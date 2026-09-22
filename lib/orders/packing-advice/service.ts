import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/masters/country-service";
import type { Country } from "@/lib/masters/country-types";
import type { Deactivatable } from "@/lib/masters/inactive";
import { withCreators } from "@/lib/created-by";
import { styleKey } from "@/lib/orders/amendments/style-key";
import type { PackingAdvice } from "./types";

/** A row normalized to {id, code, name} for a RecordPicker. */
export type PickerRow = { id: string; code: string | null; name: string } & Deactivatable;

/**
 * One order as the advice needs it — everything the header and grid offer is
 * read from here (doc/order/packing list.md: "auto-fetches order details,
 * quantities, styles, and shipping destinations directly from Order Entry").
 *
 * `id` is the SALES ORDER id (the RE No the header stores); the garment order
 * behind it is one `garment_order_amendments` row.
 */
export type PackingOrder = {
  id: string;
  code: string | null;
  /** "RE No — customer", what the picker lists. */
  name: string;
  /** Draft, cancelled or closed: not offered for a NEW advice, still resolvable. */
  inactive: boolean;
  customer_id: string | null;
  /** Destinations from the Quantities tab, each with the style keys it ships. */
  destinations: { country_id: string; styles: string[] }[];
  /** The order's styles in their own order, each with its colours. */
  styles: { style_ref_no: string; combos: string[] }[];
};

const CLOSED = new Set(["cancelled", "closed"]);

/** All packing advices with their order, customer, destination and lines. */
export async function getPackingAdvices(): Promise<PackingAdvice[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("packing_advices")
    .select(
      "*, customer:customers(id,name), sales_order:sales_orders(id,order_number), " +
        "country:countries(id,name), lines:packing_advice_lines(*)",
    )
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
  if (error) throw new Error(`Packing advices could not be read: ${error.message}`);

  return withCreators(
    ((data ?? []) as unknown as PackingAdvice[]).map((r) => ({
      ...r,
      lines: [...(r.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    })),
  );
}

type OrderQueryRow = {
  is_draft: boolean;
  customer_id: string | null;
  sales_order: { id: string; order_number: string | null; status: string | null } | null;
  customer: { name: string } | null;
  styles: { sno: number | null; style_ref_no: string | null }[] | null;
  combos: { sno: number | null; style_ref_no: string | null; combo: string | null }[] | null;
  quantities: { sno: number | null; style_ref_no: string | null; country_id: string | null }[] | null;
};

const bySno = <T extends { sno: number | null }>(xs: T[] | null) =>
  [...(xs ?? [])].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0));

/**
 * Every garment order, shaped as a `PackingOrder` — or just the one behind
 * `salesOrderId`, which is how the action re-reads the order it validates
 * against rather than trusting the screen's copy.
 */
export async function listPackingOrders(salesOrderId?: string): Promise<PackingOrder[]> {
  const s = await createClient();
  let q = s
    .from("garment_order_amendments")
    .select(
      "is_draft, customer_id, " +
        "sales_order:sales_orders(id, order_number, status), customer:customers(name), " +
        "styles:garment_order_amendment_styles(sno, style_ref_no), " +
        "combos:garment_order_amendment_combos(sno, style_ref_no, combo), " +
        "quantities:garment_order_amendment_quantities(sno, style_ref_no, country_id)",
    )
    .not("sales_order_id", "is", null);
  if (salesOrderId) q = q.eq("sales_order_id", salesOrderId);
  // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error(`Orders could not be read: ${error.message}`);

  const out: PackingOrder[] = [];
  for (const r of (data ?? []) as unknown as OrderQueryRow[]) {
    if (!r.sales_order) continue;

    const combos = new Map<string, string[]>();
    for (const c of bySno(r.combos)) {
      const k = styleKey(c.style_ref_no);
      const name = c.combo?.trim();
      if (!k || !name) continue;
      const list = combos.get(k) ?? [];
      if (!list.includes(name)) list.push(name);
      combos.set(k, list);
    }

    const styles: PackingOrder["styles"] = [];
    for (const st of bySno(r.styles)) {
      const ref = st.style_ref_no?.trim();
      if (!ref || styles.some((x) => styleKey(x.style_ref_no) === styleKey(ref))) continue;
      styles.push({ style_ref_no: ref, combos: combos.get(styleKey(ref)) ?? [] });
    }

    const dest = new Map<string, Set<string>>();
    for (const q of bySno(r.quantities)) {
      if (!q.country_id) continue;
      const set = dest.get(q.country_id) ?? new Set<string>();
      const k = styleKey(q.style_ref_no);
      if (k) set.add(k);
      dest.set(q.country_id, set);
    }

    const no = r.sales_order.order_number;
    out.push({
      id: r.sales_order.id,
      code: no,
      name: [no ?? "(no RE No)", r.customer?.name].filter(Boolean).join(" — "),
      inactive: r.is_draft || CLOSED.has((r.sales_order.status ?? "").trim().toLowerCase()),
      customer_id: r.customer_id,
      destinations: [...dest].map(([country_id, set]) => ({ country_id, styles: [...set] })),
      styles,
    });
  }
  return out;
}

/** Customers for the header picker — the flag rides along (Disabled rows). */
async function getCustomerRows(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data, error } = await s.from("customers").select("id, code, name, inactive").order("name");
  if (error) throw new Error(`Customers could not be read: ${error.message}`);
  return (data ?? []) as PickerRow[];
}

export type PackingAdviceFormData = {
  orders: PackingOrder[];
  customers: PickerRow[];
  countries: Country[];
};

/** Every option list the editor needs, fetched in parallel. */
export async function getPackingAdviceFormData(): Promise<PackingAdviceFormData> {
  const [orders, customers, countries] = await Promise.all([
    listPackingOrders(),
    getCustomerRows(),
    listCountries(),
  ]);
  return { orders, customers, countries };
}
