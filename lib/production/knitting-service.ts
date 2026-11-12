import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { isInactive } from "@/lib/masters/inactive";
import { currentFabricBom } from "@/lib/orders/fabric-requirement/service";
import { getBomYarnComposition, getGaugeRows } from "@/lib/orders/fabric-bom/service";
import { withYdRepeatBlend, type YdBlendRepeat } from "@/lib/orders/fabric-bom/yarn-dyed";
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
  type KnitYarnAtKnitter,
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
        "fabrics:process_order_knit_fabrics(id, sno, fabric_item_id, source_key, width_form, knit_dia, finished_dia, gsm, knit_gsm, loop_length, loop_length_ref, gauge_id, ply, programmed_kg, roll_weight_kg, expected_rolls, rate_per_kg, " +
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

  // The Yarn DCs carrying this order's lines (0832: one DC may carry several Knitting Orders,
  // so never `delivery_challans.process_order_id`) — and only THIS order's kg on each. Separate
  // reads: delivery_challans carries several FKs to the same tables (AGENTS.md "A SECOND FK").
  const dcLines = lineIds.length
    ? await s.from("dc_line_items").select("delivery_challan_id, sent_qty, bags").in("process_order_line_id", lineIds)
    : { data: [], error: null };
  const dcIds = [...new Set(((dcLines.data ?? []) as { delivery_challan_id: string }[]).map((l) => l.delivery_challan_id))];
  const { data: dcRows, error: dcListErr } = dcIds.length
    ? await s.from("delivery_challans").select("id, code, dc_date, status, created_at, knit_transfer_from").in("id", dcIds).order("created_at", { ascending: true })
    : { data: [], error: null };
  if (dcListErr) throw new Error(`Could not read the yarn DCs: ${dcListErr.message}`);
  // A paper DC (0833) names the order its yarn was moved from.
  const fromIds = [...new Set(((dcRows ?? []) as { knit_transfer_from: string | null }[]).map((d) => d.knit_transfer_from).filter((x): x is string => !!x))];
  const movedFromCode = new Map<string, string>();
  if (fromIds.length) {
    const { data: fromRows } = await s.from("process_orders").select("id, code").in("id", fromIds);
    for (const f of (fromRows ?? []) as { id: string; code: string | null }[]) movedFromCode.set(f.id, f.code ?? "another order");
  }
  if (dcLines.error) throw new Error(`Could not read the yarn DC lines: ${dcLines.error.message}`);
  const dcSum = new Map<string, { kg: number; bags: number | null }>();
  for (const l of (dcLines.data ?? []) as { delivery_challan_id: string; sent_qty: number; bags: number | null }[]) {
    const t = dcSum.get(l.delivery_challan_id) ?? { kg: 0, bags: null };
    t.kg += num(l.sent_qty);
    if (l.bags != null) t.bags = (t.bags ?? 0) + Number(l.bags);
    dcSum.set(l.delivery_challan_id, t);
  }

  // Phase 3 (0830): what came back, and where each kilo of yarn went.
  const [rcRes, kyRes] = await Promise.all([
    s
      .from("knitting_receipts")
      .select("id, kind, code, receipt_date, vendor_dc_no, created_at, payable_id, fabrics:knitting_receipt_fabrics(knit_fabric_id, rolls, net_kg)")
      .eq("process_order_id", id)
      .order("created_at", { ascending: true }),
    s.from("knitting_receipt_yarns").select("receipt_id, knit_yarn_id, kind, qty_kg").eq("process_order_id", id),
  ]);
  if (rcRes.error) throw new Error(`Could not read the fabric receipts: ${rcRes.error.message}`);
  if (kyRes.error) throw new Error(`Could not read the yarn accounting: ${kyRes.error.message}`);
  type RcRow = { id: string; kind: "fabric" | "yarn_return"; code: string | null; receipt_date: string; vendor_dc_no: string | null; payable_id: string | null; fabrics: { knit_fabric_id: string; rolls: number | null; net_kg: number }[] | null };
  const receiptsRaw = (rcRes.data ?? []) as unknown as RcRow[];
  const yarnMoves = (kyRes.data ?? []) as { receipt_id: string | null; knit_yarn_id: string; kind: "used" | "returned" | "written_off" | "transferred"; qty_kg: number }[];
  const byYarn = new Map<string, { used: number; returned: number; written_off: number; transferred: number }>();
  const returnedByReceipt = new Map<string, number>();
  for (const m of yarnMoves) {
    const t = byYarn.get(m.knit_yarn_id) ?? { used: 0, returned: 0, written_off: 0, transferred: 0 };
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
      knit_gsm: numN(f.knit_gsm) ?? numN(f.gsm),
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
          process_order_line_id: y.process_order_line_id,
          dispatched_kg: y.process_order_line_id ? (sentByLine.get(y.process_order_line_id) ?? 0) : 0,
          used_kg: r3(byYarn.get(y.id)?.used ?? 0),
          returned_kg: r3(byYarn.get(y.id)?.returned ?? 0),
          written_off_kg: r3(byYarn.get(y.id)?.written_off ?? 0),
          transferred_kg: r3(byYarn.get(y.id)?.transferred ?? 0),
          at_knitter_kg: r3(
            Math.max(
              0,
              (y.process_order_line_id ? (sentByLine.get(y.process_order_line_id) ?? 0) : 0) -
                (byYarn.get(y.id)?.used ?? 0) -
                (byYarn.get(y.id)?.returned ?? 0) -
                (byYarn.get(y.id)?.written_off ?? 0) -
                (byYarn.get(y.id)?.transferred ?? 0),
            ),
          ),
        })),
      received_kg: r3(fabricIn.get(f.id)?.kg ?? 0),
      received_rolls: fabricIn.get(f.id)?.rolls ?? 0,
    })),
    receipts: receiptsRaw.map((rc) => ({
      id: rc.id,
      kind: rc.kind,
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
    dcs: ((dcRows ?? []) as { id: string; code: string | null; dc_date: string | null; status: string; knit_transfer_from: string | null }[]).map((d) => ({
      id: d.id,
      code: d.code,
      dc_date: d.dc_date,
      status: d.status,
      moved_from: d.knit_transfer_from ? (movedFromCode.get(d.knit_transfer_from) ?? "another order") : null,
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

  const [reqRes, entryRes, scopeRes, structRes, elseRes, ydRes] = await Promise.all([
    s.from("order_fabric_bom_requirements").select("item_id, entry_id, size_id, required_qty").eq("bom_id", bom.id),
    s.from("order_fabric_bom_manual_entries").select("id, width_form, structure_id").eq("bom_id", bom.id),
    s.from("order_fabric_bom_process_scope").select("item_id, source").eq("bom_id", bom.id),
    s
      .from("garment_order_amendment_combo_structures")
      .select("structure_id, gsm, combo:garment_order_amendment_combos!inner(amendment_id)")
      .eq("combo.amendment_id", go.id),
    s
      .from("process_order_knit_fabrics")
      .select("source_key, fabric_item_id, finished_dia, width_form, programmed_kg, po:process_orders!inner(id, code, sales_order_id, status)")
      .eq("po.sales_order_id", salesOrderId)
      .neq("po.status", "cancelled"),
    // Yarn Dyed Details — a yarn-dyed fabric's blend when the master holds no Mixing %.
    s.from("order_fabric_bom_yd_repeats").select("item_id, yd_part, yarn_item_id, value").eq("bom_id", bom.id),
  ]);
  for (const [what, res] of [
    ["the requirement", reqRes],
    ["the Manual entries", entryRes],
    ["the fabric sources", scopeRes],
    ["the order's GSM", structRes],
    ["the knitting already programmed", elseRes],
    ["the Yarn Dyed Details", ydRes],
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

  const slices = new Map<string, Omit<KnitCandidate, "fabric_name" | "yarns" | "programmed_elsewhere_kg" | "placed_on"> & { gsms: Set<number> }>();
  for (const r of reqs) {
    const e = entries.get(r.entry_id as string);
    const widthForm = (e?.width_form === "open_width" || e?.width_form === "tubular" ? e.width_form : null) as KnitWidthForm | null;
    const dia = diaOf.get(`${r.entry_id}|${r.size_id ?? ""}`) ?? null;
    const key = knitSourceKey(r.item_id as string, dia, widthForm);
    const held = slices.get(key) ?? {
      key,
      fabric_item_id: r.item_id as string,
      finish_dia: dia,
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
  /* ONE PROGRAM PER FABRIC (user 2026-11-12, 0835): the slice already on another PLACED
     knitting order of this RE (not draft, not cancelled) — the first such KO's code. The key is
     the line's source_key, or for a line saved without one the same shape off its own fabric,
     finished dia and form — `knit_fabric_key` in 0835, which is the guard that counts. */
  const placedOn = new Map<string, string>();
  type ElseRow = {
    source_key: string | null;
    fabric_item_id: string;
    finished_dia: string | null;
    width_form: string | null;
    programmed_kg: number;
    po: { id: string; code: string | null; status: string } | { id: string; code: string | null; status: string }[];
  };
  for (const f of (elseRes.data ?? []) as unknown as ElseRow[]) {
    const po = one(f.po);
    if (po?.id === excludeOrderId) continue;
    const key = f.source_key || knitSourceKey(f.fabric_item_id, f.finished_dia, f.width_form);
    elsewhere.set(key, (elsewhere.get(key) ?? 0) + num(f.programmed_kg));
    if (po && po.status !== "draft" && !placedOn.has(key)) placedOn.set(key, po.code ?? "another knitting order");
  }

  const fabricIds = [...new Set([...slices.values()].map((x) => x.fabric_item_id))];
  const { compositions, yarns } = await getBomYarnComposition(fabricIds);
  /* A YARN-DYED fabric's master hides Mixing %; its blend is this BOM's Yarn Dyed Details
     (RE 22, 2026-11-12) — the same `withYdRepeatBlend` the Fabric BOM's own Save uses. */
  const compByFabric = withYdRepeatBlend(
    new Map(compositions.map((c) => [c.fabric_id, c])),
    (ydRes.data ?? []) as YdBlendRepeat[],
  );
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
        placed_on: placedOn.get(x.key) ?? null,
        // ONE YARN IS 100% THAT YARN (user 2026-11-12, RE 13: SOLID SINGLE JERSEY (34'S BCI COTTON)
        // 100% had its only yarn saved with the % blank, so every kg on the row read 0). With two
        // or more yarns a blank % stays blank — that split is not ours to guess.
        yarns: (comp?.components ?? []).map((c, _i, all) => ({
          yarn_item_id: c.yarn_id,
          yarn_name: yarnName.get(c.yarn_id) ?? "",
          // A single yarn with a 0 % is the same unassigned blend (spec §3.1), so it reads 100 too.
          blend_pct: all.length === 1 && !((c.blend_pct ?? 0) > 0) ? 100 : c.blend_pct,
        })),
      };
    })
    .sort((a, b) => a.fabric_name.localeCompare(b.fabric_name) || (a.finish_dia ?? "").localeCompare(b.finish_dia ?? ""));

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
    /** Knitting dia, then the finished dia it knits to. */
    ordered_dia: string | null;
    finish_dia: string | null;
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
      ? s
          .from("dc_line_items")
          .select("delivery_challan_id, item_id, sent_qty, bags, lot_no, sort_order")
          .in("delivery_challan_id", dcIds)
          // only this order's lines of a DC it shares with another Knitting Order (0832)
          .in("process_order_line_id", doc.fabrics.flatMap((f) => f.yarns.map((y) => y.process_order_line_id)).filter((x): x is string => !!x))
          .order("sort_order")
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
  // Yarn moved at the knitter onto another order (0833) leaves this order's issue.
  const moved = r3(doc.fabrics.reduce((t, f) => t + f.yarns.reduce((u, y) => u + y.transferred_kg, 0), 0));
  const issued = r3(dcl.reduce((t, l) => t + num(l.sent_qty), 0) - moved);
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
      finish_dia: f.finished_dia,
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

/**
 * YARN ALREADY AT THIS KNITTER (client 2026-11-11, 0833): the same yarns as this order's, at the
 * same knitter on its OTHER open Knitting Orders — what Tab 2 offers to move here without a
 * transport DC. "At the knitter" is per order line: sent on its DCs − used − returned − written
 * off − moved on (the DC lines' returned/shortage carry all four).
 */
export async function listYarnAtKnitter(doc: KnittingOrder): Promise<KnitYarnAtKnitter[]> {
  const yarnIds = [...new Set(doc.fabrics.flatMap((f) => f.yarns.map((y) => y.yarn_item_id)))];
  if (!doc.vendor_id || !yarnIds.length) return [];
  const s = await createClient();
  const { data: others, error } = await s
    .from("process_orders")
    .select(
      "id, code, so:sales_orders!sales_order_id(order_number), " +
        "fabrics:process_order_knit_fabrics(fabric:items!fabric_item_id(name), " +
        "yarns:process_order_knit_yarns(id, yarn_item_id, process_order_line_id, yarn:items!yarn_item_id(name)))",
    )
    .eq("process_type", "knitting")
    .eq("vendor_id", doc.vendor_id)
    .in("status", ["in_process", "partially_received"])
    .eq("close_pending", false)
    .neq("id", doc.id);
  if (error) throw new Error(`Yarn at the knitter: ${error.message}`);
  type Y = { id: string; yarn_item_id: string; process_order_line_id: string | null; yarn: { name: string } | { name: string }[] | null };
  type O = { id: string; code: string | null; so: unknown; fabrics: { fabric: unknown; yarns: Y[] | null }[] | null };
  const rows: (Omit<KnitYarnAtKnitter, "at_knitter_kg"> & { pol: string })[] = [];
  for (const o of (others ?? []) as unknown as O[]) {
    const re = one(o.so as { order_number: string | null } | { order_number: string | null }[] | null)?.order_number ?? null;
    for (const f of o.fabrics ?? []) {
      for (const y of f.yarns ?? []) {
        if (!y.process_order_line_id || !yarnIds.includes(y.yarn_item_id)) continue;
        rows.push({
          from_yarn_id: y.id,
          from_order_code: o.code,
          from_re_no: re,
          yarn_item_id: y.yarn_item_id,
          yarn_name: one(y.yarn)?.name ?? "",
          fabric: one(f.fabric as { name: string } | { name: string }[] | null)?.name ?? "",
          pol: y.process_order_line_id,
        });
      }
    }
  }
  if (!rows.length) return [];
  const { data: lines, error: lErr } = await s
    .from("dc_line_items")
    .select("process_order_line_id, sent_qty, returned_qty, shortage_qty, dc:delivery_challans!inner(status)")
    .in("process_order_line_id", rows.map((r) => r.pol))
    .in("dc.status", ["issued", "partially_returned"]);
  if (lErr) throw new Error(`Yarn at the knitter: ${lErr.message}`);
  const held = new Map<string, number>();
  for (const l of (lines ?? []) as unknown as { process_order_line_id: string; sent_qty: number; returned_qty: number | null; shortage_qty: number | null }[]) {
    held.set(l.process_order_line_id, (held.get(l.process_order_line_id) ?? 0) + num(l.sent_qty) - num(l.returned_qty) - num(l.shortage_qty));
  }
  return rows
    .map(({ pol, ...r }) => ({ ...r, at_knitter_kg: Math.round((held.get(pol) ?? 0) * 1000) / 1000 }))
    .filter((r) => r.at_knitter_kg > 0.0005);
}

/** One posted Fabric Receipt or Yarn Return, for its register (0831: separate menus). */
export type KnitReceiptListRow = {
  id: string;
  code: string | null;
  receipt_date: string;
  vendor_dc_no: string | null;
  order_id: string;
  order_code: string | null;
  re_no: string | null;
  knitter: string | null;
  rolls: number;
  kg: number;
  created_at: string;
  created_by: string | null;
};

/**
 * Process ▸ Knitting ▸ Fabric Receipts / Yarn Returns (client 2026-11-11: "distinct
 * screens/menus"). Each document belongs to its Knitting Order, which is where it is posted;
 * the register lists them across orders, in entry order.
 */
export async function listKnittingReceipts(kind: "fabric" | "yarn_return"): Promise<KnitReceiptListRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("knitting_receipts")
    .select(
      "id, code, receipt_date, vendor_dc_no, created_at, created_by, process_order_id, " +
        "ko:process_orders!process_order_id(code, vendor:master_vendors!vendor_id(name), so:sales_orders!sales_order_id(order_number)), " +
        "fabrics:knitting_receipt_fabrics(rolls, net_kg), yarns:knitting_receipt_yarns(kind, qty_kg)",
    )
    .eq("kind", kind)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read the knitting ${kind === "fabric" ? "receipts" : "yarn returns"}: ${error.message}`);
  type R = {
    id: string; code: string | null; receipt_date: string; vendor_dc_no: string | null; created_at: string; created_by: string | null;
    process_order_id: string; ko: unknown;
    fabrics: { rolls: number | null; net_kg: number }[] | null; yarns: { kind: string; qty_kg: number }[] | null;
  };
  return withCreators(
    ((data ?? []) as unknown as R[]).map((r) => {
      const ko = one(r.ko as { code: string | null; vendor: unknown; so: unknown } | null);
      return {
        id: r.id,
        code: r.code,
        receipt_date: r.receipt_date,
        vendor_dc_no: r.vendor_dc_no,
        order_id: r.process_order_id,
        order_code: ko?.code ?? null,
        re_no: one(ko?.so as { order_number: string | null } | null)?.order_number ?? null,
        knitter: one(ko?.vendor as { name: string } | null)?.name ?? null,
        rolls: (r.fabrics ?? []).reduce((t, f) => t + num(f.rolls), 0),
        kg:
          kind === "fabric"
            ? Math.round((r.fabrics ?? []).reduce((t, f) => t + num(f.net_kg), 0) * 1000) / 1000
            : Math.round((r.yarns ?? []).filter((y) => y.kind === "returned").reduce((t, y) => t + num(y.qty_kg), 0) * 1000) / 1000,
        created_at: r.created_at,
        created_by: r.created_by,
      };
    }),
  );
}

/** One posted Fabric Receipt / Yarn Return, with its lines — the read-only document screen. */
export type KnitReceiptDoc = {
  id: string;
  kind: "fabric" | "yarn_return";
  code: string | null;
  receipt_date: string;
  vendor_dc_no: string | null;
  vendor_dc_date: string | null;
  vehicle_no: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  order_id: string;
  order_code: string | null;
  re_no: string | null;
  knitter: string | null;
  fabrics: { id: string; fabric: string; rolls: number | null; net_kg: number; gross_kg: number | null; dia: string | null; store: string | null; bin: string | null; lot: string | null }[];
  yarns: { id: string; yarn: string; kind: "used" | "returned" | "written_off"; qty_kg: number; bags: number | null; lot: string | null; store: string | null; bin: string | null; reason: string | null }[];
};

/**
 * Open a posted receipt or return (user 2026-11-12: "need to show the exact screen for the
 * receipt and return") — the register had no way into the document it listed.
 */
export async function getKnittingReceiptDoc(id: string): Promise<KnitReceiptDoc | null> {
  const s = await createClient();
  const { data, error } = await s
    .from("knitting_receipts")
    .select(
      "id, kind, code, receipt_date, vendor_dc_no, vendor_dc_date, vehicle_no, notes, created_at, created_by, process_order_id, " +
        "ko:process_orders!process_order_id(code, vendor:master_vendors!vendor_id(name), so:sales_orders!sales_order_id(order_number)), " +
        "fabrics:knitting_receipt_fabrics!receipt_id(id, rolls, net_kg, gross_kg, received_dia, lot_no, sort_order, item:items!fabric_item_id(name), store:stores!store_id(name), bin:bins!bin_id(bin_code)), " +
        "yarns:knitting_receipt_yarns!receipt_id(id, kind, qty_kg, bags, lot_no, reason, created_at, item:items!yarn_item_id(name), store:stores!store_id(name), bin:bins!bin_id(bin_code))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the knitting receipt: ${error.message}`);
  if (!data) return null;
  type Named = { name: string } | null;
  type R = {
    id: string; kind: "fabric" | "yarn_return"; code: string | null; receipt_date: string; vendor_dc_no: string | null;
    vendor_dc_date: string | null; vehicle_no: string | null; notes: string | null; created_at: string; created_by: string | null;
    process_order_id: string; ko: unknown;
    fabrics: { id: string; rolls: number | null; net_kg: number; gross_kg: number | null; received_dia: string | null; lot_no: string | null; sort_order: number; item: unknown; store: unknown; bin: unknown }[] | null;
    yarns: { id: string; kind: "used" | "returned" | "written_off"; qty_kg: number; bags: number | null; lot_no: string | null; reason: string | null; created_at: string; item: unknown; store: unknown; bin: unknown }[] | null;
  };
  const r = data as unknown as R;
  const ko = one(r.ko as { code: string | null; vendor: unknown; so: unknown } | null);
  const [doc] = await withCreators([
    {
      id: r.id,
      kind: r.kind,
      code: r.code,
      receipt_date: r.receipt_date,
      vendor_dc_no: r.vendor_dc_no,
      vendor_dc_date: r.vendor_dc_date,
      vehicle_no: r.vehicle_no,
      notes: r.notes,
      created_at: r.created_at,
      created_by: r.created_by,
      order_id: r.process_order_id,
      order_code: ko?.code ?? null,
      re_no: one(ko?.so as { order_number: string | null } | null)?.order_number ?? null,
      knitter: one(ko?.vendor as Named)?.name ?? null,
      fabrics: [...(r.fabrics ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((f) => ({
          id: f.id,
          fabric: one(f.item as Named)?.name ?? "—",
          rolls: f.rolls,
          net_kg: num(f.net_kg),
          gross_kg: numN(f.gross_kg),
          dia: f.received_dia,
          store: one(f.store as Named)?.name ?? null,
          bin: one(f.bin as { bin_code: string } | null)?.bin_code ?? null,
          lot: f.lot_no,
        })),
      yarns: [...(r.yarns ?? [])]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((y) => ({
          id: y.id,
          yarn: one(y.item as Named)?.name ?? "—",
          kind: y.kind,
          qty_kg: num(y.qty_kg),
          bags: y.bags,
          lot: y.lot_no,
          store: one(y.store as Named)?.name ?? null,
          bin: one(y.bin as { bin_code: string } | null)?.bin_code ?? null,
          reason: y.reason,
        })),
    } satisfies KnitReceiptDoc,
  ]);
  return doc;
}
