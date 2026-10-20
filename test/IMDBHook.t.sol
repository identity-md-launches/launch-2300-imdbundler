// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {IMDBToken} from "../src/IMDBToken.sol";
import {IMDBHook} from "../src/IMDBHook.sol";
import {HookBase} from "../src/HookBase.sol";
import {HookFlags} from "../src/HookFlags.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {TestRouter} from "./mocks/TestRouter.sol";
import {ReentryProbeManager} from "./mocks/ReentryProbeManager.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";

abstract contract HookFixture is Test {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    address constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    IMDBToken token;
    MockERC20 pair;
    IMDBHook hook;
    IPoolManager manager;
    TestRouter router;
    PoolKey key;
    uint160 constant Q96 = 79228162514264337593543950336;
    function pairFirst() internal pure virtual returns (bool);

    function setUp() public virtual {
        manager = IPoolManager(address(new PoolManager(address(this))));
        pair = MockERC20(IMD);
        vm.etch(IMD, address(new MockERC20("IMD", "IMD", 0)).code);
        for (uint256 i; i < 100; ++i) {
            token = new IMDBToken();
            if ((IMD < address(token)) == pairFirst()) break;
        }
        assertEq(IMD < address(token), pairFirst());
        bytes memory creation = abi.encodePacked(type(IMDBHook).creationCode, abi.encode(manager, token));
        bytes32 hash = keccak256(creation);
        bool deployed;
        for (uint256 i; i < 200_000; ++i) {
            bytes32 salt = bytes32(i);
            address predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hash)))));
            if (!HookFlags.matches(predicted, 0x20cc)) continue;
            hook = new IMDBHook{salt: salt}(manager, token);
            assertEq(address(hook), predicted);
            deployed = true;
            break;
        }
        assertTrue(deployed);
        key = hook.poolKey();
        manager.initialize(key, Q96);
        router = new TestRouter(manager);
        token.transfer(address(router), 900_000_000 ether);
        pair.mint(address(router), 1_000_000_000 ether);
    }

    function seed() internal {
        router.modify(key, -887220, 887220, 1_000_000 ether);
    }

    function params(bool buy, bool exactIn, uint256 amount, bool partialFill)
        internal
        pure
        returns (SwapParams memory)
    {
        bool zeroForOne = buy == pairFirst();
        uint160 limit = partialFill
            ? TickMath.getSqrtPriceAtTick(zeroForOne ? int24(-1) : int24(1))
            : zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        return SwapParams(zeroForOne, exactIn ? -int256(amount) : int256(amount), limit);
    }

    function assertSettled() internal view {
        assertEq(manager.currencyDelta(address(hook), key.currency0), 0);
        assertEq(manager.currencyDelta(address(hook), key.currency1), 0);
        assertEq(manager.currencyDelta(address(router), key.currency0), 0);
        assertEq(manager.currencyDelta(address(router), key.currency1), 0);
        assertEq(hook.totalFeesIMD(), hook.totalBuybackIMD() + hook.pendingIMD());
        assertEq(token.INITIAL_SUPPLY() - token.totalSupply(), hook.totalBurned());
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(pair.balanceOf(address(hook)), 0);
    }
}

abstract contract HookBehavior is HookFixture {
    function test_permissionsAndInitialization() public {
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(
            p.beforeInitialize && p.beforeSwap && p.afterSwap && p.beforeSwapReturnDelta && p.afterSwapReturnDelta
        );
        assertFalse(p.beforeRemoveLiquidity || p.afterRemoveLiquidity || p.afterInitialize || p.beforeAddLiquidity);
        assertEq(HookFlags.flagsOf(address(hook)), hook.FLAGS());
        PoolKey memory wrong = key;
        wrong.fee = 3000;
        vm.expectRevert();
        manager.initialize(wrong, Q96);
        wrong = key;
        wrong.tickSpacing = 120;
        vm.expectRevert();
        manager.initialize(wrong, Q96);
        vm.expectRevert();
        manager.initialize(key, Q96);
    }

    function test_everyEnabledCallbackRejectsForgedCallers() public {
        SwapParams memory p = params(true, true, 1 ether, false);
        vm.expectRevert(HookBase.OnlyPoolManager.selector);
        hook.beforeInitialize(address(this), key, Q96);
        vm.expectRevert(HookBase.OnlyPoolManager.selector);
        hook.beforeSwap(address(this), key, p, "");
        vm.expectRevert(HookBase.OnlyPoolManager.selector);
        hook.afterSwap(address(this), key, p, BalanceDeltaLibrary.ZERO_DELTA, "");
        vm.expectRevert(HookBase.OnlyPoolManager.selector);
        hook.unlockCallback("");
        vm.expectRevert(IMDBHook.OnlySelf.selector);
        hook.quoteSwap(key, p);
        vm.expectRevert(IMDBHook.UnexpectedUnlock.selector);
        vm.prank(address(manager));
        hook.unlockCallback("");
    }

    function checkTrade(bool buy, bool exactIn, uint256 amount, bool partialFill) internal {
        seed();
        uint256 beforePair = pair.balanceOf(address(router));
        uint256 beforeToken = token.balanceOf(address(router));
        BalanceDelta delta = router.swap(key, params(buy, exactIn, amount, partialFill));
        int256 pairDelta = pairFirst() ? int256(delta.amount0()) : int256(delta.amount1());
        int256 tokenDelta = pairFirst() ? int256(delta.amount1()) : int256(delta.amount0());
        uint256 fee = hook.totalFeesIMD();
        if (buy) {
            assertLt(pairDelta, 0);
            assertGt(tokenDelta, 0);
            uint256 paid = beforePair - pair.balanceOf(address(router));
            assertEq(paid, uint256(-pairDelta));
            assertEq(fee, paid / 50);
            assertEq(token.balanceOf(address(router)) - beforeToken, uint256(tokenDelta));
            if (!partialFill) assertEq(exactIn ? paid : uint256(tokenDelta), amount);
            else assertLt(exactIn ? paid : uint256(tokenDelta), amount);
        } else {
            assertGt(pairDelta, 0);
            assertLt(tokenDelta, 0);
            uint256 net = pair.balanceOf(address(router)) - beforePair;
            assertEq(net, uint256(pairDelta));
            assertEq(fee, (net + fee) / 50);
            assertEq(beforeToken - token.balanceOf(address(router)), uint256(-tokenDelta));
            if (!partialFill) assertEq(exactIn ? uint256(-tokenDelta) : net, amount);
            else assertLt(exactIn ? uint256(-tokenDelta) : net, amount);
        }
        assertGt(fee, 0);
        assertGt(hook.totalBurned(), 0);
        assertSettled();
    }

    function test_buyExactInput() public {
        checkTrade(true, true, 100 ether, false);
    }

    function test_buyExactOutput() public {
        checkTrade(true, false, 100 ether, false);
    }

    function test_sellExactInput() public {
        checkTrade(false, true, 100 ether, false);
    }

    function test_sellExactOutput() public {
        checkTrade(false, false, 100 ether, false);
    }

    function test_partialFillBuyExactInput() public {
        checkTrade(true, true, 10000 ether, true);
    }

    function test_partialFillBuyExactOutput() public {
        checkTrade(true, false, 10000 ether, true);
    }

    function test_partialFillSellExactInput() public {
        checkTrade(false, true, 10000 ether, true);
    }

    function test_partialFillSellExactOutput() public {
        checkTrade(false, false, 10000 ether, true);
    }

    function testFuzz_feesOnSettledDeltas(bool buy, bool exactIn, uint96 amount, bool partialFill) public {
        checkTrade(buy, exactIn, bound(amount, partialFill ? 1000 ether : 0.01 ether, 100000 ether), partialFill);
    }

    function testFuzz_dustRounding(uint16 amount, bool buy, bool exactIn) public {
        seed();
        amount = uint16(bound(amount, 1, type(uint16).max));
        BalanceDelta d = router.swap(key, params(buy, exactIn, amount, false));
        int256 p = pairFirst() ? int256(d.amount0()) : int256(d.amount1());
        uint256 fee = hook.totalFeesIMD();
        assertEq(fee, buy ? uint256(-p) / 50 : (uint256(p) + fee) / 50);
        assertSettled();
    }

    function test_freshTokenOnlyManager() public {
        router.modify(
            key, pairFirst() ? int24(-120) : int24(60), pairFirst() ? int24(-60) : int24(120), 1_000_000 ether
        );
        assertEq(pair.balanceOf(address(manager)), 0);
        router.swap(key, params(true, true, 100 ether, false));
        assertGt(hook.totalBurned(), 0);
        assertSettled();
    }

    function test_tokenBurnDefersUntilSellerSettles() public {
        router.modify(
            key, pairFirst() ? int24(60) : int24(-120), pairFirst() ? int24(120) : int24(-60), 1_000_000 ether
        );
        assertEq(token.balanceOf(address(manager)), 0);
        router.swap(key, params(false, true, 100 ether, false));
        assertGt(hook.pendingIMDB(), 0);
        assertEq(hook.totalBurned(), 0);
        assertSettled();
        vm.prank(makeAddr("keeper"));
        hook.processFees();
        assertEq(hook.pendingIMDB(), 0);
        assertGt(hook.totalBurned(), 0);
        assertSettled();
    }

    function test_boundedBuybackRetainsAndRetriesClaims() public {
        seed();
        router.swap(key, params(true, true, 20_000_000 ether, false));
        uint256 pending = hook.pendingIMD();
        assertGt(pending, 0);
        assertSettled();
        vm.prank(makeAddr("keeper"));
        hook.processFees();
        assertLt(hook.pendingIMD(), pending);
        assertSettled();
    }

    function test_noLiquidityChargesNoFee() public {
        router.swap(key, params(true, true, 1 ether, false));
        assertEq(hook.totalFeesIMD(), 0);
        assertEq(hook.totalBurned(), 0);
        assertSettled();
    }

    function test_factoryCanCollectAndRemoveLiquidity() public {
        seed();
        router.swap(key, params(true, true, 100 ether, false));
        BalanceDelta fees = router.modify(key, -887220, 887220, 0);
        assertTrue(fees.amount0() >= 0 && fees.amount1() >= 0);
        uint256 charged = hook.totalFeesIMD();
        router.modify(key, -887220, 887220, -int256(1_000_000 ether));
        assertEq(charged, hook.totalFeesIMD());
        assertSettled();
    }

    function test_failedSettlementRollsBackFeeAndBurn() public {
        seed();
        TestRouter empty = new TestRouter(manager);
        vm.expectRevert();
        empty.swap(key, params(true, true, 100 ether, false));
        assertEq(hook.totalFeesIMD(), 0);
        assertEq(hook.totalBurned(), 0);
        assertEq(token.totalSupply(), token.INITIAL_SUPPLY());
        assertSettled();
    }

    function test_invalidLimitAndExcessiveAmountRevert() public {
        seed();
        SwapParams memory p = params(true, true, 1 ether, false);
        p.sqrtPriceLimitX96 = Q96;
        vm.expectRevert();
        router.swap(key, p);
        p = params(true, true, 1 ether, false);
        p.amountSpecified = type(int256).min;
        vm.expectRevert();
        router.swap(key, p);
        assertEq(hook.totalFeesIMD(), 0);
        assertSettled();
    }

    function test_reentrantProcessingAndSwapCallbacksAreBlocked() public {
        vm.etch(address(manager), type(ReentryProbeManager).runtimeCode);
        hook.processFees();
        hook.processFees(); // Guard cleanup also permits the next legitimate processing call.
        assertEq(hook.totalFeesIMD(), 0);
        assertEq(hook.totalBurned(), 0);
    }

    function test_invalidConstructorParametersAndWrongAddressFlags() public {
        vm.expectRevert(IMDBHook.InvalidConfiguration.selector);
        new IMDBHook(IPoolManager(address(0)), token);
        vm.expectRevert(IMDBHook.InvalidConfiguration.selector);
        new IMDBHook(manager, IMDBToken(address(0)));
        vm.expectRevert(IMDBHook.InvalidConfiguration.selector);
        new IMDBHook(manager, IMDBToken(IMD));
        bytes memory code = abi.encodePacked(type(IMDBHook).creationCode, abi.encode(manager, token));
        for (uint256 i;; i++) {
            bytes32 salt = bytes32(i);
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code)))))
            );
            if (HookFlags.matches(predicted, hook.FLAGS())) continue;
            vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
            new IMDBHook{salt: salt}(manager, token);
            break;
        }
    }

    function test_runtimeContainsNoUpgradeOrDestructionOpcodes() public view {
        bytes memory code = address(hook).code;
        for (uint256 i; i < code.length; i++) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xff && op != 0xf4 && op != 0xf2);
        }
    }

    function test_noAdministrativeEscapeHatches() public {
        (bool owner,) = address(hook).call(abi.encodeWithSignature("owner()"));
        assertFalse(owner);
        (bool setter,) = address(hook).call(abi.encodeWithSignature("setFee(uint256)", 0));
        assertFalse(setter);
        (bool withdrawal,) = address(hook).call(abi.encodeWithSignature("withdraw(address)", address(this)));
        assertFalse(withdrawal);
        assertLe(address(hook).code.length, 24576);
    }
}

contract PairFirstHookTest is HookBehavior {
    function pairFirst() internal pure override returns (bool) {
        return true;
    }
}

contract TokenFirstHookTest is HookBehavior {
    function pairFirst() internal pure override returns (bool) {
        return false;
    }
}
