import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Grn, GrnLineItem, DeliveryChallan, DcLineItem, Vendor } from "./types";
import { poLineOpenBalance } from "./types";
import type { Item, Uom } from "@/lib/masters/types";

// ---------- enriched types ----------

export type GrnWithVendor = Grn & {
  vendors: Pick<Vendor, "id" | "name"> | null;
  line_count: number;
};

/** A PO line that still has open quantity available to receive. */
export type OpenPoLine = {
  id: string;
  purchase_order_id: string;
  po_code: string | null;
  vendor_id: string;
  vendor_name: string;
  description: string;
  quantity: number;
  received_qty: number;
  open_balance: number;
  uom_id: string | null;
};

export type GrnLineWithPo = GrnLineItem & {
  po_code: string | null;
};

export type DcWithVendor = DeliveryChallan & {
  vendors: Pick<Vendor, "id" | "name"> | null;
  outstanding_qty: number;
};

export type DcDetail = DeliveryChallan & {
  vendors: Pick<Vendor, "id" | "name"> | null;
};

// ---------- GRN ----------

export async function listGrns(): Promise<GrnWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("grns")
    .select("*, vendors(id, name)")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as (Grn & {
    vendors: Pick<Vendor, "id" | "name"> | null;
  })[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: lineCounts } = await supabase
    .from("grn_line_items")
    .select("grn_id")
    .in("grn_id", ids);

  const countMap: Record<string, number> = {};
  for (const lc of (lineCounts ?? []) as { grn_id: string }[]) {
    countMap[lc.grn_id] = (countMap[lc.grn_id] ?? 0) + 1;
  }

  return rows.map((r) => ({ ...r, line_count: countMap[r.id] ?? 0 }));
}

export async function getGrn(id: string): Promise<GrnWithVendor | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("grns")
    .select("*, vendors(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as Grn & {
    vendors: Pick<Vendor, "id" | "name"> | null;
  };
  return { ...row, line_count: 0 };
}

export async function getGrnLines(grnId: string): Promise<GrnLineWithPo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("grn_line_items")
    .select("*, purchase_orders(code)")
    .eq("grn_id", grnId)
    .order("sort_order");

  return (
    (data ?? []) as unknown as (GrnLineItem & {
      purchase_orders: { code: string | null } | null;
    })[]
  ).map((row) => ({
    ...row,
    po_code: row.purchase_orders?.code ?? null,
  }));
}

/**
 * Returns all PO lines from approved/partially_received POs that still have
 * open balance. Optionally filtered by vendor.
 */
export async function getOpenPoLines(vendorId?: string): Promise<OpenPoLine[]> {
  const supabase = await createClient();

  let poQuery = supabase
    .from("purchase_orders")
    .select("id, code, vendor_id, vendors(id, name)")
    .in("status", ["approved", "partially_received"]);

  if (vendorId) {
    poQuery = poQuery.eq("vendor_id", vendorId);
  }

  const { data: posData } = await poQuery;
  const pos = (posData ?? []) as unknown as {
    id: string;
    code: string | null;
    vendor_id: string;
    vendors: { id: string; name: string } | null;
  }[];

  if (pos.length === 0) return [];

  const poIds = pos.map((p) => p.id);
  const poMap = new Map(pos.map((p) => [p.id, p]));

  const { data: linesData } = await supabase
    .from("po_line_items")
    .select("id, purchase_order_id, description, quantity, received_qty, uom_id")
    .in("purchase_order_id", poIds);

  const lines = (linesData ?? []) as {
    id: string;
    purchase_order_id: string;
    description: string;
    quantity: number;
    received_qty: number;
    uom_id: string | null;
  }[];

  return lines
    .map((line) => {
      const po = poMap.get(line.purchase_order_id);
      const open_balance = poLineOpenBalance({
        quantity: line.quantity,
        received_qty: line.received_qty,
      });
      return {
        id: line.id,
        purchase_order_id: line.purchase_order_id,
        po_code: po?.code ?? null,
        vendor_id: po?.vendor_id ?? "",
        vendor_name: po?.vendors?.name ?? "",
        description: line.description,
        quantity: line.quantity,
        received_qty: line.received_qty,
        open_balance,
        uom_id: line.uom_id,
      };
    })
    .filter((l) => l.open_balance > 0);
}

// ---------- DC ----------

export async function listDcs(): Promise<DcWithVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("delivery_challans")
    .select("*, vendors(id, name)")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as (DeliveryChallan & {
    vendors: Pick<Vendor, "id" | "name"> | null;
  })[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: linesData } = await supabase
    .from("dc_line_items")
    .select("delivery_challan_id, sent_qty, returned_qty")
    .in("delivery_challan_id", ids);

  const outMap: Record<string, number> = {};
  for (const l of (linesData ?? []) as {
    delivery_challan_id: string;
    sent_qty: number;
    returned_qty: number;
  }[]) {
    const bal = Math.max(0, (l.sent_qty ?? 0) - (l.returned_qty ?? 0));
    outMap[l.delivery_challan_id] = (outMap[l.delivery_challan_id] ?? 0) + bal;
  }

  return rows.map((r) => ({ ...r, outstanding_qty: outMap[r.id] ?? 0 }));
}

export async function getDc(id: string): Promise<DcDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("delivery_challans")
    .select("*, vendors(id, name)")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as unknown as DcDetail | null;
}

export async function getDcLines(dcId: string): Promise<DcLineItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dc_line_items")
    .select("*")
    .eq("delivery_challan_id", dcId)
    .order("sort_order");
  return (data ?? []) as DcLineItem[];
}

// ---------- master lookups ----------

export async function getVendors(): Promise<
  Pick<Vendor, "id" | "code" | "name">[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendors")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Pick<Vendor, "id" | "code" | "name">[];
}

export async function getLocations(): Promise<
  { id: string; code: string; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("locations")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as { id: string; code: string; name: string }[];
}

export async function getItems(): Promise<Pick<Item, "id" | "code" | "name">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Pick<Item, "id" | "code" | "name">[];
}

export async function getUoms(): Promise<Pick<Uom, "id" | "code" | "name">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uoms")
    .select("id, code, name")
    .eq("is_active", true)
    .order("code");
  return (data ?? []) as Pick<Uom, "id" | "code" | "name">[];
}
