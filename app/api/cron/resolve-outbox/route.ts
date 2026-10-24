import { NextResponse, type NextRequest } from "next/server";
import { drainOutbox } from "@/lib/resolve/outbox";
import { runJob } from "@/lib/jobs/run";

/**
 * GET /api/cron/resolve-outbox — sends the Resolve Hub alerts waiting in
 * `rh_outbox` and retries failed ones (doc/resolve/resolve-hub-plan.md §8).
 * The drain after each action is only the fast path; this is the mechanism.
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
      { error: "CRON_SECRET is not set on this deployment, so the alert drain is refused" },
      { status: 503 },
    );
  }

  const bearer = request.headers.get("authorization");
  const key = request.nextUrl.searchParams.get("key");
  if (bearer !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Every pass is recorded, empty ones too: "late" on Scheduled Jobs is
  // measured from the last row, so a quiet-but-healthy drain must leave one.
  const result = await runJob("resolve-outbox", "cron", () => drainOutbox({ limit: 200 }));
  // 200 even on error, with the error in the body — see approval-sla's route.
  return NextResponse.json({ ok: !result.error, ...result });
}
