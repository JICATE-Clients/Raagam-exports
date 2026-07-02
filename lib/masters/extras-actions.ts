"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  lookupInput,
  transporterInput,
  gstRateInput,
  currencyInput,
  type LookupInput,
  type TransporterInput,
  type GstRateInput,
  type CurrencyInput,
} from "./extras-types";

type Result = { ok: true } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters");
}
function fail(msg: string): Result {
  return { ok: false, error: msg };
}

// ---------- config lookups ----------
export async function createLookup(data: LookupInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = lookupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("config_lookups").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
export async function updateLookup(id: string, data: LookupInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = lookupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("config_lookups").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
export async function deleteLookup(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("config_lookups").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------- transporters ----------
export async function createTransporter(data: TransporterInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = transporterInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("transporters").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
export async function updateTransporter(id: string, data: TransporterInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = transporterInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("transporters").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------- gst rates ----------
export async function createGstRate(data: GstRateInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = gstRateInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("gst_rates").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
export async function updateGstRate(id: string, data: GstRateInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = gstRateInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("gst_rates").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------- currencies (existing table; PK = code) ----------
export async function createCurrency(data: CurrencyInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = currencyInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s
    .from("currencies")
    .insert({ code: p.data.code, name: p.data.name, symbol: p.data.symbol ?? null });
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
export async function updateCurrency(code: string, data: CurrencyInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = currencyInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s
    .from("currencies")
    .update({ name: p.data.name, symbol: p.data.symbol ?? null })
    .eq("code", code);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
