import "server-only";
import { createClient } from "@/lib/supabase/server";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { getRequirementLines } from "./service";
import { lineKeyOf, SOURCE_KIND_LABEL, type SourceKind } from "./types";

/**
 * RE PURCHASE STATUS — the report a pending row's Report icon opens on Raise PO
 * (client 2026-10-30: "if I click the report icon it went to the order, but I
 * clicked it on PO — it should show the PO of the item"). One RE / SWO / IWO:
 * every item it needs, the POs raised against each, and what is still to buy.
 *
 * Required / Ordered / Balance are the requirement sheet's own figures
 * (`po_requirement_lines`, 0737), so this page and Raise PO can never disagree.
 * The PO beside each line is matched the way `savePoFromRequirement` wrote it —
 * the PO line's source (`garment_order_id` / `iwo_id`) plus its `req_key`.
 *
 * Plain reads, no embed: `purchase_orders` → vendors is on the ambiguous list
 * (AGENTS.md, "A second FK breaks every existing embed").
 */

export type PurchaseStatusPo = {
  poId: string;
  code: string | null;
  vendor: string | null;
  status: string;
  qty: number;
  rate: number;
};

export type PurchaseStatusLine = {
  key: string;
  item: string;
  /** "WHITE · L" — the colour / size slice, blank on a plain item. */
  slice: string;
  itemClass: string | null;
  uom: string | null;
  required: number;
  ordered: number;
  balance: number;
  pos: PurchaseStatusPo[];
};

export type PurchaseStatus = {
  sourceId: string;
  sourceNo: string;
  kindLabel: string;
  customer: string | null;
  deliveryDate: string | null;
  company: { name: string | null; address: string | null; logo: string | null };
  lines: PurchaseStatusLine[];
  /** Distinct POs raised against this source (cancelled left out). */
  poCount: number;
};

const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function getRePurchaseStatus(sourceId: string): Promise<PurchaseStatus | null> {
  const s = await createClient();
  const [reqLines, poLinesRes, coRes] = await Promise.all([
    getRequirementLines([sourceId]),
    s
      .from("po_line_items")
      .select("purchase_order_id, req_key, quantity, unit_price, garment_order_id, iwo_id")
      .or(`garment_order_id.eq.${sourceId},iwo_id.eq.${sourceId}`)
      .not("req_key", "is", null),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
  ]);
  if (reqLines.length === 0) return null;
  if (poLinesRes.error) throw new Error(`Could not read the PO lines: ${poLinesRes.error.message}`);

  type PoLine = { purchase_order_id: string; req_key: string; quantity: number | null; unit_price: number | null };
  const poLines = (poLinesRes.data ?? []) as PoLine[];
  const poIds = [...new Set(poLines.map((l) => l.purchase_order_id))];

  const posRes = poIds.length
    ? await s.from("purchase_orders").select("id, code, status, master_vendor_id").in("id", poIds)
    : { data: [], error: null };
  if (posRes.error) throw new Error(`Could not read the POs: ${posRes.error.message}`);
  // A cancelled PO buys nothing, so it is not named against a line.
  const pos = ((posRes.data ?? []) as { id: string; code: string | null; status: string; master_vendor_id: string | null }[]).filter(
    (p) => p.status !== "cancelled",
  );
  const vendorIds = [...new Set(pos.map((p) => p.master_vendor_id).filter((v): v is string => !!v))];
  const vendorsRes = vendorIds.length
    ? await s.from("master_vendors").select("id, name").in("id", vendorIds)
    : { data: [], error: null };
  if (vendorsRes.error) throw new Error(`Could not read the vendors: ${vendorsRes.error.message}`);
  const vendorName = new Map(((vendorsRes.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
  const poOf = new Map(pos.map((p) => [p.id, p]));

  const posByKey = new Map<string, PurchaseStatusPo[]>();
  for (const l of poLines) {
    const p = poOf.get(l.purchase_order_id);
    if (!p) continue;
    const k = lineKeyOf({ source_id: sourceId, req_key: l.req_key });
    const list = posByKey.get(k) ?? [];
    list.push({
      poId: p.id,
      code: p.code,
      vendor: p.master_vendor_id ? (vendorName.get(p.master_vendor_id) ?? null) : null,
      status: p.status,
      qty: num(l.quantity),
      rate: num(l.unit_price),
    });
    posByKey.set(k, list);
  }

  const first = reqLines[0];
  const co = (coRes.data ?? null) as Record<string, unknown> | null;
  const coName = (k: string) => (typeof co?.[k] === "string" && (co[k] as string).trim() ? (co[k] as string) : null);

  return {
    sourceId,
    sourceNo: first.source_no,
    kindLabel: SOURCE_KIND_LABEL[first.source_kind as SourceKind] ?? "RE",
    customer: first.customer,
    deliveryDate: first.delivery_date,
    company: { name: coName("company_name") ?? coName("company_short_name"), address: registeredAddressOf(co), logo: letterheadLogoOf(co) },
    lines: reqLines
      .map((l) => ({
        key: lineKeyOf(l),
        item: l.item_name,
        slice: l.slice_label,
        itemClass: l.item_class,
        uom: l.uom_code,
        required: l.required_qty,
        ordered: l.ordered_qty,
        balance: l.balance_qty,
        pos: posByKey.get(lineKeyOf(l)) ?? [],
      }))
      .sort((a, b) => (a.itemClass ?? "").localeCompare(b.itemClass ?? "") || a.item.localeCompare(b.item) || a.slice.localeCompare(b.slice)),
    poCount: pos.length,
  };
}
