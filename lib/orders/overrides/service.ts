import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { ActiveOverride, OverrideGrant, OverrideGrantee, OverrideGrantHistoryRow } from "./types";
import { grantStatusOf } from "./override-modules";

/** Can the caller READ the override register (R-18, D-7)? Managers, plus
 *  anyone holding system_admin:view — the same gate the tables' RLS reads. */
export async function canViewOverrides(): Promise<boolean> {
  const s = await createClient();
  const { data, error } = await s.rpc("can_view_permission_overrides");
  return !error && data === true;
}

/**
 * Permission overrides — reads (0650 · 0651). Every answer about what the
 * CALLER may do comes from an RPC computed against the database clock on this
 * request (R-10, R-11): nothing here is cached, so a revoke or an expiry is
 * seen by the very next page load. The screens use these only to decide what
 * to show; the lock triggers are the control (R-9).
 */

/**
 * The caller's live override keys. FAILS CLOSED: an error reads as "no
 * override", so a broken read can only ever leave a screen more locked, never
 * less — the same rule `assertOrderWritable` follows.
 */
export async function myActiveOverrides(): Promise<ActiveOverride[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("my_active_overrides");
  if (error || !data) return [];
  return (data as { module_key: string; override_expiry: string }[]).map((r) => ({
    key: r.module_key,
    expiresAt: r.override_expiry,
  }));
}

/** May the caller grant and revoke overrides (R-15)? */
export async function canManageOverrides(): Promise<boolean> {
  const s = await createClient();
  const { data, error } = await s.rpc("can_manage_permission_overrides");
  return !error && data === true;
}

/** Resolve profile uuids to names — `creator_names()`, since profiles is own-row RLS. */
async function namesOf(ids: (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const uniq = [...new Set(ids.filter((v): v is string => !!v))];
  if (uniq.length === 0) return new Map();
  const s = await createClient();
  const { data } = await s.rpc("creator_names", { ids: uniq });
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));
}

/** Every grant, in entry order. A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST. */
export async function listOverrideGrants(): Promise<OverrideGrant[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("user_email_permission_overrides")
    .select("*")
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22).
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read the override grants: ${error.message}`);
  const rows = (data ?? []) as Omit<OverrideGrant, "granted_by_name" | "revoked_by_name" | "status">[];
  const names = await namesOf(rows.flatMap((r) => [r.granted_by, r.revoked_by]));
  const now = new Date();
  return withCreators(
    rows.map((r) => ({
      ...r,
      status: grantStatusOf(r, now),
      granted_by_name: names.get(r.granted_by) ?? null,
      revoked_by_name: r.revoked_by ? names.get(r.revoked_by) ?? null : null,
    })),
  );
}

/** One grant's history, oldest first (R-14). */
export async function getOverrideGrantHistory(overrideId: string): Promise<OverrideGrantHistoryRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("override_grant_history")
    .select("*")
    .eq("override_id", overrideId)
    .order("action_timestamp", { ascending: true });
  if (error) throw new Error(`Could not read the grant history: ${error.message}`);
  const rows = (data ?? []) as Omit<OverrideGrantHistoryRow, "actor_name">[];
  const names = await namesOf(rows.map((r) => r.actor_id));
  return rows.map((r) => ({ ...r, actor_name: names.get(r.actor_id) ?? null }));
}

/** The admin screen's user picker (C-8). Throws for a non-manager (R-15). */
export async function listOverrideGrantees(): Promise<OverrideGrantee[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("override_grantee_candidates");
  if (error) throw new Error(error.message);
  return (data ?? []) as OverrideGrantee[];
}
