"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";

type R = { ok: true } | { ok: false; error: string };

/**
 * Sales → Planning handoff: raise a Product Development request from an
 * opportunity. Writes into Planning's `pd_requests` via the admin client
 * (best-effort cross-module hook — a Sales user need not hold `planning`
 * permissions). Deduped to one non-cancelled PD request per opportunity.
 */
export async function requestProductDevelopment(opportunityId: string): Promise<R> {
  if (!(await can("sales", "create"))) return { ok: false, error: "Forbidden" };

  const supabase = await createClient();
  const { data: opp } = await supabase
    .from("opportunities")
    .select("id, code, title, buyer_id")
    .eq("id", opportunityId)
    .maybeSingle();
  if (!opp) return { ok: false, error: "Opportunity not found" };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("pd_requests")
    .select("id")
    .eq("opportunity_id", opportunityId)
    .neq("status", "cancelled")
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: "Product development already requested for this opportunity" };
  }

  const user = await getAppUser();
  const { error } = await admin.from("pd_requests").insert({
    opportunity_id: opp.id,
    buyer_id: opp.buyer_id,
    title: opp.title,
    description: `Raised from Sales opportunity ${opp.code ?? opp.id.slice(0, 8)}`,
    stage: "acknowledged",
    status: "open",
    created_by: user?.id ?? null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/sales/${opportunityId}`);
  revalidatePath("/planning/product-dev");
  return { ok: true };
}
