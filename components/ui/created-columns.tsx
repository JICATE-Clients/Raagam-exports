import type { ReactNode } from "react";
import { fmtDate } from "@/lib/format";
import type { Column } from "@/components/ui/data-table";

/**
 * The ONE Created Date / Created User pair, for every listing screen.
 *
 * Six screens grew their own before this existed and no two agreed: "Created
 * Dt" vs "Created Date" vs plain "Created", `created_by_name` vs raw
 * `created_by` vs `creator.full_name`, `fmtDate` on five and `fmtDateTime` on
 * the sixth, and one that put the User BEFORE the Date. The wording is settled
 * here and nowhere else (client 2026-08-01): **Created Date, then Created
 * User**, last before the Status / Actions columns.
 *
 * It lives beside `row-actions.tsx` rather than under `components/masters/`
 * because the register screens import it too — the Created pair is not a
 * masters idea.
 *
 * THE GUARD IS THE POINT. `created_by` holds three different things across the
 * schema:
 *
 *   - a `profiles` uuid (106 tables, `default auth.uid()`),
 *   - a `profiles` uuid that is always NULL (26 tables from migrations
 *     0333/0334, which declared the column with no default),
 *   - a verbatim legacy username — "SELVARAJ", "admin" — on the 7 `text`
 *     tables (`config_lookups`, `processes`, `components`, `items`,
 *     `exchange_rate_details`). That is deliberate and documented in
 *     migration 0290: those names are not Supabase Auth accounts.
 *
 * `creatorName` reads all three, plus the `created_by_name` that
 * `withCreators()` (lib/created-by.ts) resolves and the older `creator` embed,
 * and REFUSES to return anything uuid-shaped. A screen printing
 * `{r.created_by}` shows an operator a 36-character hex string — four of them
 * did — and that is the regression this file exists to make impossible.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The shape a row MAY carry. None of it is required — see `creatorName`. */
export type CreatedFields = {
  created_at?: string | null;
  /** A uuid on most tables; a verbatim legacy username on the 7 `text` ones. */
  created_by?: string | null;
  /** Resolved by `withCreators()` in the service layer. */
  created_by_name?: string | null;
  /** The older PostgREST embed, still present on a couple of rows. */
  creator?: { full_name?: string | null } | null;
};

/**
 * Best readable name for whoever created the row, or `null`.
 *
 * The uuid test runs on the CHOSEN candidate rather than on `created_by`
 * alone, so a service that mistakenly flattens an id into `created_by_name` is
 * caught by the same guard. One exit, one test.
 */
export function creatorName(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const r = row as CreatedFields;
  const candidate =
    r.created_by_name?.trim() ||
    r.creator?.full_name?.trim() ||
    (typeof r.created_by === "string" ? r.created_by.trim() : "");
  if (!candidate) return null;
  return UUID_RE.test(candidate) ? null : candidate;
}

/**
 * Does this data carry creation info at all?
 *
 * Derived from the rows, never declared — the SAME gate `useMasterFilter` uses
 * for the Created Date facet (`rows.some(r => createdAt(r) != null)`). So the
 * column and the filter appear and disappear together, and a service whose
 * hand-written `.select()` forgot `created_at` gets neither, rather than a
 * column of dashes that quietly implies the records have no creation date.
 *
 * Checked over every row, not just the first: a table can hold rows seeded
 * before the column existed.
 */
export function hasCreatedInfo(rows: readonly unknown[]): boolean {
  return rows.some((r) => (r as CreatedFields | null)?.created_at != null);
}

/**
 * The pair itself. Structurally also a `SimpleMasterDescriptor["extraColumns"]`,
 * so one factory serves both engines and every hand-rolled list.
 */
export function createdColumns<Row>(): Column<Row>[] {
  return [
    {
      header: "Created Date",
      cell: (r) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {fmtDate((r as CreatedFields).created_at)}
        </span>
      ),
    },
    {
      header: "Created User",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{creatorName(r) ?? "—"}</span>
      ),
    },
  ];
}

/** Every historical spelling, so the strip below catches all six. */
const CREATED_HEADER = /^\s*created\s*(date|dt|user|by|on)?\s*$/i;

/**
 * The trailing run the pair must sit BEFORE: a status-ish column, or the
 * headerless row-actions column. Extend this as screens are swept — a list that
 * names its status column something else ("Blocked", "State") would otherwise
 * get the pair placed after it.
 */
const TRAILING_HEADER = /^\s*(status|inactive|active)?\s*$/i;

/**
 * Splice the Created pair into a screen's own columns, in the contract position.
 *
 * Not an append: the trailing run of a list is Status (declared by the screen)
 * and then the headerless actions column (appended by `rowActionsColumn`), and
 * Created belongs in front of both. The walk only ever touches that trailing
 * run, so a status column sitting mid-table is left where it is.
 *
 * It also STRIPS any Created column the caller declared. That looks rude and is
 * deliberate — it is the same call `MasterListShell` already makes about the
 * actions column, and the alternative is the six wordings we started with.
 * `scripts/audit_layout.py --check created-columns` reports a hand-rolled
 * Created column so a vanished one is diagnosed in seconds rather than minutes.
 */
export function withCreatedColumns<Row>(
  columns: Column<Row>[],
  rows: readonly unknown[],
): Column<Row>[] {
  const own = columns.filter((c) => !CREATED_HEADER.test(c.header ?? ""));
  if (!hasCreatedInfo(rows)) return own;
  let at = own.length;
  while (at > 0 && TRAILING_HEADER.test(own[at - 1].header ?? "")) at--;
  return [...own.slice(0, at), ...createdColumns<Row>(), ...own.slice(at)];
}

/** One muted line for a mobile read card: "01/08/2026 · SELVARAJ". */
export function createdMeta(row: unknown): string {
  const when = fmtDate((row as CreatedFields).created_at);
  const who = creatorName(row);
  return who ? `${when} · ${who}` : when;
}

/**
 * The Created block for a `RecordViewSheet`.
 *
 * Typed structurally rather than importing `ViewSection` from
 * `components/masters/record-view-sheet` — a `components/ui` primitive should
 * not depend on a module folder. The shape is checked at the call sites.
 *
 * The user is passed as `null` rather than "—" because the sheet drops empty
 * pairs by contract (`isEmpty`), and "Created User: —" is a line that says
 * nothing. A table cell cannot do that — a column has to hold something — which
 * is why `createdColumns` still renders the dash.
 */
export function createdSection(
  row: unknown,
): { label: string; pairs: (readonly [string, ReactNode])[] }[] {
  const at = (row as CreatedFields | null)?.created_at;
  if (at == null) return [];
  return [
    {
      label: "Created",
      pairs: [
        ["Created Date", fmtDate(at)] as const,
        ["Created User", creatorName(row)] as const,
      ],
    },
  ];
}
