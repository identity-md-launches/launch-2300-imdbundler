# Hook design and accounting

## Immutable scope

`IMDBHook` derives from the local `HookBase` implementing v4 `IHooks`. Every enabled callback authenticates `msg.sender == poolManager`, validates the exact token/IMD key, and returns its required selector. Disabled callbacks always revert and are not advertised. The manager and launch token are constructor immutables. Construction performs no external calls and needs no deployed external code. There is no administrator and no inherited ownership.

Configuration: general BaseHook-style custom callbacks; beforeInitialize, beforeSwap, afterSwap, beforeSwapReturnDelta, afterSwapReturnDelta enabled; all other flags false. Access: none. Shares: none. Checked casting: OpenZeppelin SafeCast, inlined. Settlement: manager ERC-6909 claims and `take`. Transient-storage utility: not used; small transaction phase guards are cleared before returning. No helper contracts, external executor, router allowlist, hookData authority, or caller-controlled recipient exists.

Permissions equal `0x2000 + 0x80 + 0x40 + 0x08 + 0x04 = 0x20cc`. The constructor checks the mined address. Public `getHookPermissions()` agrees with it. The token and hook have no external library link references.

## Exact 2% definition

Both currencies have 18 decimals. “2%” uses integer minor units; `floor(base / 50)` is charged. Sub-unit fees cannot be represented. On buys the base is **total IMD debited to the trader, including the hook fee**. On sells the base is **gross IMD produced by the pool before subtracting the hook fee**. The LP fee remains separate and is included in the pool's ordinary accounting.

Let `C` be the absolute IMD delta returned by the AMM before the hook fee, `F` the hook fee, and `A` the user's specified IMD amount when applicable.

| Trade | Desired result | Fee calculation / delta |
| --- | --- | --- |
| Buy, exact input | IMD input is a maximum budget `A` | Reserve `floor(A/50)`, quote the remaining input. Full fill uses that reserve. Partial fill uses `floor(C/49)`. Return `+F` in the specified beforeSwap delta. |
| Buy, exact output | Requested IMDB output is unchanged | `F = floor(C/49)`; return `+F` in the unspecified afterSwap delta. Total IMD cost is `C+F`. |
| Sell, exact input | IMDB input is unchanged | `F = floor(C/50)`; return `+F` in the unspecified afterSwap delta. Trader gets `C-F` IMD. |
| Sell, exact output | Requested IMD output `A` is net of the fee | Quote gross output `A + floor(A/49)`, derive `F = floor(C/50)`, and return `+F` in the specified beforeSwap delta. |

For a partial exact-input buy, the actual total debit is `C+F`, with `F=floor((C+F)/50)`. For a partially filled exact-output sell, both the quoted gross and actual target exceed the obtainable output, so the same price limit produces the same `C`. The real afterSwap delta is checked again: fee disagreement reverts the entire trade. No fee is based on an unfilled requested amount. Zero fills charge zero; tiny fills follow documented rounding.

### Why the self-quote exists

v4's afterSwap return delta only adjusts the **unspecified** currency. Charging the pair currency on a buy with exact pair input, or a sell with exact pair output, therefore requires a specified delta in beforeSwap. Charging a fixed percentage of the request would overcharge partial fills.

For those two cases, beforeSwap calls `this.quoteSwap` with the adjusted amount. That function is **only callable by the hook itself**, swaps through the fixed manager, then deliberately reverts with its `BalanceDelta`. All quote state, claims, pool changes, protocol fees, and logs roll back. The caller accepts only the exact expected error shape and rethrows other failures. The actual AMM trade then executes normally using the calculated fee.

The beforeSwap delta never consumes the whole exact-input trade: a full buy reserves only 2%; a partial buy reserves less. The NoOp pattern that takes all user input without executing the AMM is not used. Sells with exact pair output increase the gross target to preserve the requested net output. Router return deltas reflect the actual fill and work with ordinary delta-based settlement, not a hidden refund that the router would have to discover.

## Same-flow buyback and burn

The fee is minted as an IMD ERC-6909 claim on the hook. It is never transferred as an ERC-20 to the hook or an operator. The hook burns fee claims into credit, performs one exact-input IMD → IMDB swap, and remints any unspent IMD. The buyback uses the same pool at its normal 1.25% LP fee. v4 deliberately skips callbacks for swaps initiated by that pool's own hook, preventing recursive taxation. Outside callers cannot invoke a free self-swap: the quote is only-self and public processing has a fixed destination and purpose.

The buyback limit is fixed at ±1% **square-root** price movement from the post-user-trade price (about 1.99% downward or 2.01% upward price movement). Limits are clamped inside TickMath bounds. At the terminal price, with no usable liquidity, or after hitting this bound, remaining IMD stays a claim. There is at most one buyback attempt per invocation; no keeper-supplied venue, price, payout, or unbounded processing queue.

The buyback is skipped entirely while the pool has **no liquidity at the current tick** (`getLiquidity(poolId) == 0`). v4 moves the price of an empty range straight to the swap's limit without consuming input, so without this check every permissionless `processFees()` call would shift `slot0` by the full bound at no cost and could walk the price into a distant range before spending the pending IMD there. With the check, pending IMD waits until a user's trade or new liquidity brings the current tick back in range. The check reads only the current tick's liquidity: a buyback that starts in range and runs off its end still moves the price to the bound, which is the ordinary cost-free price walk v4 allows any swapper through empty ranges.

IMDB proceeds are first recorded as token claims. As many as the PoolManager can physically pay are redeemed to the hook and immediately burned through `IMDBToken.burn`, with one exception: when the PoolManager's synced currency is IMDB, the burn is deferred. A payer may `sync(IMDB)` and transfer its input before calling `swap()` and only `settle()` afterwards; `settle()` credits the growth of the manager's IMDB balance since the sync, so a `take` of IMDB inside the swap would shrink that credit by the burned amount and the payer would either fail with `CurrencyNotSettled` or pay the burn on top of its input. The hook reads `TransientStateLibrary.getSyncedCurrency` and leaves the purchased IMDB as a claim in that case. A payer that settles before the swap (a router's SETTLE then SWAP) and a buyer with IMD synced are unaffected and burn in the same flow. If a seller's token input has not settled yet, the manager can also owe IMDB without currently possessing it. In both cases, claims wait rather than making the user's swap fail or overcharging it. The next swap retries them. Anyone can call `processFees()` after the manager unlock has finished, including later in the same outer transaction. It unlocks the manager itself; only that manager may enter the guarded `unlockCallback`. Nobody has IMDB synced inside that unlock, so a retry always burns what the manager holds.

Processing receives no reward. Deferred claims may persist without future liquidity or someone paying retry gas. They can never be diverted to a recipient or withdrawn by an owner.

## Delta conservation

For one callback fee `F`, total claim input `P`, buyback spend `S`, bought IMDB `T`, and immediately redeemable IMDB `R`:

| Action | Hook IMD delta | Hook IMDB delta |
| --- | ---: | ---: |
| Mint current fee claim | `-F` | 0 |
| Burn claims for buyback | `+P` | 0 |
| Buyback AMM swap | `-S` | `+T` |
| Remint unsold IMD and purchased-token claims | `-(P-S)` | `-T` |
| Burn redeemable token claims and take tokens (skipped while IMDB is the synced currency) | 0 | `+R-R = 0` |
| PoolManager credits returned hook fee | `+F` | 0 |
| **Total** | **0** | **0** |

The ERC-20 burn reduces token supply and the hook's physical balance by `R`. It does not change manager deltas. Token transfers themselves have no fee.

`totalFeesIMD` counts swap charges; `totalBuybackIMD` counts all IMD claim spending; `totalBurned` counts burns performed by the hook. Without unsolicited claim donations, `totalFeesIMD = totalBuybackIMD + pendingIMD`. Anyone can transfer ERC-6909 claims to the hook: such donations are also bought/burned and can make spending exceed the fee-only counter. Other holders may independently burn their own IMDB, so hook burns need not equal all historical supply reduction. Ordinary ERC-20 donations to the hook are unsupported and have no recovery path.

## Limits and economic assumptions

The pair must continue behaving as a normal 18-decimal ERC-20. Taxed, rebasing, malicious callback, or externally blocked IMD behavior is not supported. The launch token is the supplied immutable implementation. PoolManager is trusted to be the chain's legitimate Uniswap v4 manager.

The fixed buyback price bound limits its own price impact, **not** manipulation of the starting price. There is no TWAP, oracle, auction, sandwich guarantee, or admin able to delay a buyback. Public-mempool price manipulation and LP behavior remain risks. Traders must set their own minimum output / maximum input and price limits. Internal buybacks may move the pool after the user's trade; the user's recorded execution still respects its trade limit. Slippage bounds do not include a promise of fair external-market value.

Specified user amounts are bounded to `2^126-1` units; each processing attempt uses at most `2^127-1` IMD units. All narrowing conversions use checked SafeCast. No ETH balance is needed by the hook or manager for fee settlement.
