const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const {
  deployVittagemsFixture,
  deployVittagemsNoOracleFixture,
  deployVittagemsOracleNotLockedFixture,
  deployVittagemsNoStalenessFixture,
  deployMockOracle,
  deployBrokenOracle,
  signPermit,
} = require("../erc20/helpers/helpers");

// ============================================================
// CONSTANTS
// ============================================================
const MAX_SUPPLY = ethers.parseEther("10000000000"); // 10B tokens
const ONE_ETHER = ethers.parseEther("1");
const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

// ============================================================
// DEPLOYMENT & CONSTRUCTOR TESTS
// ============================================================
describe("Vittagems - Deployment & Constructor", function () {
  /**
   * WHY: Verify that the contract deploys with correct initial state.
   * This is the baseline for all subsequent tests.
   */
  it("should deploy with correct name and symbol", async function () {
    const { token } = await loadFixture(deployVittagemsFixture);
    expect(await token.name()).to.equal("Vittagems");
    expect(await token.symbol()).to.equal("VGMG");
  });

  it("should have 18 decimals", async function () {
    const { token } = await loadFixture(deployVittagemsFixture);
    expect(await token.decimals()).to.equal(18);
  });

  it("should set MAX_SUPPLY to 10 billion tokens", async function () {
    const { token } = await loadFixture(deployVittagemsFixture);
    expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
  });

  it("should start with zero total supply", async function () {
    const { token } = await loadFixture(deployVittagemsFixture);
    expect(await token.totalSupply()).to.equal(0);
  });

  it("should grant DEFAULT_ADMIN_ROLE to defaultAdmin", async function () {
    const { token, owner } = await loadFixture(deployVittagemsFixture);
    expect(await token.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
  });

  it("should grant PAUSER_ROLE to pauser", async function () {
    const { token, pauser } = await loadFixture(deployVittagemsFixture);
    expect(await token.hasRole(PAUSER_ROLE, pauser.address)).to.be.true;
  });

  it("should grant MINTER_ROLE to minter", async function () {
    const { token, minter } = await loadFixture(deployVittagemsFixture);
    expect(await token.hasRole(MINTER_ROLE, minter.address)).to.be.true;
  });

  it("should set staleness threshold correctly", async function () {
    const { token, stalenessThreshold } = await loadFixture(
      deployVittagemsFixture
    );
    expect(await token.reserveStalenessThreshold()).to.equal(stalenessThreshold);
  });

  /**
   * WHY: Zero address validation in constructor is critical.
   * Missing these checks allows misconfiguration that cannot be undone.
   */
  it("should revert if defaultAdmin is zero address", async function () {
    const Vittagems = await ethers.getContractFactory("Vittagems");
    const [, pauser, minter] = await ethers.getSigners();
    await expect(
      Vittagems.deploy(ethers.ZeroAddress, pauser.address, minter.address, 3600)
    )
      .to.be.revertedWithCustomError(
        await Vittagems.deploy(
          ethers.ZeroAddress,
          pauser.address,
          minter.address,
          3600
        ).catch(async () => ({ interface: (await Vittagems.deploy(pauser.address, pauser.address, minter.address, 3600)).interface })),
        "InvalidAddress"
      );
  });

  it("should revert with InvalidAddress('defaultAdmin') if admin is zero address", async function () {
    const Vittagems = await ethers.getContractFactory("Vittagems");
    const [, pauser, minter] = await ethers.getSigners();
    
    // Deploy a valid one first to get the interface
    const validDeploy = await Vittagems.deploy(
      pauser.address, pauser.address, minter.address, 3600
    );

    await expect(
      Vittagems.deploy(ethers.ZeroAddress, pauser.address, minter.address, 3600)
    ).to.be.revertedWithCustomError(validDeploy, "InvalidAddress");
  });

  it("should revert with InvalidAddress('pauser') if pauser is zero address", async function () {
    const Vittagems = await ethers.getContractFactory("Vittagems");
    const [owner, , minter] = await ethers.getSigners();
    const validDeploy = await Vittagems.deploy(
      owner.address, owner.address, minter.address, 3600
    );
    await expect(
      Vittagems.deploy(owner.address, ethers.ZeroAddress, minter.address, 3600)
    ).to.be.revertedWithCustomError(validDeploy, "InvalidAddress");
  });

  it("should revert with InvalidAddress('minter') if minter is zero address", async function () {
    const Vittagems = await ethers.getContractFactory("Vittagems");
    const [owner, pauser] = await ethers.getSigners();
    const validDeploy = await Vittagems.deploy(
      owner.address, pauser.address, owner.address, 3600
    );
    await expect(
      Vittagems.deploy(owner.address, pauser.address, ethers.ZeroAddress, 3600)
    ).to.be.revertedWithCustomError(validDeploy, "InvalidAddress");
  });

  it("should allow staleness threshold of 0 (disabled)", async function () {
    const Vittagems = await ethers.getContractFactory("Vittagems");
    const [owner, pauser, minter] = await ethers.getSigners();
    const token = await Vittagems.deploy(
      owner.address,
      pauser.address,
      minter.address,
      0
    );
    expect(await token.reserveStalenessThreshold()).to.equal(0);
  });

  it("should have EIP-712 domain correctly set", async function () {
    const { token } = await loadFixture(deployVittagemsFixture);
    // ERC20Permit domain name should match token name
    const eip712Domain = await token.eip712Domain();
    expect(eip712Domain.name).to.equal("Vittagems");
  });
});

// ============================================================
// ORACLE MANAGEMENT TESTS
// ============================================================
describe("Vittagems - Oracle Management", function () {
  /**
   * WHY: The oracle is critical infrastructure. We must verify
   * the set/lock lifecycle works correctly and cannot be bypassed.
   */

  describe("setReserveOracle()", function () {
    it("should allow admin to set oracle before locking", async function () {
      const { token, owner } = await loadFixture(
        deployVittagemsNoOracleFixture
      );
      const oracle = await deployMockOracle(ONE_ETHER);
      const oracleAddr = await oracle.getAddress();

      await expect(token.connect(owner).setReserveOracle(oracleAddr))
        .to.emit(token, "ReserveOracleSet")
        .withArgs(oracleAddr);

      expect(await token.reserveOracle()).to.equal(oracleAddr);
    });

    it("should allow admin to update oracle multiple times before locking", async function () {
      const { token, owner } = await loadFixture(
        deployVittagemsNoOracleFixture
      );
      const oracle1 = await deployMockOracle(ONE_ETHER);
      const oracle2 = await deployMockOracle(ONE_ETHER * 2n);

      await token.connect(owner).setReserveOracle(await oracle1.getAddress());
      await token.connect(owner).setReserveOracle(await oracle2.getAddress());

      expect(await token.reserveOracle()).to.equal(await oracle2.getAddress());
    });

    /**
     * SECURITY: Non-admin should never be able to change oracle.
     * An attacker controlling the oracle controls minting capacity.
     */
    it("should revert if non-admin tries to set oracle", async function () {
      const { token, attacker } = await loadFixture(
        deployVittagemsNoOracleFixture
      );
      const oracle = await deployMockOracle(ONE_ETHER);

      await expect(
        token.connect(attacker).setReserveOracle(await oracle.getAddress())
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("should revert with InvalidAddress if oracle is zero address", async function () {
      const { token, owner } = await loadFixture(
        deployVittagemsNoOracleFixture
      );
      await expect(
        token.connect(owner).setReserveOracle(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(token, "InvalidAddress");
    });

    /**
     * SECURITY: Once locked, oracle MUST NOT be changeable under any circumstances.
     */
    it("should revert with OracleAlreadyLocked if trying to set oracle after lock", async function () {
      const { token, owner, oracle } = await loadFixture(deployVittagemsFixture);
      const newOracle = await deployMockOracle(ONE_ETHER);

      await expect(
        token.connect(owner).setReserveOracle(await newOracle.getAddress())
      ).to.be.revertedWithCustomError(token, "OracleAlreadyLocked");
    });

    it("should emit ReserveOracleSet event with correct address", async function () {
      const { token, owner } = await loadFixture(
        deployVittagemsNoOracleFixture
      );
      const oracle = await deployMockOracle(ONE_ETHER);
      const oracleAddr = await oracle.getAddress();

      await expect(token.connect(owner).setReserveOracle(oracleAddr))
        .to.emit(token, "ReserveOracleSet")
        .withArgs(oracleAddr);
    });
  });

  describe("lockReserveOracle()", function () {
    it("should allow admin to lock oracle", async function () {
      const { token, owner } = await loadFixture(
        deployVittagemsOracleNotLockedFixture
      );

      expect(await token.reserveOracleLocked()).to.be.false;
      await token.connect(owner).lockReserveOracle();
      expect(await token.reserveOracleLocked()).to.be.true;
    });

    it("should emit ReserveOracleLocked with correct address", async function () {
      const { token, owner, oracle } = await loadFixture(
        deployVittagemsOracleNotLockedFixture
      );
      const oracleAddr = await oracle.getAddress();

      await expect(token.connect(owner).lockReserveOracle())
        .to.emit(token, "ReserveOracleLocked")
        .withArgs(oracleAddr);
    });

    /**
     * SECURITY: Cannot lock without oracle - prevents bricking the contract.
     */
    it("should revert with ReserveOracleNotSet if oracle not set before locking", async function () {
      const { token, owner } = await loadFixture(
        deployVittagemsNoOracleFixture
      );
      await expect(
        token.connect(owner).lockReserveOracle()
      ).to.be.revertedWithCustomError(token, "ReserveOracleNotSet");
    });

    /**
     * SECURITY: Double-lock attempt must fail.
     */
    it("should revert with OracleAlreadyLocked if already locked", async function () {
      const { token, owner } = await loadFixture(deployVittagemsFixture);
      await expect(
        token.connect(owner).lockReserveOracle()
      ).to.be.revertedWithCustomError(token, "OracleAlreadyLocked");
    });

    it("should revert if non-admin tries to lock oracle", async function () {
      const { token, attacker } = await loadFixture(
        deployVittagemsOracleNotLockedFixture
      );
      await expect(
        token.connect(attacker).lockReserveOracle()
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });
});

// ============================================================
// RESERVE VIEW FUNCTIONS TESTS
// ============================================================
describe("Vittagems - Reserve View Functions", function () {
  /**
   * WHY: View functions feed into minting logic. Incorrect readings
   * could allow over-minting or block legitimate minting.
   */

  describe("getReserveValue()", function () {
    it("should return 0 when oracle is not set", async function () {
      const { token } = await loadFixture(deployVittagemsNoOracleFixture);
      expect(await token.getReserveValue()).to.equal(0);
    });

    it("should return correct reserve value from oracle", async function () {
      const { token, oracle, initialReserve } = await loadFixture(
        deployVittagemsFixture
      );
      expect(await token.getReserveValue()).to.equal(initialReserve);
    });

    it("should reflect updated reserve value after oracle update", async function () {
      const { token, oracle } = await loadFixture(deployVittagemsFixture);
      const newReserve = ethers.parseEther("2000000");
      await oracle.setReserve(newReserve);
      expect(await token.getReserveValue()).to.equal(newReserve);
    });

    it("should return 0 when oracle reserve is 0", async function () {
      const { token, oracle } = await loadFixture(deployVittagemsFixture);
      await oracle.setReserve(0);
      expect(await token.getReserveValue()).to.equal(0);
    });
  });

  describe("getReserveLastUpdated()", function () {
    it("should return 0 when oracle is not set", async function () {
      const { token } = await loadFixture(deployVittagemsNoOracleFixture);
      expect(await token.getReserveLastUpdated()).to.equal(0);
    });

    it("should return correct lastUpdatedAt from oracle", async function () {
      const { token, oracle } = await loadFixture(deployVittagemsFixture);
      const latestTime = await time.latest();
      // Oracle was deployed at current time; should be close
      const lastUpdated = await token.getReserveLastUpdated();
      expect(lastUpdated).to.be.closeTo(BigInt(latestTime), 5n);
    });

    it("should reflect updated timestamp after oracle update", async function () {
      const { token, oracle } = await loadFixture(deployVittagemsFixture);
      const newTime = 1000000;
      await oracle.setLastUpdatedAt(newTime);
      expect(await token.getReserveLastUpdated()).to.equal(newTime);
    });
  });

  describe("isReserveFresh()", function () {
    it("should return true when staleness threshold is 0 (disabled)", async function () {
      const { token } = await loadFixture(deployVittagemsNoStalenessFixture);
      expect(await token.isReserveFresh()).to.be.true;
    });

    it("should return false when oracle is not set and threshold > 0", async function () {
      const { token } = await loadFixture(deployVittagemsNoOracleFixture);
      expect(await token.isReserveFresh()).to.be.false;
    });

    it("should return true when data is fresh within threshold", async function () {
      const { token } = await loadFixture(deployVittagemsFixture);
      // Oracle lastUpdatedAt was just set; should be fresh
      expect(await token.isReserveFresh()).to.be.true;
    });

    it("should return false when data is stale (beyond threshold)", async function () {
      const { token, oracle, stalenessThreshold } = await loadFixture(
        deployVittagemsFixture
      );

      // Advance time beyond threshold
      await time.increase(stalenessThreshold + 1);
      expect(await token.isReserveFresh()).to.be.false;
    });

    it("should return false when lastUpdatedAt is 0", async function () {
      const { token, oracle } = await loadFixture(deployVittagemsFixture);
      await oracle.makeStale(); // sets lastUpdatedAt to 0
      expect(await token.isReserveFresh()).to.be.false;
    });

    it("should return true exactly AT the staleness boundary", async function () {
      const { token, oracle, stalenessThreshold } = await loadFixture(
        deployVittagemsFixture
      );
      // Set oracle update time to now
      await oracle.makeFresh();
      // Advance exactly to threshold
      await time.increase(stalenessThreshold);
      expect(await token.isReserveFresh()).to.be.true;
    });

    it("should return false one second past the staleness boundary", async function () {
      const { token, oracle, stalenessThreshold } = await loadFixture(
        deployVittagemsFixture
      );
      await oracle.makeFresh();
      await time.increase(stalenessThreshold + 1);
      expect(await token.isReserveFresh()).to.be.false;
    });
  });

  describe("mintableAmount()", function () {
    it("should return 0 when data is stale", async function () {
      const { token, oracle, stalenessThreshold } = await loadFixture(
        deployVittagemsFixture
      );
      await time.increase(stalenessThreshold + 1);
      expect(await token.mintableAmount()).to.equal(0);
    });

    it("should return reserve-capped amount when reserve < max supply gap", async function () {
      const { token, oracle, initialReserve } = await loadFixture(
        deployVittagemsFixture
      );
      // total supply = 0, reserve = 1M tokens → mintable = 1M
      expect(await token.mintableAmount()).to.equal(initialReserve);
    });

    it("should return max supply cap when reserve > remaining max supply", async function () {
      // Deploy with very large reserve > MAX_SUPPLY
      const [owner, pauser, minter] = await ethers.getSigners();
      const hugeReserve = MAX_SUPPLY + ethers.parseEther("1000");
      const oracle = await deployMockOracle(hugeReserve);

      const Vittagems = await ethers.getContractFactory("Vittagems");
      const token = await Vittagems.deploy(
        owner.address,
        pauser.address,
        minter.address,
        0 // no staleness
      );
      await token.connect(owner).setReserveOracle(await oracle.getAddress());
      await token.connect(owner).lockReserveOracle();

      // mintable should be capped at MAX_SUPPLY (total supply is 0)
      expect(await token.mintableAmount()).to.equal(MAX_SUPPLY);
    });

    it("should return 0 when reserve equals current total supply", async function () {
      const { token, oracle, minter, user } = await loadFixture(
        deployVittagemsFixture
      );
      // Mint up to reserve level
      const mintAmount = ethers.parseEther("1000000");
      await oracle.setReserve(mintAmount);
      await oracle.makeFresh();
      await token.connect(minter).mint(user.address, mintAmount);

      // Now totalSupply == reserve → mintable = 0
      expect(await token.mintableAmount()).to.equal(0);
    });

    it("should correctly reduce mintable amount after minting", async function () {
      const { token, oracle, minter, user, initialReserve } = await loadFixture(
        deployVittagemsFixture
      );
      const mintAmount = ethers.parseEther("100000");
      await token.connect(minter).mint(user.address, mintAmount);

      const expected = initialReserve - mintAmount;
      expect(await token.mintableAmount()).to.equal(expected);
    });

    it("should return 0 when staleness threshold is 0 but oracle not set", async function () {
      // Even with threshold=0, if no oracle, reserve = 0 → mintable = 0
      const Vittagems = await ethers.getContractFactory("Vittagems");
      const [owner, pauser, minter] = await ethers.getSigners();
      const token = await Vittagems.deploy(
        owner.address, pauser.address, minter.address, 0
      );
      // No oracle set → getReserveValue() returns 0 → reserveCap = 0
      expect(await token.mintableAmount()).to.equal(0);
    });
  });
});

// ============================================================
// MINTING TESTS
// ============================================================
describe("Vittagems - Minting", function () {
  /**
   * WHY: Minting is the most sensitive operation. It must enforce
   * supply cap, oracle freshness, and reserve backing at all times.
   */

  describe("mint() - Positive Cases", function () {
    it("should mint tokens to recipient address", async function () {
      const { token, minter, user } = await loadFixture(deployVittagemsFixture);
      const amount = ethers.parseEther("1000");

      await token.connect(minter).mint(user.address, amount);
      expect(await token.balanceOf(user.address)).to.equal(amount);
    });

    it("should increase totalSupply after minting", async function () {
      const { token, minter, user } = await loadFixture(deployVittagemsFixture);
      const amount = ethers.parseEther("5000");

      await token.connect(minter).mint(user.address, amount);
      expect(await token.totalSupply()).to.equal(amount);
    });

    it("should emit MintWithReserveCheck event with correct parameters", async function () {
      const { token, minter, user, oracle, initialReserve } = await loadFixture(
        deployVittagemsFixture
      );
      const amount = ethers.parseEther("1000");

      await expect(token.connect(minter).mint(user.address, amount))
        .to.emit(token, "MintWithReserveCheck")
        .withArgs(user.address, amount, amount, initialReserve);
    });

    it("should emit Transfer event from zero address", async function () {
      const { token, minter, user } = await loadFixture(deployVittagemsFixture);
      const amount = ethers.parseEther("1000");

      await expect(token.connect(minter).mint(user.address, amount))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, user.address, amount);
    });

    it("should mint exactly at MAX_SUPPLY (boundary)", async function () {
      // Deploy with huge reserve matching MAX_SUPPLY
      const [owner, pauser, minter, user] = await ethers.getSigners();
      const oracle = await deployMockOracle(MAX_SUPPLY);

      const Vittagems = await ethers.getContractFactory("Vittagems");
      const token = await Vittagems.deploy(
        owner.address, pauser.address, minter.address, 0
      );
      await token.connect(owner).setReserveOracle(await oracle.getAddress());
      await token.connect(owner).lockReserveOracle();

      await token.connect(minter).mint(user.address, MAX_SUPPLY);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    });

    it("should allow minting 1 wei (minimum amount)", async function () {
      const { token, minter, user } = await loadFixture(deployVittagemsFixture);
      await token.connect(minter).mint(user.address, 1n);
      expect(await token.balanceOf(user.address)).to.equal(1n);
    });

    it("should allow minting to contract address", async function () {
      const { token, minter } = await loadFixture(deployVittagemsFixture);
      const tokenAddr = await token.getAddress();
      await token.connect(minter).mint(tokenAddr, ethers.parseEther("100"));
      expect(await token.balanceOf(tokenAddr)).to.equal(ethers.parseEther("100"));
    });

    it("should allow multiple mints that collectively stay within reserve", async function () {
      const { token, minter, user, alice, oracle } = await loadFixture(
        deployVittagemsFixture
      );
      // Reserve = 1M; mint 400K + 400K = 800K < 1M
      const amount = ethers.parseEther("400000");
      await token.connect(minter).mint(user.address, amount);
      await token.connect(minter).mint(alice.address, amount);
      expect(await token.totalSupply()).to.equal(amount * 2n);
    });

    it("should work when staleness threshold is 0 (disabled)", async function () {
      const { token, minter, user, oracle } = await loadFixture(
        deployVittagemsNoStalenessFixture
      );
      // Even with stale timestamp, should work
      await oracle.makeStale();
      const amount = ethers.parseEther("100");
      await token.connect(minter).mint(user.address, amount);
      expect(await token.balanceOf(user.address)).to.equal(amount);
    });
  });

  describe("mint() - Negative Cases", function () {
    /**
     * SECURITY: Non-minter should never mint. Role check is the first
     * line of defense against unauthorized token creation.
     */
    it("should revert if caller lacks MINTER_ROLE", async function () {
      const { token, attacker, user } = await loadFixture(
        deployVittagemsFixture
      );
      await expect(
        token.connect(attacker).mint(user.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("should revert if admin (without MINTER_ROLE) tries to mint", async function () {
      const { token, owner, user } = await loadFixture(deployVittagemsFixture);
      await expect(
        token.connect(owner).mint(user.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    /**
     * SECURITY: Minting without oracle set is a critical guard.
     * Without this check, there's no reserve backing validation.
     */
    it("should revert with ReserveOracleNotSet if oracle not set", async function () {
      const { token, minter, user } = await loadFixture(
        deployVittagemsNoOracleFixture
      );
      await expect(
        token.connect(minter).mint(user.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "ReserveOracleNotSet");
    });

    /**
     * SECURITY: Hard cap enforcement is absolute.
     * Minting beyond MAX_SUPPLY must ALWAYS revert.
     */
    it("should revert with MaxSupplyExceeded when exceeding MAX_SUPPLY", async function () {
      const [owner, pauser, minter, user] = await ethers.getSigners();
      const hugeReserve = MAX_SUPPLY + ethers.parseEther("1");
      const oracle = await deployMockOracle(hugeReserve);

      const Vittagems = await ethers.getContractFactory("Vittagems");
      const token = await Vittagems.deploy(
        owner.address, pauser.address, minter.address, 0
      );
      await token.connect(owner).setReserveOracle(await oracle.getAddress());
      await token.connect(owner).lockReserveOracle();

      const overAmount = MAX_SUPPLY + 1n;
      await expect(
        token.connect(minter).mint(user.address, overAmount)
      ).to.be.revertedWithCustomError(token, "MaxSupplyExceeded");
    });

    it("should revert MaxSupplyExceeded with correct arguments", async function () {
      const [owner, pauser, minter, user] = await ethers.getSigners();
      const hugeReserve = MAX_SUPPLY + ethers.parseEther("100");
      const oracle = await deployMockOracle(hugeReserve);

      const Vittagems = await ethers.getContractFactory("Vittagems");
      const token = await Vittagems.deploy(
        owner.address, pauser.address, minter.address, 0
      );
      await token.connect(owner).setReserveOracle(await oracle.getAddress());
      await token.connect(owner).lockReserveOracle();

      const overAmount = MAX_SUPPLY + 1n;
      await expect(
        token.connect(minter).mint(user.address, overAmount)
      )
        .to.be.revertedWithCustomError(token, "MaxSupplyExceeded")
        .withArgs(overAmount, MAX_SUPPLY);
    });

    /**
     * SECURITY: Stale reserve data must block minting.
     * An outdated reserve could be artificially inflated.
     */
    it("should revert with ReserveDataStale when data is beyond threshold", async function () {
      const { token, minter, user, oracle, stalenessThreshold } =
        await loadFixture(deployVittagemsFixture);

      // Advance time past the staleness threshold
      await time.increase(stalenessThreshold + 1);

      await expect(
        token.connect(minter).mint(user.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "ReserveDataStale");
    });

    it("should revert with ReserveDataStale when lastUpdatedAt is 0", async function () {
      const { token, minter, user, oracle } = await loadFixture(
        deployVittagemsFixture
      );
      await oracle.makeStale(); // sets lastUpdatedAt = 0

      await expect(
        token.connect(minter).mint(user.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "ReserveDataStale");
    });

    /**
     * SECURITY: Reserve backing is the core invariant.
     * Total supply must NEVER exceed reserve value.
     */
    it("should revert with ReserveInsufficient when amount exceeds reserve", async function () {
      const { token, minter, user, oracle } = await loadFixture(
        deployVittagemsFixture
      );
      // Reserve is 1M tokens, try to mint 2M
      const overAmount = ethers.parseEther("2000000");

      await expect(
        token.connect(minter).mint(user.address, overAmount)
      ).to.be.revertedWithCustomError(token, "ReserveInsufficient");
    });

    it("should revert ReserveInsufficient with correct arguments", async function () {
      const { token, minter, user, oracle, initialReserve } = await loadFixture(
        deployVittagemsFixture
      );
      const overAmount = initialReserve + 1n;

      await expect(
        token.connect(minter).mint(user.address, overAmount)
      )
        .to.be.revertedWithCustomError(token, "ReserveInsufficient")
        .withArgs(overAmount, initialReserve);
    });

    it("should revert when minting makes totalSupply exactly equal to reserve + 1", async function () {
      const { token, minter, user, oracle, initialReserve } = await loadFixture(
        deployVittagemsFixture
      );
      // First mint up to reserve
      await token.connect(minter).mint(user.address, initialReserve);
      // Now try to mint 1 more token
      await oracle.setReserve(initialReserve); // keep reserve same
      await oracle.makeFresh();

      await expect(
        token.connect(minter).mint(user.address, 1n)
      ).to.be.revertedWithCustomError(token, "ReserveInsufficient");
    });

    it("should revert when paused", async function () {
      const { token, minter, pauser, user } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(pauser).pause();

      await expect(
        token.connect(minter).mint(user.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    /**
     * EDGE CASE: Minting 0 amount - this should technically succeed
     * (ERC20 standard allows 0-amount transfers) but verify behavior.
     */
    it("should handle minting 0 amount (no-op but valid)", async function () {
      const { token, minter, user } = await loadFixture(deployVittagemsFixture);
      // 0 amount: newTotal = 0, reserve = 1M, so no revert expected
      await token.connect(minter).mint(user.address, 0);
      expect(await token.balanceOf(user.address)).to.equal(0);
    });
  });
});

// ============================================================
// PAUSE/UNPAUSE TESTS
// ============================================================
describe("Vittagems - Pause/Unpause", function () {
  /**
   * WHY: Pause functionality is a critical circuit breaker.
   * Must only be callable by authorized roles and must block ALL transfers.
   */

  describe("pause()", function () {
    it("should pause the contract when called by pauser", async function () {
      const { token, pauser } = await loadFixture(deployVittagemsFixture);
      await token.connect(pauser).pause();
      expect(await token.paused()).to.be.true;
    });

    it("should emit Paused event", async function () {
      const { token, pauser } = await loadFixture(deployVittagemsFixture);
      await expect(token.connect(pauser).pause())
        .to.emit(token, "Paused")
        .withArgs(pauser.address);
    });

    it("should revert if non-pauser tries to pause", async function () {
      const { token, attacker } = await loadFixture(deployVittagemsFixture);
      await expect(
        token.connect(attacker).pause()
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("should revert if already paused", async function () {
      const { token, pauser } = await loadFixture(deployVittagemsFixture);
      await token.connect(pauser).pause();
      await expect(
        token.connect(pauser).pause()
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("should block transfers when paused", async function () {
      const { token, pauser, minter, user, alice } = await loadFixture(
        deployVittagemsFixture
      );
      // Mint some tokens first
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(pauser).pause();

      await expect(
        token.connect(user).transfer(alice.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("should block burning when paused", async function () {
      const { token, pauser, minter, user } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(pauser).pause();

      await expect(
        token.connect(user).burn(ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("should block minting when paused", async function () {
      const { token, pauser, minter, user } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(pauser).pause();

      await expect(
        token.connect(minter).mint(user.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });
  });

  describe("unpause()", function () {
    it("should unpause the contract when called by pauser", async function () {
      const { token, pauser } = await loadFixture(deployVittagemsFixture);
      await token.connect(pauser).pause();
      await token.connect(pauser).unpause();
      expect(await token.paused()).to.be.false;
    });

    it("should emit Unpaused event", async function () {
      const { token, pauser } = await loadFixture(deployVittagemsFixture);
      await token.connect(pauser).pause();
      await expect(token.connect(pauser).unpause())
        .to.emit(token, "Unpaused")
        .withArgs(pauser.address);
    });

    it("should revert if non-pauser tries to unpause", async function () {
      const { token, pauser, attacker } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(pauser).pause();
      await expect(
        token.connect(attacker).unpause()
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("should revert if already unpaused", async function () {
      const { token, pauser } = await loadFixture(deployVittagemsFixture);
      await expect(
        token.connect(pauser).unpause()
      ).to.be.revertedWithCustomError(token, "ExpectedPause");
    });

    it("should allow minting after unpause", async function () {
      const { token, pauser, minter, user } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(pauser).pause();
      await token.connect(pauser).unpause();
      await token.connect(minter).mint(user.address, ONE_ETHER);
      expect(await token.balanceOf(user.address)).to.equal(ONE_ETHER);
    });

    it("should allow transfers after unpause", async function () {
      const { token, pauser, minter, user, alice } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(pauser).pause();
      await token.connect(pauser).unpause();
      await token.connect(user).transfer(alice.address, ONE_ETHER);
      expect(await token.balanceOf(alice.address)).to.equal(ONE_ETHER);
    });
  });
});

// ============================================================
// STALENESS THRESHOLD TESTS
// ============================================================
describe("Vittagems - Staleness Threshold Management", function () {
  /**
   * WHY: The staleness threshold directly gates minting.
   * Only admin should be able to modify it.
   */

  it("should allow admin to update staleness threshold", async function () {
    const { token, owner } = await loadFixture(deployVittagemsFixture);
    const newThreshold = 7200;

    await token.connect(owner).setStalenessThreshold(newThreshold);
    expect(await token.reserveStalenessThreshold()).to.equal(newThreshold);
  });

  it("should emit StalenessThresholdUpdated with old and new values", async function () {
    const { token, owner, stalenessThreshold } = await loadFixture(
      deployVittagemsFixture
    );
    const newThreshold = 7200;

    await expect(token.connect(owner).setStalenessThreshold(newThreshold))
      .to.emit(token, "StalenessThresholdUpdated")
      .withArgs(stalenessThreshold, newThreshold);
  });

  it("should revert if non-admin tries to update staleness threshold", async function () {
    const { token, attacker } = await loadFixture(deployVittagemsFixture);
    await expect(
      token.connect(attacker).setStalenessThreshold(7200)
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("should allow setting staleness threshold to 0 (disable check)", async function () {
    const { token, owner } = await loadFixture(deployVittagemsFixture);
    await token.connect(owner).setStalenessThreshold(0);
    expect(await token.reserveStalenessThreshold()).to.equal(0);
    // And minting with stale data should now work
    expect(await token.isReserveFresh()).to.be.true;
  });

  it("should correctly gate minting after threshold change", async function () {
    const { token, owner, minter, user, oracle } = await loadFixture(
      deployVittagemsFixture
    );
    // Advance time so current threshold (3600s) would reject
    await time.increase(3700);

    // With old threshold (3600s), would fail:
    await expect(
      token.connect(minter).mint(user.address, ONE_ETHER)
    ).to.be.revertedWithCustomError(token, "ReserveDataStale");

    // Increase threshold to 10000s and update oracle
    await token.connect(owner).setStalenessThreshold(10000);
    // But we still need to update oracle's timestamp for it to be fresh
    await oracle.makeFresh();

    await token.connect(minter).mint(user.address, ONE_ETHER);
    expect(await token.balanceOf(user.address)).to.equal(ONE_ETHER);
  });

  it("should allow pauser to update staleness threshold (admin only - should fail)", async function () {
    const { token, pauser } = await loadFixture(deployVittagemsFixture);
    // Pauser does NOT have admin role, should revert
    await expect(
      token.connect(pauser).setStalenessThreshold(9999)
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("should allow minter to update staleness threshold (admin only - should fail)", async function () {
    const { token, minter } = await loadFixture(deployVittagemsFixture);
    await expect(
      token.connect(minter).setStalenessThreshold(9999)
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });
});

// ============================================================
// ERC20 TRANSFER/APPROVAL TESTS
// ============================================================
describe("Vittagems - ERC20 Transfer & Approval", function () {
  /**
   * WHY: Core ERC20 functionality must work correctly.
   * Errors here would break integrations with DEXes, wallets, etc.
   */

  describe("transfer()", function () {
    it("should transfer tokens between accounts", async function () {
      const { token, minter, user, alice } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(user).transfer(alice.address, ONE_ETHER);
      expect(await token.balanceOf(alice.address)).to.equal(ONE_ETHER);
      expect(await token.balanceOf(user.address)).to.equal(0);
    });

    it("should emit Transfer event", async function () {
      const { token, minter, user, alice } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);

      await expect(token.connect(user).transfer(alice.address, ONE_ETHER))
        .to.emit(token, "Transfer")
        .withArgs(user.address, alice.address, ONE_ETHER);
    });

    it("should revert on insufficient balance", async function () {
      const { token, user, alice } = await loadFixture(deployVittagemsFixture);
      await expect(
        token.connect(user).transfer(alice.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("should revert on transfer to zero address", async function () {
      const { token, minter, user } = await loadFixture(deployVittagemsFixture);
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await expect(
        token.connect(user).transfer(ethers.ZeroAddress, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
    });

    it("should allow transfer of 0 amount", async function () {
      const { token, user, alice } = await loadFixture(deployVittagemsFixture);
      await expect(token.connect(user).transfer(alice.address, 0)).to.not.be
        .reverted;
    });
  });

  describe("approve() + transferFrom()", function () {
    it("should set allowance correctly", async function () {
      const { token, user, alice } = await loadFixture(deployVittagemsFixture);
      await token.connect(user).approve(alice.address, ONE_ETHER);
      expect(await token.allowance(user.address, alice.address)).to.equal(
        ONE_ETHER
      );
    });

    it("should emit Approval event", async function () {
      const { token, user, alice } = await loadFixture(deployVittagemsFixture);
      await expect(token.connect(user).approve(alice.address, ONE_ETHER))
        .to.emit(token, "Approval")
        .withArgs(user.address, alice.address, ONE_ETHER);
    });

    it("should allow transferFrom after approval", async function () {
      const { token, minter, user, alice, bob } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(user).approve(alice.address, ONE_ETHER);
      await token.connect(alice).transferFrom(user.address, bob.address, ONE_ETHER);
      expect(await token.balanceOf(bob.address)).to.equal(ONE_ETHER);
    });

    it("should decrease allowance after transferFrom", async function () {
      const { token, minter, user, alice, bob } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(user).approve(alice.address, ONE_ETHER);
      await token
        .connect(alice)
        .transferFrom(user.address, bob.address, ONE_ETHER / 2n);
      expect(await token.allowance(user.address, alice.address)).to.equal(
        ONE_ETHER / 2n
      );
    });

    it("should revert on insufficient allowance", async function () {
      const { token, minter, user, alice, bob } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(user).approve(alice.address, ONE_ETHER / 2n);

      await expect(
        token
          .connect(alice)
          .transferFrom(user.address, bob.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("should revert on approve to zero address", async function () {
      const { token, user } = await loadFixture(deployVittagemsFixture);
      await expect(
        token.connect(user).approve(ethers.ZeroAddress, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "ERC20InvalidSpender");
    });
  });
});

// ============================================================
// BURN TESTS
// ============================================================
describe("Vittagems - Burn", function () {
  /**
   * WHY: Burning reduces supply. Must maintain correct accounting
   * and only allow the token holder (or approved spender) to burn.
   */

  describe("burn()", function () {
    it("should allow token holder to burn their own tokens", async function () {
      const { token, minter, user } = await loadFixture(deployVittagemsFixture);
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(user).burn(ONE_ETHER);
      expect(await token.balanceOf(user.address)).to.equal(0);
    });

    it("should decrease totalSupply after burn", async function () {
      const { token, minter, user } = await loadFixture(deployVittagemsFixture);
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(user).burn(ONE_ETHER);
      expect(await token.totalSupply()).to.equal(0);
    });

    it("should emit Transfer event to zero address on burn", async function () {
      const { token, minter, user } = await loadFixture(deployVittagemsFixture);
      await token.connect(minter).mint(user.address, ONE_ETHER);

      await expect(token.connect(user).burn(ONE_ETHER))
        .to.emit(token, "Transfer")
        .withArgs(user.address, ethers.ZeroAddress, ONE_ETHER);
    });

    it("should revert burn if insufficient balance", async function () {
      const { token, user } = await loadFixture(deployVittagemsFixture);
      await expect(
        token.connect(user).burn(ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("should revert burn when paused", async function () {
      const { token, minter, pauser, user } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(pauser).pause();

      await expect(
        token.connect(user).burn(ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });
  });

  describe("burnFrom()", function () {
    it("should allow approved spender to burn tokens", async function () {
      const { token, minter, user, alice } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(user).approve(alice.address, ONE_ETHER);
      await token.connect(alice).burnFrom(user.address, ONE_ETHER);
      expect(await token.balanceOf(user.address)).to.equal(0);
    });

    it("should revert burnFrom without allowance", async function () {
      const { token, minter, user, alice } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);

      await expect(
        token.connect(alice).burnFrom(user.address, ONE_ETHER)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("should decrease allowance after burnFrom", async function () {
      const { token, minter, user, alice } = await loadFixture(
        deployVittagemsFixture
      );
      await token.connect(minter).mint(user.address, ONE_ETHER);
      await token.connect(user).approve(alice.address, ONE_ETHER);
      await token.connect(alice).burnFrom(user.address, ONE_ETHER / 2n);
      expect(await token.allowance(user.address, alice.address)).to.equal(
        ONE_ETHER / 2n
      );
    });
  });
});

// ============================================================
// ERC20 PERMIT TESTS
// ============================================================
describe("Vittagems - ERC20Permit", function () {
  /**
   * WHY: ERC20Permit enables gasless approvals via signatures.
   * We must verify signature validation and deadline enforcement.
   */

  it("should allow permit-based approval with valid signature", async function () {
    const { token, user, alice } = await loadFixture(deployVittagemsFixture);
    const deadline = (await time.latest()) + 3600;
    const nonce = await token.nonces(user.address);

    const sig = await signPermit(
      token,
      user,
      alice,
      ONE_ETHER,
      deadline,
      nonce
    );

    await token.permit(
      user.address,
      alice.address,
      ONE_ETHER,
      deadline,
      sig.v,
      sig.r,
      sig.s
    );

    expect(await token.allowance(user.address, alice.address)).to.equal(
      ONE_ETHER
    );
  });

  it("should emit Approval event on permit", async function () {
    const { token, user, alice } = await loadFixture(deployVittagemsFixture);
    const deadline = (await time.latest()) + 3600;
    const nonce = await token.nonces(user.address);
    const sig = await signPermit(token, user, alice, ONE_ETHER, deadline, nonce);

    await expect(
      token.permit(
        user.address,
        alice.address,
        ONE_ETHER,
        deadline,
        sig.v,
        sig.r,
        sig.s
      )
    )
      .to.emit(token, "Approval")
      .withArgs(user.address, alice.address, ONE_ETHER);
  });

  /**
   * SECURITY: Expired permit must be rejected to prevent replay attacks
   * with old signatures.
   */
  it("should revert on expired deadline", async function () {
    const { token, user, alice } = await loadFixture(deployVittagemsFixture);
    const deadline = (await time.latest()) - 1; // already expired
    const nonce = await token.nonces(user.address);
    const sig = await signPermit(token, user, alice, ONE_ETHER, deadline, nonce);

    await expect(
      token.permit(
        user.address,
        alice.address,
        ONE_ETHER,
        deadline,
        sig.v,
        sig.r,
        sig.s
      )
    ).to.be.revertedWithCustomError(token, "ERC2612ExpiredSignature");
  });

  /**
   * SECURITY: Wrong signer must be rejected to prevent signature forgery.
   */
  it("should revert on invalid signature (wrong signer)", async function () {
    const { token, user, alice, attacker } = await loadFixture(
      deployVittagemsFixture
    );
    const deadline = (await time.latest()) + 3600;
    const nonce = await token.nonces(user.address);

    // Attacker signs instead of user
    const sig = await signPermit(
      token,
      attacker,
      alice,
      ONE_ETHER,
      deadline,
      nonce
    );

    await expect(
      token.permit(
        user.address, // claiming it's user's approval
        alice.address,
        ONE_ETHER,
        deadline,
        sig.v,
        sig.r,
        sig.s
      )
    ).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");
  });

  it("should increment nonce after permit", async function () {
    const { token, user, alice } = await loadFixture(deployVittagemsFixture);
    const deadline = (await time.latest()) + 3600;
    const nonce = await token.nonces(user.address);
    const sig = await signPermit(token, user, alice, ONE_ETHER, deadline, nonce);

    await token.permit(
      user.address,
      alice.address,
      ONE_ETHER,
      deadline,
      sig.v,
      sig.r,
      sig.s
    );

    expect(await token.nonces(user.address)).to.equal(nonce + 1n);
  });

  /**
   * SECURITY: Same signature cannot be reused (replay attack prevention via nonce).
   */
  it("should revert on permit replay attack (nonce reuse)", async function () {
    const { token, user, alice } = await loadFixture(deployVittagemsFixture);
    const deadline = (await time.latest()) + 7200;
    const nonce = await token.nonces(user.address);
    const sig = await signPermit(token, user, alice, ONE_ETHER, deadline, nonce);

    // First use succeeds
    await token.permit(
      user.address,
      alice.address,
      ONE_ETHER,
      deadline,
      sig.v,
      sig.r,
      sig.s
    );

    // Replay must fail
    await expect(
      token.permit(
        user.address,
        alice.address,
        ONE_ETHER,
        deadline,
        sig.v,
        sig.r,
        sig.s
      )
    ).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");
  });
});

// ============================================================
// ACCESS CONTROL TESTS
// ============================================================
describe("Vittagems - Access Control", function () {
  /**
   * WHY: Role-based access control is a primary security mechanism.
   * Every protected function must reject unauthorized callers.
   */

  it("should allow admin to grant MINTER_ROLE", async function () {
    const { token, owner, alice } = await loadFixture(deployVittagemsFixture);
    await token.connect(owner).grantRole(MINTER_ROLE, alice.address);
    expect(await token.hasRole(MINTER_ROLE, alice.address)).to.be.true;
  });

  it("should allow admin to revoke MINTER_ROLE", async function () {
    const { token, owner, minter } = await loadFixture(deployVittagemsFixture);
    await token.connect(owner).revokeRole(MINTER_ROLE, minter.address);
    expect(await token.hasRole(MINTER_ROLE, minter.address)).to.be.false;
  });

  it("should not allow non-admin to grant roles", async function () {
    const { token, attacker, alice } = await loadFixture(
      deployVittagemsFixture
    );
    await expect(
      token.connect(attacker).grantRole(MINTER_ROLE, alice.address)
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("should not allow minter to grant themselves admin", async function () {
    const { token, minter } = await loadFixture(deployVittagemsFixture);
    await expect(
      token.connect(minter).grantRole(DEFAULT_ADMIN_ROLE, minter.address)
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("should allow renouncing own role", async function () {
    const { token, minter } = await loadFixture(deployVittagemsFixture);
    await token.connect(minter).renounceRole(MINTER_ROLE, minter.address);
    expect(await token.hasRole(MINTER_ROLE, minter.address)).to.be.false;
  });

  it("should allow newly granted minter to mint", async function () {
    const { token, owner, alice, user, oracle } = await loadFixture(
      deployVittagemsFixture
    );
    await token.connect(owner).grantRole(MINTER_ROLE, alice.address);
    await token.connect(alice).mint(user.address, ONE_ETHER);
    expect(await token.balanceOf(user.address)).to.equal(ONE_ETHER);
  });

  it("should block revoked minter from minting", async function () {
    const { token, owner, minter, user } = await loadFixture(
      deployVittagemsFixture
    );
    await token.connect(owner).revokeRole(MINTER_ROLE, minter.address);

    await expect(
      token.connect(minter).mint(user.address, ONE_ETHER)
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("should allow admin to grant and revoke PAUSER_ROLE", async function () {
    const { token, owner, alice } = await loadFixture(deployVittagemsFixture);
    await token.connect(owner).grantRole(PAUSER_ROLE, alice.address);
    expect(await token.hasRole(PAUSER_ROLE, alice.address)).to.be.true;
    await token.connect(owner).revokeRole(PAUSER_ROLE, alice.address);
    expect(await token.hasRole(PAUSER_ROLE, alice.address)).to.be.false;
  });

  it("should correctly report role admin for MINTER_ROLE", async function () {
    const { token } = await loadFixture(deployVittagemsFixture);
    // MINTER_ROLE admin should be DEFAULT_ADMIN_ROLE
    expect(await token.getRoleAdmin(MINTER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
  });

  it("should correctly report role admin for PAUSER_ROLE", async function () {
    const { token } = await loadFixture(deployVittagemsFixture);
    expect(await token.getRoleAdmin(PAUSER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
  });
});

// ============================================================
// EDGE CASES AND BOUNDARY TESTS
// ============================================================
describe("Vittagems - Edge Cases & Boundaries", function () {
  /**
   * WHY: Edge cases at boundaries often reveal off-by-one errors
   * and unexpected state transitions.
   */

  it("should handle reserve exactly equal to MAX_SUPPLY", async function () {
    const [owner, pauser, minter, user] = await ethers.getSigners();
    const oracle = await deployMockOracle(MAX_SUPPLY);

    const Vittagems = await ethers.getContractFactory("Vittagems");
    const token = await Vittagems.deploy(
      owner.address, pauser.address, minter.address, 0
    );
    await token.connect(owner).setReserveOracle(await oracle.getAddress());
    await token.connect(owner).lockReserveOracle();

    // Should be able to mint exactly MAX_SUPPLY
    await token.connect(minter).mint(user.address, MAX_SUPPLY);
    expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    expect(await token.balanceOf(user.address)).to.equal(MAX_SUPPLY);
  });

  it("should have 0 mintableAmount when totalSupply == MAX_SUPPLY", async function () {
    const [owner, pauser, minter, user] = await ethers.getSigners();
    const oracle = await deployMockOracle(MAX_SUPPLY);

    const Vittagems = await ethers.getContractFactory("Vittagems");
    const token = await Vittagems.deploy(
      owner.address, pauser.address, minter.address, 0
    );
    await token.connect(owner).setReserveOracle(await oracle.getAddress());
    await token.connect(owner).lockReserveOracle();

    await token.connect(minter).mint(user.address, MAX_SUPPLY);
    expect(await token.mintableAmount()).to.equal(0);
  });

  /**
   * EDGE CASE: After burning, totalSupply < reserve, so minting should be possible again.
   */
  it("should allow minting after burning within reserve limits", async function () {
    const { token, minter, user, oracle, initialReserve } = await loadFixture(
      deployVittagemsFixture
    );
    // Mint full reserve
    await token.connect(minter).mint(user.address, initialReserve);
    // Burn half
    await token.connect(user).burn(initialReserve / 2n);
    // Update oracle freshness
    await oracle.makeFresh();

    // Now should be able to mint again up to reserve
    await token.connect(minter).mint(user.address, initialReserve / 2n);
    expect(await token.totalSupply()).to.equal(initialReserve);
  });

  /**
   * EDGE CASE: Reserve drops below current supply after minting.
   * Additional minting must be blocked.
   */
  it("should block minting when reserve drops below current supply", async function () {
    const { token, minter, user, oracle, initialReserve } = await loadFixture(
      deployVittagemsFixture
    );
    // Mint half the reserve
    await token.connect(minter).mint(user.address, initialReserve / 2n);
    
    // Oracle reserve drops below current supply
    await oracle.setReserve(initialReserve / 4n); // Less than current supply
    await oracle.makeFresh();

    await expect(
      token.connect(minter).mint(user.address, 1n)
    ).to.be.revertedWithCustomError(token, "ReserveInsufficient");
  });

  it("should handle very large staleness threshold (max uint256)", async function () {
    const { token, owner } = await loadFixture(deployVittagemsFixture);
    const maxUint256 = ethers.MaxUint256;
    await token.connect(owner).setStalenessThreshold(maxUint256);
    expect(await token.reserveStalenessThreshold()).to.equal(maxUint256);
  });

  it("should handle minting 1 wei multiple times", async function () {
    const { token, minter, user } = await loadFixture(deployVittagemsFixture);
    for (let i = 0; i < 5; i++) {
      await token.connect(minter).mint(user.address, 1n);
    }
    expect(await token.balanceOf(user.address)).to.equal(5n);
  });

  it("should correctly track total supply through mint and burn cycles", async function () {
    const { token, minter, user, oracle, initialReserve } = await loadFixture(
      deployVittagemsFixture
    );
    const half = initialReserve / 2n;

    await token.connect(minter).mint(user.address, half);
    expect(await token.totalSupply()).to.equal(half);

    await token.connect(user).burn(half / 2n);
    expect(await token.totalSupply()).to.equal(half / 2n);

    await oracle.makeFresh();
    await token.connect(minter).mint(user.address, half / 2n);
    expect(await token.totalSupply()).to.equal(half);
  });

  /**
   * EDGE CASE: What happens at block.timestamp == lastUpdated + threshold exactly?
   * This is the boundary condition for staleness.
   */
  it("should treat staleness boundary as inclusive (not stale AT threshold)", async function () {
    const { token, oracle, stalenessThreshold } = await loadFixture(
      deployVittagemsFixture
    );
    const currentTime = await time.latest();
    await oracle.setLastUpdatedAt(currentTime);

    // Advance exactly to threshold
    await time.increaseTo(currentTime + stalenessThreshold);

    // Should still be fresh (<=)
    expect(await token.isReserveFresh()).to.be.true;
  });

  it("should support self-transfer (edge case in ERC20)", async function () {
    const { token, minter, user } = await loadFixture(deployVittagemsFixture);
    await token.connect(minter).mint(user.address, ONE_ETHER);
    await token.connect(user).transfer(user.address, ONE_ETHER);
    expect(await token.balanceOf(user.address)).to.equal(ONE_ETHER);
  });
});

// ============================================================
// GAS BENCHMARKS
// ============================================================
describe("Vittagems - Gas Benchmarks", function () {
  /**
   * WHY: Gas awareness helps identify unexpectedly expensive operations
   * and ensures the contract is economically viable.
   */

  it("should measure gas for mint()", async function () {
    const { token, minter, user } = await loadFixture(deployVittagemsFixture);
    const tx = await token.connect(minter).mint(user.address, ONE_ETHER);
    const receipt = await tx.wait();
    console.log(`      ⛽ mint() gas used: ${receipt.gasUsed.toString()}`);
    // Sanity check - mint should not be astronomically expensive
    expect(receipt.gasUsed).to.be.lessThan(200000n);
  });

  it("should measure gas for transfer()", async function () {
    const { token, minter, user, alice } = await loadFixture(
      deployVittagemsFixture
    );
    await token.connect(minter).mint(user.address, ONE_ETHER);
    const tx = await token.connect(user).transfer(alice.address, ONE_ETHER);
    const receipt = await tx.wait();
    console.log(`      ⛽ transfer() gas used: ${receipt.gasUsed.toString()}`);
    expect(receipt.gasUsed).to.be.lessThan(100000n);
  });

  it("should measure gas for burn()", async function () {
    const { token, minter, user } = await loadFixture(deployVittagemsFixture);
    await token.connect(minter).mint(user.address, ONE_ETHER);
    const tx = await token.connect(user).burn(ONE_ETHER);
    const receipt = await tx.wait();
    console.log(`      ⛽ burn() gas used: ${receipt.gasUsed.toString()}`);
    expect(receipt.gasUsed).to.be.lessThan(100000n);
  });

  it("should measure gas for pause()", async function () {
    const { token, pauser } = await loadFixture(deployVittagemsFixture);
    const tx = await token.connect(pauser).pause();
    const receipt = await tx.wait();
    console.log(`      ⛽ pause() gas used: ${receipt.gasUsed.toString()}`);
    expect(receipt.gasUsed).to.be.lessThan(50000n);
  });
});