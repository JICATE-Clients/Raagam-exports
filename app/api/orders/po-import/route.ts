import { NextResponse, type NextRequest } from "next/server";
import { extractPoImport } from "@/lib/orders/po-import/service";

/**
 * POST /api/orders/po-import  { importId } — read an uploaded buyer PO into a
 * draft (doc/order/digitalisation-plan.md §2).
 *
 * A route rather than a server action: actions are queued behind one another,
 * and a PO read can take most of a minute — the review screen must stay usable
 * meanwhile. `extractPoImport` checks `orders:create` itself and reads through
 * the session client, so RLS and the bucket policies stand behind it.
 */

/** A long PDF can take a while to read. */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let importId: unknown;
  try {
    ({ importId } = (await req.json()) as { importId?: unknown });
  } catch {
    return NextResponse.json({ refused: "Send { importId }." }, { status: 400 });
  }
  if (typeof importId !== "string" || !importId) {
    return NextResponse.json({ refused: "Send { importId }." }, { status: 400 });
  }
  const out = await extractPoImport(importId);
  if (!out.ok) return NextResponse.json({ refused: out.error }, { status: out.status });
  return NextResponse.json({ stored: out.stored });
}
