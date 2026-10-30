import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getAppUser, can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { fmtDate, fmtMoney } from "@/lib/format";
import { WORKFLOWS } from "@/lib/approvals/workflows";
import type {
  BalanceRow,
  Blackout,
  CompOffCredit,
  Encashment,
  Entitlement,
  LeaveType,
  LeaveYear,
  PersonOption,
  QueueItem,
  RequestCategory,
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
};

export async function timeoffViewer(): Promise<TimeoffViewer> {
  const [user, view, edit] = await Promise.all([getAppUser(), can("hr_payroll", "view"), can("hr_payroll", "edit")]);
  const myStaffId = user?.myStaffId ?? null;
  return { myStaffId, isHr: view && !myStaffId, canEdit: edit && !myStaffId };
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

// ─── Requests ──────────────────────────────────────────────────────────────

const REQUEST_SELECT =
  "id, code, staff_id, worker_id, leave_type_id, year_id, request_category, start_date, end_date, day_part, " +
  "start_time, end_time, total_days, duration_minutes, reason, status, decision_remark, decided_at, " +
  "close_reason, closed_at, created_by, created_at, " +
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
  return withCreators(((data ?? []) as unknown as RequestRaw[]).map(shapeRequest));
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
  return withCreators(
    ((data ?? []) as unknown as Raw[]).map(({ staff, worker, type, ...x }) => ({
      ...x,
      ...personOf({ staff, worker }),
      leave_name: type?.name ?? "—",
      days: num(x.days),
      rate_per_day: num(x.rate_per_day),
      amount: num(x.amount),
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
export async function getTimeoffQueue(): Promise<QueueItem[]> {
  const s = await createClient();
  const [reqs, encs, credits, mine] = await Promise.all([
    s.from("timeoff_requests").select(REQUEST_SELECT).eq("status", "pending").order("created_at"),
    s
      .from("timeoff_encashments")
      .select(
        "id, code, days, amount, reason, created_at, staff:staff!staff_id(name, code), worker:workers!worker_id(name, code), " +
          "type:timeoff_leave_types!leave_type_id(name)",
      )
      .eq("status", "pending")
      .order("created_at"),
    s
      .from("timeoff_comp_off_credits")
      .select("id, code, worked_date, credit_days, reason, had_punch, created_at, staff:staff!staff_id(name, code), worker:workers!worker_id(name, code)")
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
          q.subject_table === WORKFLOWS.timeoff_encashment.subjectTable,
      )
      .map((q) => q.subject_id),
  );

  const out: QueueItem[] = [];
  for (const r of ((reqs.data ?? []) as unknown as RequestRaw[]).map(shapeRequest)) {
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
      person_name: r.person_name,
      what: `${r.leave_name} · ${CATEGORY_LABELS[r.request_category]}`,
      when,
      amount: r.day_part === "hourly" ? fmtMinutes(r.duration_minutes) : `${fmtDays(r.total_days)} day(s)`,
      reason: r.reason,
      created_at: r.created_at,
      can_act: onMyStep.has(r.id),
    });
  }
  type EncRaw = {
    id: string;
    code: string | null;
    days: number;
    amount: number;
    reason: string;
    created_at: string;
    staff: PersonEmbed;
    worker: PersonEmbed;
    type: { name: string } | null;
  };
  for (const x of (encs.data ?? []) as unknown as EncRaw[]) {
    out.push({
      kind: "encashment",
      id: x.id,
      code: x.code,
      person_name: personOf(x).person_name,
      what: `Encashment · ${x.type?.name ?? "—"}`,
      when: "—",
      amount: `${fmtDays(num(x.days))} day(s) · ${fmtMoney(num(x.amount))}`,
      reason: x.reason,
      created_at: x.created_at,
      can_act: onMyStep.has(x.id),
    });
  }
  type CoRaw = {
    id: string;
    code: string | null;
    worked_date: string;
    credit_days: number;
    reason: string;
    had_punch: boolean;
    created_at: string;
    staff: PersonEmbed;
    worker: PersonEmbed;
  };
  const isHrEditor = (await timeoffViewer()).canEdit;
  for (const c of (credits.data ?? []) as unknown as CoRaw[]) {
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
      can_act: isHrEditor,
    });
  }
  return out;
}
