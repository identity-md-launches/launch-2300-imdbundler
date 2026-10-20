// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed initial supply. No administrator, transfer tax, or post-construction minting.
contract IMDBToken is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("IMDBundler", "IMDB") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @notice Destroy only the caller's tokens; used by the immutable buyback hook.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
