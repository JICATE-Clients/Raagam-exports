# Advised Items — build plan (2026-09-19)

Source: the client's "Advised Item System Logic & Lifecycle Workflow" (Material BOM entry →
Budget → Advised Items Register → hard PO block → buyer confirms → Available → PO unlocked).

## What already exists (verified 2026-09-19 — do not rebuild it)

- **The advised state IS the Material BOM line's `type`** (`material_bom_amendment_items.type`,
  0265): "To be advised" vs "Available Item", set by the **TBA toggle** on the MBA Items grid.
  Live data: every line is "Available Item" (0 TBA, 0 blank, 0 of the retired "To be developed").
- **The Budget already counts TBA lines** — `pullCostLines` ignores `type`, so the spec's
  budget rule holds; only the estimated rate is missing (the BOM stores none).
- **The PO gate exists** — `refuseUnsettledMaterials` (`lib/purchase/bom-ceiling-service.ts`)
  refuses a PO line whose material is TBA on the order's latest non-draft BOM, at all four
  write paths (create / add line / update line / submit). TS only; `approvePo` does not re-check.
- **The "Advised Items" screen is an ORPHAN** — `order_advised_items` (0032) is a free-text list
  nothing reads (0 rows live). It is replaced, not extended.

## Decisions

- **One state, on the BOM line.** No `item_type` enum beside `type` and **no stored
  `is_po_locked`** — the lock is DERIVED from `type = 'To be advised'` (a stored flag can be left
  TRUE after conversion and block a real item for ever). `type` gets a CHECK
  ('Available Item' | 'To be advised'), NOT NULL, default Available.
- **The Register is a VIEW of TBA BOM lines**, grouped by RE No — never a second list to keep
  in step. `/orders/advised-items` lists orders with advised lines (pending / converted counts);
  opening one shows its advised lines with their specs, reason, PO status and conversion.
- **Conversion through the lock (user, 2026-09-19).** On an approved RE the lock stays on qty,
  item and rate; an ADVISED line may still take: `type` → Available, `brand`, `artwork_code`,
  `specification`, `item_color_id`, `size`, `pending_reason`, and the stamps. Only a line that
  WAS advised gets this — an Available line of a locked RE stays fully locked. Enforced by the
  0576 trigger's allowlist, widened for this one case.
- **Conversion is ONE targeted update** (`convertAdvisedItem`), never the MBA editor's full save
  (which rewrites child grids and requirements — all locked). `converted_at` / `converted_by`
  are stamped by a DB trigger on the TBA → Available transition — one writer, cannot be skipped.
- **`pending_reason` is mandatory while advised** (DB CHECK + Zod + the field's `required`).
- **Estimated rate** — new `estimated_rate` on the MBA line (any line); the Budget pull
  pre-fills the material line's rate from it, the way a Fabric BOM line's rate already does.
- **The PO block becomes a gate AND a trigger**: a BEFORE INSERT/UPDATE trigger on
  `po_line_items` refuses a line whose material is TBA on its order's latest non-draft BOM
  (same rule, same sentence as the TS gate), and `approvePo` re-checks.
- **The orphan table is dropped** (guarded: refuses if it holds rows), with its lib and editor.

## Rules every screen follows (STANDING — right the first time)

Width-laid-out from the first commit (`raagam-screen-layout` "BUILD IT COMPACT THE FIRST
TIME"): `FieldRow` + `Field w=`, definite caps, grids as fixed-width tables of `FIELD_WIDTH_CSS`
steps in named `…Columns` arrays with literal `tableFrom="5xl"`, ≤ 1155px, listed BY NAME by
`npm run check:grid-budget`. Every warning under its own field (`Field error` / `FieldError`).

## Migration `0588_advised_items_register.sql` (APPLIED 2026-09-19 — 0587 went to the IWO purchase ceiling)

## Team
| Teammate | Owns |
|---|---|
| data | 0588; `lib/orders/material-bom-amendment/{types,service,actions}.ts` (new columns, Zod); new `lib/orders/advised/{service,actions,types}.ts` (register + convert); budget pull rate prefill; retire `lib/orders/advised-items/*` |
| locks | `lib/purchase/*`: `approvePo` re-check; gate message points at the Register; nav description |
| ui | `/orders/advised-items` Register screen (replaces the orphan editor); MBA Items grid: Estimated Rate + Pending Reason (required while TBA) |
