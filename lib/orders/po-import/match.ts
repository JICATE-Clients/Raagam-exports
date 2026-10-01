/**
 * Matching a buyer PO's WORDS to our masters (doc/order/digitalisation-plan.md §2).
 *
 * Pure and client-safe: the review screen, Order Entry's draft intent and
 * `scripts/check-po-import-match.mts` all call these.
 *
 * ## A MATCH IS ONLY EVER A MATCH, NEVER A GUESS
 *
 * Every function here returns an id only when the answer is UNAMBIGUOUS — one
 * candidate and one only. Two customers that both contain "ASMARA" return null,
 * not the first: the review screen then paints the field amber and the
 * merchandiser picks. A wrong id on an order is silent (it saves, it prints, it
 * bills the wrong party); an empty field is loud. That is the whole rule, and it
 * is the same one "Disabled rows" and "Nominated vendors" in AGENTS.md apply.
 *
 * Nothing here ever CREATES a master row. An unmatched value stays unmatched.
 * Inactive rows are never offered as a match (AGENTS.md "Disabled rows").
 */

/** Upper-case, `&` → AND, punctuation → space, collapsed. For COMPARING only — never stored. */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Legal-form words a PO prints and a master often omits ("ASMARA LTD" ↔ "ASMARA"). */
const LEGAL_WORDS = new Set([
  "LTD", "LIMITED", "PVT", "PRIVATE", "INC", "LLC", "LLP", "CO", "COMPANY", "CORP",
  "CORPORATION", "GMBH", "AG", "SA", "SAS", "BV", "PLC", "SRL", "SPA", "THE",
]);

/** `normName` minus legal-form words — a second, looser key. */
export function coreName(s: string | null | undefined): string {
  return normName(s)
    .split(" ")
    .filter((w) => w && !LEGAL_WORDS.has(w))
    .join(" ");
}

type Party = { id: string; name: string; code?: string | null; inactive?: boolean | null; blocked?: boolean | null };

const usable = <T extends { inactive?: boolean | null; blocked?: boolean | null }>(r: T) =>
  r.inactive !== true && r.blocked !== true;

/** Exactly one candidate, or null. */
function only<T>(xs: T[]): T | null {
  return xs.length === 1 ? xs[0] : null;
}

/**
 * The customer a PO names. Three passes, each stricter than the next one is
 * loose, and the first pass with a unique answer wins:
 *   1. the full normalised name, or the code, equals;
 *   2. the name without legal-form words equals;
 *   3. one core name CONTAINS the other (at least 4 characters) — unique only.
 */
export function matchCustomer<T extends Party>(name: string | null | undefined, rows: readonly T[]): T | null {
  const n = normName(name);
  if (!n) return null;
  const live = rows.filter(usable);

  const exact = live.filter((r) => normName(r.name) === n || (r.code != null && normName(r.code) === n));
  if (exact.length) return only(dedupe(exact));

  const c = coreName(name);
  if (!c) return null;
  const core = live.filter((r) => coreName(r.name) === c);
  if (core.length) return only(dedupe(core));

  if (c.length < 4) return null;
  const contains = live.filter((r) => {
    const rc = coreName(r.name);
    return rc.length >= 4 && (rc.includes(c) || c.includes(rc));
  });
  return only(dedupe(contains));
}

/** The same row listed twice (case-duplicate customers fold to one id upstream) is one answer. */
function dedupe<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/**
 * The canonical spelling of a size label, for comparison:
 * "2XL" / "XXL" / "2 XL" → "XXL", "3XL" → "XXXL", "X-LARGE" → "XL",
 * "SMALL" → "S", "MEDIUM" → "M", "LARGE" → "L".
 */
export function sizeKey(label: string | null | undefined): string {
  let s = (label ?? "").toUpperCase().replace(/[\s_]+/g, "").trim();
  if (!s) return "";
  const words: Record<string, string> = {
    XSMALL: "XS", "X-SMALL": "XS", EXTRASMALL: "XS", SMALL: "S", MEDIUM: "M", MED: "M",
    LARGE: "L", XLARGE: "XL", "X-LARGE": "XL", EXTRALARGE: "XL",
  };
  if (words[s]) return words[s];
  s = s.replace(/-/g, "");
  if (words[s]) return words[s];
  const nx = /^(\d)X(S|L)$/.exec(s);
  if (nx) return "X".repeat(Number(nx[1])) + nx[2];
  return s;
}

/** The size master row a printed label names — by canonical key, unique only. */
export function matchSize<T extends { id: string; name: string; code?: string | null }>(
  label: string | null | undefined,
  sizes: readonly T[],
): T | null {
  const k = sizeKey(label);
  if (!k) return null;
  return only(dedupe(sizes.filter((s) => sizeKey(s.name) === k || (s.code != null && sizeKey(s.code) === k))));
}

const SYMBOL_CURRENCY: Record<string, string> = { "$": "USD", "US$": "USD", "€": "EUR", "£": "GBP", "₹": "INR", "RS": "INR", "¥": "JPY" };

/** A currency CODE from what the PO printed: a code, a symbol, or a name. */
export function matchCurrency<T extends { code: string; name: string; symbol?: string | null }>(
  printed: string | null | undefined,
  currencies: readonly T[],
): string | null {
  const raw = (printed ?? "").trim();
  if (!raw) return null;
  const up = raw.toUpperCase();
  const byCode = currencies.find((c) => c.code.toUpperCase() === up);
  if (byCode) return byCode.code;
  const viaSymbol = SYMBOL_CURRENCY[up] ?? SYMBOL_CURRENCY[raw];
  if (viaSymbol && currencies.some((c) => c.code.toUpperCase() === viaSymbol)) return viaSymbol;
  const bySymbol = currencies.filter((c) => c.symbol && c.symbol.trim() === raw);
  if (bySymbol.length === 1) return bySymbol[0].code;
  const n = normName(raw);
  const byName = currencies.filter((c) => normName(c.name) === n || (n.length >= 4 && normName(c.name).includes(n)));
  return byName.length === 1 ? byName[0].code : null;
}

/** A country by name or code — unique only. */
export function matchCountry<T extends Party>(name: string | null | undefined, rows: readonly T[]): T | null {
  const n = normName(name);
  if (!n) return null;
  const live = rows.filter(usable);
  return only(dedupe(live.filter((r) => normName(r.name) === n || (r.code != null && normName(r.code) === n))));
}

/** A style master row by code, name or article no — unique only. */
export function matchStyle<T extends { id: string; name: string; code?: string | null; article_no?: string | null; blocked?: boolean | null }>(
  ref: string | null | undefined,
  styles: readonly T[],
): T | null {
  const n = normName(ref);
  if (!n) return null;
  const live = styles.filter(usable);
  return only(
    dedupe(
      live.filter(
        (s) =>
          (s.code != null && normName(s.code) === n) ||
          normName(s.name) === n ||
          (s.article_no != null && normName(s.article_no) === n),
      ),
    ),
  );
}

/**
 * A calendar date the model returned, kept only if it really is one —
 * YYYY-MM-DD with a real day (no 2026-02-30) and a four-digit year (AGENTS.md
 * date-year cap). Anything else is null: a wrong date on a delivery field
 * schedules the whole T&A ladder off it.
 */
export function normDate(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2099) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? m[0] : null;
}
