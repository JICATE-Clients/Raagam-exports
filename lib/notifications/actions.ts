"use server";

import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/auth/server";

type Result = { ok: true } | { ok: false; error: string };

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

/** Register (or refresh) a web-push subscription for the current user's device. */
export async function subscribeToPush(sub: PushSub): Promise<Result> {
  const user = await getAppUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: sub.userAgent ?? null,
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Remove a device's web-push subscription. */
export async function unsubscribeFromPush(endpoint: string): Promise<Result> {
  const user = await getAppUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const supabase = await createClient();
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);
  return { ok: true };
}

/** Mark all of the current user's notifications as read (server fallback). */
export async function markAllRead(): Promise<Result> {
  const user = await getAppUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  return { ok: true };
}
