"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { vendorInput, type VendorInput } from "./vendor-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

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

type ItemCategoryRow = Omit<VendorInput["item_categories"][number], "sno"> & { sno: number };

/**
 * Drop fully-empty Item Category rows and renumber sno.
 *
 * A row counts as real if ANY of its pickers or lead time is set — the grid
 * hands back one blank row as soon as the operator clicks + Add, and that row
 * must not reach the table.
 */
function normalizeItemCategories(data: VendorInput): ItemCategoryRow[] {
  return data.item_categories
    .map((r) => ({
      item_class_id: r.item_class_id ?? null,
      category_id: r.category_id ?? null,
      vat_levy_id: r.vat_levy_id ?? null,
      duty_levy_id: r.duty_levy_id ?? null,
      lead_days: r.lead_days ?? null,
      form_id: r.form_id ?? null,
      supply_type_id: r.supply_type_id ?? null,
      payment_term_id: r.payment_term_id ?? null,
    }))
    .filter(
      (r) =>
        r.item_class_id ||
        r.category_id ||
        r.vat_levy_id ||
        r.duty_levy_id ||
        r.lead_days != null ||
        r.form_id ||
        r.supply_type_id ||
        r.payment_term_id,
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/** Drop blank Process rows and renumber. VAT % alone is not data: it defaults to 0. */
function normalizeProcesses(data: VendorInput) {
  return data.processes
    .map((r) => ({
      process_id: r.process_id ?? null,
      vat_levy_id: r.vat_levy_id ?? null,
      vat_portion_pct: r.vat_portion_pct,
      payment_term_id: r.payment_term_id ?? null,
    }))
    .filter((r) => r.process_id || r.vat_levy_id || r.payment_term_id || r.vat_portion_pct > 0)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/** Drop blank Service rows and renumber. */
function normalizeServices(data: VendorInput) {
  return data.services
    .map((r) => ({
      service_type_id: r.service_type_id ?? null,
      payment_term_id: r.payment_term_id ?? null,
    }))
    .filter((r) => r.service_type_id || r.payment_term_id)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/** Drop blank SubContractor rows and renumber. */
function normalizeSubcontracts(data: VendorInput) {
  return data.subcontracts
    .map((r) => ({
      process_id: r.process_id ?? null,
      payment_term_id: r.payment_term_id ?? null,
    }))
    .filter((r) => r.process_id || r.payment_term_id)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * Replace one of a vendor's child grids wholesale — delete every row for this
 * vendor, then re-insert what the form sent. The house pattern for master-detail
 * (see the note in the picker-wiring skill): no diffing, so a reordered or
 * removed row cannot leave an orphan behind.
 *
 * Shared by all five grids rather than copied per grid. Five copies is how the
 * fourth one ends up missing its delete and quietly doubling rows on every save.
 */
async function writeChild(
  s: Awaited<ReturnType<typeof createClient>>,
  table: string,
  vendorId: string,
  rows: Record<string, unknown>[],
): Promise<Result> {
  const { error: delErr } = await s.from(table).delete().eq("vendor_id", vendorId);
  if (delErr) return fail(delErr.message);
  if (rows.length) {
    const { error } = await s.from(table).insert(rows.map((r) => ({ ...r, vendor_id: vendorId })));
    if (error) return fail(error.message);
  }
  return { ok: true };
}

/**
 * The header columns only — the five child arrays are written separately and
 * would be rejected as unknown columns on `master_vendors`.
 */
function headerOnly(data: VendorInput) {
  const {
    addresses: _a,
    item_categories: _b,
    processes: _c,
    services: _d,
    subcontracts: _e,
    ...header
  } = data;
  void _a;
  void _b;
  void _c;
  void _d;
  void _e;
  return header;
}

/** Every child grid this vendor owns, in one pass. Stops at the first failure. */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  vendorId: string,
  data: VendorInput,
): Promise<Result> {
  const grids: [string, Record<string, unknown>[]][] = [
    ["master_vendor_addresses", normalizeAddresses(data)],
    ["master_vendor_item_categories", normalizeItemCategories(data)],
    ["master_vendor_processes", normalizeProcesses(data)],
    ["master_vendor_services", normalizeServices(data)],
    ["master_vendor_subcontracts", normalizeSubcontracts(data)],
  ];
  for (const [table, rows] of grids) {
    const res = await writeChild(s, table, vendorId, rows);
    if (!res.ok) return res;
  }
  return { ok: true };
}

/**
 * One GSTIN identifies one registration, so two vendors must not share one.
 *
 * Mirrors the guard Customer and Consignee already carry
 * (`customer-actions.ts:164`, `consignee-actions.ts:113`); Vendor was the only
 * party master without it, so the same number could be entered twice here while
 * being blocked on the other two.
 *
 * Deliberately GSTIN only. PAN is NOT unique across rows — one PAN carries one
 * GSTIN per state, so a multi-state vendor legitimately appears several times
 * under the same PAN, and guarding it would block real data. Blank is allowed:
 * an unregistered vendor has no GSTIN, and several of them are not duplicates
 * of each other.
 */
async function checkGstinUnique(
  s: Awaited<ReturnType<typeof createClient>>,
  gstNo: string | null | undefined,
  excludeId?: string,
): Promise<string | null> {
  const v = (gstNo ?? "").trim();
  if (!v) return null;
  const res = await checkDuplicateName(s, "master_vendors", v, {
    nameColumn: "gst_no",
    excludeId,
    label: "GST number",
  });
  return res.ok ? null : res.error;
}

export async function createVendor(data: VendorInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = vendorInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "master_vendors", p.data.name);
  if (!dup.ok) return fail(dup.error);
  const gstErr = await checkGstinUnique(s, p.data.gst_no);
  if (gstErr) return fail(gstErr);
  const header = headerOnly(p.data);
  const { data: created, error } = await s.from("master_vendors").insert(header).select("id").single();
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  rev();
  return { ok: true };
}

export async function updateVendor(id: string, data: VendorInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = vendorInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "master_vendors", p.data.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const gstErr = await checkGstinUnique(s, p.data.gst_no, id);
  if (gstErr) return fail(gstErr);
  const { error } = await s.from("master_vendors").update(headerOnly(p.data)).eq("id", id);
  if (error) return fail(error.message);
  const childRes = await writeChildren(s, id, p.data);
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
