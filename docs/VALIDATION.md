# Hosting follow-up validation — 2026-10-20

## Completion and scope

**Incomplete: publishing access is not configured.** The website, production export, deterministic CAR and documentation are ready locally. `imd site publish dist --name imdbundler` was explicitly attempted and exited **1** with:

```text
not configured — run: imd pair --server <url>
```

No site ID, pin acknowledgement, or label activation was returned. Both a direct HTTPS request and Chromium navigation to `https://imdbundler.sites.imd.fun/` returned **404 / No such site** before the attempt. Successful live-site reachability, IPFS retrieval and production-origin RPC CORS could not be established. The publishing failure is a tooling/access limitation, not a request for an owner address or key. No pairing, credential lookup, on-chain transaction, contract editing, redeployment or source push was performed.

Scope was the existing static application in `site/`, its packaged `release/`, and the additional acceptance deliverables. The plain ES-module implementation, Ethers runtime, eight original Pepe SVGs, deployment metadata, wallet logic and transaction routes were retained. Changes cover share metadata/image, export tooling, navigation visibility, type consistency, flow-positioned notices and a reproduced keyboard-focus defect. `dist/` is a byte-identical copy of `site/`. New development dependencies and their lockfile live only in `web/`. The protected root manifest, dependencies, Solidity and launch configuration remain unchanged.

## Commands and actual results

| Command/check | Actual result |
| --- | --- |
| `npm run build` | Original packaging command passed before changes; no publication implied |
| `npm test` | **30/30 passed** after the dialog-focus change; 0 failed, skipped or cancelled |
| `npm run build --prefix web` | Passed; generated `dist/`, matching CAR, CID, checksum and publication-intent metadata |
| `npm run typecheck --prefix web` | Passed: strict TypeScript checking of `web/build.mjs` and `web/preview.mjs` |
| Broad legacy JS check with TypeScript `--allowJs --checkJs --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler` and the seven `site/*.js` entry points | Failed with 3,732 diagnostic lines, including pre-existing implicit-any/DOM typing and minified Ethers diagnostics; these files have no existing type declarations. No successful full-app typecheck is claimed |
| `npm run validate --prefix web -- --chromium` | Passed against the actual export under `/preview/`; see interactions below |
| Default two-engine browser suite / separate WebKit launch | Chromium passed. WebKit first lacked its executable; after downloading it, host validation/launch reported missing system libraries. **WebKit rendering and interactions not verified** |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | Executed with an explicit installed Playwright module and browser location; **13/16 checks passed** after corrections |
| Public site request + browser navigation | HTTP 404, title “No such site” |
| `imd site publish dist --name imdbundler` | Exit 1, publishing interface not configured |
| Read-only Ethereum `eth_chainId` via the assignment provider | Returned `0x1`; this alone does not verify bytecode or current token statistics |

The final design probe ran after the last site-source change. Production assets use relative paths; the Open Graph URL intentionally refers to the public domain. No backend or external script/font/image dependency was added. The existing runtime Ethers file and its notices are retained. Development packages, browser binaries, caches and encrypted temporary test downloads are not delivery files.

Final integrity checks reconstructed the UnixFS package independently from both `site/` and `dist/`, compared their CIDs and complete CAR bytes to `release/imdbundler.car`, verified the SHA-256 checksum and hosting metadata, and checked permitted paths. All passed. The final CAR is **672,434 bytes**, rooted at `bafybeihck723o3ckc7tdsep6wc4cncj7glazijtfnn6v5f7dsym6yeezce`. The complete submitted-file inventory is below **5.3 million bytes**, within the **8,388,608-byte** budget even before compression. No submodules, generated dependency/cache directories, or packaging tarballs are included; no ignore file was changed. `git diff --check` passed. The source submission is delivered through this task's bundle rather than a direct GitHub push.

## Useful interaction validation

`web/validate.mjs` starts and closes its own foreground production-preview server and browser. RPC is explicitly mocked for `eth_chainId` and `eth_getCode` during unsigned-plan preparation. Mock bytecode is a test fixture, never application configuration or live evidence. The plan targets the actual verified hook address using `processFees()` calldata; nothing is simulated against mainnet, signed, funded or broadcast in this browser smoke check. Existing offline tests separately cover v2 encoding, NFT mint templates, funding, provider isolation, stale-plan expiry, uncertain sends and RPC failure behavior.

Chromium exercised:

- A 390×844 first screen containing the product, visible Pepe artwork and the Generate wallets action; computed body text `rgb(0, 255, 0)` and background `rgb(0, 0, 0)`.
- Invalid count rejection, then keyboard generation of three unique addresses, with no network calls for generation; selected-address clipboard copy.
- Actual password-encrypted fleet JSON download, no plaintext addresses in the file, password clearing, reset and restoration of the exact original addresses.
- Review-confirmation enforcement, three independent unsigned calldata plans, real public JSON download, correct destination/calldata and invalidation after editing.
- Gain, loss and breakeven frog states; actual PNG download with a PNG signature and **1200×800** dimensions.
- Both verified deployment addresses rendered on the token page.
- Home, Manage, Snipe, P&L and IMDB navigation at **320, 390, 750, 1024 and 1440px** with no document horizontal overflow.
- Escape cancellation of reset, preserved wallets, restored keyboard focus and confirmed reset; reduced-motion state with no running animations.
- Zero captured browser console/script errors and zero failed local export resources.

Screenshots were inspected directly. Delivered landing screenshots are in `docs/site-review/`; temporary full evidence and probe measurements were generated in `test/scratch/`. The 390px landing screen is also checked by button bounds, rather than inferred only from source. The reset-focus screenshot shows the focused return state. These are emulated desktop-browser viewports, not physical phone or screen-reader tests.

## Better Interface coverage

The pinned guide's workflow and core principles in all six domains were read and applied, preserving the requested black/lime terminal direction. This is a worker review of the stated scope.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native controls and bound labels, skip link, role/status, keyboard generation/reset, Escape and focus return, targets/reduced motion; no screen-reader session, full automated a11y audit, forced-colors or native zoom test |
| Layout | Checked | Shared edges, visible mobile navigation, responsive grids; all five pages checked at five widths; no RTL or translated-language stress test |
| Writing | Checked | Existing action labels, backup cautions, review confirmation and self-reported P&L disclosure retained; error/empty paths exercised; legacy global notices can persist when navigating to another view |
| Typography | Checked | Six source roles, 16px inputs, complete wrapping addresses, numeric stability; browser wrapping reviewed; exact platform font availability is not guaranteed |
| Colors | Checked | Rendered lime/black pair checked, contrast probe passed visible text; full-opacity placeholders fixed separately; no alternate theme exists; no assertion about every disabled, artwork or forced-color pair |
| UI | Checked | Existing flat borders, selected/disabled states, native dialog, P&L preview/download and empty state; no timed animation or theme switch exists |

## Findings, fixes and rechecks

| Severity | Source | Finding, correction and result |
| --- | --- | --- |
| Medium | `site/index.html:11` | Missing Open Graph title/image. Added complete metadata and an actual locally bundled 1200×630 share PNG. Final probe share check passed |
| Medium | `site/style.css:16` | Baseline used 10–12 distinct sizes per width and captions as small as 7.5px. Added six shared type roles, readable captions and 16px fields. Final probe type-size/tracking checks passed |
| Medium | `site/index.html:38` | Small tracked all-caps kicker preceded the main heading. Removed heading kickers across views; reduced mobile hero height. Final 390px screenshot and action bounds confirm generation remains on screen |
| Medium | `site/index.html:31`, `site/style.css:55` | Numbered navigation required a horizontal scroll and hid the token destination at 390px. Shortened visible destination labels and used five mobile columns. All destinations fit at 320px and were exercised |
| Medium | `site/app.js:32` | Chromium reproduced focus remaining on the closed dialog's Cancel control after Escape because its trigger was disabled. Retained the active trigger and restored it after controls re-enable. The browser regression passed |
| Medium | `site/style.css:42` | Legacy 50%-opacity placeholders resolve below normal-text contrast on black. Restored full-opacity lime; final source/export match and browser suite rechecked |
| Preventive | `site/style.css:47` | Sticky global notices could occupy the action region. Returned notices to normal document flow; layout probe found no floating controls covering text |

The final probe's three failures were reviewed rather than silently reported as passes:

1. **Casing:** the existing uppercase headline, buttons, tags and terminal labels are retained under the requested cyber/terminal style. No new promotional casing was introduced.
2. **Type faces:** the single inherited Courier/monospace family is deliberate for this terminal. No unrelated font was added to satisfy the generic prose preference.
3. **Eyebrows:** the probe marks the ordinary **Home navigation link** within 40px above the mobile heading as a kicker. The actual promotional kickers were removed; this is a navigation false positive.

All other measured checks passed: render, layout, targets, contrast, tracking, type sizes, glyphs, slogans, repetition, copy budget, chrome, motion and sharing metadata. Source citation line numbers refer to the final source, not generated bundles.

## Remaining limitations

The required live-publication outcome is not achieved: the hosting interface lacks configured access. Final CID and CAR checksum are in `release/cid.txt` and `release/checksums.txt`; `release/hosting.json` records `ipfs: true` and `imdbundler` publication intent, not a receipt. No new IPFS pin, live assets, production-origin RPC reads or on-chain burn figures are claimed. Actual external-wallet signatures, mobile wallet applications and funding were outside this hosting-only follow-up. Legacy full-app static typing, comprehensive field-error associations and notices persisting across views remain limitations. Browser snapshots and the design probe do not certify screen-reader accessibility or security.
