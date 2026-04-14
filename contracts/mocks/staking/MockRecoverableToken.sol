// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockRecoverableToken
 * @notice A separate ERC20 used to test recoverERC20()
 * @dev Simulates tokens accidentally sent to the staking contract
 */
contract MockRecoverableToken is ERC20 {
    constructor() ERC20("Recoverable Token", "REC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}