# Deployment and publishing handoff

## Existing deployment

This assignment continues launch 2300. The token and hook are already deployed; do not deploy, replace, or mint them again. No Solidity production source is changed by this follow-up.

| Parameter | Recorded value |
| --- | --- |
| Network | Ethereum mainnet, chain 1 |
| Token | `0x9a26dcb2bbd88d4c964043f2611d6cb0031c1ee8` |
| Hook | `0x736361f1ffa0f2407724589addcde144f047a0cc` |
| PoolManager | `0x000000000004444c5dc75cb358380d2e3de08a90` |
| Pair | IMD, `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`, 18 decimals |
| Pool fee / tick spacing | `12500` / `60` |
| Hook permission mask | `0x20cc` |
| Deployment transaction | `0xd1e43869d111dc56cff402ecbd745b9937ce2a1d5981fa61ae19705a4555f33b` |
| Deployment block | `26234792` |
| Contract source commit | `864305f630ca6ea7d49f3a7f6120f299386f94aa` |
| Source repository | https://github.com/identity-md-launches/launch-2300-imdbundler |
| Requested site domain | `imdbundler.sites.imd.fun` |

The supplied verified launch record is preserved as public [deployment-record.json](deployment-record.json), including its attestation and contract ABI/creation-code hashes. The browser receives only the validated public addresses and exact contract source URL from `site/deployment.json`. It does not depend on assignment input files remaining in the checkout.

On 2026-10-20 a read-only request at Ethereum block **26234924** found code at both addresses, token symbol IMDB, 18 decimals, the hook's expected `token()`, supply **1,000,000,000 IMDB**, and zero hook fee/buyback/burn/pending counters. These are a historical snapshot, not permanently current values or a new bytecode audit. The browser fetches fresh stats on demand and checks all values at one block.

## After launch: publish this site revision

**2026-10-20 hosting follow-up:** the authorized command `imd site publish dist --name imdbundler` exited 1 with `not configured — run: imd pair --server <url>`. No pin, site ID, or active label was returned. The public domain returned HTTP 404. This release remains unpublished. No pairing or credential lookup was performed. See [the current validation record](VALIDATION.md).

The current production export is `dist/`. Rebuild it and its matching CAR with `node web/build.mjs`; preview it with `node web/preview.mjs`. `release/hosting.json` records `ipfs: true`, the requested label and the current CID as publication intent, not a successful publish receipt. An already authorized network publisher can run `imd site publish dist --name imdbundler`, then confirm the returned CID, pin status, public page and assets. The older packaging-only steps below remain available for importing the CAR directly.

There are **no on-chain setters, owner addresses, signing keys, or new constructor parameters** to supply. `IMDBToken` originally had no constructor arguments; `IMDBHook` used `(PoolManager, token)`. The launch's allocation and immutable economics remain as recorded. The existing manifest and build configuration are unchanged.

1. Run the root checks in `README.md`, review this revision, and publish the accepted source to the existing launch repository through the network's authorized publisher. The app's exact source link describes the deployed contracts, so it stays pinned to the recorded launch commit.
2. Build the static archive:

   ```sh
   node scripts/package-site.mjs
   ```

   The result is `release/imdbundler.car`, `release/cid.txt`, and `release/checksums.txt`. No network, account, key, environment secret, npm installation, or backend is involved.
3. Import and pin the archive using the network's authorized IPFS node or service. For an already configured Kubo node:

   ```sh
   ipfs dag import release/imdbundler.car
   ```

   Verify the pinned root matches `release/cid.txt` and that an independent gateway can retrieve every asset.
4. The sites.imd.fun operator points **imdbundler.sites.imd.fun** at that CID and supplies HTTPS and appropriate response headers. There is no domain or pinning control-plane credential in the project. The domain returned HTTP 404 during this assignment, so this revision is **prepared for publication**, not claimed live.
5. Verify `/`, `deployment.json`, ES modules and SVGs load with correct MIME types under the domain and under `/ipfs/CID/`. All application asset paths are relative. Test RPC CORS from the real origin, copy/download behavior, and the wallet workflow on desktop and mobile. Record the published source revision, pinned CID and successful domain check in the network's release record.

The `_headers` file is a static-host template; IPFS gateways may ignore it. Apply equivalent HTTP headers at the serving gateway, especially `frame-ancestors 'none'`, `X-Frame-Options: DENY`, no-referrer, and nosniff. The HTML also supplies a CSP. Never add analytics, remote scripts or fonts, password-capturing forms, or a key-handling backend.

If a verified metadata correction is required, `scripts/configure-site.mjs` accepts **real** token/hook addresses and an exact GitHub commit URL as arguments. It shares the browser's metadata validation, rejects incorrect hook flags and unsafe/unpinned URLs, and never signs. It does not perform bytecode verification. Rebuild, repin and update the domain for any changed site file. Do not use it to substitute other contracts for this launch.

## Assumptions and user responsibilities

- Modern secure-context browsers provide Web Crypto, ES modules, clipboard/download APIs and Canvas. The site runs on HTTPS or localhost. There is no server wallet API, account database, persistent connected wallet, or automatic key storage.
- Generate 1–50 independent keypairs. Export and test restoration before funding; only addresses can be copied. The encrypted fleet restores in this app. Individual Web3 keystores require a trusted compatible external signer. Extensions do not all support keystore import.
- Ethereum, Base, Arbitrum and Optimism presets support native balances, funding, reviewed calldata and the two explicit NFT mint templates. The built-in token route supports Ethereum's direct Uniswap v2 WETH/token pool only. Network presets are not a claim that IMDB has liquidity on each chain.
- IMDB's launch pool is **Uniswap v4 paired with IMD**. Its address alone cannot produce a v2 ETH buy or arbitrary NFT marketplace order. Use separately reviewed protocol calldata with appropriate recipients, allowance, bounds and deadlines for other routes.
- Public RPCs see public addresses and transaction data and may rate-limit, fail or lie. Browser checks are useful validation, not an oracle or guarantee of chain authenticity. No RPC request contains private keys, seed phrases or passwords.
- A plan is a collection of separate unsigned transactions, not atomic execution, a private bundle, automated sniping or guaranteed ordering. The signer supplies current nonces and gas and verifies the receipt. The UI checks expiry before exporting/sending and after extension account prompts; contract deadlines are enforced only when encoded in that contract call.
- Wallet discovery requests no accounts. The user chooses one announced provider, imports/selects each exact sender in their external signer, and authorizes each transaction independently. The site never switches accounts/networks or calls the default injected provider. Extension names are self-reported, not verified identities.
- A returned hash marks submission, not confirmation. Ambiguous send responses lock the per-transaction send button. Check the extension and explorer before making another plan; no automatic retry can safely resolve an uncertain submission.
- Clear/reset removes wallet state, selections, passwords and transaction plans; page departure clears references too. Downloads and extension permissions remain under the user's control. JavaScript cannot guarantee memory erasure. A compromised device/page/extension can read an unlocked tab.
- P&L cards are self-reported illustrations, exclude fees, and are not verified trading performance. Users own their passwords, backups, final transaction review and loss risk.

## Ongoing operation

The publisher maintains IPFS pin availability, the domain pointer and source provenance. The deterministic CARv1 contains CIDv1 raw SHA-256 file blocks and byte-sorted DAG-PB UnixFS directories. Offline tests independently verify hashes and reconstruct every site file; a local CID alone proves neither pinning nor publication.

Anyone may call the immutable hook's `processFees()` to retry pending buybacks/burns, paying their own gas without a keeper reward. Monitor `pendingIMD`, `pendingIMDB`, `Buyback` and `Burned`; available liquidity and the hook's fixed price bound affect progress. There is no pause, upgrade, rescue or recovery admin.

Contract reviews, actual extension interoperability, serving headers and production hosting verification remain operational responsibilities. Existing `checks/MainnetPairFork.sol.example` is an optional historical fork rehearsal, not a new deployment script or a dependency of the offline checks.
