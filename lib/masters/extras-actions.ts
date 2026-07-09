"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  lookupInput,
  transporterInput,
  gstRateInput,
  currencyInput,
  attributeInput,
  type LookupInput,
  type TransporterInput,
  type GstRateInput,
  type CurrencyInput,
  type AttributeInput,
} from "./extras-types";

type Result = { ok: true } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters");
}
function revAttributes(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/attributes");
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

// ---------- attributes (master-detail) ----------
/** Normalize the value grid: clear when Has Attributes is off; else drop blanks
 *  and renumber sno 1..n so the persisted rows always mirror the checkbox. */
function normalizeValues(data: AttributeInput): { sno: number; value: string }[] {
  if (!data.has_attributes) return [];
  return data.values
    .map((v) => ({ ...v, value: v.value.trim() }))
    .filter((v) => v.value.length > 0)
    .map((v, i) => ({ sno: i + 1, value: v.value }));
}

export async function createAttribute(data: AttributeInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = attributeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { values: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s
    .from("attributes")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeValues(p.data);
  if (rows.length) {
    const { error: vErr } = await s
      .from("attribute_values")
      .insert(rows.map((r) => ({ ...r, attribute_id: created.id })));
    if (vErr) return fail(vErr.message);
  }
  revAttributes();
  return { ok: true };
}

export async function updateAttribute(id: string, data: AttributeInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = attributeInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { values: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("attributes").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the child grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("attribute_values").delete().eq("attribute_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeValues(p.data);
  if (rows.length) {
    const { error: vErr } = await s
      .from("attribute_values")
      .insert(rows.map((r) => ({ ...r, attribute_id: id })));
    if (vErr) return fail(vErr.message);
  }
  revAttributes();
  return { ok: true };
}

export async function deleteAttribute(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("attributes").delete().eq("id", id); // values cascade
  if (error) return fail(error.message);
  revAttributes();
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
export async function deleteCurrency(code: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  // May be blocked by FK references (buyers/customers/etc. hold currency_code) —
  // Postgres returns a foreign-key violation which we surface to the user.
  const { error } = await s.from("currencies").delete().eq("code", code);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
