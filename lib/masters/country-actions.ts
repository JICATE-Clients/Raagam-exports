"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { countryInput, type CountryInput } from "./country-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

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
  // A deactivated country KEEPS its name reserved, so the guard is unscoped —
  // it must agree with `uq_countries_name` (0373), which is a plain index, not
  // a partial one on `inactive = false`.
  const dup = await checkDuplicateName(s, "countries", p.data.name);
  if (!dup.ok) return fail(dup.error);
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
  const dup = await checkDuplicateName(s, "countries", p.data.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
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

/**
 * "+ Add country" from inside a Country picker — same insert as `createCountry`,
 * but it RETURNS THE NEW ID so the picker can select what the operator just
 * created and close. Without the id the new row only appears after
 * `router.refresh()` lands, and the field they opened the picker to fill is
 * still empty.
 *
 * Takes the full `CountryInput` (ECGC, ISD, group, flags) rather than just a
 * name: a country created name-only is missing the ISD code that the contact
 * fields on half a dozen masters read off it.
 */
export async function createCountryQuick(
  input: CountryInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await can("masters", "create"))) return { ok: false, error: "Forbidden" };
  const p = countryInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Validation failed" };
  const s = await createClient();
  // Same guard as `createCountry` — this is the path that duplicated "INDIA"
  // most often, because every Country field on every master offers "+ Add".
  const dup = await checkDuplicateName(s, "countries", p.data.name);
  if (!dup.ok) return { ok: false, error: dup.error };
  const { data, error } = await s.from("countries").insert(p.data).select("id").single();
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true, id: data.id };
}
