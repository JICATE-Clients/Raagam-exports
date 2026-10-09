/**
 * Sample ▸ Grouping — vocabulary and the shapes the screen and the server share
 * (doc/sample/product-grouping-specification.md; tables 0702).
 *
 * PURE: no server-only import, so the screen and the actions read one status
 * vocabulary and one input schema.
 */
import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

/** The spec's five, stored lower-case (0702 CHECK). */
export const GROUP_STATUSES = ["draft", "approved", "po_raised", "fabric_received", "completed"] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

/** `po_raised` reads "IW raised": what the screen raises is the Internal Work
 *  Order the yarn and knitting are planned on (spec §6), not a PO itself. */
export const GROUP_STATUS_LABEL: Record<GroupStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  po_raised: "IW raised",
  fabric_received: "Fabric received",
  completed: "Completed",
};
export const GROUP_STATUS_TONE: Record<GroupStatus, StatusTone> = {
  draft: "neutral",
  approved: "info",
  po_raised: "warning",
  fabric_received: "info",
  completed: "success",
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
  customer: string | null;
  components: string;
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
  created_at: string;
  created_by: string | null;
  created_by_name?: string | null;
  items: GroupItemRow[];
};

export type GroupingData = {
  candidates: GroupingCandidate[];
  groups: GroupRow[];
  /** Saved styles with no current costing — they cannot be weighed yet. */
  uncosted: { style_id: string; sample_no: string | null; style_name: string; season: string; season_year: number | null }[];
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
