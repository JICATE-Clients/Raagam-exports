import { NextResponse, type NextRequest } from "next/server";
import { loadFabricBomReportsSheet } from "@/lib/orders/fabric-bom/reports-sheet";

/**
 * GET /api/fabric-bom/<bomId>/reports — everything Orders ▸ Fabric BOM ▸
 * Reports shows on open, in one request.
 *
 * A GET route for the reason `app/api/orders/[orderId]/work-flow/route.ts`
 * gives: a server action is queued behind every other one, a route handler is
 * not. Same two gates as that route and `../cad`: `proxy.ts` sends a request
 * with no session to /login, and `loadFabricBomReportsSheet` checks
 * orders ▸ view itself.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ bomId: string }> }) {
  const { bomId } = await params;
  return NextResponse.json(await loadFabricBomReportsSheet(bomId));
}
