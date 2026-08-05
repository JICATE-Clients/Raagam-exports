import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCustomers } from "@/lib/masters/customer-service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listVendorNominations, listVendorsForPicker } from "@/lib/masters/vendor-service";
import type { VendorNomination } from "@/lib/masters/vendor-nominations";
import type { Customer } from "@/lib/masters/customer-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { MaterialBomAmendment } from "./types";
import { isInactive } from "@/lib/masters/inactive";
import { withCreators } from "@/lib/created-by";

/** Accepted order for the BOM amendment picker. */
export type AcceptedOrderRow = {
  id: string;
  order_number: string | null;
  created_at: string;
  ship_date: string | null;
  order_qty: number;
  status: string;
  buyer_name: string | null;
};

async function getAcceptedOrdersForBom(): Promise<AcceptedOrderRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("sales_orders")
    .select("id, order_number, created_at, ship_date, order_qty, status, buyers(name)")
    .not("status", "in", "(cancelled,closed)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as {
    id: string;
    order_number: string | null;
    created_at: string;
    ship_date: string | null;
    order_qty: number;
    status: string;
    buyers: { name: string } | null;
  }[]).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    created_at: o.created_at,
    ship_date: o.ship_date,
    order_qty: o.order_qty,
    status: o.status,
    buyer_name: o.buyers?.name ?? null,
  }));
}

/** Shaped for `RecordPicker` — `inactive` included so a retired material, UOM or
 *  vendor stops being offered while the BOM lines that already name it still
 *  read (AGENTS.md, "Disabled rows"). */
export type PickerRow = { id: string; code: string | null; name: string; inactive: boolean };

/** A material's pack size, e.g. "1 Cone = 2,500 MTR" (0348). Fetched flat for
 *  every material and filtered client-side by item_id, so changing the item on
 *  a BOM line re-populates the pack picker without a round trip. */
export type MbaConversionRow = {
  id: string;
  item_id: string;
  alt_qty: number | null;
  alt_uom_id: string | null;
  base_qty: number | null;
  base_uom_id: string | null;
};

async function getConversionRows(): Promise<MbaConversionRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_uom_conversions")
    .select("id, item_id, alt_qty, alt_uom_id, base_qty, base_uom_id")
    .order("sno");
  return (data ?? []) as MbaConversionRow[];
}

/** All amendments with embedded order + customer + child grids. */
export async function listMaterialBomAmendments(): Promise<MaterialBomAmendment[]> {
  const s = await createClient();
  const { data } = await s
    .from("material_bom_amendments")
    .select(
      "*, sales_orders(id, order_number, order_qty), customer:customers(id,code,name), " +
        "items:material_bom_amendment_items(*), " +
        "processes:material_bom_amendment_processes(*)",
    )
    .order("created_at", { ascending: false });

  return withCreators(((data ?? []) as unknown as MaterialBomAmendment[]).map((r) => ({
    ...r,
    items: [...(r.items ?? [])].sort((a, b) => a.sno - b.sno),
    processes: [...(r.processes ?? [])].sort((a, b) => a.sno - b.sno),
  })));
}

async function pickerRows(table: string): Promise<PickerRow[]> {
  const s = await createClient();
  // `items` spells the flag `is_active`; normalized here so the shape handed to
  // the screen is the same one every other option list uses.
  const { data } = await s.from(table).select("id, code, name, is_active").order("name");
  return ((data ?? []) as (Omit<PickerRow, "inactive"> & { is_active: boolean })[]).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    inactive: isInactive(r),
  }));
}

/** UOM plus its decimal precision, needed to render a purchase quantity.
 *
 *  NB `decimal_places_allowed` (0309, defaults 2), NOT `decimal_places` (0224,
 *  defaults 0 and is 0 for every row in the live DB). The client chose exact
 *  decimals over rounding up to whole packs — 16.67 Gross, not 17 — and
 *  `decimal_places` would silently reinstate the round-up on every unit. */
export type UomRow = PickerRow & { decimal_places_allowed: number | null };

async function getUomRows(): Promise<UomRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("uoms")
    .select("id, code, name, decimal_places_allowed, is_active")
    .order("name");
  return ((data ?? []) as (Omit<UomRow, "inactive"> & { is_active: boolean })[]).map((r) => ({
    ...r,
    inactive: isInactive(r),
  }));
}

/**
 * Nominations moved to `lib/masters/vendor-nominations.ts` — MBA was the only
 * screen reading them, and the narrowing rule now has to be identical on Order
 * Trims and Accessory BOM too. Re-exported so this module's shape is unchanged.
 */
export type { VendorNomination } from "@/lib/masters/vendor-nominations";

/**
 * The Vendor MASTER (`master_vendors`), NOT the purchase-side `public.vendors`.
 *
 * Both halves of this field had to move together: `customer_nominated_vendors`
 * points at `master_vendors` (0376), so narrowing this picker to a customer's
 * nominations means it now offers `master_vendors.id` — and 0377 repointed
 * `material_bom_amendment_items.vendor_id` to match. Reading `vendors` here
 * would offer ids the FK rejects on every save.
 *
 * The rest of Purchase (POs, GRNs, RFQs) still reads `public.vendors`; its FKs
 * are there. See `lib/masters/vendor-service.ts` for why the two coexist.
 */
async function getVendorRows(): Promise<PickerRow[]> {
  return listVendorsForPicker();
}

export type MbaFormData = {
  orders: AcceptedOrderRow[];
  customers: Customer[];
  items: PickerRow[];
  vendors: PickerRow[];
  /** Every customer's nominated / recommended vendors — see `VendorNomination`. */
  nominations: VendorNomination[];
  uoms: UomRow[];
  conversions: MbaConversionRow[];
  lookups: ConfigLookup[];
};

/** Every picker option list the amendment editor needs, fetched in parallel. */
export async function getMbaFormData(): Promise<MbaFormData> {
  const [orders, customers, items, vendors, nominations, uoms, conversions, lookups] =
    await Promise.all([
      getAcceptedOrdersForBom(),
      listCustomers(),
      pickerRows("items"),
      getVendorRows(),
      listVendorNominations(),
      getUomRows(),
      getConversionRows(),
      listConfigLookups(),
    ]);
  return { orders, customers, items, vendors, nominations, uoms, conversions, lookups };
}
