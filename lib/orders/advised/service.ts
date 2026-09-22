import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { TBA_MATERIAL_TYPE } from "@/lib/orders/material-bom-amendment/types";
import type {
  AdvisedColour,
  AdvisedLine,
  AdvisedOrderDetail,
  AdvisedOrderRow,
  AdvisedPoLine,
} from "./types";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Each garment order's LATEST NON-DRAFT Material BOM — `recordedBomForOrder`'s
 * rule (lib/purchase/bom-ceiling-service.ts) and 0588's trigger's, so the
 * Register counts exactly the lines the PO block reads.
 *
 * ACROSS THE RE: the PO block looks at every document raised against the sales
 * order and takes the newest BOM among them, so an order is reported under the
 * document that BOM hangs off.
 */
async function latestBoms(
  s: Client,
  garmentOrderId?: string,
): Promise<
  {
    bom_id: string;
    bom_code: string | null;
    order: {
      id: string;
      code: string | null;
      sales_order_id: string | null;
      re_no: string | null;
      customer_name: string | null;
      created_at: string | null;
      created_by: string | null;
    };
  }[]
> {
  let q = s
    .from("material_bom_amendments")
    .select(
      "id, code, amendment_no, garment_order_id, " +
        // ONE FK from a Material BOM to the garment order, named anyway.
        "order:garment_order_amendments!garment_order_id(id, code, sales_order_id, created_at, created_by, " +
        "customer:customers(name), sales_order:sales_orders(order_number))",
    )
    .eq("is_draft", false)
    .not("garment_order_id", "is", null);
  if (garmentOrderId) q = q.eq("garment_order_id", garmentOrderId);
  const { data, error } = await q;
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — an empty Register reads
  // as "nothing is waiting on the buyer", the one answer that stops anyone
  // chasing a blocked purchase.
  if (error) throw new Error(`Could not read the Material BOMs: ${error.message}`);

  type Row = {
    id: string;
    code: string | null;
    amendment_no: number | null;
    order: {
      id: string;
      code: string | null;
      sales_order_id: string | null;
      created_at: string | null;
      created_by: string | null;
      customer: { name: string } | null;
      sales_order: { order_number: string | null } | null;
    } | null;
  };

  // Newest per RE (sales order), else per document.
  const best = new Map<string, Row>();
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.order) continue;
    const key = r.order.sales_order_id ?? r.order.id;
    const held = best.get(key);
    if (!held || (r.amendment_no ?? 0) > (held.amendment_no ?? 0)) best.set(key, r);
  }
  return [...best.values()].map((r) => ({
    bom_id: r.id,
    bom_code: r.code,
    order: {
      id: r.order!.id,
      code: r.order!.code,
      sales_order_id: r.order!.sales_order_id,
      re_no: r.order!.sales_order?.order_number ?? null,
      customer_name: r.order!.customer?.name ?? null,
      created_at: r.order!.created_at,
      created_by: r.order!.created_by,
    },
  }));
}

/** The Register — one row per order holding advised or converted lines. */
export async function listAdvisedOrders(): Promise<AdvisedOrderRow[]> {
  const s = await createClient();
  const boms = await latestBoms(s);
  if (boms.length === 0) return [];

  const { data, error } = await s
    .from("material_bom_amendment_items")
    .select("amendment_id, type, converted_at")
    .in("amendment_id", boms.map((b) => b.bom_id))
    .or(`type.eq."${TBA_MATERIAL_TYPE}",converted_at.not.is.null`);
  if (error) throw new Error(`Could not read the advised lines: ${error.message}`);

  const counts = new Map<string, { pending: number; converted: number }>();
  for (const r of (data ?? []) as { amendment_id: string; type: string; converted_at: string | null }[]) {
    const c = counts.get(r.amendment_id) ?? { pending: 0, converted: 0 };
    if (r.type === TBA_MATERIAL_TYPE) c.pending++;
    else if (r.converted_at) c.converted++;
    counts.set(r.amendment_id, c);
  }

  const rows = boms
    .filter((b) => counts.has(b.bom_id))
    .map((b) => ({
      id: b.order.id,
      re_no: b.order.re_no,
      order_code: b.order.code,
      customer_name: b.order.customer_name,
      bom_id: b.bom_id,
      bom_code: b.bom_code,
      created_at: b.order.created_at,
      created_by: b.order.created_by,
      ...counts.get(b.bom_id)!,
    }))
    // PENDING FIRST — a blocked purchase is the work; a finished order is history.
    .sort((a, b) => b.pending - a.pending || (a.re_no ?? "").localeCompare(b.re_no ?? ""));
  // The Created columns' data half (AGENTS.md "Created Date / Created User").
  return withCreators(rows);
}

/**
 * One order's advised lines — every line still To be advised, and every line
 * that was and has been converted (so the history stays on the screen).
 *
 * Null when the order has no recorded (non-draft) Material BOM.
 */
export async function getAdvisedOrder(garmentOrderId: string): Promise<AdvisedOrderDetail | null> {
  const s = await createClient();

  /* THE ORDER'S RE, so the newest BOM across all its documents is found — the
     route names one document, the PO block reads the RE. */
  const { data: go, error: goErr } = await s
    .from("garment_order_amendments")
    .select("id, sales_order_id")
    .eq("id", garmentOrderId)
    .maybeSingle();
  if (goErr) throw new Error(`Could not read the order: ${goErr.message}`);
  if (!go) return null;

  const all = await latestBoms(s);
  const key = (go as { sales_order_id: string | null }).sales_order_id ?? garmentOrderId;
  const bom = all.find((b) => (b.order.sales_order_id ?? b.order.id) === key);
  if (!bom) return null;

  const [itemsRes, reqRes, lookupsRes, combosRes] = await Promise.all([
    s
      .from("material_bom_amendment_items")
      .select(
        "id, amendment_id, sno, item_id, style_ref_no, type, specification, size, item_color_id, " +
          "brand, artwork_code, pending_reason, estimated_rate, consumption_uom_id, " +
          "converted_at, converted_by, " +
          "item:items(name), " +
          /* `item_color_id` AND `attribute_id` both point at config_lookups —
             the FK column is NAMED, or this whole select is a 300 (AGENTS.md). */
          "colour:config_lookups!item_color_id(name)",
      )
      .eq("amendment_id", bom.bom_id)
      .or(`type.eq."${TBA_MATERIAL_TYPE}",converted_at.not.is.null`)
      .order("sno", { ascending: true }),
    s
      .from("material_bom_amendment_requirements")
      .select("item_line_id, required_qty")
      .eq("amendment_id", bom.bom_id),
    s.from("config_lookups").select("id, code, name, is_active").eq("kind", "fabric_color").order("name"),
    s
      .from("garment_order_amendment_combos")
      .select("style_ref_no, combo")
      .eq("amendment_id", bom.order.id),
  ]);
  for (const [what, res] of [
    ["advised lines", itemsRes],
    ["requirements", reqRes],
    ["colours", lookupsRes],
    ["order colours", combosRes],
  ] as const) {
    if (res.error) throw new Error(`Could not read the ${what}: ${res.error.message}`);
  }

  type ItemRow = {
    id: string;
    amendment_id: string;
    sno: number;
    item_id: string | null;
    style_ref_no: string | null;
    type: string;
    specification: string | null;
    size: string | null;
    item_color_id: string | null;
    brand: string | null;
    artwork_code: string | null;
    pending_reason: string | null;
    estimated_rate: number | null;
    consumption_uom_id: string | null;
    converted_at: string | null;
    converted_by: string | null;
    item: { name: string } | null;
    colour: { name: string } | null;
  };
  const items = (itemsRes.data ?? []) as unknown as ItemRow[];

  // Σ required_qty per line; a refused row (NULL) makes the line's figure
  // unknown, never a smaller number.
  const required = new Map<string, number | null>();
  for (const r of (reqRes.data ?? []) as { item_line_id: string; required_qty: number | null }[]) {
    const held = required.get(r.item_line_id);
    if (held === null) continue;
    required.set(r.item_line_id, r.required_qty == null ? null : (held ?? 0) + Number(r.required_qty));
  }

  // PO lines for these materials on this RE — the PO status column.
  const itemIds = [...new Set(items.map((i) => i.item_id).filter(Boolean))] as string[];
  const poByItem = new Map<string, AdvisedPoLine[]>();
  if (itemIds.length && bom.order.sales_order_id) {
    const { data: po, error: poErr } = await s
      .from("po_line_items")
      .select("item_id, quantity, po:purchase_orders!purchase_order_id(id, code, status)")
      .eq("sales_order_id", bom.order.sales_order_id)
      .in("item_id", itemIds);
    if (poErr) throw new Error(`Could not read the purchase orders: ${poErr.message}`);
    for (const r of (po ?? []) as unknown as {
      item_id: string;
      quantity: number | null;
      po: { id: string; code: string | null; status: string | null } | null;
    }[]) {
      if (!r.po) continue;
      const list = poByItem.get(r.item_id) ?? [];
      list.push({ po_id: r.po.id, po_code: r.po.code, status: r.po.status, quantity: r.quantity == null ? null : Number(r.quantity) });
      poByItem.set(r.item_id, list);
    }
  }

  // WHO CONVERTED, by name — `creator_names()`, never a profiles embed
  // (lib/created-by.ts). A name that cannot be read is a dash, not a failure.
  const byIds = [...new Set(items.map((i) => i.converted_by).filter(Boolean))] as string[];
  const names = new Map<string, string | null>();
  if (byIds.length) {
    const { data: n, error: nErr } = await s.rpc("creator_names", { ids: byIds });
    if (!nErr) for (const p of (n ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, p.full_name);
  }

  /* THE COLOURS THE CONVERSION OFFERS — the order's own, as the MBA Item Color
     cell offers them (the `fabric_color` lookups named by the order's combos,
     all of them when the order names none that match), with any colour a line
     already holds kept so a filled field never reads empty. */
  const lookups: AdvisedColour[] = (
    (lookupsRes.data ?? []) as { id: string; code: string | null; name: string; is_active: boolean }[]
  ).map((l) => ({ ...l, inactive: !l.is_active }));
  const combos = (combosRes.data ?? []) as { style_ref_no: string | null; combo: string | null }[];
  const coloursFor = (styleRef: string | null, held: string | null): AdvisedColour[] => {
    const wanted = new Set(
      combos
        .filter((c) => !styleRef?.trim() || (c.style_ref_no ?? "").trim().toUpperCase() === styleRef.trim().toUpperCase())
        .map((c) => (c.combo ?? "").trim().toUpperCase())
        .filter(Boolean),
    );
    const narrowed = wanted.size ? lookups.filter((l) => wanted.has(l.name.trim().toUpperCase())) : [];
    const base = narrowed.length ? narrowed : lookups;
    const heldRow = held ? lookups.find((l) => l.id === held) : undefined;
    return heldRow && !base.some((l) => l.id === heldRow.id) ? [...base, heldRow] : base;
  };
  const coloursByItem: Record<string, AdvisedColour[]> = {};
  for (const i of items) {
    if (!i.item_id) continue;
    const merged = new Map((coloursByItem[i.item_id] ?? []).map((c) => [c.id, c] as const));
    for (const c of coloursFor(i.style_ref_no, i.item_color_id)) merged.set(c.id, c);
    coloursByItem[i.item_id] = [...merged.values()];
  }

  const lines: AdvisedLine[] = items.map((i) => ({
    id: i.id,
    bom_id: i.amendment_id,
    sno: i.sno,
    item_id: i.item_id,
    item_name: i.item?.name ?? null,
    style_ref_no: i.style_ref_no,
    type: i.type,
    specification: i.specification,
    size: i.size,
    item_color_id: i.item_color_id,
    item_color_name: i.colour?.name ?? null,
    brand: i.brand,
    artwork_code: i.artwork_code,
    pending_reason: i.pending_reason,
    estimated_rate: i.estimated_rate == null ? null : Number(i.estimated_rate),
    required_qty: required.has(i.id) ? (required.get(i.id) ?? null) : null,
    consumption_uom_id: i.consumption_uom_id,
    po_blocked: i.type === TBA_MATERIAL_TYPE,
    po_lines: i.item_id ? (poByItem.get(i.item_id) ?? []) : [],
    converted_at: i.converted_at,
    converted_by: i.converted_by,
    converted_by_name: i.converted_by ? (names.get(i.converted_by) ?? null) : null,
  }));

  const pending = lines.filter((l) => l.po_blocked).length;
  return {
    order: {
      id: bom.order.id,
      re_no: bom.order.re_no,
      order_code: bom.order.code,
      customer_name: bom.order.customer_name,
      bom_id: bom.bom_id,
      bom_code: bom.bom_code,
      created_at: bom.order.created_at,
      created_by: bom.order.created_by,
      pending,
      converted: lines.filter((l) => !l.po_blocked && !!l.converted_at).length,
    },
    lines,
    coloursByItem,
  };
}
