import "server-only";
import { createClient } from "@/lib/supabase/server";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";

/**
 * THE REJECTION DC, AS PRINTED — with the Debit Note copy that travels with it
 * (doc/purchase/grn.md §2B: "a Rejection DC to send materials back to the vendor alongside
 * the Debit Note copy"; grn-plan.md Phase 4).
 *
 * One document per Rejection DC a posted GRN raised (0780): who it goes back to, which GRN
 * and which of the vendor's invoices it is against, each rejected line with its reason and
 * whether the vendor is to REPLACE it or it is RETURNED for credit, and the debit note the
 * rejection raised. Rates are the PO's own — the vendor billed at them.
 *
 * Reads are separate, never embeds: grns ↔ vendor_returns point at each other (0780) and
 * po_line_items carries two FKs to uoms — both PGRST201 as a bare embed.
 */

export type RejectionPrintLine = {
  key: string;
  description: string;
  qty: number;
  uom: string | null;
  rate: number;
  gstPct: number;
  amount: number;
  reason: string | null;
  action: "replace" | "return";
  replaced: number;
};

export type RejectionPrintData = {
  id: string;
  code: string | null;
  status: string;
  returnDate: string | null;
  fromGrn: boolean;
  /** 0781: a Rejection DC (debited, not resent) or a Replacement DC (resent, no debit). */
  dcKind: "rejection" | "replacement";
  company: { name: string | null; address: string | null; unit: string | null; gstin: string | null; logo: string | null };
  vendor: { name: string | null; address: string | null; gstin: string | null };
  grn: { code: string | null; date: string | null; invoiceNo: string | null; invoiceDate: string | null; dcNo: string | null } | null;
  poCodes: string[];
  lines: RejectionPrintLine[];
  taxable: number;
  total: number;
  debitNote: { code: string | null; amount: number; status: string; reason: string | null; date: string | null } | null;
  preparedBy: string | null;
};

export async function getRejectionPrint(vendorReturnId: string): Promise<RejectionPrintData | null> {
  const s = await createClient();
  const { data: doc } = await s.from("vendor_returns").select("*").eq("id", vendorReturnId).maybeSingle();
  if (!doc) return null;
  const d = doc as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" && (d[k] as string).trim() ? (d[k] as string) : null);
  const vendorId = str("master_vendor_id");
  const grnId = str("grn_id");

  const [linesRes, grnRes, dnRes, coRes, vendorRes, addrRes, storeRes, peopleRes] = await Promise.all([
    s
      .from("vendor_return_lines")
      .select("id, item_id, return_qty, replacement_qty, rejection_action, grn_line_id, po_line_item_id, sort_order")
      .eq("vendor_return_id", vendorReturnId)
      .order("sort_order"),
    grnId
      ? s.from("grns").select("code, grn_date, invoice_no, invoice_date, dc_no").eq("id", grnId).maybeSingle()
      : Promise.resolve({ data: null }),
    str("debit_note_id")
      ? s.from("finance_notes").select("code, amount, status, reason, note_date").eq("id", str("debit_note_id")!).maybeSingle()
      : Promise.resolve({ data: null }),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    vendorId ? s.from("master_vendors").select("name, gst_no").eq("id", vendorId).maybeSingle() : Promise.resolve({ data: null }),
    vendorId
      ? s
          .from("master_vendor_addresses")
          .select("street, pin, config_lookups!city_id(name), states!state_id(name)")
          .eq("vendor_id", vendorId)
          .order("sno")
          .limit(1)
      : Promise.resolve({ data: [] }),
    s.from("stores").select("location_id, locations(name)").eq("id", str("store_id") ?? "").maybeSingle(),
    str("created_by") ? s.rpc("creator_names", { ids: [str("created_by")!] }) : Promise.resolve({ data: [] }),
  ]);

  const rows = (linesRes.data ?? []) as {
    id: string;
    item_id: string;
    return_qty: number;
    replacement_qty: number;
    rejection_action: string | null;
    grn_line_id: string | null;
    po_line_item_id: string | null;
  }[];
  const grnLineIds = rows.map((r) => r.grn_line_id).filter((v): v is string => !!v);
  const poLineIds = rows.map((r) => r.po_line_item_id).filter((v): v is string => !!v);
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  const [glRes, plRes, itemRes] = await Promise.all([
    grnLineIds.length
      ? s.from("grn_line_items").select("id, description, rejection_reason").in("id", grnLineIds)
      : Promise.resolve({ data: [] }),
    poLineIds.length
      ? s.from("po_line_items").select("id, unit_price, gst_pct, uom_id, purchase_order_id").in("id", poLineIds)
      : Promise.resolve({ data: [] }),
    itemIds.length ? s.from("items").select("id, name").in("id", itemIds) : Promise.resolve({ data: [] }),
  ]);
  const gl = new Map(((glRes.data ?? []) as { id: string; description: string; rejection_reason: string | null }[]).map((x) => [x.id, x]));
  const pls = (plRes.data ?? []) as { id: string; unit_price: number | null; gst_pct: number | null; uom_id: string | null; purchase_order_id: string }[];
  const pl = new Map(pls.map((x) => [x.id, x]));
  const itemName = new Map(((itemRes.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  const uomIds = [...new Set(pls.map((x) => x.uom_id).filter((v): v is string => !!v))];
  const poIds = [...new Set(pls.map((x) => x.purchase_order_id))];
  const [uomRes, poRes] = await Promise.all([
    uomIds.length ? s.from("uoms").select("id, code").in("id", uomIds) : Promise.resolve({ data: [] }),
    poIds.length ? s.from("purchase_orders").select("id, code").in("id", poIds) : Promise.resolve({ data: [] }),
  ]);
  const uom = new Map(((uomRes.data ?? []) as { id: string; code: string }[]).map((x) => [x.id, x.code]));

  const lines: RejectionPrintLine[] = rows.map((r) => {
    const g = r.grn_line_id ? gl.get(r.grn_line_id) : undefined;
    const p = r.po_line_item_id ? pl.get(r.po_line_item_id) : undefined;
    const qty = Number(r.return_qty) || 0;
    const rate = Number(p?.unit_price) || 0;
    return {
      key: r.id,
      description: g?.description ?? itemName.get(r.item_id) ?? "—",
      qty,
      uom: p?.uom_id ? (uom.get(p.uom_id) ?? null) : null,
      rate,
      gstPct: Number(p?.gst_pct) || 0,
      amount: Math.round(qty * rate * 100) / 100,
      reason: g?.rejection_reason ?? null,
      action: r.rejection_action === "return" ? "return" : "replace",
      replaced: Number(r.replacement_qty) || 0,
    };
  });
  const taxable = lines.reduce((a, l) => a + l.amount, 0);
  const total = lines.reduce((a, l) => a + Math.round(l.amount * (1 + l.gstPct / 100) * 100) / 100, 0);

  const co = (coRes.data ?? null) as Record<string, unknown> | null;
  const coStr = (k: string) => (typeof co?.[k] === "string" && (co[k] as string).trim() ? (co[k] as string) : null);
  const v = (vendorRes.data ?? null) as { name: string | null; gst_no: string | null } | null;
  const addr = ((addrRes.data ?? []) as unknown as {
    street: string | null;
    pin: string | null;
    config_lookups: { name: string | null } | null;
    states: { name: string | null } | null;
  }[])[0];
  const address = addr
    ? [addr.street, addr.config_lookups?.name, addr.states?.name, addr.pin].filter((x) => !!x && String(x).trim()).join(", ")
    : null;
  const grn = (grnRes.data ?? null) as {
    code: string | null;
    grn_date: string | null;
    invoice_no: string | null;
    invoice_date: string | null;
    dc_no: string | null;
  } | null;
  const dn = (dnRes.data ?? null) as { code: string | null; amount: number; status: string; reason: string | null; note_date: string | null } | null;
  const unit = (storeRes.data as { locations: { name: string | null } | null } | null)?.locations?.name ?? null;

  return {
    id: vendorReturnId,
    code: str("code"),
    status: String(d.status ?? ""),
    returnDate: str("return_date"),
    fromGrn: !!grnId,
    // Before 0781 a DC had no kind: it is a Replacement DC only if every line is "replace"
    // and it carries no debit note.
    dcKind:
      str("dc_kind") === "replacement" ||
      (!str("dc_kind") && !str("debit_note_id") && lines.length > 0 && lines.every((l) => l.action === "replace"))
        ? "replacement"
        : "rejection",
    company: {
      name: coStr("company_name") ?? coStr("company_short_name"),
      address: registeredAddressOf(co),
      unit,
      gstin: coStr("gstin"),
      logo: letterheadLogoOf(co),
    },
    vendor: { name: v?.name ?? null, address: address || null, gstin: v?.gst_no ?? null },
    grn: grn
      ? { code: grn.code, date: grn.grn_date, invoiceNo: grn.invoice_no, invoiceDate: grn.invoice_date, dcNo: grn.dc_no }
      : null,
    poCodes: ((poRes.data ?? []) as { code: string | null }[]).map((x) => x.code).filter((c): c is string => !!c),
    lines,
    taxable,
    total,
    debitNote: dn ? { code: dn.code, amount: Number(dn.amount) || 0, status: dn.status, reason: dn.reason, date: dn.note_date } : null,
    preparedBy: ((peopleRes.data ?? []) as { full_name: string | null }[])[0]?.full_name ?? null,
  };
}
