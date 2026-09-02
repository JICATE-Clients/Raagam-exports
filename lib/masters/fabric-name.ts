import { mixingParens, type MixingPart } from "@/lib/masters/mixing-name";

/**
 * HOW A FABRIC'S NAME IS COMPOSED — one declaration, two readers.
 *
 * Client format (2026-07-23 #10/#12): `FABRICTYPE STRUCTURE (COMPONENTS) 100%`,
 * e.g. `SOLID SINGLE JERSEY (24'S COMBED COTTON 95%, 20'S ELASTANE 5%) 100%`.
 * FABRICTYPE is Solid / Yarn Dyed / Melange; STRUCTURE is the picked Structure
 * (category) NAME — not the Circular / Flat / Woven lookup.
 *
 * ## WHY IT MOVED OUT OF THE SCREEN
 *
 * It lived inside `material-master-screen.tsx`'s `suggestedName` memo, which was
 * correct while the Materials master was the only place a fabric could be
 * created. It no longer is: `FabricQuickCreateSheet` creates one from the Fabric
 * BOM's own Fabric picker, and a fabric born there must be named by the same
 * rule or the master and the BOM would file the same cloth under two names.
 *
 * `mixing-name.ts` already records what happens when one idea is composed in two
 * places — Material's own Yarn and Fabric branches spelled the same blend
 * differently for six weeks, in ONE file. This is that lesson applied one level
 * up, before the second copy exists rather than after.
 *
 * ## THE TWO FLAGS ARE PASSED IN, NOT DERIVED HERE
 *
 * `yarnDyed` and `singleYarn` are the caller's, because each is decided by
 * something this function is not given: yarn-dyed is a `config_lookups` NAME
 * matched case-folded (`isYarnDyedFabricType` below), and single-yarn is
 * `items.fabric_using` compared against `FABRIC_USING`. Deriving either from the
 * strings here would be a third reading of a fact the screen and the server
 * already agree on.
 */
export type FabricNameParts = {
  /** The `fabric_type` lookup's NAME — Solid · Melange · Yarn Dyed. */
  fabricType: string | null;
  /** The Structure — i.e. the fabric CATEGORY's own name. */
  structure: string | null;
  /** Every composition row, unfiltered: this function decides which count. */
  parts: readonly MixingPart[];
  yarnDyed: boolean;
  singleYarn: boolean;
};

/**
 * Is this `fabric_type` name the yarn-dyed one?
 *
 * MATCHED ON THE TWO WORDS, never `===`, so "Yarn Dyed" / "Yarn-dyed" /
 * "YARN DYED" all answer the same — the value is a lookup name typed by whoever
 * created the master row. Same call `fabric-line-rules.ts` makes one module
 * along, and AGENTS.md records the cost of an exact compare on a human-entered
 * enum under *Nominated vendors*: the filter "compiles, runs, and quietly
 * matches nothing".
 */
export function isYarnDyedFabricType(name: string | null | undefined): boolean {
  const t = (name ?? "").toLowerCase();
  return t.includes("yarn") && t.includes("dyed");
}

/**
 * The composed name, or null while there is not enough to compose one.
 *
 * ONLY COMPLETED ROWS JOIN THE BRACKETS — no "?" placeholders. Single Yarn shows
 * one label with no %, Yarn Dyed lists labels only (the yarns are dyed before
 * knitting, so a share does not apply), and every other fabric carries each
 * component's %. No components yet → just `FABRICTYPE STRUCTURE`, with no empty
 * parens and no dangling 100%.
 */
export function composeFabricName({
  fabricType,
  structure,
  parts,
  yarnDyed,
  singleYarn,
}: FabricNameParts): string | null {
  const head = [fabricType, structure].filter(Boolean).join(" ");
  const filled = parts.filter((m) => m.label && (yarnDyed || singleYarn || m.pct));
  if (filled.length) {
    const comps = singleYarn
      ? `(${filled[0].label})`
      : yarnDyed
        ? `(${filled.map((m) => m.label).join(", ")})`
        : mixingParens(filled);
    return `${head}${head ? " " : ""}${comps} 100%`.toUpperCase();
  }
  return head.toUpperCase() || null;
}
