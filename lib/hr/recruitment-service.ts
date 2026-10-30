import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { staffNames } from "@/lib/people/order-people";
import { isInactive } from "@/lib/masters/inactive";
import type {
  Candidate,
  CandidateEvent,
  CandidateStatus,
  DesignationOption,
  Interview,
  Job,
  Option,
  Scorecard,
} from "./recruitment-types";
import { LIVE_STATUSES } from "./recruitment-types";

/**
 * Reads for HR ▸ Recruitment (0767).
 *
 * RLS does the scoping: HR reads the unit they are working in; a panel member
 * reads the interviews they sit on, those candidates, and their own marks.
 * Staff names (panel, referrer) come through `staffNames` — the one narrow
 * read of names past the staff table's payroll-only RLS — so a panel member
 * sees who else is on the panel.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — every read below throws.
 */

export { timeoffViewer as recruitmentViewer, listTimeoffPeople as listRecruitmentPeople } from "./timeoff-service";

type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

// ─── Options ───────────────────────────────────────────────────────────────

export async function listDepartmentOptions(): Promise<Option[]> {
  const s = await createClient();
  const { data, error } = await s.from("departments").select("id, short_name, name, blocked").order("short_name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; short_name: string; name: string | null; blocked: boolean }[]).map((d) => ({
    id: d.id,
    name: d.name || d.short_name,
    inactive: isInactive(d),
  }));
}

export async function listDesignationOptions(): Promise<DesignationOption[]> {
  const s = await createClient();
  const { data, error } = await s.from("designations").select("id, name, for_type, blocked, is_draft").order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string; for_type: DesignationOption["for_type"]; blocked: boolean; is_draft: boolean }[])
    .filter((d) => !d.is_draft)
    .map((d) => ({ id: d.id, name: d.name, for_type: d.for_type, inactive: isInactive(d) }));
}

// ─── Jobs ──────────────────────────────────────────────────────────────────

export async function listJobs(): Promise<Job[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("rc_jobs")
    .select(
      "*, department:departments!department_id(short_name, name), designation:designations!designation_id(name), cands:rc_candidates(status)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Omit<Job, "department_name" | "designation_name" | "counts"> & {
    department: One<{ short_name: string; name: string | null }>;
    designation: One<{ name: string }>;
    cands: { status: CandidateStatus }[] | null;
  };
  const rows = ((data ?? []) as Row[]).map(({ department, designation, cands, ...r }) => {
    const c = cands ?? [];
    const d = one(department);
    return {
      ...r,
      openings: num(r.openings),
      salary_min: numOrNull(r.salary_min),
      salary_max: numOrNull(r.salary_max),
      experience_min: numOrNull(r.experience_min),
      experience_max: numOrNull(r.experience_max),
      department_name: d ? d.name || d.short_name : null,
      designation_name: one(designation)?.name ?? null,
      counts: {
        total: c.length,
        active: c.filter((x) => LIVE_STATUSES.includes(x.status)).length,
        interview: c.filter((x) => x.status === "interview").length,
        selected: c.filter((x) => ["pending_approval", "approved", "offered"].includes(x.status)).length,
        joined: c.filter((x) => x.status === "joined").length,
      },
    };
  });
  return withCreators(rows);
}

// ─── Candidates ────────────────────────────────────────────────────────────

const CANDIDATE_SELECT =
  "*, job:rc_jobs!job_id(code, title, hires_as), " +
  "offer_d:designations!offer_designation_id(name), appr_d:designations!approved_designation_id(name), " +
  "hired_staff:staff!hired_staff_id(name, code), hired_worker:workers!hired_worker_id(name, code), " +
  "interviews:rc_interviews(status, scheduled_at), scores:rc_scorecards(skill, communication, attitude, experience)";

type CandRow = Record<string, unknown> & {
  id: string;
  referred_by_staff_id: string | null;
  job: One<{ code: string | null; title: string; hires_as: Candidate["hires_as"] }>;
  offer_d: One<{ name: string }>;
  appr_d: One<{ name: string }>;
  hired_staff: One<{ name: string | null; code: string | null }>;
  hired_worker: One<{ name: string | null; code: string | null }>;
  interviews: { status: string; scheduled_at: string }[] | null;
  scores: { skill: number; communication: number; attitude: number; experience: number }[] | null;
};

function shapeCandidate(r: CandRow, names: Map<string, string>): Candidate {
  const { job, offer_d, appr_d, hired_staff, hired_worker, interviews, scores, ...rest } = r;
  const j = one(job);
  const hired = one(hired_staff) ?? one(hired_worker);
  const ints = interviews ?? [];
  const sc = scores ?? [];
  const next = ints.filter((i) => i.status === "scheduled").map((i) => i.scheduled_at).sort()[0] ?? null;
  return {
    ...(rest as unknown as Candidate),
    job_code: j?.code ?? null,
    job_title: j?.title ?? "—",
    hires_as: j?.hires_as ?? "workers",
    experience_years: numOrNull(rest.experience_years),
    current_salary: numOrNull(rest.current_salary),
    expected_salary: numOrNull(rest.expected_salary),
    offer_salary: numOrNull(rest.offer_salary),
    approved_salary: numOrNull(rest.approved_salary),
    referred_by_name: r.referred_by_staff_id ? (names.get(r.referred_by_staff_id) ?? null) : null,
    offer_designation: one(offer_d)?.name ?? null,
    approved_designation: one(appr_d)?.name ?? null,
    hired_name: hired?.name ?? null,
    hired_code: hired?.code ?? null,
    rounds_done: ints.filter((i) => i.status === "completed").length,
    next_interview_at: next,
    avg_score: sc.length
      ? Math.round((sc.reduce((a, x) => a + (x.skill + x.communication + x.attitude + x.experience) / 4, 0) / sc.length) * 10) / 10
      : null,
  };
}

export async function listCandidates(): Promise<Candidate[]> {
  const s = await createClient();
  const { data, error } = await s.from("rc_candidates").select(CANDIDATE_SELECT).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as CandRow[];
  const names = await staffNames(rows.map((r) => r.referred_by_staff_id));
  return withCreators(rows.map((r) => shapeCandidate(r, names)));
}

export async function getCandidateEvents(candidateId: string): Promise<CandidateEvent[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("rc_candidate_events")
    .select("id, kind, from_status, to_status, note, data, actor_id, created_at")
    .eq("candidate_id", candidateId)
    .order("created_at");
  if (error) throw new Error(error.message);
  // Resolve the actor through the same SECURITY DEFINER name lookup the
  // Created User column uses.
  const named = await withCreators(
    ((data ?? []) as (Omit<CandidateEvent, "actor_name"> & { actor_id: string | null })[]).map((e) => ({
      ...e,
      created_by: e.actor_id,
    })),
  );
  return named.map(({ actor_id: _a, created_by: _c, ...e }) => ({
    ...e,
    actor_name: (e as { created_by_name?: string | null }).created_by_name ?? null,
  }));
}

// ─── Interviews ────────────────────────────────────────────────────────────

export async function listInterviews(opts?: { candidateId?: string }): Promise<Interview[]> {
  const s = await createClient();
  let q = s
    .from("rc_interviews")
    .select(
      "*, cand:rc_candidates!candidate_id(code, name, status, job:rc_jobs!job_id(title)), " +
        "scorecards:rc_scorecards(id, interview_id, interviewer_id, skill, communication, attitude, experience, recommendation, comments, entered_by)",
    )
    .order("scheduled_at", { ascending: false });
  if (opts?.candidateId) q = q.eq("candidate_id", opts.candidateId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Row = Omit<Interview, "candidate_code" | "candidate_name" | "candidate_status" | "job_title" | "panel_names" | "scorecards"> & {
    cand: One<{ code: string | null; name: string; status: CandidateStatus; job: One<{ title: string }> }>;
    scorecards: Omit<Scorecard, "interviewer_name">[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const names = await staffNames(rows.flatMap((r) => r.panel ?? []));
  const out = rows.map(({ cand, scorecards, ...r }) => {
    const c = one(cand);
    return {
      ...r,
      candidate_code: c?.code ?? null,
      candidate_name: c?.name ?? "—",
      candidate_status: c?.status ?? "interview",
      job_title: one(c?.job)?.title ?? "—",
      panel_names: (r.panel ?? []).map((id) => names.get(id) ?? "—"),
      scorecards: (scorecards ?? []).map((x) => ({ ...x, interviewer_name: names.get(x.interviewer_id) ?? "—" })),
    };
  });
  return withCreators(out);
}
