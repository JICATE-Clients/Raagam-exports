import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/server";
import { notificationInput, type NotificationInput } from "./types";
import { NOTIFICATION_EVENTS, type NotificationEventKey } from "./events";

/**
 * Who receives a notification. One user, an explicit list, everyone in a role,
 * everyone who holds a module:action permission (role-granted, email access
 * (0658) or super admin — active logins only, 0660), or the logins of named
 * EMPLOYEES (a merchandiser, a milestone owner), resolved by employee code then
 * email through `employee_login_ids` (0660).
 */
export type NotifyTarget =
  | { userId: string }
  | { userIds: string[] }
  | { role: string }
  | { permission: { module: string; action: string } }
  | { employeeIds: string[] };

export type NotifyOptions = {
  /**
   * AN ALERT THAT REACHES NOBODY GOES TO THE ADMINISTRATORS (0660, notification
   * audit 2026-09-30). "New order → CAD Technician" with nobody holding the
   * role used to vanish without trace. Now it goes to Administrator role holders
   * and super admins, prefixed with why. Only the UNROUTED ones — copying them
   * on every alert is how admins learn to ignore the buzz.
   *
   * Since 0673 the event's own setting (Administration ▸ Notifications) decides
   * this first; a caller may still pass `false` where an empty list is a
   * legitimate answer FOR THIS CALL (nobody to tell is nothing to report). It
   * can only veto, never force it on against the setting.
   */
  fallbackToAdmins?: boolean;
  /** Where the alert came from, for the dispatch log. Sweeps pass "cron". */
  source?: "action" | "cron" | "admin";
  /** Who raised it, when a person did (a broadcast, a test). */
  actorId?: string;
};

const FALLBACK_NOTE = "No one is set up to receive this alert, so it came to you. ";

type AdminClient = ReturnType<typeof createAdminClient>;

let vapidReady = false;
function configureVapid(): boolean {
  if (vapidReady) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false; // push simply skipped until keys are set
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
    publicKey,
    privateKey,
  );
  vapidReady = true;
  return true;
}

async function resolveRecipients(
  admin: AdminClient,
  target: NotifyTarget,
): Promise<string[]> {
  if ("userId" in target) return [target.userId];
  if ("userIds" in target) return target.userIds;
  if ("employeeIds" in target) {
    const ids = [...new Set(target.employeeIds.filter(Boolean))];
    if (!ids.length) return [];
    const { data } = await admin.rpc("employee_login_ids", { p_employees: ids });
    return (data ?? []).map((r: { profile_id: string }) => r.profile_id);
  }
  if ("role" in target) {
    const { data } = await admin.rpc("users_with_role", { p_name: target.role });
    return (data ?? []).map((r: { user_id: string }) => r.user_id);
  }
  const { data } = await admin.rpc("users_with_permission", {
    p_module: target.permission.module,
    p_action: target.permission.action,
  });
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

// ─── Event policy (0673) ─────────────────────────────────────────────────────

type CcRow = {
  kind: "role" | "user" | "permission";
  role_name: string | null;
  user_id: string | null;
  perm_module: string | null;
  perm_action: string | null;
};
type EventPolicy = { enabled: boolean; push: boolean; fallbackToAdmins: boolean; cc: CcRow[] };

/**
 * THE POLICY IS CACHED, BECAUSE AN ALERT MUST NOT COST A ROUND TRIP TO ASK
 * WHETHER IT MAY BE SENT. Server actions are queued (~260 ms a serial await),
 * and a sweep raising forty alerts would ask forty times. One read per server
 * instance per minute; the admin's own save calls
 * `invalidateNotificationPolicy()`, and other instances catch up within the TTL.
 */
const POLICY_TTL_MS = 60_000;
let policyCache: { at: number; byKey: Map<string, EventPolicy> } | null = null;

export function invalidateNotificationPolicy(): void {
  policyCache = null;
}

function registryPolicy(event: NotificationEventKey): EventPolicy {
  const def = NOTIFICATION_EVENTS[event];
  return { enabled: true, push: def.push, fallbackToAdmins: def.fallbackToAdmins, cc: [] };
}

async function policyFor(admin: AdminClient, event: NotificationEventKey): Promise<EventPolicy> {
  if (!policyCache || Date.now() - policyCache.at > POLICY_TTL_MS) {
    const [settings, cc] = await Promise.all([
      admin.from("notification_event_settings").select("event_key, enabled, push, fallback_to_admins"),
      admin
        .from("notification_event_cc")
        .select("event_key, kind, user_id, perm_module, perm_action, role:roles!role_id(name)"),
    ]);
    /* AN UNREADABLE POLICY TABLE NEVER SILENCES AN ALERT. On any error the
       registry's defaults stand and the cache is not filled, so the next alert
       asks again — a missing switch is better than a missing approval. */
    if (settings.error || cc.error) return registryPolicy(event);
    const byKey = new Map<string, EventPolicy>();
    for (const s of (settings.data ?? []) as {
      event_key: string;
      enabled: boolean;
      push: boolean;
      fallback_to_admins: boolean;
    }[]) {
      byKey.set(s.event_key, { enabled: s.enabled, push: s.push, fallbackToAdmins: s.fallback_to_admins, cc: [] });
    }
    for (const c of (cc.data ?? []) as unknown as (Omit<CcRow, "role_name"> & {
      event_key: string;
      role: { name: string } | { name: string }[] | null;
    })[]) {
      const role = Array.isArray(c.role) ? c.role[0] : c.role;
      byKey.get(c.event_key)?.cc.push({
        kind: c.kind,
        role_name: role?.name ?? null,
        user_id: c.user_id,
        perm_module: c.perm_module,
        perm_action: c.perm_action,
      });
    }
    policyCache = { at: Date.now(), byKey };
  }
  const p = policyCache.byKey.get(event) ?? registryPolicy(event);
  // MANDATORY IS THE REGISTRY'S CALL, NOT THE ROW'S (plan §4.1). The database
  // refuses "mandatory and disabled" too; this holds even if a row is missing.
  return NOTIFICATION_EVENTS[event].mandatory ? { ...p, enabled: true } : p;
}

function ccTarget(c: CcRow): NotifyTarget | null {
  if (c.kind === "user" && c.user_id) return { userId: c.user_id };
  if (c.kind === "role" && c.role_name) return { role: c.role_name };
  if (c.kind === "permission" && c.perm_module && c.perm_action)
    return { permission: { module: c.perm_module, action: c.perm_action } };
  return null;
}

/**
 * Raise a notification for one or more users. Inserts a row per recipient (which
 * the recipient's open app receives live via Supabase Realtime) AND sends web
 * push to each recipient's registered devices (for when the app is closed).
 *
 * EVERY CALL NAMES ITS EVENT (0673) — a key from lib/notifications/events.ts.
 * The event's settings decide whether it is sent at all, whether it pushes,
 * who is copied, and whether an unrouted one falls back; and every call leaves
 * one `notification_dispatches` row saying what happened, INCLUDING the calls
 * that were suppressed — "why didn't I get it?" must have an answer on screen.
 *
 * Fire-and-forget: never throws, so a failure here can't break the ERP action
 * that triggered it (modeled on lib/audit.ts writeAudit). The log is written
 * best-effort around the alert, never in front of it.
 *
 * @example
 *   await notify("cad.weights_ready", { userId }, { title: "…", href: "/orders/fabric-bom", type: "success" });
 *   await notify("order.risk", { role: "Managing Director" }, payload, { source: "cron" });
 */
export async function notify(
  event: NotificationEventKey,
  target: NotifyTarget,
  payload: NotificationInput,
  options: NotifyOptions = {},
): Promise<void> {
  try {
    const parsed = notificationInput.safeParse(payload);
    if (!parsed.success) return;
    const { title, href } = parsed.data;
    const type = parsed.data.type ?? "info";
    let body = parsed.data.body;

    const admin = createAdminClient();
    const policy = await policyFor(admin, event);
    const dispatchId = crypto.randomUUID();
    const log = {
      id: dispatchId,
      event_key: event,
      title,
      body: body ?? null,
      href: href ?? null,
      type,
      target,
      source: options.source ?? "action",
      actor_id: options.actorId ?? null,
    };

    // A disabled event still leaves its row: suppressed, and why.
    if (!policy.enabled) {
      await admin.from("notification_dispatches").insert({ ...log, suppressed: "disabled" });
      return;
    }

    const primary = [...new Set(await resolveRecipients(admin, target))].filter(Boolean);
    let cc: string[] = [];
    if (policy.cc.length) {
      const targets = policy.cc.map(ccTarget).filter((t): t is NotifyTarget => !!t);
      const lists = await Promise.all(targets.map((t) => resolveRecipients(admin, t)));
      const seen = new Set(primary);
      cc = [...new Set(lists.flat())].filter((id) => id && !seen.has(id));
    }
    let recipients = [...primary, ...cc];

    let fallbackUsed = false;
    if (recipients.length === 0 && policy.fallbackToAdmins && options.fallbackToAdmins !== false) {
      const { data } = await admin.rpc("notification_fallback_recipients");
      recipients = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))].filter(Boolean) as string[];
      if (recipients.length) {
        fallbackUsed = true;
        body = FALLBACK_NOTE + (body ?? "");
      }
    }

    const { error: logErr } = await admin.from("notification_dispatches").insert({
      ...log,
      body: body ?? null,
      primary_count: primary.length,
      cc_count: cc.length,
      recipient_count: recipients.length,
      fallback_used: fallbackUsed,
      suppressed: recipients.length === 0 ? "no_recipients" : null,
    });
    if (recipients.length === 0) return;
    // A log that could not be written must not cost the alert its link to it.
    const linkId = logErr ? null : dispatchId;

    // 1) In-app rows (service role bypasses RLS for the fan-out insert).
    const { error: rowErr } = await admin.from("notifications").insert(
      recipients.map((user_id) => ({
        user_id,
        title,
        body: body ?? null,
        href: href ?? null,
        type,
        event_key: event,
        dispatch_id: linkId,
      })),
    );
    if (rowErr && linkId) {
      await admin.from("notification_dispatches").update({ error: rowErr.message, recipient_count: 0 }).eq("id", linkId);
    }

    // 2) Web push to each recipient's devices (best-effort).
    if (!policy.push || !configureVapid()) return;
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", recipients);
    if (!subs?.length) return;

    const message = JSON.stringify({ title, body: body ?? "", url: href ?? "/" });
    const ok: string[] = [];
    const failed: string[] = [];
    const pruned: string[] = [];
    let lastError: string | null = null;
    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            message,
          );
          ok.push(s.id);
        } catch (err) {
          const code =
            err && typeof err === "object" && "statusCode" in err
              ? (err as { statusCode?: number }).statusCode
              : undefined;
          // 404/410 = subscription expired/unsubscribed → prune it.
          if (code === 404 || code === 410) pruned.push(s.id);
          else {
            failed.push(s.id);
            lastError = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
          }
        }
      }),
    );
    // Device stats, the prune and the dispatch's push counts — one round trip.
    await admin.rpc("notification_record_push", {
      p_dispatch: linkId,
      p_ok: ok,
      p_failed: failed,
      p_pruned: pruned,
      p_error: lastError,
    });
  } catch {
    // notifications must never break the triggering operation
  }
}
