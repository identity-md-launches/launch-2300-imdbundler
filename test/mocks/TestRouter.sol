// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

/// @dev Test-only prefunded trader and liquidity provider. Never deployed as a launch contract.
contract TestRouter is IUnlockCallback {
    using TransientStateLibrary for IPoolManager;

    IPoolManager public immutable manager;
    address private immutable controller;

    constructor(IPoolManager manager_) {
        manager = manager_;
        controller = msg.sender;
    }
    modifier onlyController() {
        require(msg.sender == controller, "controller");
        _;
    }

    function swap(PoolKey memory key, SwapParams memory params) external onlyController returns (BalanceDelta) {
        return abi.decode(manager.unlock(abi.encode(true, key, abi.encode(params))), (BalanceDelta));
    }

    /// @dev Pays `amount` of `payIn` with sync -> transfer before swapping. With `settleFirst` it settles before
    /// the swap, like a router's SETTLE then SWAP; otherwise it settles after, so the swap runs mid-sync.
    function swapPrepaid(PoolKey memory key, SwapParams memory params, Currency payIn, uint256 amount, bool settleFirst)
        external
        onlyController
        returns (BalanceDelta)
    {
        return abi.decode(
            manager.unlock(abi.encode(true, key, abi.encode(params, payIn, amount, settleFirst))), (BalanceDelta)
        );
    }

    function modify(PoolKey memory key, int24 lower, int24 upper, int256 liquidity)
        external
        onlyController
        returns (BalanceDelta)
    {
        return abi.decode(
            manager.unlock(
                abi.encode(false, key, abi.encode(ModifyLiquidityParams(lower, upper, liquidity, bytes32(0))))
            ),
            (BalanceDelta)
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager");
        (bool isSwap, PoolKey memory key, bytes memory params) = abi.decode(data, (bool, PoolKey, bytes));
        BalanceDelta delta;
        if (isSwap && params.length > 32 * 3) {
            (SwapParams memory p, Currency payIn, uint256 amount, bool settleFirst) =
                abi.decode(params, (SwapParams, Currency, uint256, bool));
            manager.sync(payIn);
            payIn.transfer(address(manager), amount);
            if (settleFirst) manager.settle();
            delta = manager.swap(key, p, "");
            if (!settleFirst) manager.settle();
            _net(key.currency0);
            _net(key.currency1);
            return abi.encode(delta);
        }
        if (isSwap) delta = manager.swap(key, abi.decode(params, (SwapParams)), "");
        else (delta,) = manager.modifyLiquidity(key, abi.decode(params, (ModifyLiquidityParams)), "");
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _net(Currency currency) private {
        int256 delta = manager.currencyDelta(address(this), currency);
        if (delta > type(int128).max || delta < type(int128).min) revert("delta");
        _settle(currency, int128(delta));
    }

    function _settle(Currency currency, int128 delta) private {
        if (delta < 0) {
            uint256 amount = uint256(-int256(delta));
            manager.sync(currency);
            currency.transfer(address(manager), amount);
            manager.settle();
        } else if (delta > 0) {
            manager.take(currency, address(this), uint256(uint128(delta)));
        }
    }
}
