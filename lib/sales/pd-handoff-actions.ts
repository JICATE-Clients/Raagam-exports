"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { pdRequestFormInput } from "@/lib/sales/types";

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

/**
 * Raise a Product Development request from the Sales "Product Development
 * Request" screen — anchored on an enquiry (opportunity) with the legacy extras
 * (style · sample type/qty · unit · delivery date · customer reference). Unlike
 * the per-opportunity button this does NOT dedupe (legacy is by-sample, so an
 * enquiry can have several). Writes via the admin client (planning-gated table).
 */
export async function createPdRequest(raw: unknown): Promise<R> {
  if (!(await can("sales", "create"))) return { ok: false, error: "Forbidden" };

  const parsed = pdRequestFormInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const f = parsed.data;

  const supabase = await createClient();
  const { data: opp } = await supabase
    .from("opportunities")
    .select("id, buyer_id")
    .eq("id", f.opportunity_id)
    .maybeSingle();
  if (!opp) return { ok: false, error: "Enquiry not found" };

  const admin = createAdminClient();
  const user = await getAppUser();

  const { data: created, error } = await admin
    .from("pd_requests")
    .insert({
      opportunity_id: f.opportunity_id,
      buyer_id: (opp as { buyer_id: string | null }).buyer_id,
      title: f.title,
      description: f.description ?? null,
      style_id: f.style_id ?? null,
      sample_type: f.sample_type ?? null,
      sample_qty: f.sample_qty ?? null,
      unit_id: f.unit_id ?? null,
      delivery_date: f.delivery_date || null,
      customer_reference: f.customer_reference ?? null,
      stage: "acknowledged",
      status: "open",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !created) {
    return { ok: false, error: error?.message ?? "Failed to raise PD request" };
  }

  // Seed a product line for the chosen style so Planning's PD pipeline can group it.
  if (f.style_id) {
    const { data: style } = await supabase
      .from("styles")
      .select("name")
      .eq("id", f.style_id)
      .maybeSingle();
    if (style) {
      await admin.from("pd_products").insert({
        pd_request_id: (created as { id: string }).id,
        style_id: f.style_id,
        name: (style as { name: string }).name,
      });
    }
  }

  revalidatePath("/sales/pd-requests");
  revalidatePath("/planning/product-dev");
  return { ok: true };
}

/** Cancel a PD request from the Sales screen (sets status = cancelled). */
export async function cancelPdRequest(id: string): Promise<R> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "Forbidden" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("pd_requests")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/sales/pd-requests");
  revalidatePath("/planning/product-dev");
  return { ok: true };
}
