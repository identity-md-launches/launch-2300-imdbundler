// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {HookFixture} from "./IMDBHook.t.sol";
import {IMDBHook} from "../src/IMDBHook.sol";
import {TestRouter} from "./mocks/TestRouter.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

contract TradeHandler is Test {
    IMDBHook public immutable hook;
    TestRouter public immutable trader;
    PoolKey private key;
    bool private pairFirst;
    uint256 public checkedTrades;

    constructor(IMDBHook hook_) {
        hook = hook_;
        key = hook_.poolKey();
        pairFirst = hook_.pairIsCurrency0();
        trader = new TestRouter(hook_.poolManager());
    }

    function trade(uint96 rawAmount, bool buy, bool exactIn) external {
        uint256 amount = bound(rawAmount, 1, 1000 ether);
        bool zeroForOne = buy == pairFirst;
        uint256 feeBefore = hook.totalFeesIMD();
        BalanceDelta delta = trader.swap(
            key,
            SwapParams(
                zeroForOne,
                exactIn ? -int256(amount) : int256(amount),
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            )
        );
        uint256 fee = hook.totalFeesIMD() - feeBefore;
        int256 pairDelta = pairFirst ? int256(delta.amount0()) : int256(delta.amount1());
        assertEq(fee, buy ? uint256(-pairDelta) / 50 : (uint256(pairDelta) + fee) / 50);
        checkedTrades++;
    }

    function retry() external {
        hook.processFees();
    }
}

abstract contract HookInvariants is HookFixture {
    TradeHandler handler;

    function setUp() public override {
        super.setUp();
        seed();
        handler = new TradeHandler(hook);
        token.transfer(address(handler.trader()), 50_000_000 ether);
        pair.mint(address(handler.trader()), 50_000_000 ether);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = TradeHandler.trade.selector;
        selectors[1] = TradeHandler.retry.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_feesConservedAndBurnsMatchSupply() public view {
        assertSettled();
    }

    function invariant_noTaxOrAdminBalancesAccumulate() public view {
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(pair.balanceOf(address(hook)), 0);
        assertLe(hook.totalBurned(), token.INITIAL_SUPPLY());
    }
}

contract PairFirstInvariantTest is HookInvariants {
    function pairFirst() internal pure override returns (bool) {
        return true;
    }
}

contract TokenFirstInvariantTest is HookInvariants {
    function pairFirst() internal pure override returns (bool) {
        return false;
    }
}
