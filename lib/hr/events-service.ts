import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { EventGuest, HrEvent, InvitablePerson } from "./events-types";

/** HR ▸ Events (0823) — the read half. RLS keeps it to HR in the current unit. */

type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function listEvents(): Promise<HrEvent[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("hr_calendar_events")
    .select(
      "*, guests:hr_calendar_event_guests(id, staff_id, worker_id, email, response_status, staff:staff!staff_id(name, code), worker:workers!worker_id(name, code))",
    )
    .order("starts_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type P = { name: string | null; code: string | null };
  type G = Omit<EventGuest, "person_name" | "person_code"> & { staff: One<P>; worker: One<P> };
  type Row = Omit<HrEvent, "guests"> & { guests: G[] | null };
  const rows = ((data ?? []) as Row[]).map(({ guests, ...r }) => ({
    ...r,
    guests: (guests ?? []).map(({ staff, worker, ...g }) => {
      const p = one(staff) ?? one(worker);
      return { ...g, person_name: p?.name ?? g.email, person_code: p?.code ?? null };
    }),
  }));
  return withCreators(rows);
}

/** Every active staff member and worker in the unit, with their email. */
export async function listInvitablePeople(): Promise<InvitablePerson[]> {
  const s = await createClient();
  const [st, wk] = await Promise.all([
    s.from("staff").select("id, code, name, email").eq("is_active", true).order("code"),
    s.from("workers").select("id, code, name, email").eq("is_active", true).order("code"),
  ]);
  if (st.error) throw new Error(st.error.message);
  if (wk.error) throw new Error(wk.error.message);
  type P = { id: string; code: string | null; name: string; email: string | null };
  const clean = (e: string | null) => (e && e.trim() ? e.trim().toLowerCase() : null);
  return [
    ...((st.data ?? []) as P[]).map((p) => ({ key: `staff:${p.id}`, kind: "staff" as const, ...p, email: clean(p.email) })),
    ...((wk.data ?? []) as P[]).map((p) => ({ key: `worker:${p.id}`, kind: "worker" as const, ...p, email: clean(p.email) })),
  ];
}
