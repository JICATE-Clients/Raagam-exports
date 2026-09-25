import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";
// THE ORDER BOM'S OWN SCHEMAS for a route step and a yarn row — reused, not
// re-typed, so an IWO step is validated (loss < 100, capitals on the text)
// exactly as an order step is. Importing them edits nothing on the order side.
import { fabricBomProcessInput } from "@/lib/orders/fabric-bom/processes";
import { fabricBomYarnInput } from "@/lib/orders/fabric-bom/yarn-process";
import type { IwoColourBy } from "./yarn";

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
  /** PRINT-stage lines only (0599): a name from the Roll form prints panel. */
  print_name: string | null;
  notes: string | null;
}

/**
 * Fabric Allocation ▸ Details ▸ Yarn Dyed Details (0581 tables, first used by
 * 0599) — the order screen's Repeats and Combinations panels, ADDRESSED BY THE
 * FABRIC (`item_id`), never by a line: lines are deleted and re-inserted on
 * every save, and an IWO has no style or colourway to add to the address.
 * `structure_id` is a note only, nullable since 0599.
 */
export interface IwoFabricBomYdRepeatRow {
  id: string;
  bom_id: string;
  structure_id: string | null;
  item_id: string;
  sno: number;
  yarn_item_id: string | null;
  dye_type: "dyed" | "grey";
  color_name: string | null;
  uom_id: string | null;
  value: number | null;
  twisted_yarn: string | null;
}

/** One Combinations row. `combo` is the fabric line's COLOUR — an IWO has no
 *  colourway, so its lines' colours play that part (see `iwoFabricGross`). */
export interface IwoFabricBomYdCombinationRow {
  id: string;
  bom_id: string;
  structure_id: string | null;
  item_id: string;
  combo: string | null;
  yd_combo_name: string | null;
  iwo_fabric_bom_yd_combination_colors: {
    id: string;
    sno: number;
    yarn_color: string | null;
    dyeing_loss_pct: number | null;
  }[];
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
  /** 0613 — For = COLOR WISE: a loss % per line Colour. Off ⇒ `{}`. */
  color_wise_loss?: boolean | null;
  color_losses?: Record<string, number> | null;
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
  /** 0613 — For = COLOR WISE: a loss % per shade (Yarn IWO) or per line
   *  Colour (Fabric IWO). Off ⇒ `{}`. */
  color_wise_loss?: boolean | null;
  color_losses?: Record<string, number> | null;
  process_qty: number | null;
  uom_id: string | null;
  refusal_reason: string | null;
  /** 0636 — on a CONVERSION step, the loose fabric unravelled into this yarn. */
  source_loose_fabric_id?: string | null;
}

/** One shade of a DYED Yarn IWO line (0592). `purchase_qty` is the server's,
 *  and only on Dyed Purchase — each shade is then its own purchase. */
export interface IwoFabricBomYarnShadeRow {
  id: string;
  yarn_id: string;
  sno: number;
  color_name: string;
  planned_kgs: number;
  purchase_qty: number | null;
}

/** A yarn the BOM buys (Yarn Process, step 3). `purchase_qty` is written by
 *  the SERVER from the fabrics' Req Wt, never sent by the form. */
export interface IwoFabricBomYarnRow {
  id: string;
  bom_id: string;
  sno: number;
  item_id: string;
  /** For = Yarn only (step 4): the typed weight (Σ shades on DYED, written by
   *  the server) and the Stage — GREY or DYED (0592). */
  planned_kgs: number | null;
  buy_stage_id: string | null;
  /** DYED only (0592): how the colour is got. */
  colour_by: IwoColourBy | null;
  purchase_qty: number | null;
  uom_id: string | null;
  refusal_reason: string | null;
  iwo_fabric_bom_yarn_stages: IwoFabricBomYarnStageRow[];
  iwo_fabric_bom_yarn_shades: IwoFabricBomYarnShadeRow[];
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
  iwo_fabric_bom_yd_repeats: IwoFabricBomYdRepeatRow[];
  iwo_fabric_bom_yd_combinations: IwoFabricBomYdCombinationRow[];
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
  // PRINT-stage lines (0599) — a name from the Roll form prints panel, capitals
  // like the panel. Whether one is owed is `lines.ts`'s: it needs the stage.
  print_name: capsTextNullable(),
});

export type IwoFabricBomLineInput = z.input<typeof iwoFabricBomLineInput>;

/** A shade as SENT (0592). Colour capitalised like the Yarn Colour panel it is
 *  picked from; `purchase_qty` is never sent — the server computes it. Blank
 *  seeds are dropped by `keptIwoYarnShades` before this is read. */
export const iwoFabricBomYarnShadeInput = z.object({
  color_name: capsTextNullable(),
  planned_kgs: z.number().nullable().default(null),
});

/** Details ▸ Yarn Dyed Details ▸ Repeats, as SENT (0599). Every value
 *  optional — the grid opens on a blank row; `ydRepeatFilled` in actions.ts
 *  decides what is worth storing, the order action's division of labour. */
export const iwoFabricBomYdRepeatInput = z.object({
  structure_id: z.string().uuid().nullable().default(null),
  item_id: z.string().uuid(),
  sno: z.coerce.number().int().nonnegative().default(0),
  yarn_item_id: z.string().uuid().nullable().default(null),
  dye_type: z.enum(["dyed", "grey"]).default("dyed"),
  color_name: capsTextNullable(),
  uom_id: z.string().uuid().nullable().default(null),
  value: z.number().nullable().default(null),
  twisted_yarn: capsTextNullable(),
});

/** Details ▸ Yarn Dyed Details ▸ Combinations, as SENT (0599), with its nested
 *  colours. The loss bounds are the order schema's (0568): under 100, or the
 *  markup divides by zero. */
export const iwoFabricBomYdCombinationInput = z.object({
  structure_id: z.string().uuid().nullable().default(null),
  item_id: z.string().uuid(),
  combo: capsTextNullable(),
  yd_combo_name: capsTextNullable(),
  colors: z
    .array(
      z.object({
        sno: z.coerce.number().int().nonnegative().default(0),
        yarn_color: capsTextNullable(),
        dyeing_loss_pct: z.coerce.number().min(0).max(99.99).nullable().default(0),
      }),
    )
    .default([]),
});

export type IwoFabricBomYdRepeatInput = z.infer<typeof iwoFabricBomYdRepeatInput>;
export type IwoFabricBomYdCombinationInput = z.infer<typeof iwoFabricBomYdCombinationInput>;

export const iwoFabricBomInput = z.object({
  iwo_id: z.string().uuid({ message: "Choose the Internal Work Order" }),
  bom_date: z.string().min(1, "Date is required"),
  is_draft: z.boolean().default(false),
  remark: capsTextNullable(),
  palette: z.array(iwoFabricBomPaletteInput).optional(),
  dias: z.array(iwoFabricBomDiaInput).optional(),
  lines: z.array(iwoFabricBomLineInput).optional(),
  // Details ▸ Yarn Dyed Details (0599). Absent = left alone, as every list here.
  yd_repeats: z.array(iwoFabricBomYdRepeatInput).optional(),
  yd_combinations: z.array(iwoFabricBomYdCombinationInput).optional(),
  // Step 3. `processes` carry `combo` / `component_id` because the order schema
  // does; the action writes neither (0581 has no such columns).
  processes: z.array(fabricBomProcessInput).optional(),
  // The yarn list with each yarn's own stages — DERIVED on a For = Fabric BOM,
  // PICKED on a For = Yarn one (step 4), where `planned_kgs` and
  // `buy_stage_id` are the typed half. The purchase weight is never in it: the
  // action computes it, from `lines` or from `planned_kgs`, by the IWO's For.
  yarns: z
    .array(
      fabricBomYarnInput.extend({
        planned_kgs: z.number().nullable().default(null),
        buy_stage_id: z.string().uuid().nullable().default(null),
        // DYED only (0592). What a DYED line owes is `lines.ts`'s — the schema
        // cannot see which stage is DYED.
        colour_by: z.enum(["dyed_purchase", "yarn_dyeing"]).nullable().default(null),
        shades: z.array(iwoFabricBomYarnShadeInput).default([]),
      }),
    )
    .optional(),
});

export type IwoFabricBomInput = z.input<typeof iwoFabricBomInput>;
export type IwoFabricBomParsed = z.infer<typeof iwoFabricBomInput>;
