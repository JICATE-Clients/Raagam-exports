/**
 * "Is this master row switched off?" — one answer, for a schema that asks the
 * question three different ways.
 *
 * Client-safe on purpose (no `server-only`): the rule it backs is enforced in
 * `DataPicker`, which runs in the browser. Same shape as `delete-message.ts`.
 *
 * ## Why three spellings
 *
 *   `inactive`   true = off  — 43 tables. Master Data broadly: banks,
 *                              countries, customers, master_vendors, employees,
 *                              applicants, notifies, payment_terms,
 *                              account_groups / _heads, states, categories,
 *                              commodities, components, compositions…
 *                              Renamed from `blocked` by migration **0299**
 *                              (`0299_masters_blocked_to_inactive`).
 *   `blocked`    true = off  — EXACTLY FIVE TABLES, and this list is the whole
 *                              of it: `garment_styles`, `ta_styles`,
 *                              `material_attribute_line_options`,
 *                              `style_catalogues`, `style_price_lists`.
 *                              0299 renamed every OTHER master and deliberately
 *                              skipped the first two as Orders-module tables —
 *                              its own header says so.
 *   `is_active`  false = off — 29 tables. config_lookups, the Materials / HR
 *                              simple masters, finance (cost heads, cost
 *                              centres, gl_accounts), workers / staff.
 *
 * ## THIS LIST IS LOAD-BEARING, AND IT WAS WRONG (2026-08-11)
 *
 * It used to name `components` (and bins, brands, colors, commodities,
 * compositions, divisions, processes, seasons, our_banks) under `blocked`, and
 * cited 0315 for the rename — 0315 is `associates_schema_catchup`, a different
 * migration. 0299 had already moved all of them to `inactive`.
 *
 * That is not a documentation nit. A service selected `id, short_name, blocked`
 * from `components`, PostgREST answers a select over a MISSING column with an
 * error rather than nulls, so the query returned no data and the Component
 * dropdown on the Style screen was silently EMPTY on every row — a wrong
 * comment became a blank field. Read the column from the catalog, never from
 * this list, when it matters:
 *
 *     select column_name from information_schema.columns
 *      where table_schema = 'public' and table_name = '<t>'
 *        and column_name in ('inactive', 'blocked', 'is_active');
 *
 * Counts above are catalog-verified 2026-08-11. NO table carries two of these
 * spellings, so a stale name never merely degrades — it errors.
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
 * Order matters where a row carries more than one column. No table does today —
 * 0299 RENAMED rather than added, and the catalog confirms zero tables carry
 * both `inactive` and `blocked` (verified 2026-08-11) — but a row assembled
 * from a join or spread could still arrive with two of them set. The "off"
 * spellings win, so a row disabled either way reads as disabled.
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

/** Which spelling a table uses. A master with none of them cannot be switched off. */
export type ActiveColumn = "is_active" | "inactive" | "blocked";

/**
 * THE WRITE SIDE OF THE SAME FACT — the patch that switches a row OFF.
 *
 * `isInactive` above collapses the three spellings for reading; this collapses
 * them for writing, so a caller states the column once and never has to
 * remember which way round the boolean goes (`is_active: false` but
 * `inactive: true` — the two are inverted, which is exactly the mistake worth
 * making impossible).
 *
 * It exists because the write side had drifted into TWO hand-rolled copies:
 * `deleteOrDeactivate` built this ternary inline, and `lib/data-io`'s
 * `bulkDelete` did not build it at all — it hardcoded `{ is_active: false }`
 * for every entity it knows. Seven of its fifteen do not have that column
 * (`categories`, `components`, `compositions`, `levies`, `processes` are
 * `inactive`; `material_attributes` and `out_document_terms` have no flag), and
 * PostgREST answers an UPDATE over a missing column with an error rather than a
 * no-op — so Bulk Delete on those seven has always failed outright. Same shape
 * as the bug this file's own header records: a wrong column name does not
 * degrade, it errors. `bulkSetActive` beside it had the identical hardcode, in
 * BOTH directions, which is why this takes the state rather than assuming it.
 *
 * `active` is stated the POSITIVE way at every call site — "should this row be
 * on?" — and the inversion happens here, once. That is the point: two of the
 * three spellings are negated (`inactive` / `blocked` are true when the row is
 * OFF) and `is_active` is not, so a caller that flips the boolean itself is one
 * copy-paste away from switching a row ON when it meant to switch it off.
 */
export function activePatch(column: ActiveColumn, active: boolean): Deactivatable {
  if (column === "is_active") return { is_active: active };
  if (column === "blocked") return { blocked: !active };
  return { inactive: !active };
}

/** The common case, and the one `deleteOrDeactivate` wants: switch a row off. */
export function disablePatch(column: ActiveColumn): Deactivatable {
  return activePatch(column, false);
}
