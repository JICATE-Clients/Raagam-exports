# Order Setup update — plan (client list, 2026-08-17)

Source: `doc/spec-drop.md`. 27 asks across three screens plus four shared primitives.

## Where the work actually lands

The spec says "order setup", but the asks name tabs (order info, quantity, size,
compo, item). Those live on three screens:

| Screen | File | Spec items |
|---|---|---|
| Garment Order / Amendment | `app/(app)/orders/amendments/amendment-screen.tsx` (7,072 ln) | Order Info, Quantities, Colour, Reason, Multi Style/Order |
| Material BOM Amendment | `app/(app)/orders/material-bom-amendment/mba-master-screen.tsx` | compo, Items, Material merge, Entry No |
| Style master | `app/(app)/orders/styles/style-master-screen.tsx` | Season caps, Size tab |
| Shared primitives | `components/ui/*`, `components/masters/*` | spinners, placeholders, Back, multi-tab |

One component raises **and** amends (`purpose` prop): `/orders/garment-orders`
is the entry door, `/orders/amendments` the amend door. **Every change below has
to state which purpose it applies to** — that is the trap on this screen.

## Already true in the working tree — do not redo

- **Field placeholders.** `data-picker.tsx:1067` and `combobox.tsx:54` already
  default to `—`; zero `placeholder="Select…"` remain under `app/(app)/orders`.
- **Order Info cleanup.** Style No / WareHouse / Discharge Port withdrawn
  earlier today. State still carries them — deliberate, not a leftover.
- **Blocked → listing.** In progress, untracked: `lib/masters/active-registry.ts`,
  `lib/masters/active-actions.ts`, `components/masters/use-block-action.tsx`.
  Same client rule, same date. Finish this one, don't restart it.

## Workstream A — shared primitives (fan-out is here)

1. **Number spinners.** No `appearance-none` anywhere today. Fix in
   `components/ui/input.tsx` for `type="number"`, so all ~22 hand-rolled grids
   inherit it. **Never per screen** — the AGENTS.md rule about contract-level
   fixes applies verbatim.
2. **Back button on child listings.** One shared affordance, not six copies.
3. **Multi-tab (Google-Sheets style).** Largest item by far — see Decisions.

## Workstream B — Garment Order screen

4. Screen width so Assortment · Date · Solid Color sit on one line.
5. **Multi Style / Multi Order split** — see Decisions.
6. Remove **Reason** section — see Decisions.
7. Remove "Processed as Trim" + the Garment Process child entry.
8. Colour manual input — see Decisions.
9. Reference field → manual input (stop auto-listing the style number).
10. Consignee filtered by the order's buyer/customer.
11. Price types auto-update by style; resolve the current error.
12. Yarn Dyeing / Fabric Dyeing "missing categories" — the *grids* exist
    (`amendment-screen.tsx:5440`), so this reads as missing **category master
    rows**, not missing UI. Confirm before adding either.

## Workstream C — MBA / item + component screen

13. compo auto-fetches style details on style select.
14. Components "Type" → read-only or hidden.
15. Remove "Compo Description".
16. Remove "Type" from the main layout.
17. Merge "Material" and "Item" into one section.
18. Item section: drop the Item Class Name prefix on category.
19. Item "Type" options: To be advised / To be developed / Available Item.
20. Item listing as one screen, not fragmented.
21. Hide Entry No from the UI (`mba-master-screen.tsx:1560`); keep the
    back-end serial.

## Workstream D — Style master

22. Season → CAPITALS. **Belongs in the Zod schema** (`capsName()`), never only
    in the action — `lib/data-io` imports bypass actions entirely.
23. Size tab: field too long; shorten and keep inline.

## Contracts every workstream must respect

- Removing a field ≠ dropping its column. Keep the DB column and round-trip.
- A hidden field that is still `required` is an unsaveable record with nothing
  on screen to explain why.
- `ChildGrid` stacked-cards must declare `required` **twice**, or the star ships
  with nothing behind it.
- Gate: `npm run build`, then `python scripts/audit_layout.py .` and
  `npm run check:nav`. tsc alone is blind to the server/client boundary.

## Decisions — RESOLVED 2026-08-17

- **Colour: type-or-pick hybrid.** Keep 0415's master palette and the FK; accept a
  typed value that is not a master row (e.g. "0001"). NOT a revert of 0415.
- **Reason: removed on `purpose="raise"` only.** Kept on `/orders/amendments`,
  where an amendment must state why and approve-amendments reads Amendment In.
  Columns untouched on both doors.
- **Multi Style is already built** — `mult_ord` is that switch today
  ("Multiple styles on this PO", `amendment-screen.tsx:5078`). Only the LABEL is
  wrong. **Multi Order does not exist in any branch** (`git log --all -S` finds
  nothing): build the new flag + PO No column in Quantities. Do not touch the
  `mult_ord` column name — relabel in the UI only.
- **Multi-tab: deferred.** Not in this pass. Item 3 above is out of scope.
