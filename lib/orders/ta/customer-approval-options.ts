/**
 * "Which approvals apply to THIS customer?" — same shape as
 * `nominatedVendorOptions()` (lib/masters/vendor-nominations.ts) and
 * `taOwnerOptions()` (lib/ta/task-owners.ts): a buyer's own approval list
 * lives on `customer_approval_defaults` (0535, "which ta_approvals apply to
 * which buyer, and at what lead time"), and the T&A ▸ Approvals grid's
 * picker should only ever offer what THAT customer's own list names —
 * never the whole `ta_approvals` master, which is every approval any
 * customer anywhere might ask for (operator, 2026-09-09: "that approval
 * listing totally from approval master but it should based [on] that
 * customer approval only").
 *
 * `getAllCustomerApprovalDefaults()` (lib/orders/amendments/service.ts) was
 * already loading the whole table into `AmendmentFormData` for exactly this
 * — its own comment says "filtered CLIENT-SIDE when the order's Customer
 * changes, the same shape `nominatedVendorOptions` already uses" — but the
 * screen's Approval picker was never wired to read it, so it fell back to
 * offering the entire master. This module is that missing filter, not a new
 * design decision.
 *
 * Client-safe on purpose (no `server-only`, same shape as `inactive.ts` and
 * `vendor-nominations.ts`): the rule runs in the browser, inside the picker.
 *
 * Empty-and-explain, never fall back to the full list: a silent fallback
 * makes the customer's own approval list advisory, and the operator never
 * learns the customer needs one set up on their own Approvals tab.
 */
import type { Deactivatable } from "@/lib/masters/inactive";

export type CustomerApprovalOption = { id: string; code: string | null; name: string } & Deactivatable;

/** Structural twin of `CustomerApprovalDefault` (service.ts) — declared here
 *  so this module owes nothing to a `server-only` file. */
export type CustomerApprovalDefaultRow = {
  customer_id: string;
  approval_id: string;
};

export type CustomerApprovalOptionsArgs = {
  customerId: string | null | undefined;
  /** Shown in the "has no approvals configured" hint, so it names the right party. */
  customerName?: string | null;
  /** Every row in `ta_approvals`, inactive included. */
  approvals: CustomerApprovalOption[];
  /** Every customer's approval defaults — filtered here, not in SQL. */
  defaults: CustomerApprovalDefaultRow[];
  /** What this row already holds; never filtered out. See below. */
  currentValue?: string | null;
};

export type CustomerApprovalOptions = {
  items: CustomerApprovalOption[];
  hint: string | null;
  shortHint: string | null;
};

/**
 * The option list for ONE Approvals row, plus the line to show when there
 * are none.
 *
 * **The approval a row already holds always survives** (`currentValue`),
 * even when the rule would exclude it — a default withdrawn from the
 * customer after the row was saved, or an approval since deactivated.
 * Dropping it renders a filled field as empty and blanks the FK on the next
 * save; silent data loss dressed up as tidiness (AGENTS.md, "Disabled
 * rows").
 */
export function customerApprovalOptions({
  customerId,
  customerName,
  approvals,
  defaults,
  currentValue,
}: CustomerApprovalOptionsArgs): CustomerApprovalOptions {
  const keep = (
    items: CustomerApprovalOption[],
    hint: string | null,
    shortHint: string | null = null,
  ): CustomerApprovalOptions => {
    if (!currentValue || items.some((a) => a.id === currentValue)) {
      return { items, hint, shortHint };
    }
    const held = approvals.find((a) => a.id === currentValue);
    return held
      ? { items: [...items, held], hint, shortHint: null }
      : { items, hint, shortHint };
  };

  if (!customerId) {
    return keep(
      [],
      "Pick the customer first — approvals are per customer.",
      "— Pick Customer first —",
    );
  }

  const allowed = new Set<string>();
  for (const d of defaults) {
    if (d.customer_id === customerId) allowed.add(d.approval_id);
  }

  const items = approvals.filter((a) => allowed.has(a.id));
  if (items.length) return keep(items, null);

  const who = customerName?.trim() || "This customer";
  return keep(
    [],
    `${who} has no approvals configured — add them on the customer's Approvals tab.`,
    "— No approvals configured —",
  );
}
