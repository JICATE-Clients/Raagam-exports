// Verification that no operator-facing string recites a MENU PATH the nav
// registry cannot resolve.
//
// The repo has no test framework, so this runs standalone:
//     npx tsx scripts/check-nav-paths.mts
//
// UNLIKE check-module-groups.mts this is NOT in tsconfig `exclude`, and the
// difference is worth a line. That script imports `module-groups.ts` alone,
// which imports nothing but a type — so node's own type stripping can run it,
// at the price of `.ts` import extensions the app's tsconfig forbids. Reading
// the Master Data tree as well pulls in `submodules.ts`, which imports
// `./registry` EXTENSIONLESS, and node cannot resolve that. So this one runs
// under tsx instead, and the reward is that it stays type-checked by `tsc`
// along with the rest of the app rather than being verified only by running.
//
// ## Why this exists
//
// `check-module-groups.mts` asserts that every row, card and href in
// `lib/nav/module-groups.ts` points somewhere real. It says nothing about the
// OTHER place the menu is written down: the prose. Sentences like
//
//     "Raise one on Orders > Order Preparation > Order Entry."
//     "There are no styles yet — add one under Master Data > Materials."
//
// are directions, and a direction naming a row that no longer exists is worse
// than no direction at all: the operator goes looking, does not find it, and
// concludes the SCREEN is broken rather than the sentence.
//
// This was not hypothetical. Renaming the Orders "Order Setup" sub-module to
// "Order Preparation" (client 2026-08-25) reached every surface the registry
// drives — sidebar, hub, palette, breadcrumb — and reached NONE of the prose,
// because prose is a string. Two empty states and a back-link still recited the
// old name, and the only reason they were caught is that a human went looking.
// The same sweep turned up `Orders > Approve` against a row labelled
// `Approval` — drift that predated the rename by weeks and that nothing would
// ever have reported.
//
// ## What counts as a menu path
//
// The house separator is U+25B8 and it is used for two different things:
//
//   - A MENU path — `Orders > Material BOM`. In scope.
//   - An IN-SCREEN path — `Quantities > Assort`, `Combos > Structure Details`.
//     A tab and a grid inside one screen. Out of scope, and deliberately: those
//     names live in JSX, not in a registry, so there is nothing to check them
//     against and a check that guessed would only produce noise.
//
// The two are told apart by their FIRST segment. A path rooted at a label the
// registry knows — a module ("Orders"), a sub-module group ("Order Entry"), or
// a Master Data submodule ("Materials") — is a menu path, and every segment
// after it must resolve. Anything else is left alone. That rule is what keeps
// the check honest: it never has to decide what a sentence MEANT, only whether
// the words it used are on the menu.
//
// ## Comments are stripped first, and that is not laziness
//
// A comment reciting `Order Setup > Garment Process Plan` is a record of what
// the menu USED to say, and rewriting history to keep a check quiet would
// destroy the one thing those comments are for — most of this repo's uses of
// the separator are exactly that. Only live source (string literals and JSX
// text) is scanned, which is also precisely the set an operator can ever read.
//
// ## The one exemption, and the collision that earned it
//
// `// nav-path: exempt -- <reason>` on the line or either of the two above it,
// same shape as every other audit exemption in this repo.
//
// It exists because the separator is also borrowed for a PERMISSION —
// `Orders > Approve` on the budget-approval screen is the key `orders:approve`
// rendered through `MODULE_LABELS`, not a row to click. That sentence says so
// ("...permission, which is granted on the Roles screen"), so nothing is being
// promised that is not there. It is still worth the marker rather than a
// special case in the code: an operator reading the same glyph in two meanings
// is a small real cost, and a line that has to say why is a line someone can
// later decide to reword.
//
// ## A shorthand is allowed, a wrong name is not
//
// `Orders > Material BOM` skips the sub-module that owns the row, and that is
// fine: it is how people talk, and the row is unambiguously in Orders. So a
// segment resolves against its parent's DESCENDANTS, not only its children.
// What does not resolve is a name no row carries at all, which is the whole
// failure mode — a rename leaves the shorthand just as stale as the full path.
import { MODULE_GROUPS } from "../lib/nav/module-groups";
import { SUBMODULES } from "../lib/masters/submodules";
import { MATERIALS_CHILDREN } from "../lib/masters/registry";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCAN = ["app", "lib", "components"];
const SEP = "▸";

// ---------------------------------------------------------------------------
// The vocabulary: label -> every label reachable beneath it.
// ---------------------------------------------------------------------------

/** Labels a path may START at: a module, a group, or a Master Data submodule. */
const roots = new Set<string>();
/**
 * label -> descendants, merged across same-named nodes — so an ambiguous
 * segment ("Materials" is a Master Data submodule AND a row elsewhere) resolves
 * if EITHER reading works. The check reports names, not trees, and a sentence
 * that names two real rows is not the bug being hunted.
 */
const under = new Map<string, Set<string>>();
/** Every label in either registry, for the near-miss suggestion. */
const known = new Set<string>();

function link(parent: string, child: string) {
  known.add(parent);
  known.add(child);
  let set = under.get(parent);
  if (!set) under.set(parent, (set = new Set<string>()));
  set.add(child);
}

for (const grouping of Object.values(MODULE_GROUPS)) {
  roots.add(grouping.label);
  known.add(grouping.label);
  for (const entry of grouping.entries) {
    if (entry.kind === "link") {
      link(grouping.label, entry.label);
      continue;
    }
    roots.add(entry.label);
    link(grouping.label, entry.label);
    for (const c of entry.children) {
      link(entry.label, c.label);
      // The shorthand: "Orders > Material BOM", skipping the sub-module.
      link(grouping.label, c.label);
    }
  }
}

// Master Data is not in MODULE_GROUPS — it kept the shape every other module
// was regrouped INTO, so its tree lives in submodules.ts + registry.ts.
roots.add("Master Data");
known.add("Master Data");
for (const sub of SUBMODULES) {
  roots.add(sub.label);
  link("Master Data", sub.label);
  // Materials' children live in registry.ts (it owns a richer route); the other
  // five carry theirs inline. BOTH spellings of a child count: those entries
  // declare a plural `label` and a `singular`, and prose legitimately uses
  // either — "Materials > Attributes" and "Materials > Attribute" are one row.
  const kids = sub.slug === "materials" ? MATERIALS_CHILDREN : sub.children;
  for (const c of kids) {
    for (const name of [c.label, c.singular]) {
      link(sub.label, name);
      link("Master Data", name);
    }
  }
}

/** Every label beneath `label`, following the tree to the bottom. */
function descendants(label: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(under.get(label) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (out.has(next)) continue;
    out.add(next);
    for (const d of under.get(next) ?? []) stack.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading the source
// ---------------------------------------------------------------------------

const BACKSLASH = String.fromCharCode(92);

/**
 * Source with comments removed and line numbers preserved.
 *
 * Hand-rolled rather than regex'd because a "//" inside a string literal is not
 * a comment and an apostrophe inside a comment is not a quote — both occur in
 * this repo, and either mistake silently swallows the rest of a file.
 */
function stripComments(src: string): { code: string; comments: string[] } {
  let out = "";
  const comments: string[] = [""];
  let mode: "code" | "line" | "block" | "str" = "code";
  let quote = "";
  const newline = () => {
    out += "\n";
    comments.push("");
  };
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        mode = "str";
        quote = c;
      }
      if (c === "\n") newline();
      else out += c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        newline();
      } else comments[comments.length - 1] += c;
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && d === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      if (c === "\n") newline(); // keep line numbers honest
      else comments[comments.length - 1] += c;
      i += 1;
      continue;
    }
    if (c === BACKSLASH) {
      out += c + (d ?? "");
      i += 2;
      continue;
    }
    if (c === quote) mode = "code";
    if (c === "\n") newline();
    else out += c;
    i += 1;
  }
  return { code: out, comments };
}

// A segment is Title Case words. Requiring every word to start uppercase (or be
// a bare "&", as in "HR & Payroll") is what ends a path at the sentence around
// it: "... on Orders > Material BOM and save it" stops at "and". A label
// containing a lowercase word would be clipped instead — it would then fail to
// resolve and be REPORTED, never silently passed, which is the right way round
// for a guess to fail.
const WORD = "(?:[A-Z0-9][A-Za-z0-9&'()/-]*|&)";
const SEGMENT = `${WORD}(?: ${WORD})*`;
const PATH = new RegExp(`${SEGMENT}(?:\\s*${SEP}\\s*${SEGMENT})+`, "g");

const files: string[] = [];
function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".next") walk(f);
    } else if (/\.tsx?$/.test(e.name)) {
      files.push(f);
    }
  }
}
for (const d of SCAN) walk(path.join(ROOT, d));

/**
 * Closest known label, for "did you mean". Plain Levenshtein; the vocabulary is
 * small enough that nothing cleverer earns its lines. The threshold scales with
 * the word so a one-letter slip in "GST" is offered and an unrelated
 * fifteen-letter phrase is not.
 */
function nearest(word: string): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  const a = word.toUpperCase();
  for (const k of known) {
    const b = k.toUpperCase();
    if (a === b) return k;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(
          prev[j] + 1,
          row[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      prev = row;
    }
    if (prev[b.length] < bestD) {
      bestD = prev[b.length];
      best = k;
    }
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

const EXEMPT = "nav-path: exempt";

const failures: string[] = [];
let checked = 0;
let skipped = 0;
let exempted = 0;

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.includes(SEP)) continue;
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const { code, comments } = stripComments(raw);
  const codeLines = code.split(/\r?\n/);
  // The marker lives in a comment, which is what the scan just removed — so it
  // is read from the stripper's own per-line record rather than re-guessed from
  // the raw text.
  //
  // Its reach is the COMMENT BLOCK immediately above, not a line count. A fixed
  // window is a number someone has to guess right: the first cut allowed two
  // lines and missed a four-line `{/* … */}` in JSX, which is the normal shape
  // for a reason that needs a sentence. Walking up "comment-only" lines binds a
  // marker to the statement it was written above however long the explanation
  // runs, and cannot reach past an unrelated statement to grab one.
  //
  // A JSX comment leaves its braces behind, so `{` / `}` and whitespace are what
  // "no code on this line" means here — the brace is the comment's syntax, not
  // a statement.
  const codeOnly = (i: number) => (codeLines[i] ?? "").replace(/[{}\s]/g, "");
  const isExempt = (idx: number) => {
    if ((comments[idx] ?? "").includes(EXEMPT)) return true;
    for (let i = idx - 1; i >= 0 && codeOnly(i) === ""; i--) {
      if ((comments[i] ?? "").includes(EXEMPT)) return true;
    }
    return false;
  };
  codeLines
    .forEach((line, idx) => {
      if (!line.includes(SEP)) return;
      if (isExempt(idx)) {
        exempted++;
        return;
      }
      for (const m of line.matchAll(PATH)) {
        const segments = m[0].split(SEP).map((s) => s.trim());
        if (!roots.has(segments[0])) {
          skipped++;
          continue;
        }
        checked++;
        let parent = segments[0];
        for (const seg of segments.slice(1)) {
          if (descendants(parent).has(seg)) {
            parent = seg;
            continue;
          }
          const hint = nearest(seg);
          failures.push(
            `${rel}:${idx + 1}\n` +
              `    "${m[0]}"\n` +
              `    ${SEP} "${seg}" is not on the menu under "${parent}".` +
              (hint ? ` Did you mean "${hint}"?` : ""),
          );
          break;
        }
      }
    });
}

console.log(
  `check-nav-paths: ${checked} menu path${checked === 1 ? "" : "s"} checked, ` +
    `${skipped} in-screen path${skipped === 1 ? "" : "s"} skipped ` +
    `(first segment is not a registry label), ${exempted} exempt.`,
);
if (failures.length) {
  console.error(`\n${failures.length} unresolvable menu path(s):\n`);
  for (const f of failures) console.error(f + "\n");
  console.error(
    "Each of these is a sentence telling an operator to click something that is\n" +
      "not there. Fix the WORDING to match lib/nav/module-groups.ts (or\n" +
      "lib/masters/submodules.ts) — never the registry to match the sentence.\n",
  );
  process.exit(1);
}
console.log("check-nav-paths: OK");
