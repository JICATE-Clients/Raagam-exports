/**
 * Material BOM ▸ ITEM COLOR IS MANDATORY ON A COLOUR-WISE ROW (client 2026-09-21).
 *
 * ## THE RULE
 *
 * A line whose grain carries the COLOURWAY axis — Attribute = Colour, with or
 * without the Size wise tick (the legacy `combination` basis resolves to the
 * same axes) — is one the merchandiser has said splits BY colour. Every row it
 * explodes into is a colourway of the order (WHITE, NAVY, CRANBERRY), and each
 * owes the accessory's own colour for that colourway: the thread or the button
 * that goes on the white garment. A blank there is not "no colour"; it is an
 * unanswered question the purchaser will have to come back and ask.
 *
 * Under ITEM_WISE / SIZE_WISE (Attribute = Order, Style, Country, ticked or
 * not) the Item Color cell is NOT DRAWN (client spec 2026-09-21, "Color:
 * HIDDEN") — a polybag has none, and a row that is not a colourway has nothing
 * to match. A colour such a row already holds stays visible until cleared.
 *
 * SIZE NEEDS NO RULE OF ITS OWN. The spec's "Size: MANDATORY" under SIZE_WISE /
 * COLOR_SIZE_WISE is satisfied by construction: a size-wise row IS a size of the
 * order's assortment (`productionSlices` explodes it), never a box to fill.
 *
 * ## WHAT SATISFIES IT
 *
 * The row's own Item Color, or the LINE's — `flags.colour(slice) ?? line.
 * item_color_id`, the same resolution `requirementRows` stores and the screen
 * totals by. A line coloured once for every colourway is answered on every row.
 *
 * ## ONE FUNCTION, FOUR ENFORCERS
 *
 * The header star and the cursor hold read `colourRequired(grain)`; the Save
 * gate (`sectionValidity` extra on the screen) and the server
 * (`writeChildren`, before its first write) read `missingItemColours`. AGENTS.md
 * "Mandatory fields": one declaration, and none of the four can drift.
 *
 * ## THE IWO MATERIAL BOM IS DELIBERATELY OUTSIDE THIS
 *
 * Same client ruling, same day: an IWO books advance trims — cartons, polybags,
 * raw thread — before any shade is approved, and it has no Attribute to gate
 * on. Its line Colour stays optional. Do not import this there.
 *
 * Vectors: `npm run check:bom-colour-required`.
 */

import type { Axis } from "@/lib/orders/bom-explosion/exploder";

/** Does this grain split by colourway? — the whole of the switch. */
export function colourRequired(grain: readonly Axis[] | null | undefined): boolean {
  return !!grain && grain.includes("colour");
}

/** One line, as much of it as the rule reads — exploded and `chosen`-filtered
 *  by the caller, since both callers already have those rows in hand. */
export type ColourWiseLineFacts = {
  /** 1-based, for the message. */
  sno: number;
  /** What the message calls the line — the material's name, or its category. */
  material: string;
  grain: readonly Axis[] | null;
  /** The line's own Item Color — answers every row. */
  item_color_id: string | null;
  /** The rows the line explodes into, minus the ones the operator unticked. */
  rows: readonly { label: string; item_color_id: string | null }[];
};

export type MissingItemColour = {
  sno: number;
  /** The rows still blank, in explosion order. */
  rows: string[];
  message: string;
};

/** How many row names a message lists before "and N more". */
const NAMED = 3;

/**
 * Every colour-wise line with a row whose Item Color is not answered — by the
 * row or by the line. Empty means the rule is satisfied.
 */
export function missingItemColours(lines: readonly ColourWiseLineFacts[]): MissingItemColour[] {
  const out: MissingItemColour[] = [];
  for (const l of lines) {
    if (!colourRequired(l.grain)) continue;
    if (l.item_color_id) continue;
    const rows = l.rows.filter((r) => !r.item_color_id).map((r) => r.label);
    if (rows.length === 0) continue;
    const named = rows.slice(0, NAMED).join(", ");
    const more = rows.length > NAMED ? ` and ${rows.length - NAMED} more` : "";
    out.push({
      sno: l.sno,
      rows,
      message:
        `Line ${l.sno} (${l.material}) splits by colour — pick the Item Color on ` +
        `${rows.length === 1 ? "its" : `each of its ${rows.length}`} colour ${rows.length === 1 ? "row" : "rows"}: ${named}${more}.`,
    });
  }
  return out;
}
