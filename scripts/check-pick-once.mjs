#!/usr/bin/env node
/**
 * check:pick-once — EVERY GRID COLUMN THAT PICKS MASTER DATA DECIDES ABOUT REPEATS
 * (user 2026-11-02: "globally don't allow duplicates in any entry in the application").
 *
 * A `ChildGrid` column whose cell holds a picker (`<…Picker`, `<Combobox`) must say ONE of:
 *   - `unique: (row) => row.<id>` — the value may not repeat across rows; the grid greys
 *     what another row holds (components/ui/pick-once.tsx). A picker already handed its
 *     siblings by hand (`usedIds=`) counts too — that is the same rule, wired per cell;
 *   - `// pick-once: exempt -- <reason>` inside the column (or on the lines just above it) —
 *     a repeat is real data here (five contacts in Marketing, the same item in two colours).
 *
 * A column that says neither fails the build — a new grid cannot ship the duplicate by
 * forgetting. Columns are found as object literals carrying both `header:` and `cell:`;
 * strings, template literals and comments are skipped while matching braces.
 *
 * `node scripts/check-pick-once.mjs`             fail on any undecided column
 * `node scripts/check-pick-once.mjs --list`      also list every decided column
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const LIST = process.argv.includes("--list");
const PICKER = /<(?:[A-Z]\w*Picker|Combobox)\b/;
/** Declared on the column, or the picker already handed its sibling set by hand (`usedIds=`). */
const UNIQUE = /\bunique\s*:|\busedIds\s*=/;
const EXEMPT = /pick-once:\s*exempt\s*--\s*\S/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Object literals of a file, as [start, end] offsets, skipping strings/comments/templates. */
function objects(src) {
  const out = [];
  const stack = []; // { pos, kind: "{" | "${" }
  let i = 0;
  const tmpl = []; // template nesting: depth of "${" braces per open template
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const e = src.indexOf("\n", i);
      i = e < 0 ? src.length : e;
      continue;
    }
    if (c === "/" && n === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        if (src[i] === "\n") break;
        i++;
      }
      i++;
      continue;
    }
    if (c === "`") {
      // scan the template; "${" opens a code brace we track on the stack
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "`") break;
        if (src[i] === "$" && src[i + 1] === "{") {
          tmpl.push(stack.length);
          stack.push({ pos: i + 1, kind: "${" });
          i += 2;
          // resume normal scanning until this "${" closes
          break;
        }
        i++;
      }
      if (src[i] === "`") i++;
      continue;
    }
    if (c === "{") {
      stack.push({ pos: i, kind: "{" });
      i++;
      continue;
    }
    if (c === "}") {
      const top = stack.pop();
      if (top && top.kind === "${") {
        tmpl.pop();
        // back inside the template literal: scan to its end or the next "${"
        i++;
        while (i < src.length) {
          if (src[i] === "\\") {
            i += 2;
            continue;
          }
          if (src[i] === "`") {
            i++;
            break;
          }
          if (src[i] === "$" && src[i + 1] === "{") {
            tmpl.push(stack.length);
            stack.push({ pos: i + 1, kind: "${" });
            i += 2;
            break;
          }
          i++;
        }
        continue;
      }
      if (top) out.push([top.pos, i + 1]);
      i++;
      continue;
    }
    i++;
  }
  return out;
}

const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];
const bad = [];
const ok = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!src.includes("ChildGrid")) continue;
  for (const [s, e] of objects(src)) {
    const body = src.slice(s, e);
    // A column: carries header + cell at its OWN level (approximation: both keys present
    // and the object is not huge — a whole component body also contains them).
    if (!/\bheader\s*:/.test(body) || !/\bcell\s*:/.test(body) || body.length > 6000) continue;
    if (!PICKER.test(body)) continue;
    // Skip an object that merely CONTAINS columns (an array of them inside).
    const inner = body.slice(1, -1);
    if ((inner.match(/\bheader\s*:/g) ?? []).length > 1) continue;
    const before = src.slice(Math.max(0, s - 400), s).split("\n").slice(-4).join("\n");
    const line = src.slice(0, s).split("\n").length;
    const header = /\bheader\s*:\s*(["'`])(.*?)\1/.exec(body)?.[2] ?? "?";
    const where = `${relative(ROOT, f).replace(/\\/g, "/")}:${line}  "${header}"`;
    if (UNIQUE.test(body)) ok.push(`unique  ${where}`);
    else if (EXEMPT.test(body) || EXEMPT.test(before)) ok.push(`exempt  ${where}`);
    else bad.push(where);
  }
}

if (LIST) for (const l of ok.sort()) console.log(l);
if (bad.length) {
  console.error(`\ncheck:pick-once — ${bad.length} grid column(s) pick master data and say nothing about repeats:\n`);
  for (const b of bad.sort()) console.error(`  ${b}`);
  console.error(
    `\nAdd \`unique: (row) => row.<id>\` to the column (the grid then greys a value another row holds),\n` +
      `or \`// pick-once: exempt -- <reason>\` where a repeat is real data. components/ui/pick-once.tsx.\n`,
  );
  process.exit(1);
}
console.log(`check:pick-once — ok: ${ok.length} picker column(s), each unique or exempt with a reason.`);
