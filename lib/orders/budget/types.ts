import { z } from "zod";
import {
  BUDGET_SOURCES,
  CMT_OPERATIONS,
  cmtBreakupTotal,
  isRefusal,
  round4,
} from "./totals";
import { capsTextNullable } from "@/lib/validation/formats";
import { HOME_CURRENCY } from "@/lib/orders/amendments/order-value";
import {
  AMENDMENT_SOURCES,
  AMENDMENT_TYPES,
  type AmendmentSource,
  type AmendmentType,
} from "./amendment";

// ============================================================================
// Orders ▸ Budgeting (step 5) and Approval (step 6), over ONE table (0428).
//
// A budget groups several garment orders, costs them from their Fabric and
// Material BOMs, and is then approved. Approval is a transition on `status`, not
// a second document — two records would let the approved figures drift from the
// budget they approved.
//
// `amount` and every total are DERIVED, by `./totals.ts`. See 0428 on why: three
// numbers stating two facts disagree the first time one is edited without the
// other, and the sales total REFUSES when an order cannot be valued, which a
// numeric column cannot hold.
// ============================================================================

export const BUDGET_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export function budgetStatusText(s: BudgetStatus): string {
  switch (s) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Awaiting approval";
    case "approved":
      return "Approved";
    default:
      return "Rejected";
  }
}

export function budgetStatusTone(s: BudgetStatus): "neutral" | "warning" | "success" | "danger" {
  switch (s) {
    // NEUTRAL — `lib/ui/tone.ts`: neutral is "no claim", and a draft makes none.
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
    default:
      return "danger";
  }
}

/**
 * Can this budget move to that status?
 *
 * ONE FUNCTION, THREE READERS — the editor's footer, the approval queue's
 * buttons, and both server actions. A transition table that lived only in the
 * UI would let a stale tab approve a budget that had already been rejected, and
 * one that lived only in the action would leave the screen offering buttons that
 * always fail.
 *
 * `submitted -> submitted` is refused rather than being a harmless no-op: it is
 * what a double-click produces, and letting it through would re-stamp
 * `submitted_at` and move the budget to the back of the queue.
 */
export function canTransition(from: BudgetStatus, to: BudgetStatus): boolean {
  switch (from) {
    case "draft":
      return to === "submitted";
    case "submitted":
      return to === "approved" || to === "rejected";
    // A REJECTED BUDGET GOES BACK TO DRAFT to be reworked. An APPROVED one
    // does NOT, through this table: it is the document purchase is acting on
    // and its orders are LOCKED by it (0576). The only way back is the
    // Amendment Protocol — `canReopen` below and `reopen_order_budget()` —
    // which records who reopened it, why, and the approved baseline in the
    // same transaction as the status change.
    case "rejected":
      return to === "draft";
    default:
      return false;
  }
}

/**
 * May this budget be reopened through the Amendment Protocol (0576)?
 *
 * Only an APPROVED one. A rejected budget goes back to draft by the ordinary
 * transition above — nothing was approved, so there is no baseline to freeze
 * and no lock to lift. Gated on `orders:approve` by the action and the RPC:
 * undoing an approval is the approver's act.
 */
export function canReopen(status: BudgetStatus): boolean {
  return status === "approved";
}

/**
 * May this budget be deleted?
 *
 * Only while it is the operator's (draft / rejected) AND it was never approved.
 * A budget reopened through the Amendment Protocol is a draft again, but its
 * revisions are the audit record of an approval being undone (doc §4.4), and
 * deleting the budget would erase them — 0576 refuses it in the database
 * (`guard_order_budget_approval`, and the revisions' FK is ON DELETE RESTRICT).
 * The screen reads this so it never offers the button the database refuses.
 */
export function canDeleteBudget(b: { status: BudgetStatus; revisions?: readonly unknown[] | null }): boolean {
  return (b.status === "draft" || b.status === "rejected") && (b.revisions?.length ?? 0) === 0;
}

/**
 * Why an order cannot be budgeted yet — or null once BOTH BOMs are saved (the
 * prerequisite gate, user 2026-09-19). ONE SENTENCE for the picker and the save
 * action, so the operator reads the same words on screen and in a refusal.
 */
export function bomRefusalOf(fabricSaved: boolean, materialSaved: boolean): string | null {
  if (fabricSaved && materialSaved) return null;
  if (!fabricSaved && !materialSaved) return "Fabric BOM and Material BOM not saved";
  return fabricSaved ? "Material BOM not saved" : "Fabric BOM not saved";
}

export interface BudgetOrder {
  id: string;
  budget_id: string;
  garment_order_id: string;
  sno: number;
  /** The order's value when the budget was saved. NULL means it could not be
   *  valued — `sales_refusal` says why. Never a partial sum. */
  sales_value: number | null;
  sales_refusal: string | null;
  garment_order?: {
    id: string;
    code: string | null;
    po_no: string | null;
    delivery_date: string | null;
    customer: { id: string; name: string } | null;
    sales_order: { order_number: string | null } | null;
  } | null;
}

export interface BudgetLine {
  id: string;
  budget_id: string;
  sno: number;
  source: string;
  /** Which order this cost belongs to. NULL = the whole group — right for a
   *  shared overhead, wrong for fabric. */
  garment_order_id: string | null;
  item_id: string | null;
  description: string | null;
  qty: number | null;
  uom_id: string | null;
  /** In `currency_code`'s units — NOT rupees unless that is null (0572). */
  rate: number | null;
  notes: string | null;
  /** Brand / Specifications (0572). */
  specification: string | null;
  /** The currency `rate` is quoted in. NULL = INR, which is what every line
   *  written before 0572 was. Travels with `ex_rate`. */
  currency_code: string | null;
  /** Rupees per unit of `currency_code`. NULL exactly when it is. */
  ex_rate: number | null;
  /** Free of cost — a real line at amount 0 (0474 on the Material BOM). */
  is_foc: boolean;
  is_import: boolean;
  /** The process this line charges for — the four `*_process` sources (0573). */
  process_id: string | null;
  /** The grain a pulled process line was split at (0573). */
  basis: BudgetLineBasis | null;
  /** The colourway a `basis = 'color'` line is for. Text by value. */
  combo: string | null;
  /** `flat` = the rate IS the charge; `per_unit` = rate x Reqd (0573). */
  rate_type: BudgetRateType;
  /** Garment Processes multipliers. NULL = 1. */
  no_of_pcs: number | null;
  no_of_units: number | null;
  /** The style a `garment_process` line is for — TEXT by value, the order
   *  module's key (0407 · 0411). NULL on every other source. */
  style_ref_no: string | null;
  /** The component a Partwise (`basis = 'part'`) garment line is for (0421's
   *  `components` row). NULL otherwise. */
  component_id: string | null;
  /** CMT breakup, per piece (0574). NULL = not broken up; when any is set,
   *  `rate` is their sum — `chk_obl_cmt_breakup`. */
  cutting_rate: number | null;
  making_rate: number | null;
  checking_rate: number | null;
  ironing_rate: number | null;
  packing_rate: number | null;
  /** The Expense / Income Head (0575) — a `config_lookups` row of kind
   *  `expense_head` / `income_head`. NULL on every other source. */
  cost_head_id: string | null;
  /** The stage (0590) — a `config_lookups` row: `yarn_stage` (GREY / DYED) on
   *  a Yarn Purchases line, `fabric_stage` (GREIGE / DYED / WASH / PRINT) on a
   *  Fabric Purchases line — the lists the Fabric BOM's Yarn Process and Fabric
   *  Process use. NULL on every other source. */
  stage_id: string | null;
  /** Pulled from a BOM (0591) — its item, description, qty, unit, stage and
   *  colour are the BOM's and read-only on the budget; false = typed by hand.
   *  `source` cannot say which: every pulled grid takes a hand-added line too. */
  from_bom: boolean;
}

/** 0573's `chk_obl_basis`. `part` is Garment Processes' Partwise — never a
 *  fabric split, which is why `ProcessBasis` in `./totals` stops at three. */
export const BUDGET_LINE_BASES = ["process", "fabric", "color", "part"] as const;
export type BudgetLineBasis = (typeof BUDGET_LINE_BASES)[number];

/** 0573's `chk_obl_rate_type`, widened by 0575. "Per KG" / "Per Piece" is
 *  `per_unit` with its word read off the UOM — never stored beside it.
 *  `percent` is a share of the line scope's INR gross sales. */
export const BUDGET_RATE_TYPES = ["per_unit", "flat", "percent"] as const;
export type BudgetRateType = (typeof BUDGET_RATE_TYPES)[number];

export interface OrderBudget {
  id: string;
  code: string | null;
  budget_date: string;
  description: string | null;
  status: BudgetStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_remark: string | null;
  currency_code: string | null;
  exchange_rate: number;
  remark: string | null;
  location_id: string | null;
  created_at: string;
  updated_at: string;
  orders: BudgetOrder[];
  lines: BudgetLine[];
  /** The KPIs as they stood at submit (`kpisToJson`, 0576) — what the
   *  approver approved against. Read with `kpisFromJson`. NULL before the
   *  first submit since 0576. */
  submitted_summary: unknown;
  /** The Amendment Protocol history, oldest first (0576). */
  revisions: BudgetRevision[];
}

/** One reopen of an approved budget (0576, `order_budget_revisions`). */
export interface BudgetRevision {
  id: string;
  budget_id: string;
  revision_no: number;
  source: AmendmentSource;
  amendment_type: AmendmentType;
  reason: string;
  /** `budgetBaseline()` as it stood when reopened — the approved figures and
   *  lines. Read it with `compareToBaseline`. */
  baseline: unknown;
  baseline_approved_by: string | null;
  /** Who approved the baseline, by name (`creator_names()`). */
  baseline_approved_by_name?: string | null;
  baseline_approved_at: string | null;
  reopened_by: string | null;
  /** Resolved through `creator_names()`, never an embed (lib/created-by.ts). */
  reopened_by_name?: string | null;
  reopened_at: string;
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

/**
 * One CMT operation's rate, rounded to 4dp the way `numeric(14,4)` stores it —
 * with the ENGINE's `round4`, which rounds on the typed decimal (12.34565 →
 * 12.3457, as Postgres does; `Math.round(n * 1e4)` gives 12.3456). The same
 * function `cmtBreakupTotal` rounds each term with, so the stored operations
 * and the stored rate are rounded identically and `chk_obl_cmt_breakup` holds.
 * A negative passes through untouched for the refine to name.
 */
const breakupN = numN.transform((v) => (v == null || v < 0 ? v : round4(v)));

export const budgetOrderInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  garment_order_id: z.string().uuid(),
  sales_value: numN,
  sales_refusal: nullableText,
});

export const budgetLineInput = z
  .object({
    sno: z.coerce.number().int().nonnegative().default(0),
    source: z.enum(BUDGET_SOURCES),
    garment_order_id: uuidN,
    item_id: uuidN,
    description: capsTextNullable(),
    qty: numN,
    uom_id: uuidN,
    rate: numN,
    notes: capsTextNullable(),
    specification: capsTextNullable(),
    /* Blank and absent both mean INR, and so does the word INR itself — see
       the transform at the bottom. Upper-cased because `currencies.code` is
       the FK target and holds "USD", not "usd". */
    currency_code: z
      .string()
      .trim()
      .transform((v) => (v ? v.toUpperCase() : null))
      .nullable()
      .default(null),
    ex_rate: numN,
    /* NOT `z.coerce.boolean()` — that turns the string "false" from a
       spreadsheet import into `true`. */
    is_foc: z.boolean().default(false),
    is_import: z.boolean().default(false),
    // 0573 — Process Rates.
    process_id: uuidN,
    basis: z.enum(BUDGET_LINE_BASES).nullable().default(null),
    combo: capsTextNullable(),
    rate_type: z.enum(BUDGET_RATE_TYPES).default("per_unit"),
    no_of_pcs: numN,
    no_of_units: numN,
    /* Upper-cased and trimmed like every style key (`styleKey`), so a typed
       ref and a pulled one compare equal. */
    style_ref_no: capsTextNullable(),
    component_id: uuidN,
    /* 0574 — the CMT breakup. Rounded to 4dp as the column stores it (see
       `breakupN` above), and the transform below derives `rate` from it. */
    cutting_rate: breakupN,
    making_rate: breakupN,
    checking_rate: breakupN,
    ironing_rate: breakupN,
    packing_rate: breakupN,
    // 0575 — Other Expenses / Other Incomes.
    cost_head_id: uuidN,
    // 0590 — Yarn Purchases' Stage.
    stage_id: uuidN,
    /* 0591 — pulled from a BOM. A real boolean, never `z.coerce` (the
       spreadsheet "false" reason above); absent means typed by hand. */
    from_bom: z.boolean().default(false),
  })
  /**
   * The line rules, in the SCHEMA — `lib/data-io` parses imports with these same
   * schemas and writes straight to Postgres, so a rule enforced only in the
   * action misses every spreadsheet import.
   *
   * The messages are `lineAmount`'s, word for word. Two spellings of one refusal
   * is how an operator comes to believe there are two different problems.
   */
  .superRefine((v, ctx) => {
    /* THE BREAKUP DECIDES WHETHER A RATE IS OWED AT ALL (0574): a breakup IS
       the rate (the transform below derives it), so a line with one must not
       be refused "Enter a rate" for a box the operator never types. Read here,
       reported at the RATE's place in the order below, so the first refusal
       the operator sees is still the engine's first. */
    const breakup = cmtBreakupTotal(v);

    /* A FLAT CHARGE ASKS FOR NO QUANTITY (0573) — `lineAmount` does not
       consult Reqd for one, so refusing a blank here would demand a number the
       charge does not depend on. A pulled quantity still rides along for
       reference. */
    /* NOR DOES A PERCENTAGE (0575) — it is a share of the sales of the line's
       scope, and `lineAmount` reads no quantity, pieces, units or currency for
       one. */
    const perUnit = v.rate_type !== "flat" && v.rate_type !== "percent";
    if (perUnit && (v.qty == null || v.qty <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qty"],
        message: "Enter a quantity — use 1 for a lump sum",
      });
    }
    /* THE TWO MULTIPLIERS: blank is 1, anything else must be above 0 —
       `lineReqd`'s sentences, word for word. Checked on a flat line too,
       although the engine ignores them there: `chk_obl_no_of_pcs` /
       `chk_obl_no_of_units` do not, and Postgres would word it worse. */
    if (v.no_of_pcs != null && !(v.no_of_pcs > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["no_of_pcs"],
        message: "No of Pcs must be more than 0 — leave it blank for 1",
      });
    }
    if (v.no_of_units != null && !(v.no_of_units > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["no_of_units"],
        message: "No of Units must be more than 0 — leave it blank for 1",
      });
    }
    /* A FREE-OF-COST LINE NEEDS NO RATE (0572) — it is a real line at amount
       0, and `lineAmount` answers 0 for it without one. Demanding a rate would
       make the operator type a 0 the flag already states. A rate typed on one
       anyway is still checked for sign below. */
    if (isRefusal(breakup)) {
      // A negative operation, named in the engine's own words, on its own box.
      const bad = CMT_OPERATIONS.find((op) => (v[op.key] ?? 0) < 0);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [bad?.key ?? "rate"],
        message: breakup.refused,
      });
    } else if (breakup != null) {
      // `chk_obl_cmt_breakup` — said here rather than left for Postgres to word.
      if (v.source !== "cmt") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source"],
          message: "Only a CMT line can carry an operation breakup",
        });
      }
    } else if (v.rate == null) {
      if (!v.is_foc) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rate"], message: "Enter a rate" });
      }
    } else if (v.rate < 0) {
      // NOT a tidy-up of the sign. A negative expense subtracts from the COST
      // total, which is the figure a purchase ceiling is checked against.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rate"],
        message: "A rate cannot be negative — use Other income instead",
      });
    } else if (v.rate_type === "percent" && v.rate > 100) {
      /* `percentRate`'s sentence. Asked on a FOC line too, though the engine
         answers 0 there first: `chk_obl_percent` does not know about FOC. */
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rate"],
        message: "A percentage cannot be more than 100",
      });
    }

    /* THE CURRENCY AND ITS RATE TRAVEL TOGETHER (0572, `chk_obl_currency_pair`).
       A currency with no rate cannot be converted; a rate with no currency is
       a multiplier on rupees, which would quietly scale an INR price by 83.
       INR itself needs no rate — it converts at 1 by definition — and is
       folded to null below rather than stored as a second spelling of home. */
    const home = v.currency_code === HOME_CURRENCY;
    /* A PERCENT LINE HAS NO CURRENCY — it is cleared below, not refused: the
       percentage is of sales already in INR (`chk_obl_percent`). */
    if (!home && v.rate_type !== "percent") {
      if (v.currency_code != null && (v.ex_rate == null || !(v.ex_rate > 0))) {
        // `lineInrRate`'s refusal, word for word — missing and <= 0 are one
        // sentence there, because 0 is "not entered", not a rate.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ex_rate"],
          message: `Enter the exchange rate for ${v.currency_code}`,
        });
      } else if (v.currency_code == null && v.ex_rate != null) {
        /* The engine ignores a rate with no currency (it reads as INR); the
           table does not (`chk_obl_currency_pair`), so this is said here
           rather than left for Postgres to word. */
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["currency_code"],
          message: "Choose the currency this rate is in",
        });
      }
    }
  })
  /* ONE SPELLING OF HOME. NULL is INR on this table (0572), so an explicit
     "INR" is stored as null/null — otherwise two lines both in rupees would
     disagree on whether they carry a currency, and a filter on one spelling
     would miss the other. */
  .transform((v) =>
    /* A percent line joins them: a share of an INR figure carries no currency,
       and 0575's `chk_obl_percent` refuses one. */
    v.currency_code === HOME_CURRENCY || v.rate_type === "percent"
      ? { ...v, currency_code: null, ex_rate: null }
      : v,
  )
  /* THE RATE IS DERIVED FROM ITS BREAKUP (0574), never typed beside it —
     `chk_obl_cmt_breakup` holds `rate` equal to the five operations' sum, and
     `cmtBreakupTotal` rounds exactly as Postgres will store them, so a line
     that passed this schema cannot fail that check. No breakup: the typed rate
     stands, which is the fast path. */
  .transform((v) => {
    const total = cmtBreakupTotal(v);
    return typeof total === "number" ? { ...v, rate: total } : v;
  });

export const orderBudgetInput = z.object({
  budget_date: z.string().min(1, "Date is required"),
  description: capsTextNullable(),
  currency_code: nullableText,
  exchange_rate: z.coerce.number().positive("Exchange rate must be more than 0").default(1),
  remark: nullableText,
  /** AT LEAST ONE ORDER. A budget with none is a cost sheet for nothing — and
   *  `budgetTotals` refuses its sales figure anyway, so saving one would create a
   *  document that can never leave draft. */
  orders: z.array(budgetOrderInput).min(1, "Add at least one garment order"),
  lines: z.array(budgetLineInput).default([]),
});

export type OrderBudgetInput = z.infer<typeof orderBudgetInput>;
export type BudgetLineInputT = z.infer<typeof budgetLineInput>;
export type BudgetOrderInputT = z.infer<typeof budgetOrderInput>;

/** A garment order a budget may pick up, with what it will sell for. */
export type BudgetableOrder = {
  id: string;
  /** The order's colourways (`garment_order_amendment_combos.combo`), in its
   *  own order — what Yarn Purchases' Colour lists, as the Fabric BOM's Yarn
   *  Process does (0590). */
  combos: string[];
  sc_no: string | null;
  order_code: string | null;
  po_no: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  /** `sq_details.code` via `sq_detail_id` (0511). Null for the ordinary order
   *  booked straight off a customer PO. Never displayed — it feeds only the
   *  queue's "Booked From" facet. */
  sq_no: string | null;
  /** `sales_orders.order_number` — the same value as `sc_no`; "RE No" is the
   *  operator-facing name for it since 2026-08-23. */
  re_no: string | null;
  /** Garments ordered — the Styles tab's `po_qty`, summed over every line
   *  `orderValue` counts. Pieces, on a set pack too. Null when nothing is
   *  ordered yet. */
  qty: number | null;
  /** The unit `qty` is in — always PCS, because `po_qty` is always pieces.
   *  Null when `qty` is. */
  unit: string | null;
  /** The order's own currency and booking rate (Logistic tab). `ex_rate` is 1
   *  for an INR order and null when not entered — never the column's 0. */
  currency_code: string | null;
  ex_rate: number | null;
  /** `orderValue().grossValue`, in the BUYER'S currency, before conversion.
   *  Null when it refuses. */
  gross_value: number | null;
  /** Cut Qty — Order + Excess + Rejection + Approval, the Fabric BOM report's
   *  own (`qtyBreakdownOf`) — summed over `styles`. Null, with `cut_refusal`
   *  saying why, the moment ANY style refuses: a sum of the styles that could
   *  be counted is not the order's figure. */
  cut_qty: number | null;
  cut_refusal: string | null;
  /** One entry per style ref on the order — the CMT grid's rows (0574). */
  styles: BudgetableStyle[];
  /** From `orderValue()` — null when it refuses. */
  sales_value: number | null;
  sales_refusal: string | null;
  /** Which budget already covers it, if any. Advisory: two DRAFT budgets over
   *  one order is someone comparing two groupings, and only APPROVAL is refused
   *  (0428). */
  in_budget: {
    id: string;
    code: string | null;
    status: BudgetStatus;
    /** An OPEN revision entry is on this budget (Orders ▸ Order Revisions) —
     *  so a `submitted` budget is a revision with the MD, not a first submit. */
    in_revision: boolean;
  } | null;
  /**
   * THE PREREQUISITE GATE (user 2026-09-19): an order is budgeted only once
   * BOTH its Fabric BOM and its Material BOM are saved — `is_draft = false`, the
   * same test `pullCostLines` uses to decide what it will pull. A draft BOM is
   * somebody's half-finished thinking, and a budget built on it would be
   * approved against figures that were never recorded.
   */
  fabric_bom_saved: boolean;
  material_bom_saved: boolean;
  /** Why the order cannot be budgeted yet ("Material BOM not saved"), or null
   *  when both are. The picker prints it; the save action refuses on it. */
  bom_refusal: string | null;
  /** The ORDER's provenance, for the queue's Updated table — the Created
   *  Date / Created User pair every listing carries (AGENTS.md). The order's,
   *  not the budget's: the row is an order, as on the BOM queues. */
  created_at: string;
  created_by: string | null;
};

/** One style of a garment order, as the CMT tab and the header need it. */
export type BudgetableStyle = {
  /** `styleKey`-normalised — trimmed, upper-cased — the order module's key. */
  style_ref_no: string;
  style_description: string | null;
  article_no: string | null;
  /** 'piece' | 'set' (0471), or null when the order never answered. */
  unit_kind: string | null;
  /** Σ `po_qty` over every style line carrying this ref. On a set-pack order
   *  (0467) that is PIECES; on a `unit_kind = 'set'` style of an ordinary
   *  order it is SETS — see `pullCostLines`' CMT branch. */
  order_qty: number;
  /** `qtyBreakdownOf` over this style's approval rows; null + reason when it
   *  refuses (no approval rows, or a rejection rule with a gap). */
  cut_qty: number | null;
  cut_refusal: string | null;
  /** `cut_qty`'s four terms, kept apart — the Budget Statement's Quantity
   *  columns (Order · Excess · Approval · Rej.Allow). Same `qtyBreakdownOf`
   *  call, so the four always add up to `cut_qty`. Null when it refuses. */
  cut_breakup?: { order: number; excess: number; approval: number; rejection: number } | null;
  /** The style's coordinates (0461) — GAR items: PIECES, TOP, BOTTOM. Often
   *  empty. */
  coordinates: { id: string; name: string }[];
};

/** A row of the approval queue (step 6). */
export type BudgetApprovalRow = {
  id: string;
  code: string | null;
  budget_date: string;
  description: string | null;
  status: BudgetStatus;
  order_count: number;
  line_count: number;
  submitted_at: string | null;
  decided_at: string | null;
  decision_remark: string | null;
  created_at: string;
  created_by: string | null;
};

/** A budget offered as a "Copy From" source — enough to label a picker row. */
export type CopyableBudget = {
  id: string;
  code: string | null;
  budget_date: string;
  description: string | null;
  status: BudgetStatus;
  order_count: number;
  line_count: number;
  /** The FIRST order's facts (lowest `sno`). A budget over several orders is
   *  labelled by its first, with `order_count` saying there are more. */
  first_order: {
    re_no: string | null;
    customer_name: string | null;
  } | null;
};

/**
 * The Amendment Protocol form (0576) — who asked, what kind of change, and why.
 * The vocabularies are the engine's (`./amendment`), and 0576's CHECKs state
 * the same values; the reason is mandatory and non-blank, as the column is.
 */
export const budgetReopenInput = z.object({
  source: z.enum(AMENDMENT_SOURCES.map((s) => s.value) as [AmendmentSource, ...AmendmentSource[]], {
    message: "Say who asked for the change",
  }),
  amendment_type: z.enum(AMENDMENT_TYPES.map((t) => t.value) as [AmendmentType, ...AmendmentType[]], {
    message: "Choose what kind of change this is",
  }),
  reason: z.string().trim().min(1, "Say why the budget is being reopened"),
});
export type BudgetReopenInput = z.infer<typeof budgetReopenInput>;
