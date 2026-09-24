import "server-only";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { isoDateInTZ, today } from "@/lib/calendar";
import { currentAmendmentsBySalesOrder } from "@/lib/orders/amendments/current";
import {
  finalQuantityByItem,
  recordedBomsForOrders,
  type LineRow,
  type ReqRow,
} from "@/lib/purchase/bom-ceiling-service";
import { myDepartment } from "@/lib/ta/worklist";
import {
  inHouseTarget,
  trimClassOf,
  trimSchedule,
  type InHouseTarget,
  type LadderAnchors,
  type TrimClass,
  type TrimDocEvent,
  type TrimStep,
  type TrimStepCode,
  type TrimStepKind,
  type TrimStepMark,
} from "./engine";

/**
 * The LOAD half of the trims T&A tracker (steps 12–17). Every rule is in
 * `./engine`; this file only gathers what the rules read, in batched queries
 * (one per table, never one per order), and hands each (order, material) to
 * `trimSchedule`.
 *
 * ## EVERY QUERY CHECKS ITS ERROR, AND THAT IS NOT BOILERPLATE
 *
 * On 2026-09-21 this database holds ZERO trim POs, GRNs and BOM-linked DCs. A
 * query that silently failed would therefore look exactly like a correct one —
 * "nothing received yet" — until the first real GRN, when the tracker would
 * keep saying so. That is the `vendors(name)` embed failure AGENTS.md records
 * ("A SECOND FK BREAKS EVERY EXISTING EMBED"), which is also why nothing here
 * embeds across `purchase_orders` (it has two FKs to `vendors`): headers are
 * read by id in a second query instead.
 */


export interface TrimTaMaterial {
  itemId: string;
  itemName: string;
  itemCode: string | null;
  trimClass: TrimClass;
  uom: string | null;
  requiredQty: number | null;
  /** A slice of the BOM refused, so `requiredQty` is withheld (a partial sum). */
  unresolved: boolean;
  needsProcess: boolean;
  freeIssue: boolean;
  leadDays: number | null;
  steps: TrimStep[];
}

export interface TrimTaOrder {
  salesOrderId: string;
  orderRef: string | null;
  buyer: string | null;
  amendmentCode: string | null;
  bomCode: string | null;
  inHouse: Record<TrimClass, InHouseTarget>;
  materials: TrimTaMaterial[];
}

export interface TrimTaResult {
  today: string;
  orders: TrimTaOrder[];
  /** assigned_staff_id → name, for every step that carries one. */
  staffNames: Record<string, string>;
  viewerEmployeeId: string | null;
  canEdit: boolean;
  /** Sentences, never silence: what was skipped, and why. */
  notes: string[];
}

const ISSUED = new Set(["approved", "partially_received", "received", "closed"]);

type SB = Awaited<ReturnType<typeof createClient>>;

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what} could not be read: ${error.message}. This is an error, not an empty tracker.`);
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The tracker for every order with a recorded Material BOM, or for one order.
 */
export async function getTrimTa(opts: { salesOrderId?: string } = {}): Promise<TrimTaResult> {
  const [sb, user, canEdit] = await Promise.all([createClient(), getAppUser(), can("orders", "edit")]);
  const result: TrimTaResult = { today: today(), orders: [], staffNames: {}, viewerEmployeeId: null, canEdit, notes: [] };
  if (!user) return result;

  /* WHO IS LOOKING RUNS BESIDE THE LOAD, NOT AHEAD OF IT (2026-09-24, "T&A
     tab takes 2 seconds"). It is three serial reads that only feed the "mine"
     highlight, and it used to hold every read below behind it. Every round
     trip here is ~260 ms of network and ~0 ms of query — the tables are tiny
     — so the wait is the NUMBER OF SERIAL ROUNDS, and nothing else. */
  const [viewer] = await Promise.all([myDepartment(sb, user.id), loadTrimTaInto(sb, result, opts)]);
  result.viewerEmployeeId = viewer?.employeeId ?? null;
  return result;
}

/**
 * Fills `result` in as few serial rounds as the reads' own dependencies allow:
 * the BOMs → (their content ‖ activities ‖ marks ‖ current amendments) →
 * (masters ‖ ladder dates ‖ PO lines ‖ DC lines ‖ owners ‖ buyers) →
 * (PO headers ‖ GRN lines ‖ DC headers) → GRN headers. A read joins a round
 * the moment everything it filters by is known — never later.
 */
async function loadTrimTaInto(sb: SB, result: TrimTaResult, opts: { salesOrderId?: string }): Promise<void> {
  const t = result.today;
  const notes = result.notes;

  /* ---- 1. Which orders: those with a RECORDED BOM (a draft is not a plan). -- */
  let soIds: string[];
  if (opts.salesOrderId) {
    soIds = [opts.salesOrderId];
  } else {
    const { data: recorded, error } = await sb
      .from("material_bom_amendments")
      .select("garment_order_id")
      .eq("is_draft", false)
      .not("garment_order_id", "is", null);
    fail("Material BOMs", error);
    const goIds = [...new Set(((recorded ?? []) as { garment_order_id: string }[]).map((r) => r.garment_order_id))];
    if (!goIds.length) return;
    const { data: gos, error: goErr } = await sb
      .from("garment_order_amendments")
      .select("sales_order_id")
      .in("id", goIds);
    fail("Garment orders", goErr);
    soIds = [...new Set(((gos ?? []) as { sales_order_id: string | null }[]).map((g) => g.sales_order_id).filter((x): x is string => !!x))];
  }
  if (!soIds.length) return;

  const boms = await recordedBomsForOrders(sb, soIds);
  const bomIds = [...boms.values()].map((b) => b.bom?.id).filter((x): x is string => !!x);
  const allGoIds = [...boms.values()].flatMap((b) => b.goIds);
  if (!bomIds.length) {
    if (opts.salesOrderId) notes.push("This order has no recorded Material BOM yet — trims are scheduled once one is saved out of draft.");
    return;
  }

  /* ---- 2. The BOMs' own content, every BOM id of each order (for DCs), and
     the two reads that need nothing but the order ids — activities and marks
     used to wait two and three rounds for inputs they never read. --------- */
  const [linesQ, reqQ, procQ, allBomQ, soQ, currentAmend, actsQ, marksQ] = await Promise.all([
    sb
      .from("material_bom_amendment_items")
      .select("id, amendment_id, item_id, category_id, vendor_id, supply_type, send_out, moq, round_to, purchase_uom_id")
      .in("amendment_id", bomIds),
    sb
      .from("material_bom_amendment_requirements")
      .select("amendment_id, item_id, item_line_id, item_color_id, required_qty, purchase_qty, refusal_reason")
      .in("amendment_id", bomIds),
    sb.from("material_bom_amendment_processes").select("amendment_id, item_id").in("amendment_id", bomIds),
    sb.from("material_bom_amendments").select("id, garment_order_id").in("garment_order_id", allGoIds),
    sb.from("sales_orders").select("id, order_number").in("id", soIds),
    currentAmendmentsBySalesOrder(sb, soIds),
    sb.from("ta_activities").select("id, short_name").in("short_name", ["CUT", "PACK", "SEWTRIM", "PACKTRIM"]),
    sb
      .from("order_trim_ta_marks")
      .select("sales_order_id, item_id, step_code, tolerance_pct, done_on, remarks, assigned_staff_id")
      .in("sales_order_id", soIds),
  ]);
  fail("Material BOM lines", linesQ.error);
  fail("Material BOM requirements", reqQ.error);
  fail("Material BOM processes", procQ.error);
  fail("Material BOM amendments", allBomQ.error);
  fail("Orders", soQ.error);
  fail("T&A activities", actsQ.error);
  fail("Trim T&A marks", marksQ.error);

  type Line = LineRow & {
    amendment_id: string;
    item_id: string | null;
    category_id: string | null;
    vendor_id: string | null;
    supply_type: string | null;
    send_out: boolean | null;
    purchase_uom_id: string | null;
  };
  const lines = (linesQ.data ?? []) as Line[];
  const reqs = (reqQ.data ?? []) as (ReqRow & { amendment_id: string })[];
  const procs = (procQ.data ?? []) as { amendment_id: string; item_id: string | null }[];
  const itemIds = [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))];
  if (!itemIds.length) return;

  const currentIds = [...currentAmend.values()].map((a) => a.id);
  const actCode = new Map(((actsQ.data ?? []) as { id: string; short_name: string }[]).map((a) => [a.id, a.short_name]));

  const allBomRows = (allBomQ.data ?? []) as { id: string; garment_order_id: string }[];
  const soOfGo = new Map<string, string>();
  for (const [so, b] of boms) for (const g of b.goIds) soOfGo.set(g, so);
  const soOfBom = new Map(allBomRows.map((b) => [b.id, soOfGo.get(b.garment_order_id) ?? ""]));

  const marks = new Map<string, Partial<Record<TrimStepCode, TrimStepMark>>>();
  const staffIds = new Set<string>();
  for (const m of (marksQ.data ?? []) as {
    sales_order_id: string;
    item_id: string;
    step_code: TrimStepCode;
    tolerance_pct: number | null;
    done_on: string | null;
    remarks: string | null;
    assigned_staff_id: string | null;
  }[]) {
    const k = `${m.sales_order_id}|${m.item_id}`;
    const bag = marks.get(k) ?? {};
    bag[m.step_code] = {
      tolerancePct: m.tolerance_pct,
      doneOn: m.done_on,
      remarks: m.remarks,
      assignedStaffId: m.assigned_staff_id,
    };
    marks.set(k, bag);
    if (m.assigned_staff_id) staffIds.add(m.assigned_staff_id);
  }

  /* ---- 3. ONE ROUND for everything the BOM lines and step 2 unlock: masters
     (item class, category class, units, vendor lead times), the order's own
     T&A dates (stored by the last save of the tab), the first link of both
     document chains (PO lines, BOM-linked DC lines), owners and buyers. ---- */
  const categoryIds = [...new Set(lines.map((l) => l.category_id).filter((x): x is string => !!x))];
  const vendorIds = [...new Set(lines.map((l) => l.vendor_id).filter((x): x is string => !!x))];
  const uomIds = [...new Set(lines.map((l) => l.purchase_uom_id).filter((x): x is string => !!x))];
  const [itemsQ, catsQ, uomQ, leadQ, classQ, ladderQ, poLineQ, dcLineQ, staffQ, buyerQ] = await Promise.all([
    sb.from("items").select("id, code, name, item_class_id").in("id", itemIds),
    categoryIds.length ? sb.from("categories").select("id, item_class_id").in("id", categoryIds) : Promise.resolve({ data: [], error: null }),
    uomIds.length ? sb.from("uoms").select("id, code").in("id", uomIds) : Promise.resolve({ data: [], error: null }),
    vendorIds.length
      ? sb.from("master_vendor_item_categories").select("vendor_id, category_id, lead_days").in("vendor_id", vendorIds)
      : Promise.resolve({ data: [], error: null }),
    sb.from("config_lookups").select("id, code").eq("kind", "item_class"),
    currentIds.length && actCode.size
      ? sb
          .from("garment_order_amendment_ta_activities")
          .select("amendment_id, activity_id, target_date")
          .in("amendment_id", currentIds)
          .in("activity_id", [...actCode.keys()])
      : Promise.resolve({ data: [], error: null }),
    sb
      .from("po_line_items")
      .select("id, purchase_order_id, sales_order_id, item_id, quantity")
      .in("sales_order_id", soIds)
      .in("item_id", itemIds),
    allBomRows.length
      ? sb
          .from("dc_line_items")
          .select("delivery_challan_id, mba_amendment_id, item_id, sent_qty, returned_qty, returned_on")
          .in("mba_amendment_id", allBomRows.map((b) => b.id))
      : Promise.resolve({ data: [], error: null }),
    staffIds.size ? sb.from("employees").select("id, name").in("id", [...staffIds]) : Promise.resolve({ data: [], error: null }),
    currentIds.length
      ? sb.from("garment_order_amendments").select("id, sales_order_id, customer:customers(name)").in("id", currentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  fail("Materials", itemsQ.error);
  fail("Categories", catsQ.error);
  fail("Units", uomQ.error);
  fail("Vendor lead times", leadQ.error);
  fail("Item classes", classQ.error);
  fail("The order T&A schedule", ladderQ.error);
  fail("Purchase order lines", poLineQ.error);
  fail("Delivery challan lines", dcLineQ.error);
  fail("Employees", staffQ.error);
  fail("Buyers", buyerQ.error);

  const classCode = new Map(((classQ.data ?? []) as { id: string; code: string }[]).map((c) => [c.id, c.code]));
  const catClass = new Map(((catsQ.data ?? []) as { id: string; item_class_id: string | null }[]).map((c) => [c.id, c.item_class_id]));
  const uomCode = new Map(((uomQ.data ?? []) as { id: string; code: string }[]).map((u) => [u.id, u.code]));
  const items = new Map(
    ((itemsQ.data ?? []) as { id: string; code: string | null; name: string | null; item_class_id: string | null }[]).map((i) => [i.id, i]),
  );
  const leadOf = new Map<string, number>();
  for (const r of (leadQ.data ?? []) as { vendor_id: string; category_id: string | null; lead_days: number | null }[]) {
    if (r.lead_days == null || !r.category_id) continue;
    const k = `${r.vendor_id}|${r.category_id}`;
    leadOf.set(k, Math.max(leadOf.get(k) ?? 0, r.lead_days));
  }

  // amendment → code → earliest stored date (a code can repeat on a ladder).
  const ladderDate = new Map<string, string>();
  for (const r of (ladderQ.data ?? []) as { amendment_id: string; activity_id: string; target_date: string | null }[]) {
    const code = actCode.get(r.activity_id);
    if (!code || !r.target_date) continue;
    const k = `${r.amendment_id}|${code}`;
    const prev = ladderDate.get(k);
    if (!prev || r.target_date < prev) ladderDate.set(k, r.target_date);
  }

  for (const e of (staffQ.data ?? []) as { id: string; name: string | null }[]) result.staffNames[e.id] = e.name ?? "—";

  const buyerOf = new Map<string, string>();
  for (const r of (buyerQ.data ?? []) as unknown as { sales_order_id: string; customer: { name: string | null } | { name: string | null }[] | null }[]) {
    const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    if (c?.name) buyerOf.set(r.sales_order_id, c.name);
  }

  /* ---- 4–5. The rest of both document chains: PO headers and GRN lines,
     then GRN headers; DC headers ride the first of those two rounds. ------- */
  type PoLine = { id: string; purchase_order_id: string; sales_order_id: string; item_id: string; quantity: number | null };
  type GrnLine = { grn_id: string; po_line_item_id: string; received_qty: number | null; accepted_qty: number | null };
  type DcLine = {
    delivery_challan_id: string;
    mba_amendment_id: string;
    item_id: string | null;
    sent_qty: number | null;
    returned_qty: number | null;
    returned_on: string | null;
  };
  const poLineRows = (poLineQ.data ?? []) as PoLine[];
  const poIds = [...new Set(poLineRows.map((l) => l.purchase_order_id))];
  const dcLines = (dcLineQ.data ?? []) as DcLine[];
  const dcIds = [...new Set(dcLines.map((d) => d.delivery_challan_id))];

  const [poHeadQ, grnLineQ, dcHeadQ] = await Promise.all([
    poIds.length
      ? sb.from("purchase_orders").select("id, code, status, order_date, approved_at, created_at").in("id", poIds)
      : Promise.resolve({ data: [], error: null }),
    poLineRows.length
      ? sb.from("grn_line_items").select("grn_id, po_line_item_id, received_qty, accepted_qty").in("po_line_item_id", poLineRows.map((l) => l.id))
      : Promise.resolve({ data: [], error: null }),
    dcIds.length ? sb.from("delivery_challans").select("id, code, status, dc_date, updated_at").in("id", dcIds) : Promise.resolve({ data: [], error: null }),
  ]);
  fail("Purchase orders", poHeadQ.error);
  fail("GRN lines", grnLineQ.error);
  fail("Delivery challans", dcHeadQ.error);

  const grnLines = (grnLineQ.data ?? []) as GrnLine[];
  const grnIds = [...new Set(grnLines.map((g) => g.grn_id))];
  const grnHeadQ = grnIds.length ? await sb.from("grns").select("id, code, status, grn_date").in("id", grnIds) : { data: [], error: null };
  fail("GRNs", grnHeadQ.error);

  const poHead = new Map(
    ((poHeadQ.data ?? []) as { id: string; code: string | null; status: string; order_date: string | null; approved_at: string | null; created_at: string }[]).map((p) => [p.id, p]),
  );
  const grnHead = new Map(((grnHeadQ.data ?? []) as { id: string; code: string | null; status: string; grn_date: string | null }[]).map((g) => [g.id, g]));
  const dcHead = new Map(
    ((dcHeadQ.data ?? []) as { id: string; code: string | null; status: string; dc_date: string | null; updated_at: string }[]).map((d) => [d.id, d]),
  );

  // (order, material, stream) → events
  const events = new Map<string, Partial<Record<TrimStepKind, TrimDocEvent[]>>>();
  const push = (so: string, item: string, kind: TrimStepKind, e: TrimDocEvent) => {
    const k = `${so}|${item}`;
    const bag = events.get(k) ?? {};
    (bag[kind] ??= []).push(e);
    events.set(k, bag);
  };
  const lineOfPo = new Map(poLineRows.map((l) => [l.id, l]));
  for (const l of poLineRows) {
    const h = poHead.get(l.purchase_order_id);
    if (!h || h.status === "cancelled") continue;
    push(l.sales_order_id, l.item_id, "po", {
      date: isoDateInTZ(h.approved_at) ?? h.order_date ?? isoDateInTZ(h.created_at) ?? t,
      qty: num(l.quantity),
      code: h.code,
      settled: ISSUED.has(h.status),
    });
  }
  for (const g of grnLines) {
    const l = lineOfPo.get(g.po_line_item_id);
    const h = grnHead.get(g.grn_id);
    if (!l || !h) continue;
    const posted = h.status === "posted";
    // A posted GRN counts what QC ACCEPTED; a draft shows movement only.
    push(l.sales_order_id, l.item_id, "grn", {
      date: h.grn_date ?? t,
      qty: num(posted ? (g.accepted_qty ?? g.received_qty) : g.received_qty),
      code: h.code,
      settled: posted,
    });
  }
  for (const d of dcLines) {
    const so = soOfBom.get(d.mba_amendment_id);
    const h = dcHead.get(d.delivery_challan_id);
    if (!so || !h || !d.item_id || h.status === "cancelled") continue;
    push(so, d.item_id, "dc_out", { date: h.dc_date ?? t, qty: num(d.sent_qty), code: h.code, settled: true });
    if (num(d.returned_qty) > 0) {
      push(so, d.item_id, "dc_in", {
        // 0608 stamps the day a return arrived; rows returned before it fall
        // back to the challan's last touch, the nearest date the table kept.
        date: d.returned_on ?? isoDateInTZ(h.updated_at) ?? h.dc_date ?? t,
        qty: num(d.returned_qty),
        code: h.code,
        settled: true,
      });
    }
  }

  const orderRef = new Map(((soQ.data ?? []) as { id: string; order_number: string | null }[]).map((s) => [s.id, s.order_number]));

  /* ---- 7. Assemble. ---------------------------------------------------------- */
  let notATrim = 0;
  for (const so of soIds) {
    const b = boms.get(so);
    if (!b?.bom) continue;
    const bomLines = lines.filter((l) => l.amendment_id === b.bom!.id && l.item_id);
    const { byItem, unresolvedItems } = finalQuantityByItem(
      reqs.filter((r) => r.amendment_id === b.bom!.id),
      bomLines,
    );
    const processItems = new Set(procs.filter((p) => p.amendment_id === b.bom!.id).map((p) => p.item_id));
    const amend = currentAmend.get(so);
    const d = (code: string) => (amend ? (ladderDate.get(`${amend.id}|${code}`) ?? null) : null);
    const ladders: Record<TrimClass, LadderAnchors> = {
      SEWING: { trimInward: d("SEWTRIM"), anchorStart: d("CUT") },
      PACKING: { trimInward: d("PACKTRIM"), anchorStart: d("PACK") },
    };

    const byMaterial = new Map<string, Line[]>();
    for (const l of bomLines) byMaterial.set(l.item_id!, [...(byMaterial.get(l.item_id!) ?? []), l]);

    const materials: TrimTaMaterial[] = [];
    for (const [itemId, ls] of byMaterial) {
      const item = items.get(itemId);
      // The MATERIAL's class decides; its category's class is the fallback for
      // a material saved before its class was filled in.
      const cls = trimClassOf(
        classCode.get(item?.item_class_id ?? "") ??
          classCode.get(catClass.get(ls.find((l) => l.category_id)?.category_id ?? "") ?? ""),
      );
      if (!cls) {
        notATrim += 1;
        continue;
      }
      const leads = ls.map((l) => (l.vendor_id && l.category_id ? leadOf.get(`${l.vendor_id}|${l.category_id}`) : undefined)).filter((x): x is number => x != null);
      const unresolved = unresolvedItems.has(itemId);
      const requiredQty = unresolved ? null : (byItem.get(itemId) ?? null);
      const input = {
        trimClass: cls,
        requiredQty,
        needsProcess: ls.some((l) => l.send_out === true) || processItems.has(itemId),
        freeIssue: ls.every((l) => (l.supply_type ?? "").trim().toLowerCase() === "free issue"),
        leadDays: leads.length ? Math.max(...leads) : null,
        ladder: ladders[cls],
        events: events.get(`${so}|${itemId}`) ?? {},
        marks: marks.get(`${so}|${itemId}`),
        today: t,
      };
      materials.push({
        itemId,
        itemName: item?.name ?? "—",
        itemCode: item?.code ?? null,
        trimClass: cls,
        uom: uomCode.get(ls.find((l) => l.purchase_uom_id)?.purchase_uom_id ?? "") ?? null,
        requiredQty,
        unresolved,
        needsProcess: input.needsProcess,
        freeIssue: input.freeIssue,
        leadDays: input.leadDays,
        steps: trimSchedule(input),
      });
    }
    if (!materials.length) continue;
    materials.sort((a, b) => (a.trimClass === b.trimClass ? a.itemName.localeCompare(b.itemName) : a.trimClass === "SEWING" ? -1 : 1));

    result.orders.push({
      salesOrderId: so,
      orderRef: orderRef.get(so) ?? null,
      buyer: buyerOf.get(so) ?? null,
      amendmentCode: amend?.code ?? null,
      bomCode: b.bom.code,
      inHouse: { SEWING: inHouseTarget("SEWING", ladders.SEWING), PACKING: inHouseTarget("PACKING", ladders.PACKING) },
      materials,
    });
  }
  if (notATrim) {
    notes.push(
      `${notATrim} BOM material${notATrim === 1 ? " is" : "s are"} not a sewing or packing accessory by item class, so ${notATrim === 1 ? "it has" : "they have"} no trims schedule.`,
    );
  }
  result.orders.sort((a, b) => (a.orderRef ?? "").localeCompare(b.orderRef ?? ""));
  return;
}
