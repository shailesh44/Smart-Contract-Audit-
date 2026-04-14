const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * @notice Deploys MockReserveOracle with a given reserve value
 * @param {BigInt} reserveAmount - Initial reserve in wei
 */
async function deployMockOracle(reserveAmount) {
  // Contract name must exactly match the contract name in the .sol file
  const MockOracle = await ethers.getContractFactory("MockReserveOracle");
  const oracle = await MockOracle.deploy(reserveAmount);
  await oracle.waitForDeployment();
  return oracle;
}

/**
 * @notice Deploys MockReserveOracleBroken (always reverts)
 */
async function deployBrokenOracle() {
  const BrokenOracle = await ethers.getContractFactory(
    "MockReserveOracleBroken"
  );
  const oracle = await BrokenOracle.deploy();
  await oracle.waitForDeployment();
  return oracle;
}

/**
 * @notice Deploys MaliciousReentrancy attacker contract
 * @param {string} targetAddress - Address of the Vittagems token
 */
async function deployMaliciousReentrancy(targetAddress) {
  const Malicious = await ethers.getContractFactory("MaliciousReentrancy");
  const malicious = await Malicious.deploy(targetAddress);
  await malicious.waitForDeployment();
  return malicious;
}

/**
 * @notice Full deployment fixture — oracle set AND locked
 */
async function deployVittagemsFixture() {
  const [owner, pauser, minter, user, attacker, alice, bob] =
    await ethers.getSigners();

  const stalenessThreshold = 3600; // 1 hour in seconds
  const initialReserve = ethers.parseEther("1000000"); // 1 million tokens

  // Deploy mock oracle first
  const oracle = await deployMockOracle(initialReserve);

  // Deploy Vittagems token
  const Vittagems = await ethers.getContractFactory("Vittagems");
  const token = await Vittagems.deploy(
    owner.address,
    pauser.address,
    minter.address,
    stalenessThreshold
  );
  await token.waitForDeployment();

  // Set the oracle
  await token.connect(owner).setReserveOracle(await oracle.getAddress());

  // Lock the oracle (permanent)
  await token.connect(owner).lockReserveOracle();

  return {
    token,
    oracle,
    owner,
    pauser,
    minter,
    user,
    attacker,
    alice,
    bob,
    stalenessThreshold,
    initialReserve,
  };
}

/**
 * @notice Deployment fixture with NO oracle set at all
 */
async function deployVittagemsNoOracleFixture() {
  const [owner, pauser, minter, user, attacker, alice, bob] =
    await ethers.getSigners();

  const stalenessThreshold = 3600;

  const Vittagems = await ethers.getContractFactory("Vittagems");
  const token = await Vittagems.deploy(
    owner.address,
    pauser.address,
    minter.address,
    stalenessThreshold
  );
  await token.waitForDeployment();

  return {
    token,
    owner,
    pauser,
    minter,
    user,
    attacker,
    alice,
    bob,
    stalenessThreshold,
  };
}

/**
 * @notice Deployment fixture with oracle SET but NOT yet locked
 */
async function deployVittagemsOracleNotLockedFixture() {
  const [owner, pauser, minter, user, attacker, alice, bob] =
    await ethers.getSigners();

  const stalenessThreshold = 3600;
  const initialReserve = ethers.parseEther("1000000");

  const oracle = await deployMockOracle(initialReserve);

  const Vittagems = await ethers.getContractFactory("Vittagems");
  const token = await Vittagems.deploy(
    owner.address,
    pauser.address,
    minter.address,
    stalenessThreshold
  );
  await token.waitForDeployment();

  // Set but do NOT lock
  await token.connect(owner).setReserveOracle(await oracle.getAddress());

  return {
    token,
    oracle,
    owner,
    pauser,
    minter,
    user,
    attacker,
    alice,
    bob,
    stalenessThreshold,
    initialReserve,
  };
}

/**
 * @notice Deployment fixture with staleness threshold = 0 (disabled)
 */
async function deployVittagemsNoStalenessFixture() {
  const [owner, pauser, minter, user, attacker, alice, bob] =
    await ethers.getSigners();

  const initialReserve = ethers.parseEther("1000000");
  const oracle = await deployMockOracle(initialReserve);

  const Vittagems = await ethers.getContractFactory("Vittagems");
  const token = await Vittagems.deploy(
    owner.address,
    pauser.address,
    minter.address,
    0 // staleness check disabled
  );
  await token.waitForDeployment();

  await token.connect(owner).setReserveOracle(await oracle.getAddress());
  await token.connect(owner).lockReserveOracle();

  return {
    token,
    oracle,
    owner,
    pauser,
    minter,
    user,
    attacker,
    alice,
    bob,
    initialReserve,
  };
}

/**
 * @notice Generates an EIP-712 permit signature
 * @param {Contract} token - The Vittagems token contract
 * @param {Signer} ownerSigner - The token owner signing the permit
 * @param {Signer} spenderSigner - The approved spender
 * @param {BigInt} value - Amount to approve
 * @param {number} deadline - Unix timestamp deadline
 * @param {BigInt} nonce - Current nonce of the owner
 * @returns {ethers.Signature} The split signature {v, r, s}
 */
async function signPermit(token, ownerSigner, spenderSigner, value, deadline, nonce) {
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;
  const tokenAddress = await token.getAddress();

  const domain = {
    name: "Vittagems",
    version: "1",
    chainId: chainId,
    verifyingContract: tokenAddress,
  };

  const types = {
    Permit: [
      { name: "owner",    type: "address" },
      { name: "spender",  type: "address" },
      { name: "value",    type: "uint256" },
      { name: "nonce",    type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const message = {
    owner:    ownerSigner.address,
    spender:  spenderSigner.address,
    value:    value,
    nonce:    nonce,
    deadline: deadline,
  };

  const signature = await ownerSigner.signTypedData(domain, types, message);
  return ethers.Signature.from(signature);
}

module.exports = {
  deployMockOracle,
  deployBrokenOracle,
  deployMaliciousReentrancy,
  deployVittagemsFixture,
  deployVittagemsNoOracleFixture,
  deployVittagemsOracleNotLockedFixture,
  deployVittagemsNoStalenessFixture,
  signPermit,
  time,
};