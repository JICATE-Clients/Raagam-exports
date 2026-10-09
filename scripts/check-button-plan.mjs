// npm run check:button-plan — THE BUTTON PLAN (user 2026-10-09).
//
// "in button area i can see a lot of button and top area also why this much
// button" — Sample Costing showed eleven at once, and two of them ran the same
// handler. The approved plan (AGENTS.md "Buttons: one job, one filled, three on
// top") is mostly carried by primitives — `BackLink` is a text link,
// `MasterFullScreen`'s footer is 36px and takes `saveQuiet`, `MoreActions` folds
// the occasional actions. This check guards the two halves a SCREEN can still
// get wrong, and the shape they come back in is a copy of an old editor:
//
//   1. A desktop "← Back to list" <Button>. An editor's way out is its
//      footer's Cancel / Close, so a labelled Back button in the header is a
//      second button for one job. The phone arrow (`md:hidden`, labelled only
//      by `aria-label`) is not flagged — the footer hides Cancel below `sm`.
//   2. A `size="sm"` <Button> in an editor's header band (the element stamped
//      `data-focus-region="header"`). Header buttons are 36px; `sm` is for grid
//      rows and dense bars.
//
// NOT CHECKED, deliberately: "one filled button on screen". Filled buttons
// that never show together (Sample Costing's Revise on an approved costing,
// Submit on an editable one) look identical in source to two that do, so a
// static rule would either cry wolf or be exempted into silence. Review owns it.
//
// Opt out per element with `button-plan: exempt -- <reason>` on one of the
// four lines above it (HR person: its footer swaps Cancel for Skip, so the
// header Back is its only visible way out). Verified by being made to FAIL
// first, against Sample Costing and the Garment Order editor as committed
// before the plan.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const DIRS = ["app", "components"];
const SKIP = new Set(["components/ui/page-header.tsx", "components/masters/master-full-screen.tsx"]);
const EXEMPT = /button-plan:\s*exempt\s*--/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** End index of a JSX opening tag that starts after `i`, skipping `{…}` and strings. */
function openingEnd(s, i) {
  let depth = 0;
  let q = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) {
      if (c === q && s[j - 1] !== "\\") q = null;
    } else if ((c === '"' || c === "`" || c === "'") && depth > 0) q = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return j;
  }
  return s.length;
}

/** Index just past the `</div>` closing the `<div` that opens at `start`. */
function divEnd(s, start) {
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  for (let m; (m = re.exec(s)); ) {
    if (m[0] === "</div>") {
      if (--depth === 0) return m.index + 6;
    } else {
      const end = openingEnd(s, m.index + 4);
      if (s[end - 1] !== "/") depth++;
    }
  }
  return s.length;
}

const findings = [];
for (const file of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const slug = relative(ROOT, file).split(sep).join("/");
  if (SKIP.has(slug)) continue;
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n");
  // Block comments blanked, newlines kept, so offsets and line numbers still
  // match: a comment that says "a plain `<Button>` … ← Back to list" is prose,
  // not a button (it fired once, against the Garment Order band's old note).
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  const exempt = (line) => lines.slice(Math.max(0, line - 5), line).some((l) => EXEMPT.test(l));

  // Rule 1 — a labelled, desktop-visible Back to list button.
  for (const m of src.matchAll(/<Button\b/g)) {
    const end = openingEnd(src, m.index + 7);
    const tag = src.slice(m.index, end);
    // `max-md:hidden` is the OPPOSITE (hidden on a phone), hence the lookbehind.
    if (/(?<![\w-])md:hidden/.test(tag)) continue;
    const close = src.indexOf("</Button>", end);
    if (close < 0) continue;
    const label = src.slice(end + 1, close);
    if (!/Back to list/.test(label)) continue;
    const line = lineOf(m.index);
    if (!exempt(line)) {
      findings.push(`${slug}:${line}  desktop "← Back to list" button — the footer's Cancel / Close is the way out (keep only a phone \`md:hidden\` ←)`);
    }
  }

  // Rule 2 — a small button inside an editor header band.
  for (const m of src.matchAll(/data-focus-region="header"/g)) {
    const open = src.lastIndexOf("<div", m.index);
    if (open < 0 || src.slice(open, m.index).includes(">")) continue; // not on a <div>
    const band = src.slice(open, divEnd(src, open));
    for (const b of band.matchAll(/<Button\b/g)) {
      const tag = band.slice(b.index, openingEnd(band, b.index + 7));
      if (!/size="sm"/.test(tag) || /(?<![\w-])md:hidden/.test(tag)) continue;
      const line = lineOf(open + b.index);
      if (!exempt(line)) {
        findings.push(`${slug}:${line}  size="sm" in an editor header band — header buttons are 36px (drop \`size\`)`);
      }
    }
  }
}

if (findings.length) {
  console.error(`check:button-plan — ${findings.length} finding(s):\n`);
  for (const f of findings) console.error("  " + f);
  console.error("\nFix the call site, or add `// button-plan: exempt -- <reason>` above the element.");
  process.exit(1);
}
console.log("check:button-plan — ok: no duplicate Back buttons, no small buttons in an editor header.");
