import "server-only";
import { getCurrentLocationId } from "@/lib/auth/location";
import { createClient } from "@/lib/supabase/server";
import { LANE_OF_KIND, type InboxLists, type InboxRow, type RaiserLists } from "./inbox-types";
import {
  ANONYMOUS,
  JOB_ROW_CAP,
  TICKET_COLS,
  hydrate,
  idNames,
  me,
  must,
  uniq,
  type RawTicket,
  type Sb,
} from "./service";
import type { TicketListRow } from "./types";

/*
 * RESOLVE INBOX (2026-10-26) — ONE list for every lane (Fix · IT · Buy ·
 * Concern) for the person doing the work, and one for the person who raised
 * it. Who sees which row is still RLS; this only decides which TAB a row
 * belongs in and how urgent it reads. The clock words are worked out HERE, so
 * no render reads `Date.now()` (AGENTS "Overdue is answered" — never from a
 * phone's clock in a render).
 */

/** Live statuses a resolver still owes work on, across every kind. */
const INBOX_LIVE = ["open", "assigned", "in_progress", "escalated", "approved"];
const INBOX_WAITING = ["blocked", "on_hold"];
const INBOX_DONE = ["fixed", "closed", "resolved", "fulfilled", "rejected"];

const DONE_WORD: Record<string, string> = {
  fixed: "Fixed",
  closed: "Closed",
  resolved: "Resolved",
  fulfilled: "Given",
  rejected: "Rejected",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
};

function spanWords(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} m` : `${h} h`;
  }
  return `${Math.floor(min / 1440)} d`;
}

type InboxSource = TicketListRow & { sd_category_name?: string | null };

/** The deadline that matters NOW: the response promise until someone has
 *  answered, then the resolution one. Null for a Buy request — its needed-by
 *  is a word, not a clock. */
function inboxDeadline(r: InboxSource): string | null {
  if (r.kind === "requirement") return null;
  if (r.kind === "broken") return r.due_at;
  if (!r.first_response_at) return r.response_due_at ?? r.due_at;
  return r.due_at;
}

function inboxRow(r: InboxSource, nowMs: number, yourTurn = false): InboxRow {
  const sub =
    r.kind === "broken"
      ? [r.place_name, r.trade_name]
      : r.kind === "service"
        ? [r.sd_category_name, r.reporter_name]
        : r.kind === "complaint"
          ? [r.category_name, r.is_anonymous ? ANONYMOUS : null]
          : [r.rq_qty ? `Qty ${r.rq_qty}` : null, r.place_name];
  const base = {
    id: r.id,
    kind: r.kind,
    lane: LANE_OF_KIND[r.kind],
    ref_no: r.ref_no,
    title: r.title,
    sub: sub.filter(Boolean).join(" · "),
    status: r.status,
    dangerous: !!r.is_dangerous,
    yourTurn,
  };
  if (DONE_WORD[r.status]) return { ...base, group: "done", clock: DONE_WORD[r.status], clockTone: "idle" };
  if (INBOX_WAITING.includes(r.status) || r.paused_at) {
    return { ...base, group: "later", clock: "Paused", clockTone: "idle" };
  }
  if (r.kind === "requirement") {
    const need = r.rq_needed_by;
    if (need === "today") return { ...base, group: "soon", clock: "Need today", clockTone: "warn" };
    if (need === "week") return { ...base, group: "today", clock: "Need this week", clockTone: "idle" };
    return { ...base, group: "later", clock: need === "month" ? "Need this month" : "No date", clockTone: "idle" };
  }
  const at = inboxDeadline(r);
  if (!at) return { ...base, group: "later", clock: "No deadline", clockTone: "idle" };
  const min = Math.round((new Date(at).getTime() - nowMs) / 60000);
  if (min < 0) return { ...base, group: "late", clock: `${spanWords(-min)} late`, clockTone: "bad" };
  if (min < 60) return { ...base, group: "soon", clock: `${spanWords(min)} left`, clockTone: "warn" };
  if (min < 24 * 60) return { ...base, group: "today", clock: `${spanWords(min)} left`, clockTone: "ok" };
  return { ...base, group: "later", clock: `${spanWords(min)} left`, clockTone: "ok" };
}

const GROUP_RANK: Record<InboxRow["group"], number> = { late: 0, soon: 1, today: 2, later: 3, done: 4 };

/** Urgent first: band, then dangerous, then the order the query gave. */
function byUrgency(rows: InboxRow[]): InboxRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        GROUP_RANK[a.r.group] - GROUP_RANK[b.r.group] || Number(b.r.dangerous) - Number(a.r.dangerous) || a.i - b.i,
    )
    .map((x) => x.r);
}

async function withServiceCategories(s: Sb, rows: TicketListRow[]): Promise<InboxSource[]> {
  const names = await idNames(s, "rh_sd_categories", rows.map((r) => r.sd_category_id));
  return rows.map((r) => ({ ...r, sd_category_name: (r.sd_category_id && names.get(r.sd_category_id)) || null }));
}

/** A queue never carries who complained (listComplaintWork's rule) — the
 *  ticket pane, opened deliberately, is where a permitted viewer sees it. */
function blindComplaint<T extends RawTicket>(r: T): T {
  return r.kind === "complaint" ? { ...r, reporter_id: null, created_by: null } : r;
}

/**
 * The resolver's four tabs, in the current unit:
 *   mine   live and mine (assignee, or owner with nobody assigned), plus the
 *          live complaints of every category whose committee I sit on
 *   take   Fix / IT, open, nobody on it, on a team I am an active member of
 *   wait   blocked / on hold, and mine
 *   done   finished by me in the last 30 days
 */
export async function loadInbox(): Promise<InboxLists> {
  const uid = await me();
  const s = await createClient();
  const loc = await getCurrentLocationId();
  if (!loc) return { mine: [], take: [], wait: [], done: [] };
  const mineOr = `assignee_id.eq.${uid},and(owner_id.eq.${uid},assignee_id.is.null)`;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const base = () => s.from("rh_tickets").select(TICKET_COLS).eq("location_id", loc);

  const [mineRes, waitRes, doneRes, teamRes, catRes] = await Promise.all([
    base().in("status", INBOX_LIVE).or(mineOr).limit(JOB_ROW_CAP),
    base().in("status", INBOX_WAITING).or(mineOr).limit(JOB_ROW_CAP),
    base()
      .in("status", INBOX_DONE)
      .or(`assignee_id.eq.${uid},owner_id.eq.${uid}`)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(200),
    s.from("rh_team_members").select("team_id").eq("profile_id", uid).eq("active", true),
    s.from("rh_category_members").select("category_id").eq("profile_id", uid),
  ]);
  const teams = uniq(((must(teamRes, "Reading your teams") ?? []) as { team_id: string }[]).map((t) => t.team_id));
  const takeRows = teams.length
    ? ((must(
        await base()
          .in("kind", ["broken", "service"])
          .eq("status", "open")
          .is("assignee_id", null)
          .in("team_id", teams)
          .order("created_at", { ascending: true })
          .limit(JOB_ROW_CAP),
        "Reading jobs to take",
      ) ?? []) as RawTicket[])
    : [];

  // A complaint committee member sees their categories' live complaints in
  // Mine too — the Complaints list they used to open folded into this one.
  const cats = uniq(((must(catRes, "Reading your committees") ?? []) as { category_id: string }[]).map((c) => c.category_id));
  const committeeRows = cats.length
    ? ((must(
        await base()
          .eq("kind", "complaint")
          .in("status", ["open", "assigned", "in_progress", "escalated"])
          .in("category_id", cats)
          .limit(JOB_ROW_CAP),
        "Reading your committees' complaints",
      ) ?? []) as RawTicket[])
    : [];
  const ownRaw = (must(mineRes, "Reading your tickets") ?? []) as RawTicket[];
  const ownIds = new Set(ownRaw.map((r) => r.id));
  const mineRaw = [...ownRaw, ...committeeRows.filter((r) => !ownIds.has(r.id))];
  const waitRaw = (must(waitRes, "Reading tickets on hold") ?? []) as RawTicket[];
  const doneRaw = (must(doneRes, "Reading finished tickets") ?? []) as RawTicket[];
  // A ticket I own with nobody on it is already in Mine — never twice.
  const mineIds = new Set(mineRaw.map((r) => r.id));
  const takeRaw = takeRows.filter((r) => !mineIds.has(r.id));

  const all = [...mineRaw, ...waitRaw, ...doneRaw, ...takeRaw].map(blindComplaint);
  const hydrated = await withServiceCategories(s, await hydrate(s, all));
  const byId = new Map(hydrated.map((r) => [r.id, r]));
  const now = Date.now();
  const rowsOf = (list: RawTicket[]) =>
    list
      .map((r) => byId.get(r.id))
      .filter((r): r is InboxSource => !!r)
      .map((r) => inboxRow(r, now));
  return {
    mine: byUrgency(rowsOf(mineRaw)),
    take: byUrgency(rowsOf(takeRaw)),
    wait: rowsOf(waitRaw),
    done: rowsOf(doneRaw),
  };
}

/**
 * The raiser's list: every ticket I raised (or joined, for a Broken report),
 * in any unit. "Your turn" means the work says it is done and waits on me —
 * confirm, reopen, or rate this round. An anonymous complaint never appears:
 * its reporter is not stored (0745), so it is followed by its tracking link.
 */
export async function loadMyRequests(): Promise<RaiserLists> {
  const uid = await me();
  const s = await createClient();
  const joined = (must(
    await s.from("rh_ticket_joiners").select("ticket_id").eq("profile_id", uid),
    "Reading the problems you joined",
  ) ?? []) as { ticket_id: string }[];
  const ids = joined.map((j) => j.ticket_id);
  let q = s.from("rh_tickets").select(TICKET_COLS);
  q = ids.length ? q.or(`reporter_id.eq.${uid},id.in.(${ids.join(",")})`) : q.eq("reporter_id", uid);
  const rows = (must(await q.order("created_at", { ascending: false }).limit(300), "Reading your requests") ??
    []) as RawTicket[];
  const waiting = rows.filter((r) => r.status === "fixed" || r.status === "resolved");
  const rated = waiting.length
    ? ((must(
        await s
          .from("rh_ratings")
          .select("ticket_id, fix_round")
          .eq("rater_id", uid)
          .in("ticket_id", waiting.map((r) => r.id)),
        "Reading your ratings",
      ) ?? []) as { ticket_id: string; fix_round: number }[])
    : [];
  const ratedRound = new Set(rated.map((r) => `${r.ticket_id}:${r.fix_round}`));
  const hydrated = await withServiceCategories(s, await hydrate(s, rows));
  const now = Date.now();
  const out: RaiserLists = { turn: [], open: [], done: [] };
  for (const r of hydrated) {
    const turn = (r.status === "fixed" || r.status === "resolved") && !ratedRound.has(`${r.id}:${r.fix_round}`);
    const row = inboxRow(r, now, turn);
    if (turn) out.turn.push(row);
    else if (row.group === "done") out.done.push(row);
    else out.open.push(row);
  }
  return out;
}
