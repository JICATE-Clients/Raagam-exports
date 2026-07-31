/**
 * Adapter functions that map dedicated-table rows into ConfigLookup shape.
 *
 * These 6 entities have their own CRUD tables but many picker screens still
 * consume ConfigLookup[]. Rather than rewriting every picker component, we
 * map at the resolver-page boundary so the components stay unchanged.
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
