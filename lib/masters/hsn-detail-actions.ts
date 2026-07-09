"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { hsnDetailInput, type HsnDetailInput } from "./hsn-detail-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/gst");
  revalidatePath("/masters/gst/hsn-detail");
}

export async function createHsnDetail(data: HsnDetailInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = hsnDetailInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("hsn_details").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateHsnDetail(id: string, data: HsnDetailInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = hsnDetailInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("hsn_details").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteHsnDetail(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("hsn_details").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
