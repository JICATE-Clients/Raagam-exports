import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/auth/server";

/**
 * The service worker's `pushsubscriptionchange` handler (app/sw.ts) posts here
 * when the browser replaced a device's push subscription on its own. A server
 * action cannot be called from a service worker, hence a route.
 *
 * Signed-in only (the session cookie rides along, same origin); the new row is
 * written for THAT login through the user's own RLS (`push_subscriptions` is
 * own-rows-only), and the old endpoint is removed for the same login.
 */
export async function POST(req: Request) {
  const user = await getAppUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { oldEndpoint?: string | null; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys.auth || !/^https:\/\//.test(sub.endpoint)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: req.headers.get("user-agent"),
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  if (body.oldEndpoint && body.oldEndpoint !== sub.endpoint) {
    await supabase.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", body.oldEndpoint);
  }
  return NextResponse.json({ ok: true });
}
