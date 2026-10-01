import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { currentAmendmentsBySalesOrder } from "@/lib/orders/amendments/current";
import { staffNames } from "@/lib/orders/staff-names";
import { buildProgress, type OrderProgress, type ProgressInput, type AlertLevel } from "./engine";

/**
 * Reads everything the progress engine needs, for every live RE or for one.
 *
 * Takes the client as an argument on purpose: the tracker screen passes the
 * signed-in session (RLS decides what the viewer may see) and the nightly
 * risk sweep passes the service-role client. ONE loader, so the alert is
 * always about the same answer the screen shows.
 *
 * Three serial rounds and no more — each round trip here is ~260 ms and the
 * tables are tiny, so the wait is the NUMBER of rounds (memory: load time is
 * round trips): ids → current documents ‖ orders → everything else at once.
 *
 * A failed read THROWS. On 2026-10-01 every downstream table (POs,
 * production, inspections, shipments) is empty, so a query that failed
 * silently would look exactly like a correct "not started" — the empty-report
 * trap AGENTS.md names under Cascading filters.
 */

type SB = Awaited<ReturnType<typeof createClient>>;

export type ProgressRow = {
  salesOrderId: string;
  orderNumber: string | null;
  orderStatus: string | null;
  amendmentId: string;
  amendmentCode: string | null;
  customer: string | null;
  merchandiserId: string | null;
  merchandiser: string | null;
  orderQty: number | null;
  deliveryDate: string | null;
  createdAt: string | null;
  progress: OrderProgress;
  /** The last risk alert sent for this RE (0666), if one stands. */
  alert: { level: AlertLevel; notifiedAt: string } | null;
};

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what} could not be read: ${error.message}. This is an error, not an empty tracker.`);
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const SHIPPED = new Set(["shipped", "delivered", "closed"]);

type Row = Record<string, unknown>;

/** Group rows by a key column. */
function groupBy<T extends Row>(rows: T[], key: string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = r[key];
    if (typeof k !== "string") continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

// created-by: exempt -- a derived tracker over orders, not a listing of records someone created; Order Entry's own list carries the pair
export async function loadOrderProgress(
  sb: SB,
  today: string,
  opts: { salesOrderId?: string } = {},
): Promise<ProgressRow[]> {
  // ---- Round 1: which REs have an Order Entry document at all.
  let soIds: string[];
  if (opts.salesOrderId) {
    soIds = [opts.salesOrderId];
  } else {
    const { data, error } = await sb.from("garment_order_amendments").select("sales_order_id").not("sales_order_id", "is", null);
    fail("Order documents", error);
    soIds = [...new Set(((data ?? []) as { sales_order_id: string }[]).map((r) => r.sales_order_id))];
  }
  if (!soIds.length) return [];

  // ---- Round 2: the CURRENT document per RE (the worklist's own tie-break) ‖ the RE rows.
  const [current, soRes] = await Promise.all([
    currentAmendmentsBySalesOrder(sb, soIds),
    sb.from("sales_orders").select("id, order_number, status, created_at").in("id", soIds),
  ]);
  fail("Orders", soRes.error);
  const soById = new Map(((soRes.data ?? []) as Row[]).map((r) => [String(r.id), r]));

  // A draft is not an order yet — the worklist drops it the same way.
  const live = [...current.entries()].filter(([so, a]) => !a.isDraft && soById.has(so));
  if (!live.length) return [];
  const ids = live.map(([so]) => so);
  const docIds = live.map(([, a]) => a.id);

  // ---- Round 3: everything else, side by side.
  const [heads, qtys, ladder, flow, po, prod, insp, ship, alerts] = await Promise.all([
    sb
      .from("garment_order_amendments")
      .select("id, delivery_date, merchandiser_id, customer:customers!customer_id(name)")
      .in("id", docIds),
    sb.from("garment_order_amendment_quantities").select("amendment_id, po_qty, delivery_date").in("amendment_id", docIds),
    sb
      .from("garment_order_amendment_ta_activities")
      .select("amendment_id, target_date, days_required, actual_date, activity:ta_activities!activity_id(short_name)")
      .in("amendment_id", docIds),
    sb.from("order_work_flow_milestones").select("sales_order_id, code, target_date, actual_date, status").in("sales_order_id", ids),
    sb.from("po_line_items").select("sales_order_id, quantity, received_qty").in("sales_order_id", ids),
    sb.from("production_entries").select("sales_order_id, stage, entry_date, good_qty").in("sales_order_id", ids),
    sb.from("inspections").select("sales_order_id, inspection_date, result, status").in("sales_order_id", ids),
    sb
      .from("shipment_lines")
      .select("sales_order_id, quantity, shipment:shipments!shipment_id(status, etd, invoice_date)")
      .in("sales_order_id", ids),
    sb.from("order_risk_alerts").select("sales_order_id, level, notified_at").in("sales_order_id", ids),
  ]);
  fail("Order headers", heads.error);
  fail("Order quantities", qtys.error);
  fail("T&A ladder", ladder.error);
  fail("Work Flow milestones", flow.error);
  fail("Purchase lines", po.error);
  fail("Production entries", prod.error);
  fail("Inspections", insp.error);
  fail("Shipment lines", ship.error);
  fail("Risk alerts", alerts.error);

  const headById = new Map(((heads.data ?? []) as Row[]).map((r) => [String(r.id), r]));
  // Merchandiser is a `staff` id; names come through the narrow admin lookup (staff RLS is HR-only).
  const merchNames = await staffNames(((heads.data ?? []) as Row[]).map((r) => (typeof r.merchandiser_id === "string" ? r.merchandiser_id : null)));
  const qtyByDoc = groupBy((qtys.data ?? []) as Row[], "amendment_id");
  const ladderByDoc = groupBy((ladder.data ?? []) as Row[], "amendment_id");
  const flowBySo = groupBy((flow.data ?? []) as Row[], "sales_order_id");
  const poBySo = groupBy((po.data ?? []) as Row[], "sales_order_id");
  const prodBySo = groupBy((prod.data ?? []) as Row[], "sales_order_id");
  const inspBySo = groupBy((insp.data ?? []) as Row[], "sales_order_id");
  const shipBySo = groupBy((ship.data ?? []) as Row[], "sales_order_id");
  const alertBySo = new Map(((alerts.data ?? []) as Row[]).map((r) => [String(r.sales_order_id), r]));

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

  const rows: ProgressRow[] = live.map(([so, doc]) => {
    const head = headById.get(doc.id) ?? {};
    const so_ = soById.get(so)!;
    const qtyRows = qtyByDoc.get(doc.id) ?? [];
    const orderQty = qtyRows.length ? qtyRows.reduce((s, q) => s + num(q.po_qty), 0) : null;
    // The EARLIEST line delivery is the one that can be missed first.
    const lineDates = qtyRows.map((q) => str(q.delivery_date)).filter((d): d is string => !!d).sort();
    const deliveryDate = lineDates[0] ?? str(head.delivery_date);

    const input: ProgressInput = {
      orderStatus: str(so_.status),
      orderQty,
      deliveryDate,
      workFlow: (flowBySo.get(so) ?? []).map((w) => ({
        code: String(w.code),
        target_date: str(w.target_date),
        actual_date: str(w.actual_date),
        status: String(w.status),
      })),
      ladder: (ladderByDoc.get(doc.id) ?? []).map((l) => ({
        shortName: str(one(l.activity as Row | Row[] | null)?.short_name) ?? "",
        target_date: str(l.target_date),
        days_required: l.days_required == null ? null : num(l.days_required),
        actual_date: str(l.actual_date),
      })),
      poLines: (poBySo.get(so) ?? []).map((p) => ({ quantity: num(p.quantity), received_qty: num(p.received_qty) })),
      production: (prodBySo.get(so) ?? []).map((p) => ({
        stage: String(p.stage),
        entry_date: String(p.entry_date),
        good_qty: num(p.good_qty),
      })),
      inspections: (inspBySo.get(so) ?? []).map((i) => ({
        inspection_date: str(i.inspection_date),
        result: str(i.result),
        status: str(i.status),
      })),
      shipped: (shipBySo.get(so) ?? [])
        .map((l) => ({ line: l, head: one(l.shipment as Row | Row[] | null) }))
        .filter(({ head: h }) => h && SHIPPED.has(String(h.status)))
        .map(({ line, head: h }) => ({ date: str(h!.invoice_date) ?? str(h!.etd), qty: num(line.quantity) })),
    };

    const alert = alertBySo.get(so);
    return {
      salesOrderId: so,
      orderNumber: str(so_.order_number),
      orderStatus: input.orderStatus,
      amendmentId: doc.id,
      amendmentCode: doc.code,
      customer: str(one(head.customer as Row | Row[] | null)?.name),
      merchandiserId: str(head.merchandiser_id),
      merchandiser: merchNames.get(str(head.merchandiser_id) ?? "") ?? null,
      orderQty,
      deliveryDate,
      createdAt: str(so_.created_at),
      progress: buildProgress(input, today),
      alert: alert ? { level: alert.level as AlertLevel, notifiedAt: String(alert.notified_at) } : null,
    };
  });

  // Listings in ENTRY order (STANDING): oldest RE first.
  rows.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  return rows;
}
