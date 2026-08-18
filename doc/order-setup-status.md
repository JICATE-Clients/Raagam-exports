# Order Setup update — status (2026-08-17)

Client list: `doc/spec-drop.md`, 27 asks. Multi-tab deferred by the user, so 26
in scope. Lanes A, C, D closed; B in flight.

## Already true before the team started — 3

Found in the working tree during recon, not done by this pass. Had the team
worked from the spec alone it would have "fixed" finished work.

| Ask | Evidence |
|---|---|
| Field placeholders ("Select", "Color Select") | `data-picker.tsx:1067`, `combobox.tsx:54` already default to `—`; zero `placeholder="Select…"` under `app/(app)/orders` |
| Order Info: Style No · WareHouse · Discharge Port | Withdrawn earlier today; state still carries them, deliberately |
| Blocked → table listing | In progress untracked: `active-registry.ts`, `active-actions.ts`, `use-block-action.tsx` |

## Lane A — primitives · CLOSED

| Ask | Outcome |
|---|---|
| Remove number spinners | `components/ui/input.tsx:77`, gated on `type === "number"`. Reaches 325 `<Input type="number">` in 125 files; zero raw `<input type="number">` in the tree, so the ~22 hand-rolled grids inherit it unedited |
| Back button on child listings | New `components/ui/back-link.tsx` + `lib/nav/back-target.ts`, rendered by `PageHeader`, `back` defaulting true. Target derived from `MODULE_GROUPS` — the registry the sidebar, hub pages and nav search already read |

88 of 118 leaf routes had no back affordance; the 30 that did had drifted into
three dialects. Derived rather than hand-written, so a screen that changes group
changes its own Back. `h-9` via `buttonClasses({size:"md"})` per the header-row
rule. Four screens got `back={false}` on their editor branch only.

## Lane C — MBA items · CLOSED

| Ask | Outcome |
|---|---|
| compo auto-fetch / Compo Description / components Type | **Reassigned** — "compo" means COMBO. See below |
| Remove Type from main layout | Already true: `amendment-screen.tsx:6407`, withdrawn 2026-08-11 |
| Merge Material + Item; one clear screen | Two rail stops → one section (`:1592-1772`). Grid renders LAST, per the 08-11 merge's recorded `registerContentEdge` trap |
| Drop Item Class Name prefix on category | **Conditionally.** Prefix derived per NAME: one class → none, two → both. STRING exists under both SEW and PACK |
| Item Type: To be advised / To be developed / Available Item | Restored, 19 → 20 columns. No migration — verified from `pg_attribute`; table empty, so no orphaned values |
| Hide Entry No | Done; `required` absent — confirmed by enumerating all six `required: true` sites |

`lib/orders/material-bom/**` untouched. `BomLineInput` has four members and no
slot for `type`, so c756d82's "restoring is a grid column and nothing else"
holds structurally, not just by grep.

## Lane D — style master · CLOSED

| Ask | Outcome |
|---|---|
| Season in CAPITALS | `SEASON_OPTIONS` uppercased (values, not a CSS transform on the trigger — that would show caps while storing Title case). `capsTextNullable()` in the Zod schema so `lib/data-io` imports are covered. `uppercase` on the LIST column — the only half reaching the 3 existing rows |
| Size tab too long | Already true on arrival (`inlineCards flushRows frameless`, earlier session) |
| Size tab "not working correctly" | **Real bug**: duplicate sizes stored cleanly. Fixed at picker (`usedIds`), action (`normalizeSizes`), and DB (`0429`, unique index). 0407 seeds order size grids from this table, so one repeat propagated to every order |
| Components Type (reassigned in) | Read-only, not hidden — `comp_type` is still written by `normalizeComponents`, so hiding leaves a column storing with nothing on screen to account for it |

Also deleted generation 2's dead `fabricTypeOpts` — one reference, its own
declaration, still commented "THE TYPE COLUMN'S VOCABULARY — a real master
list". That is what a fourth wrong answer would have been written from.

## Lane B — garment order · CLOSED

11 items (9 + 2 reassigned in). `0427_amendment_multi_order.sql` applied —
verified from `list_migrations` and `information_schema`, not the folder.

| Ask | Outcome |
|---|---|
| Assortment · Date · Solid Color on one line | Already true. "Solid Color" is not a field — it is a `PACK_TYPE_OPTIONS` VALUE. Both halves fixed earlier today (pane cap 768→1440, `QTY_NARROW`) |
| Multi Order | Done. New `multi_order` + `po_no`. Switch on the QUANTITIES tab, not the header — 13 header cells = 26 columns, which does not divide by 12, reproducing the orphan row the client reported on 08-17 |
| Reason off the raise door | Done, one predicate: `t.key !== "reason" \|\| amending` |
| Remove Processed as Trim + Garment Process child | Done — **controls only**. See the correction below |
| Colour type-or-pick | Done. `color_name` was always the stored VALUE; palette pick writes the FK as before, a typed value writes `color_id: null`. ⊕ survives, pencil does not |
| Reference manual input | Done (Quantities ▸ Ref No) |
| Consignee filtered by customer | Done. Held value survives. 0404 gave this screen a real `customer_id → customers` FK, so the nullable-bridge trap does not apply here |
| Price types auto-update | **Two proven bugs fixed**; the reported error itself UNCONFIRMED — see open question |
| Yarn/Fabric Dyeing categories | Misread of the ask — it was a free-text Type field, already fixed. **Nothing seeded**; live DB queried to prove it |
| Combos auto-fetch (reassigned in) | Already true. One defect fixed: `article_no` was printing under a "Style Desc." label |
| Compo Description (reassigned in) | Already true, withdrawn earlier today |

**CORRECTION — the withdrawal pattern is TWO rules, not one.** The brief said
"withdraw from the UI and the input schema's write path, keep the column", taken
from `amend_year`. That is right for a HEADER field, where an update writes only
the keys the schema names. It is WRONG for a CHILD: `writeChildren` /
`writeComboTree` delete and re-insert wholesale, so dropping a child field from
the payload returns the column default on the next save of every existing order,
silently. Lane B departed from the brief and was right to; c756d82 kept `type` in
`mbaItemInput` for the same reason.

## Decisions taken

- **Colour**: type-or-pick hybrid. Keeps 0415's palette and FK; accepts a typed
  value. NOT a revert of 0415.
- **Reason**: hidden on the raise door only; kept on amend.
  **CORRECTION (lane B, verified):** the stated justification was wrong. The
  `amend_in_*` booleans are read by NOTHING — they appear only in
  `amendment-screen.tsx` and `lib/orders/amendments/types.ts`. What
  `/orders/approve-amendments` actually reads is `reason_text`, as a column on
  its queue (`approve-amendment-screen.tsx:163`). The decision is unchanged; the
  reason for it is different. This false premise came down from the plan doc and
  may be in other lanes' notes.
- **Multi Style**: already built as `mult_ord`. Label only. Column unchanged.
- **Item Type restore**: not a re-flip. c756d82 withdrew it for column count and
  said "restoring any of them is a grid column and nothing else".
- **C6 row shape**: `forceCards` / `foldRows` NOT touched — dated operator and
  client decisions, and re-flipping on an inferred reading is the recorded
  failure mode.
- **Quick-created fabric category → blank Type**: left open. Closing it needs
  derivation at render or save, which rewrites stored values on load.

## Follow-ups — not in this pass

0. **"The grid must render LAST in a merged section" has NO machine check.**
   Not a misconfigured check — a rule with no enforcement anywhere, hand-carried
   across three merges now (Order Info + Style(s) 08-11, MBA today, and the next
   one). Get it wrong and nothing fails loudly: Tab re-enters the header after
   the last grid row instead of handing off, and the cursor circles. AGENTS.md's
   own standard — "four hand-written workarounds for one gap is what a missing
   check looks like" — makes three hand-carries the warning. **Highest-value
   item on this list.**

1. **Season casing on the order screen.** `lib/orders/amendments/types.ts:144`
   stays Title case. Needs three coordinated parts (literal, load-time
   upper-case, `capsTextNullable()`); the literal alone is correct on the day it
   lands and wrong later, with nothing failing in between.
2. **Two `SEASON_OPTIONS` literals.** `style-options.ts` states nothing keeps
   them in step. Merging crosses two lanes' boundaries — a separate decision.
3. **`audit_layout.py` cannot distinguish "inspected and clean" from "never
   looked".** `--check caps-input` returns early unless the path contains
   `components/masters/`; `--check cascade-filter` requires `CLASS_FACET` to
   match. Both print `0 findings` in the same format as a real pass. Two lanes
   hit this independently today. A `scanned N, matched M` line per check closes it.
4. **`AGENTS.md` is stale**: it describes `/orders/garment-orders` as a
   registered group with `slug: "garment-orders"`; `module-groups.ts:333` has it
   as a leaf labelled "Order Entry" under Order Setup.
5. **30 hand-rolled back links** in three dialects could retire onto `<BackLink>`.
6. **0428 is a permanent gap** — claimed by lane C, unused. Not recycled.

## Gate — ALL PASS

| Gate | Result |
|---|---|
| `npm run build` | exit 0 |
| `npm run check:nav` | OK — 9 modules, 36 groups, 121 screens |
| `npx tsc --noEmit` | 0 errors |
| `audit_layout.py` | no finding names any touched file |
| `audit_keyboard.py` | `tab-fields` 0, `picker-trigger` 0 |

Remaining findings are in `approve-amendment-screen.tsx`, untouched by this pass.
`tab-page-form` 28 and `unsaved-guard` 1 are the pre-existing enumerated
remainder.

**Not verified: nothing was browser-tested.** Everything above is static
analysis, DB queries and the audits. Row density at 20 MBA columns, the merged
BOM section on screen, and the Quantities line at nine cells all need eyes.

## Open question for the client — B8

The price-type error was NOT reproduced; no browser. Three ranked candidates:

1. The leftover-rates block: *"N rates are left over from <mode>. Remove them or
   the order's value cannot be calculated."* Best match to the wording — but
   clearing it means DELETING TYPED MONEY, which was an operator decision on
   2026-08-12 and not ours to reverse.
2. The `required` hold on seeded blank rates — Save refusing, not an error.
3. `styleRate` returning null and blanking Avg Rate.

**One sentence about the text they saw decides it.**
