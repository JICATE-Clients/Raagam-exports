/**
 * "Is this master row switched off?" — one answer, for a schema that asks the
 * question three different ways.
 *
 * Client-safe on purpose (no `server-only`): the rule it backs is enforced in
 * `DataPicker`, which runs in the browser. Same shape as `delete-message.ts`.
 *
 * ## Why three spellings
 *
 *   `inactive`   true = off  — Associates (banks, countries, customers,
 *                              master_vendors, employees, applicants, notifies,
 *                              payment_terms, account_groups / _heads, states…).
 *                              Renamed from `blocked` by migration 0315.
 *   `blocked`    true = off  — bins, brands, colors, commodities, components,
 *                              compositions, divisions, processes, seasons,
 *                              our_banks, garment styles, attribute lines.
 *   `is_active`  false = off — config_lookups, the Materials / HR simple
 *                              masters, finance (cost heads, cost centres,
 *                              gl_accounts), workers / staff.
 *
 * `lib/masters/delete-guard.ts` already had to know all three to write the
 * soft-disable patch. This is the read side of the same fact. Nothing is
 * renamed in the DB — 250+ migrations and every RLS policy reference these
 * columns by name; the divergence is collapsed here, at the edge, instead.
 */
export type Deactivatable = {
  is_active?: boolean | null;
  inactive?: boolean | null;
  blocked?: boolean | null;
};

/**
 * Order matters where a row carries more than one column: a table mid-rename
 * (0315 added `inactive` before every screen stopped writing `blocked`) would
 * otherwise answer from whichever column happened to be checked first. The
 * "off" spellings win, so a row disabled either way reads as disabled.
 *
 * A row carrying none of them is ACTIVE — a master with no disable column (work
 * timings, document-no formats, exchange-rate entries) cannot be switched off,
 * and `deleteOrBlock` is what guards those instead.
 */
export function isInactive(row: Deactivatable): boolean {
  if (row.inactive != null) return row.inactive;
  if (row.blocked != null) return row.blocked;
  if (row.is_active != null) return !row.is_active;
  return false;
}

/** The inverse, for the many call sites that read better positively. */
export function isActive(row: Deactivatable): boolean {
  return !isInactive(row);
}
