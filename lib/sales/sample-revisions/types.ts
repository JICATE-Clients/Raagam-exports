/**
 * Sample ▸ Revision — the shared vocabulary (doc/sample/sample revion.md;
 * tables 0716). Client-safe: no server imports.
 *
 * A sample is LOCKED once its costing is approved; a revision unlocks only the
 * modules it names and goes to the MD. See the 0716 header for how the spec's
 * modules map onto the SMP entry and the versioned costing.
 */

export const REVISION_KINDS = ["sample_info", "fabric_spec", "trims", "costing"] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

/** The module picker's words and what each one opens. */
export const REVISION_KIND_LABEL: Record<RevisionKind, string> = {
  sample_info: "Sample Info & Qty",
  fabric_spec: "Fabric & Yarn Spec",
  trims: "Accessories & Trims",
  costing: "Costing & Price",
};
export const REVISION_KIND_HINT: Record<RevisionKind, string> = {
  sample_info: "The Sample Entry: sample qty, delivery date, sizes, colour quantities.",
  fabric_spec: "The costing's fabrics, yarn mix, processes and garment weights (GSM, size, wastage).",
  trims: "The costing's trims: item, consumption, pack size.",
  costing: "Every rate on the costing: fabric, yarn, process, CMT, overheads, quotes.",
};
/** Does this revision open the costing (make its next revision)? */
export const opensCosting = (kinds: readonly string[]) => kinds.some((k) => k !== "sample_info");

export const REVISION_ORIGINS = ["customer", "internal"] as const;
export type RevisionOrigin = (typeof REVISION_ORIGINS)[number];
export const REVISION_ORIGIN_LABEL: Record<RevisionOrigin, string> = { customer: "By Customer", internal: "Internal" };

export type RevisionStatus = "draft" | "pending" | "approved" | "rejected" | "abandoned";
export const REVISION_STATUS_LABEL: Record<RevisionStatus, string> = {
  draft: "In revision",
  pending: "With MD",
  approved: "Approved",
  rejected: "Rejected",
  abandoned: "Abandoned",
};

/** The cost heads the V0 / proposed comparison shows, per costing. */
export type CostingKpis = {
  cost_sheet_id: string;
  costing_no: string | null;
  version: number;
  currency: string | null;
  fabric: number | null;
  trims: number | null;
  cmt: number | null;
  process: number | null;
  overheads: number | null;
  gross_cost: number | null;
  quoted: number | null;
  margin_pct: number | null;
};

export type CostingPair = { parent_id: string; proposed_id: string };

/** One revision as the register and its page read it. */
export type SampleRevisionRow = {
  id: string;
  revision_code: string;
  revision_no: number;
  opportunity_id: string;
  smp_no: string | null;
  customer_name: string | null;
  style_names: string[];
  origin: RevisionOrigin;
  kinds: RevisionKind[];
  remarks: string;
  status: RevisionStatus;
  costing_pairs: CostingPair[];
  v0_kpis: CostingKpis[] | null;
  proposed_kpis: CostingKpis[] | null;
  decision_remark: string | null;
  revert_error: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name?: string | null;
};

/** A locked sample a revision can be raised on. */
export type RaisableSample = {
  id: string;
  smp_no: string | null;
  customer_name: string | null;
  style_names: string[];
};

/** What the Raise Revision form sends. */
export type RaiseSampleRevisionInput = {
  opportunity_id: string;
  kinds: RevisionKind[];
  origin: RevisionOrigin;
  remarks: string;
};
