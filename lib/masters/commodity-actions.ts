"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { commodityInput, type CommodityInput } from "./commodity-types";
import { checkDuplicateName } from "./dup-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/commodities");
}

export async function createCommodity(data: CommodityInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = commodityInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "commodities", p.data.name);
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s.from("commodities").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateCommodity(id: string, data: CommodityInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = commodityInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "commodities", p.data.name, { excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("commodities").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteCommodity(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("commodities").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
