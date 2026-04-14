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
    uint256 private constant MIN_PRICE_CENTS = 1;    // Minimum $0.01
    uint256 private constant MAX_PRICE_CENTS = 1000; // Maximum $10.00

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

    /**
     * @notice Constructor
     * @param _tokenAddress stablecoin token contract (mintable)
     * @param _nativePriceFeedAddress chainlink price feed for native/USD
     * @param _usdtTokenAddress USDT token address (6 decimals typical)
     * @param _usdcTokenAddress USDC token address (6 decimals typical)
     * @param initialOwner owner of the presale contract
     */
    constructor(
        address _tokenAddress,
        address _nativePriceFeedAddress,
        address _usdtTokenAddress,
        address _usdcTokenAddress,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_tokenAddress == address(0)) revert ZeroAddress();
        if (_nativePriceFeedAddress == address(0)) revert ZeroAddress();
        if (_usdtTokenAddress == address(0)) revert ZeroAddress();
        if (_usdcTokenAddress == address(0)) revert ZeroAddress();
        if (initialOwner == address(0)) revert ZeroAddress();

        token = IVittagemsStablecoin(_tokenAddress);
        nativePriceFeed = AggregatorV3Interface(_nativePriceFeedAddress);
        usdtToken = IERC20(_usdtTokenAddress);
        usdcToken = IERC20(_usdcTokenAddress);
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
        (, int256 price, , uint256 updatedAt, ) = nativePriceFeed.latestRoundData();
        
        if (price <= 0) revert InvalidOraclePrice();
        if (block.timestamp - updatedAt > ORACLE_STALENESS_THRESHOLD) revert StaleOracleData();

        uint8 priceDecimals = nativePriceFeed.decimals();

        // Calculate: (usdCents * 10^(18 + priceDecimals - 2)) / price
        return (_usdCents * (10 ** (uint256(18) + uint256(priceDecimals) - 2))) / uint256(price);
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
}