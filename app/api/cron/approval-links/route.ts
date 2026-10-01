import { NextResponse, type NextRequest } from "next/server";
import { sweepApprovalLinks } from "@/lib/ta/approval-links-sweep";

/**
 * GET /api/cron/approval-links — the daily tick behind buyer approval links
 * (0668): expire old links, remind once after three days. The deciding is in
 * `sweepApprovalLinks`; this is a doorbell.
 *
 * Authenticated exactly as `/api/cron/work-flow` is: `proxy.ts` stands down
 * for `/api/cron/`, so the secret is checked HERE, and with no `CRON_SECRET`
 * set the route refuses everything rather than falling open.
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
      { error: "CRON_SECRET is not set on this deployment, so the approval-link sweep is refused" },
      { status: 503 },
    );
  }

  const bearer = request.headers.get("authorization");
  const key = request.nextUrl.searchParams.get("key");
  if (bearer !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepApprovalLinks();
  // 200 even on error, with the error in the body — see approval-sla's route.
  return NextResponse.json({ ok: !result.error, ...result });
}
