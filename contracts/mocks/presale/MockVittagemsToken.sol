// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title MockVittagemsToken
 * @notice Mock for IVittagemsStablecoin interface used in presale
 * @dev Tracks mint calls, allows configuring totalSupply and MAX_SUPPLY
 *      Also simulates mint reverts for negative test cases
 */
contract MockVittagemsToken {
    uint256 private _totalSupply;
    uint256 private _maxSupply;
    bool public mintShouldRevert;
    bool public mintShouldRevertWithMaxSupply;
    string public mintRevertReason;

    // Track who received minted tokens and amounts
    mapping(address => uint256) public mintedTo;
    uint256 public mintCallCount;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(uint256 maxSupply_) {
        _maxSupply = maxSupply_;
    }

    function mint(address to, uint256 amount) external {
        if (mintShouldRevert) {
            revert(mintRevertReason);
        }
        if (mintShouldRevertWithMaxSupply) {
            revert("ExceedsMaxSupply");
        }
        _totalSupply += amount;
        mintedTo[to] += amount;
        mintCallCount++;
        emit Transfer(address(0), to, amount);
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function MAX_SUPPLY() external view returns (uint256) {
        return _maxSupply;
    }

    // --- Test helpers ---

    function setTotalSupply(uint256 supply) external {
        _totalSupply = supply;
    }

    function setMaxSupply(uint256 maxSupply_) external {
        _maxSupply = maxSupply_;
    }

    function setMintShouldRevert(bool shouldRevert, string calldata reason) external {
        mintShouldRevert = shouldRevert;
        mintRevertReason = reason;
    }

    function setMintShouldRevertWithMaxSupply(bool shouldRevert) external {
        mintShouldRevertWithMaxSupply = shouldRevert;
    }

    function resetMintCount() external {
        mintCallCount = 0;
    }
}