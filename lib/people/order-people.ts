import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getCurrentLocation } from "@/lib/auth/location";

/**
 * THE PEOPLE THE ORDERS MODULE NAMES — HR ▸ STAFF, AND ONLY HR ▸ STAFF
 * (0671 / 0674, user 2026-10-01: one people list, then "my work").
 *
 * Merchandiser, T&A task owner, fabric / trim T&A owner, Work Flow owner and
 * CAD pattern maker all point at `staff(id)` now; the old Employee master held
 * nothing but test rows. This file is the ONE place that reads them, so every
 * picker, every name on a list and every "mine" view agree on who a person is.
 *
 * ## WHY THE SERVICE ROLE, AND WHY IT IS SAFE
 *
 * `staff_read` needs hr_payroll:view (and the current unit) — and the
 * merchandiser, the T&A owner and the MD who use the Orders screens are exactly
 * the people who should NOT hold payroll access. Through their own RLS these
 * reads came back empty, which reads as "nobody", not as "not allowed". So the
 * reads below go past RLS and in exchange are NARROW: id, code, name, active /
 * blocked, department and designation — never pay, bank, family or documents —
 * and every caller sits behind an Orders permission check of its own.
 *
 * ## WHO "ME" IS (`myStaff`)
 *
 * Matched exactly as `employee_login_ids()` (0674) matches it the other way:
 * `profiles.employee_code` = `staff.code` first — the code `createUserFromStaff`
 * stamps — then the login's e-mail. Same rule in SQL and in TypeScript, so an
 * alert and a "my tasks" list can never disagree about who someone is.
 */
export type OrderPerson = {
  id: string;
  code: string | null;
  name: string;
  /** Switched off or blocked on HR ▸ Staff — not offered, but still named. */
  inactive: boolean;
  department_id: string | null;
  department_name: string | null;
  designation: string | null;
};

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Every staff member, active or not, in name order. Callers decide who is
 * OFFERED (AGENTS.md ▸ Disabled rows: an inactive person a record already
 * holds must still be named).
 */
export async function listOrderPeople(): Promise<OrderPerson[]> {
  const [{ data, error }, { location }] = await Promise.all([
    createAdminClient()
      .from("staff")
      .select(
        "id, code, name, is_active, blocked, location_id, department_id, department:departments!department_id(name), designation:designations!designation_id(name)",
      )
      .order("name"),
    getCurrentLocation(),
  ]);
  if (error) throw new Error(`Could not read staff: ${error.message}`);
  return ((data ?? []) as unknown as {
    id: string;
    code: string | null;
    name: string | null;
    is_active: boolean | null;
    blocked: boolean | null;
    location_id: string | null;
    department_id: string | null;
    department: One<{ name: string | null }>;
    designation: One<{ name: string | null }>;
  }[]).map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name ?? "(unnamed)",
    // ANOTHER UNIT'S STAFF ARE NOT OFFERED (0680, client 2026-10-03: staff are
    // per unit). Flagged like an inactive person rather than dropped, so a
    // record that already names them still shows the name (Disabled rows).
    inactive: s.is_active === false || !!s.blocked || s.location_id !== (location?.id ?? null),
    department_id: s.department_id,
    department_name: one(s.department)?.name ?? null,
    designation: one(s.designation)?.name ?? null,
  }));
}

/** id → name, for showing who a row names. Only the ids asked for; only the name. */
export async function staffNames(ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const { data, error } = await createAdminClient().from("staff").select("id, name").in("id", wanted);
  if (error) throw new Error(`Could not read staff names: ${error.message}`);
  for (const r of (data ?? []) as { id: string; name: string | null }[]) out.set(r.id, r.name ?? "(unnamed)");
  return out;
}

/**
 * The same read as `staffNames`, in the `{ data, error }` shape of a Supabase
 * query — for loaders that batch it into a `Promise.all` of queries and report
 * each failure by name.
 */
export async function staffNameRows(
  ids: Iterable<string | null | undefined>,
): Promise<{ data: { id: string; name: string | null }[]; error: { message: string } | null }> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
  if (wanted.length === 0) return { data: [], error: null };
  const { data, error } = await createAdminClient().from("staff").select("id, name").in("id", wanted);
  return { data: (data ?? []) as { id: string; name: string | null }[], error };
}

export type MyStaff = { id: string; name: string; department_id: string | null; department_name: string | null };

/**
 * The signed-in person's staff record, or null when the login matches none.
 * `userId` is the SESSION's id (callers pass `requireUser().id` or the
 * Supabase user) — never a value from the request.
 */
export async function myStaff(userId: string): Promise<MyStaff | null> {
  const s = await createClient();
  const { data: me } = await s.from("profiles").select("email, employee_code").eq("id", userId).maybeSingle();
  const code = (me as { employee_code: string | null } | null)?.employee_code?.trim() || null;
  const email = (me as { email: string | null } | null)?.email?.trim().toLowerCase() || null;
  if (!code && !email) return null;

  const admin = createAdminClient();
  const cols = "id, name, department_id, department:departments!department_id(name)";
  type Row = { id: string; name: string | null; department_id: string | null; department: One<{ name: string | null }> };
  const pick = (r: Row | null): MyStaff | null =>
    r
      ? { id: r.id, name: r.name ?? "", department_id: r.department_id, department_name: one(r.department)?.name ?? null }
      : null;

  if (code) {
    const { data } = await admin.from("staff").select(cols).eq("code", code).limit(1).maybeSingle();
    if (data) return pick(data as unknown as Row);
  }
  if (email) {
    // `ilike` for the case-fold, wildcards escaped (see lib/hr/my-profile.ts).
    const exact = email.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data } = await admin.from("staff").select(cols).ilike("email", exact).limit(1).maybeSingle();
    if (data) return pick(data as unknown as Row);
  }
  return null;
}
