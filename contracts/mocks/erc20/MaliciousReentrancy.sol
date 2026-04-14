// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IVittagems {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title MaliciousReentrancy
 * @notice Attempts reentrancy attack on mint and burn flows
 * @dev Used to verify ERC20 transfer hooks cannot be re-entered
 */
contract MaliciousReentrancy {
    IVittagems public target;
    uint256 public attackCount;
    bool public attacking;

    constructor(address _target) {
        target = IVittagems(_target);
    }

    // Attempt reentrancy during a transfer hook (ERC20 doesn't have receive hooks
    // but we test the pattern for completeness)
    function attack(uint256 amount) external {
        attacking = true;
        attackCount = 0;
        target.mint(address(this), amount);
    }

    // Simulated callback - ERC20 doesn't call back on transfer,
    // but we keep this to verify no unexpected callbacks exist
    receive() external payable {
        if (attacking && attackCount < 3) {
            attackCount++;
            target.mint(address(this), 1e18);
        }
    }
}