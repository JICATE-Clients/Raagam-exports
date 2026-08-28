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
/**
 * Save the value grid for one Item Class. Only classes flagged `has_attribute`
 * may carry values (the split — Item Class lifecycle lives on its own screen).
 *
 * ## IT RECONCILES. IT USED TO REPLACE, AND THAT SILENTLY BROKE EVERY SET
 *
 * This was `delete().eq("item_class_id", …)` followed by a fresh insert, and the
 * comment beside the delete reasoned only about what cascades OUT of a value
 * (`attribute_value_options`). What points IN is
 * `material_attribute_lines.attribute_id`, **`ON DELETE SET NULL`** — so saving
 * the value list for a class blanked the attribute on every Material Attribute
 * line under that class, and the line kept its options, its steps and its unit
 * while losing the one thing that says what it asks about.
 *
 * It was not a risk, it was the live state: **12 of 12 lines** across all five
 * sets read NULL (2026-08-27), and the timestamps show the mechanism — in every
 * set the lines were saved BEFORE the class's current values existed, POLY BAG
 * and TAGS by 50 seconds, ELASTIC and LABEL by 63. `normalizeLines` in
 * `material-attribute-actions.ts` REFUSES to insert a line with no
 * `attribute_id`, so the app could not have written those NULLs: the FK did,
 * after the fact. Nothing recovers them — `audit_log` holds no entry for any
 * attribute table — so the twelve have to be re-picked by hand.
 *
 * ## HOW A VALUE IS RECOGNISED ACROSS A SAVE
 *
 * By `id` first, and that is why the parameter now takes one: matching on TEXT
 * alone makes a RENAME indistinguishable from a delete plus an insert, so
 * correcting a typo in "GSM" would blank every line pointing at it — the same
 * bug wearing a smaller hat. The screen sends the id it loaded.
 *
 * By trimmed, case-insensitive VALUE second, for `lib/data-io`, which reaches
 * this action directly and has no ids to send. That is the same key the
 * duplicate check below uses, so two rows can never resolve to one id.
 *
 * A DELETE STILL HAPPENS for a value the operator actually removed, and the
 * lines pointing at it are still nulled. That is the FK doing what it is for:
 * the attribute is gone, so a line asking it has no question left. What changed
 * is that this is now the only path that reaches it.
 */
export async function saveAttributeValues(
  itemClassId: string,
  values: {
    /** The stored row this one IS, where the caller knows it. See the header. */
    id?: string | null;
    value: string;
    input_type?: "option_list" | "numeric_range";
    options?: { value: string }[];
  }[],
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
      id: v.id ?? null,
      value: (v.value ?? "").trim(),
      input_type: v.input_type === "option_list" ? "option_list" : "numeric_range",
      options: (v.options ?? []).map((o) => (o.value ?? "").trim()).filter((x) => x.length > 0),
    }))
    .filter((v) => v.value.length > 0);

  // A repeated value is rejected, not silently deduped. The screen already marks
  // it as the operator types, but `lib/data-io` reaches this action directly, and
  // the insert below is a wholesale replace with no unique constraint behind it —
  // so two GSM rows would both land and the Material screen would then offer the
  // same attribute twice with no way to tell which one an item answered.
  // Rejecting says which value clashed; deduping would quietly drop a row the
  // operator can still see on screen.
  const seen = new Set<string>();
  for (const v of clean) {
    const key = v.value.toUpperCase();
    if (seen.has(key)) return fail(`"${v.value}" is listed twice. Use a different value.`);
    seen.add(key);
  }

  // What this class holds today. Read BEFORE anything is written, so a value that
  // survives the save can be recognised and kept rather than re-created.
  const { data: existing, error: exErr } = await s
    .from("attribute_values")
    .select("id, value")
    .eq("item_class_id", itemClassId);
  if (exErr) return fail(exErr.message);
  const stored = (existing ?? []) as { id: string; value: string | null }[];

  const idsHere = new Set(stored.map((r) => r.id));
  const byText = new Map<string, string>();
  for (const r of stored) {
    const key = (r.value ?? "").trim().toUpperCase();
    // FIRST WINS, so a class that already holds two rows differing only in case
    // cannot make two incoming rows resolve to one id and lose one of them.
    if (key && !byText.has(key)) byText.set(key, r.id);
  }

  /* THE ID IS ONLY TRUSTED WHEN IT IS ONE OF THIS CLASS'S OWN ROWS. A payload
     naming another class's value would otherwise re-parent it by UPDATE — a
     value silently moving between Item Classes, which no screen offers and no
     import should be able to do by accident. */
  const claimed = new Set<string>();
  const resolved = clean.map((v, i) => {
    const byId = v.id && idsHere.has(v.id) ? v.id : null;
    const id = byId ?? byText.get(v.value.toUpperCase()) ?? null;
    const keep = id && !claimed.has(id) ? id : null;
    if (keep) claimed.add(keep);
    return { id: keep, sno: i + 1, v };
  });

  // 1 · GONE — the only delete, and the only path that nulls a line's attribute.
  const removed = stored.map((r) => r.id).filter((id) => !claimed.has(id));
  if (removed.length) {
    const { error } = await s.from("attribute_values").delete().in("id", removed);
    if (error) return fail(error.message);
  }

  // 2 · KEPT — updated in place, so the id every Material Attribute line points
  //     at survives. This is the whole fix.
  for (const r of resolved) {
    if (!r.id) continue;
    const { error } = await s
      .from("attribute_values")
      .update({ sno: r.sno, value: r.v.value, input_type: r.v.input_type })
      .eq("id", r.id);
    if (error) return fail(error.message);
  }

  // 3 · NEW.
  const fresh = resolved.filter((r) => !r.id);
  if (fresh.length) {
    const { data: inserted, error: insErr } = await s
      .from("attribute_values")
      .insert(
        fresh.map((r) => ({
          sno: r.sno,
          value: r.v.value,
          input_type: r.v.input_type,
          item_class_id: itemClassId,
        })),
      )
      .select("id");
    if (insErr) return fail(insErr.message);
    // RETURNING preserves VALUES order → index-match, as before.
    (inserted ?? []).forEach((row, i) => {
      const r = fresh[i];
      if (r) r.id = row.id as string;
    });
  }

  /* 4 · OPTIONS, replaced per value. Nothing points AT an option row — no FK
     names `attribute_value_options` — so wholesale replacement is safe here in
     the way it was never safe one table up. Every value is cleared, including a
     value that stopped being an option list, or its old options would outlive
     the switch. */
  const withIds = resolved.filter((r): r is typeof r & { id: string } => !!r.id);
  if (withIds.length) {
    const { error: optDel } = await s
      .from("attribute_value_options")
      .delete()
      .in("attribute_value_id", withIds.map((r) => r.id));
    if (optDel) return fail(optDel.message);
  }
  const optRows: { attribute_value_id: string; sno: number; value: string }[] = [];
  for (const r of withIds) {
    if (r.v.input_type !== "option_list") continue;
    r.v.options.forEach((opt, j) =>
      optRows.push({ attribute_value_id: r.id, sno: j + 1, value: opt }),
    );
  }
  if (optRows.length) {
    const { error: optErr } = await s.from("attribute_value_options").insert(optRows);
    if (optErr) return fail(optErr.message);
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
