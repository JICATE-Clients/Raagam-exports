/**
 * Sample ▸ Grouping — the arithmetic (doc/sample/product-grouping-specification.md §5).
 *
 * PURE ON PURPOSE: no server-only import, so the screen's live figures, the
 * server actions that store them and `scripts/check-sample-grouping.mts` read
 * ONE rule. A style's kilos come from its costing through the costing's own
 * `gramsOf`, so a sample costs and batches on the same number.
 *
 * WHY GROUPING EXISTS (spec §1): a sample is 2–5 pieces and 0.5–2 kg of fabric,
 * while a spinning mill, knitter or dye house sells by the 50–60 kg bag. Buying
 * per style buys a bag per style; batching styles that share a season, a fabric
 * structure and a yarn blend buys one bag for all of them.
 */
import { gramsOf, num, type WeightInput } from "../sample-costing/calc";

/** The mill's minimum order (spec §5.2 "Market MOQ (60.0 Kg)"). Per group, editable. */
export const DEFAULT_MOQ_KG = 60;
/** Above the MOQ, the purchase rounds UP to whole batches of this size (spec §5.2). */
export const DEFAULT_BATCH_KG = 30;

const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

// ---------------------------------------------------------------------------
// §5.2 Market MOQ batch rounding
// ---------------------------------------------------------------------------
/**
 *   net ≤ MOQ  →  MOQ
 *   net > MOQ  →  ⌈net ÷ batch⌉ × batch
 *
 * Nothing to buy (net 0) buys nothing — the spec's first case would order a
 * whole bag for a group with no kilos in it. A non-positive MOQ or batch is
 * never divided by: the MOQ falls back to the net itself, the batch to 1 kg.
 */
export function moqOrderWeight(netKg: number, moqKg: number = DEFAULT_MOQ_KG, batchKg: number = DEFAULT_BATCH_KG): number {
  if (!(netKg > 0)) return 0;
  const moq = moqKg > 0 ? moqKg : 0;
  if (netKg <= moq) return round(moq, 3);
  const batch = batchKg > 0 ? batchKg : 1;
  // Round the quotient first: 4.2 ÷ 1.4 is 3.0000000000000004 in floating point, which must not buy a 4th batch.
  return round(Math.ceil(round(netKg / batch, 9)) * batch, 3);
}

/** How the purchased weight reads: "MOQ" at the minimum, else "n × 30 kg". */
export function purchaseBasis(netKg: number, moqKg: number, batchKg: number): string {
  const buy = moqOrderWeight(netKg, moqKg, batchKg);
  if (buy === 0) return "";
  if (netKg <= moqKg) return "MOQ";
  const batch = batchKg > 0 ? batchKg : 1;
  return `${Math.round(buy / batch)} × ${round(batch, 2)} kg`;
}

// ---------------------------------------------------------------------------
// §5.1 Net group weight
// ---------------------------------------------------------------------------
export const groupNetKg = (itemKg: readonly (number | null | undefined)[]) =>
  round(itemKg.reduce<number>((t, k) => t + (k ?? 0), 0), 3);

// ---------------------------------------------------------------------------
// §5.3 Material redistribution on receipt
// ---------------------------------------------------------------------------
/** Released cutting weight = style weight × (1 + sample cutting waste %). */
export const releasedCuttingKg = (styleKg: number, cuttingWastePct: number) =>
  round(styleKg * (1 + (cuttingWastePct > 0 ? cuttingWastePct : 0) / 100), 3);

/**
 * What stays in the Sample Fabric Stock once every style has its cutting
 * weight (spec §5.3) — negative when the purchase cannot cover the release,
 * which `distributeProblem` refuses.
 */
export function excessToStock(purchasedKg: number, styleKg: readonly number[], cuttingWastePct: number): number {
  return round(purchasedKg - styleKg.reduce((t, k) => t + releasedCuttingKg(k, cuttingWastePct), 0), 3);
}

export function distributeProblem(purchasedKg: number, styleKg: readonly number[], cuttingWastePct: number): string | null {
  const left = excessToStock(purchasedKg, styleKg, cuttingWastePct);
  if (left >= 0) return null;
  return `The styles need ${fmtKg(-left)} kg more than the ${fmtKg(purchasedKg)} kg bought — lower the cutting waste, or buy another batch.`;
}

// ---------------------------------------------------------------------------
// "Efficiency / Waste Saved %" (spec §3.A.1)
// ---------------------------------------------------------------------------
/**
 * The spec names the card and not the sum, so this is the one reading of it
 * that the data can answer: the kilos the styles would have bought ORDERING
 * ALONE — each its own MOQ / batch purchase — against the kilos the groups
 * buy. Same MOQ and batch on both sides (the group's), so the saving is only
 * ever the batching, never a different supplier term.
 */
export type BatchSaving = { aloneKg: number; batchedKg: number; savedKg: number; savedPct: number | null };

export function batchingSaving(groups: readonly { itemKg: readonly number[]; moqKg: number; batchKg: number }[]): BatchSaving {
  let alone = 0;
  let batched = 0;
  for (const g of groups) {
    for (const k of g.itemKg) alone += moqOrderWeight(k, g.moqKg, g.batchKg);
    batched += moqOrderWeight(groupNetKg(g.itemKg), g.moqKg, g.batchKg);
  }
  alone = round(alone, 3);
  batched = round(batched, 3);
  const saved = round(alone - batched, 3);
  return { aloneKg: alone, batchedKg: batched, savedKg: saved, savedPct: alone > 0 ? round((saved / alone) * 100, 1) : null };
}

// ---------------------------------------------------------------------------
// A style's kilos of ONE costing fabric
// ---------------------------------------------------------------------------
/** A costing weight row as stored (`sample_costing_component_weights`). */
export type StoredWeight = {
  fabric_line_id: string | null;
  size_name: string | null;
  weight_g: number | string | null;
  length_cm: number | string | null;
  width_cm: number | string | null;
  gsm: number | string | null;
  wastage_pct: number | string | null;
};

const s = (v: number | string | null | undefined) => (v == null ? "" : String(v));
const asInput = (w: StoredWeight): WeightInput => ({
  piece_key: "",
  fabric_key: w.fabric_line_id,
  size_name: w.size_name,
  weight_g: s(w.weight_g),
  length_cm: s(w.length_cm),
  width_cm: s(w.width_cm),
  gsm: s(w.gsm),
  wastage_pct: s(w.wastage_pct),
});

/**
 * Net kilos of one costing fabric for a style's sample pieces.
 *
 *   kg = Σ over sizes ( pieces in that size × grams per piece in that size × (1 + loss %) ) ÷ 1000
 *
 * - GRAMS are the costing's own (`gramsOf`: L × W × GSM when all three are in,
 *   else the typed grams), with the costing's Loss % on the row — the "Uses kg"
 *   figure the costing shows beside the fabric. One weight engine, two screens.
 * - SIZES follow the costing's matrix: a size the costing has no column for
 *   takes the FIRST column's grams, the same "blank cell = first size" rule the
 *   weights table draws; a row saved with no size (before 0693) counts in every size.
 * - PIECES are the style's size split from Sample Entry's Combos when it has
 *   one; otherwise the whole Sample Qty is weighed at the first column.
 *
 * Null when the costing gives this fabric no weight at all — a style with no
 * kilos is not a candidate, never a zero that would quietly shrink a batch.
 */
export function styleFabricKg(
  weights: readonly StoredWeight[],
  fabricLineId: string,
  pieces: { bySize: Readonly<Record<string, number>>; total: number },
): number | null {
  const cols: string[] = [];
  for (const w of weights) if (w.size_name && !cols.includes(w.size_name)) cols.push(w.size_name);
  const mine = weights.filter((w) => w.fabric_line_id === fabricLineId);
  if (!mine.some((w) => gramsOf(asInput(w)) != null)) return null;

  const perPiece = (size: string | null) => {
    const col = size != null && cols.includes(size) ? size : (cols[0] ?? null);
    return mine
      .filter((w) => w.size_name == null || w.size_name === col)
      .reduce((t, w) => t + (gramsOf(asInput(w)) ?? 0) * (1 + (num(s(w.wastage_pct)) ?? 0) / 100), 0);
  };

  const split = Object.entries(pieces.bySize).filter(([, q]) => q > 0);
  const grams = split.length
    ? split.reduce((t, [size, q]) => t + q * perPiece(size), 0)
    : (pieces.total > 0 ? pieces.total : 0) * perPiece(null);
  return round(grams / 1000, 3);
}

// ---------------------------------------------------------------------------
// The yarn blend a fabric is bought as
// ---------------------------------------------------------------------------
/**
 * The blend LABEL ("95% 24'S BCI COTTON / 5% 40 DINER ELASTANE") and the KEY two
 * candidates must share to batch. From the costing's Yarn Mix when it has
 * one, largest share first; a fabric priced at a direct rate has no mix, so
 * its typed quality stands in, then the structure's name.
 */
export function blendOf(
  yarns: readonly { name: string | null; mix_pct: number | string | null }[],
  quality: string | null,
  structure: string | null,
): { label: string; key: string } {
  const mix = yarns
    .map((y) => ({ name: (y.name ?? "").trim(), pct: num(s(y.mix_pct)) }))
    .filter((y) => y.name && y.pct != null && y.pct > 0)
    .sort((a, b) => (b.pct as number) - (a.pct as number) || a.name.localeCompare(b.name));
  const label = mix.length
    ? mix.map((y) => `${round(y.pct as number, 2)}% ${y.name}`).join(" / ")
    : (quality ?? "").trim() || (structure ?? "").trim();
  return { label, key: label.toUpperCase().replace(/\s+/g, " ").trim() };
}

// ---------------------------------------------------------------------------
// Which candidates may share a group
// ---------------------------------------------------------------------------
/** What a group is keyed on: same season, same year, same structure, same blend. */
export type GroupKey = {
  season: string;
  season_year: number | null;
  fabric_structure_id: string | null;
  blend_key: string;
};

/** Season names match ignoring case and spaces — the same normalising the
 *  group code's trigger applies (0702), so "Q 1" and "Q1" are one season in
 *  the code and in this rule. */
export const seasonKey = (season: string) => season.replace(/\s+/g, "").toUpperCase();
const sameSeason = (a: string, b: string) => seasonKey(a) === seasonKey(b);

export const sameGroupKey = (a: GroupKey, b: GroupKey) =>
  sameSeason(a.season, b.season) &&
  a.season_year === b.season_year &&
  a.fabric_structure_id === b.fabric_structure_id &&
  a.blend_key === b.blend_key;

/**
 * Why these candidates cannot be batched together, or null. The first reason
 * found, worded for the operator. Read by the selection bar AND the server
 * action, so a group the screen offers is a group the server accepts.
 */
export function groupingProblem(
  picked: readonly (GroupKey & { label: string; kg: number | null; group_code: string | null })[],
): string | null {
  if (picked.length === 0) return "Tick the styles to batch first.";
  const grouped = picked.find((c) => c.group_code);
  if (grouped) return `${grouped.label} is already in ${grouped.group_code}.`;
  const noKg = picked.find((c) => !(c.kg != null && c.kg > 0));
  if (noKg) return `${noKg.label} has no garment weight on its costing, so it has no kilos to batch.`;
  const noSeason = picked.find((c) => !c.season.trim() || c.season_year == null);
  if (noSeason) return `${noSeason.label} has no Season and Year — set them on Sample Entry first.`;
  const first = picked[0];
  const odd = picked.find((c) => !sameGroupKey(c, first));
  if (odd) {
    if (!sameSeason(odd.season, first.season) || odd.season_year !== first.season_year) {
      return "A group is one season — every style picked must share the Season and Year.";
    }
    if (odd.fabric_structure_id !== first.fabric_structure_id) {
      return "A group is one fabric structure — every style picked must use the same one.";
    }
    return "A group is one yarn blend — every style picked must be knitted from the same yarn.";
  }
  return null;
}

/** "1.375" — kilos to three places, trailing zeros trimmed past one. */
export function fmtKg(kg: number | null | undefined, dp = 3): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  const fixed = kg.toFixed(dp);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, ".0") : fixed;
}

// ---------------------------------------------------------------------------
// Auto-group — the batches the screen PROPOSES (user 2026-10-09)
// ---------------------------------------------------------------------------
/**
 * One proposal: the ungrouped, weighed styles that share a group key, and
 * where they would go — into a DRAFT group already holding that key (`into`),
 * else a new group. Nothing is written by this function; the planner confirms
 * on the screen, and each proposal then runs through the same create / add
 * action a hand-ticked selection does, so the server re-checks it.
 *
 * WHICH CANDIDATES ARE PROPOSED: ungrouped, kilos > 0, with a Season and Year
 * — exactly the ones `groupingProblem` would accept. A lone style still gets a
 * proposal when a Draft group is waiting for it; alone with nothing to join,
 * it is listed in `alone` instead, because a group of one buys the same bag it
 * would have bought on its own and saves nothing.
 *
 * Ordered by season, then by net kilos (largest first), so the batches worth
 * most are read first.
 */
export type GroupProposal<C> = {
  key: string;
  candidates: C[];
  netKg: number;
  into: { id: string; code: string; netKg: number } | null;
};

export function proposeGroups<C extends GroupKey & { key: string; kg: number | null; group_code: string | null }>(
  candidates: readonly C[],
  draftGroups: readonly (GroupKey & { id: string; group_code: string; netKg: number })[],
): { proposals: GroupProposal<C>[]; alone: C[] } {
  const keyOf = (k: GroupKey) => [seasonKey(k.season), k.season_year ?? "", k.fabric_structure_id ?? "", k.blend_key].join("|");
  const buckets = new Map<string, C[]>();
  for (const c of candidates) {
    if (c.group_code || !(c.kg != null && c.kg > 0) || !c.season.trim() || c.season_year == null || !c.blend_key) continue;
    const k = keyOf(c);
    const list = buckets.get(k);
    if (list) list.push(c);
    else buckets.set(k, [c]);
  }
  const proposals: GroupProposal<C>[] = [];
  const alone: C[] = [];
  for (const [k, list] of buckets) {
    const target = draftGroups.find((g) => keyOf(g) === k) ?? null;
    if (list.length < 2 && !target) {
      alone.push(...list);
      continue;
    }
    proposals.push({
      key: k,
      candidates: list,
      netKg: groupNetKg(list.map((c) => c.kg)),
      into: target ? { id: target.id, code: target.group_code, netKg: target.netKg } : null,
    });
  }
  proposals.sort(
    (a, b) =>
      seasonKey(a.candidates[0].season).localeCompare(seasonKey(b.candidates[0].season)) ||
      (a.candidates[0].season_year ?? 0) - (b.candidates[0].season_year ?? 0) ||
      b.netKg - a.netKg,
  );
  return { proposals, alone };
}
