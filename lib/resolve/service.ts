import "server-only";
import { getAppUser } from "@/lib/auth/server";
import { getCurrentLocationId } from "@/lib/auth/location";
import { withCreators } from "@/lib/created-by";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isLate } from "./sla";
import {
  ACTIVE_COMPLAINT_STATUSES,
  ACTIVE_STATUSES,
  type CategoryMember,
  type ComplaintCategory,
  type OpenComplaintCategory,
  TICKET_ACTIONS,
  type Place,
  type PlaceByToken,
  type ResolveAnalytics,
  type RoutingOverride,
  type Team,
  type TeamMember,
  type Ticket,
  type TicketAction,
  type TicketActivity,
  type TicketDetail,
  type TicketListRow,
  type TicketNote,
  type TicketPhoto,
  type Trade,
  type TriageRow,
  type TriageWeights,
  type UnitSettings,
  type WorkloadRow,
} from "./types";

/*
 * Resolve Hub reads. Every read runs as the operator under RLS (`createClient`);
 * the admin client is used for exactly one thing — minting signed photo URLs —
 * and only after the RLS read of that ticket succeeded.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST (AGENTS.md): every read checks
 * `error` and throws. An empty Triage queue must mean nothing is waiting, never
 * "the query broke".
 *
 * Names, never uuids: people go through `creator_names()` (SECURITY DEFINER —
 * `profiles_read_own` hides every profile but your own, so an embed would read
 * null), places / trades / teams through one id lookup each.
 */

export const PHOTO_BUCKET = "resolve-photos";
const SIGNED_URL_TTL = 60 * 60; // 1 hour
const JOB_ROW_CAP = 2000;

type Sb = Awaited<ReturnType<typeof createClient>>;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

function uniq(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((v): v is string => !!v))];
}

/** id → full name for any set of profile ids, one round trip. */
async function peopleNames(s: Sb, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = uniq(ids);
  if (!list.length) return new Map();
  const rows = must(await s.rpc("creator_names", { ids: list }), "Reading people's names") as
    | { id: string; full_name: string | null }[]
    | null;
  return new Map((rows ?? []).filter((r) => r.full_name).map((r) => [r.id, r.full_name as string]));
}

async function idNames(s: Sb, table: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = uniq(ids);
  if (!list.length) return new Map();
  const rows = must(await s.from(table).select("id, name").in("id", list), `Reading ${table}`) as
    | { id: string; name: string }[]
    | null;
  return new Map((rows ?? []).map((r) => [r.id, r.name]));
}

/** A ticket row as selected — the complaint columns exist on every row (0745),
 *  null / false on a Broken ticket. */
type RawTicket = Ticket & {
  joiners?: number | null;
  category_id?: string | null;
  is_anonymous?: boolean | null;
  about_superior?: boolean | null;
  resolution_message?: string | null;
  response_due_at?: string | null;
  first_response_at?: string | null;
};

/** A complaint is late when its RESPONSE is late: past `response_due_at`
 *  with no first response yet. Once someone has started on it, the 72-hour
 *  promise is kept, whatever happens after. */
function complaintLate(r: RawTicket, nowMs: number): boolean {
  if (r.first_response_at || !r.response_due_at) return false;
  if (!["open", "assigned", "escalated"].includes(r.status)) return false;
  return nowMs > new Date(r.response_due_at).getTime();
}

export const ANONYMOUS = "Anonymous";

/** Resolve every name a listing shows, and the server's word on lateness.
 *  An anonymous complaint's reporter is NEVER looked up — `reporter_id` is
 *  NULL by construction (0745), and this does not even ask. */
async function hydrate<T extends RawTicket>(s: Sb, rows: T[]): Promise<(T & TicketListRow)[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const needJoiners = rows.some((r) => r.kind === "broken" && typeof r.joiners !== "number");
  const categoryIds = uniq(rows.map((r) => r.category_id));
  const [places, trades, teams, people, joinerRows, catRows] = await Promise.all([
    idNames(s, "rh_places", rows.map((r) => r.place_id)),
    idNames(s, "rh_trades", rows.map((r) => r.trade_id)),
    idNames(s, "rh_teams", rows.map((r) => r.team_id)),
    peopleNames(
      s,
      rows.flatMap((r) => [r.owner_id, r.assignee_id, r.is_anonymous ? null : r.reporter_id]),
    ),
    needJoiners
      ? s.from("rh_ticket_joiners").select("ticket_id").in("ticket_id", ids)
      : Promise.resolve({ data: [] as { ticket_id: string }[], error: null }),
    categoryIds.length
      ? s.from("rh_complaint_categories").select("id, name, is_sensitive").in("id", categoryIds)
      : Promise.resolve({ data: [] as { id: string; name: string; is_sensitive: boolean }[], error: null }),
  ]);
  const joinCount = new Map<string, number>();
  for (const j of must(joinerRows, "Reading joiners") ?? []) {
    joinCount.set(j.ticket_id, (joinCount.get(j.ticket_id) ?? 0) + 1);
  }
  const cats = new Map(
    ((must(catRows, "Reading complaint categories") ?? []) as { id: string; name: string; is_sensitive: boolean }[]).map(
      (c) => [c.id, c],
    ),
  );
  const now = Date.now();
  return rows.map((r) => {
    const cat = r.category_id ? cats.get(r.category_id) : undefined;
    return {
      ...r,
      place_name: (r.place_id && places.get(r.place_id)) || null,
      trade_name: (r.trade_id && trades.get(r.trade_id)) || null,
      team_name: (r.team_id && teams.get(r.team_id)) || null,
      owner_name: (r.owner_id && people.get(r.owner_id)) || null,
      assignee_name: (r.assignee_id && people.get(r.assignee_id)) || null,
      reporter_name: r.is_anonymous ? ANONYMOUS : (r.reporter_id && people.get(r.reporter_id)) || null,
      is_late: r.kind === "complaint" ? complaintLate(r, now) : isLate(r.status, r.due_at, now),
      joiners: typeof r.joiners === "number" ? r.joiners : joinCount.get(r.id) ?? 0,
      category_name: cat?.name ?? null,
      is_anonymous: !!r.is_anonymous,
      about_superior: !!r.about_superior,
      // A category the viewer cannot read is treated as sensitive — the safe guess.
      is_sensitive: r.category_id ? (cat ? cat.is_sensitive : true) : false,
      resolution_message: r.resolution_message ?? null,
      response_due_at: r.response_due_at ?? null,
    };
  });
}

async function me(): Promise<string> {
  const u = await getAppUser();
  if (!u) throw new Error("Sign in to continue");
  return u.id;
}

// ---- reporting --------------------------------------------------------------

/** Places a report can be raised against in the current unit (picker). */
export async function listReportablePlaces(): Promise<
  { id: string; code: string; name: string; kind: Place["kind"]; default_trade_id: string | null }[]
> {
  const s = await createClient();
  return (
    must(
      await s
        .from("rh_places")
        .select("id, code, name, kind, default_trade_id")
        .eq("inactive", false)
        .order("name"),
      "Reading places",
    ) ?? []
  );
}

export async function listTrades(opts: { includeInactive?: boolean } = {}): Promise<Trade[]> {
  const s = await createClient();
  let q = s.from("rh_trades").select("*").order("name");
  if (!opts.includeInactive) q = q.eq("inactive", false);
  return withCreators((must(await q, "Reading trades") ?? []) as Trade[]);
}

/**
 * The place behind a QR sticker. THROWS the database's own sentence when the
 * sticker is unknown or replaced ("This sticker is not recognised …") or the
 * place is in a unit the operator cannot access — the scan page catches and
 * shows it. Null only for a token that is not even token-shaped.
 */
export async function getPlaceByToken(token: string): Promise<PlaceByToken | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  const s = await createClient();
  const { data, error } = await s.rpc("rh_place_by_token", { p_token: token });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as PlaceByToken | null;
  return row && row.place_id ? row : null;
}

const TICKET_COLS = "*";

/** Tickets I reported or joined, any unit. LISTED IN ENTRY ORDER — 1, 2, 3. */
export async function listMyReports(): Promise<TicketListRow[]> {
  const uid = await me();
  const s = await createClient();
  const joined = (must(
    await s.from("rh_ticket_joiners").select("ticket_id").eq("profile_id", uid),
    "Reading the problems you joined",
  ) ?? []) as { ticket_id: string }[];
  const ids = joined.map((j) => j.ticket_id);
  let q = s.from("rh_tickets").select(TICKET_COLS).eq("kind", "broken");
  q = ids.length ? q.or(`reporter_id.eq.${uid},id.in.(${ids.join(",")})`) : q.eq("reporter_id", uid);
  const rows = (must(await q.order("created_at", { ascending: true }), "Reading your reports") ?? []) as Ticket[];
  return withCreators(await hydrate(s, rows));
}

// ---- work -------------------------------------------------------------------

export type MyWorkTab = "assigned" | "in_progress" | "to_claim" | "done";

/**
 * The fixer's queue. A QUEUE, so it keeps its own order — soonest due first —
 * rather than entry order.
 *   assigned     open, and mine (assignee, or owner with nobody assigned)
 *   in_progress  in progress or blocked, and mine
 *   to_claim     open, unassigned, on a team I am an active member of
 *   done         fixed / closed by me in the last 30 days
 */
export async function listMyWork(tab: MyWorkTab): Promise<TicketListRow[]> {
  const uid = await me();
  const s = await createClient();
  const mine = `assignee_id.eq.${uid},and(owner_id.eq.${uid},assignee_id.is.null)`;
  let q = s.from("rh_tickets").select(TICKET_COLS).eq("kind", "broken");

  if (tab === "assigned") q = q.eq("status", "open").or(mine);
  else if (tab === "in_progress") q = q.in("status", ["in_progress", "blocked"]).or(mine);
  else if (tab === "done") {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    q = q
      .in("status", ["fixed", "closed"])
      .or(`assignee_id.eq.${uid},owner_id.eq.${uid}`)
      .gte("updated_at", since);
  } else {
    const teams = (must(
      await s.from("rh_team_members").select("team_id").eq("profile_id", uid).eq("active", true),
      "Reading your teams",
    ) ?? []) as { team_id: string }[];
    if (!teams.length) return [];
    q = q.eq("status", "open").is("assignee_id", null).in("team_id", uniq(teams.map((t) => t.team_id)));
  }

  q =
    tab === "done"
      ? q.order("updated_at", { ascending: false })
      : q.order("is_dangerous", { ascending: false }).order("due_at", { ascending: true, nullsFirst: false });
  const rows = (must(await q, "Reading your work") ?? []) as Ticket[];
  return hydrate(s, rows);
}

/** One ticket, everything the detail page shows. Null when RLS hides it. */
export async function getTicketDetail(id: string): Promise<TicketDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const uid = await me();
  const s = await createClient();
  const ticket = must(
    await s.from("rh_tickets").select(TICKET_COLS).eq("id", id).maybeSingle(),
    "Reading the ticket",
  ) as Ticket | null;
  if (!ticket) return null;

  const [photosRes, activityRes, notesRes, actionsRes, ratingRes] = await Promise.all([
    s.from("rh_ticket_photos").select("*").eq("ticket_id", id).order("created_at", { ascending: true }),
    s.from("rh_ticket_activity").select("*").eq("ticket_id", id).order("created_at", { ascending: true }),
    s.from("rh_ticket_notes").select("*").eq("ticket_id", id).order("created_at", { ascending: true }),
    s.rpc("rh_ticket_actions", { p_ticket_id: id }),
    s
      .from("rh_ratings")
      .select("stars, comment")
      .eq("ticket_id", id)
      .eq("rater_id", uid)
      .eq("fix_round", ticket.fix_round)
      .maybeSingle(),
  ]);
  const photoRows = (must(photosRes, "Reading photos") ?? []) as Omit<TicketPhoto, "url">[];
  const activityRows = (must(activityRes, "Reading the history") ?? []) as Omit<TicketActivity, "actor_name">[];
  const noteRows = (must(notesRes, "Reading notes") ?? []) as Omit<TicketNote, "author_name">[];
  const known = new Set<string>(TICKET_ACTIONS);
  const actions = ((must(actionsRes, "Reading what you can do") ?? []) as string[]).filter(
    (a): a is TicketAction => known.has(a),
  );
  const rating = must(ratingRes, "Reading your rating") as { stars: number; comment: string | null } | null;

  // The RLS read above passed, so this person may see these photos.
  let urls = new Map<string, string>();
  if (photoRows.length) {
    const { data, error } = await createAdminClient()
      .storage.from(PHOTO_BUCKET)
      .createSignedUrls(
        photoRows.map((p) => p.path),
        SIGNED_URL_TTL,
      );
    if (error) throw new Error(`Opening photos: ${error.message}`);
    urls = new Map(
      (data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]),
    );
  }

  const [hydrated, names] = await Promise.all([
    hydrate(s, [ticket]),
    peopleNames(s, [...activityRows.map((a) => a.actor_id), ...noteRows.map((n) => n.author_id)]),
  ]);

  return {
    ticket: hydrated[0],
    photos: photoRows.map((p) => ({ ...p, url: urls.get(p.path) ?? null })),
    activity: activityRows.map((a) => ({
      ...a,
      meta: (a.meta ?? {}) as Record<string, unknown>,
      actor_name: (a.actor_id && names.get(a.actor_id)) || null,
    })),
    notes: noteRows.map((n) => ({ ...n, author_name: (n.author_id && names.get(n.author_id)) || null })),
    actions,
    // Internal notes need rh_is_staff_on (plan §3) — the action list already
    // answered that question, so it is not asked twice.
    isStaff: actions.includes("note_internal"),
    myRating: rating ? { stars: rating.stars, comment: rating.comment } : null,
  };
}

export type JobsListFilter = { status?: string; trade_id?: string; overdue?: boolean };

/** All Jobs in the current unit. LISTED IN ENTRY ORDER — 1, 2, 3. */
export async function listJobs(f: JobsListFilter = {}): Promise<{
  rows: TicketListRow[];
  counts: { open: number; late: number; waiting: number; completed30: number };
}> {
  const s = await createClient();
  const loc = await getCurrentLocationId();
  if (!loc) return { rows: [], counts: { open: 0, late: 0, waiting: 0, completed30: 0 } };
  const nowIso = new Date().toISOString();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const base = () => s.from("rh_tickets").select("id", { count: "exact", head: true }).eq("kind", "broken").eq("location_id", loc);

  let q = s.from("rh_tickets").select(TICKET_COLS).eq("kind", "broken").eq("location_id", loc);
  if (f.status) q = q.eq("status", f.status);
  if (f.trade_id) q = q.eq("trade_id", f.trade_id);
  if (f.overdue) q = q.in("status", ["open", "in_progress"]).lt("due_at", nowIso);

  const [rowsRes, openRes, lateRes, waitRes, doneRes] = await Promise.all([
    q.order("created_at", { ascending: true }).limit(JOB_ROW_CAP),
    base().in("status", [...ACTIVE_STATUSES]),
    base().in("status", ["open", "in_progress"]).lt("due_at", nowIso),
    base().eq("status", "blocked"),
    base().eq("status", "closed").gte("closed_at", since30),
  ]);
  const rows = (must(rowsRes, "Reading jobs") ?? []) as Ticket[];
  for (const [r, what] of [
    [openRes, "Counting open jobs"],
    [lateRes, "Counting late jobs"],
    [waitRes, "Counting waiting jobs"],
    [doneRes, "Counting completed jobs"],
  ] as const) {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
  }
  return {
    rows: await withCreators(await hydrate(s, rows)),
    counts: {
      open: openRes.count ?? 0,
      late: lateRes.count ?? 0,
      waiting: waitRes.count ?? 0,
      completed30: doneRes.count ?? 0,
    },
  };
}

/** Triage — the RPC (0740) scores, orders and names the rows itself. */
export async function getTriageQueue(tab: "decide" | "open" | "all"): Promise<TriageRow[]> {
  const s = await createClient();
  const rows = (must(await s.rpc("rh_triage_queue", { p_tab: tab }), "Reading the triage queue") ?? []) as (Omit<
    TriageRow,
    "score_parts"
  > & { score_parts: { label: string; points: number }[] | null })[];
  return rows.map((r) => ({
    ...r,
    joiners: Number(r.joiners) || 0,
    score: Number(r.score) || 0,
    score_parts: r.score_parts ?? [],
  }));
}

export async function getWorkload(): Promise<WorkloadRow[]> {
  const s = await createClient();
  const rows = (must(await s.rpc("rh_workload"), "Reading the workload") ?? []) as WorkloadRow[];
  return rows.map((r) => ({
    ...r,
    open: Number(r.open) || 0,
    in_progress: Number(r.in_progress) || 0,
    blocked: Number(r.blocked) || 0,
    overdue: Number(r.overdue) || 0,
  }));
}

export async function getAnalytics(weeks = 12): Promise<ResolveAnalytics> {
  const s = await createClient();
  const data = must(await s.rpc("rh_analytics", { p_weeks: weeks }), "Reading analytics");
  const a = (Array.isArray(data) ? data[0] : data) as Partial<ResolveAnalytics> | null;
  const t = a?.totals;
  return {
    totals: {
      total: t?.total ?? 0,
      open: t?.open ?? 0,
      late: t?.late ?? 0,
      blocked: t?.blocked ?? 0,
      fixed: t?.fixed ?? 0,
      closed: t?.closed ?? 0,
      reopened: t?.reopened ?? 0,
      disputed: t?.disputed ?? 0,
    },
    verified_fix_rate: a?.verified_fix_rate ?? null,
    reopen_rate: a?.reopen_rate ?? null,
    median_days_to_fix: a?.median_days_to_fix ?? null,
    avg_resolution_days: a?.avg_resolution_days ?? null,
    weekly: a?.weekly ?? [],
    late_by_place: a?.late_by_place ?? [],
    repeats: a?.repeats ?? [],
    top_closers: a?.top_closers ?? [],
    top_overdue: a?.top_overdue ?? [],
    by_source: a?.by_source ?? [],
  };
}

// ---- administration ---------------------------------------------------------

export type PlaceRow = Place & {
  caretaker_name: string | null;
  default_trade_name: string | null;
  parent_name: string | null;
};

/** Masters stay alphabetical (by code). */
export async function listPlaces(): Promise<PlaceRow[]> {
  const s = await createClient();
  const rows = (must(await s.from("rh_places").select("*").order("code"), "Reading places") ?? []) as Place[];
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  const [people, trades] = await Promise.all([
    peopleNames(s, rows.map((r) => r.caretaker_id)),
    idNames(s, "rh_trades", rows.map((r) => r.default_trade_id)),
  ]);
  return withCreators(
    rows.map((r) => ({
      ...r,
      caretaker_name: (r.caretaker_id && people.get(r.caretaker_id)) || null,
      default_trade_name: (r.default_trade_id && trades.get(r.default_trade_id)) || null,
      parent_name: (r.parent_id && byId.get(r.parent_id)) || null,
    })),
  );
}

export type TeamRow = Team & {
  trade_name: string | null;
  lead_name: string | null;
  members: (TeamMember & { name: string | null })[];
};

export async function listTeams(): Promise<TeamRow[]> {
  const s = await createClient();
  const rows = (must(
    await s.from("rh_teams").select("*, members:rh_team_members(*)").order("name"),
    "Reading teams",
  ) ?? []) as (Team & { members: TeamMember[] | null })[];
  const [people, trades] = await Promise.all([
    peopleNames(s, rows.flatMap((r) => [r.lead_id, ...(r.members ?? []).map((m) => m.profile_id)])),
    idNames(s, "rh_trades", rows.map((r) => r.trade_id)),
  ]);
  return withCreators(
    rows.map((r) => ({
      ...r,
      trade_name: trades.get(r.trade_id) ?? null,
      lead_name: (r.lead_id && people.get(r.lead_id)) || null,
      members: (r.members ?? []).map((m) => ({ ...m, name: people.get(m.profile_id) ?? null })),
    })),
  );
}

export type RoutingOverrideRow = RoutingOverride & {
  place_name: string | null;
  trade_name: string | null;
  owner_name: string | null;
};

export async function listRoutingOverrides(): Promise<RoutingOverrideRow[]> {
  const s = await createClient();
  const rows = (must(
    await s.from("rh_routing_overrides").select("*").order("created_at", { ascending: true }),
    "Reading routing rules",
  ) ?? []) as RoutingOverride[];
  const [places, trades, people] = await Promise.all([
    idNames(s, "rh_places", rows.map((r) => r.place_id)),
    idNames(s, "rh_trades", rows.map((r) => r.trade_id)),
    peopleNames(s, rows.map((r) => r.owner_id)),
  ]);
  return withCreators(
    rows.map((r) => ({
      ...r,
      place_name: (r.place_id && places.get(r.place_id)) || null,
      trade_name: (r.trade_id && trades.get(r.trade_id)) || null,
      owner_name: people.get(r.owner_id) ?? null,
    })),
  );
}

export const DEFAULT_TRIAGE_WEIGHTS: TriageWeights = {
  severity: { critical: 100, high: 60, medium: 30, low: 10 },
  priority: { urgent: 80, high: 50, medium: 20, low: 5 },
  per_day_open: 2,
  age_cap: 60,
  reopened: 70,
  disputed: 90,
  repeated: 25,
  unassigned: 15,
};

/** The current unit's settings — the plan's defaults when none are saved yet. */
export async function getUnitSettings(): Promise<UnitSettings> {
  const s = await createClient();
  const loc = await getCurrentLocationId();
  const row = loc
    ? (must(
        await s.from("rh_unit_settings").select("*").eq("location_id", loc).maybeSingle(),
        "Reading unit settings",
      ) as Partial<UnitSettings> | null)
    : null;
  return {
    location_id: loc ?? "",
    unit_head_id: row?.unit_head_id ?? null,
    estate_owner_id: row?.estate_owner_id ?? null,
    director_ids: row?.director_ids ?? [],
    timezone: row?.timezone ?? "Asia/Kolkata",
    escalation_hour: row?.escalation_hour ?? 8,
    ordinary_days: row?.ordinary_days ?? 2,
    routine_days: row?.routine_days ?? 7,
    purchase_days: row?.purchase_days ?? 7,
    dup_window_days: row?.dup_window_days ?? 14,
    dispute_window_days: row?.dispute_window_days ?? 7,
    report_limit_24h: row?.report_limit_24h ?? 10,
    spot_check_one_in: row?.spot_check_one_in ?? 10,
    page_cap_per_day: row?.page_cap_per_day ?? 20,
    suppress_notifications: row?.suppress_notifications ?? false,
    triage_weights: { ...DEFAULT_TRIAGE_WEIGHTS, ...(row?.triage_weights ?? {}) },
    superior_handler_id: row?.superior_handler_id ?? null,
    complaint_response_hours: row?.complaint_response_hours ?? 72,
  };
}

/** People of the current unit, for assignee / caretaker / owner pickers. */
export async function listPeople(): Promise<{ id: string; name: string }[]> {
  const s = await createClient();
  const rows = (must(await s.rpc("rh_people"), "Reading people") ?? []) as { id: string; name: string | null }[];
  return rows
    .filter((r) => r.name)
    .map((r) => ({ id: r.id, name: r.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- complaints (plan §10) ----------------------------------------------------

/** My own (non-anonymous) complaints. An anonymous one is linked to nobody, so
 *  it can never appear here — its tracking link is the only way back to it.
 *  LISTED IN ENTRY ORDER — 1, 2, 3. */
export async function listMyComplaints(): Promise<TicketListRow[]> {
  const uid = await me();
  const s = await createClient();
  const rows = (must(
    await s
      .from("rh_tickets")
      .select(TICKET_COLS)
      .eq("kind", "complaint")
      .eq("reporter_id", uid)
      .order("created_at", { ascending: true }),
    "Reading your complaints",
  ) ?? []) as RawTicket[];
  return hydrate(s, rows);
}

export type ComplaintWorkTab = "mine" | "committee" | "all";

/**
 * The handler queue. A QUEUE, so soonest response deadline first.
 *   mine       still open, and I am its handler or assignee
 *   committee  still open, in a category I sit on (committee or oversight)
 *   all        every complaint RLS shows me in this unit, any status
 * Visibility itself is RLS (0745): a sensitive complaint reaches only its
 * handler and members, whatever permissions the viewer holds.
 */
export async function listComplaintWork(tab: ComplaintWorkTab): Promise<TicketListRow[]> {
  const uid = await me();
  const s = await createClient();
  let q = s.from("rh_tickets").select(TICKET_COLS).eq("kind", "complaint");
  if (tab === "mine") {
    q = q.in("status", [...ACTIVE_COMPLAINT_STATUSES]).or(`owner_id.eq.${uid},assignee_id.eq.${uid}`);
  } else if (tab === "committee") {
    const cats = (must(
      await s.from("rh_category_members").select("category_id").eq("profile_id", uid),
      "Reading your committees",
    ) ?? []) as { category_id: string }[];
    if (!cats.length) return [];
    q = q.in("status", [...ACTIVE_COMPLAINT_STATUSES]).in("category_id", uniq(cats.map((c) => c.category_id)));
  } else {
    const loc = await getCurrentLocationId();
    if (!loc) return [];
    q = q.eq("location_id", loc);
  }
  const rows = (must(
    await q.order("response_due_at", { ascending: true, nullsFirst: false }).limit(JOB_ROW_CAP),
    "Reading complaints",
  ) ?? []) as RawTicket[];
  // A QUEUE NEVER CARRIES THE COMPLAINANT. The reporter is not resolved, and
  // reporter_id / created_by are blanked before the row leaves the server, so
  // no column helper (withCreatedColumns' "Created User") can print who
  // complained. The ticket page, opened deliberately, is where a named
  // complainant is shown — never a listing of sensitive / about-superior rows.
  const blind = rows.map((r) => ({ ...r, reporter_id: null, created_by: null }));
  return (await hydrate(s, blind)).map((r) => ({ ...r, reporter_name: r.is_anonymous ? ANONYMOUS : null }));
}

/** Categories the complaint FORM offers — active, current unit. */
export async function listOpenComplaintCategories(): Promise<OpenComplaintCategory[]> {
  const s = await createClient();
  return ((must(await s.rpc("rh_complaint_categories_open"), "Reading complaint categories") ?? []) as OpenComplaintCategory[]).map(
    (c) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      is_sensitive: !!c.is_sensitive,
      anonymous_allowed: !!c.anonymous_allowed,
    }),
  );
}

export type ComplaintCategoryRow = ComplaintCategory & {
  handler_name: string | null;
  members: (CategoryMember & { name: string | null })[];
};

/** Administration ▸ Complaint Categories. Masters stay alphabetical. */
export async function listComplaintCategories(): Promise<ComplaintCategoryRow[]> {
  const s = await createClient();
  const rows = (must(
    await s.from("rh_complaint_categories").select("*, members:rh_category_members(*)").order("name"),
    "Reading complaint categories",
  ) ?? []) as (ComplaintCategory & { members: CategoryMember[] | null })[];
  const people = await peopleNames(
    s,
    rows.flatMap((r) => [r.handler_id, ...(r.members ?? []).map((m) => m.profile_id)]),
  );
  return withCreators(
    rows.map((r) => ({
      ...r,
      handler_name: (r.handler_id && people.get(r.handler_id)) || null,
      members: (r.members ?? []).map((m) => ({ ...m, name: people.get(m.profile_id) ?? null })),
    })),
  );
}
