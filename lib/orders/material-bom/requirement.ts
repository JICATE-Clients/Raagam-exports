/**
 * Material BOM — how much of a material an order needs.
 *
 *     Total Material Required = SKU Quantity x (Number of Items / Number of Pieces)
 *
 * Client spec: 2 labels per piece on 600 pieces is 1,200 labels; 1 metre that
 * makes 4 pieces divides the total by 4. Plus a per-line Wastage %, and an
 * Attribute that decides how the requirement SPLITS — one bulk figure for the
 * order, one row per colour, or one row per size.
 *
 * "SKU Quantity" is the production target: order qty + excess + approval pieces
 * + rejection allowance. That already exists as `productionTarget()` in
 * `../amendments/approval-qty.ts` and is NEVER recomputed here. A second excess
 * calculation is how two screens start reporting different quantities for one
 * order — `doc/orders-six-step.md` says so explicitly about this very step.
 *
 * Client-safe (no `server-only`) for the reason `approval-qty.ts` and
 * `order-value.ts` are: the figures recalculate as the operator types, so they
 * run in the browser — and the server action computes the STORED requirement
 * from these same functions, which is what stops the number the operator
 * approved and the number a purchase order is checked against from being
 * derived twice.
 *
 * ## NULL IS AN ANSWER. 0 IS NOT.
 *
 * The rule `order-value.ts` records for money applies here with the same force,
 * because this number is spent: a requirement of 0 renders as "none needed",
 * which is the one answer a material requirement never intends. Every branch
 * that cannot answer returns a `Refusal` carrying the SENTENCE the screen
 * prints, so the operator learns which tab to go and fix.
 *
 * ## A PARTIAL EXPLOSION IS THE DANGEROUS ONE
 *
 * If one colour of a three-colour order has no quantity, emitting two rows
 * instead of three produces a smaller total that looks exactly like a correct
 * answer. So a set disagreement between the Combos tab and the Approval Qty tab
 * poisons the WHOLE explosion rather than being quietly dropped from it — the
 * same call `styleRate` makes for a priced style with no quantity behind it.
 */

import { productionTarget, type ApprovalLine } from "@/lib/orders/amendments/approval-qty";
import { styleKey } from "@/lib/orders/amendments/style-key";
import { ceilToPrecision, uomPrecision } from "@/lib/uom/convert";
import type { RejectionTier } from "@/lib/masters/rejection-rule";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * How a material's requirement splits.
 *
 * LOWERCASE, and stored in a CHECKed text column rather than pointed at
 * `config_lookups`. The Attribute picker that used to sit in this cell reads
 * kind `material_attribute`, whose entire live content is one hand-typed row
 * ("STYLE") that no migration ever seeded — so a switch on it resolves to "no
 * basis" for every row, leaving the feature inert and looking configured. And a
 * lookup name is operator-editable and stored in CAPITALS, so `=== "Color-wise"`
 * compiles, runs and quietly matches nothing, which is the failure AGENTS.md
 * records under Nominated vendors. Lowercase matches this schema's own idiom
 * (`ratio_for in ('master','inner')`, 0414).
 *
 * ## `size` AND `combination` ARE NOT THE SAME SPLIT, and conflating them is a
 * ## bug this module shipped once
 *
 * A SIZE LABEL DOES NOT CARE WHAT COLOUR THE SHIRT IS. Size-wise must give one
 * row per size — every Medium garment across every colourway — because that is
 * the number of Medium labels to buy. Emitting `WHITE · M` and `NAVY · M`
 * separately is the COMBINATION split wearing the wrong name: it doubles the row
 * count and asks the operator to reconcile two numbers that are only ever added
 * back together.
 *
 * Combination is the genuine matrix, for a trim that varies along BOTH axes —
 * the size label printed in the garment's own colour. It is the only basis whose
 * row identifies a single SKU.
 */
export const REQUIREMENT_BASES = ["order", "colour", "size", "combination"] as const;
export type RequirementBasis = (typeof REQUIREMENT_BASES)[number];

/** What the screen prints when a figure cannot be produced. Never an empty
 *  string: a blank cell and a refused cell must not look alike. */
export type Refusal = { refused: string };

export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && typeof (v as Refusal).refused === "string";
}

/**
 * One row the requirement explodes into.
 *
 * KEYED BY STYLE AND COMBO, never combo alone. WHITE can exist under two styles
 * with different targets, and collapsing them would let one style's white absorb
 * the other's — a wrong number with nothing on screen saying two things were
 * merged.
 */
export type ProductionSlice = {
  key: string;
  label: string;
  qty: number;
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
};

/** An Approval Qty row, as much of it as the requirement needs. */
export type ApprovalRow = {
  style_ref_no: string | null;
  combo: string | null;
  qty: number;
  approval_qty: number;
};

/** A Combos-tab row. Present so a colour with no quantity can be NAMED. */
export type ComboRow = { style_ref_no: string | null; combo: string | null };

/**
 * One (style, combo, size) quantity off the Quantities tab's Assort tree (0414).
 *
 * Flattened by the caller — `no_of_cartons x that size's pieces` — exactly as
 * `ValuedQty` is in `order-value.ts`: the tree shape is the screen's business
 * and this module needs three keys and a number.
 *
 * READ AS A RATIO, NEVER AS ABSOLUTE PIECES — see `productionSlices`.
 */
export type AssortSizeRow = {
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  qty: number;
};

/** Everything about the ORDER the requirement depends on. */
export type OrderProductionInput = {
  /** The order header's Excess %, applied per approval line. */
  excessPct: number;
  /** Whether a Garment Rejection Rule was named on the order (0413). */
  rejectionRuleChosen: boolean;
  tiers: readonly RejectionTier[] | null | undefined;
  approvals: readonly ApprovalRow[];
  combos: readonly ComboRow[];
  assortSizes: readonly AssortSizeRow[];
  /** Resolves a size id to what the operator calls it. */
  sizeName?: (id: string) => string;
};

/** A BOM line, as much of it as the requirement needs. */
export type BomLineInput = {
  /** "Number of Items" — how many are used. The NUMERATOR. */
  no_of_items: number | null;
  /** "Number of Pieces" — how many garments they cover. The DIVISOR. */
  per_pieces: number | null;
  /** The line's own Wastage %. NOT the order's Excess %, which is already
   *  inside the slice quantity. */
  excess_pct: number | null;
  /** `uoms.decimal_places_allowed` of the CONSUMPTION unit. */
  decimals: number | null;
};

/**
 * One panel's share of a line (0436) — the Combination sheet's row, as much of
 * it as the requirement needs.
 *
 * `label` is the caller's, because THIS MODULE IS NAME-BLIND and a refusal has
 * to name the panel it is about. Everything else here resolves ids to names in
 * the screen, so passing the one string a refusal needs is cheaper than teaching
 * the engine the components master.
 */
export type BomLineComponent = {
  component_id: string;
  /** NULL means the line's own Item Color (0436). */
  item_color_id: string | null;
  no_of_items: number | null;
  per_pieces: number | null;
  label?: string | null;
};

/**
 * A LINE'S PANELS, COLLAPSED ONTO THE THING YOU ACTUALLY BUY.
 *
 * You do not buy sleeve-thread and front-thread; you buy thread — so panels of
 * the SAME colour sum into one rate and vanish. You do buy white thread and navy
 * thread separately, so each distinct colour survives as its own split and
 * becomes its own requirement row. That boundary is 0436's whole design, and it
 * is why a component never reaches `material_bom_amendment_requirements` while a
 * colour now does.
 *
 * The summed rate is expressed as items per ONE piece, so a split can be handed
 * straight to `requirementFor` with `per_pieces: 1`. Two front/2-per and
 * sleeve/1-per-2 become 2 + 0.5 = 2.5 per garment, which is the number a cone is
 * bought against — the panels are how it was ARRIVED at, not how it is ordered.
 *
 * AN EMPTY ARRAY IS NOT A REFUSAL, and callers must not treat it as one: a line
 * with no panels is the ordinary line, and its own ratio applies. 0436 is opt-in
 * per line precisely so that stays true.
 */
export type ColourSplit = {
  /** NULL means the line's own Item Color — resolved by the caller, which is
   *  also the only layer that can name a colour. */
  item_color_id: string | null;
  /** Which panels fed this rate. For the screen's summary; never arithmetic. */
  component_ids: string[];
  /** The panels' rates SUMMED, over one piece. */
  no_of_items: number;
  per_pieces: 1;
};

export function colourSplits(
  lineColourId: string | null,
  components: readonly BomLineComponent[],
): ColourSplit[] | Refusal {
  if (components.length === 0) return [];

  // Insertion-ordered, so the sheet's row order is the requirement's row order.
  // A Map keyed by the resolved colour is what merges two panels of one colour.
  const byColour = new Map<string, ColourSplit>();

  for (const c of components) {
    const items = num(c.no_of_items);
    const pieces = num(c.per_pieces);
    const who = (c.label ?? "").trim() || "A panel";

    // The same two guards `requirementFor` applies to a line, applied one level
    // down — because a bad panel would otherwise be summed into a rate that
    // looks entirely reasonable, and the refusal would name the LINE. `x / 0` is
    // Infinity in JS rather than a throw, which is how it would escape.
    if (items == null || items < 0) {
      return { refused: `${who}: enter how many are used` };
    }
    if (pieces == null || pieces <= 0) {
      return { refused: `${who}: pieces must be more than 0` };
    }

    const colour = c.item_color_id ?? lineColourId ?? null;
    const key = colour ?? "";
    const at = byColour.get(key);
    if (at) {
      at.no_of_items += items / pieces;
      at.component_ids.push(c.component_id);
    } else {
      byColour.set(key, {
        item_color_id: colour,
        component_ids: [c.component_id],
        no_of_items: items / pieces,
        per_pieces: 1,
      });
    }
  }

  return [...byColour.values()];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const comboKey = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/** Joins the two halves of a colour key. A control character, so a style or
 *  combo containing the separator cannot forge another pair's key. */
const SEP = "\u0000";
const pairKey = (style: string, combo: string) => `${style}${SEP}${combo}`;

/**
 * Normalise a stored basis, refusing anything unrecognised.
 *
 * EMPTY-AND-EXPLAIN, NEVER A FALLBACK TO 'order'. A silent fallback makes the
 * Attribute advisory and the operator never learns it needs filling in — the
 * lesson the nominated-vendor rule records twice.
 */
export function basisOf(v: string | null | undefined): RequirementBasis | Refusal {
  const k = (v ?? "").trim().toLowerCase();
  return (REQUIREMENT_BASES as readonly string[]).includes(k)
    ? (k as RequirementBasis)
    : { refused: "Choose how this material splits" };
}

// ---------------------------------------------------------------------------
// Apportionment
// ---------------------------------------------------------------------------

/**
 * Split `total` across `weights` so the parts sum to EXACTLY `total`.
 *
 * Largest remainder: floor every share, then hand the leftover pieces to the
 * largest fractional parts, ties going to the earlier size so the result is
 * stable across renders.
 *
 * WHY NOT CEIL EACH SHARE, which is what every other rounding in this feature
 * does: ceiling per size inflates the total by up to one piece per size, and
 * this number is the ceiling a quantity controller enforces. A control that
 * quietly raises its own limit is not a control. The upward rounding that
 * matters has already happened — in `excessQty` and `rejectionFor`, on the
 * target being split here.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const w = weights.map((x) => Math.max(num(x) ?? 0, 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return w.map(() => 0);

  const exact = w.map((x) => (total * x) / sum);
  const base = exact.map((x) => Math.floor(x));
  let left = Math.round(total - base.reduce((a, b) => a + b, 0));

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i] += 1;
  return base;
}

// ---------------------------------------------------------------------------
// The slices
// ---------------------------------------------------------------------------

type Target = { style: string; combo: string; qty: number };

/** Every approval line resolved to a production target, or the first refusal. */
function targetsOf(order: OrderProductionInput): Target[] | Refusal {
  if (order.approvals.length === 0) {
    return { refused: "No production quantity yet — fill Approval Qty on the order" };
  }

  const out: Target[] = [];
  for (const a of order.approvals) {
    const line: ApprovalLine = {
      qty: num(a.qty) ?? 0,
      approvalQty: num(a.approval_qty) ?? 0,
    };
    const t = productionTarget(
      line,
      num(order.excessPct) ?? 0,
      order.tiers,
      order.rejectionRuleChosen,
    );
    if (t.qty == null) {
      return {
        refused: `Rejection rule has no tier for ${line.qty} pieces — fix the rule or clear it on the order`,
      };
    }
    out.push({ style: styleKey(a.style_ref_no), combo: comboKey(a.combo), qty: t.qty });
  }

  // Rows exist but every one is blank. Distinct from "no rows at all", and it is
  // the state a freshly seeded Approval Qty grid is in — so it must say so
  // rather than hand back a requirement of 0 on a real order.
  if (out.every((t) => t.qty <= 0)) {
    return { refused: "Approval Qty rows have no quantity" };
  }
  return out;
}

/**
 * The rows a material's requirement explodes into.
 *
 * ## Size is a RATIO, not a list of absolute quantities
 *
 * `garment_order_amendment_assort_lines` hangs off
 * `garment_order_amendment_quantities`, which breaks an order down by COUNTRY
 * and CONSIGNEE. A partially-entered assortment is therefore normal, not an
 * error — an order shipping to two countries with one entered is a perfectly
 * ordinary mid-entry state. Reading those numbers as absolute pieces would
 * silently buy material for half the order.
 *
 * So the assortment supplies PROPORTIONS, and each combo's own production target
 * is apportioned across them. That keeps the invariant the vectors assert: the
 * size rows sum to the colour rows sum to the order row.
 *
 * Apportioning per COMBO rather than once over the whole order matters — two
 * colourways rarely carry the same size curve, and a global ratio would move
 * pieces between them.
 */
export function productionSlices(
  basis: RequirementBasis,
  order: OrderProductionInput,
): ProductionSlice[] | Refusal {
  const targets = targetsOf(order);
  if (isRefusal(targets)) return targets;

  if (basis === "order") {
    return [
      {
        key: "",
        label: "Whole order",
        qty: targets.reduce((a, t) => a + t.qty, 0),
        style_ref_no: null,
        combo: null,
        size_id: null,
      },
    ];
  }

  // Both remaining bases split by colour, so both need the two tabs to agree.
  const declared = new Set(
    order.combos.map((c) => pairKey(styleKey(c.style_ref_no), comboKey(c.combo))),
  );
  if (declared.size === 0) return { refused: "This order has no combos to split by" };

  const targeted = new Set(targets.map((t) => pairKey(t.style, t.combo)));

  // A colour the order DECLARES but does not quantify. Emitting the others
  // yields a smaller total that reads as correct, so the whole explosion stops
  // and names the colour.
  for (const c of order.combos) {
    if (!targeted.has(pairKey(styleKey(c.style_ref_no), comboKey(c.combo)))) {
      return { refused: `Combo ${c.combo ?? "(blank)"} has no quantity on Approval Qty` };
    }
  }
  // And the reverse: a quantity for a colour the Combos tab no longer lists,
  // which is what a rename leaves behind. The tabs disagree; picking either
  // silently is the failure.
  for (const t of targets) {
    if (!declared.has(pairKey(t.style, t.combo))) {
      return { refused: `Combo ${t.combo || "(blank)"} is not on the Combos tab` };
    }
  }

  const multiStyle = new Set(targets.map((t) => t.style)).size > 1;
  const labelFor = (t: Target) =>
    multiStyle ? `${t.style} · ${t.combo || "(blank)"}` : t.combo || "(blank)";

  if (basis === "colour") {
    return targets.map((t) => ({
      key: pairKey(t.style, t.combo),
      label: labelFor(t),
      qty: t.qty,
      style_ref_no: t.style || null,
      combo: t.combo || null,
      size_id: null,
    }));
  }

  // ---- size / combination ----
  //
  // Both walk the same apportionment and differ only in whether the colour
  // survives into the slice. Sharing the walk is deliberate: two copies would be
  // two places for the size curve to be read differently, and "every basis sums
  // to the same total" is the invariant the vectors lean on hardest.
  if (order.assortSizes.length === 0) {
    return { refused: "Size break-up not entered on Quantities ▸ Assort" };
  }

  const matrix: ProductionSlice[] = [];
  for (const t of targets) {
    const rows = order.assortSizes.filter(
      (r) => styleKey(r.style_ref_no) === t.style && comboKey(r.combo) === t.combo,
    );
    if (rows.length === 0) {
      return {
        refused: `Size break-up not entered on Quantities ▸ Assort for ${labelFor(t)}`,
      };
    }

    // Collapse repeats first: one combo can appear on several assort lines (one
    // per carton set), and the ratio is the sum across them.
    const bySize = new Map<string, number>();
    for (const r of rows) {
      if (!r.size_id) continue;
      bySize.set(r.size_id, (bySize.get(r.size_id) ?? 0) + (num(r.qty) ?? 0));
    }
    const sizes = [...bySize.entries()];
    if (sizes.length === 0 || sizes.every(([, q]) => q <= 0)) {
      return { refused: `Size break-up has no quantities for ${labelFor(t)}` };
    }

    const shares = apportion(
      t.qty,
      sizes.map(([, q]) => q),
    );
    sizes.forEach(([sizeId], i) => {
      const name = order.sizeName?.(sizeId) ?? sizeId;
      matrix.push({
        key: `${pairKey(t.style, t.combo)}${SEP}${sizeId}`,
        label: multiStyle ? `${labelFor(t)} · ${name}` : `${t.combo || "(blank)"} · ${name}`,
        qty: shares[i],
        style_ref_no: t.style || null,
        combo: t.combo || null,
        size_id: sizeId,
      });
    });
  }

  if (basis === "combination") return matrix;

  // SIZE-WISE COLLAPSES THE COLOUR AXIS. The matrix is apportioned per combo
  // FIRST — which is what preserves each colourway's own size curve — and only
  // then summed by size, so the totals still agree with the colour and order
  // bases. Summing before apportioning would blend two different curves into one.
  //
  // The STYLE is kept only where the order has one. A size label is bought per
  // size across the whole order, and a row keyed to a style the operator did not
  // ask to split by would imply a division that was never requested.
  const bySizeAcrossCombos = new Map<string, { qty: number; label: string }>();
  for (const m of matrix) {
    const id = m.size_id as string;
    const prev = bySizeAcrossCombos.get(id);
    bySizeAcrossCombos.set(id, {
      qty: (prev?.qty ?? 0) + m.qty,
      label: order.sizeName?.(id) ?? id,
    });
  }

  const onlyStyle = multiStyle ? null : (targets[0]?.style || null);
  return [...bySizeAcrossCombos.entries()].map(([sizeId, v]) => ({
    key: `${SEP}${sizeId}`,
    label: v.label,
    qty: v.qty,
    style_ref_no: onlyStyle,
    combo: null,
    size_id: sizeId,
  }));
}

// ---------------------------------------------------------------------------
// The requirement
// ---------------------------------------------------------------------------

/**
 * One slice's requirement, in the CONSUMPTION unit.
 *
 *     ceilToPrecision(qty x (no_of_items / per_pieces) x (1 + wastage/100), dp)
 *
 * `excess_pct` here is the BOM's own WASTAGE and multiplies the MATERIAL figure,
 * never the pieces. The order's Excess % is a different number and is already
 * inside `slice.qty`; applying a second percentage to the pieces would compound
 * two buffers invisibly. The UI labels this column "Wastage %" for that reason.
 */
export function requirementFor(line: BomLineInput, slice: ProductionSlice): number | Refusal {
  const items = num(line.no_of_items);
  const pieces = num(line.per_pieces);
  const wastage = num(line.excess_pct) ?? 0;

  // 0 is not "no material needed" — every grid opens on a blank row and a
  // half-filled one carries 0. Same call `styleRate` makes for a price of 0.
  if (items == null || items <= 0) return { refused: "Enter how many are used per piece" };

  // `x / 0` is Infinity in JS, not a throw, so an unguarded divisor escapes into
  // the UI as an ordinary-looking number — `conversionFactor`'s stated reason.
  if (pieces == null || pieces <= 0) return { refused: "Pieces must be more than 0" };

  if (wastage < 0 || wastage > 100) return { refused: "Wastage must be between 0 and 100" };

  const qty = num(slice.qty) ?? 0;
  return ceilToPrecision(
    ((qty * items) / pieces) * (1 + wastage / 100),
    uomPrecision(line.decimals),
  );
}

/**
 * MOQ, applied to the ITEM'S TOTAL — never to a requirement row.
 *
 * THIS IS THE ONE THAT LOOKS LIKE A DETAIL AND BUYS SIX TIMES TOO MUCH. A
 * colour-wise explosion makes six rows for one material; an MOQ of 500 applied
 * per row orders 3,000 of something the order needs 100 of. The supplier's
 * minimum is a minimum per ORDER, so it is a rollup — which is also why `moq`
 * does not appear on the requirement child table at all.
 *
 * `unitKnown` says whether the quantity the MOQ is being compared against has a
 * unit: the purchase quantity where the line names a pack, the requirement
 * otherwise. With neither known, the figure "500" has no unit, and applying it
 * would be the blank-supply-type shape the nominated-vendor rule refuses — so it
 * refuses too.
 */
export function moqRollup(
  quantities: readonly (number | null)[],
  moq: number | null,
  unitKnown: boolean,
): { total: number; afterMoq: number } | Refusal {
  const known = quantities.filter((q): q is number => num(q) != null);
  if (known.length === 0) return { refused: "Nothing to total — every line refused" };
  const total = known.reduce((a, b) => a + b, 0);

  const m = num(moq);
  if (m == null || m <= 0) return { total, afterMoq: total };
  if (!unitKnown) return { refused: "Set a purchase unit before an MOQ can be applied" };
  return { total, afterMoq: Math.max(total, m) };
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

/**
 * A fingerprint of everything the requirement was computed FROM.
 *
 * ## Why a total is not enough, and this is the whole reason the column exists
 *
 * WHITE 300 / NAVY 200 becoming WHITE 200 / NAVY 300 leaves the order total at
 * 500 while every colour-wise requirement row is wrong. A stored
 * `computed_for_qty` compares equal and the screen reports "Updated" over a
 * material plan that no longer matches the order.
 *
 * ## What is and is not in it — four decisions
 *
 * The hash is over the sorted (style, combo, TARGET) triples, and every one of
 * these falls out of that choice rather than being listed separately:
 *
 *  - **A combo's DESCRIPTION is not in it.** It is a label, not a quantity, and
 *    nothing downstream multiplies by it. Flagging Recalculate over a typo fix
 *    trains the operator to ignore the badge, which costs more than it saves.
 *  - **A new combo with qty 0 IS in it.** It adds a colour row to every
 *    colour-wise explosion, so the shape of the plan changed even though the
 *    total did not.
 *  - **A REMOVAL is in it**, because the hash is over the whole sorted list
 *    rather than a running sum — a list that lost an entry hashes differently.
 *  - **Excess % and the rejection rule are in it BY CONSTRUCTION**, since both
 *    move the targets. And a rule swapped for one that happens to produce the
 *    same targets does NOT flag, which is correct: nothing to recompute.
 *
 * A target that cannot be resolved encodes as `?`, so a projection gap opening up
 * is a change rather than a silently equal hash.
 */
export function basisFingerprint(order: OrderProductionInput): string {
  const rows = order.approvals
    .map((a) => {
      const t = productionTarget(
        { qty: num(a.qty) ?? 0, approvalQty: num(a.approval_qty) ?? 0 },
        num(order.excessPct) ?? 0,
        order.tiers,
        order.rejectionRuleChosen,
      );
      return `${styleKey(a.style_ref_no)}|${comboKey(a.combo)}|${t.qty ?? "?"}`;
    })
    .sort();
  return fnv1a64(rows.join("\n"));
}

/**
 * FNV-1a, doubled to 64 bits.
 *
 * Not a cryptographic hash and does not need to be: this value is only ever
 * compared against ANOTHER fingerprint of the SAME order, so a collision between
 * two different orders is meaningless. `crypto.subtle` was the alternative and
 * is async, which would make every list row await a digest.
 */
function fnv1a64(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Total production across the whole order — the figure shown beside the hash so
 *  an operator can read WHAT it was computed for, not just whether it moved. */
export function totalProductionOf(order: OrderProductionInput): number | Refusal {
  const targets = targetsOf(order);
  if (isRefusal(targets)) return targets;
  return targets.reduce((a, t) => a + t.qty, 0);
}
