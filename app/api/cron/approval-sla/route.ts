import { NextResponse, type NextRequest } from "next/server";
import { sweepSla } from "@/lib/approvals/sla";

/**
 * GET /api/cron/approval-sla — the tick behind `doc/order/newfeature.md` §3.
 *
 * Sweeps every approval past its SLA: marks the breach, escalates the ones
 * whose step says so, and notifies. The deciding is all in
 * `approval_sweep_sla` (0601); this route is a doorbell.
 *
 * ## WHY A ROUTE AND NOT `pg_cron`
 *
 * `pg_cron` is not installed on this project (checked against `pg_extension`,
 * 2026-09-20: btree_gist, pgcrypto, uuid-ossp, vault, pg_stat_statements —
 * that is the whole list). It could be enabled, and the skill's own schedule
 * line assumes it, but a SQL schedule cannot send a WEB PUSH: that is
 * `web-push` + VAPID, a Node concern. An escalation the MD only learns about
 * when they next open the app is not an escalation, so the tick has to come
 * through the app.
 *
 * ## THE SECRET IS CHECKED HERE BECAUSE `proxy.ts` STANDS DOWN FOR /api/cron/
 *
 * The session gate would answer a cookie-less cron with a redirect to /login —
 * a 307, which a scheduler records as a success. So `/api/cron/` is exempt
 * there and authenticates here instead. Two ways in, both accepted because
 * Vercel sends the first and a manual curl is the second:
 *
 *   Authorization: Bearer <CRON_SECRET>       (what Vercel Cron sends)
 *   ?key=<CRON_SECRET>                        (for a hand-run check)
 *
 * WITH NO `CRON_SECRET` SET THE ROUTE REFUSES EVERYTHING. It does not fall
 * open "for convenience": this endpoint advances approvals past the people who
 * were meant to make them, and an unset environment variable is not consent.
 * The refusal says which variable is missing, so a misconfigured deploy reads
 * as a misconfiguration rather than as a broken feature.
 */

/** Never prerendered, never cached — it mutates. */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set on this deployment, so the SLA sweep is refused" },
      { status: 503 },
    );
  }

  const bearer = request.headers.get("authorization");
  const key = request.nextUrl.searchParams.get("key");
  if (bearer !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepSla();

  /* 200 EVEN WHEN THE SWEEP ERRORED, with the error in the body. A 500 makes
     Vercel retry a job that is idempotent but pointless to repeat, and buries
     the reason in a platform log; the body is what a human reads. */
  return NextResponse.json({ ok: !result.error, ...result });
}
