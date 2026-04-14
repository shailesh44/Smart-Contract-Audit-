// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MaliciousReentrantStaker
 * @notice Attempts reentrancy on claimReward and unstake
 * @dev ReentrancyGuard should block all re-entry attempts
 */
interface ITokenStaking {
    enum Tier { BRONZE, SILVER, GOLD, PLATINUM }
    function stake(uint256 amount, ITokenStaking.Tier tier) external returns (uint256);
    function claimReward(uint256 stakeId) external returns (uint256);
    function unstake(uint256 stakeId) external;
}

contract MaliciousReentrantStaker {
    ITokenStaking public staking;
    IERC20 public token;
    uint256 public lastStakeId;
    uint256 public reentryCount;
    bool public attacking;
    bool public attackClaim; // true = attack claimReward, false = attack unstake

    constructor(address _staking, address _token) {
        staking = ITokenStaking(_staking);
        token = IERC20(_token);
    }

    function setupStake(uint256 amount) external {
        token.approve(address(staking), amount);
        lastStakeId = staking.stake(amount, ITokenStaking.Tier.BRONZE);
    }

    function attackClaimReward() external {
        attacking = true;
        attackClaim = true;
        reentryCount = 0;
        staking.claimReward(lastStakeId);
    }

    function attackUnstake() external {
        attacking = true;
        attackClaim = false;
        reentryCount = 0;
        staking.unstake(lastStakeId);
    }

    // Called when tokens are transferred to this contract
    // ERC20 safeTransfer does NOT trigger onERC20Received but we
    // simulate the attack pattern via a hook in the token transfer
    // This verifies ReentrancyGuard blocks any re-entry path
    function onTokenReceived() external {
        if (attacking && reentryCount < 3) {
            reentryCount++;
            if (attackClaim) {
                try staking.claimReward(lastStakeId) {} catch {}
            } else {
                try staking.unstake(lastStakeId) {} catch {}
            }
        }
    }
}