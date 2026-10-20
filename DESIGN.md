# Implemented design

## Overview

imdbundler is a client-side wallet and unsigned-transaction workbench. Preserve its existing pure-black and lime-green cyber/terminal appearance and locally drawn Pepe visuals. Home prioritizes generation; Manage, Snipe, P&L and IMDB are hash-routed views in `site/index.html`. Runtime behavior is in `site/app.js`; shared styling is in `site/style.css`. The final declarations in that stylesheet override the original compact rules above them.

## Colors

| Token | Value | Use |
| --- | --- | --- |
| `--black` | `#000000` | Page, panels, fields, dialog, inverse text |
| `--lime` | `#00ff00` | Text, borders, illustrations, primary fills |
| `--bright` | `#39ff14` | Focus outline and primary hover |

Source: `site/style.css:1` and its final review rules. No additional hue or theme exists. Unfilled controls have a lime border; filled primary and selected navigation controls invert to black text on lime. Status meaning uses words rather than a second color. Placeholder text uses full-opacity lime. Disabled controls retain the existing 45% opacity and native disabled state. Rendered body foreground/background were checked as lime/black; this pair's computed WCAG contrast is 15.30:1. The probe separately checks visible text against resolved backgrounds. It does not establish universal accessibility compliance.

## Typography

Use the existing `'Courier New', monospace` system stack, with requested weights 400 and 700; there are no font downloads. Font availability depends on the platform. Root size is 16px. The final six roles in `site/style.css:16` are:

| Token | Size | Use |
| --- | --- | --- |
| `--text-caption` | 0.75rem / 12px | Hints, badges, code, mobile navigation |
| `--text-ui` | 0.875rem / 14px | Buttons, labels, desktop navigation, panel copy, wallet addresses |
| `--text-body` | 1rem / 16px | General prose and inputs |
| `--text-heading` | 1.125rem / 18px | Panel headings |
| `--text-brand` | 1.5rem / 24px | Wordmark and statistics |
| `--text-display` | `clamp(2rem, 4.6vw, 3.75rem)` | Page headings; fixed 2rem below 751px |

Prose line-height is 1.65; hints 1.6; headings 1.08. Headings balance wrapping. Desktop display tracking is -0.065em; mobile is -0.04em. Buttons use +0.04em, badges +0.03em. Preserve the established uppercase terminal display and action labels. Paragraph measure is capped at 75ch. Addresses wrap completely instead of ellipsizing; numeric outputs use tabular figures. Canvas card typography is drawn independently at 1200×800 and scales with the image.

## Layout

Header, navigation, content and footer share a maximum 1200px width. Desktop content has 30px side padding and 35px top padding. `.grid-two` uses equal columns with a 20px gap; `.compact` uses 16px. Panels have 25px padding and 20px bottom separation. Controls use a minimum 44px height. `.toolbar` wraps actions.

At 750px and below, content side padding is 18px, panels use 18px padding, two-column grids and stats become single-column, and all five navigation links share a visible five-column row. The hero reduces to a 180px minimum height. At 400px and below its large artwork hides and generation controls stack; frogs remain in the brand and generation panel. Wallet rows wrap the copy action below the address. The 390×844 first screen contains the product and Generate wallets button. Chromium checked all five pages at 320, 390, 750, 1024 and 1440px without document overflow.

## Elevation & Depth

Flat black surfaces use lime borders for structure; there are no decorative surface shadows or gradients. Notifications remain in document flow and cannot cover controls. The native dialog uses a black 85%-opacity backdrop and a 2px lime border. The skip link has a raised stacking level when focused. A checkbox's inset black mark communicates its selected state.

## Shapes

Square corners are intentional. Borders are normally 1px, with dashed borders for outputs and transaction separators. Do not introduce rounded cards or a second surface palette. Frog SVGs retain their original lime-and-black shapes.

## Components

- **Navigation:** real hash links with `aria-current="page"`; `.page[hidden]` hides inactive views. All destinations are visible on narrow layouts.
- **Actions:** native buttons; `.primary` supplies lime fill, other buttons use outlines. Busy work disables controls and sets `aria-busy`. There are no continuous animations.
- **Fields:** persistent bound labels, 16px input text, native selectors, file input and checkboxes. Error notices provide actionable text. Field-level error associations are not implemented throughout the legacy app.
- **Panels:** `.panel`, `.panel-heading`, `.grid-two`, `.toolbar`; use these existing patterns for grouping and aligned controls.
- **Wallet rows:** `.wallet`, `.wallet-address`, `.balance`; complete addresses, selection checkboxes and copy actions. An empty state directs visitors to generation or restoration.
- **Review:** native `<dialog>` supports Escape and trapped focus. The app restores the trigger after busy controls re-enable (`site/app.js:32`). Reset requires explicit confirmation.
- **P&L card:** responsive canvas, render/download buttons, descriptive text and local happy/sad/thinking frog assets. Downloads are real 1200×800 PNGs, labeled self-reported.
- **Token panel:** exact deployment metadata and explorer links, copy controls, explicit on-demand RPC stats; failures display unavailable data.

Visible keyboard focus is a 2px `--bright` outline offset by 4px. The skip link is first in the keyboard order. Reduced-motion settings suppress smooth scrolling. No animation, external font, image service or key backend was added.

## Do's and Don'ts

Reuse the existing tokens, native elements and panel/grid patterns. Keep a primary action prominent, complete addresses selectable, controls at least 44px tall where the pattern permits, and all runtime assets local. Keep the lime/black identity, explicit transaction review and local key handling. A new view should follow `.page` with one visible page heading, bound labels and an entry in the hash-navigation handler. Do not invent another font, palette, truncation scheme, automatic wallet connection or transaction route.

The review used Jakub Krehel's Better Interface principles (MIT) and Paul Bakaus's Impeccable documentation method (Apache-2.0), at the pinned revisions supplied with this task. Coverage and unperformed checks are recorded in `docs/VALIDATION.md`.
