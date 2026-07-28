"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { vendorInput, type VendorInput } from "./vendor-types";
import { deleteOrDeactivate } from "./delete-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/vendor");
}

type AddressRow = Omit<VendorInput["addresses"][number], "sno"> & { sno: number };

/** Drop fully-empty address rows (no picker + all text blank) and renumber sno. */
function normalizeAddresses(data: VendorInput): AddressRow[] {
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return data.addresses
    .map((a) => ({
      address_type: clean(a.address_type),
      street: clean(a.street),
      city_id: a.city_id ?? null,
      state_id: a.state_id ?? null,
      country_id: a.country_id ?? null,
      pin: clean(a.pin),
      land_line: clean(a.land_line),
      mobile: clean(a.mobile),
      // clean() collapses "" → null, which is exactly the stored convention:
      // an explicit-but-empty WhatsApp box means "same as mobile".
      whatsapp: clean(a.whatsapp),
      email_id: clean(a.email_id),
    }))
    .filter(
      (a) =>
        a.address_type ||
        a.street ||
        a.city_id ||
        a.state_id ||
        a.country_id ||
        a.pin ||
        a.land_line ||
        a.mobile ||
        a.whatsapp ||
        a.email_id,
    )
    .map((a, i) => ({ ...a, sno: i + 1 }));
}

/** Replace the address grid wholesale for a given vendor id. */
async function writeAddresses(
  s: Awaited<ReturnType<typeof createClient>>,
  vendorId: string,
  data: VendorInput,
): Promise<Result> {
  const { error: delErr } = await s.from("master_vendor_addresses").delete().eq("vendor_id", vendorId);
  if (delErr) return fail(delErr.message);
  const rows = normalizeAddresses(data);
  if (rows.length) {
    const { error } = await s
      .from("master_vendor_addresses")
      .insert(rows.map((r) => ({ ...r, vendor_id: vendorId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

export async function createVendor(data: VendorInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = vendorInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { addresses: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s.from("master_vendors").insert(header).select("id").single();
  if (error) return fail(error.message);
  const childRes = await writeAddresses(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  rev();
  return { ok: true };
}

export async function updateVendor(id: string, data: VendorInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = vendorInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { addresses: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("master_vendors").update(header).eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeAddresses(s, id, p.data);
  if (!childRes.ok) return childRes;
  rev();
  return { ok: true };
}

export async function deleteVendor(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  // Own addresses cascade; if referenced elsewhere, deactivate instead of delete.
  const res = await deleteOrDeactivate(s, "master_vendors", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
