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
  itemClassInput,
  type LookupInput,
  type TransporterInput,
  type GstRateInput,
  type CurrencyInput,
  type ItemClassInput,
} from "./extras-types";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

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
  p.data.name = p.data.name.trim().toUpperCase(); // names stored in CAPS (client 2026-07-23)
  // Blank code → default to the name (forms no longer ask for codes; codes in
  // config_lookups are per-kind and nullable, so name is a safe default).
  if (!p.data.code?.trim()) p.data.code = p.data.name;
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
  p.data.name = p.data.name.trim().toUpperCase(); // names stored in CAPS (client 2026-07-23)
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
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}

// ---------- item classes (config_lookups kind='item_class') ----------
async function currentUserName(s: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) return null;
  const { data: profile } = await s
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();
  return profile?.full_name || profile?.email || null;
}

export async function createItemClass(data: ItemClassInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = itemClassInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  p.data.name = p.data.name.trim().toUpperCase(); // names stored in CAPS (client 2026-07-23)
  // Blank code → default to the name (forms no longer ask for codes).
  if (!p.data.code?.trim()) p.data.code = p.data.name;
  const s = await createClient();
  const dup = await checkDuplicateName(s, "config_lookups", p.data.name, { scope: { kind: "item_class" } });
  if (!dup.ok) return fail(dup.error);
  if (p.data.code) {
    const dupCode = await checkDuplicateName(s, "config_lookups", p.data.code, {
      nameColumn: "code",
      label: "code",
      scope: { kind: "item_class" },
    });
    if (!dupCode.ok) return fail(dupCode.error);
  }
  const createdBy = await currentUserName(s);
  const { error } = await s
    .from("config_lookups")
    .insert({ ...p.data, kind: "item_class", created_by: createdBy });
  if (error) return fail(error.message);
  revAttributes();
  return { ok: true };
}

export async function updateItemClass(id: string, data: ItemClassInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = itemClassInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  p.data.name = p.data.name.trim().toUpperCase(); // names stored in CAPS (client 2026-07-23)
  const s = await createClient();
  const dup = await checkDuplicateName(s, "config_lookups", p.data.name, {
    excludeId: id,
    scope: { kind: "item_class" },
  });
  if (!dup.ok) return fail(dup.error);
  if (p.data.code) {
    const dupCode = await checkDuplicateName(s, "config_lookups", p.data.code, {
      nameColumn: "code",
      label: "code",
      excludeId: id,
      scope: { kind: "item_class" },
    });
    if (!dupCode.ok) return fail(dupCode.error);
  }
  const { error } = await s
    .from("config_lookups")
    .update({ ...p.data, kind: "item_class" })
    .eq("id", id);
  if (error) return fail(error.message);
  revAttributes();
  return { ok: true };
}

export async function deleteItemClass(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "config_lookups", id, "is_active");
  if (!res.ok) return fail(res.error);
  revAttributes();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}

// ---------- attribute values (per Item Class; gated by has_attribute) ----------
/** Replace the value grid for one Item Class. Only classes flagged `has_attribute`
 *  may carry values (the split — Item Class lifecycle lives on its own screen). */
export async function saveAttributeValues(
  itemClassId: string,
  values: { value: string; input_type?: "option_list" | "numeric_range"; options?: { value: string }[] }[],
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { data: cls, error: clsErr } = await s
    .from("config_lookups")
    .select("id, kind, has_attribute")
    .eq("id", itemClassId)
    .single();
  if (clsErr) return fail(clsErr.message);
  if (!cls || cls.kind !== "item_class") return fail("Not an Item Class.");
  if (!cls.has_attribute) return fail("This Item Class does not have attributes enabled.");

  const clean = values
    .map((v) => ({
      value: (v.value ?? "").trim(),
      input_type: v.input_type === "option_list" ? "option_list" : "numeric_range",
      options: (v.options ?? []).map((o) => (o.value ?? "").trim()).filter((x) => x.length > 0),
    }))
    .filter((v) => v.value.length > 0);

  // Replace wholesale — attribute_value_options cascade-delete with their parent value.
  const { error: delErr } = await s.from("attribute_values").delete().eq("item_class_id", itemClassId);
  if (delErr) return fail(delErr.message);

  if (clean.length) {
    const { data: inserted, error: insErr } = await s
      .from("attribute_values")
      .insert(
        clean.map((v, i) => ({
          sno: i + 1,
          value: v.value,
          input_type: v.input_type,
          item_class_id: itemClassId,
        })),
      )
      .select("id");
    if (insErr) return fail(insErr.message);

    // Options for categorical attributes (RETURNING preserves VALUES order → index-match).
    const optRows: { attribute_value_id: string; sno: number; value: string }[] = [];
    (inserted ?? []).forEach((row, i) => {
      const v = clean[i];
      if (v && v.input_type === "option_list") {
        v.options.forEach((opt, j) => optRows.push({ attribute_value_id: row.id, sno: j + 1, value: opt }));
      }
    });
    if (optRows.length) {
      const { error: optErr } = await s.from("attribute_value_options").insert(optRows);
      if (optErr) return fail(optErr.message);
    }
  }
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
  // May be inactive by FK references (buyers/customers/etc. hold currency_code) —
  // Postgres returns a foreign-key violation which we surface to the user.
  const { error } = await s.from("currencies").delete().eq("code", code);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
