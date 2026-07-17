"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";
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
type DeleteResult = { ok: true; inactive: boolean } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters");
}
function revAttributes(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/attributes");
}
function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

// ---------- config lookups ----------
export async function createLookup(data: LookupInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = lookupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "config_lookups", p.data.name, { scope: { kind: p.data.kind } });
  if (!dup.ok) return fail(dup.error);
  const {
    data: { user },
  } = await s.auth.getUser();
  let createdBy: string | null = null;
  if (user) {
    const { data: profile } = await s
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();
    createdBy = profile?.full_name || profile?.email || null;
  }
  const { error } = await s.from("config_lookups").insert({ ...p.data, created_by: createdBy });
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
export async function updateLookup(id: string, data: LookupInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = lookupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "config_lookups", p.data.name, {
    excludeId: id,
    scope: { kind: p.data.kind },
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("config_lookups").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
export async function deleteLookup(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "config_lookups", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ---------- attributes (= Item Class rows, merged by 0293) ----------
/** Drop blanks and renumber sno 1..n so the persisted rows always mirror the grid. */
function normalizeValues(data: AttributeInput): { sno: number; value: string }[] {
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
  const dup = await checkDuplicateName(s, "config_lookups", header.name, { scope: { kind: "item_class" } });
  if (!dup.ok) return fail(dup.error);
  const dupCode = await checkDuplicateName(s, "config_lookups", header.code, {
    nameColumn: "code",
    label: "code",
    scope: { kind: "item_class" },
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { data: created, error } = await s
    .from("config_lookups")
    .insert({ ...header, kind: "item_class" })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeValues(p.data);
  if (rows.length) {
    const { error: vErr } = await s
      .from("attribute_values")
      .insert(rows.map((r) => ({ ...r, item_class_id: created.id })));
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
  const dup = await checkDuplicateName(s, "config_lookups", header.name, {
    excludeId: id,
    scope: { kind: "item_class" },
  });
  if (!dup.ok) return fail(dup.error);
  const dupCode = await checkDuplicateName(s, "config_lookups", header.code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
    scope: { kind: "item_class" },
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { error } = await s.from("config_lookups").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the child grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("attribute_values").delete().eq("item_class_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeValues(p.data);
  if (rows.length) {
    const { error: vErr } = await s
      .from("attribute_values")
      .insert(rows.map((r) => ({ ...r, item_class_id: id })));
    if (vErr) return fail(vErr.message);
  }
  revAttributes();
  return { ok: true };
}

export async function deleteAttribute(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "config_lookups", id, "is_active");
  if (!res.ok) return fail(res.error);
  revAttributes();
  return { ok: true, inactive: res.inactive };
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
  // May be inactive by FK references (buyers/customers/etc. hold currency_code) —
  // Postgres returns a foreign-key violation which we surface to the user.
  const { error } = await s.from("currencies").delete().eq("code", code);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
