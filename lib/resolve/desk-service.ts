import "server-only";
import { getAppUser } from "@/lib/auth/server";
import { getCurrentLocationId } from "@/lib/auth/location";
import { withCreators } from "@/lib/created-by";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_DESK_SETTINGS,
  DEFAULT_SERVICE_SLA,
  type DeskDashboard,
  type DeskPerformanceRow,
  type DeskQueueRow,
  type DeskQueueTab,
  type DeskUnitSettings,
  type KbArticle,
  type KbListRow,
  type KbSearchHit,
  type KbStatus,
  type OpenServiceCategory,
  type ServiceCategory,
  type ServiceCategoryRow,
  type ServiceSla,
  type ServiceTicketExtras,
  type ServiceTicketRow,
  type ShiftSummary,
  type TicketType,
  type TrendPoint,
} from "./desk-types";
import { RH } from "./permissions";
import { minutesLeft, resolutionState, responseState } from "./sla";
import type { Priority, Ticket } from "./types";

/*
 * Service Desk reads (doc/resolve/service-desk-plan.md §3). Same rules as
 * service.ts: every read runs as the operator under RLS, and A FAILED QUERY IS
 * AN ERROR, NOT AN EMPTY LIST — an empty Unassigned tab must mean nothing is
 * waiting, never "the query broke".
 *
 * The queue, the shift line, the dashboard and the performance table are each
 * ONE RPC that scopes, orders and computes the SLA states in SQL; this file
 * only normalises numbers (PostgREST returns bigint as string) and fills
 * defaults. The SLA states for rows read straight from `rh_tickets` (My
 * Reports, the ticket page) come from lib/resolve/sla.ts on the SERVER clock —
 * never `Date.now()` in a render.
 */

type Sb = Awaited<ReturnType<typeof createClient>>;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

function uniq(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((v): v is string => !!v))];
}

const n = (v: unknown): number => Number(v) || 0;
const nOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** One row out of an RPC that may return a row, a one-row table, or jsonb. */
function one<T>(data: unknown): T | null {
  return ((Array.isArray(data) ? data[0] : data) ?? null) as T | null;
}

/** id → full name, one round trip (creator_names — see service.ts). */
async function peopleNames(s: Sb, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = uniq(ids);
  if (!list.length) return new Map();
  const rows = must(await s.rpc("creator_names", { ids: list }), "Reading people's names") as
    | { id: string; full_name: string | null }[]
    | null;
  return new Map((rows ?? []).filter((r) => r.full_name).map((r) => [r.id, r.full_name as string]));
}

async function me(): Promise<string> {
  const u = await getAppUser();
  if (!u) throw new Error("Sign in to continue");
  return u.id;
}

// ---- intake ------------------------------------------------------------------

/** Categories the request form offers — active, current unit. */
export async function listOpenServiceCategories(): Promise<OpenServiceCategory[]> {
  const s = await createClient();
  const rows = (must(await s.rpc("rh_sd_categories_open"), "Reading service categories") ?? []) as OpenServiceCategory[];
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description ?? null,
    ticket_type: c.ticket_type,
  }));
}

// ---- SLA matrix ----------------------------------------------------------------

/** The current unit's matrix, every priority present (seed values where a row
 *  is missing). Ordered Urgent → Low. */
export async function listServiceSla(): Promise<ServiceSla[]> {
  const s = await createClient();
  const loc = await getCurrentLocationId();
  const rows = loc
    ? ((must(
        await s.from("rh_sd_sla").select("priority, response_minutes, resolution_minutes").eq("location_id", loc),
        "Reading the service SLA",
      ) ?? []) as ServiceSla[])
    : [];
  const by = new Map(rows.map((r) => [r.priority, r]));
  return DEFAULT_SERVICE_SLA.map((d) => {
    const r = by.get(d.priority);
    return r
      ? { priority: d.priority, response_minutes: n(r.response_minutes), resolution_minutes: n(r.resolution_minutes) }
      : { ...d };
  });
}

function slaFor(matrix: readonly ServiceSla[], priority: Priority): ServiceSla {
  return matrix.find((m) => m.priority === priority) ?? DEFAULT_SERVICE_SLA.find((m) => m.priority === priority)!;
}

// ---- queue and boards ----------------------------------------------------------

/** One desk tab, in queue order: overridden first, then priority, then FIFO. */
export async function listDeskQueue(tab: DeskQueueTab): Promise<DeskQueueRow[]> {
  const s = await createClient();
  const rows = (must(await s.rpc("rh_sd_queue", { p_tab: tab }), "Reading the desk queue") ?? []) as DeskQueueRow[];
  return rows.map((r) => ({
    ...r,
    overridden: !!r.overridden,
    override_kind: r.override_kind ?? null,
    minutes_left: nOrNull(r.minutes_left),
    stale_days: n(r.stale_days),
  }));
}

export async function getShiftSummary(): Promise<ShiftSummary> {
  const s = await createClient();
  const r = one<Partial<ShiftSummary>>(must(await s.rpc("rh_sd_shift_summary"), "Reading your shift summary"));
  return {
    carried_over: n(r?.carried_over),
    stale: n(r?.stale),
    breaching: n(r?.breaching),
    new_since_last_shift: n(r?.new_since_last_shift),
  };
}

const trend = (pts: unknown): TrendPoint[] =>
  ((pts ?? []) as TrendPoint[]).map((p) => ({ d: p.d, created: n(p.created), resolved: n(p.resolved) }));

export async function getDeskDashboard(): Promise<DeskDashboard> {
  const s = await createClient();
  const a = one<Partial<DeskDashboard>>(must(await s.rpc("rh_sd_dashboard"), "Reading the desk dashboard"));
  return {
    open: n(a?.open),
    unassigned: n(a?.unassigned),
    on_hold: n(a?.on_hold),
    at_risk: n(a?.at_risk),
    breached_response: n(a?.breached_response),
    breached_resolution: n(a?.breached_resolution),
    resolved_today: n(a?.resolved_today),
    escalations: n(a?.escalations),
    by_technician: (a?.by_technician ?? []).map((t) => ({
      profile_id: t.profile_id,
      name: t.name,
      assigned: n(t.assigned),
      in_progress: n(t.in_progress),
      on_hold: n(t.on_hold),
      breached: n(t.breached),
    })),
    by_priority: (a?.by_priority ?? []).map((p) => ({ priority: p.priority, open: n(p.open) })),
    by_type: (a?.by_type ?? []).map((p) => ({ ticket_type: p.ticket_type, open: n(p.open) })),
    trend: {
      daily: trend(a?.trend?.daily),
      weekly: trend(a?.trend?.weekly),
      monthly: trend(a?.trend?.monthly),
    },
    escalation_list: (a?.escalation_list ?? []).map((e) => ({
      id: e.id,
      ref_no: e.ref_no,
      title: e.title,
      priority: e.priority,
      reason: e.reason,
      at: e.at ?? null,
      assignee_name: e.assignee_name ?? null,
    })),
  };
}

/** Per technician, plus the desk total LAST (`profile_id` null). Dates are
 *  `YYYY-MM-DD`, inclusive — they are fed to the query, never formatted. */
export async function getDeskPerformance(from: string, to: string): Promise<DeskPerformanceRow[]> {
  const s = await createClient();
  const rows = (must(
    await s.rpc("rh_sd_performance", { p_from: from, p_to: to }),
    "Reading technician performance",
  ) ?? []) as DeskPerformanceRow[];
  const norm = rows.map((r) => ({
    profile_id: r.profile_id ?? null,
    name: r.name ?? (r.profile_id ? "" : "Desk total"),
    resolved: n(r.resolved),
    avg_first_response_min: nOrNull(r.avg_first_response_min),
    avg_resolution_min: nOrNull(r.avg_resolution_min),
    response_met_pct: nOrNull(r.response_met_pct),
    resolution_met_pct: nOrNull(r.resolution_met_pct),
    csat_avg: nOrNull(r.csat_avg),
    csat_count: n(r.csat_count),
    reopened: n(r.reopened),
    kb_authored: n(r.kb_authored),
  }));
  return [...norm.filter((r) => r.profile_id), ...norm.filter((r) => !r.profile_id)];
}

// ---- tickets -----------------------------------------------------------------

type SdCat = { id: string; code: string; name: string; ticket_type: TicketType };

/** Service rows → the shared listing row + the desk's words, server clock. */
async function hydrateService(s: Sb, rows: Ticket[]): Promise<ServiceTicketRow[]> {
  if (!rows.length) return [];
  const catIds = uniq(rows.map((r) => r.sd_category_id));
  const teamIds = uniq(rows.map((r) => r.team_id));
  const [people, catRes, teamRes, matrix] = await Promise.all([
    peopleNames(s, rows.flatMap((r) => [r.owner_id, r.assignee_id, r.reporter_id])),
    catIds.length
      ? s.from("rh_sd_categories").select("id, code, name, ticket_type").in("id", catIds)
      : Promise.resolve({ data: [] as SdCat[], error: null }),
    teamIds.length
      ? s.from("rh_teams").select("id, name").in("id", teamIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    listServiceSla(),
  ]);
  const cats = new Map(((must(catRes, "Reading service categories") ?? []) as SdCat[]).map((c) => [c.id, c]));
  const teams = new Map(((must(teamRes, "Reading teams") ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const now = Date.now();
  return rows.map((r) => {
    const cat = r.sd_category_id ? cats.get(r.sd_category_id) : undefined;
    const sla = slaFor(matrix, r.priority);
    const resolution = resolutionState(r.status, r.due_at, sla.resolution_minutes, now);
    return {
      ...r,
      place_name: null,
      trade_name: null,
      team_name: (r.team_id && teams.get(r.team_id)) || null,
      owner_name: (r.owner_id && people.get(r.owner_id)) || null,
      assignee_name: (r.assignee_id && people.get(r.assignee_id)) || null,
      reporter_name: (r.reporter_id && people.get(r.reporter_id)) || null,
      is_late: resolution === "breached",
      joiners: 0,
      category_name: cat?.name ?? null,
      is_anonymous: false,
      about_superior: false,
      is_sensitive: false,
      resolution_message: null,
      response_due_at: r.response_due_at ?? null,
      ticket_type: r.ticket_type ?? cat?.ticket_type ?? null,
      category_code: cat?.code ?? null,
      response_state: responseState(r.first_response_at, r.response_due_at, now, r.status),
      resolution_state: resolution,
      minutes_left: minutesLeft(r.status, r.due_at, now),
    };
  });
}

/** My IT requests (raised by me, or logged for me by the desk), any unit.
 *  LISTED IN ENTRY ORDER — 1, 2, 3. */
export async function listMyServiceTickets(): Promise<ServiceTicketRow[]> {
  const uid = await me();
  const s = await createClient();
  const rows = (must(
    await s
      .from("rh_tickets")
      .select("*")
      .eq("kind", "service")
      .eq("reporter_id", uid)
      .order("created_at", { ascending: true }),
    "Reading your IT requests",
  ) ?? []) as Ticket[];
  return withCreators(await hydrateService(s, rows));
}

/**
 * What the ticket page adds for a service ticket, beside `getTicketDetail`.
 * Null when RLS hides the ticket or it is not a service ticket.
 */
export async function getServiceTicketExtras(id: string): Promise<ServiceTicketExtras | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const s = await createClient();
  const t = must(
    await s.from("rh_tickets").select("*").eq("id", id).eq("kind", "service").maybeSingle(),
    "Reading the ticket",
  ) as Ticket | null;
  if (!t) return null;

  const [catRes, kbRes, preRes, pausedRes, people, matrix] = await Promise.all([
    t.sd_category_id
      ? s.from("rh_sd_categories").select("id, code, name, ticket_type").eq("id", t.sd_category_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    t.kb_article_id
      ? s.from("rh_kb_articles").select("id, code, title").eq("id", t.kb_article_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    t.preempted_by
      ? s.from("rh_tickets").select("id, ref_no, title").eq("id", t.preempted_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    s
      .from("rh_tickets")
      .select("id, ref_no, title")
      .eq("preempted_by", id)
      .eq("status", "on_hold")
      .order("created_at", { ascending: true }),
    peopleNames(s, [t.overridden_by]),
    listServiceSla(),
  ]);
  const category = must(catRes, "Reading the category") as SdCat | null;
  // An article RLS hides (a draft, to a requester) reads as "none linked".
  const kb = must(kbRes, "Reading the linked article") as { id: string; code: string; title: string } | null;
  const pre = must(preRes, "Reading the urgent ticket") as { id: string; ref_no: string; title: string } | null;
  const paused = (must(pausedRes, "Reading paused tickets") ?? []) as { id: string; ref_no: string; title: string }[];

  const sla = slaFor(matrix, t.priority);
  const now = Date.now();
  const resolution = resolutionState(t.status, t.due_at, sla.resolution_minutes, now);
  const live = resolution !== "done";
  return {
    category,
    kb_article: kb,
    overridden_by_name: (t.overridden_by && people.get(t.overridden_by)) || null,
    preempted_by: pre,
    paused_for_this: paused,
    sla,
    response_state: responseState(t.first_response_at, t.response_due_at, now, t.status),
    resolution_state: resolution,
    minutes_left: minutesLeft(t.status, t.due_at, now),
    kb_suggestions: live && !t.kb_article_id ? await searchKb(t.title, category?.code ?? null, 3) : [],
  };
}

// ---- knowledge base ----------------------------------------------------------

/** Published articles matching a query — what the form and the ticket page
 *  suggest. Under two characters there is nothing to match yet. */
export async function searchKb(q: string, categoryCode: string | null = null, limit = 5): Promise<KbSearchHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const s = await createClient();
  const rows = (must(
    await s.rpc("rh_kb_search", { p_q: query, p_category_code: categoryCode, p_limit: Math.min(Math.max(limit, 1), 20) }),
    "Searching the knowledge base",
  ) ?? []) as KbSearchHit[];
  return rows.map((r) => ({ ...r, steps: r.steps ?? [], rank: Number(r.rank) || 0 }));
}

/** The KB list: published for everyone; drafts / retired need resolve:edit
 *  (the RPC refuses otherwise). Newest first — a library, not a ledger. */
export async function listKbArticles(status: KbStatus = "published", q: string | null = null): Promise<KbListRow[]> {
  const s = await createClient();
  const rows = (must(
    await s.rpc("rh_kb_list", { p_status: status, p_q: q?.trim() || null }),
    "Reading the knowledge base",
  ) ?? []) as (KbListRow & { steps?: string[] | null })[];
  const names = await peopleNames(s, rows.map((r) => r.author_id));
  return withCreators(
    rows.map(({ steps, ...r }) => ({
      ...r,
      tags: r.tags ?? [],
      step_count: typeof r.step_count === "number" ? r.step_count : (steps ?? []).length,
      author_name: r.author_name ?? ((r.author_id && names.get(r.author_id)) || null),
      used_count: n(r.used_count),
      helpful_count: n(r.helpful_count),
      not_helpful_count: n(r.not_helpful_count),
    })),
  );
}

/** One article. Null when it does not exist or the viewer may not read it. */
export async function getKbArticle(id: string): Promise<KbArticle | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const s = await createClient();
  const r = one<KbArticle>(must(await s.rpc("rh_kb_get", { p_id: id }), "Reading the article"));
  if (!r?.id) return null;
  const names = await peopleNames(s, [r.author_id]);
  return {
    ...r,
    steps: r.steps ?? [],
    tags: r.tags ?? [],
    author_name: r.author_name ?? ((r.author_id && names.get(r.author_id)) || null),
    used_count: n(r.used_count),
    helpful_count: n(r.helpful_count),
    not_helpful_count: n(r.not_helpful_count),
    my_feedback: r.my_feedback ?? null,
  };
}

// ---- administration ----------------------------------------------------------

/** Administration ▸ Service Categories. Masters stay alphabetical. */
export async function listServiceCategories(): Promise<ServiceCategoryRow[]> {
  const s = await createClient();
  const rows = (must(await s.from("rh_sd_categories").select("*").order("name"), "Reading service categories") ??
    []) as ServiceCategory[];
  const teamIds = uniq(rows.map((r) => r.team_id));
  const teams = teamIds.length
    ? new Map(
        ((must(await s.from("rh_teams").select("id, name").in("id", teamIds), "Reading teams") ?? []) as {
          id: string;
          name: string;
        }[]).map((t) => [t.id, t.name]),
      )
    : new Map<string, string>();
  return withCreators(rows.map((r) => ({ ...r, team_name: (r.team_id && teams.get(r.team_id)) || null })));
}

/** The desk's half of the current unit's settings — defaults when unsaved. */
export async function getDeskUnitSettings(): Promise<DeskUnitSettings> {
  const s = await createClient();
  const loc = await getCurrentLocationId();
  const row = loc
    ? (must(
        await s
          .from("rh_unit_settings")
          .select("desk_manager_id, sd_auto_close_days, sd_stale_remind_days, sd_stale_escalate_days, sd_reopen_days")
          .eq("location_id", loc)
          .maybeSingle(),
        "Reading desk settings",
      ) as Partial<DeskUnitSettings> | null)
    : null;
  return {
    desk_manager_id: row?.desk_manager_id ?? DEFAULT_DESK_SETTINGS.desk_manager_id,
    sd_auto_close_days: row?.sd_auto_close_days ?? DEFAULT_DESK_SETTINGS.sd_auto_close_days,
    sd_stale_remind_days: row?.sd_stale_remind_days ?? DEFAULT_DESK_SETTINGS.sd_stale_remind_days,
    sd_stale_escalate_days: row?.sd_stale_escalate_days ?? DEFAULT_DESK_SETTINGS.sd_stale_escalate_days,
    sd_reopen_days: row?.sd_reopen_days ?? DEFAULT_DESK_SETTINGS.sd_reopen_days,
  };
}

/**
 * Everyone who holds the triage key (resolve:approve) — the desk manager needs
 * it to open the tickets escalated to them (plan §1.9), and Unit Settings warns
 * when the one chosen does not. One call (`users_with_permission`, roles + per
 * person grants + super admins), not one per person.
 */
export async function listDeskApproverIds(): Promise<string[]> {
  const s = await createClient();
  const rows = (must(
    await s.rpc("users_with_permission", { p_module: "resolve", p_action: RH.triage }),
    "Reading who can triage",
  ) ?? []) as { user_id: string }[];
  return uniq(rows.map((r) => r.user_id));
}
