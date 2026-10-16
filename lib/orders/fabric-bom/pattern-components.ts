/**
 * Fabric BOM ▸ Components FILLED AND LOCKED FROM THE PATTERN SHEET (client
 * 2026-10-15, "Option A — Pre-fill and Lock").
 *
 * The CAD Pattern Sheet is the technical source for WHICH PARTS a style is cut
 * into, their ROLL FORM (Tubular / Open Width) and their FINISH DIA. On the
 * Components tab those three are therefore the sheet's, read-only; what stays
 * the merchandiser's is Fabric Allocation — which cloth each part is cut from.
 *
 * A Components line is one (style, colourway, structure, panel). A pattern line
 * COVERS it when it is the same style, names the panel among its parts, is cut
 * from the same structure, and either names no colour (= every colour) or names
 * the line's colourway. Only a covered line is locked: a part the sheet does not
 * mention stays fully editable, so nothing the merchandiser added by hand is
 * frozen by a sheet that never spoke about it.
 *
 * TWO MODES, BOTH RUN AUTOMATICALLY BY THE SCREEN (no button since
 * 2026-10-15):
 *   fill    covered lines take the sheet's roll form. Never adds — what the
 *           screen runs on a NEW BOM until the order's Structure Details seed
 *           has landed, since an addition made first would stop that seed.
 *   resync  the same, plus a line for every (part, colourway) the sheet names
 *           that the BOM does not have yet.
 * Neither ever removes a line.
 *
 * Finish Dia is SHOWN here and stored on Manual — a dia is per size, and a
 * Components line has no size. `diaText` says what the sheet measured.
 *
 * PURE: the screen owns the lines.
 */

import type { PatternFillLine } from "./pattern-fill";

/** The roll form the Components tab stores (`FABRIC_FORM_OPTIONS`) for the sheet's word. */
export const fabricFormOf = (w: PatternFillLine["width_form"]): "" | "open" | "tubular" =>
  w === "open_width" ? "open" : w === "tubular" ? "tubular" : "";

/** What the matcher needs of a Components line. */
export type ComponentLineShape = {
  key: string;
  style_ref_no: string;
  combo: string;
  structure_id: string | null;
  coordinate_id: string | null;
  component_id: string | null;
  fabric_form: string;
};

const norm = (s: string) => s.trim().toUpperCase();

/** Does this sheet part name this panel? A coordinate-less side claims the component under every coordinate. */
const samePanel = (
  part: { coordinate_id: string | null; component_id: string },
  l: { coordinate_id: string | null; component_id: string | null },
) =>
  !!l.component_id &&
  part.component_id === l.component_id &&
  (!part.coordinate_id || !l.coordinate_id || part.coordinate_id === l.coordinate_id);

const coversColour = (line: PatternFillLine, combo: string) =>
  line.colours.length === 0 || !combo.trim() || line.colours.some((c) => norm(c) === norm(combo));

/**
 * The pattern line that covers this Components line, or null. First match
 * wins — the Pattern Sheet's own auto-split keeps each (part, colour) on one
 * line, so a second match is a sheet the pattern maker has not finished.
 */
export function patternLineFor(
  lines: readonly PatternFillLine[],
  l: ComponentLineShape,
  sameStyle: (lineStyle: string, patternStyle: string) => boolean,
): PatternFillLine | null {
  for (const p of lines) {
    if (!sameStyle(l.style_ref_no, p.style_ref_no)) continue;
    if (p.fabric_category_id && l.structure_id && p.fabric_category_id !== l.structure_id) continue;
    if (!p.parts.some((part) => samePanel(part, l))) continue;
    if (!coversColour(p, l.combo)) continue;
    return p;
  }
  return null;
}

/** "72" · "72–80" (size wise) · "" — what the sheet measured, for the read-only cell. */
export function diaText(p: PatternFillLine): string {
  const dias = (p.size_wise ? p.sizes.map((z) => z.table_dia) : [p.table_dia]).filter(
    (d): d is number => d != null,
  );
  if (dias.length === 0) return "";
  const lo = Math.min(...dias);
  const hi = Math.max(...dias);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

export type ComponentAddition = {
  style_ref_no: string;
  combo: string;
  structure_id: string | null;
  coordinate_id: string | null;
  component_id: string;
  fabric_form: "" | "open" | "tubular";
};

export type ComponentFillPlan = {
  /** Line key → the roll form it takes. Only lines whose form actually changes. */
  forms: Map<string, "open" | "tubular">;
  /** resync only: (part, colourway) pairs the sheet names and the BOM lacks. */
  additions: ComponentAddition[];
};

export function planComponentFill(
  patternLines: readonly PatternFillLine[],
  lines: readonly ComponentLineShape[],
  mode: "fill" | "resync",
  sameStyle: (lineStyle: string, patternStyle: string) => boolean,
  /** The colourways a style's new panel is drawn for when the sheet names none. */
  combosOfStyle: (styleRef: string) => readonly string[],
): ComponentFillPlan {
  const forms = new Map<string, "open" | "tubular">();
  for (const l of lines) {
    const p = patternLineFor(patternLines, l, sameStyle);
    const form = p ? fabricFormOf(p.width_form) : "";
    if (form && form !== l.fabric_form) forms.set(l.key, form);
  }
  const additions: ComponentAddition[] = [];
  if (mode === "resync") {
    const seen = new Set<string>();
    for (const p of patternLines) {
      const combos = p.colours.length > 0 ? p.colours : combosOfStyle(p.style_ref_no);
      for (const part of p.parts) {
        for (const combo of combos.length > 0 ? combos : [""]) {
          const k = [norm(p.style_ref_no), norm(combo), part.coordinate_id ?? "", part.component_id].join("|");
          if (seen.has(k)) continue;
          seen.add(k);
          const held = lines.some(
            (l) =>
              sameStyle(l.style_ref_no, p.style_ref_no) &&
              samePanel(part, l) &&
              (!combo || !l.combo.trim() || norm(l.combo) === norm(combo)),
          );
          if (held) continue;
          additions.push({
            style_ref_no: p.style_ref_no,
            combo,
            structure_id: p.fabric_category_id,
            coordinate_id: part.coordinate_id,
            component_id: part.component_id,
            fabric_form: fabricFormOf(p.width_form),
          });
        }
      }
    }
  }
  return { forms, additions };
}
