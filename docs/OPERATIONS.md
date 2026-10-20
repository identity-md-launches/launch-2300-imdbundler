# Deployment and publishing handoff

## Launch parameters

The IMD launch pipeline deploys exactly these two production contracts from the pinned root Foundry build:

| Contract | Constructor arguments | Source |
| --- | --- | --- |
| `IMDBToken` | none | `src/IMDBToken.sol` |
| `IMDBHook` | `[$poolManager, $token]` | `src/IMDBHook.sol` |

There is no `$owner` role in either contract, no fee recipient, and no administrative address to configure. The pair is the brief's mainnet IMD address, not a guess. The manager is always supplied as an argument, never a hardcoded deployment address. The factory deploys the token first, receives all `10^27` units, then deploys the hook with the real token address.

Pool: chain 1, IMDB/IMD, fee 12500, tick spacing 60, hook mask **8396 / 0x20cc**. The factory chooses currency ordering and derives the opening price from the launch's 2,500 IMD whole-supply opening market-cap policy. It controls the liquidity position and allocation. It must deploy the mined hook and initialize the correct pool atomically. No special initialization sender is required, and no user-supplied hookData is trusted. An incorrect currency, fee, spacing, or hook field is rejected.

The token has a fixed **initial** supply, with voluntary caller-balance burning to implement the requested burn mechanism. The hook receives no initial allocation. There is no mint after construction. The platform distributes the standard 10% agent allocation to its MerkleDistributor, 88% to liquidity, and 2% according to its payer/treasury policy. There is no agent wallet to supply.

## Reviewable preparation

1. Build and run all offline checks in the root README. Review the self-quote, partial-fill rounding, delta conservation, claim retries, and immutable MEV limitations.
2. The independent reviewer should examine the final source and artifact hashes, then rehearse the actual factory/manager/pair at the final opening price. The included fork rehearsal only verifies real mainnet IMD behavior against a fresh manager; it is not a rehearsal of the platform's factory.
3. Once the factory, manager, and token addresses are known, the offline helper mines a valid salt:

   ```text
   node scripts/mine-hook.mjs FACTORY_ADDRESS POOL_MANAGER_ADDRESS TOKEN_ADDRESS
   ```

   The uppercase words are required command arguments, not address values. The helper reads `out/IMDBHook.sol/IMDBHook.json`, appends the two constructor arguments, hashes that exact initcode, and computes CREATE2 addresses using the supplied factory. It prints a salt, address, initcode hash, and flags. It never signs, deploys, broadcasts, or reads credentials. The platform may use its own equivalent miner if its factory wraps CREATE2 differently; the final actual factory deployer address and exact initcode must agree.
4. The separate manifest step writes the launch manifest and the authorized IMD deployer performs the launch. No `launch.json` or broadcast script is supplied by this assignment.
5. Verify deployed bytecode and source, permission mask, manager/token immutables, token metadata/supply at deployment, pool key, and the factory's actual allocation. Do not use unpublished/predicted addresses as live addresses in the site.

The compiler is 0.8.26, EVM Cancun, optimizer 200 runs, and `bytecode_hash = "none"`. No FFI, filesystem permissions, compiler binary, upgradeable proxy, or externally linked Solidity library is required.

## After launch

There are **no on-chain setters**. Publishing public site metadata is an operator action, not an on-chain admin power.

1. Obtain the actual token/hook addresses from the accepted factory launch receipt, verify them, and obtain the exact reviewed GitHub source commit URL from the launch repository publisher.
2. Update the public static metadata using those real values:

   ```text
   node scripts/configure-site.mjs TOKEN_ADDRESS HOOK_ADDRESS https://github.com/ORG/REPO/tree/COMMIT
   ```

   All address/URL tokens above describe required operator inputs. The shipped `site/deployment.json` deliberately contains only the chain and an awaiting-launch status. No zero/dead/test address is ever used as a live setting. This helper rejects zero addresses and a hook whose address does not carry the correct mask. It cannot substitute for bytecode verification.
3. Review the metadata diff and rebuild:

   ```sh
   node --test test/site/*.test.mjs
   node scripts/package-site.mjs
   ```

4. Publish the accepted repository source to the launch GitHub repo using the network's authorized publisher. Source publication is not performed by the offline packaging tool. No repository credentials or unknown repo URLs are included in the project.
5. Import `release/imdbundler.car` into the network's authorized IPFS node/pinning service. A CAR import should pin the root shown in `release/cid.txt`. With an already installed and authorized Kubo node, the operator can use `ipfs dag import release/imdbundler.car`, then verify the root is pinned. No IPFS account is required to build the CAR locally; hosting/pinning does require infrastructure.
6. The sites.imd.fun operator points **imdbundler.sites.imd.fun** to that pinned CID using its domain/control-plane mechanism. No control-plane API or credential was supplied to this assignment. Confirm the HTTPS page, JS MIME types, CSP/security headers, RPC CORS behavior, images, and imports at the actual gateway and domain.
7. Open Token info and refresh stats over Ethereum RPC. Confirm the displayed hook's `token()` matches the configured token and independently check the explorer source. Capture the successful launch and site CID in the network release record.

`release/imdbundler.car` uses CARv1, a CIDv1 UnixFS directory with byte-sorted names, raw SHA-256 file blocks (maximum 1 MiB), and DAG-PB directory nodes. It is deterministic across hosts and excludes host timestamps and credentials. Tests validate every block hash and reconstruct every shipped file. It can be served under `/ipfs/CID/` or an IPFS subdomain because all site asset paths are relative. The generated CID is **not evidence of publication or pinning**. A changed file changes the root; publish a new CID when adding live addresses.

The `_headers` file is a template for static hosts that support it. IPFS gateways may ignore it. Configure equivalent HTTP headers at the production gateway, especially frame restrictions. The HTML also contains a CSP meta policy. Do not add analytics, external scripts, fonts, password-capturing forms, or a key-handling backend.

## Ongoing responsibilities

- Any user or watcher may call the immutable hook's `processFees()` after the manager is locked again to retry deferred buybacks/burns. It takes no arguments, charges no service fee, and rewards no keeper. Monitor `pendingIMD`, `pendingIMDB`, `Buyback`, and `Burned`; caller gas and available pool liquidity determine retry timing.
- There is no pause or recovery admin. Do not send ordinary ERC-20s or native assets directly to the hook. There is no rescue path. Changing behavior would require a separately reviewed new deployment, not an upgrade.
- The publisher maintains IPFS availability, the domain pointer, and release provenance. A content-addressed build does not guarantee the domain always points to that build.
- Users maintain encrypted backups, verify restoration before funding, use strong unique passwords, and review each transaction/account/network. RPC requests reveal public addresses and activity. Never share passwords or plaintext private keys.
- For desktop/mobile browser release smoke tests: generate and restore 5 and 50 wallets; download/reimport a keystore using a trusted compatible signer; check single-account extension selection/cancellation/network changes; simulate an intentionally unfunded call; render positive/negative/flat P&L and open the PNG; inspect a 375px viewport. The offline DOM tests do not replace a real extension or rendering-engine test.

## Optional mainnet IMD rehearsal

A read-only fork at Ethereum block **26234425** was used locally to confirm the real IMD contract's metadata/transfers and all four trade modes. It used a new PoolManager, new token/hook, synthetic test balances, and fee collection afterward. It sent no live transaction. Reproduce only with network access:

```sh
mkdir -p test/scratch
cp checks/MainnetPairFork.sol.example test/scratch/ForkRehearsal.t.sol
forge test --match-path test/scratch/ForkRehearsal.t.sol -vv
rm test/scratch/ForkRehearsal.t.sol
```

The example pins its public RPC and block explicitly. It is excluded from the normal offline suite. A final real-factory deployment rehearsal remains the launch operator's responsibility.
