import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/server";
import { notificationInput, type NotificationInput } from "./types";

/**
 * Who receives a notification. One user, an explicit list, everyone in a role,
 * or everyone who holds a module:action permission (role-granted or super admin).
 */
export type NotifyTarget =
  | { userId: string }
  | { userIds: string[] }
  | { role: string }
  | { permission: { module: string; action: string } };

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

/**
 * Raise a notification for one or more users. Inserts a row per recipient (which
 * the recipient's open app receives live via Supabase Realtime) AND sends web
 * push to each recipient's registered devices (for when the app is closed).
 *
 * Fire-and-forget: never throws, so a failure here can't break the ERP action
 * that triggered it (modeled on lib/audit.ts writeAudit).
 *
 * @example
 *   await notify({ userId }, { title: "PO approved", href: "/purchase/orders/1", type: "success" });
 *   await notify({ permission: { module: "finance", action: "approve" } },
 *                { title: "Payment due", body: "BILL-42 due tomorrow", type: "warning" });
 */
export async function notify(
  target: NotifyTarget,
  payload: NotificationInput,
): Promise<void> {
  try {
    const parsed = notificationInput.safeParse(payload);
    if (!parsed.success) return;
    const { title, body, href, type } = parsed.data;

    const admin = createAdminClient();
    const recipients = [...new Set(await resolveRecipients(admin, target))].filter(
      Boolean,
    );
    if (recipients.length === 0) return;

    // 1) In-app rows (service role bypasses RLS for the fan-out insert).
    await admin.from("notifications").insert(
      recipients.map((user_id) => ({
        user_id,
        title,
        body: body ?? null,
        href: href ?? null,
        type: type ?? "info",
      })),
    );

    // 2) Web push to each recipient's devices (best-effort).
    if (!configureVapid()) return;
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", recipients);
    if (!subs?.length) return;

    const message = JSON.stringify({ title, body: body ?? "", url: href ?? "/" });
    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            message,
          );
        } catch (err) {
          const code =
            err && typeof err === "object" && "statusCode" in err
              ? (err as { statusCode?: number }).statusCode
              : undefined;
          // 404/410 = subscription expired/unsubscribed → prune it.
          if (code === 404 || code === 410) {
            await admin.from("push_subscriptions").delete().eq("id", s.id);
          }
        }
      }),
    );
  } catch {
    // notifications must never break the triggering operation
  }
}
