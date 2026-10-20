# Validation and security review

This is an implementation review and test record, not an independent security audit. The launch network still needs its independent contributor review and actual-factory rehearsal before release.

## Automated checks

Normal checks require no network or secrets. Results on the delivered implementation:

- `forge build`: succeeds with pinned Solidity 0.8.26 and Cancun.
- `forge test`: **52 reported tests/groups passed**, no failures or skips. This includes 50 ordinary/fuzz tests and two invariant campaigns (two invariants each, grouped by this Foundry version).
- Fuzz cases: 256 per fuzz test, including transfer/burn amounts, all trade directions and exactness modes, partial fills, and minor-unit rounding. The assignment's exact seed is in `foundry.toml`.
- Stateful invariants: 64 × 32 = **2,048 calls per currency ordering**, all succeeding. Random trades and claim retries check fee conservation, total-supply reduction, settled deltas, and no retained ERC-20 fees. Across both campaigns: 4,096 calls.
- `forge fmt --check`: succeeds.
- `node --test test/site/*.test.mjs`: **18 tests passed**. Includes cryptographic export/restore, wrong passwords, tampering, KDF/resource bounds, random IV/salt, clear-during-encryption, standard keystore interoperability, exact transaction ABI fields, invalid inputs, account/network changes, RPC failures, DOM workflow, and complete IPFS archive reconstruction.
- A gas report was run for all four trade modes in both currency orderings. These swaps perform additional AMM work; use live gas estimation instead of a fixed gas limit. The representative local prefunded router calls were roughly 0.35–0.46 million gas. This includes the pool trade, hook, buyback, and settlement, not the entire test setup or transaction intrinsic gas.
- A separate read-only fork at Ethereum block **26234425** passed buy/sell × exact-input/output against **real IMD bytecode**, followed by liquidity fee collection. It used a new v4 PoolManager and test-funded balances, not the launch factory. See `checks/MainnetPairFork.sol.example` and the operations document to reproduce.
- Public RPC reads confirmed IMD symbol/18 decimals, nonempty bytecode for the site's Ethereum Router02 and WETH, Router02's WETH address, and WETH's symbol. The browser also checks selected chain, contract code, router WETH, and token decimals before building the built-in token buy.

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

RPC traffic carries only selected public addresses and transaction fields. The RPC helper only permits read-only methods and rejects credential-bearing/insecure remote URLs. RPCs can lie about prices, balances, simulation, or chain identity, so critical results need independent verification. ETH-signing requests go exclusively to an explicitly selected extension; the app never receives that extension's keys. It checks the sender and chain, rechecks both after requesting accounts, and never changes account/network automatically. Each request is separately reviewed and simulated. Rejection or mismatch causes no send request. App reset does not claim to revoke extension-level permissions.

Every transaction export is labeled unsigned and non-atomic. NFT templates are interface-specific; advanced calldata is not semantically decoded by the site. The v2 route enforces a nonzero recipient-balance minimum and on-chain deadline; quotes are indicative and do not predict transfer tax or later trades. No simulation guarantees future inclusion or execution.

A compromised page, extension, browser, OS, password manager, or domain can still compromise live keys. Encrypted export protects an at-rest file, not an unlocked tab. This is why static-source provenance, independent review, device security, and strong passwords remain user/operator responsibilities.

## UI and publication limits

The DOM integration test exercises generation, local encryption/download, selections, funding plan creation, RPC balances, failure feedback, reset, P&L drawing calls, and image/download wiring. It uses a vendored DOM implementation and a canvas test double. It does **not** claim a Chromium/mobile screenshot test, real extension prompt test, or validation of PNG raster pixels. The browser smoke checklist is in `OPERATIONS.md`.

The release test independently reads CAR frames, verifies SHA-256 CID hashes, follows UnixFS links, and compares every reconstructed file with `site/`. No IPFS pin, domain update, GitHub publication, contract deployment, source explorer verification, or live token/hook address is claimed by an offline package build.

## Reference sources and dependencies

Dependencies are pinned in [dependencies.json](dependencies.json) and included with licenses. Uniswap's [hook implementation](https://github.com/Uniswap/v4-core/blob/46c6834698c48bc4a463a86d8420f4eb1d7f3b75/src/libraries/Hooks.sol) defines callback return-delta handling and the self-call bypass used here. Ethers documents [encrypted wallet serialization](https://docs.ethers.org/v6/api/wallet/). The package format follows the [CARv1](https://ipld.io/specs/transport/car/carv1/) and [DAG-PB](https://ipld.io/specs/codecs/dag-pb/spec/) specifications. These references support the design; they do not independently audit this implementation.
