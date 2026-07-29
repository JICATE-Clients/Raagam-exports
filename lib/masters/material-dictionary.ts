// Fuzzy "did you mean?" spell-suggest for Category names (client 2026-07-24).
//
// Category names are free text, so a typo like "COOTTON" would be saved as a
// brand-new, wrong category. This module offers the closest correctly-spelled
// alternative WITHOUT ever changing the user's text on its own — the UI shows a
// tappable suggestion and only applies it if the user accepts.
//
// Pure module (no React) so it stays trivially testable and reusable. The
// dictionary of "correct" words = whatever names the caller passes in (so it
// also catches typos of names the user already created) + a seed word list the
// caller chooses. The seed DEFAULTS to the curated fibre/material list, but a
// caller outside yarn/fabric passes `[]` — offering COTTON as a correction for
// a Packing Accessories name is noise (client 2026-07-28). Both halves are the
// caller's to scope: pass only the names that belong beside what is being typed.

/** Curated common fibre / material / process words — always uppercase. Extend
 *  this freely; anything the mill routinely types is fair game. */
export const MATERIAL_SEED_WORDS: string[] = [
  // Natural fibres
  "COTTON", "SILK", "WOOL", "LINEN", "JUTE", "HEMP", "FLAX", "CASHMERE", "ANGORA",
  // Man-made / synthetic
  "POLYESTER", "POLY", "VISCOSE", "RAYON", "MODAL", "LYOCELL", "TENCEL", "BAMBOO",
  "NYLON", "ACRYLIC", "SPANDEX", "ELASTANE", "LYCRA", "MICROFIBER", "POLYAMIDE",
  // Blends / common qualifiers
  "ORGANIC", "COMBED", "CARDED", "MERCERIZED", "MELANGE", "SLUB", "RECYCLED",
  "BLEND", "BLENDED", "MIXED", "PURE",
  // Fabric / product words
  "YARN", "FABRIC", "DENIM", "TWILL", "KNIT", "WOVEN", "FLEECE", "TERRY",
  "JERSEY", "POPLIN", "CANVAS", "CORDUROY", "VELVET", "SATIN", "CHIFFON",
];

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

/** Break a stored name into comparable word tokens: uppercase, split on spaces
 *  and slashes, strip a trailing "%", and drop numeric / too-short tokens
 *  ("100%", "50", "A") so the dictionary holds only real words. */
function tokenize(name: string): string[] {
  return (name ?? "")
    .toUpperCase()
    .split(/[\s/]+/)
    .map((t) => t.replace(/%$/, "").trim())
    .filter((t) => t.length > 2 && !/^\d/.test(t));
}

/** Known-good word set = `seed` ∪ words from the passed DB names. `seed`
 *  defaults to the fibre/material list; pass `[]` on a screen where those words
 *  are not vocabulary (Packing, Capital Goods, …). */
export function buildWordDictionary(names: string[], seed: string[] = MATERIAL_SEED_WORDS): Set<string> {
  const dict = new Set<string>(seed);
  for (const name of names) for (const tok of tokenize(name)) dict.add(tok);
  return dict;
}

/** How far a word may be from a dictionary word before we call it a typo.
 *  Scaled by length: short words tolerate fewer edits (fewer false guesses),
 *  ≤2 chars are never guessed. Tune here to make suggestions more/less eager. */
export function maxDistanceFor(word: string): number {
  if (word.length <= 2) return 0;
  if (word.length <= 4) return 1;
  return 2;
}

/** The single closest dictionary word for a (possibly misspelled) token, or
 *  null when nothing is close enough OR two words tie for closest (ambiguous →
 *  don't guess, a wrong "correction" is worse than none). */
export function bestMatchWord(word: string, dict: Set<string>): string | null {
  const max = maxDistanceFor(word);
  if (max === 0) return null;
  let best: string | null = null;
  let bestDist = max + 1;
  let tie = false;
  for (const cand of dict) {
    if (Math.abs(cand.length - word.length) > max) continue; // cheap pre-filter
    const d = levenshtein(word, cand, max);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
      tie = false;
    } else if (d === bestDist) {
      tie = true;
    }
  }
  if (!best || bestDist > max) return null;
  return tie ? null : best;
}

/** Suggest a corrected version of a full Category name, or null if there's
 *  nothing worth correcting. Works word-by-word so "COOTTON FABRIC" →
 *  "COTTON FABRIC" while leaving already-valid words untouched. */
export function suggestCorrection(input: string, dict: Set<string>): string | null {
  const norm = input.trim().replace(/\s+/g, " ").toUpperCase();
  if (!norm) return null;
  let changed = false;
  const fixed = norm.split(" ").map((w) => {
    if (dict.has(w)) return w; // already a known word — leave it
    const match = bestMatchWord(w, dict);
    if (match && match !== w) {
      changed = true;
      return match;
    }
    return w;
  });
  const result = fixed.join(" ");
  return changed && result !== norm ? result : null;
}

/** Max edit distance allowed between a partial token and a dictionary word's
 *  leading slice, for prefix prediction. Stricter than full-word typo tolerance
 *  because a prefix is short and easy to over-match. */
function prefixDistanceFor(token: string): number {
  return token.length <= 4 ? 1 : 2;
}

/** Ranked candidate full words for a token the user is still typing. A dict word
 *  qualifies as either a typo of the whole token OR a fuzzy prefix match (its
 *  first `token.length` chars are within `prefixDistanceFor` of the token). This
 *  is what lets "COOTT" predict "COTTON" before the word is finished. */
export function predictWord(token: string, dict: Set<string>, limit = 3): string[] {
  if (token.length < 3) return []; // too short to predict without noise
  const typoMax = maxDistanceFor(token);
  const prefMax = prefixDistanceFor(token);
  const scored: { word: string; dist: number }[] = [];

  for (const cand of dict) {
    if (cand === token) continue; // exact — nothing to predict
    let dist = Infinity;
    // Typo of the whole token (e.g. COOTTON -> COTTON).
    if (Math.abs(cand.length - token.length) <= typoMax) {
      dist = Math.min(dist, levenshtein(token, cand, typoMax));
    }
    // Fuzzy prefix: token looks like the start of a longer word (COOTT -> COTTON).
    if (cand.length > token.length) {
      const pd = levenshtein(token, cand.slice(0, token.length), prefMax);
      if (pd <= prefMax) dist = Math.min(dist, pd);
    }
    if (dist <= Math.max(typoMax, prefMax)) scored.push({ word: cand, dist });
  }

  scored.sort(
    (a, b) => a.dist - b.dist || a.word.length - b.word.length || a.word.localeCompare(b.word),
  );
  return scored.slice(0, limit).map((s) => s.word);
}

/** Public entry for the hook: up to `limit` suggested full Category names for the
 *  current input, ranked. Predicts/completes the LAST (being-typed) token, and
 *  also folds in a whole-string typo fix (`suggestCorrection`) so a misspelled
 *  earlier word — "COOTTON FABRIC" -> "COTTON FABRIC" — is still offered. */
export function suggestNames(input: string, dict: Set<string>, limit = 3): string[] {
  const norm = input.trim().replace(/\s+/g, " ").toUpperCase();
  if (!norm) return [];
  const words = norm.split(" ");
  const last = words[words.length - 1];
  const prefix = words.slice(0, -1);

  const out: string[] = [];
  const push = (s: string) => {
    if (s && s !== norm && !out.includes(s)) out.push(s);
  };

  // Predictions for the token under the cursor, rebuilt onto the full string.
  for (const cand of predictWord(last, dict, limit)) {
    push([...prefix, cand].join(" "));
  }
  // Whole-string correction (catches a bad word that isn't the last token).
  const corrected = suggestCorrection(norm, dict);
  if (corrected) push(corrected);

  return out.slice(0, limit);
}
