import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Orders ▸ CAD Markers (0460). doc/file.md §2.
//
// A sheet per garment order, a layout per marker (one style at one roll dia,
// with its PDF), and a gram weight per coordinate component panel.
//
// KEYED TO `garment_order_amendments` — the same call 0418 and 0426 both record:
// the styles, combos and components a marker is measured against live on the
// amendment, and the `sales_orders` shell carries none of them.
//
// NO DOCUMENT NUMBER. doc/file.md §1 makes the RE No the universal key and this
// sheet is one-per-order, so a CAD number would be a second name for one job.
// ============================================================================

/** Draft while CAD is still measuring; Submitted is what §2 calls the handoff. */
export const CAD_STATUSES = ["draft", "submitted"] as const;
export type CadStatus = (typeof CAD_STATUSES)[number];

export function cadStatusText(s: CadStatus): string {
  return s === "submitted" ? "Submitted" : "Draft";
}
/** NEUTRAL for a draft, not warning — `lib/ui/tone.ts`: neutral is "no claim",
 *  and work in progress is not work that has gone wrong (bom-status.ts's call). */
export function cadStatusTone(s: CadStatus): "neutral" | "success" {
  return s === "submitted" ? "success" : "neutral";
}

/**
 * The QUEUE's status for one order — a wider vocabulary than the sheet's own.
 *
 * FOUR STATES, AND TWO OF THEM ARE NOT ON THE SHEET. `bom-status.ts` makes the
 * same argument for the BOM queue: an order with no sheet at all has to be
 * visible as "Pending" or the queue could never show the case it exists for, and
 * a sheet SUBMITTED with panels still unweighed is a different claim from one
 * where every panel is measured — folding the second into "Submitted" is the
 * "restrict only in case X" leak the nominated-vendor rule records, since every
 * state that is not the exception then reads as done.
 */
export type CadQueueStatus = "pending" | "draft" | "measuring" | "submitted";

export function cadQueueStatus(
  status: CadStatus | null,
  unweighed: number,
): CadQueueStatus {
  if (status === null) return "pending";
  if (status === "draft") return "draft";
  return unweighed > 0 ? "measuring" : "submitted";
}

export function cadQueueStatusText(s: CadQueueStatus): string {
  switch (s) {
    case "pending":
      return "Pending";
    case "draft":
      return "Draft";
    case "measuring":
      return "Panels unweighed";
    default:
      return "Submitted";
  }
}

export function cadQueueStatusTone(s: CadQueueStatus): "warning" | "neutral" | "danger" | "success" {
  switch (s) {
    case "pending":
      return "warning";
    case "draft":
      return "neutral";
    // DANGER, not warning: a sheet marked submitted with panels nobody has
    // weighed is the one state that reads as done downstream and is not. Every
    // other tone lets it be left.
    case "measuring":
      return "danger";
    default:
      return "success";
  }
}

export interface CadComponentWeight {
  id: string;
  layout_id: string;
  sno: number;
  coordinate_id: string | null;
  component_id: string | null;
  /** The fabric this panel is cut from — a `categories` row. Every source of a
   *  panel speaks that one vocabulary: the Fabric BOM line's `structure_id`
   *  (0426), the order's style components (0457) and the combo tree's own
   *  structure row, which 0409 repointed off `config_lookups`. */
  fabric_category_id: string | null;
  /** Grams per garment for this panel. NULL = not measured yet, never 0. */
  grams: number | null;
  notes: string | null;
}

export interface CadMarkerLayout {
  id: string;
  marker_id: string;
  sno: number;
  /** By VALUE (0407 · 0421) — the amendment's style rows are reinserted on every
   *  save, so an FK to one would dangle. */
  style_ref_no: string | null;
  /** Dia / Width (வித்) — the fabric roll width, in the same numeric(10,2) the
   *  Fabric BOM line uses, so the handoff copies it rather than converting it. */
  dia: number | null;
  file_name: string | null;
  /** The key inside the PRIVATE `garment-order-docs` bucket (0416). Never a URL:
   *  a signed one expires and a stored one 404s next week. */
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  notes: string | null;
  weights: CadComponentWeight[];
}

/** The order a CAD sheet is measured for, as much as the queue and editor need. */
export type CadOrder = {
  id: string;
  code: string | null;
  po_no: string | null;
  delivery_date: string | null;
  customer: { id: string; code: string | null; name: string } | null;
  /** The RE No, stamped on the minted shell by 0395. */
  sales_order: { id: string; order_number: string | null } | null;
};

export interface CadMarker {
  id: string;
  garment_order_id: string;
  marker_date: string;
  status: CadStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  remark: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  garment_order?: CadOrder | null;
  layouts: CadMarkerLayout[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

/**
 * One panel's weight.
 *
 * THE RULE IS IN THE SCHEMA, NOT IN THE ACTION — the argument AGENTS.md makes
 * for the CAPITALS transform: `lib/data-io` parses with these same `*Input`
 * schemas and writes straight to Postgres, so a rule enforced only in the server
 * action misses every import path the moment one exists.
 *
 * `grams` IS NULLABLE AND MUST STAY SO. A sheet being filled in has panels
 * nobody has weighed yet, and `not null` would turn "not measured" into a save
 * failure. What it may not be is 0 — the refusal below is the same sentence
 * `componentWeightsForOrder` prints, word for word, because two spellings of one
 * refusal is how an operator comes to believe there are two different problems.
 */
export const cadWeightInput = z
  .object({
    sno: z.coerce.number().int().nonnegative().default(0),
    coordinate_id: uuidN,
    component_id: uuidN,
    fabric_category_id: uuidN,
    grams: numN,
    notes: capsTextNullable(),
  })
  .superRefine((v, ctx) => {
    if (v.grams != null && v.grams <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["grams"],
        message: "A panel weight must be more than 0 g",
      });
    }
    // A weight with no panel cannot be matched to a Fabric BOM line, and the
    // rollup refuses it by name. Gated on a weight being TYPED: an untouched
    // blank row is how a grid opens (the `seedRow` rule) and it is dropped
    // before it reaches the database.
    if (v.grams != null && !v.component_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["component_id"],
        message: "Choose the panel this weight is for",
      });
    }
  });

export const cadLayoutInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: capsTextNullable(),
  dia: numN,
  file_name: nullableText,
  storage_path: nullableText,
  mime_type: nullableText,
  size_bytes: z.coerce.number().nullable().default(null),
  notes: capsTextNullable(),
  weights: z.array(cadWeightInput).default([]),
});

export const cadMarkerInput = z.object({
  /**
   * MANDATORY, and the only header field that is. Every weight on the sheet is
   * measured for a style THIS order declares, so a sheet with no order is not an
   * incomplete record — it is a set of panels belonging to nothing.
   */
  garment_order_id: z.string().uuid({ message: "Choose the garment order" }),
  marker_date: z.string().min(1, "Date is required"),
  /** Save vs Save as Draft. Submitting is what §2 calls the handoff, and it is
   *  the state `seedFabricBomFromCad` refuses to run without. */
  is_submitted: z.boolean().default(false),
  remark: capsTextNullable(),
  layouts: z.array(cadLayoutInput).default([]),
});

export type CadMarkerInput = z.infer<typeof cadMarkerInput>;
export type CadLayoutInput = z.infer<typeof cadLayoutInput>;
export type CadWeightInput = z.infer<typeof cadWeightInput>;
