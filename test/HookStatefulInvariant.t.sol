// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {HookFixture} from "./IMDBHook.t.sol";
import {IMDBHook} from "../src/IMDBHook.sol";
import {IMDBToken} from "../src/IMDBToken.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {TestRouter} from "./mocks/TestRouter.sol";
import {BatchRouter} from "./mocks/BatchRouter.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

/// @dev Several traders, an LP that comes and goes, batched swaps in one unlock, ERC-6909 claim
/// donations and permissionless processing, all in random order with bounded inputs.
contract MultiActorHandler is Test {
    using StateLibrary for IPoolManager;

    struct Position {
        int24 lower;
        int24 upper;
        uint128 liquidity;
    }

    IMDBHook public immutable hook;
    IPoolManager public immutable manager;
    IMDBToken public immutable token;
    MockERC20 public immutable pair;
    TestRouter public immutable lp;
    BatchRouter public immutable batch;
    TestRouter[3] public traders;
    bool private immutable pairFirst;
    PoolKey private key;
    Position[] public positions;

    uint256 public ghostDonatedIMD;
    uint256 public ghostLastBurned;
    uint256 public ghostLastFees;
    bool public ghostMonotonic = true;
    uint256 public trades;

    constructor(IMDBHook hook_, MockERC20 pair_) {
        hook = hook_;
        manager = hook_.poolManager();
        token = hook_.token();
        pair = pair_;
        key = hook_.poolKey();
        pairFirst = hook_.pairIsCurrency0();
        lp = new TestRouter(manager);
        batch = new BatchRouter(manager);
        for (uint256 i; i < 3; ++i) {
            traders[i] = new TestRouter(manager);
        }
    }

    function fund() external {
        address[5] memory who =
            [address(lp), address(batch), address(traders[0]), address(traders[1]), address(traders[2])];
        for (uint256 i; i < who.length; ++i) {
            token.transfer(who[i], 10_000_000 ether);
            pair.mint(who[i], 1_000_000_000 ether);
        }
    }

    function positionCount() external view returns (uint256) {
        return positions.length;
    }

    function _limit(bool zeroForOne, uint256 rawTicks) private view returns (uint160) {
        (, int24 tick,,) = manager.getSlot0(key.toId());
        uint256 distance = bound(rawTicks, 1, 6000);
        int256 t = zeroForOne ? int256(tick) - int256(distance) : int256(tick) + int256(distance);
        if (t <= TickMath.MIN_TICK) return TickMath.MIN_SQRT_PRICE + 1;
        if (t >= TickMath.MAX_TICK) return TickMath.MAX_SQRT_PRICE - 1;
        return TickMath.getSqrtPriceAtTick(int24(t));
    }

    function _pair(BalanceDelta d) private view returns (int256) {
        return pairFirst ? int256(d.amount0()) : int256(d.amount1());
    }

    function _checkFee(bool buy, BalanceDelta d, uint256 fee) private view {
        int256 p = _pair(d);
        if (buy) {
            assertLe(p, 0);
            assertEq(fee, uint256(-p) / 50, "buy fee is not floor(total IMD paid / 50)");
        } else {
            assertGe(p, 0);
            assertEq(fee, (uint256(p) + fee) / 50, "sell fee is not floor(gross IMD / 50)");
        }
    }

    function _params(bool buy, bool exactIn, uint256 rawAmount, uint256 rawTicks)
        private
        view
        returns (SwapParams memory)
    {
        uint256 amount = bound(rawAmount, 1, 100_000 ether);
        bool zeroForOne = buy == pairFirst;
        return SwapParams(zeroForOne, exactIn ? -int256(amount) : int256(amount), _limit(zeroForOne, rawTicks));
    }

    function _track() private {
        if (hook.totalBurned() < ghostLastBurned || hook.totalFeesIMD() < ghostLastFees) ghostMonotonic = false;
        ghostLastBurned = hook.totalBurned();
        ghostLastFees = hook.totalFeesIMD();
    }

    function trade(uint256 actor, bool buy, bool exactIn, uint256 rawAmount, uint256 rawTicks) external {
        TestRouter trader = traders[actor % 3];
        uint256 feeBefore = hook.totalFeesIMD();
        BalanceDelta d = trader.swap(key, _params(buy, exactIn, rawAmount, rawTicks));
        _checkFee(buy, d, hook.totalFeesIMD() - feeBefore);
        trades++;
        _track();
    }

    function batchTrade(bool buyFirst, bool exactIn, uint256 rawAmount, uint256 rawTicks) external {
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](2);
        ops[0] = BatchRouter.Op(BatchRouter.Kind.Swap, abi.encode(_params(buyFirst, exactIn, rawAmount, rawTicks)));
        // The second leg's limit is computed against the pre-batch price; keep it unbounded so it cannot revert.
        bool zeroForOne = !buyFirst == pairFirst;
        uint256 amount = bound(rawAmount >> 8, 1, 50_000 ether);
        ops[1] = BatchRouter.Op(
            BatchRouter.Kind.Swap,
            abi.encode(
                SwapParams(
                    zeroForOne,
                    exactIn ? -int256(amount) : int256(amount),
                    zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                )
            )
        );
        uint256 feeBefore = hook.totalFeesIMD();
        BalanceDelta[] memory d = batch.run(key, ops);
        uint256 charged = hook.totalFeesIMD() - feeBefore;
        // The buy leg's fee is determined by its debit alone; the remainder must satisfy the sell rule.
        BalanceDelta buyLeg = buyFirst ? d[0] : d[1];
        BalanceDelta sellLeg = buyFirst ? d[1] : d[0];
        uint256 buyFee = uint256(-_pair(buyLeg)) / 50;
        assertLe(buyFee, charged);
        _checkFee(false, sellLeg, charged - buyFee);
        trades += 2;
        _track();
    }

    function addLiquidity(uint256 rawCenter, uint256 rawWidth, uint256 rawLiquidity) external {
        (, int24 tick,,) = manager.getSlot0(key.toId());
        int256 center = (int256(tick) / 60) * 60 + (int256(bound(rawCenter, 0, 200)) - 100) * 60;
        int256 width = int256(bound(rawWidth, 1, 100)) * 60;
        int256 lower = center - width;
        int256 upper = center + width;
        if (lower < -887220 || upper > 887220) return;
        uint128 liquidity = uint128(bound(rawLiquidity, 1e15, 1e22));
        lp.modify(key, int24(lower), int24(upper), int256(uint256(liquidity)));
        positions.push(Position(int24(lower), int24(upper), liquidity));
        _track();
    }

    function removeLiquidity(uint256 index) external {
        if (positions.length == 0) return;
        index = index % positions.length;
        Position memory p = positions[index];
        positions[index] = positions[positions.length - 1];
        positions.pop();
        BalanceDelta d = lp.modify(key, p.lower, p.upper, -int256(uint256(p.liquidity)));
        assertGe(d.amount0(), 0);
        assertGe(d.amount1(), 0);
        _track();
    }

    function donateClaim(uint256 rawAmount) external {
        uint256 amount = bound(rawAmount, 1, 1_000 ether);
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](1);
        ops[0] =
            BatchRouter.Op(BatchRouter.Kind.MintClaim, abi.encode(address(hook), Currency.wrap(address(pair)), amount));
        batch.run(key, ops);
        ghostDonatedIMD += amount;
        _track();
    }

    function process(address caller) external {
        vm.prank(caller);
        hook.processFees();
        _track();
    }

    function removeAll() external {
        while (positions.length != 0) {
            Position memory p = positions[positions.length - 1];
            positions.pop();
            lp.modify(key, p.lower, p.upper, -int256(uint256(p.liquidity)));
        }
    }
}

abstract contract MultiActorInvariants is HookFixture {
    MultiActorHandler handler;

    function setUp() public override {
        super.setUp();
        seed();
        handler = new MultiActorHandler(hook, pair);
        token.transfer(address(handler), 50_000_000 ether);
        handler.fund();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = MultiActorHandler.trade.selector;
        selectors[1] = MultiActorHandler.batchTrade.selector;
        selectors[2] = MultiActorHandler.addLiquidity.selector;
        selectors[3] = MultiActorHandler.removeLiquidity.selector;
        selectors[4] = MultiActorHandler.donateClaim.selector;
        selectors[5] = MultiActorHandler.process.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 40
    function invariant_supplyFallsOnlyByHookBurns() public view {
        assertEq(token.totalSupply() + hook.totalBurned(), token.INITIAL_SUPPLY());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 40
    function invariant_imdClaimsConserved() public view {
        assertEq(hook.pendingIMD() + hook.totalBuybackIMD(), hook.totalFeesIMD() + handler.ghostDonatedIMD());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 40
    function invariant_managerBacksHookClaimsAtRest() public view {
        assertGe(pair.balanceOf(address(manager)), hook.pendingIMD());
        assertGe(token.balanceOf(address(manager)), hook.pendingIMDB());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 40
    function invariant_hookHoldsNoErc20AndCountersOnlyGrow() public view {
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(pair.balanceOf(address(hook)), 0);
        assertTrue(handler.ghostMonotonic());
    }

    /// @dev After any sequence, every LP can exit and anyone can still run the buyback.
    function afterInvariant() public {
        handler.removeAll();
        hook.processFees();
        assertEq(token.totalSupply() + hook.totalBurned(), token.INITIAL_SUPPLY());
        assertEq(hook.pendingIMD() + hook.totalBuybackIMD(), hook.totalFeesIMD() + handler.ghostDonatedIMD());
    }
}

contract PairFirstMultiActorInvariantTest is MultiActorInvariants {
    function pairFirst() internal pure override returns (bool) {
        return true;
    }
}

contract TokenFirstMultiActorInvariantTest is MultiActorInvariants {
    function pairFirst() internal pure override returns (bool) {
        return false;
    }
}
