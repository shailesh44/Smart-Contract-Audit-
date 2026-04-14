module.exports = {
  skipFiles: [
    "mocks/erc20/MockReserveOracle.sol",
    "mocks/erc20/MockReserveOracleBroken.sol",
    "mocks/erc20/MaliciousReentrancy.sol",
    "mocks/presale/MockVittagemsToken.sol",
    "mocks/presale/MockAggregatorV3.sol",
    "mocks/presale/MockERC20Stablecoin.sol",
    "mocks/presale/MockERC20StablecoinLowDecimals.sol",
    "mocks/presale/MaliciousReentrantBuyer.sol",
    "mocks/presale/MaliciousStablecoin.sol",
    "mocks/governance/MockMinterBroken.sol",
    "mocks/governance/MockVGMGToken.sol",
    "mocks/staking/MockStakingToken.sol",
    "mocks/staking/MaliciousReentrantStaker.sol",
    "mocks/staking/MockFeeOnTransferToken.sol",
    "mocks/staking/MockRecoverableToken.sol"
  ],
  configureYulOptimizer: true,
  mocha: { timeout: 120000 },
};