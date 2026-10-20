// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {HookFixture} from "./IMDBHook.t.sol";
import {BatchRouter} from "./mocks/BatchRouter.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

/// @dev Adversarial coverage of the two revised rules in IMDBHook._process / _burnAvailableTokens:
/// (1) no IMDB take while IMDB is the manager's synced currency, (2) no buyback without liquidity at
/// the current tick. Every check is against what payers actually transferred, not hook counters alone.
abstract contract HookRevisionBehavior is HookFixture {
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

    function syncPayOp(Currency currency, uint256 amount) internal pure returns (BatchRouter.Op memory) {
        return BatchRouter.Op(BatchRouter.Kind.SyncAndPay, abi.encode(currency, amount));
    }

    function swapOp(SwapParams memory p) internal pure returns (BatchRouter.Op memory) {
        return BatchRouter.Op(BatchRouter.Kind.Swap, abi.encode(p));
    }

    function settleOp() internal pure returns (BatchRouter.Op memory) {
        return BatchRouter.Op(BatchRouter.Kind.Settle, "");
    }

    function batchSettled() internal view {
        assertEq(manager.currencyDelta(address(batch), key.currency0), 0);
        assertEq(manager.currencyDelta(address(batch), key.currency1), 0);
        assertEq(Currency.unwrap(manager.getSyncedCurrency()), address(0));
    }

    /// forge-config: default.fuzz.runs = 512
    /// @dev Any payer, whatever it syncs before the swap and however much it prepays, ends up paying
    /// exactly the swap's settled deltas: the hook never shrinks a pending settle() credit.
    function testFuzz_midSyncPayerPaysExactlyTheSwapDeltas(
        bool buy,
        bool exactIn,
        bool syncToken,
        uint256 rawAmount,
        uint256 rawPrepay
    ) public {
        seed();
        uint256 amount = bound(rawAmount, 1, 200_000 ether);
        uint256 prepay = bound(rawPrepay, 0, 1_000_000 ether);
        Currency synced = Currency.wrap(syncToken ? address(token) : IMD);
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](3);
        ops[0] = syncPayOp(synced, prepay);
        ops[1] = swapOp(params(buy, exactIn, amount, false));
        ops[2] = settleOp();
        uint256 tokenBefore = token.balanceOf(address(batch));
        uint256 pairBefore = pair.balanceOf(address(batch));
        BalanceDelta d = batch.run(key, ops)[1];
        assertEq(int256(token.balanceOf(address(batch))) - int256(tokenBefore), tokenOf(d), "IMDB paid != delta");
        assertEq(int256(pair.balanceOf(address(batch))) - int256(pairBefore), pairOf(d), "IMD paid != delta");
        uint256 fee = hook.totalFeesIMD();
        if (buy) assertEq(fee, uint256(-pairOf(d)) / 50);
        else assertEq(fee, (uint256(pairOf(d)) + fee) / 50);
        batchSettled();
        assertSettled();
        // Whatever was deferred is burned by one later permissionless retry; nothing is stranded.
        vm.prank(makeAddr("anyone"));
        hook.processFees();
        assertEq(hook.pendingIMDB(), 0);
        assertSettled();
    }

    /// @dev A third party that merely has IMDB synced while buying defers the burn but cannot profit:
    /// it pays its whole budget, receives only the swap output, and the deferred claim stays the hook's.
    function test_buyerWithTokenSyncedDefersBurnWithoutGain() public {
        seed();
        uint256 budget = 1_000 ether;
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](3);
        ops[0] = syncPayOp(Currency.wrap(address(token)), 0);
        ops[1] = swapOp(params(true, true, budget, false));
        ops[2] = settleOp();
        uint256 tokenBefore = token.balanceOf(address(batch));
        uint256 pairBefore = pair.balanceOf(address(batch));
        BalanceDelta d = batch.run(key, ops)[1];
        assertEq(pairBefore - pair.balanceOf(address(batch)), budget);
        assertEq(token.balanceOf(address(batch)) - tokenBefore, uint256(tokenOf(d)));
        assertEq(hook.totalFeesIMD(), budget / 50);
        assertGt(hook.totalBuybackIMD(), 0);
        assertEq(hook.totalBurned(), 0, "burned while IMDB was synced");
        uint256 deferred = hook.pendingIMDB();
        assertGt(deferred, 0);
        assertGe(token.balanceOf(address(manager)), deferred);
        batchSettled();
        assertSettled();
        hook.processFees();
        assertEq(hook.totalBurned(), deferred);
        assertEq(hook.pendingIMDB(), 0);
        assertSettled();
    }

    /// @dev Several swaps run inside one sync window. Each buyback mints claims; none is taken until
    /// the payer has settled, and the payer's IMDB outflow equals the summed swap deltas.
    function test_twoSwapsInsideOneTokenSyncWindow() public {
        seed();
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](4);
        ops[0] = syncPayOp(Currency.wrap(address(token)), 500 ether);
        ops[1] = swapOp(params(false, true, 500 ether, false));
        ops[2] = swapOp(params(true, true, 300 ether, false));
        ops[3] = settleOp();
        uint256 tokenBefore = token.balanceOf(address(batch));
        uint256 pairBefore = pair.balanceOf(address(batch));
        BalanceDelta[] memory d = batch.run(key, ops);
        assertEq(int256(token.balanceOf(address(batch))) - int256(tokenBefore), tokenOf(d[1]) + tokenOf(d[2]));
        assertEq(int256(pair.balanceOf(address(batch))) - int256(pairBefore), pairOf(d[1]) + pairOf(d[2]));
        assertEq(hook.totalBurned(), 0);
        assertGt(hook.pendingIMDB(), 0);
        batchSettled();
        assertSettled();
        // An ordinary later swap (nothing synced) burns the backlog in its own flow.
        router.swap(key, params(true, true, 10 ether, false));
        assertEq(hook.pendingIMDB(), 0);
        assertGt(hook.totalBurned(), 0);
        assertSettled();
    }

    /// @dev Settling the sync before the swap (SETTLE then SWAP) clears the synced currency, so the
    /// same flow burns immediately. Proves the deferral is keyed on the live sync, not on prepayment.
    function test_settleBeforeSwapClearsSyncAndBurnsInFlow() public {
        seed();
        BatchRouter.Op[] memory ops = new BatchRouter.Op[](3);
        ops[0] = syncPayOp(Currency.wrap(address(token)), 500 ether);
        ops[1] = settleOp();
        ops[2] = swapOp(params(false, true, 500 ether, false));
        uint256 tokenBefore = token.balanceOf(address(batch));
        batch.run(key, ops);
        assertEq(tokenBefore - token.balanceOf(address(batch)), 500 ether);
        assertGt(hook.totalBurned(), 0);
        assertEq(hook.pendingIMDB(), 0);
        batchSettled();
        assertSettled();
    }

    /// @dev The empty-range rule gates only the buyback. Deferred IMDB claims still burn on a retry
    /// with zero liquidity anywhere, and the price does not move.
    function test_deferredBurnStillRunsWithNoLiquidity() public {
        seed();
        router.swapPrepaid(
            key, params(false, true, 1_000 ether, false), Currency.wrap(address(token)), 1_000 ether, false
        );
        uint256 deferred = hook.pendingIMDB();
        assertGt(deferred, 0);
        router.modify(key, -887220, 887220, -int256(1_000_000 ether));
        assertEq(manager.getLiquidity(key.toId()), 0);
        (uint160 priceBefore,,,) = manager.getSlot0(key.toId());
        hook.processFees();
        (uint160 priceAfter,,,) = manager.getSlot0(key.toId());
        assertEq(priceAfter, priceBefore);
        assertEq(hook.pendingIMDB(), 0);
        assertEq(hook.totalBurned(), deferred);
        assertSettled();
    }

    /// @dev Dust liquidity at the current tick re-enables one buyback. It may run off the dust into an
    /// empty range, but never past the fixed ±1% sqrt-price bound, and the next retry (current tick now
    /// empty) moves nothing. Free price walking stays one bound per liquidity placement.
    function test_dustInRangeLiquidityBuybackStaysWithinBound() public {
        seed();
        router.swap(key, params(true, true, 20_000_000 ether, false));
        uint256 pending = hook.pendingIMD();
        assertGt(pending, 0);
        router.modify(key, -887220, 887220, -int256(1_000_000 ether));
        (uint160 p0, int24 tick,,) = manager.getSlot0(key.toId());
        int24 lower = tick >= 0 ? (tick / 60) * 60 : ((tick - 59) / 60) * 60;
        router.modify(key, lower, lower + 60, 1e9);
        assertGt(manager.getLiquidity(key.toId()), 0);
        hook.processFees();
        (uint160 p1,,,) = manager.getSlot0(key.toId());
        if (pairFirst()) {
            assertLe(p1, p0);
            assertGe(uint256(p1), uint256(p0) * 9_900 / 10_000);
        } else {
            assertGe(p1, p0);
            assertLe(uint256(p1), uint256(p0) * 10_100 / 10_000);
        }
        assertLt(hook.pendingIMD(), pending);
        assertSettled();
        if (manager.getLiquidity(key.toId()) == 0) {
            uint256 spent = hook.totalBuybackIMD();
            hook.processFees();
            (uint160 p2,,,) = manager.getSlot0(key.toId());
            assertEq(p2, p1);
            assertEq(hook.totalBuybackIMD(), spent);
        }
        assertSettled();
    }

    /// @dev A user buy that drains the in-range liquidity and stops inside an empty range is charged 2%
    /// of what it settled; its afterSwap buyback is skipped (not reverted) and the fee waits as a claim.
    function test_userSwapEndingInEmptyRangeKeepsFeePending() public {
        router.modify(key, -60, 60, 1e21);
        bool zeroForOne = pairFirst();
        SwapParams memory p = SwapParams(
            zeroForOne, -int256(1_000_000 ether), TickMath.getSqrtPriceAtTick(zeroForOne ? int24(-3000) : int24(3000))
        );
        uint256 pairBefore = pair.balanceOf(address(router));
        BalanceDelta d = router.swap(key, p);
        uint256 paid = pairBefore - pair.balanceOf(address(router));
        assertEq(uint256(-pairOf(d)), paid);
        assertLt(paid, 1_000_000 ether);
        assertEq(manager.getLiquidity(key.toId()), 0);
        uint256 fee = hook.totalFeesIMD();
        assertGt(fee, 0);
        assertEq(fee, paid / 50);
        assertEq(hook.totalBuybackIMD(), 0);
        assertEq(hook.pendingIMD(), fee);
        // The skipped buyback leaves the price exactly where the user's swap stopped.
        (uint160 price,,,) = manager.getSlot0(key.toId());
        assertEq(price, p.sqrtPriceLimitX96);
        assertSettled();
    }
}

contract PairFirstHookRevisionTest is HookRevisionBehavior {
    function pairFirst() internal pure override returns (bool) {
        return true;
    }
}

contract TokenFirstHookRevisionTest is HookRevisionBehavior {
    function pairFirst() internal pure override returns (bool) {
        return false;
    }
}
