---
name: raagam-theme-presets
description: Raagam ERP's appearance options — a typeface and a colour, chosen separately from the topbar "T" menu, declared once in lib/appearance.ts and proven readable by `npm run check:themes`. This skill should be used when exploring font / typography / colour combinations for the app, when adding, tuning or removing a font or colour option, when the operator says the font or colours look wrong, when promoting a combination to be the default, and whenever someone touches lib/appearance.ts, components/shell/appearance-menu.tsx, the `--font-app` / `--primary*` tokens in app/globals.css, or the next/font loaders in app/layout.tsx. Triggers on "theme", "font", "typography", "typeface", "colour", "color theme", "combination", "design system look", "Carbon / Fluent / Material / Spectrum", "T icon", "appearance".
---

# Raagam appearance options

## What exists

Four independent preferences, each stored in localStorage and applied to
`<html>` before first paint, so any combination works:

| Preference | Declared in | Control | `<html>` hook |
|---|---|---|---|
| Light / Dark / System | `lib/theme.ts` | sun / moon button | `.dark` |
| New look / Classic | `lib/type-scale.ts` | T menu ▸ Look | `data-type-scale` |
| **Font** | `lib/appearance.ts` `FONTS` | T menu ▸ Font | `data-font` → `--font-app` |
| **Colour** | `lib/appearance.ts` `ACCENTS` | T menu ▸ Colour | `data-accent` → `--primary*` |

**Why font and colour are separate (client 2026-09-17).** The first cut
bundled each design system's face with that system's own blue. Five blues side
by side read as "the colour still same", and bundles meant a combination could
only be tried if someone had pre-packaged it. Two axes give 5 × 8 combinations,
and the colour list can offer real hues. Do not re-bundle them.

**One declaration, three readers.** `FONTS` and `ACCENTS` are the only place
values are written:

- `appearanceCss()` → the `<style>` the root layout inlines (non-defaults only)
- `AppearanceMenu` (`components/shell/appearance-menu.tsx`) → the menu, with
  font names drawn in their own face and colours shown as swatches
- `scripts/check-theme-contrast.mts` (this skill) → `npm run check:themes`

Never hand-write a `html[data-font=…]` or `html[data-accent=…]` block in
`globals.css`: the menu and the check cannot see it.

## Rules

1. **The first entry of each list is the default and writes no CSS.** Inter +
   Raagam Blue is the client-approved look in `globals.css`; those entries only
   mirror it. Removing the feature must leave the default screen unchanged.
2. **Only the primary colour family and the font change.** A colour option
   sets `primary`, `primaryHover`, `primaryActive`, `primarySoft`,
   `cellActive`, `info` and `infoSoft`, plus the derived `--ring` and
   `--btn-glow`. That family paints the solid buttons, the workspace tab bar,
   links, focus rings and selected rows. **Never** the logo colours, and
   **never** success / warning / danger.
3. **No green, amber, red or orange SOLID colour option.** Those hues are the
   status language of every pill in the app. A green Save button reads as
   "Approved", and a red one reads as "Delete". Blues, cyan, teal (kept darker
   than the app's `--accent` `#0d9488`) and neutral graphite stay clear of it.
   Indigo, violet and plum shipped for one afternoon and were dropped on
   2026-09-17 at the client's request ("replace with better colour"), in favour
   of Navy, Ocean and the gradients below.
4. **A gradient paints two surfaces and nothing else.** `gradientTo` on a
   palette makes it a gradient option. `gradientCss()` applies it to the
   workspace tab bar (`.ty-chrome`) and to primary buttons (`.ty-btn-primary`,
   stamped only on `variant="primary"` in `button.tsx`), with hover and pressed
   done by `filter: brightness()` because a background-image hides the variant's
   hover colour. Never on text, tints, rows or cells: a gradient behind a value
   only costs legibility. Green may appear as the FAR stop of the Raagam
   Gradient (the logo's own pair), using `--success`'s `#547b19`, never the raw
   lime. The tab bar was a gradient once before and a green TINT on it was
   rejected ("not good fit"), which is why gradients stay opt-in.
5. **Readable or it does not ship.** `npm run check:themes` must pass. It tests
   the pairs the app really draws: white on each button state, primary text on
   the canvas, surface and tints, dark-mode info text, the dark focus ring, and
   white on a gradient's second stop.
   Where the approved default is itself below WCAG (brand blue on its tints,
   ~4.2), the default's ratio is the floor. Fix a failure by moving the colour,
   never by loosening a threshold.
6. **Fonts cost nothing until chosen.** A web font is a `next/font/google`
   loader in `app/layout.tsx` with `preload: false` and a `variable`, added to
   `<html>`'s className. The browser downloads it only when a rule uses it.
   Prefer variable fonts, which need no weight list. A system face (Segoe UI)
   needs no loader but must end in `var(--font-inter)` for machines without it.
7. **Tabular figures are mandatory** (quantity and rate columns). Reject a face
   without `tnum`. Inter, IBM Plex Sans, Source Sans 3, Roboto and Segoe UI all
   have it.
8. **Watch the face's width.** Field widths were tuned on Inter, and Archivo was
   dropped on 2026-09-08 because its wider letters overflowed fields. IBM Plex
   Sans is ~4% wider than Inter; look at the dense screens before recommending
   a wide face.
9. **Labels stay short.** The menu is 176px wide.

## What is shipped

| Font | From | | Colour | Light primary |
|---|---|---|---|---|
| Inter (default) | Raagam / Polaris | | Raagam Blue (default) | `#037bb8` |
| IBM Plex Sans | IBM Carbon | | Navy | `#1e40af` |
| Segoe UI | Microsoft Fluent 2 | | Ocean | `#0e7490` |
| Source Sans 3 | Adobe Spectrum | | Teal | `#0f766e` |
| Roboto | Google Material 3 | | Graphite (neutral) | `#334155` |
| | | | Raagam Gradient | `#037bb8` → `#547b19` |
| | | | Deep Sea | `#1e40af` → `#0f766e` |
| | | | Steel | `#334155` → `#037bb8` |

## Suggested combinations to try

| Combination | Why |
|---|---|
| Inter + Raagam Gradient | The brand, dressed up: the logo's blue-to-green on the bar and Save buttons. The best first try. |
| Segoe UI + Navy | Looks native on the operators' Windows PCs; a deep, conservative corporate blue. |
| IBM Plex Sans + Steel | IBM Carbon's feel: calm graphite chrome with a brand-blue lift. |
| Source Sans 3 + Ocean | A narrow face fits more per column; cyan is fresh without being a status colour. |
| Roboto + Deep Sea | Material-style with a navy-to-teal bar; the most vivid of the set. |

## Exploring further

The Figma "enterprise design systems" guide
(figma.com/resource-library/enterprise-design-systems) is about process, not
values. Its one concrete rule is the one this registry follows: **tokens are
the source of truth; change one and every component follows.** Candidates that
are not shipped yet:

| System | Face | Licence | Primary | Note |
|---|---|---|---|---|
| GitHub Primer | Mona Sans | OFL, Google Fonts | `#0969da` | wide face (rule 8) |
| US Web Design System | Public Sans | OFL, Google Fonts | `#005ea2` | very plain, high legibility |
| Ant Design | system stack | MIT | `#1677ff` | white on it is 4.10; darken first |
| Atlassian | — | — | `#0c66e4` | proprietary face; colour only |
| SAP Fiori, Salesforce, Oracle Redwood | proprietary faces | — | — | face **not usable** |

Workflow:

1. **Add an entry** to `FONTS` (plus a loader) or to `ACCENTS`. For a colour,
   take the hue's 700–800 step as `primary`, one step darker for hover, two
   for active, the 50 step for soft/cell, and a dark set whose primary is light
   enough for the focus ring (≥3:1 on `#14171d`). For a gradient, reuse a
   solid option's palette and add `gradientTo` in both light and dark; pick two
   hues that are neighbours or the brand pair, since distant hues muddy in the
   middle.
2. **`npm run check:themes`**, and fix any `FAIL` by moving the colour.
3. **`npx tsc --noEmit`**, then try it in the app (T ▸ Font / Colour) on the
   screens that stress it hardest: Orders ▸ Garment Orders, Fabric BOM, a
   report, the dashboard. Check light AND dark, New look AND Classic.
4. **Let the operator choose** by using it for a day. Each choice is saved in
   that browser only, so trying one affects nobody else.

Printable report sheets (`components/orders/fabric-bom-reports-sheet.tsx`,
`fabric-requirement-sheet.tsx`) hard-code the brand blue on purpose, so they
match the printed RP format. They do not follow the colour option, and should
not.

## Promoting a combination to the default

This changes what every operator sees, so it needs the client's say-so. Then:

1. Move the colour's values into `:root`, `.dark` and the New look block in
   `app/globals.css`.
2. Point `--font-sans`'s fallback at the new face, make its loader
   `preload: true`, and set Inter's to `false`.
3. Reorder `FONTS` / `ACCENTS` so the new default is first, and keep the old
   look as a named option.
4. Rerun `npm run check:themes`.
