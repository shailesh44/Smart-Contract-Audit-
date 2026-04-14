// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title MockReserveOracle
 * @notice Simulates IReserveOracle for testing purposes
 * @dev Allows manipulation of reserve value and lastUpdatedAt for edge case testing
 */
contract MockReserveOracle {
    uint256 private _reserve;
    uint256 private _lastUpdatedAt;

    constructor(uint256 initialReserve) {
        _reserve = initialReserve;
        _lastUpdatedAt = block.timestamp;
    }

    function getCurrentReserve() external view returns (uint256) {
        return _reserve;
    }

    function lastUpdatedAt() external view returns (uint256) {
        return _lastUpdatedAt;
    }

    function setReserve(uint256 newReserve) external {
        _reserve = newReserve;
    }

    function setLastUpdatedAt(uint256 timestamp) external {
        _lastUpdatedAt = timestamp;
    }

    // Simulate stale data by setting lastUpdatedAt to 0
    function makeStale() external {
        _lastUpdatedAt = 0;
    }

    // Simulate fresh data at current block
    function makeFresh() external {
        _lastUpdatedAt = block.timestamp;
    }
}