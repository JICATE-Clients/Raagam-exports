import { z } from "zod";
import { capsName } from "@/lib/validation/formats";

// ============================================================================
// Processes — master-detail (0227). Legacy EDP2 "Process" form: a header (name,
// billing basis, "For" applicability flags, planning flags) + an optional
// "Sub Categories" line grid.
//
// Commodity was withdrawn from this master (client 2026-08-01) along with the
// Commodities child itself. `processes.commodity_id` still EXISTS in the
// database and keeps its stored value; leaving it out of this schema is what
// stops every save from writing null over it.
// ============================================================================
export const BILLING_ON = ["Outward Qty", "Inward Qty/Wt", "Outward Qty/Wt"] as const;
export type BillingOn = (typeof BILLING_ON)[number];

export interface ProcessSubCategory {
  id: string;
  process_id: string;
  sno: number;
  sub_category: string;
  /* NO `short_description`. IT WAS HERE AND THE CLIENT REMOVED IT (2026-09-16,
     doc/order/fabriprocess.md §4 — "the redundant short description textbox").
     Column, row field, payload schema and DB column all went together (0565),
     the same shape `rate` left in 0521 and `description` in 0528. The header's
     own Short Description went in the same change; see `Process` below. */
  hsn_code: string | null;
}

/**
 * WHICH FABRIC STAGES THIS PROCESS MAY RUN IN, and where it is that stage's
 * mandatory entry step (0563, `process_fabric_stages`).
 *
 * A TABLE AND NOT A FLAG PER PROCESS, deliberately: Knitting is the base of
 * Greige, Dyeing of Dyed, Washing of Washed and Printing of Printed — but
 * Stentering and Compacting are secondary steps in three different stages at
 * once, so "which stage" has no single answer per process.
 *
 * Seeded once by 0563 from the master's own names, and OPERATOR-MAINTAINED from
 * then on — exactly as `is_print` (0528) and `is_dyeing` (0557) below are. The
 * grid on the Process master is where it is maintained, and it renders only when
 * `for_fabric` is ticked: a stage route is meaningless on a garment or trims
 * process.
 */
export interface ProcessFabricStage {
  id: string;
  process_id: string;
  /**
   * `config_lookups` kind 'fabric_stage'. On the live master the four rows are
   * **GREIGE · DYED · WASH · PRINT** — an operator renamed 0492's GREY row and
   * added the other two under their own codes, and 0563 deliberately binds to
   * those rows (matching by code OR name, case-insensitively) rather than
   * creating WASHED/PRINTED duplicates beside them.
   *
   * So READ THE LIST, never the code string: anything keyed off `'washed'` /
   * `'printed'` matches nothing here, and the names can change again — the list
   * is operator-maintained by design.
   */
  stage_id: string;
  /** Is this process the stage's MANDATORY entry step? */
  is_base: boolean;
}
export interface Process {
  id: string;
  name: string;
  /* NO `short_description`. IT WAS HERE AND THE CLIENT REMOVED IT (2026-09-16,
     doc/order/fabriprocess.md §4). Gone from the DATABASE (0565) and not merely
     from the screen, for the reason `rate` and `description` record in
     `lib/orders/fabric-bom/processes.ts`: `lib/data-io` parses imports with the
     `processInput` schema below and writes straight to Postgres, so a field left
     standing there is a door the form has closed and an import can still walk
     through — and `processes` IS a data-io entity. */
  billing_on: BillingOn | null;
  hsn_code: string | null;
  for_yarn: boolean;
  for_fabric: boolean;
  for_trims: boolean;
  for_garments: boolean;
  for_components: boolean;
  no_planning: boolean;
  designwise_delivery: boolean;
  is_conversion: boolean;
  /** Is this a PRINT process (AOP, rotary, bit printing, …)? (0528) — read by
   *  the Fabric BOM ▸ Fabric Process picker to refuse "Print" until the order
   *  has declared a Roll form print / AOP. Seeded once from names already
   *  containing PRINT; an operator-maintained flag from here on. */
  is_print: boolean;
  /** Is this a FABRIC-STAGE Dyeing process? (0557) — read by the Fabric BOM ▸
   *  Fabric Process picker to withhold Dyeing from a Yarn-Dyed fabric's
   *  offered route, same shape as `is_print` above. Seeded once from
   *  `for_fabric` processes already named DYE/DYEING; operator-maintained. */
  is_dyeing: boolean;
  /** Is this THE GREIGE KNITTING step? (0564) — read by the Fabric BOM demand
   *  engine to drop Knitting from the ladder of a fabric whose source is
   *  `greige_purchase` or `dyed_purchase` (§2's Default Rule 2: the factory
   *  buys ready-knitted rolls, so there is no knitting to plan). Third of the
   *  same shape as `is_print` and `is_dyeing` above — seeded once, from
   *  `for_fabric` processes named KNIT, and operator-maintained after.
   *
   *  **AN UNFLAGGED KNITTING STEP ERRS UPWARD, NEVER DOWNWARD**, and that
   *  asymmetry is deliberate: the yarn half of the suppression does not read
   *  this flag at all (`yarnPurchase` skips a purchased fabric outright), so
   *  the expensive half of Rule 2 cannot be defeated by an unticked box. What a
   *  missing flag costs is a greige demand grossed by a knitting loss it should
   *  not carry — an over-buy of a percent or two. The flag must NOT catch
   *  Knitting Dia, Flat Knitting or Knit Fabric Inspection. */
  is_knitting: boolean;
  has_sub_categories: boolean;
  /* NO `sl_no`. IT WAS HERE AND THE CLIENT REMOVED IT (2026-09-16,
     doc/order/fabriprocess.md §4). 0293/0294 imported it verbatim from the
     legacy EDP2 export, where a hand-typed serial was how process steps were
     ordered; step ordering is governed by the 5 standard process routes
     instead (§3 of that spec, and `ProcessFabricStage` above), so a second
     hand-typed ordering could only ever contradict them — "manual serial
     numbers cause sequencing errors", in the client's words. Dropped from the
     DATABASE by 0565 for the same data-io reason as `short_description`. */
  inactive: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  sub_categories: ProcessSubCategory[];
  /** 0563 — which fabric stages this process may run in. Empty on a process
   *  that is not `for_fabric`, and on an unclassified fabric process. */
  fabric_stages: ProcessFabricStage[];
}

export const processSubCategoryInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  sub_category: z.string().min(1),
  /* NO `short_description` — see `ProcessSubCategory` above. */
  hsn_code: z.string().optional().nullable(),
});

/** One (stage, base?) pairing the Process master maintains — see
 *  `ProcessFabricStage`. `stage_id` is required because a row with no stage is
 *  not a statement about anything; the screen's save path drops blank rows
 *  before this schema ever sees them. */
export const processFabricStageInput = z.object({
  stage_id: z.string().uuid(),
  is_base: z.boolean().default(false),
});

export const processInput = z.object({
  name: capsName("Process name is required"),
  /* NO `short_description` AND NO `sl_no`. Both were here and the client
     removed them (2026-09-16, doc/order/fabriprocess.md §4). They are gone from
     the SCHEMA and not merely from the screen, deliberately: `lib/data-io`
     parses imports with this exact schema and writes straight to Postgres, so a
     field left standing here would be a door the form has closed and an import
     could still walk through. The DB columns went with them (0565), which is
     what makes the removal final rather than a convention. */
  billing_on: z.enum(BILLING_ON).nullable().default(null),
  hsn_code: z.string().optional().nullable(),
  for_yarn: z.boolean().default(false),
  for_fabric: z.boolean().default(false),
  for_trims: z.boolean().default(false),
  for_garments: z.boolean().default(false),
  for_components: z.boolean().default(false),
  no_planning: z.boolean().default(false),
  designwise_delivery: z.boolean().default(false),
  is_conversion: z.boolean().default(false),
  is_print: z.boolean().default(false),
  is_dyeing: z.boolean().default(false),
  is_knitting: z.boolean().default(false),
  has_sub_categories: z.boolean().default(false),
  inactive: z.boolean().default(false),
  sub_categories: z.array(processSubCategoryInput).default([]),
  /** 0563 — the stage mapping, saved by the actions as a child table exactly as
   *  `sub_categories` above is. `.default([])` matches that sibling so the two
   *  children behave identically for a caller that names neither. */
  fabric_stages: z.array(processFabricStageInput).default([]),
});
export type ProcessInput = z.infer<typeof processInput>;
