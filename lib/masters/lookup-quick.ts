"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import type { LookupKind } from "./extras-types";

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
  const s = await createClient();
  const { data, error } = await s
    .from("config_lookups")
    .insert({ kind, code: code?.trim() || null, name: name.trim(), type_code: typeCode?.trim() || null, is_active: true })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/masters/materials");
  return { ok: true, id: data.id };
}
