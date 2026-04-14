// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20Stablecoin
 * @notice Mock USDT/USDC with configurable decimals
 * @dev Supports 6-decimal stablecoins typical of USDT/USDC
 *      Also supports 18-decimal for edge case testing
 */
contract MockERC20Stablecoin is ERC20 {
    uint8 private _decimals;
    bool public transferFromShouldRevert;
    bool public transferFromReturnsFalse;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTransferFromShouldRevert(bool shouldRevert) external {
        transferFromShouldRevert = shouldRevert;
    }

    // Override transferFrom to simulate failure
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        if (transferFromShouldRevert) revert("Stablecoin: transferFrom failed");
        return super.transferFrom(from, to, amount);
    }
}