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
 *  (AGENTS.md "CAPITALS"), so this is comparing like with like. Exported because
 *  a caller building the "already a row" set must normalise it the SAME way, or
 *  membership is undecidable on this module's output. */
export function normName(s: string): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}
const norm = normName;

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

/* -------------------------------------------------------------------------- */

/** Scored candidates fetched before splitting free from taken. Comfortably
 *  bigger than MAX_CHIPS, and it has to be: the limit inside suggestEntityNames
 *  is applied BEFORE anything here can filter, so a pool that happened to be all
 *  taken would leave no chips while free names sat just below the cut. Dense
 *  classes make that the normal case, not the edge one — YARN already holds six
 *  of the fibres it would otherwise offer first. */
const POOL = 24;

/** Chips shown. Five, not three (client 2026-08-04, "only limited suggestion"):
 *  the category vocabularies run 20-59 names a class, so a typed prefix
 *  routinely has more than three free matches. It stops at five because the
 *  strip is one wrapped line under an input and a list nobody finishes reading
 *  is not more help — and every chip past the first few is, by construction, a
 *  worse match than the ones above it. */
export const MAX_CHIPS = 5;

/** Taken names named in the warning. A warning, not a menu; two is enough to
 *  recognise a twin. */
export const MAX_EXISTING = 2;

/**
 * The two lists a Name field's hint is made of.
 *
 *   suggestions — FREE names. Chips: every one of them saves.
 *   existing    — names that are ALREADY ROWS. Inert text, never chips.
 *
 * ── THE BOUNDARY (client 2026-08-04) ────────────────────────────────────────
 * `candidates` IS the boundary, and it is the only one there is. Every name this
 * function can return came out of that array, so a field can only ever be
 * offered words that belong to the thing it is naming: on a Category under Item
 * Class YARN, the yarn vocabulary and the yarn categories that already exist —
 * nothing from FABRIC, nothing from PACKING, and nothing from outside the app.
 *
 * That means the ONE way to break the rule is to widen `candidates` at a call
 * site. Do not: no merged "all classes" list, no fallback when a class has no
 * vocabulary, and above all **no general dictionary or word API**. That last one
 * was asked and measured (2026-08-04) — Datamuse answers `viscos` with VISCOUS
 * and never VISCOSE, and ranks COTTON ninth for `cot*` behind COTERIE and
 * COTILLION. A general word list is exactly the unrelated-word listing this
 * boundary exists to forbid, with the extra problem that it is not yours to fix.
 *
 * Enforced exhaustively by scripts/check-name-suggest.mts, which probes every
 * class with every prefix of every word every OTHER class knows and asserts
 * nothing from outside comes back.
 *
 * The split is the point. A caller scopes `taken` exactly as its duplicate check
 * is scoped, so a candidate already in it is one the guard is about to reject —
 * offering it as a chip is offering a click that lands on "already exists". That
 * was every chip a screen with no vocabulary could produce (client 2026-08-04).
 *
 * The taken ones are still returned, because they are the only warning a typo
 * TWIN gets: the duplicate guard fires on an exact match, so INTARLOCK typed
 * beside an existing INTERLOCK is invisible to it.
 *
 * Lives here rather than in useSpellSuggest so it can be exercised without React
 * — scripts/check-name-suggest.mts runs it against the real category rows, and a
 * copy of these rules in the test would be a copy free to drift.
 */
export function splitSuggestions(
  input: string,
  candidates: string[],
  taken: ReadonlySet<string>,
): { suggestions: string[]; existing: string[] } {
  const pool = suggestEntityNames(input, candidates, POOL);
  return {
    suggestions: pool.filter((n) => !taken.has(n)).slice(0, MAX_CHIPS),
    existing: pool.filter((n) => taken.has(n)).slice(0, MAX_EXISTING),
  };
}
