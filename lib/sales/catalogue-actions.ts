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
