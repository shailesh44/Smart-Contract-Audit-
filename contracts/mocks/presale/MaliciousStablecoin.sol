// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MaliciousStablecoin
 * @notice Fake stablecoin that reports wrong decimals or re-enters on transferFrom
 * @dev Tests TokenNotSupported error and edge cases with non-standard tokens
 */
contract MaliciousStablecoin is ERC20 {
    uint8 private _decimals;
    address private _presale;
    bool public reenterOnTransfer;
    uint256 public reentryCount;

    constructor(uint8 decimals_) ERC20("Malicious", "MAL") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setPresale(address presale_) external {
        _presale = presale_;
    }

    function setReenterOnTransfer(bool _reenter) external {
        reenterOnTransfer = _reenter;
    }
}