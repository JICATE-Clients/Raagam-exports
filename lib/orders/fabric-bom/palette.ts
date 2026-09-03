/**
 * EDITING THE ORDER'S PALETTE FROM THE FABRIC BOM (client 2026-09-02).
 *
 * Fabric BOM ▸ Color/Print Details shows four panels. Three of them — Colour,
 * Yarn Colour, Roll form prints — were READ-ONLY by design (0490): the order
 * already declares its palette on Garment Order ▸ Color/Print Details, a fabric
 * BOM names exactly one order, and copying those lists onto the BOM would be a
 * second copy free to drift. The client asked for them to be editable here.
 *
 * ## THE READ-ONLY DESIGN IS KEPT. WHAT CHANGED IS WHO MAY WRITE TO IT.
 *
 * There is still ONE list. An edit made on this screen writes to
 * `garment_order_amendment_dyeings` / `_prints` — the order's own tables — so
 * Fabric Lines' colour cell, `combo-rules.ts` and step 4 keep reading the same
 * rows they always did. The alternative the client was shown and did not take
 * was a BOM-local copy, which is the drift 0490 rejected and would have let
 * these panels show a colour the line grid beneath them could not offer.
 *
 * ## THE PANEL EDITS A SET OF NAMES, NOT A SET OF ROWS
 *
 * This is the rule the whole module turns on, and it is not a simplification —
 * it is what stops the edit destroying data the panel cannot see.
 *
 * A dyeing row carries `dye_type` (Y/D · Melange · Dyed) and `color_id` as well
 * as `color_name`, and `dye_type` is what decides whether step 4 plans a yarn
 * dyeing or a fabric dyeing. THE PANEL SHOWS ONLY THE NAME — the type column was
 * deliberately dropped from this tab (0490) — and the screen DEDUPES by name, so
 * `GREY/Dyed` and `GREY/Melange` are two stored rows and one visible row.
 *
 * A name-keyed rewrite would therefore collapse those two into one and silently
 * lose a `dye_type` nothing on this screen ever displayed. That is precisely the
 * Material Attribute failure — a writer replacing a child grid wholesale over
 * columns its form did not carry. So:
 *
 * - a name present BEFORE and AFTER keeps **every** row that bears it, untouched
 *   (its `sno`, `dye_type` and `color_id` all survive);
 * - a name that APPEARS inserts ONE new row, `dye_type` null, for the order to
 *   answer on its own tab;
 * - a name that DISAPPEARS deletes every row bearing it — and only if nothing
 *   cites it (see `citationProblem`).
 *
 * A RENAME IS A DELETE PLUS AN ADD, and is meant to be: the guard then refuses
 * it whenever the old name is cited, which is the honest answer. Offering
 * in-place rename would let one keystroke re-point a combo's yarn colour at a
 * name that no longer means anything, with no FK anywhere to notice.
 *
 * ## PURE, SO THE SCREEN AND THE ACTION CANNOT DISAGREE
 *
 * No `server-only`, no Supabase. The screen runs `paletteDiff` to decide what to
 * warn about while the operator types; the action runs the same function to
 * decide what to write. One statement of the rule, two readers — the division
 * `missingRequiredMaterialFields` records for requiredness.
 */

/** Which of the three panels a name belongs to. */
export type PaletteSection = "fabric" | "yarn" | "print";

export const PALETTE_SECTION_LABELS: Record<PaletteSection, string> = {
  fabric: "Colour",
  yarn: "Yarn Colour",
  print: "Roll form prints",
};

/** One stored row, as much of it as the diff needs. */
export type StoredPaletteRow = {
  sno: number;
  /** `color_name` for a dyeing, `print_name` for a print. */
  name: string | null;
};

/**
 * Normalise a name for COMPARISON only.
 *
 * Upper-cased and trimmed, because `capsName()` stores capitals and an operator
 * typing "white" beside a stored "WHITE" means the same colour. Punctuation and
 * inner spacing are deliberately NOT touched: "OFF WHITE" and "OFF-WHITE" are
 * two names a dyer would treat as two, and folding them here would make the
 * guard miss a citation of one while the other survived.
 */
export const normPaletteName = (v: string | null | undefined): string =>
  (v ?? "").trim().toUpperCase();

/** What a save must do to one section's rows. */
export type PaletteDiff = {
  /** Names to insert, in the order the panel listed them. */
  added: string[];
  /** Names whose every stored row must go. */
  removed: string[];
  /** Names present both before and after — their rows are not touched at all. */
  kept: string[];
};

/**
 * What changed in one panel.
 *
 * BLANK ROWS ARE NOT NAMES. A `ChildGrid` opens on an empty row like every grid
 * in this app, so an operator who clicks "+ Add colour" and saves without typing
 * would otherwise insert a nameless dyeing — which `getOrderPalette` then
 * filters back out, leaving a row that exists, is invisible, and comes back as a
 * surprise on the order's own tab.
 *
 * DUPLICATES COLLAPSE, and silently, because the panel is a SET. Typing WHITE
 * twice is not a second declaration of anything; the order's tab is where a
 * second row with a different `dye_type` is made.
 */
export function paletteDiff(
  stored: readonly StoredPaletteRow[],
  typed: readonly string[],
): PaletteDiff {
  const before = new Set(stored.map((r) => normPaletteName(r.name)).filter(Boolean));

  const after: string[] = [];
  const seen = new Set<string>();
  for (const raw of typed) {
    const n = normPaletteName(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    after.push(n);
  }

  return {
    added: after.filter((n) => !before.has(n)),
    removed: [...before].filter((n) => !seen.has(n)),
    kept: after.filter((n) => before.has(n)),
  };
}

/**
 * Everywhere a palette name is held BY VALUE, with no foreign key behind it.
 *
 * Each of these columns stores the colour or print as TEXT. That is deliberate
 * where it was chosen — 0477 made prints manual entry, 0480 made
 * `yarn_colors text[]`, and `combo-rules.ts` notes that storing `color_name`
 * keeps a value the operator picked even after it stops being offered — but it
 * means the database will not stop a delete. Nothing errors, nothing cascades;
 * the citing row simply starts naming a colour the order no longer declares.
 *
 * SO THE GUARD IS THE ONLY THING THERE IS. It is enumerated here rather than
 * written into the action so that adding a fourth citer is a change to this
 * list, and so the screen can warn about the same three the server refuses on.
 */
export type PaletteCitation = {
  /** Where the name is still held, in words the operator can act on. */
  where: string;
  /** The name being removed. */
  name: string;
};

/**
 * The sentence a refused save carries.
 *
 * NAMES BOTH HALVES — the colour AND what still cites it. "Cannot remove this
 * colour" tells an operator nothing they can act on; the whole point of the
 * refusal is to send them to the row that has to change first. Same rule the
 * fabric requirement's refusals follow, and the reason `nominatedVendorOptions`
 * explains itself rather than silently offering everything.
 */
export function citationProblem(cites: readonly PaletteCitation[]): string | null {
  if (cites.length === 0) return null;

  const first = cites[0];
  const rest = cites.length - 1;
  const tail = rest > 0 ? ` (and ${rest} other${rest === 1 ? "" : "s"})` : "";
  return `${first.name} is still named by ${first.where}${tail}. Change that first, or keep the name here.`;
}
