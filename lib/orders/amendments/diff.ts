import type { SeededAmendmentChildren } from "./order-seed";

/**
 * Orders ▸ Garment Order Amendment — what actually changed.
 *
 * An amendment restates the order (a DOCUMENT model) rather than recording the
 * change to it (a DELTA model — that is `order_amendments` + `order_revisions`,
 * 0006). So the delta has to be COMPUTED: seed the tabs from the order
 * (`seedAmendmentFromOrder`), let the operator edit, then diff the two.
 *
 * Deliberately pure — no `server-only`, no Supabase, no React. It runs on the
 * client to drive a "3 changes" badge beside a tab while the operator types,
 * and on the server to build the approval queue's summary from the same code.
 * One implementation, so the badge and the summary can never disagree.
 *
 * ── Row matching ────────────────────────────────────────────────────────────
 * Rows are matched on a natural key, not on database id, because a seeded row
 * has no id yet and a re-typed row would otherwise read as "removed + added".
 * The key is normalised the way `styleKey` normalises — trim + upper-case —
 * since values are stored in capitals (AGENTS.md "CAPITALS") but rows saved
 * before that rule are not.
 *
 * Where a tab has no natural key at all — a dyeing, a print, a structure are
 * each just a value — the VALUE is the key. Those tabs therefore report only
 * added / removed, never changed, which is the honest reading: changing a
 * colour from Navy to Black is removing Navy and adding Black.
 */

export type ChangeKind = "added" | "removed" | "changed";

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface RowChange {
  kind: ChangeKind;
  /** The matching key, for de-duping and for a stable React key. */
  key: string;
  /** What to call this row in a summary — usually the style ref. */
  label: string;
  /** Empty for added / removed rows; one entry per differing field otherwise. */
  fields: FieldChange[];
}

export interface TabDiff {
  tab: string;
  label: string;
  rows: RowChange[];
}

/** A tab's shape, as far as diffing needs to know it. */
interface TabSpec<T> {
  tab: string;
  label: string;
  /** Natural key. Rows sharing one are matched pairwise in order. */
  key: (r: T) => string;
  /** Human name for the row in a summary line. */
  rowLabel: (r: T) => string;
  /** The fields a "changed" verdict is allowed to rest on. */
  fields: { field: keyof T & string; label: string }[];
}

const norm = (v: unknown): string =>
  typeof v === "string" ? v.trim().toUpperCase() : "";

/** How a value reads in a summary. Never "null", never "undefined". */
export function display(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  return String(v).trim();
}

/**
 * Two values are the same when they READ the same. `null` and `""` are both
 * empty, `"NAVY"` and `"navy "` are one colour, and `0` and `"0"` are one
 * quantity — a seeded row comes off `numeric` columns as a string in some
 * PostgREST responses and as a number in others, and a false "changed" on
 * every single row would make the whole diff useless.
 */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a ?? 0);
    const nb = Number(b ?? 0);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return !!a === !!b;
  return display(a).toUpperCase() === display(b).toUpperCase();
}

/**
 * Bucket rows by key, keeping duplicates in order. Two price rows for the same
 * style and type are legitimate, and collapsing them would hide one of them.
 */
function bucket<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function diffTab<T>(spec: TabSpec<T>, before: T[], after: T[]): TabDiff {
  const b = bucket(before, spec.key);
  const a = bucket(after, spec.key);
  const rows: RowChange[] = [];

  for (const [key, afterRows] of a) {
    const beforeRows = b.get(key) ?? [];
    const n = Math.max(beforeRows.length, afterRows.length);
    for (let i = 0; i < n; i++) {
      const bef = beforeRows[i];
      const aft = afterRows[i];
      if (!bef && aft) {
        rows.push({ kind: "added", key: `${key}#${i}`, label: spec.rowLabel(aft), fields: [] });
        continue;
      }
      if (bef && !aft) {
        rows.push({ kind: "removed", key: `${key}#${i}`, label: spec.rowLabel(bef), fields: [] });
        continue;
      }
      if (!bef || !aft) continue;
      const fields = spec.fields
        .filter((f) => !same(bef[f.field], aft[f.field]))
        .map((f) => ({
          field: f.field,
          label: f.label,
          before: display(bef[f.field]),
          after: display(aft[f.field]),
        }));
      if (fields.length) {
        rows.push({ kind: "changed", key: `${key}#${i}`, label: spec.rowLabel(aft), fields });
      }
    }
  }

  // Keys present before and gone after — the loop above never visits them.
  for (const [key, beforeRows] of b) {
    if (a.has(key)) continue;
    beforeRows.forEach((r, i) =>
      rows.push({ kind: "removed", key: `${key}#${i}`, label: spec.rowLabel(r), fields: [] }),
    );
  }

  return { tab: spec.tab, label: spec.label, rows };
}

// ---- the eight tabs -------------------------------------------------------

type Children = SeededAmendmentChildren;
type StyleRow = Children["styles"][number];
type DyeRow = Children["dyeings"][number];
type PrintRow = Children["prints"][number];
type StructureRow = Children["structures"][number];
type ComboRow = Children["combos"][number];
type PriceRow = Children["priceDetails"][number];
type QtyRow = Children["approvalQtys"][number];
type QuantityRow = Children["quantities"][number];
type PackTypeRow = NonNullable<Children["packTypes"]>[number];
type CountryRow = NonNullable<Children["countrySizes"]>[number];

const styleName = (r: { style_ref_no: string | null }) => r.style_ref_no?.trim() || "(no style)";

const STYLES: TabSpec<StyleRow> = {
  tab: "styles",
  label: "Style(s)",
  key: (r) => norm(r.style_ref_no),
  rowLabel: styleName,
  fields: [
    { field: "style_id", label: "Style" },
    /*
     * BOTH UNIT COLUMNS ARE OFF THE SCREEN AND STILL IN THE DIFF (2026-08-11).
     *
     * They are frozen `uoms` FKs — Plan Unit was withdrawn and Order Unit became
     * PCS/SET read off the style's `unit_kind`, which is DERIVED and so has no
     * column here to compare. The rows are still written (`pickStyle` seeds them
     * from the style's `unit_id`), and a column that is written but not diffed is
     * a change an amendment silently fails to report — so they stay.
     *
     * THE LABELS SAY "STOCK UNIT", NOT "ORDER UNIT". Whatever these two once
     * were, neither is the Order Unit an operator now sees; a diff line reading
     * "Order Unit: nos -> kg" beside a screen showing PCS would describe a field
     * that is not there. `unit_kind` cannot appear here at all — changing it
     * changes the STYLE, which is reported as a Style change on the row above.
     */
    { field: "order_unit_id", label: "Stock Unit (order)" },
    { field: "plan_unit_id", label: "Stock Unit (plan)" },
    { field: "po_qty", label: "PO Qty" },
    { field: "description", label: "Description" },
  ],
};

// A dyeing has no key but its own value, so section+colour IS the key and the
// tab reports only added / removed. `dye_type` rides along in the key for the
// same reason — a different type on the same colour is a different row.
//
// The colour is now the TYPED NAME (0403), normalised like every other text in
// this key — the id stays in the key beside it so a pre-0403 row, whose colour
// lives only in `color_id`, still keys as itself rather than collapsing into
// every other id-only row of the same section.
const DYEINGS: TabSpec<DyeRow> = {
  tab: "dyeings",
  label: "Color/Print — Dyeing",
  key: (r) => `${r.section}|${norm(r.dye_type)}|${norm(r.color_name)}|${r.color_id ?? ""}`,
  rowLabel: (r) => (r.section === "yarn" ? "Yarn dyeing" : "Fabric dyeing"),
  fields: [],
};

const PRINTS: TabSpec<PrintRow> = {
  tab: "prints",
  label: "Color/Print — Prints",
  key: (r) => r.print_id ?? "",
  rowLabel: () => "Print",
  fields: [],
};

const STRUCTURES: TabSpec<StructureRow> = {
  tab: "structures",
  label: "Color/Print — Structures",
  key: (r) => r.structure_id ?? "",
  rowLabel: () => "Structure",
  fields: [],
};

const COMBOS: TabSpec<ComboRow> = {
  tab: "combos",
  label: "Combos",
  key: (r) => `${norm(r.style_ref_no)}|${norm(r.style)}`,
  rowLabel: styleName,
  fields: [{ field: "article_no", label: "Article No" }],
};

// Price type discriminates: one style legitimately carries an FOB and a CMT
// rate, and keying on the style alone would read the second as a change to
// the first.
const PRICES: TabSpec<PriceRow> = {
  tab: "prices",
  label: "Prices",
  key: (r) => `${norm(r.style_ref_no)}|${norm(r.price_type)}`,
  rowLabel: (r) => `${styleName(r)}${r.price_type ? ` (${r.price_type})` : ""}`,
  fields: [
    { field: "unit", label: "Unit" },
    { field: "price", label: "Price" },
    { field: "article_no", label: "Article No" },
  ],
};

const APPROVAL_QTYS: TabSpec<QtyRow> = {
  tab: "approvalQtys",
  label: "Approval Qty",
  key: (r) => norm(r.style_ref_no),
  rowLabel: styleName,
  fields: [{ field: "approval_qty", label: "Approval Qty" }],
};

/**
 * Quantities (0398).
 *
 * KEYED ON ref no + sno, not on ref no alone. Every other tab has at most one
 * row per style, so `styleKey` is a unique key there — this tab exists precisely
 * to SPLIT a style across countries, consignees and dates, so several rows share
 * a ref. Keying on the style alone would make the second row look like an edit
 * of the first, and "Delivery Dt 30/09 → 15/10" would appear on an approval
 * queue for a row nobody touched.
 *
 * The uuid columns are diffed as ids rather than names: `diff.ts` takes no
 * database, and an id that changed IS a change even when the label reads the
 * same. `display` renders a null as "—".
 */
const QUANTITIES: TabSpec<QuantityRow> = {
  tab: "quantities",
  label: "Quantities",
  key: (r) => `${norm(r.style_ref_no)}#${r.sno}`,
  rowLabel: styleName,
  fields: [
    { field: "po_qty", label: "PO Qty" },
    { field: "delivery_date", label: "Delivery Dt" },
    { field: "earlier_shipment_date", label: "Earlier Shipment Dt" },
    { field: "country_id", label: "Country" },
    { field: "consignee_id", label: "Consignee" },
    { field: "assortment_type_id", label: "Assortment Type" },
    { field: "warehouse_id", label: "WareHouse" },
    { field: "discharge_port_id", label: "Discharge Port" },
  ],
};

/**
 * Pack type(s) (0399).
 *
 * NO `fields`, deliberately — this is the third tab where the VALUE IS THE KEY,
 * alongside Dyeings and Prints, and here it is not a simplification but the
 * whole row: there is nothing about a pack method to change except which one it
 * is. So swapping a method reads as one removed and one added, which is the
 * honest summary and the one an approver can act on. Giving it a `fields` entry
 * would need a key to hang it off, and the only candidate is `sno` — a row's
 * POSITION, which changes whenever an earlier row is deleted, so re-ordering
 * the list would report changes nobody made.
 */
const PACK_TYPES: TabSpec<PackTypeRow> = {
  tab: "packTypes",
  label: "Pack type(s)",
  key: (r) => norm(r.pack_type),
  rowLabel: (r) => r.pack_type?.trim() || "(no method)",
  fields: [],
};

const COUNTRY_SIZES: TabSpec<CountryRow> = {
  tab: "countrySizes",
  label: "Country/Sizewise",
  key: (r) => norm(r.style_ref_no),
  rowLabel: styleName,
  fields: [{ field: "countrywise", label: "Countrywise" }],
};

/**
 * The whole amendment, tab by tab. Tabs with nothing changed are KEPT with an
 * empty `rows` array rather than dropped, so a caller can render a stable set
 * of badges without re-listing the tabs itself.
 */
export function diffAmendment(
  before: SeededAmendmentChildren,
  after: SeededAmendmentChildren,
): TabDiff[] {
  return [
    diffTab(STYLES, before.styles, after.styles),
    diffTab(DYEINGS, before.dyeings, after.dyeings),
    diffTab(PRINTS, before.prints, after.prints),
    diffTab(STRUCTURES, before.structures, after.structures),
    diffTab(COMBOS, before.combos, after.combos),
    diffTab(PRICES, before.priceDetails, after.priceDetails),
    diffTab(APPROVAL_QTYS, before.approvalQtys, after.approvalQtys),
    diffTab(QUANTITIES, before.quantities ?? [], after.quantities ?? []),
    diffTab(PACK_TYPES, before.packTypes ?? [], after.packTypes ?? []),
    // The tab was withdrawn from the SCREEN on 2026-08-10; the seed still
    // produces these rows and check-amendment-diff.mts still asserts on them.
    diffTab(COUNTRY_SIZES, before.countrySizes ?? [], after.countrySizes ?? []),
  ];
}

/** How many rows a tab changed — the number for a badge. */
export function changeCount(diff: TabDiff[]): number {
  return diff.reduce((n, t) => n + t.rows.length, 0);
}

/**
 * One line per changed row, for the approval queue and the audit entry.
 * Reads "Prices · TSH-001 (FOB): Price 4.50 → 4.90".
 */
export function summarise(diff: TabDiff[]): string[] {
  const out: string[] = [];
  for (const tab of diff) {
    for (const r of tab.rows) {
      if (r.kind === "added") out.push(`${tab.label} · ${r.label}: added`);
      else if (r.kind === "removed") out.push(`${tab.label} · ${r.label}: removed`);
      else
        out.push(
          `${tab.label} · ${r.label}: ` +
            r.fields.map((f) => `${f.label} ${f.before} → ${f.after}`).join(", "),
        );
    }
  }
  return out;
}
