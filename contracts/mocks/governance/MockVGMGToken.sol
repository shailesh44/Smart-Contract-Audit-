// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockVGMGToken
 * @notice Mock Vittagems token for governance testing
 * @dev Supports configurable mint behavior and transfer failures
 */
contract MockVGMGToken is ERC20 {
    bool public mintShouldRevert;
    bool public transferShouldFail;
    string public mintRevertReason;
    uint256 private _maxSupply;

    constructor(uint256 maxSupply_) ERC20("Vittagems", "VGMG") {
        _maxSupply = maxSupply_;
    }

    // Implements IVittagemsMinter
    function mint(address to, uint256 amount) external {
        if (mintShouldRevert) revert(mintRevertReason);
        _mint(to, amount);
    }

    function MAX_SUPPLY() external view returns (uint256) {
        return _maxSupply;
    }

    function totalSupply() public view override returns (uint256) {
        return super.totalSupply();
    }

    // Override transfer to simulate failure
    function transfer(address to, uint256 amount)
        public override returns (bool)
    {
        if (transferShouldFail) return false;
        return super.transfer(to, amount);
    }

    // Test helpers
    function setMintShouldRevert(bool _revert, string calldata reason) external {
        mintShouldRevert = _revert;
        mintRevertReason = reason;
    }

    function setTransferShouldFail(bool _fail) external {
        transferShouldFail = _fail;
    }

    function setMaxSupply(uint256 max) external {
        _maxSupply = max;
    }

    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}