import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_KEYS,
  notificationEvent,
  type NotificationEventKey,
} from "./events";
import type {
  DispatchFilters,
  DispatchPage,
  DispatchRow,
  DispatchStatus,
  NotificationDevice,
  NotificationOverview,
  ReachablePerson,
  Retention,
} from "./admin-types";

/**
 * Administration ▸ System ▸ Notifications — the READ side (Phase 1,
 * doc/admin/notification-management-plan.md §5).
 *
 * Everything that crosses users goes through 0675's SECURITY DEFINER readers,
 * which check `system_admin:view` themselves; the dispatch log is read
 * directly, under 0673's `system_admin:view` policy. A failed query is an
 * ERROR here, never an empty list: on this screen "nothing was sent" is a real
 * and unremarkable answer, so a broken read reporting it would be believed.
 */

export const DISPATCH_PAGE_SIZE = 50;

const ENV_CHECKS = [
  {
    key: "push",
    label: "Phone & browser alerts (web push)",
    vars: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
    missing: "Alerts reach the bell only — no phone or desktop alert is sent.",
  },
  {
    key: "cron",
    label: "Scheduled jobs (CRON_SECRET)",
    vars: ["CRON_SECRET"],
    missing:
      "Every scheduled job refuses to run: approval timeouts never escalate, overdue milestones and order risks are never raised.",
  },
  {
    key: "email",
    label: "Email (Resend)",
    vars: ["RESEND_API_KEY"],
    missing: "Welcome mails and buyer approval links are not emailed; the link has to be copied by hand.",
  },
] as const;

export async function getNotificationOverview(): Promise<NotificationOverview> {
  const s = await createClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const staticRoles = [
    ...new Set(
      NOTIFICATION_EVENT_KEYS.map((k) => notificationEvent(k)?.staticAudience?.role).filter(
        (r): r is string => !!r,
      ),
    ),
  ];

  const [people, stats, settings, cc, roles, ...roleHolders] = await Promise.all([
    s.rpc("notification_admin_people"),
    s.rpc("notification_event_stats", { p_since: since }),
    s.from("notification_event_settings").select("event_key, enabled, push, fallback_to_admins, updated_by, updated_at"),
    s.from("notification_event_cc").select("event_key, kind, role_id, user_id"),
    s.from("roles").select("id, name").order("name"),
    ...staticRoles.map((role) => s.rpc("users_with_role", { p_name: role })),
  ]);
  if (people.error) throw new Error(people.error.message);
  if (stats.error) throw new Error(stats.error.message);
  if (settings.error) throw new Error(settings.error.message);
  if (cc.error) throw new Error(cc.error.message);
  if (roles.error) throw new Error(roles.error.message);
  const ccBy = new Map<string, { roles: string[]; users: string[] }>();
  for (const c of (cc.data ?? []) as { event_key: string; kind: string; role_id: string | null; user_id: string | null }[]) {
    const e = ccBy.get(c.event_key) ?? { roles: [], users: [] };
    if (c.kind === "role" && c.role_id) e.roles.push(c.role_id);
    if (c.kind === "user" && c.user_id) e.users.push(c.user_id);
    ccBy.set(c.event_key, e);
  }
  const holders = new Map<string, number>();
  staticRoles.forEach((role, i) => {
    const r = roleHolders[i];
    if (r.error) throw new Error(r.error.message);
    holders.set(role, (r.data ?? []).length);
  });

  const statBy = new Map(
    ((stats.data ?? []) as {
      event_key: string;
      dispatches: number;
      delivered: number;
      recipients: number;
      fell_back: number;
      no_recipients: number;
      disabled: number;
      push_failed: number;
      last_sent_at: string | null;
    }[]).map((r) => [r.event_key, r]),
  );
  const setBy = new Map(
    ((settings.data ?? []) as {
      event_key: string;
      enabled: boolean;
      push: boolean;
      fallback_to_admins: boolean;
      updated_by: string | null;
      updated_at: string | null;
    }[]).map(
      (r) => [r.event_key, r],
    ),
  );

  const reach = (people.data ?? []) as ReachablePerson[];
  const active = reach.filter((p) => p.is_active);

  return {
    plumbing: ENV_CHECKS.map((c) => ({
      key: c.key,
      label: c.label,
      ok: c.vars.every((v) => !!process.env[v]),
      missing: c.missing,
    })),
    people: reach,
    activeLogins: active.length,
    withDevice: active.filter((p) => p.device_count > 0).length,
    events: NOTIFICATION_EVENT_KEYS.map((key) => {
      const def = notificationEvent(key)!;
      const st = statBy.get(key);
      const set = setBy.get(key);
      const role = def.staticAudience?.role ?? null;
      return {
        key,
        module: def.module,
        label: def.label,
        audience: def.audience,
        mandatory: def.mandatory,
        enabled: def.mandatory || (set?.enabled ?? true),
        push: set?.push ?? def.push,
        fallbackToAdmins: set?.fallback_to_admins ?? def.fallbackToAdmins,
        staticRole: role,
        roleHolders: role ? (holders.get(role) ?? 0) : null,
        sent30: st?.delivered ?? 0,
        recipients30: st?.recipients ?? 0,
        fellBack30: st?.fell_back ?? 0,
        reachedNobody30: st?.no_recipients ?? 0,
        disabled30: st?.disabled ?? 0,
        pushFailed30: st?.push_failed ?? 0,
        lastSentAt: st?.last_sent_at ?? null,
        ccRoleIds: ccBy.get(key)?.roles ?? [],
        ccUserIds: ccBy.get(key)?.users ?? [],
        // Seeded rows carry the migration's time; only a person's change counts.
        updatedAt: set?.updated_by ? set.updated_at : null,
      };
    }),
    roles: (roles.data ?? []) as { id: string; name: string }[],
  };
}

/**
 * The dispatch log, newest first — a LOG, so it keeps `created_at desc` (the
 * entry-order rule exempts logs). Paged in the QUERY, not by `DataTable`'s
 * display slice: this table gains a row per alert forever, which is the case
 * the Pagination section of AGENTS.md says belongs in the service.
 *
 * created-by: exempt -- the dispatch log. Most rows are raised by a scheduled
 * job, not a person; the one who did act (a broadcast, Phase 2) is `actor_id`,
 * shown in its own column.
 */
export async function listDispatches(
  f: DispatchFilters,
  opts: { showBody: boolean },
): Promise<DispatchPage> {
  const s = await createClient();
  const page = Math.max(1, f.page ?? 1);
  let q = s
    .from("notification_dispatches")
    .select(
      "id, event_key, title, body, href, type, target, primary_count, cc_count, recipient_count, " +
        "fallback_used, suppressed, push_attempted, push_sent, push_failed, push_pruned, error, source, created_at, recalled_at",
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * DISPATCH_PAGE_SIZE, page * DISPATCH_PAGE_SIZE); // one extra row = "is there a next page"

  if (f.event) q = q.eq("event_key", f.event);
  if (f.from) q = q.gte("created_at", f.from);
  if (f.to) q = q.lte("created_at", `${f.to}T23:59:59.999`);
  switch (f.status) {
    case "delivered":
      q = q.is("suppressed", null).eq("fallback_used", false).is("recalled_at", null);
      break;
    case "fell_back":
      q = q.eq("fallback_used", true);
      break;
    case "no_recipients":
      q = q.eq("suppressed", "no_recipients");
      break;
    case "disabled":
      q = q.eq("suppressed", "disabled");
      break;
    case "push_failed":
      q = q.gt("push_failed", 0);
      break;
    case "recalled":
      q = q.not("recalled_at", "is", null);
      break;
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as DispatchRow[];
  const hasMore = rows.length > DISPATCH_PAGE_SIZE;
  return {
    rows: rows.slice(0, DISPATCH_PAGE_SIZE).map((r) => ({
      ...r,
      // Bodies can name fines, salaries, margins (plan §7.1): edit rights only.
      body: opts.showBody ? r.body : null,
      status: dispatchStatus(r),
    })),
    page,
    hasMore,
  };
}

export function dispatchStatus(
  r: Pick<DispatchRow, "suppressed" | "fallback_used" | "push_failed" | "error" | "recalled_at">,
): DispatchStatus {
  if (r.recalled_at) return "recalled";
  if (r.error) return "error";
  if (r.suppressed === "disabled") return "disabled";
  if (r.suppressed === "no_recipients") return "no_recipients";
  if (r.fallback_used) return "fell_back";
  if (r.push_failed > 0) return "push_failed";
  return "delivered";
}

export async function listDispatchRecipients(
  dispatchId: string,
): Promise<{ user_id: string; full_name: string | null; email: string | null; read_at: string | null }[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("notification_dispatch_recipients", { p_dispatch: dispatchId });
  if (error) throw new Error(error.message);
  return (data ?? []) as { user_id: string; full_name: string | null; email: string | null; read_at: string | null }[];
}

/** created-by: exempt -- devices are registered by their own user's browser;
 *  the owner IS the row's subject, shown as its first column. */
export async function listNotificationDevices(): Promise<NotificationDevice[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("notification_admin_devices");
  if (error) throw new Error(error.message);
  return (data ?? []) as NotificationDevice[];
}

/** The retention singleton (0677) — what the housekeeping job deletes by. */
export async function getRetention(): Promise<Retention> {
  const s = await createClient();
  const { data, error } = await s
    .from("notification_settings")
    .select("read_retention_days, unread_retention_days, dispatch_retention_days, job_run_retention_days")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    readDays: data?.read_retention_days ?? 90,
    unreadDays: data?.unread_retention_days ?? 365,
    logDays: data?.dispatch_retention_days ?? 180,
    jobRunDays: data?.job_run_retention_days ?? 90,
  };
}

export function isEventKey(v: string | undefined): v is NotificationEventKey {
  return !!v && v in NOTIFICATION_EVENTS;
}
