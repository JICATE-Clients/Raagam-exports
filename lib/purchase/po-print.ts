import "server-only";
import { createClient } from "@/lib/supabase/server";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { getPurchaseOrder } from "@/lib/purchase/po-service";
import { getRequirementLines } from "@/lib/purchase/re-po/service";
import { lineDescription, lineKeyOf, withNote, type RequirementLine } from "@/lib/purchase/re-po/types";

/**
 * THE VENDOR PO PRINT (user 2026-10-27: "how the final PO print will display the item
 * notes, size breakups, yarn bags and fabric rolls"). Everything the printed purchase
 * order says, worked out once here so the sheet only draws.
 *
 * ONE ROW PER ITEM, ITS SIZES BESIDE IT — the same grouping Raise PO's grid uses. A PO
 * line is still one size (its own req_key, balance and GRN line); the print folds the
 * sizes of one item, slice, colour, unit, rate, note and GST back into one row and
 * lists them ("S 1,000 · M 2,000 · L 2,261"). The size of a line is not stored on the
 * line, so it is read from the requirement (`po_requirement_lines`, 0757) by the
 * line's own source + req_key. A line with no requirement behind it (a manual PO)
 * prints exactly as stored.
 *
 * THE DESCRIPTION IS THE ONE THE GRN WILL CARRY. The saved `description` already ends
 * "(NOTE)" (0755); a grouped row rebuilds it from the slice WITHOUT the size and the
 * same note, so the vendor reads "MAIN LABEL · WHITE (PROCESS: CUT & SEAL)" once, not
 * five times with a size in each.
 */

export type PoPrintRow = {
  key: string;
  /** RE / SWO / IWO No the line was ordered against. */
  sourceNo: string | null;
  description: string;
  /** What the sheet prints, on two lines (user 2026-10-27): the item with its note,
   *  then the colour / shade beneath it. `description` stays the one-line GRN text. */
  name: string;
  spec: string | null;
  /** Empty for an item bought without sizes. */
  sizes: { size: string; qty: number }[];
  qty: number;
  uom: string | null;
  rate: number;
  amount: number;
  gstPct: number;
  delivery: string | null;
  /** Yarn (0758) — set only when the line was bought in whole bags. */
  bags: number | null;
  bagWeight: number | null;
  /** Fabric (0758). */
  rolls: number | null;
  dia: string | null;
};

export type PoPrintData = {
  id: string;
  code: string | null;
  status: string;
  orderDate: string | null;
  /** "INR", or the import PO's own currency the rates are in. */
  currency: string;
  exchangeRate: number | null;
  gstKind: "igst" | "cgst_sgst";
  company: { name: string | null; address: string | null; unit: string | null; gstin: string | null; logo: string | null };
  vendor: { name: string | null; address: string | null; gstin: string | null };
  /** The PO's own terms, in the order the Commercial tab asks them. */
  terms: { label: string; value: string }[];
  rows: PoPrintRow[];
  taxable: number;
  /** GST split by slab, each with its amount — "CGST 6% + SGST 6%" is drawn from `pct`. */
  gstBySlab: { pct: number; amount: number }[];
  charges: { label: string; kind: "add" | "less"; amount: number }[];
  total: number;
  /** INR total of an import PO (the header's figure). */
  totalInr: number | null;
  notes: string | null;
  preparedBy: string | null;
  approvedBy: string | null;
  /** When it was approved — the digital approval stamp's date. */
  approvedAt: string | null;
};

const money = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function getPoPrint(poId: string): Promise<PoPrintData | null> {
  const po = await getPurchaseOrder(poId);
  if (!po) return null;
  const raw = po as unknown as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === "string" && (raw[k] as string).trim() ? (raw[k] as string) : null);
  const s = await createClient();

  const lines = po.lines as unknown as Record<string, unknown>[];
  const sourceIds = [
    ...new Set(lines.map((l) => (l.garment_order_id as string | null) ?? (l.iwo_id as string | null)).filter((v): v is string => !!v)),
  ];

  const vendorId = str("master_vendor_id");
  const people = [str("created_by"), str("approved_by")].filter((v): v is string => !!v);
  const uomIds = [...new Set(lines.map((l) => l.uom_id as string | null).filter((v): v is string => !!v))];

  // One round for everything the sheet names — five independent reads, never serial.
  const [reqLines, coRes, locRes, vendorRes, addrRes, peopleRes, uomRes] = await Promise.all([
    sourceIds.length ? getRequirementLines(sourceIds).catch(() => [] as RequirementLine[]) : Promise.resolve([] as RequirementLine[]),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    str("location_id") ? s.from("locations").select("name").eq("id", str("location_id")!).maybeSingle() : Promise.resolve({ data: null }),
    vendorId ? s.from("master_vendors").select("name, gst_no").eq("id", vendorId).maybeSingle() : Promise.resolve({ data: null }),
    vendorId
      ? s
          .from("master_vendor_addresses")
          .select("street, pin, config_lookups!city_id(name), states!state_id(name)")
          .eq("vendor_id", vendorId)
          .order("sno")
          .limit(1)
      : Promise.resolve({ data: [] }),
    people.length ? s.rpc("creator_names", { ids: people }) : Promise.resolve({ data: [] }),
    uomIds.length ? s.from("uoms").select("id, code").in("id", uomIds) : Promise.resolve({ data: [] }),
  ]);

  const co = (coRes.data ?? null) as Record<string, unknown> | null;
  const coStr = (k: string) => (typeof co?.[k] === "string" && (co[k] as string).trim() ? (co[k] as string) : null);
  const vendorRow = (vendorRes.data ?? null) as { name: string | null; gst_no: string | null } | null;
  const addr = ((addrRes.data ?? []) as unknown as {
    street: string | null;
    pin: string | null;
    config_lookups: { name: string | null } | null;
    states: { name: string | null } | null;
  }[])[0];
  const names = new Map(((peopleRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));
  const uomCode = new Map(((uomRes.data ?? []) as { id: string; code: string | null }[]).map((u) => [u.id, u.code]));
  const reqByKey = new Map(reqLines.map((r) => [lineKeyOf(r), r]));

  const defaultPct = num(raw.gst_pct);

  // ---- rows: fold the sizes of one item back together ----
  const byGroup = new Map<string, { row: PoPrintRow; sizeOrder: number[] }>();
  for (const l of lines) {
    const src = (l.garment_order_id as string | null) ?? (l.iwo_id as string | null);
    const reqKey = l.req_key as string | null;
    const req = src && reqKey ? reqByKey.get(`${src}::${reqKey}`) : undefined;
    const note = (l.note as string | null) ?? null;
    const qty = num(l.quantity);
    const rate = num(l.unit_price);
    const gstPct = l.gst_pct == null ? defaultPct : num(l.gst_pct);
    const bags = l.bags == null ? null : num(l.bags);
    // A sized line folds; a yarn line in bags or a fabric line with rolls stays its own row,
    // because its bags / rolls belong to it alone.
    const foldable = !!req?.size_name && bags == null && !num(l.rolls);
    const groupKey = foldable
      ? [src, req!.item_id, req!.slice_base.toUpperCase(), (req!.colour ?? "").toUpperCase(), l.uom_id, rate, note ?? "", gstPct].join("|")
      : String(l.id);
    const description = req
      ? withNote(lineDescription({ item_name: req.item_name, slice_label: foldable ? req.slice_base : req.slice_label, colour: req.colour }), note).toUpperCase()
      : String(l.description ?? "");
    const spec = req
      ? lineDescription({ item_name: "", slice_label: foldable ? req.slice_base : req.slice_label, colour: req.colour }).replace(/^ · /, "").toUpperCase() || null
      : null;
    const name = req ? withNote(req.item_name, note).toUpperCase() : description;
    const hit = byGroup.get(groupKey);
    if (hit) {
      hit.row.qty += qty;
      hit.row.amount += num(l.amount);
      if (req?.size_name) {
        hit.row.sizes.push({ size: req.size_name, qty });
        hit.sizeOrder.push(req.size_sort ?? 1e9);
      }
      const d = l.delivery_date as string | null;
      if (d && (!hit.row.delivery || d < hit.row.delivery)) hit.row.delivery = d;
      continue;
    }
    byGroup.set(groupKey, {
      row: {
        key: groupKey,
        sourceNo: req?.source_no ?? null,
        description,
        name,
        spec,
        sizes: foldable && req?.size_name ? [{ size: req.size_name, qty }] : [],
        qty,
        uom: (typeof l.uom_id === "string" ? uomCode.get(l.uom_id) : null) || req?.uom_code || null,
        rate,
        amount: num(l.amount),
        gstPct,
        delivery: (l.delivery_date as string | null) ?? null,
        bags,
        bagWeight: l.bag_weight == null ? null : num(l.bag_weight),
        rolls: l.rolls == null || !num(l.rolls) ? null : num(l.rolls),
        dia: (l.dia as string | null) ?? null,
      },
      sizeOrder: foldable && req?.size_name ? [req.size_sort ?? 1e9] : [],
    });
  }
  const rows = [...byGroup.values()].map(({ row, sizeOrder }) => {
    // The order's own size sequence (XS S M L XL), never alphabetical.
    const sizes = row.sizes.map((sz, i) => ({ sz, o: sizeOrder[i] })).sort((a, b) => a.o - b.o).map((x) => x.sz);
    return { ...row, sizes, qty: Number(row.qty.toFixed(3)), amount: money(row.amount) };
  });

  // ---- totals ----
  const taxable = money(rows.reduce((a, r) => a + r.amount, 0));
  const slabs = new Map<number, number>();
  for (const l of lines) {
    const pct = l.gst_pct == null ? defaultPct : num(l.gst_pct);
    // Lines saved after 0756 carry their own GST; earlier ones take the header's slab.
    const amt = l.gst_amount == null ? (num(l.amount) * pct) / 100 : num(l.gst_amount);
    slabs.set(pct, (slabs.get(pct) ?? 0) + amt);
  }
  const gstBySlab = [...slabs.entries()].filter(([, a]) => a > 0).sort((a, b) => a[0] - b[0]).map(([pct, amount]) => ({ pct, amount: money(amount) }));
  const fx = num(raw.exchange_rate) || null;
  const isImport = raw.po_type === "import";
  const charges = (po.additional_charges as unknown as Record<string, unknown>[]).map((c) => ({
    label: String(c.label ?? ""),
    kind: (c.charge_type === "less" ? "less" : "add") as "add" | "less",
    // An import PO's charge is in its own currency (`fgn_amount`), a local one in INR.
    amount: money(isImport ? num(c.fgn_amount) : num(c.inr_amount)),
  }));
  const chargesNet = charges.reduce((a, c) => a + (c.kind === "less" ? -1 : 1) * c.amount, 0);
  const total = money(taxable + gstBySlab.reduce((a, g) => a + g.amount, 0) + chargesNet);

  const term = (label: string, k: string) => (str(k) ? { label, value: str(k)! } : null);
  const terms = [
    term("Payment Terms", "payment_terms"),
    term("Pay Mode", "pay_mode"),
    term("Ship Mode", "ship_mode"),
    term("Ship Type", "ship_type"),
    term("Place of Delivery", "place_of_delivery"),
    term("Invoice Send To", "invoice_send_to"),
    term("VAT/GST Against", "vat_against"),
    term("Duty Against", "duty_against"),
    str("freight_type") ? { label: "Freight", value: str("freight_type") === "itemwise" ? "ITEM-WISE" : "CONSOLIDATED" } : null,
  ].filter((t): t is { label: string; value: string } => !!t);

  const address = addr
    ? [addr.street, addr.config_lookups?.name, addr.states?.name, addr.pin].filter((v) => !!v && String(v).trim()).join(", ")
    : null;

  return {
    id: po.id,
    code: str("code"),
    status: String(raw.status ?? ""),
    orderDate: str("order_date"),
    currency: (isImport ? str("foreign_currency_code") : null) ?? "INR",
    exchangeRate: isImport ? fx : null,
    gstKind: raw.gst_kind === "igst" ? "igst" : "cgst_sgst",
    company: {
      name: coStr("company_name") ?? coStr("company_short_name"),
      address: registeredAddressOf(co),
      unit: ((locRes.data ?? null) as { name: string | null } | null)?.name ?? null,
      gstin: coStr("gstin"),
      logo: letterheadLogoOf(co),
    },
    vendor: { name: vendorRow?.name ?? po.vendor_name ?? null, address: address || null, gstin: vendorRow?.gst_no ?? null },
    terms,
    rows,
    taxable,
    gstBySlab,
    charges,
    total,
    totalInr: isImport ? num(raw.total_amount) : null,
    notes: str("notes"),
    preparedBy: str("created_by") ? (names.get(str("created_by")!) ?? null) : null,
    approvedBy: str("approved_by") ? (names.get(str("approved_by")!) ?? null) : null,
    approvedAt: str("approved_at"),
  };
}
