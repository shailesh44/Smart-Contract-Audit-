// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockMinterBroken
 * @notice Token whose mint() always reverts — tests graceful reward skip
 */
contract MockMinterBroken is ERC20 {
    constructor() ERC20("Broken", "BRK") {}

    function mint(address, uint256) external pure {
        revert("Mint: always fails");
    }

    function totalSupply() public view override returns (uint256) {
        return super.totalSupply();
    }

    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}