# Order Setup update — lane ownership (2026-08-17)

Four agents work in parallel on ONE working tree. Ownership is by FILE, because
the largest target is a 7,072-line screen and two writers would clobber it.

| Lane | Owns (edit freely) | Never touches |
|---|---|---|
| **A · primitives** | `components/ui/input.tsx`, `components/masters/master-list-shell.tsx`, any new shared component | the three orders screens |
| **B · garment order** | `app/(app)/orders/amendments/**`, `lib/orders/amendments/**` | `components/**` |
| **C · mba items** | `app/(app)/orders/material-bom-amendment/**`, `lib/orders/material-bom-amendment/**`, `lib/orders/material-bom/**` | `components/**` |
| **D · style master** | `app/(app)/orders/styles/**`, `lib/orders/styles/**` | `components/**` |

**Shared files nobody edits without saying so:** `lib/orders/types.ts`,
`lib/validation/formats.ts`, `components/masters/child-grid.tsx`,
`components/ui/field.tsx`, `AGENTS.md`. Need a change there? Report it; the lead
applies it once.

## Rules that bind every lane

1. **The working tree is dirty and that is deliberate.** 15 files carry
   uncommitted work (placeholder removal, Blocked→listing, ChildGrid folding).
   Never `git checkout`, `git stash`, `git restore` or revert anything.
2. **Do NOT run `npm run build` or `npm run dev`.** Four concurrent builds
   corrupt `.next/`. The lead runs the build once, at the end.
   `npx tsc --noEmit` and `python scripts/audit_layout.py .` are read-only — fine.
3. **Read the screen before you change it.** Several spec items are already
   done. State "currently X → asked for Y" before editing. If X already equals
   Y, report it as already-done and change nothing.
4. **Contract-level rules are never fixed per screen** (AGENTS.md). A keyboard,
   required-field, CAPS or created-column problem gets fixed in the primitive —
   which means it is lane A's, not yours. Report it.
5. **Removing a field ≠ dropping its column.** Withdraw it from the UI and from
   the input schema's write path, keep the column and its stored values. That is
   how this file has withdrawn every field (see the `amend_year` note).
6. **Migration numbers are pre-assigned** so two lanes cannot collide:
   A=0430, B=0427, C=0428, D=0429. A committed migration is NOT an applied one —
   verify against `list_migrations`, never against the migrations folder.

## Report back with

- **Done** — item, file:line, one line on the approach.
- **Already true** — item, and the evidence it was already satisfied.
- **Blocked** — item, why, and what you need. Do not guess at a client
  intention; a wrong guess here costs a re-flip (colour has flipped twice).

## Reassignment — 2026-08-17, after lane C's finding

**"compo" in the client's drop means COMBO, not COMPONENT.** MBA has no
components section, no Compo Description and no component Type. Three items move:

| Item | Was | Now | Note |
|---|---|---|---|
| auto-fetch style details on style select | C | **B** | Combos `detailHeader` ~4522 — likely already true |
| Type read-only/hidden in components | C | **D** | Style master ▸ Components ~1062 — wrong 3 times already |
| remove Compo Description | C | **B** | `amendment-screen.tsx:4531` — already done today |

**There are THREE separate "Type" fields. Confusing them is the live hazard:**

1. `amendment-screen.tsx:6407` — Order Info Type (Garment/Fabric/Made-ups).
   **WITHDRAWN 2026-08-11.** This is what the spec's "remove Type from the main
   layout" asks for. Already satisfied.
2. `amendment-screen.tsx:4851` — Combos ▸ Structure Details Type. Lane B's.
   Its own comment: "NOT the Style master's Type, which is a different question".
3. Style master ▸ Components Type, fed by `fabric_structure_id` (0405). Lane D's.
4. MBA Items grid Type — withdrawn this morning by c756d82, **being restored**
   with the client's three options (see below).

**Ruling: the Items-grid Type comes back** with To be advised / To be developed /
Available Item. Not a re-flip of c756d82: that commit withdrew it for column
count ("22 columns to 19") while keeping the column, the values and its place in
`mbaItemInput`, and closed by saying "restoring any of them is a grid column and
nothing else". The three named options REPLACE the provisional
`["Production","Sample","Trial"]`. No CAPS transform — a fixed option list is not
`<Input uppercase>` free text. The restoration must carry a comment naming the
client and the date, or the next reader reads it as drift.
