/**
 * HOW EVERY FIELD-LEVEL SEARCH BOX IN THIS APP MATCHES WHAT WAS TYPED.
 *
 * One definition, three readers — `DataPicker` (which sits behind ~160 pickers),
 * `Combobox` and `MultiSelect`. They each had their own one-liner and all three
 * were the same one-liner, which is the shape a rule takes just before it drifts.
 *
 * ## THE RULE: EVERY WORD TYPED MUST APPEAR, IN ANY ORDER
 *
 * It used to be a single contiguous `includes()` over `label + sublabel +
 * search`, which means the operator had to type a prefix of the stored string in
 * the stored order. On a master whose names are COMPOSED that is close to
 * unusable, and the Fabric field is the extreme case — `composeFabricName`
 * builds
 *
 *     SOLID 1X1 LYCRA RIB (30'S COTTON COMBED 95%, 20'S ELASTANE 5%) 100%
 *
 * so `lycra rib` found it and `rib lycra` found nothing; `cotton elastane`,
 * `solid cotton` and `1x1 95` all found nothing. The operator's report was
 * exactly that (client 2026-09-03): *"that fabric field needs to be one search
 * with global understanding — whatever the user searches it should understand,
 * needs to fetch the right fabric."*
 *
 * Splitting the QUERY into words and requiring all of them can only ever return
 * MORE rows than the old test, never fewer: a contiguous match is also a match
 * where every word is present. So no search that worked before stops working —
 * the change is strictly an addition, which is why it is safe to make it the
 * behaviour of every picker rather than of one field.
 *
 * ## PUNCTUATION IS NOT PART OF WHAT ANYONE TYPES
 *
 * Both sides are folded — lowercased, with every run of non-alphanumerics
 * becoming one space — so `95%` finds `95%,`, `(160` finds `160`, and a name
 * carrying brackets and commas is searchable by its words.
 *
 * A SECOND, SQUASHED HAYSTACK CATCHES THE APOSTROPHE, and it is not decoration:
 * yarn counts are written `30'S` and every operator types `30s`. Folding alone
 * turns the stored value into `30 s`, so the typed token `30s` would miss the
 * one thing this field exists to find. A token matches if it is in the spaced
 * form OR in the fully squashed one.
 *
 * That second form can match across a word boundary (`ncom` is inside `cotton
 * combed`), and that is an accepted trade rather than an oversight: every token
 * must still match, a false POSITIVE costs a glance at a list the operator is
 * already reading, and a false NEGATIVE is the defect being fixed — an operator
 * concluding the cloth is not in the master.
 *
 * ## WHAT THIS IS NOT
 *
 * Not fuzzy matching, and deliberately: no edit distance, no transposition, no
 * ranking. A typo still finds nothing, which is honest — the near-miss chips
 * (`useSpellSuggest`) are this app's answer to a misspelling, and a picker that
 * quietly offered an approximate row would be the 2026-07-28 "corrected to
 * COTTON" failure wearing different clothes.
 */

/** Lowercased, punctuation collapsed to single spaces. `SOLID 1X1 RIB (30'S)` →
 *  `solid 1x1 rib 30 s`. */
const fold = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Lowercased with every non-alphanumeric removed — the form that lets a typed
 *  `30s` find a stored `30'S`. */
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The words a query is asking for. Empty when the operator has typed nothing (or
 * nothing but punctuation), which every caller reads as "no filter".
 *
 * SPLIT ONCE PER KEYSTROKE, NOT ONCE PER ROW — the reason this is exported
 * separately from `matchesSearch` below rather than folded into it.
 */
export function searchTokens(query: string): string[] {
  const f = fold(query);
  return f ? f.split(" ") : [];
}

/**
 * Does one row's searchable text answer every word typed?
 *
 * `haystack` is the caller's own idea of what a row is findable BY — for a
 * picker that is `label + sublabel + search`, where `search` is the hidden half
 * that keeps a code typeable after it stopped being displayed
 * (`pickerIdentityParts`).
 */
export function matchesSearch(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const spaced = fold(haystack);
  const tight = squash(haystack);
  return tokens.every((t) => spaced.includes(t) || tight.includes(t));
}
