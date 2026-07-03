import type { SearchResult, SearchEntity } from "./types";

/**
 * Fixed entity priority used as a tiebreaker when two results have the same
 * text-match strength. Orders/Customers surface above Employees because they're
 * the things people most often paste a code for. Lower index = higher priority.
 */
const ENTITY_PRIORITY: SearchEntity[] = [
  "order",
  "invoice",
  "customer",
  "vendor",
  "product",
  "employee",
];

/**
 * Relevance score for ordering results (higher = shown first).
 *
 * This is the one genuinely judgement-driven part of search: it decides whether
 * an exact order-number paste beats a fuzzy name match, and how the entity
 * groups interleave. Tune the weights below to taste.
 *
 *   exact match ............ 100   (query === title/subtitle, case-insensitive)
 *   title starts-with ....... 60
 *   title contains .......... 40
 *   subtitle contains ....... 20
 *   + small entity-priority nudge so ties break predictably
 */
export function scoreResult(result: SearchResult, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const title = result.title.toLowerCase();
  const subtitle = result.subtitle.toLowerCase();

  let score = 0;
  if (title === q || subtitle === q) score = 100;
  else if (title.startsWith(q)) score = 60;
  else if (title.includes(q)) score = 40;
  else if (subtitle.includes(q)) score = 20;

  // Prefer shorter titles at equal match strength (a 6-char code that starts
  // with the query is a tighter hit than a 40-char name that starts with it).
  const brevity = Math.max(0, 10 - title.length / 6);

  const priority = ENTITY_PRIORITY.indexOf(result.type);
  const entityNudge = priority < 0 ? 0 : (ENTITY_PRIORITY.length - priority) * 0.5;

  return score + brevity + entityNudge;
}

/** Sort a result list in place-safe (returns a new array) by descending score. */
export function rankResults(
  results: SearchResult[],
  query: string,
): SearchResult[] {
  return [...results]
    .map((r) => ({ r, s: scoreResult(r, query) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}
