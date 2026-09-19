import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";
// THE ORDER BOM'S OWN SCHEMAS for a route step and a yarn row — reused, not
// re-typed, so an IWO step is validated (loss < 100, capitals on the text)
// exactly as an order step is. Importing them edits nothing on the order side.
import { fabricBomProcessInput } from "@/lib/orders/fabric-bom/processes";
import { fabricBomYarnInput } from "@/lib/orders/fabric-bom/yarn-process";

/**
 * IWO Fabric BOM — the order Fabric BOM, duplicated for an Internal Work Order
 * For Yarn or Fabric (client 2026-09-18; 0581).
 *
 * THIS FOLDER IS A COPY, NOT A WRAPPER. The client asked that the order Fabric
 * BOM screen be duplicated and "not disturbed", so nothing here edits
 * `lib/orders/fabric-bom/*`. Where the copy reads the order module's PURE rule
 * files (the yarn-process engine, the process routes) it imports them rather
 * than re-typing them, so an IWO and an order can never compute a yarn weight
 * two different ways — the one kind of drift a copy must not have.
 *
 * Column names mirror `order_fabric_bom_*` on purpose (see 0581's header).
 */

export type PaletteSection = "fabric" | "yarn" | "print";

export const PALETTE_SECTIONS: readonly PaletteSection[] = ["fabric", "yarn", "print"];

/** Same list, same labels as the order screen's Dia panel (0490). */
export const KNIT_TYPE_OPTIONS = [
  { value: "circular", label: "Circular Knit" },
  { value: "flat_knit", label: "Flat Knit" },
  { value: "woven", label: "Woven" },
] as const;

export interface IwoFabricBomPaletteRow {
  id: string;
  bom_id: string;
  section: PaletteSection;
  sno: number;
  name: string;
}

export interface IwoFabricBomDiaRow {
  id: string;
  bom_id: string;
  sno: number;
  knit_type: string | null;
  dia: string | null;
}

/**
 * One fabric line — Fabric Allocation's cells and Fabric Consumption's cells
 * are the SAME row (0581 §3), shown on two sections as the order screen shows
 * its lines on Fabric Allocation and Manual.
 */
export interface IwoFabricBomLineRow {
  id: string;
  bom_id: string;
  sno: number;
  structure_id: string | null;
  item_id: string;
  color_name: string | null;
  fabric_form: string | null;
  mixing_uom_id: string | null;
  no_of_colors: number | null;
  gsm: number | null;
  finish_dia: string | null;
  stage_id: string | null;
  req_kgs: number | null;
  notes: string | null;
}

/** One step of a fabric's route (Fabric Process, step 3). No colourway and no
 *  garment component — an IWO has neither (0581). */
export interface IwoFabricBomProcessRow {
  id: string;
  bom_id: string;
  item_id: string;
  sno: number;
  stage_id: string | null;
  process_id: string | null;
  loss_for_id: string | null;
  loss_pct: number | null;
  type_id: string | null;
}

export interface IwoFabricBomYarnStageRow {
  id: string;
  yarn_id: string;
  sno: number;
  stage_id: string | null;
  process_id: string | null;
  loss_for_id: string | null;
  combo: string | null;
  description: string | null;
  loss_pct: number | null;
  process_qty: number | null;
  uom_id: string | null;
  refusal_reason: string | null;
}

/** A yarn the BOM buys (Yarn Process, step 3). `purchase_qty` is written by
 *  the SERVER from the fabrics' Req Wt, never sent by the form. */
export interface IwoFabricBomYarnRow {
  id: string;
  bom_id: string;
  sno: number;
  item_id: string;
  purchase_qty: number | null;
  uom_id: string | null;
  refusal_reason: string | null;
  iwo_fabric_bom_yarn_stages: IwoFabricBomYarnStageRow[];
}

export interface IwoFabricBom {
  id: string;
  iwo_id: string;
  bom_date: string;
  is_draft: boolean;
  remark: string | null;
  location_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  iwo_fabric_bom_palette: IwoFabricBomPaletteRow[];
  iwo_fabric_bom_dias: IwoFabricBomDiaRow[];
  iwo_fabric_bom_lines: IwoFabricBomLineRow[];
  iwo_fabric_bom_processes: IwoFabricBomProcessRow[];
  iwo_fabric_bom_yarns: IwoFabricBomYarnRow[];
}

// ---------------------------------------------------------------------------
// What the screen sends
//
// A CHILD LIST THAT IS ABSENT IS LEFT ALONE; a list that is PRESENT replaces
// the stored one. The screen grows a tab at a time (Fabric Allocation, Yarn
// Process …), and a save from a build that does not yet carry a tab must not
// wipe what that tab stored — the order screen's `palette?: undefined` rule,
// applied to every list.
// ---------------------------------------------------------------------------

export const iwoFabricBomPaletteInput = z.object({
  section: z.enum(["fabric", "yarn", "print"]),
  // Stored in capitals: a name is matched against other names (AGENTS.md,
  // CAPITALS — the transform lives in the schema, not the action).
  name: capsName("Name is required"),
});

export const iwoFabricBomDiaInput = z.object({
  knit_type: z.enum(["circular", "flat_knit", "woven"]).nullable().default(null),
  dia: capsTextNullable(),
});

/**
 * A fabric line as SENT — blank rows are already dropped by the screen and
 * dropped again by the action (`keptIwoFabricLines`), so `item_id` is required
 * here: a kept line without a fabric is refused, never stored half-made.
 *
 * WHAT A LINE MUST CARRY BEYOND ITS FABRIC — Stage, Req Wt, and Mixing Uom on a
 * yarn-dyed cloth — is NOT in this schema: the last one depends on the fabric's
 * type, which the schema cannot see. It lives once in `lines.ts`.
 */
export const iwoFabricBomLineInput = z.object({
  structure_id: z.string().uuid().nullable().default(null),
  item_id: z.string().uuid({ message: "Choose the fabric" }),
  // A name from this BOM's Fabric Colour panel; capitals like the panel.
  color_name: capsTextNullable(),
  fabric_form: z.enum(["open", "tubular"]).nullable().default(null),
  mixing_uom_id: z.string().uuid().nullable().default(null),
  no_of_colors: z.number().int().min(1).max(99).nullable().default(null),
  gsm: z.number().positive("GSM must be more than 0").nullable().default(null),
  finish_dia: capsTextNullable(),
  stage_id: z.string().uuid().nullable().default(null),
  req_kgs: z.number().positive("Req Wt must be more than 0").nullable().default(null),
});

export type IwoFabricBomLineInput = z.input<typeof iwoFabricBomLineInput>;

export const iwoFabricBomInput = z.object({
  iwo_id: z.string().uuid({ message: "Choose the Internal Work Order" }),
  bom_date: z.string().min(1, "Date is required"),
  is_draft: z.boolean().default(false),
  remark: capsTextNullable(),
  palette: z.array(iwoFabricBomPaletteInput).optional(),
  dias: z.array(iwoFabricBomDiaInput).optional(),
  lines: z.array(iwoFabricBomLineInput).optional(),
  // Step 3. `processes` carry `combo` / `component_id` because the order schema
  // does; the action writes neither (0581 has no such columns).
  processes: z.array(fabricBomProcessInput).optional(),
  // The yarn list AS DERIVED on screen, with each yarn's own stages. The
  // purchase weight is not in it: the action computes it from `lines`.
  yarns: z.array(fabricBomYarnInput).optional(),
});

export type IwoFabricBomInput = z.input<typeof iwoFabricBomInput>;
export type IwoFabricBomParsed = z.infer<typeof iwoFabricBomInput>;
