// Propose new item-class category names from free external sources.
//
//     node --experimental-strip-types scripts/mine-name-vocabularies.mts
//     node --experimental-strip-types scripts/mine-name-vocabularies.mts --apply
//
// or `npm run mine:vocab` / `npm run mine:vocab -- --apply`.
//
// ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ──────────────────────────
//
// `lib/masters/name-vocabularies.ts` holds ~262 hand-written category names
// keyed by item class. They are good and they are finite: a name nobody thought
// of is a name the "did you mean?" strip can never offer. This script widens
// them from three free sources (see scripts/vocab-sources/).
//
// It is NOT a runtime lookup, and that distinction is the whole design:
//
//   • Nothing is fetched on the keystroke path. The strip stays synchronous and
//     offline, which it has to be — the cursor hold is a keydown-time test, so a
//     suggestion that arrives 300 ms later has already lost (AGENTS.md
//     "Duplicates").
//   • `candidates` stays a compile-time constant, so THE BOUNDARY assertion in
//     check-name-suggest.mts remains a proof rather than a spot-check. It probes
//     every class with every prefix of every word every other class knows; that
//     only means something if the word set cannot change at runtime.
//   • Nothing reaches an operator un-reviewed. The default run writes a proposal
//     file with every box UNTICKED. `--apply` reads back only the ticked ones.
//     Approval is an act, not a default.
//
// The 2026-07-28 failure was a fibre word list reachable from a screen that
// never asked for one. Everything here is arranged so that shape stays
// unrepresentable: sources emit (term, class) pairs, the HSN partition is a
// declared table, and a class with no declared source gets nothing.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { normName } from "../lib/masters/name-dictionary.ts";
import { categoryNameSeed } from "../lib/masters/name-vocabularies.ts";
import { hsnSource } from "./vocab-sources/hsn.mts";
import type { MinedTerm } from "./vocab-sources/types.mts";
import { wikidataSource } from "./vocab-sources/wikidata.mts";
import { wiktionarySource } from "./vocab-sources/wiktionary.mts";

/** The seven shipped classes, in the order the vocabulary file lists them. */
const CLASSES = ["YARN", "FABRIC", "SEW", "PACK", "GAR", "GEN", "CAP"] as const;

const REPO = path.join(import.meta.dirname, "..");
const VOCAB_FILE = path.join(REPO, "lib", "masters", "name-vocabularies.ts");
const REVIEW_FILE = path.join(REPO, "scripts", "out", "vocab-proposals.md");

/* ══════════════════════════════════════════════════════════ sanitise ══════ */

/** Longer than this is a specification, not a name. The longest hand-written
 *  entry today is FABRIC INSPECTION MACHINE at 26. */
const MAX_LEN = 32;

/** More than this is a sentence. The longest hand-written entry is 3 words. */
const MAX_WORDS = 4;

/**
 * Characters a category name may contain, AFTER normName has uppercased it.
 *
 * Deliberately narrow. Every hand-written name in the file today fits it, and
 * the things it excludes — commas, percent signs, parentheses, slashes, colons —
 * are exactly the punctuation that marks an HSN description as a legal
 * definition rather than a product name.
 *
 * This matters more than it looks: normName() only trims, collapses whitespace
 * and uppercases (name-dictionary.ts:77). It strips NO punctuation. So
 * check-name-suggest.mts's `n === normName(n)` assertion would happily accept
 * "WOVEN FABRICS OF COTTON, CONTAINING 85% OR MORE" as a valid vocabulary entry.
 * The existing safety net cannot catch bad mining; this charset is the net.
 */
const ALLOWED_CHARS = /^[A-Z0-9 &'-]+$/;

/** Two or more digits together, or a decimal, means a measurement. Single digits
 *  are fine — 1X1 RIB, 2X2 RIB and 2X1 RIB are real FABRIC names today. */
const MEASUREMENT = /\d{2,}|\d\.\d/;

/**
 * Words that make a phrase a definition rather than a name. Rejected anywhere
 * in the term.
 *
 * OTHER earns its place twice over: it is the single most common HSN leaf, and
 * "OTHER KNITTED OR CROCHETED FABRICS" is a heading, not something an operator
 * would ever type into a Category field.
 */
const BOILERPLATE = new Set([
  "OTHER", "OTHERS", "WHETHER", "NOT", "EXCEEDING", "MEASURING", "CONTAINING",
  "WEIGHING", "INCLUDING", "EXCLUDING", "THEREOF", "SIMILAR", "KIND", "USED",
  "ELSEWHERE", "SPECIFIED", "RETAIL", "SALE", "CENT", "WEIGHT", "MIXED",
  "MAINLY", "SOLELY", "PIECE", "PIECES", "NES", "NESOI", "ETC", "PARTS",
  "PREPARED", "UNPREPARED", "READY", "MADE", "MADEUPS", "ARTICLES",
  "PRODUCTS", "MATERIALS", "MANUFACTURES", "COMBINED", "IMPREGNATED",
  "COATED", "COVERED", "LAMINATED", "COMMERCIALLY", "TECHNICAL",
]);

/** A term starting with one of these is a qualifier hanging off its heading. */
const LEADING_STOPWORDS = new Set(["OF", "IN", "ON", "FOR", "WITH", "AND", "OR", "BY", "AS", "AT", "TO"]);

/**
 * Whole terms that are true of the entire class and therefore name nothing in it.
 *
 * Two kinds, both observed in the first real run:
 *
 *   • The class's own noun. HSN heading 5509 is described as just "YARN", so YARN
 *     was proposed as a YARN category name. A category is a subdivision — a name
 *     that restates the class is the one name guaranteed to be useless.
 *   • A bare PROCESS. CARDED, COMBED, BALED, CARBONISED are leaves under a dozen
 *     headings each, and as compounds they are already right (the YARN list has
 *     CARDED COTTON and COMBED COTTON). Alone they describe a state, not a thing.
 *
 * Compare GENERIC_LEAVES in vocab-sources/hsn.mts, which is the same idea for
 * strings only that source produces. These are checked for every source.
 */
const DEGENERATE = new Set([
  "YARN", "YARNS", "FABRIC", "FABRICS", "FIBRE", "FIBRES", "FIBER", "FIBERS",
  "TEXTILE", "TEXTILES", "CLOTH", "THREAD", "THREADS", "MATERIAL", "TOW",
  "TOPS", "WASTE", "GARMENT", "GARMENTS", "MACHINE", "MACHINERY", "ACCESSORY",
  "CARDED", "COMBED", "BALED", "CARBONISED", "CARBONIZED", "DEGUMMED",
  "SCOURED", "RAW", "PROCESSED", "UNPROCESSED", "FINISHED", "UNFINISHED",
  "SINGLE", "DOUBLE", "MULTIPLE", "FOLDED", "CABLED", "TWISTED", "SPUN",
  "WOVEN", "KNITTED", "CROCHETED", "NARROW", "WIDE", "HEAVY", "LIGHT",
]);

type Reject = string;

/**
 * The name this term should be proposed as, or a one-word reason it should not be.
 *
 * Returning a REASON rather than null is not decoration — the run prints a
 * histogram of them, which is how you tune BOILERPLATE without guessing. A
 * source that is 90% "boilerplate" is working; one that is 90% "charset" means
 * the extraction is wrong upstream.
 */
function sanitise(raw: string): { ok: true; name: string } | { ok: false; why: Reject } {
  let t = normName(raw);
  t = t.replace(/\s*:\s*$/, "").replace(/\.+$/, "").trim();
  // A parenthetical is always a qualification — "SHEETING (TAKIA, LEOPARD
  // CLOTH...)" — and the useful name is what comes before it.
  t = t.replace(/\s*\(.*$/, "").trim();
  t = normName(t);

  if (t.length < 3) return { ok: false, why: "too-short" };
  if (t.length > MAX_LEN) return { ok: false, why: "too-long" };
  if (DEGENERATE.has(t)) return { ok: false, why: "degenerate" };
  if (MEASUREMENT.test(t)) return { ok: false, why: "measurement" };
  if (!ALLOWED_CHARS.test(t)) return { ok: false, why: "charset" };

  const words = t.split(" ");
  if (words.length > MAX_WORDS) return { ok: false, why: "too-many-words" };
  if (LEADING_STOPWORDS.has(words[0]!)) return { ok: false, why: "leading-stopword" };
  if (words.some((w) => BOILERPLATE.has(w))) return { ok: false, why: "boilerplate" };

  return { ok: true, name: t };
}

/* ══════════════════════════════════════════════════════════ collect ══════ */

type Proposal = { name: string; source: string; ref: string };

async function collect(refresh: boolean) {
  const sources = [hsnSource(refresh), wikidataSource(), wiktionarySource()];
  const raw: MinedTerm[] = [];
  const notes: Record<string, string> = {};

  for (const s of sources) {
    console.log(`\n[${s.id}]`);
    notes[s.id] = s.note;
    raw.push(...(await s.fetch()));
  }

  // Per class: sanitise, drop what the vocabulary already has, dedupe. The FIRST
  // source to propose a name keeps the citation, so the ref shown in review is
  // the most authoritative one available (sources are ordered HSN first).
  const proposals: Record<string, Proposal[]> = {};
  const rejects: Record<string, number> = {};
  let already = 0;
  let duped = 0;

  for (const cls of CLASSES) proposals[cls] = [];

  const seenPerClass = new Map<string, Set<string>>();
  const existingPerClass = new Map<string, Set<string>>();
  for (const cls of CLASSES) {
    seenPerClass.set(cls, new Set());
    existingPerClass.set(cls, new Set(categoryNameSeed(cls).map(normName)));
  }

  for (const term of raw) {
    const bucket = proposals[term.classCode];
    if (!bucket) {
      rejects["unknown-class"] = (rejects["unknown-class"] ?? 0) + 1;
      continue;
    }
    const s = sanitise(term.term);
    if (!s.ok) {
      rejects[s.why] = (rejects[s.why] ?? 0) + 1;
      continue;
    }
    if (existingPerClass.get(term.classCode)!.has(s.name)) {
      already++;
      continue;
    }
    const seen = seenPerClass.get(term.classCode)!;
    if (seen.has(s.name)) {
      duped++;
      continue;
    }
    seen.add(s.name);
    bucket.push({ name: s.name, source: term.source, ref: term.ref });
  }

  for (const cls of CLASSES) {
    proposals[cls]!.sort(
      (a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name),
    );
  }

  console.log(`\n[sanitise] ${raw.length} raw terms in`);
  console.log(`  already in the vocabulary: ${already}`);
  console.log(`  duplicate proposals:       ${duped}`);
  for (const [why, n] of Object.entries(rejects).sort((a, b) => b[1] - a[1])) {
    console.log(`  rejected ${why.padEnd(18)} ${n}`);
  }

  return { proposals, notes };
}

/* ═════════════════════════════════════════════════════ the review file ══════ */

const REVIEW_HEADER = (notes: Record<string, string>) => `# Proposed category names — review

Tick a box to ACCEPT a name. Everything is unticked on purpose: a proposal that
nobody read is a proposal that should not ship.

    - [x] \`COMBED COTTON\`   <- accepted
    - [ ] \`LEAD WOOL\`       <- rejected, just leave it

Then run:

    npm run mine:vocab -- --apply

which appends only the ticked names to CATEGORY_NAMES_BY_ITEM_CLASS in
lib/masters/name-vocabularies.ts, re-sorted and de-duplicated, and leaves this
file alone. Re-running the miner regenerates this file from scratch — accepted
names stop being proposed because they are then in the vocabulary.

**Judge each name against ONE question:** would an operator on this floor type it
into a Category field for this item class? Not "is it a real word", not "is it
really a textile". A correct name for the wrong class is the 2026-07-28 bug.

Sources:

${Object.entries(notes)
  .map(([id, note]) => `- \`${id}\` — ${note}`)
  .join("\n")}
`;

function renderReview(proposals: Record<string, Proposal[]>, notes: Record<string, string>): string {
  const parts = [REVIEW_HEADER(notes)];

  for (const cls of CLASSES) {
    const rows = proposals[cls] ?? [];
    const existing = categoryNameSeed(cls).length;
    parts.push(`\n## ${cls} — ${existing} existing, ${rows.length} proposed\n`);

    if (rows.length === 0) {
      parts.push(
        `_Nothing proposed._ No source declares anything for ${cls} — for HSN that means\n` +
          `\`HSN_CLASS_CHAPTERS.${cls}\` is empty in \`scripts/vocab-sources/hsn-chapter-map.mts\`.\n`,
      );
      continue;
    }

    // Grouped by source so a reviewer can judge a whole provenance at once —
    // the archaic Wiktionary tail is much faster to reject as a block than
    // interleaved with HSN codes.
    let lastSource = "";
    const width = Math.min(34, Math.max(...rows.map((r) => r.name.length)) + 2);
    for (const r of rows) {
      if (r.source !== lastSource) {
        parts.push(`\n### ${cls} · from \`${r.source}\`\n`);
        lastSource = r.source;
      }
      parts.push(`- [ ] \`${r.name}\`${" ".repeat(Math.max(1, width - r.name.length))}${r.ref}`);
    }
    parts.push("");
  }

  return parts.join("\n") + "\n";
}

/**
 * `- [x] \`NAME\`  ref` — backticks so a name with spaces has unambiguous bounds.
 *
 * ANCHORED AT COLUMN 0, with no leading whitespace allowed, because the header of
 * the file this parses contains a worked example of a ticked line. Indented by
 * four spaces it is a Markdown code block to a reader, and it was a ticked
 * COMBED COTTON to the first version of this regex — which then failed with "a
 * ticked line appears before any ## CLASS heading" and would have silently
 * accepted a name nobody chose if the headings had come first.
 */
const TICKED = /^- \[[xX]\] `([^`]+)`/;
const HEADING = /^## ([A-Z]+) —/;

async function readAccepted(): Promise<Record<string, string[]>> {
  let text: string;
  try {
    text = await readFile(REVIEW_FILE, "utf8");
  } catch {
    throw new Error(
      `--apply: ${REVIEW_FILE} does not exist. Run the miner without --apply first, ` +
        `tick the names you want, then re-run with --apply.`,
    );
  }

  const accepted: Record<string, string[]> = {};
  let cls: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h) {
      cls = h[1]!;
      continue;
    }
    const t = TICKED.exec(line);
    if (!t) continue;
    if (!cls) {
      throw new Error(`--apply: a ticked line appears before any "## CLASS" heading: ${line}`);
    }
    if (!CLASSES.includes(cls as (typeof CLASSES)[number])) {
      throw new Error(`--apply: heading "## ${cls}" is not one of ${CLASSES.join(", ")}`);
    }
    const s = sanitise(t[1]!);
    if (!s.ok) {
      // A hand-edited name that fails the same rules the miner applies would
      // otherwise land in the file and break check-name-suggest.mts's CAPS
      // assertion, several steps removed from the edit that caused it.
      throw new Error(
        `--apply: the ticked name "${t[1]}" under ${cls} is rejected as "${s.why}". ` +
          `Fix or untick it — names in the vocabulary must be <= ${MAX_LEN} chars, ` +
          `<= ${MAX_WORDS} words, uppercase, and free of punctuation.`,
      );
    }
    (accepted[cls] ??= []).push(s.name);
  }

  return accepted;
}

/* ═══════════════════════════════════════════════════════════ the patch ══════ */

/** Rewrap a class's names the way the file already writes them: 4-space indent,
 *  quoted and comma-separated, wrapped just under 80 columns. */
function renderNames(names: string[]): string {
  const lines: string[] = [];
  let line = "";
  for (const n of names) {
    const piece = `"${n}",`;
    if (line && `    ${line} ${piece}`.length > 78) {
      lines.push(`    ${line}`);
      line = piece;
    } else {
      line = line ? `${line} ${piece}` : piece;
    }
  }
  if (line) lines.push(`    ${line}`);
  return lines.join("\n");
}

/**
 * Replace one class's array literal in place, leaving everything else — and in
 * particular every block comment above the key — byte-identical.
 *
 * Targeted per key rather than by regenerating the whole map: those comments
 * carry the reasoning for each list (why the compounds matter more than the bare
 * fibres, why INTERLOCK is listed and INTARLOCK is not) and a codegen pass that
 * rewrote the map wholesale would quietly delete them.
 */
function patchClass(src: string, cls: string, names: string[]): string {
  const re = new RegExp(`(\\n  ${cls}: \\[\\n)([\\s\\S]*?)(\\n  \\],)`);
  const m = re.exec(src);
  if (!m) {
    throw new Error(
      `--apply: could not find the "${cls}: [" block in name-vocabularies.ts. ` +
        `The map's formatting changed — check CATEGORY_NAMES_BY_ITEM_CLASS.`,
    );
  }
  return src.slice(0, m.index) + m[1] + renderNames(names) + m[3] + src.slice(m.index + m[0].length);
}

async function apply() {
  const accepted = await readAccepted();
  const total = Object.values(accepted).reduce((n, v) => n + v.length, 0);
  if (total === 0) {
    console.log(
      `\nNothing ticked in ${REVIEW_FILE} — nothing to apply.\n` +
        `Change a "- [ ]" to "- [x]" for each name you want, then re-run.`,
    );
    return;
  }

  let src = await readFile(VOCAB_FILE, "utf8");
  const summary: string[] = [];

  for (const cls of CLASSES) {
    const add = accepted[cls] ?? [];
    if (add.length === 0) continue;
    const before = categoryNameSeed(cls);
    // Sorted and de-duplicated because check-name-suggest.mts asserts both.
    const after = [...new Set([...before, ...add].map(normName))].sort();
    src = patchClass(src, cls, after);
    summary.push(`  ${cls.padEnd(7)} ${before.length} -> ${after.length}  (+${after.length - before.length})`);
  }

  await writeFile(VOCAB_FILE, src, "utf8");
  console.log(`\nPatched ${VOCAB_FILE}:\n${summary.join("\n")}`);
  console.log(
    `\nNow verify — this is not optional, it is where a bad name shows up:\n` +
      `  node --experimental-strip-types scripts/check-name-suggest.mts`,
  );
}

/* ════════════════════════════════════════════════════════════════ main ══════ */

const argv = process.argv.slice(2);

if (argv.includes("--apply")) {
  await apply();
} else {
  const { proposals, notes } = await collect(argv.includes("--refresh"));
  await mkdir(path.dirname(REVIEW_FILE), { recursive: true });
  await writeFile(REVIEW_FILE, renderReview(proposals, notes), "utf8");

  console.log("\n[proposals]");
  for (const cls of CLASSES) {
    const n = proposals[cls]?.length ?? 0;
    console.log(`  ${cls.padEnd(7)} ${String(categoryNameSeed(cls).length).padStart(4)} existing  ` +
      `${String(n).padStart(4)} proposed${n === 0 ? "   (no source declares anything for it)" : ""}`);
  }
  console.log(`\nWrote ${REVIEW_FILE}`);
  console.log("Tick what you want, then: npm run mine:vocab -- --apply");
}
