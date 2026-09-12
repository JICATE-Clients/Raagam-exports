"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { zoneInput, type ZoneInput } from "./zone-types";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/zones");
}

export async function createZone(
  data: ZoneInput,
  children: { area_name: string | null }[],
): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = zoneInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "zones", p.data.zone_name, {
    nameColumn: "zone_name",
  });
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s
    .from("zones")
    .insert(p.data)
    .select("id")
    .single();
  if (error) return fail(error.message);
  if (children.length > 0) {
    const { error: childErr } = await s.from("zone_areas").insert(
      children.map((c) => ({ zone_id: row.id, ...c })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function updateZone(
  id: string,
  data: ZoneInput,
  children: { area_name: string | null }[],
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = zoneInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "zones", p.data.zone_name, {
    nameColumn: "zone_name",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("zones").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  // Replace children wholesale
  await s.from("zone_areas").delete().eq("zone_id", id);
  if (children.length > 0) {
    const { error: childErr } = await s.from("zone_areas").insert(
      children.map((c) => ({ zone_id: id, ...c })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true };
}

/**
 * DELETE A ZONE, or switch it off if anything still points at it.
 *
 * THIS REPLACED `deactivateZone` ON 2026-09-11, and the replacement is what the
 * Status switch made necessary rather than merely tidy. That action only ever
 * set `inactive = true`, so the listing's row menu offered "Deactivate" — and
 * once the same listing grew a switch calling `setMasterActive`, the master had
 * TWO controls for one flag, one of which never said which way the row was
 * currently set. `bank-master-screen.tsx` records the same removal for the same
 * reason.
 *
 * So the flag is the switch's and this is an ordinary delete, through the guard
 * every other Associates master already uses: an unreferenced zone goes (its
 * `zone_areas` cascade, 0308), and a referenced one soft-disables with `usedBy`
 * naming where. Nothing else in the app called `deactivateZone`.
 *
 * `inactive` is the column — `0305_new_tables_blocked_to_inactive.sql:17`
 * renamed it, and the old action wrote `blocked` until 2026-08-10. It is stated
 * once here and once in `active-registry.ts`, and both read it from that
 * migration rather than from each other.
 */
export async function deleteZone(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "zones", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
