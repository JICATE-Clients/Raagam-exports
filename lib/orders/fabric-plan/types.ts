import { z } from "zod";
import { STAGE_MODES } from "./route";
import { capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Orders ▸ Fabric Plan (0427). Step 4 of the client's order flow: the route that
// produces the fabric the BOM requires — yarn purchase, knitting, dyeing,
// stentering, compacting — with each stage's loss and who performs it.
//
// Header + two children — one line per fabric, and the route beneath each. The
// stage quantities are not typed: they are solved backwards from the BOM
// requirement by `./route.ts` and STORED. 0427's header argues for storing them
// and 0418's argues at greater length for the same thing one document up.
//
// A LINE ADDRESSES ITS BOM LINE BY VALUE. `order_fabric_bom_lines.id` does not
// survive its own document being saved — `writeLines` deletes and reinserts
// every line — so the five stable keys (style_ref_no, combo, structure_id,
// component_id, item_id) are the address. See 0427.
// ============================================================================

export const STAGE_MODE_OPTIONS = [
  { value: "in_house", label: "In-house" },
  { value: "outsourced", label: "Out-processed" },
] as const;

export interface FabricPlanStage {
  id: string;
  plan_id: string;
  line_id: string;
  sno: number;
  process_id: string | null;
  mode: string;
  /** The processor, on an out-processed stage. `master_vendors`, never
   *  `public.vendors` — the picker hands back a master id (0377 · 0427). */
  vendor_id: string | null;
  /** Percentage of this stage's INPUT lost. Strictly below 100. */
  loss_pct: number | null;
  /** Solved by `routeQuantities`, stored. NULL means refused, never zero. */
  input_qty: number | null;
  output_qty: number | null;
  uom_id: string | null;
  refusal_reason: string | null;
  planned_start: string | null;
  planned_end: string | null;
  notes: string | null;
}

export interface FabricPlanLine {
  id: string;
  plan_id: string;
  sno: number;
  style_ref_no: string | null;
  combo: string | null;
  structure_id: string | null;
  component_id: string | null;
  item_id: string | null;
  /** The BOM's requirement AS IT STOOD when this route was planned. A snapshot,
   *  never a live join — 0427's header gives both reasons. */
  required_qty: number | null;
  required_uom_id: string | null;
  notes: string | null;
  stages: FabricPlanStage[];
}

export interface FabricPlan {
  id: string;
  code: string | null;
  garment_order_id: string;
  plan_date: string;
  is_draft: boolean;
  remark: string | null;
  bom_id: string | null;
  /** The BOM's `computed_at` when this route was planned. Compared, never
   *  summed: it is what makes "the BOM has moved" a fact rather than a guess. */
  bom_computed_at: string | null;
  location_id: string | null;
  created_at: string;
  updated_at: string;
  garment_order?: {
    id: string;
    code: string | null;
    po_no: string | null;
    delivery_date: string | null;
    customer: { id: string; code: string | null; name: string } | null;
    sales_order: { id: string; order_number: string | null } | null;
  } | null;
  lines: FabricPlanLine[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

export const fabricPlanStageInput = z
  .object({
    sno: z.coerce.number().int().nonnegative().default(0),
    process_id: uuidN,
    mode: z.enum(STAGE_MODES).default("in_house"),
    vendor_id: uuidN,
    loss_pct: numN,
    uom_id: uuidN,
    planned_start: nullableText,
    planned_end: nullableText,
    notes: capsTextNullable(),
  })
  /**
   * THE STAGE RULES LIVE IN THE SCHEMA, NOT IN THE ACTION.
   *
   * `lib/data-io` parses imports with these same `*Input` schemas and writes
   * straight to Postgres, so a rule enforced only in the server action misses
   * every spreadsheet import — AGENTS.md's argument for putting the CAPITALS
   * transform in Zod rather than the action, applied to arithmetic.
   *
   * Gated on a process being NAMED, so an untouched blank row does not block
   * Save. The messages are `stageProblem()`'s, and that is not a coincidence to
   * be tidied away: two spellings of one refusal is how an operator comes to
   * believe there are two different problems. This schema cannot simply CALL
   * `stageProblem` for the whole row, because Zod has to attach each issue to
   * the `path` that names the offending control — so the messages are shared and
   * the routing is not.
   */
  .superRefine((v, ctx) => {
    if (!v.process_id) return;

    if (v.mode === "outsourced" && !v.vendor_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vendor_id"],
        message: "Name the processor for an out-processed stage",
      });
    }
    if (v.loss_pct == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loss_pct"],
        message: "Enter this stage's loss %, or 0 if there is none",
      });
    } else if (v.loss_pct < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loss_pct"], message: "Loss cannot be negative" });
    } else if (v.loss_pct >= 100) {
      // NOT `> 100`. At exactly 100 the solve divides by zero, and in JS that is
      // Infinity rather than a throw — an ordinary-looking figure on its way to a
      // purchase order. The column CHECK says the same thing (0427).
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["loss_pct"],
        message: "Loss must be less than 100% — nothing would come out",
      });
    }
  });

export const fabricPlanLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  style_ref_no: nullableText,
  combo: capsTextNullable(),
  structure_id: uuidN,
  component_id: uuidN,
  item_id: uuidN,
  required_qty: numN,
  required_uom_id: uuidN,
  notes: capsTextNullable(),
  stages: z.array(fabricPlanStageInput).default([]),
});

export const fabricPlanInput = z.object({
  /** MANDATORY — everything here is a route for one order's fabric, so a plan
   *  with no order is a document with no subject. */
  garment_order_id: z.string().uuid({ message: "Choose the garment order" }),
  plan_date: z.string().min(1, "Date is required"),
  is_draft: z.boolean().default(false),
  remark: nullableText,
  bom_id: uuidN,
  bom_computed_at: nullableText,
  lines: z.array(fabricPlanLineInput).default([]),
});

export type FabricPlanInput = z.infer<typeof fabricPlanInput>;
export type FabricPlanLineInput = z.infer<typeof fabricPlanLineInput>;
export type FabricPlanStageInput = z.infer<typeof fabricPlanStageInput>;

/** Draft vs Recorded — this DOCUMENT's own state, shown inside the editor.
 *  Distinct from `fabricPlanStatusText` below, which answers the QUEUE's
 *  question ("is this order's route planned, and is it still current?"). Both
 *  can say "Draft" and they are not the same claim. */
export function fabricPlanDraftText(is_draft: boolean): string {
  return is_draft ? "Draft" : "Recorded";
}

/**
 * A fabric the BOM requires, ready to have a route hung under it.
 *
 * Read off the BOM by the SERVICE, so the plan screen never has to know how the
 * BOM stores its requirement — and so the five-key address is built in one place
 * rather than at each end of it.
 */
export type PlannableFabric = {
  style_ref_no: string | null;
  combo: string | null;
  structure_id: string | null;
  structure_name: string | null;
  component_id: string | null;
  component_name: string | null;
  item_id: string | null;
  item_name: string | null;
  /** The BOM's stored requirement for this fabric, summed across its slices. */
  required_qty: number | null;
  required_uom_id: string | null;
  required_uom_code: string | null;
  /** Why there is no figure, when there is none — printed rather than dashed.
   *  A refused BOM line is a question nobody has answered, not a zero. */
  refusal: string | null;
};

/**
 * Which garment orders can be planned, and the state of each one's plan.
 *
 * NOT `BomTaskRow`. That type answers "has this order been BOM'd, and is the BOM
 * still current?" — a question about the ORDER moving. This one asks whether the
 * BOM has moved since the route was planned, which is a different comparison
 * over a different pair of timestamps, and folding them into one status would
 * make "Recalculate" mean two things depending on which screen showed it.
 */
export type FabricPlanTaskRow = {
  /** The garment order id — the row's identity. */
  id: string;
  sc_no: string | null;
  order_code: string | null;
  po_no: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  /** How many fabrics the BOM names. 0 = there is nothing to plan yet. */
  fabric_count: number;
  status: FabricPlanStatus;
  plan_id: string | null;
  stage_count: number;
  created_at: string;
  created_by: string | null;
};

export const FABRIC_PLAN_STATUSES = [
  "no_bom",
  "pending",
  "draft",
  "planned",
  "replan",
] as const;
export type FabricPlanStatus = (typeof FABRIC_PLAN_STATUSES)[number];

export function fabricPlanStatusOf(input: {
  bomRecorded: boolean;
  bomComputedAt: string | null;
  planExists: boolean;
  planIsDraft: boolean;
  planBomComputedAt: string | null;
  stageCount: number;
}): FabricPlanStatus {
  // NO BOM IS ITS OWN STATE, not "pending". A route cannot be planned against a
  // fabric list that does not exist, so the action the operator has to take is
  // on a different screen — and "Pending" would send them to this one.
  if (!input.bomRecorded) return "no_bom";
  if (!input.planExists || input.stageCount === 0) return "pending";
  if (input.planIsDraft) return "draft";
  // THE COMPARISON IS AGAINST THE BOM, NOT THE ORDER. Both BOMs already report
  // "the order moved" themselves; this is the one question only the plan can
  // answer. A plan saved before the column existed has null on one side, which
  // is `replan` rather than `planned`: claiming a route is current when nothing
  // can be compared is the guess that gets believed.
  if (!input.bomComputedAt || !input.planBomComputedAt) return "replan";
  return input.planBomComputedAt === input.bomComputedAt ? "planned" : "replan";
}

export function fabricPlanStatusText(s: FabricPlanStatus): string {
  switch (s) {
    case "no_bom":
      return "No BOM";
    case "pending":
      return "Pending";
    case "draft":
      return "Draft";
    case "planned":
      return "Planned";
    default:
      return "Re-plan";
  }
}

export function fabricPlanStatusTone(s: FabricPlanStatus): "neutral" | "warning" | "success" | "danger" {
  switch (s) {
    // NEUTRAL — `lib/ui/tone.ts`: neutral is "no claim". The order is not late
    // on this screen's work; the work has not reached it yet.
    case "no_bom":
      return "neutral";
    case "pending":
      return "warning";
    case "draft":
      return "neutral";
    case "planned":
      return "success";
    // DANGER, not warning. A stale route reads as done at any lighter tone, and
    // leaving it is the failure — the same call `bom-status.ts` makes for
    // `recalculate`.
    default:
      return "danger";
  }
}

/** Order of work for the queue: what needs doing, first. */
export const FABRIC_PLAN_STATUS_RANK: Record<FabricPlanStatus, number> = {
  replan: 0,
  pending: 1,
  draft: 2,
  no_bom: 3,
  planned: 4,
};
