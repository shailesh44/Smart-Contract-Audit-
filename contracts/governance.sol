// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Interface used to call mint() on the Vittagems ERC20 contract
interface IVittagemsMinter {
    function mint(address to, uint256 amount) external;
}

contract DOVGovernance is AccessControl, ReentrancyGuard, Pausable {

    bytes32 public constant DAO_MEMBER_ROLE = keccak256("DAO_MEMBER_ROLE");
    bytes32 public constant RESERVE_UPDATE_ROLE = keccak256("RESERVE_UPDATE_ROLE");

    enum ProposalState { None, Active, Succeeded, Defeated, Executed, Cancelled }

    struct Proposal {
        uint256 id;
        bytes32 secretHash;          // keccak256 of the secret word required to execute
        string ipfsCid;              // IPFS hash pointing to the reserve audit document
        uint256 proposedReserve;     // New reserve value this proposal would set
        uint256 startTime;
        uint256 endTime;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 totalEligibleVoters; // Snapshot of active member count at proposal creation
        uint256 rewardPool;          // Total VGMG tokens to distribute among voters
        ProposalState state;
        address proposer;
    }

    struct MemberInfo {
        bool isActive;
        uint256 joinedAt;            // Timestamp used for cooldown enforcement
    }

    // Token reference set post-deployment, then permanently locked
    IERC20 public vgmgToken;
    address public vgmgTokenAddress;
    bool public vgmgTokenLocked;

    // Reserve state updated when proposals are executed
    uint256 public currentReserve;
    uint256 public lastUpdatedAt;
    uint256 public reserveUpdateCount;

    // Proposal tracking; only one active proposal at a time
    uint256 public proposalCount;
    uint256 public activeProposalId;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => address[]) internal proposalVoters;
    mapping(uint256 => mapping(address => bool)) internal voterSupport;

    // DAO membership registry
    mapping(address => MemberInfo) public members;
    address[] public memberList;
    uint256 public activeMemberCount;

    // Governance tuning parameters
    uint256 public minVotingDuration;
    uint256 public maxVotingDuration;
    uint256 public quorumPercentage;       // Basis points (e.g., 5000 = 50%)
    uint256 public approvalThreshold;      // Basis points (e.g., 6000 = 60%)
    uint256 public memberCooldownPeriod;   // Seconds a new member must wait before voting
    uint256 public maxReserveChangePercent; // Basis points; 0 disables the limit

    // Reward claim tracking
    mapping(uint256 => mapping(address => bool)) public rewardClaimed;
    uint256 public totalRewardsMinted;

    uint256 public constant BASIS_POINTS = 10000;

    event ProposalCreated(
        uint256 indexed proposalId, string ipfsCid, uint256 proposedReserve,
        uint256 rewardPool, uint256 startTime, uint256 endTime,
        uint256 totalEligibleVoters, address indexed proposer
    );
    event VoteCast(
        uint256 indexed proposalId, address indexed voter, bool support,
        uint256 yesVotes, uint256 noVotes
    );
    event ProposalExecuted(
        uint256 indexed proposalId, uint256 oldReserve, uint256 newReserve,
        uint256 rewardsMinted, address indexed executor
    );
    event ProposalCancelled(uint256 indexed proposalId, address indexed cancelledBy);
    event ReserveUpdated(uint256 indexed updateIndex, uint256 oldReserve, uint256 newReserve, uint256 timestamp);
    event RewardsMinted(uint256 indexed proposalId, uint256 amount, uint256 voterCount);
    event RewardClaimed(address indexed member, uint256 indexed proposalId, uint256 amount);
    event MemberAdded(address indexed member, uint256 timestamp);
    event MemberRemoved(address indexed member, uint256 timestamp);
    event ParamUpdated(string parameter, uint256 oldValue, uint256 newValue);
    event VGMGTokenSet(address indexed tokenAddress);
    event VGMGTokenLocked(address indexed tokenAddress);

    error ActiveProposalExists();
    error NoActiveProposal();
    error InvalidDuration();
    error InvalidReserveValue();
    error InvalidState();
    error VotingNotActive();
    error AlreadyVoted();
    error MemberInCooldown();
    error VotingNotEnded();
    error QuorumNotReached();
    error ApprovalNotReached();
    error ReserveChangeExceedsLimit();
    error InvalidParam();
    error MemberExists();
    error MemberNotFound();
    error NotAuthorized();
    error WrongSecret();
    error AlreadyClaimed();
    error NoReward();
    error DidNotVote();
    error EmptySecret();
    error RewardExceedsCapacity();
    error TokenNotSet();
    error TokenAlreadyLocked();

    /// @param admin Address receiving DEFAULT_ADMIN_ROLE
    /// @param _quorumPercentage Minimum voter turnout in basis points
    /// @param _approvalThreshold Minimum yes-vote ratio in basis points
    /// @param _minVotingDuration Shortest allowed voting period in seconds
    /// @param _maxVotingDuration Longest allowed voting period in seconds
    /// @param _memberCooldownPeriod Seconds a new member waits before becoming vote-eligible
    constructor(
        address admin,
        uint256 _quorumPercentage,
        uint256 _approvalThreshold,
        uint256 _minVotingDuration,
        uint256 _maxVotingDuration,
        uint256 _memberCooldownPeriod
    ) {
        if (admin == address(0)) revert InvalidParam();
        if (_quorumPercentage == 0 || _quorumPercentage > BASIS_POINTS) revert InvalidParam();
        if (_approvalThreshold == 0 || _approvalThreshold > BASIS_POINTS) revert InvalidParam();
        if (_minVotingDuration == 0 || _maxVotingDuration < _minVotingDuration) revert InvalidParam();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        quorumPercentage = _quorumPercentage;
        approvalThreshold = _approvalThreshold;
        minVotingDuration = _minVotingDuration;
        maxVotingDuration = _maxVotingDuration;
        memberCooldownPeriod = _memberCooldownPeriod;
    }

    /// @notice Sets the VGMG token contract address; callable multiple times until locked
    /// @dev Deployment flow: deploy Vittagems â deploy DOVGovernance â call this â call lockVGMGToken()
    /// @param _token Address of the deployed Vittagems ERC20 contract
    function setVGMGToken(address _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vgmgTokenLocked) revert TokenAlreadyLocked();
        if (_token == address(0)) revert InvalidParam();

        vgmgToken = IERC20(_token);
        vgmgTokenAddress = _token;

        emit VGMGTokenSet(_token);
    }

    /// @notice Permanently locks the token address so it can never be changed again
    function lockVGMGToken() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (vgmgTokenAddress == address(0)) revert TokenNotSet();
        if (vgmgTokenLocked) revert TokenAlreadyLocked();

        vgmgTokenLocked = true;
        emit VGMGTokenLocked(vgmgTokenAddress);
    }

    /// @notice Registers a new DAO member and grants them the voting role
    /// @param account Address to add as a member
    function addMember(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidParam();
        if (members[account].isActive) revert MemberExists();

        _grantRole(DAO_MEMBER_ROLE, account);
        members[account] = MemberInfo({ isActive: true, joinedAt: block.timestamp });
        memberList.push(account);
        activeMemberCount++;

        emit MemberAdded(account, block.timestamp);
    }

    /// @notice Deactivates a DAO member and revokes their voting role
    /// @param account Address to remove
    function removeMember(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!members[account].isActive) revert MemberNotFound();

        _revokeRole(DAO_MEMBER_ROLE, account);
        members[account].isActive = false;
        activeMemberCount--;

        emit MemberRemoved(account, block.timestamp);
    }

    /// @notice Returns the full list of addresses ever added as members (includes inactive)
    function getMemberList() external view returns (address[] memory) {
        return memberList;
    }

    /// @notice Creates a new reserve-update proposal with an embedded secret for execution
    /// @param ipfsCid IPFS content identifier for the supporting audit document
    /// @param proposedReserve The new reserve value to set if the vote passes
    /// @param secretWord Plaintext secret whose hash is stored; required to execute later
    /// @param duration Voting window length in seconds (must be within configured limits)
    /// @param rewardPool Total VGMG tokens to mint and distribute among voters upon execution
    function createProposal(
        string calldata ipfsCid,
        uint256 proposedReserve,
        string calldata secretWord,
        uint256 duration,
        uint256 rewardPool
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        if (vgmgTokenAddress == address(0)) revert TokenNotSet();

        // Only one active proposal at a time
        if (activeProposalId != 0 && proposals[activeProposalId].state == ProposalState.Active)
            revert ActiveProposalExists();

        if (bytes(secretWord).length == 0) revert EmptySecret();
        if (duration < minVotingDuration || duration > maxVotingDuration) revert InvalidDuration();
        if (proposedReserve == 0) revert InvalidReserveValue();
        if (activeMemberCount == 0) revert InvalidParam();

        // Enforce maximum reserve change percentage if configured
        if (maxReserveChangePercent > 0 && currentReserve > 0) {
            uint256 change = proposedReserve > currentReserve
                ? proposedReserve - currentReserve
                : currentReserve - proposedReserve;
            if ((change * BASIS_POINTS) / currentReserve > maxReserveChangePercent)
                revert ReserveChangeExceedsLimit();
        }

        // Ensure reward pool fits within the minting headroom the new reserve would create
        if (rewardPool > 0) {
            uint256 supply = vgmgToken.totalSupply();
            if (proposedReserve <= supply || rewardPool > proposedReserve - supply)
                revert RewardExceedsCapacity();
        }

        proposalCount++;
        proposals[proposalCount] = Proposal({
            id: proposalCount,
            secretHash: keccak256(abi.encodePacked(secretWord)),
            ipfsCid: ipfsCid,
            proposedReserve: proposedReserve,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            yesVotes: 0,
            noVotes: 0,
            totalEligibleVoters: activeMemberCount,
            rewardPool: rewardPool,
            state: ProposalState.Active,
            proposer: msg.sender
        });
        activeProposalId = proposalCount;

        emit ProposalCreated(
            proposalCount, ipfsCid, proposedReserve, rewardPool,
            block.timestamp, block.timestamp + duration, activeMemberCount, msg.sender
        );
    }

    /// @notice Casts a yes or no vote on the current active proposal
    /// @param support true for yes, false for no
    function vote(bool support) external onlyRole(DAO_MEMBER_ROLE) whenNotPaused {
        uint256 pid = activeProposalId;
        if (pid == 0) revert NoActiveProposal();

        Proposal storage p = proposals[pid];
        if (p.state != ProposalState.Active) revert InvalidState();
        if (block.timestamp < p.startTime || block.timestamp > p.endTime) revert VotingNotActive();
        if (hasVoted[pid][msg.sender]) revert AlreadyVoted();

        // Members must have joined before the cooldown window preceding the proposal start
        uint256 eligibleAt = members[msg.sender].joinedAt + memberCooldownPeriod;
        if (eligibleAt > p.startTime) revert MemberInCooldown();

        hasVoted[pid][msg.sender] = true;
        voterSupport[pid][msg.sender] = support;
        proposalVoters[pid].push(msg.sender);

        if (support) {
            p.yesVotes++;
        } else {
            p.noVotes++;
        }

        emit VoteCast(pid, msg.sender, support, p.yesVotes, p.noVotes);
    }

    /// @notice Executes a passed proposal: updates reserve and mints voter rewards
    /// @dev Requires the correct secret word and that the voting period has ended
    /// @param proposalId ID of the proposal to execute
    /// @param secretWord Plaintext secret that must hash-match the stored secretHash
    function executeReserveUpdate(
        uint256 proposalId,
        string calldata secretWord
    ) external nonReentrant whenNotPaused {
        // Only admin or dedicated reserve-update role can execute
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(RESERVE_UPDATE_ROLE, msg.sender))
            revert NotAuthorized();

        Proposal storage p = proposals[proposalId];
        if (p.state != ProposalState.Active) revert InvalidState();
        if (block.timestamp <= p.endTime) revert VotingNotEnded();

        // Verify quorum and approval thresholds are met
        _verifyVotingResult(p);

        // Verify the secret word matches the hash stored at creation time
        if (keccak256(abi.encodePacked(secretWord)) != p.secretHash) revert WrongSecret();

        uint256 oldReserve = currentReserve;
        currentReserve = p.proposedReserve;
        lastUpdatedAt = block.timestamp;
        reserveUpdateCount++;

        // Mint voter rewards into this contract; voters claim individually via claimReward()
        if (p.rewardPool > 0 && proposalVoters[proposalId].length > 0) {
            try IVittagemsMinter(vgmgTokenAddress).mint(address(this), p.rewardPool) {
                totalRewardsMinted += p.rewardPool;
                emit RewardsMinted(proposalId, p.rewardPool, proposalVoters[proposalId].length);
            } catch {
                // If minting fails (e.g., reserve insufficient), zero out rewards rather than reverting
                p.rewardPool = 0;
            }
        }

        p.state = ProposalState.Executed;
        activeProposalId = 0;

        emit ProposalExecuted(proposalId, oldReserve, currentReserve, p.rewardPool, msg.sender);
        emit ReserveUpdated(reserveUpdateCount, oldReserve, currentReserve, block.timestamp);
    }

    /// @notice Cancels a proposal; admin can cancel anytime, others only after a failed vote
    /// @param proposalId ID of the proposal to cancel
    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.state != ProposalState.Active) revert InvalidState();

        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            // Non-admins can only cancel after voting ends and the proposal did not pass
            if (block.timestamp <= p.endTime) revert VotingNotEnded();
            (bool quorumMet, bool approvalMet) = _checkVotingResult(p);
            require(!quorumMet || !approvalMet, "Passed");
        }

        p.state = ProposalState.Cancelled;
        activeProposalId = 0;

        emit ProposalCancelled(proposalId, msg.sender);
    }

    /// @notice Allows a voter to claim their equal share of a proposal's reward pool
    /// @param proposalId ID of the executed proposal to claim rewards from
    function claimReward(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (p.state != ProposalState.Executed) revert InvalidState();
        if (p.rewardPool == 0) revert NoReward();
        if (!hasVoted[proposalId][msg.sender]) revert DidNotVote();
        if (rewardClaimed[proposalId][msg.sender]) revert AlreadyClaimed();

        // Equal split among all voters; remainder stays in contract (dust)
        uint256 amount = p.rewardPool / proposalVoters[proposalId].length;
        if (amount == 0) revert NoReward();

        rewardClaimed[proposalId][msg.sender] = true;
        require(vgmgToken.transfer(msg.sender, amount), "Failed");

        emit RewardClaimed(msg.sender, proposalId, amount);
    }

    /// @notice Checks how much reward a specific account can claim from a proposal
    /// @param proposalId Proposal ID to check
    /// @param account Address to check eligibility for
    /// @return claimable Amount of VGMG tokens claimable
    /// @return status Human-readable status string for UI display
    function getClaimableReward(
        uint256 proposalId,
        address account
    ) external view returns (uint256 claimable, string memory status) {
        Proposal storage p = proposals[proposalId];
        if (p.state != ProposalState.Executed) return (0, "Not executed");
        if (p.rewardPool == 0) return (0, "No reward");
        if (!hasVoted[proposalId][account]) return (0, "Did not vote");
        if (rewardClaimed[proposalId][account]) return (0, "Claimed");
        return (p.rewardPool / proposalVoters[proposalId].length, "Claimable");
    }

    /// @notice Updates quorum percentage; blocked while a proposal is active
    /// @param val New quorum in basis points (1â10000)
    function setQuorumPercentage(uint256 val) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (val == 0 || val > BASIS_POINTS) revert InvalidParam();
        _requireNoActiveProposal();
        emit ParamUpdated("quorum", quorumPercentage, val);
        quorumPercentage = val;
    }

    /// @notice Updates approval threshold; blocked while a proposal is active
    /// @param val New threshold in basis points (1â10000)
    function setApprovalThreshold(uint256 val) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (val == 0 || val > BASIS_POINTS) revert InvalidParam();
        _requireNoActiveProposal();
        emit ParamUpdated("approval", approvalThreshold, val);
        approvalThreshold = val;
    }

    /// @notice Updates minimum and maximum voting duration; blocked while a proposal is active
    /// @param _min New minimum duration in seconds
    /// @param _max New maximum duration in seconds (must be >= _min)
    function setVotingDurationLimits(uint256 _min, uint256 _max) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_min == 0 || _max < _min) revert InvalidParam();
        _requireNoActiveProposal();
        emit ParamUpdated("minDuration", minVotingDuration, _min);
        emit ParamUpdated("maxDuration", maxVotingDuration, _max);
        minVotingDuration = _min;
        maxVotingDuration = _max;
    }

    /// @notice Updates the cooldown period new members must wait before voting
    /// @param val New cooldown in seconds
    function setMemberCooldownPeriod(uint256 val) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireNoActiveProposal();
        emit ParamUpdated("cooldown", memberCooldownPeriod, val);
        memberCooldownPeriod = val;
    }

    /// @notice Updates the max allowed reserve change per proposal; 0 disables the limit
    /// @param val New limit in basis points
    function setMaxReserveChangePercent(uint256 val) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireNoActiveProposal();
        emit ParamUpdated("maxChange", maxReserveChangePercent, val);
        maxReserveChangePercent = val;
    }

    /// @notice Pauses proposal creation, voting, and execution
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Resumes all governance operations after a pause
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Returns the current reserve value (implements IReserveOracle for the ERC20 contract)
    function getCurrentReserve() external view returns (uint256) {
        return currentReserve;
    }

    /// @notice Returns full proposal data by ID
    function getProposal(uint256 id) external view returns (Proposal memory) {
        return proposals[id];
    }

    /// @notice Returns the list of addresses that voted on a specific proposal
    function getProposalVoters(uint256 id) external view returns (address[] memory) {
        return proposalVoters[id];
    }

    /// @notice Returns the computed state of a proposal, accounting for post-vote-end evaluation
    /// @param proposalId Proposal ID to check
    /// @return The current effective ProposalState
    function getProposalState(uint256 proposalId) external view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        if (p.id == 0) return ProposalState.None;
        if (p.state == ProposalState.Executed) return ProposalState.Executed;
        if (p.state == ProposalState.Cancelled) return ProposalState.Cancelled;

        // Still within voting window
        if (block.timestamp <= p.endTime) return ProposalState.Active;

        // Voting ended â determine outcome
        (bool quorumMet, bool approvalMet) = _checkVotingResult(p);
        return (quorumMet && approvalMet) ? ProposalState.Succeeded : ProposalState.Defeated;
    }

    /// @notice Checks whether an account is currently eligible to vote and explains why not
    /// @param account Address to check
    /// @return eligible true if the account can vote right now
    /// @return reason Human-readable explanation for UI display
    function canVote(address account) external view returns (bool eligible, string memory reason) {
        if (!members[account].isActive) return (false, "Not member");
        if (activeProposalId == 0) return (false, "No proposal");

        Proposal storage p = proposals[activeProposalId];
        if (p.state != ProposalState.Active) return (false, "Not active");
        if (block.timestamp < p.startTime || block.timestamp > p.endTime) return (false, "Outside window");
        if (hasVoted[activeProposalId][account]) return (false, "Already voted");
        if (members[account].joinedAt + memberCooldownPeriod > p.startTime) return (false, "Cooldown");

        return (true, "Eligible");
    }

    /// @notice Returns a summary of the currently active proposal for dashboard display
    function getActiveProposalSummary()
        external view returns (
            uint256 proposalId, string memory ipfsCid, uint256 proposedReserve,
            uint256 rewardPool, uint256 startTime, uint256 endTime,
            uint256 yesVotes, uint256 noVotes, uint256 totalEligible, ProposalState state
        )
    {
        if (activeProposalId == 0)
            return (0, "", 0, 0, 0, 0, 0, 0, 0, ProposalState.None);

        Proposal storage p = proposals[activeProposalId];
        return (
            p.id, p.ipfsCid, p.proposedReserve, p.rewardPool,
            p.startTime, p.endTime, p.yesVotes, p.noVotes,
            p.totalEligibleVoters, p.state
        );
    }

    /// @notice Returns aggregate ecosystem statistics for dashboard display
    function getEcosystemStats()
        external view returns (
            uint256 reserve, uint256 tokenSupply, uint256 mintCapacity,
            uint256 totalProposals, uint256 totalUpdates, uint256 rewardsMinted,
            uint256 memberCount, uint256 govBalance
        )
    {
        uint256 supply = vgmgTokenAddress != address(0) ? vgmgToken.totalSupply() : 0;
        return (
            currentReserve,
            supply,
            currentReserve > supply ? currentReserve - supply : 0,
            proposalCount,
            reserveUpdateCount,
            totalRewardsMinted,
            activeMemberCount,
            vgmgTokenAddress != address(0) ? vgmgToken.balanceOf(address(this)) : 0
        );
    }

    /// @notice Allows admin to withdraw VGMG tokens held by this contract (e.g., unclaimed dust)
    /// @param to Recipient address
    /// @param amount Number of tokens to transfer
    function withdrawVGMG(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (vgmgTokenAddress == address(0)) revert TokenNotSet();
        if (to == address(0)) revert InvalidParam();
        require(vgmgToken.transfer(to, amount), "Failed");
    }

    /// @dev Reverts if there is currently an active proposal; used to guard parameter changes
    function _requireNoActiveProposal() internal view {
        if (activeProposalId != 0 && proposals[activeProposalId].state == ProposalState.Active)
            revert ActiveProposalExists();
    }

    /// @dev Calculates whether quorum and approval thresholds are met for a given proposal
    /// @return quorumMet true if enough voters participated
    /// @return approvalMet true if enough yes-votes were cast
    function _checkVotingResult(Proposal storage p) internal view returns (bool quorumMet, bool approvalMet) {
    uint256 totalVotes = p.yesVotes + p.noVotes;

    // Ceiling division formula: ceil(a × b / c) = (a × b + c - 1) / c
    // Prevents: (3 × 5000) / 10000 = 1 (floor, too lenient)
    // Ensures:  (3 × 5000 + 9999) / 10000 = 2 (ceiling, correct)
    uint256 requiredVoters = (p.totalEligibleVoters * quorumPercentage + BASIS_POINTS - 1) / BASIS_POINTS;
    if (requiredVoters == 0) requiredVoters = 1;
    quorumMet = totalVotes >= requiredVoters;

    // Ceiling division for approval threshold
    // Prevents: (3 × 6000) / 10000 = 1 (floor, too lenient)  
    // Ensures:  (3 × 6000 + 9999) / 10000 = 2 (ceiling, correct)
    uint256 requiredYes = totalVotes > 0
        ? (totalVotes * approvalThreshold + BASIS_POINTS - 1) / BASIS_POINTS
        : 1;
    if (requiredYes == 0) requiredYes = 1;
    approvalMet = p.yesVotes >= requiredYes;
}


    /// @dev Verifies voting result and reverts with specific error if thresholds are not met
    function _verifyVotingResult(Proposal storage p) internal view {
        (bool quorumMet, bool approvalMet) = _checkVotingResult(p);
        if (!quorumMet) revert QuorumNotReached();
        if (!approvalMet) revert ApprovalNotReached();
    }
}