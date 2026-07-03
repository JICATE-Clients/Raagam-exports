import { NextResponse, type NextRequest } from "next/server";
import { getAppUser } from "@/lib/auth/server";
import { searchEverywhere } from "@/lib/search/service";

/**
 * GET /api/search?q=… — global "Search Everywhere" record lookup.
 *
 * Reads cookies (via the Supabase server client) so it's request-time dynamic;
 * never cached. Returns `{ results: SearchResult[] }`, or 401 when unauthed.
 * Nav/action results are computed client-side and are NOT part of this payload.
 */
export async function GET(request: NextRequest) {
  const user = await getAppUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const results = await searchEverywhere(q, user);

  return NextResponse.json({ results });
}
