"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { destinationInput, type DestinationInput } from "./destination-types";
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
  revalidatePath("/masters/associates/destination");
}

export async function createDestination(data: DestinationInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = destinationInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // Matches the DB's own unique index (0335: country_id, lower(trim(short_name))) —
  // this just turns that constraint into a readable error instead of a raw
  // Postgres "duplicate key" message.
  const dup = await checkDuplicateName(s, "destinations", p.data.short_name, {
    nameColumn: "short_name",
    scope: { country_id: p.data.country_id },
    label: "short name",
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("destinations").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateDestination(id: string, data: DestinationInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = destinationInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "destinations", p.data.short_name, {
    nameColumn: "short_name",
    scope: { country_id: p.data.country_id },
    excludeId: id,
    label: "short name",
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("destinations").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteDestination(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "destinations", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
