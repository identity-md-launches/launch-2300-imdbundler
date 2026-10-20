// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IMDBHook} from "../../src/IMDBHook.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDeltaLibrary} from "v4-core/src/types/BalanceDelta.sol";

/// @dev Test-only adversary replacing the manager runtime in one isolated test.
contract ReentryProbeManager {
    function unlock(bytes calldata) external returns (bytes memory) {
        IMDBHook hook = IMDBHook(msg.sender);
        PoolKey memory key = hook.poolKey();
        SwapParams memory params = SwapParams(true, -1 ether, 79228162514264337593543950336);
        _assertBusy(msg.sender, abi.encodeCall(IMDBHook.processFees, ()));
        _assertBusy(msg.sender, abi.encodeCall(IHooks.beforeSwap, (address(this), key, params, "")));
        _assertBusy(
            msg.sender,
            abi.encodeCall(IHooks.afterSwap, (address(this), key, params, BalanceDeltaLibrary.ZERO_DELTA, ""))
        );
        return hook.unlockCallback("");
    }

    function balanceOf(address, uint256) external pure returns (uint256) {
        return 0;
    }

    function _assertBusy(address hook, bytes memory data) private {
        (bool success, bytes memory reason) = hook.call(data);
        require(!success && bytes4(reason) == IMDBHook.Busy.selector, "reentry not blocked");
    }
}
