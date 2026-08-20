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

/**
 * Provisional fixed dropdown. LOWERCASE MATTERS HERE: `nominatedVendorOptions()`
 * lower-cases before comparing, because the same word is spelled "Nominated"
 * in this list and "nominated" in Orders and Planning — AGENTS.md's
 * "Nominated vendors" section records that a `===` at a call site compiles,
 * runs and quietly matches nothing.
 */
export const SUPPLY_TYPE_OPTIONS = ["Local", "Import", "Nominated", "Free Issue"] as const;

/**
 * The Items grid's "Type" — how settled this line's material is.
 *
 * RESTORED 2026-08-17 ON THE CLIENT'S WRITTEN INSTRUCTION, and the history
 * matters because a column coming back with no note beside it reads as drift:
 * this list held `["Production", "Sample", "Trial"]`, c756d82 withdrew the cell
 * that morning as part of a 22 → 19 column streamlining and called the option
 * list provisional, and the SAME client drop asked for these three words in the
 * item section. So the withdrawal was of a wrong vocabulary, and this is the
 * right one — they REPLACE the old three rather than joining them.
 *
 * That restoration cost one grid column and nothing else because the withdrawal
 * kept the DB column, the stored values and `mbaItemInput.type`. There is no
 * migration: `material_bom_amendment_items.type` is plain `text` with no CHECK
 * (0265) and nothing has altered it since.
 *
 * NOT CAPITALISED. "To be advised" is mixed case by design; AGENTS.md's CAPITALS
 * rule governs typed free text (`<Input uppercase>` + `capsName()` in the
 * schema), not a fixed option list — the same exemption workflow status keys
 * take. `type` stays `nullableText` in the input for that reason.
 */
export const MATERIAL_TYPE_OPTIONS = [
  "To be advised",
  "To be developed",
  "Available Item",
] as const;

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

/**
 * ## THE THREE COLUMNS WITHDRAWN ON 2026-08-17 ARE ALL BACK, WHICH IS WHY A
 * ## WITHDRAWAL HERE IS NEVER A DELETION
 *
 * "UI streamlining" took `type`, `alternate_uom_id` and `combination` off the
 * Items grid to shorten a 22-column row. `type` returned the same day with a
 * corrected option list; the other two returned on 2026-08-19, when the client
 * asked for the item row in legacy's order column-for-column (screenshot 2362).
 *
 * Each restoration cost one grid column and nothing else — no migration, no
 * change here — because the withdrawals kept the DB columns, the stored values
 * and the place in `mbaItemInput`. That is not tidiness: `writeChildren` DELETES
 * AND REINSERTS every child row, so a field the form stops carrying is a field
 * the next save destroys. 0418's pattern for `attribute_id`, and the one
 * AGENTS.md records for `amend_type`.
 *
 * None of the three ever reached `lib/orders/material-bom/requirement.ts`, so
 * nothing computed changed in either direction.
 */
export interface MbaItem {
  id: string;
  amendment_id: string;
  sno: number;
  /**
   * A `public.categories` id since 0426 — BUTTON, LABEL, POLY BAG. NOT a
   * `config_lookups` row of kind `material_category`, which holds the two GROUP
   * names ("Sewing Accessory", "Packing Accessory") and was all this cell could
   * offer until then (client 2026-08-17, screenshot 2314).
   *
   * It is the same master `items.category_id` has pointed at since 0226, and
   * that is the point: the two are comparable, so this cell narrows the Material
   * picker beside it (`materialsForCategory`). Both accessory classes are
   * offered together — a BOM line has no item class of its own.
   */
  category_id: string | null;
  /** How settled this line's material is — `MATERIAL_TYPE_OPTIONS`. Withdrawn
   *  from the grid on the morning of 2026-08-17 and restored the same day with
   *  the corrected option list, on the client's instruction; see that constant
   *  for why the two are one decision rather than a flip-flop. */
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
  /**
   * Which garment PANEL this material goes on — front body, sleeve, collar
   * (0423). From the components master, narrowed on screen to the parts the
   * line's style declares.
   *
   * DESCRIPTIVE. It does not split the requirement: one collar interlining is
   * needed per garment whichever panel it is cut for, so a component axis would
   * multiply rows without changing the total. `productionSlices` is untouched
   * and `material_bom_amendment_requirements` has no component column — 0423
   * asserts that second half, because the decision is only safe while it holds.
   */
  component_id: string | null;
  supply_type: string | null;
  vendor_id: string | null;
  purchase_uom_id: string | null;
  consumption_uom_id: string | null;
  /** Legacy's third unit beside Consumption and Purchase. Off the grid
   *  2026-08-17, back on it 2026-08-19 with legacy's row order. Nothing reads
   *  it: the engine converts consumption → purchase and never consults a third
   *  unit. */
  alternate_uom_id: string | null;
  /** Which pack size this line buys, e.g. the 2,500 m cone rather than the
   *  5,000 m one (0348). It cannot live on the material: items.purchase_uom_id
   *  holds a single UOM ("Cone") and cannot tell two cone sizes apart, so the
   *  choice belongs to the BOM line. */
  uom_conversion_id: string | null;
  /** Free text that collides by name with `requirement_basis = 'combination'`
   *  (0420, colour x size) while having nothing to do with it. That collision is
   *  why it left the grid on 2026-08-17; the client had it back on 2026-08-19
   *  with legacy's row, so `REQUIREMENT_BASIS_LABELS.combination` keeps its
   *  "(Color + Size)" qualifier as the only thing distinguishing the two. */
  combination: string | null;
  moq: number | null;
  /** Round the post-MOQ figure UP to the next multiple of this (0437).
   *  NULL = no rounding asked for, which is every row before 0437. */
  round_to: number | null;
  /** The NUMERATOR — how many are used. Renamed from `quantity_nos` by 0418. */
  no_of_items: number | null;
  /** The DIVISOR — how many garments they cover. */
  per_pieces: number | null;
  /** This line's wastage buffer, shown as "Wastage %". */
  excess_pct: number | null;
  required_by: string | null;
  /**
   * PER-PANEL CONSTRUCTION (0436), the Combination sheet's rows. EMPTY IS THE
   * ORDINARY CASE and means "this line's own `no_of_items` / `per_pieces`
   * apply to the whole garment" — the opt-in half of 0436, which is what keeps
   * every line written before it unchanged.
   */
  components: MbaItemComponent[];
}

/**
 * One panel's share of a Material BOM line (0436).
 *
 * WHY THIS EXISTS AT ALL: a sleeve seam is shorter than a front seam, so thread
 * consumption genuinely differs by panel. 0423 rejected a component axis on the
 * premise that it never does ("one collar interlining per garment whichever
 * panel it is cut for") — true of interlining, false of thread. Read 0436's
 * header before adding a fifth `requirement_basis` for this; it deliberately is
 * not one.
 */
export interface MbaItemComponent {
  id: string;
  item_line_id: string;
  sno: number;
  component_id: string;
  /** The trim's colour ON THIS PANEL. NULL means the line's own Item Color.
   *  Two colours under one line are two things to buy, so they become two
   *  requirement rows — see `MbaRequirement.item_color_id`. */
  item_color_id: string | null;
  no_of_items: number;
  /** Never defaulted to 1 — CHECKed `> 0` in the column (0436), same rule 0418
   *  states for the line. */
  per_pieces: number;
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
  /**
   * The TRIM's own colour, not the garment combo above it (0436).
   *
   * It was SHOWN AND NEVER STORED until then: the Requirement tab computes an
   * Item Color in `colourOf` and throws it away on save, so a purchase order had
   * no colour to be checked against. Harmless while one line meant one colour;
   * a wrong purchase the moment a line's panels carry two.
   */
  item_color_id: string | null;
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

/**
 * One row of the Combination sheet (0436).
 *
 * `per_pieces` is `.positive()` rather than merely non-null, which mirrors the
 * column's CHECK — and the rule lives HERE rather than in the action for the
 * reason the whole file repeats: `lib/data-io` parses with these schemas and
 * writes straight to Postgres.
 */
export const mbaItemComponentInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  component_id: z.string().uuid(),
  item_color_id: uuidN,
  no_of_items: z.coerce.number().nonnegative(),
  per_pieces: z.coerce.number().positive("Pieces must be more than 0"),
});

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
    component_id: uuidN,
    supply_type: nullableText,
    vendor_id: uuidN,
    purchase_uom_id: uuidN,
    consumption_uom_id: uuidN,
    alternate_uom_id: uuidN,
    uom_conversion_id: uuidN,
    combination: nullableText,
    moq: numN,
    round_to: numN,
    no_of_items: numN,
    per_pieces: numN,
    excess_pct: z.coerce.number().min(0).max(100).nullable().default(0),
    required_by: nullableText,
    /** The Combination sheet's rows (0436). Defaulted to `[]`, never required:
     *  the opt-in is what keeps every line written before 0436 valid. */
    components: z.array(mbaItemComponentInput).default([]),
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

    /**
     * TWO PANELS OF THE SAME COLOUR ARE ONE PURCHASE, so naming one twice
     * silently DOUBLES the line's rate rather than failing — the quietest way
     * this table can be wrong. The column has the same unique index; this is the
     * half that answers with a sentence instead of a Postgres error, and the
     * half a spreadsheet import meets first.
     */
    const seen = new Set<string>();
    for (const [i, c] of (v.components ?? []).entries()) {
      const key = `${c.component_id}:${c.item_color_id ?? ""}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["components", i, "component_id"],
          message: "This panel is already on the line in that colour",
        });
      }
      seen.add(key);
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
