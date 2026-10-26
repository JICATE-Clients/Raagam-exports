import { NextResponse, type NextRequest } from "next/server";
import { sweepResolveDesk } from "@/lib/resolve/desk-sweep";
import { runJob } from "@/lib/jobs/run";

/**
 * GET /api/cron/resolve-desk — the five-minute Service Desk sweep
 * (doc/resolve/service-desk-plan.md §3): SLA breaches and warnings, stale
 * requests (a reminder, then the desk manager), and resolved requests the
 * requester never confirmed closing themselves. Each event fires once.
 *
 * Authenticated exactly as `/api/cron/approval-sla` is, and for its reasons
 * (read that route's header): `proxy.ts` stands down for `/api/cron/`, so the
 * secret is checked HERE, and with no `CRON_SECRET` set the route refuses
 * everything rather than falling open.
 *
 *   Authorization: Bearer <CRON_SECRET>       (what Vercel Cron sends)
 *   ?key=<CRON_SECRET>                        (for a hand-run check)
 */

/** Never prerendered, never cached — it mutates. */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set on this deployment, so the service desk sweep is refused" },
      { status: 503 },
    );
  }

  const bearer = request.headers.get("authorization");
  const key = request.nextUrl.searchParams.get("key");
  if (bearer !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runJob("resolve-desk", "cron", sweepResolveDesk);
  // 200 even on error, with the error in the body — see approval-sla's route.
  return NextResponse.json({ ok: !result.error, ...result });
}
