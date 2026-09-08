"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { taApprovalInput, type TaApprovalInput } from "./ta-approval-types";
import { deleteOrDeactivate } from "./delete-guard";
import { checkDuplicateName } from "./dup-guard";

type Result = { ok: true } | { ok: false; error: string };
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/system");
  revalidatePath("/masters/system/ta-approvals");
}

export async function createTaApproval(data: TaApprovalInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = taApprovalInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  // Two separate identity columns, two separate checks — `short_name` is what
  // the PP-Sample/cutting-hardlock bridges match by convention
  // (`lib/orders/amendments/actions.ts`), so a collision there is a correctness
  // bug, not a cosmetic one. `name` is what an operator actually reads.
  const dupShort = await checkDuplicateName(s, "ta_approvals", p.data.short_name, {
    nameColumn: "short_name",
    label: "short name",
  });
  if (!dupShort.ok) return fail(dupShort.error);
  const dupName = await checkDuplicateName(s, "ta_approvals", p.data.name, { label: "name" });
  if (!dupName.ok) return fail(dupName.error);
  const { error } = await s.from("ta_approvals").insert(p.data);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateTaApproval(id: string, data: TaApprovalInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = taApprovalInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dupShort = await checkDuplicateName(s, "ta_approvals", p.data.short_name, {
    nameColumn: "short_name",
    label: "short name",
    excludeId: id,
  });
  if (!dupShort.ok) return fail(dupShort.error);
  const dupName = await checkDuplicateName(s, "ta_approvals", p.data.name, {
    label: "name",
    excludeId: id,
  });
  if (!dupName.ok) return fail(dupName.error);
  const { error } = await s.from("ta_approvals").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteTaApproval(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "ta_approvals", id);
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
