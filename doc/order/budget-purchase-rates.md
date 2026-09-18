# Budget ▸ Purchase Rates — build plan (2026-09-18)

Source: client blueprint (Purchase Rates tab + Yarn / Fabric / Accessories child tabs,
SQ header, bottom Sales / Profit-Loss bar) and screenshot 2924 of the current
`/orders/budgets` editor.

## What already exists — this EXTENDS 0428, it does not replace it

| Blueprint asks for | Already here |
|---|---|
| `budget_header` table | `order_budgets` (0428) — one budget covers a GROUP of orders (client, `doc/prd.md`) |
| `budget_yarn_purchases`, `budget_accessories_purchases` tables | `order_budget_lines.source` = `yarn` / `fabric` / `material` (0493 · 0504). **No per-tab tables** — one line table keyed by source, which is what lets `budgetTotals` add every tab in one pass |
| `line_total GENERATED` column | `lineAmount()` — amount is DERIVED and has no column (0428's header says why) |
| `gross_sales_value GENERATED` | Σ `orderSalesValue()` per order, snapshot in `order_budget_orders.sales_value`, REFUSES rather than part-summing |
| PENDING / APPROVED / REWORK / NOT_APPROVED | `draft → submitted → approved \| rejected → draft` + approval engine (0500–0505) |
| Auto-populate from Fabric / Material BOM | `pullCostLines()` + "Pull costs from the BOMs" |

So the blueprint's SQL is **not** used. What is genuinely missing:

1. **Layout** — primary tabs, child tabs, SQ header facts, a pinned bottom bar.
2. **Per-line facts** — Brand/Specifications, FOC, Import, line Currency + Ex Rate.
3. **A double-count bug** — `pullCostLines` pulls EVERY Fabric BOM requirement as a
   fabric purchase. Since 0564 a `yarn_knit` fabric is already costed through its Yarn
   Purchase lines (+ processes), so those fabrics are costed twice. The blueprint's own
   rule is the fix: *Fabric Purchases is for fabric BOUGHT (greige_purchase /
   dyed_purchase), not knitted.*
4. **Copy From** — clone rates from an earlier budget.

## Decisions (made, with reasons)

- **Primary tabs = rail sections.** The section rail IS this app's tab strip
  (`raagam-screen-layout`, rule 1). Rail: **Budget** (header) · Orders · **Purchase Rates**
  · Process Rates · CMTs · Other Expenses · Other Incomes. The blueprint's "General" tab
  has no stated content, so it is not invented; the header fields already live in the
  first section.
- **Child tabs = a `Tabs` strip inside Purchase Rates**, one `ChildGrid` per tab, each
  filtered to its source: Yarn Purchases → `yarn`, Fabric Purchases → `fabric`,
  Accessories Purchases → `material`. Process Rates holds `yarn_process` + `process`.
- **The group model stays.** The SQ header (SQ No, SQ Description, RE No, Customer,
  SQ Qty, Unit) is DERIVED from the budget's orders and read-only: one order → its values;
  several → the common value when they agree, else "N orders" / "Mixed". Nothing new is
  stored on the header.
- **The Summary section becomes the pinned bottom bar** (opt-in `summary` prop on
  `MasterFullScreen`, rendered above the footer on every section). Chrome, not fields —
  Tab never lands on it.
- **Rate is in the LINE's currency; INR Rate is derived.** `currency_code` NULL = INR, and
  every existing row keeps its meaning (its `rate` was INR). `INR Rate = rate × ex_rate`.
- **FOC = a real line at amount 0.** It is counted as priced (no rate needed), shown, and
  adds nothing to cost. Pulled from `material_bom_amendment_items.is_foc` (0474).
- **Import** is pulled from the Material BOM item's supply type (case-insensitive — the
  enums disagree on case, AGENTS.md "Nominated vendors").
- **SizeWiseRate is DEFERRED.** A checkbox with no per-size rate grid behind it is a stated
  rule nothing enforces. Needs its own design (per-size requirement split) — ask first.
- **Approval lock of upstream modules** (Order Entry / Fabric BOM / Material BOM locked
  once the budget is approved) is OUT of this build — cross-cutting, and needs checking
  against what the approval engine already does.

## The contract (every teammate codes against this)

### Migration `0572_budget_purchase_rates.sql` — additive, on `order_budget_lines`

```
specification  text                                   -- Brand / Specifications (CAPS via Zod)
currency_code  text references public.currencies(code) -- NULL = INR
ex_rate        numeric(14,6)                          -- NULL when currency_code is NULL
is_foc         boolean not null default false
is_import      boolean not null default false
check ((currency_code is null) = (ex_rate is null))
check (ex_rate is null or ex_rate > 0)
```

### `lib/orders/budget/totals.ts` (engine)

```ts
export type BudgetLineInput = {
  source: string | null; qty: number | null; rate: number | null;
  currency_code?: string | null; ex_rate?: number | null; is_foc?: boolean;
};
export function lineInrRate(line: BudgetLineInput): number | Refusal;  // rate × ex_rate (1 for INR)
export function lineAmount(line: BudgetLineInput): number | Refusal;   // FOC → 0; else qty × inr rate
export const BUDGET_SECTIONS: readonly { key: "purchase"|"process"|"cmt"|"expense"|"income";
  label: string; sources: readonly BudgetSource[] }[];
export const PURCHASE_TABS: readonly { source: "yarn"|"fabric"|"material"; label: string }[];
export type SalesOrderFacts = { label: string; qty: number | null; unit: string | null;
  currency_code: string | null; ex_rate: number | null; gross_value: number | null };
export type SalesSummary = { currency: string | Refusal; conv: number | Refusal;
  qty: number | Refusal; unit: string | Refusal; avgPrice: number | Refusal };
export function salesSummary(orders: readonly SalesOrderFacts[]): SalesSummary;
```

### `lib/orders/budget/types.ts` / `service.ts` (data)

- `BudgetLine` and `budgetLineInput` gain the five columns above.
- `BudgetableOrder` gains `sq_no`, `sq_description`, `re_no`, `qty`, `unit`,
  `currency_code`, `ex_rate`, `gross_value` (buyer currency, pre-conversion).
- `PulledCostLine` gains `specification`, `is_foc`, `is_import`, `currency_code`, `ex_rate`.
- New actions: `listCopyableBudgets()` and `loadBudgetLinesForCopy(budgetId)`.

### `lib/orders/budget/copy-from.ts`

`copyRatesFrom(target, source)` — the matching rule is a business decision, left to the user.

## Team

| Teammate | Owns (only these files) |
|---|---|
| **data** | `supabase/migrations/0572_*.sql`, `lib/orders/budget/types.ts`, `service.ts`, `actions.ts` |
| **engine** | `lib/orders/budget/totals.ts`, `copy-from.ts`, `scripts/check-budget-totals.mts` |
| **ui** | `components/masters/master-full-screen.tsx` (the `summary` prop only), `app/(app)/orders/budgets/*` |

Lead integrates: `npx tsc --noEmit`, `npm run check:budget-totals`, `npm run check:hooks`,
`check:embeds`, both audits, then `npm run build:check`. The migration is written, **not
applied** — applying it to the live DB is the user's call.

---

# Phase 2 — Process Rates (four child tabs), 2026-09-18

Client blueprint: Yarn Processes · Fabric Processes (nested, For = Fabricwise / Colorwise /
Processwise) · Accessories Processes · Garment Processes. The blueprint's
`budget_fabric_processes` + `_details` + `budget_garment_processes` tables are **not** used —
same reason as Phase 1: one line table is what lets one pass add up every tab.

## Where each tab's rows come from (verified 2026-09-18)

| Tab | Source | Reqd | Notes |
|---|---|---|---|
| Yarn Processes | `order_fabric_bom_yarn_stages` (already pulled as `yarn_process`) | `process_qty` (kg) | add `process_id`, stage name (`stage_id` → config_lookups) to the pull |
| Fabric Processes | `yarnFabricRequirementReport(bomId).stageBreakdown` — keyed by `processId`, lines per (fabric, combo, component), `byColour` subtotals | the figure the report prints as the process's quantity | **nothing stored**; the report already drops steps a bought fabric suppresses (0564). `StageBreakdownLine` lacks the fabric `itemId` — add it (additive) |
| Accessories Processes | `material_bom_amendment_processes` (item_id, process_id, description, for_scope) | the item's `material_bom_amendment_requirements.required_qty` (loss already folded in) | no UOM/FOC on the process row; UOM = the requirement's |
| Garment Processes | `garment_order_amendment_style_processes` (style_ref_no, kind garment/component, process_id, component_id) | production target (po + excess, `amendments/approval-qty.ts` — the Material BOM's base) × No of Pcs × No of Units | Type = kind (garment → Processwise, component → Partwise); For = component |

## Decisions

- **New sources** `fabric_process`, `material_process`, `garment_process` (all PULLED).
  **`process` (typed) is retired** → `garment_process`; 0 budgets exist live, and a
  "+ Add" on the Garment tab stamps `garment_process`. `Process Rates` section =
  `[yarn_process, fabric_process, material_process, garment_process]`.
- **Rate Type is `per_unit | flat`.** "Per KG" / "Per Piece" is `per_unit` whose label is
  read off the UOM — storing both would be two facts about one. `flat` ⇒ amount = charge,
  qty not multiplied (and not required).
- **The `+` parent row is a GROUP, not a stored row** — lines sharing (order, process_id).
  `basis` on each line says the grain: `process` (one line) · `fabric` (one per fabric) ·
  `color` (one per combo). Changing For RE-SPLITS that group's lines from the breakdown; a
  rate survives the switch only when every line of the group shared it.
- **Garment Reqd is DERIVED** = `qty × no_of_pcs × no_of_units`; `qty` holds the pulled
  production target. NULL pcs/units = 1, so every other source is unchanged.
- **The fold** reuses `components/orders/process-fold-list.tsx` (`ProcessFoldList`) — a
  `ChildGrid` cannot carry a panel under a row. Summary cells read-only; the For select
  is the panel's first field.

## Contract

Migration `0573_budget_process_rates.sql` on `order_budget_lines`:
```
process_id  uuid references public.processes(id)
basis       text check (basis in ('process','fabric','color','part'))
combo       text
rate_type   text not null default 'per_unit' check (rate_type in ('per_unit','flat'))
no_of_pcs   numeric(12,3) check (no_of_pcs  is null or no_of_pcs  > 0)
no_of_units numeric(12,3) check (no_of_units is null or no_of_units > 0)
source check: + fabric_process, material_process, garment_process; − process (update process → garment_process first)
```

`totals.ts`:
```ts
BudgetLineInput += { rate_type?: "per_unit" | "flat"; no_of_pcs?: number | null; no_of_units?: number | null }
export function lineReqd(line): number | Refusal;          // qty × pcs × units
// lineAmount: flat ⇒ money(lineInrRate); else money(lineReqd × lineInrRate)
export const PROCESS_TABS: readonly { source: "yarn_process"|"fabric_process"|"material_process"|"garment_process"; label: string }[];
export type ProcessBasis = "process" | "fabric" | "color";
export type FabricProcessRow = { item_id: string | null; fabric_name: string; combo: string | null; qty: number };
export function splitFabricProcess(rows: readonly FabricProcessRow[], basis: ProcessBasis):
  { basis: ProcessBasis; item_id: string | null; combo: string | null; description: string; qty: number }[];
export function pulledLineKey(l: { source: string; garment_order_id: string | null; item_id: string | null;
  process_id?: string | null; combo?: string | null; basis?: string | null }): string;
```

`service.ts` / `actions.ts`: pull the three new sources (+ `process_id`, stage, basis on
yarn_process); fabric_process pulled at `basis = 'fabric'`; new action
`loadFabricProcessBreakdown(garmentOrderIds)` →
`{ ok: true; groups: { garment_order_id; process_id; process_name; uom_id; rows: FabricProcessRow[] }[] } | { ok: false; error }`.

## Team (same three)

| Teammate | Owns |
|---|---|
| data | `0573_*.sql`, `types.ts`, `service.ts`, `actions.ts`, + additive `itemId` on `StageBreakdownLine` in `lib/orders/fabric-bom/reports.ts` |
| engine | `totals.ts`, `scripts/check-budget-totals.mts` |
| ui | `budget-screen.tsx` + new files under `app/(app)/orders/budgets/` |

---

# Phase 3 — CMTs, 2026-09-18

Client blueprint: one row per style — Style Ref No · Style / Article · SC No / Order No ·
Coordinate · Order Qty · SQ Qty · CMT Rate; amount = **SQ Qty × CMT Rate**; optional breakup
into Cutting / Sewing-Making / Checking / Ironing / Packing per piece. The blueprint's
`budget_cmt_expenses` + `budget_cmt_operation_breakup` tables are not used (Phase 1's reason).
`budget_cmts` (0369) is the dropped Planning module's table — not live, not reused.

## Facts (verified 2026-09-18)

- **Legacy "SQ Qty" = Order + Excess + Rejection + Approval** — the Fabric BOM report's own
  `sqQty` (reports.ts ~440–470, labelled "Cut Qty" there), summed over the order's approval
  rows with the TIERED rejection projection. The blueprint's own figures prove the split:
  Gross Sales 38,85,638.40 = **5028** (Order Qty) × 9.20 × 84, while CMT uses **5321**.
- **Phase 1 header mislabel:** its "SQ Qty" box shows Σ `po_qty`, which is the ORDER qty.
- Style lines: `garment_order_amendment_styles` (style_ref_no, style_description, article_no,
  po_qty, unit_kind). Coordinates: `garment_order_amendment_style_coordinates(style_ref_no,
  coordinate_id → items)` — GAR-class items (PIECES / TOP / BOTTOM); optional, often empty.
- No CMT master, rate card or operation vocabulary exists live.

## Decisions

- **Grain: (order, style_ref_no, coordinate)**, falling back to one row per style when the
  style records no coordinates.
- **The coordinate goes in `item_id`.** A CMT line costs MAKING that garment item, the same
  way a yarn line's `item_id` is the yarn bought. A separate `coordinate_id → items` column
  would be a SECOND FK to `items` and break every bare embed (AGENTS.md) for no gain.
- **SQ Qty is ONE per-style function, extracted from the report, never re-derived.** CMT,
  Garment Processes AND the header read it — within one budget "pieces made" is one number.
  **Garment Processes moves off `materialTarget` onto it** (the blueprint anchors garment
  Reqd on SQ Qty 5321; CMT and garment processes are both labour on the same garments).
- **Header:** shows Order Qty (Σ po_qty) AND SQ Qty; the bottom bar's qty is relabelled
  **Order Qty** (Avg Price = gross ÷ ORDER qty — the blueprint's numbers confirm it).
- **Breakup = five nullable columns** on the line, and the DB enforces
  `rate = Σ breakup` whenever any is set. Rate stays THE rate for every reader; the breakup
  explains it and cannot disagree with it. The schema DERIVES rate from the breakup (4dp),
  so the check always holds. Single rate typed directly stays the fast path; the breakup is a
  `[Breakup]` sub-sheet (AGENTS.md "A sub-detail Sheet's size": `sm`, `SubSheetFooter`).
- **No automatic de-duplication with Garment Processes.** The Process master flags CUTTING /
  SEWING / CHECKING / IRONING / PACKING `for_garments`, so a style's process list can bring
  them into Garment Processes too. No `is_cmt` flag (the client removed backend flags from
  that master today — 0571) and no name match (rejected pattern, 0557). A pulled process
  line arrives unpriced, which blocks Save until the operator prices or removes it.
- CMT is INR labour: no Curr / Ex Rate / Rate Type columns on this grid (lines stay INR,
  per_unit). `cmt` becomes a PULLED source; "+ Add" still allows a manual CMT line.

## Contract

Migration `0574_budget_cmt_breakup.sql` on `order_budget_lines`:
```
cutting_rate, making_rate, checking_rate, ironing_rate, packing_rate  numeric(14,4)  -- each null or >= 0
chk_obl_cmt_breakup: all five null
   OR (source = 'cmt' AND rate = coalesce(cutting_rate,0)+coalesce(making_rate,0)
                               +coalesce(checking_rate,0)+coalesce(ironing_rate,0)+coalesce(packing_rate,0))
```

`totals.ts`:
```ts
PULLED_SOURCES += "cmt"
export const CMT_OPERATIONS: readonly { key: CmtOperationKey; label: string }[];
// cutting_rate "Cutting" · making_rate "Sewing / Making" · checking_rate "Checking" · ironing_rate "Ironing" · packing_rate "Packing"
export type CmtOperationKey = "cutting_rate"|"making_rate"|"checking_rate"|"ironing_rate"|"packing_rate";
export type CmtBreakup = Partial<Record<CmtOperationKey, number | null>>;
export function cmtBreakupTotal(b: CmtBreakup): number | Refusal | null;  // null = no breakup; Σ of 4dp-rounded values, rounded to 4dp
```

`types.ts` / `service.ts`:
- `BudgetLine` / `budgetLineInput` / `PulledCostLine` gain the five `*_rate` fields. Zod: each
  4dp, ≥ 0; when any is set, `rate` := `cmtBreakupTotal` and source must be `cmt`.
- `BudgetableOrder` gains `sq_qty: number | null`, `sq_refusal: string | null`, and
  `styles: { style_ref_no; style_description; article_no; unit_kind; order_qty;
  sq_qty: number | null; sq_refusal: string | null; coordinates: { id; name }[] }[]`.
- `cmt` lines pulled per (order, style, coordinate): `qty` = style SQ Qty, `item_id` =
  coordinate (null when none), `style_ref_no`, `uom` PCS, `rate` null.

## Team — same three, same ownership as Phase 2 (+ data may export the per-style SQ Qty
helper from `lib/orders/fabric-bom/reports.ts`, with that report's output unchanged).

---

# Phase 4 — Other Expenses · Other Incomes · General, 2026-09-18

Blueprints: Other Expenses (Cost Head · Description · Type SQ/Style/Order Wise · Rate Type
Qty/Flat/Percentage · UOM · Qty · Rate · Value), Other Incomes (Income Head · Description ·
Percentage/Flat · Rate · Value), General (cost matrix by category with % of Gross Sales +
highlights incl. Cost per piece). Blueprint tables / SQL view not used (Phase 1's reason; the
view's figures are `budgetTotals`, which refuses where SQL would part-sum).

## Decisions

- **Heads are two `config_lookups` kinds, `expense_head` and `income_head`**, picked with
  `LookupDialogPicker` (inline Add/Modify). NOT the finance `cost_heads` master: its RLS is
  gated on `finance` permissions (a merchandiser would see an empty picker), it has no inline
  add, and it is a GL cost-centre vocabulary. Seeded with the client's own examples:
  TESTING, FOB, BANK CHARGES, COMMISSION, INSPECTION / DUTY DRAWBACK, RODTEP, ROSCTL.
  One column `cost_head_id → config_lookups(id)`; the tab's picker offers only its kind.
- **Type is not stored — it IS the line's scope.** SQ Wise = whole budget (no order), Order
  Wise = `garment_order_id`, Style Wise = + `style_ref_no`. Choosing Type fills Qty with that
  scope's SQ Qty.
- **`rate_type` gains `percent`**: amount = scope's INR gross sales × rate / 100. No per-style
  sales value exists (`orderValue` has no style breakdown; pack pricing makes a naive split
  wrong), so Style Wise + Percentage refuses with a sentence. DB: percent ⇒ rate ≤ 100 and
  currency_code null.
- **Cost (and income) can now REFUSE.** A percent line whose rate is fine but whose sales base
  refuses is `pending` (does not block Save) and makes its category, cost and profit refuse,
  naming the line — never a smaller, plausible partial total.
- **General = the last rail section**, read-only: GENERAL_CATEGORIES matrix (Yarn · Fabric ·
  Accessories · Processing · CMT · Other Expenses, + Total) with % of Gross Sales, then Gross
  Sales · Total Expenses · Other Incomes · Net Profit · Margin % · Cost per piece (= cost ÷ SQ
  Qty, the client's definition).
- **Approval lock of upstream modules: deferred** — own plan, needs a client policy decision.

## Contract

Migration `0575_budget_other_lines.sql`:
```
order_budget_lines.cost_head_id uuid references public.config_lookups(id)
chk_obl_rate_type: rate_type in ('per_unit','flat','percent')
chk_obl_percent: rate_type <> 'percent' or ((rate is null or rate <= 100) and currency_code is null)
config_lookups_kind_check: + 'expense_head', 'income_head' (restate ALL kinds from the latest rewrite)
seed rows for both kinds
```
Engine: see the Phase 4 brief (rate_type percent, pending, cost/income/costBySource may refuse,
GENERAL_CATEGORIES, generalSummary).

---

# Phase 5 — The approval lock (PLAN, not built), 2026-09-18

Client blueprint (General tab §3): once the MD approves a budget, "HARD LOCK RE Entry across
Order Entry, Fabric PLM, Material PLM"; REWORK sends it back with fields re-opened.

## What exists (verified 2026-09-18)

- **Approval engine is LIVE** (0500–0505). A budget reaches `approved` two ways: the engine's
  terminal trigger `approval_apply_terminal()` (0505, SECURITY DEFINER), and the legacy
  `decideBudget()` (shown only when a budget has no run). REWORK = `rejected → draft`, already
  built. **No notification is sent** by either path — only the inbox page shows the queue.
- **Nothing locks anything today.** `garment_order_amendments` has `is_draft` and an
  `approval_status` nobody reads; both BOMs have only `is_draft`; no write action checks
  status. No screen of the three has a read-only mode.
- **The purchase ceiling reads the LIVE latest Material BOM** of an order whose budget is
  approved (`bom-ceiling-service.ts`). Editing the BOM after approval MOVES the ceiling POs are
  checked against — the concrete reason this lock matters.
- **Write choke points exist:** Order Entry = `createAmendment` / `updateAmendment` /
  `deleteAmendment` (+ one `writeChildren`); Fabric BOM = create/update/delete + `writePalette`
  (which writes ORDER child tables); Material BOM = create/update/delete.
- **Order Amendment is not a separate document.** `/orders/amendments` renders the same screen
  with `purpose="amend"` and saves through the same `updateAmendment` on the same row.

## Three defects found on the way (fixed by this phase)

1. **An approved budget can never be revised.** `canTransition` lets `approved` go nowhere,
   and 0428's stated revision path — "raise a second budget" — is refused at approval because
   the order is already in an approved budget. Today, once approved, the numbers are final
   forever. A lock on top of that would freeze the ORDER forever too.
2. **The engine path skips the "one approved budget per order" guard.** Only `decideBudget`
   runs `approvedClash`; the trigger path does not, yet the purchase ceiling assumes it holds.
3. **Approving a budget does not freeze what it approved** — see the ceiling above.

## Design

- **The lock is DERIVED, never stored.** An order is locked while an `approved` budget covers
  it: one SQL function `order_budget_lock(order_id) → (budget_id, code, decided_at) | null`.
  No `is_locked` column to drift; unlocking happens by itself when the budget leaves approved.
- **Server guard = the authority.** One `assertOrderUnlocked(orderId)` at the top of every
  write action listed above (before any write — there is no transaction across PostgREST
  calls, so a refusal after the first child write would leave a half-saved order). Message
  names the budget: "Locked — approved in budget BG-12 on 18/09/2026. Reopen it to change
  this order."
- **DB backstop:** BEFORE INSERT/UPDATE/DELETE triggers on the three PARENT tables
  (`garment_order_amendments`, `order_fabric_boms`, `material_bom_amendments`) raising the
  same named message (precedent: `validate_item_class_category`, 0335). Child tables are
  covered by the server guard only — stated, not implied.
- **Single-approved-budget guard moves INTO the database:** a BEFORE UPDATE trigger on
  `order_budgets` when status becomes `approved`, so BOTH approval paths run it (fixes defect 2).
- **Revision path (fixes defect 1):** "Reopen for revision" — `approved → draft`, approver-only
  (`orders:approve`), mandatory remark, recorded (who / when / why). It unlocks the orders; the
  re-submitted budget starts a fresh approval run.
- **Read-only UI, in the primitives:** a `locked` prop on `MasterFullScreen` feeding a
  `ReadOnlyScope` context that `Input` / `Textarea` / `Select` / `DataPicker` / `RecordPicker` /
  `ChildGrid` already-shared primitives read (readOnly, no add/remove), plus a banner naming the
  budget and a Save that explains instead of saving. Screens get it by passing one prop —
  not three hand-rolled read-only modes. Hand-rolled controls on the 22k-line order screen are
  the known remainder; the server guard still holds them.
- **Stays writable:** T&A execution worklists (they track what happened, not what was
  budgeted), and the budget's own approval trail.

## Decided (user, 2026-09-18)

1. **Order Amendment locks too.** It saves to the same row as Order Entry; exempting it would
   empty the lock. Changes to an approved order go through Reopen.
2. **Reopen = an approver (`orders:approve`) moves the budget `approved → draft` with a
   mandatory remark**, recorded who / when / why. No separate approval for the reopen itself.
   Re-submitting starts a fresh approval run.
3. **While reopened, Purchase BLOCKS new POs for those orders** — no approved ceiling, no
   buying. Verify first what `bom-ceiling-service.ts` does today with NO approved budget
   (allow vs refuse); if it allows, the block is new work in the PO path, and POs already
   placed above a lowered ceiling need a stated rule (flag, never auto-cancel).

## Rough build shape (same three teammates)

data: migration (lock fn, 3 backstop triggers, approved-uniqueness trigger, reopen audit
columns), `assertOrderUnlocked` + calls in the 3 action files, `reopenBudget` action ·
engine: `canTransition` approved→draft (approver-only), vectors · ui: `ReadOnlyScope` in the
primitives + `MasterFullScreen locked`, banners on the 3 screens, Reopen button on the budget.
Collision risk: another session is editing the Fabric BOM files in this tree now.

---

# Phase 5 — CONTRACT (supersedes the Phase 5 "Design" above where they differ), 2026-09-18

Source: doc/order/budget.md §4 + the user's restatement of the Hard Lock Rules:
"When approved, set RE Status = APPROVED. Execute database lock triggers to set Order Entry,
Fabric PLM and Material PLM to Read-Only / Locked for this RE No. This protects the projected
profit margin from unauthorized edits to quantities, price, or fabric weight."

## Changed from the plan: the RE STATUS is STORED (the spec says "set", and it is right)

- `garment_order_amendments.re_status text not null default 'open' check (re_status in
  ('open','approved'))` + `re_status_at timestamptz`.
- **ONE writer:** an AFTER UPDATE OF status trigger on `order_budgets` —
  `→ approved` sets its orders APPROVED; `approved → draft` (reopen) sets them OPEN.
  **SECURITY DEFINER** (search_path pinned, `revoke all … from public, anon`): the approver
  may hold `orders:approve` without `orders:edit`, and an invoker-rights update would be
  filtered to 0 rows by RLS — the order would stay unlocked with no error.
- Every lock trigger, the order list and the editors read `re_status` — one column, no join.

## Database lock triggers (the authority)

- **Parents:** BEFORE UPDATE/DELETE on `garment_order_amendments` (refuse when OLD.re_status =
  'approved'); BEFORE INSERT/UPDATE/DELETE on `order_fabric_boms` and
  `material_bom_amendments` (refuse when their order is approved; MBA with no order: allowed).
- **Children too** — Order Entry saves by delete + re-insert of ~20 child grids, so a
  parent-only trigger leaves quantities and prices writable through a child table. ONE generic
  trigger function `refuse_when_order_locked()` with TG_ARGV naming how to reach the order
  (direct `amendment_id`, or via `bom_id` → BOM → order), attached to every child table found
  from the CATALOG (FKs into the three parents), **T&A tables excluded** (execution, not plan)
  and any other exclusion justified in the migration.
- **Allowlist, not blanket:** an UPDATE whose only changed columns are bookkeeping
  (`re_status`, `re_status_at`, `approval_status`, `approved_at`, `updated_at`, …) passes —
  compared as `to_jsonb(NEW) - allow <> to_jsonb(OLD) - allow`. Otherwise the status trigger
  would be refused by the lock it sets.
- Message (one wording everywhere): `RE <no> is locked — its budget <code> was approved on
  <dd/mm/yyyy>. Reopen the budget (Amendment Protocol) to change it.`
- **Uniqueness guard:** BEFORE UPDATE on `order_budgets` when status becomes `approved` —
  refuse if any of its orders is already in another approved budget, naming it. Both approval
  paths (engine terminal trigger, legacy decideBudget) pass through it.

## Server guards (the courtesy, so the operator sees a sentence before any write)

`assertOrderUnlocked(orderId)` at the top of every write action of Order Entry / Amendment,
Fabric BOM (incl. `writePalette`) and Material BOM — BEFORE the first write. The trigger is
still the guard; this makes the refusal a toast instead of a half-run action.

## Amendment Protocol = the reopen (doc §4.4 + decisions 1–2)

- `order_budget_revisions`: budget_id, revision_no, **source** ('customer' | 'internal' —
  "By Customer" / "By Us"), **amendment_type**, **reason** (not null, non-blank), baseline
  jsonb (the APPROVED figures + lines as they stood), approved_by/at of the baseline,
  reopened_by (auth.uid()), reopened_at. Append-only (no UPDATE/DELETE policy).
- `reopen_order_budget(budget_id, source, type, reason, baseline)` — ONE transactional RPC
  (insert revision + `approved → draft`, clearing decided_* per `chk_ob_decision_*`), gated on
  `orders:approve`. Two PostgREST calls would leave a revision with no reopen or vice versa.
- `canTransition`: `approved → draft` only through this path.
- The budget shows its revision history and, in General, **Approved baseline vs Current**
  with the variance.

## Submission summary + notification (doc §4.2)

- `budgetKpis()` (engine): RE No(s), entry date, delivery date(s), order qty, total income
  (= gross sales + other incomes, per the doc), total expenses, profit, profit %, cost/piece —
  refusals as sentences.
- Stored at submit as `order_budgets.submitted_summary jsonb` (what the MD approved against)
  and passed as the approval run's context.
- Notify the current step's approvers when a step becomes active — mechanism per the
  notifications research (in-app always; web push only if it already exists).

## Purchase (decision 3)

While an order's budget is reopened (has a revision and is not approved), no new PO for that
order — refused at the PO write choke point with the revision's reason.

## Gross Sales — NOT changed

doc/order/budget.md §3 Step A says `SQ Quantity × Avg Price × Rate`. The client's own sample
(38,85,638.40 = **5028** × 9.20 × 84) is ORDER Qty; SQ Qty (5321) includes excess/rejection
pieces that are never sold. Kept on Order Qty; flagged to the user for client confirmation.

## Phase 5 — research-settled details (2026-09-18)

- **Notify:** `lib/notifications/notify.ts` `notify({userIds}, {title, body, href, type})` —
  in-app bell (Realtime) + WEB PUSH (VAPID, `app/sw.ts` push handler). Payload is text only,
  so the KPI summary goes in `body`. Approvers: `approval_step_approvers(step, requester,
  scope, context)` (granted to authenticated since 0546), step = `steps_snapshot ->
  (current_step - 1)`. Called from TS after `startApproval` AND after `actOnRun` advances a
  run — in `lib/approvals`, generic, so every future workflow gets it. The run's `context`
  carries the KPIs (`approval_runs.context`).
- **Amendment vocabulary is REUSED:** source = the order module's own `INITIATED_OPTIONS`
  ("By Customer" / "By Us", stored 'customer' / 'internal'); type = the legacy
  `order_amendments` list quantity · colour · price · sizes · delivery_date · consignee ·
  packing · style, + internal_error (doc §4.4) + other.
- **PO block:** new gate `refuseReopenedBudget` beside `refuseOverCeiling` /
  `refuseUnsettledMaterials` / `refuseUnapprovedYarnPurchase` at all four write paths of
  `lib/purchase/po-actions.ts`. Today POs are ALLOWED for an order with no approved budget —
  that stays true; only a REOPENED budget blocks.
- **Allowlist columns** (bookkeeping that must pass the lock): re_status, re_status_at,
  approval_status, approved_by, approved_at, approval_reason (decideAmendment), updated_at.
  CAD apply (`lib/orders/cad/actions.ts`) changes fabric consumption — BLOCKED on a locked
  order on purpose ("fabric weight" is what the lock protects).
- **UI lock:** all three editors use `MasterFullScreen` (order: mount=page, the two BOMs:
  overlay) → one `locked` prop. `LockScope` context modelled on `RequiredScope`
  (field.tsx), read where `useRequiredHold` is (input, textarea, select, combobox,
  data-picker, multi-select, file-attachments) + toggle, RecordPicker, ChildGrid (no add /
  remove). Unlike RequiredScope it is NOT reset at portal boundaries: a sub-sheet of a locked
  record is locked too.

## Phase 5 team (four)

| Teammate | Owns |
|---|---|
| data | `0576_budget_approval_lock.sql`, `lib/orders/budget/{types,service,actions}.ts` |
| engine | `lib/orders/budget/totals.ts` (+ a new `lib/orders/budget/amendment.ts` if cleaner), vectors |
| locks (new) | server guards in `lib/orders/{amendments,fabric-bom,material-bom-amendment,cad}/actions.ts`, `lib/purchase/{bom-ceiling-service,po-actions}.ts`, `lib/approvals/*` notify, `locked` wiring + banners in the three editor screens, RE Status on the order list |
| ui | `LockScope` in the field primitives + `MasterFullScreen locked`, budget screens (Amendment Protocol sheet, revision history, baseline vs current, submitted summary) |

Shared-tree rule: `fabric-bom-screen.tsx` and `child-grid.tsx` are being edited by another
session — surgical `Edit` only, re-read right before editing, never a whole-file `Write`.
