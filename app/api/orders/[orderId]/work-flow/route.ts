import { NextResponse, type NextRequest } from "next/server";
import { loadWorkFlow } from "@/lib/orders/work-flow/actions";

/**
 * GET /api/orders/<amendment id>/work-flow — Order Entry ▸ T&A ▸ Work Flow.
 *
 * A GET ROUTE, NOT THE SERVER ACTION IT WRAPS (2026-09-25, "T&A tab shows a
 * loading message"). Server Actions are QUEUED (next/dist/docs
 * backend-for-frontend.md: "Using them for data fetching introduces sequential
 * execution"), so the tab's read waited behind whatever action the screen had
 * in flight, and could not be started early without blocking the operator's
 * next click. A route handler runs concurrently, so the order screen fetches
 * this the moment an order opens (`prefetchOrderTabs`) at no cost to anything
 * else. Same function, same answer shape — `loadWorkFlow` checks the
 * permission itself. Request-time only: it reads the session cookie.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return NextResponse.json(await loadWorkFlow(orderId));
}
