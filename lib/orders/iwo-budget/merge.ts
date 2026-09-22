/**
 * IWO Budget — "Refresh from BOM": keeping pulled lines in step with the BOM
 * they came from (Phase 4).
 *
 * The order Budget has the same rule in `lib/orders/budget/pull-merge.ts`
 * (0591). This is its IWO half, written separately for two reasons: that file
 * was not yet committed when this one was (a commit cannot import another
 * session's uncommitted file), and it carries order-only grain — Fabric
 * Processes re-split per colour or per process and compared by GROUP total. An
 * IWO pulls fabric processes only fabric-wise and offers no re-split, so every
 * source here is matched line by line. THE POLICY IS THE ORDER BUDGET'S,
 * clause for clause:
 *
 *   - **Matched** (same `iwoPulledKey`): the BOM's facts replace the line's
 *     (qty, unit, stage, and on an accessory its FOC); the operator's stay
 *     (rate, currency, exchange rate, rate type, description, specification).
 *     A HAND-TYPED line with the key of a fresh BOM line is adopted, so one
 *     yarn is never costed twice.
 *   - **New**: added.
 *   - **Stale**: a held PULLED line the BOM no longer has is FLAGGED, never
 *     dropped — nothing leaves the budget unless the operator removes it
 *     (the order side's `staleDisposition` default).
 *
 * The comparison forgives what saving does to a value: 4 decimal places
 * (numeric(16,4)), and the key case-folds the shade.
 */

import { iwoPulledKey, type IwoPulledLine } from "./pull";

export type IwoHeldLine = {
  key: string;
  from_bom: boolean;
  source: string;
  item_id: string | null;
  process_id: string | null;
  combo: string | null;
  basis: string | null;
  qty: number | null;
  uom_id: string | null;
  stage_id: string | null;
  is_foc: boolean;
};

export type IwoMerge = {
  update: { key: string; line: IwoPulledLine }[];
  add: IwoPulledLine[];
  stale: string[];
};

const q4 = (v: number | null | undefined) => (v == null ? null : Math.round(Number(v) * 1e4) / 1e4);

/** Do the BOM's facts on `held` already say what `fresh` says? */
export function sameIwoBomFacts(held: IwoHeldLine, fresh: IwoPulledLine): boolean {
  return (
    q4(held.qty) === q4(fresh.qty) &&
    (held.uom_id ?? null) === (fresh.uom_id ?? null) &&
    (held.stage_id ?? null) === (fresh.stage_id ?? null) &&
    (fresh.source !== "material" || held.is_foc === fresh.is_foc)
  );
}

export function mergeIwoPulled(held: readonly IwoHeldLine[], fresh: readonly IwoPulledLine[]): IwoMerge {
  const out: IwoMerge = { update: [], add: [], stale: [] };
  const heldByKey = new Map<string, IwoHeldLine>();
  for (const h of held) {
    const k = iwoPulledKey(h);
    const prev = heldByKey.get(k);
    // Two held lines on one key: the pulled one is the one kept in step.
    if (!prev || (!prev.from_bom && h.from_bom)) heldByKey.set(k, h);
  }
  const matched = new Set<string>();
  for (const f of fresh) {
    const h = heldByKey.get(iwoPulledKey(f));
    if (!h) {
      out.add.push(f);
      continue;
    }
    matched.add(h.key);
    if (!h.from_bom || !sameIwoBomFacts(h, f)) out.update.push({ key: h.key, line: f });
  }
  for (const h of held) {
    if (h.from_bom && !matched.has(h.key)) out.stale.push(h.key);
  }
  return out;
}

export const iwoMergeIsEmpty = (m: IwoMerge) => !m.update.length && !m.add.length && !m.stale.length;
