/**
 * "Which vendors may this line use?" — one answer, for every screen that asks.
 *
 * A **nomination** is the customer telling us which vendor may supply them. It
 * is stored on the Customer master (Nominated Vendors tab → two grids,
 * `customer_nominated_vendors.list_kind` = 'nominated' | 'recommended') and,
 * until this module, it constrained nothing: MBA was the only screen that read
 * it, Order Trims took a free-text vendor name, and Accessory BOM had no vendor
 * input at all. A line could be marked "Nominated" against a vendor the customer
 * had never approved (client, 2026-07-31 — reported twice).
 *
 * Client-safe on purpose (no `server-only`, same shape as `inactive.ts`): the
 * rule runs in the browser, inside the picker, so the option list narrows as the
 * operator tabs down a grid. The server half — loading the nominations — lives in
 * `listVendorNominations()` (`lib/masters/vendor-service.ts`), which is where the
 * Supabase client already is.
 *
 * ## The rule
 *
 *   supply type          vendors offered
 *   -------------------  ---------------------------------------------------
 *   nominated            that customer's list_kind = 'nominated'
 *   recommended          that customer's list_kind = 'recommended'
 *   (blank)              NONE — "pick the supply type first"
 *   anything else        every vendor
 *
 * Two decisions worth keeping:
 *
 * **Blank offers nothing, not everything.** This was the actual leak: MBA tested
 * `supplyType !== "Nominated"` and a new row starts blank, so the very first
 * dropdown an operator opened listed the whole master — which is exactly what
 * was reported. A guard phrased as "restrict only in case X" leaks through every
 * state that is not X, and blank is always one of them. Hence the allow-list of
 * unconstrained types below rather than a single equality test.
 *
 * **Local / Import / purchase stay unconstrained.** Buying locally is OUR
 * sourcing decision, not the customer's. Narrowing those would be wrong, not
 * stricter.
 *
 * Empty-and-explain rather than falling back to the full list: a silent fallback
 * makes the nomination list advisory, and the operator never learns that the
 * customer's list is what needs filling in.
 */
import type { Deactivatable } from "./inactive";

/** One customer's nomination of one vendor. `vendor_id` → `master_vendors` (0376). */
export type VendorNomination = {
  customer_id: string;
  vendor_id: string;
  list_kind: "nominated" | "recommended";
};

/** Structural twin of `PickerItem` — declared here so this module owes nothing
 *  to a `"use client"` file and can be imported from either side. */
export type VendorOption = { id: string; code: string | null; name: string } & Deactivatable;

/**
 * The supply types that mean "the customer chose the vendor".
 *
 * Matched case-insensitively because the three enums disagree and always have:
 * MBA stores `"Nominated"` (`lib/orders/material-bom-amendment/types.ts`), while
 * Order Trims (`lib/orders/order-detail-types.ts`) and Accessory BOM
 * (`lib/planning/bom-types.ts`) store `"nominated"`. Compare with `===` and the
 * filter compiles, runs, and quietly matches nothing on two screens out of three.
 */
const CUSTOMER_CHOSEN: Record<string, VendorNomination["list_kind"]> = {
  nominated: "nominated",
  recommended: "recommended",
};

/** Which nomination list a supply type maps to, or null if it maps to none. */
export function nominationKindFor(supplyType: string | null | undefined) {
  return CUSTOMER_CHOSEN[(supplyType ?? "").trim().toLowerCase()] ?? null;
}

export type NominatedVendorArgs = {
  /** The line's supply type, in whatever casing that screen's enum uses. */
  supplyType: string | null | undefined;
  /** `public.customers.id`. Null until the header names a customer. */
  customerId: string | null | undefined;
  /** Shown in the "has nominated no vendors" hint, so it names the right party. */
  customerName?: string | null;
  /** Every vendor in `master_vendors`, inactive rows included. */
  vendors: VendorOption[];
  /** Every customer's nominations — filtered here, not in SQL. */
  nominations: VendorNomination[];
  /** What this row already holds; never filtered out. See below. */
  currentValue?: string | null;
  /**
   * Set when the screen cannot resolve a customer at all — an Orders document
   * hangs off `buyers`, not `customers`. Replaces the hint rather than pretending
   * the customer has an empty list.
   */
  unresolvedCustomerHint?: string | null;
};

export type NominatedVendorOptions = {
  items: VendorOption[];
  /** Rendered under the field when the list is narrowed to nothing. */
  hint: string | null;
  /**
   * The same reason in a few words, for a field that has no room beneath it.
   *
   * A grid cell is ~150px wide and the row is one line tall, so the `hint`
   * paragraph made the Vendor cell three lines and shoved every other cell in
   * the row out of alignment (operator, 2026-08-10). A compact picker shows this
   * as its PLACEHOLDER instead — the explanation lands inside the empty box the
   * operator is looking at, which is if anything closer to the point of
   * confusion than a line underneath it.
   *
   * Set ONLY when the list is empty, so it never overwrites the normal
   * "— Select Vendor —" on a field that does have options. That is why the
   * unresolved-customer case leaves it null: that one offers every vendor and
   * its `hint` is an advisory about the offer, not an explanation of an empty
   * box, so it keeps the paragraph.
   *
   * AGENTS.md "Nominated vendors" requires empty-and-explain — never a silent
   * fallback to the full list. This is the explain half in a narrower shape, not
   * its removal; drop it and the operator meets an empty dropdown with no reason.
   */
  shortHint: string | null;
};

/**
 * The option list for ONE line, plus the line to show when there are none.
 *
 * Narrowed per ROW, not per grid: two lines of the same document can carry
 * different supply types.
 *
 * **The vendor a row already holds always survives** (`currentValue`), even when
 * the rule would exclude it — a nomination withdrawn after the line was saved, or
 * a vendor since deactivated. Dropping it renders a filled field as empty and
 * blanks the FK on the next save; silent data loss dressed up as tidiness
 * (AGENTS.md, "Disabled rows"). `RecordPicker` still greys it and refuses to
 * re-pick it.
 */
export function nominatedVendorOptions({
  supplyType,
  customerId,
  customerName,
  vendors,
  nominations,
  currentValue,
  unresolvedCustomerHint,
}: NominatedVendorArgs): NominatedVendorOptions {
  const keep = (
    items: VendorOption[],
    hint: string | null,
    shortHint: string | null = null,
  ): NominatedVendorOptions => {
    if (!currentValue || items.some((v) => v.id === currentValue)) {
      return { items, hint, shortHint };
    }
    const held = vendors.find((v) => v.id === currentValue);
    // The held vendor rescues the list, so the box is no longer empty and the
    // short form has nothing to explain — but `hint` stays, because the reason
    // the OTHER vendors are missing is still worth saying.
    return held
      ? { items: [...items, held], hint, shortHint: null }
      : { items, hint, shortHint };
  };

  const supply = (supplyType ?? "").trim();
  if (!supply) {
    return keep(
      [],
      "Pick the Supply Type first — it decides which vendors apply.",
      "— Pick Supply Type first —",
    );
  }

  const kind = nominationKindFor(supply);
  if (!kind) return keep(vendors, null); // Local · Import · purchase · others — our own choice.

  // A screen whose document hangs off a party we cannot map to a customer can
  // neither narrow nor claim the list is empty. Say so and offer everything.
  // No short form: the list is FULL here, so this is an advisory about the offer
  // rather than an explanation of an empty box, and it keeps the paragraph.
  if (unresolvedCustomerHint) return keep(vendors, unresolvedCustomerHint);

  if (!customerId) {
    return keep(
      [],
      "Pick the customer first — nominations are per customer.",
      "— Pick Customer first —",
    );
  }

  const allowed = new Set<string>();
  for (const n of nominations) {
    if (n.customer_id === customerId && n.list_kind === kind) allowed.add(n.vendor_id);
  }

  const items = vendors.filter((v) => allowed.has(v.id));
  if (items.length) return keep(items, null);

  const who = customerName?.trim() || "This customer";
  return keep(
    [],
    `${who} has no ${kind} vendors — add them on the customer's Nominated Vendors tab.`,
    `— No ${kind} vendors —`,
  );
}
