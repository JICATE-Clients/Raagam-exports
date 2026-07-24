"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { countryInput, type CountryInput } from "./country-types";
import { deleteOrDeactivate } from "./delete-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/country");
}

export async function createCountry(data: CountryInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = countryInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("countries").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateCountry(id: string, data: CountryInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = countryInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("countries").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteCountry(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "countries", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}

/** Inline "+ New" country add from a Country picker (e.g. Destination) — returns
 *  the new id so the caller can immediately select it. */
export async function createCountryQuick(
  input: { code: string | null; name: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await can("masters", "create"))) return { ok: false, error: "Forbidden" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required" };
  const s = await createClient();
  const { data, error } = await s
    .from("countries")
    .insert({ code: input.code?.trim() || null, name })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true, id: data.id };
}
