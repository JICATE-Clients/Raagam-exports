import { KNIT_TYPE_OPTIONS } from "./types";

/**
 * A FABRIC'S FINISH DIA COMES FROM ITS OWN KNIT FAMILY (client 2026-09-19).
 *
 * Color/Print Details ▸ Dia / Size Width Details declares each dia under a Type
 * — Circular, Flat or Woven (`order_fabric_bom_dias.knit_type`, 0490). Manual's
 * Finish Dia used to offer every declared dia to every fabric, so a circular
 * jersey could be given a flat-knit collar width and nothing objected. The
 * client's rule: a circular fabric lists circular dias only, a flat fabric flat
 * dias only.
 *
 * ## WHERE THE FABRIC'S FAMILY COMES FROM
 *
 * The STRUCTURE master — `categories.fabric_structure_id`, a `config_lookups`
 * row coded `circular` / `flat_knit` / `woven`, the same three codes a dia row
 * stores. A fabric's structure is its `items.category_id`. It is NOT derived
 * from the dias (`diaTypeOf` on the screen does that for a label), because a
 * type read off the chosen dia can never disagree with the dia — which is
 * exactly the check this file exists to make.
 *
 * ## ONE RULE, TWO READERS
 *
 * The screen narrows the picker and blocks Save with `diaKnitProblem`; the save
 * action runs the same function over the payload, so a stale page or a replayed
 * request cannot store what the picker would never have offered.
 *
 * ## WHAT IT DELIBERATELY DOES NOT REFUSE
 *
 * - A fabric whose structure has NO family set: there is nothing to scope by,
 *   so every declared dia stays on offer (the behaviour before this rule).
 * - A dia declared with no Type, or not declared at all: neither is "the wrong
 *   type". An untyped dia is left out of a typed fabric's list, but a value
 *   already holding one is not blocked — only a dia declared EXCLUSIVELY under
 *   other families is a contradiction.
 */

export type DiaDeclaration = { knit_type: string | null; dia?: string | number | null };

/** The identity of a dia since 0566: its text, upper-cased for the compare. */
export const diaKey = (v: string | number | null | undefined): string =>
  String(v ?? "").trim().toUpperCase();

export const knitLabel = (code: string | null | undefined): string =>
  KNIT_TYPE_OPTIONS.find((o) => o.value === code)?.label ?? "";

/** The families a dia is declared under — empty when undeclared or untyped. */
export function knitTypesOfDia(dia: string | null | undefined, dias: readonly DiaDeclaration[]): string[] {
  const key = diaKey(dia);
  if (!key) return [];
  return [
    ...new Set(
      dias.filter((d) => diaKey(d.dia) === key && d.knit_type).map((d) => d.knit_type as string),
    ),
  ];
}

/**
 * The refusal for one Finish Dia on a fabric of family `knit`, or null.
 * `fabric` names the cloth in the sentence, since Manual is one card per fabric.
 */
export function diaKnitProblem(
  dia: string | null | undefined,
  knit: string | null | undefined,
  dias: readonly DiaDeclaration[],
  fabric: string,
): string | null {
  if (!knit || !diaKey(dia)) return null;
  const kinds = knitTypesOfDia(dia, dias);
  if (kinds.length === 0 || kinds.includes(knit)) return null;
  const declared = kinds.map(knitLabel).join(" / ");
  const own = knitLabel(knit) || knit;
  return `${fabric}: Finish Dia ${diaKey(dia)} is declared for ${declared}, but this fabric is ${own} — pick a ${own} dia.`;
}

/** Every refusal across the Manual entries, first-found order. */
export function manualDiaKnitProblems(
  entries: readonly { item_id: string | null; sizes: readonly { dia?: string | null }[] }[],
  dias: readonly DiaDeclaration[],
  knitOfFabric: (itemId: string) => string | null,
  fabricName: (itemId: string) => string,
): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (!e.item_id) continue;
    const knit = knitOfFabric(e.item_id);
    if (!knit) continue;
    const seen = new Set<string>();
    for (const z of e.sizes) {
      const key = diaKey(z.dia);
      if (seen.has(key)) continue;
      seen.add(key);
      const p = diaKnitProblem(z.dia, knit, dias, fabricName(e.item_id));
      if (p) out.push(p);
    }
  }
  return out;
}
