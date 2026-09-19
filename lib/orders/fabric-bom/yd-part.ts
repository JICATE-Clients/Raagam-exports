import { ydPartKey } from "./component-map";

/**
 * YD PART — one yarn-dyed fabric allocated more than once on one BOM (0596).
 *
 * Client ticket 2026-09-19: a Top and a Bottom may be knitted from the SAME
 * yarn-dyed cloth to different stripe ratios (80% NAVY / 20% WHITE vs 70 / 30),
 * so Fabric Allocation must accept the fabric a second time, and each
 * allocation carries its own Yarn Dyed Details, its own piece weight (a Manual
 * entry) and its own yarn split.
 *
 * The allocation is told apart by its PART — a name the operator gives it (TOP,
 * BOTTOM). `ydPartKey` (./component-map.ts) is how every reader compares one.
 * Blank means "the fabric's only part", which is every row written before 0596.
 *
 * ## WHAT THIS FILE REFUSES, AND WHY EACH ONE BLOCKS SAVE
 *
 * 1. A FABRIC WITH TWO OR MORE PARTS, ONE OF THEM UNNAMED. Blank is a real
 *    answer only while it is the only one; beside TOP it is an allocation with
 *    no name, and nothing downstream (the Manual picker, the report heading)
 *    could say which it is.
 * 2. A MANUAL ENTRY OF SUCH A FABRIC THAT NAMES NO PART, OR A PART THE FABRIC
 *    DOES NOT HAVE. The entry is the piece weight; weighed against no part, its
 *    yarn would be grossed by nobody's stripes — which the engine reads as "no
 *    shades" and silently buys the yarn undyed-loss-free.
 *
 * ONE FUNCTION, TWO READERS — the screen's Save gate and `updateFabricBom` /
 * `createFabricBom` — so the screen and the server refuse the same document with
 * the same sentence.
 *
 * A PART IS ONLY EVER A YARN-DYED IDEA. A fabric the master does not call Yarn
 * Dyed is never split (the screen offers no part cell and never assigns one),
 * so these rules ask only about fabrics `isYarnDyedFabric` says yes to.
 */

type PartLine = {
  style_ref_no?: string | null;
  structure_id?: string | null;
  item_id?: string | null;
  yd_part?: string | null;
};

type PartEntry = {
  style_ref_no?: string | null;
  item_id?: string | null;
  yd_part?: string | null;
};

const styleOf = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/** The parts one fabric carries within one style, in first-seen order. */
export function ydPartsOf(
  lines: readonly PartLine[],
  itemId: string,
  styleRefNo: string | null | undefined,
): string[] {
  const style = styleOf(styleRefNo);
  const out: string[] = [];
  for (const l of lines) {
    if (l.item_id !== itemId) continue;
    /* A BLANK STYLE ON A LINE MEANS "EVERY STYLE" on this document (see
       `fabricSlices`), so it answers for any style asked about. */
    if (styleOf(l.style_ref_no) && style && styleOf(l.style_ref_no) !== style) continue;
    const p = ydPartKey(l.yd_part);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function ydPartProblems(
  lines: readonly PartLine[],
  entries: readonly PartEntry[],
  isYarnDyedFabric: (itemId: string) => boolean,
  fabricName: (itemId: string) => string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // 1 — a split fabric with an unnamed part
  for (const l of lines) {
    if (!l.item_id || !isYarnDyedFabric(l.item_id)) continue;
    const k = `${styleOf(l.style_ref_no)}|${l.item_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const parts = ydPartsOf(lines, l.item_id, l.style_ref_no);
    if (parts.length > 1 && parts.includes("")) {
      out.push(
        `${fabricName(l.item_id)} is allocated ${parts.length} times — give every allocation a YD Part name (e.g. TOP, BOTTOM) on Fabric Allocation.`,
      );
    }
  }

  // 2 — a Manual entry of a split fabric that names no part, or a stale one
  for (const e of entries) {
    if (!e.item_id || !isYarnDyedFabric(e.item_id)) continue;
    const parts = ydPartsOf(lines, e.item_id, e.style_ref_no);
    if (parts.length < 2) continue;
    const mine = ydPartKey(e.yd_part);
    if (!mine) {
      out.push(
        `${fabricName(e.item_id)}: this fabric has ${parts.length} YD Parts (${parts.filter(Boolean).join(", ")}) — pick which one this Manual entry weighs.`,
      );
    } else if (!parts.includes(mine)) {
      out.push(
        `${fabricName(e.item_id)}: Manual entry is for YD Part ${mine}, which Fabric Allocation no longer has — pick one of ${parts.filter(Boolean).join(", ")}.`,
      );
    }
  }
  return out;
}

/**
 * THE NAME A NEW ALLOCATION OF AN ALREADY-ALLOCATED FABRIC STARTS WITH.
 *
 * "PART 2", "PART 3", … — the first number not already taken. A placeholder the
 * operator is expected to rename (TOP, BOTTOM), and a real name meanwhile, so
 * the second pick can be accepted at once instead of refused until a name is
 * typed into a cell that did not exist a moment ago.
 */
export function nextYdPartName(taken: readonly string[]): string {
  const have = new Set(taken.map(ydPartKey));
  for (let n = 2; ; n++) if (!have.has(`PART ${n}`)) return `PART ${n}`;
}
