/**
 * Keeping a budget's PULLED lines in step with the BOMs they came from.
 *
 * The Budget fills itself (user 2026-09-19): picking an order pulls its lines
 * from the Fabric BOM and the Material BOM, and on a pulled line the item,
 * description, quantity, unit and stage are the BOM's answer, read-only. That
 * lock is only honest if the budget FOLLOWS the BOM. When a BOM is edited after
 * the pull, the operator can no longer fix a stale quantity by hand, so "Refresh
 * from BOMs" has to UPDATE lines as well as add them. The old pull only added.
 *
 * This file is the one rule for what a refresh does. The screen applies it, and
 * `submitBudget` runs it against the STORED lines and refuses a budget it would
 * change. So the budget the approver sees is always the BOMs' current answer,
 * even if a stale tab never pressed Refresh.
 *
 * PURE. No `server-only` and no database, so `scripts/check-budget-pull-merge.mts`
 * can reach every clause.
 *
 * ## WHAT A REFRESH DOES TO EACH LINE
 *
 * - **Matched** (same `mergeKey`): the BOM's facts replace the line's own
 *   (qty, unit, description, stage), and the operator's facts stay: rate,
 *   currency, exchange rate, rate type, specification, CMT breakup, FOC and
 *   Import. A HAND-TYPED line with the key of a fresh BOM
 *   line is matched too, and becomes a pulled one. Left alone, the pull would add
 *   the BOM's line beside it and the same yarn would be costed twice.
 * - **New**: a fresh line with no match is added.
 * - **Stale**: a held PULLED line with no fresh match is no longer on the BOM.
 *   `staleDisposition` decides what happens to it.
 * - **Fabric Processes compare by GROUP** (one process on one order). The
 *   operator may have re-split a group per colour or per process, and a split
 *   line never keys like a pulled one. So a group is compared on its TOTAL
 *   kilograms. A group whose total moved is re-fitted at the grain it holds; a
 *   new group is added; a group gone from the BOM goes stale.
 *
 * ## THE COMPARISON FORGIVES WHAT SAVING DOES TO A VALUE
 *
 * `order_budget_lines.qty` is numeric(16,4), and descriptions and colours are
 * saved in CAPITALS (`capsTextNullable`). The report writes "Greige Fabric Roll
 * Weight" and 1536.873291 kg. Compared raw, every stored budget would read as
 * "the BOM changed" forever, and Submit would never pass. So quantities compare
 * at 4 places and text compares trimmed and upper-cased.
 */
import { pulledLineKey } from "./totals";

/** The fields that make a pulled line "the same line" (`pulledLineKey`). */
export type MergeKeyed = {
  source: string;
  garment_order_id: string | null;
  item_id: string | null;
  process_id?: string | null;
  combo?: string | null;
  basis?: string | null;
  style_ref_no?: string | null;
  component_id?: string | null;
};

/** The BOM's facts on a line. These are the fields a refresh overwrites and
 *  the fields the lock makes read-only. */
export type BomFacts = {
  qty: number | null;
  uom_id: string | null;
  description: string | null;
  stage_id?: string | null;
  is_foc?: boolean;
  is_import?: boolean;
};

/** A line already on the budget. `key` is the screen's row key, or the stored
 *  line's id on the server. */
export type HeldLine = MergeKeyed & BomFacts & { key: string; from_bom: boolean };
/** A line the pull just produced. */
export type FreshLine = MergeKeyed & BomFacts;

/** What a stale pulled line should become. See `staleDisposition`. */
export type StaleDisposition = "drop" | "flag";

export type PullMerge<F extends FreshLine> = {
  /** Held line → the fresh line whose BOM facts now replace its own. Only lines
   *  whose facts actually differ, or that were typed and are now adopted. */
  update: { key: string; line: F }[];
  /** Fresh lines with no held match (outside Fabric Processes). */
  add: F[];
  /** Held pulled lines the BOM no longer has, with what to do about each. */
  stale: { key: string; disposition: StaleDisposition }[];
  /** Fabric Processes groups to re-fit: the group's key, the grain it is held
   *  at (null for a NEW group) and the BOM's fresh lines for it. */
  refit: { groupKey: string; basis: string | null; lines: F[] }[];
};

const up = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();
const q4 = (v: number | null | undefined) => (v == null ? null : Math.round(Number(v) * 1e4) / 1e4);

/**
 * `pulledLineKey` with its TEXT parts case-folded. A stored colour is in
 * capitals and the order's own may not be. Keyed raw, a refresh would read a
 * saved "NAVY" line and a fresh "Navy" one as a stale line and a new line, and
 * the same dye lot would be costed twice.
 */
export function mergeKey(l: MergeKeyed): string {
  return pulledLineKey({ ...l, combo: up(l.combo) || null, style_ref_no: up(l.style_ref_no) || null });
}

/** A Fabric Processes group: one process on one order. The screen's
 *  `fabricGroupKey`, restated here so the server can reach it. */
export function mergeGroupKey(l: { garment_order_id: string | null; process_id?: string | null }): string {
  return `${l.garment_order_id ?? ""}|${l.process_id ?? ""}`;
}

/** Do the BOM's facts on `held` already say what `fresh` says? */
export function sameBomFacts(held: HeldLine, fresh: FreshLine): boolean {
  return (
    q4(held.qty) === q4(fresh.qty) &&
    (held.uom_id ?? null) === (fresh.uom_id ?? null) &&
    up(held.description) === up(fresh.description) &&
    (held.stage_id ?? null) === (fresh.stage_id ?? null)
    /* NOT FOC OR IMPORT (user 2026-09-19): those are the merchandiser's on
       every line, an accessory's included. A pulled line starts from the
       Material BOM's, and a switch changed on the budget is not "the BOM
       changed" — comparing them would refuse Submit on every such line. */
  );
}

/**
 * What happens to a pulled line the BOM no longer has.
 *
 * TODO(user): the policy is yours to decide. See the request in the session.
 * Until then every stale line is FLAGGED (kept, marked "No longer on the BOM",
 * removable): nothing leaves the budget unless the operator removes it.
 */
export function staleDisposition(line: HeldLine & { rate?: number | null }): StaleDisposition {
  void line;
  return "flag";
}

/** Σ of a group's quantities at 4 places, or null when any line has none. */
function groupTotal(lines: readonly BomFacts[]): number | null {
  let n = 0;
  for (const l of lines) {
    if (l.qty == null) return null;
    n += Number(l.qty);
  }
  return q4(n);
}

/**
 * The refresh, as a plan. It changes nothing: the screen applies it to its rows
 * and `submitBudget` refuses when it is not empty (`pullMergeIsEmpty`).
 *
 * `held` is every line on the budget for the orders being refreshed: typed and
 * pulled, any source. Typed lines only ever match; they never go stale.
 */
export function mergePulled<H extends HeldLine, F extends FreshLine>(
  held: readonly H[],
  fresh: readonly F[],
): PullMerge<F> {
  const out: PullMerge<F> = { update: [], add: [], stale: [], refit: [] };

  // ---- everything but Fabric Processes: line by line ----
  const heldByKey = new Map<string, H>();
  for (const h of held) {
    if (h.source === "fabric_process") continue;
    const k = mergeKey(h);
    const prev = heldByKey.get(k);
    // TWO HELD LINES ON ONE KEY: the pulled one is the one to keep in step.
    if (!prev || (!prev.from_bom && h.from_bom)) heldByKey.set(k, h);
  }
  const matched = new Set<string>();
  for (const f of fresh) {
    if (f.source === "fabric_process") continue;
    const h = heldByKey.get(mergeKey(f));
    if (!h) {
      out.add.push(f);
      continue;
    }
    matched.add(h.key);
    if (!h.from_bom || !sameBomFacts(h, f)) out.update.push({ key: h.key, line: f });
  }
  for (const h of held) {
    if (h.source === "fabric_process" || !h.from_bom || matched.has(h.key)) continue;
    out.stale.push({ key: h.key, disposition: staleDisposition(h) });
  }

  // ---- Fabric Processes: group by group, on the total ----
  const heldGroups = new Map<string, H[]>();
  for (const h of held) {
    if (h.source !== "fabric_process") continue;
    const k = mergeGroupKey(h);
    heldGroups.set(k, [...(heldGroups.get(k) ?? []), h]);
  }
  const freshGroups = new Map<string, F[]>();
  for (const f of fresh) {
    if (f.source !== "fabric_process") continue;
    const k = mergeGroupKey(f);
    freshGroups.set(k, [...(freshGroups.get(k) ?? []), f]);
  }
  for (const [k, lines] of freshGroups) {
    const mine = heldGroups.get(k);
    if (!mine) {
      out.refit.push({ groupKey: k, basis: null, lines });
      continue;
    }
    const basis = mine[0]?.basis ?? null;
    /* STILL FABRIC-WISE — the grain the pull brings — so every held line keys
       like a fresh one and is compared as one: 10 kg moving from one fabric to
       another leaves the total alone and is still a change. A group the
       operator re-split has no per-line counterpart, so its TOTAL is the fact
       (the split re-fits from the breakdown at the new weights). */
    const moved = mine.every((h) => h.basis === "fabric")
      ? mine.length !== lines.length ||
        lines.some((f) => {
          const h = mine.find((x) => mergeKey(x) === mergeKey(f));
          return !h || q4(h.qty) !== q4(f.qty) || (h.uom_id ?? null) !== (f.uom_id ?? null);
        })
      : (() => {
          const t = groupTotal(mine);
          return t == null || t !== groupTotal(lines);
        })();
    if (moved) out.refit.push({ groupKey: k, basis, lines });
  }
  for (const [k, mine] of heldGroups) {
    if (freshGroups.has(k)) continue;
    for (const h of mine) {
      if (h.from_bom) out.stale.push({ key: h.key, disposition: staleDisposition(h) });
    }
  }
  return out;
}

/** Nothing to do: the budget already says what the BOMs say. */
export function pullMergeIsEmpty(m: PullMerge<FreshLine>): boolean {
  return m.update.length === 0 && m.add.length === 0 && m.stale.length === 0 && m.refit.length === 0;
}

/** How many lines a refresh would touch, for the banner and the refusal. */
export function pullMergeSize(m: PullMerge<FreshLine>): number {
  return m.update.length + m.add.length + m.stale.length + m.refit.reduce((a, g) => a + g.lines.length, 0);
}
