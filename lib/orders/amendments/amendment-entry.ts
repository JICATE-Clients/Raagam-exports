/**
 * THE AMENDMENT ENTRY's vocabulary — the TypeScript mirror of 0604 / 0616.
 *
 * `doc/order/amedment.md`: an approved order is changed through an Amendment
 * Entry that names WHO asked (origin), WHAT KIND of change (one or more Change
 * Categories) and WHY (remarks). The database freezes the entry's scope — the
 * union of its categories' (table, columns) allowlists — and refuses every
 * write outside it while the RE reads `amending`. This file is what the
 * SCREENS read so that the fields they show as editable are the fields the
 * trigger will accept:
 *
 *  - `AMENDMENT_ENTRY_TYPES` — the six categories offered (the register's
 *    multi-select). The legacy ten from Budget ▸ Reopen stay readable through
 *    `amendmentTypeLabel`, never offered.
 *  - `AMENDMENT_SCOPE_SEED` — 0604's seed, verbatim. `check:amendment-scope`
 *    holds this literal to the migration's, so drift is a build failure and not
 *    a comment. `unionScope` is the SQL union rule, for the screen to preview a
 *    scope before the entry exists.
 *  - `openAreasOf` — which of the Order Entry editor's SECTIONS and header
 *    FIELDS a frozen scope opens. `UnlockScope` (`components/ui/field.tsx`)
 *    reads the resulting set.
 *  - `entryStatusOf` — the register's Status column, derived from the entry's
 *    outcome and its budget's status (there is no status column to drift).
 *  - `marginDelta` — the register's Margin Delta, from the frozen baseline and
 *    the budget's submitted summary. NOTHING HERE COMPUTES A FIGURE: both sides
 *    are `budgetKpis` outputs already stored.
 *
 * Client-safe (no `server-only`): the door sheet, the register and the editor
 * all read it.
 */

import { isRefusal, type Refusal } from "@/lib/orders/budget/totals";
import { kpisFromJson, type BudgetKpis } from "@/lib/orders/budget/amendment";
import type { StatusTone } from "@/lib/ui/tone";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** The six scoped Change Categories (0604). Order = the order they are offered. */
export const AMENDMENT_ENTRY_TYPES = [
  { value: "qty_addition", label: "Quantity Addition", hint: "More pieces of what was sold — quantities, assortment, sizes, and both BOMs follow" },
  { value: "qty_cancellation", label: "Quantity Cancellation", hint: "Fewer pieces — the same axis as an addition" },
  { value: "price_change", label: "Price Change", hint: "Style prices, price details, logistic charges and the money terms" },
  { value: "delivery_date_ext", label: "Delivery Date Extension", hint: "The delivery date, and nothing else" },
  { value: "combo_colour_change", label: "Combo / Color Change", hint: "Colours, prints, structures, combos and the coordinates built on them — and both BOMs, for the new colourway" },
  { value: "bom_revision", label: "BOM Revision", hint: "The Fabric BOM and the Material BOM — not the order itself" },
] as const;
export type AmendmentEntryType = (typeof AMENDMENT_ENTRY_TYPES)[number]["value"];

export const AMENDMENT_ENTRY_TYPE_VALUES: readonly AmendmentEntryType[] = AMENDMENT_ENTRY_TYPES.map(
  (t) => t.value,
);

/** The legacy ten (0576) — readable on rows Budget ▸ Reopen wrote, never offered. */
const LEGACY_TYPE_LABELS: Record<string, string> = {
  quantity: "Quantity",
  colour: "Colour",
  price: "Price",
  sizes: "Sizes",
  delivery_date: "Delivery Date",
  consignee: "Consignee",
  packing: "Packing",
  style: "Style",
  internal_error: "Internal Error",
  other: "Other",
};

export function isAmendmentEntryType(v: string): v is AmendmentEntryType {
  return (AMENDMENT_ENTRY_TYPE_VALUES as readonly string[]).includes(v);
}

/** The operator's word for a type — SQL `order_amendment_type_label`. */
export function amendmentTypeLabel(t: string): string {
  return (
    AMENDMENT_ENTRY_TYPES.find((x) => x.value === t)?.label ??
    LEGACY_TYPE_LABELS[t] ??
    (t.trim() || "an amendment")
  );
}

/** "Quantity Addition + Delivery Date Extension" — SQL `order_amendment_types_label`. */
export function amendmentTypesLabel(types: readonly string[]): string {
  return types.length === 0 ? "an amendment" : types.map(amendmentTypeLabel).join(" + ");
}

/** The spec's origin values, on the order module's own two words. */
export const AMENDMENT_ORIGINS = [
  { value: "customer", label: "By Customer", code: "BY_CUSTOMER" },
  { value: "internal", label: "By Us", code: "BY_US" },
] as const;
export type AmendmentOrigin = (typeof AMENDMENT_ORIGINS)[number]["value"];

export function originLabel(v: string | null | undefined): string {
  return AMENDMENT_ORIGINS.find((o) => o.value === v)?.label ?? "—";
}

// ---------------------------------------------------------------------------
// The scope — the SQL seed, mirrored
// ---------------------------------------------------------------------------

/** One table's verdict inside a frozen scope. `columns` null = whole table. */
export type ScopeEntry = { columns: readonly string[] | null; insert: boolean; delete: boolean };
/** `order_budget_revisions.scope` — `{ table: ScopeEntry }`. */
export type FrozenScope = Readonly<Record<string, ScopeEntry>>;

const whole = (insert = true, del = true): ScopeEntry => ({ columns: null, insert, delete: del });
const cols = (...c: string[]): ScopeEntry => ({ columns: c, insert: false, delete: false });
const all = (tables: readonly string[], entry: ScopeEntry): Record<string, ScopeEntry> =>
  Object.fromEntries(tables.map((t) => [t, entry]));

const FABRIC_BOM_CHILDREN = [
  "order_fabric_bom_dias",
  "order_fabric_bom_lines",
  "order_fabric_bom_manual_entries",
  "order_fabric_bom_manual_combos",
  "order_fabric_bom_manual_components",
  "order_fabric_bom_manual_sizes",
  "order_fabric_bom_process_scope",
  "order_fabric_bom_processes",
  "order_fabric_bom_requirements",
  "order_fabric_bom_yarns",
  "order_fabric_bom_yarn_stages",
  "order_fabric_bom_yd_combinations",
  "order_fabric_bom_yd_combination_colors",
  "order_fabric_bom_yd_repeats",
] as const;
const MATERIAL_BOM_CHILDREN = [
  "material_bom_amendment_items",
  "material_bom_amendment_item_components",
  "material_bom_amendment_item_slices",
  "material_bom_amendment_processes",
  "material_bom_amendment_requirements",
] as const;

/** Both BOMs entire — the parents may be inserted, never deleted. */
const BOTH_BOMS: Record<string, ScopeEntry> = {
  order_fabric_boms: whole(true, false),
  ...all(FABRIC_BOM_CHILDREN, whole()),
  material_bom_amendments: whole(true, false),
  ...all(MATERIAL_BOM_CHILDREN, whole()),
};

const QTY_SCOPE: Record<string, ScopeEntry> = {
  garment_order_amendments: cols("excess_pct", "gross_value"),
  ...all(
    [
      "garment_order_amendment_quantities",
      "garment_order_amendment_assort_lines",
      "garment_order_amendment_assort_line_sizes",
      "garment_order_amendment_approval_qtys",
      "garment_order_amendment_country_sizes",
      "garment_order_amendment_style_sizes",
    ],
    whole(),
  ),
  ...BOTH_BOMS,
};

/**
 * 0604's seed, table for table. `check:amendment-scope` parses the migration
 * and fails the build if this disagrees with it.
 */
export const AMENDMENT_SCOPE_SEED: Readonly<Record<AmendmentEntryType, Readonly<Record<string, ScopeEntry>>>> = {
  delivery_date_ext: {
    garment_order_amendments: cols("delivery_date"),
  },
  price_change: {
    garment_order_amendments: cols(
      "ex_rate", "avg_rate", "gross_value", "currency_code",
      "cd1_pct", "cd1_days", "cd2_pct", "cd2_days", "cd3_pct", "cd3_days",
    ),
    ...all(
      [
        "garment_order_amendment_style_prices",
        "garment_order_amendment_price_details",
        "garment_order_amendment_charges",
      ],
      whole(),
    ),
  },
  combo_colour_change: {
    ...all(
      [
        "garment_order_amendment_combos",
        "garment_order_amendment_combo_structures",
        "garment_order_amendment_combo_components",
        "garment_order_amendment_dyeings",
        "garment_order_amendment_prints",
        "garment_order_amendment_structures",
        "garment_order_amendment_style_coordinates",
        "garment_order_amendment_price_details",
        "garment_order_amendment_approval_qtys",
      ],
      whole(),
    ),
    /* 0618: a new colourway needs a fabric plan — both BOMs follow, as they do
       for a quantity change. Found when AMD/26-27/0001 added a combo, both
       BOMs read Recalculate, and the scope let nobody re-save them. */
    ...BOTH_BOMS,
  },
  bom_revision: BOTH_BOMS,
  qty_addition: QTY_SCOPE,
  qty_cancellation: QTY_SCOPE,
};

/**
 * The union of several categories' scopes — the rule `order_amendment_record`
 * applies when it freezes the entry: a table any type opens whole is open
 * whole, otherwise the columns are the union; insert / delete if any allows.
 * The screen uses it to PREVIEW what a selection will open before the entry
 * exists; the database's own union is what is stored.
 */
export function unionScope(types: readonly string[]): FrozenScope {
  const out: Record<string, { columns: Set<string> | null; insert: boolean; delete: boolean }> = {};
  for (const t of types) {
    if (!isAmendmentEntryType(t)) continue;
    for (const [table, e] of Object.entries(AMENDMENT_SCOPE_SEED[t])) {
      const cur = out[table] ?? { columns: new Set<string>(), insert: false, delete: false };
      if (e.columns === null) cur.columns = null;
      else if (cur.columns) for (const c of e.columns) cur.columns.add(c);
      cur.insert ||= e.insert;
      cur.delete ||= e.delete;
      out[table] = cur;
    }
  }
  return Object.fromEntries(
    Object.entries(out).map(([table, e]) => [
      table,
      { columns: e.columns ? [...e.columns].sort() : null, insert: e.insert, delete: e.delete },
    ]),
  );
}

/** Read a stored `scope` jsonb back, tolerating whatever shape was written. */
export function scopeFromJson(json: unknown): FrozenScope {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const out: Record<string, ScopeEntry> = {};
  for (const [table, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const e = v as Record<string, unknown>;
    out[table] = {
      columns: Array.isArray(e.columns) ? e.columns.filter((c): c is string => typeof c === "string") : null,
      insert: e.insert === true,
      delete: e.delete === true,
    };
  }
  return out;
}

/** Is the table in the scope at all (any column, any op)? */
export function scopeOpensTable(scope: FrozenScope, table: string): boolean {
  return table in scope;
}

/**
 * May a save DELETE-AND-REINSERT this table? Order Entry, the Fabric BOM and
 * the Material BOM all write their child grids that way, so a grid the scope
 * opens for UPDATE only cannot be saved by them at all — it has to be skipped.
 */
export function scopeAllowsRewrite(scope: FrozenScope, table: string): boolean {
  const e = scope[table];
  return !!e && e.insert && e.delete;
}

/** Does the scope open a named column of the order header? */
export function scopeOpensColumn(scope: FrozenScope, table: string, column: string): boolean {
  const e = scope[table];
  if (!e) return false;
  return e.columns === null || e.columns.includes(column);
}

// ---------------------------------------------------------------------------
// The three editors' AREAS
// ---------------------------------------------------------------------------

/** Which document a write action is about — the argument to `assertOrderWritable`. */
export type AmendmentArea = "order" | "fabric_bom" | "material_bom";

const AREA_PARENT: Record<AmendmentArea, string> = {
  order: "garment_order_amendments",
  fabric_bom: "order_fabric_boms",
  material_bom: "material_bom_amendments",
};

export const AREA_LABEL: Record<AmendmentArea, string> = {
  order: "Order Entry",
  fabric_bom: "the Fabric BOM",
  material_bom: "the Material BOM",
};

/**
 * Is any of the area's tables open? For the BOMs that is the parent (a BOM is
 * opened whole or not at all); for the order it is the header OR any child
 * grid, since a Combo / Color Change opens grids and not the header.
 */
export function areaOpen(scope: FrozenScope, area: AmendmentArea): boolean {
  if (area !== "order") return scopeOpensTable(scope, AREA_PARENT[area]);
  return Object.keys(scope).some((t) => t.startsWith("garment_order_amendment"));
}

/**
 * The refusal an editor shows on an area the entry does not open — the same
 * shape as the trigger's own sentence, at the grain the screen can name.
 */
export function outOfScopeMessage(v: { entryNo: string | null; types: readonly string[] }, area: AmendmentArea): string {
  const no = (v.entryNo ?? "").trim() || "open";
  return `This amendment (${no}) is a ${amendmentTypesLabel(v.types)} — ${AREA_LABEL[area]} is not open to it. Close it and raise the right kind of amendment.`;
}

/** An order under an open Amendment Entry — what the editors read (0616). */
export type OrderAmendmentState = {
  entryId: string;
  entryNo: string | null;
  types: string[];
  scope: FrozenScope;
  /** The banner on an editor the entry opens. */
  banner: string;
};

/** The banner on an editor the entry DOES open. */
export function amendmentBanner(v: { entryNo: string | null; types: readonly string[]; scope: FrozenScope }): string {
  const no = (v.entryNo ?? "").trim() || "open";
  const opened = openAreasOf(v.scope);
  const only =
    opened.length === 1 && opened[0] === "delivery_date"
      ? " Only the delivery date can be changed."
      : opened.includes("orderinfo")
        ? ""
        : ` Only ${describeOpenAreas(opened)} can be changed here.`;
  return `Amendment ${no} is open — ${amendmentTypesLabel(v.types)}.${only} Everything else stays as approved.`;
}

// ---------------------------------------------------------------------------
// The Order Entry editor: sections and header fields
// ---------------------------------------------------------------------------

/**
 * Which tables each SECTION of the Order Entry editor writes. A section is open
 * when every one of its tables can be rewritten (its grids save by
 * delete-and-reinsert). Keys are the rail's own section keys.
 */
export const ORDER_SECTION_TABLES: Readonly<Record<string, readonly string[]>> = {
  styles: [
    "garment_order_amendment_styles",
    "garment_order_amendment_style_sizes",
    "garment_order_amendment_style_components",
    "garment_order_amendment_style_coordinates",
    "garment_order_amendment_style_processes",
    "garment_order_amendment_pack_components",
  ],
  colors: [
    "garment_order_amendment_dyeings",
    "garment_order_amendment_prints",
    "garment_order_amendment_structures",
  ],
  combos: [
    "garment_order_amendment_combos",
    "garment_order_amendment_combo_structures",
    "garment_order_amendment_combo_components",
  ],
  packtypes: ["garment_order_amendment_pack_types", "garment_order_amendment_pack_type_lines"],
  prices: ["garment_order_amendment_price_details"],
  quantities: [
    "garment_order_amendment_quantities",
    "garment_order_amendment_assort_lines",
    "garment_order_amendment_assort_line_sizes",
    "garment_order_amendment_country_sizes",
  ],
  approvalqty: ["garment_order_amendment_approval_qtys"],
};

/**
 * Header COLUMNS that have a field of their own on the editor, and the
 * `UnlockScope` area that field is wrapped in. A category that opens only some
 * header columns (Delivery Date Extension, the money terms) opens these areas
 * and NOT the whole Order Info section.
 */
export const ORDER_HEADER_FIELD_AREAS: Readonly<Record<string, string>> = {
  delivery_date: "delivery_date",
  excess_pct: "excess_pct",
  currency_code: "money_terms",
  ex_rate: "money_terms",
};

const AREA_WORDS: Record<string, string> = {
  orderinfo: "Order Info",
  styles: "Style(s)",
  colors: "Colour / Print Details",
  combos: "Combos",
  packtypes: "Pack type(s)",
  prices: "Prices",
  quantities: "Quantities",
  approvalqty: "Approval Qty",
  delivery_date: "the delivery date",
  excess_pct: "the excess %",
  money_terms: "the currency and ex-rate",
};

function describeOpenAreas(areas: readonly string[]): string {
  const words = areas.map((a) => AREA_WORDS[a] ?? a);
  if (words.length <= 1) return words[0] ?? "nothing";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The `UnlockScope` areas a frozen scope opens on the Order Entry editor —
 * section keys, plus header field areas. Empty outside an amendment.
 *
 * `orderinfo` opens only when the header is open WHOLE (`columns: null`);
 * otherwise each opened header column contributes its field's area, so a
 * Delivery Date Extension yields exactly `["delivery_date"]`.
 */
export function openAreasOf(scope: FrozenScope): string[] {
  const out: string[] = [];
  const header = scope.garment_order_amendments;
  if (header) {
    if (header.columns === null) out.push("orderinfo", ...new Set(Object.values(ORDER_HEADER_FIELD_AREAS)));
    else {
      for (const c of header.columns) {
        const a = ORDER_HEADER_FIELD_AREAS[c];
        if (a && !out.includes(a)) out.push(a);
      }
    }
  }
  for (const [section, tables] of Object.entries(ORDER_SECTION_TABLES)) {
    if (tables.every((t) => scopeAllowsRewrite(scope, t))) out.push(section);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The register: status and margin delta
// ---------------------------------------------------------------------------

/** The register's Status — derived, never stored. */
export type AmendmentEntryStatus =
  | "draft" // open; the revised budget is being worked on
  | "pending_approval" // open; the revised budget is with the approver
  | "rejected" // open; the approver sent it back
  | "approved" // closed: re-approved
  | "abandoned" // closed: abandoned
  | "superseded"; // closed: a later entry on the same order took over (0618)

export function entryStatusOf(v: {
  outcome: string;
  budgetStatus: string | null | undefined;
}): AmendmentEntryStatus {
  if (v.outcome === "reapproved") return "approved";
  if (v.outcome === "abandoned") return "abandoned";
  if (v.outcome === "superseded") return "superseded";
  switch (v.budgetStatus) {
    case "submitted":
      return "pending_approval";
    case "rejected":
      return "rejected";
    default:
      return "draft";
  }
}

export function entryStatusLabel(s: AmendmentEntryStatus): string {
  switch (s) {
    case "draft":
      return "Draft";
    case "pending_approval":
      return "Pending approval";
    case "rejected":
      return "Rejected";
    case "approved":
      return "Approved";
    case "superseded":
      return "Superseded";
    default:
      return "Abandoned";
  }
}

export function entryStatusTone(s: AmendmentEntryStatus): StatusTone {
  switch (s) {
    case "approved":
      return "success";
    case "pending_approval":
      return "warning";
    case "rejected":
      return "danger";
    case "abandoned":
    case "superseded":
      return "neutral";
    default:
      return "info";
  }
}

/** The spec's filter vocabulary → the derived statuses it means. */
export const ENTRY_STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open (draft / rejected)" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "abandoned", label: "Abandoned" },
  { value: "superseded", label: "Superseded" },
] as const;

export function entryStatusMatches(filter: string, s: AmendmentEntryStatus): boolean {
  if (!filter) return true;
  if (filter === "open") return s === "draft" || s === "rejected";
  return filter === s;
}

/**
 * Amended margin % − original margin %, in percentage points. Both sides are
 * stored `budgetKpis` (the entry's frozen baseline, the budget's submitted
 * summary); a side that refused, or is not there yet, refuses — a delta
 * against an unknown is not a delta.
 */
export type MarginDelta = {
  original: number | Refusal;
  amended: number | Refusal;
  delta: number | Refusal;
};

export function marginDelta(v: { baselineKpis: unknown; submittedKpis: unknown }): MarginDelta {
  const base = kpisFromJson(v.baselineKpis);
  const now = kpisFromJson(v.submittedKpis);
  const original: number | Refusal = base ? base.profit_pct : { refused: "No approved baseline recorded" };
  const amended: number | Refusal = now
    ? now.profit_pct
    : { refused: "Not yet submitted — send the revised budget for approval" };
  const delta: number | Refusal = isRefusal(original)
    ? { refused: `Original margin unknown — ${original.refused}` }
    : isRefusal(amended)
      ? { refused: amended.refused }
      : Math.round((amended - original) * 100) / 100;
  return { original, amended, delta };
}

/** A margin drop is the case the MD gate exists for (spec §5). */
export function marginAlert(d: MarginDelta): "drop" | "rise" | "flat" | "unknown" {
  if (isRefusal(d.delta)) return "unknown";
  if (d.delta < 0) return "drop";
  if (d.delta > 0) return "rise";
  return "flat";
}

export type { BudgetKpis };
