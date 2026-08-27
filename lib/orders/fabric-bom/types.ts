import { z } from "zod";
import { FABRIC_BASES } from "./requirement";
import { capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Orders ▸ Fabric BOM (0426). Step 3 of the client's order flow: which fabric,
// in which colour, for which panel, and how much.
//
// Header + two children — the fabric lines, and the STORED requirement those
// lines explode into. The requirement is not typed and not projected; it is
// computed by `./requirement.ts` on save. 0426's header argues at length for
// storing it, and its argument is 0418's.
//
// KEYED TO `garment_order_amendments`, like Material BOM and for the same
// reason: the production target this multiplies — order qty + excess + approval
// + projection — lives on the garment order's Approval Qty tab, and the
// `sales_orders` shell it would otherwise be read from has `order_qty` 0.
//
// NO STATUS FIELD BEYOND `is_draft`. The client is explicit in doc/prd.md: "BOM
// required no approval… After BOM, budgeting is done using Fabric BOM and
// Material BOM… This budget is approved." Approval is step 6's transition on the
// BUDGET. Draft vs Recorded is this document's own state and is a different
// question from the ORDER-level one `lib/orders/bom-status.ts` answers.
// ============================================================================

/**
 * Main fabric or trims fabric — the order's own `fabric_type` vocabulary (0408).
 *
 * LOWERCASE, matching the column's CHECK. The values are shared with
 * `garment_order_amendment_combo_structures`, so a seeded line carries the
 * order's word through unchanged rather than being re-spelled on the way — the
 * supply-type case split ('Nominated' vs 'nominated') is what that costs when it
 * goes wrong (AGENTS.md, Nominated vendors).
 */
export const FABRIC_TYPE_OPTIONS = [
  { value: "main", label: "Main fabric" },
  { value: "trims_fabric", label: "Trims fabric" },
] as const;

export interface FabricBomLine {
  id: string;
  bom_id: string;
  sno: number;
  /** Which style this fabric is for; NULL = every style. By VALUE (0407). */
  style_ref_no: string | null;
  /** The colourway; NULL = every combo on the order. By VALUE (0397). */
  combo: string | null;
  /** The fabric structure — SINGLE JERSEY, 1X1 LYCRA RIB. A `categories` row,
   *  which is where 0409 moved the order's own structure column. */
  structure_id: string | null;
  /** Which panel this fabric is cut for. The `components` MASTER (0228), never
   *  `garment_style_components`, whose ids are rewritten on every save (0421). */
  component_id: string | null;
  /** The fabric itself — an `items` row of item class FABRIC. */
  item_id: string | null;
  fabric_type: string | null;
  color_name: string | null;
  /** Fabric per garment, in `consumption_uom_id`. */
  consumption: number | null;
  consumption_uom_id: string | null;
  /** The CUTTING room's buffer. NOT process loss — that is step 4, and applying
   *  it here as well charges the same loss twice (0426). */
  wastage_pct: number | null;
  /** 'colour' | 'colour_size'. */
  requirement_basis: string | null;
  /** Knitting diameter. Descriptive — step 4 plans knitting per diameter. */
  dia: number | null;
  required_by: string | null;
  rate: number | null;
  notes: string | null;
}

/** One stored requirement row. Written by the server, never by the form. */
export interface FabricBomRequirement {
  id: string;
  bom_id: string;
  line_id: string;
  item_id: string | null;
  sno: number;
  basis: string;
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  slice_label: string;
  basis_qty: number;
  consumption: number;
  wastage_pct: number;
  /** NULL means REFUSED — never "none needed". `refusal_reason` says which case. */
  required_qty: number | null;
  refusal_reason: string | null;
  consumption_uom_id: string | null;
}

/** The order a fabric BOM plans for, as much of it as the list and editor need. */
export type FabricBomOrder = {
  id: string;
  code: string | null;
  po_no: string | null;
  amend_date: string;
  delivery_date: string | null;
  excess_pct: number;
  rejection_rule_id: string | null;
  customer: { id: string; code: string | null; name: string } | null;
  /** The SC No, stamped on the minted shell by 0395. */
  sales_order: { id: string; order_number: string | null } | null;
};

export interface FabricBom {
  id: string;
  code: string | null;
  garment_order_id: string;
  bom_date: string;
  is_draft: boolean;
  remark: string | null;
  computed_at: string | null;
  computed_for_qty: number | null;
  computed_basis_hash: string | null;
  location_id: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  garment_order?: FabricBomOrder | null;
  lines: FabricBomLine[];
  requirements: FabricBomRequirement[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

export const fabricBomLineInput = z
  .object({
    sno: z.coerce.number().int().nonnegative().default(0),
    style_ref_no: nullableText,
    combo: capsTextNullable(),
    structure_id: uuidN,
    component_id: uuidN,
    item_id: uuidN,
    fabric_type: nullableText,
    // CAPS in the SCHEMA, not the action: `lib/data-io` parses imports with this
    // same schema and writes straight to Postgres, so an action-level
    // `.toUpperCase()` misses every spreadsheet import (AGENTS.md, "CAPITALS").
    color_name: capsTextNullable(),
    consumption: numN,
    consumption_uom_id: uuidN,
    wastage_pct: z.coerce.number().min(0).max(100).nullable().default(0),
    requirement_basis: z.enum(FABRIC_BASES).nullable().default(null),
    dia: numN,
    required_by: nullableText,
    rate: numN,
    notes: capsTextNullable(),
  })
  /**
   * THE LINE RULES LIVE IN THE SCHEMA, NOT IN THE ACTION.
   *
   * `lib/data-io` parses imports with these same `*Input` schemas and writes
   * straight to Postgres, so a rule enforced only in the server action misses
   * every spreadsheet import — the identical argument AGENTS.md makes for
   * putting the CAPITALS transform in Zod rather than in the action.
   *
   * Gated on a fabric being NAMED. An entirely blank row is how a grid opens
   * (the `seedRow` rule) and is dropped before it reaches the database;
   * refusing it here would make an untouched blank line block Save.
   *
   * The messages are the ENGINE'S, word for word. `requirement.ts` prints them
   * in the Calculated Quantities section as it recomputes, and this prints them
   * under the offending cell — two spellings of one refusal is how an operator
   * comes to believe there are two different problems.
   */
  .superRefine((v, ctx) => {
    if (!v.item_id) return;

    if (v.consumption == null || v.consumption <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consumption"],
        message: "Enter the fabric consumption per garment",
      });
    }
    if (!v.consumption_uom_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consumption_uom_id"],
        message: "Choose the unit this consumption is in",
      });
    }
    if (!v.requirement_basis) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requirement_basis"],
        message: "Choose how this fabric splits",
      });
    }
  });

export const fabricBomInput = z.object({
  /**
   * MANDATORY, and it is the only header field that is.
   *
   * Everything this document computes is a multiple of the order's production
   * target, so a BOM with no order is not an incomplete record — it is a
   * document with no arithmetic. `uuidN` elsewhere in this file means "not
   * chosen yet"; here it would mean "cannot mean anything".
   */
  garment_order_id: z.string().uuid({ message: "Choose the garment order" }),
  bom_date: z.string().min(1, "Date is required"),
  is_draft: z.boolean().default(false),
  remark: nullableText,
  lines: z.array(fabricBomLineInput).default([]),
});

export type FabricBomInput = z.infer<typeof fabricBomInput>;
export type FabricBomLineInput = z.infer<typeof fabricBomLineInput>;

/** Draft vs Recorded — the DOCUMENT's own state, distinct from the ORDER-level
 *  question `lib/orders/bom-status.ts` answers ("has this order been planned,
 *  and is the plan still current?"). Both are shown: this one inside the editor,
 *  that one on the work queue. */
export function fabricBomStatusTone(is_draft: boolean): "warning" | "success" {
  return is_draft ? "warning" : "success";
}
export function fabricBomStatusText(is_draft: boolean): string {
  return is_draft ? "Draft" : "Recorded";
}

/**
 * One row of the order's combo tree, flattened — what the Seed button offers.
 *
 * FLATTENED BY THE SERVICE, not by the screen. The tree is three levels deep
 * (combo -> structure -> component) and the BOM is one line per leaf, so the
 * flattening is the seed rule itself; leaving it on the screen would put it
 * beside the grid state where the next screen to want it would rewrite it.
 */
export type OrderFabricSeedRow = {
  style_ref_no: string | null;
  combo: string | null;
  structure_id: string | null;
  structure_name: string | null;
  component_id: string | null;
  component_name: string | null;
  fabric_type: string | null;
  color_name: string | null;
  /** SOLID / MELANGE / YARN DYED, and the GSM — shown so the operator can tell
   *  two otherwise identical rows apart. Descriptive: not copied to the line,
   *  because a copy is a second place for them to disagree with the order. */
  item_sub_type: string | null;
  gsm: number | null;
};
