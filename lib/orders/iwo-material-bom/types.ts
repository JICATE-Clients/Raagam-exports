import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";

/**
 * IWO Material BOM — the order Material BOM, duplicated for an Internal Work
 * Order For Accessories (client 2026-09-19, screenshot 2941; 0584).
 *
 * A COPY, NOT A WRAPPER: nothing here edits `lib/orders/material-bom*`. Where it
 * reads the order module's PURE functions (process loss, pack resolution, MOQ /
 * round-up) it imports them, so an IWO and an order can never turn one planned
 * quantity into two purchase quantities (see rules.ts).
 */

/** The order BOM's process stages — `PROCESS_STAGE_OPTIONS`, spelled the same. */
export const IWO_MB_STAGES = ["GREIGE", "DYED"] as const;

/**
 * THE ATTRIBUTE (0614, user 2026-09-21) — how a line is broken up. Not the
 * order BOM's (which EXPLODES a line by the order's colourways and sizes; an
 * IWO has no order to explode by) but a breakup the planner TYPES: one row per
 * colour and/or size, each with its own Planned Qty, the line's Planned Qty
 * being their sum. `item` is one Planned Qty as before, and what every row
 * stored before 0614 reads as.
 */
export const IWO_MB_ATTRIBUTES = ["item", "colour", "size", "colour_size"] as const;
export type IwoMbAttribute = (typeof IWO_MB_ATTRIBUTES)[number];
/** The menu's own words (user 2026-09-22, screenshot 3014: "Item wise, etc") —
 *  so a message or a caption built from them never appends its own "wise". */
export const IWO_MB_ATTRIBUTE_LABELS: Record<IwoMbAttribute, string> = {
  item: "Item wise",
  colour: "Colour wise",
  size: "Size wise",
  colour_size: "Colour + Size wise",
};
/** Does this attribute carry a Colour / a Size per row? */
export const attributeHasColour = (a: IwoMbAttribute) => a === "colour" || a === "colour_size";
export const attributeHasSize = (a: IwoMbAttribute) => a === "size" || a === "colour_size";

/** One breakup row (0614). */
export interface IwoMbItemSliceRow {
  id: string;
  item_line_id: string;
  sno: number;
  item_color_id: string | null;
  size: string | null;
  planned_qty: number;
}

export interface IwoMbItemRow {
  id: string;
  bom_id: string;
  sno: number;
  category_id: string | null;
  item_id: string;
  specification: string | null;
  item_color_id: string | null;
  consumption_uom_id: string;
  purchase_uom_id: string | null;
  uom_conversion_id: string | null;
  planned_qty: number;
  moq: number | null;
  round_to: number | null;
  is_advised: boolean;
  send_out: boolean;
  is_foc: boolean;
  required_qty: number | null;
  purchase_qty: number | null;
  refusal_reason: string | null;
  /** 0614 — see `IWO_MB_ATTRIBUTES`. */
  attribute: IwoMbAttribute;
  iwo_material_bom_item_slices: IwoMbItemSliceRow[];
}

export interface IwoMbProcessRow {
  id: string;
  bom_id: string;
  sno: number;
  item_id: string;
  stage: string | null;
  process_id: string;
  loss_pct: number | null;
  vendor_id: string | null;
}

export interface IwoMaterialBom {
  id: string;
  iwo_id: string;
  bom_date: string;
  is_draft: boolean;
  remark: string | null;
  location_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  iwo_material_bom_items: IwoMbItemRow[];
  iwo_material_bom_processes: IwoMbProcessRow[];
}

// ---------------------------------------------------------------------------
// What the screen sends. Blank rows are dropped by the screen AND by the
// action (rules.ts); the weights are never sent — the action computes them.
// A child list ABSENT from the payload is left untouched (0581's rule).
// ---------------------------------------------------------------------------

const uuidN = z.string().uuid().nullable().default(null);

export const iwoMbItemSliceInput = z.object({
  item_color_id: uuidN,
  // Typed, so capitals (AGENTS.md, CAPITALS) — an IWO has no size range to pick from.
  size: capsTextNullable(),
  planned_qty: z.number().nullable().default(null),
});

export const iwoMbItemInput = z.object({
  category_id: uuidN,
  item_id: z.string().uuid({ message: "Choose the material" }),
  // "Brand / Specs" — capitals in the schema (AGENTS.md, CAPITALS).
  specification: capsTextNullable(),
  item_color_id: uuidN,
  consumption_uom_id: uuidN,
  purchase_uom_id: uuidN,
  uom_conversion_id: uuidN,
  /* THE LINE'S OWN FIGURE under `attribute = item`; IGNORED otherwise — the
     server writes Σ of the rows there (rules.ts `plannedQtyOf`), so a stale
     line figure can never disagree with its own breakup. */
  planned_qty: z.number().nullable().default(null),
  attribute: z.enum(IWO_MB_ATTRIBUTES).default("item"),
  slices: z.array(iwoMbItemSliceInput).default([]),
  moq: z.number().nullable().default(null),
  round_to: z.number().nullable().default(null),
  is_advised: z.boolean().default(false),
  send_out: z.boolean().default(false),
  is_foc: z.boolean().default(false),
});

export const iwoMbProcessInput = z.object({
  item_id: z.string().uuid({ message: "Choose the material a process row is for" }),
  stage: z.enum(IWO_MB_STAGES).nullable().default(null),
  process_id: uuidN,
  loss_pct: z.number().nullable().default(null),
  vendor_id: uuidN,
});

export const iwoMaterialBomInput = z.object({
  iwo_id: z.string().uuid({ message: "Choose the Internal Work Order" }),
  bom_date: z.string().min(1, "Date is required"),
  is_draft: z.boolean().default(false),
  remark: capsTextNullable(),
  items: z.array(iwoMbItemInput).optional(),
  processes: z.array(iwoMbProcessInput).optional(),
});

export type IwoMaterialBomInput = z.input<typeof iwoMaterialBomInput>;
export type IwoMaterialBomParsed = z.infer<typeof iwoMaterialBomInput>;
