import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocationId } from "@/lib/auth/location";
import { personKey } from "./timeoff-types";
import type {
  CaseEvent,
  DisciplinaryCase,
  Memo,
  MemoEvent,
  Policy,
  PolicyAck,
  PolicyVersion,
  Witness,
} from "./conduct-types";

/**
 * Reads for HR ▸ Conduct & Policies (0791).
 *
 * RLS does the scoping: HR reads the unit they are working in; a person reads
 * their own memos and the policies that reach them. Names of the people on
 * rows the caller ALREADY holds are read through the privileged client — a
 * self-service login cannot read the staff / workers tables, and its screen
 * would otherwise be a list of dashes. Nothing is read for a row RLS did not
 * return.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — every read below throws.
 */

export { timeoffViewer as conductViewer, listTimeoffPeople as listConductPeople } from "./timeoff-service";

type Named = { name: string; code: string | null };
type Names = { staff: Map<string, Named>; workers: Map<string, Named> };

async function namesOf(staffIds: Iterable<string | null>, workerIds: Iterable<string | null>): Promise<Names> {
  const sIds = [...new Set([...staffIds].filter((x): x is string => !!x))];
  const wIds = [...new Set([...workerIds].filter((x): x is string => !!x))];
  const admin = createAdminClient();
  const [st, wk] = await Promise.all([
    sIds.length ? admin.from("staff").select("id, name, code").in("id", sIds) : Promise.resolve({ data: [], error: null }),
    wIds.length ? admin.from("workers").select("id, name, code").in("id", wIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (st.error) throw new Error(`Could not read staff names: ${st.error.message}`);
  if (wk.error) throw new Error(`Could not read worker names: ${wk.error.message}`);
  type Row = { id: string; name: string | null; code: string | null };
  const toMap = (rows: Row[]) => new Map(rows.map((r) => [r.id, { name: r.name ?? "(unnamed)", code: r.code }]));
  return { staff: toMap((st.data ?? []) as Row[]), workers: toMap((wk.data ?? []) as Row[]) };
}

function who(n: Names, staffId: string | null, workerId: string | null) {
  const p = staffId ? n.staff.get(staffId) : workerId ? n.workers.get(workerId) : undefined;
  return { person_kind: (staffId ? "staff" : "worker") as "staff" | "worker", person_name: p?.name ?? "—", person_code: p?.code ?? null };
}

/** Profile names for the actors in a diary. */
async function actorNames(ids: Iterable<string | null>): Promise<Map<string, string>> {
  const list = [...new Set([...ids].filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const s = await createClient();
  const { data, error } = await s.rpc("creator_names", { ids: list });
  if (error) return new Map();
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map((r) => [r.id, r.full_name ?? ""]));
}

// ─── Memos ─────────────────────────────────────────────────────────────────

export async function listMemos(): Promise<Memo[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("cd_memos")
    .select("*, case:cd_cases!case_id(code)")
    .order("issued_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Omit<Memo, "person_kind" | "person_name" | "person_code" | "case_code"> & { case: { code: string | null } | null };
  const rows = (data ?? []) as Row[];
  const n = await namesOf(
    rows.map((r) => r.staff_id),
    rows.map((r) => r.worker_id),
  );
  return withCreators(rows.map(({ case: c, ...r }) => ({ ...r, ...who(n, r.staff_id, r.worker_id), case_code: c?.code ?? null })));
}

export async function listMemoEvents(memoId: string): Promise<MemoEvent[]> {
  const s = await createClient();
  const { data, error } = await s.from("cd_memo_events").select("id, from_status, to_status, note, at, actor_id").eq("memo_id", memoId).order("at");
  if (error) throw new Error(error.message);
  type Row = { id: string; from_status: string | null; to_status: string; note: string | null; at: string; actor_id: string | null };
  const rows = (data ?? []) as Row[];
  const names = await actorNames(rows.map((r) => r.actor_id));
  return rows.map(({ actor_id, ...r }) => ({ ...r, actor: actor_id ? (names.get(actor_id) ?? null) : null }));
}

// ─── Cases ─────────────────────────────────────────────────────────────────

export async function listCases(): Promise<DisciplinaryCase[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("cd_cases")
    .select("*, exit:lc_exits!exit_id(code), memos:cd_memos!case_id(id)")
    .order("opened_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Omit<DisciplinaryCase, "person_kind" | "person_name" | "person_code" | "enquiry_officer_name" | "exit_code" | "memo_count"> & {
    exit: { code: string | null } | null;
    memos: { id: string }[] | null;
  };
  const rows = (data ?? []) as Row[];
  const n = await namesOf(
    [...rows.map((r) => r.staff_id), ...rows.map((r) => r.enquiry_officer)],
    rows.map((r) => r.worker_id),
  );
  return withCreators(
    rows.map(({ exit, memos, ...r }) => ({
      ...r,
      ...who(n, r.staff_id, r.worker_id),
      enquiry_officer_name: r.enquiry_officer ? (n.staff.get(r.enquiry_officer)?.name ?? null) : null,
      exit_code: exit?.code ?? null,
      memo_count: memos?.length ?? 0,
    })),
  );
}

export async function getCaseDetail(caseId: string): Promise<{ events: CaseEvent[]; witnesses: Witness[] }> {
  const s = await createClient();
  const [ev, wt] = await Promise.all([
    s.from("cd_case_events").select("id, kind, note, at, actor_id").eq("case_id", caseId).order("at"),
    s.from("cd_case_witnesses").select("id, staff_id, worker_id, outside_name, statement, given_on").eq("case_id", caseId).order("given_on"),
  ]);
  if (ev.error) throw new Error(ev.error.message);
  if (wt.error) throw new Error(wt.error.message);
  type E = { id: string; kind: string; note: string | null; at: string; actor_id: string | null };
  type W = { id: string; staff_id: string | null; worker_id: string | null; outside_name: string | null; statement: string; given_on: string };
  const events = (ev.data ?? []) as E[];
  const wits = (wt.data ?? []) as W[];
  const [names, people] = await Promise.all([
    actorNames(events.map((e) => e.actor_id)),
    namesOf(
      wits.map((w) => w.staff_id),
      wits.map((w) => w.worker_id),
    ),
  ]);
  return {
    events: events.map(({ actor_id, ...e }) => ({ ...e, actor: actor_id ? (names.get(actor_id) ?? null) : null })),
    witnesses: wits.map((w) => ({
      id: w.id,
      name: w.outside_name ?? who(people, w.staff_id, w.worker_id).person_name,
      kind: w.outside_name ? "outside" : w.staff_id ? "staff" : "worker",
      person: w.outside_name ? null : w.staff_id ? `staff:${w.staff_id}` : w.worker_id ? `worker:${w.worker_id}` : null,
      statement: w.statement,
      given_on: w.given_on,
    })),
  };
}

// ─── Policies ──────────────────────────────────────────────────────────────

type Reachable = { id: string; kind: "staff" | "worker"; name: string; code: string | null };

/** Active people in the unit in view — the ones a policy can reach there. */
async function unitPeople(locationId: string | null): Promise<Reachable[]> {
  if (!locationId) return [];
  const s = await createClient();
  const [st, wk] = await Promise.all([
    s.from("staff").select("id, name, code").eq("is_active", true).eq("location_id", locationId).order("name"),
    s.from("workers").select("id, name, code").eq("is_active", true).eq("location_id", locationId).order("name"),
  ]);
  if (st.error) throw new Error(st.error.message);
  if (wk.error) throw new Error(wk.error.message);
  type P = { id: string; name: string; code: string | null };
  return [
    ...((st.data ?? []) as P[]).map((p) => ({ ...p, kind: "staff" as const })),
    ...((wk.data ?? []) as P[]).map((p) => ({ ...p, kind: "worker" as const })),
  ];
}

const reaches = (p: Pick<Policy, "applies_to">, kind: "staff" | "worker") => p.applies_to === "all" || p.applies_to === kind;

export async function listPolicies(opts: { isHr: boolean; myStaffId: string | null }): Promise<Policy[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("cd_policies")
    .select("*, unit:locations!location_id(name), versions:cd_policy_versions(*)")
    .order("title");
  if (error) throw new Error(error.message);
  type Row = Omit<Policy, "unit_name" | "live" | "draft" | "versions" | "reach" | "acked" | "mine_acked"> & {
    unit: { name: string } | null;
    versions: PolicyVersion[] | null;
  };
  const rows = (data ?? []) as Row[];
  const liveIds = rows.flatMap((r) => (r.versions ?? []).filter((v) => v.status === "published").map((v) => v.id));

  // Acknowledgements of the live versions RLS lets the caller see: HR → the
  // unit in view; a person → their own.
  const acks = new Map<string, { staff: Set<string>; workers: Set<string> }>();
  if (liveIds.length) {
    const { data: a, error: ae } = await s.from("cd_policy_acks").select("version_id, staff_id, worker_id").in("version_id", liveIds);
    if (ae) throw new Error(ae.message);
    for (const r of (a ?? []) as { version_id: string; staff_id: string | null; worker_id: string | null }[]) {
      const m = acks.get(r.version_id) ?? { staff: new Set<string>(), workers: new Set<string>() };
      if (r.staff_id) m.staff.add(r.staff_id);
      if (r.worker_id) m.workers.add(r.worker_id);
      acks.set(r.version_id, m);
    }
  }
  const people = opts.isHr ? await unitPeople(await getCurrentLocationId()) : [];

  const out: Policy[] = rows.map(({ unit, versions, ...r }) => {
    const vs = [...(versions ?? [])].sort((a, b) => b.version_no - a.version_no);
    const live = vs.find((v) => v.status === "published") ?? null;
    const draft = vs.find((v) => v.status === "draft") ?? null;
    const a = live ? acks.get(live.id) : undefined;
    const reached = people.filter((p) => reaches(r, p.kind));
    return {
      ...r,
      unit_name: unit?.name ?? null,
      live,
      draft,
      versions: vs,
      reach: reached.length,
      acked: reached.filter((p) => (p.kind === "staff" ? a?.staff.has(p.id) : a?.workers.has(p.id))).length,
      mine_acked: !!(opts.myStaffId && a?.staff.has(opts.myStaffId)),
    };
  });
  return withCreators(out);
}

/** Everyone the live version reaches in the unit in view, acknowledged or not. */
export async function listPolicyAcks(policy: Pick<Policy, "applies_to">, versionId: string): Promise<PolicyAck[]> {
  const s = await createClient();
  const [people, a] = await Promise.all([
    unitPeople(await getCurrentLocationId()),
    s.from("cd_policy_acks").select("id, staff_id, worker_id, acked_at, mode").eq("version_id", versionId),
  ]);
  if (a.error) throw new Error(a.error.message);
  type A = { id: string; staff_id: string | null; worker_id: string | null; acked_at: string; mode: "self" | "hr" };
  const byKey = new Map(((a.data ?? []) as A[]).map((r) => [r.staff_id ? personKey("staff", r.staff_id) : personKey("worker", r.worker_id as string), r]));
  return people
    .filter((p) => reaches(policy, p.kind))
    .map((p) => {
      const k = personKey(p.kind, p.id);
      const r = byKey.get(k);
      return { id: r?.id ?? k, person_key: k, name: p.name, code: p.code, kind: p.kind, acked_at: r?.acked_at ?? null, mode: r?.mode ?? null };
    });
}
