import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getAppUser, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { fmtDate, fmtMoney } from "@/lib/format";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import type {
  WorkHours,
  BalanceRow,
  Blackout,
  CompOffCredit,
  DepartmentHead,
  Encashment,
  Entitlement,
  HodOption,
  LeaveType,
  LeaveYear,
  PersonOption,
  QueueItem,
  RequestCategory,
  StageRoles,
  TimeoffRequest,
} from "./timeoff-types";
import { CATEGORY_LABELS, fmtDays, fmtMinutes, hhmm, personKey } from "./timeoff-types";

/**
 * Reads for HR ▸ Time Off (0770).
 *
 * RLS does the scoping: an HR viewer reads the unit they are working in, a
 * staff member reads only their own rows. `viewer()` is what the SCREEN needs
 * to know on top — whether to offer the whole unit's people or just "me".
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — every read below throws.
 */

export type TimeoffViewer = {
  /** Set when the login is a regular staff member (My Profile, self-service). */
  myStaffId: string | null;
  /** HR operator: may act for everyone in the current unit. */
  isHr: boolean;
  canEdit: boolean;
  /**
   * The signed-in person's own record ("staff:<id>"), WHATEVER their role — an
   * HR operator or a HOD who is also on the Staff master. Request forms open
   * with it picked (user 2026-11-14: "their name should be default pre fill
   * who signed in"); null for a login with no staff record.
   */
  meKey: string | null;
};

export async function timeoffViewer(): Promise<TimeoffViewer> {
  const [user, view, edit] = await Promise.all([getAppUser(), can("hr_payroll", "view"), can("hr_payroll", "edit")]);
  const myStaffId = user?.myStaffId ?? null;
  let meId = myStaffId;
  const email = user?.email?.trim().toLowerCase();
  if (!meId && email) {
    // Service role, by the login's own verified email: `staff_read` is unit-scoped.
    const { data } = await createAdminClient()
      .from("staff")
      .select("id")
      // `ilike` for case only — `%`, `_` and `\` escaped so an address is never a pattern.
      .ilike("email", email.replace(/[\\%_]/g, (c) => "\\" + c))
      .eq("is_active", true)
      .order("created_at")
      .limit(1);
    meId = ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
  }
  return { myStaffId, isHr: view && !myStaffId, canEdit: edit && !myStaffId, meKey: meId ? `staff:${meId}` : null };
}

/**
 * AN EMPLOYEE SEES THEIR OWN ROWS, NEVER THE UNIT'S (user 2026-11-06: "they
 * should see their details only, not all people"). RLS already reads only
 * their rows while the login holds no unit — this keeps it true if someone
 * allocates them one by mistake, where RLS would open the whole unit.
 */
export function ownRows<T extends { staff_id: string | null }>(rows: T[], v: TimeoffViewer): T[] {
  return v.myStaffId ? rows.filter((r) => r.staff_id === v.myStaffId) : rows;
}

function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}
function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}
type PersonEmbed = { name: string | null; code: string | null } | null;
function personOf(r: { staff?: PersonEmbed; worker?: PersonEmbed }): { person_name: string; person_code: string | null } {
  const p = r.staff ?? r.worker ?? null;
  return { person_name: p?.name ?? "—", person_code: p?.code ?? null };
}

// ─── People ────────────────────────────────────────────────────────────────

/** Who the operator may apply for: everyone active in the unit (HR), or themself. */
export async function listTimeoffPeople(v: TimeoffViewer): Promise<PersonOption[]> {
  const s = await createClient();
  if (v.myStaffId) {
    const { data, error } = await s.rpc("timeoff_my_staff_id");
    if (error) throw new Error(error.message);
    const id = (data as string | null) ?? v.myStaffId;
    // A self-service login usually holds no unit, so the staff table's own RLS
    // hides the row; the balance sheet (SECURITY DEFINER) names it instead.
    const yr = await currentYearId();
    const sheet = yr ? await getBalanceSheet(yr, { staff_id: id }) : [];
    const name = sheet[0]?.person_name ?? "Me";
    return [{ key: personKey("staff", id), kind: "staff", id, name, code: sheet[0]?.person_code ?? null, gender: null }];
  }
  if (!v.isHr) return [];
  const [st, wk] = await Promise.all([
    s.from("staff").select("id, code, name, gender").eq("is_active", true).order("name"),
    s.from("workers").select("id, code, name, gender").eq("is_active", true).order("name"),
  ]);
  if (st.error) throw new Error(st.error.message);
  if (wk.error) throw new Error(wk.error.message);
  type P = { id: string; code: string | null; name: string; gender: string | null };
  return [
    ...((st.data ?? []) as P[]).map((p) => ({ key: personKey("staff", p.id), kind: "staff" as const, ...p })),
    ...((wk.data ?? []) as P[]).map((p) => ({ key: personKey("worker", p.id), kind: "worker" as const, ...p })),
  ];
}

// ─── Catalog ───────────────────────────────────────────────────────────────

export async function listLeaveTypes(): Promise<LeaveType[]> {
  const s = await createClient();
  const { data, error } = await s.from("timeoff_leave_types").select("*").order("sort_order").order("code");
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as LeaveType[]).map((t) => ({
    ...t,
    default_entitled_days: num(t.default_entitled_days),
    accrual_rate: numOrNull(t.accrual_rate),
    max_continuous_days: numOrNull(t.max_continuous_days),
    max_days_per_period: numOrNull(t.max_days_per_period),
    max_carry_forward_days: numOrNull(t.max_carry_forward_days),
    max_encashable_days: numOrNull(t.max_encashable_days),
  }));
  return withCreators(rows);
}

export async function listYears(): Promise<LeaveYear[]> {
  const s = await createClient();
  const { data, error } = await s.from("timeoff_years").select("*").order("start_date");
  if (error) throw new Error(error.message);
  return withCreators((data ?? []) as LeaveYear[]);
}

export async function currentYearId(): Promise<string | null> {
  const s = await createClient();
  const { data, error } = await s.rpc("timeoff_year_of", { p_day: today() });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function listBlackouts(): Promise<Blackout[]> {
  const s = await createClient();
  const { data, error } = await s.from("timeoff_blackouts").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return withCreators((data ?? []) as Blackout[]);
}

// ─── Approval flow: department heads (0817) ────────────────────────────────

/** Every active department and who heads it. */
export async function listDepartmentHeads(): Promise<DepartmentHead[]> {
  const s = await createClient();
  const [deps, heads] = await Promise.all([
    s.from("departments").select("id, name, inactive").order("name"),
    s.from("hr_department_heads").select("department_id, staff_id"),
  ]);
  if (deps.error) throw new Error(deps.error.message);
  // PGRST205 / 42P01: 0817 not applied yet — every department reads "no HOD".
  const missing = heads.error?.code === "PGRST205" || heads.error?.code === "42P01";
  if (heads.error && !missing) throw new Error(heads.error.message);
  const hod = new Map(((heads.data ?? []) as { department_id: string; staff_id: string }[]).map((h) => [h.department_id, h.staff_id]));
  return ((deps.data ?? []) as { id: string; name: string; inactive: boolean | null }[])
    // A switched-off department keeps its row only while it still names an HOD.
    .filter((d) => !d.inactive || hod.has(d.id))
    .map((d) => ({ department_id: d.id, department_name: d.name, hod_staff_id: hod.get(d.id) ?? null }));
}

/**
 * The HR and ED stages' roles (0842) and every role with who holds it. The
 * holders are read with the service role: `user_roles` / `profiles` let a user
 * see only their own rows, and HR needs to see who a stage would reach.
 */
export async function getStageRoles(): Promise<StageRoles | null> {
  if (!(await can("hr_payroll", "view"))) return null;
  const s = await createClient();
  const set = await s.from("hr_approval_settings").select("hr_role_id, ed_role_id").maybeSingle();
  // 0842 not applied yet — the screen says so instead of offering a picker.
  if (set.error?.code === "PGRST205" || set.error?.code === "42P01") return null;
  if (set.error) throw new Error(set.error.message);
  const admin = createAdminClient();
  const [roles, held, people] = await Promise.all([
    admin.from("roles").select("id, name").order("name"),
    admin.from("user_roles").select("role_id, user_id"),
    admin.from("profiles").select("id, full_name, email, is_active"),
  ]);
  for (const r of [roles, held, people]) if (r.error) throw new Error(r.error.message);
  const nameOf = new Map(
    ((people.data ?? []) as { id: string; full_name: string | null; email: string | null; is_active: boolean | null }[])
      .filter((p) => p.is_active !== false)
      .map((p) => [p.id, p.full_name || p.email || "—"]),
  );
  const heldBy = new Map<string, string[]>();
  for (const h of (held.data ?? []) as { role_id: string; user_id: string }[]) {
    const n = nameOf.get(h.user_id);
    if (n) heldBy.set(h.role_id, [...(heldBy.get(h.role_id) ?? []), n]);
  }
  return {
    hr_role_id: (set.data as { hr_role_id: string | null } | null)?.hr_role_id ?? null,
    ed_role_id: (set.data as { ed_role_id: string | null } | null)?.ed_role_id ?? null,
    roles: ((roles.data ?? []) as { id: string; name: string }[]).map((r) => ({
      id: r.id,
      name: r.name,
      holders: (heldBy.get(r.id) ?? []).sort(),
    })),
  };
}

/** Active staff, for the HOD picker. */
export async function listHodOptions(): Promise<HodOption[]> {
  const s = await createClient();
  const { data, error } = await s.from("staff").select("id, name, code, department_id").eq("is_active", true).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as HodOption[];
}

// ─── Requests ──────────────────────────────────────────────────────────────

const REQUEST_SELECT =
  "id, code, staff_id, worker_id, leave_type_id, year_id, request_category, start_date, end_date, day_part, " +
  "start_time, end_time, total_days, duration_minutes, reason, status, decision_remark, decided_at, " +
  "close_reason, closed_at, attachment_path, attachment_name, created_by, created_at, " +
  "staff:staff!staff_id(name, code), worker:workers!worker_id(name, code), " +
  "type:timeoff_leave_types!leave_type_id(code, name, color)";

type RequestRaw = Omit<TimeoffRequest, "person_name" | "person_code" | "leave_code" | "leave_name" | "leave_color"> & {
  staff: PersonEmbed;
  worker: PersonEmbed;
  type: { code: string; name: string; color: string } | null;
};

function shapeRequest({ staff, worker, type, ...r }: RequestRaw): TimeoffRequest {
  return {
    ...r,
    ...personOf({ staff, worker }),
    leave_code: type?.code ?? "—",
    leave_name: type?.name ?? "—",
    leave_color: type?.color ?? "#64748b",
    total_days: num(r.total_days),
  };
}

/** Requests of the given kinds, in entry order. */
export async function listRequests(categories: RequestCategory[]): Promise<TimeoffRequest[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("timeoff_requests")
    .select(REQUEST_SELECT)
    .in("request_category", categories)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as unknown as RequestRaw[]).map(shapeRequest);
  // A pending request says how far it has got — "1 of 3 approved · now HR Manager".
  const stage = await stagesOf(WORKFLOWS.timeoff_request.subjectTable, rows.filter((r) => r.status === "pending").map((r) => r.id));
  return withCreators(rows.map((r) => ({ ...r, stage: stage.get(r.id)?.stage ?? null })));
}

/** Approved leave overlapping a date range — the calendar. */
export async function listApprovedBetween(from: string, to: string): Promise<TimeoffRequest[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("timeoff_requests")
    .select(REQUEST_SELECT)
    .eq("status", "approved")
    .lte("start_date", to)
    .gte("end_date", from)
    .order("start_date");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RequestRaw[]).map(shapeRequest);
}

// ─── Comp-off credits ──────────────────────────────────────────────────────

export async function listCredits(): Promise<CompOffCredit[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("timeoff_comp_off_credits")
    .select(
      "id, code, staff_id, worker_id, worked_date, credit_days, reason, had_punch, status, expires_on, consumed_by, " +
        "decision_remark, created_by, created_at, staff:staff!staff_id(name, code), worker:workers!worker_id(name, code)",
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const t = today();
  type Raw = Omit<CompOffCredit, "person_name" | "person_code" | "expired"> & { staff: PersonEmbed; worker: PersonEmbed };
  return withCreators(
    ((data ?? []) as unknown as Raw[]).map(({ staff, worker, ...c }) => ({
      ...c,
      ...personOf({ staff, worker }),
      credit_days: num(c.credit_days),
      expired: c.status === "approved" && c.expires_on < t,
    })),
  );
}

// ─── Encashments ───────────────────────────────────────────────────────────

export async function listEncashments(): Promise<Encashment[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("timeoff_encashments")
    .select(
      "id, code, staff_id, worker_id, leave_type_id, days, rate_per_day, amount, reason, status, decision_remark, " +
        "paid_at, paid_ref, created_by, created_at, staff:staff!staff_id(name, code), worker:workers!worker_id(name, code), " +
        "type:timeoff_leave_types!leave_type_id(name)",
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  type Raw = Omit<Encashment, "person_name" | "person_code" | "leave_name"> & {
    staff: PersonEmbed;
    worker: PersonEmbed;
    type: { name: string } | null;
  };
  const raw = (data ?? []) as unknown as Raw[];
  const stage = await stagesOf(WORKFLOWS.timeoff_encashment.subjectTable, raw.filter((x) => x.status === "pending").map((x) => x.id));
  return withCreators(
    raw.map(({ staff, worker, type, ...x }) => ({
      ...x,
      ...personOf({ staff, worker }),
      leave_name: type?.name ?? "—",
      days: num(x.days),
      rate_per_day: num(x.rate_per_day),
      amount: num(x.amount),
      stage: stage.get(x.id)?.stage ?? null,
    })),
  );
}

// ─── Balances ──────────────────────────────────────────────────────────────

export async function getBalanceSheet(
  yearId: string,
  person?: { staff_id?: string | null; worker_id?: string | null },
): Promise<BalanceRow[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("timeoff_balance_sheet", {
    p_year: yearId,
    p_staff: person?.staff_id ?? null,
    p_worker: person?.worker_id ?? null,
    p_as_of: null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as BalanceRow[]).map((b) => ({
    ...b,
    entitled: num(b.entitled),
    accrued: num(b.accrued),
    carried: num(b.carried),
    used: num(b.used),
    pending: num(b.pending),
    encashed: num(b.encashed),
    available: num(b.available),
  }));
}

export async function listEntitlements(yearId: string): Promise<Entitlement[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("timeoff_entitlements")
    .select("id, year_id, leave_type_id, staff_id, worker_id, entitled_days, carried_forward, opening_used, reason")
    .eq("year_id", yearId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Entitlement[]).map((e) => ({
    ...e,
    entitled_days: numOrNull(e.entitled_days),
    carried_forward: num(e.carried_forward),
    opening_used: num(e.opening_used),
  }));
}

// ─── Approvals queue ───────────────────────────────────────────────────────

/**
 * What is waiting, for the Time Off ▸ Approvals screen: pending requests and
 * encashments (decided through the approval engine — `can_act` says whether
 * the signed-in user is on the current step), and pending comp-off claims
 * (decided directly by HR, as in MyJKKN).
 */
type EncRaw = {
  id: string;
  code: string | null;
  staff_id: string | null;
  worker_id: string | null;
  days: number;
  amount: number;
  reason: string;
  created_at: string;
  staff: PersonEmbed;
  worker: PersonEmbed;
  type: { name: string } | null;
};

/**
 * Which stage each open request is with — "Waiting for Department HOD", "Sent
 * to HR Manager" — and the
 * person's name from the run (0817 `hr_approval_stage`). An HOD without a
 * unit reads the request but not the staff row it embeds, so the run's
 * snapshot of the name stands in.
 */
async function stagesOf(table: string, ids: string[]): Promise<Map<string, { stage: string; person: string | null }>> {
  const out = new Map<string, { stage: string; person: string | null }>();
  if (!ids.length) return out;
  const s = await createClient();
  const { data, error } = await s.rpc("hr_approval_stage", { p_subject_table: table, p_ids: ids });
  // PGRST202: 0817 not applied yet — the queue still works, just without the stage.
  if (error?.code === "PGRST202") return out;
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { subject_id: string; step_no: number; step_total: number; step_label: string | null; person_name: string | null }[]) {
    const label = r.step_label ?? `Step ${r.step_no}`;
    // Nobody has approved a pending request — whoever has it decides, and it
    // only climbs when sent on (0820, user 2026-11-06: no "1 of 3 approved").
    const stage = r.step_no > 1 ? `Sent to ${label}` : `Waiting for ${label}`;
    out.set(r.subject_id, { stage, person: r.person_name });
  }
  return out;
}

export async function getTimeoffQueue(): Promise<QueueItem[]> {
  const s = await createClient();
  const [reqs, encs, credits, mine] = await Promise.all([
    s.from("timeoff_requests").select(REQUEST_SELECT).eq("status", "pending").order("created_at"),
    s
      .from("timeoff_encashments")
      .select(
        "id, code, staff_id, worker_id, days, amount, reason, created_at, staff:staff!staff_id(name, code), worker:workers!worker_id(name, code), " +
          "type:timeoff_leave_types!leave_type_id(name)",
      )
      .eq("status", "pending")
      .order("created_at"),
    s
      .from("timeoff_comp_off_credits")
      .select("id, code, staff_id, worker_id, worked_date, credit_days, reason, had_punch, created_at, staff:staff!staff_id(name, code), worker:workers!worker_id(name, code)")
      .eq("status", "pending")
      .order("created_at"),
    s.rpc("approval_my_queue", { p_workflow_key: null, p_tenant_id: null, p_limit: 500, p_offset: 0 }),
  ]);
  if (reqs.error) throw new Error(reqs.error.message);
  if (encs.error) throw new Error(encs.error.message);
  if (credits.error) throw new Error(credits.error.message);
  // The engine's inbox may refuse a login without approvals access; that only
  // means "nothing is on your step", never an empty page.
  const onMyStep = new Set(
    ((mine.data ?? []) as { subject_table: string; subject_id: string }[])
      .filter(
        (q) =>
          q.subject_table === WORKFLOWS.timeoff_request.subjectTable ||
          q.subject_table === WORKFLOWS.timeoff_encashment.subjectTable ||
          q.subject_table === WORKFLOWS.timeoff_comp_off.subjectTable,
      )
      .map((q) => q.subject_id),
  );

  const reqRows = ((reqs.data ?? []) as unknown as RequestRaw[]).map(shapeRequest);
  const encRows = (encs.data ?? []) as unknown as EncRaw[];
  const [reqStage, encStage] = await Promise.all([
    stagesOf(WORKFLOWS.timeoff_request.subjectTable, reqRows.map((r) => r.id)),
    stagesOf(WORKFLOWS.timeoff_encashment.subjectTable, encRows.map((x) => x.id)),
  ]);

  const out: QueueItem[] = [];
  for (const r of reqRows) {
    const when =
      r.day_part === "hourly"
        ? `${fmtDate(r.start_date)} ${hhmm(r.start_time)}–${hhmm(r.end_time)}`
        : r.start_date === r.end_date
          ? fmtDate(r.start_date) + (r.day_part === "full" ? "" : r.day_part === "first_half" ? " (1st half)" : " (2nd half)")
          : `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`;
    out.push({
      kind: "request",
      id: r.id,
      code: r.code,
      person_name: r.person_name === "—" ? (reqStage.get(r.id)?.person ?? "—") : r.person_name,
      what: `${r.leave_name} · ${CATEGORY_LABELS[r.request_category]}`,
      when,
      amount: r.day_part === "hourly" ? fmtMinutes(r.duration_minutes) : `${fmtDays(r.total_days)} day(s)`,
      reason: r.reason,
      attachment_path: r.attachment_path,
      attachment_name: r.attachment_name,
      created_at: r.created_at,
      can_act: onMyStep.has(r.id),
      stage: reqStage.get(r.id)?.stage ?? null,
      status: "pending",
      staff_id: r.staff_id,
      worker_id: r.worker_id,
    });
  }
  for (const x of encRows) {
    const named = personOf(x).person_name;
    out.push({
      kind: "encashment",
      id: x.id,
      code: x.code,
      person_name: named === "—" ? (encStage.get(x.id)?.person ?? "—") : named,
      what: `Encashment · ${x.type?.name ?? "—"}`,
      when: "—",
      amount: `${fmtDays(num(x.days))} day(s) · ${fmtMoney(num(x.amount))}`,
      reason: x.reason,
      created_at: x.created_at,
      can_act: onMyStep.has(x.id),
      stage: encStage.get(x.id)?.stage ?? null,
      status: "pending",
      staff_id: x.staff_id,
      worker_id: x.worker_id,
    });
  }
  type CoRaw = {
    id: string;
    code: string | null;
    staff_id: string | null;
    worker_id: string | null;
    worked_date: string;
    credit_days: number;
    reason: string;
    had_punch: boolean;
    created_at: string;
    staff: PersonEmbed;
    worker: PersonEmbed;
  };
  const isHrEditor = (await timeoffViewer()).canEdit;
  const coRows = (credits.data ?? []) as unknown as CoRaw[];
  const coStage = await stagesOf(WORKFLOWS.timeoff_comp_off.subjectTable, coRows.map((c) => c.id));
  for (const c of coRows) {
    // On the three stages (0835) the run says who decides; a claim filed
    // before then has no run and is still HR's to decide.
    const st = coStage.get(c.id);
    const named = personOf(c).person_name;
    out.push({
      kind: "claim",
      id: c.id,
      code: c.code,
      person_name: named === "—" ? (st?.person ?? "—") : named,
      what: `Comp-off claim${c.had_punch ? " · punch found" : " · no punch that day"}`,
      when: `Worked ${fmtDate(c.worked_date)}`,
      amount: `${fmtDays(num(c.credit_days))} day credit`,
      reason: c.reason,
      created_at: c.created_at,
      can_act: st ? onMyStep.has(c.id) : isHrEditor,
      stage: st?.stage ?? "HR",
      status: "pending",
      staff_id: c.staff_id,
      worker_id: c.worker_id,
    });
  }
  return [...out, ...(await decidedItems())];
}

/**
 * WHAT HAS BEEN DECIDED — Time Off Approvals ▸ Decided (user 2026-11-06: "I
 * want to see the approved wording in green"). The queue held pending rows
 * only, so a request vanished the moment it was approved and the screen never
 * said "Approved" at all. The last 60 days, newest first, read under the same
 * RLS as the pending list (HR of the unit, an HOD's department).
 */
async function decidedItems(): Promise<QueueItem[]> {
  const s = await createClient();
  const since = new Date(Date.now() - 60 * 86400e3).toISOString();
  const [reqs, encs, credits] = await Promise.all([
    s
      .from("timeoff_requests")
      .select(REQUEST_SELECT + ", decided_by")
      .in("status", ["approved", "rejected"])
      .gte("decided_at", since)
      .order("decided_at", { ascending: false })
      .limit(150),
    s
      .from("timeoff_encashments")
      .select(
        "id, code, staff_id, worker_id, status, days, amount, reason, created_at, decided_at, decided_by, staff:staff!staff_id(name, code), " +
          "worker:workers!worker_id(name, code), type:timeoff_leave_types!leave_type_id(name)",
      )
      .in("status", ["approved", "rejected", "paid"])
      .gte("decided_at", since)
      .order("decided_at", { ascending: false })
      .limit(150),
    s
      .from("timeoff_comp_off_credits")
      .select(
        "id, code, staff_id, worker_id, status, worked_date, credit_days, reason, had_punch, created_at, decided_at, decided_by, " +
          "staff:staff!staff_id(name, code), worker:workers!worker_id(name, code)",
      )
      .in("status", ["approved", "rejected", "consumed"])
      .gte("decided_at", since)
      .order("decided_at", { ascending: false })
      .limit(150),
  ]);
  // An enrichment beside the pending list: a failed read leaves Decided empty.
  if (reqs.error || encs.error || credits.error) return [];

  type Decided = { id: string; decided_at: string | null; decided_by: string | null };
  const reqRows = ((reqs.data ?? []) as unknown as (RequestRaw & Decided)[]).map((r) => ({ ...shapeRequest(r), decided_by: r.decided_by }));
  const encRows = (encs.data ?? []) as unknown as (EncRaw & Decided & { status: string })[];
  const coRows = (credits.data ?? []) as unknown as ({
    id: string;
    code: string | null;
    staff_id: string | null;
    worker_id: string | null;
    status: string;
    worked_date: string;
    credit_days: number;
    reason: string;
    had_punch: boolean;
    created_at: string;
    staff: PersonEmbed;
    worker: PersonEmbed;
  } & Decided)[];

  // Who decided, by name — the app's one resolver (creator_names), via withCreators.
  const deciders = await withCreators(
    [...reqRows, ...encRows, ...coRows].map((r) => ({ id: r.id, created_by: r.decided_by ?? "" })),
  );
  const by = new Map(deciders.map((d) => [d.id, (d as { created_by_name?: string | null }).created_by_name ?? null]));
  // An HOD reads the request but not the staff row it names: the run carries the name (0817).
  const ids = [...reqRows.map((r) => r.id), ...encRows.map((x) => x.id)];
  const runNames = new Map<string, string>();
  if (ids.length) {
    const { data } = await s.from("approval_runs").select("subject_id, context").in("subject_id", ids);
    for (const r of (data ?? []) as { subject_id: string; context: { person_name?: string } | null }[])
      if (r.context?.person_name) runNames.set(r.subject_id, r.context.person_name);
  }
  const decided = (id: string, at: string | null) =>
    [by.get(id), at ? fmtDate(at) : null].filter(Boolean).join(" · ") || null;

  const out: QueueItem[] = [];
  for (const r of reqRows) {
    out.push({
      kind: "request",
      id: r.id,
      code: r.code,
      person_name: r.person_name === "—" ? (runNames.get(r.id) ?? "—") : r.person_name,
      what: `${r.leave_name} · ${CATEGORY_LABELS[r.request_category]}`,
      when: whenOf(r),
      amount: r.day_part === "hourly" ? fmtMinutes(r.duration_minutes) : `${fmtDays(r.total_days)} day(s)`,
      reason: r.reason,
      created_at: r.created_at,
      can_act: false,
      stage: null,
      status: r.status,
      decided: decided(r.id, r.decided_at),
      staff_id: r.staff_id,
      worker_id: r.worker_id,
    });
  }
  for (const x of encRows) {
    const named = personOf(x).person_name;
    out.push({
      kind: "encashment",
      id: x.id,
      code: x.code,
      person_name: named === "—" ? (runNames.get(x.id) ?? "—") : named,
      what: `Encashment · ${x.type?.name ?? "—"}`,
      when: "—",
      amount: `${fmtDays(num(x.days))} day(s) · ${fmtMoney(num(x.amount))}`,
      reason: x.reason,
      created_at: x.created_at,
      can_act: false,
      stage: null,
      status: x.status,
      decided: decided(x.id, x.decided_at),
      staff_id: x.staff_id,
      worker_id: x.worker_id,
    });
  }
  for (const c of coRows) {
    out.push({
      kind: "claim",
      id: c.id,
      code: c.code,
      person_name: personOf(c).person_name,
      what: `Comp-off claim${c.had_punch ? " · punch found" : " · no punch that day"}`,
      when: `Worked ${fmtDate(c.worked_date)}`,
      amount: `${fmtDays(num(c.credit_days))} day credit`,
      reason: c.reason,
      created_at: c.created_at,
      can_act: false,
      stage: null,
      // A credit used for a leave was approved first; to the approver it reads Approved.
      status: c.status === "consumed" ? "approved" : c.status,
      decided: decided(c.id, c.decided_at),
      staff_id: c.staff_id,
      worker_id: c.worker_id,
    });
  }
  return out;
}

/** "05/11/2026", "05/11/2026 (1st half)", "05/11/2026 10:00–12:00", or a range. */
function whenOf(r: { day_part: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null }): string {
  return r.day_part === "hourly"
    ? `${fmtDate(r.start_date)} ${hhmm(r.start_time)}–${hhmm(r.end_time)}`
    : r.start_date === r.end_date
      ? fmtDate(r.start_date) + (r.day_part === "full" ? "" : r.day_part === "first_half" ? " (1st half)" : " (2nd half)")
      : `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`;
}

/**
 * Each person's timing group and every group's dated hours (0769) — for
 * Permission's time lists. Read with the admin client: a self-service login
 * holds no unit, so the staff table's RLS would hide its own category. Only
 * the group word and the hours leave the server.
 */
export async function getWorkHours(people: PersonOption[]): Promise<WorkHours> {
  const admin = createAdminClient();
  const staffIds = people.filter((p) => p.kind === "staff").map((p) => p.id);
  const workerIds = people.filter((p) => p.kind === "worker").map((p) => p.id);
  type Row = { id: string; category: { timing_group: string | null } | null };
  const [st, wk, tm] = await Promise.all([
    staffIds.length
      ? admin.from("staff").select("id, category:employee_categories!category_id(timing_group)").in("id", staffIds)
      : Promise.resolve({ data: [], error: null }),
    workerIds.length
      ? admin.from("workers").select("id, category:employee_categories!category_id(timing_group)").in("id", workerIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("hr_group_timings").select("timing_group, in_time, out_time, effective_from").order("effective_from"),
  ]);
  if (st.error) throw new Error(st.error.message);
  if (wk.error) throw new Error(wk.error.message);
  if (tm.error) throw new Error(tm.error.message);
  const groupOf: Record<string, string> = {};
  for (const r of (st.data ?? []) as unknown as Row[]) if (r.category?.timing_group) groupOf[personKey("staff", r.id)] = r.category.timing_group;
  for (const r of (wk.data ?? []) as unknown as Row[]) if (r.category?.timing_group) groupOf[personKey("worker", r.id)] = r.category.timing_group;
  const timings = ((tm.data ?? []) as { timing_group: string; in_time: string; out_time: string; effective_from: string }[]).map(
    (t) => ({ group: t.timing_group, in_time: t.in_time, out_time: t.out_time, effective_from: t.effective_from }),
  );
  return { groupOf, timings };
}
