import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { isInactive } from "@/lib/masters/inactive";
import { currentFabricBom } from "@/lib/orders/fabric-requirement/service";
import { getBomYarnComposition, getGaugeRows } from "@/lib/orders/fabric-bom/service";
import {
  knitSourceKey,
  type KnitCandidate,
  type KnitCandidatesResult,
  type KnitFabric,
  type KnitOption,
  type KnitWidthForm,
  type KnittingOrder,
  type KnittingOrderListRow,
  type KnittingOrderStatus,
} from "./knitting-types";

/**
 * KNITTING HUB reads (DB 0825, doc/process/knitting-plan.md).
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST: every read below throws or refuses on
 * `error`, because an empty knitting register and a broken one look identical (AGENTS.md,
 * "A SECOND FK BREAKS EVERY EXISTING EMBED").
 */

const num = (v: unknown): number => (v == null || v === "" ? 0 : Number(v));
const numN = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** DC statuses that mean the goods have left (a draft has moved nothing; a cancelled one never will). */
const SENT_DC = ["issued", "dispatched", "partially_returned", "received", "closed"];

export async function listKnittingOrders(): Promise<KnittingOrderListRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("process_orders")
    .select(
      "id, code, status, order_date, expected_date, created_at, created_by, " +
        "vendor:master_vendors!vendor_id(name), so:sales_orders!sales_order_id(order_number), " +
        "fabrics:process_order_knit_fabrics(programmed_kg)",
    )
    .eq("process_type", "knitting")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22).
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read the knitting orders: ${error.message}`);

  return withCreators(
    ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
      const fabrics = (r.fabrics as { programmed_kg: number }[] | null) ?? [];
      return {
        id: r.id as string,
        code: (r.code as string | null) ?? null,
        status: r.status as KnittingOrderStatus,
        vendor_name: one(r.vendor as { name: string } | null)?.name ?? null,
        order_number: one(r.so as { order_number: string | null } | null)?.order_number ?? null,
        order_date: (r.order_date as string | null) ?? null,
        expected_date: (r.expected_date as string | null) ?? null,
        programmed_kg: fabrics.reduce((t, f) => t + num(f.programmed_kg), 0),
        fabric_count: fabrics.length,
        created_at: r.created_at as string,
        created_by: (r.created_by as string | null) ?? null,
      };
    }),
  );
}

export async function getKnittingOrder(id: string): Promise<KnittingOrder | null> {
  const s = await createClient();
  const { data, error } = await s
    .from("process_orders")
    .select(
      "id, code, status, process_type, vendor_id, sales_order_id, order_date, expected_date, allowed_loss_pct, notes, total_amount, created_at, created_by, close_pending, close_reason, close_remark, " +
        "vendor:master_vendors!vendor_id(name), so:sales_orders!sales_order_id(order_number), " +
        "fabrics:process_order_knit_fabrics(id, sno, fabric_item_id, source_key, width_form, knit_dia, finished_dia, gsm, loop_length, loop_length_ref, gauge_id, ply, programmed_kg, roll_weight_kg, expected_rolls, rate_per_kg, " +
        "fabric:items!fabric_item_id(name), " +
        "yarns:process_order_knit_yarns(id, sno, yarn_item_id, blend_pct, allowance_pct, required_kg, bag_weight_kg, required_bags, process_order_line_id, yarn:items!yarn_item_id(name)))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the knitting order: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  if (r.process_type !== "knitting") return null;

  type YarnRow = {
    id: string; sno: number; yarn_item_id: string; blend_pct: number; allowance_pct: number; required_kg: number;
    bag_weight_kg: number | null; required_bags: number | null; process_order_line_id: string | null;
    yarn: { name: string } | { name: string }[] | null;
  };
  type FabricRow = Omit<KnitFabric, "fabric_name" | "yarns"> & {
    fabric: { name: string } | { name: string }[] | null;
    yarns: YarnRow[] | null;
  };
  const fabricRows = ((r.fabrics as FabricRow[] | null) ?? []).sort((a, b) => a.sno - b.sno);

  // What has left on Process DCs, per order line (= per yarn row).
  const lineIds = fabricRows.flatMap((f) => (f.yarns ?? []).map((y) => y.process_order_line_id)).filter((x): x is string => !!x);
  const sentByLine = new Map<string, number>();
  if (lineIds.length) {
    const { data: dcl, error: dcErr } = await s
      .from("dc_line_items")
      .select("process_order_line_id, sent_qty, dc:delivery_challans!inner(status)")
      .in("process_order_line_id", lineIds)
      .in("dc.status", SENT_DC);
    if (dcErr) throw new Error(`Could not read the yarn sent so far: ${dcErr.message}`);
    for (const l of (dcl ?? []) as unknown as { process_order_line_id: string; sent_qty: number }[]) {
      sentByLine.set(l.process_order_line_id, (sentByLine.get(l.process_order_line_id) ?? 0) + num(l.sent_qty));
    }
  }

  // The Yarn DCs raised against this order (separate reads: delivery_challans carries several
  // FKs to the same tables, AGENTS.md "A SECOND FK").
  const { data: dcRows, error: dcListErr } = await s
    .from("delivery_challans")
    .select("id, code, dc_date, status, created_at")
    .eq("process_order_id", id)
    .order("created_at", { ascending: true });
  if (dcListErr) throw new Error(`Could not read the yarn DCs: ${dcListErr.message}`);
  const dcIds = ((dcRows ?? []) as { id: string }[]).map((d) => d.id);
  const dcLines = dcIds.length
    ? await s.from("dc_line_items").select("delivery_challan_id, sent_qty, bags").in("delivery_challan_id", dcIds)
    : { data: [], error: null };
  if (dcLines.error) throw new Error(`Could not read the yarn DC lines: ${dcLines.error.message}`);
  const dcSum = new Map<string, { kg: number; bags: number | null }>();
  for (const l of (dcLines.data ?? []) as { delivery_challan_id: string; sent_qty: number; bags: number | null }[]) {
    const t = dcSum.get(l.delivery_challan_id) ?? { kg: 0, bags: null };
    t.kg += num(l.sent_qty);
    if (l.bags != null) t.bags = (t.bags ?? 0) + Number(l.bags);
    dcSum.set(l.delivery_challan_id, t);
  }

  // Phase 3 (0827): what came back, and where each kilo of yarn went.
  const [rcRes, kyRes] = await Promise.all([
    s
      .from("knitting_receipts")
      .select("id, code, receipt_date, vendor_dc_no, created_at, payable_id, fabrics:knitting_receipt_fabrics(knit_fabric_id, rolls, net_kg)")
      .eq("process_order_id", id)
      .order("created_at", { ascending: true }),
    s.from("knitting_receipt_yarns").select("receipt_id, knit_yarn_id, kind, qty_kg").eq("process_order_id", id),
  ]);
  if (rcRes.error) throw new Error(`Could not read the fabric receipts: ${rcRes.error.message}`);
  if (kyRes.error) throw new Error(`Could not read the yarn accounting: ${kyRes.error.message}`);
  type RcRow = { id: string; code: string | null; receipt_date: string; vendor_dc_no: string | null; payable_id: string | null; fabrics: { knit_fabric_id: string; rolls: number | null; net_kg: number }[] | null };
  const receiptsRaw = (rcRes.data ?? []) as unknown as RcRow[];
  const yarnMoves = (kyRes.data ?? []) as { receipt_id: string | null; knit_yarn_id: string; kind: "used" | "returned" | "written_off"; qty_kg: number }[];
  const byYarn = new Map<string, { used: number; returned: number; written_off: number }>();
  const returnedByReceipt = new Map<string, number>();
  for (const m of yarnMoves) {
    const t = byYarn.get(m.knit_yarn_id) ?? { used: 0, returned: 0, written_off: 0 };
    t[m.kind] += num(m.qty_kg);
    byYarn.set(m.knit_yarn_id, t);
    if (m.kind === "returned" && m.receipt_id) returnedByReceipt.set(m.receipt_id, (returnedByReceipt.get(m.receipt_id) ?? 0) + num(m.qty_kg));
  }
  const fabricIn = new Map<string, { kg: number; rolls: number }>();
  for (const rc of receiptsRaw) for (const f of rc.fabrics ?? []) {
    const t = fabricIn.get(f.knit_fabric_id) ?? { kg: 0, rolls: 0 };
    t.kg += num(f.net_kg);
    t.rolls += num(f.rolls);
    fabricIn.set(f.knit_fabric_id, t);
  }
  const payIds = receiptsRaw.map((x) => x.payable_id).filter((x): x is string => !!x);
  const bills = new Map<string, number>();
  if (payIds.length) {
    const { data: pays } = await s.from("payables").select("id, total_amount").in("id", payIds);
    for (const p of (pays ?? []) as { id: string; total_amount: number }[]) bills.set(p.id, num(p.total_amount));
  }
  const r3 = (n: number) => Math.round(n * 1000) / 1000;

  const doc = {
    id: r.id as string,
    code: (r.code as string | null) ?? null,
    status: r.status as KnittingOrderStatus,
    vendor_id: r.vendor_id as string,
    vendor_name: one(r.vendor as { name: string } | null)?.name ?? null,
    sales_order_id: (r.sales_order_id as string | null) ?? null,
    order_number: one(r.so as { order_number: string | null } | null)?.order_number ?? null,
    order_date: (r.order_date as string | null) ?? null,
    expected_date: (r.expected_date as string | null) ?? null,
    allowed_loss_pct: numN(r.allowed_loss_pct),
    notes: (r.notes as string | null) ?? null,
    total_amount: num(r.total_amount),
    created_at: r.created_at as string,
    created_by: (r.created_by as string | null) ?? null,
    fabrics: fabricRows.map((f) => ({
      id: f.id,
      sno: f.sno,
      fabric_item_id: f.fabric_item_id,
      fabric_name: one(f.fabric)?.name ?? "",
      source_key: f.source_key,
      width_form: (f.width_form as KnitWidthForm | null) ?? null,
      knit_dia: f.knit_dia,
      finished_dia: f.finished_dia,
      gsm: numN(f.gsm),
      loop_length: numN(f.loop_length),
      loop_length_ref: numN(f.loop_length_ref),
      gauge_id: f.gauge_id,
      ply: f.ply,
      programmed_kg: num(f.programmed_kg),
      roll_weight_kg: numN(f.roll_weight_kg),
      expected_rolls: numN(f.expected_rolls),
      rate_per_kg: num(f.rate_per_kg),
      yarns: (f.yarns ?? [])
        .sort((a, b) => a.sno - b.sno)
        .map((y) => ({
          id: y.id,
          yarn_item_id: y.yarn_item_id,
          yarn_name: one(y.yarn)?.name ?? "",
          blend_pct: num(y.blend_pct),
          allowance_pct: num(y.allowance_pct),
          required_kg: num(y.required_kg),
          bag_weight_kg: numN(y.bag_weight_kg),
          required_bags: numN(y.required_bags),
          dispatched_kg: y.process_order_line_id ? (sentByLine.get(y.process_order_line_id) ?? 0) : 0,
          used_kg: r3(byYarn.get(y.id)?.used ?? 0),
          returned_kg: r3(byYarn.get(y.id)?.returned ?? 0),
          written_off_kg: r3(byYarn.get(y.id)?.written_off ?? 0),
          at_knitter_kg: r3(
            Math.max(
              0,
              (y.process_order_line_id ? (sentByLine.get(y.process_order_line_id) ?? 0) : 0) -
                (byYarn.get(y.id)?.used ?? 0) -
                (byYarn.get(y.id)?.returned ?? 0) -
                (byYarn.get(y.id)?.written_off ?? 0),
            ),
          ),
        })),
      received_kg: r3(fabricIn.get(f.id)?.kg ?? 0),
      received_rolls: fabricIn.get(f.id)?.rolls ?? 0,
    })),
    receipts: receiptsRaw.map((rc) => ({
      id: rc.id,
      code: rc.code,
      receipt_date: rc.receipt_date,
      vendor_dc_no: rc.vendor_dc_no,
      rolls: (rc.fabrics ?? []).reduce((t, f) => t + num(f.rolls), 0),
      fabric_kg: r3((rc.fabrics ?? []).reduce((t, f) => t + num(f.net_kg), 0)),
      returned_kg: r3(returnedByReceipt.get(rc.id) ?? 0),
      bill: rc.payable_id ? (bills.get(rc.payable_id) ?? null) : null,
    })),
    close_pending: !!r.close_pending,
    close_reason: (r.close_reason as string | null) ?? null,
    close_remark: (r.close_remark as string | null) ?? null,
    dcs: ((dcRows ?? []) as { id: string; code: string | null; dc_date: string | null; status: string }[]).map((d) => ({
      id: d.id,
      code: d.code,
      dc_date: d.dc_date,
      status: d.status,
      kg: Math.round((dcSum.get(d.id)?.kg ?? 0) * 1000) / 1000,
      bags: dcSum.get(d.id)?.bags ?? null,
    })),
  };
  const [withCreator] = await withCreators([doc]);
  return withCreator as KnittingOrder;
}

/**
 * Vendors who knit: an APPROVED master vendor with a KNITTING process on its master
 * (`master_vendor_processes` → `processes.is_knitting`). The vendor a saved order already
 * names always survives (AGENTS.md, Disabled rows).
 */
export async function getKnitters(currentVendorId?: string | null): Promise<KnitOption[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("master_vendor_processes")
    .select("vendor:master_vendors!vendor_id(id, name, status), process:processes!inner(is_knitting)")
    .eq("process.is_knitting", true);
  if (error) throw new Error(`Could not read the knitters: ${error.message}`);
  const byId = new Map<string, KnitOption>();
  for (const row of (data ?? []) as unknown as { vendor: { id: string; name: string; status: string | null } | null }[]) {
    const v = one(row.vendor);
    if (v && v.status === "Approved") byId.set(v.id, { id: v.id, name: v.name });
  }
  if (currentVendorId && !byId.has(currentVendorId)) {
    const { data: cur } = await s.from("master_vendors").select("id, name").eq("id", currentVendorId).maybeSingle();
    if (cur) byId.set(cur.id as string, { id: cur.id as string, name: cur.name as string, inactive: true });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getKnitGauges(): Promise<KnitOption[]> {
  const rows = await getGaugeRows();
  return rows.map((g) => ({ id: g.id, name: g.name, inactive: isInactive(g) }));
}

/**
 * THE FABRICS THIS ORDER NEEDS KNITTED — read off its CURRENT Fabric BOM (`currentFabricBom`,
 * the one rule every per-order report uses), one pick per fabric × DIA × width form: the same
 * split Raise PO's fabric lines use (0760), so the two screens name a slice the same way.
 *
 *  - A fabric whose BOM source BUYS the cloth (greige / dyed purchase, 0770) is not knitted
 *    by us and is not offered.
 *  - GSM is the order's (combo structure), one distinct value or nothing (0762's rule).
 *  - The blend is the fabric master's `material_mixings` — never retyped here.
 */
export async function getKnitCandidates(salesOrderId: string, excludeOrderId: string | null): Promise<KnitCandidatesResult> {
  const current = await currentFabricBom(salesOrderId);
  if ("refused" in current) return { ok: false, error: current.refused };
  const { go, bom } = current;
  const s = await createClient();

  const [reqRes, entryRes, scopeRes, structRes, elseRes] = await Promise.all([
    s.from("order_fabric_bom_requirements").select("item_id, entry_id, size_id, required_qty").eq("bom_id", bom.id),
    s.from("order_fabric_bom_manual_entries").select("id, width_form, structure_id").eq("bom_id", bom.id),
    s.from("order_fabric_bom_process_scope").select("item_id, source").eq("bom_id", bom.id),
    s
      .from("garment_order_amendment_combo_structures")
      .select("structure_id, gsm, combo:garment_order_amendment_combos!inner(amendment_id)")
      .eq("combo.amendment_id", go.id),
    s
      .from("process_order_knit_fabrics")
      .select("source_key, programmed_kg, po:process_orders!inner(id, sales_order_id, status)")
      .eq("po.sales_order_id", salesOrderId)
      .neq("po.status", "cancelled"),
  ]);
  for (const [what, res] of [
    ["the requirement", reqRes],
    ["the Manual entries", entryRes],
    ["the fabric sources", scopeRes],
    ["the order's GSM", structRes],
    ["the knitting already programmed", elseRes],
  ] as const) {
    if (res.error) return { ok: false, error: `Could not read ${what}: ${res.error.message}` };
  }

  const entries = new Map(
    ((entryRes.data ?? []) as { id: string; width_form: string | null; structure_id: string | null }[]).map((e) => [e.id, e]),
  );
  const bought = new Set(
    ((scopeRes.data ?? []) as { item_id: string; source: string | null }[])
      .filter((r) => r.source === "greige_purchase" || r.source === "dyed_purchase")
      .map((r) => r.item_id),
  );
  const gsmSeen = new Map<string, Set<number>>();
  for (const r of (structRes.data ?? []) as unknown as { structure_id: string | null; gsm: number | null }[]) {
    if (!r.structure_id || r.gsm == null) continue;
    const set = gsmSeen.get(r.structure_id) ?? new Set<number>();
    set.add(Number(r.gsm));
    gsmSeen.set(r.structure_id, set);
  }
  const gsmOf = (structureId: string | null) => {
    const set = structureId ? gsmSeen.get(structureId) : undefined;
    return set && set.size === 1 ? [...set][0] : null;
  };

  const reqs = ((reqRes.data ?? []) as { item_id: string | null; entry_id: string | null; size_id: string | null; required_qty: number | null }[]).filter(
    (r) => r.item_id && r.entry_id && r.required_qty != null && Number(r.required_qty) > 0 && !bought.has(r.item_id),
  );

  // The dia of each (entry, size) — the Manual entry's size row, as 0760 reads it.
  const entryIds = [...new Set(reqs.map((r) => r.entry_id as string))];
  const diaOf = new Map<string, string | null>();
  if (entryIds.length) {
    const { data: sizes, error: sizeErr } = await s
      .from("order_fabric_bom_manual_sizes")
      .select("entry_id, size_id, dia, sno")
      .in("entry_id", entryIds)
      .order("sno");
    if (sizeErr) return { ok: false, error: `Could not read the dias: ${sizeErr.message}` };
    for (const z of (sizes ?? []) as { entry_id: string; size_id: string | null; dia: string | null }[]) {
      const k = `${z.entry_id}|${z.size_id ?? ""}`;
      if (!diaOf.has(k)) diaOf.set(k, z.dia?.trim() ? z.dia.trim().toUpperCase() : null);
    }
  }

  const slices = new Map<string, Omit<KnitCandidate, "fabric_name" | "yarns" | "programmed_elsewhere_kg"> & { gsms: Set<number> }>();
  for (const r of reqs) {
    const e = entries.get(r.entry_id as string);
    const widthForm = (e?.width_form === "open_width" || e?.width_form === "tubular" ? e.width_form : null) as KnitWidthForm | null;
    const dia = diaOf.get(`${r.entry_id}|${r.size_id ?? ""}`) ?? null;
    const key = knitSourceKey(r.item_id as string, dia, widthForm);
    const held = slices.get(key) ?? {
      key,
      fabric_item_id: r.item_id as string,
      knit_dia: dia,
      width_form: widthForm,
      gsm: null,
      bom_kg: 0,
      gsms: new Set<number>(),
    };
    held.bom_kg += Number(r.required_qty);
    const g = gsmOf(e?.structure_id ?? null);
    if (g != null) held.gsms.add(g);
    slices.set(key, held);
  }

  const elsewhere = new Map<string, number>();
  for (const f of (elseRes.data ?? []) as unknown as { source_key: string | null; programmed_kg: number; po: { id: string } | { id: string }[] }[]) {
    if (!f.source_key || one(f.po)?.id === excludeOrderId) continue;
    elsewhere.set(f.source_key, (elsewhere.get(f.source_key) ?? 0) + num(f.programmed_kg));
  }

  const fabricIds = [...new Set([...slices.values()].map((x) => x.fabric_item_id))];
  const { compositions, yarns } = await getBomYarnComposition(fabricIds);
  const compByFabric = new Map(compositions.map((c) => [c.fabric_id, c]));
  const yarnName = new Map(yarns.map((y) => [y.id, y.name]));

  const candidates: KnitCandidate[] = [...slices.values()]
    .map(({ gsms, ...x }) => {
      const comp = compByFabric.get(x.fabric_item_id);
      return {
        ...x,
        gsm: gsms.size === 1 ? [...gsms][0] : null,
        bom_kg: Math.round(x.bom_kg * 1000) / 1000,
        fabric_name: comp?.fabric_name ?? "",
        programmed_elsewhere_kg: elsewhere.get(x.key) ?? 0,
        yarns: (comp?.components ?? []).map((c) => ({
          yarn_item_id: c.yarn_id,
          yarn_name: yarnName.get(c.yarn_id) ?? "",
          blend_pct: c.blend_pct,
        })),
      };
    })
    .sort((a, b) => a.fabric_name.localeCompare(b.fabric_name) || (a.knit_dia ?? "").localeCompare(b.knit_dia ?? ""));

  // Names for a fabric with no composition (the composition helper names only what it found).
  const unnamed = candidates.filter((c) => !c.fabric_name).map((c) => c.fabric_item_id);
  if (unnamed.length) {
    const { data: items } = await s.from("items").select("id, name").in("id", unnamed);
    const n = new Map(((items ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]));
    for (const c of candidates) if (!c.fabric_name) c.fabric_name = n.get(c.fabric_item_id) ?? "(fabric not found)";
  }

  const customer = one(go.customer as { name: string } | { name: string }[] | null)?.name ?? null;
  return {
    ok: true,
    customer,
    bom_code: bom.code,
    candidates,
    note: candidates.length
      ? null
      : bought.size
        ? "Every fabric on this order's Fabric BOM is bought as cloth — nothing to knit."
        : "This order's Fabric BOM has no fabric requirement yet — save the Fabric BOM first.",
  };
}

// ---------------------------------------------------------------------------
// KNITTING ANALYSIS — the legacy statement's rows (screenshot 4105, user 2026-11-11)
// ---------------------------------------------------------------------------

export type KnitAnalysisSheet = {
  customer: string | null;
  /** Knitting Order & Receipt — one block per KO fabric, its receipts beside it. */
  fabrics: {
    id: string;
    item: string;
    width_form: string | null;
    ordered_dia: string | null;
    ordered_kg: number;
    receipts: { grn: string | null; grn_date: string; supp_dc: string | null; supp_dt: string | null; dia: string | null; rolls: number | null; kg: number }[];
  }[];
  /** Yarn Issue & Return — DC by DC, then the returns receipt by receipt. */
  issues: { dc_id: string; doc: string | null; date: string | null; lines: { yarn: string; mill: string | null; lot: string | null; bags: number | null; kg: number }[] }[];
  returns: { receipt: string | null; date: string; supp_dc: string | null; supp_dt: string | null; yarn: string; bags: number | null; kg: number }[];
  issued_kg: number;
  fabric_kg: number;
  returned_kg: number;
  written_off_kg: number;
  /** Issued − fabric − returned (the legacy "YARN TO BE RETURNED"). */
  to_return_kg: number;
  to_return_pct: number | null;
};

export async function getKnitAnalysisSheet(doc: KnittingOrder): Promise<KnitAnalysisSheet> {
  const s = await createClient();
  const dcIds = doc.dcs.filter((d) => d.status !== "draft" && d.status !== "cancelled").map((d) => d.id);
  const [custRes, rcRes, retRes, dclRes] = await Promise.all([
    doc.sales_order_id
      ? s.from("garment_order_amendments").select("customer:customers(name)").eq("sales_order_id", doc.sales_order_id).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [], error: null }),
    s
      .from("knitting_receipts")
      .select("code, receipt_date, vendor_dc_no, vendor_dc_date, fabrics:knitting_receipt_fabrics(knit_fabric_id, received_dia, rolls, net_kg)")
      .eq("process_order_id", doc.id)
      .order("created_at", { ascending: true }),
    s
      .from("knitting_receipt_yarns")
      .select("qty_kg, bags, receipt:knitting_receipts!inner(code, receipt_date, vendor_dc_no, vendor_dc_date, created_at), yarn:items!yarn_item_id(name)")
      .eq("process_order_id", doc.id)
      .eq("kind", "returned"),
    dcIds.length
      ? s.from("dc_line_items").select("delivery_challan_id, item_id, sent_qty, bags, lot_no, sort_order").in("delivery_challan_id", dcIds).order("sort_order")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const [what, res] of [["the receipts", rcRes], ["the yarn returned", retRes], ["the yarn DCs", dclRes]] as const) {
    if (res.error) throw new Error(`Knitting Analysis — could not read ${what}: ${res.error.message}`);
  }

  // Receipts beside each KO fabric.
  type Rc = { code: string | null; receipt_date: string; vendor_dc_no: string | null; vendor_dc_date: string | null; fabrics: { knit_fabric_id: string; received_dia: string | null; rolls: number | null; net_kg: number }[] | null };
  const rcByFabric = new Map<string, KnitAnalysisSheet["fabrics"][number]["receipts"]>();
  for (const rc of (rcRes.data ?? []) as unknown as Rc[]) {
    for (const f of rc.fabrics ?? []) {
      const list = rcByFabric.get(f.knit_fabric_id) ?? [];
      list.push({ grn: rc.code, grn_date: rc.receipt_date, supp_dc: rc.vendor_dc_no, supp_dt: rc.vendor_dc_date, dia: f.received_dia, rolls: f.rolls, kg: num(f.net_kg) });
      rcByFabric.set(f.knit_fabric_id, list);
    }
  }

  // Yarn names, and the MILL: the supplier of the GRN that brought that lot in.
  const dcl = (dclRes.data ?? []) as { delivery_challan_id: string; item_id: string; sent_qty: number; bags: number | null; lot_no: string | null }[];
  const yarnIds = [...new Set(dcl.map((l) => l.item_id))];
  const lots = [...new Set(dcl.map((l) => (l.lot_no ?? "").trim().toUpperCase()).filter(Boolean))];
  const [itemRes, grnRes] = await Promise.all([
    yarnIds.length ? s.from("items").select("id, name").in("id", yarnIds) : Promise.resolve({ data: [] }),
    yarnIds.length && lots.length
      ? s
          .from("grn_line_items")
          .select("item_id, roll_batch_no, grn:grns!grn_id(vendor:master_vendors!master_vendor_id(name))")
          .in("item_id", yarnIds)
          .in("roll_batch_no", lots)
      : Promise.resolve({ data: [] }),
  ]);
  const yarnName = new Map(((itemRes.data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]));
  const millOf = new Map<string, string>();
  for (const g of (grnRes.data ?? []) as unknown as { item_id: string; roll_batch_no: string | null; grn: unknown }[]) {
    const grn = one(g.grn as { vendor: unknown } | null);
    const v = one((grn?.vendor ?? null) as { name: string } | null);
    if (v?.name && g.roll_batch_no) millOf.set(`${g.item_id}|${g.roll_batch_no.trim().toUpperCase()}`, v.name);
  }

  const issues = doc.dcs
    .filter((d) => dcIds.includes(d.id))
    .map((d) => ({
      dc_id: d.id,
      doc: d.code,
      date: d.dc_date,
      lines: dcl
        .filter((l) => l.delivery_challan_id === d.id)
        .map((l) => {
          const lot = (l.lot_no ?? "").trim().toUpperCase() || null;
          return {
            yarn: yarnName.get(l.item_id) ?? "",
            mill: lot ? (millOf.get(`${l.item_id}|${lot}`) ?? null) : null,
            lot,
            bags: l.bags == null ? null : Number(l.bags),
            kg: num(l.sent_qty),
          };
        }),
    }));

  type Ret = { qty_kg: number; bags: number | null; receipt: unknown; yarn: unknown };
  const returns = ((retRes.data ?? []) as unknown as Ret[])
    .map((r) => {
      const rc = one(r.receipt as { code: string | null; receipt_date: string; vendor_dc_no: string | null; vendor_dc_date: string | null; created_at: string } | null);
      return {
        receipt: rc?.code ?? null,
        date: rc?.receipt_date ?? "",
        supp_dc: rc?.vendor_dc_no ?? null,
        supp_dt: rc?.vendor_dc_date ?? null,
        yarn: one(r.yarn as { name: string } | null)?.name ?? "",
        bags: r.bags == null ? null : Number(r.bags),
        kg: num(r.qty_kg),
        at: rc?.created_at ?? "",
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ at: _at, ...r }) => (void _at, r));

  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const issued = r3(dcl.reduce((t, l) => t + num(l.sent_qty), 0));
  const fabric = r3(doc.fabrics.reduce((t, f) => t + f.received_kg, 0));
  const returned = r3(returns.reduce((t, r) => t + r.kg, 0));
  const off = r3(doc.fabrics.reduce((t, f) => t + f.yarns.reduce((u, y) => u + y.written_off_kg, 0), 0));
  const toReturn = r3(issued - fabric - returned);

  return {
    customer: one(((custRes.data ?? []) as unknown as { customer: { name: string } | { name: string }[] | null }[])[0]?.customer ?? null)?.name ?? null,
    fabrics: doc.fabrics.map((f) => ({
      id: f.id,
      item: f.fabric_name,
      width_form: f.width_form,
      ordered_dia: f.knit_dia,
      ordered_kg: f.programmed_kg,
      receipts: rcByFabric.get(f.id) ?? [],
    })),
    issues,
    returns,
    issued_kg: issued,
    fabric_kg: fabric,
    returned_kg: returned,
    written_off_kg: off,
    to_return_kg: toReturn,
    to_return_pct: issued > 0 ? Math.round((toReturn / issued) * 100 * 1000) / 1000 : null,
  };
}
