"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  defaultAccountHeadInput,
  type DefaultAccountHeadInput,
} from "./default-account-head-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/default-account-head");
}

export async function upsertDefaultAccountHead(
  existingId: string | null,
  data: DefaultAccountHeadInput,
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = defaultAccountHeadInput.safeParse(data);
  if (!p.success)
    return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();

  if (existingId) {
    const { error } = await s
      .from("default_account_heads")
      .update(p.data)
      .eq("id", existingId);
    if (error) return fail(error.message);
  } else {
    const { error } = await s.from("default_account_heads").insert(p.data);
    if (error) return fail(error.message);
  }

  rev();
  return { ok: true };
}
