import "server-only";
import { notify } from "@/lib/notifications/notify";
import { createAdminClient } from "@/lib/supabase/server";
import { isResolveEvent, RESOLVE_MESSAGES, resolveHref, type ResolveEventKey } from "./messages";

/*
 * Drains `rh_outbox` — the durable queue a trigger on `rh_ticket_activity`
 * fills (plan §8). Each row is claimed by `rh_outbox_claim` (which leases it,
 * so two drains never send one row twice), sent, and marked by `rh_outbox_mark`
 * — 'failed' rows are retried by the database with back-off.
 *
 * Called two ways: best-effort right after a transition (`after()` in
 * actions.ts, scoped to that ticket), and every five minutes by the
 * `resolve-outbox` job, which is the mechanism — the after-hook is only what
 * makes an alert arrive in seconds instead of minutes.
 *
 * SMS rows are recorded by the database for a dangerous report; there is no
 * SMS / WhatsApp provider in this app, so they end 'skipped' with that reason
 * and are NEVER marked sent.
 */

/** What `rh_outbox_claim` returns (0740): the row, plus the ticket's ref /
 *  title and the activity's note / meta, joined in SQL. */
type OutboxRow = {
  id: string;
  activity_id: string;
  ticket_id: string | null;
  location_id: string | null;
  event_key: string;
  recipient_id: string | null;
  channel: "in_app" | "sms" | string;
  attempts: number;
  ref_no: string | null;
  title: string | null;
  location_name: string | null;
  action: string | null;
  note: string | null;
  meta: Record<string, unknown> | null;
  /** 0747: the complaint category's flag (null on a Broken ticket). */
  is_sensitive?: boolean | null;
};

const NO_SMS = "No SMS/WhatsApp provider configured";

export type DrainResult = { sent: number; skipped: number; failed: number; error?: string };

/**
 * `ticketId` marks a drain started by an action (dispatch source "action");
 * the claim itself is not per-ticket — it takes the oldest pending rows, which
 * includes this ticket's, so the after-hook also clears any backlog.
 */
export async function drainOutbox(
  opts: { ticketId?: string; limit?: number; source?: "action" | "cron" } = {},
): Promise<DrainResult> {
  const admin = createAdminClient();
  const result: DrainResult = { sent: 0, skipped: 0, failed: 0 };

  const limit = Math.min(Math.max(opts.limit ?? (opts.ticketId ? 25 : 100), 1), 500);
  const { data, error } = await admin.rpc("rh_outbox_claim", { p_limit: limit });
  if (error) return { ...result, error: `Claiming the outbox: ${error.message}` };
  const rows = (data ?? []) as OutboxRow[];
  if (!rows.length) return result;

  const mark = async (id: string, status: "sent" | "failed" | "skipped", err: string | null) => {
    const { error: e } = await admin.rpc("rh_outbox_mark", { p_id: id, p_status: status, p_error: err });
    if (e) result.error = `Marking the outbox: ${e.message}`;
  };

  // What the claim does not carry: the place, the ticket's kind, and — for a
  // complaint — whether its category is sensitive and when it is due. If this
  // read fails, every row is worded as a SENSITIVE COMPLAINT (ref number
  // only): an alert that says too little is a nuisance, one that prints a
  // harassment complaint's subject to the wrong phone is not recoverable.
  type TicketInfo = {
    id: string;
    kind: string;
    place_id: string | null;
    category_id: string | null;
    response_due_at: string | null;
  };
  const ticketIds = [...new Set(rows.map((r) => r.ticket_id).filter((v): v is string => !!v))];
  const info = new Map<string, TicketInfo & { place_name: string | null; is_sensitive: boolean | null }>();
  if (ticketIds.length) {
    const { data: t, error: tErr } = await admin
      .from("rh_tickets")
      .select("id, kind, place_id, category_id, response_due_at")
      .in("id", ticketIds);
    const list = tErr ? [] : ((t ?? []) as TicketInfo[]);
    const placeIds = [...new Set(list.map((x) => x.place_id).filter((v): v is string => !!v))];
    const catIds = [...new Set(list.map((x) => x.category_id).filter((v): v is string => !!v))];
    const [pRes, cRes] = await Promise.all([
      placeIds.length
        ? admin.from("rh_places").select("id, name").in("id", placeIds)
        : Promise.resolve({ data: [], error: null }),
      catIds.length
        ? admin.from("rh_complaint_categories").select("id, is_sensitive").in("id", catIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const places = new Map(((pRes.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
    const cats = cRes.error
      ? new Map<string, boolean>()
      : new Map(((cRes.data ?? []) as { id: string; is_sensitive: boolean }[]).map((x) => [x.id, x.is_sensitive]));
    for (const x of list) {
      info.set(x.id, {
        ...x,
        place_name: (x.place_id && places.get(x.place_id)) || null,
        // a category we could not read stays null → treated as sensitive
        is_sensitive: x.category_id ? (cats.get(x.category_id) ?? null) : false,
      });
    }
  }

  for (const row of rows) {
    try {
      if (row.channel === "sms") {
        await mark(row.id, "skipped", NO_SMS);
        result.skipped++;
        continue;
      }
      if (!isResolveEvent(row.event_key)) {
        await mark(row.id, "failed", `Unknown event ${row.event_key}`);
        result.failed++;
        continue;
      }
      if (!row.recipient_id) {
        await mark(row.id, "skipped", "No recipient");
        result.skipped++;
        continue;
      }
      const key: ResolveEventKey = row.event_key;
      const t = row.ticket_id ? info.get(row.ticket_id) : undefined;
      const msg = RESOLVE_MESSAGES[key]({
        ref_no: row.ref_no,
        title: row.title,
        place_name: t?.place_name ?? null,
        note: row.note,
        meta: row.meta ?? {},
        // unknown ticket → worded as a sensitive complaint (see above)
        kind: row.ticket_id ? (t?.kind ?? "complaint") : null,
        // Either source saying "sensitive" wins; a known "not sensitive" prints the subject; unknown hides it.
        is_sensitive: row.is_sensitive === true || t?.is_sensitive === true
          ? true
          : row.is_sensitive === false || t?.is_sensitive === false
            ? false
            : null,
        response_due_at: t?.response_due_at ?? null,
      });
      const dispatch = await notify(
        key,
        { userId: row.recipient_id },
        { title: msg.title, body: msg.body, href: resolveHref(key, row.ticket_id), type: msg.type },
        // One named recipient per row — "nobody to tell" was already decided in SQL.
        { source: opts.source ?? (opts.ticketId ? "action" : "cron"), fallbackToAdmins: false },
      );
      if (dispatch) {
        await mark(row.id, "sent", null);
        result.sent++;
      } else {
        await mark(row.id, "failed", "The notification could not be recorded");
        result.failed++;
      }
    } catch (e) {
      await mark(row.id, "failed", e instanceof Error ? e.message : String(e));
      result.failed++;
    }
  }
  return result;
}
