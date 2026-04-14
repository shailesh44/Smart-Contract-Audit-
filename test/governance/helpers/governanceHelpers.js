const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");

// ============================================================
// CONSTANTS — mirror contract values
// ============================================================
const BASIS_POINTS = 10_000n;

// Default governance parameters
const DEFAULT_QUORUM       = 5000n;  // 50%
const DEFAULT_APPROVAL     = 6000n;  // 60%
const DEFAULT_MIN_DURATION = 60n;    // 1 minute  (short for tests)
const DEFAULT_MAX_DURATION = 604800n; // 7 days
const DEFAULT_COOLDOWN     = 0n;     // No cooldown (simplifies tests)

// Proposal defaults
const DEFAULT_IPFS_CID      = "QmTestHash123";
const DEFAULT_SECRET        = "mysecretword";
const DEFAULT_SECRET_HASH   = ethers.keccak256(
  ethers.toUtf8Bytes("mysecretword")
);
const DEFAULT_DURATION      = 300n;   // 5 minutes
const DEFAULT_REWARD_POOL   = ethers.parseEther("1000");

// Reserve values
const INITIAL_RESERVE   = ethers.parseEther("1000000");  // 1M
const PROPOSED_RESERVE  = ethers.parseEther("2000000");  // 2M
const MAX_TOKEN_SUPPLY  = ethers.parseEther("10000000000"); // 10B

// ProposalState enum — mirrors contract
const ProposalState = {
  None:      0,
  Active:    1,
  Succeeded: 2,
  Defeated:  3,
  Executed:  4,
  Cancelled: 5,
};

// ============================================================
// DEPLOY HELPERS
// ============================================================

async function deployMockToken(maxSupply = MAX_TOKEN_SUPPLY) {
  const Token = await ethers.getContractFactory("MockVGMGToken");
  const token = await Token.deploy(maxSupply);
  await token.waitForDeployment();
  return token;
}

async function deployBrokenMinter() {
  const Token = await ethers.getContractFactory("MockMinterBroken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  return token;
}

/**
 * @notice Deploy DOVGovernance with default test parameters
 */
async function deployGovernance(
  admin,
  quorum      = DEFAULT_QUORUM,
  approval    = DEFAULT_APPROVAL,
  minDuration = DEFAULT_MIN_DURATION,
  maxDuration = DEFAULT_MAX_DURATION,
  cooldown    = DEFAULT_COOLDOWN
) {
  const Governance = await ethers.getContractFactory("DOVGovernance");
  const gov = await Governance.deploy(
    admin.address,
    quorum,
    approval,
    minDuration,
    maxDuration,
    cooldown
  );
  await gov.waitForDeployment();
  return gov;
}

// ============================================================
// FIXTURES
// ============================================================

/**
 * @notice Base fixture — governance deployed with token set and locked
 *         3 active DAO members added
 */
async function deployGovernanceFixture() {
  const [admin, member1, member2, member3, nonMember, attacker, executor] =
    await ethers.getSigners();

  const token = await deployMockToken();
  const gov   = await deployGovernance(admin);
  const govAddr = await gov.getAddress();

  // Set and lock token
  await gov.connect(admin).setVGMGToken(await token.getAddress());
  await gov.connect(admin).lockVGMGToken();

  // Add 3 members (cooldown = 0, so they can vote immediately)
  await gov.connect(admin).addMember(member1.address);
  await gov.connect(admin).addMember(member2.address);
  await gov.connect(admin).addMember(member3.address);

  // Mint tokens to governance contract for reward distribution tests
  await token.mintTo(govAddr, ethers.parseEther("10000000")); // 10M pre-minted

  return {
    gov,
    token,
    admin,
    member1,
    member2,
    member3,
    nonMember,
    attacker,
    executor,
    govAddr,
    DEFAULT_IPFS_CID,
    DEFAULT_SECRET,
    DEFAULT_DURATION,
    DEFAULT_REWARD_POOL,
    INITIAL_RESERVE,
    PROPOSED_RESERVE,
  };
}

/**
 * @notice Fixture with an active proposal already created
 */
async function deployGovernanceWithProposalFixture() {
  const base = await deployGovernanceFixture();
  const { gov, admin, token } = base;

  // Create a proposal
  // proposedReserve must be large enough for reward pool
  // supply=10M (pre-minted to gov) so proposedReserve must be > 10M + rewardPool
  const proposedReserve = ethers.parseEther("20000000"); // 20M
  const rewardPool      = ethers.parseEther("1000");

  await gov.connect(admin).createProposal(
    DEFAULT_IPFS_CID,
    proposedReserve,
    DEFAULT_SECRET,
    DEFAULT_DURATION,
    rewardPool
  );

  const proposalId = await gov.proposalCount();

  return {
    ...base,
    proposalId,
    proposedReserve,
    rewardPool,
  };
}

/**
 * @notice Fixture where all 3 members have voted YES (quorum + approval met)
 */
async function deployGovernanceAllVotedYesFixture() {
  const base = await deployGovernanceWithProposalFixture();
  const { gov, member1, member2, member3 } = base;

  await gov.connect(member1).vote(true);
  await gov.connect(member2).vote(true);
  await gov.connect(member3).vote(true);

  return base;
}

/**
 * @notice Fixture where voting has ended with YES majority
 */
async function deployGovernanceVotingEndedFixture() {
  const base = await deployGovernanceAllVotedYesFixture();
  // Advance past voting window
  await time.increase(Number(DEFAULT_DURATION) + 1);
  return base;
}

/**
 * @notice Fixture with executed proposal (reserve updated)
 */
async function deployGovernanceExecutedFixture() {
  const base = await deployGovernanceVotingEndedFixture();
  const { gov, admin, proposalId } = base;

  await gov.connect(admin).executeReserveUpdate(proposalId, DEFAULT_SECRET);
  return base;
}

/**
 * @notice Fixture with governance paused
 */
async function deployGovernancePausedFixture() {
  const base = await deployGovernanceFixture();
  await base.gov.connect(base.admin).pause();
  return base;
}

/**
 * @notice Fixture with no token set (pre-setVGMGToken state)
 */
async function deployGovernanceNoTokenFixture() {
  const [admin, member1, member2, member3, nonMember, attacker] =
    await ethers.getSigners();

  const gov = await deployGovernance(admin);

  await gov.connect(admin).addMember(member1.address);
  await gov.connect(admin).addMember(member2.address);
  await gov.connect(admin).addMember(member3.address);

  return { gov, admin, member1, member2, member3, nonMember, attacker };
}

// ============================================================
// UTILITY HELPERS
// ============================================================

/**
 * @notice Create a proposal and return its ID
 */
async function createProposal(
  gov,
  admin,
  proposedReserve = PROPOSED_RESERVE,
  rewardPool      = 0n,
  secret          = DEFAULT_SECRET,
  duration        = DEFAULT_DURATION,
  ipfsCid         = DEFAULT_IPFS_CID
) {
  await gov.connect(admin).createProposal(
    ipfsCid,
    proposedReserve,
    secret,
    duration,
    rewardPool
  );
  return await gov.proposalCount();
}

/**
 * @notice Have all listed members vote with given support
 */
async function voteAll(gov, members, support = true) {
  for (const m of members) {
    await gov.connect(m).vote(support);
  }
}

/**
 * @notice Advance time past voting window
 */
async function endVoting(duration = DEFAULT_DURATION) {
  await time.increase(Number(duration) + 2);
}

/**
 * @notice Full lifecycle: create → vote → end → execute
 */
async function fullProposalLifecycle(
  gov,
  admin,
  members,
  proposedReserve,
  secret   = DEFAULT_SECRET,
  rewardPool = 0n
) {
  const pid = await createProposal(
    gov, admin, proposedReserve, rewardPool, secret
  );
  await voteAll(gov, members, true);
  await endVoting();
  await gov.connect(admin).executeReserveUpdate(pid, secret);
  return pid;
}

module.exports = {
  // Constants
  BASIS_POINTS,
  DEFAULT_QUORUM,
  DEFAULT_APPROVAL,
  DEFAULT_MIN_DURATION,
  DEFAULT_MAX_DURATION,
  DEFAULT_COOLDOWN,
  DEFAULT_IPFS_CID,
  DEFAULT_SECRET,
  DEFAULT_SECRET_HASH,
  DEFAULT_DURATION,
  DEFAULT_REWARD_POOL,
  INITIAL_RESERVE,
  PROPOSED_RESERVE,
  MAX_TOKEN_SUPPLY,
  ProposalState,

  // Deploy
  deployMockToken,
  deployBrokenMinter,
  deployGovernance,

  // Fixtures
  deployGovernanceFixture,
  deployGovernanceWithProposalFixture,
  deployGovernanceAllVotedYesFixture,
  deployGovernanceVotingEndedFixture,
  deployGovernanceExecutedFixture,
  deployGovernancePausedFixture,
  deployGovernanceNoTokenFixture,

  // Utilities
  createProposal,
  voteAll,
  endVoting,
  fullProposalLifecycle,
  time,
};