// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookBase} from "./HookBase.sol";
import {IMDBToken} from "./IMDBToken.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";

/// @notice Immutable IMD-denominated 2% swap fee, recycled into IMDB and burned.
/// @dev A reverted self-quote is necessary only when IMD is the specified currency: it finds the
/// actual fill before committing a specified return delta. The outer pool swap still executes.
contract IMDBHook is HookBase, IUnlockCallback {
    using StateLibrary for IPoolManager;
    using SafeCast for uint256;
    using SafeCast for int256;

    error InvalidConfiguration();
    error WrongPool();
    error Busy();
    error OnlySelf();
    error QuoteResult(int256 delta);
    error InvalidQuote();
    error FeeMismatch();
    error AmountTooLarge();
    error UnexpectedUnlock();

    address public constant IMD = 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7;
    uint24 public constant LP_FEE = 12_500;
    int24 public constant TICK_SPACING = 60;
    uint256 public constant FEE_BPS = 200;
    uint256 public constant BUYBACK_SQRT_MOVE_BPS = 100;
    uint160 public constant FLAGS = 0x20cc;

    IMDBToken public immutable token;
    bool public immutable pairIsCurrency0;
    uint256 public totalFeesIMD;
    uint256 public totalBuybackIMD;
    uint256 public totalBurned;

    bool private swapping;
    bool private processing;
    uint256 private specifiedFee;

    event FeeCharged(bool indexed buy, uint256 settledPairAmount, uint256 fee);
    event Buyback(uint256 imdSpent, uint256 imdbPurchased);
    event Burned(uint256 amount);

    constructor(IPoolManager manager_, IMDBToken token_) HookBase(manager_) {
        if (address(manager_) == address(0) || address(token_) == address(0) || address(token_) == IMD) {
            revert InvalidConfiguration();
        }
        token = token_;
        pairIsCurrency0 = IMD < address(token_);
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(pairIsCurrency0 ? IMD : address(token)),
            currency1: Currency.wrap(pairIsCurrency0 ? address(token) : IMD),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    function beforeInitialize(address, PoolKey calldata key, uint160)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        _checkPool(key);
        return IHooks.beforeInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _checkPool(key);
        if (swapping || processing) revert Busy();
        swapping = true;
        bool buy = params.zeroForOne == pairIsCurrency0;
        bool exactIn = params.amountSpecified < 0;
        if (params.amountSpecified == type(int256).min) revert AmountTooLarge();
        uint256 amount = (exactIn ? -params.amountSpecified : params.amountSpecified).toUint256();
        if (amount > ((1 << 126) - 1)) revert AmountTooLarge();
        uint256 fee = 0;
        if (buy == exactIn) {
            SwapParams memory quoted = params;
            if (buy) {
                // A buy's 2% is included in its total IMD input budget.
                fee = amount / 50;
                uint256 budget = amount - fee;
                quoted.amountSpecified = -budget.toInt256();
                uint256 used = _pairMagnitude(_quote(key, quoted));
                if (used < budget) fee = used / 49;
            } else {
                // A sell's specified IMD output is net of the fee.
                quoted.amountSpecified = (amount + amount / 49).toInt256();
                fee = _pairMagnitude(_quote(key, quoted)) / 50;
            }
        }
        specifiedFee = fee;
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(fee.toInt256().toInt128(), 0), 0);
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, int128)
    {
        _checkPool(key);
        if (!swapping || processing) revert Busy();
        processing = true;
        bool buy = params.zeroForOne == pairIsCurrency0;
        bool pairSpecified = buy == (params.amountSpecified < 0);
        uint256 pairAmount = _pairMagnitude(delta);
        uint256 fee = pairSpecified ? specifiedFee : (buy ? pairAmount / 49 : pairAmount / 50);
        // A quoted partial fill must agree with the real fill, including integer rounding.
        if (fee != (buy ? (pairAmount + fee) / 50 : pairAmount / 50)) revert FeeMismatch();
        specifiedFee = 0;
        if (fee != 0) {
            totalFeesIMD += fee;
            poolManager.mint(address(this), uint256(uint160(IMD)), fee);
        }
        emit FeeCharged(buy, buy ? pairAmount + fee : pairAmount, fee);
        _process(key);
        processing = false;
        swapping = false;
        return (IHooks.afterSwap.selector, pairSpecified ? int128(0) : fee.toInt256().toInt128());
    }

    /// @dev Quotes cannot persist state, take funds, or bypass the fee for an external caller.
    function quoteSwap(PoolKey calldata key, SwapParams calldata params) external {
        if (msg.sender != address(this)) revert OnlySelf();
        BalanceDelta delta = poolManager.swap(key, params, "");
        revert QuoteResult(BalanceDelta.unwrap(delta));
    }

    function _quote(PoolKey calldata key, SwapParams memory params) private returns (BalanceDelta delta) {
        (bool ok, bytes memory result) = address(this).call(abi.encodeCall(this.quoteSwap, (key, params)));
        if (ok) revert InvalidQuote();
        if (result.length != 36) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
        bytes4 selector;
        int256 raw;
        assembly ("memory-safe") {
            selector := mload(add(result, 32))
            raw := mload(add(result, 36))
        }
        if (selector != QuoteResult.selector) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
        return BalanceDelta.wrap(raw);
    }

    /// @notice Anyone may retry deferred buybacks and burns. No recipient, reward, or admin privilege.
    function processFees() external {
        if (swapping || processing) revert Busy();
        processing = true;
        if (poolManager.unlock("").length != 0) revert UnexpectedUnlock();
        processing = false;
    }

    function unlockCallback(bytes calldata) external onlyPoolManager returns (bytes memory) {
        if (!processing || swapping) revert UnexpectedUnlock();
        _process(poolKey());
        return "";
    }

    function pendingIMD() external view returns (uint256) {
        return poolManager.balanceOf(address(this), uint256(uint160(IMD)));
    }

    function pendingIMDB() external view returns (uint256) {
        return poolManager.balanceOf(address(this), uint256(uint160(address(token))));
    }

    function _process(PoolKey memory key) private {
        uint256 pairId = uint256(uint160(IMD));
        uint256 available = poolManager.balanceOf(address(this), pairId);
        uint256 maxAmount = (1 << 127) - 1;
        if (available > maxAmount) available = maxAmount;
        if (available != 0) {
            (uint160 price,,,) = poolManager.getSlot0(key.toId());
            uint256 bound = pairIsCurrency0
                ? uint256(price) * (10_000 - BUYBACK_SQRT_MOVE_BPS) / 10_000
                : uint256(price) * (10_000 + BUYBACK_SQRT_MOVE_BPS) / 10_000;
            if (bound <= TickMath.MIN_SQRT_PRICE) bound = uint256(TickMath.MIN_SQRT_PRICE) + 1;
            if (bound >= TickMath.MAX_SQRT_PRICE) bound = uint256(TickMath.MAX_SQRT_PRICE) - 1;
            if ((pairIsCurrency0 && bound < price) || (!pairIsCurrency0 && bound > price)) {
                poolManager.burn(address(this), pairId, available);
                // v4 skips this hook's callbacks for swaps initiated by this hook itself.
                BalanceDelta bought =
                    poolManager.swap(key, SwapParams(pairIsCurrency0, -available.toInt256(), bound.toUint160()), "");
                uint256 spent = _pairMagnitude(bought);
                int128 tokenDelta = pairIsCurrency0 ? bought.amount1() : bought.amount0();
                if (tokenDelta < 0 || spent > available) revert FeeMismatch();
                uint256 received = int256(tokenDelta).toUint256();
                if (available > spent) poolManager.mint(address(this), pairId, available - spent);
                if (received != 0) poolManager.mint(address(this), uint256(uint160(address(token))), received);
                totalBuybackIMD += spent;
                emit Buyback(spent, received);
            }
        }
        _burnAvailableTokens();
    }

    function _burnAvailableTokens() private {
        uint256 tokenId = uint256(uint160(address(token)));
        uint256 claim = poolManager.balanceOf(address(this), tokenId);
        if (claim == 0) return;
        uint256 balance = token.balanceOf(address(poolManager));
        uint256 amount = claim < balance ? claim : balance;
        if (amount == 0) return;
        totalBurned += amount;
        poolManager.burn(address(this), tokenId, amount);
        poolManager.take(Currency.wrap(address(token)), address(this), amount);
        token.burn(amount);
        emit Burned(amount);
    }

    function _checkPool(PoolKey calldata key) private view {
        if (
            address(key.hooks) != address(this) || key.fee != LP_FEE || key.tickSpacing != TICK_SPACING
                || Currency.unwrap(key.currency0) != (pairIsCurrency0 ? IMD : address(token))
                || Currency.unwrap(key.currency1) != (pairIsCurrency0 ? address(token) : IMD)
        ) revert WrongPool();
    }

    function _pairMagnitude(BalanceDelta delta) private view returns (uint256) {
        int256 amount = pairIsCurrency0 ? int256(delta.amount0()) : int256(delta.amount1());
        return (amount < 0 ? -amount : amount).toUint256();
    }
}
