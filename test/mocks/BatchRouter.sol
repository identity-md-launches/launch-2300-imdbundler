// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

/// @dev Test-only router that runs several manager operations inside ONE unlock, then nets its
/// deltas. Lets tests reproduce multi-hop / batched flows that a single-swap router cannot.
contract BatchRouter is IUnlockCallback {
    using TransientStateLibrary for IPoolManager;

    enum Kind {
        Swap,
        Modify,
        MintClaim,
        SyncAndPay,
        Settle,
        Call
    }

    struct Op {
        Kind kind;
        bytes data;
    }

    IPoolManager public immutable manager;
    address private immutable controller;
    BalanceDelta[] private lastDeltas;

    constructor(IPoolManager manager_) {
        manager = manager_;
        controller = msg.sender;
    }

    function run(PoolKey memory key, Op[] memory ops) external returns (BalanceDelta[] memory deltas) {
        require(msg.sender == controller, "controller");
        return abi.decode(manager.unlock(abi.encode(key, ops)), (BalanceDelta[]));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager");
        (PoolKey memory key, Op[] memory ops) = abi.decode(data, (PoolKey, Op[]));
        BalanceDelta[] memory deltas = new BalanceDelta[](ops.length);
        for (uint256 i; i < ops.length; ++i) {
            Op memory op = ops[i];
            if (op.kind == Kind.Swap) {
                deltas[i] = manager.swap(key, abi.decode(op.data, (SwapParams)), "");
            } else if (op.kind == Kind.Modify) {
                (deltas[i],) = manager.modifyLiquidity(key, abi.decode(op.data, (ModifyLiquidityParams)), "");
            } else if (op.kind == Kind.MintClaim) {
                (address to, Currency currency, uint256 amount) = abi.decode(op.data, (address, Currency, uint256));
                manager.mint(to, currency.toId(), amount);
            } else if (op.kind == Kind.SyncAndPay) {
                (Currency currency, uint256 amount) = abi.decode(op.data, (Currency, uint256));
                manager.sync(currency);
                currency.transfer(address(manager), amount);
            } else if (op.kind == Kind.Settle) {
                manager.settle();
            } else {
                (address target, bytes memory callData) = abi.decode(op.data, (address, bytes));
                (bool ok, bytes memory ret) = target.call(callData);
                if (!ok) {
                    assembly ("memory-safe") { revert(add(ret, 32), mload(ret)) }
                }
            }
        }
        _net(key.currency0);
        _net(key.currency1);
        return abi.encode(deltas);
    }

    function _net(Currency currency) private {
        int256 delta = manager.currencyDelta(address(this), currency);
        if (delta < 0) {
            manager.sync(currency);
            currency.transfer(address(manager), uint256(-delta));
            manager.settle();
        } else if (delta > 0) {
            manager.take(currency, address(this), uint256(delta));
        }
    }
}
