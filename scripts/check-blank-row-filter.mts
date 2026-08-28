/**
 * THE BLANK-ROW FILTER MAY NOT TEST A FIELD `blankItem` STAMPS.
 *
 * One rule, asserted over one file pair:
 *
 *   No key that `blankItem` (`app/(app)/orders/material-bom/mba-master-screen.tsx`)
 *   gives a TRUTHY default may appear in the OR-chain of `normalizeItems`'
 *   blank-row filter (`lib/orders/material-bom-amendment/actions.ts`) as a bare
 *   `c.<key> ||` test.
 *
 * ## WHY THIS EXISTS — the rule has been broken TWICE, silently
 *
 * The filter asks "did somebody enter this line?" and each clause answers by
 * testing one field for content. A field `blankItem` stamps is never blank, so
 * its clause is not a test at all: **it is the constant `true` wearing the shape
 * of evidence.**
 *
 * On 2026-08-21 two defaults landed in `blankItem` — `type` ("Available Item")
 * and `supply_type` ("Local"). Each silently converted one clause into that
 * constant, and because the chain is an OR, either one alone kept EVERY row.
 * `superRefine` returns no issues for a row with no `item_id` *by design*,
 * explicitly delegating the drop to this filter, so from that day an untouched
 * "+ Add material" row passed validation, passed the filter on two values
 * nobody typed, and was INSERTED as a phantom line naming no material.
 *
 * Both were found by a human reading two files side by side, and the first fix
 * removed only `supply_type` — leaving `type` doing the identical thing one line
 * up, so the fix READ as complete while behaviour was unchanged. That is the
 * specific failure this file exists to make impossible: a coupling between two
 * files that no type, no test and no reader of either file alone can see.
 *
 * It would have fired the day `type`'s default landed.
 *
 * ## WHAT IT DELIBERATELY DOES NOT DO
 *
 * It is scoped to this ONE file pair. It does not try to generalise to every
 * grid in the app: a broad version would need to resolve every screen's blank-row
 * factory and every service's filter, would produce false positives, and a check
 * people silence is worse than no check. One pair, stated precisely.
 *
 * ## THE NUMERIC CLAUSES ARE SAFE ONLY BY ACCIDENT, AND ARE REPORTED
 *
 * `blankItem` sets `moq`, `round_to`, `no_of_items`, `per_pieces` and
 * `excess_pct` to `""`, and `numN` is `z.coerce.number()` — which coerces `""`
 * to **0, not null**. The filter tests those with `!= null`, so they would all
 * be permanently true were the raw strings ever to reach it. They are saved only
 * because the screen maps `""` to null with `numOrNull` before building the
 * payload. That is a converter in a THIRD file holding up three clauses, so the
 * check prints them as a standing note rather than failing — failing would
 * report a bug that does not exist today, but saying nothing would let the day
 * it arrives pass unremarked.
 *
 * Run: `npm run check:blank-row-filter`
 *
 * Testing this check itself: pass alternate paths to point it at a mutated copy,
 * which is how it was made to FAIL before being trusted —
 *   `npx tsx scripts/check-blank-row-filter.mts --actions=<path> --screen=<path>`
 */
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const ACTIONS = arg("actions", `${ROOT}lib/orders/material-bom-amendment/actions.ts`);
const SCREEN = arg("screen", `${ROOT}app/(app)/orders/material-bom/mba-master-screen.tsx`);
const TYPES = arg("types", `${ROOT}lib/orders/material-bom-amendment/types.ts`);

/* COMMENTS ARE STRIPPED BEFORE ANYTHING IS SCANNED, and this is not hygiene —
   it is the difference between working and not. The house style records removed
   code VERBATIM ("`c.supply_type ||` STOOD HERE AND WAS REMOVED"), so a raw scan
   finds both retired clauses forever and reports a bug that was fixed. The same
   reason `check-nav-paths` strips first, stated in AGENTS.md. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const read = (p: string) => strip(readFileSync(p, "utf8"));

// ---------------------------------------------------------------------------
// 1. Which keys does `blankItem` give a TRUTHY default?
// ---------------------------------------------------------------------------

/** `export const NAME ... = "literal";` in types.ts, so an identifier default
 *  (`DEFAULT_MATERIAL_TYPE`) can be resolved to the string it actually holds
 *  rather than guessed at. */
function resolveConsts(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export\s+const\s+([A-Z0-9_]+)\s*(?::[^=]+)?=\s*("([^"]*)"|'([^']*)')\s*;/g;
  for (const m of src.matchAll(re)) out.set(m[1], m[3] ?? m[4] ?? "");
  return out;
}

/** Top-level `key: value` pairs of the `blankItem` object literal. Depth-aware,
 *  so a nested array or object value does not split the scan. */
function blankItemDefaults(src: string): Map<string, string> {
  const start = src.indexOf("const blankItem");
  if (start < 0) throw new Error("check-blank-row-filter: `blankItem` not found in the screen");
  const open = src.indexOf("({", start);
  if (open < 0) throw new Error("check-blank-row-filter: could not find `blankItem`'s object literal");

  let depth = 0;
  let i = open + 1;
  let body = "";
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) break;
    }
    body += ch;
  }

  const out = new Map<string, string>();
  let buf = "";
  let d = 0;
  const flush = () => {
    const t = buf.trim();
    buf = "";
    if (!t) return;
    const c = t.indexOf(":");
    if (c < 0) return; // shorthand (`key`) — not a default we can classify
    out.set(t.slice(0, c).trim(), t.slice(c + 1).trim());
  };
  for (const ch of body.slice(1)) {
    if (ch === "{" || ch === "[" || ch === "(") d++;
    if (ch === "}" || ch === "]" || ch === ")") d--;
    if (ch === "," && d === 0) flush();
    else buf += ch;
  }
  flush();
  return out;
}

/** Is this default truthy at runtime? Unresolvable values are reported as
 *  truthy ON PURPOSE — the safe bias for a guard is to make somebody look. */
function truthiness(raw: string, consts: Map<string, string>): "falsy" | "truthy" | "unknown" {
  const v = raw.trim();
  if (/^(null|undefined|false|0|""|''|``|\[\]|\{\})$/.test(v)) return "falsy";
  if (/^("|'|`)/.test(v)) return v.length > 2 ? "truthy" : "falsy";
  if (/^(true|\d+(\.\d+)?)$/.test(v)) return v === "true" || Number(v) !== 0 ? "truthy" : "falsy";
  if (consts.has(v)) return consts.get(v)! ? "truthy" : "falsy";
  return "unknown";
}

// ---------------------------------------------------------------------------
// 2. Which keys does the blank-row filter test with a bare `||`?
// ---------------------------------------------------------------------------

function filterClauses(src: string): { bare: string[]; notNull: string[] } {
  const at = src.indexOf("function normalizeItems");
  if (at < 0) throw new Error("check-blank-row-filter: `normalizeItems` not found");
  const f = src.indexOf(".filter(", at);
  if (f < 0) throw new Error("check-blank-row-filter: `normalizeItems` has no .filter(");
  const chain = src.slice(f, src.indexOf("\n    )", f));

  const bare = [...chain.matchAll(/c\.(\w+)\s*\|\|/g)].map((m) => m[1]);
  const notNull = [...chain.matchAll(/c\.(\w+)\s*!=\s*null/g)].map((m) => m[1]);
  return { bare, notNull };
}

// ---------------------------------------------------------------------------
// 3. The assertion
// ---------------------------------------------------------------------------

const screenSrc = read(SCREEN);
const actionsSrc = read(ACTIONS);
const consts = resolveConsts(read(TYPES));

const defaults = blankItemDefaults(screenSrc);
const { bare, notNull } = filterClauses(actionsSrc);

const offenders: { key: string; value: string; why: string }[] = [];
for (const key of bare) {
  if (!defaults.has(key)) continue;
  const raw = defaults.get(key)!;
  const t = truthiness(raw, consts);
  if (t === "falsy") continue;
  offenders.push({
    key,
    value: raw,
    why: t === "unknown" ? "could not be resolved — treated as truthy" : "is truthy",
  });
}

console.log(`check-blank-row-filter: ${defaults.size} blankItem defaults, ${bare.length} bare || clauses`);

/* THE NUMERIC NOTE. Not a failure — see the header. It names the exact
   dependency so the day a payload path skips `numOrNull` is not the day
   somebody has to rediscover why three clauses went constant at once. */
const numericStrings = notNull.filter((k) => truthiness(defaults.get(k) ?? "null", consts) === "falsy" && defaults.get(k) === '""');
if (numericStrings.length) {
  console.log(
    `  note  ${numericStrings.join(", ")} default to "" and are tested with != null.\n` +
      `        Safe ONLY because the screen's numOrNull maps "" to null before the\n` +
      `        payload is built — z.coerce.number() would make "" into 0, not null.`,
  );
}

if (offenders.length === 0) {
  console.log("  ok    no filter clause tests a field blankItem stamps.");
  process.exit(0);
}

console.error(`\n${offenders.length} filter clause(s) can never be false:\n`);
for (const o of offenders) {
  console.error(`  c.${o.key} ||   —   blankItem sets \`${o.key}: ${o.value}\`, which ${o.why}`);
}
console.error(
  "\nA field blankItem stamps is never blank, so its clause is not a test — it is\n" +
    "the constant `true` wearing the shape of evidence. The chain is an OR, so ONE\n" +
    "such clause keeps every row, and `superRefine` passes a row with no item_id BY\n" +
    "DESIGN because it delegates the drop to this filter. The result is an untouched\n" +
    "\"+ Add material\" row saved as a phantom line naming no material.\n\n" +
    "Remove the clause from the filter — do not remove the default, which exists so\n" +
    "a new line opens on a usable value.\n",
);
process.exit(1);
