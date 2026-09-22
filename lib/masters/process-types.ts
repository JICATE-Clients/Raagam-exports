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
  /* NO `hsn_code` EITHER. The client removed HSN from the sub-category rows
     (2026-09-18, Process Master flags & sub-category cleanup). HSN is stated
     ONCE, on the process header — which is also the only place Master Data ▸
     Process HSN Assign ever read or wrote it. Dropped from the DATABASE by
     0571: nothing read it, and a column the form no longer fills is only a
     door for a spreadsheet import. */
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
 * then on. The grid on the Process master is where it is maintained, and it
 * renders only when `for_fabric` is ticked: a stage route is meaningless on a
 * garment or trims process.
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
  /** "Use Conversion Process" — the one planning flag the client KEPT in the
   *  2026-09-18 cleanup, for the 10–20% of processes that run as a conversion
   *  job (YARN DYEING on the live master). */
  is_conversion: boolean;
  /* NO `designwise_delivery`, `is_print`, `is_dyeing` OR `is_knitting`. The
     client removed all four from the form as unnecessary (2026-09-18), and they
     did NOT all leave the same way:

     - `designwise_delivery` had no reader anywhere outside this master and was
       false on every live row. 0571 dropped the column outright.

     - THE THREE KIND FLAGS STAY IN THE DATABASE, as system-maintained data. The
       Fabric BOM reads them — the print gate (0528), the Yarn-Dyed dyeing
       withhold (0557) and §2 Rule 2's knitting suppression (0564) — through its
       own selects in `lib/orders/fabric-bom/`, never through this type. They
       are seeded by migrations (0570 sets `is_print` on PRINTING as it creates
       it) and are no longer operator-editable.

       WHY NOT DERIVE THEM FROM THE FABRIC STAGES GRID INSTEAD, which looks
       like the same fact ("Knitting is the base of Greige")? Because it is not
       the same fact. 0570 makes FABRIC PURCHASE a second BASE of GREIGE — how a
       Rule 2 route opens — so "base of Greige" means "knitting OR buying
       greige", and Rule 2 suppresses only the first. Derived, FABRIC PURCHASE
       would read as a knitting step and a greige-bought fabric would DROP its
       own purchase loss: an under-buy, the one direction a missing flag here
       must never fail in. Dyed has the same trap waiting for its dyed-cloth
       purchase process.

       Absent from the Zod schema below, so neither this form nor a data-io
       import can write them; `updateProcess` then leaves the stored values
       exactly as they are, and a new process takes the column default (false),
       which errs toward over-buying — the direction the engine accepts. */
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
  /* THE ROW'S OWN ID, sent back on an edit (0583) — so `updateProcess` can
     reconcile BY ID instead of delete-and-reinsert. A Fabric BOM route step now
     points at a sub-category (`order_fabric_bom_processes.sub_category_id`, ON
     DELETE RESTRICT); regenerating ids on every save would refuse the save of
     any sub-category a route names. Absent on a row typed since the load. */
  id: z.string().uuid().optional(),
  sno: z.coerce.number().int().nonnegative().default(0),
  sub_category: z.string().min(1),
  /* NO `short_description` and NO `hsn_code` — see `ProcessSubCategory` above.
     Gone from the schema and not just the grid: `lib/data-io` imports parse
     with these schemas and write straight to Postgres. */
});

/** One (stage, base?) pairing the Process master maintains — see
 *  `ProcessFabricStage`. `stage_id` is required because a row with no stage is
 *  not a statement about anything; the screen's save path drops blank rows
 *  before this schema ever sees them. */
export const processFabricStageInput = z.object({
  stage_id: z.string().uuid(),
  is_base: z.boolean().default(false),
});

/**
 * THE ONE THING A BASE TICK CANNOT BE: this process being the ENTRY STEP OF
 * TWO STAGES.
 *
 * ## IT HAPPENED, AND THE FORM LET IT (2026-09-18)
 *
 * COMPACTING [OPEN WIDTH] was saved as the base of GREIGE, DYED, WASH *and*
 * PRINT. Compacting is a finishing step — it cannot be what moves cloth INTO a
 * stage, let alone into all four — and the consequences were live: the first
 * step of every stage offered Compacting as a way in (`isFirstOfStage` narrows
 * to the stage's bases), and compacting twice inside one stage began to read as
 * "this stage was entered twice" and blocked Save (`baseProcessRepeated`).
 *
 * ## WHAT IS AND IS NOT THE RULE
 *
 * NOT "one base per stage": a stage may have several, and GREIGE really does —
 * KNITTING and FABRIC PURCHASE both open it (0570). The grid's own note argues
 * that at length and it stands.
 *
 * NOT "every stage must have a base" either: Wash and Print had none on day one
 * and `narrowToStage` stands down rather than offering an empty list.
 *
 * The invariant is the OTHER WAY ROUND, and `stage-routes.ts` states it in as
 * many words: "a process is the base of at most one stage while being a
 * secondary step in several". A process is one physical operation; the stage it
 * is the entry to is the state that operation PRODUCES, and an operation
 * produces one. Being a secondary step in every stage is ordinary — Compacting
 * is exactly that, and stays mapped to all four.
 *
 * Read by the form (Save is blocked and the message shown under the grid), by
 * both server actions (an import reaches those directly, and a gate that only
 * disables a button is a gate an import walks through — AGENTS.md, Duplicates)
 * and by `npm run check:process-base`.
 */
export function baseStageProblem(input: {
  for_fabric: boolean;
  /** Since 2026-09-21 a yarn process is classified on the same grid. Optional
   *  so every earlier caller and vector keeps its shape. */
  for_yarn?: boolean;
  fabric_stages: readonly { stage_id: string | null; is_base: boolean }[];
}): string | null {
  /* A process that is neither `for_fabric` nor `for_yarn` HAS no stage route —
     `normalizeFabricStages` drops the rows entirely — so there is nothing here
     to be wrong about. */
  if (!input.for_fabric && !input.for_yarn) return null;
  const based = new Set(
    input.fabric_stages.filter((s) => s.stage_id && s.is_base).map((s) => s.stage_id as string),
  );
  if (based.size <= 1) return null;
  return `A process is the entry step of at most one stage, and Base is ticked on ${based.size}. Leave it ticked on the stage this process moves cloth INTO, and untick the rest — a process may still RUN in every stage without being the way into it.`;
}

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
  is_conversion: z.boolean().default(false),
  /* NO `designwise_delivery` / `is_print` / `is_dyeing` / `is_knitting` — see
     `Process` above. Out of the SCHEMA and not just off the screen: a key left
     here defaults to `false` on every parse, so each Save would silently
     overwrite a migration-seeded kind flag (KNITTING's `is_knitting`, say) with
     false — and `designwise_delivery` no longer exists to write to. */
  has_sub_categories: z.boolean().default(false),
  inactive: z.boolean().default(false),
  sub_categories: z.array(processSubCategoryInput).default([]),
  /** 0563 — the stage mapping, saved by the actions as a child table exactly as
   *  `sub_categories` above is. `.default([])` matches that sibling so the two
   *  children behave identically for a caller that names neither. */
  fabric_stages: z.array(processFabricStageInput).default([]),
});
export type ProcessInput = z.infer<typeof processInput>;
