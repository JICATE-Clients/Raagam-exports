// ============================================================================
// Contract for an ONLINE GSTIN lookup — the registry facts a GST number cannot
// tell you by itself (legal name, trade name, filing status, addresses).
//
// DORMANT. No provider is registered (see ./provider.ts), so nothing here makes
// a network call today. This exists so that switching a provider on later is a
// one-file change rather than a redesign.
//
// Everything derivable from the 15 characters WITHOUT a lookup lives in
// lib/validation/gstin.ts and is always available, free.
// ============================================================================

/** Normalized shape every provider maps its payload into. */
export interface GstinDetails {
  gstin: string;
  /** Registered legal name of the business (portal: `lgnm`). */
  legalName: string | null;
  /** Trading name, often what appears on the invoice (portal: `tradeNam`). */
  tradeName: string | null;
  /** e.g. "Private Limited Company", "Proprietorship" (portal: `ctb`). */
  constitution: string | null;
  /** "Regular" | "Composition" | "SEZ Unit" | "Input Service Distributor" … (portal: `dty`). */
  taxpayerType: string | null;
  /** The one field worth re-checking periodically — a cancelled GSTIN blocks ITC. */
  status: "Active" | "Cancelled" | "Suspended" | "Provisional" | "Inactive" | null;
  /** ISO date (portal: `rgdt`). */
  registeredOn: string | null;
  /** ISO date (portal: `cxdt`). */
  cancelledOn: string | null;
  /** Principal place of business, flattened to one line (portal: `pradr`). */
  principalAddress: string | null;
  stateCode: string | null;
  jurisdictionCentre: string | null;
  jurisdictionState: string | null;
  natureOfBusiness: string[] | null;
}

export type GstinLookupResult =
  | { ok: true; source: "cache" | "provider"; fetchedAt: string; details: GstinDetails }
  | {
      ok: false;
      error: string;
      code: "not_configured" | "not_found" | "rate_limited" | "provider_error" | "invalid";
    };

export interface GstinProvider {
  /** Persisted onto the cache row, so a provider switch is traceable. */
  readonly name: string;
  /** How long this provider's answers stay fresh. Lookups are billed per call. */
  readonly ttlHours: number;
  fetch(gstin: string): Promise<GstinLookupResult>;
}
