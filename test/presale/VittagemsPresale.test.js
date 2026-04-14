const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const {
    deployPresaleFixture,
    deployPresaleDiscountPausedFixture,
    deployPresalePausedFixture,
    deployPresaleStaleOracleFixture,
    deployMockToken,
    deployMockPriceFeed,
    deployMockStablecoin,
    deployLowDecimalStablecoin,
    ETH_PRICE_CHAINLINK,
    ETH_PRICE_CENTS,
    BASE_PRICE_CENTS,
    ONE_TOKEN,
    HUNDRED_TOKENS,
    TEN_THOUSAND_TOKENS,
    HUNDRED_THOUSAND_TOKENS,
    ONE_MILLION_TOKENS,
    MAX_SUPPLY,
    calculateEthCost,
    getDiscountedPrice,
    calculateStablecoinCost,
    withSlippage,
} = require("./helpers/presaleHelpers");

// ============================================================
// DEPLOYMENT & CONSTRUCTOR TESTS
// ============================================================
describe("VittagemsPresale - Deployment & Constructor", function () {
    /**
     * WHY: Verify all constructor parameters are stored correctly.
     * Immutable variables cannot be changed post-deployment.
     */

    it("should deploy with correct token address", async function () {
        const { presale, mockToken } = await loadFixture(deployPresaleFixture);
        expect(await presale.token()).to.equal(await mockToken.getAddress());
    });

    it("should deploy with correct price feed address", async function () {
        const { presale, priceFeed } = await loadFixture(deployPresaleFixture);
        expect(await presale.nativePriceFeed()).to.equal(
            await priceFeed.getAddress()
        );
    });

    it("should deploy with correct USDT address", async function () {
        const { presale, usdt } = await loadFixture(deployPresaleFixture);
        expect(await presale.usdtToken()).to.equal(await usdt.getAddress());
    });

    it("should deploy with correct USDC address", async function () {
        const { presale, usdc } = await loadFixture(deployPresaleFixture);
        expect(await presale.usdcToken()).to.equal(await usdc.getAddress());
    });

    it("should deploy with correct owner", async function () {
        const { presale, owner } = await loadFixture(deployPresaleFixture);
        expect(await presale.owner()).to.equal(owner.address);
    });

    it("should deploy with base price = 100 cents ($1.00)", async function () {
        const { presale } = await loadFixture(deployPresaleFixture);
        expect(await presale.basePriceCents()).to.equal(100n);
    });

    it("should deploy with totalTokensSold = 0", async function () {
        const { presale } = await loadFixture(deployPresaleFixture);
        expect(await presale.totalTokensSold()).to.equal(0n);
    });

    it("should deploy with discountedSalePaused = false", async function () {
        const { presale } = await loadFixture(deployPresaleFixture);
        expect(await presale.discountedSalePaused()).to.be.false;
    });

    it("should deploy unpaused", async function () {
        const { presale } = await loadFixture(deployPresaleFixture);
        expect(await presale.paused()).to.be.false;
    });

    it("should accept ETH via receive()", async function () {
        const { presale, user, presaleAddr } = await loadFixture(
            deployPresaleFixture
        );
        await user.sendTransaction({ to: presaleAddr, value: ethers.parseEther("1") });
        expect(await ethers.provider.getBalance(presaleAddr)).to.equal(
            ethers.parseEther("1")
        );
    });

    /**
     * WHY: Zero address in constructor is a permanent misconfiguration.
     */
    it("should revert with ZeroAddress if token address is zero", async function () {
        const [owner] = await ethers.getSigners();
        const pf = await deployMockPriceFeed();
        const usdt = await deployMockStablecoin();
        const usdc = await deployMockStablecoin("USDC", "USDC", 6);
        const Presale = await ethers.getContractFactory("VittagemsPresale");
        await expect(
            Presale.deploy(ethers.ZeroAddress, await pf.getAddress(), await usdt.getAddress(), await usdc.getAddress(), owner.address)
        ).to.be.revertedWithCustomError({ interface: (await Presale.deploy(owner.address, await pf.getAddress(), await usdt.getAddress(), await usdc.getAddress(), owner.address).catch(() => ({ interface: Presale.interface }))).interface ?? Presale.interface }, "ZeroAddress");
    });

    it("should revert ZeroAddress for each zero parameter", async function () {
        const [owner] = await ethers.getSigners();
        const token = await deployMockToken();
        const pf = await deployMockPriceFeed();
        const usdt = await deployMockStablecoin();
        const usdc = await deployMockStablecoin("USDC", "USDC", 6);
        const Presale = await ethers.getContractFactory("VittagemsPresale");

        const tokenAddr = await token.getAddress();
        const pfAddr = await pf.getAddress();
        const usdtAddr = await usdt.getAddress();
        const usdcAddr = await usdc.getAddress();

        // These 4 all hit the custom ZeroAddress check first
        const zeroAddressCases = [
            [ethers.ZeroAddress, pfAddr, usdtAddr, usdcAddr, owner.address],
            [tokenAddr, ethers.ZeroAddress, usdtAddr, usdcAddr, owner.address],
            [tokenAddr, pfAddr, ethers.ZeroAddress, usdcAddr, owner.address],
            [tokenAddr, pfAddr, usdtAddr, ethers.ZeroAddress, owner.address],
        ];

        for (const args of zeroAddressCases) {
            await expect(Presale.deploy(...args))
                .to.be.revertedWithCustomError(Presale, "ZeroAddress");
        }

        // This case hits OwnableInvalidOwner FIRST because Ownable(initialOwner)
        // runs before your manual if(initialOwner == address(0)) check in the body.
        // WHY: Solidity executes base constructor arguments before the constructor body.
        await expect(
            Presale.deploy(tokenAddr, pfAddr, usdtAddr, usdcAddr, ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(Presale, "OwnableInvalidOwner");
    });
})

// ============================================================
// PRICING ENGINE TESTS
// ============================================================
describe("VittagemsPresale - Pricing Engine", function () {
    /**
     * WHY: Pricing is the core business logic. Incorrect prices lead to
     * financial loss for the protocol or unfair pricing for buyers.
     */

    describe("getDiscountedPrice()", function () {
        it("should return base price for < 100 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            // 99 tokens — no discount
            const amount = ethers.parseEther("99");
            expect(await presale.getDiscountedPrice(amount)).to.equal(100n);
        });

        it("should return 10% discount for >= 100 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            expect(await presale.getDiscountedPrice(HUNDRED_TOKENS)).to.equal(90n);
        });

        it("should return 20% discount for >= 10,000 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            expect(await presale.getDiscountedPrice(TEN_THOUSAND_TOKENS)).to.equal(80n);
        });

        it("should return 30% discount for >= 100,000 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            expect(await presale.getDiscountedPrice(HUNDRED_THOUSAND_TOKENS)).to.equal(70n);
        });

        it("should return 40% discount for >= 1,000,000 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            expect(await presale.getDiscountedPrice(ONE_MILLION_TOKENS)).to.equal(60n);
        });

        it("should return base price for 0 tokens (edge case)", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            expect(await presale.getDiscountedPrice(0n)).to.equal(100n);
        });

        it("should use correct tier at exact boundary: exactly 100 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            const exactly100 = ethers.parseEther("100");
            expect(await presale.getDiscountedPrice(exactly100)).to.equal(90n);
        });

        it("should use correct tier at exact boundary: exactly 10,000 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            expect(await presale.getDiscountedPrice(TEN_THOUSAND_TOKENS)).to.equal(80n);
        });

        it("should use correct tier for 99 tokens (just below 100 boundary)", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            const just99 = ethers.parseEther("99.9"); // still rounds to 99 whole tokens
            expect(await presale.getDiscountedPrice(just99)).to.equal(100n); // no discount
        });

        it("should reflect updated base price in discount calculation", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await presale.connect(owner).setBasePrice(200n); // $2.00
            // 40% discount: 200 * 60 / 100 = 120 cents
            expect(await presale.getDiscountedPrice(ONE_MILLION_TOKENS)).to.equal(120n);
        });
    });

    describe("calculateTotalCostWithDiscount()", function () {
        it("should calculate correct cost for 100 tokens at 10% discount", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            // 100 tokens * 90 cents = 9000 cents = $90.00
            const cost = await presale.calculateTotalCostWithDiscount(HUNDRED_TOKENS);
            expect(cost).to.equal(9000n);
        });

        it("should calculate correct cost for 1 token at base price", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            // 1 token * 100 cents = 100 cents
            const cost = await presale.calculateTotalCostWithDiscount(ONE_TOKEN);
            expect(cost).to.equal(100n);
        });

        it("should calculate correct cost for 1M tokens at 40% discount", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            // 1,000,000 tokens * 60 cents = 60,000,000 cents
            const cost = await presale.calculateTotalCostWithDiscount(ONE_MILLION_TOKENS);
            expect(cost).to.equal(60_000_000n);
        });

        it("should revert with ZeroTokens for 0 amount", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.calculateTotalCostWithDiscount(0n)
            ).to.be.revertedWithCustomError(presale, "ZeroTokens");
        });

        it("should handle fractional tokens (less than 1e18)", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            // 0.5 tokens * 100 cents / 1e18 = 50 cents (rounds down)
            const halfToken = ethers.parseEther("0.5");
            const cost = await presale.calculateTotalCostWithDiscount(halfToken);
            expect(cost).to.equal(50n);
        });
    });

    describe("calculateTotalCostAtBasePrice()", function () {
        it("should calculate correct cost at base price for 1 token", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            expect(await presale.calculateTotalCostAtBasePrice(ONE_TOKEN)).to.equal(100n);
        });

        it("should calculate correct cost for 1,000,000 tokens at base price", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            // No discount applied
            expect(await presale.calculateTotalCostAtBasePrice(ONE_MILLION_TOKENS)).to.equal(100_000_000n);
        });

        it("should revert with ZeroTokens for 0 amount", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.calculateTotalCostAtBasePrice(0n)
            ).to.be.revertedWithCustomError(presale, "ZeroTokens");
        });

        it("should be greater than discounted cost for same amount >= 100 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            const discounted = await presale.calculateTotalCostWithDiscount(HUNDRED_TOKENS);
            const base = await presale.calculateTotalCostAtBasePrice(HUNDRED_TOKENS);
            expect(base).to.be.gt(discounted);
        });
    });

    describe("getNativeAmountFromUsd()", function () {

        it("should return correct ETH amount for given USD cents", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            // $1.00 at $2000/ETH = 0.0005 ETH
            // Formula: (100 * 10^(18+8-2)) / (2000 * 10^8)
            //        = (100 * 10^24)       / (2 * 10^11)
            //        = 5 * 10^14 wei
            const ethAmount = await presale.getNativeAmountFromUsd(100n);
            const expected = calculateEthCost(100n);           // uses fixed helper

            expect(ethAmount).to.equal(expected);               // 500_000_000_000_000 = 0.0005 ETH
            expect(ethAmount).to.equal(ethers.parseEther("0.0005"));
        });

        it("should return correct ETH amount for 10000 cents ($100)", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            // $100 at $2000/ETH = 0.05 ETH
            const ethAmount = await presale.getNativeAmountFromUsd(10000n);
            const expected = calculateEthCost(10000n);

            expect(ethAmount).to.equal(expected);               // 50_000_000_000_000_000 = 0.05 ETH
            expect(ethAmount).to.equal(ethers.parseEther("0.05"));
        });

        it("should revert InvalidOraclePrice when price is 0", async function () {
            const { presale, priceFeed } = await loadFixture(deployPresaleFixture);
            await priceFeed.setReturnZeroPrice(true);
            await expect(
                presale.getNativeAmountFromUsd(100n)
            ).to.be.revertedWithCustomError(presale, "InvalidOraclePrice");
        });

        it("should revert InvalidOraclePrice when price is negative", async function () {
            const { presale, priceFeed } = await loadFixture(deployPresaleFixture);
            await priceFeed.setReturnNegativePrice(true);
            await expect(
                presale.getNativeAmountFromUsd(100n)
            ).to.be.revertedWithCustomError(presale, "InvalidOraclePrice");
        });

        it("should revert StaleOracleData when data is older than 1 hour", async function () {
            const { presale, priceFeed } = await loadFixture(deployPresaleFixture);
            await priceFeed.makeStale(2);
            await expect(
                presale.getNativeAmountFromUsd(100n)
            ).to.be.revertedWithCustomError(presale, "StaleOracleData");
        });

        it("should accept data exactly at staleness boundary (1 hour)", async function () {
            const { presale, priceFeed } = await loadFixture(deployPresaleFixture);
            const currentTime = await time.latest();
            await priceFeed.setUpdatedAt(currentTime - 3600 + 1);
            await expect(presale.getNativeAmountFromUsd(100n)).to.not.be.reverted;
        });

        it("should revert StaleOracleData exactly at boundary + 1 second", async function () {
            const { presale, priceFeed } = await loadFixture(deployPresaleFixture);
            const currentTime = await time.latest();
            await priceFeed.setUpdatedAt(currentTime - 3601);
            await expect(
                presale.getNativeAmountFromUsd(100n)
            ).to.be.revertedWithCustomError(presale, "StaleOracleData");
        });
    });


    describe("getDiscountInfo()", function () {
        it("should return 0% discount for < 100 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            const { discountPercent, finalPriceCents } =
                await presale.getDiscountInfo(ONE_TOKEN);
            expect(discountPercent).to.equal(0n);
            expect(finalPriceCents).to.equal(100n);
        });

        it("should return 10% discount for 100 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            const { discountPercent, finalPriceCents } =
                await presale.getDiscountInfo(HUNDRED_TOKENS);
            expect(discountPercent).to.equal(10n);
            expect(finalPriceCents).to.equal(90n);
        });

        it("should return 20% discount for 10,000 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            const { discountPercent } = await presale.getDiscountInfo(TEN_THOUSAND_TOKENS);
            expect(discountPercent).to.equal(20n);
        });

        it("should return 30% discount for 100,000 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            const { discountPercent } = await presale.getDiscountInfo(HUNDRED_THOUSAND_TOKENS);
            expect(discountPercent).to.equal(30n);
        });

        it("should return 40% discount for 1,000,000 tokens", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            const { discountPercent } = await presale.getDiscountInfo(ONE_MILLION_TOKENS);
            expect(discountPercent).to.equal(40n);
        });
    });
});

// ============================================================
// BUY WITH NATIVE ETH (DISCOUNTED) TESTS
// ============================================================
describe("VittagemsPresale - buyTokensWithNative()", function () {
    /**
     * WHY: ETH purchases involve oracle price feeds and ETH refunds —
     * complex enough to warrant thorough testing of each scenario.
     */

    describe("Positive Cases", function () {
        it("should mint tokens to buyer on valid ETH purchase", async function () {
            const { presale, mockToken, user } = await loadFixture(
                deployPresaleFixture
            );
            const amount = ONE_TOKEN;
            const ethCost = await presale.getNativeAmountFromUsd(100n); // $1 at base price
            const ethToSend = withSlippage(ethCost);

            await presale.connect(user).buyTokensWithNative(amount, {
                value: ethToSend,
            });

            expect(await mockToken.mintedTo(user.address)).to.equal(amount);
        });

        it("should emit TokensPurchased event with discounted=true", async function () {
            const { presale, usdt, user } = await loadFixture(deployPresaleFixture);
            const amount = ONE_TOKEN;
            const costCents = 100n; // 1 token at base price (no discount for 1 token)
            const ethCost = await presale.getNativeAmountFromUsd(costCents);

            await expect(
                presale.connect(user).buyTokensWithNative(amount, {
                    value: withSlippage(ethCost),
                })
            )
                .to.emit(presale, "TokensPurchased")
                .withArgs(
                    user.address,
                    ethers.ZeroAddress,
                    amount,
                    costCents,
                    true // discounted flag
                );
        });

        it("should increase totalTokensSold after purchase", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            const amount = ONE_TOKEN;
            const ethCost = await presale.getNativeAmountFromUsd(100n);

            await presale.connect(user).buyTokensWithNative(amount, {
                value: withSlippage(ethCost),
            });

            expect(await presale.totalTokensSold()).to.equal(amount);
        });

        it("should refund excess ETH to buyer", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            const amount = ONE_TOKEN;
            const exactCost = await presale.getNativeAmountFromUsd(100n);
            const extraEth = ethers.parseEther("1");
            const totalSent = exactCost + extraEth;

            const balanceBefore = await ethers.provider.getBalance(user.address);
            const tx = await presale.connect(user).buyTokensWithNative(amount, {
                value: totalSent,
            });
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const balanceAfter = await ethers.provider.getBalance(user.address);

            // User should get back the excess ETH (minus gas)
            const netCost = balanceBefore - balanceAfter - gasUsed;
            expect(netCost).to.be.closeTo(exactCost, ethers.parseEther("0.0001"));
        });

        it("should apply 10% discount for 100 tokens", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            const amount = HUNDRED_TOKENS;
            // 100 tokens * 90 cents = 9000 cents
            const costCents = 9000n;
            const ethCost = await presale.getNativeAmountFromUsd(costCents);

            await expect(
                presale.connect(user).buyTokensWithNative(amount, {
                    value: withSlippage(ethCost),
                })
            )
                .to.emit(presale, "TokensPurchased")
                .withArgs(user.address, ethers.ZeroAddress, amount, costCents, true);
        });

        it("should apply 40% discount for 1M tokens", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            const amount = ONE_MILLION_TOKENS;
            // 1,000,000 tokens * 60 cents = 60,000,000 cents
            const costCents = 60_000_000n;
            const ethCost = await presale.getNativeAmountFromUsd(costCents);

            await expect(
                presale.connect(user).buyTokensWithNative(amount, {
                    value: withSlippage(ethCost),
                })
            ).to.emit(presale, "TokensPurchased");
        });

        it("should work for multiple sequential purchases", async function () {
            const { presale, mockToken, user } = await loadFixture(
                deployPresaleFixture
            );
            const ethCost = await presale.getNativeAmountFromUsd(100n);

            await presale.connect(user).buyTokensWithNative(ONE_TOKEN, {
                value: withSlippage(ethCost),
            });
            await presale.connect(user).buyTokensWithNative(ONE_TOKEN, {
                value: withSlippage(ethCost),
            });

            expect(await presale.totalTokensSold()).to.equal(ONE_TOKEN * 2n);
        });

        it("should accept exact ETH (no excess, no refund)", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            const amount = ONE_TOKEN;
            const exactCost = await presale.getNativeAmountFromUsd(100n);

            await expect(
                presale.connect(user).buyTokensWithNative(amount, { value: exactCost })
            ).to.not.be.reverted;
        });
    });

    describe("Negative Cases", function () {
        it("should revert with MinimumPurchaseNotMet for < 1 token", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            const tooSmall = ethers.parseEther("0.5");
            await expect(
                presale.connect(user).buyTokensWithNative(tooSmall, {
                    value: ethers.parseEther("1"),
                })
            ).to.be.revertedWithCustomError(presale, "MinimumPurchaseNotMet");
        });

        it("should revert with InsufficientETHSent when underpaying", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(user).buyTokensWithNative(ONE_TOKEN, {
                    value: 1n, // Way too little
                })
            ).to.be.revertedWithCustomError(presale, "InsufficientETHSent");
        });

        it("should revert with DiscountedSaleIsPaused when discount sale is paused", async function () {
            const { presale, user } = await loadFixture(
                deployPresaleDiscountPausedFixture
            );
            await expect(
                presale.connect(user).buyTokensWithNative(ONE_TOKEN, {
                    value: ethers.parseEther("1"),
                })
            ).to.be.revertedWithCustomError(presale, "DiscountedSaleIsPaused");
        });

        it("should revert when contract is paused", async function () {
            const { presale, user } = await loadFixture(deployPresalePausedFixture);
            await expect(
                presale.connect(user).buyTokensWithNative(ONE_TOKEN, {
                    value: ethers.parseEther("1"),
                })
            ).to.be.revertedWithCustomError(presale, "EnforcedPause");
        });

        it("should revert StaleOracleData during buy", async function () {
            const { presale, user } = await loadFixture(
                deployPresaleStaleOracleFixture
            );
            await expect(
                presale.connect(user).buyTokensWithNative(ONE_TOKEN, {
                    value: ethers.parseEther("1"),
                })
            ).to.be.revertedWithCustomError(presale, "StaleOracleData");
        });

        it("should revert when oracle price is invalid (zero)", async function () {
            const { presale, priceFeed, user } = await loadFixture(
                deployPresaleFixture
            );
            await priceFeed.setReturnZeroPrice(true);
            await expect(
                presale.connect(user).buyTokensWithNative(ONE_TOKEN, {
                    value: ethers.parseEther("1"),
                })
            ).to.be.revertedWithCustomError(presale, "InvalidOraclePrice");
        });

        it("should revert ExceedsMaxSupply when supply would be exceeded", async function () {
            const { presale, mockToken, user } = await loadFixture(
                deployPresaleFixture
            );
            // Set total supply to almost max
            await mockToken.setTotalSupply(MAX_SUPPLY - ONE_TOKEN + 1n);
            const ethCost = await presale.getNativeAmountFromUsd(100n);
            // Buying 1 token would exceed max
            await expect(
                presale.connect(user).buyTokensWithNative(ONE_TOKEN, {
                    value: withSlippage(ethCost),
                })
            ).to.be.revertedWithCustomError(presale, "ExceedsMaxSupply");
        });

        it("should revert with 0 tokens amount", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(user).buyTokensWithNative(0n, {
                    value: ethers.parseEther("1"),
                })
            ).to.be.revertedWithCustomError(presale, "MinimumPurchaseNotMet");
        });
    });
});

// ============================================================
// BUY WITH NATIVE AT BASE PRICE TESTS
// ============================================================
describe("VittagemsPresale - buyTokensWithNativeAtBasePrice()", function () {
    /**
     * WHY: Base price purchases should NOT apply discounts and should
     * work even when discounted sale is paused.
     */

    it("should mint tokens at base price (no discount)", async function () {
        const { presale, mockToken, user } = await loadFixture(deployPresaleFixture);
        const amount = HUNDRED_TOKENS; // 100 tokens
        // At base price: 100 tokens * 100 cents = 10000 cents
        const costCents = 10000n;
        const ethCost = await presale.getNativeAmountFromUsd(costCents);

        await presale.connect(user).buyTokensWithNativeAtBasePrice(amount, {
            value: withSlippage(ethCost),
        });

        expect(await mockToken.mintedTo(user.address)).to.equal(amount);
    });

    it("should emit TokensPurchased with discounted=false", async function () {
        const { presale, user } = await loadFixture(deployPresaleFixture);
        const amount = ONE_TOKEN;
        const costCents = 100n;
        const ethCost = await presale.getNativeAmountFromUsd(costCents);

        await expect(
            presale.connect(user).buyTokensWithNativeAtBasePrice(amount, {
                value: withSlippage(ethCost),
            })
        )
            .to.emit(presale, "TokensPurchased")
            .withArgs(user.address, ethers.ZeroAddress, amount, costCents, false);
    });

    it("should work when discounted sale is paused", async function () {
        const { presale, user } = await loadFixture(
            deployPresaleDiscountPausedFixture
        );
        const ethCost = await presale.getNativeAmountFromUsd(100n);
        await expect(
            presale.connect(user).buyTokensWithNativeAtBasePrice(ONE_TOKEN, {
                value: withSlippage(ethCost),
            })
        ).to.not.be.reverted;
    });

    it("should charge MORE than discounted version for 100+ tokens", async function () {
        const { presale, priceFeed } = await loadFixture(deployPresaleFixture);
        const amount = HUNDRED_TOKENS;

        const discountedCents =
            await presale.calculateTotalCostWithDiscount(amount);
        const baseCents = await presale.calculateTotalCostAtBasePrice(amount);

        expect(baseCents).to.be.gt(discountedCents);
    });

    it("should revert MinimumPurchaseNotMet for < 1 token", async function () {
        const { presale, user } = await loadFixture(deployPresaleFixture);
        await expect(
            presale.connect(user).buyTokensWithNativeAtBasePrice(
                ethers.parseEther("0.99"),
                { value: ethers.parseEther("1") }
            )
        ).to.be.revertedWithCustomError(presale, "MinimumPurchaseNotMet");
    });

    it("should revert when main sale is paused", async function () {
        const { presale, user } = await loadFixture(deployPresalePausedFixture);
        await expect(
            presale.connect(user).buyTokensWithNativeAtBasePrice(ONE_TOKEN, {
                value: ethers.parseEther("1"),
            })
        ).to.be.revertedWithCustomError(presale, "EnforcedPause");
    });

    it("should refund excess ETH on base price purchase", async function () {
        const { presale, user } = await loadFixture(deployPresaleFixture);
        const amount = ONE_TOKEN;
        const exactCost = await presale.getNativeAmountFromUsd(100n);
        const extra = ethers.parseEther("0.1");

        const balBefore = await ethers.provider.getBalance(user.address);
        const tx = await presale.connect(user).buyTokensWithNativeAtBasePrice(amount, {
            value: exactCost + extra,
        });
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        const balAfter = await ethers.provider.getBalance(user.address);

        const netSpent = balBefore - balAfter - gasUsed;
        expect(netSpent).to.be.closeTo(exactCost, ethers.parseEther("0.0001"));
    });
});

// ============================================================
// BUY WITH STABLECOIN (DISCOUNTED) TESTS
// ============================================================
describe("VittagemsPresale - buyTokensWithStablecoin()", function () {
    /**
     * WHY: Stablecoin purchases bypass the oracle price feed.
     * Must verify correct USDT/USDC amount is transferred.
     */

    describe("Positive Cases - USDT", function () {
        it("should accept USDT and mint tokens", async function () {
            const { presale, mockToken, usdt, user } = await loadFixture(
                deployPresaleFixture
            );
            const amount = ONE_TOKEN;
            const usdtAddr = await usdt.getAddress();

            await presale.connect(user).buyTokensWithStablecoin(usdtAddr, amount);

            expect(await mockToken.mintedTo(user.address)).to.equal(amount);
        });

        it("should transfer correct USDT amount from buyer", async function () {
            const { presale, usdt, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            const amount = HUNDRED_TOKENS;
            const usdtAddr = await usdt.getAddress();

            // 100 tokens * 90 cents (10% discount) = 9000 cents
            // 9000 cents * 10^(6-2) = 9000 * 10000 = 90,000,000 (6 decimal units)
            const expectedUsdt = calculateStablecoinCost(9000n, 6);

            const balBefore = await usdt.balanceOf(user.address);
            await presale.connect(user).buyTokensWithStablecoin(usdtAddr, amount);
            const balAfter = await usdt.balanceOf(user.address);

            expect(balBefore - balAfter).to.equal(expectedUsdt);
        });

        it("should emit TokensPurchased with USDT address and discounted=true", async function () {
            const { presale, usdt, user } = await loadFixture(deployPresaleFixture);
            const amount = ONE_TOKEN;
            const usdtAddr = await usdt.getAddress();

            await expect(
                presale.connect(user).buyTokensWithStablecoin(usdtAddr, amount)
            )
                .to.emit(presale, "TokensPurchased")
                .withArgs(user.address, usdtAddr, amount, 100n, true);
        });

        it("should increase presale USDT balance after purchase", async function () {
            const { presale, usdt, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            const usdtAddr = await usdt.getAddress();
            const balBefore = await usdt.balanceOf(presaleAddr);

            await presale.connect(user).buyTokensWithStablecoin(usdtAddr, ONE_TOKEN);

            const balAfter = await usdt.balanceOf(presaleAddr);
            expect(balAfter).to.be.gt(balBefore);
        });

        it("should increase totalTokensSold", async function () {
            const { presale, usdt, user } = await loadFixture(deployPresaleFixture);
            const usdtAddr = await usdt.getAddress();

            await presale.connect(user).buyTokensWithStablecoin(usdtAddr, ONE_TOKEN);
            expect(await presale.totalTokensSold()).to.equal(ONE_TOKEN);
        });
    });

    describe("Positive Cases - USDC", function () {
        it("should accept USDC and mint tokens", async function () {
            const { presale, mockToken, usdc, user } = await loadFixture(
                deployPresaleFixture
            );
            const usdcAddr = await usdc.getAddress();
            await presale.connect(user).buyTokensWithStablecoin(usdcAddr, ONE_TOKEN);
            expect(await mockToken.mintedTo(user.address)).to.equal(ONE_TOKEN);
        });

        it("should emit TokensPurchased with USDC address", async function () {
            const { presale, usdc, user } = await loadFixture(deployPresaleFixture);
            const usdcAddr = await usdc.getAddress();
            await expect(
                presale.connect(user).buyTokensWithStablecoin(usdcAddr, ONE_TOKEN)
            )
                .to.emit(presale, "TokensPurchased")
                .withArgs(user.address, usdcAddr, ONE_TOKEN, 100n, true);
        });

        it("should deduct correct USDC amount for 1M token purchase (40% discount)", async function () {
            const { presale, usdc, user } = await loadFixture(deployPresaleFixture);
            const usdcAddr = await usdc.getAddress();

            // Approve more USDC
            await usdc.mint(user.address, 1_000_000_000n * 10n ** 6n);
            await usdc
                .connect(user)
                .approve(await presale.getAddress(), ethers.MaxUint256);

            // 1M tokens * 60 cents = 60,000,000 cents
            const expectedUsdc = calculateStablecoinCost(60_000_000n, 6);

            const balBefore = await usdc.balanceOf(user.address);
            await presale
                .connect(user)
                .buyTokensWithStablecoin(usdcAddr, ONE_MILLION_TOKENS);
            const balAfter = await usdc.balanceOf(user.address);

            expect(balBefore - balAfter).to.equal(expectedUsdc);
        });
    });

    describe("Negative Cases", function () {
        it("should revert TokenNotSupported for unknown token address", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            const fakeToken = await deployMockStablecoin("FAKE", "FAKE", 6);
            await expect(
                presale
                    .connect(user)
                    .buyTokensWithStablecoin(await fakeToken.getAddress(), ONE_TOKEN)
            ).to.be.revertedWithCustomError(presale, "TokenNotSupported");
        });

        it("should revert TokenNotSupported for zero address", async function () {
            const { presale, user } = await loadFixture(deployPresaleFixture);
            await expect(
                presale
                    .connect(user)
                    .buyTokensWithStablecoin(ethers.ZeroAddress, ONE_TOKEN)
            ).to.be.revertedWithCustomError(presale, "TokenNotSupported");
        });

        it("should revert MinimumPurchaseNotMet for < 1 token", async function () {
            const { presale, usdt, user } = await loadFixture(deployPresaleFixture);
            await expect(
                presale
                    .connect(user)
                    .buyTokensWithStablecoin(
                        await usdt.getAddress(),
                        ethers.parseEther("0.5")
                    )
            ).to.be.revertedWithCustomError(presale, "MinimumPurchaseNotMet");
        });

        it("should revert DiscountedSaleIsPaused", async function () {
            const { presale, usdt, user } = await loadFixture(
                deployPresaleDiscountPausedFixture
            );
            await expect(
                presale
                    .connect(user)
                    .buyTokensWithStablecoin(await usdt.getAddress(), ONE_TOKEN)
            ).to.be.revertedWithCustomError(presale, "DiscountedSaleIsPaused");
        });

        it("should revert when main sale is paused", async function () {
            const { presale, usdt, user } = await loadFixture(
                deployPresalePausedFixture
            );
            await expect(
                presale
                    .connect(user)
                    .buyTokensWithStablecoin(await usdt.getAddress(), ONE_TOKEN)
            ).to.be.revertedWithCustomError(presale, "EnforcedPause");
        });

        it("should revert when USDT allowance is insufficient", async function () {
            const { presale, usdt, alice } = await loadFixture(deployPresaleFixture);
            // alice has no approval set
            await usdt.connect(alice).approve(await presale.getAddress(), 0n);
            await expect(
                presale
                    .connect(alice)
                    .buyTokensWithStablecoin(await usdt.getAddress(), ONE_TOKEN)
            ).to.be.revertedWithCustomError(usdt, "ERC20InsufficientAllowance");
        });

        it("should revert when buyer has insufficient USDT balance", async function () {
            const { presale, usdt, attacker, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            // Attacker has no tokens but sets high allowance
            await usdt.connect(attacker).approve(presaleAddr, ethers.MaxUint256);
            await expect(
                presale
                    .connect(attacker)
                    .buyTokensWithStablecoin(await usdt.getAddress(), ONE_TOKEN)
            ).to.be.revertedWithCustomError(usdt, "ERC20InsufficientBalance");
        });

        it("should revert DecimalsTooLow for token with 1 decimal", async function () {
            const { presale, owner, user, mockToken, priceFeed } = await loadFixture(
                deployPresaleFixture
            );
            // Deploy a stablecoin with 1 decimal
            const lowDec = await deployLowDecimalStablecoin();
            const lowDecAddr = await lowDec.getAddress();

            // Mint and approve
            await lowDec.mint(user.address, 1000n);

            // We need to deploy a new presale with lowDec as USDT to test this
            // because the current presale has immutable usdt/usdc
            // Instead, test via a new presale deployment
            const usdt2 = await deployMockStablecoin("USDT2", "USDT2", 6);
            const Presale = await ethers.getContractFactory("VittagemsPresale");
            const presale2 = await Presale.deploy(
                await mockToken.getAddress(),
                await priceFeed.getAddress(),
                lowDecAddr,       // USDT = low decimal token
                await usdt2.getAddress(),
                owner.address
            );

            await lowDec.mint(user.address, 1_000_000n);
            await lowDec.connect(user).approve(await presale2.getAddress(), ethers.MaxUint256);

            await expect(
                presale2.connect(user).buyTokensWithStablecoin(lowDecAddr, ONE_TOKEN)
            ).to.be.revertedWithCustomError(presale2, "DecimalsTooLow");
        });

        it("should revert ExceedsMaxSupply when supply would be exceeded", async function () {
            const { presale, mockToken, usdt, user } = await loadFixture(
                deployPresaleFixture
            );
            await mockToken.setTotalSupply(MAX_SUPPLY - ONE_TOKEN + 1n);
            await expect(
                presale
                    .connect(user)
                    .buyTokensWithStablecoin(await usdt.getAddress(), ONE_TOKEN)
            ).to.be.revertedWithCustomError(presale, "ExceedsMaxSupply");
        });
    });
});

// ============================================================
// BUY WITH STABLECOIN AT BASE PRICE TESTS
// ============================================================
describe("VittagemsPresale - buyTokensWithStablecoinAtBasePrice()", function () {
    /**
     * WHY: Base price stablecoin purchases must skip discount logic
     * and work even when discounted sale is paused.
     */

    it("should mint tokens at base price with USDT", async function () {
        const { presale, mockToken, usdt, user } = await loadFixture(
            deployPresaleFixture
        );
        const usdtAddr = await usdt.getAddress();
        await presale
            .connect(user)
            .buyTokensWithStablecoinAtBasePrice(usdtAddr, ONE_TOKEN);
        expect(await mockToken.mintedTo(user.address)).to.equal(ONE_TOKEN);
    });

    it("should charge base price (no discount) for 100+ tokens", async function () {
        const { presale, usdt, user } = await loadFixture(deployPresaleFixture);
        const usdtAddr = await usdt.getAddress();

        // Base: 100 tokens * 100 cents = 10000 cents = 10000 * 10^4 = 100,000,000 USDT units
        const expectedUsdt = calculateStablecoinCost(10000n, 6);

        const balBefore = await usdt.balanceOf(user.address);
        await presale
            .connect(user)
            .buyTokensWithStablecoinAtBasePrice(usdtAddr, HUNDRED_TOKENS);
        const balAfter = await usdt.balanceOf(user.address);

        expect(balBefore - balAfter).to.equal(expectedUsdt);
    });

    it("should emit TokensPurchased with discounted=false", async function () {
        const { presale, usdt, user } = await loadFixture(deployPresaleFixture);
        const usdtAddr = await usdt.getAddress();
        await expect(
            presale
                .connect(user)
                .buyTokensWithStablecoinAtBasePrice(usdtAddr, ONE_TOKEN)
        )
            .to.emit(presale, "TokensPurchased")
            .withArgs(user.address, usdtAddr, ONE_TOKEN, 100n, false);
    });

    it("should work when discounted sale is paused", async function () {
        const { presale, usdt, user } = await loadFixture(
            deployPresaleDiscountPausedFixture
        );
        const usdtAddr = await usdt.getAddress();
        await expect(
            presale
                .connect(user)
                .buyTokensWithStablecoinAtBasePrice(usdtAddr, ONE_TOKEN)
        ).to.not.be.reverted;
    });

    it("should revert when main sale is paused", async function () {
        const { presale, usdt, user } = await loadFixture(
            deployPresalePausedFixture
        );
        await expect(
            presale
                .connect(user)
                .buyTokensWithStablecoinAtBasePrice(await usdt.getAddress(), ONE_TOKEN)
        ).to.be.revertedWithCustomError(presale, "EnforcedPause");
    });

    it("should revert TokenNotSupported for non-whitelisted token", async function () {
        const { presale, user } = await loadFixture(deployPresaleFixture);
        const fake = await deployMockStablecoin("FAKE", "FAKE", 6);
        await expect(
            presale
                .connect(user)
                .buyTokensWithStablecoinAtBasePrice(await fake.getAddress(), ONE_TOKEN)
        ).to.be.revertedWithCustomError(presale, "TokenNotSupported");
    });

    it("should revert MinimumPurchaseNotMet for < 1 token", async function () {
        const { presale, usdt, user } = await loadFixture(deployPresaleFixture);
        await expect(
            presale
                .connect(user)
                .buyTokensWithStablecoinAtBasePrice(
                    await usdt.getAddress(),
                    ethers.parseEther("0.001")
                )
        ).to.be.revertedWithCustomError(presale, "MinimumPurchaseNotMet");
    });
});

// ============================================================
// ADMIN FUNCTIONS TESTS
// ============================================================
describe("VittagemsPresale - Admin Functions", function () {
    describe("pauseDiscountedSale() / resumeDiscountedSale()", function () {
        it("should pause discounted sale", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await presale.connect(owner).pauseDiscountedSale();
            expect(await presale.discountedSalePaused()).to.be.true;
        });

        it("should emit DiscountedSalePaused event", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await expect(presale.connect(owner).pauseDiscountedSale())
                .to.emit(presale, "DiscountedSalePaused");
        });

        it("should resume discounted sale", async function () {
            const { presale, owner } = await loadFixture(
                deployPresaleDiscountPausedFixture
            );
            await presale.connect(owner).resumeDiscountedSale();
            expect(await presale.discountedSalePaused()).to.be.false;
        });

        it("should emit DiscountedSaleResumed event", async function () {
            const { presale, owner } = await loadFixture(
                deployPresaleDiscountPausedFixture
            );
            await expect(presale.connect(owner).resumeDiscountedSale())
                .to.emit(presale, "DiscountedSaleResumed");
        });

        it("should revert if non-owner pauses discounted sale", async function () {
            const { presale, attacker } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(attacker).pauseDiscountedSale()
            ).to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");
        });

        it("should revert if non-owner resumes discounted sale", async function () {
            const { presale, owner, attacker } = await loadFixture(
                deployPresaleFixture
            );
            await presale.connect(owner).pauseDiscountedSale();
            await expect(
                presale.connect(attacker).resumeDiscountedSale()
            ).to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");
        });
    });

    describe("pauseSale() / resumeSale()", function () {
        it("should pause entire sale", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await presale.connect(owner).pauseSale();
            expect(await presale.paused()).to.be.true;
        });

        it("should emit Paused event", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await expect(presale.connect(owner).pauseSale())
                .to.emit(presale, "Paused")
                .withArgs(owner.address);
        });

        it("should resume sale", async function () {
            const { presale, owner } = await loadFixture(deployPresalePausedFixture);
            await presale.connect(owner).resumeSale();
            expect(await presale.paused()).to.be.false;
        });

        it("should emit Unpaused event", async function () {
            const { presale, owner } = await loadFixture(deployPresalePausedFixture);
            await expect(presale.connect(owner).resumeSale())
                .to.emit(presale, "Unpaused")
                .withArgs(owner.address);
        });

        it("should revert if non-owner calls pauseSale", async function () {
            const { presale, attacker } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(attacker).pauseSale()
            ).to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");
        });

        it("should revert if already paused", async function () {
            const { presale, owner } = await loadFixture(deployPresalePausedFixture);
            await expect(
                presale.connect(owner).pauseSale()
            ).to.be.revertedWithCustomError(presale, "EnforcedPause");
        });

        it("should revert resumeSale if not paused", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(owner).resumeSale()
            ).to.be.revertedWithCustomError(presale, "ExpectedPause");
        });
    });

    describe("setBasePrice()", function () {
        it("should allow owner to update base price", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await presale.connect(owner).setBasePrice(200n);
            expect(await presale.basePriceCents()).to.equal(200n);
        });

        it("should emit BasePriceUpdated with old and new price", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await expect(presale.connect(owner).setBasePrice(200n))
                .to.emit(presale, "BasePriceUpdated")
                .withArgs(100n, 200n);
        });

        it("should allow setting minimum price (1 cent)", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await presale.connect(owner).setBasePrice(1n);
            expect(await presale.basePriceCents()).to.equal(1n);
        });

        it("should allow setting maximum price (1000 cents = $10)", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await presale.connect(owner).setBasePrice(1000n);
            expect(await presale.basePriceCents()).to.equal(1000n);
        });

        it("should revert InvalidPrice for price = 0", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(owner).setBasePrice(0n)
            ).to.be.revertedWithCustomError(presale, "InvalidPrice");
        });

        it("should revert InvalidPrice for price > 1000", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(owner).setBasePrice(1001n)
            ).to.be.revertedWithCustomError(presale, "InvalidPrice");
        });

        it("should revert if non-owner calls setBasePrice", async function () {
            const { presale, attacker } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(attacker).setBasePrice(50n)
            ).to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");
        });

        it("should affect future purchase pricing after update", async function () {
            const { presale, owner, usdt, user } = await loadFixture(
                deployPresaleFixture
            );
            await presale.connect(owner).setBasePrice(200n); // $2.00

            // 1 token * 200 cents = 200 cents = 200 * 10^4 = 2,000,000 USDT (6 dec)
            const expectedUsdt = calculateStablecoinCost(200n, 6);
            const balBefore = await usdt.balanceOf(user.address);

            await presale
                .connect(user)
                .buyTokensWithStablecoin(await usdt.getAddress(), ONE_TOKEN);

            const balAfter = await usdt.balanceOf(user.address);
            expect(balBefore - balAfter).to.equal(expectedUsdt);
        });
    });

    describe("setPriceFeed()", function () {
        it("should allow owner to update price feed", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            const newFeed = await deployMockPriceFeed();
            await presale.connect(owner).setPriceFeed(await newFeed.getAddress());
            expect(await presale.nativePriceFeed()).to.equal(
                await newFeed.getAddress()
            );
        });

        it("should emit ConfigUpdated event", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            const newFeed = await deployMockPriceFeed();
            const newFeedAddr = await newFeed.getAddress();
            await expect(presale.connect(owner).setPriceFeed(newFeedAddr))
                .to.emit(presale, "ConfigUpdated")
                .withArgs("PriceFeed", newFeedAddr);
        });

        it("should revert ZeroAddress for zero address feed", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(owner).setPriceFeed(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "ZeroAddress");
        });

        it("should revert if non-owner calls setPriceFeed", async function () {
            const { presale, attacker } = await loadFixture(deployPresaleFixture);
            const newFeed = await deployMockPriceFeed();
            await expect(
                presale.connect(attacker).setPriceFeed(await newFeed.getAddress())
            ).to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");
        });

        it("should use new feed for subsequent ETH price calculations", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);

            // New feed: ETH = $4000 (double the original $2000)
            // Chainlink format: 4000 * 10^8 = 400_000_000_000
            const newEthPrice = 4000n;
            const newChainlinkPrice = newEthPrice * 10n ** 8n; // 400_000_000_000
            const newFeed = await deployMockPriceFeed(newChainlinkPrice, 8);

            await presale.connect(owner).setPriceFeed(await newFeed.getAddress());

            // At $4000/ETH, $1 costs 0.00025 ETH
            // Formula: (100 * 10^24) / (4000 * 10^8)
            //        = 10^26 / 4*10^11
            //        = 2.5 * 10^14 = 250_000_000_000_000 wei
            const ethRequired = await presale.getNativeAmountFromUsd(100n);
            const expected = calculateEthCost(100n, newChainlinkPrice, 8);

            expect(ethRequired).to.equal(expected);
            expect(ethRequired).to.equal(ethers.parseEther("0.00025"));
        });
    });

    describe("withdrawFunds()", function () {
        it("should withdraw full ETH balance to owner", async function () {
            const { presale, owner, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            // Fund the presale with ETH
            await user.sendTransaction({
                to: presaleAddr,
                value: ethers.parseEther("1"),
            });

            const ownerBalBefore = await ethers.provider.getBalance(owner.address);
            const tx = await presale.connect(owner).withdrawFunds(ethers.ZeroAddress, 0);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const ownerBalAfter = await ethers.provider.getBalance(owner.address);

            const netReceived = ownerBalAfter - ownerBalBefore + gasUsed;
            expect(netReceived).to.equal(ethers.parseEther("1"));
        });

        it("should withdraw specific ETH amount", async function () {
            const { presale, owner, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            await user.sendTransaction({
                to: presaleAddr,
                value: ethers.parseEther("2"),
            });

            const halfEth = ethers.parseEther("1");
            const ownerBalBefore = await ethers.provider.getBalance(owner.address);
            const tx = await presale.connect(owner).withdrawFunds(ethers.ZeroAddress, halfEth);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const ownerBalAfter = await ethers.provider.getBalance(owner.address);

            const netReceived = ownerBalAfter - ownerBalBefore + gasUsed;
            expect(netReceived).to.equal(halfEth);
        });

        it("should withdraw full USDT balance when amount = 0", async function () {
            const { presale, owner, usdt, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            const usdtAddr = await usdt.getAddress();

            // Deposit USDT into presale (simulate purchase)
            await presale.connect(user).buyTokensWithStablecoin(usdtAddr, ONE_TOKEN);

            const presaleBal = await usdt.balanceOf(presaleAddr);
            expect(presaleBal).to.be.gt(0n);

            await presale.connect(owner).withdrawFunds(usdtAddr, 0);
            expect(await usdt.balanceOf(presaleAddr)).to.equal(0n);
            expect(await usdt.balanceOf(owner.address)).to.equal(presaleBal);
        });

        it("should withdraw specific USDT amount", async function () {
            const { presale, owner, usdt, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            const usdtAddr = await usdt.getAddress();

            // Deposit via purchase
            await presale.connect(user).buyTokensWithStablecoin(usdtAddr, HUNDRED_TOKENS);

            const presaleBal = await usdt.balanceOf(presaleAddr);
            const halfBal = presaleBal / 2n;

            await presale.connect(owner).withdrawFunds(usdtAddr, halfBal);

            expect(await usdt.balanceOf(owner.address)).to.equal(halfBal);
            expect(await usdt.balanceOf(presaleAddr)).to.equal(presaleBal - halfBal);
        });

        it("should withdraw full balance when amount > balance", async function () {
            const { presale, owner, usdt, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            const usdtAddr = await usdt.getAddress();
            await presale.connect(user).buyTokensWithStablecoin(usdtAddr, ONE_TOKEN);

            const presaleBal = await usdt.balanceOf(presaleAddr);
            const overAmount = presaleBal * 100n; // request more than balance

            await presale.connect(owner).withdrawFunds(usdtAddr, overAmount);
            expect(await usdt.balanceOf(presaleAddr)).to.equal(0n);
        });

        it("should emit FundsWithdrawn event for ETH", async function () {
            const { presale, owner, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            const ethAmount = ethers.parseEther("1");
            await user.sendTransaction({ to: presaleAddr, value: ethAmount });

            await expect(presale.connect(owner).withdrawFunds(ethers.ZeroAddress, 0))
                .to.emit(presale, "FundsWithdrawn")
                .withArgs(ethers.ZeroAddress, owner.address, ethAmount);
        });

        it("should emit FundsWithdrawn event for USDT", async function () {
            const { presale, owner, usdt, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            const usdtAddr = await usdt.getAddress();
            await presale.connect(user).buyTokensWithStablecoin(usdtAddr, ONE_TOKEN);
            const presaleBal = await usdt.balanceOf(presaleAddr);

            await expect(presale.connect(owner).withdrawFunds(usdtAddr, 0))
                .to.emit(presale, "FundsWithdrawn")
                .withArgs(usdtAddr, owner.address, presaleBal);
        });

        it("should revert ZeroAmount when ETH balance is 0", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(owner).withdrawFunds(ethers.ZeroAddress, 0)
            ).to.be.revertedWithCustomError(presale, "ZeroAmount");
        });

        it("should revert ZeroAmount when ERC20 balance is 0", async function () {
            const { presale, owner, usdt } = await loadFixture(deployPresaleFixture);
            await expect(
                presale.connect(owner).withdrawFunds(await usdt.getAddress(), 0)
            ).to.be.revertedWithCustomError(presale, "ZeroAmount");
        });

        it("should revert if non-owner calls withdrawFunds", async function () {
            const { presale, attacker, user, presaleAddr } = await loadFixture(
                deployPresaleFixture
            );
            await user.sendTransaction({
                to: presaleAddr,
                value: ethers.parseEther("1"),
            });
            await expect(
                presale.connect(attacker).withdrawFunds(ethers.ZeroAddress, 0)
            ).to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");
        });
    });
});

// ============================================================
// isDiscountedSaleActive() VIEW TESTS
// ============================================================
describe("VittagemsPresale - isDiscountedSaleActive()", function () {
    it("should return true when neither sale nor discount is paused", async function () {
        const { presale } = await loadFixture(deployPresaleFixture);
        expect(await presale.isDiscountedSaleActive()).to.be.true;
    });

    it("should return false when discounted sale is paused", async function () {
        const { presale } = await loadFixture(deployPresaleDiscountPausedFixture);
        expect(await presale.isDiscountedSaleActive()).to.be.false;
    });

    it("should return false when main sale is paused", async function () {
        const { presale } = await loadFixture(deployPresalePausedFixture);
        expect(await presale.isDiscountedSaleActive()).to.be.false;
    });

    it("should return false when both sales are paused", async function () {
        const { presale, owner } = await loadFixture(deployPresaleFixture);
        await presale.connect(owner).pauseDiscountedSale();
        await presale.connect(owner).pauseSale();
        expect(await presale.isDiscountedSaleActive()).to.be.false;
    });

    it("should return true after unpausing discounted sale", async function () {
        const { presale, owner } = await loadFixture(
            deployPresaleDiscountPausedFixture
        );
        await presale.connect(owner).resumeDiscountedSale();
        expect(await presale.isDiscountedSaleActive()).to.be.true;
    });
});

// ============================================================
// GAS BENCHMARKS
// ============================================================
describe("VittagemsPresale - Gas Benchmarks", function () {
    it("should measure gas for buyTokensWithNative()", async function () {
        const { presale, user } = await loadFixture(deployPresaleFixture);
        const ethCost = await presale.getNativeAmountFromUsd(100n);
        const tx = await presale.connect(user).buyTokensWithNative(ONE_TOKEN, {
            value: withSlippage(ethCost),
        });
        const receipt = await tx.wait();
        console.log(`      ⛽ buyTokensWithNative() gas: ${receipt.gasUsed}`);
        expect(receipt.gasUsed).to.be.lt(300000n);
    });

    it("should measure gas for buyTokensWithStablecoin()", async function () {
        const { presale, usdt, user } = await loadFixture(deployPresaleFixture);
        const tx = await presale
            .connect(user)
            .buyTokensWithStablecoin(await usdt.getAddress(), ONE_TOKEN);
        const receipt = await tx.wait();
        console.log(`      ⛽ buyTokensWithStablecoin() gas: ${receipt.gasUsed}`);
        expect(receipt.gasUsed).to.be.lt(200000n);
    });

    it("should measure gas for withdrawFunds() ETH", async function () {
        const { presale, owner, user, presaleAddr } = await loadFixture(
            deployPresaleFixture
        );
        await user.sendTransaction({
            to: presaleAddr,
            value: ethers.parseEther("1"),
        });
        const tx = await presale.connect(owner).withdrawFunds(ethers.ZeroAddress, 0);
        const receipt = await tx.wait();
        console.log(`      ⛽ withdrawFunds(ETH) gas: ${receipt.gasUsed}`);
        expect(receipt.gasUsed).to.be.lt(100000n);
    });
});