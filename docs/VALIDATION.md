# Frontend repair validation — 2026-10-20

## Outcome and scope

**Complete for the local frontend/export scope; public activation is after submission.** `dist/` contains all 26 source assets plus its generated manifest. The CAR reconstructs that exact 27-file export, including the complete `vendor/` directory. The submission publisher pins the committed export and updates the existing `imdb.site.identitymd.eth` name / `https://imdb.sites.imd.fun/`. No publication receipt or successful post-activation public check is claimed here.

The live failure was reproduced by direct HTTPS requests and the supplied browser: the index and application modules returned 200, while **all three vendor files returned 404**. The browser console reported missing `vendor/ethers.js`. The response identified the then-active IPFS CID as `bafybeid2ivp322crzwq7iunuo6dw7bmpv2piikpn3fqkkw5hx2cnucwczq`. The source and pre-existing local export already contained Ethers; a missing vendor directory in the served bundle is established, but publisher internals and the original omission mechanism are not available to this worker.

The repair makes the production build fail on omitted runtime files, checks every copied source asset, and packages the exact publication directory. Both original build entry points now use that gate. A local asset manifest and an independent CAR reader verify nested files and digests; a hosted verifier detects missing/stale files or an HTML fallback. Startup failures now explain recovery, and stale messages no longer follow visitors between views. Existing vanilla ES modules, cryptography, black/lime design, transaction routes and deployment data were retained. Token/hook source and all protected dependencies/configuration are unchanged. No deployment or signing transaction was sent.

## Commands and actual results

Development packages were installed from the **unchanged** `web/package.json` and `web/package-lock.json` in `/tmp/imdb-frontend-tools`, with browser binaries and npm cache also outside the repository. These temporary tools are not submission files.

| Command/check | Result |
| --- | --- |
| `npm run build` | **PASS**, original root command now runs the complete production export gate; 27 files, matching CAR/CID/checksum/hosting target |
| `node web/build.mjs` | **PASS**, same production export |
| `/tmp/imdb-frontend-tools/node_modules/.bin/tsc --project web/tsconfig.json --typeRoots /tmp/imdb-frontend-tools/node_modules/@types` | **PASS**, strict no-emit check of build, preview and imported export/CAR validation modules |
| Strict TypeScript check of `web/verify-hosted.mjs` using `--allowJs --checkJs --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node` and the same type roots | **PASS** |
| `node --check site/bootstrap.js` and `node --check site/app.js` | **PASS** |
| `npm test` | **33/33 PASS**, no failures/skips/cancellations; includes omitted-vendor, missing-import, corrupt-Ethers and corrupt/incomplete-CAR regressions |
| `IMD_PLAYWRIGHT=/tmp/imdb-frontend-tools/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/imdb-browsers node web/validate.mjs --chromium` | **PASS** against the actual export served at `/preview/`; details below |
| Same validator without `--chromium` | Chromium passed; **WebKit could not launch** because host libraries including GTK4/GStreamer are absent. Browser downloads succeeded; WebKit behavior is unverified |
| `IMD_PLAYWRIGHT=/tmp/imdb-frontend-tools/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/imdb-browsers node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | Executed after the final site change: **13/16 PASS**, three reviewed exceptions below |
| `web/verify-hosted.mjs` against an owned local production preview | **27/27 PASS**, exact bytes and correct JS MIME types |
| `node --use-env-proxy web/verify-hosted.mjs https://imdb.sites.imd.fun/` before submission | Expected pre-activation **FAIL: 20/27 match**, 7 failures. All vendor files, bootstrap and manifest are still 404; index/app are the previous bytes |
| Independent standard IPFS decoding | **PASS**, temporary `@ipld/car` **5.4.7** plus `ipfs-unixfs-exporter` **15.0.4** reconstructed every one of the 27 CAR paths and compared exact bytes to `dist/`, including all vendor files |
| Read-only Ethereum checks using the assignment provider, public source `https://ethereum-rpc.publicnode.com` | **PASS**, chain 1; both token and hook bytecode present; addresses match the pinned deployment; token identity and supply/burn reads passed at block **26236072**, checked **2026-10-20T20:05:46.086Z**. Supply was 1 billion IMDB and hook fee/burn counters were zero at that snapshot |

Full strict typechecking of the untyped legacy wallet/UI app and minified Ethers is **not** claimed. The project typecheck covers the export tooling, and changed frontend JS also passes syntax and interaction checks. Read-only contract checks are distinct from browser RPC mocks and do not establish production-origin RPC CORS.

## Interaction and rendered evidence

The bounded browser validator starts/closes its own preview and browser. It verified:

- **All 27 files** return 200 with exact release bytes; JavaScript uses a JavaScript MIME type. Resource timing confirms **bootstrap, app, vault, chains, transactions, rpc, deployment, providers and Ethers** loaded.
- At **390×844**, the product and Generate wallets action are on the first screen. The button is approximately y=660–705; the screenshot was opened and inspected. Root foreground/background compute to lime/black.
- Invalid wallet count is rejected; Enter on Generate creates **three unique valid addresses**. Selection none/all works, and clipboard contains the selected addresses. No RPC or wallet connection occurs during generation.
- A real password-encrypted fleet JSON downloads without plaintext addresses; password fields clear; confirmed reset followed by decrypt/restore returns the **same three addresses**.
- Snipe requires review, creates three unsigned reviewed-calldata transactions to the verified hook, downloads real public JSON, and invalidates an edited plan. This is **not a live transaction test**: chain/code RPC responses are mocks, the plan is unsigned, no fee processing occurs, and no signature is requested.
- P&L renders happy/sad/thinking states and downloads a valid **1200×800 PNG**. A Snipe error disappears when opening P&L. Both verified token/hook addresses render on the token view.
- Home, Manage, Snipe, P&L and IMDB each have no document overflow at **320, 390, 750, 1024 and 1440px**. Escape cancels reset without losing wallets, and keyboard focus returns visibly to Clear/reset. Reduced-motion testing finds no running animations.
- **Zero normal-load browser console/script errors and failed local resources.** In a separate failure context, Ethers is deliberately served as 404: the page shows an alert/reload link and disables unavailable actions. That expected network error is part of the regression, not counted as a clean-load pass.

The supplied browser tool also opened `/preview/`, clicked Generate wallets to create **five addresses** in Manage, and listed all required modules with **HTTP 200** and zero console errors. Its desktop screenshot and accessibility snapshot were inspected. A browser snapshot is not a screen-reader test.

Final inspected screenshots are in `docs/site-review/`: `390-home.png`, `390-manage.png`, `390-pnl.png`, `1440-home.png`, `reset-focus.png`, and `missing-vendor.png`. `taste.json` contains the final measured probe. Temporary generated wallets, encrypted downloads, caches and browser tooling remain outside the submitted paths.

## Better Interface review

The pinned workflow, documentation method and core principles for all six domains were read and applied. The product's existing visual idea is a **black/lime terminal for local wallet and unsigned-transaction work, with local frog artwork**. This assignment preserves that identity and reviews the repaired load path and existing primary flows rather than redesigning the workbench.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native labeled controls; keyboard generation/reset, Escape/focus return, in-flow polite notices and failed-load alert/reload link; target/reduced-motion probe passed. No screen-reader session, full automated a11y audit, forced-colors or native 200% zoom test |
| Layout | Checked | First 390px screen and all five views at five widths; complete addresses wrap and controls remain reachable. No RTL, translation stress test or physical-device test |
| Writing | Checked | Actions match handlers; backups, unsigned plans and self-reported P&L are explicit. Load failure explains reload, and unrelated stale errors are cleared. Existing terminal casing retained |
| Typography | Checked | Existing six CSS type roles, 16px inputs, two weights, wrapped addresses and tabular numeric outputs. Probe confirms six sizes including one-offs at mobile/desktop; exact platform font availability not guaranteed |
| Colors | Checked | Black/lime theme retained; actual measured solid text pairs pass the probe (normal lime/black **15.30:1**). No alternate theme exists; disabled/artwork/forced-colors pairs not comprehensively measured |
| UI | Checked | Existing flat panels, outlined/filled/disabled actions, empty state, native review dialog, startup error and real PNG/JSON downloads. No theme switch or staged animation exists; no 10%-speed animation-panel session |

## Findings, fixes and rechecks

| Severity | Source | Reproduction, fix and recheck |
| --- | --- | --- |
| High | `web/build.mjs:14`, `web/export-check.mjs:43`, `web/car-check.mjs:37` | Published vendor directory absent despite local source availability. Full-tree export/import/checksum/manifest gates and CAR traversal now require it. Every exported path returns exact bytes locally; standard UnixFS reconstruction and omission regressions pass. Public-origin recheck awaits publication |
| High | `site/bootstrap.js:2`, `site/index.html:23` | A failed transitive import previously left every primary action silent. The separate bootstrap now reports an accessible load error with a real reload link and disabled unavailable controls. Deliberate vendor-404 browser regression and screenshot pass |
| Medium | `site/app.js:26`, `site/app.js:81` | Snipe review error remained above the P&L view. Notices are scoped to their route and cleared before a new action. Reproduced before the change; final P&L screenshot and interaction assertion confirm removal |
| Medium | `web/build.mjs:27`, `site/index.html:14` | Prior release metadata targeted `imdbundler` rather than this task's existing `imdb` site. Target is now `imdb` / `imdb.site.identitymd.eth`; canonical metadata matches and share image is relative/local. Release regression and share probe pass |

The final probe's three failures were examined and retained as documented exceptions:

1. **Casing:** established terminal headings/buttons/tags are intentionally uppercase. No visual redesign was requested.
2. **Type faces:** the existing Courier/monospace prose is part of that terminal design; one family and two weights are used.
3. **Eyebrows:** the normal Home navigation link within 40px of the mobile heading is classified as a kicker. The screenshot shows real navigation, so removing it would harm the tool.

Render, layout, targets, contrast, tracking, type sizes, glyphs, slogans, repetition, copy budget, chrome, motion and share checks all passed. First-screen prose was 13 words at 390px. No applicable first-screen or systemic rendered failure was left unresolved. Design guidance attribution: Jakub Krehel's Better Interface (MIT), pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`; documentation method: Paul Bakaus's Impeccable (Apache-2.0), pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`.

## Release and limitations

- CAR: **677,663 bytes**, CID **`bafybeibfsbsxtq4xrub6r3te3sohdqnnvt667f3hd7tzto6vtff7yy57qq`**.
- CAR SHA-256: **`70c07ecbac58953f1117ea63743560f675f05613b7c25d138f316b35b4e13f09`**.
- Final inventory audit: **508 delivery paths**, below **5.4 million raw bytes** and **1.7 million bytes** in a compressed tar audit; both below **8,388,608 bytes**. `git diff --check` passed. No Git metadata was written; the task submission collects the source/export changes.
- Source/runtime assets, Ethers and its license/notices, original required CAR, lockfile and `dist/` are preserved. No ignore file was changed. No submodule, generated dependency/cache directory or dependency archive was added.
- Public **pin/name activation and the post-activation live interactions are not verified in this worker turn**. The hosted verifier currently identifies the old export. `dist/` and matching CAR are delivered for the submission publisher; the local CID is not a claim of an active pin. No credentials/configuration lookup, pairing, private keys, contract change or on-chain broadcast was needed.
- WebKit host libraries, actual external-wallet signatures, production-origin RPC CORS, physical mobile devices, native zoom, RTL and screen-reader behavior remain unverified. Offline/DOM tests cover additional funding, mint, v2-route, RPC failure and signer-isolation behavior; they are not live-wallet evidence.
