import { NextResponse, type NextRequest } from "next/server";
import { purgeOldNotifications } from "@/lib/jobs/sweeps";
import { runJob } from "@/lib/jobs/run";

/**
 * GET /api/cron/housekeeping — the daily cleanup (0677): deletes alerts, alert
 * log rows and job-run rows older than the retention set on Administration ▸
 * System ▸ Notifications ▸ Settings. Before this nothing ever deleted a
 * notification, so the table only grew.
 *
 * Authenticated exactly as `/api/cron/approval-sla` is, and for its reasons
 * (read that route's header): `proxy.ts` stands down for `/api/cron/`, so the
 * secret is checked HERE, and with no `CRON_SECRET` set the route refuses
 * everything rather than falling open — this one DELETES.
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
      { error: "CRON_SECRET is not set on this deployment, so the cleanup is refused" },
      { status: 503 },
    );
  }

  const bearer = request.headers.get("authorization");
  const key = request.nextUrl.searchParams.get("key");
  if (bearer !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runJob("housekeeping", "cron", purgeOldNotifications);
  // 200 even on error, with the error in the body — see approval-sla's route.
  return NextResponse.json({ ok: !result.error, ...result });
}
