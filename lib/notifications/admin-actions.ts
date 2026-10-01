"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { allow } from "@/lib/rate-limit";
import { listDispatchRecipients } from "./admin-service";
import { invalidateNotificationPolicy, notify } from "./notify";
import { NOTIFICATION_EVENTS } from "./events";

/**
 * Administration ▸ System ▸ Notifications — every WRITE (Phase 2,
 * doc/admin/notification-management-plan.md §5).
 *
 * The database functions (0676) each check their own permission and hold the
 * §4 rules — mandatory cannot be switched off, CC is additive, only an
 * administrator's own sends can be taken back. The gates here are the
 * friendlier refusal in front of them, never the only one.
 *
 * Types are NOT re-exported from this file: a `"use server"` module that
 * re-exports a type crashes at runtime ("X is not defined").
 */

const PATH = "/admin/notifications";
/** NULL is active — the SQL readers say `coalesce(is_active, true)`, and
 *  `.neq("is_active", false)` would silently drop every NULL row. */
const ACTIVE = "is_active.is.null,is_active.eq.true";
type Fail = { ok: false; error: string };

/** One dispatch's recipients and their read state — the Log's drill-down. */
export async function loadDispatchRecipients(dispatchId: string) {
  await requirePermission("system_admin", "view");
  try {
    return { ok: true as const, rows: await listDispatchRecipients(dispatchId) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Alert settings ─────────────────────────────────────────────────────────

const eventSettingsInput = z.object({
  key: z.string().refine((k) => k in NOTIFICATION_EVENTS, "Unknown alert"),
  enabled: z.boolean(),
  push: z.boolean(),
  fallbackToAdmins: z.boolean(),
  ccRoles: z.array(z.string().uuid()).max(50),
  ccUsers: z.array(z.string().uuid()).max(200),
});

export async function saveEventSettings(input: z.input<typeof eventSettingsInput>): Promise<{ ok: true } | Fail> {
  await requirePermission("system_admin", "edit");
  const parsed = eventSettingsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  const v = parsed.data;
  const s = await createClient();
  const { error } = await s.rpc("notification_save_event", {
    p_key: v.key,
    p_enabled: v.enabled,
    p_push: v.push,
    p_fallback: v.fallbackToAdmins,
    p_cc_roles: v.ccRoles,
    p_cc_users: v.ccUsers,
  });
  if (error) return { ok: false, error: error.message };
  // This instance stops using the old policy now; others within the 60 s TTL.
  invalidateNotificationPolicy();
  revalidatePath(PATH);
  return { ok: true };
}

// ─── Test ───────────────────────────────────────────────────────────────────

type TestResult = {
  ok: true;
  reached: number;
  pushAttempted: number;
  pushSent: number;
  pushFailed: number;
  suppressed: string | null;
};

/**
 * Send a test alert to one person and report what happened — the answer to
 * "my phone doesn't buzz". Reads the dispatch row `notify()` wrote, so the
 * result is the same record the Log shows, not a second opinion.
 */
export async function sendTestNotification(userId: string): Promise<TestResult | Fail> {
  const me = await requirePermission("system_admin", "create");
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: "Pick a person" };
  if (!allow(`notif-test:${me.id}`, 10, 10 * 60_000)) {
    return { ok: false, error: "That is ten tests in ten minutes — wait a few minutes and try again." };
  }
  const id = await notify(
    "admin.test",
    { userId },
    {
      title: "Test alert",
      body: "If you can read this, alerts reach you. Nothing to do.",
      href: "/",
      type: "info",
    },
    { source: "admin", actorId: me.id },
  );
  if (!id) return { ok: false, error: "The test could not be sent or logged." };
  const { data } = await createAdminClient()
    .from("notification_dispatches")
    .select("recipient_count, push_attempted, push_sent, push_failed, suppressed")
    .eq("id", id)
    .maybeSingle();
  revalidatePath(PATH);
  return {
    ok: true,
    reached: data?.recipient_count ?? 0,
    pushAttempted: data?.push_attempted ?? 0,
    pushSent: data?.push_sent ?? 0,
    pushFailed: data?.push_failed ?? 0,
    suppressed: data?.suppressed ?? null,
  };
}

// ─── Announcement ───────────────────────────────────────────────────────────

const audienceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("everyone") }),
  z.object({ kind: z.literal("roles"), roleIds: z.array(z.string().uuid()).min(1, "Pick at least one role") }),
  z.object({ kind: z.literal("people"), userIds: z.array(z.string().uuid()).min(1, "Pick at least one person") }),
]);

const broadcastInput = z.object({
  audience: audienceInput,
  title: z.string().trim().min(1, "Title is required").max(120, "Keep the title under 120 characters"),
  body: z.string().trim().max(1000, "Keep the message under 1,000 characters").optional(),
  // INTERNAL LINKS ONLY. An announcement goes to every operator's phone; an
  // outside link in it is a phishing message with the company's name on it.
  href: z
    .string()
    .trim()
    .optional()
    .refine((h) => !h || (h.startsWith("/") && !h.startsWith("//")), "A link must be a screen in this app, starting with /"),
  type: z.enum(["info", "success", "warning", "danger"]),
});

/** Active logins the audience resolves to — the preview count AND the send list. */
async function audienceIds(a: z.infer<typeof audienceInput>): Promise<string[]> {
  const admin = createAdminClient();
  let ids: string[];
  if (a.kind === "people") ids = a.userIds;
  else if (a.kind === "roles") {
    const { data, error } = await admin.from("user_roles").select("user_id").in("role_id", a.roleIds);
    if (error) throw new Error(error.message);
    ids = (data ?? []).map((r: { user_id: string }) => r.user_id);
  } else {
    const { data, error } = await admin.from("profiles").select("id").or(ACTIVE);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: { id: string }) => r.id);
  }
  ids = [...new Set(ids)];
  if (!ids.length) return [];
  const { data, error } = await admin.from("profiles").select("id").in("id", ids).or(ACTIVE);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string }) => r.id);
}

export async function previewAudience(
  audience: z.input<typeof audienceInput>,
): Promise<{ ok: true; count: number } | Fail> {
  await requirePermission("system_admin", "create");
  const parsed = audienceInput.safeParse(audience);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pick who it goes to" };
  try {
    return { ok: true, count: (await audienceIds(parsed.data)).length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendAnnouncement(
  input: z.input<typeof broadcastInput>,
): Promise<{ ok: true; reached: number } | Fail> {
  const me = await requirePermission("system_admin", "create");
  const parsed = broadcastInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the announcement" };
  if (!allow(`notif-broadcast:${me.id}`, 5, 10 * 60_000)) {
    return { ok: false, error: "That is five announcements in ten minutes — wait a few minutes before sending another." };
  }
  const v = parsed.data;
  let ids: string[];
  try {
    ids = await audienceIds(v.audience);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!ids.length) return { ok: false, error: "Nobody active is in that audience." };
  const id = await notify(
    "admin.broadcast",
    { userIds: ids },
    { title: v.title, body: v.body || undefined, href: v.href || undefined, type: v.type },
    { source: "admin", actorId: me.id },
  );
  if (!id) return { ok: false, error: "The announcement could not be sent or logged." };
  revalidatePath(PATH);
  return { ok: true, reached: ids.length };
}

// ─── Recall · revoke ────────────────────────────────────────────────────────

/** Take an announcement or test back out of every bell. Push cannot be recalled. */
export async function recallDispatch(dispatchId: string): Promise<{ ok: true; removed: number } | Fail> {
  await requirePermission("system_admin", "delete");
  const s = await createClient();
  const { data, error } = await s.rpc("notification_recall", { p_dispatch: dispatchId });
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true, removed: (data as number | null) ?? 0 };
}

/** Remove a device (a lost or retired phone). The person can turn alerts on again. */
export async function revokeDevice(deviceId: string): Promise<{ ok: true } | Fail> {
  await requirePermission("system_admin", "edit");
  const s = await createClient();
  const { error } = await s.rpc("notification_revoke_device", { p_id: deviceId });
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
