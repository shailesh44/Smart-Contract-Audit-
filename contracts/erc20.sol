// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

// Interface to read reserve data from the governance oracle contract
interface IReserveOracle {
    function getCurrentReserve() external view returns (uint256);
    function lastUpdatedAt() external view returns (uint256);
}

contract Vittagems is ERC20, ERC20Pausable, ERC20Burnable, AccessControl, ERC20Permit {

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // Hard cap: 10 billion tokens with 18 decimals
    uint256 public constant MAX_SUPPLY = 10_000_000_000 * (10 ** 18);

    // Oracle reference set post-deployment via setReserveOracle(), then permanently locked
    IReserveOracle public reserveOracle;
    bool public reserveOracleLocked;

    // Maximum allowed age (in seconds) of reserve data before minting is blocked; 0 disables the check
    uint256 public reserveStalenessThreshold;

    event ReserveOracleSet(address indexed oracleAddress);
    event ReserveOracleLocked(address indexed oracleAddress);
    event StalenessThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event MintWithReserveCheck(
        address indexed to,
        uint256 amount,
        uint256 newTotalSupply,
        uint256 reserveValue
    );

    error InvalidAddress(string param);
    error MaxSupplyExceeded(uint256 requested, uint256 available);
    error ReserveInsufficient(uint256 requestedTotal, uint256 reserveValue);
    error ReserveDataStale(uint256 lastUpdated, uint256 threshold);
    error ReserveOracleNotSet();
    error OracleAlreadyLocked();

    /// @param defaultAdmin Address receiving DEFAULT_ADMIN_ROLE
    /// @param pauser Address receiving PAUSER_ROLE
    /// @param minter Address receiving MINTER_ROLE
    /// @param _stalenessThreshold Seconds before reserve data is considered stale; 0 to disable
    constructor(
        address defaultAdmin,
        address pauser,
        address minter,
        uint256 _stalenessThreshold
    )
        ERC20("Vittagems", "VGMG")
        ERC20Permit("Vittagems")
    {
        if (defaultAdmin == address(0)) revert InvalidAddress("defaultAdmin");
        if (pauser == address(0)) revert InvalidAddress("pauser");
        if (minter == address(0)) revert InvalidAddress("minter");

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(MINTER_ROLE, minter);

        reserveStalenessThreshold = _stalenessThreshold;
    }

    /// @notice Assigns the reserve oracle address; callable multiple times until locked
    /// @dev Deployment flow: deploy Vittagems â deploy DOVGovernance â call this â call lockReserveOracle()
    /// @param _oracle Address of the deployed DOVGovernance contract
    function setReserveOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (reserveOracleLocked) revert OracleAlreadyLocked();
        if (_oracle == address(0)) revert InvalidAddress("oracle");

        reserveOracle = IReserveOracle(_oracle);
        emit ReserveOracleSet(_oracle);
    }

    /// @notice Permanently locks the oracle address so it can never be changed again
    function lockReserveOracle() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(reserveOracle) == address(0)) revert ReserveOracleNotSet();
        if (reserveOracleLocked) revert OracleAlreadyLocked();

        reserveOracleLocked = true;
        emit ReserveOracleLocked(address(reserveOracle));
    }

    /// @notice Returns the current reserve value from the oracle, or 0 if oracle is not set
    function getReserveValue() public view returns (uint256) {
        if (address(reserveOracle) == address(0)) return 0;
        return reserveOracle.getCurrentReserve();
    }

    /// @notice Returns the timestamp of the last reserve update from the oracle
    function getReserveLastUpdated() public view returns (uint256) {
        if (address(reserveOracle) == address(0)) return 0;
        return reserveOracle.lastUpdatedAt();
    }

    /// @notice Checks whether the reserve data is within the staleness threshold
    /// @return true if data is fresh or staleness check is disabled, false otherwise
    function isReserveFresh() public view returns (bool) {
        // Staleness check disabled when threshold is 0
        if (reserveStalenessThreshold == 0) return true;
        if (address(reserveOracle) == address(0)) return false;

        uint256 lastUpdated = reserveOracle.lastUpdatedAt();
        if (lastUpdated == 0) return false;

        return (block.timestamp - lastUpdated) <= reserveStalenessThreshold;
    }

    /// @notice Calculates how many tokens can still be minted given reserve and max supply limits
    /// @return The lower of reserve-based capacity and max-supply-based capacity, or 0 if data is stale
    function mintableAmount() external view returns (uint256) {
        if (!isReserveFresh()) return 0;

        uint256 reserve = getReserveValue();
        uint256 supply = totalSupply();

        // Tokens allowed by reserve backing
        uint256 reserveCap = reserve > supply ? reserve - supply : 0;
        // Tokens allowed before hitting hard cap
        uint256 maxCap = MAX_SUPPLY > supply ? MAX_SUPPLY - supply : 0;

        return reserveCap < maxCap ? reserveCap : maxCap;
    }

    /// @notice Mints tokens after verifying hard cap, staleness, and reserve backing
    /// @param to Recipient address
    /// @param amount Number of tokens to mint (18 decimals)
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        if (address(reserveOracle) == address(0)) revert ReserveOracleNotSet();

        uint256 newTotal = totalSupply() + amount;

        // Enforce absolute hard cap
        if (newTotal > MAX_SUPPLY) revert MaxSupplyExceeded(newTotal, MAX_SUPPLY);

        // Enforce staleness check when threshold is configured
        if (reserveStalenessThreshold > 0) {
            uint256 lastUpdated = reserveOracle.lastUpdatedAt();
            if (lastUpdated == 0 || (block.timestamp - lastUpdated) > reserveStalenessThreshold)
                revert ReserveDataStale(lastUpdated, reserveStalenessThreshold);
        }

        // Enforce 1:1 reserve backing â total supply must never exceed reserve value
        uint256 reserveValue = reserveOracle.getCurrentReserve();
        if (newTotal > reserveValue) revert ReserveInsufficient(newTotal, reserveValue);

        _mint(to, amount);
        emit MintWithReserveCheck(to, amount, newTotal, reserveValue);
    }

    /// @notice Pauses all token transfers, minting, and burning
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resumes all token operations after a pause
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Updates how long reserve data can age before minting is blocked
    /// @param _newThreshold New staleness threshold in seconds; 0 disables the check
    function setStalenessThreshold(uint256 _newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 old = reserveStalenessThreshold;
        reserveStalenessThreshold = _newThreshold;
        emit StalenessThresholdUpdated(old, _newThreshold);
    }

    /// @dev Required override to integrate ERC20Pausable with base ERC20 transfer hook
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}