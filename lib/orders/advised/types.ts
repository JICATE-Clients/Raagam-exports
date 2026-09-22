import { z } from "zod";
import { capsTextNullable } from "@/lib/validation/formats";

/**
 * Orders ▸ Advised Items — the Register (doc/order/advised-items-plan.md).
 *
 * NOT A LIST OF ITS OWN. The advised state IS the Material BOM line's `type`
 * ("To be advised"), so the Register is a view of those lines grouped by RE No.
 * The orphan `order_advised_items` table this screen used to edit is dropped by
 * 0588 — a second list would have to be kept in step with the BOM, and the day
 * it was not, a purchase would be blocked (or allowed) by the wrong one.
 *
 * Every figure is read off each order's LATEST NON-DRAFT Material BOM — the
 * same BOM the PO block (`refuseUnsettledMaterials` / `refuse_advised_po_line`)
 * reads, so "pending here" and "refused there" are one set of lines.
 */

/** One order (RE No) with advised lines. */
export type AdvisedOrderRow = {
  /** The garment order document's id — the Register's row key and route. */
  id: string;
  re_no: string | null;
  order_code: string | null;
  customer_name: string | null;
  bom_id: string;
  bom_code: string | null;
  /** Lines still To be advised — each blocks its purchase order. */
  pending: number;
  /** Lines converted to Available (stamped `converted_at`). */
  converted: number;
  /** The garment order's own — the Register's Created Date / Created User
   *  columns (AGENTS.md; resolved by `withCreators`). */
  created_at: string | null;
  created_by: string | null;
};

/** A PO line raised for an advised line's material on the same order. */
export type AdvisedPoLine = {
  po_id: string;
  po_code: string | null;
  status: string | null;
  quantity: number | null;
};

/** One advised (or once-advised) Material BOM line. */
export type AdvisedLine = {
  id: string;
  bom_id: string;
  sno: number;
  item_id: string | null;
  item_name: string | null;
  style_ref_no: string | null;
  /** "To be advised" | "Available Item". */
  type: string;
  specification: string | null;
  size: string | null;
  item_color_id: string | null;
  item_color_name: string | null;
  brand: string | null;
  artwork_code: string | null;
  pending_reason: string | null;
  estimated_rate: number | null;
  /** Σ the line's stored requirement rows; null when any of them refused. */
  required_qty: number | null;
  consumption_uom_id: string | null;
  /** True while the line is To be advised — a PO for its material is refused. */
  po_blocked: boolean;
  po_lines: AdvisedPoLine[];
  converted_at: string | null;
  converted_by: string | null;
  converted_by_name: string | null;
};

/** A colour the conversion sheet offers — a `fabric_color` lookup, in the
 *  shape `RecordPicker` takes. */
export type AdvisedColour = {
  id: string;
  code: string | null;
  name: string;
  is_active: boolean;
  /** `!is_active`, spelled the way `RecordPicker` reads first. */
  inactive: boolean;
};

/** Everything the per-order screen needs. */
export type AdvisedOrderDetail = {
  order: AdvisedOrderRow;
  lines: AdvisedLine[];
  /** Keyed by `item_id`: the order's own colours (as the MBA Item Color cell
   *  offers them), with any colour a line already holds kept. */
  coloursByItem: Record<string, AdvisedColour[]>;
};

/** The fields a conversion writes — and the ones a refusal can name. */
export const ADVISED_CONVERT_FIELDS = [
  "brand",
  "artwork_code",
  "specification",
  "item_color_id",
  "size",
] as const;
export type AdvisedConvertField = (typeof ADVISED_CONVERT_FIELDS)[number];

/**
 * What the buyer confirmed. SPECIFICATION IS REQUIRED — it is what the PO
 * block's own sentence asks for ("Save the final specification …"), so a
 * conversion without one would unblock a purchase of a material still
 * undescribed. The rest are optional: not every trim has a brand, an artwork
 * or a size. Capitalised in the schema (AGENTS.md "CAPITALS").
 */
export const advisedConversionInput = z.object({
  specification: capsTextNullable().refine((v) => !!v && v.trim() !== "", {
    message: "Enter the final specification the buyer confirmed",
  }),
  brand: capsTextNullable(),
  artwork_code: capsTextNullable(),
  item_color_id: z.string().uuid().nullable().default(null),
  size: capsTextNullable(),
});
export type AdvisedConversionInput = z.input<typeof advisedConversionInput>;
