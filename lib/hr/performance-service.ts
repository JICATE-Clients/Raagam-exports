import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { isInactive } from "@/lib/masters/inactive";
import { personKey } from "./timeoff-types";
import type {
  DesignationOption,
  Enrolment,
  PersonRole,
  Promotion,
  Rating,
  Ratings,
  Review,
  Round,
  RoundStatus,
  Training,
  TrainingCategory,
  TrainingStatus,
} from "./performance-types";

/**
 * Reads for HR ▸ Performance & Growth (0773).
 *
 * RLS does the scoping: HR reads the unit they are working in; a person reads
 * their own appraisal and trainings; a supervisor reads the appraisals they
 * rate. Names, codes and designations of the people on rows the caller
 * ALREADY holds are read through the privileged client — a self-service
 * supervisor cannot read the staff / workers tables, and their screen would
 * otherwise be a list of dashes. Nothing is read for a row RLS did not return.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — every read below throws.
 */

export { timeoffViewer as performanceViewer, listTimeoffPeople as listPerformancePeople } from "./timeoff-service";

type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

type PersonInfo = { name: string; code: string | null; designation_id: string | null; designation_name: string | null };

/** Name, code and designation for staff / workers the caller already holds rows for. */
async function peopleInfo(
  staffIds: Iterable<string | null>,
  workerIds: Iterable<string | null>,
): Promise<{ staff: Map<string, PersonInfo>; workers: Map<string, PersonInfo> }> {
  const sIds = [...new Set([...staffIds].filter((x): x is string => !!x))];
  const wIds = [...new Set([...workerIds].filter((x): x is string => !!x))];
  const admin = createAdminClient();
  const sel = "id, name, code, designation_id, designation:designations!designation_id(name)";
  const [st, wk] = await Promise.all([
    sIds.length ? admin.from("staff").select(sel).in("id", sIds) : Promise.resolve({ data: [], error: null }),
    wIds.length ? admin.from("workers").select(sel).in("id", wIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (st.error) throw new Error(`Could not read staff names: ${st.error.message}`);
  if (wk.error) throw new Error(`Could not read worker names: ${wk.error.message}`);
  type Row = { id: string; name: string | null; code: string | null; designation_id: string | null; designation: One<{ name: string }> };
  const toMap = (rows: Row[]) =>
    new Map(
      rows.map((r) => [
        r.id,
        { name: r.name ?? "(unnamed)", code: r.code, designation_id: r.designation_id, designation_name: one(r.designation)?.name ?? null },
      ]),
    );
  return { staff: toMap((st.data ?? []) as Row[]), workers: toMap((wk.data ?? []) as Row[]) };
}

function personOf(
  info: { staff: Map<string, PersonInfo>; workers: Map<string, PersonInfo> },
  staffId: string | null,
  workerId: string | null,
): PersonInfo & { kind: "staff" | "worker" } {
  const p = staffId ? info.staff.get(staffId) : workerId ? info.workers.get(workerId) : undefined;
  return {
    kind: staffId ? "staff" : "worker",
    name: p?.name ?? "—",
    code: p?.code ?? null,
    designation_id: p?.designation_id ?? null,
    designation_name: p?.designation_name ?? null,
  };
}

// ─── Options ───────────────────────────────────────────────────────────────

export async function listDesignationOptions(): Promise<DesignationOption[]> {
  const s = await createClient();
  const { data, error } = await s.from("designations").select("id, name, for_type, inactive, is_draft").order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string; for_type: DesignationOption["for_type"]; inactive: boolean; is_draft: boolean }[])
    .filter((d) => !d.is_draft)
    .map((d) => ({ id: d.id, name: d.name, for_type: d.for_type, inactive: isInactive(d) }));
}

/** Everyone's designation today, keyed by `personKey` — for the promotion sheet. */
export async function listPeopleRoles(): Promise<Record<string, PersonRole>> {
  const s = await createClient();
  const sel = "id, designation_id, designation:designations!designation_id(name)";
  const [st, wk] = await Promise.all([
    s.from("staff").select(sel).eq("is_active", true),
    s.from("workers").select(sel).eq("is_active", true),
  ]);
  if (st.error) throw new Error(st.error.message);
  if (wk.error) throw new Error(wk.error.message);
  type Row = { id: string; designation_id: string | null; designation: One<{ name: string }> };
  const out: Record<string, PersonRole> = {};
  for (const r of (st.data ?? []) as Row[])
    out[personKey("staff", r.id)] = { designation_id: r.designation_id, designation_name: one(r.designation)?.name ?? null };
  for (const r of (wk.data ?? []) as Row[])
    out[personKey("worker", r.id)] = { designation_id: r.designation_id, designation_name: one(r.designation)?.name ?? null };
  return out;
}

// ─── Rounds ────────────────────────────────────────────────────────────────

export async function listRounds(): Promise<Round[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("pf_rounds")
    .select("*, reviews:pf_reviews(status)")
    .order("period_from", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Omit<Round, "counts"> & { reviews: { status: string }[] | null };
  const rows = ((data ?? []) as Row[]).map(({ reviews, ...r }) => {
    const v = reviews ?? [];
    return {
      ...r,
      counts: {
        total: v.length,
        self: v.filter((x) => x.status === "self").length,
        supervisor: v.filter((x) => x.status === "supervisor").length,
        pending: v.filter((x) => x.status === "pending_approval").length,
        approved: v.filter((x) => x.status === "approved").length,
      },
    };
  });
  return withCreators(rows);
}

// ─── Appraisals ────────────────────────────────────────────────────────────

type ReviewRow = Record<string, unknown> & {
  id: string;
  staff_id: string | null;
  worker_id: string | null;
  reviewer_id: string | null;
  round: One<{ code: string | null; name: string; status: RoundStatus }>;
};

const ratings = (r: Record<string, unknown>, p: "self" | "sup"): Ratings => ({
  quality: (r[`${p}_quality`] as Rating | null) ?? null,
  output: (r[`${p}_output`] as Rating | null) ?? null,
  discipline: (r[`${p}_discipline`] as Rating | null) ?? null,
  teamwork: (r[`${p}_teamwork`] as Rating | null) ?? null,
});

export async function listReviews(opts?: { roundId?: string; ids?: string[] }): Promise<Review[]> {
  const s = await createClient();
  let q = s.from("pf_reviews").select("*, round:pf_rounds!round_id(code, name, status)").order("created_at");
  if (opts?.roundId) q = q.eq("round_id", opts.roundId);
  if (opts?.ids) q = q.in("id", opts.ids);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ReviewRow[];
  const info = await peopleInfo(
    [...rows.map((r) => r.staff_id), ...rows.map((r) => r.reviewer_id)],
    rows.map((r) => r.worker_id),
  );
  const out = rows.map((r) => {
    const p = personOf(info, r.staff_id, r.worker_id);
    const rd = one(r.round);
    return {
      ...(r as unknown as Review),
      round_code: rd?.code ?? null,
      round_name: rd?.name ?? "—",
      round_status: rd?.status ?? "closed",
      person_kind: p.kind,
      person_name: p.name,
      person_code: p.code,
      designation_name: p.designation_name,
      reviewer_name: r.reviewer_id ? (info.staff.get(r.reviewer_id)?.name ?? null) : null,
      self: ratings(r, "self"),
      sup: ratings(r, "sup"),
      final_score: numOrNull(r.final_score),
    };
  });
  out.sort((a, b) => a.person_name.localeCompare(b.person_name));
  return withCreators(out);
}

/** Approved appraisals — the promotion sheet links one as its evidence. */
export async function listApprovedReviews(): Promise<{ id: string; person: string; label: string }[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("pf_reviews")
    .select("id, staff_id, worker_id, final_score, round:pf_rounds!round_id(name)")
    .eq("status", "approved")
    .order("approved_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = { id: string; staff_id: string | null; worker_id: string | null; final_score: number | null; round: One<{ name: string }> };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    person: r.staff_id ? personKey("staff", r.staff_id) : personKey("worker", r.worker_id as string),
    label: `${one(r.round)?.name ?? "Appraisal"} — ${r.final_score != null ? Number(r.final_score) : "—"} / 100`,
  }));
}

// ─── Promotions ────────────────────────────────────────────────────────────

export async function listPromotions(): Promise<Promotion[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("pf_promotions")
    .select(
      "*, from_d:designations!from_designation_id(name), to_d:designations!to_designation_id(name), " +
        "review:pf_reviews!review_id(final_score, round:pf_rounds!round_id(name))",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Record<string, unknown> & {
    staff_id: string | null;
    worker_id: string | null;
    from_d: One<{ name: string }>;
    to_d: One<{ name: string }>;
    review: One<{ final_score: number | null; round: One<{ name: string }> }>;
  };
  const rows = (data ?? []) as unknown as Row[];
  const info = await peopleInfo(rows.map((r) => r.staff_id), rows.map((r) => r.worker_id));
  const out = rows.map(({ from_d, to_d, review, ...r }) => {
    const p = personOf(info, r.staff_id, r.worker_id);
    const rv = one(review);
    return {
      ...(r as unknown as Promotion),
      person_kind: p.kind,
      person_name: p.name,
      person_code: p.code,
      from_designation: one(from_d)?.name ?? null,
      to_designation: one(to_d)?.name ?? "—",
      current_salary: numOrNull(r.current_salary),
      proposed_salary: numOrNull(r.proposed_salary),
      review_label: rv ? `${one(rv.round)?.name ?? "Appraisal"} — ${rv.final_score != null ? Number(rv.final_score) : "—"} / 100` : null,
    };
  });
  return withCreators(out);
}

// ─── Training ──────────────────────────────────────────────────────────────

export async function listTrainings(): Promise<Training[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("pf_trainings")
    .select("*, enrolments:pf_enrolments(status)")
    .order("starts_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  type Row = Omit<Training, "counts"> & { enrolments: { status: string }[] | null };
  const rows = ((data ?? []) as Row[]).map(({ enrolments, ...r }) => {
    const e = enrolments ?? [];
    return {
      ...r,
      hours: numOrNull(r.hours),
      seats: numOrNull(r.seats),
      counts: {
        taken: e.filter((x) => x.status !== "dropped").length,
        completed: e.filter((x) => x.status === "completed").length,
      },
    };
  });
  return withCreators(rows);
}

export async function listEnrolments(opts?: { trainingId?: string }): Promise<Enrolment[]> {
  const s = await createClient();
  let q = s
    .from("pf_enrolments")
    .select("*, training:pf_trainings!training_id(code, title, status, starts_on, ends_on, hours, category)")
    .order("created_at");
  if (opts?.trainingId) q = q.eq("training_id", opts.trainingId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Row = Record<string, unknown> & {
    staff_id: string | null;
    worker_id: string | null;
    training: One<{
      code: string | null;
      title: string;
      status: TrainingStatus;
      starts_on: string;
      ends_on: string;
      hours: number | null;
      category: TrainingCategory;
    }>;
  };
  const rows = (data ?? []) as unknown as Row[];
  const info = await peopleInfo(rows.map((r) => r.staff_id), rows.map((r) => r.worker_id));
  const out = rows.map(({ training, ...r }) => {
    const p = personOf(info, r.staff_id, r.worker_id);
    const t = one(training);
    return {
      ...(r as unknown as Enrolment),
      training_code: t?.code ?? null,
      training_title: t?.title ?? "—",
      training_status: t?.status ?? "cancelled",
      starts_on: t?.starts_on ?? "",
      ends_on: t?.ends_on ?? "",
      hours: numOrNull(t?.hours),
      category: t?.category ?? "other",
      person_kind: p.kind,
      person_name: p.name,
      person_code: p.code,
    };
  });
  out.sort((a, b) => a.person_name.localeCompare(b.person_name));
  return out;
}
