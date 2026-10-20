// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {HookFixture} from "./IMDBHook.t.sol";
import {IMDBHook} from "../src/IMDBHook.sol";
import {HookBase} from "../src/HookBase.sol";
import {BatchRouter} from "./mocks/BatchRouter.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";

abstract contract HookEdgeBehavior is HookFixture {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    BatchRouter batch;

    function setUp() public virtual override {
        super.setUp();
        batch = new BatchRouter(manager);
        token.transfer(address(batch), 50_000_000 ether);
        pair.mint(address(batch), 1_000_000_000 ether);
    }

    function pairOf(BalanceDelta d) internal pure returns (int256) {
        return pairFirst() ? int256(d.amount0()) : int256(d.amount1());
    }

    function tokenOf(BalanceDelta d) internal pure returns (int256) {
        return pairFirst() ? int256(d.amount1()) : int256(d.amount0());
    }

    /// @dev The exact-2% rule from docs/HOOK.md, checked against the settled router delta only.
    function assertTwoPercent(bool buy, BalanceDelta d, uint256 fee) internal pure {
        int256 p = pairOf(d);
        if (buy) {
            assertLe(p, 0);
            assertEq(fee, uint256(-p) / 50, "buy fee != floor(total paid / 50)");
        } else {
            assertGe(p, 0);
            assertEq(fee, (uint256(p) + fee) / 50, "sell fee != floor(gross / 50)");
        }
    }

    function limitAway(bool zeroForOne, uint256 tickDistance) internal view returns (uint160) {
        (, int24 tick,,) = manager.getSlot0(key.toId());
        int256 t = zeroForOne ? int256(tick) - int256(tickDistance) : int256(tick) + int256(tickDistance);
        if (t <= TickMath.MIN_TICK) return TickMath.MIN_SQRT_PRICE + 1;
        if (t >= TickMath.MAX_TICK) return TickMath.MAX_SQRT_PRICE - 1;
        return TickMath.getSqrtPriceAtTick(int24(t));
    }

    function swapOp(SwapParams memory p) internal pure returns (BatchRouter.Op memory) {
        return BatchRouter.Op(BatchRouter.Kind.Swap, abi.encode(p));
    }

    // ---------------------------------------------------------------- property tests

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_randomPriceLimitsNeverMischargeOrRevert(
        bool buy,
        bool exactIn,
        uint256 rawAmount,
        uint256 rawTicks
    ) public {
        seed();
        uint256 amount = bound(rawAmount, 1, 5_000_000 ether);
        bool zeroForOne = buy == pairFirst();
        SwapParams memory p = SwapParams(
            zeroForOne, exactIn ? -int256(amount) : int256(amount), limitAway(zeroForOne, bound(rawTicks, 1, 20_000))
        );
        uint256 pairBefore = pair.balanceOf(address(router));
        uint256 tokenBefore = token.balanceOf(address(router));
        BalanceDelta d = router.swap(key, p);
        uint256 fee = hook.totalFeesIMD();
        assertTwoPercent(buy, d, fee);
        // The specified side never exceeds what the trader asked for, fee included.
        if (buy && exactIn) assertLe(pairBefore - pair.balanceOf(address(router)), amount);
        if (buy && !exactIn) assertLe(token.balanceOf(address(router)) - tokenBefore, amount);
        if (!buy && exactIn) assertLe(tokenBefore - token.balanceOf(address(router)), amount);
        if (!buy && !exactIn) assertLe(pair.balanceOf(address(router)) - pairBefore, amount);
        assertSettled();
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_protocolFeeDoesNotBreakFeeAccounting(bool buy, bool exactIn, uint256 rawAmount, uint256 rawTicks)
        public
    {
        manager.setProtocolFeeController(address(this));
        manager.setProtocolFee(key, uint24(1000) | (uint24(1000) << 12));
        seed();
        uint256 amount = bound(rawAmount, 1 ether, 300_000 ether);
        bool zeroForOne = buy == pairFirst();
        SwapParams memory p = SwapParams(
            zeroForOne, exactIn ? -int256(amount) : int256(amount), limitAway(zeroForOne, bound(rawTicks, 1, 887_272))
        );
        BalanceDelta d = router.swap(key, p);
        assertTwoPercent(buy, d, hook.totalFeesIMD());
        assertGt(hook.totalFeesIMD(), 0);
        assertSettled();
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_exactOutputSellDeliversRequestedNet(uint256 rawAmount) public {
        seed();
        uint256 amount = bound(rawAmount, 1, 300_000 ether);
        uint256 before = pair.balanceOf(address(router));
        router.swap(key, params(false, false, amount, false));
        assertEq(pair.balanceOf(address(router)) - before, amount);
        assertEq(hook.totalFeesIMD(), amount / 49);
        assertSettled();
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_exactInputBuyNeverDebitsMoreThanBudget(uint256 rawAmount) public {
        seed();
        uint256 amount = bound(rawAmount, 1, 300_000 ether);
        uint256 before = pair.balanceOf(address(router));
        router.swap(key, params(true, true, amount, false));
        assertEq(before - pair.balanceOf(address(router)), amount);
        assertEq(hook.totalFeesIMD(), amount / 50);
        assertSettled();
    }

    // ---------------------------------------------------------------- pinned edges

    function test_exactInputBuyRoundingBoundaries() public {
        seed();
        uint256[6] memory amounts = [uint256(1), 49, 50, 99, 100, 149];
        uint256 total;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 before = pair.balanceOf(address(router));
            router.swap(key, params(true, true, amounts[i], false));
            assertEq(before - pair.balanceOf(address(router)), amounts[i]);
            total += amounts[i] / 50;
            assertEq(hook.totalFeesIMD(), total);
        }
        assertEq(total, 0 + 0 + 1 + 1 + 2 + 2);
        assertSettled();
    }

    function test_twoOppositeSwapsInOneUnlockAreEachCharged() public {
        seed();
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](4);
        ops[0] = swapOp(params(true, true, 1000 ether, false));
        ops[1] = swapOp(params(false, true, 500 ether, false));
        ops[2] = swapOp(params(true, false, 300 ether, false));
        ops[3] = swapOp(params(false, false, 200 ether, false));
        BalanceDelta[] memory d = batch.run(key, ops);
        uint256 buyFees = uint256(-pairOf(d[0])) / 50 + uint256(-pairOf(d[2])) / 50;
        // Exact-out sell of a net 200 IMD costs floor(200e18 / 49); the exact-in sell takes the rest.
        assertEq(pairOf(d[3]), 200 ether);
        uint256 exactInSellFee = hook.totalFeesIMD() - buyFees - uint256(200 ether) / 49;
        assertEq(exactInSellFee, (uint256(pairOf(d[1])) + exactInSellFee) / 50);
        assertGt(exactInSellFee, 0);
        assertGt(hook.totalBurned(), 0);
        assertEq(manager.currencyDelta(address(batch), key.currency0), 0);
        assertEq(manager.currencyDelta(address(batch), key.currency1), 0);
        assertEq(hook.totalFeesIMD(), hook.totalBuybackIMD() + hook.pendingIMD());
        assertEq(token.INITIAL_SUPPLY() - token.totalSupply(), hook.totalBurned());
    }

    function test_processFeesInsideAnotherUnlockReverts() public {
        seed();
        router.swap(key, params(true, true, 20_000_000 ether, false));
        uint256 pending = hook.pendingIMD();
        assertGt(pending, 0);
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](1);
        ops[0] =
            BatchRouter.Op(BatchRouter.Kind.Call, abi.encode(address(hook), abi.encodeCall(IMDBHook.processFees, ())));
        vm.expectRevert(IPoolManager.AlreadyUnlocked.selector);
        batch.run(key, ops);
        assertEq(hook.pendingIMD(), pending);
        assertSettled();
    }

    function test_processFeesWithNothingPendingIsANoOpForAnyone() public {
        seed();
        uint256 supply = token.totalSupply();
        vm.prank(makeAddr("anyone"));
        hook.processFees();
        assertEq(token.totalSupply(), supply);
        assertEq(hook.totalBuybackIMD(), 0);
        assertSettled();
    }

    function test_donatedImdClaimsAreBoughtBackAndBurnedNotWithdrawable() public {
        seed();
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](1);
        ops[0] = BatchRouter.Op(BatchRouter.Kind.MintClaim, abi.encode(address(hook), Currency.wrap(IMD), 10 ether));
        batch.run(key, ops);
        assertEq(hook.pendingIMD(), 10 ether);
        assertEq(hook.totalFeesIMD(), 0);
        vm.prank(makeAddr("keeper"));
        hook.processFees();
        assertEq(hook.pendingIMD(), 0);
        assertEq(hook.totalBuybackIMD(), 10 ether);
        assertGt(hook.totalBurned(), 0);
        assertEq(token.INITIAL_SUPPLY() - token.totalSupply(), hook.totalBurned());
        assertEq(pair.balanceOf(address(hook)), 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }

    function test_buybackSkippedAtTerminalPriceRetainsClaimWithoutReverting() public {
        // One narrow position on the buy side; a buy drains it and parks the price at the extreme.
        router.modify(key, pairFirst() ? int24(-120) : int24(60), pairFirst() ? int24(-60) : int24(120), 1e20);
        bool zeroForOne = pairFirst();
        router.swap(
            key,
            SwapParams(
                zeroForOne, -int256(1e30), zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            )
        );
        (uint160 price,,,) = manager.getSlot0(key.toId());
        assertEq(price, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
        uint256 pending = hook.pendingIMD();
        assertGt(hook.totalFeesIMD(), 0);
        assertEq(hook.totalFeesIMD(), hook.totalBuybackIMD() + pending);
        hook.processFees();
        assertEq(hook.pendingIMD(), pending);
        assertSettled();
    }

    function test_freshManagerTokenOnlyPoolExactOutputBuy() public {
        router.modify(
            key, pairFirst() ? int24(-120) : int24(60), pairFirst() ? int24(-60) : int24(120), 1_000_000 ether
        );
        assertEq(pair.balanceOf(address(manager)), 0);
        BalanceDelta d = router.swap(key, params(true, false, 10 ether, false));
        assertEq(tokenOf(d), 10 ether);
        assertTwoPercent(true, d, hook.totalFeesIMD());
        assertGt(hook.totalFeesIMD(), 0);
        assertSettled();
    }

    // ---------------------------------------------------------------- direct callback failure paths

    function test_wrongPoolKeyRejectedEvenFromManager() public {
        PoolKey memory wrong = key;
        wrong.fee = 3000;
        SwapParams memory p = params(false, true, 1 ether, false);
        vm.startPrank(address(manager));
        vm.expectRevert(IMDBHook.WrongPool.selector);
        hook.beforeInitialize(address(this), wrong, Q96);
        vm.expectRevert(IMDBHook.WrongPool.selector);
        hook.beforeSwap(address(this), wrong, p, "");
        vm.expectRevert(IMDBHook.WrongPool.selector);
        hook.afterSwap(address(this), wrong, p, BalanceDeltaLibrary.ZERO_DELTA, "");
        wrong = key;
        wrong.hooks = IHooks(address(0xBEEF));
        vm.expectRevert(IMDBHook.WrongPool.selector);
        hook.beforeSwap(address(this), wrong, p, "");
        wrong = key;
        (wrong.currency0, wrong.currency1) = (key.currency1, key.currency0);
        vm.expectRevert(IMDBHook.WrongPool.selector);
        hook.beforeSwap(address(this), wrong, p, "");
        vm.stopPrank();
    }

    function test_callbackPhaseGuards() public {
        // Sell exact-in needs no self-quote, so it can be driven directly outside an unlock.
        SwapParams memory p = params(false, true, 1 ether, false);
        vm.startPrank(address(manager));
        vm.expectRevert(IMDBHook.Busy.selector);
        hook.afterSwap(address(this), key, p, BalanceDeltaLibrary.ZERO_DELTA, "");
        hook.beforeSwap(address(this), key, p, "");
        vm.expectRevert(IMDBHook.Busy.selector);
        hook.beforeSwap(address(this), key, p, "");
        vm.stopPrank();
        vm.expectRevert(IMDBHook.Busy.selector);
        hook.processFees();
        vm.prank(address(manager));
        (bytes4 sel, int128 ret) = hook.afterSwap(address(this), key, p, BalanceDeltaLibrary.ZERO_DELTA, "");
        assertEq(sel, IHooks.afterSwap.selector);
        assertEq(ret, 0);
        // Guards are released: a fresh pair of callbacks works again.
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, p, "");
    }

    function test_specifiedAmountBounds() public {
        vm.startPrank(address(manager));
        SwapParams memory p = params(false, true, 1, false);
        p.amountSpecified = type(int256).min;
        vm.expectRevert(IMDBHook.AmountTooLarge.selector);
        hook.beforeSwap(address(this), key, p, "");
        p.amountSpecified = -int256(1 << 126);
        vm.expectRevert(IMDBHook.AmountTooLarge.selector);
        hook.beforeSwap(address(this), key, p, "");
        p = params(true, false, 1, false);
        p.amountSpecified = type(int256).max;
        vm.expectRevert(IMDBHook.AmountTooLarge.selector);
        hook.beforeSwap(address(this), key, p, "");
        p = params(false, true, 1, false);
        p.amountSpecified = -int256((1 << 126) - 1);
        (bytes4 sel,,) = hook.beforeSwap(address(this), key, p, "");
        assertEq(sel, IHooks.beforeSwap.selector);
        vm.stopPrank();
    }

    function test_disabledCallbacksRevertEvenForManager() public {
        ModifyLiquidityParams memory m = ModifyLiquidityParams(-60, 60, 1, bytes32(0));
        vm.startPrank(address(manager));
        vm.expectRevert(HookBase.CallbackDisabled.selector);
        hook.afterInitialize(address(this), key, Q96, 0);
        vm.expectRevert(HookBase.CallbackDisabled.selector);
        hook.beforeAddLiquidity(address(this), key, m, "");
        vm.expectRevert(HookBase.CallbackDisabled.selector);
        hook.beforeRemoveLiquidity(address(this), key, m, "");
        vm.expectRevert(HookBase.CallbackDisabled.selector);
        hook.afterAddLiquidity(
            address(this), key, m, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, ""
        );
        vm.expectRevert(HookBase.CallbackDisabled.selector);
        hook.afterRemoveLiquidity(
            address(this), key, m, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, ""
        );
        vm.expectRevert(HookBase.CallbackDisabled.selector);
        hook.beforeDonate(address(this), key, 1, 1, "");
        vm.expectRevert(HookBase.CallbackDisabled.selector);
        hook.afterDonate(address(this), key, 1, 1, "");
        vm.stopPrank();
    }

    function test_donateToPoolSkipsHookAndChargesNothing() public {
        seed();
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](1);
        ops[0] = BatchRouter.Op(
            BatchRouter.Kind.Call,
            abi.encode(address(manager), abi.encodeCall(IPoolManager.donate, (key, 1 ether, 1 ether, bytes(""))))
        );
        // The batch router is not the donor here (manager call is from the router), so it owes the donation.
        batch.run(key, ops);
        assertEq(hook.totalFeesIMD(), 0);
    }

    function test_hookPinsTheLaunchConfiguration() public view {
        assertEq(hook.IMD(), IMD);
        assertEq(hook.LP_FEE(), 12_500);
        assertEq(hook.TICK_SPACING(), 60);
        assertEq(hook.FEE_BPS(), 200);
        assertEq(address(hook.token()), address(token));
        assertEq(address(hook.poolManager()), address(manager));
        PoolKey memory k = hook.poolKey();
        assertEq(Currency.unwrap(k.currency0) < Currency.unwrap(k.currency1), true);
        assertEq(address(k.hooks), address(hook));
    }
}

contract PairFirstHookEdgeTest is HookEdgeBehavior {
    function pairFirst() internal pure override returns (bool) {
        return true;
    }
}

contract TokenFirstHookEdgeTest is HookEdgeBehavior {
    function pairFirst() internal pure override returns (bool) {
        return false;
    }
}
