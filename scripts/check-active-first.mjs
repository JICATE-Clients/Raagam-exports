// npm run check:active-first — ACTIVE LEADS THE FORM (user 2026-10-15).
//
// "fix this for overall application … it should not appear in future modules
// also." A record's Active / Inactive status is a fact about the WHOLE record,
// so an editor shows it FIRST — before the fields it governs — and a child grid
// whose rows can be switched off shows it as its FIRST column. Before this, 19
// editors drew the flag by hand as a tick box worded "Inactive", "Blocked" or
// "Active", and every one of them put it LAST.
//
// The rule lives in one primitive, `components/ui/active-field.tsx`
// (`<ActiveField>`), and this check keeps it there:
//
//   1. A HAND-ROLLED STATUS TICK — an `<input type="checkbox">` or `<Toggle>`
//      whose `checked` reads the record's own flag (`inactive`, `blocked`,
//      `is_active`, `isActive`). Use `<ActiveField>`; it owns the wording, the
//      colour, the positive state and the edit-only rule.
//   2. AN `<ActiveField>` THAT IS NOT FIRST — any field (`<Field`, `<Input`,
//      `<Select`, `<Textarea`, a `…Picker`) between the nearest form container
//      that opens before it (`<FieldGrid`, `<FieldRow`, `<DetailSection`,
//      `<CardBody`, `<form`) and the `<ActiveField>` itself.
//   3. A CHILD-GRID STATUS COLUMN THAT IS NOT FIRST — in a `columns` array, a
//      column headed Active / Inactive / Blocked / Status-with-a-switch must be
//      the array's first entry.
//
// Comments are stripped before scanning — files describe the old tick boxes in
// prose. Opt out per element with `active-first: exempt -- <reason>` on one of
// the three lines above it (a LISTING's status switch is `StatusToggle`, which
// is not this check's business and is never flagged). Verified by being made
// to FAIL first, against the tree as it stood before the sweep.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const DIRS = ["app", "components"];
const OWNERS = new Set([
  "components/ui/active-field.tsx",
  // The LISTING's status cell and its hook — a row switch, not an editor field.
  "components/ui/status-toggle.tsx",
  "components/masters/use-block-action.tsx",
]);
const EXEMPT = /active-first:\s*exempt\s*--/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Blank out comments, keeping offsets (and so line numbers) intact. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre) => pre + " ".repeat(m.length - pre.length));
}

const lineOf = (src, i) => src.slice(0, i).split("\n").length;

function exempt(raw, line) {
  const lines = raw.split("\n");
  for (let l = Math.max(0, line - 4); l < line; l++) if (EXEMPT.test(lines[l] ?? "")) return true;
  return false;
}

/** The text of the JSX opening tag starting at `i` (to its matching `>`). */
function tagAt(src, i) {
  let depth = 0;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i, i + 400);
}

const FLAG = /\b(inactive|blocked|is_active|isActive|isBlocked)\b/;
const CONTAINER = /<(FieldGrid|FieldRow|DetailSection|CardBody|form)\b/g;
const FIELDISH = /<(Field|Input|Select|Textarea|Combobox|[A-Z]\w*Picker)\b/;

const findings = [];

for (const abs of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const rel = relative(ROOT, abs).split(sep).join("/");
  if (OWNERS.has(rel)) continue;
  const raw = readFileSync(abs, "utf8");
  const src = stripComments(raw);

  // 1. Hand-rolled status ticks.
  for (const m of src.matchAll(/<(input|Toggle|Checkbox)\b/g)) {
    const tag = tagAt(src, m.index);
    if (m[1] === "input" && !/type=["']checkbox["']/.test(tag)) continue;
    const checked = tag.match(/\bchecked=\{([^}]*)\}/);
    if (!checked || !FLAG.test(checked[1])) continue;
    const line = lineOf(src, m.index);
    if (exempt(raw, line)) continue;
    findings.push(`${rel}:${line}  hand-rolled status tick (checked={${checked[1].trim()}}) — use <ActiveField>`);
  }

  // 2. <ActiveField> must lead its container.
  for (const m of src.matchAll(/<ActiveField\b/g)) {
    const line = lineOf(src, m.index);
    if (exempt(raw, line)) continue;
    const before = src.slice(0, m.index);
    let open = -1;
    for (const c of before.matchAll(CONTAINER)) open = c.index;
    if (open < 0) {
      findings.push(`${rel}:${line}  <ActiveField> sits in no FieldGrid/FieldRow/DetailSection/CardBody/form — cannot tell whether it is first`);
      continue;
    }
    const between = src.slice(open + tagAt(src, open).length, m.index);
    const hit = between.match(FIELDISH);
    if (hit) findings.push(`${rel}:${line}  <ActiveField> is not the first field — <${hit[1]}> comes before it`);
  }

  // 3. A status column in a columns array must be its first entry.
  for (const m of src.matchAll(/(?:header|label):\s*"(Active|Inactive|Blocked)"/g)) {
    const line = lineOf(src, m.index);
    if (exempt(raw, line)) continue;
    const before = src.slice(0, m.index);
    const arr = before.lastIndexOf("[");
    if (arr < 0) continue;
    const head = before.slice(arr + 1);
    // Another `{ … header:` / `key:` object ahead of this one in the same array.
    if (/\{\s*(key|header|label|id)\s*:/.test(head.replace(/\{[^{}]*$/, ""))) {
      findings.push(`${rel}:${line}  "${m[1]}" column is not the first column of its grid`);
    }
  }
}

if (findings.length) {
  console.error(`check:active-first — ${findings.length} finding(s). Active leads the form (AGENTS.md):\n`);
  for (const f of findings) console.error("  " + f);
  process.exit(1);
}
console.log("check:active-first — ok: every status field leads its form.");
