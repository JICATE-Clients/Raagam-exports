"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { pfEsiControlInput, type PfEsiControlInput } from "./pf-esi-control-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/hr");
  revalidatePath("/masters/hr/pf-esi-control");
}

export async function createPfEsiControl(data: PfEsiControlInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = pfEsiControlInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("pf_esi_controls").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updatePfEsiControl(id: string, data: PfEsiControlInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = pfEsiControlInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("pf_esi_controls").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deletePfEsiControl(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("pf_esi_controls").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
