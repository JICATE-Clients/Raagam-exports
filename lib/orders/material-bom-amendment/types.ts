import { z } from "zod";
import { REQUIREMENT_BASES } from "@/lib/orders/material-bom/requirement";
import { capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Orders ▸ Material BOM (0265, reshaped by 0418). Step 3 of the client's
// six-step garment order flow: every sewing and packing accessory a confirmed
// order needs, and how much of each.
//
// Header + three children — Items, Processes, and the STORED requirement the
// Items grid explodes into. The requirement is not typed and not projected; it
// is computed by `lib/orders/material-bom/requirement.ts` on save. See 0418 for
// why it is stored rather than derived on read.
//
// KEYED TO `garment_order_amendments`, NOT `sales_orders` (0418). The production
// target this multiplies — order qty + excess + approval + projection — lives on
// the garment order's Approval Qty tab. `sales_order_id` keeps its column and
// its data and has left this input; the SC No is read through the order.
// ============================================================================

/** Provisional fixed dropdown — no legacy option list captured yet (confirm). */
export const MATERIAL_TYPE_OPTIONS = ["Production", "Sample", "Trial"] as const;

/**
 * Provisional fixed dropdown. LOWERCASE MATTERS HERE: `nominatedVendorOptions()`
 * lower-cases before comparing, because the same word is spelled "Nominated"
 * in this list and "nominated" in Orders and Planning — AGENTS.md's
 * "Nominated vendors" section records that a `===` at a call site compiles,
 * runs and quietly matches nothing.
 */
export const SUPPLY_TYPE_OPTIONS = ["Local", "Import", "Nominated", "Free Issue"] as const;

/** Where a material sent out for processing has got to. */
export const PROCESS_STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "sent", label: "Sent" },
  { value: "part_received", label: "Part received" },
  { value: "received", label: "Received" },
] as const;

/** How the Attribute column splits a requirement. Labels only — the VALUES are
 *  `REQUIREMENT_BASES`, which the CHECK constraint and the engine share. */
export const REQUIREMENT_BASIS_LABELS: Record<(typeof REQUIREMENT_BASES)[number], string> = {
  order: "Order Number",
  colour: "Color-wise",
  size: "Size-wise",
  combination: "Combination (Color + Size)",
};

export interface MbaItem {
  id: string;
  amendment_id: string;
  sno: number;
  category_id: string | null;
  type: string | null;
  item_id: string | null;
  /** Classification only. It does NOT drive the split — see `requirement_basis`
   *  and 0418's header for the four reasons a `config_lookups` row cannot. */
  attribute_id: string | null;
  /**
   * The trim's colour, from `config_lookups` kind `fabric_color` — the SAME list
   * the garment's colours come from, so "match the thread to the fabric" is a
   * comparison rather than a string reconciliation.
   *
   * NULL IS A MEANING. On a colour-wise line it means "takes the garment's
   * combo colour", which is the ordinary case and the reason the operator chose
   * Color-wise. A value pins a CONTRAST colour across every exploded row.
   */
  item_color_id: string | null;
  /** Free CAPS text: WOVEN 2-FOLD, NYLON #5. */
  specification: string | null;
  /** The MATERIAL's size (50MM X 20MM), NOT the garment size a size-wise line
   *  explodes along — different axes, so different storage (0419). */
  size: string | null;
  /** 'order' | 'colour' | 'size'. */
  requirement_basis: string | null;
  /** Which style this line is for; null = every style. By VALUE (0407). */
  style_ref_no: string | null;
  supply_type: string | null;
  vendor_id: string | null;
  purchase_uom_id: string | null;
  consumption_uom_id: string | null;
  alternate_uom_id: string | null;
  /** Which pack size this line buys, e.g. the 2,500 m cone rather than the
   *  5,000 m one (0348). It cannot live on the material: items.purchase_uom_id
   *  holds a single UOM ("Cone") and cannot tell two cone sizes apart, so the
   *  choice belongs to the BOM line. */
  uom_conversion_id: string | null;
  combination: string | null;
  moq: number | null;
  /** The NUMERATOR — how many are used. Renamed from `quantity_nos` by 0418. */
  no_of_items: number | null;
  /** The DIVISOR — how many garments they cover. */
  per_pieces: number | null;
  /** This line's wastage buffer, shown as "Wastage %". */
  excess_pct: number | null;
  required_by: string | null;
}

export interface MbaProcess {
  id: string;
  amendment_id: string;
  sno: number;
  item_id: string | null;
  process_id: string | null;
  vendor_id: string | null;
  qty_out: number | null;
  qty_in: number | null;
  status: string;
}

/** One stored requirement row. Written by the server, never by the form. */
export interface MbaRequirement {
  id: string;
  amendment_id: string;
  item_line_id: string;
  item_id: string | null;
  sno: number;
  basis: string;
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  slice_label: string;
  basis_qty: number;
  no_of_items: number;
  per_pieces: number;
  excess_pct: number;
  /** NULL means REFUSED — never "none needed". `refusal_reason` says which case. */
  required_qty: number | null;
  refusal_reason: string | null;
  consumption_uom_id: string | null;
  uom_conversion_id: string | null;
  purchase_qty: number | null;
  purchase_uom_id: string | null;
}

/** The order a BOM plans for, as much of it as the list and editor need. */
export type BomGarmentOrder = {
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

export interface MaterialBomAmendment {
  id: string;
  code: string | null;
  garment_order_id: string | null;
  /** WITHDRAWN from the input by 0418; still selected so nothing that reads the
   *  row breaks, and so a pre-0418 record keeps pointing where it pointed. */
  sales_order_id: string | null;
  customer_id: string | null;
  amendment_no: number;
  amend_date: string;
  is_draft: boolean;
  remarks: string | null;
  computed_at: string | null;
  computed_for_qty: number | null;
  computed_basis_hash: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  garment_order?: BomGarmentOrder | null;
  customer?: { id: string; code: string | null; name: string } | null;
  items: MbaItem[];
  processes: MbaProcess[];
  requirements: MbaRequirement[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

export const mbaItemInput = z
  .object({
    sno: z.coerce.number().int().nonnegative().default(0),
    category_id: uuidN,
    type: nullableText,
    item_id: uuidN,
    attribute_id: uuidN,
    item_color_id: uuidN,
    // CAPS in the SCHEMA, not the action: `lib/data-io` parses imports with this
    // same schema and writes straight to Postgres, so an action-level
    // `.toUpperCase()` misses every spreadsheet import (AGENTS.md, "CAPITALS").
    specification: capsTextNullable(),
    size: capsTextNullable(),
    requirement_basis: z.enum(REQUIREMENT_BASES).nullable().default(null),
    style_ref_no: nullableText,
    supply_type: nullableText,
    vendor_id: uuidN,
    purchase_uom_id: uuidN,
    consumption_uom_id: uuidN,
    alternate_uom_id: uuidN,
    uom_conversion_id: uuidN,
    combination: nullableText,
    moq: numN,
    no_of_items: numN,
    per_pieces: numN,
    excess_pct: z.coerce.number().min(0).max(100).nullable().default(0),
    required_by: nullableText,
  })
  /**
   * THE LINE RULES LIVE IN THE SCHEMA, NOT IN THE ACTION.
   *
   * `lib/data-io` parses imports with these same `*Input` schemas and writes
   * straight to Postgres, so a rule enforced only in the server action misses
   * every spreadsheet import — the identical argument AGENTS.md makes for
   * putting the CAPITALS transform in Zod rather than in the action.
   *
   * Gated on a material being NAMED. An entirely blank row is how a grid opens
   * and is dropped by `normalizeItems` before it reaches the database; refusing
   * it here would make an untouched blank line block Save.
   */
  .superRefine((v, ctx) => {
    if (!v.item_id) return;

    if (v.no_of_items == null || v.no_of_items <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["no_of_items"],
        message: "Enter how many are used per piece",
      });
    }
    // Not defaulted to 1 anywhere — in the column (0418), in the input, or in the
    // engine. A default makes an unfinished line compute, and the number it
    // produces goes onto a real purchase order.
    if (v.per_pieces == null || v.per_pieces <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["per_pieces"],
        message: "Pieces must be more than 0",
      });
    }
    if (!v.requirement_basis) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requirement_basis"],
        message: "Choose how this material splits",
      });
    }
  });

export const mbaProcessInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  item_id: uuidN,
  process_id: uuidN,
  vendor_id: uuidN,
  qty_out: numN,
  qty_in: numN,
  status: z
    .enum(["planned", "sent", "part_received", "received"])
    .default("planned"),
});

export const materialBomAmendmentInput = z.object({
  garment_order_id: uuidN,
  customer_id: uuidN,
  amend_date: z.string().min(1, "Date is required"),
  is_draft: z.boolean().default(false),
  remarks: nullableText,
  // children
  items: z.array(mbaItemInput).default([]),
  processes: z.array(mbaProcessInput).default([]),
});
export type MaterialBomAmendmentInput = z.infer<typeof materialBomAmendmentInput>;
export type MbaItemInput = z.infer<typeof mbaItemInput>;
export type MbaProcessInput = z.infer<typeof mbaProcessInput>;

/** Draft vs Recorded — the DOCUMENT's own state, distinct from the ORDER-level
 *  question `status.ts` answers ("has this order been planned, and is the plan
 *  still current?"). Both are shown: this one inside the editor, that one on the
 *  two lists. */
export function mbaStatusTone(is_draft: boolean): "warning" | "success" {
  return is_draft ? "warning" : "success";
}
export function mbaStatusText(is_draft: boolean): string {
  return is_draft ? "Draft" : "Recorded";
}

/** What the Copy sheet lists: an order whose BOM is worth copying from. */
export type BomCopySource = {
  bom_id: string;
  code: string | null;
  sc_no: string | null;
  customer_name: string | null;
  customer_id: string | null;
  amend_date: string;
  line_count: number;
};

/** The rows `copyMaterialBomFrom` hands back, shaped for the form. Quantities
 *  are absent by construction — they recompute against THIS order. */
export type BomCopyPayload = {
  items: Omit<MbaItemInput, "sno">[];
  processes: Omit<MbaProcessInput, "sno">[];
  /** True when the source order belongs to a different customer, so vendors
   *  were dropped. The sheet says so rather than leaving it to be noticed. */
  vendorsDropped: boolean;
};
