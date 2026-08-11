/**
 * "Which styles may this order line name?" — the Style picker's option list.
 *
 * Client requirement: "Once a customer and season are selected, the Style field
 * should only list relevant styles from the Style Master." The Style master runs
 * to every style the business has ever made, and an operator entering a PO for
 * one buyer's Spring range should not be scrolling past their Winter one.
 *
 * **HALF OF THAT REQUIREMENT IS BUILT. THE CUSTOMER HALF IS BLOCKED ON SCHEMA,
 * NOT ON EFFORT** — see "Why there is no customer filter" below, which is the
 * more important half of this comment.
 *
 * Client-safe on purpose (no `server-only`, the same shape as
 * `lib/masters/vendor-nominations.ts`, which this module is modelled on): the
 * rule runs in the browser inside the picker, so the list narrows as the
 * operator changes the header. The server half is `getStyleRows()` in
 * `service.ts`, which is where the Supabase client already is.
 *
 * ## The rule, stated positively
 *
 * A style is OFFERED unless it is KNOWN to be for a different season.
 *
 * That phrasing is the whole design and it is deliberate. The tempting version —
 * "when a season is picked, keep only styles whose season matches" — reads as
 * stricter and is simply wrong, because `garment_styles.season` is nullable and
 * most existing styles have none. Plain equality would empty the picker the
 * moment a season was chosen, on a screen that worked the day before. A NULL
 * means UNASSIGNED, not "belongs to another season", and an unassigned style is
 * a legitimate answer for any season. Likewise a blank season on the ORDER
 * narrows nothing rather than everything.
 *
 * AGENTS.md records the matching trap under "Nominated vendors" — a guard
 * phrased as "restrict only in case X" leaks through every state that is not X.
 * This is that lesson applied to the inverse mistake: restricting on a
 * comparison that one side cannot answer.
 *
 * ## Season is text, not an FK
 *
 * `garment_styles.season` is plain `text` (0124). The two screens happen to
 * offer the same four words from two SEPARATE literals — `SEASON_OPTIONS` exists
 * in both `lib/orders/styles/types.ts` and `lib/orders/amendments/types.ts` —
 * and nothing keeps those in step; the column has also always accepted imported
 * free text. So it is compared trimmed and case-folded, the way `norm` in
 * `diff.ts` already compares every other text key on this screen. A stored
 * "SS26" against a typed "ss26" must match, or the filter compiles, runs and
 * quietly matches nothing.
 *
 * ## Why there is no customer filter
 *
 * NOT AN OVERSIGHT, AND NOT SOMETHING TO "FINISH" WITHOUT FIXING THE DATA FIRST.
 *
 *   - `garment_styles.customer_id` → **`customers`** (0124).
 *   - The order's Customer field holds `buyer_id` → **`buyers`**.
 *   - Two different tables behind one word on screen. The only link is
 *     `buyers.customer_id` (0380), which is NULLABLE and backfilled by nothing.
 *   - Verified against the live database (2026-08-11): **6 buyers exist, ZERO
 *     have `customer_id` set.**
 *
 * So resolving an order's buyer to a customer returns null for every order that
 * exists. A strict filter would show ZERO styles on every order and break the
 * Style(s) tab outright; a lenient one would show ALL styles and be a filter
 * that does nothing while claiming to. **The second is the worse of the two**,
 * because it passes review and the next reader believes it works.
 *
 * `StylePickerRow.customer_id` IS selected and carried, so the data is ready and
 * turning this on is a small edit — but it is a schema/data decision first: link
 * buyers to customers, or point one of the two at the other's table. This is the
 * SECOND client requirement blocked by that same empty bridge; the first is
 * filtering Approved Sample No on the Style screen. One fix unblocks both.
 */
import type { Deactivatable } from "@/lib/masters/inactive";

/** Structural twin of `PickerItem` — declared here so this module owes nothing
 *  to a `"use client"` file and can be imported from either side. */
export type StyleOption = { id: string; code: string | null; name: string } & Deactivatable;

/**
 * A style master row, with the column the filter reads.
 *
 * `customer_id` is deliberately NOT here. It is carried as far as
 * `StylePickerRow` so the data is ready, but a filter input that accepts a value
 * it cannot honestly use is how a dead parameter becomes a live bug later.
 */
export type StyleFilterRow = StyleOption & {
  /** Free text (0124). Null means unassigned, which is never excluded. */
  season: string | null;
};

export type StyleOptionsArgs = {
  /** Every style in the master, inactive rows included. */
  styles: readonly StyleFilterRow[];
  /** The order header's Season, in whatever casing its list uses. */
  season: string | null | undefined;
  /** What this row already holds; never filtered out. See below. */
  currentValue?: string | null;
};

export type StyleOptions = {
  items: StyleOption[];
  /** Rendered beside the field — the reason the list looks like this. */
  hint: string | null;
  /**
   * The same reason in a few words, for the empty box itself.
   *
   * The Style field is a `compact` picker in a ChildGrid cell, so a paragraph
   * beneath it is a second line in a one-line row. Set ONLY when the list came
   * back empty, so a field that does have options keeps its normal
   * "— Select Style —" placeholder. Same rule as `NominatedVendorOptions.shortHint`,
   * and it exists for the same reported reason.
   */
  shortHint: string | null;
};

/** Trimmed and case-folded, exactly as `norm` in `diff.ts` treats every other
 *  text key on this screen. "" for a null, which reads as "unassigned". */
const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/**
 * The option list for ONE row, plus the line to show when there are none.
 *
 * **The style a row already holds always survives** (`currentValue`), even when
 * the rule would exclude it — the header's season edited after the line was
 * saved, or a style since blocked. Dropping it renders a filled field as empty
 * and blanks the FK on the next save: silent data loss dressed up as tidiness
 * (AGENTS.md, "Disabled rows"). `RecordPicker` still greys it and refuses to
 * re-pick it.
 */
export function styleOptions({ styles, season, currentValue }: StyleOptionsArgs): StyleOptions {
  const keep = (
    items: StyleOption[],
    hint: string | null,
    shortHint: string | null = null,
  ): StyleOptions => {
    if (!currentValue || items.some((s) => s.id === currentValue)) {
      return { items, hint, shortHint };
    }
    const held = styles.find((s) => s.id === currentValue);
    // The held style rescues the list, so the box is no longer empty and the
    // short form has nothing to explain — but `hint` stays, because the reason
    // the OTHER styles are missing is still worth saying.
    return held ? { items: [...items, held], hint, shortHint: null } : { items, hint, shortHint };
  };

  const wanted = norm(season);

  // A blank Season on the order narrows nothing. Not "restrict unless blank" —
  // the filter below is simply inert, which is the same statement without a
  // second branch to get wrong.
  const items = styles.filter((s) => !wanted || !norm(s.season) || norm(s.season) === wanted);

  if (items.length) return keep(items, null);

  // Empty, and the reason has to distinguish "nothing matches" from "there is
  // nothing at all" — an operator told "no styles for this season" while the
  // master is empty goes and edits the wrong thing.
  if (!wanted) {
    return keep(
      [],
      "There are no styles in the Style Master yet — add one on Orders ▸ Order Setup ▸ Style.",
      "— No styles yet —",
    );
  }
  return keep(
    [],
    `No styles for this season. Change the header's Season, or set the Season on the style itself.`,
    "— No styles for this season —",
  );
}
