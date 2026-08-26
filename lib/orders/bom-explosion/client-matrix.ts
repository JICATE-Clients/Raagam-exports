/**
 * THE CLIENT'S 22-ROW ATTRIBUTE LIST, mapped onto the axis sets this engine
 * actually produces.
 *
 * ## WHY THIS FILE EXISTS
 *
 * The client hands over a numbered list of Attribute options; the screen offers
 * `producibleGrains()`; and until now NOTHING related the two. So the same
 * conversation kept happening — "we missed adding these" — and it could only be
 * answered by re-deriving the mapping by hand, which is how a row gets declared
 * missing when it is really the same grain under a different name (#1 "Order No"
 * IS "Whole order") or declared present when it cannot be built at all (#19
 * "Pack Ref No" has no column anywhere).
 *
 * The table below is that mapping, written down once and ASSERTED by
 * `check-bom-explosion.mts`, so "which of the client's rows do we serve?" is a
 * question you answer by running a script rather than by reading a chat log.
 *
 * ## EVERY ROW IS SELECTABLE (client, 2026-08-26: "enable all")
 *
 * Thirteen produce rows. NINE REFUSE, and they are offered anyway, because the
 * engine's contract is empty-and-explain: `slicesForAxes` refuses each with a
 * sentence naming what to go and fix, and the Requirement section prints it. An
 * operator who picks "Pack Ref No" is told the order carries no packing
 * reference — more use than an option they can neither click nor ask about.
 * Asserted: every refusing row must REFUSE rather than quietly return rows.
 *
 * ## IT DECLARES NO NEW AXIS AND NO NEW PLAN
 *
 * Every `axes` value uses axes `AXES` already defines, and nothing here adds a
 * capability — it names what the client asked for in terms the engine can answer
 * one way or the other.
 *
 * ## THE FIVE "COMBINATION" ROWS PRODUCE, AND DO NOT DIVIDE
 *
 * They were first written down here as blocked, and that was WRONG — corrected
 * the same day against `check-bom-explosion`, which already asserted the real
 * rule: *"trim_colour does not divide the order ... so it produces the same
 * rows"*. `orderAxesOf` strips the token and `colourSplits` applies the panels
 * per BOM LINE, because dividing at both levels would divide the trim colour
 * twice. See `downstream` on the row type for what that costs.
 *
 * ## THE NINTH GRAIN IS NOT IN THE CLIENT'S LIST AND IS KEPT ANYWAY
 *
 * `{style_ref, colour, size, country}` — the old matrix's #16 — is built,
 * vectored and serving, and the 22-row list omits it. The client confirmed on
 * 2026-08-26 that the omission is a typo and the grain STAYS. `EXTRA_SERVED`
 * below records that, and the vectors assert it, so a later tidy-up that makes
 * the dropdown match the client's list cannot quietly delete a working grain.
 */

import type { Axis } from "@/lib/orders/bom-explosion/exploder";

/**
 * Why a client row cannot be produced. Codes, not free text, so a reason cannot
 * be reworded into disagreement with the one beside it — the same argument
 * `AXIS_LABELS` makes for labels.
 *
 * `combination_downstream` is NOT here. It was, and it was a mistake: those five
 * rows produce. The reason a code was reserved for them is the reason they are
 * easy to get wrong — they look unbuildable because `ORDER_AXES` excludes
 * `trim_colour` — so the correction is recorded in the header rather than left
 * as a silently deleted union member.
 */
export type BlockedReason = "order_no_constant" | "colour_needs_style" | "pack_no_data";

/**
 * The sentence an operator reads. Written in the operator's vocabulary, not the
 * engine's: they have never seen the words "axis", "grain" or "ORDER_AXES", and
 * the column on their screen is called Attribute.
 */
export const BLOCKED_REASONS: Record<BlockedReason, string> = {
  order_no_constant:
    "One BOM covers one order, so Order No cannot split it — this is the whole order",
  colour_needs_style:
    "A colour belongs to a style — the same white under two styles is two different requirements",
  pack_no_data: "Pack Ref No is not on the order yet — there is no packing reference to split by",
};

/**
 * THE SAME REASON, SHORT ENOUGH FOR A DROPDOWN ROW.
 *
 * A second wording of one fact, which this codebase normally refuses — so it is
 * keyed off the SAME `BlockedReason` union rather than written beside it. Adding
 * a code without a short form is a type error, which is what stops the two
 * drifting into disagreement. The long form is what a refusal prints; this is
 * what fits after a label in an option row.
 */
export const BLOCKED_SHORT: Record<BlockedReason, string> = {
  order_no_constant: "one BOM is one order",
  colour_needs_style: "a colour needs its style",
  pack_no_data: "not on the order yet",
};

/** One row of the client's list. */
export type ClientGrainRow = {
  /** The client's own S.No, so a conversation about "#19" resolves here. */
  sno: number;
  /** The client's own words, verbatim — never re-worded to match ours. */
  label: string;
  /** The axes it means. ALWAYS real — `blocked` says whether they can be built,
   *  not whether the row can be expressed. */
  axes: Axis[];
  /** Why the engine cannot produce it, or null when it can. */
  blocked: BlockedReason | null;
  /**
   * TRUE where the row names `trim_colour` — the client's "Combination".
   *
   * These PRODUCE, and they produce the same ORDER rows as the same grain
   * without the token, because `orderAxesOf` strips it and `colourSplits`
   * applies the panels per BOM LINE downstream. That is asserted in
   * `check-bom-explosion` ("trim_colour does not divide the order ... so it
   * produces the same rows") and it is deliberate: dividing at both levels
   * would divide the trim colour twice.
   *
   * So the Attribute records the operator's INTENT and the line does the work.
   * The consequence worth knowing is that "Style / Combination" and "Style"
   * yield identical order rows, differing only in what the stored grain says —
   * five of the client's 22 pair off with five others this way.
   */
  downstream?: boolean;
};

/**
 * THE MAPPING. Verbatim labels on the left, this engine's grains on the right.
 *
 * #16 reads "Country / Country Size" in the client's list. Every other row says
 * "Order Size", there is no size that belongs to a country, and the neighbouring
 * rows make the intent plain — so it is read as Order Size. The client's literal
 * words are preserved in `label` rather than silently corrected, because a typo
 * that gets tidied away is a typo nobody ever confirms.
 *
 * #18 "Pack" and #19 "Pack Ref No" BOTH map to `{pack}`, because the schema has
 * one pack axis and no pack-TYPE axis. They store the same value and refuse
 * identically. Left as two rows because the client's list has two and neither is
 * buildable anyway; if `pack` ever gains data, splitting them is the first job.
 *
 * The five `downstream` rows likewise pair off with five others at ORDER level —
 * #10 "Style / Combination" produces exactly what #6 "Style" produces. The
 * difference is what the stored grain RECORDS, not what the explosion does.
 */
export const CLIENT_GRAIN_MATRIX: ClientGrainRow[] = [
  { sno: 1, label: "Order No", axes: [], blocked: null },
  { sno: 2, label: "Order No / Order Size", axes: ["size"], blocked: null },
  { sno: 3, label: "Order No / Order Color", axes: ["colour"], blocked: "colour_needs_style" },
  { sno: 4, label: "Order No / Order Color / Order Size", axes: ["colour", "size"], blocked: "colour_needs_style" },
  { sno: 5, label: "Order No / Combination", axes: ["trim_colour"], blocked: null, downstream: true },
  { sno: 6, label: "Style", axes: ["style_ref"], blocked: null },
  { sno: 7, label: "Style / Order Color", axes: ["style_ref", "colour"], blocked: null },
  { sno: 8, label: "Style / Order Size", axes: ["style_ref", "size"], blocked: null },
  { sno: 9, label: "Style / Order Color / Order Size", axes: ["style_ref", "colour", "size"], blocked: null },
  { sno: 10, label: "Style / Combination", axes: ["style_ref", "trim_colour"], blocked: null, downstream: true },
  { sno: 11, label: "Style / Combination / Order Color", axes: ["style_ref", "colour", "trim_colour"], blocked: null, downstream: true },
  { sno: 12, label: "Style / Combination / Order Size", axes: ["style_ref", "size", "trim_colour"], blocked: null, downstream: true },
  { sno: 13, label: "Style / Combination / Order Color / Order Size", axes: ["style_ref", "colour", "size", "trim_colour"], blocked: null, downstream: true },
  { sno: 14, label: "Country", axes: ["country"], blocked: null },
  { sno: 15, label: "Country / Order Color", axes: ["colour", "country"], blocked: "colour_needs_style" },
  { sno: 16, label: "Country / Country Size", axes: ["size", "country"], blocked: null },
  { sno: 17, label: "Country / Order Color / Order Size", axes: ["colour", "size", "country"], blocked: "colour_needs_style" },
  { sno: 18, label: "Pack", axes: ["pack"], blocked: "pack_no_data" },
  { sno: 19, label: "Pack Ref No", axes: ["pack"], blocked: "pack_no_data" },
  { sno: 20, label: "Pack Ref No / Order Color", axes: ["colour", "pack"], blocked: "pack_no_data" },
  { sno: 21, label: "Pack Ref No / Order Size", axes: ["size", "pack"], blocked: "pack_no_data" },
  { sno: 22, label: "Pack Ref No / Order Color / Order Size", axes: ["colour", "size", "pack"], blocked: "pack_no_data" },
];

/**
 * GRAINS THE ENGINE SERVES THAT THE CLIENT'S LIST DOES NOT NAME.
 *
 * Retained by explicit client decision (2026-08-26). Listed rather than left
 * implicit so the vectors can assert that `producibleGrains()` is exactly the
 * matrix's served rows PLUS these — which is what makes a silent deletion fail
 * a check instead of a purchase order.
 */
export const EXTRA_SERVED: { axes: Axis[]; why: string }[] = [
  {
    axes: ["style_ref", "colour", "size", "country"],
    why: "The old matrix's #16. Omitted from the 22-row list by mistake, kept by client decision 2026-08-26 — it is built, vectored and serving.",
  },
];

/** The rows the engine can actually build. Keyed off `blocked`, never off
 *  `axes` — every row has axes now, and reading the wrong field is how this
 *  would silently report all 22 as producible. */
export function servedRows(): ClientGrainRow[] {
  return CLIENT_GRAIN_MATRIX.filter((r) => r.blocked === null);
}

/** The rows it will refuse, each with the reason this module records. */
export function blockedRows(): (ClientGrainRow & { reason: string })[] {
  return CLIENT_GRAIN_MATRIX.filter((r) => r.blocked !== null).map((r) => ({
    ...r,
    reason: BLOCKED_REASONS[r.blocked as BlockedReason],
  }));
}

/**
 * THE ONE OPERATOR-FACING NAME FOR A GRAIN (client, 2026-08-26: drop the
 * brackets, "standardise both the select dropdown and the read-only Attribute
 * cell to render a single, clean, operator-facing name").
 *
 * The menu briefly showed both names — "Order No (Whole order)" — so that the
 * dropdown and the read-only cell could not disagree while one used the client's
 * words and the other used `labelFor`. That fixed the disagreement by printing
 * it, and on the four-token rows it ran to 60 characters inside a grid cell.
 *
 * So the two are standardised on the CLIENT'S name instead, and this is the one
 * function that resolves it. `labelFor` is deliberately NOT changed: it is the
 * ENGINE's naming, it appears inside refusal sentences ("Style Ref No / Country
 * is not a split this order can be exploded by yet"), and several vectors assert
 * those strings exactly. Two names for two audiences, one lookup each, neither
 * guessing at the other.
 *
 * FALLS BACK to `labelFor` for a grain the client's list does not name — the
 * ninth grain, and any stored value from before this table. Never blank: a grain
 * with no name would render an empty Attribute cell on a line that has answered.
 *
 * ## IT IS FOR A STORED GRAIN, NOT FOR THE MENU
 *
 * The menu iterates the matrix and prints each row's OWN `label`, because two
 * rows can share one axis set: #18 "Pack" and #19 "Pack Ref No" are both
 * `{pack}`, so resolving the menu through here would print "Pack" twice and lose
 * "Pack Ref No" entirely. Caught by probe rather than by reading.
 *
 * The same collision has one unavoidable consequence in the other direction: a
 * STORED `{pack}` reads back as "Pack", whichever of the two was picked. That is
 * as good as it gets while the schema has one pack axis, it costs nothing today
 * (both refuse, so neither can reach a saved requirement), and splitting them is
 * the first job if `pack` ever gains data.
 */
export function clientLabelFor(axes: readonly Axis[], labelFor: (a: readonly Axis[]) => string): string {
  const key = [...axes].sort().join("+");
  const hit = CLIENT_GRAIN_MATRIX.find((r) => [...r.axes].sort().join("+") === key);
  return hit ? hit.label : labelFor(axes);
}
