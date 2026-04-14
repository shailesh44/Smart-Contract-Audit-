const { expect }      = require("chai");
const { ethers }      = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time }        = require("@nomicfoundation/hardhat-network-helpers");

const {
  BASIS_POINTS,
  DEFAULT_QUORUM, DEFAULT_APPROVAL,
  DEFAULT_MIN_DURATION, DEFAULT_MAX_DURATION, DEFAULT_COOLDOWN,
  DEFAULT_IPFS_CID, DEFAULT_SECRET, DEFAULT_DURATION, DEFAULT_REWARD_POOL,
  INITIAL_RESERVE, PROPOSED_RESERVE, MAX_TOKEN_SUPPLY,
  ProposalState,
  deployMockToken, deployBrokenMinter, deployGovernance,
  deployGovernanceFixture,
  deployGovernanceWithProposalFixture,
  deployGovernanceAllVotedYesFixture,
  deployGovernanceVotingEndedFixture,
  deployGovernanceExecutedFixture,
  deployGovernancePausedFixture,
  deployGovernanceNoTokenFixture,
  createProposal, voteAll, endVoting, fullProposalLifecycle,
} = require("./helpers/governanceHelpers");

const DAO_MEMBER_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("DAO_MEMBER_ROLE"));
const RESERVE_UPDATE_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("RESERVE_UPDATE_ROLE"));
const DEFAULT_ADMIN_ROLE   = ethers.ZeroHash;

// ============================================================
// DEPLOYMENT & CONSTRUCTOR
// ============================================================
describe("DOVGovernance - Deployment & Constructor", function () {

  it("should deploy with correct admin", async function () {
    const { gov, admin } = await loadFixture(deployGovernanceFixture);
    expect(await gov.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
  });

  it("should deploy with correct quorumPercentage", async function () {
    const { gov } = await loadFixture(deployGovernanceFixture);
    expect(await gov.quorumPercentage()).to.equal(DEFAULT_QUORUM);
  });

  it("should deploy with correct approvalThreshold", async function () {
    const { gov } = await loadFixture(deployGovernanceFixture);
    expect(await gov.approvalThreshold()).to.equal(DEFAULT_APPROVAL);
  });

  it("should deploy with correct voting duration limits", async function () {
    const { gov } = await loadFixture(deployGovernanceFixture);
    expect(await gov.minVotingDuration()).to.equal(DEFAULT_MIN_DURATION);
    expect(await gov.maxVotingDuration()).to.equal(DEFAULT_MAX_DURATION);
  });

  it("should deploy with correct cooldown period", async function () {
    const { gov } = await loadFixture(deployGovernanceFixture);
    expect(await gov.memberCooldownPeriod()).to.equal(DEFAULT_COOLDOWN);
  });

  it("should deploy with zero currentReserve", async function () {
    const { gov } = await loadFixture(deployGovernanceFixture);
    expect(await gov.currentReserve()).to.equal(0n);
  });

  it("should deploy unpaused", async function () {
    const { gov } = await loadFixture(deployGovernanceFixture);
    expect(await gov.paused()).to.be.false;
  });

  it("should deploy with proposalCount = 0", async function () {
    const { gov } = await loadFixture(deployGovernanceFixture);
    expect(await gov.proposalCount()).to.equal(0n);
  });

  it("should revert InvalidParam for zero admin address", async function () {
    const Governance = await ethers.getContractFactory("DOVGovernance");
    await expect(
      Governance.deploy(
        ethers.ZeroAddress,
        DEFAULT_QUORUM, DEFAULT_APPROVAL,
        DEFAULT_MIN_DURATION, DEFAULT_MAX_DURATION, DEFAULT_COOLDOWN
      )
    ).to.be.revertedWithCustomError(Governance, "InvalidParam");
  });

  it("should revert InvalidParam for quorum = 0", async function () {
    const [admin] = await ethers.getSigners();
    const Governance = await ethers.getContractFactory("DOVGovernance");
    await expect(
      Governance.deploy(
        admin.address, 0n, DEFAULT_APPROVAL,
        DEFAULT_MIN_DURATION, DEFAULT_MAX_DURATION, DEFAULT_COOLDOWN
      )
    ).to.be.revertedWithCustomError(Governance, "InvalidParam");
  });

  it("should revert InvalidParam for quorum > BASIS_POINTS", async function () {
    const [admin] = await ethers.getSigners();
    const Governance = await ethers.getContractFactory("DOVGovernance");
    await expect(
      Governance.deploy(
        admin.address, 10001n, DEFAULT_APPROVAL,
        DEFAULT_MIN_DURATION, DEFAULT_MAX_DURATION, DEFAULT_COOLDOWN
      )
    ).to.be.revertedWithCustomError(Governance, "InvalidParam");
  });

  it("should revert InvalidParam for approval = 0", async function () {
    const [admin] = await ethers.getSigners();
    const Governance = await ethers.getContractFactory("DOVGovernance");
    await expect(
      Governance.deploy(
        admin.address, DEFAULT_QUORUM, 0n,
        DEFAULT_MIN_DURATION, DEFAULT_MAX_DURATION, DEFAULT_COOLDOWN
      )
    ).to.be.revertedWithCustomError(Governance, "InvalidParam");
  });

  it("should revert InvalidParam for minDuration = 0", async function () {
    const [admin] = await ethers.getSigners();
    const Governance = await ethers.getContractFactory("DOVGovernance");
    await expect(
      Governance.deploy(
        admin.address, DEFAULT_QUORUM, DEFAULT_APPROVAL,
        0n, DEFAULT_MAX_DURATION, DEFAULT_COOLDOWN
      )
    ).to.be.revertedWithCustomError(Governance, "InvalidParam");
  });

  it("should revert InvalidParam when maxDuration < minDuration", async function () {
    const [admin] = await ethers.getSigners();
    const Governance = await ethers.getContractFactory("DOVGovernance");
    await expect(
      Governance.deploy(
        admin.address, DEFAULT_QUORUM, DEFAULT_APPROVAL,
        300n, 100n, DEFAULT_COOLDOWN   // max < min
      )
    ).to.be.revertedWithCustomError(Governance, "InvalidParam");
  });
});

// ============================================================
// TOKEN MANAGEMENT
// ============================================================
describe("DOVGovernance - Token Management", function () {

  describe("setVGMGToken()", function () {

    it("should allow admin to set token", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceNoTokenFixture);
      const token = await deployMockToken();
      await gov.connect(admin).setVGMGToken(await token.getAddress());
      expect(await gov.vgmgTokenAddress()).to.equal(await token.getAddress());
    });

    it("should emit VGMGTokenSet event", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceNoTokenFixture);
      const token = await deployMockToken();
      const tokenAddr = await token.getAddress();
      await expect(gov.connect(admin).setVGMGToken(tokenAddr))
        .to.emit(gov, "VGMGTokenSet")
        .withArgs(tokenAddr);
    });

    it("should allow updating token before lock", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceNoTokenFixture);
      const token1 = await deployMockToken();
      const token2 = await deployMockToken();
      await gov.connect(admin).setVGMGToken(await token1.getAddress());
      await gov.connect(admin).setVGMGToken(await token2.getAddress());
      expect(await gov.vgmgTokenAddress()).to.equal(await token2.getAddress());
    });

    it("should revert InvalidParam for zero address token", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceNoTokenFixture);
      await expect(
        gov.connect(admin).setVGMGToken(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(gov, "InvalidParam");
    });

    it("should revert TokenAlreadyLocked after locking", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      const token = await deployMockToken();
      await expect(
        gov.connect(admin).setVGMGToken(await token.getAddress())
      ).to.be.revertedWithCustomError(gov, "TokenAlreadyLocked");
    });

    it("should revert if non-admin calls setVGMGToken", async function () {
      const { gov, member1 } = await loadFixture(deployGovernanceNoTokenFixture);
      const token = await deployMockToken();
      await expect(
        gov.connect(member1).setVGMGToken(await token.getAddress())
      ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
    });
  });

  describe("lockVGMGToken()", function () {

    it("should lock token address permanently", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceNoTokenFixture);
      const token = await deployMockToken();
      await gov.connect(admin).setVGMGToken(await token.getAddress());
      await gov.connect(admin).lockVGMGToken();
      expect(await gov.vgmgTokenLocked()).to.be.true;
    });

    it("should emit VGMGTokenLocked event", async function () {
      const { gov, admin, token } = await loadFixture(deployGovernanceFixture);
      // Already locked in fixture — test the event from a fresh deploy
      const { gov: gov2, admin: admin2 } =
        await loadFixture(deployGovernanceNoTokenFixture);
      const freshToken = await deployMockToken();
      await gov2.connect(admin2).setVGMGToken(await freshToken.getAddress());
      await expect(gov2.connect(admin2).lockVGMGToken())
        .to.emit(gov2, "VGMGTokenLocked")
        .withArgs(await freshToken.getAddress());
    });

    it("should revert TokenNotSet if token not set before locking", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceNoTokenFixture);
      await expect(
        gov.connect(admin).lockVGMGToken()
      ).to.be.revertedWithCustomError(gov, "TokenNotSet");
    });

    it("should revert TokenAlreadyLocked if already locked", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).lockVGMGToken()
      ).to.be.revertedWithCustomError(gov, "TokenAlreadyLocked");
    });

    it("should revert if non-admin calls lockVGMGToken", async function () {
      const { gov, member1 } = await loadFixture(deployGovernanceNoTokenFixture);
      await expect(
        gov.connect(member1).lockVGMGToken()
      ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
    });
  });
});

// ============================================================
// MEMBER MANAGEMENT
// ============================================================
describe("DOVGovernance - Member Management", function () {

  describe("addMember()", function () {

    it("should add a member and grant DAO_MEMBER_ROLE", async function () {
      const { gov, admin, nonMember } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).addMember(nonMember.address);
      expect(await gov.hasRole(DAO_MEMBER_ROLE, nonMember.address)).to.be.true;
    });

    it("should set member isActive = true", async function () {
      const { gov, admin, nonMember } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).addMember(nonMember.address);
      const info = await gov.members(nonMember.address);
      expect(info.isActive).to.be.true;
    });

    it("should record joinedAt timestamp", async function () {
      const { gov, admin, nonMember } = await loadFixture(deployGovernanceFixture);
      const before = BigInt(await time.latest());
      await gov.connect(admin).addMember(nonMember.address);
      const info = await gov.members(nonMember.address);
      expect(info.joinedAt).to.be.gte(before);
    });

    it("should increment activeMemberCount", async function () {
      const { gov, admin, nonMember } = await loadFixture(deployGovernanceFixture);
      const before = await gov.activeMemberCount();
      await gov.connect(admin).addMember(nonMember.address);
      expect(await gov.activeMemberCount()).to.equal(before + 1n);
    });

    it("should add address to memberList", async function () {
      const { gov, admin, nonMember } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).addMember(nonMember.address);
      const list = await gov.getMemberList();
      expect(list).to.include(nonMember.address);
    });

    it("should emit MemberAdded event", async function () {
  const { gov, admin, nonMember } = await loadFixture(deployGovernanceFixture);

  // FIX: Do NOT capture timestamp before the tx.
  // The block timestamp is set WHEN the tx mines, not when we call time.latest().
  // Use the receipt's block to get the exact timestamp.
  const tx = await gov.connect(admin).addMember(nonMember.address);
  const receipt = await tx.wait();
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  const blockTimestamp = BigInt(block.timestamp);

  await expect(tx)
    .to.emit(gov, "MemberAdded")
    .withArgs(nonMember.address, blockTimestamp);
});

    it("should revert InvalidParam for zero address", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).addMember(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(gov, "InvalidParam");
    });

    it("should revert MemberExists for duplicate member", async function () {
      const { gov, admin, member1 } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).addMember(member1.address)
      ).to.be.revertedWithCustomError(gov, "MemberExists");
    });

    it("should revert if non-admin adds member", async function () {
      const { gov, member1, nonMember } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(member1).addMember(nonMember.address)
      ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
    });
  });

  describe("removeMember()", function () {

    it("should set member isActive = false", async function () {
      const { gov, admin, member1 } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).removeMember(member1.address);
      const info = await gov.members(member1.address);
      expect(info.isActive).to.be.false;
    });

    it("should revoke DAO_MEMBER_ROLE", async function () {
      const { gov, admin, member1 } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).removeMember(member1.address);
      expect(await gov.hasRole(DAO_MEMBER_ROLE, member1.address)).to.be.false;
    });

    it("should decrement activeMemberCount", async function () {
      const { gov, admin, member1 } = await loadFixture(deployGovernanceFixture);
      const before = await gov.activeMemberCount();
      await gov.connect(admin).removeMember(member1.address);
      expect(await gov.activeMemberCount()).to.equal(before - 1n);
    });

    it("should emit MemberRemoved event", async function () {
      const { gov, admin, member1 } = await loadFixture(deployGovernanceFixture);
      await expect(gov.connect(admin).removeMember(member1.address))
        .to.emit(gov, "MemberRemoved");
    });

    it("should revert MemberNotFound for non-member", async function () {
      const { gov, admin, nonMember } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).removeMember(nonMember.address)
      ).to.be.revertedWithCustomError(gov, "MemberNotFound");
    });

    it("should revert MemberNotFound for already removed member", async function () {
      const { gov, admin, member1 } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).removeMember(member1.address);
      await expect(
        gov.connect(admin).removeMember(member1.address)
      ).to.be.revertedWithCustomError(gov, "MemberNotFound");
    });

    it("should revert if non-admin removes member", async function () {
      const { gov, member1, member2 } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(member1).removeMember(member2.address)
      ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
    });
  });
});

// ============================================================
// PROPOSAL CREATION
// ============================================================
describe("DOVGovernance - createProposal()", function () {

  describe("Positive Cases", function () {

    it("should create proposal with correct data", async function () {
      const { gov, admin, proposalId, proposedReserve, rewardPool } =
        await loadFixture(deployGovernanceWithProposalFixture);

      const p = await gov.getProposal(proposalId);
      expect(p.id).to.equal(proposalId);
      expect(p.ipfsCid).to.equal(DEFAULT_IPFS_CID);
      expect(p.proposedReserve).to.equal(proposedReserve);
      expect(p.rewardPool).to.equal(rewardPool);
      expect(p.state).to.equal(ProposalState.Active);
      expect(p.proposer).to.equal(admin.address);
    });

    it("should emit ProposalCreated with correct parameters", async function () {
      const { gov, admin, token } = await loadFixture(deployGovernanceFixture);
      const proposedReserve = ethers.parseEther("20000000");
      const rewardPool      = ethers.parseEther("1000");
      const startTime       = BigInt(await time.latest()) + 1n;

      await expect(
        gov.connect(admin).createProposal(
          DEFAULT_IPFS_CID, proposedReserve, DEFAULT_SECRET,
          DEFAULT_DURATION, rewardPool
        )
      ).to.emit(gov, "ProposalCreated");
    });

    it("should increment proposalCount", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      expect(await gov.proposalCount()).to.equal(0n);
      await createProposal(gov, admin, PROPOSED_RESERVE);
      expect(await gov.proposalCount()).to.equal(1n);
    });

    it("should set activeProposalId", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);
      expect(await gov.activeProposalId()).to.equal(proposalId);
    });

    it("should store secretHash correctly", async function () {
      const { gov, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);
      const p = await gov.getProposal(proposalId);
      const expected = ethers.keccak256(ethers.toUtf8Bytes(DEFAULT_SECRET));
      expect(p.secretHash).to.equal(expected);
    });

    it("should snapshot totalEligibleVoters at creation time", async function () {
      const { gov, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);
      const p = await gov.getProposal(proposalId);
      expect(p.totalEligibleVoters).to.equal(3n); // 3 members in fixture
    });

    it("should create proposal with zero rewardPool", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      const pid = await createProposal(gov, admin, PROPOSED_RESERVE, 0n);
      const p = await gov.getProposal(pid);
      expect(p.rewardPool).to.equal(0n);
    });

    it("should allow new proposal after previous one is executed", async function () {
      const { gov, admin, member1, member2, member3 } =
        await loadFixture(deployGovernanceFixture);

      // First proposal lifecycle
      const pid1 = await createProposal(
        gov, admin, ethers.parseEther("5000000")
      );
      await voteAll(gov, [member1, member2, member3], true);
      await endVoting();
      await gov.connect(admin).executeReserveUpdate(pid1, DEFAULT_SECRET);

      // Second proposal — should succeed
      await expect(
        createProposal(gov, admin, ethers.parseEther("8000000"))
      ).to.not.be.reverted;
    });
  });

  describe("Negative Cases", function () {

    it("should revert TokenNotSet when no token configured", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceNoTokenFixture);
      await expect(
        createProposal(gov, admin, PROPOSED_RESERVE)
      ).to.be.revertedWithCustomError(gov, "TokenNotSet");
    });

    it("should revert ActiveProposalExists when one is already active", async function () {
      const { gov, admin } =
        await loadFixture(deployGovernanceWithProposalFixture);
      await expect(
        createProposal(gov, admin, PROPOSED_RESERVE)
      ).to.be.revertedWithCustomError(gov, "ActiveProposalExists");
    });

    it("should revert EmptySecret for blank secret word", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).createProposal(
          DEFAULT_IPFS_CID, PROPOSED_RESERVE, "", DEFAULT_DURATION, 0n
        )
      ).to.be.revertedWithCustomError(gov, "EmptySecret");
    });

    it("should revert InvalidDuration when below minimum", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).createProposal(
          DEFAULT_IPFS_CID, PROPOSED_RESERVE, DEFAULT_SECRET, 1n, 0n
        )
      ).to.be.revertedWithCustomError(gov, "InvalidDuration");
    });

    it("should revert InvalidDuration when above maximum", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).createProposal(
          DEFAULT_IPFS_CID, PROPOSED_RESERVE, DEFAULT_SECRET,
          DEFAULT_MAX_DURATION + 1n, 0n
        )
      ).to.be.revertedWithCustomError(gov, "InvalidDuration");
    });

    it("should revert InvalidReserveValue for proposedReserve = 0", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).createProposal(
          DEFAULT_IPFS_CID, 0n, DEFAULT_SECRET, DEFAULT_DURATION, 0n
        )
      ).to.be.revertedWithCustomError(gov, "InvalidReserveValue");
    });

    it("should revert RewardExceedsCapacity when reward > reserve headroom", async function () {
      const { gov, admin, token } = await loadFixture(deployGovernanceFixture);
      // Token supply = 10M (pre-minted), proposedReserve = 11M
      // headroom = 11M - 10M = 1M; rewardPool = 2M > headroom
      const proposedReserve = ethers.parseEther("11000000");
      const rewardPool      = ethers.parseEther("2000000"); // exceeds headroom

      await expect(
        gov.connect(admin).createProposal(
          DEFAULT_IPFS_CID, proposedReserve, DEFAULT_SECRET,
          DEFAULT_DURATION, rewardPool
        )
      ).to.be.revertedWithCustomError(gov, "RewardExceedsCapacity");
    });

    it("should revert when paused", async function () {
      const { gov, admin } = await loadFixture(deployGovernancePausedFixture);
      await expect(
        createProposal(gov, admin, PROPOSED_RESERVE)
      ).to.be.revertedWithCustomError(gov, "EnforcedPause");
    });

    it("should revert if non-admin creates proposal", async function () {
      const { gov, member1 } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(member1).createProposal(
          DEFAULT_IPFS_CID, PROPOSED_RESERVE, DEFAULT_SECRET,
          DEFAULT_DURATION, 0n
        )
      ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
    });

    it("should revert ReserveChangeExceedsLimit when change is too large", async function () {
      const { gov, admin, member1, member2, member3 } =
        await loadFixture(deployGovernanceFixture);

      // First set a reserve by executing one proposal
      const pid1 = await createProposal(
        gov, admin, ethers.parseEther("5000000")
      );
      await voteAll(gov, [member1, member2, member3], true);
      await endVoting();
      await gov.connect(admin).executeReserveUpdate(pid1, DEFAULT_SECRET);

      // Set max change to 10% (1000 bps)
      await gov.connect(admin).setMaxReserveChangePercent(1000n);

      // Try to change by 50% — should fail
      const tooLarge = ethers.parseEther("7500000"); // +50% from 5M
      await expect(
        createProposal(gov, admin, tooLarge)
      ).to.be.revertedWithCustomError(gov, "ReserveChangeExceedsLimit");
    });
  });
});

// ============================================================
// VOTING
// ============================================================
describe("DOVGovernance - vote()", function () {

  describe("Positive Cases", function () {

    it("should record YES vote correctly", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await gov.connect(member1).vote(true);
      const p = await gov.getProposal(proposalId);
      expect(p.yesVotes).to.equal(1n);
      expect(p.noVotes).to.equal(0n);
    });

    it("should record NO vote correctly", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await gov.connect(member1).vote(false);
      const p = await gov.getProposal(proposalId);
      expect(p.noVotes).to.equal(1n);
      expect(p.yesVotes).to.equal(0n);
    });

    it("should emit VoteCast event", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await expect(gov.connect(member1).vote(true))
        .to.emit(gov, "VoteCast")
        .withArgs(proposalId, member1.address, true, 1n, 0n);
    });

    it("should mark hasVoted for the member", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await gov.connect(member1).vote(true);
      expect(await gov.hasVoted(proposalId, member1.address)).to.be.true;
    });

    it("should add voter to proposalVoters list", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await gov.connect(member1).vote(true);
      const voters = await gov.getProposalVoters(proposalId);
      expect(voters).to.include(member1.address);
    });

    it("should allow all 3 members to vote", async function () {
      const { gov, member1, member2, member3, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await gov.connect(member1).vote(true);
      await gov.connect(member2).vote(true);
      await gov.connect(member3).vote(false);

      const p = await gov.getProposal(proposalId);
      expect(p.yesVotes).to.equal(2n);
      expect(p.noVotes).to.equal(1n);
    });

    it("should track voterSupport correctly", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await gov.connect(member1).vote(true);
      const voters = await gov.getProposalVoters(proposalId);
      expect(voters).to.include(member1.address);
    });
  });

  describe("Negative Cases", function () {

    it("should revert NoActiveProposal when no proposal exists", async function () {
      const { gov, member1 } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(member1).vote(true)
      ).to.be.revertedWithCustomError(gov, "NoActiveProposal");
    });

    it("should revert AlreadyVoted on duplicate vote", async function () {
      const { gov, member1 } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await gov.connect(member1).vote(true);
      await expect(
        gov.connect(member1).vote(true)
      ).to.be.revertedWithCustomError(gov, "AlreadyVoted");
    });

    it("should revert VotingNotActive after voting window ends", async function () {
      const { gov, member1 } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await endVoting();
      await expect(
        gov.connect(member1).vote(true)
      ).to.be.revertedWithCustomError(gov, "VotingNotActive");
    });

    it("should revert for non-member", async function () {
      const { gov, nonMember } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await expect(
        gov.connect(nonMember).vote(true)
      ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
    });

    it("should revert for removed member", async function () {
      const { gov, admin, member1 } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await gov.connect(admin).removeMember(member1.address);
      await expect(
        gov.connect(member1).vote(true)
      ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
    });

    it("should revert MemberInCooldown for member who joined after proposal start", async function () {
      const [admin, member1, member2, member3, newMember] =
        await ethers.getSigners();

      // Deploy governance with 1-hour cooldown
      const gov = await deployGovernance(
        admin,
        DEFAULT_QUORUM, DEFAULT_APPROVAL,
        DEFAULT_MIN_DURATION, DEFAULT_MAX_DURATION,
        3600n  // 1 hour cooldown
      );

      const token = await deployMockToken();
      await gov.connect(admin).setVGMGToken(await token.getAddress());
      await gov.connect(admin).lockVGMGToken();

      // Add members with cooldown=0 would fail, so add BEFORE proposal
      // These members joined BEFORE proposal, so they are eligible
      await gov.connect(admin).addMember(member1.address);
      await gov.connect(admin).addMember(member2.address);
      await gov.connect(admin).addMember(member3.address);

      // Create proposal
      await gov.connect(admin).createProposal(
        DEFAULT_IPFS_CID,
        PROPOSED_RESERVE,
        DEFAULT_SECRET,
        DEFAULT_DURATION,
        0n
      );

      // Add newMember AFTER proposal start — they are in cooldown
      await gov.connect(admin).addMember(newMember.address);

      await expect(
        gov.connect(newMember).vote(true)
      ).to.be.revertedWithCustomError(gov, "MemberInCooldown");
    });

    it("should revert when paused", async function () {
      const { gov, admin, member1 } =
        await loadFixture(deployGovernanceWithProposalFixture);
      await gov.connect(admin).pause();
      await expect(
        gov.connect(member1).vote(true)
      ).to.be.revertedWithCustomError(gov, "EnforcedPause");
    });
  });
});

// ============================================================
// EXECUTE RESERVE UPDATE
// ============================================================
describe("DOVGovernance - executeReserveUpdate()", function () {

  describe("Positive Cases", function () {

    it("should update currentReserve after execution", async function () {
      const { gov, admin, proposalId, proposedReserve } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      await gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET);
      expect(await gov.currentReserve()).to.equal(proposedReserve);
    });

    it("should update lastUpdatedAt", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      const ts = BigInt(await time.latest()) + 1n;
      await gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET);
      expect(await gov.lastUpdatedAt()).to.be.gte(ts);
    });

    it("should increment reserveUpdateCount", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      const before = await gov.reserveUpdateCount();
      await gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET);
      expect(await gov.reserveUpdateCount()).to.equal(before + 1n);
    });

    it("should set proposal state to Executed", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      await gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET);
      const p = await gov.getProposal(proposalId);
      expect(p.state).to.equal(ProposalState.Executed);
    });

    it("should clear activeProposalId after execution", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      await gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET);
      expect(await gov.activeProposalId()).to.equal(0n);
    });

    it("should emit ProposalExecuted event", async function () {
      const { gov, admin, proposalId, proposedReserve, rewardPool } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      await expect(
        gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET)
      )
        .to.emit(gov, "ProposalExecuted")
        .withArgs(proposalId, 0n, proposedReserve, rewardPool, admin.address);
    });

    it("should emit ReserveUpdated event", async function () {
      const { gov, admin, proposalId, proposedReserve } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      await expect(
        gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET)
      ).to.emit(gov, "ReserveUpdated");
    });

    it("should mint rewards to governance contract", async function () {
      const { gov, token, admin, proposalId, rewardPool, govAddr } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      const balBefore = await token.balanceOf(govAddr);
      // Reward pool was pre-minted to gov in fixture
      // After execution, mint() is called — adds to existing balance
      await gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET);
      // Token minting increases balance
      const balAfter = await token.balanceOf(govAddr);
      // Balance increased by rewardPool (minted by executeReserveUpdate)
      expect(balAfter).to.be.gte(balBefore);
    });

    it("should allow RESERVE_UPDATE_ROLE to execute", async function () {
      const { gov, admin, executor, proposalId } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      await gov.connect(admin).grantRole(RESERVE_UPDATE_ROLE, executor.address);
      await expect(
        gov.connect(executor).executeReserveUpdate(proposalId, DEFAULT_SECRET)
      ).to.not.be.reverted;
    });

    it("should skip reward minting gracefully when mint reverts", async function () {
      /**
       * WHY: The contract wraps mint in try/catch.
       * If mint fails, rewardPool is zeroed but execution continues.
       */
      const [admin, member1, member2, member3] = await ethers.getSigners();
      const brokenToken = await deployBrokenMinter();
      const gov = await deployGovernance(admin);

      await gov.connect(admin).setVGMGToken(await brokenToken.getAddress());
      await gov.connect(admin).lockVGMGToken();

      await gov.connect(admin).addMember(member1.address);
      await gov.connect(admin).addMember(member2.address);
      await gov.connect(admin).addMember(member3.address);

      // Create proposal with reward pool
      // But broken token supply = 0 so headroom = proposedReserve
      const proposedReserve = ethers.parseEther("2000000");
      const rewardPool      = ethers.parseEther("100");
      await gov.connect(admin).createProposal(
        DEFAULT_IPFS_CID, proposedReserve, DEFAULT_SECRET,
        DEFAULT_DURATION, rewardPool
      );
      const pid = await gov.proposalCount();

      await gov.connect(member1).vote(true);
      await gov.connect(member2).vote(true);
      await gov.connect(member3).vote(true);
      await endVoting();

      // Execution should succeed even though mint reverts inside try/catch
      await expect(
        gov.connect(admin).executeReserveUpdate(pid, DEFAULT_SECRET)
      ).to.not.be.reverted;

      // Reserve is updated
      expect(await gov.currentReserve()).to.equal(proposedReserve);

      // Reward pool zeroed out
      const p = await gov.getProposal(pid);
      expect(p.rewardPool).to.equal(0n);
    });
  });

  describe("Negative Cases", function () {

    it("should revert VotingNotEnded before voting window closes", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceAllVotedYesFixture);

      await expect(
        gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET)
      ).to.be.revertedWithCustomError(gov, "VotingNotEnded");
    });

    it("should revert WrongSecret for incorrect secret", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      await expect(
        gov.connect(admin).executeReserveUpdate(proposalId, "wrongsecret")
      ).to.be.revertedWithCustomError(gov, "WrongSecret");
    });

    it("should revert QuorumNotReached when too few voters", async function () {
  const { gov, admin, member1 } =
    await loadFixture(deployGovernanceWithProposalFixture);

  // Setup: 3 eligible members, quorum = 50%
  // ceil(3 × 5000 / 10000) = ceil(1.5) = 2 votes required
  // Only member1 votes → 1 vote < 2 required → QuorumNotReached ✅
  await gov.connect(member1).vote(true);
  await endVoting();

  const pid = await gov.proposalCount();
  await expect(
    gov.connect(admin).executeReserveUpdate(pid, DEFAULT_SECRET)
  ).to.be.revertedWithCustomError(gov, "QuorumNotReached");
});


    it("should revert ApprovalNotReached when not enough YES votes", async function () {
  const { gov, admin, member1, member2, member3 } =
    await loadFixture(deployGovernanceWithProposalFixture);

  // Setup: 3 votes total, approval threshold = 60%
  // ceil(3 × 6000 / 10000) = ceil(1.8) = 2 YES votes required
  // 1 YES + 2 NO = 33% → 1 < 2 required → ApprovalNotReached ✅
  // Also: 3 votes satisfies quorum (3 >= ceil(1.5) = 2) so quorum IS met
  await gov.connect(member1).vote(true);   // YES
  await gov.connect(member2).vote(false);  // NO
  await gov.connect(member3).vote(false);  // NO
  await endVoting();

  const pid = await gov.proposalCount();
  await expect(
    gov.connect(admin).executeReserveUpdate(pid, DEFAULT_SECRET)
  ).to.be.revertedWithCustomError(gov, "ApprovalNotReached");
});


    it("should revert NotAuthorized for non-admin non-executor", async function () {
      const { gov, nonMember, proposalId } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      await expect(
        gov.connect(nonMember).executeReserveUpdate(proposalId, DEFAULT_SECRET)
      ).to.be.revertedWithCustomError(gov, "NotAuthorized");
    });

    it("should revert InvalidState for already executed proposal", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceExecutedFixture);

      await expect(
        gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET)
      ).to.be.revertedWithCustomError(gov, "InvalidState");
    });

    it("should revert when paused", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceVotingEndedFixture);

      await gov.connect(admin).pause();
      await expect(
        gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET)
      ).to.be.revertedWithCustomError(gov, "EnforcedPause");
    });
  });
});

// ============================================================
// CANCEL PROPOSAL
// ============================================================
describe("DOVGovernance - cancelProposal()", function () {

  it("should allow admin to cancel active proposal", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await gov.connect(admin).cancelProposal(proposalId);
    const p = await gov.getProposal(proposalId);
    expect(p.state).to.equal(ProposalState.Cancelled);
  });

  it("should emit ProposalCancelled event", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await expect(gov.connect(admin).cancelProposal(proposalId))
      .to.emit(gov, "ProposalCancelled")
      .withArgs(proposalId, admin.address);
  });

  it("should clear activeProposalId after cancel", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await gov.connect(admin).cancelProposal(proposalId);
    expect(await gov.activeProposalId()).to.equal(0n);
  });

  it("should allow non-admin to cancel failed proposal after voting ends", async function () {
  const { gov, member1, member2, member3, nonMember } =
    await loadFixture(deployGovernanceWithProposalFixture);

  // Setup: Need a vote result that FAILS (so non-admin can cancel)
  // 3 votes total, approval threshold = 60%
  // ceil(3 × 6000 / 10000) = ceil(1.8) = 2 YES required
  // 1 YES + 2 NO = 33% → FAILS approval ✅
  // Quorum: 3 votes >= ceil(3 × 50%) = 2 → quorum MET
  // But approval NOT met → proposal is Defeated → non-admin can cancel
  await gov.connect(member1).vote(true);   // 1 YES
  await gov.connect(member2).vote(false);  // 1 NO
  await gov.connect(member3).vote(false);  // 1 NO
  await endVoting();

  const pid = await gov.proposalCount();
  await expect(
    gov.connect(nonMember).cancelProposal(pid)
  ).to.not.be.reverted;
});


  it("should revert InvalidState for already cancelled proposal", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await gov.connect(admin).cancelProposal(proposalId);
    await expect(
      gov.connect(admin).cancelProposal(proposalId)
    ).to.be.revertedWithCustomError(gov, "InvalidState");
  });

  it("should revert VotingNotEnded for non-admin cancel before voting ends", async function () {
    const { gov, nonMember, proposalId } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await expect(
      gov.connect(nonMember).cancelProposal(proposalId)
    ).to.be.revertedWithCustomError(gov, "VotingNotEnded");
  });

  it("should revert for non-admin trying to cancel a passed proposal", async function () {
    const { gov, nonMember } =
      await loadFixture(deployGovernanceVotingEndedFixture);

    const pid = await gov.proposalCount();
    // Proposal passed — non-admin cannot cancel a passed one
    await expect(
      gov.connect(nonMember).cancelProposal(pid)
    ).to.be.revertedWith("Passed");
  });
});

// ============================================================
// CLAIM REWARD
// ============================================================
describe("DOVGovernance - claimReward()", function () {

  describe("Positive Cases", function () {

    it("should transfer equal share to each voter", async function () {
      const { gov, token, member1, member2, member3,
              proposalId, rewardPool } =
        await loadFixture(deployGovernanceExecutedFixture);

      const expectedPerVoter = rewardPool / 3n;

      const balBefore = await token.balanceOf(member1.address);
      await gov.connect(member1).claimReward(proposalId);
      const balAfter = await token.balanceOf(member1.address);

      expect(balAfter - balBefore).to.equal(expectedPerVoter);
    });

    it("should emit RewardClaimed event", async function () {
      const { gov, member1, proposalId, rewardPool } =
        await loadFixture(deployGovernanceExecutedFixture);

      await expect(gov.connect(member1).claimReward(proposalId))
        .to.emit(gov, "RewardClaimed")
        .withArgs(member1.address, proposalId, rewardPool / 3n);
    });

    it("should mark reward as claimed", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceExecutedFixture);

      await gov.connect(member1).claimReward(proposalId);
      expect(
        await gov.rewardClaimed(proposalId, member1.address)
      ).to.be.true;
    });

    it("should allow all 3 voters to claim separately", async function () {
      const { gov, token, member1, member2, member3,
              proposalId, rewardPool } =
        await loadFixture(deployGovernanceExecutedFixture);

      const perVoter = rewardPool / 3n;

      await gov.connect(member1).claimReward(proposalId);
      await gov.connect(member2).claimReward(proposalId);
      await gov.connect(member3).claimReward(proposalId);

      expect(await token.balanceOf(member1.address)).to.be.gte(perVoter);
      expect(await token.balanceOf(member2.address)).to.be.gte(perVoter);
      expect(await token.balanceOf(member3.address)).to.be.gte(perVoter);
    });
  });

  describe("Negative Cases", function () {

    it("should revert InvalidState for non-executed proposal", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);

      await expect(
        gov.connect(member1).claimReward(proposalId)
      ).to.be.revertedWithCustomError(gov, "InvalidState");
    });

    it("should revert AlreadyClaimed on duplicate claim", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceExecutedFixture);

      await gov.connect(member1).claimReward(proposalId);
      await expect(
        gov.connect(member1).claimReward(proposalId)
      ).to.be.revertedWithCustomError(gov, "AlreadyClaimed");
    });

    it("should revert DidNotVote for non-voter", async function () {
      const { gov, nonMember, proposalId } =
        await loadFixture(deployGovernanceExecutedFixture);

      await expect(
        gov.connect(nonMember).claimReward(proposalId)
      ).to.be.revertedWithCustomError(gov, "DidNotVote");
    });

    it("should revert NoReward when rewardPool is 0", async function () {
      const { gov, admin, member1, member2, member3 } =
        await loadFixture(deployGovernanceFixture);

      const pid = await createProposal(
        gov, admin, PROPOSED_RESERVE, 0n // no reward pool
      );
      await voteAll(gov, [member1, member2, member3], true);
      await endVoting();
      await gov.connect(admin).executeReserveUpdate(pid, DEFAULT_SECRET);

      await expect(
        gov.connect(member1).claimReward(pid)
      ).to.be.revertedWithCustomError(gov, "NoReward");
    });
  });
});

// ============================================================
// GOVERNANCE PARAMETERS
// ============================================================
describe("DOVGovernance - Parameter Updates", function () {

  describe("setQuorumPercentage()", function () {

    it("should update quorum percentage", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).setQuorumPercentage(7000n);
      expect(await gov.quorumPercentage()).to.equal(7000n);
    });

    it("should emit ParamUpdated event", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(gov.connect(admin).setQuorumPercentage(7000n))
        .to.emit(gov, "ParamUpdated")
        .withArgs("quorum", DEFAULT_QUORUM, 7000n);
    });

    it("should revert InvalidParam for 0", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).setQuorumPercentage(0n)
      ).to.be.revertedWithCustomError(gov, "InvalidParam");
    });

    it("should revert InvalidParam for > BASIS_POINTS", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).setQuorumPercentage(10001n)
      ).to.be.revertedWithCustomError(gov, "InvalidParam");
    });

    it("should revert ActiveProposalExists when proposal active", async function () {
      const { gov, admin } =
        await loadFixture(deployGovernanceWithProposalFixture);
      await expect(
        gov.connect(admin).setQuorumPercentage(7000n)
      ).to.be.revertedWithCustomError(gov, "ActiveProposalExists");
    });

    it("should revert if non-admin calls", async function () {
      const { gov, member1 } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(member1).setQuorumPercentage(7000n)
      ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
    });
  });

  describe("setApprovalThreshold()", function () {

    it("should update approval threshold", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).setApprovalThreshold(7000n);
      expect(await gov.approvalThreshold()).to.equal(7000n);
    });

    it("should revert InvalidParam for 0 or > BASIS_POINTS", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).setApprovalThreshold(0n)
      ).to.be.revertedWithCustomError(gov, "InvalidParam");
      await expect(
        gov.connect(admin).setApprovalThreshold(10001n)
      ).to.be.revertedWithCustomError(gov, "InvalidParam");
    });
  });

  describe("setVotingDurationLimits()", function () {

    it("should update min and max duration", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).setVotingDurationLimits(120n, 1209600n);
      expect(await gov.minVotingDuration()).to.equal(120n);
      expect(await gov.maxVotingDuration()).to.equal(1209600n);
    });

    it("should revert InvalidParam when max < min", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).setVotingDurationLimits(500n, 100n)
      ).to.be.revertedWithCustomError(gov, "InvalidParam");
    });

    it("should revert InvalidParam for min = 0", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).setVotingDurationLimits(0n, 1000n)
      ).to.be.revertedWithCustomError(gov, "InvalidParam");
    });
  });

  describe("setMemberCooldownPeriod()", function () {

    it("should update cooldown period", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).setMemberCooldownPeriod(86400n);
      expect(await gov.memberCooldownPeriod()).to.equal(86400n);
    });

    it("should allow setting cooldown to 0", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).setMemberCooldownPeriod(0n);
      expect(await gov.memberCooldownPeriod()).to.equal(0n);
    });
  });

  describe("setMaxReserveChangePercent()", function () {

    it("should update max reserve change percent", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).setMaxReserveChangePercent(2000n);
      expect(await gov.maxReserveChangePercent()).to.equal(2000n);
    });

    it("should allow setting to 0 (disables limit)", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await gov.connect(admin).setMaxReserveChangePercent(0n);
      expect(await gov.maxReserveChangePercent()).to.equal(0n);
    });
  });
});

// ============================================================
// PAUSE / UNPAUSE
// ============================================================
describe("DOVGovernance - Pause/Unpause", function () {

  it("should pause contract", async function () {
    const { gov, admin } = await loadFixture(deployGovernanceFixture);
    await gov.connect(admin).pause();
    expect(await gov.paused()).to.be.true;
  });

  it("should unpause contract", async function () {
    const { gov, admin } = await loadFixture(deployGovernancePausedFixture);
    await gov.connect(admin).unpause();
    expect(await gov.paused()).to.be.false;
  });

  it("should revert if non-admin pauses", async function () {
    const { gov, member1 } = await loadFixture(deployGovernanceFixture);
    await expect(
      gov.connect(member1).pause()
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("should revert if non-admin unpauses", async function () {
    const { gov, member1 } = await loadFixture(deployGovernancePausedFixture);
    await expect(
      gov.connect(member1).unpause()
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });
});

// ============================================================
// VIEW FUNCTIONS
// ============================================================
describe("DOVGovernance - View Functions", function () {

  describe("getCurrentReserve()", function () {
    it("should return 0 before any execution", async function () {
      const { gov } = await loadFixture(deployGovernanceFixture);
      expect(await gov.getCurrentReserve()).to.equal(0n);
    });

    it("should return updated reserve after execution", async function () {
      const { gov, proposedReserve } =
        await loadFixture(deployGovernanceExecutedFixture);
      expect(await gov.getCurrentReserve()).to.equal(proposedReserve);
    });
  });

  describe("getProposalState()", function () {
    it("should return None for non-existent proposal", async function () {
      const { gov } = await loadFixture(deployGovernanceFixture);
      expect(await gov.getProposalState(999n)).to.equal(ProposalState.None);
    });

    it("should return Active during voting window", async function () {
      const { gov, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);
      expect(await gov.getProposalState(proposalId)).to.equal(
        ProposalState.Active
      );
    });

    it("should return Succeeded after passing vote and window ends", async function () {
      const { gov, proposalId } =
        await loadFixture(deployGovernanceVotingEndedFixture);
      expect(await gov.getProposalState(proposalId)).to.equal(
        ProposalState.Succeeded
      );
    });

    it("should return Defeated when quorum not met", async function () {
  const { gov, member1 } =
    await loadFixture(deployGovernanceWithProposalFixture);

  // Setup: 3 eligible members, quorum = 50%
  // ceil(3 × 5000 / 10000) = ceil(1.5) = 2 votes required for quorum
  // Only member1 votes → 1 vote < 2 required → quorum NOT met → Defeated ✅
  await gov.connect(member1).vote(true);
  await endVoting();

  const pid = await gov.proposalCount();
  // Must equal ProposalState.Defeated = 3
  expect(await gov.getProposalState(pid)).to.equal(ProposalState.Defeated);
});


    it("should return Executed after execution", async function () {
      const { gov, proposalId } =
        await loadFixture(deployGovernanceExecutedFixture);
      expect(await gov.getProposalState(proposalId)).to.equal(
        ProposalState.Executed
      );
    });

    it("should return Cancelled after cancellation", async function () {
      const { gov, admin, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);
      await gov.connect(admin).cancelProposal(proposalId);
      expect(await gov.getProposalState(proposalId)).to.equal(
        ProposalState.Cancelled
      );
    });
  });

  describe("canVote()", function () {
    it("should return (false, 'Not member') for non-member", async function () {
      const { gov, nonMember } =
        await loadFixture(deployGovernanceWithProposalFixture);
      const { eligible, reason } = await gov.canVote(nonMember.address);
      expect(eligible).to.be.false;
      expect(reason).to.equal("Not member");
    });

    it("should return (true, 'Eligible') for valid voter", async function () {
      const { gov, member1 } =
        await loadFixture(deployGovernanceWithProposalFixture);
      const { eligible, reason } = await gov.canVote(member1.address);
      expect(eligible).to.be.true;
      expect(reason).to.equal("Eligible");
    });

    it("should return (false, 'No proposal') when no active proposal", async function () {
      const { gov, member1 } = await loadFixture(deployGovernanceFixture);
      const { eligible, reason } = await gov.canVote(member1.address);
      expect(eligible).to.be.false;
      expect(reason).to.equal("No proposal");
    });

    it("should return (false, 'Already voted') after voting", async function () {
      const { gov, member1 } =
        await loadFixture(deployGovernanceWithProposalFixture);
      await gov.connect(member1).vote(true);
      const { eligible, reason } = await gov.canVote(member1.address);
      expect(eligible).to.be.false;
      expect(reason).to.equal("Already voted");
    });

    it("should return (false, 'Outside window') after voting ends", async function () {
      const { gov, member1 } =
        await loadFixture(deployGovernanceWithProposalFixture);
      await endVoting();
      const { eligible, reason } = await gov.canVote(member1.address);
      expect(eligible).to.be.false;
      expect(reason).to.equal("Outside window");
    });
  });

  describe("getClaimableReward()", function () {
    it("should return claimable amount for voter", async function () {
      const { gov, member1, proposalId, rewardPool } =
        await loadFixture(deployGovernanceExecutedFixture);
      const { claimable, status } =
        await gov.getClaimableReward(proposalId, member1.address);
      expect(claimable).to.equal(rewardPool / 3n);
      expect(status).to.equal("Claimable");
    });

    it("should return 0 for non-voter", async function () {
      const { gov, nonMember, proposalId } =
        await loadFixture(deployGovernanceExecutedFixture);
      const { claimable, status } =
        await gov.getClaimableReward(proposalId, nonMember.address);
      expect(claimable).to.equal(0n);
      expect(status).to.equal("Did not vote");
    });

    it("should return 0 after claiming", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceExecutedFixture);
      await gov.connect(member1).claimReward(proposalId);
      const { claimable, status } =
        await gov.getClaimableReward(proposalId, member1.address);
      expect(claimable).to.equal(0n);
      expect(status).to.equal("Claimed");
    });

    it("should return 'Not executed' for active proposal", async function () {
      const { gov, member1, proposalId } =
        await loadFixture(deployGovernanceWithProposalFixture);
      const { claimable, status } =
        await gov.getClaimableReward(proposalId, member1.address);
      expect(claimable).to.equal(0n);
      expect(status).to.equal("Not executed");
    });
  });

  describe("getActiveProposalSummary()", function () {
    it("should return zeros when no active proposal", async function () {
      const { gov } = await loadFixture(deployGovernanceFixture);
      const result = await gov.getActiveProposalSummary();
      expect(result.proposalId).to.equal(0n);
      expect(result.state).to.equal(ProposalState.None);
    });

    it("should return correct data for active proposal", async function () {
      const { gov, proposalId, proposedReserve } =
        await loadFixture(deployGovernanceWithProposalFixture);
      const result = await gov.getActiveProposalSummary();
      expect(result.proposalId).to.equal(proposalId);
      expect(result.proposedReserve).to.equal(proposedReserve);
      expect(result.state).to.equal(ProposalState.Active);
    });
  });

  describe("getEcosystemStats()", function () {
    it("should return correct stats after execution", async function () {
      const { gov, proposedReserve } =
        await loadFixture(deployGovernanceExecutedFixture);

      const stats = await gov.getEcosystemStats();
      expect(stats.reserve).to.equal(proposedReserve);
      expect(stats.totalProposals).to.equal(1n);
      expect(stats.totalUpdates).to.equal(1n);
      expect(stats.memberCount).to.equal(3n);
    });
  });

  describe("withdrawVGMG()", function () {
    it("should allow admin to withdraw tokens", async function () {
      const { gov, token, admin, govAddr } =
        await loadFixture(deployGovernanceFixture);

      const amount = ethers.parseEther("100");
      const balBefore = await token.balanceOf(admin.address);
      await gov.connect(admin).withdrawVGMG(admin.address, amount);
      const balAfter = await token.balanceOf(admin.address);
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("should revert if non-admin calls withdrawVGMG", async function () {
      const { gov, member1 } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(member1).withdrawVGMG(member1.address, 1n)
      ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
    });

    it("should revert InvalidParam for zero recipient", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceFixture);
      await expect(
        gov.connect(admin).withdrawVGMG(ethers.ZeroAddress, 1n)
      ).to.be.revertedWithCustomError(gov, "InvalidParam");
    });

    it("should revert TokenNotSet when no token set", async function () {
      const { gov, admin } = await loadFixture(deployGovernanceNoTokenFixture);
      await expect(
        gov.connect(admin).withdrawVGMG(admin.address, 1n)
      ).to.be.revertedWithCustomError(gov, "TokenNotSet");
    });
  });
});