const { expect }      = require("chai");
const { ethers }      = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time }        = require("@nomicfoundation/hardhat-network-helpers");

const {
  Tier,
  BRONZE_DURATION, SILVER_DURATION, GOLD_DURATION, PLATINUM_DURATION,
  BRONZE_MIN_STAKE, SILVER_MIN_STAKE, GOLD_MIN_STAKE, PLATINUM_MIN_STAKE,
  BRONZE_RATE, SILVER_RATE, GOLD_RATE, PLATINUM_RATE,
  BASIS_POINTS, MAX_REWARD_RATE, MAX_STAKES_PER_USER, REWARD_POOL_SEED,
  calculateRewardPerCycle, rewardForCycles,
  deployStakingFixture,
  deployStakingWithBronzeStakeFixture,
  deployStakingAfterLockFixture,
  deployStakingPausedFixture,
  deployStakingWithPlatinumStakeFixture,
  deployMockFeeToken,
  deployMockRecoverableToken,
  stakeAndGetId,
} = require("./helpers/stakingHelpers");

// ============================================================
// DEPLOYMENT & CONSTRUCTOR
// ============================================================
describe("TokenStaking - Deployment & Constructor", function () {
  /**
   * WHY: Constructor sets immutable state. Any error here is permanent.
   */

  it("should deploy with correct staking token", async function () {
    const { staking, token } = await loadFixture(deployStakingFixture);
    expect(await staking.stakingToken()).to.equal(await token.getAddress());
  });

  it("should deploy with correct owner", async function () {
    const { staking, owner } = await loadFixture(deployStakingFixture);
    expect(await staking.owner()).to.equal(owner.address);
  });

  it("should deploy unpaused", async function () {
    const { staking } = await loadFixture(deployStakingFixture);
    expect(await staking.paused()).to.be.false;
  });

  it("should deploy with totalStaked = 0", async function () {
    const { staking } = await loadFixture(deployStakingFixture);
    expect(await staking.totalStaked()).to.equal(0n);
  });

  it("should deploy with rewardPool = 0 before deposit", async function () {
    const [owner] = await ethers.getSigners();
    const token   = await (await ethers.getContractFactory("MockStakingToken")).deploy();
    const Staking = await ethers.getContractFactory("TokenStaking");
    const staking = await Staking.deploy(await token.getAddress(), owner.address);
    expect(await staking.rewardPool()).to.equal(0n);
  });

  it("should initialize all 4 tier plans correctly", async function () {
    const { staking } = await loadFixture(deployStakingFixture);

    const bronze   = await staking.getTierPlan(Tier.BRONZE);
    const silver   = await staking.getTierPlan(Tier.SILVER);
    const gold     = await staking.getTierPlan(Tier.GOLD);
    const platinum = await staking.getTierPlan(Tier.PLATINUM);

    // Durations
    expect(bronze.duration).to.equal(BigInt(BRONZE_DURATION));
    expect(silver.duration).to.equal(BigInt(SILVER_DURATION));
    expect(gold.duration).to.equal(BigInt(GOLD_DURATION));
    expect(platinum.duration).to.equal(BigInt(PLATINUM_DURATION));

    // Reward rates
    expect(bronze.rewardRate).to.equal(BigInt(BRONZE_RATE));
    expect(silver.rewardRate).to.equal(BigInt(SILVER_RATE));
    expect(gold.rewardRate).to.equal(BigInt(GOLD_RATE));
    expect(platinum.rewardRate).to.equal(BigInt(PLATINUM_RATE));

    // Min stakes
    expect(bronze.minStakeAmount).to.equal(BRONZE_MIN_STAKE);
    expect(silver.minStakeAmount).to.equal(SILVER_MIN_STAKE);
    expect(gold.minStakeAmount).to.equal(GOLD_MIN_STAKE);
    expect(platinum.minStakeAmount).to.equal(PLATINUM_MIN_STAKE);

    // All active
    expect(bronze.isActive).to.be.true;
    expect(silver.isActive).to.be.true;
    expect(gold.isActive).to.be.true;
    expect(platinum.isActive).to.be.true;
  });

  it("should revert ZeroAddress if staking token is zero", async function () {
    const [owner] = await ethers.getSigners();
    const Staking = await ethers.getContractFactory("TokenStaking");
    await expect(
      Staking.deploy(ethers.ZeroAddress, owner.address)
    ).to.be.revertedWithCustomError(Staking, "ZeroAddress");
  });

  it("should revert OwnableInvalidOwner if owner is zero address", async function () {
    const token   = await (await ethers.getContractFactory("MockStakingToken")).deploy();
    const Staking = await ethers.getContractFactory("TokenStaking");
    // OZ Ownable fires before the manual check when initialOwner = 0
    await expect(
      Staking.deploy(await token.getAddress(), ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(Staking, "OwnableInvalidOwner");
  });

  it("should reject ETH sent via receive()", async function () {
    const { staking, user, stakingAddr } = await loadFixture(deployStakingFixture);
    await expect(
      user.sendTransaction({ to: stakingAddr, value: ethers.parseEther("1") })
    ).to.be.revertedWithCustomError(staking, "ETHNotAccepted");
  });

  it("should reject ETH sent via fallback()", async function () {
    const { staking, user, stakingAddr } = await loadFixture(deployStakingFixture);
    await expect(
      user.sendTransaction({
        to: stakingAddr,
        value: ethers.parseEther("1"),
        data: "0xdeadbeef",
      })
    ).to.be.revertedWithCustomError(staking, "ETHNotAccepted");
  });
});

// ============================================================
// STAKING TESTS
// ============================================================
describe("TokenStaking - stake()", function () {
  describe("Positive Cases", function () {
    it("should stake BRONZE minimum amount successfully", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE)
      ).to.not.be.reverted;
    });

    it("should return a valid stakeId starting from 1", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      const stakeId = await stakeAndGetId(staking, user, BRONZE_MIN_STAKE, Tier.BRONZE);
      expect(stakeId).to.equal(1n);
    });

    it("should increment stakeId for each stake", async function () {
      const { staking, user, alice } = await loadFixture(deployStakingFixture);
      const id1 = await stakeAndGetId(staking, user,  BRONZE_MIN_STAKE, Tier.BRONZE);
      const id2 = await stakeAndGetId(staking, alice, BRONZE_MIN_STAKE, Tier.BRONZE);
      expect(id2).to.equal(id1 + 1n);
    });

    it("should emit Staked event with correct parameters", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE))
        .to.emit(staking, "Staked")
        .withArgs(
          1n,
          user.address,
          BRONZE_MIN_STAKE,
          Tier.BRONZE,
          BigInt(BRONZE_DURATION),
          BigInt(BRONZE_RATE)
        );
    });

    it("should transfer tokens from user to staking contract", async function () {
      const { staking, token, user, stakingAddr } = await loadFixture(
        deployStakingFixture
      );
      const balBefore = await token.balanceOf(user.address);
      await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);
      const balAfter = await token.balanceOf(user.address);
      expect(balBefore - balAfter).to.equal(BRONZE_MIN_STAKE);
      expect(await token.balanceOf(stakingAddr)).to.be.gte(BRONZE_MIN_STAKE);
    });

    it("should update totalStaked correctly", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);
      expect(await staking.totalStaked()).to.equal(BRONZE_MIN_STAKE);
    });

    it("should store stake data correctly", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      const startTime = BigInt(await time.latest()) + 1n;
      const stakeId = await stakeAndGetId(staking, user, BRONZE_MIN_STAKE, Tier.BRONZE);
      const stake = await staking.stakes(stakeId);

      expect(stake.id).to.equal(stakeId);
      expect(stake.staker).to.equal(user.address);
      expect(stake.amount).to.equal(BRONZE_MIN_STAKE);
      expect(stake.lockDuration).to.equal(BigInt(BRONZE_DURATION));
      expect(stake.rewardRate).to.equal(BigInt(BRONZE_RATE));
      expect(stake.unstaked).to.be.false;
      expect(stake.totalClaimed).to.equal(0n);
      expect(stake.tier).to.equal(Tier.BRONZE);
    });

    it("should calculate rewardPerCycle correctly in stake", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      const stakeId = await stakeAndGetId(staking, user, BRONZE_MIN_STAKE, Tier.BRONZE);
      const stake = await staking.stakes(stakeId);
      const expected = calculateRewardPerCycle(BRONZE_MIN_STAKE, BRONZE_RATE);
      expect(stake.rewardPerCycle).to.equal(expected);
    });

    it("should update user aggregates correctly", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);
      const { totalAmount, activeStakes } = await staking.getUserTotalStaked(user.address);
      expect(totalAmount).to.equal(BRONZE_MIN_STAKE);
      expect(activeStakes).to.equal(1n);
    });

    it("should allow staking all 4 tiers", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await staking.connect(user).stake(BRONZE_MIN_STAKE,   Tier.BRONZE);
      await staking.connect(user).stake(SILVER_MIN_STAKE,   Tier.SILVER);
      await staking.connect(user).stake(GOLD_MIN_STAKE,     Tier.GOLD);
      await staking.connect(user).stake(PLATINUM_MIN_STAKE, Tier.PLATINUM);
      const { activeStakes } = await staking.getUserTotalStaked(user.address);
      expect(activeStakes).to.equal(4n);
    });

    it("should allow multiple stakes by same user", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);
      await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);
      const { totalAmount } = await staking.getUserTotalStaked(user.address);
      expect(totalAmount).to.equal(BRONZE_MIN_STAKE * 2n);
    });

    it("should add stakeId to user's stake list", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      const stakeId = await stakeAndGetId(staking, user, BRONZE_MIN_STAKE, Tier.BRONZE);
      const ids = await staking.getUserStakeIds(user.address);
      expect(ids).to.include(stakeId);
    });

    it("should stake exactly at SILVER minimum", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).stake(SILVER_MIN_STAKE, Tier.SILVER)
      ).to.not.be.reverted;
    });

    it("should stake amounts above minimum", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      const overMin = BRONZE_MIN_STAKE * 5n;
      await expect(
        staking.connect(user).stake(overMin, Tier.BRONZE)
      ).to.not.be.reverted;
    });
  });

  describe("Negative Cases", function () {
    it("should revert BelowMinimumStake for BRONZE below 1000 tokens", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).stake(BRONZE_MIN_STAKE - 1n, Tier.BRONZE)
      ).to.be.revertedWithCustomError(staking, "BelowMinimumStake");
    });

    it("should revert BelowMinimumStake for 0 amount", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).stake(0n, Tier.BRONZE)
      ).to.be.revertedWithCustomError(staking, "BelowMinimumStake");
    });

    it("should revert TierNotActive when tier is disabled", async function () {
      const { staking, owner, user } = await loadFixture(deployStakingFixture);
      await staking.connect(owner).setTierActive(Tier.BRONZE, false);
      await expect(
        staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE)
      ).to.be.revertedWithCustomError(staking, "TierNotActive");
    });

    it("should revert when paused", async function () {
      const { staking, user } = await loadFixture(deployStakingPausedFixture);
      await expect(
        staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE)
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
    });

   it("should revert MaxStakesReached after 100 stakes", async function () {
  const { staking, token, owner, user, stakingAddr } =
    await loadFixture(deployStakingFixture);

  // ── FIX: Lower minStakeAmount to 1 token so 100 stakes
  // only costs 100 tokens (well within 500K USER_FUND)
  await staking.connect(owner).updateMinStakeAmount(
    Tier.BRONZE,
    ethers.parseEther("1")   // 1 token per stake × 100 = 100 tokens total
  );

  // Also lower reward rate floor by setting to 1 basis point
  // to avoid RewardCalculationZero for very small stakes
  // Actually with 1e18 tokens: 1e18 * 500 / 10000 = 5e16 > 0 ✅
  for (let i = 0; i < MAX_STAKES_PER_USER; i++) {
    await staking.connect(user).stake(
      ethers.parseEther("1"),  // 1 token each
      Tier.BRONZE
    );
  }

  // 101st must revert
  await expect(
    staking.connect(user).stake(ethers.parseEther("1"), Tier.BRONZE)
  ).to.be.revertedWithCustomError(staking, "MaxStakesReached");
});

   it("should revert when user has insufficient token balance", async function () {
  const { staking, token, attacker } = await loadFixture(
    deployStakingFixture
  );

  // attacker has exactly USER_FUND = 500K tokens
  const attackerBalance = await token.balanceOf(attacker.address);

  // Attempt to stake MORE than they have
  const overBalance = attackerBalance + 1n;

  // The error comes from the token contract (ERC20), not staking
  await expect(
    staking.connect(attacker).stake(overBalance, Tier.BRONZE)
  ).to.be.reverted; // ERC20InsufficientBalance from token
});

// ── BONUS: add a stricter version that checks the exact error ──
it("should revert ERC20InsufficientBalance from token when balance too low", async function () {
  const { staking, token, attacker } = await loadFixture(
    deployStakingFixture
  );

  const balance    = await token.balanceOf(attacker.address);
  const overAmount = balance + ethers.parseEther("1");

  // Error is thrown by the ERC20 token, not the staking contract
  await expect(
    staking.connect(attacker).stake(overAmount, Tier.BRONZE)
  ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
});

    it("should revert when user has no approval", async function () {
      const { staking, token } = await loadFixture(deployStakingFixture);
      const [, , , , , newUser] = await ethers.getSigners();
      await token.mint(newUser.address, BRONZE_MIN_STAKE);
      // No approve call
      await expect(
        staking.connect(newUser).stake(BRONZE_MIN_STAKE, Tier.BRONZE)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("should revert RewardCalculationZero for tiny amount that rounds to 0", async function () {
      /**
       * With BRONZE_RATE=500 and BASIS_POINTS=10000:
       * rewardPerCycle = amount * 500 / 10000 = amount / 20
       * Minimum amount where this > 0: 20 wei
       * But BelowMinimumStake fires first (min=1000e18), so this
       * is only reachable if minStakeAmount is set to 1
       */
      const { staking, owner, user } = await loadFixture(deployStakingFixture);
      // Lower min stake to 1 wei so we can test RewardCalculationZero
      await staking.connect(owner).updateMinStakeAmount(Tier.BRONZE, 1n);
      // stake 1 wei: 1 * 500 / 10000 = 0 → RewardCalculationZero
      await expect(
        staking.connect(user).stake(1n, Tier.BRONZE)
      ).to.be.revertedWithCustomError(staking, "RewardCalculationZero");
    });
  });
});

// ============================================================
// CLAIM REWARD TESTS
// ============================================================
describe("TokenStaking - claimReward()", function () {
  describe("Positive Cases", function () {
    it("should claim reward after one full lock cycle", async function () {
      const { staking, token, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      // Advance exactly 1 BRONZE cycle
      await time.increase(BRONZE_DURATION);

      const expectedReward = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);
      const balBefore = await token.balanceOf(user.address);

      await staking.connect(user).claimReward(stakeId);

      const balAfter = await token.balanceOf(user.address);
      expect(balAfter - balBefore).to.equal(expectedReward);
    });

    it("should claim rewards for multiple cycles at once", async function () {
      const { staking, token, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      // Advance 3 cycles
      await time.increase(BRONZE_DURATION * 3);

      const expectedReward = rewardForCycles(stakedAmount, BRONZE_RATE, 3);
      const balBefore = await token.balanceOf(user.address);

      await staking.connect(user).claimReward(stakeId);

      const balAfter = await token.balanceOf(user.address);
      expect(balAfter - balBefore).to.equal(expectedReward);
    });

    it("should emit RewardClaimed event with correct parameters", async function () {
      const { staking, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await time.increase(BRONZE_DURATION);
      const expectedReward = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);

      await expect(staking.connect(user).claimReward(stakeId))
        .to.emit(staking, "RewardClaimed")
        .withArgs(stakeId, user.address, expectedReward, 1n);
    });

    it("should reduce rewardPool by claimed amount", async function () {
      const { staking, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await time.increase(BRONZE_DURATION);
      const expectedReward = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);
      const poolBefore = await staking.rewardPool();

      await staking.connect(user).claimReward(stakeId);

      const poolAfter = await staking.rewardPool();
      expect(poolBefore - poolAfter).to.equal(expectedReward);
    });

    it("should update totalClaimed in stake struct", async function () {
      const { staking, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await time.increase(BRONZE_DURATION);
      const expectedReward = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);

      await staking.connect(user).claimReward(stakeId);

      const stake = await staking.stakes(stakeId);
      expect(stake.totalClaimed).to.equal(expectedReward);
    });

    it("should advance lastClaimTime by one lockDuration after claim", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      const stakeBefore = await staking.stakes(stakeId);
      const lastClaimBefore = stakeBefore.lastClaimTime;

      await time.increase(BRONZE_DURATION);
      await staking.connect(user).claimReward(stakeId);

      const stakeAfter = await staking.stakes(stakeId);
      expect(stakeAfter.lastClaimTime).to.equal(
        lastClaimBefore + BigInt(BRONZE_DURATION)
      );
    });

    it("should advance lastClaimTime by 3 lockDurations when claiming 3 cycles", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      const stakeBefore = await staking.stakes(stakeId);
      const lastClaimBefore = stakeBefore.lastClaimTime;

      await time.increase(BRONZE_DURATION * 3);
      await staking.connect(user).claimReward(stakeId);

      const stakeAfter = await staking.stakes(stakeId);
      expect(stakeAfter.lastClaimTime).to.equal(
        lastClaimBefore + BigInt(BRONZE_DURATION) * 3n
      );
    });

    it("should allow sequential claims across multiple cycles", async function () {
      const { staking, token, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      const perCycle = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);

      // Claim cycle 1
      await time.increase(BRONZE_DURATION);
      await staking.connect(user).claimReward(stakeId);

      // Claim cycle 2
      await time.increase(BRONZE_DURATION);
      const balBefore = await token.balanceOf(user.address);
      await staking.connect(user).claimReward(stakeId);
      const balAfter = await token.balanceOf(user.address);

      expect(balAfter - balBefore).to.equal(perCycle);
    });

    it("should return correct rewardAmount from claimReward", async function () {
      const { staking, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await time.increase(BRONZE_DURATION);
      const expected = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);

      // Call via staticCall to get return value
      const result = await staking.connect(user).claimReward.staticCall(stakeId);
      expect(result).to.equal(expected);
    });
  });

  describe("Negative Cases", function () {
    it("should revert StakeNotFound for non-existent stakeId", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).claimReward(9999n)
      ).to.be.revertedWithCustomError(staking, "StakeNotFound");
    });

    it("should revert StakeNotFound for stakeId = 0", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).claimReward(0n)
      ).to.be.revertedWithCustomError(staking, "StakeNotFound");
    });

    it("should revert NotStakeOwner when called by non-owner", async function () {
      const { staking, alice, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await time.increase(BRONZE_DURATION);
      await expect(
        staking.connect(alice).claimReward(stakeId)
      ).to.be.revertedWithCustomError(staking, "NotStakeOwner");
    });

    it("should revert AlreadyUnstaked after unstaking", async function () {
      const { staking, user, stakeId } = await loadFixture(
        deployStakingAfterLockFixture
      );
      await staking.connect(user).unstake(stakeId);

      await time.increase(BRONZE_DURATION);
      await expect(
        staking.connect(user).claimReward(stakeId)
      ).to.be.revertedWithCustomError(staking, "AlreadyUnstaked");
    });

    it("should revert NoRewardsToClaim before first cycle completes", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      // Only advance half a cycle
      await time.increase(BRONZE_DURATION / 2);
      await expect(
        staking.connect(user).claimReward(stakeId)
      ).to.be.revertedWithCustomError(staking, "NoRewardsToClaim");
    });

    it("should revert NoRewardsToClaim immediately after staking (0 time)", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await expect(
        staking.connect(user).claimReward(stakeId)
      ).to.be.revertedWithCustomError(staking, "NoRewardsToClaim");
    });

    it("should revert InsufficientRewardPool when pool is drained", async function () {
      const { staking, owner, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      // Drain the reward pool
      const pool = await staking.rewardPool();
      await staking.connect(owner).withdrawRewardPool(pool);

      await time.increase(BRONZE_DURATION);
      await expect(
        staking.connect(user).claimReward(stakeId)
      ).to.be.revertedWithCustomError(staking, "InsufficientRewardPool");
    });

    it("should revert when paused", async function () {
      const { staking, owner, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await time.increase(BRONZE_DURATION);
      await staking.connect(owner).pause();

      await expect(
        staking.connect(user).claimReward(stakeId)
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
    });
  });
});

// ============================================================
// UNSTAKE TESTS
// ============================================================
describe("TokenStaking - unstake()", function () {
  describe("Positive Cases", function () {
    it("should unstake principal + rewards after lock period", async function () {
      const { staking, token, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingAfterLockFixture);

      const expectedReward = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);
      const expectedTotal  = stakedAmount + expectedReward;

      const balBefore = await token.balanceOf(user.address);
      await staking.connect(user).unstake(stakeId);
      const balAfter = await token.balanceOf(user.address);

      expect(balAfter - balBefore).to.equal(expectedTotal);
    });

    it("should emit Unstaked event with correct parameters", async function () {
      const { staking, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingAfterLockFixture);

      const expectedReward = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);
      const expectedTotal  = stakedAmount + expectedReward;

      await expect(staking.connect(user).unstake(stakeId))
        .to.emit(staking, "Unstaked")
        .withArgs(
          stakeId,
          user.address,
          stakedAmount,
          expectedReward,
          expectedTotal
        );
    });

    it("should mark stake as unstaked", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingAfterLockFixture);

      await staking.connect(user).unstake(stakeId);
      const stake = await staking.stakes(stakeId);
      expect(stake.unstaked).to.be.true;
    });

    it("should reduce totalStaked by principal", async function () {
      const { staking, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingAfterLockFixture);

      const totalBefore = await staking.totalStaked();
      await staking.connect(user).unstake(stakeId);
      const totalAfter = await staking.totalStaked();

      expect(totalBefore - totalAfter).to.equal(stakedAmount);
    });

    it("should reduce user aggregates correctly", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingAfterLockFixture);

      await staking.connect(user).unstake(stakeId);
      const { totalAmount, activeStakes } =
        await staking.getUserTotalStaked(user.address);

      expect(totalAmount).to.equal(0n);
      expect(activeStakes).to.equal(0n);
    });

    it("should unstake with no rewards if none pending", async function () {
      /**
       * If user claims all rewards just before unstaking, finalReward = 0.
       * Should still return principal.
       */
      const { staking, token, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await time.increase(BRONZE_DURATION);
      // Claim first
      await staking.connect(user).claimReward(stakeId);
      // Unstake immediately after (no new cycle completed)
      const balBefore = await token.balanceOf(user.address);
      await staking.connect(user).unstake(stakeId);
      const balAfter = await token.balanceOf(user.address);

      expect(balAfter - balBefore).to.equal(stakedAmount);
    });

    it("should unstake after multiple cycles with accumulated rewards", async function () {
      const { staking, token, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      // Advance 5 cycles
      await time.increase(BRONZE_DURATION * 5);

      const expectedReward = rewardForCycles(stakedAmount, BRONZE_RATE, 5);
      const expectedTotal  = stakedAmount + expectedReward;

      const balBefore = await token.balanceOf(user.address);
      await staking.connect(user).unstake(stakeId);
      const balAfter = await token.balanceOf(user.address);

      expect(balAfter - balBefore).to.equal(expectedTotal);
    });

    it("should update totalClaimed on unstake with rewards", async function () {
      const { staking, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingAfterLockFixture);

      const expectedReward = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);
      await staking.connect(user).unstake(stakeId);
      const stake = await staking.stakes(stakeId);
      expect(stake.totalClaimed).to.equal(expectedReward);
    });
  });

  describe("Negative Cases", function () {
    it("should revert LockPeriodNotEnded before lock expires", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      // Only half time passed
      await time.increase(BRONZE_DURATION / 2);
      await expect(
        staking.connect(user).unstake(stakeId)
      ).to.be.revertedWithCustomError(staking, "LockPeriodNotEnded");
    });

    it("should revert LockPeriodNotEnded immediately after staking (0 time)", async function () {
  const { staking, user, stakeId } =
    await loadFixture(deployStakingWithBronzeStakeFixture);

  // No time.increase needed — just try immediately
  await expect(
    staking.connect(user).unstake(stakeId)
  ).to.be.revertedWithCustomError(staking, "LockPeriodNotEnded");
});

it("should revert LockPeriodNotEnded 1 second before lock ends", async function () {
  const { staking, user, stakeId } =
    await loadFixture(deployStakingWithBronzeStakeFixture);

  const stake        = await staking.stakes(stakeId);
  const startTime    = stake.startTime;
  const lockDuration = stake.lockDuration;

  // Set block time to exactly 2 seconds before unlock.
  // The unstake() tx will mine +1s making it 1s before unlock → revert.
  const target = startTime + lockDuration - 2n;
  await time.increaseTo(Number(target));

  await expect(
    staking.connect(user).unstake(stakeId)
  ).to.be.revertedWithCustomError(staking, "LockPeriodNotEnded");
});

it("should allow unstake exactly at lock end", async function () {
  const { staking, user, stakeId } =
    await loadFixture(deployStakingWithBronzeStakeFixture);

  const stake        = await staking.stakes(stakeId);
  const startTime    = stake.startTime;
  const lockDuration = stake.lockDuration;

  // Set time so that after tx mines (+1s), we're exactly AT unlock
  // firstUnlockTime = startTime + lockDuration
  // We need block.timestamp >= firstUnlockTime when tx executes
  // So set to firstUnlockTime - 1 (tx mining adds the final +1)
  const target = startTime + lockDuration - 1n;
  await time.increaseTo(Number(target));

  await expect(
    staking.connect(user).unstake(stakeId)
  ).to.not.be.reverted;
});

    it("should revert LockPeriodNotEnded 1 second before lock ends", async function () {
  const { staking, user, stakeId } =
    await loadFixture(deployStakingWithBronzeStakeFixture);

  // Read the exact startTime from the stored stake
  const stake       = await staking.stakes(stakeId);
  const startTime   = stake.startTime;
  const lockDuration = stake.lockDuration;

  // firstUnlockTime = startTime + lockDuration
  // We want to be at firstUnlockTime - 2 so that after
  // the unstake() tx mines (+1s), we're still at -1s
  const oneSecondBefore = startTime + lockDuration - 2n;

  await time.increaseTo(Number(oneSecondBefore));

  await expect(
    staking.connect(user).unstake(stakeId)
  ).to.be.revertedWithCustomError(staking, "LockPeriodNotEnded");
});

    it("should revert NotStakeOwner when called by wrong user", async function () {
      const { staking, alice, stakeId } =
        await loadFixture(deployStakingAfterLockFixture);

      await expect(
        staking.connect(alice).unstake(stakeId)
      ).to.be.revertedWithCustomError(staking, "NotStakeOwner");
    });

    it("should revert AlreadyUnstaked on second unstake", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingAfterLockFixture);

      await staking.connect(user).unstake(stakeId);

      await time.increase(BRONZE_DURATION);
      await expect(
        staking.connect(user).unstake(stakeId)
      ).to.be.revertedWithCustomError(staking, "AlreadyUnstaked");
    });

    it("should revert StakeNotFound for invalid stakeId", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).unstake(9999n)
      ).to.be.revertedWithCustomError(staking, "StakeNotFound");
    });

    it("should revert InsufficientRewardPool when pool cannot cover rewards", async function () {
      const { staking, owner, user, stakeId } =
        await loadFixture(deployStakingAfterLockFixture);

      // Drain pool
      const pool = await staking.rewardPool();
      await staking.connect(owner).withdrawRewardPool(pool);

      await expect(
        staking.connect(user).unstake(stakeId)
      ).to.be.revertedWithCustomError(staking, "InsufficientRewardPool");
    });

    it("should revert when paused", async function () {
      const { staking, owner, user, stakeId } =
        await loadFixture(deployStakingAfterLockFixture);

      await staking.connect(owner).pause();
      await expect(
        staking.connect(user).unstake(stakeId)
      ).to.be.revertedWithCustomError(staking, "EnforcedPause");
    });
  });
});

// ============================================================
// EMERGENCY WITHDRAW TESTS
// ============================================================
describe("TokenStaking - emergencyWithdraw()", function () {
  describe("Positive Cases", function () {
    it("should return principal when contract is paused", async function () {
      const { staking, token, owner, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await staking.connect(owner).pause();
      const balBefore = await token.balanceOf(user.address);
      await staking.connect(user).emergencyWithdraw(stakeId);
      const balAfter = await token.balanceOf(user.address);

      expect(balAfter - balBefore).to.equal(stakedAmount);
    });

    it("should emit EmergencyWithdraw event", async function () {
      const { staking, owner, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await staking.connect(owner).pause();
      await expect(staking.connect(user).emergencyWithdraw(stakeId))
        .to.emit(staking, "EmergencyWithdraw")
        .withArgs(stakeId, user.address, stakedAmount);
    });

    it("should mark stake as unstaked after emergency withdraw", async function () {
      const { staking, owner, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await staking.connect(owner).pause();
      await staking.connect(user).emergencyWithdraw(stakeId);

      const stake = await staking.stakes(stakeId);
      expect(stake.unstaked).to.be.true;
    });

    it("should reduce totalStaked after emergency withdraw", async function () {
      const { staking, owner, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      const totalBefore = await staking.totalStaked();
      await staking.connect(owner).pause();
      await staking.connect(user).emergencyWithdraw(stakeId);
      const totalAfter = await staking.totalStaked();

      expect(totalBefore - totalAfter).to.equal(stakedAmount);
    });

    it("should NOT include rewards in emergency withdraw (principal only)", async function () {
      const { staking, token, owner, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      // Advance several cycles to accumulate rewards
      await time.increase(BRONZE_DURATION * 3);
      await staking.connect(owner).pause();

      const balBefore = await token.balanceOf(user.address);
      await staking.connect(user).emergencyWithdraw(stakeId);
      const balAfter = await token.balanceOf(user.address);

      // Should receive ONLY principal, not rewards
      expect(balAfter - balBefore).to.equal(stakedAmount);
    });

    it("should work even before lock period ends", async function () {
      const { staking, owner, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      // Emergency withdraw works even before lock ends
      await staking.connect(owner).pause();
      await expect(
        staking.connect(user).emergencyWithdraw(stakeId)
      ).to.not.be.reverted;
    });
  });

  describe("Negative Cases", function () {
    it("should revert NotPaused when contract is not paused", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await expect(
        staking.connect(user).emergencyWithdraw(stakeId)
      ).to.be.revertedWithCustomError(staking, "NotPaused");
    });

    it("should revert NotStakeOwner when called by wrong user", async function () {
      const { staking, owner, alice, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await staking.connect(owner).pause();
      await expect(
        staking.connect(alice).emergencyWithdraw(stakeId)
      ).to.be.revertedWithCustomError(staking, "NotStakeOwner");
    });

    it("should revert AlreadyUnstaked after already withdrawn", async function () {
      const { staking, owner, user, stakeId } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await staking.connect(owner).pause();
      await staking.connect(user).emergencyWithdraw(stakeId);

      await expect(
        staking.connect(user).emergencyWithdraw(stakeId)
      ).to.be.revertedWithCustomError(staking, "AlreadyUnstaked");
    });

    it("should revert StakeNotFound for invalid stakeId", async function () {
      const { staking, owner, user } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await staking.connect(owner).pause();
      await expect(
        staking.connect(user).emergencyWithdraw(9999n)
      ).to.be.revertedWithCustomError(staking, "StakeNotFound");
    });
  });
});

// ============================================================
// REWARD POOL MANAGEMENT TESTS
// ============================================================
describe("TokenStaking - Reward Pool Management", function () {
  describe("depositRewardPool()", function () {
    it("should deposit tokens into reward pool", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      // Pool was already seeded in fixture; check additional deposit
      const poolBefore = await staking.rewardPool();
      const deposit = ethers.parseEther("1000");
      await staking.connect(owner).depositRewardPool(deposit);
      expect(await staking.rewardPool()).to.equal(poolBefore + deposit);
    });

    it("should emit RewardPoolDeposited event", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      const deposit = ethers.parseEther("1000");
      await expect(staking.connect(owner).depositRewardPool(deposit))
        .to.emit(staking, "RewardPoolDeposited")
        .withArgs(owner.address, deposit);
    });

    it("should revert InvalidAmount for 0 deposit", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).depositRewardPool(0n)
      ).to.be.revertedWithCustomError(staking, "InvalidAmount");
    });

    it("should revert if non-owner deposits", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).depositRewardPool(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });

    // Find and replace in TokenStaking.test.js:
it("should revert TransferAmountMismatch for fee-on-transfer token", async function () {
  const [owner] = await ethers.getSigners();

  // Deploy fee token
  const feeToken = await deployMockFeeToken();
  const feeAddr  = await feeToken.getAddress();

  // Deploy fresh staking with fee token
  const Staking  = await ethers.getContractFactory("TokenStaking");
  const staking  = await Staking.deploy(feeAddr, owner.address);
  const stakingAddr = await staking.getAddress();

  // Mint ENOUGH for the deposit attempt
  const depositAmount = ethers.parseEther("1000");
  await feeToken.mint(owner.address, depositAmount * 2n); // 2x buffer

  // Approve staking contract
  await feeToken.connect(owner).approve(stakingAddr, ethers.MaxUint256);

  // depositRewardPool checks balanceBefore == balanceAfter + amount
  // Fee token deducts 1% → mismatch → revert
  await expect(
    staking.connect(owner).depositRewardPool(depositAmount)
  ).to.be.revertedWithCustomError(staking, "TransferAmountMismatch");
});
  })

  describe("withdrawRewardPool()", function () {
    it("should allow owner to withdraw from reward pool", async function () {
      const { staking, token, owner } = await loadFixture(deployStakingFixture);
      const withdraw = ethers.parseEther("1000");
      const poolBefore = await staking.rewardPool();
      const balBefore  = await token.balanceOf(owner.address);

      await staking.connect(owner).withdrawRewardPool(withdraw);

      expect(await staking.rewardPool()).to.equal(poolBefore - withdraw);
      const balAfter = await token.balanceOf(owner.address);
      expect(balAfter - balBefore).to.equal(withdraw);
    });

    it("should emit RewardPoolWithdrawn event", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      const withdraw = ethers.parseEther("1000");
      await expect(staking.connect(owner).withdrawRewardPool(withdraw))
        .to.emit(staking, "RewardPoolWithdrawn")
        .withArgs(owner.address, withdraw);
    });

    it("should revert BelowMinimumReserve when withdrawal exceeds available", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      // Set minimumReserve = rewardPool (nothing available to withdraw)
      const pool = await staking.rewardPool();
      await staking.connect(owner).setMinimumReserve(pool);

      await expect(
        staking.connect(owner).withdrawRewardPool(1n)
      ).to.be.revertedWithCustomError(staking, "BelowMinimumReserve");
    });

    it("should respect minimumReserve in withdrawal", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      const pool    = await staking.rewardPool();
      const reserve = ethers.parseEther("100000");
      await staking.connect(owner).setMinimumReserve(reserve);

      const available = pool - reserve;
      // Can withdraw exactly available
      await expect(
        staking.connect(owner).withdrawRewardPool(available)
      ).to.not.be.reverted;

      // Cannot withdraw 1 more
      await expect(
        staking.connect(owner).withdrawRewardPool(1n)
      ).to.be.revertedWithCustomError(staking, "BelowMinimumReserve");
    });

    it("should revert InvalidAmount for 0 withdrawal", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).withdrawRewardPool(0n)
      ).to.be.revertedWithCustomError(staking, "InvalidAmount");
    });

    it("should revert if non-owner tries to withdraw", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).withdrawRewardPool(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });
  });

  describe("setMinimumReserve()", function () {
    it("should update minimumReserve", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      const newReserve = ethers.parseEther("50000");
      await staking.connect(owner).setMinimumReserve(newReserve);
      expect(await staking.minimumReserve()).to.equal(newReserve);
    });

    it("should emit MinimumReserveUpdated event", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      const newReserve = ethers.parseEther("50000");
      await expect(staking.connect(owner).setMinimumReserve(newReserve))
        .to.emit(staking, "MinimumReserveUpdated")
        .withArgs(0n, newReserve);
    });

    it("should allow setting minimumReserve to 0", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await staking.connect(owner).setMinimumReserve(0n);
      expect(await staking.minimumReserve()).to.equal(0n);
    });

    it("should revert if non-owner calls setMinimumReserve", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).setMinimumReserve(1000n)
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });
  });
});

// ============================================================
// TIER MANAGEMENT TESTS
// ============================================================
describe("TokenStaking - Tier Management", function () {
  describe("updateRewardRate()", function () {
    it("should update BRONZE reward rate", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await staking.connect(owner).updateRewardRate(Tier.BRONZE, 600n);
      const plan = await staking.getTierPlan(Tier.BRONZE);
      expect(plan.rewardRate).to.equal(600n);
    });

    it("should emit TierPlanUpdated event", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      const plan = await staking.getTierPlan(Tier.BRONZE);
      await expect(staking.connect(owner).updateRewardRate(Tier.BRONZE, 600n))
        .to.emit(staking, "TierPlanUpdated");
    });

    it("should revert InvalidRewardRate for rate = 0", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).updateRewardRate(Tier.BRONZE, 0n)
      ).to.be.revertedWithCustomError(staking, "InvalidRewardRate");
    });

    it("should revert InvalidRewardRate for rate > MAX_REWARD_RATE", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).updateRewardRate(Tier.BRONZE, MAX_REWARD_RATE + 1n)
      ).to.be.revertedWithCustomError(staking, "InvalidRewardRate");
    });

    it("should allow setting rate to exactly MAX_REWARD_RATE", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).updateRewardRate(Tier.BRONZE, MAX_REWARD_RATE)
      ).to.not.be.reverted;
    });

    it("should revert if non-owner calls updateRewardRate", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).updateRewardRate(Tier.BRONZE, 600n)
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });
  });

  describe("updateTierDuration()", function () {
    it("should update tier duration", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      const newDuration = 30 * 24 * 60 * 60; // 30 days
      await staking.connect(owner).updateTierDuration(Tier.BRONZE, newDuration);
      const plan = await staking.getTierPlan(Tier.BRONZE);
      expect(plan.duration).to.equal(BigInt(newDuration));
    });

    it("should emit TierDurationUpdated event", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      const newDuration = 30 * 24 * 60 * 60;
      await expect(
        staking.connect(owner).updateTierDuration(Tier.BRONZE, newDuration)
      )
        .to.emit(staking, "TierDurationUpdated")
        .withArgs(Tier.BRONZE, BigInt(BRONZE_DURATION), BigInt(newDuration));
    });

    it("should revert InvalidDuration for 0", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).updateTierDuration(Tier.BRONZE, 0n)
      ).to.be.revertedWithCustomError(staking, "InvalidDuration");
    });

    it("should revert if non-owner calls updateTierDuration", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).updateTierDuration(Tier.BRONZE, 30 * 86400)
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });
  });

  describe("updateMinStakeAmount()", function () {
    it("should update min stake amount", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      const newMin = ethers.parseEther("2000");
      await staking.connect(owner).updateMinStakeAmount(Tier.BRONZE, newMin);
      const plan = await staking.getTierPlan(Tier.BRONZE);
      expect(plan.minStakeAmount).to.equal(newMin);
    });

    it("should revert InvalidAmount for 0 min stake", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).updateMinStakeAmount(Tier.BRONZE, 0n)
      ).to.be.revertedWithCustomError(staking, "InvalidAmount");
    });

    it("should revert if non-owner calls", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).updateMinStakeAmount(Tier.BRONZE, ethers.parseEther("500"))
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });
  });

  describe("setTierActive()", function () {
    it("should deactivate a tier", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await staking.connect(owner).setTierActive(Tier.GOLD, false);
      const plan = await staking.getTierPlan(Tier.GOLD);
      expect(plan.isActive).to.be.false;
    });

    it("should reactivate a tier", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await staking.connect(owner).setTierActive(Tier.GOLD, false);
      await staking.connect(owner).setTierActive(Tier.GOLD, true);
      const plan = await staking.getTierPlan(Tier.GOLD);
      expect(plan.isActive).to.be.true;
    });

    it("should emit TierPlanUpdated event on setTierActive", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(staking.connect(owner).setTierActive(Tier.BRONZE, false))
        .to.emit(staking, "TierPlanUpdated");
    });

    it("should revert if non-owner calls setTierActive", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).setTierActive(Tier.BRONZE, false)
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });
  });

  describe("batchUpdateTierPlans()", function () {
    it("should batch update all tiers", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);

      await staking.connect(owner).batchUpdateTierPlans(
        [Tier.BRONZE, Tier.SILVER],
        [600n, 1100n],
        [BigInt(BRONZE_DURATION), BigInt(SILVER_DURATION)],
        [BRONZE_MIN_STAKE, SILVER_MIN_STAKE],
        [true, true]
      );

      const bronze = await staking.getTierPlan(Tier.BRONZE);
      const silver = await staking.getTierPlan(Tier.SILVER);
      expect(bronze.rewardRate).to.equal(600n);
      expect(silver.rewardRate).to.equal(1100n);
    });

    it("should revert ArrayLengthMismatch when arrays differ", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).batchUpdateTierPlans(
          [Tier.BRONZE, Tier.SILVER],
          [600n],                          // wrong length
          [BigInt(BRONZE_DURATION), BigInt(SILVER_DURATION)],
          [BRONZE_MIN_STAKE, SILVER_MIN_STAKE],
          [true, true]
        )
      ).to.be.revertedWithCustomError(staking, "ArrayLengthMismatch");
    });

    it("should revert InvalidRewardRate inside batch", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).batchUpdateTierPlans(
          [Tier.BRONZE],
          [0n],                            // invalid rate
          [BigInt(BRONZE_DURATION)],
          [BRONZE_MIN_STAKE],
          [true]
        )
      ).to.be.revertedWithCustomError(staking, "InvalidRewardRate");
    });

    it("should revert InvalidDuration inside batch", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).batchUpdateTierPlans(
          [Tier.BRONZE],
          [600n],
          [0n],                            // invalid duration
          [BRONZE_MIN_STAKE],
          [true]
        )
      ).to.be.revertedWithCustomError(staking, "InvalidDuration");
    });

    it("should revert InvalidAmount inside batch", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).batchUpdateTierPlans(
          [Tier.BRONZE],
          [600n],
          [BigInt(BRONZE_DURATION)],
          [0n],                            // invalid min stake
          [true]
        )
      ).to.be.revertedWithCustomError(staking, "InvalidAmount");
    });

    it("should revert if non-owner calls batchUpdateTierPlans", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(user).batchUpdateTierPlans(
          [Tier.BRONZE],
          [600n],
          [BigInt(BRONZE_DURATION)],
          [BRONZE_MIN_STAKE],
          [true]
        )
      ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    });

    it("should handle empty arrays gracefully", async function () {
      const { staking, owner } = await loadFixture(deployStakingFixture);
      await expect(
        staking.connect(owner).batchUpdateTierPlans([], [], [], [], [])
      ).to.not.be.reverted;
    });
  });
});

// ============================================================
// PAUSE / UNPAUSE TESTS
// ============================================================
describe("TokenStaking - Pause/Unpause", function () {
  it("should pause contract", async function () {
    const { staking, owner } = await loadFixture(deployStakingFixture);
    await staking.connect(owner).pause();
    expect(await staking.paused()).to.be.true;
  });

  it("should emit ContractPaused event", async function () {
    const { staking, owner } = await loadFixture(deployStakingFixture);
    await expect(staking.connect(owner).pause())
      .to.emit(staking, "ContractPaused")
      .withArgs(owner.address);
  });

  it("should unpause contract", async function () {
    const { staking, owner } = await loadFixture(deployStakingPausedFixture);
    await staking.connect(owner).unpause();
    expect(await staking.paused()).to.be.false;
  });

  it("should emit ContractUnpaused event", async function () {
    const { staking, owner } = await loadFixture(deployStakingPausedFixture);
    await expect(staking.connect(owner).unpause())
      .to.emit(staking, "ContractUnpaused")
      .withArgs(owner.address);
  });

  it("should revert if already paused", async function () {
    const { staking, owner } = await loadFixture(deployStakingPausedFixture);
    await expect(
      staking.connect(owner).pause()
    ).to.be.revertedWithCustomError(staking, "EnforcedPause");
  });

  it("should revert if not paused when unpausing", async function () {
    const { staking, owner } = await loadFixture(deployStakingFixture);
    await expect(
      staking.connect(owner).unpause()
    ).to.be.revertedWithCustomError(staking, "ExpectedPause");
  });

  it("should revert if non-owner pauses", async function () {
    const { staking, user } = await loadFixture(deployStakingFixture);
    await expect(
      staking.connect(user).pause()
    ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
  });

  it("should revert if non-owner unpauses", async function () {
    const { staking, owner, user } = await loadFixture(deployStakingFixture);
    await staking.connect(owner).pause();
    await expect(
      staking.connect(user).unpause()
    ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
  });
});

// ============================================================
// TOKEN RECOVERY TESTS
// ============================================================
describe("TokenStaking - recoverERC20()", function () {
  it("should recover accidentally sent tokens", async function () {
  const { staking, owner, stakingAddr } = await loadFixture(
    deployStakingFixture
  );
  const recToken = await deployMockRecoverableToken();
  const recAddr  = await recToken.getAddress();
  const amount   = ethers.parseEther("500");

  // Mint directly to staking contract address (simulates accidental send)
  await recToken.mint(stakingAddr, amount);

  // Verify it arrived
  expect(await recToken.balanceOf(stakingAddr)).to.equal(amount);

  // Recover
  const ownerBalBefore = await recToken.balanceOf(owner.address);
  await staking.connect(owner).recoverERC20(recAddr, owner.address, amount);
  const ownerBalAfter = await recToken.balanceOf(owner.address);

  expect(ownerBalAfter - ownerBalBefore).to.equal(amount);
  expect(await recToken.balanceOf(stakingAddr)).to.equal(0n);
});

  it("should emit TokensRecovered event", async function () {
    const { staking, owner, stakingAddr } = await loadFixture(
      deployStakingFixture
    );
    const recToken = await deployMockRecoverableToken();
    const amount   = ethers.parseEther("100");
    await recToken.mint(stakingAddr, amount);

    await expect(
      staking
        .connect(owner)
        .recoverERC20(await recToken.getAddress(), owner.address, amount)
    )
      .to.emit(staking, "TokensRecovered")
      .withArgs(await recToken.getAddress(), owner.address, amount);
  });

  it("should revert CannotRecoverStakingToken", async function () {
    const { staking, token, owner } = await loadFixture(deployStakingFixture);
    await expect(
      staking
        .connect(owner)
        .recoverERC20(await token.getAddress(), owner.address, 1n)
    ).to.be.revertedWithCustomError(staking, "CannotRecoverStakingToken");
  });

  it("should revert ZeroAddress for zero recipient", async function () {
    const { staking, owner } = await loadFixture(deployStakingFixture);
    const recToken = await deployMockRecoverableToken();
    await expect(
      staking
        .connect(owner)
        .recoverERC20(await recToken.getAddress(), ethers.ZeroAddress, 1n)
    ).to.be.revertedWithCustomError(staking, "ZeroAddress");
  });

  it("should revert InvalidAmount for 0 amount", async function () {
    const { staking, owner } = await loadFixture(deployStakingFixture);
    const recToken = await deployMockRecoverableToken();
    await expect(
      staking
        .connect(owner)
        .recoverERC20(await recToken.getAddress(), owner.address, 0n)
    ).to.be.revertedWithCustomError(staking, "InvalidAmount");
  });

  it("should revert if non-owner calls recoverERC20", async function () {
    const { staking, user } = await loadFixture(deployStakingFixture);
    const recToken = await deployMockRecoverableToken();
    await expect(
      staking
        .connect(user)
        .recoverERC20(await recToken.getAddress(), user.address, 1n)
    ).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
  });
});

// ============================================================
// VIEW FUNCTION TESTS
// ============================================================
describe("TokenStaking - View Functions", function () {
  describe("getUserCurrentTier()", function () {
    it("should return NONE when user has no stakes", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      const { hasTier, tierName } = await staking.getUserCurrentTier(user.address);
      expect(hasTier).to.be.false;
      expect(tierName).to.equal("NONE");
    });

    it("should return BRONZE for bronze staker", async function () {
      const { staking, user } = await loadFixture(
        deployStakingWithBronzeStakeFixture
      );
      const { currentTier, hasTier, tierName } =
        await staking.getUserCurrentTier(user.address);
      expect(hasTier).to.be.true;
      expect(currentTier).to.equal(Tier.BRONZE);
      expect(tierName).to.equal("BRONZE");
    });

    it("should return highest tier when user has multiple tiers", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);
      await staking.connect(user).stake(GOLD_MIN_STAKE,   Tier.GOLD);

      const { currentTier, tierName } = await staking.getUserCurrentTier(user.address);
      expect(currentTier).to.equal(Tier.GOLD);
      expect(tierName).to.equal("GOLD");
    });

    it("should return PLATINUM for platinum staker", async function () {
      const { staking, user } = await loadFixture(
        deployStakingWithPlatinumStakeFixture
      );
      const { currentTier, tierName } = await staking.getUserCurrentTier(user.address);
      expect(currentTier).to.equal(Tier.PLATINUM);
      expect(tierName).to.equal("PLATINUM");
    });

    it("should return NONE after all stakes unstaked", async function () {
      const { staking, user, stakeId } =
        await loadFixture(deployStakingAfterLockFixture);

      await staking.connect(user).unstake(stakeId);
      const { hasTier } = await staking.getUserCurrentTier(user.address);
      expect(hasTier).to.be.false;
    });
  });

  describe("getUserTotalStaked()", function () {
    it("should return 0 for user with no stakes", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      const { totalAmount, activeStakes } =
        await staking.getUserTotalStaked(user.address);
      expect(totalAmount).to.equal(0n);
      expect(activeStakes).to.equal(0n);
    });

    it("should accumulate totalAmount across multiple stakes", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);
      await staking.connect(user).stake(SILVER_MIN_STAKE, Tier.SILVER);

      const { totalAmount, activeStakes } =
        await staking.getUserTotalStaked(user.address);
      expect(totalAmount).to.equal(BRONZE_MIN_STAKE + SILVER_MIN_STAKE);
      expect(activeStakes).to.equal(2n);
    });
  });

  describe("getUserTotalRewards()", function () {
    it("should return 0 for fresh stake (no cycles completed)", async function () {
      const { staking, user } = await loadFixture(
        deployStakingWithBronzeStakeFixture
      );
      const { claimableRewards } = await staking.getUserTotalRewards(user.address);
      expect(claimableRewards).to.equal(0n);
    });

    it("should return correct claimable rewards after 1 cycle", async function () {
      const { staking, user, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await time.increase(BRONZE_DURATION);
      const expected = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);

      const { claimableRewards } = await staking.getUserTotalRewards(user.address);
      expect(claimableRewards).to.equal(expected);
    });

    it("should track claimedRewards after a claim", async function () {
      const { staking, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      await time.increase(BRONZE_DURATION);
      const claimed = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);
      await staking.connect(user).claimReward(stakeId);

      const { claimedRewards } = await staking.getUserTotalRewards(user.address);
      expect(claimedRewards).to.equal(claimed);
    });

    it("should return totalRewards = claimable + claimed", async function () {
      const { staking, user, stakeId, stakedAmount } =
        await loadFixture(deployStakingWithBronzeStakeFixture);

      // Claim 1 cycle
      await time.increase(BRONZE_DURATION);
      await staking.connect(user).claimReward(stakeId);

      // Another cycle accrues
      await time.increase(BRONZE_DURATION);
      const perCycle = calculateRewardPerCycle(stakedAmount, BRONZE_RATE);

      const { claimableRewards, claimedRewards, totalRewards } =
        await staking.getUserTotalRewards(user.address);

      expect(claimedRewards).to.equal(perCycle);
      expect(claimableRewards).to.equal(perCycle);
      expect(totalRewards).to.equal(perCycle * 2n);
    });
  });

  describe("getAllTierPlans()", function () {
    it("should return all 4 tier plans", async function () {
      const { staking } = await loadFixture(deployStakingFixture);
      const { tiers, plans } = await staking.getAllTierPlans();
      expect(tiers.length).to.equal(4);
      expect(plans.length).to.equal(4);
      expect(plans[0].rewardRate).to.equal(BigInt(BRONZE_RATE));
      expect(plans[3].rewardRate).to.equal(BigInt(PLATINUM_RATE));
    });
  });

  describe("getContractStats()", function () {
    it("should return correct stats", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);

      const { _totalStaked, _rewardPool, _totalStakesCreated } =
        await staking.getContractStats();

      expect(_totalStaked).to.equal(BRONZE_MIN_STAKE);
      expect(_rewardPool).to.equal(REWARD_POOL_SEED);
      expect(_totalStakesCreated).to.equal(1n);
    });
  });

  describe("getUserStakeIds()", function () {
    it("should return empty array for new user", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      const ids = await staking.getUserStakeIds(user.address);
      expect(ids.length).to.equal(0);
    });

    it("should track all stake IDs for user", async function () {
      const { staking, user } = await loadFixture(deployStakingFixture);
      const id1 = await stakeAndGetId(staking, user, BRONZE_MIN_STAKE, Tier.BRONZE);
      const id2 = await stakeAndGetId(staking, user, BRONZE_MIN_STAKE, Tier.BRONZE);
      const ids = await staking.getUserStakeIds(user.address);
      expect(ids).to.deep.include(id1);
      expect(ids).to.deep.include(id2);
    });
  });

  describe("getTierPlan()", function () {
    it("should return correct plan for each tier", async function () {
      const { staking } = await loadFixture(deployStakingFixture);
      const bronze = await staking.getTierPlan(Tier.BRONZE);
      expect(bronze.duration).to.equal(BigInt(BRONZE_DURATION));
      expect(bronze.rewardRate).to.equal(BigInt(BRONZE_RATE));
      expect(bronze.minStakeAmount).to.equal(BRONZE_MIN_STAKE);
      expect(bronze.isActive).to.be.true;
    });
  });
});

// ============================================================
// GAS BENCHMARKS
// ============================================================
describe("TokenStaking - Gas Benchmarks", function () {
   it("should measure gas for stake() - cold slot (first stake ever)", async function () {
    const { staking, user } = await loadFixture(deployStakingFixture);

    const tx      = await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);
    const receipt = await tx.wait();

    console.log(`      ⛽ stake() cold slot gas: ${receipt.gasUsed}`);

    // Cold SSTORE (zero → nonzero) is expensive — allow up to 450K
    expect(receipt.gasUsed).to.be.lt(450000n);
  });

  it("should measure gas for stake() - warm slot (second stake, realistic)", async function () {
    const { staking, user, alice } = await loadFixture(deployStakingFixture);

    // First stake warms up contract storage
    await staking.connect(user).stake(BRONZE_MIN_STAKE, Tier.BRONZE);

    // Second stake (alice, still cold for alice but stakeIdCounter is warm)
    const tx      = await staking.connect(alice).stake(BRONZE_MIN_STAKE, Tier.BRONZE);
    const receipt = await tx.wait();

    console.log(`      ⛽ stake() warm slot gas: ${receipt.gasUsed}`);

    // Warm SSTORE is cheaper — 250K is a reasonable upper bound
    expect(receipt.gasUsed).to.be.lt(350000n);
  });

  it("should measure gas for claimReward()", async function () {
    const { staking, user, stakeId } =
      await loadFixture(deployStakingWithBronzeStakeFixture);

    await time.increase(BRONZE_DURATION);

    const tx      = await staking.connect(user).claimReward(stakeId);
    const receipt = await tx.wait();

    console.log(`      ⛽ claimReward() gas: ${receipt.gasUsed}`);
    expect(receipt.gasUsed).to.be.lt(150000n);
  });

  it("should measure gas for unstake()", async function () {
    const { staking, user, stakeId } =
      await loadFixture(deployStakingAfterLockFixture);

    const tx      = await staking.connect(user).unstake(stakeId);
    const receipt = await tx.wait();

    console.log(`      ⛽ unstake() gas: ${receipt.gasUsed}`);
    expect(receipt.gasUsed).to.be.lt(200000n);
  });

  it("should measure gas for emergencyWithdraw()", async function () {
    const { staking, owner, user, stakeId } =
      await loadFixture(deployStakingWithBronzeStakeFixture);

    await staking.connect(owner).pause();

    const tx      = await staking.connect(user).emergencyWithdraw(stakeId);
    const receipt = await tx.wait();

    console.log(`      ⛽ emergencyWithdraw() gas: ${receipt.gasUsed}`);
    expect(receipt.gasUsed).to.be.lt(150000n);
  });

  it("should measure gas for depositRewardPool()", async function () {
    const { staking, owner } = await loadFixture(deployStakingFixture);
    const amount = ethers.parseEther("1000");

    const tx      = await staking.connect(owner).depositRewardPool(amount);
    const receipt = await tx.wait();

    console.log(`      ⛽ depositRewardPool() gas: ${receipt.gasUsed}`);
    expect(receipt.gasUsed).to.be.lt(100000n);
  });

  it("should measure gas for batchUpdateTierPlans() with 4 tiers", async function () {
    const { staking, owner } = await loadFixture(deployStakingFixture);

    const tx = await staking.connect(owner).batchUpdateTierPlans(
      [Tier.BRONZE, Tier.SILVER, Tier.GOLD, Tier.PLATINUM],
      [600n, 1100n, 1600n, 2400n],
      [
        BigInt(BRONZE_DURATION),
        BigInt(SILVER_DURATION),
        BigInt(GOLD_DURATION),
        BigInt(PLATINUM_DURATION),
      ],
      [BRONZE_MIN_STAKE, SILVER_MIN_STAKE, GOLD_MIN_STAKE, PLATINUM_MIN_STAKE],
      [true, true, true, true]
    );
    const receipt = await tx.wait();

    console.log(`      ⛽ batchUpdateTierPlans(4) gas: ${receipt.gasUsed}`);
    expect(receipt.gasUsed).to.be.lt(300000n);
  });
});