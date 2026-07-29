"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { GSTIN_RE } from "@/lib/validation/formats";
import { isGstinChecksumValid, normalizeGstin } from "@/lib/validation/gstin";
import { getGstinProvider } from "@/lib/integration/gstin/provider";
import type { GstinDetails, GstinLookupResult } from "@/lib/integration/gstin/types";

// ============================================================================
// Online GSTIN lookup. DORMANT until a provider is configured — getGstinProvider()
// returns null in v1, so this short-circuits to "not_configured" before touching
// the network or the database, even if something calls it directly.
//
// Answers are cached in public.gstin_lookup_cache keyed by GSTIN because every
// provider bills per call and registry facts change rarely.
// ============================================================================

const gstinInput = z
  .string()
  .trim()
  .transform(normalizeGstin)
  .refine((v) => GSTIN_RE.test(v), "Invalid GSTIN")
  .refine(isGstinChecksumValid, "GSTIN check digit is wrong");

type CacheRow = {
  gstin: string;
  legal_name: string | null;
  trade_name: string | null;
  constitution: string | null;
  taxpayer_type: string | null;
  gst_status: string | null;
  registered_on: string | null;
  cancelled_on: string | null;
  principal_address: string | null;
  state_code: string | null;
  jurisdiction_centre: string | null;
  jurisdiction_state: string | null;
  nature_of_business: string[] | null;
  fetched_at: string;
};

function rowToDetails(r: CacheRow): GstinDetails {
  return {
    gstin: r.gstin,
    legalName: r.legal_name,
    tradeName: r.trade_name,
    constitution: r.constitution,
    taxpayerType: r.taxpayer_type,
    status: (r.gst_status as GstinDetails["status"]) ?? null,
    registeredOn: r.registered_on,
    cancelledOn: r.cancelled_on,
    principalAddress: r.principal_address,
    stateCode: r.state_code,
    jurisdictionCentre: r.jurisdiction_centre,
    jurisdictionState: r.jurisdiction_state,
    natureOfBusiness: r.nature_of_business,
  };
}

/**
 * Look up the registry facts behind a GSTIN: cache first, provider second.
 * Read-only — it never writes to a vendor, so there is no revalidatePath here.
 * The caller decides what (if anything) to copy onto the form.
 */
export async function lookupGstin(raw: string): Promise<GstinLookupResult> {
  if (!(await can("masters", "edit"))) {
    return { ok: false, code: "not_configured", error: "Forbidden" };
  }

  const parsed = gstinInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid GSTIN" };
  }
  const gstin = parsed.data;

  // Checked BEFORE any I/O: with no provider there is nothing to fall back to,
  // and we don't want a dormant feature touching the database either.
  const provider = getGstinProvider();
  if (!provider) {
    return { ok: false, code: "not_configured", error: "GSTIN lookup is not configured" };
  }

  const s = await createClient();

  const { data: cached } = await s
    .from("gstin_lookup_cache")
    .select("*")
    .eq("gstin", gstin)
    .eq("status", "ok")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (cached) {
    const row = cached as CacheRow;
    return { ok: true, source: "cache", fetchedAt: row.fetched_at, details: rowToDetails(row) };
  }

  const fresh = await provider.fetch(gstin);
  if (!fresh.ok) return fresh;

  const d = fresh.details;
  const now = new Date();
  const expires = new Date(now.getTime() + provider.ttlHours * 3600_000);

  const { error } = await s.from("gstin_lookup_cache").upsert(
    {
      gstin,
      provider: provider.name,
      status: "ok",
      legal_name: d.legalName,
      trade_name: d.tradeName,
      constitution: d.constitution,
      taxpayer_type: d.taxpayerType,
      gst_status: d.status,
      registered_on: d.registeredOn,
      cancelled_on: d.cancelledOn,
      principal_address: d.principalAddress,
      state_code: d.stateCode,
      jurisdiction_centre: d.jurisdictionCentre,
      jurisdiction_state: d.jurisdictionState,
      nature_of_business: d.natureOfBusiness,
      fetched_at: now.toISOString(),
      expires_at: expires.toISOString(),
    },
    { onConflict: "gstin" },
  );
  // A cache write failure costs a repeat call, not correctness — still answer.
  if (error) console.error("gstin_lookup_cache upsert failed", error.message);

  return { ok: true, source: "provider", fetchedAt: now.toISOString(), details: d };
}
