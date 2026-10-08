/**
 * Sample Costing — the arithmetic (doc/sample/sample-costing-specification.md
 * §3–§4). PURE: no React, no server import, so the live summary on screen, the
 * server's Submit decision (§5.2, margin floor) and the quotation PDF are the
 * SAME numbers — three readers, one engine, nothing to drift.
 *
 * The chain, per garment PIECE and per SIZE GROUP:
 *
 *   Yarn / KG          = typed, or Σ Mix % × Rate ÷ 100 over the Yarn Mix lines
 *   Fabric Price / KG  = (Yarn + Knitting + Dyeing + Finishing + Σ special processes)
 *                        × (1 + Process Loss % / 100)          — or the Direct Rate
 *   Grams              = typed, or L(cm) × W(cm) × GSM / 10 000 once all three are in
 *   Fabric cost        = Σ  Price/KG ÷ 1000 × grams × (1 + Wastage Allowance % / 100)
 *                                                             over the piece's components
 *   Net cost           = Fabric + CMT + Print + Embroidery + Wash + Trims
 *                        + Testing & FOB + Bank charges
 *   Margin / Wastage / Overhead / Discount = Net × their %
 *   Gross cost (INR)   = Net + Wastage + Overhead              (UI/UX spec §3 rail)
 *   Price (INR)        = Gross cost + Margin − Discount        (= the costing spec's
 *                                                             "Gross Price", §4.1)
 *   Calc price         = (Price + Freight + Insurance) ÷ Exchange Rate
 *   Set price          = Σ over the pieces of a SET
 *
 * SIZE GROUPS. A component weight row may name a size group (the spec's 162 g /
 * 258 g / 270 g bodies for three size ranges) or none, meaning "every size" — a
 * rib that is 40 g in every range is typed once. A piece is costed once per
 * size group the sheet uses; a row with no group adds to every group. A sheet
 * that names no group at all is costed once, as "All sizes".
 *
 * A BLANK IS NOT A ZERO where the figure is a price the operator owes us: a
 * missing exchange rate leaves the calc price `null` (shown as a dash and as a
 * problem), never a price divided by nothing or by an invented 1.
 */

/** Costing spec §5.2: a quoted price that earns less than this goes to the MD
 *  (the APPROVAL rule — server Submit and the approval engine read it). */
export const MARGIN_FLOOR_PCT = 20;
/**
 * UI/UX spec v2 §4.1 margin BADGES — a colour, not an approval rule:
 *   green  ≥ 22 %        meets the commercial target
 *   yellow 15 – 21.9 %   acceptable, flagged for management review
 *   red    < 15 %        low; the Quotation PDF waits for approval
 * (v1's 20 / 12 bands are superseded.) The 20 % approval floor sits inside
 * the yellow band: 20–21.9 % is "below target", 15–19.9 % also goes to the MD.
 */
export const MARGIN_TARGET_PCT = 22;
export const MARGIN_RED_BELOW_PCT = 15;
export type MarginHealth = "good" | "tight" | "poor";
export function marginHealth(pct: number | null): MarginHealth | null {
  if (pct == null) return null;
  return pct >= MARGIN_TARGET_PCT ? "good" : pct >= MARGIN_RED_BELOW_PCT ? "tight" : "poor";
}

// ---------------------------------------------------------------------------
// The shapes the engine reads. Strings, because they are the editor's own
// state — what the operator typed, blank included.
// ---------------------------------------------------------------------------
export type FabricProcessInput = { rate: string };
export type YarnMixInput = { mix_pct: string; rate: string };
export type FabricInput = {
  key: string;
  yarn_rate: string;
  /** The Yarn Mix breakdown (0690). When any line carries a Mix %, the yarn
   *  rate IS their weighted sum and `yarn_rate` is not read. */
  yarns: readonly YarnMixInput[];
  knitting_rate: string;
  dyeing_rate: string;
  finishing_rate: string;
  process_loss_pct: string;
  is_direct: boolean;
  direct_rate: string;
  processes: readonly FabricProcessInput[];
};
export type PieceInput = {
  key: string;
  cmt: string;
  print_cost: string;
  embroidery_cost: string;
  wash_cost: string;
  testing_cost: string;
  bank_cost: string;
};
export type WeightInput = {
  piece_key: string;
  fabric_key: string | null;
  size_group_id: string | null;
  weight_g: string;
  length_cm: string;
  width_cm: string;
  gsm: string;
  /** The component's Wastage Allowance % (0690) — cutting loss on THIS
   *  component's fabric, applied to its grams. Blank = none. */
  wastage_pct: string;
};
export type TrimInput = { piece_key: string; qty: string; rate: string };
export type TermsInput = {
  margin_pct: string;
  garment_waste_pct: string;
  overhead_pct: string;
  discount_pct: string;
  freight_per_pc: string;
  insurance_per_pc: string;
  exchange_rate: string;
};
export type CostingInput = {
  pieces: readonly PieceInput[];
  fabrics: readonly FabricInput[];
  weights: readonly WeightInput[];
  trims: readonly TrimInput[];
  terms: TermsInput;
  /** Quoted price per `quoteKey(piece, group)`. */
  quotes: Readonly<Record<string, string>>;
};

/** A typed number, or null for a blank / unreadable box. */
export function num(v: string | null | undefined): number | null {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const z = (v: string | null | undefined) => num(v) ?? 0;
const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** The key a quoted price is stored under — one per piece × size group. */
export const quoteKey = (pieceKey: string, groupId: string | null) => `${pieceKey}|${groupId ?? ""}`;

// ---------------------------------------------------------------------------
// §3.1 Fabric rate derivation
// ---------------------------------------------------------------------------
export function processTotal(f: Pick<FabricInput, "processes">): number {
  return f.processes.reduce((t, p) => t + z(p.rate), 0);
}

/** Σ Mix % over the yarn lines — a blend should add to 100. */
export function yarnMixTotal(f: Pick<FabricInput, "yarns">): number {
  return round(f.yarns.reduce((t, y) => t + z(y.mix_pct), 0), 2);
}
/** True once the Yarn Mix carries any Mix % — the yarn rate is then derived. */
export const hasYarnMix = (f: Pick<FabricInput, "yarns">) => f.yarns.some((y) => num(y.mix_pct) != null);

/** Yarn / KG: the weighted mix when there is one, else the typed rate. */
export function yarnRateOf(f: Pick<FabricInput, "yarns" | "yarn_rate">): number {
  if (hasYarnMix(f)) return round(f.yarns.reduce((t, y) => t + (z(y.mix_pct) * z(y.rate)) / 100, 0), 4);
  return z(f.yarn_rate);
}

/** Yarn + Knitting + Dyeing + Finishing + special processing. */
export function fabricSubtotal(f: FabricInput): number {
  return yarnRateOf(f) + z(f.knitting_rate) + z(f.dyeing_rate) + z(f.finishing_rate) + processTotal(f);
}

/**
 * Price per KG, or null while nothing that prices the fabric has been typed.
 * A direct rate (finished fabric bought from a mill) replaces the derivation
 * whole — loss included, because a mill's price is for finished fabric.
 */
export function fabricPricePerKg(f: FabricInput): number | null {
  if (f.is_direct) {
    const d = num(f.direct_rate);
    return d != null && d > 0 ? d : null;
  }
  const sub = fabricSubtotal(f);
  if (sub <= 0) return null;
  return round(sub * (1 + z(f.process_loss_pct) / 100), 4);
}

// ---------------------------------------------------------------------------
// §3.2 Component consumption
// ---------------------------------------------------------------------------
/** The dimensional calc applies once Length, Width and GSM are all in. */
export function dimensionalGrams(w: Pick<WeightInput, "length_cm" | "width_cm" | "gsm">): number | null {
  const l = num(w.length_cm);
  const wd = num(w.width_cm);
  const g = num(w.gsm);
  if (l == null || wd == null || g == null || l <= 0 || wd <= 0 || g <= 0) return null;
  return round((l * wd * g) / 10000, 2);
}

/** Grams for a row: the dimensional figure when it applies, else the typed one. */
export function gramsOf(w: WeightInput): number | null {
  const d = dimensionalGrams(w);
  if (d != null) return d;
  const t = num(w.weight_g);
  return t != null && t > 0 ? t : null;
}

/** Cost of one component row, or null while its fabric or weight is missing. */
export function componentCost(w: WeightInput, fabrics: readonly FabricInput[]): number | null {
  const f = fabrics.find((x) => x.key === w.fabric_key);
  const price = f ? fabricPricePerKg(f) : null;
  const grams = gramsOf(w);
  if (price == null || grams == null) return null;
  return round((price / 1000) * grams * (1 + z(w.wastage_pct) / 100), 4);
}

/** The size groups the sheet is costed for, in first-use order; [null] = all sizes. */
export function sizeGroupsOf(weights: readonly WeightInput[]): (string | null)[] {
  const seen: string[] = [];
  for (const w of weights) if (w.size_group_id && !seen.includes(w.size_group_id)) seen.push(w.size_group_id);
  return seen.length ? seen : [null];
}

// ---------------------------------------------------------------------------
// §4 The commercial summary
// ---------------------------------------------------------------------------
export type PieceFigures = {
  pieceKey: string;
  groupId: string | null;
  fabric: number;
  cmt: number;
  /** Print + Embroidery + Wash — the garment processing of §3.3. */
  process: number;
  trims: number;
  /** Testing & FOB + Bank charges. */
  other: number;
  net: number;
  margin: number;
  wastage: number;
  overhead: number;
  discount: number;
  /** Net + Wastage + Overhead — what the piece COSTS before any margin. */
  grossCost: number;
  /** The INR selling price: Gross cost + Margin − Discount. */
  gross: number;
  /** In the target currency; null while the exchange rate is missing. */
  calc: number | null;
  quoted: number | null;
  /** quoted − calc, and as a % of calc. Null without both. */
  delta: number | null;
  deltaPct: number | null;
  /**
   * The margin the QUOTED price actually earns, % of net — what the floor is
   * tested against. With no quoted price it is the calc price's, i.e. the
   * typed Margin %. Null when net is 0 or the rate is missing.
   */
  effectiveMarginPct: number | null;
};

export type GroupFigures = {
  groupId: string | null;
  pieces: PieceFigures[];
  /** The set (or the one piece) — every money figure summed over the pieces. */
  total: Omit<PieceFigures, "pieceKey" | "groupId" | "effectiveMarginPct" | "deltaPct"> & {
    deltaPct: number | null;
    effectiveMarginPct: number | null;
  };
};

export type CostingSummary = {
  groups: GroupFigures[];
  /** The lowest effective margin across every piece × group; null if none computable. */
  lowestMarginPct: number | null;
  /** Spec §5.2 — true when any quote earns under MARGIN_FLOOR_PCT. */
  belowFloor: boolean;
};

function sumOrNull(xs: (number | null)[]): number | null {
  if (xs.some((x) => x == null)) return null;
  return round(xs.reduce<number>((t, x) => t + (x ?? 0), 0), 4);
}

function effectiveMargin(
  quotedOrCalc: number | null,
  net: number,
  costAdds: number,
  discount: number,
  freight: number,
  insurance: number,
  rate: number | null,
): number | null {
  if (quotedOrCalc == null || rate == null || rate <= 0 || net <= 0) return null;
  const priceFromQuote = quotedOrCalc * rate - freight - insurance;
  return round(((priceFromQuote - net - costAdds + discount) / net) * 100, 2);
}

/** Every figure the summary rail, the quotation matrix and Submit read. */
export function costingSummary(input: CostingInput): CostingSummary {
  const t = input.terms;
  const marginPct = z(t.margin_pct);
  const wastePct = z(t.garment_waste_pct);
  const overheadPct = z(t.overhead_pct);
  const discPct = z(t.discount_pct);
  const freight = z(t.freight_per_pc);
  const insurance = z(t.insurance_per_pc);
  const rateRaw = num(t.exchange_rate);
  const rate = rateRaw != null && rateRaw > 0 ? rateRaw : null;

  const groups = sizeGroupsOf(input.weights).map((groupId): GroupFigures => {
    const pieces = input.pieces.map((p): PieceFigures => {
      const rows = input.weights.filter(
        (w) => w.piece_key === p.key && (w.size_group_id == null || w.size_group_id === groupId),
      );
      const fabric = round(rows.reduce((s, w) => s + (componentCost(w, input.fabrics) ?? 0), 0), 4);
      const trims = round(
        input.trims.filter((x) => x.piece_key === p.key).reduce((s, x) => s + z(x.qty) * z(x.rate), 0),
        4,
      );
      const cmt = z(p.cmt);
      const process = z(p.print_cost) + z(p.embroidery_cost) + z(p.wash_cost);
      const other = z(p.testing_cost) + z(p.bank_cost);
      const net = round(fabric + cmt + process + trims + other, 4);
      const margin = round((net * marginPct) / 100, 4);
      const wastage = round((net * wastePct) / 100, 4);
      const overhead = round((net * overheadPct) / 100, 4);
      const discount = round((net * discPct) / 100, 4);
      const grossCost = round(net + wastage + overhead, 4);
      const gross = round(grossCost + margin - discount, 4);
      const calc = rate ? round((gross + freight + insurance) / rate, 4) : null;
      const quoted = num(input.quotes[quoteKey(p.key, groupId)]);
      const delta = quoted != null && calc != null ? round(quoted - calc, 4) : null;
      const deltaPct = delta != null && calc ? round((delta / calc) * 100, 2) : null;
      return {
        pieceKey: p.key,
        groupId,
        fabric,
        cmt,
        process,
        trims,
        other,
        net,
        margin,
        wastage,
        overhead,
        discount,
        grossCost,
        gross,
        calc,
        quoted,
        delta,
        deltaPct,
        effectiveMarginPct: effectiveMargin(quoted ?? calc, net, wastage + overhead, discount, freight, insurance, rate),
      };
    });

    const sum = (
      k: "fabric" | "cmt" | "process" | "trims" | "other" | "net" | "margin" | "wastage" | "overhead" | "discount" | "grossCost" | "gross",
    ) =>
      round(pieces.reduce((s, x) => s + x[k], 0), 4);
    const calc = sumOrNull(pieces.map((x) => x.calc));
    const quoted = sumOrNull(pieces.map((x) => x.quoted));
    const delta = quoted != null && calc != null ? round(quoted - calc, 4) : null;
    const net = sum("net");
    const wastage = sum("wastage");
    const overhead = sum("overhead");
    const discount = sum("discount");
    const n = pieces.length;
    return {
      groupId,
      pieces,
      total: {
        fabric: sum("fabric"),
        cmt: sum("cmt"),
        process: sum("process"),
        trims: sum("trims"),
        other: sum("other"),
        net,
        margin: sum("margin"),
        wastage,
        overhead,
        discount,
        grossCost: sum("grossCost"),
        gross: sum("gross"),
        calc,
        quoted,
        delta,
        deltaPct: delta != null && calc ? round((delta / calc) * 100, 2) : null,
        // Freight and insurance are per PIECE, so a set carries them n times.
        effectiveMarginPct: effectiveMargin(quoted ?? calc, net, wastage + overhead, discount, freight * n, insurance * n, rate),
      },
    };
  });

  const margins = groups.flatMap((g) => g.pieces.map((p) => p.effectiveMarginPct)).filter((m): m is number => m != null);
  const lowestMarginPct = margins.length ? Math.min(...margins) : null;
  return {
    groups,
    lowestMarginPct,
    belowFloor: lowestMarginPct != null && lowestMarginPct < MARGIN_FLOOR_PCT,
  };
}

// ---------------------------------------------------------------------------
// WORK BACK FROM THE BUYER'S TARGET (UX plan P2.4). The buyer names a price
// first; this answers "what margin does it leave, and how much cost has to
// come out to reach the floor?" — read-only, it never edits a figure.
// ---------------------------------------------------------------------------
/** KG of fabric one piece (or set) consumes in a size group, allowance included. */
export function fabricKgFor(weights: readonly WeightInput[], groupId: string | null): number {
  return round(
    weights
      .filter((w) => w.size_group_id == null || w.size_group_id === groupId)
      .reduce((t, w) => t + ((gramsOf(w) ?? 0) * (1 + z(w.wastage_pct) / 100)) / 1000, 0),
    4,
  );
}

export type TargetSolve = {
  /** The margin the target price leaves, % of net. */
  marginPct: number;
  clearsFloor: boolean;
  /** ₹ of net cost per piece / set to remove to reach MARGIN_FLOOR_PCT; 0 when it clears. */
  costCut: number;
  /** The same cut expressed on the fabric, ₹ per KG; null without fabric. */
  perKgFabric: number | null;
};

/**
 * `total` is a group's (or a set's) figures, `pieces` how many garment pieces
 * the price covers (freight and insurance are per piece).
 *
 *   target INR      = target × rate − freight × n − insurance × n
 *   margin %        = (target INR − net − wastage − overhead + discount) ÷ net
 *   net that clears = target INR ÷ (1 + wastage% + overhead% − discount% + floor%)
 *   cost cut        = net − net that clears
 */
export function solveTarget(
  total: { net: number },
  terms: TermsInput,
  target: number,
  pieces: number,
  fabricKg: number,
): TargetSolve | null {
  const rate = num(terms.exchange_rate);
  if (rate == null || rate <= 0 || total.net <= 0 || !(target > 0)) return null;
  const n = Math.max(1, pieces);
  const targetInr = target * rate - z(terms.freight_per_pc) * n - z(terms.insurance_per_pc) * n;
  const w = z(terms.garment_waste_pct) / 100;
  const o = z(terms.overhead_pct) / 100;
  const d = z(terms.discount_pct) / 100;
  const marginPct = round(((targetInr - total.net * (1 + w + o - d)) / total.net) * 100, 2);
  const netThatClears = targetInr / (1 + w + o - d + MARGIN_FLOOR_PCT / 100);
  const costCut = round(Math.max(0, total.net - netThatClears), 2);
  return {
    marginPct,
    clearsFloor: marginPct >= MARGIN_FLOOR_PCT,
    costCut,
    perKgFabric: fabricKg > 0 ? round(costCut / fabricKg, 2) : null,
  };
}
