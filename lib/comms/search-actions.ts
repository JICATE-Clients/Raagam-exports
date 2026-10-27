"use server";

import { getAppUser } from "@/lib/auth/server";
import { allow } from "@/lib/rate-limit";
import { searchInput, type SearchInput } from "./search";
import { searchHuddle, type SearchOutcome } from "./service";

/**
 * The next page of a search (0762). The first page is read by the Search page
 * itself from the URL; this answers "Load more" with the cursor it was given.
 * Zod at the door, a per-person rate limit, and the search text is never
 * logged — a query can be as private as the messages it looks for.
 */
export async function searchMore(input: SearchInput): Promise<({ ok: true } & SearchOutcome) | { ok: false; error: string }> {
  const parsed = searchInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the search." };
  const me = await getAppUser();
  if (!me) return { ok: false, error: "You are signed out." };
  if (!allow(`comm-search:${me.id}`, 30, 10_000)) return { ok: false, error: "You are searching too fast. Wait a moment." };
  try {
    return { ok: true, ...(await searchHuddle(parsed.data)) };
  } catch {
    return { ok: false, error: "Search failed. Try again." };
  }
}
