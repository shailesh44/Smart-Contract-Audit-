// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockStakingToken
 * @notice Standard ERC20 used as the staking token in tests
 * @dev Mintable by anyone for test setup simplicity
 */
contract MockStakingToken is ERC20 {
    constructor() ERC20("Mock Staking Token", "MST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}