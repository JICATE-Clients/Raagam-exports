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
 * ## IT DECLARES NOTHING NEW, DELIBERATELY
 *
 * Every `axes` value here is a grain the engine ALREADY produces. This file adds
 * no axis, no plan and no schema — mapping is all it does. Four classes of row
 * cannot be served, each blocked by a client ruling rather than by an oversight
 * (2026-08-25 / 2026-08-26), and each carries the reason the operator should be
 * told rather than the generic "not a split this order can be exploded by yet".
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
 * Why a client row cannot be served. Four codes, not free text, so a reason
 * cannot be reworded into disagreement with the one beside it — the same
 * argument `AXIS_LABELS` makes for labels.
 */
export type BlockedReason =
  | "order_no_constant"
  | "combination_downstream"
  | "colour_needs_style"
  | "pack_no_data";

/**
 * The sentence an operator reads. Written in the operator's vocabulary, not the
 * engine's: they have never seen the words "axis", "grain" or "ORDER_AXES", and
 * the column on their screen is called Attribute.
 */
export const BLOCKED_REASONS: Record<BlockedReason, string> = {
  order_no_constant:
    "One BOM covers one order, so Order No cannot split it — this is the whole order",
  combination_downstream:
    "A Combination belongs to the material line, not to the order — set it in the Combination cell",
  colour_needs_style:
    "A colour belongs to a style — the same white under two styles is two different requirements",
  pack_no_data: "Pack Ref No is not on the order yet — there is no packing reference to split by",
};

/** One row of the client's list. */
export type ClientGrainRow = {
  /** The client's own S.No, so a conversation about "#19" resolves here. */
  sno: number;
  /** The client's own words, verbatim — never re-worded to match ours. */
  label: string;
  /** The grain it maps to, or null when nothing can serve it. */
  axes: Axis[] | null;
  /** Why not, when `axes` is null. */
  blocked: BlockedReason | null;
};

/**
 * THE MAPPING. Verbatim labels on the left, this engine's grains on the right.
 *
 * #16 reads "Country / Country Size" in the client's list. Every other row says
 * "Order Size", there is no size that belongs to a country, and the neighbouring
 * rows make the intent plain — so it is read as Order Size. The client's literal
 * words are preserved in `label` rather than silently corrected, because a typo
 * that gets tidied away is a typo nobody ever confirms.
 */
export const CLIENT_GRAIN_MATRIX: ClientGrainRow[] = [
  { sno: 1, label: "Order No", axes: [], blocked: null },
  { sno: 2, label: "Order No / Order Size", axes: ["size"], blocked: null },
  { sno: 3, label: "Order No / Order Color", axes: null, blocked: "colour_needs_style" },
  { sno: 4, label: "Order No / Order Color / Order Size", axes: null, blocked: "colour_needs_style" },
  { sno: 5, label: "Order No / Combination", axes: null, blocked: "combination_downstream" },
  { sno: 6, label: "Style", axes: ["style_ref"], blocked: null },
  { sno: 7, label: "Style / Order Color", axes: ["style_ref", "colour"], blocked: null },
  { sno: 8, label: "Style / Order Size", axes: ["style_ref", "size"], blocked: null },
  { sno: 9, label: "Style / Order Color / Order Size", axes: ["style_ref", "colour", "size"], blocked: null },
  { sno: 10, label: "Style / Combination", axes: null, blocked: "combination_downstream" },
  { sno: 11, label: "Style / Combination / Order Color", axes: null, blocked: "combination_downstream" },
  { sno: 12, label: "Style / Combination / Order Size", axes: null, blocked: "combination_downstream" },
  { sno: 13, label: "Style / Combination / Order Color / Order Size", axes: null, blocked: "combination_downstream" },
  { sno: 14, label: "Country", axes: ["country"], blocked: null },
  { sno: 15, label: "Country / Order Color", axes: null, blocked: "colour_needs_style" },
  { sno: 16, label: "Country / Country Size", axes: ["size", "country"], blocked: null },
  { sno: 17, label: "Country / Order Color / Order Size", axes: null, blocked: "colour_needs_style" },
  { sno: 18, label: "Pack", axes: null, blocked: "pack_no_data" },
  { sno: 19, label: "Pack Ref No", axes: null, blocked: "pack_no_data" },
  { sno: 20, label: "Pack Ref No / Order Color", axes: null, blocked: "pack_no_data" },
  { sno: 21, label: "Pack Ref No / Order Size", axes: null, blocked: "pack_no_data" },
  { sno: 22, label: "Pack Ref No / Order Color / Order Size", axes: null, blocked: "pack_no_data" },
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

/** The rows this engine can actually serve. */
export function servedRows(): ClientGrainRow[] {
  return CLIENT_GRAIN_MATRIX.filter((r) => r.axes !== null);
}

/** The rows it cannot, each with the sentence to show. */
export function blockedRows(): (ClientGrainRow & { reason: string })[] {
  return CLIENT_GRAIN_MATRIX.filter((r) => r.blocked !== null).map((r) => ({
    ...r,
    reason: BLOCKED_REASONS[r.blocked as BlockedReason],
  }));
}
