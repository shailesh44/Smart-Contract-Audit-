// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title MaliciousReentrantBuyer
 * @notice Attempts reentrancy attack on buyTokensWithNative via ETH refund
 * @dev The presale sends back excess ETH via sendValue — this contract
 *      tries to re-enter buyTokensWithNative in its receive() callback
 *      ReentrancyGuard should block this completely
 */
interface IPresale {
    function buyTokensWithNative(uint256 _amountTokensToBuy) external payable;
    function buyTokensWithNativeAtBasePrice(uint256 _amountTokensToBuy) external payable;
}

contract MaliciousReentrantBuyer {
    IPresale public presale;
    uint256 public attackCount;
    bool public attacking;
    uint256 public amountToBuy;

    constructor(address _presale) {
        presale = IPresale(_presale);
    }

    /// @notice Initiates the attack with excess ETH to trigger refund callback
    function attack(uint256 _amountToBuy) external payable {
        attacking = true;
        attackCount = 0;
        amountToBuy = _amountToBuy;
        // Send extra ETH to trigger refund and re-enter
        presale.buyTokensWithNative{value: msg.value}(_amountToBuy);
    }

    /// @notice This is called when presale refunds excess ETH
    ///         Attempts reentrancy — should be blocked by ReentrancyGuard
    receive() external payable {
        if (attacking && attackCount < 3) {
            attackCount++;
            // Try to reenter — ReentrancyGuard should revert this
            try presale.buyTokensWithNative{value: msg.value}(amountToBuy) {
                // If we get here, reentrancy succeeded (BAD)
            } catch {
                // Expected: reentrancy blocked (GOOD)
            }
        }
    }
}