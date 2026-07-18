"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { catalogueInput, priceListInput, piEnquiryInput } from "./catalogue-types";
import type { CatalogueInput, PriceListInput, PiEnquiryInput } from "./catalogue-types";

type CreateResult = { ok: true; id: string } | { ok: false; error: string };
type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/sales");
  revalidatePath("/sales/catalogues");
}

export async function createCatalogue(data: CatalogueInput): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const p = catalogueInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("style_catalogues").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteCatalogue(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("style_catalogues").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function createPriceList(data: PriceListInput): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const p = priceListInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("style_price_lists").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deletePriceList(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("style_price_lists").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function createPiEnquiry(data: PiEnquiryInput): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const p = piEnquiryInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("pi_enquiries").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deletePiEnquiry(id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("pi_enquiries").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Catalogue child: styles + pack types
// ---------------------------------------------------------------------------
export async function addCatalogueStyle(catalogueId: string, data: { style_no?: string | null; style_description?: string | null; base_style?: string | null; design?: string | null }): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("catalogue_styles").select("sno").eq("catalogue_id", catalogueId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("catalogue_styles").insert({ catalogue_id: catalogueId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function addCataloguePackType(catalogueId: string, data: { style_no?: string | null; combo?: string | null; no_of_pcs?: number | null }): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("catalogue_pack_types").select("sno").eq("catalogue_id", catalogueId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("catalogue_pack_types").insert({ catalogue_id: catalogueId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// Price List child: styles + size prices
// ---------------------------------------------------------------------------
export async function addPriceListStyle(pricelistId: string, data: { style_no?: string | null; style_description?: string | null; uom_id?: string | null }): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("pricelist_styles").select("sno").eq("pricelist_id", pricelistId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("pricelist_styles").insert({ pricelist_id: pricelistId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function addPriceListSizePrice(pricelistStyleId: string, data: { garment_size: string; price?: number }): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: row, error } = await s.from("pricelist_size_prices").insert({ pricelist_style_id: pricelistStyleId, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// PI Enquiry child: styles + products
// ---------------------------------------------------------------------------
export async function addPiEnquiryStyle(piEnquiryId: string, data: { style_no?: string | null; style_description?: string | null; fabric_structure?: string | null; uom_id?: string | null; order_qty?: number; expected_order_qty?: number; delivery_date?: string | null }): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("pi_enquiry_styles").select("sno").eq("pi_enquiry_id", piEnquiryId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("pi_enquiry_styles").insert({ pi_enquiry_id: piEnquiryId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function addPiEnquiryProduct(piStyleId: string, data: { product_code?: string | null; product_description?: string | null; order_qty?: number; expected_order_qty?: number }): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("pi_enquiry_products").select("sno").eq("pi_style_id", piStyleId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("pi_enquiry_products").insert({ pi_style_id: piStyleId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

// Generic delete for catalogue/pricelist/PI child tables
export async function deleteCatalogueChild(table: string, id: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const allowed = ["catalogue_styles", "catalogue_pack_types", "pricelist_styles", "pricelist_size_prices", "pi_enquiry_styles", "pi_enquiry_products"];
  if (!allowed.includes(table)) return fail("Invalid table");
  const s = await createClient();
  const { error } = await s.from(table).delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
