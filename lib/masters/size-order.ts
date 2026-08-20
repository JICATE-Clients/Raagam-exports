/**
 * HOW A GARMENT PERSON READS A LIST OF SIZES.
 *
 * The Sizes master is `config_lookups` kind='size' — a flat table with a name and
 * nothing else. No ordinal, no family. So every screen that lists sizes has been
 * listing them ALPHABETICALLY, which produces `L, M, S, TEST, XL, XS, XXL, XXS`
 * (client screenshot 2392, 2026-08-19). That is not a long-list problem: it is
 * wrong at nine rows and no amount of layout rescues it.
 *
 * ## WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
 *
 * This is the FALLBACK order — for sizes shown ungrouped, or shown under "All".
 * A size that belongs to a Size Group sorts by that group's stored `sort_order`
 * (`size_group_sizes.sort_order`), and never reaches this function.
 *
 * That split is the whole design, and it is why a single global ordinal on the
 * size row would have been the wrong migration: `30` sits between `28` and `32`
 * in a waist group and has no place at all in the letter ladder, so "the order of
 * a size" is not a property a size can carry on its own. It is a property of the
 * size WITHIN A GROUP. The current code comment in `style-master-screen.tsx`
 * objects that an ordinal "fails on numeric ranges (28, 30, 32)" — that objection
 * is correct, and it is an objection to a *global* ordinal only.
 *
 * So this function is deliberately allowed to be imperfect on exotic labels. It
 * has to be SANE and total; it does not have to be authoritative, because the
 * authoritative answer is the group's. Where it gives up it says so (band 3
 * below) rather than guessing.
 *
 * ## THE BANDS
 *
 * Ascending. A size lands in exactly one, and the band wins before anything else:
 *
 *   0  The letter ladder      XXS · XS · S · M · L · XL · XXL · 3XL …
 *   1  A bare number          2 · 4 · 6 · 14½ · 32
 *   2  A number with a word   W32 · EU38 · 2Y · 0-3M · 14W · 1X
 *   3  Anything else          S/T · XSP · TEST  (alphabetical, and see below)
 *   4  "Fits anyone"          FREE SIZE · OS · ONE SIZE
 *
 * Band 4 is last on purpose. `FREE SIZE` is not a point on any ladder, so putting
 * it anywhere among real sizes implies a magnitude it does not have.
 *
 * Band 3 is where compound labels land — `S/T` (tall), `XSP` (petite). They read
 * as letter sizes to a person and as noise to a parser, and a heuristic that
 * half-understood them would reorder them differently as the vocabulary grew.
 * They are exactly what a Size Group is for; until one exists they sit together,
 * alphabetically, which is at least stable.
 *
 * ## ALIASES ARE RANKED THE SAME, DELIBERATELY
 *
 * `XXXL` and `3XL` are the same size and BOTH are in this database today. They
 * share a rank, so they sort adjacent rather than a dozen rows apart — which is
 * what makes the duplication visible to whoever is tidying the master, instead of
 * hiding it at opposite ends of the list.
 *
 * ## NO EXTERNAL ANYTHING
 *
 * Pure, dependency-free and synchronous, for the same reason `lib/orders/styles/
 * rules.ts` is: it is read at KEYDOWN while a dropdown is open, and it is proved
 * by `scripts/check-size-order.mts` without a database, a browser or a test
 * framework.
 */

/**
 * The ladder, coarsest first. Each entry is one RANK; every spelling on that
 * entry is the same size.
 *
 * Ranks are array indices, so inserting a size in the middle renumbers everything
 * after it — which is fine, because nothing persists a rank. This is a sort key,
 * never a stored value.
 */
const LETTER_LADDER: readonly (readonly string[])[] = [
  ["XXXXS", "4XS"],
  ["XXXS", "3XS"],
  ["XXS", "2XS"],
  ["XS"],
  ["S", "SM", "SMALL"],
  ["M", "MD", "MED", "MEDIUM"],
  ["L", "LG", "LARGE"],
  ["XL"],
  ["XXL", "2XL"],
  ["XXXL", "3XL"],
  ["XXXXL", "4XL"],
  ["XXXXXL", "5XL"],
  ["XXXXXXL", "6XL"],
];

const LADDER_RANK: ReadonlyMap<string, number> = new Map(
  LETTER_LADDER.flatMap((spellings, rank) => spellings.map((s) => [s, rank] as const)),
);

/**
 * Labels meaning "one size fits all". Band 4.
 *
 * `STD` / `STANDARD` are here rather than in band 3 because they are used the
 * same way in this trade — a single un-graded size — not because the words mean
 * the same thing.
 */
const ONE_SIZE: ReadonlySet<string> = new Set([
  "FREE",
  "FREE SIZE",
  "FREESIZE",
  "ONE SIZE",
  "ONESIZE",
  "OS",
  "OSFA",
  "STD",
  "STANDARD",
  "UNIVERSAL",
]);

/** Vulgar fractions, which appear on neck and cup sizes (`N14½`). */
const FRACTIONS: Readonly<Record<string, string>> = {
  "¼": ".25",
  "½": ".5",
  "¾": ".75",
  "⅓": ".333",
  "⅔": ".667",
  "⅛": ".125",
};

/**
 * Trim, upper-case, collapse internal whitespace, fold fraction glyphs, and
 * normalise the several dashes a label can be typed with.
 *
 * The same trim-collapse-upper as `normName` (`lib/masters/name-dictionary.ts`),
 * repeated rather than imported so this file stays dependency-free — see the
 * header. The fraction and dash folding is this file's own.
 */
function normalise(raw: string): string {
  let s = (raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  for (const [glyph, decimal] of Object.entries(FRACTIONS)) {
    s = s.split(glyph).join(decimal);
  }
  // en/em dash and minus all mean "to" in `0-3M`.
  return s.replace(/[‐-―−]/g, "-");
}

type Parsed = {
  band: 0 | 1 | 2 | 3 | 4;
  /** Band 0 only: position on the ladder. */
  rank: number;
  /** Band 2 only: the alphabetic head, e.g. `W` in `W32`, `EU` in `EU38`. */
  prefix: string;
  /** Band 2 only: the alphabetic tail, e.g. `Y` in `2Y`, `M` in `0-3M`. */
  suffix: string;
  /** Bands 1 and 2: the first number in the label. */
  num: number;
  /** Every band: the normalised label, for a stable final tiebreak. */
  text: string;
};

/**
 * `^([A-Z]*)` alphabetic head, then the first number (which may be a range's
 * lower bound, `0-3M`), then `([A-Z]*)$` alphabetic tail.
 *
 * The middle is non-greedy about the rest of a range on purpose: `0-3M` sorts on
 * its LOWER bound, because that is what makes `0-3M · 3-6M · 6-9M` come out in
 * order. Sorting on the upper bound gives the same answer here and a wrong one
 * the moment a range overlaps.
 */
const SHAPE = /^([A-Z]*)\s*(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*([A-Z]*)$/;

/**
 * ONE SIZE, SPELLED SEVERAL WAYS — folded to a canonical suffix.
 *
 * The client's own words for the vocabulary were "yr, m, xs" (2026-08-19), which
 * is the ordinary state of a hand-typed master: `2Y` and `2YR` are the same size
 * and both will get entered. Folding them here means they SORT adjacent and land
 * in the SAME family, which is what makes the duplication visible to whoever is
 * tidying the master — the same treatment `XXXL` / `3XL` already get on the
 * ladder, and for the same reason.
 *
 * It does NOT merge them. They stay two master rows, because they are two rows;
 * deciding which spelling is canonical is a rule for the Sizes master, not for a
 * sort comparator. This only stops the list pretending they are unrelated.
 */
const SUFFIX_CANON: Readonly<Record<string, string>> = {
  Y: "Y", YR: "Y", YRS: "Y", YEAR: "Y", YEARS: "Y",
  M: "M", MO: "M", MOS: "M", MTH: "M", MTHS: "M", MONTH: "M", MONTHS: "M",
};

function canonSuffix(s: string): string {
  return SUFFIX_CANON[s] ?? s;
}

function parse(raw: string): Parsed {
  const text = normalise(raw);
  const base: Omit<Parsed, "band"> = { rank: 0, prefix: "", suffix: "", num: 0, text };

  if (text === "") return { ...base, band: 3 };
  if (ONE_SIZE.has(text)) return { ...base, band: 4 };

  const rank = LADDER_RANK.get(text);
  if (rank !== undefined) return { ...base, band: 0, rank };

  const m = SHAPE.exec(text);
  if (m) {
    const [, prefix, digits, suffix] = m;
    const num = Number(digits);
    if (Number.isFinite(num)) {
      // A bare number is its own band: `32` must not sort among `W32` / `EU32`,
      // because a list holding both is a list where the bare one is ambiguous
      // and needs to be seen as a block.
      const band = prefix === "" && suffix === "" ? 1 : 2;
      return { ...base, band, prefix, suffix: canonSuffix(suffix), num };
    }
  }

  return { ...base, band: 3 };
}

function cmp(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compare two size LABELS. Feed it to `Array.prototype.sort`.
 *
 * Total and stable: every pair returns a decision, and equal-ranked aliases fall
 * through to an alphabetic tiebreak rather than to 0, so the result does not
 * depend on the input order.
 */
export function naturalSizeOrder(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);

  if (x.band !== y.band) return cmp(x.band, y.band);

  switch (x.band) {
    case 0:
      // Same rank means the two are spellings of one size (XXXL / 3XL). Falling
      // through to the label keeps them adjacent AND deterministic.
      return cmp(x.rank, y.rank) || x.text.localeCompare(y.text);
    case 1:
      return cmp(x.num, y.num) || x.text.localeCompare(y.text);
    case 2:
      // Family before magnitude: every W together, then every EU, then the
      // suffixed ones. A list mixing families is a list where seeing the family
      // is the point — `38` in two families is the ambiguity groups exist to fix.
      return (
        x.prefix.localeCompare(y.prefix) ||
        x.suffix.localeCompare(y.suffix) ||
        cmp(x.num, y.num) ||
        x.text.localeCompare(y.text)
      );
    default:
      return x.text.localeCompare(y.text);
  }
}

/**
 * Sort anything carrying a size label, without the call site restating the
 * accessor every time.
 *
 * Returns a NEW array — the option lists this runs over come from props and from
 * `useMemo` dependencies, and sorting one in place would mutate a value React is
 * holding by reference.
 */
export function sortBySize<T>(rows: readonly T[], label: (row: T) => string): T[] {
  return [...rows].sort((a, b) => naturalSizeOrder(label(a), label(b)));
}

/**
 * WHICH FAMILY A SIZE BELONGS TO — derived from the name, not looked up.
 *
 * The client's master is heading for 50+ sizes across families (2026-08-19:
 * "minimum 50 size will user add like yr, m, xs"). At that count a flat list is
 * unreadable however well it is sorted, and one label stops meaning one thing:
 * **`M` is Medium AND `3M` is three months.** A band heading is what separates
 * them, and it costs the operator nothing to get.
 *
 * ## WHY DERIVED RATHER THAN DECLARED
 *
 * Size Groups (`size_group_sizes`, now FK'd to the master by 0438) are the
 * DECLARED answer and are strictly better — but there is exactly ONE group in
 * this database, so shipping only that means shipping a grouping feature that
 * groups nothing until someone spends a day entering data. The family is already
 * in the name: `2Y` ends in Y, `W32` starts with W. So the grouping works on day
 * one, for free, and a declared group overrides it whenever one exists.
 *
 * ## WHAT IT CANNOT DO, STATED RATHER THAN DISCOVERED
 *
 * It groups by SHAPE, not by meaning. A buyer's own scheme whose names share no
 * pattern — ALPHA / BRAVO / CHARLIE — has no shape to read and lands in "Other"
 * together. That is precisely the case Size Groups exist for. This is a good
 * default, not a replacement.
 *
 * ## THE LABELS ARE THE OPERATOR'S OWN WORDS
 *
 * Only `Y` and `M` get an English name, because those are the two the client
 * named. Every other token is shown VERBATIM — `W32` bands under "W", not under
 * a guessed "Waist". Naming a family we were not told about would be inventing
 * business meaning from a single letter, and a wrong name on a heading is worse
 * than a terse one: it tells the operator the app knows something it does not.
 *
 * `key` is for grouping and must be stable; `label` is for reading.
 */
export type SizeFamily = { key: string; label: string };

const FAMILY_NAMES: Readonly<Record<string, string>> = { Y: "Years", M: "Months" };

export function sizeFamily(raw: string): SizeFamily {
  const p = parse(raw);
  switch (p.band) {
    case 0:
      return { key: "letter", label: "Letter" };
    case 1:
      return { key: "numeric", label: "Numeric" };
    case 4:
      return { key: "free", label: "Free size" };
    case 3:
      return { key: "other", label: "Other" };
    default:
      // A PREFIX WINS OVER A SUFFIX, and the order matters: `W32` is the W
      // family, not a number that happens to have no suffix. Only one of the two
      // is ever non-empty for the shapes seen in practice, but stating the
      // precedence keeps a name like `EU38W` from silently changing family the
      // day someone types one.
      return p.prefix
        ? { key: `p:${p.prefix}`, label: p.prefix }
        : { key: `s:${p.suffix}`, label: FAMILY_NAMES[p.suffix] ?? p.suffix };
  }
}

/**
 * Bucket sizes into families, each family's rows already in `naturalSizeOrder`,
 * and the families themselves in the order their FIRST member sorts.
 *
 * Deriving band order from the sort rather than from a hand-written list is what
 * keeps the two from disagreeing: the ladder sorts before numbers before
 * prefixed families before "Other" before "Free size", so the headings come out
 * in that order without a second rule that could drift from the first.
 */
export function groupBySizeFamily<T>(
  rows: readonly T[],
  label: (row: T) => string,
): { family: SizeFamily; rows: T[] }[] {
  const out: { family: SizeFamily; rows: T[] }[] = [];
  const byKey = new Map<string, { family: SizeFamily; rows: T[] }>();
  for (const row of sortBySize(rows, label)) {
    const family = sizeFamily(label(row));
    let bucket = byKey.get(family.key);
    if (!bucket) {
      bucket = { family, rows: [] };
      byKey.set(family.key, bucket);
      out.push(bucket);
    }
    bucket.rows.push(row);
  }
  return out;
}
