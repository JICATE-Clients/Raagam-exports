/**
 * Adapter functions that map dedicated-table rows into ConfigLookup shape.
 *
 * These 6 entities have their own CRUD tables but many picker screens still
 * consume ConfigLookup[]. Rather than rewriting every picker component, we
 * map at the resolver-page boundary so the components stay unchanged.
 *
 * ## ⚠ A SHIM IS ONLY SAFE WHERE THE COLUMN'S FK POINTS AT THE DEDICATED TABLE
 *
 * These functions hand a picker rows whose `id` is `<master>.id`. If the column
 * being filled still `references public.config_lookups(id)`, the save is
 * rejected outright — and `LookupDialogPicker`'s inline **+ Add** creates a
 * `config_lookups` row, so ADDING a value succeeds while PICKING an existing one
 * fails. That asymmetry is why it survives: the operator who adds works, the
 * operator who picks is told nothing useful.
 *
 * **Diff the FK TARGET, never the column name or the master's label** — "the
 * Designation master" names two different tables in this codebase.
 *
 * Current state of each, checked 2026-08-31:
 *
 * - `statesAsLookups` — SAFE. 0355 repointed 7 FKs at `public.states`.
 * - `paymentTermsAsLookups` — SAFE. 0375 repointed at `public.payment_terms`.
 * - `hsnDetailsAsLookups`, `categoriesAsLookups` — used where the column
 *   references the dedicated table.
 * - **`departmentsAsLookups`, `designationsAsLookups`, `employeeCategoriesAsLookups`
 *   HAVE NO SAFE CALLER TODAY.** Every `department_id`, `designation_id` and
 *   `category_id` column in the schema (0124 · 0126 · 0238 · 0239 · 0240 · 0243 ·
 *   0245 · 0252 · 0267) references `config_lookups`. They fed Applicant,
 *   Customer, Notify and Consignee until 2026-08-31 and rejected every save on a
 *   picked designation or department; those four now read
 *   `all.filter(l => l.kind === …)`. **Do not reach for these three again
 *   without first repointing the column** — they are kept only because that
 *   repoint is the other half of the fix and has not been decided.
 *
 * The class, with its history: [[raagam-lookup-compat-fk-mismatch]].
 */

import type { ConfigLookup } from "./extras-types";
import type { Department } from "./department-types";
import type { Designation } from "./designation-types";
import type { EmployeeCategory } from "./employee-category-types";
import type { PaymentTerm } from "./payment-term-types";
import type { State } from "./state-types";
import type { HsnDetail } from "./hsn-detail-types";
import type { Category } from "./category-types";

export function departmentsAsLookups(rows: Department[]): ConfigLookup[] {
  return rows.map((d) => ({
    id: d.id,
    kind: "department" as const,
    code: d.short_name,
    name: d.name ?? d.short_name ?? "—",
    notes: null,
    is_active: !d.inactive,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
}

export function designationsAsLookups(rows: Designation[]): ConfigLookup[] {
  return rows.map((d) => ({
    id: d.id,
    kind: "designation" as const,
    code: null,
    name: d.name,
    notes: null,
    is_active: !d.inactive,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
}

export function employeeCategoriesAsLookups(rows: EmployeeCategory[]): ConfigLookup[] {
  return rows.map((d) => ({
    id: d.id,
    kind: "employee_category" as const,
    code: d.short_name ?? null,
    name: d.name,
    notes: null,
    is_active: !d.inactive,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
}

export function paymentTermsAsLookups(rows: PaymentTerm[]): ConfigLookup[] {
  return rows.map((d) => ({
    id: d.id,
    kind: "payment_term" as const,
    code: String(d.entry_no),
    name: d.description ?? `Term #${d.entry_no}`,
    notes: null,
    is_active: !d.inactive,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
}

/**
 * A state in `ConfigLookup` clothing, plus the one column that has no ConfigLookup
 * equivalent. `country_id` is optional on the type so the six screens that still
 * declare their prop as `ConfigLookup[]` stay assignable — an unscoped list simply
 * behaves as it always did.
 */
export type StateLookup = ConfigLookup & { country_id: string | null };

export function statesAsLookups(rows: State[]): StateLookup[] {
  return rows.map((d) => ({
    id: d.id,
    kind: "state" as const,
    code: d.code ?? null,
    name: d.name,
    notes: null,
    // Carried through so State fields can scope by country; every other
    // ConfigLookup consumer just ignores the extra key.
    country_id: d.country_id ?? null,
    is_active: !d.inactive,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
}

/**
 * Categories for a picker that consumes `ConfigLookup[]`.
 *
 * Caller must scope by item class FIRST — a category only means anything inside
 * one. Customer ▸ Supplied Items was reading `config_lookups` where kind =
 * 'material_category', which holds the two GROUP names ("Sewing Accessory",
 * "Packing Accessory") rather than the categories inside them, so both of its
 * cards offered the same two wrong values (client 2026-07-29, 0356).
 *
 * `kind: "material_category"` is kept on the output only because that is the
 * discriminator the picker components read; the rows are `categories`, and the
 * ids are `categories.id`. Any picker fed from this must therefore run with
 * `canCreate`/`canEdit` OFF — its inline Add/Modify writes to `config_lookups`,
 * which is now the wrong table for these values.
 */
export function categoriesAsLookups(rows: Category[]): ConfigLookup[] {
  return rows.map((d) => ({
    id: d.id,
    kind: "material_category" as const,
    code: d.short_name ?? null,
    name: d.name ?? d.short_name ?? "—",
    notes: null,
    is_active: !d.inactive,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
}

export function hsnDetailsAsLookups(rows: HsnDetail[]): ConfigLookup[] {
  return rows.map((d) => ({
    id: d.id,
    kind: "hsn_code" as const,
    code: d.hsn_code ?? null,
    name: d.description ?? d.hsn_code ?? "—",
    notes: null,
    is_active: !d.inactive,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
}
