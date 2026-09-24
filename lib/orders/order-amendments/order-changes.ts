import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";
import { diffAmendment, display } from "@/lib/orders/amendments/diff";
import type { SeededAmendmentChildren } from "@/lib/orders/amendments/order-seed";

/**
 * "WHAT CHANGED IN ORDER DETAILS" (client 2026-09-24) — the order a revision
 * was raised on, field by field, as it stood at raise vs as it stands now.
 *
 * BEFORE is `order_budget_revisions.order_snapshot` (0619): the raw rows of
 * every Order Entry table, frozen at raise for the revert. AFTER is the same
 * tables read live. BOTH go through ONE mapper (`seedOf`) into the shape
 * `diffAmendment` reads, so the two sides cannot be shaped differently — a
 * mis-shaped side would report every row as changed. The diff itself is the
 * existing pure engine (lib/orders/amendments/diff.ts), not a second one.
 *
 * NO PER-FIELD COST. The spec's "Cost Delta" column assumes a field has a
 * cost; an order field does not — a GSM or a quantity moves cost only through
 * the BOMs and the budget, which the comparison table above this log already
 * breaks down by head. Printing a number here would be an invention.
 */

export type OrderFieldChange = {
  section: string;
  row: string;
  field: string;
  before: string;
  after: string;
};

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | undefined>;

const T = (s: string) => `garment_order_amendment_${s}`;

/** The header fields an approver reads as the order's terms. Ids are left out:
 *  a uuid is not something to put in front of anyone (AGENTS.md "Created User"). */
const HEADER_FIELDS: { field: string; label: string; date?: boolean }[] = [
  { field: "po_no", label: "PO No" },
  { field: "po_date", label: "PO Date", date: true },
  { field: "delivery_date", label: "Delivery Date", date: true },
  { field: "season", label: "Season" },
  { field: "ship_mode", label: "Ship Mode" },
  { field: "currency_code", label: "Currency" },
  { field: "ex_rate", label: "Ex-Rate" },
  { field: "avg_rate", label: "Avg Rate" },
  { field: "gross_value", label: "Gross Value" },
  { field: "excess_pct", label: "Excess %" },
  { field: "rejection_pct", label: "Rejection %" },
  { field: "cd1_pct", label: "CD1 %" },
  { field: "cd1_days", label: "CD1 Days" },
  { field: "cd2_pct", label: "CD2 %" },
  { field: "cd2_days", label: "CD2 Days" },
  { field: "cd3_pct", label: "CD3 %" },
  { field: "cd3_days", label: "CD3 Days" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bySno = (a: Row, b: Row) => Number(a.sno ?? 0) - Number(b.sno ?? 0);

/** One order's rows of each table, shaped as `diffAmendment` reads them. */
function seedOf(tables: Tables, orderId: string): SeededAmendmentChildren {
  const own = (t: string) => (tables[T(t)] ?? []).filter((r) => r.amendment_id === orderId).sort(bySno);
  const structures = tables[T("combo_structures")] ?? [];
  const components = tables[T("combo_components")] ?? [];
  const seed = {
    styles: own("styles"),
    styleSizes: own("style_sizes"),
    styleCoordinates: own("style_coordinates"),
    styleComponents: own("style_components"),
    dyeings: own("dyeings"),
    prints: own("prints"),
    structures: own("structures"),
    combos: own("combos").map((c) => ({
      ...c,
      structures: structures
        .filter((st) => st.combo_id === c.id)
        .sort(bySno)
        .map((st) => ({ ...st, components: components.filter((x) => x.structure_id === st.id).sort(bySno) })),
    })),
    priceDetails: own("price_details"),
    approvalQtys: own("approval_qtys"),
    quantities: own("quantities").map((q) => ({ ...q, assort_lines: [] })),
    packTypes: own("pack_types"),
    countrySizes: own("country_sizes"),
    // T&A is execution, never frozen in the snapshot — both sides empty.
    taActivities: [],
  };
  /* The rows are the tables' own columns, a superset of what each tab spec
     reads; `diffAmendment` only ever touches the fields its specs name. */
  return seed as unknown as SeededAmendmentChildren;
}

/** A uuid is a selection, not a word: say that it moved, never print it. */
function readable(before: string, after: string): [string, string] {
  if (UUID.test(before) || UUID.test(after)) {
    return [before === "—" ? "—" : "previous selection", after === "—" ? "—" : "new selection"];
  }
  return [before, after];
}

/** The live order, embedded into the snapshot's shape — one round trip. */
async function liveTables(orderId: string): Promise<{ header: Row | null; tables: Tables }> {
  const s = await createClient();
  const flat = [
    "styles", "style_sizes", "style_coordinates", "style_components", "dyeings", "prints",
    "structures", "price_details", "approval_qtys", "quantities", "pack_types", "country_sizes",
  ];
  const { data, error } = await s
    .from("garment_order_amendments")
    .select(
      [
        "*",
        ...flat.map((t) => `${T(t)}(*)`),
        `${T("combos")}(*, ${T("combo_structures")}(*, ${T("combo_components")}(*)))`,
      ].join(", "),
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the order as it stands: ${error.message}`);
  if (!data) return { header: null, tables: {} };
  const row = data as unknown as Row;
  const tables: Tables = {};
  for (const t of flat) tables[T(t)] = (row[T(t)] as Row[] | undefined) ?? [];
  const combos = (row[T("combos")] as Row[] | undefined) ?? [];
  tables[T("combos")] = combos;
  tables[T("combo_structures")] = combos.flatMap((c) => (c[T("combo_structures")] as Row[] | undefined) ?? []);
  tables[T("combo_components")] = (tables[T("combo_structures")] ?? []).flatMap(
    (st) => (st[T("combo_components")] as Row[] | undefined) ?? [],
  );
  return { header: row, tables };
}

/**
 * The order's changes since the revision was raised. Empty when nothing moved
 * (or the revision predates the snapshot); throws only when the live read
 * fails, which the caller turns into a sentence.
 */
export async function orderChangesSince(orderSnapshot: unknown, orderId: string): Promise<OrderFieldChange[]> {
  if (!orderSnapshot || typeof orderSnapshot !== "object") return [];
  const before = orderSnapshot as Tables;
  const live = await liveTables(orderId);
  if (!live.header) return [];

  const out: OrderFieldChange[] = [];

  /* The header is stored as the table's rows like every other entry; read it
     defensively all the same (a single object is accepted too). */
  const rawHeader = (before as Record<string, unknown>)["garment_order_amendments"];
  const headerRows: Row[] = Array.isArray(rawHeader) ? (rawHeader as Row[]) : rawHeader ? [rawHeader as Row] : [];
  const wasHeader = headerRows.find((r) => r.id === orderId) ?? null;
  if (wasHeader) {
    for (const f of HEADER_FIELDS) {
      const show = (v: unknown) => (f.date && typeof v === "string" && v ? fmtDate(v) : display(v));
      const a = show(wasHeader[f.field]);
      const b = show(live.header[f.field]);
      if (a !== b) out.push({ section: "Order Info", row: "", field: f.label, before: a, after: b });
    }
  }

  for (const tab of diffAmendment(seedOf(before, orderId), seedOf(live.tables, orderId))) {
    for (const r of tab.rows) {
      if (r.kind === "added") out.push({ section: tab.label, row: r.label, field: "Row", before: "—", after: "added" });
      else if (r.kind === "removed") out.push({ section: tab.label, row: r.label, field: "Row", before: "present", after: "removed" });
      else {
        for (const f of r.fields) {
          const [a, b] = readable(f.before, f.after);
          out.push({ section: tab.label, row: r.label, field: f.label, before: a, after: b });
        }
      }
    }
  }
  return out;
}
