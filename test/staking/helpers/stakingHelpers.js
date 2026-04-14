const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");

// ============================================================
// TIER CONSTANTS — mirrors contract values exactly
// ============================================================
const Tier = {
  BRONZE:   0,
  SILVER:   1,
  GOLD:     2,
  PLATINUM: 3,
};

// Lock durations (seconds)
const BRONZE_DURATION   = 180 * 24 * 60 * 60;
const SILVER_DURATION   = 365 * 24 * 60 * 60;
const GOLD_DURATION     = 540 * 24 * 60 * 60;
const PLATINUM_DURATION = 730 * 24 * 60 * 60;

// Minimum stake amounts
const BRONZE_MIN_STAKE   = ethers.parseEther("1000");
const SILVER_MIN_STAKE   = ethers.parseEther("5000");
const GOLD_MIN_STAKE     = ethers.parseEther("15000");
const PLATINUM_MIN_STAKE = ethers.parseEther("50000");

// Reward rates in basis points
const BRONZE_RATE   = 500;
const SILVER_RATE   = 1000;
const GOLD_RATE     = 1500;
const PLATINUM_RATE = 2300;

const BASIS_POINTS        = 10_000n;
const MAX_REWARD_RATE     = 10_000n;
const MAX_STAKES_PER_USER = 100;

// ── IMPORTANT: reward pool seed uses OWNER's tokens ──────────
// Owner gets a SEPARATE larger mint so pool deposit doesn't
// drain tokens needed for staking tests
const REWARD_POOL_SEED    = ethers.parseEther("1000000");  // 1M for pool
const OWNER_EXTRA_MINT    = ethers.parseEther("2000000");  // 2M extra for owner
const USER_FUND           = ethers.parseEther("500000");   // 500K per user

// ============================================================
// CALCULATION HELPERS
// ============================================================

function calculateRewardPerCycle(amount, rewardRate) {
  return (amount * BigInt(rewardRate)) / BASIS_POINTS;
}

function calculateClaimableReward(
  lastClaimTime,
  currentTime,
  lockDuration,
  rewardPerCycle
) {
  if (currentTime <= lastClaimTime) return { cycles: 0n, reward: 0n };
  const timeElapsed = currentTime - lastClaimTime;
  const cycles      = timeElapsed / lockDuration;
  const reward      = cycles * rewardPerCycle;
  return { cycles, reward };
}

function rewardForCycles(amount, rewardRate, cycles) {
  const perCycle = calculateRewardPerCycle(amount, rewardRate);
  return perCycle * BigInt(cycles);
}

// ============================================================
// MOCK DEPLOYMENT HELPERS
// ============================================================

async function deployMockStakingToken() {
  const Token = await ethers.getContractFactory("MockStakingToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  return token;
}

async function deployMockFeeToken() {
  const Token = await ethers.getContractFactory("MockFeeOnTransferToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  return token;
}

async function deployMockRecoverableToken() {
  const Token = await ethers.getContractFactory("MockRecoverableToken");
  const token = await Token.deploy();
  await token.waitForDeployment();
  return token;
}

async function deployMaliciousStaker(stakingAddr, tokenAddr) {
  const Malicious = await ethers.getContractFactory("MaliciousReentrantStaker");
  const malicious = await Malicious.deploy(stakingAddr, tokenAddr);
  await malicious.waitForDeployment();
  return malicious;
}

// ============================================================
// CORE FIXTURE
// ============================================================

/**
 * @notice Base fixture
 *
 * Token distribution:
 *   owner   → OWNER_EXTRA_MINT (2M) for reward pool + any owner staking
 *   user    → USER_FUND (500K)  for staking tests
 *   alice   → USER_FUND (500K)
 *   bob     → USER_FUND (500K)
 *   attacker→ USER_FUND (500K)  enough to attempt attacks
 *
 * Reward pool seeded from owner's balance (1M tokens).
 * Owner still has 1M left for further deposits if needed.
 */
async function deployStakingFixture() {
  const [owner, user, alice, bob, attacker] = await ethers.getSigners();

  // ── 1. Deploy token ───────────────────────────────────────
  const token = await deployMockStakingToken();

  // ── 2. Deploy staking contract ────────────────────────────
  const Staking = await ethers.getContractFactory("TokenStaking");
  const staking = await Staking.deploy(
    await token.getAddress(),
    owner.address
  );
  await staking.waitForDeployment();
  const stakingAddr = await staking.getAddress();

  // ── 3. Mint tokens ────────────────────────────────────────
  // Owner gets extra to cover reward pool deposit
  await token.mint(owner.address,    OWNER_EXTRA_MINT);  // 2M

  // Regular users get USER_FUND each
  for (const signer of [user, alice, bob, attacker]) {
    await token.mint(signer.address, USER_FUND);          // 500K each
  }

  // ── 4. Approve staking contract for all signers ───────────
  for (const signer of [owner, user, alice, bob, attacker]) {
    await token.connect(signer).approve(stakingAddr, ethers.MaxUint256);
  }

  // ── 5. Seed reward pool from owner's tokens ───────────────
  // Owner has 2M; deposit 1M → owner keeps 1M for other tests
  await staking.connect(owner).depositRewardPool(REWARD_POOL_SEED);

  // ── 6. Verify balances are sane ───────────────────────────
  const ownerBal = await token.balanceOf(owner.address);
  // owner should have 2M - 1M (pool) = 1M remaining
  if (ownerBal < ethers.parseEther("500000")) {
    throw new Error(
      `Fixture setup error: owner balance too low: ${ethers.formatEther(ownerBal)}`
    );
  }

  return {
    staking,
    token,
    owner,
    user,
    alice,
    bob,
    attacker,
    stakingAddr,
    REWARD_POOL_SEED,
  };
}

// ============================================================
// DERIVED FIXTURES
// ============================================================

/**
 * @notice Fixture with user already staked in BRONZE tier
 */
async function deployStakingWithBronzeStakeFixture() {
  const base = await deployStakingFixture();
  const { staking, user } = base;

  const stakeId = await stakeAndGetId(
    staking, user, BRONZE_MIN_STAKE, Tier.BRONZE
  );

  return { ...base, stakeId, stakedAmount: BRONZE_MIN_STAKE };
}

/**
 * @notice Fixture where exactly 1 BRONZE lock cycle has elapsed
 */
async function deployStakingAfterLockFixture() {
  const base = await deployStakingWithBronzeStakeFixture();
  await time.increase(BRONZE_DURATION);
  return base;
}

/**
 * @notice Fixture where entire contract is paused
 */
async function deployStakingPausedFixture() {
  const base = await deployStakingFixture();
  await base.staking.connect(base.owner).pause();
  return base;
}

/**
 * @notice Fixture with user staked in PLATINUM tier
 */
async function deployStakingWithPlatinumStakeFixture() {
  const base = await deployStakingFixture();
  const { staking, user } = base;

  const stakeId = await stakeAndGetId(
    staking, user, PLATINUM_MIN_STAKE, Tier.PLATINUM
  );

  return { ...base, stakeId, stakedAmount: PLATINUM_MIN_STAKE };
}

/**
 * @notice Fixture with empty reward pool (for insolvency tests)
 */
async function deployStakingEmptyPoolFixture() {
  const base = await deployStakingWithBronzeStakeFixture();
  const { staking, owner } = base;

  const pool = await staking.rewardPool();
  await staking.connect(owner).withdrawRewardPool(pool);

  return base;
}

// ============================================================
// UTILITY
// ============================================================

/**
 * @notice Stake tokens and return the generated stakeId
 */
async function stakeAndGetId(staking, signer, amount, tier) {
  const tx      = await staking.connect(signer).stake(amount, tier);
  const receipt = await tx.wait();

  const stakedEvent = receipt.logs
    .map(log => {
      try   { return staking.interface.parseLog(log); }
      catch { return null; }
    })
    .find(e => e && e.name === "Staked");

  if (!stakedEvent) throw new Error("Staked event not found in receipt");
  return stakedEvent.args.stakeId;
}

/**
 * @notice Verify a user's token balance changed by expected amount
 */
async function expectBalanceChange(token, address, fn, expectedDelta) {
  const before = await token.balanceOf(address);
  await fn();
  const after  = await token.balanceOf(address);
  const delta  = after - before;
  return delta;
}

module.exports = {
  // Enums
  Tier,

  // Durations
  BRONZE_DURATION,
  SILVER_DURATION,
  GOLD_DURATION,
  PLATINUM_DURATION,

  // Min stakes
  BRONZE_MIN_STAKE,
  SILVER_MIN_STAKE,
  GOLD_MIN_STAKE,
  PLATINUM_MIN_STAKE,

  // Rates
  BRONZE_RATE,
  SILVER_RATE,
  GOLD_RATE,
  PLATINUM_RATE,

  // Constants
  BASIS_POINTS,
  MAX_REWARD_RATE,
  MAX_STAKES_PER_USER,
  REWARD_POOL_SEED,
  USER_FUND,
  OWNER_EXTRA_MINT,

  // Math helpers
  calculateRewardPerCycle,
  calculateClaimableReward,
  rewardForCycles,

  // Deploy helpers
  deployMockStakingToken,
  deployMockFeeToken,
  deployMockRecoverableToken,
  deployMaliciousStaker,

  // Fixtures
  deployStakingFixture,
  deployStakingWithBronzeStakeFixture,
  deployStakingAfterLockFixture,
  deployStakingPausedFixture,
  deployStakingWithPlatinumStakeFixture,
  deployStakingEmptyPoolFixture,

  // Utilities
  stakeAndGetId,
  expectBalanceChange,
  time,
};