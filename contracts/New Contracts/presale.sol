// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVittagemsStablecoin {
    function mint(address to, uint256 amount) external;
    function totalSupply() external view returns (uint256);
    function MAX_SUPPLY() external view returns (uint256);
}

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract VittagemsPresale is Ownable, Pausable, ReentrancyGuard {
    using Address for address payable;
    using SafeERC20 for IERC20;

    // --- Custom Errors (Gas Optimized) ---
    error ZeroAddress();
    error ZeroTokens();
    error MinimumPurchaseNotMet();
    error TokenNotSupported();
    error InsufficientETHSent();
    error InvalidOraclePrice();
    error StaleOracleData();
    error ExceedsMaxSupply();
    error DecimalsTooLow();
    error DiscountedSaleIsPaused();
    error InvalidPrice();
    error ZeroAmount();
    // [FIX #4] New error for incomplete oracle round
    error OracleRoundIncomplete();
    // [FIX #3] New error for sequencer downtime
    error SequencerDown();
    error SequencerGracePeriodNotOver();
    // [FIX #7] New error for circuit breaker price bounds
    error PriceOutOfBounds();

    // --- State Variables ---
    IVittagemsStablecoin public immutable token;
    AggregatorV3Interface public nativePriceFeed;

    IERC20 public immutable usdtToken;  // Made immutable for gas savings
    IERC20 public immutable usdcToken;  // Made immutable for gas savings

    // Pricing - Now configurable
    uint256 public basePriceCents = 100; // $1.00 - Can be changed by admin
    uint256 public totalTokensSold;
    
    // Discounted Sale Control
    bool public discountedSalePaused;

    // Constants
    uint256 private constant ORACLE_STALENESS_THRESHOLD = 1 hours; // Reduced from 3 hours

    // [FIX #1] Raised minimum from 1 to 100 ($1.00) so no discount tier can round to zero
    // At MIN_PRICE_CENTS=100, the deepest discount (40% off) yields (100*60)/100 = 60 cents — safe.
    uint256 private constant MIN_PRICE_CENTS = 100;   // Minimum $1.00
    uint256 private constant MAX_PRICE_CENTS = 1000;   // Maximum $10.00

    // [FIX #3] L2 Sequencer Uptime Feed for Base
    AggregatorV3Interface public sequencerUptimeFeed;
    uint256 private constant SEQUENCER_GRACE_PERIOD = 1 hours;

    // [FIX #7] Configurable price sanity bounds for circuit breaker protection
    int256 public minPriceSanity;  // Minimum acceptable ETH/USD price (8 decimals)
    int256 public maxPriceSanity;  // Maximum acceptable ETH/USD price (8 decimals)

    // --- Events ---
    event TokensPurchased(
        address indexed buyer,
        address indexed currency,
        uint256 tokenAmount,
        uint256 costInUsdCents,
        bool discounted
    );
    event ConfigUpdated(string indexed name, address indexed newAddress);
    event FundsWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount
    );
    event DiscountedSalePaused();
    event DiscountedSaleResumed();
    event BasePriceUpdated(uint256 oldPrice, uint256 newPrice);
    // [FIX #7] New event for price bounds update
    event PriceSanityBoundsUpdated(int256 minPrice, int256 maxPrice);

    /**
     * @notice Constructor
     * @param _tokenAddress stablecoin token contract (mintable)
     * @param _nativePriceFeedAddress chainlink price feed for native/USD
     * @param _usdtTokenAddress USDT token address (6 decimals typical)
     * @param _usdcTokenAddress USDC token address (6 decimals typical)
     * @param initialOwner owner of the presale contract
     * @param _sequencerUptimeFeed Chainlink sequencer uptime feed address for Base L2
     */
    constructor(
        address _tokenAddress,
        address _nativePriceFeedAddress,
        address _usdtTokenAddress,
        address _usdcTokenAddress,
        address initialOwner,
        address _sequencerUptimeFeed
    ) Ownable(initialOwner) {
        if (_tokenAddress == address(0)) revert ZeroAddress();
        if (_nativePriceFeedAddress == address(0)) revert ZeroAddress();
        if (_usdtTokenAddress == address(0)) revert ZeroAddress();
        if (_usdcTokenAddress == address(0)) revert ZeroAddress();
        if (initialOwner == address(0)) revert ZeroAddress();
        // [FIX #3] Validate sequencer feed address
        if (_sequencerUptimeFeed == address(0)) revert ZeroAddress();

        token = IVittagemsStablecoin(_tokenAddress);
        nativePriceFeed = AggregatorV3Interface(_nativePriceFeedAddress);
        usdtToken = IERC20(_usdtTokenAddress);
        usdcToken = IERC20(_usdcTokenAddress);
        // [FIX #3] Store sequencer uptime feed
        sequencerUptimeFeed = AggregatorV3Interface(_sequencerUptimeFeed);
    }

    // Allow contract to receive ETH
    receive() external payable {}

    // --- Pricing Engine ---

    /**
     * @notice Calculates the discounted price per token based on quantity
     * @param _amountTokens The amount of tokens (in 18 decimals)
     * @return pricePerTokenCents discounted price in cents
     */
    function getDiscountedPrice(uint256 _amountTokens) public view returns (uint256 pricePerTokenCents) {
        pricePerTokenCents = basePriceCents;
        
        // Cache basePriceCents to save gas
        uint256 _basePrice = basePriceCents;
        
        // Calculate whole tokens
        uint256 tokensCount = _amountTokens / 1e18;

        if (tokensCount >= 1_000_000) {
            pricePerTokenCents = (_basePrice * 60) / 100; // 40% Off
        } else if (tokensCount >= 100_000) {
            pricePerTokenCents = (_basePrice * 70) / 100; // 30% Off
        } else if (tokensCount >= 10_000) {
            pricePerTokenCents = (_basePrice * 80) / 100; // 20% Off
        } else if (tokensCount >= 100) {
            pricePerTokenCents = (_basePrice * 90) / 100; // 10% Off
        }

        // [FIX #1] Enforce a minimum non-zero discounted price to prevent free token acquisition
        if (pricePerTokenCents == 0) {
            pricePerTokenCents = 1;
        }
    }

    /**
     * @notice Calculates the total USD cost with discounts
     * @param _amountTokens The amount of tokens (in 18 decimals)
     * @return total cost in USD cents
     */
    function calculateTotalCostWithDiscount(uint256 _amountTokens) public view returns (uint256) {
        if (_amountTokens == 0) revert ZeroTokens();
        uint256 pricePerTokenCents = getDiscountedPrice(_amountTokens);
        return (_amountTokens * pricePerTokenCents) / 1e18;
    }

    /**
     * @notice Calculates the total USD cost at base price (no discount)
     * @param _amountTokens The amount of tokens (in 18 decimals)
     * @return total cost in USD cents
     */
    function calculateTotalCostAtBasePrice(uint256 _amountTokens) public view returns (uint256) {
        if (_amountTokens == 0) revert ZeroTokens();
        return (_amountTokens * basePriceCents) / 1e18;
    }

    // --- Buy Functions (With Discount) ---

    /**
     * @notice Buy tokens with native ETH at discounted price
     * @param _amountTokensToBuy The amount of tokens to buy (18 decimals)
     */
    function buyTokensWithNative(
        uint256 _amountTokensToBuy
    ) external payable whenNotPaused nonReentrant {
        if (discountedSalePaused) revert DiscountedSaleIsPaused();
        if (_amountTokensToBuy < 1e18) revert MinimumPurchaseNotMet();

        uint256 costInUsdCents = calculateTotalCostWithDiscount(_amountTokensToBuy);
        uint256 ethRequired = getNativeAmountFromUsd(costInUsdCents);
        
        if (msg.value < ethRequired) revert InsufficientETHSent();

        _processPurchase(msg.sender, address(0), _amountTokensToBuy, costInUsdCents, true);

        // Refund excess ETH
        unchecked {
            uint256 excess = msg.value - ethRequired;
            if (excess > 0) payable(msg.sender).sendValue(excess);
        }
    }

    /**
     * @notice Buy tokens with stablecoin at discounted price
     * @param _stablecoinAddress USDT or USDC address
     * @param _amountTokensToBuy The amount of tokens to buy (18 decimals)
     */
    function buyTokensWithStablecoin(
        address _stablecoinAddress,
        uint256 _amountTokensToBuy
    ) external whenNotPaused nonReentrant {
        if (discountedSalePaused) revert DiscountedSaleIsPaused();
        _buyWithStablecoin(_stablecoinAddress, _amountTokensToBuy, true);
    }

    // --- Buy Functions (At Base Price - No Discount) ---

    /**
     * @notice Buy tokens with native ETH at base price (no discount)
     * @param _amountTokensToBuy The amount of tokens to buy (18 decimals)
     */
    function buyTokensWithNativeAtBasePrice(
        uint256 _amountTokensToBuy
    ) external payable whenNotPaused nonReentrant {
        if (_amountTokensToBuy < 1e18) revert MinimumPurchaseNotMet();

        uint256 costInUsdCents = calculateTotalCostAtBasePrice(_amountTokensToBuy);
        uint256 ethRequired = getNativeAmountFromUsd(costInUsdCents);
        
        if (msg.value < ethRequired) revert InsufficientETHSent();

        _processPurchase(msg.sender, address(0), _amountTokensToBuy, costInUsdCents, false);

        // Refund excess ETH
        unchecked {
            uint256 excess = msg.value - ethRequired;
            if (excess > 0) payable(msg.sender).sendValue(excess);
        }
    }

    /**
     * @notice Buy tokens with stablecoin at base price (no discount)
     * @param _stablecoinAddress USDT or USDC address
     * @param _amountTokensToBuy The amount of tokens to buy (18 decimals)
     */
    function buyTokensWithStablecoinAtBasePrice(
        address _stablecoinAddress,
        uint256 _amountTokensToBuy
    ) external whenNotPaused nonReentrant {
        _buyWithStablecoin(_stablecoinAddress, _amountTokensToBuy, false);
    }

    // --- Internal Functions ---

    function _buyWithStablecoin(
        address _stablecoinAddress,
        uint256 _amountTokensToBuy,
        bool _withDiscount
    ) internal {
        if (_stablecoinAddress != address(usdtToken) && 
            _stablecoinAddress != address(usdcToken)) {
            revert TokenNotSupported();
        }
        if (_amountTokensToBuy < 1e18) revert MinimumPurchaseNotMet();

        uint256 costInUsdCents = _withDiscount 
            ? calculateTotalCostWithDiscount(_amountTokensToBuy)
            : calculateTotalCostAtBasePrice(_amountTokensToBuy);

        uint8 decimals = IERC20Metadata(_stablecoinAddress).decimals();
        if (decimals < 2) revert DecimalsTooLow();

        uint256 stablecoinAmount;
        unchecked {
            stablecoinAmount = costInUsdCents * (10 ** (decimals - 2));
        }

        IERC20(_stablecoinAddress).safeTransferFrom(
            msg.sender,
            address(this),
            stablecoinAmount
        );

        _processPurchase(msg.sender, _stablecoinAddress, _amountTokensToBuy, costInUsdCents, _withDiscount);
    }

    function _processPurchase(
        address _buyer,
        address _currency,
        uint256 _tokensToMint,
        uint256 _costInUsdCents,
        bool _discounted
    ) internal {
        if (_tokensToMint == 0) revert ZeroTokens();
        
        uint256 currentSupply = token.totalSupply();
        uint256 maxSupply = token.MAX_SUPPLY();
        
        unchecked {
            if (currentSupply + _tokensToMint > maxSupply) revert ExceedsMaxSupply();
        }

        token.mint(_buyer, _tokensToMint);
        
        unchecked {
            totalTokensSold += _tokensToMint;
        }

        emit TokensPurchased(_buyer, _currency, _tokensToMint, _costInUsdCents, _discounted);
    }

    // --- View Helpers ---

    /**
     * @notice Convert USD cents to native currency amount (wei)
     * @param _usdCents dollars * 100
     * @return amount of native currency in wei
     */
    function getNativeAmountFromUsd(uint256 _usdCents) public view returns (uint256) {
        // [FIX #3] Check L2 sequencer uptime before using the price feed
        _checkSequencerUptime();

        // [FIX #4] Destructure all five return values and validate round completeness
        (
            uint80 roundId,
            int256 price,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = nativePriceFeed.latestRoundData();
        
        if (price <= 0) revert InvalidOraclePrice();
        if (block.timestamp - updatedAt > ORACLE_STALENESS_THRESHOLD) revert StaleOracleData();
        // [FIX #4] Ensure the oracle round is complete (not carrying forward a stale answer)
        if (answeredInRound < roundId) revert OracleRoundIncomplete();

        // [FIX #7] Enforce configurable price sanity bounds for circuit breaker protection
        if (minPriceSanity > 0 && price < minPriceSanity) revert PriceOutOfBounds();
        if (maxPriceSanity > 0 && price > maxPriceSanity) revert PriceOutOfBounds();

        uint8 priceDecimals = nativePriceFeed.decimals();

        // Calculate: (usdCents * 10^(18 + priceDecimals - 2)) / price
        return (_usdCents * (10 ** (uint256(18) + uint256(priceDecimals) - 2))) / uint256(price);
    }

    // [FIX #3] Internal function to verify L2 sequencer is live and grace period has elapsed
    function _checkSequencerUptime() internal view {
        (, int256 answer, uint256 startedAt, , ) = sequencerUptimeFeed.latestRoundData();

        // answer == 0: sequencer is up; answer == 1: sequencer is down
        if (answer != 0) revert SequencerDown();

        // Ensure the grace period has passed since sequencer came back up
        uint256 timeSinceUp = block.timestamp - startedAt;
        if (timeSinceUp < SEQUENCER_GRACE_PERIOD) revert SequencerGracePeriodNotOver();
    }

    /**
     * @notice Get current discount tier info
     * @param _amountTokens Amount of tokens to check
     * @return discountPercent The discount percentage (0-40)
     * @return finalPriceCents The final price per token in cents
     */
    function getDiscountInfo(uint256 _amountTokens) external view returns (
        uint256 discountPercent,
        uint256 finalPriceCents
    ) {
        uint256 tokensCount = _amountTokens / 1e18;
        
        if (tokensCount >= 1_000_000) {
            discountPercent = 40;
        } else if (tokensCount >= 100_000) {
            discountPercent = 30;
        } else if (tokensCount >= 10_000) {
            discountPercent = 20;
        } else if (tokensCount >= 100) {
            discountPercent = 10;
        } else {
            discountPercent = 0;
        }
        
        finalPriceCents = getDiscountedPrice(_amountTokens);
    }

    // --- Admin Functions ---

    /**
     * @notice Pause only the discounted sale
     */
    function pauseDiscountedSale() external onlyOwner {
        discountedSalePaused = true;
        emit DiscountedSalePaused();
    }

    /**
     * @notice Resume the discounted sale
     */
    function resumeDiscountedSale() external onlyOwner {
        discountedSalePaused = false;
        emit DiscountedSaleResumed();
    }

    /**
     * @notice Check if discounted sale is active
     */
    function isDiscountedSaleActive() external view returns (bool) {
        return !discountedSalePaused && !paused();
    }

    /**
     * @notice Set a new base price for tokens
     * @param _newPriceCents New price in cents (e.g., 100 = $1.00)
     */
    function setBasePrice(uint256 _newPriceCents) external onlyOwner {
        if (_newPriceCents < MIN_PRICE_CENTS || _newPriceCents > MAX_PRICE_CENTS) {
            revert InvalidPrice();
        }
        
        uint256 oldPrice = basePriceCents;
        basePriceCents = _newPriceCents;
        
        emit BasePriceUpdated(oldPrice, _newPriceCents);
    }

    // [FIX #7] Allow owner to set price sanity bounds for circuit breaker protection
    /**
     * @notice Set min/max acceptable ETH/USD price bounds for circuit breaker protection
     * @param _minPrice Minimum acceptable price (8 decimals, e.g., 10000000000 = $100). 0 to disable.
     * @param _maxPrice Maximum acceptable price (8 decimals, e.g., 10000000000000 = $100,000). 0 to disable.
     */
    function setPriceSanityBounds(int256 _minPrice, int256 _maxPrice) external onlyOwner {
        if (_minPrice < 0 || _maxPrice < 0) revert InvalidOraclePrice();
        if (_minPrice > 0 && _maxPrice > 0 && _minPrice >= _maxPrice) revert InvalidOraclePrice();

        minPriceSanity = _minPrice;
        maxPriceSanity = _maxPrice;

        emit PriceSanityBoundsUpdated(_minPrice, _maxPrice);
    }

    /**
     * @notice Withdraw ETH or ERC20 held by contract
     * @param _tokenAddress address(0) for native, otherwise ERC20 token address
     * @param _amount if 0, withdraw full balance
     */
    function withdrawFunds(
        address _tokenAddress,
        uint256 _amount
    ) external onlyOwner {
        address recipient = owner();
        
        if (_tokenAddress == address(0)) {
            uint256 balance = address(this).balance;
            if (balance == 0) revert ZeroAmount();
            
            uint256 amountToTransfer = (_amount == 0 || _amount > balance) ? balance : _amount;
            payable(recipient).sendValue(amountToTransfer);
            emit FundsWithdrawn(address(0), recipient, amountToTransfer);
        } else {
            IERC20 asset = IERC20(_tokenAddress);
            uint256 balance = asset.balanceOf(address(this));
            if (balance == 0) revert ZeroAmount();
            
            uint256 amountToTransfer = (_amount == 0 || _amount > balance) ? balance : _amount;
            asset.safeTransfer(recipient, amountToTransfer);
            emit FundsWithdrawn(_tokenAddress, recipient, amountToTransfer);
        }
    }

    /**
     * @notice Pause entire sale (both regular and discounted)
     */
    function pauseSale() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resume entire sale
     */
    function resumeSale() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Update the Chainlink price feed address
     * @param _newPriceFeed New price feed address
     */
    function setPriceFeed(address _newPriceFeed) external onlyOwner {
        if (_newPriceFeed == address(0)) revert ZeroAddress();
        nativePriceFeed = AggregatorV3Interface(_newPriceFeed);
        emit ConfigUpdated("PriceFeed", _newPriceFeed);
    }

    // [FIX #3] Allow owner to update the sequencer uptime feed if needed
    /**
     * @notice Update the Chainlink sequencer uptime feed address
     * @param _newSequencerFeed New sequencer uptime feed address
     */
    function setSequencerUptimeFeed(address _newSequencerFeed) external onlyOwner {
        if (_newSequencerFeed == address(0)) revert ZeroAddress();
        sequencerUptimeFeed = AggregatorV3Interface(_newSequencerFeed);
        emit ConfigUpdated("SequencerUptimeFeed", _newSequencerFeed);
    }
}
