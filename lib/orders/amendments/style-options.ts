/**
 * NOTHING IMPORTS THIS AS OF 2026-08-25, AND THAT IS NOT AN OVERSIGHT.
 *
 * The Garment Order's Style became MANUAL ENTRY on that date (client: "allow it
 * manual entry now, unwire that style mapping with that field in orderinfo"), so
 * there is no picker left to narrow and its one call site is gone. The file is
 * kept rather than deleted because what it holds is a CLIENT RULE and an account
 * of a schema blocker, not just code: `service.ts` cites it beside the
 * `customer_id` column it selects but does not filter on, and `lib/orders/styles/
 * types.ts` cites it for why the two style vocabularies are allowed to drift.
 * Delete the file and those three comments point at nothing.
 *
 * SO TREAT IT AS DOCUMENTATION UNTIL SOMETHING IMPORTS IT AGAIN. It still
 * type-checks, and its "empty and explain" hints still name the right screens —
 * but nothing renders them today, so fixing the wording here changes nothing an
 * operator sees. If the picker comes back (the customer half is one filled
 * `buyers.customer_id` bridge away from being switchable on), this is what it
 * comes back to.
 *
 * ---
 *
 * "Which styles may this order line name?" — the Style picker's option list.
 *
 * Client requirement: "Once a customer and season are selected, the Style field
 * should only list relevant styles from the Style Master." The Style master runs
 * to every style the business has ever made, and an operator entering a PO for
 * one buyer's Spring range should not be scrolling past their Winter one.
 *
 * **BOTH HALVES ARE BUILT AS OF 2026-08-14.** The customer half was blocked on
 * schema rather than effort for months; 0404 removed the blocker and the client
 * re-stated the requirement as CUSTOMER-FIRST — Customer, then Approved Sample
 * No, then Style. See "The customer filter, and why it took a migration" below.
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
 * ## The customer filter, and why it took a migration
 *
 * KEPT IN FULL, because the reason it was absent is the reason to be careful
 * about how it is switched on — and because "just add the filter" was the wrong
 * answer for four months.
 *
 * Until 0404 the two sides named different tables:
 *
 *   - `garment_styles.customer_id` → **`customers`** (0124).
 *   - The order's Customer field held `buyer_id` → **`buyers`**.
 *   - The only link was `buyers.customer_id` (0380), NULLABLE and backfilled by
 *     nothing. Verified against the live database (2026-08-11): **6 buyers
 *     existed, ZERO had `customer_id` set.**
 *
 * So resolving an order's buyer to a customer returned null for every order that
 * existed. A strict filter would have shown ZERO styles on every order; a lenient
 * one would have shown ALL styles while claiming to narrow. **The second is the
 * worse of the two**, because it passes review and the next reader believes it
 * works — which is exactly why this was left unbuilt rather than half-built.
 *
 * 0404 repointed the Garment Order's party at `customers`. Both sides now key on
 * ONE table, so the comparison is finally meaningful and the filter is live.
 *
 * ## It offers UNASSIGNED styles, and that is not a loophole
 *
 * The rule is the same shape as the season rule above, deliberately: **a style is
 * offered unless it is KNOWN to belong to a different customer.** A style with a
 * NULL `customer_id` is unassigned, not "someone else's", so it stays on offer.
 *
 * The client's wording is stricter — "only list styles previously linked to that
 * customer" — and taken literally it would hide every style entered before
 * Customer became mandatory on the Style master. Those rows are exactly the ones
 * an operator reaches for while the new master is still filling up, and a picker
 * that silently drops them reads as data loss. The strict reading arrives on its
 * own as the nulls disappear; nothing has to be changed for that to happen.
 *
 * This is the same trap AGENTS.md records twice — under "Nominated vendors" (a
 * guard phrased for one case leaks through every other) and in the season rule
 * above (restricting on a comparison one side cannot answer).
 */
import type { Deactivatable } from "@/lib/masters/inactive";

/** Structural twin of `PickerItem` — declared here so this module owes nothing
 *  to a `"use client"` file and can be imported from either side. */
export type StyleOption = { id: string; code: string | null; name: string } & Deactivatable;

/** A style master row, with the two columns the filter reads. */
export type StyleFilterRow = StyleOption & {
  /** Free text (0124). Null means unassigned, which is never excluded. */
  season: string | null;
  /**
   * → `customers` (0124). Null means unassigned, and is never excluded — see
   * "It offers UNASSIGNED styles" above.
   *
   * This field was deliberately absent until 2026-08-14, on the grounds that "a
   * filter input that accepts a value it cannot honestly use is how a dead
   * parameter becomes a live bug later". That was right while the order keyed on
   * `buyers`; 0404 made the value honest.
   */
  customer_id: string | null;
};

export type StyleOptionsArgs = {
  /** Every style in the master, inactive rows included. */
  styles: readonly StyleFilterRow[];
  /**
   * The order header's Customer — a `customers` id, same table as
   * `StyleFilterRow.customer_id` since 0404. Blank narrows nothing, which is
   * what makes Customer-first a prompt rather than a trap: an operator who has
   * not chosen one yet sees the whole master rather than an empty box.
   */
  customer: string | null | undefined;
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
export function styleOptions({
  styles,
  customer,
  season,
  currentValue,
}: StyleOptionsArgs): StyleOptions {
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
  // NOT `norm`ed: a uuid is compared as an id, not as text. Running it through
  // the season's case-folding would work by accident today and stop working the
  // day either side is compared against something that is not a uuid.
  const forCustomer = customer ?? null;

  // Both filters state the same shape: blank on the ORDER narrows nothing, and
  // null on the STYLE is unassigned rather than "someone else's". Neither is
  // written as "restrict unless blank" — each clause is simply inert when it has
  // nothing to say, which is the same statement without a second branch to get
  // wrong.
  const items = styles.filter(
    (s) =>
      (!forCustomer || !s.customer_id || s.customer_id === forCustomer) &&
      (!wanted || !norm(s.season) || norm(s.season) === wanted),
  );

  if (items.length) return keep(items, null);

  // Empty, and the reason has to name the RIGHT facet — an operator told "no
  // styles for this season" who then edits Season, on a list actually emptied by
  // Customer, has been sent to the wrong field. So the customer is tested first
  // and separately: it is the facet the client made primary, and re-running the
  // filter without it is what distinguishes "this customer has none" from "this
  // season has none".
  if (!styles.length) {
    return keep(
      [],
      // THE STYLE SCREEN IS OFF THE MENU (2026-08-25), so a hint naming a menu
      // path sends the operator hunting for a row that is not there. The palette
      // is the route now — see the `retired` group in lib/nav/module-groups.ts,
      // which records that this is the only door left to a master an order
      // cannot save without.
      "There are no styles in the Style Master yet — press Ctrl+K and search “Style” to add one.",
      "— No styles yet —",
    );
  }

  if (forCustomer) {
    const seasonOnly = styles.filter(
      (s) => !wanted || !norm(s.season) || norm(s.season) === wanted,
    );
    if (seasonOnly.length) {
      return keep(
        [],
        "No styles for this customer. Press Ctrl+K, search “Style”, and enter one with this customer on it — or change the header's Customer.",
        "— No styles for this customer —",
      );
    }
  }

  if (!wanted) {
    // Reachable only when a customer is set and it alone empties the list — the
    // branch above returns first whenever season is the cause.
    return keep(
      [],
      "No styles for this customer. Press Ctrl+K, search “Style”, and enter one with this customer on it — or change the header's Customer.",
      "— No styles for this customer —",
    );
  }
  return keep(
    [],
    `No styles for this season. Change the header's Season, or set the Season on the style itself.`,
    "— No styles for this season —",
  );
}
