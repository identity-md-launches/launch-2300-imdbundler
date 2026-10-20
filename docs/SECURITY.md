# Validation and security review

This is an implementation review and test record, not an independent security audit. The token and hook are already deployed. This follow-up changes the static site, public deployment metadata, and an invariant test harness; production Solidity source and dependencies remain unchanged. The network should independently review each site release before publication.

## Automated checks

Normal checks require no network or secrets. Results on the delivered implementation:

- `forge build`: succeeds with pinned Solidity 0.8.26 and Cancun.
- `forge test`: **114 reported tests/groups passed**, no failures or skips: 110 ordinary/fuzz tests and four invariant groups. Both the protected configuration's pinned seed and the assignment's explicit `FOUNDRY_FUZZ_SEED=0xacb203d670db1f70f458598b65fbad8cb01f4491378fbe0c08a61bd984f2c01f` were checked.
- Fuzz cases: 256 per fuzz test, including transfer/burn amounts, all trade directions and exactness modes, partial fills, and minor-unit rounding.
- Stateful invariants cover both currency orderings. Random trades, liquidity changes, multiple traders, mid-sync payments, donations and claim retries check fee conservation, total-supply reduction, backing, settled deltas, and no retained ERC-20 fees. The runs retained `fail_on_revert = true`.
- The assignment seed reproduced an existing harness error: a one-wei zeroForOne trade left the square-root price at a tick boundary while the stored tick was one lower. A reverse limit of stored tick + 1 then equaled the current price. Both regression tests failed before repair with `PriceLimitAlreadyExceeded`; the handler now derives its limit from the actual square-root price. No invariant was weakened and no hook behavior was changed.
- `forge fmt --check`: succeeds.
- `node --test test/site/*.test.mjs`: **30 tests** covering cryptographic export/restore through 50 wallets, wrong passwords, tampering, resource bounds, clear-during-encryption/restoration, standard keystore interoperability, transaction ABI fields, invalid inputs, and complete IPFS archive reconstruction. DOM tests exercise generation, encryption, funding, NFT plans, provider selection/rejection, uncertain submission locks, P&L wiring, and live stats success/failure. Separate tests cover duplicate provider announcements, account/network changes, expiry during permission prompts, invalid gas estimates, metadata validation, single-block reads, and impossible burn totals.
- A read-only check at Ethereum block **26234924** confirmed code at the supplied live token/hook, IMDB metadata, the hook's token reference, supply and burn counters. No live transaction was sent. See `OPERATIONS.md` for the snapshot and provenance.
- Historical checks retained from the original launch: a four-mode gas report (~0.35–0.46 million gas for local prefunded router calls), a read-only real-IMD fork at block **26234425**, and Router02/WETH identity checks. They were not rerun as part of this site follow-up. The browser still verifies selected chain, contract code, router WETH, and token decimals before built-in token buys.

The supplied protected floor checks were read as acceptance inputs. They are not copied into or weakened by this repository; the independent verifier runs them against the final launch artifacts.

## Contract review

| Area | Implementation and evidence |
| --- | --- |
| Authorization | All enabled hooks and unlock callback require the immutable PoolManager. `quoteSwap` is only-self. Unauthorized direct calls fail. |
| Initialization | Exact currencies, hook, fee, and tick spacing are checked. Duplicate/wrong initialization fails. The matching key initializes without an owner/factory privilege. |
| Permissions | Constructor validates low address bits; `getHookPermissions` declares `0x20cc`. Wrong-address construction fails. |
| Immutable economics | No owner, fee setter, pauser, admin withdrawal, proxy, external executor, or post-deployment mint. Runtime opcode scan rejects DELEGATECALL, CALLCODE, SELFDESTRUCT. |
| NoOp exposure | Before-swap returns only the calculated fee. The core still executes the trade. Fee cannot consume the entire exact input. Only-self quoting always reverts its effects. |
| Exact fills and partial fills | All four combinations, both currency orderings, tight price-limit fills, empty liquidity, and dust inputs tested. afterSwap checks the real settled fee equation. |
| Claims and cash availability | Token-only fresh manager buys succeed. IMD-only fresh manager sells defer token burns until actual input arrives. Bounded buyback leaves claims and permissionless retries make progress. No native balance is required. |
| Mid-sync settlement | A seller that syncs and transfers IMDB before `swap()` and settles after it pays exactly its input (fixed test and fuzz, both orderings): the hook never takes IMDB while IMDB is the manager's synced currency and burns on the next retry instead. Controls: settling before the swap, and a buyer with IMD synced, still burn in the same flow. Revision after an external review (finding `841aea96…`). |
| Empty-range retries | With pending IMD and zero in-range liquidity, repeated `processFees()` calls leave `slot0` and `pendingIMD` unchanged; once liquidity returns the retry spends. Revision after an external review (finding `03615ec5…`). |
| Conservation | No open manager deltas at unlock exit; fee spend plus outstanding claims equals fee charges in the no-donation test model. Supply reduction matches burns in the no-other-holder-burn model. |
| Reentrancy | `swapping` gates before/after phases; `processing` is set before fee processing and during permissionless unlock. The trusted manager's self-call bypass handles nested swaps; a public caller has no corresponding bypass. An adversarial manager-runtime test tries reentering processing and both swap callbacks during unlock; each is rejected, and the next legitimate processing call succeeds. |
| Settlement rollback | If the trader cannot settle input, fees, claims, buyback, and burn all roll back atomically. |
| Liquidity access | No add/remove permission flags. LP zero-change fee collection and full removal succeed after trading; no swap fee applies to those actions. |
| Type bounds | Explicit input limits and inlined OpenZeppelin SafeCast guard signed/narrowed amounts and price bounds. No unsigned reinterpretation of a negative delta. |
| External calls | Fixed PoolManager and launch token only. No arbitrary recipient, delegated code, token approval, allowance pull, or caller-supplied target exists in production contracts. |
| Other assets | Only the launch key is recognized. ERC-20 donations have no rescue path. ERC-6909 IMD/IMDB claim donations are processed for buyback/burn and are not counted as charged swap fees. |

The general Ethereum and v4 security references supplied with the assignment were used as checklists. Router allowlisting is intentionally unnecessary: this hook neither authenticates an end user through hookData nor spends any user's allowance. Trading remains permissionless.

Foundry's built-in lint also runs with `forge build`. The remaining external-call/reentrancy/event-order heuristics refer to PoolManager calls followed by phase-guard cleanup, realized-swap counters, or events. The custom phase guards are already held during those calls; only the fixed manager and the immutable standard launch token are called. These warnings were reviewed rather than treating a blanket suppression as a security argument. OpenZeppelin's internal SafeCast performs the checked conversions. Slither, Mythril, formal verification, and a separate human audit were **not** run by this assignment.

### Residual contract risks

The buyback starting price is the immediate post-trade pool price, not a manipulation-resistant oracle. The 1% square-root price bound limits incremental execution movement, not sandwiching or fair value. The extra buyback pays LP fees. Low liquidity can defer claims indefinitely. Permissionless retry has no keeper incentive. A canonical trusted manager, the supplied standard launch token, normal mainnet IMD transfer behavior, and correct factory parameters are assumptions. No owner can fix a deployed bug, pause, or rescue funds. Users must apply their own final swap bounds and understand these immutable tradeoffs.

## Browser trust boundary

The frontend is ordinary static HTML/CSS/ES modules. Only the local vendor bundle is imported; there is no telemetry, remote script, dynamic code evaluation, service worker, key API, localStorage, sessionStorage, or server key handling. Wallet objects live in a module-private `Vault`. Public getters expose addresses only. Keys are not rendered. A secure context and browser cryptographic RNG are required.

Fleet exports use:

| Setting | Value |
| --- | --- |
| Format/version | `imdbundler-vault` / `1` |
| KDF | PBKDF2 with SHA-256, 600,000 iterations |
| Salt | 16 fresh random bytes per export |
| Cipher | AES-256-GCM, 128-bit authentication tag |
| IV | 12 fresh random bytes per export |
| Authenticated format label | UTF-8 `imdbundler-vault:1` |
| Password policy | 12–1,024 characters; use a strong unique passphrase |
| Import resource limits | 100 KB file, fixed supported KDF, 1–50 unique wallets |
| Content checks | Recompute every address from its private key; reject mismatches/duplicates |

Metadata and ciphertext are JSON/base64. Addresses and private keys in a fleet backup are encrypted together. A successful restore atomically replaces an empty vault after all entries validate. Failed imports leave it empty. Concurrent wallet changes invalidate pending exports/imports. Temporary byte buffers are cleared when practical, but JavaScript strings and garbage collection cannot provide a guaranteed memory wipe.

Individual exports are the standard encrypted Web3 Secret Storage v3 keystore produced by the vendored Ethers implementation. Their public address is visible, as in that standard; the private key is encrypted. The offline interoperability test decrypts a keyfile with Ethers and verifies the address. Fleet JSON is restored by this app; individual keystores are intended for a compatible trusted external signer.

Clear/reset removes application wallet state, selections, plans and password fields. Leaving the page clears wallet references, including before restoration from the back/forward cache. Neither action deletes downloaded files or revokes a wallet extension's own site permissions; users manage those separately. A before-unload warning helps prevent accidental loss but is not a backup guarantee.

RPC traffic carries only selected public addresses and transaction fields. The RPC helper only permits read-only methods and rejects credential-bearing/insecure remote URLs. RPCs can lie about prices, balances, simulation, or chain identity, so critical results need independent verification. IMDB stats validate metadata and contract identity and read one block to avoid mixing pre/post-burn counters. An unavailable RPC replaces displayed stats with an explicit unavailable state.

ETH-signing requests go exclusively to an explicitly selected extension; the app never receives that extension's keys. It checks the sender and chain, rechecks both after requesting accounts, rechecks plan expiry after permission prompts, and never changes account/network automatically. Duplicate provider announcements cannot replace a selected provider object. Each request is separately reviewed and simulated. Account/network mismatch causes no send request; a signature rejection permits retry. An ambiguous send response locks that transaction's button because the transaction might already have been submitted. App reset does not revoke extension-level permissions. Provider names are self-reported; a malicious extension or compromised page remains outside this trust boundary.

Every transaction export is labeled unsigned and non-atomic. NFT templates are interface-specific; advanced calldata is not semantically decoded by the site. The v2 route enforces a nonzero recipient-balance minimum and on-chain deadline; quotes are indicative and do not predict transfer tax or later trades. No simulation guarantees future inclusion or execution.

A compromised page, extension, browser, OS, password manager, or domain can still compromise live keys. Encrypted export protects an at-rest file, not an unlocked tab. This is why static-source provenance, independent review, device security, and strong passwords remain user/operator responsibilities.

## UI and publication limits

The DOM integration tests use a vendored DOM implementation and a canvas test double. They do **not** claim a Chromium/mobile screenshot test, real extension prompt test, or validation of PNG raster pixels. A Chromium smoke attempt could not run because the required runtime libraries were unavailable; providing them was blocked by the execution environment. Production desktop/mobile rendering, PNG opening, and actual signer interoperability remain release smoke checks.

The release test independently reads CAR frames, verifies SHA-256 CID hashes, follows UnixFS links, and compares every reconstructed file with `site/`. Live addresses come from the supplied existing launch attestation. No new IPFS pin, domain update, GitHub publication, contract deployment, or source explorer verification is claimed by the offline package build.

## Reference sources and dependencies

Dependencies are pinned in [dependencies.json](dependencies.json) and included with licenses. Uniswap's [hook implementation](https://github.com/Uniswap/v4-core/blob/46c6834698c48bc4a463a86d8420f4eb1d7f3b75/src/libraries/Hooks.sol) defines callback return-delta handling and the self-call bypass used here. Ethers documents [encrypted wallet serialization](https://docs.ethers.org/v6/api/wallet/). The package format follows the [CARv1](https://ipld.io/specs/transport/car/carv1/) and [DAG-PB](https://ipld.io/specs/codecs/dag-pb/spec/) specifications. These references support the design; they do not independently audit this implementation.
