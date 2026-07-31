"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { stateInput, type StateInput } from "./state-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/gst");
  revalidatePath("/masters/gst/state");
}

export async function createState(data: StateInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = stateInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // Unscoped on purpose. The State MASTER form has no country box, so a row
  // created here sits at country_id = null — the exact set `uq_states_name`
  // (0373) collapses with `nulls not distinct`. (`createStateQuick` below now
  // does stamp a country, from the address field that called it.) Leaving the
  // guard unscoped is the safe direction: it can only be STRICTER than the
  // index, never looser.
  const dup = await checkDuplicateName(s, "states", p.data.name);
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("states").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateState(id: string, data: StateInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = stateInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "states", p.data.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("states").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

/**
 * Quick-add / rename a State from a State FIELD's inline picker.
 *
 * State fields used to render through `LookupDialogPicker kind="state"`, whose
 * options are `statesAsLookups(stateRows)` — rows from `public.states`, carrying
 * their real `states.id` (see `lib/masters/lookup-compat.ts`). That adapter
 * writes every kind to `config_lookups`, so its "+ Add" put a state in the WRONG
 * TABLE: the row vanished on the next refresh (the field re-reads
 * `public.states`) and the id it handed back was not a valid `state_id` — which
 * is an FK into `public.states` since 0355.
 *
 * The six State fields now render `components/masters/state-picker.tsx`, which
 * calls these. `LookupDialogPicker` is left exactly as it was, so the ~78 other
 * lookup fields — genuinely `config_lookups` values — are untouched.
 *
 * `is_default` and `inactive` are deliberately not exposed: the inline form
 * offers Code + Name only, and a quick-add must never silently move the
 * default state.
 */
export async function createStateQuick(
  name: string,
  code: string | null,
  /**
   * The country the calling field is scoped to, stamped onto the new row so a
   * state added from a FRANCE address does not surface under India. Null (the
   * default) reproduces the old behaviour and matches every existing row.
   *
   * Passed as an argument rather than added to `stateInput` on purpose: the
   * schema is shared with `updateState`, which writes `update(p.data)` from a
   * State-master form that has no country box — a `country_id` field with a
   * `.default(null)` there would blank the column on every rename.
   */
  countryId: string | null = null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = stateInput.safeParse({ code, name, is_default: false, inactive: false });
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // Still unscoped, and now deliberately STRICTER than `uq_states_name` (0373),
  // which keys on (country_id, name): this rejects "GEORGIA" under FRANCE while
  // an Indian "GEORGIA" exists, where the index would allow it. Erring strict is
  // the safe direction — the operator gets a clear "already exists" instead of a
  // second row nobody can tell apart in a picker that shows names only.
  const dup = await checkDuplicateName(s, "states", p.data.name);
  if (!dup.ok) return fail(dup.error);
  const { data, error } = await s
    .from("states")
    .insert({ ...p.data, country_id: countryId })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: data.id };
}

export async function updateStateQuick(
  id: string,
  name: string,
  code: string | null,
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const s = await createClient();
  // Read the flags back rather than defaulting them — a rename from a field
  // must not clear `is_default` or silently reactivate a deactivated state.
  const { data: existing } = await s
    .from("states")
    .select("is_default, inactive")
    .eq("id", id)
    .single();
  const p = stateInput.safeParse({
    code,
    name,
    is_default: existing?.is_default ?? false,
    inactive: existing?.inactive ?? false,
  });
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const dup = await checkDuplicateName(s, "states", p.data.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("states").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteState(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "states", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
