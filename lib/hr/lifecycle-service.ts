import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { today } from "@/lib/calendar";
import type {
  Asset,
  ChecklistTemplate,
  DocStatus,
  ExitCase,
  ExitStep,
  ExitStepCatalog,
  LcSettings,
  Onboarding,
  OnboardingStep,
  PersonDocument,
  RequiredDocument,
  RetirementDue,
  Settlement,
} from "./lifecycle-types";

/**
 * Reads for HR ▸ Team Lifecycle (0766).
 *
 * RLS does the scoping: an HR viewer reads the unit they are working in, a
 * staff member reads only their own rows. The people list and the "who is
 * looking" question are Time Off's (`timeoffViewer`, `listTimeoffPeople`) —
 * one answer for both phases.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — every read below throws.
 */

export { timeoffViewer as lifecycleViewer, listTimeoffPeople as listLifecyclePeople } from "./timeoff-service";

type PersonEmbed = { name: string | null; code: string | null } | null;
const PERSON = "staff:staff!staff_id(name, code), worker:workers!worker_id(name, code)";

function personOf(r: { staff?: PersonEmbed; worker?: PersonEmbed }): { person_name: string; person_code: string | null } {
  const p = r.staff ?? r.worker ?? null;
  // A self-service login holds no unit, so the people tables' own RLS hides
  // the embed — but every row it can read is its own.
  return { person_name: p?.name ?? "Me", person_code: p?.code ?? null };
}
function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ─── Settings + catalogs ───────────────────────────────────────────────────

export async function getLcSettings(): Promise<LcSettings> {
  const s = await createClient();
  const { data, error } = await s.from("lc_settings").select("*").eq("id", true).maybeSingle();
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Partial<LcSettings>;
  return {
    retirement_age: num(d.retirement_age ?? 60),
    retirement_lookahead: num(d.retirement_lookahead ?? 6),
    notice_days_staff: num(d.notice_days_staff ?? 30),
    notice_days_workers: num(d.notice_days_workers ?? 15),
    gratuity_min_years: num(d.gratuity_min_years ?? 5),
    gratuity_cap: num(d.gratuity_cap ?? 2000000),
  };
}

export async function listTemplates(): Promise<ChecklistTemplate[]> {
  const s = await createClient();
  const { data, error } = await s.from("lc_checklist_templates").select("*").order("name");
  if (error) throw new Error(error.message);
  return withCreators((data ?? []) as ChecklistTemplate[]);
}

export async function listRequiredDocs(): Promise<RequiredDocument[]> {
  const s = await createClient();
  const { data, error } = await s.from("lc_required_documents").select("*").order("sort_order").order("code");
  if (error) throw new Error(error.message);
  return withCreators((data ?? []) as RequiredDocument[]);
}

export async function listExitCatalog(): Promise<ExitStepCatalog[]> {
  const s = await createClient();
  const { data, error } = await s.from("lc_exit_step_catalog").select("*").order("sort_order");
  if (error) throw new Error(error.message);
  return withCreators((data ?? []) as ExitStepCatalog[]);
}

// ─── Joining ───────────────────────────────────────────────────────────────

export async function listOnboardings(): Promise<Onboarding[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("lc_onboardings")
    .select(`*, ${PERSON}, steps:lc_onboarding_steps(done, due_date)`)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const t0 = today();
  type Row = Onboarding & { staff?: PersonEmbed; worker?: PersonEmbed; steps?: { done: boolean; due_date: string | null }[] };
  const rows = ((data ?? []) as Row[]).map(({ staff, worker, steps, ...r }) => ({
    ...r,
    ...personOf({ staff, worker }),
    steps_total: steps?.length ?? 0,
    steps_done: steps?.filter((x) => x.done).length ?? 0,
    steps_overdue: steps?.filter((x) => !x.done && x.due_date != null && x.due_date < t0).length ?? 0,
  }));
  return withCreators(rows);
}

export async function getOnboardingSteps(onboardingId: string): Promise<OnboardingStep[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("lc_onboarding_steps")
    .select("id, onboarding_id, sort_order, title, owner, due_date, done, done_at, note")
    .eq("onboarding_id", onboardingId)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as OnboardingStep[];
}

// ─── Documents ─────────────────────────────────────────────────────────────

/** The current upload of every document (superseded ones are history). */
export async function listDocuments(opts: { status?: DocStatus } = {}): Promise<PersonDocument[]> {
  const s = await createClient();
  let q = s
    .from("lc_documents")
    .select(`*, ${PERSON}`)
    .eq("superseded", false)
    .order("created_at", { ascending: false });
  if (opts.status && opts.status !== "expired") q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const t0 = today();
  type Row = PersonDocument & { staff?: PersonEmbed; worker?: PersonEmbed };
  const rows = ((data ?? []) as Row[]).map(({ staff, worker, ...r }) => {
    const expires_in = r.expires_on ? daysBetween(t0, r.expires_on) : null;
    const status: DocStatus = r.status === "verified" && expires_in != null && expires_in < 0 ? "expired" : r.status;
    return { ...r, ...personOf({ staff, worker }), size_bytes: r.size_bytes == null ? null : Number(r.size_bytes), expires_in, status };
  });
  return withCreators(opts.status === "expired" ? rows.filter((r) => r.status === "expired") : rows);
}

// ─── Assets ────────────────────────────────────────────────────────────────

export async function listAssets(): Promise<Asset[]> {
  const s = await createClient();
  const { data, error } = await s.from("lc_assets").select(`*, ${PERSON}`).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Asset & { staff?: PersonEmbed; worker?: PersonEmbed };
  const rows = ((data ?? []) as Row[]).map(({ staff, worker, ...r }) => ({
    ...r,
    ...personOf({ staff, worker }),
    value: r.value == null ? null : Number(r.value),
    recovery_amount: r.recovery_amount == null ? null : Number(r.recovery_amount),
  }));
  return withCreators(rows);
}

// ─── Exits ─────────────────────────────────────────────────────────────────

export async function listExits(): Promise<ExitCase[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("lc_exits")
    .select(`*, ${PERSON}, steps:lc_exit_steps(done), settlements:lc_settlements(status)`)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = ExitCase & {
    staff?: PersonEmbed;
    worker?: PersonEmbed;
    steps?: { done: boolean }[];
    settlements?: { status: string }[];
  };
  const LIVE = ["draft", "pending", "approved", "paid"];
  const rows = ((data ?? []) as Row[]).map(({ staff, worker, steps, settlements, ...r }) => ({
    ...r,
    ...personOf({ staff, worker }),
    steps_total: steps?.length ?? 0,
    steps_done: steps?.filter((x) => x.done).length ?? 0,
    settlement_status: settlements?.find((x) => LIVE.includes(x.status))?.status ?? null,
  }));
  return withCreators(rows);
}

export async function getExitSteps(exitId: string): Promise<ExitStep[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("lc_exit_steps")
    .select("id, exit_id, step_key, label, sort_order, done, done_at, note")
    .eq("exit_id", exitId)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as ExitStep[];
}

export async function listRetirementsDue(): Promise<RetirementDue[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("lc_retirements_due");
  if (error) throw new Error(error.message);
  return ((data ?? []) as RetirementDue[]).map((r) => ({ ...r, age_now: num(r.age_now) }));
}

// ─── Full & final ──────────────────────────────────────────────────────────

const MONEY = [
  "basic_da",
  "daily_wage",
  "service_years",
  "gratuity",
  "leave_days",
  "leave_amount",
  "salary_due",
  "bonus_due",
  "other_earnings",
  "notice_short_days",
  "notice_recovery",
  "advance_recovery",
  "asset_recovery",
  "other_deductions",
  "net_payable",
] as const;

export async function listSettlements(): Promise<Settlement[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("lc_settlements")
    .select(`*, ${PERSON}, exit:lc_exits!exit_id(code, separation_type, last_working_day)`)
    .neq("status", "superseded")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Settlement & {
    staff?: PersonEmbed;
    worker?: PersonEmbed;
    exit?: { code: string | null; separation_type: Settlement["separation_type"]; last_working_day: string } | null;
  };
  const rows = ((data ?? []) as Row[]).map(({ staff, worker, exit, ...r }) => {
    const out = {
      ...r,
      ...personOf({ staff, worker }),
      exit_code: exit?.code ?? null,
      separation_type: exit?.separation_type ?? "resignation",
      last_working_day: exit?.last_working_day ?? "",
      completed_years: num(r.completed_years),
    } as Settlement;
    for (const k of MONEY) (out as Record<string, unknown>)[k] = num(r[k]);
    return out;
  });
  return withCreators(rows);
}
