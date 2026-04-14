require("@nomicfoundation/hardhat-toolbox");
require("solidity-coverage");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
      hardfork: "cancun",
      mining: { auto: true, interval: 0 },
    },
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: process.env.REPORT_GAS === "true" ? "gas-report.txt" : undefined,
    noColors: process.env.REPORT_GAS === "true",
    excludeContracts: [
      "MockReserveOracle",
      "MockReserveOracleBroken",
      "MaliciousReentrancy",
      "MockVittagemsToken",
      "MockAggregatorV3",
      "MockERC20Stablecoin",
      "MockERC20StablecoinLowDecimals",
      "MaliciousReentrantBuyer",
      "MaliciousStablecoin",
      "MockMinterBroken",
      "MockVGMGToken",
      "MockStakingToken",
      "MaliciousReentrantStaker",
      "MockFeeOnTransferToken",
      "MockRecoverableToken"
    ],
  },

  mocha: {
    timeout: 120000,
    reporter: "spec",
  },

  paths: {
    sources:   "./contracts",
    tests:     "./test",          // Hardhat auto-discovers all subdirectories
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};