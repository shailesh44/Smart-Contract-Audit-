// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title MockReserveOracleBroken
 * @notice Simulates a broken oracle that always reverts - tests robustness
 */
contract MockReserveOracleBroken {
    function getCurrentReserve() external pure returns (uint256) {
        revert("Oracle: broken");
    }

    function lastUpdatedAt() external pure returns (uint256) {
        revert("Oracle: broken");
    }
}