import { NextResponse, type NextRequest } from "next/server";
import { loadOrderFullData } from "@/lib/orders/full-data/service";
import { ORDER_FULL_DATA_PARTS, type OrderFullDataPart } from "@/lib/orders/full-data/types";

/**
 * GET /api/orders/<sales order id>/full-data?part=gos|budget|fabric|material
 * — one tab of the MD's "View full order data" pop-up (client 2026-09-30).
 *
 * A GET route for the reason `../work-flow/route.ts` gives: server actions are
 * queued behind one another, a route handler is not, so the tab the MD opens
 * loads at once. `loadOrderFullData` checks `orders:view` itself.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const part = req.nextUrl.searchParams.get("part") as OrderFullDataPart | null;
  if (!part || !ORDER_FULL_DATA_PARTS.includes(part)) {
    return NextResponse.json({ refused: "Unknown part of the order." }, { status: 400 });
  }
  return NextResponse.json(await loadOrderFullData(orderId, part));
}
