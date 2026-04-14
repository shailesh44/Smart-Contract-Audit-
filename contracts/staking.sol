// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ERC20 Tier-Based Staking Contract
 * @author Your Name
 * @notice Stake tokens with tier-based lock periods and rewards
 * @custom:version 9.0.0
 */
contract TokenStaking is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                            ENUMS
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    enum Tier {
        BRONZE,     // 0 - 6 months, 5%
        SILVER,     // 1 - 12 months, 10%
        GOLD,       // 2 - 18 months, 15%
        PLATINUM    // 3 - 24 months, 23%
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                           STRUCTS
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    struct TierPlan {
        uint256 duration;
        uint256 rewardRate;
        uint256 minStakeAmount;
        bool isActive;
    }

    struct Stake {
        uint256 id;
        address staker;
        uint256 amount;
        uint256 startTime;
        uint256 lockDuration;
        uint256 rewardRate;
        uint256 rewardPerCycle;
        uint256 lastClaimTime;
        uint256 totalClaimed;
        Tier tier;
        bool unstaked;
    }

    struct UserAggregates {
        uint256 totalStaked;
        uint256 activeStakeCount;
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                       STATE VARIABLES
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    IERC20 public immutable stakingToken;

    uint256 private _stakeIdCounter;
    uint256 public totalStaked;
    uint256 public rewardPool;
    uint256 public minimumReserve;

    mapping(uint256 stakeId => Stake) public stakes;
    mapping(address user => uint256[]) private _userStakeIds;
    mapping(Tier => TierPlan) public tierPlans;
    mapping(address user => UserAggregates) private _userAggregates;

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                          CONSTANTS
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    uint256 public constant NUM_TIERS = 4;
    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_REWARD_RATE = 10_000;
    uint256 public constant MAX_STAKES_PER_USER = 100;

    uint256 public constant BRONZE_DURATION = 180 days;
    uint256 public constant SILVER_DURATION = 365 days;
    uint256 public constant GOLD_DURATION = 540 days;
    uint256 public constant PLATINUM_DURATION = 730 days;

    uint256 public constant BRONZE_MIN_STAKE = 1_000e18;
    uint256 public constant SILVER_MIN_STAKE = 5_000e18;
    uint256 public constant GOLD_MIN_STAKE = 15_000e18;
    uint256 public constant PLATINUM_MIN_STAKE = 50_000e18;

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                           EVENTS
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    event Staked(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 amount,
        Tier tier,
        uint256 lockDuration,
        uint256 rewardRate
    );

    event RewardClaimed(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 rewardAmount,
        uint256 cyclesClaimed
    );

    event Unstaked(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 principalAmount,
        uint256 finalReward,
        uint256 totalReceived
    );

    event EmergencyWithdraw(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 amount
    );

    event TierPlanUpdated(
        Tier indexed tier,
        uint256 oldRewardRate,
        uint256 newRewardRate,
        uint256 oldMinStake,
        uint256 newMinStake,
        bool isActive
    );

    event TierDurationUpdated(
        Tier indexed tier,
        uint256 oldDuration,
        uint256 newDuration
    );

    event RewardPoolDeposited(address indexed depositor, uint256 amount);
    event RewardPoolWithdrawn(address indexed owner, uint256 amount);
    event MinimumReserveUpdated(uint256 oldReserve, uint256 newReserve);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event TokensRecovered(address indexed token, address indexed to, uint256 amount);

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                           ERRORS
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    error InvalidAmount();
    error InvalidDuration();
    error BelowMinimumStake();
    error TierNotActive();
    error StakeNotFound();
    error NotStakeOwner();
    error AlreadyUnstaked();
    error LockPeriodNotEnded();
    error NoRewardsToClaim();
    error InsufficientRewardPool();
    error ZeroAddress();
    error TransferAmountMismatch();
    error InvalidRewardRate();
    error CannotRecoverStakingToken();
    error RewardCalculationZero();
    error BelowMinimumReserve();
    error ETHNotAccepted();
    error ArrayLengthMismatch();
    error MaxStakesReached();
    error NotPaused();

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                         CONSTRUCTOR
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    constructor(
        address _stakingToken,
        address _initialOwner
    ) Ownable(_initialOwner) {
        if (_stakingToken == address(0)) revert ZeroAddress();
        if (_initialOwner == address(0)) revert ZeroAddress();

        stakingToken = IERC20(_stakingToken);
        _initializeTierPlans();
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                      RECEIVE / FALLBACK
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    receive() external payable {
        revert ETHNotAccepted();
    }

    fallback() external payable {
        revert ETHNotAccepted();
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                      STAKING FUNCTIONS
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    /**
     * @notice Stake tokens with chosen tier
     * @param _amount Amount of tokens to stake
     * @param _tier Tier to stake in (0: Bronze, 1: Silver, 2: Gold, 3: Platinum)
     * @return stakeId Unique identifier for this stake
     */
    function stake(
    uint256 _amount,
    Tier _tier
) external nonReentrant whenNotPaused returns (uint256 stakeId) {
    if (_userStakeIds[msg.sender].length >= MAX_STAKES_PER_USER) revert MaxStakesReached();

    TierPlan memory plan = tierPlans[_tier];
    if (!plan.isActive) revert TierNotActive();
    if (_amount < plan.minStakeAmount) revert BelowMinimumStake();

    uint256 rewardPerCycle = (_amount * plan.rewardRate) / BASIS_POINTS;
    if (rewardPerCycle == 0) revert RewardCalculationZero();

    // Transfer tokens first to fail early if transfer fails
    stakingToken.safeTransferFrom(msg.sender, address(this), _amount);

    // Create stake and update state in a single transaction
    stakeId = ++_stakeIdCounter;

    // Pack multiple state updates together
    _userAggregates[msg.sender].totalStaked += _amount;
    _userAggregates[msg.sender].activeStakeCount += 1;
    totalStaked += _amount;

    // Add stake to user's stake IDs
    _userStakeIds[msg.sender].push(stakeId);

    // Create stake with all data
    stakes[stakeId] = Stake({
        id: stakeId,
        staker: msg.sender,
        amount: _amount,
        startTime: block.timestamp,
        lockDuration: plan.duration,
        rewardRate: plan.rewardRate,
        rewardPerCycle: rewardPerCycle,
        lastClaimTime: block.timestamp,
        totalClaimed: 0,
        tier: _tier,
        unstaked: false
    });

    emit Staked(
        stakeId,
        msg.sender,
        _amount,
        _tier,
        plan.duration,
        plan.rewardRate
    );
}

    /**
     * @notice Claim available rewards without unstaking
     * @param _stakeId Stake ID to claim rewards for
     * @return rewardAmount Amount of rewards claimed
     */
    function claimReward(uint256 _stakeId) external nonReentrant whenNotPaused returns (uint256 rewardAmount) {
        Stake storage userStake = stakes[_stakeId];

        if (userStake.staker == address(0)) revert StakeNotFound();
        if (userStake.staker != msg.sender) revert NotStakeOwner();
        if (userStake.unstaked) revert AlreadyUnstaked();

        (uint256 claimableCycles, uint256 claimableReward) = _calculateClaimableReward(userStake);

        if (claimableCycles == 0) revert NoRewardsToClaim();
        if (rewardPool < claimableReward) revert InsufficientRewardPool();

        rewardPool -= claimableReward;
        userStake.lastClaimTime += claimableCycles * userStake.lockDuration;
        userStake.totalClaimed += claimableReward;

        stakingToken.safeTransfer(msg.sender, claimableReward);

        emit RewardClaimed(_stakeId, msg.sender, claimableReward, claimableCycles);

        return claimableReward;
    }

    /**
     * @notice Unstake tokens and claim any remaining rewards
     * @param _stakeId Stake ID to unstake
     */
    function unstake(uint256 _stakeId) external nonReentrant whenNotPaused {
        Stake storage userStake = stakes[_stakeId];

        if (userStake.staker == address(0)) revert StakeNotFound();
        if (userStake.staker != msg.sender) revert NotStakeOwner();
        if (userStake.unstaked) revert AlreadyUnstaked();

        uint256 firstUnlockTime = userStake.startTime + userStake.lockDuration;
        if (block.timestamp < firstUnlockTime) revert LockPeriodNotEnded();

        (, uint256 finalReward) = _calculateClaimableReward(userStake);

        if (finalReward > 0 && rewardPool < finalReward) {
            revert InsufficientRewardPool();
        }

        uint256 principalAmount = userStake.amount;
        uint256 totalAmount = principalAmount + finalReward;

        if (finalReward > 0) {
            rewardPool -= finalReward;
            userStake.totalClaimed += finalReward;
        }

        userStake.unstaked = true;

        _userAggregates[msg.sender].totalStaked -= principalAmount;
        _userAggregates[msg.sender].activeStakeCount -= 1;
        totalStaked -= principalAmount;

        stakingToken.safeTransfer(msg.sender, totalAmount);

        emit Unstaked(_stakeId, msg.sender, principalAmount, finalReward, totalAmount);
    }

    /**
     * @notice Emergency withdraw principal only when contract is paused
     * @param _stakeId Stake ID to emergency withdraw
     */
    function emergencyWithdraw(uint256 _stakeId) external nonReentrant {
        if (!paused()) revert NotPaused();

        Stake storage userStake = stakes[_stakeId];

        if (userStake.staker == address(0)) revert StakeNotFound();
        if (userStake.staker != msg.sender) revert NotStakeOwner();
        if (userStake.unstaked) revert AlreadyUnstaked();

        uint256 principalAmount = userStake.amount;

        userStake.unstaked = true;

        _userAggregates[msg.sender].totalStaked -= principalAmount;
        _userAggregates[msg.sender].activeStakeCount -= 1;
        totalStaked -= principalAmount;

        stakingToken.safeTransfer(msg.sender, principalAmount);

        emit EmergencyWithdraw(_stakeId, msg.sender, principalAmount);
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                       ADMIN FUNCTIONS
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    /**
     * @notice Update reward rate for a tier
     * @param _tier Tier to update
     * @param _newRewardRate New reward rate in basis points
     */
    function updateRewardRate(
        Tier _tier,
        uint256 _newRewardRate
    ) external onlyOwner {
        if (_newRewardRate == 0 || _newRewardRate > MAX_REWARD_RATE) {
            revert InvalidRewardRate();
        }

        TierPlan storage plan = tierPlans[_tier];
        uint256 oldRate = plan.rewardRate;
        plan.rewardRate = _newRewardRate;

        emit TierPlanUpdated(_tier, oldRate, _newRewardRate, plan.minStakeAmount, plan.minStakeAmount, plan.isActive);
    }

    /**
     * @notice Update tier duration (for testing)
     * @param _tier Tier to update
     * @param _newDuration New duration in seconds
     */
    function updateTierDuration(
        Tier _tier,
        uint256 _newDuration
    ) external onlyOwner {
        if (_newDuration == 0) revert InvalidDuration();

        TierPlan storage plan = tierPlans[_tier];
        uint256 oldDuration = plan.duration;
        plan.duration = _newDuration;

        emit TierDurationUpdated(_tier, oldDuration, _newDuration);
    }

    /**
     * @notice Update minimum stake amount for a tier (for testing)
     * @param _tier Tier to update
     * @param _newMinStake New minimum stake amount
     */
    function updateMinStakeAmount(
        Tier _tier,
        uint256 _newMinStake
    ) external onlyOwner {
        if (_newMinStake == 0) revert InvalidAmount();

        TierPlan storage plan = tierPlans[_tier];
        uint256 oldMin = plan.minStakeAmount;
        plan.minStakeAmount = _newMinStake;

        emit TierPlanUpdated(_tier, plan.rewardRate, plan.rewardRate, oldMin, _newMinStake, plan.isActive);
    }

    /**
     * @notice Enable or disable a tier
     * @param _tier Tier to update
     * @param _isActive Whether tier should be active
     */
    function setTierActive(
        Tier _tier,
        bool _isActive
    ) external onlyOwner {
        TierPlan storage plan = tierPlans[_tier];
        plan.isActive = _isActive;

        emit TierPlanUpdated(_tier, plan.rewardRate, plan.rewardRate, plan.minStakeAmount, plan.minStakeAmount, _isActive);
    }

    /**
 * @notice Batch update all tier parameters
 * @param _tiers Array of tiers
 * @param _rewardRates Array of reward rates
 * @param _durations Array of durations
 * @param _minStakes Array of minimum stakes
 * @param _isActive Array of active status
 */
function batchUpdateTierPlans(
    Tier[] calldata _tiers,
    uint256[] calldata _rewardRates,
    uint256[] calldata _durations,
    uint256[] calldata _minStakes,
    bool[] calldata _isActive
) external onlyOwner {
    uint256 length = _tiers.length;
    if (
        length != _rewardRates.length || 
        length != _durations.length ||
        length != _minStakes.length ||
        length != _isActive.length
    ) {
        revert ArrayLengthMismatch();
    }

    for (uint256 i = 0; i < length; ++i) {
        _updateSingleTierPlan(
            _tiers[i],
            _rewardRates[i],
            _durations[i],
            _minStakes[i],
            _isActive[i]
        );
    }
}

/**
 * @notice Internal function to update a single tier plan
 * @param _tier Tier to update
 * @param _rewardRate New reward rate
 * @param _duration New duration
 * @param _minStake New minimum stake
 * @param _isActive Active status
 */
function _updateSingleTierPlan(
    Tier _tier,
    uint256 _rewardRate,
    uint256 _duration,
    uint256 _minStake,
    bool _isActive
) internal {
    if (_rewardRate == 0 || _rewardRate > MAX_REWARD_RATE) {
        revert InvalidRewardRate();
    }
    if (_duration == 0) {
        revert InvalidDuration();
    }
    if (_minStake == 0) {
        revert InvalidAmount();
    }

    TierPlan storage plan = tierPlans[_tier];
    
    uint256 oldRate = plan.rewardRate;
    uint256 oldDuration = plan.duration;

    plan.rewardRate = _rewardRate;
    plan.duration = _duration;
    plan.minStakeAmount = _minStake;
    plan.isActive = _isActive;

    emit TierPlanUpdated(_tier, oldRate, _rewardRate, _minStake, _minStake, _isActive);
    
    if (oldDuration != _duration) {
        emit TierDurationUpdated(_tier, oldDuration, _duration);
    }
}

    /**
     * @notice Deposit tokens to the reward pool
     * @param _amount Amount of tokens to deposit
     */
    function depositRewardPool(uint256 _amount) external onlyOwner {
        if (_amount == 0) revert InvalidAmount();

        uint256 balanceBefore = stakingToken.balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        uint256 balanceAfter = stakingToken.balanceOf(address(this));

        if (balanceAfter - balanceBefore != _amount) {
            revert TransferAmountMismatch();
        }

        rewardPool += _amount;

        emit RewardPoolDeposited(msg.sender, _amount);
    }

    /**
     * @notice Withdraw tokens from reward pool
     * @param _amount Amount to withdraw
     */
    function withdrawRewardPool(uint256 _amount) external onlyOwner {
        if (_amount == 0) revert InvalidAmount();

        uint256 available = rewardPool > minimumReserve ? rewardPool - minimumReserve : 0;
        if (_amount > available) revert BelowMinimumReserve();

        rewardPool -= _amount;
        stakingToken.safeTransfer(msg.sender, _amount);

        emit RewardPoolWithdrawn(msg.sender, _amount);
    }

    /**
     * @notice Set minimum reserve for reward pool
     * @param _minimumReserve New minimum reserve amount
     */
    function setMinimumReserve(uint256 _minimumReserve) external onlyOwner {
        uint256 oldReserve = minimumReserve;
        minimumReserve = _minimumReserve;

        emit MinimumReserveUpdated(oldReserve, _minimumReserve);
    }

    /**
     * @notice Recover accidentally sent ERC20 tokens
     * @param _token Token address to recover
     * @param _to Recipient address
     * @param _amount Amount to recover
     */
    function recoverERC20(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyOwner {
        if (_token == address(stakingToken)) revert CannotRecoverStakingToken();
        if (_to == address(0)) revert ZeroAddress();
        if (_amount == 0) revert InvalidAmount();

        IERC20(_token).safeTransfer(_to, _amount);

        emit TokensRecovered(_token, _to, _amount);
    }

    /**
     * @notice Pause the contract
     */
    function pause() external onlyOwner {
        _pause();
        emit ContractPaused(msg.sender);
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
        emit ContractUnpaused(msg.sender);
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                       VIEW FUNCTIONS
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    /**
     * @notice Get user's current highest active tier
     * @param _user User address
     * @return currentTier User's highest tier (0=Bronze, 1=Silver, 2=Gold, 3=Platinum)
     * @return hasTier Whether user has any active stake
     * @return tierName String name of tier
     */
    function getUserCurrentTier(address _user) external view returns (
        Tier currentTier,
        bool hasTier,
        string memory tierName
    ) {
        uint256[] memory stakeIds = _userStakeIds[_user];
        uint256 length = stakeIds.length;

        int256 highestTier = -1;

        for (uint256 i = 0; i < length; ++i) {
            Stake memory userStake = stakes[stakeIds[i]];
            if (!userStake.unstaked) {
                int256 tierValue = int256(uint256(userStake.tier));
                if (tierValue > highestTier) {
                    highestTier = tierValue;
                }
            }
        }

        if (highestTier == -1) {
            return (Tier.BRONZE, false, "NONE");
        }

        currentTier = Tier(uint256(highestTier));
        hasTier = true;

        if (currentTier == Tier.BRONZE) {
            tierName = "BRONZE";
        } else if (currentTier == Tier.SILVER) {
            tierName = "SILVER";
        } else if (currentTier == Tier.GOLD) {
            tierName = "GOLD";
        } else {
            tierName = "PLATINUM";
        }
    }

    /**
     * @notice Get user's total staked amount
     * @param _user User address
     * @return totalAmount Total tokens currently staked by user
     * @return activeStakes Number of active stakes
     */
    function getUserTotalStaked(address _user) external view returns (
        uint256 totalAmount,
        uint256 activeStakes
    ) {
        return (
            _userAggregates[_user].totalStaked,
            _userAggregates[_user].activeStakeCount
        );
    }

    /**
     * @notice Get user's total estimated rewards
     * @param _user User address
     * @return claimableRewards Total rewards available to claim now
     * @return claimedRewards Total rewards already claimed
     * @return totalRewards Total lifetime rewards (claimable + claimed)
     */
    function getUserTotalRewards(address _user) external view returns (
        uint256 claimableRewards,
        uint256 claimedRewards,
        uint256 totalRewards
    ) {
        uint256[] memory stakeIds = _userStakeIds[_user];
        uint256 length = stakeIds.length;

        for (uint256 i = 0; i < length; ++i) {
            Stake memory userStake = stakes[stakeIds[i]];
            
            claimedRewards += userStake.totalClaimed;

            if (!userStake.unstaked) {
                (, uint256 pendingReward) = _calculateClaimableReward(userStake);
                claimableRewards += pendingReward;
            }
        }

        totalRewards = claimableRewards + claimedRewards;
    }

    /**
     * @notice Get all tier plans
     * @return tiers Array of tiers
     * @return plans Array of tier plans
     */
    function getAllTierPlans() external view returns (
        Tier[4] memory tiers,
        TierPlan[4] memory plans
    ) {
        tiers[0] = Tier.BRONZE;
        tiers[1] = Tier.SILVER;
        tiers[2] = Tier.GOLD;
        tiers[3] = Tier.PLATINUM;

        plans[0] = tierPlans[Tier.BRONZE];
        plans[1] = tierPlans[Tier.SILVER];
        plans[2] = tierPlans[Tier.GOLD];
        plans[3] = tierPlans[Tier.PLATINUM];
    }

    /**
     * @notice Get contract statistics
     * @return _totalStaked Total tokens staked
     * @return _rewardPool Available reward pool
     * @return _minimumReserve Minimum reserve requirement
     * @return _totalStakesCreated Total stakes ever created
     */
    function getContractStats() external view returns (
        uint256 _totalStaked,
        uint256 _rewardPool,
        uint256 _minimumReserve,
        uint256 _totalStakesCreated
    ) {
        return (totalStaked, rewardPool, minimumReserve, _stakeIdCounter);
    }

    /**
     * @notice Get user's stake IDs
     * @param _user User address
     * @return Array of stake IDs
     */
    function getUserStakeIds(address _user) external view returns (uint256[] memory) {
        return _userStakeIds[_user];
    }

    /**
     * @notice Get tier plan details
     * @param _tier Tier to query
     * @return plan TierPlan struct
     */
    function getTierPlan(Tier _tier) external view returns (TierPlan memory plan) {
        return tierPlans[_tier];
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    //                      INTERNAL FUNCTIONS
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

    /**
     * @notice Initialize default tier plans
     */
    function _initializeTierPlans() internal {
        // Bronze: 6 months, 5% reward, 1,000 min
        tierPlans[Tier.BRONZE] = TierPlan({
            duration: BRONZE_DURATION,
            rewardRate: 500,
            minStakeAmount: BRONZE_MIN_STAKE,
            isActive: true
        });

        // Silver: 12 months, 10% reward, 5,000 min
        tierPlans[Tier.SILVER] = TierPlan({
            duration: SILVER_DURATION,
            rewardRate: 1000,
            minStakeAmount: SILVER_MIN_STAKE,
            isActive: true
        });

        // Gold: 18 months, 15% reward, 15,000 min
        tierPlans[Tier.GOLD] = TierPlan({
            duration: GOLD_DURATION,
            rewardRate: 1500,
            minStakeAmount: GOLD_MIN_STAKE,
            isActive: true
        });

        // Platinum: 24 months, 23% reward, 50,000 min
        tierPlans[Tier.PLATINUM] = TierPlan({
            duration: PLATINUM_DURATION,
            rewardRate: 2300,
            minStakeAmount: PLATINUM_MIN_STAKE,
            isActive: true
        });
    }

    /**
     * @notice Calculate claimable reward for a stake
     * @param _stake Stake to calculate for
     * @return claimableCycles Number of complete cycles
     * @return claimableReward Total claimable reward
     */
    function _calculateClaimableReward(Stake memory _stake) internal view returns (
        uint256 claimableCycles,
        uint256 claimableReward
    ) {
        if (block.timestamp <= _stake.lastClaimTime) {
            return (0, 0);
        }
        
        uint256 timeElapsed = block.timestamp - _stake.lastClaimTime;
        claimableCycles = timeElapsed / _stake.lockDuration;

        if (claimableCycles > 0) {
            claimableReward = claimableCycles * _stake.rewardPerCycle;
        }
    }
}