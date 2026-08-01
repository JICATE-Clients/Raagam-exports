// Fuzzy "did you mean?" matching for master Name fields that hold a NAMED
// ENTITY — a country, a port, a destination.
//
// The problem this solves: `useDuplicateCheck` only fires on an EXACT collision.
// Type "TUTICORN" beside an existing "TUTICORIN" and nothing objects, so a
// second row is created for the same berth and every Customer that points at it
// is now split across two masters that mean the same thing. This module offers
// the correctly-spelled name WITHOUT ever changing the user's text on its own —
// the UI shows a tappable chip and applies it only if the user accepts.
//
// WHOLE NAMES, NOT WORDS. There was an earlier word-by-word version of this for
// material Category names (removed 2026-07-30 — see the tombstones in
// category-master-screen.tsx; recoverable from
// `git show worktree-layout-save-validation:lib/masters/material-dictionary.ts`).
// Word matching is right for a material, where "COOTTON FABRIC" is two
// independent words and only one of them is wrong. It is wrong for geography:
// "UNITED ARAB EMIRATES" is ONE thing, and a token matcher happily "corrects"
// the word UNITED on its own. So the candidates here are compared end to end.
//
// `levenshtein` and the two distance thresholds are carried over verbatim from
// that module — they were the genuinely general half.
//
// Pure module (no React) so it stays trivially testable and reusable.

/** Classic Levenshtein edit distance (insert / delete / substitute), with an
 *  early-exit cap so long words don't build a full matrix when they can't win. */
export function levenshtein(a: string, b: string, cap = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1; // whole row already over budget
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** How far the typed text may be from a known name before we stop calling it a
 *  typo. Scaled by length: short input tolerates fewer edits (fewer wrong
 *  guesses), ≤2 chars is never guessed at all. Tune here to make suggestions
 *  more / less eager. */
export function maxDistanceFor(input: string): number {
  if (input.length <= 2) return 0;
  if (input.length <= 4) return 1;
  return 2;
}

/**
 * Max edit distance allowed between the typed text and a longer name's leading
 * slice, for prefix prediction. Much stricter than whole-string typo tolerance,
 * and it has to be: a prefix is short, so a budget of 2 lets 40% of a 5-letter
 * prefix be wrong and the matcher starts inventing. Measured — with `2` here,
 * "KLANG" suggested "SHANGHAI" (SHANG is two edits from KLANG). Paired with the
 * same-first-letter guard in `suggestEntityNames`, which is what actually kills
 * that class of nonsense.
 */
export function prefixDistanceFor(input: string): number {
  return input.length <= 6 ? 1 : 2;
}

/** Uppercase, trim, collapse runs of whitespace. Names are stored in CAPS
 *  (AGENTS.md "CAPITALS"), so this is comparing like with like. */
function norm(s: string): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Up to `limit` known names worth offering for what the user has typed so far,
 * best first. Returns [] when there is nothing worth saying.
 *
 * Candidates are scored, lowest wins — the order encodes "how confident are we
 * that this is what they meant":
 *
 *   skip  exact match          GERMANY      — already right, nothing to suggest
 *   0     name starts with it  GERM      -> GERMANY
 *   1     name contains it     KLANG     -> PORT KLANG
 *   2+d   typo of whole name   GERMNY    -> GERMANY
 *   4+d   typo of the prefix   TUTIC     -> TUTICORIN
 *
 * Ties break to the SHORTER name then alphabetically, so "GERM" offers GERMANY
 * ahead of a longer coincidence.
 */
export function suggestEntityNames(input: string, names: string[], limit = 3): string[] {
  const typed = norm(input);
  // Under 3 characters everything is "close" to everything — pure noise.
  if (typed.length < 3) return [];

  const typoMax = maxDistanceFor(typed);
  const prefMax = prefixDistanceFor(typed);

  const scored: { name: string; score: number }[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const cand = norm(raw);
    if (!cand || cand === typed) continue; // exact — nothing to predict
    if (seen.has(cand)) continue; // the seed list and the DB rows overlap
    seen.add(cand);

    let score = Infinity;
    if (cand.startsWith(typed)) {
      score = 0;
    } else if (cand.includes(typed)) {
      score = 1;
    } else {
      // Typo of the whole name (GERMNY -> GERMANY). The length pre-filter is
      // what keeps this cheap across a ~200-name dictionary on every keystroke.
      if (Math.abs(cand.length - typed.length) <= typoMax) {
        const d = levenshtein(typed, cand, typoMax);
        if (d <= typoMax) score = 2 + d;
      }
      // Typo of the leading slice — the user is still typing (TUTIK -> TUTICORIN).
      //
      // The first letter must agree. Without it this branch matched anything
      // vaguely rhyming: "KLANG" offered "SHANGHAI", "GERM" offered "BERMUDA",
      // "CHEN" offered "SHENZHEN". People fumble the middle of a foreign place
      // name, not its first letter — and a wrong suggestion is worse than none,
      // because it teaches the operator to stop reading the chip.
      if (score === Infinity && cand.length > typed.length && cand[0] === typed[0]) {
        const d = levenshtein(typed, cand.slice(0, typed.length), prefMax);
        if (d <= prefMax) score = 4 + d;
      }
    }

    if (score !== Infinity) scored.push({ name: cand, score });
  }

  scored.sort(
    (a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name),
  );
  return scored.slice(0, limit).map((s) => s.name);
}
