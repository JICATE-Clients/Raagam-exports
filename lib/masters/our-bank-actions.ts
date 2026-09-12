"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { ourBankInput, type OurBankInput } from "./our-bank-types";
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
  revalidatePath("/masters/associates/our-banks");
}

export async function createOurBank(data: OurBankInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = ourBankInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "our_banks", p.data.account_no, { nameColumn: "account_no" });
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s.from("our_banks").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateOurBank(id: string, data: OurBankInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = ourBankInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "our_banks", p.data.account_no, { nameColumn: "account_no", excludeId: id });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("our_banks").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteOurBank(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  /**
   * `inactive`, NOT `blocked` — fixed 2026-09-11, and this is the SECOND time
   * this exact line has been wrong in this repo.
   *
   * `0305_new_tables_blocked_to_inactive.sql:8` renamed this column and
   * `our-bank-types.ts` has said `inactive` ever since; only this write was left
   * behind. It reached the soft-disable path — the one taken whenever the bank
   * is referenced by anything, which is the ordinary case — and updated a column
   * that does not exist, so PostgREST errored and deleting an in-use bank
   * reported a failure instead of switching it off.
   *
   * `deactivateZone` in `zone-actions.ts` carried the identical line from the
   * identical migration and was fixed on 2026-08-10. Found here while
   * registering `our_bank` in `lib/masters/active-registry.ts`, whose column had
   * to be read from the catalog rather than from this file.
   */
  const res = await deleteOrDeactivate(s, "our_banks", id, "inactive");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}
