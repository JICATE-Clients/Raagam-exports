/**
 * Fabric BOM ▸ Fabric Lines — WHAT THE FABRIC'S TYPE DECIDES (0513).
 *
 * Client field spec, 2026-09-02, on the `Type` cell: it "controls the visibility
 * of all subsequent mixing fields".
 *
 *     Solid · Melange     dyed as a whole roll  → Mixing UOM and No Of Colors
 *                                                 mean nothing and are hidden
 *     Yarn Dyed           knit from pre-dyed    → both become live, and
 *                         yarns                   Mixing UOM is MANDATORY
 *
 * ## WHY THIS IS A FUNCTION AND NOT A ZOD RULE
 *
 * AGENTS.md states the shape and the reason: "Requiredness is often a property of
 * the field FOR A CASE, not of the column… the schema only sees `item_class_id`,
 * a uuid, not the class code that decides it." The same is true here one column
 * along — a line carries `item_id`, and the type that decides these fields lives
 * on `items.fabric_type_id`. A `superRefine` cannot reach it.
 *
 * So this is `missingRequiredMaterialFields`' shape: ONE exported function, read
 * by the screen (the `*` and the cursor hold), by the Save gate, and by both
 * server actions. Four enforcers, one declaration. Adding a second rule beside it
 * is how a star and a hold come to disagree.
 *
 * ## THE VOCABULARY IS THE CATALOG'S, AND IT IS CLOSED
 *
 * Counted 2026-09-02: `config_lookups` where `kind = 'fabric_type'` holds exactly
 * three values — Solid (11 fabrics), Yarn Dyed (2), Melange (1). Nothing had to
 * be seeded and there is no fourth value, so `isYarnDyed` is a test for one name
 * rather than a list of the other two: a type this function has never heard of
 * reads as NOT yarn dyed, which hides the mixing cells rather than demanding
 * them. That is the safe direction — the alternative makes a new master row
 * block Save on a screen with nothing to say why.
 */

/** One fabric line, as much of it as these rules read. */
export type FabricLineFacts = {
  item_id: string | null;
  mixing_uom_id: string | null;
  no_of_colors: number | null;
};

/** One refusal, in the shape the screen, the gate and the action all render. */
export type FabricLineProblem = {
  /** The row cell it belongs to — used to mark the control. */
  field: "mixing_uom_id" | "no_of_colors";
  label: string;
  message: string;
};

/**
 * The two ratio units the client named — now SEEDED INTO THE UOM MASTER (0514)
 * rather than hardcoded here, because the cell reads that master.
 *
 * KEPT AS CODES, not as a list of options. Nothing renders from this any more;
 * it is what a future check or seed can compare against, and it records which
 * two rows the feature depends on existing. `%` and `CM`, matched case-folded on
 * `uoms.code`.
 */
export const MIXING_UOM_CODES = ["%", "CM"] as const;

/**
 * IS THIS CLOTH KNIT FROM PRE-DYED YARN?
 *
 * COMPARED CASE-FOLDED AND TRIMMED, never `===`. The value arrives as a
 * `config_lookups` NAME typed by whoever created the master row, and AGENTS.md
 * records the cost of an exact compare on a human-entered enum under "Nominated
 * vendors": the filter "compiles, runs, and quietly matches nothing". A silent
 * miss here hides two mandatory fields rather than showing them, which is the
 * failure that ships.
 */
export const isYarnDyed = (fabricType: string | null | undefined): boolean =>
  (fabricType ?? "").trim().toLowerCase() === "yarn dyed";

/**
 * Does this line still owe an answer, given the type of the fabric it names?
 *
 * GATED ON A FABRIC BEING NAMED, like every other rule on this line: a blank row
 * the grid opened owes nothing, or "+ Add fabric" would block Save the moment it
 * was pressed. Returns `[]` for a line with no `item_id`.
 *
 * `no_of_colors` IS NOT DEMANDED, deliberately, and this is the one asymmetry in
 * here. The client made Mixing UOM "Mandatory only if Fabric Type is Yarn Dyed"
 * and described No Of Colors as merely "Active", so it is offered and not
 * required — a planner who knows the ratio unit before they have counted the
 * colours can still save. Where the count IS given and disagrees with the Repeats
 * panel, that is reported on the panel rather than refused here: a mismatch is a
 * thing to look at, not a thing to be trapped by.
 */
export function missingFabricLineFields(
  line: FabricLineFacts,
  fabricType: string | null | undefined,
): FabricLineProblem[] {
  if (!line.item_id) return [];
  if (!isYarnDyed(fabricType)) return [];

  const out: FabricLineProblem[] = [];
  if (!line.mixing_uom_id) {
    out.push({
      field: "mixing_uom_id",
      label: "Mixing Uom",
      message:
        "Yarn-dyed fabric — choose the unit its repeat ratio is in (% or CM)",
    });
  }
  return out;
}

/**
 * Does the declared colour count match the colours actually mapped?
 *
 * ADVISORY, NEVER A HOLD — it returns a sentence, not a problem, and no caller
 * wires it through `dupFieldProps`. The two numbers legitimately disagree while
 * the planner is part-way through mapping, and AGENTS.md's rule for that case is
 * explicit: holding the cursor on "close to something" cages the operator on a
 * right answer.
 *
 * ABSTAINS ON A BLANK COUNT rather than reading it as zero. "Not yet said" and
 * "no colours" are different claims, and only one of them is worth a sentence.
 */
export function colourCountNote(
  declared: number | null,
  mapped: number,
): string | null {
  if (declared == null) return null;
  if (declared === mapped) return null;
  return mapped === 0
    ? `${declared} colour${declared === 1 ? "" : "s"} declared on the fabric line — map them on Repeats.`
    : `${declared} colour${declared === 1 ? "" : "s"} declared on the fabric line, ${mapped} mapped here.`;
}
