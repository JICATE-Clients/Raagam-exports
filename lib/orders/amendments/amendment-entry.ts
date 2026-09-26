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

/**
 * THE KINDS (0604 · 0619). Five are Order Entry's detail — what is changing on
 * the order itself; three name a whole MODULE. `bom_revision` (both BOMs at
 * once) is the pre-0619 kind: still readable and still seeded, no longer
 * offered — the two BOMs are now picked separately (spec §2).
 */
export const AMENDMENT_ENTRY_TYPES = [
  { value: "qty_addition", label: "Quantity Addition", hint: "More pieces of what was sold — quantities, assortment and sizes; both BOMs' figures recalculate" },
  { value: "qty_cancellation", label: "Quantity Cancellation", hint: "Fewer pieces — the same axis as an addition" },
  { value: "price_change", label: "Price Change", hint: "FOB prices, price details, logistic charges and the money terms" },
  { value: "delivery_date_ext", label: "Delivery Date Extension", hint: "The delivery date, and nothing else" },
  { value: "combo_colour_change", label: "Combo / Color Change", hint: "Colours, prints, structures and combos; both BOMs' figures recalculate" },
  { value: "fabric_bom_revision", label: "Fabric BOM", hint: "Yarn structure, process loss, fabric allocations" },
  { value: "material_bom_revision", label: "Material BOM", hint: "Trims, accessories, packaging items" },
  { value: "budget_revision", label: "Order Budget", hint: "Overheads, freight, operational rates" },
  { value: "bom_revision", label: "BOM Revision", hint: "Both BOMs (raised before the modules were picked separately)" },
] as const;
export type AmendmentEntryType = (typeof AMENDMENT_ENTRY_TYPES)[number]["value"];

export const AMENDMENT_ENTRY_TYPE_VALUES: readonly AmendmentEntryType[] = AMENDMENT_ENTRY_TYPES.map(
  (t) => t.value,
);

/** Order Entry's detail — the five kinds that change the order itself. */
export const ORDER_CHANGE_KINDS = [
  "qty_addition",
  "qty_cancellation",
  "price_change",
  "delivery_date_ext",
  "combo_colour_change",
] as const satisfies readonly AmendmentEntryType[];
export type OrderChangeKind = (typeof ORDER_CHANGE_KINDS)[number];

// ---------------------------------------------------------------------------
// The four MODULE categories (spec §2)
// ---------------------------------------------------------------------------

export type AmendmentModule = "order_entry" | "material_bom" | "fabric_bom" | "order_budget";

/**
 * The spec's four checkboxes, in the spec's order, with its own descriptions.
 * Order Entry is picked through its KINDS (at least one is required when it is
 * ticked); each other module IS one kind. "Selecting Order Entry and Fabric
 * BOM keeps Material BOM read-only" is `unionScope` over those kinds.
 */
export const AMENDMENT_MODULES: readonly {
  key: AmendmentModule;
  label: string;
  hint: string;
  /** The kind that IS this module; null for Order Entry, which is picked by kind. */
  kind: AmendmentEntryType | null;
}[] = [
  { key: "order_entry", label: "Order Entry", hint: "PO Qty, Delivery Date, FOB Price, Color Combos", kind: null },
  { key: "material_bom", label: "Material BOM", hint: "Trims, Accessories, Packaging Items", kind: "material_bom_revision" },
  { key: "fabric_bom", label: "Fabric BOM", hint: "Yarn Structure, Process Loss, Fabric Allocations", kind: "fabric_bom_revision" },
  { key: "order_budget", label: "Order Budget", hint: "Overheads, Freight, Operational Rates", kind: "budget_revision" },
];

/**
 * WHAT CHANGES INSIDE EACH OTHER MODULE (client 2026-09-24, screenshot 3051:
 * Order Entry listed its detail, the other three did not). The three words
 * each module's hint already printed, now ticked the same way Order Entry's
 * kinds are.
 *
 * A RECORD, NOT A LOCK. Since 0627 a picked module opens WHOLE, so these
 * never narrow the scope — they say what the revision touches, for the
 * register, the revision page and the MD's sheet. Which is also why they are
 * not kinds: a kind carries seeded scope rows (0604), and these must not.
 * Stored as `<module>.<detail>` in `order_budget_revisions.module_details`
 * (0630).
 */
export type DetailModule = "material_bom" | "fabric_bom" | "order_budget";
export const MODULE_DETAILS: Readonly<Record<DetailModule, readonly { value: string; label: string }[]>> = {
  material_bom: [
    { value: "material_bom.trims", label: "Trims" },
    { value: "material_bom.accessories", label: "Accessories" },
    { value: "material_bom.packaging", label: "Packaging Items" },
  ],
  fabric_bom: [
    { value: "fabric_bom.yarn_structure", label: "Yarn Structure" },
    { value: "fabric_bom.process_loss", label: "Process Loss" },
    { value: "fabric_bom.fabric_allocation", label: "Fabric Allocations" },
  ],
  order_budget: [
    { value: "order_budget.overheads", label: "Overheads" },
    { value: "order_budget.freight", label: "Freight" },
    { value: "order_budget.operational_rates", label: "Operational Rates" },
  ],
};
export const MODULE_DETAIL_VALUES: readonly string[] = Object.values(MODULE_DETAILS).flatMap((d) => d.map((x) => x.value));
const DETAIL_LABEL = new Map(Object.values(MODULE_DETAILS).flatMap((d) => d.map((x) => [x.value, x.label] as const)));

/** The kinds a raise may name (the register offers these; `bom_revision` is legacy). */
export const OFFERED_KINDS: readonly AmendmentEntryType[] = [
  ...ORDER_CHANGE_KINDS,
  "material_bom_revision",
  "fabric_bom_revision",
  "budget_revision",
];

const LEGACY_ORDER_KINDS = new Set([
  "quantity", "colour", "price", "sizes", "delivery_date", "consignee", "packing", "style",
]);

/** Which modules an entry's kinds open — derived, never stored (0619). */
export function modulesOf(types: readonly string[]): AmendmentModule[] {
  const out = new Set<AmendmentModule>();
  for (const t of types) {
    if ((ORDER_CHANGE_KINDS as readonly string[]).includes(t) || LEGACY_ORDER_KINDS.has(t)) out.add("order_entry");
    else if (t === "fabric_bom_revision") out.add("fabric_bom");
    else if (t === "material_bom_revision") out.add("material_bom");
    else if (t === "budget_revision") out.add("order_budget");
    else if (t === "bom_revision") {
      out.add("fabric_bom");
      out.add("material_bom");
    }
  }
  return AMENDMENT_MODULES.map((m) => m.key).filter((k) => out.has(k));
}

export function moduleLabel(m: AmendmentModule): string {
  return AMENDMENT_MODULES.find((x) => x.key === m)?.label ?? m;
}

/** "Order Entry (Quantity Addition) + Fabric BOM" — the register's Change Type. */
export function entryScopeLabel(types: readonly string[], details: readonly string[] = []): string {
  const kinds = types.filter((t) => (ORDER_CHANGE_KINDS as readonly string[]).includes(t) || LEGACY_ORDER_KINDS.has(t));
  /* Each module's ticked detail in brackets, as Order Entry's kinds are — an
     entry raised before 0630 has none and reads exactly as it did. */
  const detailOf = (m: AmendmentModule) =>
    details.filter((d) => d.startsWith(`${m}.`)).map((d) => DETAIL_LABEL.get(d) ?? d);
  return modulesOf(types)
    .map((m) => {
      if (m === "order_entry") return kinds.length ? `Order Entry (${kinds.map(amendmentTypeLabel).join(", ")})` : moduleLabel(m);
      const d = detailOf(m);
      return d.length ? `${moduleLabel(m)} (${d.join(", ")})` : moduleLabel(m);
    })
    .join(" + ") || amendmentTypesLabel(types);
}

/**
 * Do the order kinds picked move quantities or colourways — the case where
 * the BOMs' figures must be recalculated even when the BOM itself is not
 * picked (spec §3.1)?
 */
export function kindsMoveBoms(types: readonly string[]): boolean {
  return types.some((t) => t === "qty_addition" || t === "qty_cancellation" || t === "combo_colour_change");
}

/**
 * A raise's module/kind selection, validated the way the door explains it.
 * Null = fine.
 */
export function moduleSelectionProblem(v: {
  modules: readonly AmendmentModule[];
  orderKinds: readonly string[];
  /** The other modules' ticked detail (0630). Omitted = not checked (a caller
   *  re-validating an entry raised before the detail existed). */
  details?: readonly string[];
}): string | null {
  if (v.modules.length === 0) return "Pick at least one module to revise";
  if (v.modules.includes("order_entry") && v.orderKinds.length === 0) {
    return "Say what changes on the order — PO Qty, Delivery Date, FOB Price or Color Combos";
  }
  return v.details ? moduleDetailProblem(v.modules, v.details) : null;
}

/** The same rule as Order Entry's kinds, for each other module: ticked means
 *  say what inside it (0630). Pass only the modules THIS raise picks — one an
 *  open entry already carries brought its detail with it. */
export function moduleDetailProblem(modules: readonly AmendmentModule[], details: readonly string[]): string | null {
  for (const m of Object.keys(MODULE_DETAILS) as DetailModule[]) {
    if (modules.includes(m) && !details.some((d) => d.startsWith(`${m}.`))) {
      return `Say what changes in the ${moduleLabel(m)} — ${MODULE_DETAILS[m].map((x) => x.label).join(", ")}`;
    }
  }
  return null;
}

/** The kinds a raise sends: Order Entry's detail, then each other module's own kind. */
export function kindsForSelection(v: { modules: readonly AmendmentModule[]; orderKinds: readonly OrderChangeKind[] }): AmendmentEntryType[] {
  const out: AmendmentEntryType[] = [];
  if (v.modules.includes("order_entry")) out.push(...v.orderKinds);
  for (const m of AMENDMENT_MODULES) {
    if (m.kind && v.modules.includes(m.key)) out.push(m.kind);
  }
  return out;
}

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

/** Each BOM entire — the parents may be inserted, never deleted. */
const FABRIC_BOM: Record<string, ScopeEntry> = {
  order_fabric_boms: whole(true, false),
  ...all(FABRIC_BOM_CHILDREN, whole()),
};
const MATERIAL_BOM: Record<string, ScopeEntry> = {
  material_bom_amendments: whole(true, false),
  ...all(MATERIAL_BOM_CHILDREN, whole()),
};
const BOTH_BOMS: Record<string, ScopeEntry> = { ...FABRIC_BOM, ...MATERIAL_BOM };

/**
 * THE ROWS A RECALCULATION WRITES (0619) — and nothing else of either BOM.
 * A quantity or colourway change moves both BOMs' figures, so the BOMs'
 * DERIVED rows open even when neither BOM is picked; their authored rows stay
 * as approved (spec §2: "selecting Order Entry and Fabric BOM keeps Material
 * BOM read-only"). `lib/orders/*\/recalc` writes exactly these.
 */
export const BOM_DERIVED_SCOPE: Readonly<Record<string, ScopeEntry>> = {
  order_fabric_boms: cols("computed_at", "computed_for_qty", "computed_basis_hash"),
  order_fabric_bom_requirements: whole(),
  order_fabric_bom_yarns: cols("purchase_qty", "uom_id", "refusal_reason"),
  order_fabric_bom_yarn_stages: cols("process_qty", "uom_id", "refusal_reason"),
  material_bom_amendments: cols("computed_at", "computed_for_qty", "computed_basis_hash"),
  material_bom_amendment_requirements: whole(),
};

/** The budget's marker (0619): read by the budget action and screen, never by the trigger. */
export const BUDGET_MARKER_TABLE = "order_budget_lines";

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
  /* 0619: the BOMs' derived rows only — see BOM_DERIVED_SCOPE. */
  ...BOM_DERIVED_SCOPE,
};

/**
 * The seed, table for table — 0604, corrected by 0618 and re-cut by module in
 * 0619. `check:amendment-scope` parses the migration
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
    /* 0618 opened both BOMs whole here (a combo add made them stale and the
       scope let nobody re-save them). 0619 keeps the fix and narrows it: the
       recalculation re-saves their DERIVED rows, so only those open; the
       authored rows open when the BOM module itself is picked. */
    ...BOM_DERIVED_SCOPE,
  },
  fabric_bom_revision: FABRIC_BOM,
  material_bom_revision: MATERIAL_BOM,
  budget_revision: { [BUDGET_MARKER_TABLE]: whole() },
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

/**
 * OPEN UNDER EVERY AMENDMENT, WHATEVER ITS CATEGORIES (0622, user 2026-09-23:
 * "file field only allowing 1 file only why?" — HO/RE/26-27/0001 amending under
 * a Combo/Color Change + Quantity Addition, the revised sketch refused).
 *
 * A document DOCUMENTS the order; it does not move the margin the lock
 * protects. 0604 closed attachments to every type "until the first client
 * report of 'I cannot attach the revised sketch'" — this is that report.
 *
 * NOT A SEED ROW, deliberately. A scope is FROZEN on the entry when it is
 * raised, so adding the table to each category's seed would open it only on
 * entries raised from now on — the entry that prompted the report would stay
 * shut. So it is merged at READ time, on both sides: `order_amendment_of()`
 * adds `order_amendment_always_open()` to the frozen scope it hands the
 * trigger, and `scopeFromJson` adds this. `check:amendment-scope` holds the
 * two literals together. It never appears in `unionScope` / the seed, which
 * mirror what is STORED.
 *
 * Only while amending: an approved order with no open entry is refused by
 * 0576's lock before any scope is read, exactly as before.
 */
export const ALWAYS_OPEN_WHILE_AMENDING: FrozenScope = {
  garment_order_amendment_files: whole(),
};

/**
 * A PICKED MODULE OPENS WHOLE (0627, client 2026-09-24: "click back into any
 * chosen module … to edit and re-save freely"). The MODULE is the lock
 * boundary, not the kind: an entry whose stored scope names ANY Order Entry
 * table reads the whole order document open — every header column, every
 * child grid — and the kinds stay on the entry only as what the MD is told
 * changed. Laid over the stored scope at READ time, like the files overlay
 * above, so every open entry widens at once and the seed is untouched.
 * `order_amendment_order_entry_whole()` is the SQL twin; check:amendment-scope
 * holds the two literals together.
 */
export const ORDER_ENTRY_WHOLE: FrozenScope = {
  garment_order_amendments: { columns: null, insert: false, delete: false },
  ...all(
    [
      "garment_order_amendment_approval_qtys",
      "garment_order_amendment_assort_line_sizes",
      "garment_order_amendment_assort_lines",
      "garment_order_amendment_charges",
      "garment_order_amendment_combo_components",
      "garment_order_amendment_combo_structures",
      "garment_order_amendment_combos",
      "garment_order_amendment_country_sizes",
      "garment_order_amendment_dyeings",
      "garment_order_amendment_files",
      "garment_order_amendment_pack_components",
      "garment_order_amendment_pack_type_lines",
      "garment_order_amendment_pack_types",
      "garment_order_amendment_price_details",
      "garment_order_amendment_prints",
      "garment_order_amendment_quantities",
      "garment_order_amendment_structures",
      "garment_order_amendment_style_components",
      "garment_order_amendment_style_coordinates",
      "garment_order_amendment_style_prices",
      "garment_order_amendment_style_processes",
      "garment_order_amendment_style_sizes",
      "garment_order_amendment_styles",
    ],
    whole(),
  ),
};

/** The order's colour / print tables, open whenever the Fabric BOM is picked —
 *  its Colour/Print tab writes them (`writePalette`, 0627). SQL twin:
 *  `order_amendment_fabric_bom_palette()`. */
export const FABRIC_BOM_PALETTE: FrozenScope = {
  garment_order_amendment_dyeings: whole(),
  garment_order_amendment_prints: whole(),
};

/** Does this STORED scope pick Order Entry — any Order Entry table at all? */
export function touchesOrderEntry(stored: FrozenScope): boolean {
  return Object.keys(stored).some((t) => t.startsWith("garment_order_amendment"));
}

/** Read a stored `scope` jsonb back, tolerating whatever shape was written —
 *  with the module widenings (0627) and `ALWAYS_OPEN_WHILE_AMENDING` laid over
 *  it, in the order the trigger's `order_amendment_of` lays them. */
export function scopeFromJson(json: unknown): FrozenScope {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ...ALWAYS_OPEN_WHILE_AMENDING };
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
  /* Laid OVER the stored scope (jsonb `||` in SQL: the right side wins), so a
     stored entry naming the files table narrower cannot narrow it back. The
     module widenings are tested against the STORED scope, before the files
     overlay, so the files table alone never counts as picking Order Entry. */
  return {
    ...out,
    ...(touchesOrderEntry(out) ? ORDER_ENTRY_WHOLE : {}),
    ...(out.order_fabric_boms && out.order_fabric_boms.columns === null ? FABRIC_BOM_PALETTE : {}),
    ...ALWAYS_OPEN_WHILE_AMENDING,
  };
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
export type AmendmentArea = "order" | "fabric_bom" | "material_bom" | "budget";

const AREA_PARENT: Record<AmendmentArea, string> = {
  order: "garment_order_amendments",
  fabric_bom: "order_fabric_boms",
  material_bom: "material_bom_amendments",
  budget: BUDGET_MARKER_TABLE,
};

export const AREA_LABEL: Record<AmendmentArea, string> = {
  order: "Order Entry",
  fabric_bom: "the Fabric BOM",
  material_bom: "the Material BOM",
  budget: "the Order Budget",
};

/**
 * Is the area open FOR EDITING — its authored rows, the operator's own? For a
 * BOM that is the parent opened WHOLE (0619: a quantity change opens only the
 * parent's computed stamp, which is a recalculation's, not an edit); for the
 * order it is the header OR any child grid, since a Combo / Color Change opens
 * grids and not the header; for the budget it is its marker (0619).
 */
export function areaOpen(scope: FrozenScope, area: AmendmentArea): boolean {
  if (area === "order") return Object.keys(scope).some((t) => t.startsWith("garment_order_amendment"));
  const e = scope[AREA_PARENT[area]];
  if (!e) return false;
  return area === "budget" ? true : e.columns === null;
}

/**
 * May a RECALCULATION write this BOM's derived rows? True when the BOM is open
 * whole, or when the entry opened its derived rows (a quantity or colourway
 * change, 0619). Never true for the order or the budget.
 */
export function areaRecalculable(scope: FrozenScope, area: "fabric_bom" | "material_bom"): boolean {
  if (areaOpen(scope, area)) return true;
  const req = area === "fabric_bom" ? "order_fabric_bom_requirements" : "material_bom_amendment_requirements";
  return scopeAllowsRewrite(scope, req) && scopeOpensColumn(scope, AREA_PARENT[area], "computed_basis_hash");
}

/**
 * The refusal an editor shows on an area the entry does not open — the same
 * shape as the trigger's own sentence, at the grain the screen can name.
 */
export function outOfScopeMessage(v: { entryNo: string | null; types: readonly string[] }, area: AmendmentArea): string {
  const no = (v.entryNo ?? "").trim() || "open";
  return `This revision (${no}) covers ${amendmentTypesLabel(v.types)} — ${AREA_LABEL[area]} is not open to it. Use + Add module on the revision to open it.`;
}

/** An order under an open Amendment Entry — what the editors read (0616). */
export type OrderAmendmentState = {
  entryId: string;
  entryNo: string | null;
  types: string[];
  scope: FrozenScope;
  /** The revised budget is with the MD (0619) — "Pending MD Approval" rather than "Waiting Amendment". */
  pendingMd?: boolean;
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
  return `Revision ${no} is open — ${amendmentTypesLabel(v.types)}.${only} Everything else stays as approved.`;
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
  /* Not a rail section — the Files cell of each style line, wrapped in
     `<UnlockScope area="files">`. Open under every entry (0622,
     `ALWAYS_OPEN_WHILE_AMENDING`), so `openAreasOf` of any stored scope lists it. */
  files: ["garment_order_amendment_files"],
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
  files: "the attached files",
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
    /* The WHOLE header open means the whole document is (0627), T&A included —
       its tables are never locked (UNLOCKED_CHILD_TABLES), only its rail
       section was, for want of anything that opened it. */
    if (header.columns === null) out.push("orderinfo", "ta", ...new Set(Object.values(ORDER_HEADER_FIELD_AREAS)));
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

/**
 * The register's Status — derived, never stored (spec §4A: DRAFT ·
 * PENDING_MD_APPROVAL · APPROVED · REJECTED, plus the two ways an entry closes
 * without a decision).
 *
 * REJECTED is a CLOSED outcome since 0619 — the MD's reject reverted the order,
 * both BOMs and the budget to V0. `returned` is the one open state a reject
 * can still leave: an entry raised before 0619 (no budget snapshot) or a
 * revert that could not complete — the order stays open for a revision.
 */
export type AmendmentEntryStatus =
  | "draft" // open; being worked on by the merchandiser
  | "pending_md_approval" // open; the revised budget is with the MD
  | "approved" // closed: authorized — the amended baseline is the new version
  | "rejected" // closed: denied — reverted to the previous approved version
  | "returned" // open: rejected but NOT reverted (pre-0619 entry, or the revert failed)
  | "abandoned" // closed: abandoned by the merchandiser — reverted
  | "superseded"; // closed: a later entry on the same order took over (0618)

export function entryStatusOf(v: {
  outcome: string;
  budgetStatus: string | null | undefined;
}): AmendmentEntryStatus {
  if (v.outcome === "reapproved") return "approved";
  if (v.outcome === "rejected") return "rejected";
  if (v.outcome === "abandoned") return "abandoned";
  if (v.outcome === "superseded") return "superseded";
  switch (v.budgetStatus) {
    case "submitted":
      return "pending_md_approval";
    case "rejected":
      return "returned";
    default:
      return "draft";
  }
}

/** The spec's own codes, for the register's badge and the push payload. */
export function entryStatusCode(s: AmendmentEntryStatus): string {
  switch (s) {
    case "pending_md_approval":
      return "PENDING_MD_APPROVAL";
    default:
      return s.toUpperCase();
  }
}

export function entryStatusLabel(s: AmendmentEntryStatus): string {
  switch (s) {
    case "draft":
      return "Draft";
    case "pending_md_approval":
      return "Pending MD Approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "returned":
      return "Rejected — revise";
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
    case "pending_md_approval":
      return "warning";
    case "rejected":
    case "returned":
      return "danger";
    case "abandoned":
    case "superseded":
      return "neutral";
    default:
      return "info";
  }
}

/** Is the entry still open — being worked on, with the MD, or returned? */
export function entryIsOpen(s: AmendmentEntryStatus): boolean {
  return s === "draft" || s === "pending_md_approval" || s === "returned";
}

/** The spec's filter vocabulary → the derived statuses it means. */
export const ENTRY_STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending_md_approval", label: "Pending MD Approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "abandoned", label: "Abandoned" },
  { value: "superseded", label: "Superseded" },
] as const;

export function entryStatusMatches(filter: string, s: AmendmentEntryStatus): boolean {
  if (!filter) return true;
  if (filter === "draft") return s === "draft" || s === "returned";
  if (filter === "rejected") return s === "rejected" || s === "returned";
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
