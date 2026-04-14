const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ============================================================
// CONSTANTS — carefully verified against contract formula
// ============================================================

// ETH price: $2000.00
const ETH_PRICE_USD = 2000n;

// USD cents representation (used in contract's cent-based pricing)
const ETH_PRICE_CENTS = ETH_PRICE_USD * 100n; // 200_000 cents

/**
 * Chainlink price feed format:
 *   price = USD_per_ETH * 10^feedDecimals
 *   $2000 ETH with 8-decimal feed = 2000 * 10^8 = 200_000_000_000
 *
 * WRONG:  ETH_PRICE_CENTS * 10^8 = 200_000 * 10^8 = 20_000_000_000_000  (100x too big)
 * CORRECT: ETH_PRICE_USD   * 10^8 = 2_000   * 10^8 = 200_000_000_000     ✅
 */
const ETH_PRICE_CHAINLINK = ETH_PRICE_USD * 10n ** 8n; // 200_000_000_000

const BASE_PRICE_CENTS = 100n; // $1.00 per token
const ORACLE_STALENESS = 1 * 60 * 60; // 1 hour in seconds

// Token amounts in 18-decimal wei
const ONE_TOKEN              = ethers.parseEther("1");
const HUNDRED_TOKENS         = ethers.parseEther("100");
const TEN_THOUSAND_TOKENS    = ethers.parseEther("10000");
const HUNDRED_THOUSAND_TOKENS = ethers.parseEther("100000");
const ONE_MILLION_TOKENS     = ethers.parseEther("1000000");

// Vittagems max supply
const MAX_SUPPLY = ethers.parseEther("10000000000"); // 10 billion

const USDT_DECIMALS = 6;
const USDC_DECIMALS = 6;

// ============================================================
// DEPLOYMENT HELPERS
// ============================================================

async function deployMockToken(maxSupply = MAX_SUPPLY) {
  const MockToken = await ethers.getContractFactory("MockVittagemsToken");
  const token = await MockToken.deploy(maxSupply);
  await token.waitForDeployment();
  return token;
}

/**
 * @param {BigInt} price    - Chainlink-format price (USD * 10^decimals)
 *                            Default: $2000 * 10^8 = 200_000_000_000
 * @param {number} decimals - Feed decimal places (default 8)
 */
async function deployMockPriceFeed(
  price = ETH_PRICE_CHAINLINK,
  decimals = 8
) {
  const MockFeed = await ethers.getContractFactory("MockAggregatorV3");
  const feed = await MockFeed.deploy(price, decimals);
  await feed.waitForDeployment();
  return feed;
}

async function deployMockStablecoin(
  name = "USDT",
  symbol = "USDT",
  decimals = 6
) {
  const MockStable = await ethers.getContractFactory("MockERC20Stablecoin");
  const stable = await MockStable.deploy(name, symbol, decimals);
  await stable.waitForDeployment();
  return stable;
}

async function deployLowDecimalStablecoin() {
  const LowDec = await ethers.getContractFactory(
    "MockERC20StablecoinLowDecimals"
  );
  const stable = await LowDec.deploy();
  await stable.waitForDeployment();
  return stable;
}

async function deployMaliciousBuyer(presaleAddress) {
  const Malicious = await ethers.getContractFactory("MaliciousReentrantBuyer");
  const malicious = await Malicious.deploy(presaleAddress);
  await malicious.waitForDeployment();
  return malicious;
}

// ============================================================
// FIXTURES
// ============================================================

async function deployPresaleFixture() {
  const [owner, user, attacker, alice, bob] = await ethers.getSigners();

  const mockToken = await deployMockToken(MAX_SUPPLY);
  const priceFeed = await deployMockPriceFeed(ETH_PRICE_CHAINLINK, 8);
  const usdt      = await deployMockStablecoin("Tether USD", "USDT", 6);
  const usdc      = await deployMockStablecoin("USD Coin",   "USDC", 6);

  const Presale = await ethers.getContractFactory("VittagemsPresale");
  const presale = await Presale.deploy(
    await mockToken.getAddress(),
    await priceFeed.getAddress(),
    await usdt.getAddress(),
    await usdc.getAddress(),
    owner.address
  );
  await presale.waitForDeployment();

  // Fund users with stablecoins
  const FUND = 1_000_000n * 10n ** 6n;
  for (const addr of [user.address, alice.address]) {
    await usdt.mint(addr, FUND);
    await usdc.mint(addr, FUND);
  }

  // Approve presale
  const presaleAddr = await presale.getAddress();
  for (const signer of [user, alice]) {
    await usdt.connect(signer).approve(presaleAddr, FUND);
    await usdc.connect(signer).approve(presaleAddr, FUND);
  }

  return {
    presale,
    mockToken,
    priceFeed,
    usdt,
    usdc,
    owner,
    user,
    attacker,
    alice,
    bob,
    presaleAddr,
    ETH_PRICE_CHAINLINK,
    ETH_PRICE_CENTS,
    BASE_PRICE_CENTS,
    MAX_SUPPLY,
  };
}

async function deployPresaleDiscountPausedFixture() {
  const base = await deployPresaleFixture();
  await base.presale.connect(base.owner).pauseDiscountedSale();
  return base;
}

async function deployPresalePausedFixture() {
  const base = await deployPresaleFixture();
  await base.presale.connect(base.owner).pauseSale();
  return base;
}

async function deployPresaleStaleOracleFixture() {
  const base = await deployPresaleFixture();
  await base.priceFeed.makeStale(2); // 2 hours old
  return base;
}

// ============================================================
// CALCULATION HELPERS — must mirror contract math exactly
// ============================================================

/**
 * @notice Mirror of contract's getNativeAmountFromUsd()
 *
 * Contract formula:
 *   ethWei = (usdCents * 10^(18 + feedDecimals - 2)) / chainlinkPrice
 *
 * Verified: $1 at $2000/ETH with 8-decimal feed
 *   = (100 * 10^24) / 200_000_000_000
 *   = 10^26 / 2*10^11
 *   = 5 * 10^14
 *   = 0.0005 ETH ✅
 *
 * @param {BigInt} usdCents       - Cost in cents (e.g. 100 = $1.00)
 * @param {BigInt} chainlinkPrice - Feed price (e.g. 2000 * 10^8)
 * @param {number} feedDecimals   - Feed decimals (default 8)
 */
function calculateEthCost(
  usdCents,
  chainlinkPrice = ETH_PRICE_CHAINLINK,
  feedDecimals = 8
) {
  return (
    (usdCents * 10n ** BigInt(18 + feedDecimals - 2)) / chainlinkPrice
  );
}

/**
 * @notice Mirror of contract's getDiscountedPrice()
 */
function getDiscountedPrice(tokenAmount, basePriceCents = BASE_PRICE_CENTS) {
  const tokensCount = tokenAmount / 10n ** 18n;
  if (tokensCount >= 1_000_000n) return (basePriceCents * 60n) / 100n;
  if (tokensCount >= 100_000n)   return (basePriceCents * 70n) / 100n;
  if (tokensCount >= 10_000n)    return (basePriceCents * 80n) / 100n;
  if (tokensCount >= 100n)       return (basePriceCents * 90n) / 100n;
  return basePriceCents;
}

/**
 * @notice Calculate stablecoin cost from USD cents
 *
 * Contract formula:
 *   stablecoinAmount = costInUsdCents * 10^(decimals - 2)
 *
 * Example: 100 cents at 6 decimals
 *   = 100 * 10^4 = 1_000_000 units = $1.00 USDT ✅
 */
function calculateStablecoinCost(costInUsdCents, decimals = 6) {
  return costInUsdCents * 10n ** BigInt(decimals - 2);
}

/**
 * @notice Add percentage buffer to ETH amount to handle 1-wei rounding
 * @param {BigInt} exact       - Exact ETH amount in wei
 * @param {BigInt} bpSlippage  - Basis points extra (default 50 = 0.5%)
 */
function withSlippage(exact, bpSlippage = 50n) {
  return exact + (exact * bpSlippage) / 10000n + 1n; // +1 for rounding
}

module.exports = {
  // Constants
  ETH_PRICE_USD,
  ETH_PRICE_CENTS,
  ETH_PRICE_CHAINLINK,
  BASE_PRICE_CENTS,
  ORACLE_STALENESS,
  ONE_TOKEN,
  HUNDRED_TOKENS,
  TEN_THOUSAND_TOKENS,
  HUNDRED_THOUSAND_TOKENS,
  ONE_MILLION_TOKENS,
  MAX_SUPPLY,
  USDT_DECIMALS,
  USDC_DECIMALS,

  // Deploy
  deployMockToken,
  deployMockPriceFeed,
  deployMockStablecoin,
  deployLowDecimalStablecoin,
  deployMaliciousBuyer,

  // Fixtures
  deployPresaleFixture,
  deployPresaleDiscountPausedFixture,
  deployPresalePausedFixture,
  deployPresaleStaleOracleFixture,

  // Calculations
  calculateEthCost,
  getDiscountedPrice,
  calculateStablecoinCost,
  withSlippage,

  time,
};