"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { checkDuplicateName } from "./dup-guard";
import { lookupInput, type LookupKind } from "./extras-types";

/**
 * Quick-add a `config_lookups` value from inside another form's picker and get
 * its id back so the picker can auto-select it (mirrors the legacy ⓘ lookup's
 * inline Add). Reused by <LookupPicker>.
 */
export async function createLookupValue(
  kind: LookupKind,
  name: string,
  code: string | null,
  typeCode?: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!name.trim()) return { ok: false, error: "Name is required" };
  if (!(await can("masters", "create"))) return { ok: false, error: "Forbidden" };

  /*
   * Parse through the SAME schema the Lookup master uses, rather than
   * hand-rolling `.trim().toUpperCase()` here.
   *
   * `lookupInput` is not just a CAPS transform: it carries the per-kind format
   * rules, and today that means `YARN_COUNT_RE` — a yarn count must read 10'S,
   * 2/10'S or 40 DINER. This path is every picker's inline "+ Add" (~78
   * fields), so hand-rolling let it write a name the Counts master itself would
   * have rejected. Latent until Count gained an "+ Add" on 2026-07-31; a real
   * hole from that moment on.
   *
   * Same reasoning as the CAPS rule in AGENTS.md — the rule belongs in the Zod
   * schema, because more than one path reaches the table.
   */
  const parsed = lookupInput.safeParse({
    kind,
    code,
    name,
    type_code: typeCode ?? null,
    is_active: true,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid value" };
  }
  const clean = parsed.data;

  const s = await createClient();
  // `uq_config_lookups_kind_name` (0317) would reject a duplicate anyway, but as
  // a raw "duplicate key value violates unique constraint …" string in a toast.
  // Same scope as the index — per kind, case-insensitive, trimmed.
  const dup = await checkDuplicateName(s, "config_lookups", clean.name, { scope: { kind } });
  if (!dup.ok) return { ok: false, error: dup.error };
  // Blank code → default to the name (forms no longer ask for codes).
  const { data, error } = await s
    .from("config_lookups")
    .insert({ kind, code: clean.code?.trim() || clean.name, name: clean.name, type_code: clean.type_code?.trim() || null, is_active: true })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/masters/materials");
  return { ok: true, id: data.id };
}
