// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title MockAggregatorV3
 * @notice Mock Chainlink AggregatorV3Interface for price feed testing
 * @dev Allows full control over price, timestamp, and revert behavior
 */
contract MockAggregatorV3 {
    int256 private _price;
    uint256 private _updatedAt;
    uint8 private _decimals;
    bool public shouldRevert;
    bool public returnZeroPrice;
    bool public returnNegativePrice;
    uint80 private _roundId;

    constructor(int256 initialPrice, uint8 decimals_) {
        _price = initialPrice;
        _decimals = decimals_;
        _updatedAt = block.timestamp;
        _roundId = 1;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external pure returns (string memory) {
        return "Mock ETH/USD";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        if (shouldRevert) revert("Oracle: reverted");
        if (returnNegativePrice) return (_roundId, -1, block.timestamp, _updatedAt, _roundId);
        if (returnZeroPrice) return (_roundId, 0, block.timestamp, _updatedAt, _roundId);
        return (_roundId, _price, block.timestamp, _updatedAt, _roundId);
    }

    function getRoundData(uint80 _rid)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_rid, _price, block.timestamp, _updatedAt, _rid);
    }

    // --- Test helpers ---

    function setPrice(int256 newPrice) external {
        _price = newPrice;
        _updatedAt = block.timestamp;
        _roundId++;
    }

    function setUpdatedAt(uint256 timestamp) external {
        _updatedAt = timestamp;
    }

    function makeStale(uint256 hoursOld) external {
        _updatedAt = block.timestamp - (hoursOld * 1 hours);
    }

    function makeFresh() external {
        _updatedAt = block.timestamp;
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function setReturnZeroPrice(bool _zero) external {
        returnZeroPrice = _zero;
    }

    function setReturnNegativePrice(bool _neg) external {
        returnNegativePrice = _neg;
    }
}