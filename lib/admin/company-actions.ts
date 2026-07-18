"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { companyProfileInput, type CompanyProfileInput } from "./company-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/admin");
  revalidatePath("/admin/company");
}

export async function saveCompanyProfile(data: CompanyProfileInput): Promise<Result> {
  if (!(await can("system_admin", "edit"))) return fail("Forbidden");
  const p = companyProfileInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();

  // Check if a row already exists (singleton)
  const { data: existing } = await s
    .from("company_profile")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await s
      .from("company_profile")
      .update(p.data)
      .eq("id", existing.id);
    if (error) return fail(error.message);
  } else {
    const { error } = await s.from("company_profile").insert(p.data);
    if (error) return fail(error.message);
  }

  rev();
  return { ok: true };
}
