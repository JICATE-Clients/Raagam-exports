import "server-only";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { isoDateInTZ, today } from "@/lib/calendar";
import { currentAmendmentsBySalesOrder } from "@/lib/orders/amendments/current";
import { currentFabricBom } from "@/lib/orders/fabric-requirement/service";
import { yarnFabricRequirementReport } from "@/lib/orders/fabric-bom/reports";
import { isReportRefusal } from "@/lib/orders/fabric-bom/report-refusal";
import { myDepartment } from "@/lib/ta/worklist";
import {
  fabricTaSchedule,
  fabricTaTargets,
  greigeFromStages,
  type FabricLadder,
  fabricTaLadder,
  type FabricTaEvent,
  type FabricTaLadderRow,
  type FabricTaMark,
  type FabricTaSource,
  type FabricTaStep,
  type FabricTaStepCode,
  type FabricTaStream,
  type StageLineForGreige,
} from "./engine";

/**
 * The LOAD half of the Fabric T&A tracker (steps 6–11). Every rule is in
 * `./engine`; this file gathers what the rules read and hands each (order,
 * yarn) and (order, fabric) to `fabricTaSchedule`.
 *
 * ## THE QUANTITIES ARE THE REQUIREMENT REPORT'S, NOT A SECOND COMPUTATION
 *
 * Yarn purchase, the knitting stage's output and the Rule 2 cloth purchases are
 * read off `yarnFabricRequirementReport` — the same object the printed Yarn &
 * Fabric Requirement report renders. A tracker that re-derived them would be a
 * second answer to "how much greige does this order need", and the day the two
 * disagreed the store would be chasing a figure no report shows.
 *
 * ## EVERY QUERY CHECKS ITS ERROR, AND THAT IS NOT BOILERPLATE
 *
 * On 2026-09-21 this database holds ZERO purchase orders, GRNs and process
 * orders. A query that failed silently would look exactly like a correct one —
 * "nothing received yet" — until the first real receipt. Same stance as the
 * trims tracker, and for the same reason nothing here embeds across
 * `purchase_orders` (two FKs to vendors — AGENTS.md "A SECOND FK BREAKS EVERY
 * EXISTING EMBED"): headers are read by id in a second query.
 */

type SB = Awaited<ReturnType<typeof createClient>>;

export interface FabricTaRow {
  itemId: string;
  itemName: string;
  itemCode: string | null;
  subject: "YARN" | "FABRIC";
  /** "Yarn knitted here" / "Bought as greige rolls" / … — fabric rows only. */
  sourceLabel: string | null;
  /** Why a figure is missing — the report's own sentence. */
  refusal: string | null;
  steps: FabricTaStep[];
}

export interface FabricTaOrder {
  salesOrderId: string;
  orderRef: string | null;
  buyer: string | null;
  bomId: string;
  bomCode: string | null;
  /** Step 11's date for a wet-processed fabric, stated once for the header. */
  inHouse: { date: string | null; note: string };
  /** THE GROUPED LADDER — one row per step, rolled up over `yarns` + `fabrics`
   *  (client 2026-09-21). What the Fabric BOM's T&A tab shows. */
  ladder: FabricTaLadderRow[];
  /** The detailed per-material schedules the ladder is rolled up from. Kept
   *  (the "backup" the client named) for the step sheet and for a drill-down. */
  yarns: FabricTaRow[];
  fabrics: FabricTaRow[];
}

export interface FabricTaResult {
  today: string;
  orders: FabricTaOrder[];
  staffNames: Record<string, string>;
  viewerEmployeeId: string | null;
  canEdit: boolean;
  /** Sentences, never silence: what was skipped, and why. */
  notes: string[];
}

const PO_ISSUED = new Set(["approved", "partially_received", "received", "closed"]);

const SOURCE_LABEL: Record<FabricTaSource, string> = {
  yarn_knit: "Knitted from yarn",
  greige_purchase: "Bought as greige rolls",
  dyed_purchase: "Bought as dyed rolls",
};

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what} could not be read: ${error.message}. This is an error, not an empty tracker.`);
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const asSource = (v: unknown): FabricTaSource =>
  v === "greige_purchase" || v === "dyed_purchase" ? v : "yarn_knit";

/** Orders that have a recorded (non-draft) Fabric BOM. */
async function ordersWithFabricBom(sb: SB): Promise<string[]> {
  const { data: boms, error } = await sb
    .from("order_fabric_boms")
    .select("garment_order_id")
    .eq("is_draft", false)
    .not("garment_order_id", "is", null);
  fail("Fabric BOMs", error);
  const goIds = [...new Set(((boms ?? []) as { garment_order_id: string }[]).map((b) => b.garment_order_id))];
  if (!goIds.length) return [];
  const { data: gos, error: goErr } = await sb.from("garment_order_amendments").select("sales_order_id").in("id", goIds);
  fail("Garment orders", goErr);
  return [
    ...new Set(((gos ?? []) as { sales_order_id: string | null }[]).map((g) => g.sales_order_id).filter((x): x is string => !!x)),
  ];
}

/**
 * The tracker for every order with a recorded Fabric BOM, or for one order.
 */
export async function getFabricTa(opts: { salesOrderId?: string } = {}): Promise<FabricTaResult> {
  const [sb, user, canEdit] = await Promise.all([createClient(), getAppUser(), can("orders", "edit")]);
  const result: FabricTaResult = { today: today(), orders: [], staffNames: {}, viewerEmployeeId: null, canEdit, notes: [] };
  if (!user) return result;

  /* WHO IS LOOKING RUNS BESIDE THE LOAD, NOT AHEAD OF IT (2026-09-24, "T&A
     tab takes 2 seconds") — three serial reads that only feed the "mine"
     highlight. Same split, same reason, as the trims tracker's `getTrimTa`. */
  const [viewer] = await Promise.all([myDepartment(sb, user.id), loadFabricTaInto(sb, result, opts)]);
  result.viewerEmployeeId = viewer?.employeeId ?? null;
  return result;
}

/**
 * Fills `result` in. THE REQUIREMENT REPORT IS THE CRITICAL PATH — it is a
 * chain of its own — so the work is split into two chains that run side by
 * side instead of one queue:
 *
 *   report chain: report ‖ BOM requirements ‖ sources → process kinds ‖
 *                 materials ‖ PO lines → PO headers ‖ GRN lines → GRN headers
 *   order chain:  current amendments ‖ activities ‖ marks ‖ process orders →
 *                 ladder dates ‖ buyers ‖ owners ‖ issues ‖ receipts → their lines
 *
 * Every round trip is ~260 ms of network and ~0 ms of query (the tables hold
 * tens of rows), so the wait is the number of SERIAL rounds and nothing else.
 * The order chain needs nothing the report produces, so it now costs nothing.
 */
async function loadFabricTaInto(sb: SB, result: FabricTaResult, opts: { salesOrderId?: string }): Promise<void> {
  const t = result.today;
  const notes = result.notes;

  /* ---- 1. Which orders, and each one's CURRENT Fabric BOM. ------------------ */
  const soIds = opts.salesOrderId ? [opts.salesOrderId] : await ordersWithFabricBom(sb);
  if (!soIds.length) return;

  const current = await Promise.all(soIds.map(async (so) => [so, await currentFabricBom(so)] as const));
  const bomOf = new Map<string, { id: string; code: string | null }>();
  for (const [so, c] of current) {
    if ("refused" in c) {
      if (opts.salesOrderId) notes.push(c.refused);
      continue;
    }
    bomOf.set(so, { id: c.bom.id, code: c.bom.code });
  }
  const liveSo = [...bomOf.keys()];
  if (!liveSo.length) return;
  const bomIds = [...bomOf.values()].map((b) => b.id);

  const [reportSide, orderSide] = await Promise.all([reportChain(), orderChain()]);
  if (!reportSide) return;

  /* ---- 2–3. The report chain: quantities, the BOMs' own fabrics, finished
     weight and sources, then the materials and the PO → GRN documents. ------ */
  async function reportChain() {
    const reports = new Map<string, Awaited<ReturnType<typeof yarnFabricRequirementReport>>>();
    const [, reqQ, scopeQ] = await Promise.all([
      Promise.all(
        liveSo.map(async (so) => {
          reports.set(so, await yarnFabricRequirementReport(bomOf.get(so)!.id, { allocation: false }));
        }),
      ),
      sb.from("order_fabric_bom_requirements").select("bom_id, item_id, required_qty, refusal_reason").in("bom_id", bomIds),
      sb.from("order_fabric_bom_process_scope").select("bom_id, item_id, source").in("bom_id", bomIds),
    ]);
    fail("Fabric BOM requirements", reqQ.error);
    fail("Fabric sources", scopeQ.error);
    const reqs = (reqQ.data ?? []) as { bom_id: string; item_id: string | null; required_qty: number | null; refusal_reason: string | null }[];
    const sourceOf = new Map<string, FabricTaSource>();
    for (const r of (scopeQ.data ?? []) as { bom_id: string; item_id: string; source: string | null }[]) {
      sourceOf.set(`${r.bom_id}|${r.item_id}`, asSource(r.source));
    }

    /* Process kinds for every stage group the reports carry — the ONLY way to
       tell a knitting line from a dyeing one (flags on the master, never a name). */
    const processIds = new Set<string>();
    for (const r of reports.values()) {
      if (isReportRefusal(r)) continue;
      for (const g of r.stageBreakdown) processIds.add(g.processId);
    }

    /* The subjects: yarns off the report, fabrics off the stored requirement. */
    const yarnIds = new Set<string>();
    const fabricIds = new Set<string>();
    for (const r of reports.values()) if (!isReportRefusal(r)) for (const y of r.yarns) yarnIds.add(y.itemId);
    for (const q of reqs) if (q.item_id) fabricIds.add(q.item_id);
    const itemIds = [...new Set([...yarnIds, ...fabricIds])];
    if (!itemIds.length) return null;

    // Purchase orders → GRNs. Yarn feeds 6/7; the fabric itself feeds the
    // purchased-cloth steps (the engine decides which by source).
    const [kindQ, itemsQ, poLineQ] = await Promise.all([
      processIds.size
        ? sb.from("processes").select("id, is_knitting, is_cloth_purchase").in("id", [...processIds])
        : Promise.resolve({ data: [], error: null }),
      sb.from("items").select("id, code, name").in("id", itemIds),
      sb
        .from("po_line_items")
        .select("id, purchase_order_id, sales_order_id, item_id, quantity")
        .in("sales_order_id", liveSo)
        .in("item_id", itemIds),
    ]);
    fail("Process master", kindQ.error);
    fail("Materials", itemsQ.error);
    fail("Purchase order lines", poLineQ.error);
    const kinds = new Map<string, { is_knitting: boolean; is_cloth_purchase: boolean }>();
    for (const p of (kindQ.data ?? []) as { id: string; is_knitting: boolean | null; is_cloth_purchase: boolean | null }[]) {
      kinds.set(p.id, { is_knitting: !!p.is_knitting, is_cloth_purchase: !!p.is_cloth_purchase });
    }
    const items = new Map(((itemsQ.data ?? []) as { id: string; code: string | null; name: string | null }[]).map((i) => [i.id, i]));

    type PoLine = { id: string; purchase_order_id: string; sales_order_id: string; item_id: string; quantity: number | null };
    const poLineRows = (poLineQ.data ?? []) as PoLine[];
    const poIds = [...new Set(poLineRows.map((l) => l.purchase_order_id))];
    const [poHeadQ, grnLineQ] = await Promise.all([
      poIds.length
        ? sb.from("purchase_orders").select("id, code, status, order_date, approved_at, created_at").in("id", poIds)
        : Promise.resolve({ data: [], error: null }),
      poLineRows.length
        ? sb.from("grn_line_items").select("grn_id, po_line_item_id, received_qty, accepted_qty").in("po_line_item_id", poLineRows.map((l) => l.id))
        : Promise.resolve({ data: [], error: null }),
    ]);
    fail("Purchase orders", poHeadQ.error);
    fail("GRN lines", grnLineQ.error);
    const grnLines = (grnLineQ.data ?? []) as { grn_id: string; po_line_item_id: string; received_qty: number | null; accepted_qty: number | null }[];
    const grnIds = [...new Set(grnLines.map((g) => g.grn_id))];
    const grnHeadQ = grnIds.length ? await sb.from("grns").select("id, code, status, grn_date").in("id", grnIds) : { data: [], error: null };
    fail("GRNs", grnHeadQ.error);

    return { reports, reqs, sourceOf, kinds, yarnIds, fabricIds, items, poLineRows, poHeadQ, grnLines, grnHeadQ };
  }

  /* ---- 4–5. The order chain: the order's own T&A dates, buyers, marks and
     owners, and the process-order documents. Nothing here reads the report. */
  async function orderChain() {
    const [currentAmend, actsQ, marksQ, procQ, soQ] = await Promise.all([
      currentAmendmentsBySalesOrder(sb, liveSo),
      sb.from("ta_activities").select("id, short_name").in("short_name", ["CUT", "YRNPUR", "KNIT", "DYE"]),
      sb
        .from("order_fabric_ta_marks")
        .select("sales_order_id, item_id, step_code, tolerance_pct, done_on, remarks, assigned_staff_id")
        .in("sales_order_id", liveSo),
      sb.from("process_orders").select("id, code, sales_order_id, process_type, status").in("sales_order_id", liveSo),
      sb.from("sales_orders").select("id, order_number").in("id", liveSo),
    ]);
    fail("T&A activities", actsQ.error);
    fail("Fabric T&A marks", marksQ.error);
    fail("Process orders", procQ.error);
    fail("Orders", soQ.error);

    const currentIds = [...currentAmend.values()].map((a) => a.id);
    const actCode = new Map(((actsQ.data ?? []) as { id: string; short_name: string }[]).map((a) => [a.id, a.short_name]));
    type Proc = { id: string; code: string | null; sales_order_id: string; process_type: string; status: string };
    const procRows = ((procQ.data ?? []) as Proc[]).filter((p) => p.status !== "cancelled");
    const procIds = procRows.map((p) => p.id);

    const marks = new Map<string, Partial<Record<FabricTaStepCode, FabricTaMark>>>();
    const staffIds = new Set<string>();
    for (const m of (marksQ.data ?? []) as {
      sales_order_id: string;
      item_id: string;
      step_code: FabricTaStepCode;
      tolerance_pct: number | null;
      done_on: string | null;
      remarks: string | null;
      assigned_staff_id: string | null;
    }[]) {
      const k = `${m.sales_order_id}|${m.item_id}`;
      const bag = marks.get(k) ?? {};
      bag[m.step_code] = { tolerancePct: m.tolerance_pct, doneOn: m.done_on, remarks: m.remarks, assignedStaffId: m.assigned_staff_id };
      marks.set(k, bag);
      if (m.assigned_staff_id) staffIds.add(m.assigned_staff_id);
    }

    const [ladderQ, buyerQ, staffQ, issueQ, receiptQ] = await Promise.all([
      currentIds.length && actCode.size
        ? sb
            .from("garment_order_amendment_ta_activities")
            .select("amendment_id, activity_id, target_date")
            .in("amendment_id", currentIds)
            .in("activity_id", [...actCode.keys()])
        : Promise.resolve({ data: [], error: null }),
      currentIds.length
        ? sb.from("garment_order_amendments").select("id, sales_order_id, customer:customers(name)").in("id", currentIds)
        : Promise.resolve({ data: [], error: null }),
      staffIds.size ? sb.from("employees").select("id, name").in("id", [...staffIds]) : Promise.resolve({ data: [], error: null }),
      procIds.length
        ? sb.from("process_material_issues").select("id, code, process_order_id, issue_date, status").in("process_order_id", procIds)
        : Promise.resolve({ data: [], error: null }),
      procIds.length
        ? sb.from("process_material_receipts").select("id, code, process_order_id, receipt_date, status").in("process_order_id", procIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    fail("The order T&A schedule", ladderQ.error);
    fail("Buyers", buyerQ.error);
    fail("Employees", staffQ.error);
    fail("Process issues", issueQ.error);
    fail("Process receipts", receiptQ.error);

    type Issue = { id: string; code: string | null; process_order_id: string; issue_date: string | null; status: string };
    type Receipt = { id: string; code: string | null; process_order_id: string; receipt_date: string | null; status: string };
    const issues = ((issueQ.data ?? []) as Issue[]).filter((i) => i.status !== "cancelled");
    const receipts = ((receiptQ.data ?? []) as Receipt[]).filter((r) => r.status !== "cancelled");
    const [issueLineQ, receiptLineQ] = await Promise.all([
      issues.length
        ? sb.from("process_material_issue_lines").select("issue_id, item_id, quantity").in("issue_id", issues.map((i) => i.id))
        : Promise.resolve({ data: [], error: null }),
      receipts.length
        ? sb.from("process_material_receipt_lines").select("receipt_id, item_id, received_qty, accepted_qty").in("receipt_id", receipts.map((r) => r.id))
        : Promise.resolve({ data: [], error: null }),
    ]);
    fail("Process issue lines", issueLineQ.error);
    fail("Process receipt lines", receiptLineQ.error);

    return { currentAmend, actCode, ladderQ, buyerQ, staffQ, marks, procRows, issues, receipts, issueLineQ, receiptLineQ, soQ };
  }

  const { reports, reqs, sourceOf, kinds, yarnIds, fabricIds, items, poLineRows, poHeadQ, grnLines, grnHeadQ } = reportSide;
  const { currentAmend, actCode, ladderQ, buyerQ, staffQ, marks, procRows, issues, receipts, issueLineQ, receiptLineQ, soQ } = orderSide;

  const ladderDate = new Map<string, string>();
  for (const r of (ladderQ.data ?? []) as { amendment_id: string; activity_id: string; target_date: string | null }[]) {
    const code = actCode.get(r.activity_id);
    if (!code || !r.target_date) continue;
    const k = `${r.amendment_id}|${code}`;
    const prev = ladderDate.get(k);
    if (!prev || r.target_date < prev) ladderDate.set(k, r.target_date);
  }

  /* ---- 6. Documents → events. ------------------------------------------------ */
  const events = new Map<string, Partial<Record<FabricTaStream, FabricTaEvent[]>>>();
  const push = (so: string, item: string, stream: FabricTaStream, e: FabricTaEvent) => {
    const k = `${so}|${item}`;
    const bag = events.get(k) ?? {};
    (bag[stream] ??= []).push(e);
    events.set(k, bag);
  };

  const procById = new Map(procRows.map((p) => [p.id, p]));
  const poHead = new Map(
    ((poHeadQ.data ?? []) as { id: string; code: string | null; status: string; order_date: string | null; approved_at: string | null; created_at: string }[]).map(
      (p) => [p.id, p],
    ),
  );
  const grnHead = new Map(((grnHeadQ.data ?? []) as { id: string; code: string | null; status: string; grn_date: string | null }[]).map((g) => [g.id, g]));
  const lineOfPo = new Map(poLineRows.map((l) => [l.id, l]));

  for (const l of poLineRows) {
    if (!yarnIds.has(l.item_id)) continue; // a fabric's own PO is judged at its GRN
    const h = poHead.get(l.purchase_order_id);
    if (!h || h.status === "cancelled") continue;
    push(l.sales_order_id, l.item_id, "yarn_po", {
      date: isoDateInTZ(h.approved_at) ?? h.order_date ?? isoDateInTZ(h.created_at) ?? t,
      qty: num(l.quantity),
      code: h.code,
      settled: PO_ISSUED.has(h.status),
    });
  }
  for (const g of grnLines) {
    const l = lineOfPo.get(g.po_line_item_id);
    const h = grnHead.get(g.grn_id);
    if (!l || !h) continue;
    const posted = h.status === "posted";
    push(l.sales_order_id, l.item_id, yarnIds.has(l.item_id) ? "yarn_grn" : "fabric_grn", {
      date: h.grn_date ?? t,
      qty: num(posted ? (g.accepted_qty ?? g.received_qty) : g.received_qty),
      code: h.code,
      settled: posted,
    });
  }
  const issueById = new Map(issues.map((i) => [i.id, i]));
  for (const l of (issueLineQ.data ?? []) as { issue_id: string; item_id: string | null; quantity: number | null }[]) {
    const i = issueById.get(l.issue_id);
    const p = i ? procById.get(i.process_order_id) : undefined;
    if (!i || !p || !l.item_id) continue;
    const knitting = p.process_type === "knitting";
    /* Knitting takes YARN out; every other process takes the FABRIC out. A line
       that fits neither (yarn sent to a dyer is yarn dyeing — not a step here)
       is left out rather than miscounted. */
    const stream: FabricTaStream | null =
      knitting && yarnIds.has(l.item_id) ? "knit_issue" : !knitting && fabricIds.has(l.item_id) ? "process_issue" : null;
    if (!stream) continue;
    push(p.sales_order_id, l.item_id, stream, {
      date: i.issue_date ?? t,
      qty: num(l.quantity),
      code: i.code ?? p.code,
      settled: i.status !== "draft",
    });
  }
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  for (const l of (receiptLineQ.data ?? []) as { receipt_id: string; item_id: string | null; received_qty: number | null; accepted_qty: number | null }[]) {
    const r = receiptById.get(l.receipt_id);
    const p = r ? procById.get(r.process_order_id) : undefined;
    if (!r || !p || !l.item_id || !fabricIds.has(l.item_id)) continue;
    const posted = r.status === "posted";
    push(p.sales_order_id, l.item_id, p.process_type === "knitting" ? "knit_receipt" : "process_receipt", {
      date: r.receipt_date ?? t,
      qty: num(posted ? (l.accepted_qty ?? l.received_qty) : l.received_qty),
      code: r.code ?? p.code,
      settled: posted,
    });
  }

  /* ---- Owners, buyers, order refs. ------------------------------------------- */
  for (const e of (staffQ.data ?? []) as { id: string; name: string | null }[]) result.staffNames[e.id] = e.name ?? "—";
  const buyerOf = new Map<string, string>();
  for (const r of (buyerQ.data ?? []) as unknown as { sales_order_id: string; customer: { name: string | null } | { name: string | null }[] | null }[]) {
    const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    if (c?.name) buyerOf.set(r.sales_order_id, c.name);
  }
  const orderRef = new Map(((soQ.data ?? []) as { id: string; order_number: string | null }[]).map((s) => [s.id, s.order_number]));

  /* ---- 7. Assemble. ------------------------------------------------------------- */
  for (const so of liveSo) {
    const bom = bomOf.get(so)!;
    const report = reports.get(so)!;
    const amend = currentAmend.get(so);
    const ladder: FabricLadder = {
      cutStart: amend ? (ladderDate.get(`${amend.id}|CUT`) ?? null) : null,
      yarnPurchase: amend ? (ladderDate.get(`${amend.id}|YRNPUR`) ?? null) : null,
      knitting: amend ? (ladderDate.get(`${amend.id}|KNIT`) ?? null) : null,
      dyeing: amend ? (ladderDate.get(`${amend.id}|DYE`) ?? null) : null,
    };
    const targets = fabricTaTargets(ladder);
    const order: FabricTaOrder = {
      salesOrderId: so,
      orderRef: orderRef.get(so) ?? null,
      buyer: buyerOf.get(so) ?? null,
      bomId: bom.id,
      bomCode: bom.code,
      inHouse: targets.PROCESS_GRN,
      ladder: [],
      yarns: [],
      fabrics: [],
    };
    const nameOf = (id: string) => items.get(id)?.name ?? "(material not found)";
    const codeOf = (id: string) => items.get(id)?.code ?? null;

    if (isReportRefusal(report)) {
      notes.push(`${order.orderRef ?? "An order"}: ${report.refused}`);
      result.orders.push(order);
      continue;
    }

    for (const y of report.yarns) {
      order.yarns.push({
        itemId: y.itemId,
        itemName: y.yarnName || nameOf(y.itemId),
        itemCode: codeOf(y.itemId),
        subject: "YARN",
        sourceLabel: null,
        refusal: y.purchaseQty == null ? y.refusalReason : null,
        steps: fabricTaSchedule({
          subject: "YARN",
          requiredQty: y.purchaseQty,
          events: events.get(`${so}|${y.itemId}`) ?? {},
          marks: marks.get(`${so}|${y.itemId}`),
          targets,
          today: t,
        }),
      });
    }

    const stageLines: StageLineForGreige[] = report.stageBreakdown.flatMap((g) =>
      g.lines.map((l) => ({
        itemId: l.itemId,
        combo: l.combo,
        component: l.component,
        isKnitting: kinds.get(g.processId)?.is_knitting ?? false,
        isClothPurchase: kinds.get(g.processId)?.is_cloth_purchase ?? false,
        plannedWt: l.plannedWt,
        toOrderedWt: l.toOrderedWt,
      })),
    );
    const myReqs = reqs.filter((r) => r.bom_id === bom.id && r.item_id);
    const fabricsHere = [...new Set(myReqs.map((r) => r.item_id as string))];
    for (const f of fabricsHere) {
      const rows = myReqs.filter((r) => r.item_id === f);
      const refused = rows.find((r) => r.required_qty == null || r.refusal_reason);
      const finished = refused ? null : Math.round(rows.reduce((s, r) => s + num(r.required_qty), 0) * 1e6) / 1e6;
      const source = sourceOf.get(`${bom.id}|${f}`) ?? "yarn_knit";
      const bought = report.clothPurchase.filter((c) => c.fabricId === f);
      const boughtQty = bought.length ? Math.round(bought.reduce((s, c) => s + num(c.purchaseWt), 0) * 1e6) / 1e6 : null;
      const g = greigeFromStages(stageLines, f);
      /* NO ROUTE DECLARED → keep 10–11 OPEN, never bypassed (see
         `greigeFromStages`). A bought cloth needs no route to be tracked. */
      const undeclared = !g.routeDeclared && source === "yarn_knit";
      order.fabrics.push({
        itemId: f,
        itemName: nameOf(f),
        itemCode: codeOf(f),
        subject: "FABRIC",
        sourceLabel: SOURCE_LABEL[source],
        refusal: refused
          ? (refused.refusal_reason ?? "Part of this fabric's requirement could not be worked out")
          : undeclared
            ? "No process route on Fabric Process yet — the greige weight is unknown until one is declared"
            : null,
        steps: fabricTaSchedule({
          subject: "FABRIC",
          source,
          hasWetProcess: undeclared || g.hasWetProcess,
          /* A greige purchase's greige IS what is bought; a dyed purchase's
             finished weight is what is bought (it carries the losses of any
             step after the purchase). Otherwise the ladder's own figures. */
          greigeQty: source === "greige_purchase" ? (boughtQty ?? g.greigeQty) : g.greigeQty,
          finishedQty: source === "dyed_purchase" ? (boughtQty ?? finished) : finished,
          events: events.get(`${so}|${f}`) ?? {},
          marks: marks.get(`${so}|${f}`),
          targets,
          today: t,
        }),
      });
    }
    order.yarns.sort((a, b) => a.itemName.localeCompare(b.itemName));
    order.fabrics.sort((a, b) => a.itemName.localeCompare(b.itemName));
    order.ladder = fabricTaLadder([...order.yarns, ...order.fabrics], targets, t);
    result.orders.push(order);
  }

  result.orders.sort((a, b) => (a.orderRef ?? "").localeCompare(b.orderRef ?? ""));
  return;
}
