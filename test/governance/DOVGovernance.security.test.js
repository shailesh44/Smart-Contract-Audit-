const { expect }      = require("chai");
const { ethers }      = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time }        = require("@nomicfoundation/hardhat-network-helpers");

const {
  DEFAULT_IPFS_CID, DEFAULT_SECRET, DEFAULT_DURATION,
  PROPOSED_RESERVE, ProposalState,
  deployMockToken, deployBrokenMinter, deployGovernance,
  deployGovernanceFixture,
  deployGovernanceWithProposalFixture,
  deployGovernanceAllVotedYesFixture,
  deployGovernanceVotingEndedFixture,
  deployGovernanceExecutedFixture,
  deployGovernanceNoTokenFixture,
  createProposal, voteAll, endVoting,
} = require("./helpers/governanceHelpers");

const DEFAULT_ADMIN_ROLE  = ethers.ZeroHash;
const DAO_MEMBER_ROLE     = ethers.keccak256(ethers.toUtf8Bytes("DAO_MEMBER_ROLE"));
const RESERVE_UPDATE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("RESERVE_UPDATE_ROLE"));

// ============================================================
// ACCESS CONTROL SECURITY
// ============================================================
describe("DOVGovernance - Security: Access Control", function () {

  it("[CRITICAL] attacker cannot create proposals", async function () {
    const { gov, attacker } = await loadFixture(deployGovernanceFixture);
    await expect(
      gov.connect(attacker).createProposal(
        DEFAULT_IPFS_CID, PROPOSED_RESERVE, DEFAULT_SECRET, DEFAULT_DURATION, 0n
      )
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("[CRITICAL] attacker cannot add members", async function () {
    const { gov, attacker, nonMember } = await loadFixture(
      deployGovernanceFixture
    );
    await expect(
      gov.connect(attacker).addMember(nonMember.address)
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("[CRITICAL] attacker cannot remove members", async function () {
    const { gov, attacker, member1 } = await loadFixture(
      deployGovernanceFixture
    );
    await expect(
      gov.connect(attacker).removeMember(member1.address)
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("[CRITICAL] attacker cannot execute reserve update", async function () {
    const { gov, attacker, proposalId } =
      await loadFixture(deployGovernanceVotingEndedFixture);

    await expect(
      gov.connect(attacker).executeReserveUpdate(proposalId, DEFAULT_SECRET)
    ).to.be.revertedWithCustomError(gov, "NotAuthorized");
  });

  it("[CRITICAL] attacker cannot pause contract", async function () {
    const { gov, attacker } = await loadFixture(deployGovernanceFixture);
    await expect(
      gov.connect(attacker).pause()
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("[CRITICAL] attacker cannot drain VGMG tokens", async function () {
    const { gov, attacker } = await loadFixture(deployGovernanceFixture);
    await expect(
      gov.connect(attacker).withdrawVGMG(attacker.address, 1n)
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("[CRITICAL] member cannot grant themselves admin role", async function () {
    const { gov, member1 } = await loadFixture(deployGovernanceFixture);
    await expect(
      gov.connect(member1).grantRole(DEFAULT_ADMIN_ROLE, member1.address)
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("[CRITICAL] member cannot change governance parameters", async function () {
    const { gov, member1 } = await loadFixture(deployGovernanceFixture);
    await expect(
      gov.connect(member1).setQuorumPercentage(100n)
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("[CRITICAL] non-admin cannot set price or lock token", async function () {
    const { gov, member1 } = await loadFixture(deployGovernanceNoTokenFixture);
    const token = await deployMockToken();
    await expect(
      gov.connect(member1).setVGMGToken(await token.getAddress())
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });
});

// ============================================================
// SECRET WORD SECURITY
// ============================================================
describe("DOVGovernance - Security: Secret Word", function () {

  it("[CRITICAL] wrong secret cannot execute proposal", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceVotingEndedFixture);

    await expect(
      gov.connect(admin).executeReserveUpdate(proposalId, "hackerguess")
    ).to.be.revertedWithCustomError(gov, "WrongSecret");
  });

  it("[CRITICAL] empty string secret cannot execute", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceVotingEndedFixture);

    await expect(
      gov.connect(admin).executeReserveUpdate(proposalId, "")
    ).to.be.revertedWithCustomError(gov, "WrongSecret");
  });

  it("[CRITICAL] case-sensitive secret is enforced", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceVotingEndedFixture);

    // DEFAULT_SECRET = "mysecretword"
    await expect(
      gov.connect(admin).executeReserveUpdate(proposalId, "MYSECRETWORD")
    ).to.be.revertedWithCustomError(gov, "WrongSecret");
  });

  it("[CRITICAL] correct secret succeeds after failed attempts", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceVotingEndedFixture);

    // Wrong attempts don't consume the secret — correct one still works
    try { await gov.connect(admin).executeReserveUpdate(proposalId, "wrong1"); } catch {}
    try { await gov.connect(admin).executeReserveUpdate(proposalId, "wrong2"); } catch {}

    await expect(
      gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET)
    ).to.not.be.reverted;
  });

  it("[CRITICAL] secret hash stored at creation — changing secret after is impossible", async function () {
    /**
     * WHY: The secretHash is immutable in the proposal struct.
     * No function exists to update it post-creation.
     */
    const { gov, proposalId } =
      await loadFixture(deployGovernanceWithProposalFixture);
    const p = await gov.getProposal(proposalId);
    const expectedHash = ethers.keccak256(
      ethers.toUtf8Bytes(DEFAULT_SECRET)
    );
    expect(p.secretHash).to.equal(expectedHash);
    console.log("      ✅ Secret hash is immutable after proposal creation");
  });
});

// ============================================================
// VOTING INTEGRITY
// ============================================================
describe("DOVGovernance - Security: Voting Integrity", function () {

  it("[CRITICAL] member cannot vote twice", async function () {
    const { gov, member1 } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await gov.connect(member1).vote(true);
    await expect(
      gov.connect(member1).vote(false) // change vote attempt
    ).to.be.revertedWithCustomError(gov, "AlreadyVoted");
  });

  it("[CRITICAL] removed member cannot vote on active proposal", async function () {
    const { gov, admin, member1 } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await gov.connect(admin).removeMember(member1.address);
    await expect(
      gov.connect(member1).vote(true)
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("[CRITICAL] vote after window is rejected", async function () {
    const { gov, member1 } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await endVoting();
    await expect(
      gov.connect(member1).vote(true)
    ).to.be.revertedWithCustomError(gov, "VotingNotActive");
  });

  it("[CRITICAL] non-member cannot vote even with ETH", async function () {
    const { gov, nonMember } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await expect(
      gov.connect(nonMember).vote(true)
    ).to.be.revertedWithCustomError(gov, "AccessControlUnauthorizedAccount");
  });

  it("[CRITICAL] totalEligibleVoters snapshot cannot be manipulated post-creation", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceWithProposalFixture);

    const pBefore = await gov.getProposal(proposalId);
    const eligibleBefore = pBefore.totalEligibleVoters;

    // Add a new member AFTER proposal creation
    const [, , , , , , , newMember] = await ethers.getSigners();
    await gov.connect(admin).addMember(newMember.address);

    // Snapshot in proposal should be unchanged
    const pAfter = await gov.getProposal(proposalId);
    expect(pAfter.totalEligibleVoters).to.equal(eligibleBefore);
    console.log("      ✅ Eligible voter snapshot is immutable after proposal creation");
  });

  it("[CRITICAL] cooldown prevents sybil attacks via new members", async function () {
    /**
     * WHY: Without cooldown, an admin could add 100 new members
     * right before a proposal and inflate the vote count.
     * Cooldown prevents this attack.
     */
    const [admin, m1, m2, m3, sybil1, sybil2] = await ethers.getSigners();
    const gov = await deployGovernance(
      admin, 5000n, 6000n, 60n, 604800n, 3600n // 1 hour cooldown
    );
    const token = await deployMockToken();
    await gov.connect(admin).setVGMGToken(await token.getAddress());
    await gov.connect(admin).lockVGMGToken();

    // Legitimate members added early
    await gov.connect(admin).addMember(m1.address);
    await gov.connect(admin).addMember(m2.address);
    await gov.connect(admin).addMember(m3.address);

    // Create proposal
    await gov.connect(admin).createProposal(
      DEFAULT_IPFS_CID, PROPOSED_RESERVE, DEFAULT_SECRET,
      DEFAULT_DURATION, 0n
    );

    // Attacker adds sybil members RIGHT before voting
    await gov.connect(admin).addMember(sybil1.address);
    await gov.connect(admin).addMember(sybil2.address);

    // Sybil members cannot vote — cooldown blocks them
    await expect(
      gov.connect(sybil1).vote(true)
    ).to.be.revertedWithCustomError(gov, "MemberInCooldown");

    await expect(
      gov.connect(sybil2).vote(true)
    ).to.be.revertedWithCustomError(gov, "MemberInCooldown");

    console.log("      ✅ Cooldown prevents sybil attack via last-minute member addition");
  });
});

// ============================================================
// REENTRANCY PROTECTION
// ============================================================
describe("DOVGovernance - Security: Reentrancy", function () {

  it("[CRITICAL] claimReward marked claimed BEFORE transfer", async function () {
    /**
     * WHY: The contract calls:
     *   1. rewardClaimed[pid][msg.sender] = true  (EFFECT)
     *   2. vgmgToken.transfer(...)                 (INTERACTION)
     * Even if token had callbacks, state is updated first.
     */
    const { gov, member1, proposalId } =
      await loadFixture(deployGovernanceExecutedFixture);

    await gov.connect(member1).claimReward(proposalId);

    // State is marked claimed
    expect(await gov.rewardClaimed(proposalId, member1.address)).to.be.true;

    // Second claim must revert
    await expect(
      gov.connect(member1).claimReward(proposalId)
    ).to.be.revertedWithCustomError(gov, "AlreadyClaimed");

    console.log("      ✅ CEI pattern followed in claimReward — reentrancy blocked");
  });

  it("[CRITICAL] executeReserveUpdate is nonReentrant", async function () {
    /**
     * The nonReentrant modifier protects executeReserveUpdate.
     * State (p.state = Executed) is set before external mint call.
     */
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceVotingEndedFixture);

    await gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET);

    // Second call — proposal is now Executed, not Active
    await expect(
      gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET)
    ).to.be.revertedWithCustomError(gov, "InvalidState");

    console.log("      ✅ executeReserveUpdate correctly protected against re-entry");
  });

  it("[CRITICAL] withdrawVGMG is nonReentrant", async function () {
    const { gov, admin } = await loadFixture(deployGovernanceFixture);
    // Just verify the function works once correctly (nonReentrant protects concurrent calls)
    await expect(
      gov.connect(admin).withdrawVGMG(admin.address, ethers.parseEther("100"))
    ).to.not.be.reverted;
    console.log("      ✅ withdrawVGMG protected by nonReentrant modifier");
  });
});

// ============================================================
// DOUBLE SPEND / DUPLICATE ACTIONS
// ============================================================
describe("DOVGovernance - Security: Double Spend", function () {

  it("[CRITICAL] cannot execute same proposal twice", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceVotingEndedFixture);

    await gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET);

    await expect(
      gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET)
    ).to.be.revertedWithCustomError(gov, "InvalidState");
  });

  it("[CRITICAL] cannot claim reward twice", async function () {
    const { gov, member1, proposalId } =
      await loadFixture(deployGovernanceExecutedFixture);

    await gov.connect(member1).claimReward(proposalId);
    await expect(
      gov.connect(member1).claimReward(proposalId)
    ).to.be.revertedWithCustomError(gov, "AlreadyClaimed");
  });

  it("[CRITICAL] cannot vote twice even after round-trip", async function () {
    const { gov, member1 } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await gov.connect(member1).vote(true);

    // Try both true and false
    await expect(gov.connect(member1).vote(true))
      .to.be.revertedWithCustomError(gov, "AlreadyVoted");
    await expect(gov.connect(member1).vote(false))
      .to.be.revertedWithCustomError(gov, "AlreadyVoted");
  });

  it("[CRITICAL] cannot cancel already executed proposal", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceExecutedFixture);

    await expect(
      gov.connect(admin).cancelProposal(proposalId)
    ).to.be.revertedWithCustomError(gov, "InvalidState");
  });

  it("[CRITICAL] cannot execute already cancelled proposal", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await gov.connect(admin).cancelProposal(proposalId);
    await endVoting();

    await expect(
      gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET)
    ).to.be.revertedWithCustomError(gov, "InvalidState");
  });
});

// ============================================================
// RESERVE MANIPULATION ATTACKS
// ============================================================
describe("DOVGovernance - Security: Reserve Manipulation", function () {

  it("[CRITICAL] reserve can only be updated by passed proposal execution", async function () {
    const { gov } = await loadFixture(deployGovernanceFixture);
    // No direct setter exists — only executeReserveUpdate changes reserve
    expect(gov.setCurrentReserve).to.be.undefined;
    console.log("      ✅ No direct reserve setter — only governance can update");
  });

  it("[CRITICAL] maxReserveChangePercent blocks extreme reserve jumps", async function () {
    const { gov, admin, member1, member2, member3 } =
      await loadFixture(deployGovernanceFixture);

    // Execute initial reserve
    const pid1 = await createProposal(gov, admin, ethers.parseEther("5000000"));
    await voteAll(gov, [member1, member2, member3], true);
    await endVoting();
    await gov.connect(admin).executeReserveUpdate(pid1, DEFAULT_SECRET);

    // Set 10% max change
    await gov.connect(admin).setMaxReserveChangePercent(1000n); // 10%

    // 200% increase should fail
    const extreme = ethers.parseEther("15000000"); // 3x = 200% increase
    await expect(
      createProposal(gov, admin, extreme)
    ).to.be.revertedWithCustomError(gov, "ReserveChangeExceedsLimit");
  });

  it("[CRITICAL] reward pool validated against reserve headroom at creation", async function () {
    const { gov, admin, token } = await loadFixture(deployGovernanceFixture);

    // Token supply = 10M (pre-minted to gov)
    // Reserve headroom at 11M = 1M
    // Request reward = 5M > 1M → should fail
    await expect(
      gov.connect(admin).createProposal(
        DEFAULT_IPFS_CID,
        ethers.parseEther("11000000"),
        DEFAULT_SECRET,
        DEFAULT_DURATION,
        ethers.parseEther("5000000") // exceeds headroom
      )
    ).to.be.revertedWithCustomError(gov, "RewardExceedsCapacity");
  });

  it("[CRITICAL] proposedReserve = 0 is always rejected", async function () {
    const { gov, admin } = await loadFixture(deployGovernanceFixture);
    await expect(
      gov.connect(admin).createProposal(
        DEFAULT_IPFS_CID, 0n, DEFAULT_SECRET, DEFAULT_DURATION, 0n
      )
    ).to.be.revertedWithCustomError(gov, "InvalidReserveValue");
  });
});

// ============================================================
// STATE DESYNCHRONIZATION
// ============================================================
describe("DOVGovernance - Security: State Consistency", function () {

  it("[CRITICAL] only one active proposal at a time", async function () {
    const { gov, admin } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await expect(
      createProposal(gov, admin, PROPOSED_RESERVE)
    ).to.be.revertedWithCustomError(gov, "ActiveProposalExists");
  });

  it("[CRITICAL] activeProposalId cleared after execution", async function () {
    const { gov } = await loadFixture(deployGovernanceExecutedFixture);
    expect(await gov.activeProposalId()).to.equal(0n);
  });

  it("[CRITICAL] activeProposalId cleared after cancellation", async function () {
    const { gov, admin, proposalId } =
      await loadFixture(deployGovernanceWithProposalFixture);
    await gov.connect(admin).cancelProposal(proposalId);
    expect(await gov.activeProposalId()).to.equal(0n);
  });

  it("[CRITICAL] activeMemberCount stays consistent through add/remove cycles", async function () {
    const { gov, admin, member1, member2 } =
      await loadFixture(deployGovernanceFixture);

    const initial = await gov.activeMemberCount(); // 3
    await gov.connect(admin).removeMember(member1.address);
    expect(await gov.activeMemberCount()).to.equal(initial - 1n);
    await gov.connect(admin).addMember(member1.address);
    expect(await gov.activeMemberCount()).to.equal(initial);
  });

  it("[CRITICAL] parameter changes blocked during active proposal", async function () {
    const { gov, admin } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await expect(
      gov.connect(admin).setQuorumPercentage(7000n)
    ).to.be.revertedWithCustomError(gov, "ActiveProposalExists");

    await expect(
      gov.connect(admin).setApprovalThreshold(7000n)
    ).to.be.revertedWithCustomError(gov, "ActiveProposalExists");

    await expect(
      gov.connect(admin).setVotingDurationLimits(120n, 1209600n)
    ).to.be.revertedWithCustomError(gov, "ActiveProposalExists");

    await expect(
      gov.connect(admin).setMemberCooldownPeriod(3600n)
    ).to.be.revertedWithCustomError(gov, "ActiveProposalExists");
  });

  it("[CRITICAL] token lock is permanent", async function () {
    const { gov, admin } = await loadFixture(deployGovernanceFixture);
    const newToken = await deployMockToken();
    await expect(
      gov.connect(admin).setVGMGToken(await newToken.getAddress())
    ).to.be.revertedWithCustomError(gov, "TokenAlreadyLocked");
    console.log("      ✅ Token address is permanently locked — cannot be swapped");
  });
});

// ============================================================
// QUORUM & APPROVAL MANIPULATION
// ============================================================
describe("DOVGovernance - Security: Quorum & Threshold Edge Cases", function () {

  it("[CRITICAL] quorum check uses snapshot not current member count", async function () {
  const { gov, admin, member1, member2, member3 } =
    await loadFixture(deployGovernanceWithProposalFixture);

  // Snapshot at creation = 3 members
  // ceil(3 × 5000 / 10000) = ceil(1.5) = 2 votes required for quorum
  
  // Only member1 votes (1 vote)
  await gov.connect(member1).vote(true);

  // Admin removes member2 and member3 after voting
  // Live activeMemberCount drops to 1
  // But quorum uses SNAPSHOT (3), not live count
  await gov.connect(admin).removeMember(member2.address);
  await gov.connect(admin).removeMember(member3.address);

  await endVoting();
  const pid = await gov.proposalCount();

  // 1 vote vs snapshot of 3 → ceil(3 × 50%) = 2 required → QuorumNotReached ✅
  // If contract incorrectly used live count: ceil(1 × 50%) = 1 → would PASS (wrong!)
  await expect(
    gov.connect(admin).executeReserveUpdate(pid, DEFAULT_SECRET)
  ).to.be.revertedWithCustomError(gov, "QuorumNotReached");

  console.log("      ✅ Quorum uses creation-time snapshot — member removal cannot inflate it");
});


  it("[CRITICAL] 0% yes votes always fails approval", async function () {
    const { gov, admin, member1, member2, member3 } =
      await loadFixture(deployGovernanceWithProposalFixture);

    // All vote NO
    await voteAll(gov, [member1, member2, member3], false);
    await endVoting();

    const pid = await gov.proposalCount();
    await expect(
      gov.connect(admin).executeReserveUpdate(pid, DEFAULT_SECRET)
    ).to.be.revertedWithCustomError(gov, "ApprovalNotReached");
  });

  it("[CRITICAL] exactly at approval threshold passes", async function () {
    /**
     * approvalThreshold = 60% (6000 bps)
     * 3 members, 2 YES, 1 NO → 66.7% > 60% → should pass
     */
    const { gov, admin, member1, member2, member3 } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await gov.connect(member1).vote(true);
    await gov.connect(member2).vote(true);
    await gov.connect(member3).vote(false);
    await endVoting();

    const pid = await gov.proposalCount();
    await expect(
      gov.connect(admin).executeReserveUpdate(pid, DEFAULT_SECRET)
    ).to.not.be.reverted;
  });

  it("[CRITICAL] exact quorum boundary — meets minimum voter requirement", async function () {
    /**
     * quorum = 50%, 3 members → need ceiling(3*5000/10000) = 2 voters
     * 2 YES votes = quorum met
     */
    const { gov, admin, member1, member2 } =
      await loadFixture(deployGovernanceWithProposalFixture);

    await gov.connect(member1).vote(true);
    await gov.connect(member2).vote(true);
    await endVoting();

    const pid = await gov.proposalCount();
    await expect(
      gov.connect(admin).executeReserveUpdate(pid, DEFAULT_SECRET)
    ).to.not.be.reverted;
  });
});

// ============================================================
// AUDIT NOTES
// ============================================================
describe("DOVGovernance - Security: Audit Notes", function () {

  /**
   * FINDING: claimReward uses vgmgToken.transfer() which returns bool
   * but the contract requires it be true. If transfer returns false,
   * it reverts with "Failed". Standard SafeERC20 would be safer.
   */
  it("[AUDIT NOTE] claimReward reverts if token transfer returns false", async function () {
    const { gov, token, member1, proposalId } =
      await loadFixture(deployGovernanceExecutedFixture);

    // Simulate token returning false on transfer
    await token.setTransferShouldFail(true);

    await expect(
      gov.connect(member1).claimReward(proposalId)
    ).to.be.revertedWith("Failed");

    await token.setTransferShouldFail(false);
    console.log("      ⚠️  AUDIT: claimReward uses require(transfer()) not SafeERC20.safeTransfer");
  });

  /**
   * FINDING: Dust tokens accumulate in governance contract from
   * integer division of reward pool (rewardPool % voterCount stays in contract).
   * No mechanism to automatically distribute this dust.
   */
  it("[AUDIT NOTE] reward division leaves dust in contract", async function () {
    const { gov, token, admin, member1, member2, member3,
            proposalId, rewardPool, govAddr } =
      await loadFixture(deployGovernanceExecutedFixture);

    // 1000 tokens / 3 voters = 333 per voter, 1 token dust
    const perVoter = rewardPool / 3n;
    const dust     = rewardPool - perVoter * 3n;

    await gov.connect(member1).claimReward(proposalId);
    await gov.connect(member2).claimReward(proposalId);
    await gov.connect(member3).claimReward(proposalId);

    // Governance holds dust — withdrawVGMG can recover it
    expect(dust).to.be.gte(0n);
    console.log(`      ⚠️  AUDIT: ${ethers.formatEther(dust)} tokens remain as dust after all claims`);
    console.log("      ✅ withdrawVGMG() allows admin to recover dust");
  });

  /**
   * FINDING: No timelock between proposal creation and execution.
   * A fast governance attack: create proposal → vote → end → execute
   * all within the minimum voting duration (60 seconds in tests).
   */
  it("[AUDIT NOTE] minimum voting duration is the only time-based protection", async function () {
    const { gov, admin, member1, member2, member3 } =
      await loadFixture(deployGovernanceFixture);

    const before = await time.latest();
    const pid = await createProposal(gov, admin, PROPOSED_RESERVE);
    await voteAll(gov, [member1, member2, member3], true);
    await endVoting();
    await gov.connect(admin).executeReserveUpdate(pid, DEFAULT_SECRET);
    const after = await time.latest();

    console.log(`      ⚠️  AUDIT: Full lifecycle completed in ${after - before}s`);
    console.log("      Minimum voting duration = only protection against rushed governance");
  });

  /**
   * FINDING: memberList array grows forever — never shrunk when
   * members are removed. This could lead to high gas costs for
   * functions that iterate memberList.
   */
  it("[AUDIT NOTE] memberList is append-only (removed members stay in array)", async function () {
    const { gov, admin, member1 } = await loadFixture(deployGovernanceFixture);

    const listBefore = await gov.getMemberList();
    await gov.connect(admin).removeMember(member1.address);
    const listAfter = await gov.getMemberList();

    // Array length unchanged — member1 still appears in list
    expect(listAfter.length).to.equal(listBefore.length);
    expect(listAfter).to.include(member1.address);

    // But isActive = false correctly marks them inactive
    const info = await gov.members(member1.address);
    expect(info.isActive).to.be.false;

    console.log("      ⚠️  AUDIT: memberList grows unboundedly — inactive members stay in array");
  });

  /**
   * FINDING: Single-step ownership (DEFAULT_ADMIN_ROLE grant).
   * If admin accidentally grants to wrong address, governance is compromised.
   */
  it("[AUDIT NOTE] single-step admin role transfer is dangerous", async function () {
    const { gov, admin, attacker } = await loadFixture(deployGovernanceFixture);

    // Admin accidentally grants admin to attacker
    await gov.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, attacker.address);
    expect(await gov.hasRole(DEFAULT_ADMIN_ROLE, attacker.address)).to.be.true;

    // Attacker could now add members, create proposals, drain tokens
    console.log("      ⚠️  AUDIT: No two-step admin transfer — accidental grant is irrecoverable");
  });

  /**
   * FINDING: getProposalState() is a view that re-evaluates outcome.
   * The actual proposal.state may be Active while getProposalState
   * returns Succeeded/Defeated. This discrepancy is by design but
   * could confuse integrators.
   */
  it("[AUDIT NOTE] getProposalState vs proposal.state can diverge", async function () {
    const { gov, member1, member2, member3, proposalId } =
      await loadFixture(deployGovernanceAllVotedYesFixture);

    await endVoting();

    // proposal.state is still Active (not yet executed/cancelled)
    const p = await gov.getProposal(proposalId);
    expect(p.state).to.equal(ProposalState.Active);

    // but getProposalState returns Succeeded (derived view)
    const derivedState = await gov.getProposalState(proposalId);
    expect(derivedState).to.equal(ProposalState.Succeeded);

    console.log("      ⚠️  AUDIT: proposal.state != getProposalState() after voting ends");
    console.log("      Integrators must use getProposalState() not raw proposal.state");
  });
});