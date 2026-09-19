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

export const iwoMbItemInput = z.object({
  category_id: uuidN,
  item_id: z.string().uuid({ message: "Choose the material" }),
  // "Brand / Specs" — capitals in the schema (AGENTS.md, CAPITALS).
  specification: capsTextNullable(),
  item_color_id: uuidN,
  consumption_uom_id: uuidN,
  purchase_uom_id: uuidN,
  uom_conversion_id: uuidN,
  planned_qty: z.number().nullable().default(null),
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
