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

export function statesAsLookups(rows: State[]): ConfigLookup[] {
  return rows.map((d) => ({
    id: d.id,
    kind: "state" as const,
    code: d.code ?? null,
    name: d.name,
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
