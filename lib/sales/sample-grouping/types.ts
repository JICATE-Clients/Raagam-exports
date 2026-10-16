/**
 * Sample ▸ Grouping — vocabulary and the shapes the screen and the server share
 * (doc/sample/product-grouping-specification.md; tables 0702).
 *
 * PURE: no server-only import, so the screen and the actions read one status
 * vocabulary and one input schema.
 */
import { z } from "zod";
import { statusTone, type StatusTone } from "@/lib/ui/status-tone";

/** The spec's five, stored lower-case (0702 CHECK). */
export const GROUP_STATUSES = ["draft", "approved", "po_raised", "fabric_received", "completed"] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

/** `po_raised` reads "SWO raised" (user 2026-10-12, screenshot 3456: "which
 *  is not IW, which SWO"): the operator knows the batch by its SWO number; the
 *  Internal Work Order the yarn and knitting are planned on stays underneath. */
export const GROUP_STATUS_LABEL: Record<GroupStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  po_raised: "SWO raised",
  fabric_received: "Fabric received",
  completed: "Completed",
};
// A GROUP'S LIFECYCLE runs past approval — Approved is its first step and
// Completed (fabric distributed) its last — so Approved reads as "moving"
// (info), not done. SWO raised waits on the mill (amber).
const GROUP_TONES = { approved: "info", po_raised: "warning", fabric_received: "info" } as const;

export const GROUP_STATUS_TONE: Record<GroupStatus, StatusTone> = {
  draft: statusTone("draft", GROUP_TONES),
  approved: statusTone("approved", GROUP_TONES),
  po_raised: statusTone("po_raised", GROUP_TONES),
  fabric_received: statusTone("fabric_received", GROUP_TONES),
  completed: statusTone("completed", GROUP_TONES),
};

/**
 * ONE CANDIDATE = one style's fabric of one structure + yarn blend, weighed
 * from the style's current costing. A style costed in two fabrics (a Single
 * Jersey body, a Rib collar) is two candidates, because they are bought from
 * two different bags.
 */
export type GroupingCandidate = {
  /** `style|structure|blend` — the unique key of 0702's `uq_sgi_candidate`. */
  key: string;
  style_id: string;
  sample_entry_id: string;
  enquiry_no: string | null;
  sample_no: string | null;
  style_name: string;
  thumb_url: string | null;
  customer_id: string | null;
  customer: string | null;
  agent: string | null;
  season: string;
  season_id: string | null;
  season_year: number | null;
  fabric_structure_id: string | null;
  fabric_structure: string | null;
  gsm: number | null;
  yarn_blend: string;
  blend_key: string;
  /** Garment components weighed on this fabric — "BODY, SLEEVE". */
  components: string;
  sample_qty_pcs: number;
  /** Net kilos (loss included), or null when the costing gives no weight. */
  kg: number | null;
  cost_sheet_id: string;
  costing_code: string | null;
  /** The group it is batched in, if any. */
  group_id: string | null;
  group_code: string | null;
};

export type GroupItemRow = {
  id: string;
  style_id: string;
  sample_entry_id: string;
  enquiry_no: string | null;
  sample_no: string | null;
  style_name: string;
  customer_id: string | null;
  customer: string | null;
  components: string;
  /** The item's OWN structure and blend (0707: a group may mix them — the
   *  planner's call). Labels from the live costing; null once it is gone. */
  fabric_structure_id: string | null;
  fabric_structure: string | null;
  blend_key: string;
  yarn_blend: string | null;
  sample_qty_pcs: number;
  /** Stored at the last Draft change; frozen once approved. */
  calculated_weight_kg: number;
  allocated_fabric_kg: number | null;
  /** While Draft: the candidate's live figure, or null when it no longer exists. */
  live_kg: number | null;
  live_missing: boolean;
};

export type GroupRow = {
  id: string;
  group_code: string;
  season: string;
  season_year: number;
  fabric_structure_id: string | null;
  fabric_structure: string | null;
  yarn_blend: string;
  blend_key: string;
  moq_kg: number;
  batch_kg: number;
  cutting_waste_pct: number;
  net_required_weight_kg: number;
  moq_purchased_weight_kg: number;
  status: GroupStatus;
  iwo_id: string | null;
  iwo_code: string | null;
  remarks: string | null;
  /** The planner's own name for the SWO (0712); NULL shows the SWO number. */
  description: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name?: string | null;
  items: GroupItemRow[];
  /** Σ Req Wt per sample style on the SWO's Fabric Plan (0707) — the cutting
   *  basis `cuttingBasis` reads first. Empty until the plan names its SMPs. */
  plan_kg_by_style: Record<string, number>;
  /** The approval state of the SWO's two plans (0720), null while a plan does
   *  not exist yet. Read by `samplesLockedReason`. */
  fabric_plan_status: PlanStatus | null;
  accessories_plan_status: PlanStatus | null;
};

type PlanStatus = "open" | "submitted" | "approved" | "returned";

/**
 * WHY THIS SWO'S SAMPLES CAN NO LONGER BE ADDED OR REMOVED, or null while they
 * can (user 2026-10-16: "allow to edit, add, remove before plan approval only").
 *
 * The samples are what the two plans are planned FOR — once either plan is
 * approved, a sample joining or leaving would change an approved plan behind
 * the approver's back. Open, sent back and waiting-with-the-approver all stay
 * editable (the user's choice: lock at APPROVED, not at submit). A plan
 * revision sets the plan back to open (0727/0730), so revising a plan reopens
 * its samples with it. Read by the sheet AND by add / remove on the server.
 */
export function samplesLockedReason(g: Pick<GroupRow, "fabric_plan_status" | "accessories_plan_status">): string | null {
  const approved = [
    g.fabric_plan_status === "approved" ? "Fabric Plan" : null,
    g.accessories_plan_status === "approved" ? "Accessories Plan" : null,
  ].filter(Boolean);
  if (!approved.length) return null;
  return `The ${approved.join(" and ")} ${approved.length > 1 ? "are" : "is"} approved — samples can no longer be added or removed. Revise the plan to change them.`;
}

export type GroupingData = {
  candidates: GroupingCandidate[];
  groups: GroupRow[];
  /** Saved styles with no current costing — they cannot be weighed yet. */
  /** `smp_no` is the entry's SMP number — what the screen names a sample by
   *  (spec 2026-10-12: SMP, not the style line's PRD). */
  uncosted: { style_id: string; smp_no: string | null; sample_no: string | null; style_name: string; season: string; season_year: number | null }[];
};

/** The terms a Draft group is saved with. */
export const groupTermsInput = z.object({
  moq_kg: z.coerce.number().positive("MOQ must be more than 0 kg."),
  batch_kg: z.coerce.number().positive("Batch must be more than 0 kg."),
  cutting_waste_pct: z.coerce.number().min(0, "Cutting waste cannot be negative.").lt(100, "Cutting waste must be under 100 %."),
  remarks: z
    .string()
    .nullable()
    .default(null)
    .transform((v) => (v && v.trim() ? v.trim().toUpperCase() : null)),
});
export type GroupTermsInput = z.input<typeof groupTermsInput>;

export const candidateKey = (styleId: string, structureId: string | null, blendKey: string) =>
  `${styleId}|${structureId ?? ""}|${blendKey}`;
