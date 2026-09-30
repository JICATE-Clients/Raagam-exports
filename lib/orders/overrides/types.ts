/**
 * Permission overrides — row shapes and input schemas (0650 · 0651).
 * Client-safe; the vocabulary and rules live in `./override-modules`.
 */

import { z } from "zod";
import { OVERRIDE_KEYS, OVERRIDE_MIN_REASON, type OverrideGrantStatus } from "./override-modules";

/** A row of `user_email_permission_overrides`, names resolved. */
export interface OverrideGrant {
  id: string;
  /** The badge, computed by the SERVICE at read time — never `Date.now()` in a
   *  render (the React Compiler refuses it, and a phone with a wrong clock would
   *  paint the list wrong). Display only: enforcement reads the DB clock. */
  status: OverrideGrantStatus;
  user_email: string;
  module_key: string;
  can_edit: boolean;
  can_approve: boolean;
  override_expiry: string;
  reason: string;
  granted_by: string;
  granted_by_name: string | null;
  granted_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_by_name: string | null;
  revoke_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A row of `override_grant_history` (R-14). */
export interface OverrideGrantHistoryRow {
  id: string;
  override_id: string;
  action: "GRANT" | "RENEW" | "REVOKE";
  user_email: string;
  module_key: string;
  can_edit: boolean;
  override_expiry: string | null;
  reason: string;
  actor_id: string;
  actor_email: string | null;
  actor_name: string | null;
  action_timestamp: string;
}

/** The admin screen's user picker (`override_grantee_candidates()`). */
export interface OverrideGrantee {
  user_id: string;
  email: string;
  full_name: string | null;
  employee_name: string | null;
  department: string | null;
  designation: string | null;
  /** C-4: false means the user cannot be granted — they cannot edit orders at all. */
  can_edit_orders: boolean;
}

/**
 * One field changed under an override — a row of the MD's Override Edit Report
 * (R-18): `override_audit_trail` with its commit's outcome and the RE No.
 */
export interface OverrideEditRow {
  id: string;
  commit_id: string;
  commit_status: "open" | "committed" | "failed" | "expired";
  /** When the save closed (or started, if it never closed). ISO, UTC. */
  committed_at: string;
  direction_breach: boolean;
  sales_order_id: string;
  garment_order_id: string;
  re_no: string | null;
  order_version: string | null;
  user_email: string;
  module_key: string | null;
  entity_table: string;
  entity_row_id: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  reason: string;
}

/** How many override edits an order's RE carries — the report footer's note. */
export interface OrderOverrideEditCount {
  commits: number;
  fields: number;
  lastAt: string | null;
}

/** One of the CALLER's live keys (`my_active_overrides()`). */
export interface ActiveOverride {
  key: string;
  expiresAt: string;
}

/**
 * What an editor needs to offer override edit mode (Phase 5), handed down by
 * the page once — the editors are client components below early returns and
 * must not grow a hook to ask. Null when the caller holds no live key, which
 * is every user today: the loader then makes no further query.
 */
export interface OverrideEditState {
  keys: ActiveOverride[];
  /** Approved garment order id → "V{n}" — the version an override edits in
   *  place (the count of re-approved revisions, as `v-final.ts` counts it). */
  versions: Record<string, string>;
}

const reason = z
  .string()
  .trim()
  .min(OVERRIDE_MIN_REASON, `Give a reason of at least ${OVERRIDE_MIN_REASON} characters.`);

export const grantOverrideInput = z.object({
  email: z.string().trim().min(3, "Choose the user to grant access to."),
  keys: z.array(z.enum(OVERRIDE_KEYS)).min(1, "Choose at least one module."),
  /** ISO timestamp, UTC (the screen shows IST, sends UTC — spec §7.1). */
  expiresAt: z.string().min(1, "Choose when the access expires."),
  reason,
});
export type GrantOverrideInput = z.infer<typeof grantOverrideInput>;

export const revokeOverrideInput = z.object({
  id: z.string().uuid(),
  reason,
});
export type RevokeOverrideInput = z.infer<typeof revokeOverrideInput>;
