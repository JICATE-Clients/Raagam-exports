import { NextResponse, type NextRequest } from "next/server";
import { getOrderCad } from "@/lib/orders/cad-lifecycle/actions";

/**
 * GET /api/orders/<amendment id>/cad — Order Entry ▸ CAD.
 *
 * A GET route for the reason `../work-flow/route.ts` gives: a server action is
 * queued behind every other one, a route handler is not, so the order screen
 * can start this read when the order opens and the tab paints at once.
 * `getOrderCad` checks the permission itself.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return NextResponse.json(await getOrderCad(orderId));
}
