# imdbundler

A static multi-wallet workbench and an immutable IMDB / IMD Uniswap v4 buyback-and-burn hook. Everything required to build and test is vendored as ordinary files. No package installation, backend, key service, submodule, or network is required for the normal checks.

**Live contracts:** the existing Ethereum launch is recorded in [deployment-record.json](docs/deployment-record.json). This site release now includes the verified token and hook addresses:

| Contract | Ethereum mainnet address |
| --- | --- |
| IMDB | [`0x9a26dcb2bbd88d4c964043f2611d6cb0031c1ee8`](https://etherscan.io/address/0x9a26dcb2bbd88d4c964043f2611d6cb0031c1ee8) |
| Hook | [`0x736361f1ffa0f2407724589addcde144f047a0cc`](https://etherscan.io/address/0x736361f1ffa0f2407724589addcde144f047a0cc) |

Contract source remains unchanged. The launch source is already in [the launch repository](https://github.com/identity-md-launches/launch-2300-imdbundler/tree/864305f630ca6ea7d49f3a7f6120f299386f94aa).

**Hosting follow-up, 2026-10-20: incomplete.** The production export is in `dist/`, with its matching CAR in `release/imdbundler.car`. The authorized publishing command `imd site publish dist --name imdbundler` was attempted and exited 1: `not configured — run: imd pair --server <url>`. No pin or label activation was acknowledged. The public URL returned HTTP 404 / “No such site.” This is a prepared release, not a live-site claim. No credentials, pairing, contract changes, redeployment, or transactions were attempted.

## Install, rebuild and preview the production export

The existing vanilla JavaScript application and local runtime assets remain in `site/`. No runtime dependency installation is needed. The additional hosting tools have their own manifest and lockfile in `web/`; the original root manifest and build configuration are unchanged.

```sh
# Production export + deterministic IPFS CAR, using Node 22+ only:
node web/build.mjs
# Preview the actual export at http://127.0.0.1:4173/preview/:
node web/preview.mjs

# Install the optional development/checking tools, then check them:
npm ci --prefix web --ignore-scripts
npm run typecheck --prefix web
npm test
# Browser binaries and their system libraries must also be installed:
npm exec --prefix web -- playwright install chromium webkit
npm run validate --prefix web
# Explicit Chromium-only check when WebKit's system libraries are unavailable:
npm run validate --prefix web -- --chromium
```

`npm run build --prefix web` is equivalent to `node web/build.mjs`. It replaces `dist/` with a byte-for-byte copy of `site/`, including local Ethers, eight frog SVGs, licenses, deployment metadata, and the PNG share image, and regenerates `release/`. Hash routes and relative runtime URLs work under a gateway subpath. The absolute Open Graph image URL intentionally targets the requested public domain.

On an **already authorized publisher**, `imd site publish dist --name imdbundler` bundles/pins the export and requests the label. After success, compare the returned CID to `release/cid.txt`, check publisher status, and verify the public HTTPS page and assets. Creating a CAR or a CID alone is insufficient. Do not include `web/node_modules/`, browser caches or temporary test files in a source submission.

Actual checks: production build passed; strict typecheck of the new hosting scripts passed; all **30 existing tests passed**; Chromium passed the primary interaction suite and five-page reflow checks at **320, 390, 750, 1024 and 1440px**. The design probe passed **13/16**, with deliberate terminal casing/monospace and a navigation false positive documented. WebKit could not launch because required system libraries are absent. A full strict JavaScript check of the legacy app and minified Ethers does not pass; the successful hosting typecheck does not cover that legacy code. Read [validation and limitations](docs/VALIDATION.md), [implemented design](DESIGN.md), and [browser evidence](docs/site-review/) for details. These are worker observations, not independent certification.

## Run and check

Requires Foundry with Solidity **0.8.26**, and Node **22 or newer** for site checks and packaging. The site itself needs a modern browser with Web Crypto, Canvas, ES modules, and HTTPS (or localhost).

```sh
forge build
FOUNDRY_FUZZ_SEED=0xacb203d670db1f70f458598b65fbad8cb01f4491378fbe0c08a61bd984f2c01f forge test
forge test
forge fmt --check
node --test test/site/*.test.mjs
node scripts/package-site.mjs
node scripts/serve.mjs
```

The last command serves the static site at `http://127.0.0.1:4173`. It only serves files and accepts GET/HEAD. It never accepts wallet data. `npm test`, `npm run build`, and `npm run serve` are equivalent conveniences; do not run `npm install`.

The protected Foundry configuration pins seed `0xb38a9ff495bdd18e650f7fcfaf78750fb7edd57ffc4f545ce5d371877a55407a`. The explicit command also tests the follow-up assignment's seed. Fuzz tests run 256 cases per test; invariant campaigns cover both currency orderings with real freshly deployed v4 PoolManagers. A regression reproduces a dust trade at a tick boundary and checks that the invariant harness generates a valid reverse price limit. See [validation and security review](docs/SECURITY.md).

## Browser workflow

1. **Home:** generate 1–50 independent wallets using cryptographic browser randomness, or restore an encrypted fleet. Addresses are displayed; private keys never appear in the UI, logs, public transaction exports, or RPC requests.
2. **Manage:** select wallets, copy one or all selected addresses, read native and optional ERC-20 balances, and export password-encrypted backups. Export one standard Web3 keystore when an external signer needs one generated wallet. The fleet format is documented in [security notes](docs/SECURITY.md).
3. **Fund:** enter your external funding address and native ETH amount per selected wallet. Inspect/download one unsigned transfer per recipient. Fees are additional. Each transfer needs its own signature.
4. **Snipe:** prepare Ethereum Uniswap v2 ETH-to-token buys with nonzero minimum output and a deadline; prepare explicit NFT mint templates; or paste reviewed calldata for another router/marketplace. The generated address is the sender and, for supported templates, recipient of each transaction.
5. **Sign:** export public JSON to your own signer, or explicitly discover and choose one EIP-6963 extension. The app never connects on load, selects `window.ethereum`, changes an extension's network, or assumes one account owns the fleet. It checks chain and sender again for every request, runs a simulation, and requests one signature at a time. An account permission prompt cannot bypass plan expiry. Duplicate provider announcements cannot replace your choice. Import a generated wallet's encrypted keystore into a compatible trusted signer first if needed.
6. **P&L:** enter entry/exit/quantity or override exit with gain/loss percentage. Render and download a 1200×800 PNG with an original happy, sad, or thinking frog. Cards are labeled self-reported and exclude fees.
7. **Token info:** copy the live token/hook addresses, open the exact contract source, and request on-chain stats. Identity, bytecode presence, supply, and burn counters are read at one Ethereum block. Hook burns and all-holder burns are reported separately. RPC failures display unavailable results, never invented zeroes.

If the extension rejects a signature, you may try again. If a send request loses its response or returns an invalid hash, its button locks because it may already have been submitted. Check the extension and explorer before discarding the plan and preparing another one.

Eight locally bundled, original frog SVG poses use only lime and black. They have no third-party image requests, tracking, or fonts. They are independently drawn meme-inspired artwork dedicated under CC0; see [art license](site/assets/LICENSE.txt).

### Supported networks and routes

| Network | Native funding and balances | NFT templates / reviewed calldata | Built-in token swap |
| --- | --- | --- | --- |
| Ethereum, chain 1 | Yes | Yes | Uniswap v2 Router02, direct WETH → token |
| Base, chain 8453 | Yes | Yes | Use reviewed router calldata |
| Arbitrum One, chain 42161 | Yes | Yes | Use reviewed router calldata |
| Optimism, chain 10 | Yes | Yes | Use reviewed router calldata |

NFT templates are **only** `mint(uint256)` and `mint(address,uint256)` for contracts that implement those signatures. There is no universal “buy NFT” or “buy token” selector. Allowlist proofs, signed marketplace orders, multi-hop routes, and other protocols use the advanced calldata mode and require independent review. The same advanced calldata is repeated for every selected sender, so embedded recipients must be checked.

The Ethereum route uses Router02's `swapExactETHForTokensSupportingFeeOnTransferTokens`, which checks the recipient's received balance against the minimum. The indicative quote does not estimate token transfer taxes, so a taxed token can still fail the chosen minimum. See the [official Router02 implementation](https://github.com/Uniswap/v2-periphery/blob/master/contracts/UniswapV2Router02.sol).

The IMDB launch pool is **v4 paired with IMD**, not the site's v2 ETH route. Use a reviewed v4 transaction or an appropriate external v4 interface for that pool. No v4 routing or other-chain token liquidity is silently assumed. The app prepares a collection of independent transactions; it provides neither an atomic bundle nor a private relayer, guaranteed inclusion, timing advantage, or profit guarantee. A nonce, current gas settings, and a final receipt belong to the signer. Prepared plans expire in the UI; only contracts with an encoded deadline enforce that deadline on-chain.

## Launch contracts

| Item | Value |
| --- | --- |
| Token Solidity name | `IMDBToken` |
| Name / symbol / decimals | IMDBundler / IMDB / 18 |
| Initial supply | 1,000,000,000 IMDB = `1000000000000000000000000000` units |
| Initial recipient | Entire supply to constructor `msg.sender`, the launch factory |
| Future supply | No minting; decreases only when holders burn their own tokens |
| Hook Solidity name | `IMDBHook` |
| Hook constructor | `(IPoolManager manager_, IMDBToken token_)` |
| Constructor placeholders | `$poolManager`, `$token` |
| Network | Ethereum mainnet, chain 1 |
| Pair | IMD at `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`, 18 decimals |
| LP fee / spacing | `12500` (1.25%) / `60` |
| Hook fee | 2% of settled IMD paid on buys, gross IMD output on sells, rounded down |
| Permissions / address mask | beforeInitialize, beforeSwap, afterSwap, both swap return deltas / `0x20cc` (8396) |
| Buyback price bound | 100 basis points of square-root price movement from the post-trade price |
| Administrative powers | None: no owner, setters, upgrade, pause, rescue, or withdrawal function |

The hook takes fees only on its one exact pool key. It buys IMDB with those fees in that same pool and destroys the purchased tokens using the token's caller-only `burn`. It does not convert fees to ETH or pay an owner: the brief specifically requests buyback and burn. This overrides the reference's generic ETH fee-payout behavior.

The burn happens inside the user's swap whenever the PoolManager can pay it and no payer has IMDB synced for a pending settlement; otherwise the purchased IMDB waits as a claim and the next swap or a permissionless `processFees()` call burns it. The buyback itself is skipped while the pool has no liquidity at its current tick, so retries cannot move the price for free. Both rules were added in a revision after an external review; see [hook accounting](docs/HOOK.md).

The factory, not either contract, applies the launch allocation: **10%** agent MerkleDistributor, **88%** liquidity, **2%** payer or policy treasury. The hook reserves no launch allocation. Opening price is the factory's responsibility, derived from its opening market-cap policy and final currency ordering. Tests use 1:1 for accounting coverage; that is not a deployment-price instruction.

The initialization callback was added to validate the sole supported key and prevent preinitializing a predicted hook pool before its code exists. Liquidity callbacks are disabled: the factory can collect fees with zero liquidity change and remove its liquidity without hook taxes or gates.

See [hook accounting](docs/HOOK.md) for exact-in/out and partial-fill mathematics, and [deployment and hosting](docs/OPERATIONS.md) for CREATE2 mining, public address publication, IPFS, source publication, and operational responsibilities.

## Project layout

- `src/`: the token, hook, authenticated callback base, and address permission helpers.
- `test/`: contract success/failure/fuzz/invariant tests and offline site tests.
- `lib/`: pinned Solidity dependencies, with their original licenses.
- `site/`: the deployable static application, local Ethers bundle, and original art.
- `scripts/`: offline salt miner, static preview, deployment metadata writer, and deterministic IPFS CAR packaging.
- `release/`: reproducible CARv1 archive, CID, and checksum. Building a CID does not pin or publish it.
- `checks/MainnetPairFork.sol.example`: optional network-dependent mainnet IMD rehearsal, excluded from normal compilation.
- `docs/dependencies.json`: exact upstream commits/versions and JavaScript checksums.

The existing launch manifest is retained as historical deployment data. This follow-up deploys no contracts and changes no token economics or dependencies. Do not send assets directly to the hook. No administrative rescue exists. Browser users are responsible for trusted software, their backups, passwords, final transaction review, and funds. A compromised page, device, or extension can read browser memory; encryption of a downloaded file cannot protect a currently unlocked page.
