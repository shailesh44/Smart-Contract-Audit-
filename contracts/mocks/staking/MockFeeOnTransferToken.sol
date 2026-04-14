// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockFeeOnTransferToken
 * @notice ERC20 that deducts a 1% fee on every transfer
 * @dev Used to test TransferAmountMismatch in depositRewardPool()
 */
contract MockFeeOnTransferToken is ERC20 {
    uint256 public constant FEE_BPS = 100; // 1%

    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            // Deduct 1% fee — burns it
            uint256 fee = (value * FEE_BPS) / 10_000;
            super._update(from, address(0), fee); // burn fee
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}