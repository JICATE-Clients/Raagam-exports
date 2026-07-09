"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { merchandisingTeamInput, type MerchandisingTeamInput } from "./merchandising-team-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/merchandising-team");
}

export async function createMerchandisingTeam(data: MerchandisingTeamInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = merchandisingTeamInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("merchandising_teams").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateMerchandisingTeam(
  id: string,
  data: MerchandisingTeamInput,
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = merchandisingTeamInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("merchandising_teams").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteMerchandisingTeam(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("merchandising_teams").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
