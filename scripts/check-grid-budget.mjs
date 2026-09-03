// Does every `tableFrom` grid FIT the smallest screen this app supports?
//
//     npm run check:grid-budget
//
// ## WHY THIS EXISTS
//
// Client 2026-09-03: *"i checked with my client system, the fabric bom each tab
// lost its css … it comes with uneven aligned ui"*, and then the tell — *"i found
// the issue, if i set screen size as 90% its working"*.
//
// Browser zoom changes how many CSS pixels the window reports. A 1366x768 laptop
// at 100% gives the editor pane 1155 CSS px; at 90% it reports 1518 and the pane
// becomes ~1295. So a grid whose declared columns add up to more than 1155px
// looks broken at 100% and correct at 90% — which is exactly a layout that is
// fine on the machine it was built on and wrong on every narrower one.
//
// THREE OF THE FOUR FABRIC BOM GRIDS WERE OVER, and the worst offender was over
// by THREE PIXELS: `lineColumns` totalled 67.875rem = 1086px, plus 72px of `#`
// and `✕` chrome = 1158px against a 1155px pane. Nothing could have caught that
// by eye, and nothing did for weeks.
//
// ## WHY A CHECK AND NOT A COMMENT
//
// These budgets were already written down — `lineColumns` carries a comment
// working out "66.5rem + 72px of chrome = 1136px, which must stay under
// `tableFrom`'s 1152". The comment was right when it was written and the array
// drifted away from it: `manualEntryColumns` was trimmed to 65rem in the morning
// and was 69rem by the afternoon, because a `Size Wise` column was added and the
// arithmetic in the comment was not re-run. A budget that is enforced by a
// sentence is a budget that holds until the next column.
//
// ## WHAT IT CHECKS
//
//   1. columns + chrome <= MIN_PANE — the grid fits the smallest supported pane,
//      so the table never scrolls sideways there (doc/ui/LAYOUT.md rules that
//      out, and the operator had those scrollbars removed on 2026-08-10).
//   2. the grid's `tableFrom` threshold is at least THRESHOLD_MARGIN below
//      MIN_PANE. "Below" alone is not enough, and that is the sharpest lesson
//      here: `6xl` is 1152 against a 1155px pane, so it cleared the switch by
//      THREE pixels — and a scrollbar, an unmaximised window or one notch of
//      zoom put it under, turning the table into stacked cards. That is the
//      other half of what was reported.
//
// It is deliberately narrow: only arrays that a `tableFrom` grid renders, only
// widths declared as `rem`. A grid with no `tableFrom` is `across`, `cards` or
// `inline` and has no table to overflow.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The smallest pane the app must look right in, in CSS px.
 *
 * MEASURED, NOT CHOSEN: a 1366x768 laptop at 100% scaling, which is the machine
 * the client tested on. 1366 viewport - 191px section rail - ~20px of pane
 * padding = 1155. Verified against a screenshot from that machine by measuring a
 * 16 CSS px checkbox at 16 device px (so: no scaling) and the header rule at
 * 1155px wide.
 *
 * RAISE IT ONLY WITH THE CLIENT. Lowering the number is a promise about a
 * narrower screen; raising it says some machine in use is no longer supported.
 */
const MIN_PANE = 1155;

/** What `#` and the row's `✕` cost outside the declared columns. */
const CHROME = 72;

/**
 * How far BELOW the minimum pane a `tableFrom` threshold has to sit.
 *
 * "Below" alone is not enough, and that is the whole lesson of this report:
 * `6xl` is 1152 against a 1155px pane, so it cleared the switch by THREE pixels
 * and passed a naive test — while a vertical scrollbar (~15px), a window not
 * quite maximised, or one notch of browser zoom put it under and turned the
 * table into stacked cards. A threshold that close to the pane is not a
 * breakpoint, it is a coin toss.
 *
 * 64px covers a scrollbar with room to spare and still leaves `5xl` (1024)
 * comfortably legal at this pane.
 */
const THRESHOLD_MARGIN = 64;

/** `tableFrom` thresholds, from `child-grid.tsx`'s own TABLE_FROM. */
const THRESHOLD = { "5xl": 1024, "6xl": 1152, "7xl": 1280 };

const ROOTS = ["app", "components"];
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".next-")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (p.includes("worktrees")) continue;
      walk(p);
    } else if (e.endsWith(".tsx")) files.push(p);
  }
})(".") ;

let failed = 0;
let checked = 0;

for (const file of files.filter((f) => ROOTS.some((r) => f.startsWith(`.\\${r}`) || f.startsWith(`./${r}`) || f.startsWith(r)))) {
  const src = readFileSync(file, "utf8");
  if (!src.includes("tableFrom=")) continue;

  // Which thresholds this file uses. A file with one `tableFrom` is
  // unambiguous; with several, the STRICTEST is used, because a column array
  // cannot be traced to one grid by text alone and the tightest is the honest
  // assumption.
  const used = [...src.matchAll(/tableFrom="(5xl|6xl|7xl)"/g)].map((m) => m[1]);
  if (used.length === 0) continue;
  const threshold = Math.max(...used.map((u) => THRESHOLD[u]));

  // Each `const <name>Columns` block, up to the next top-level const.
  const lines = src.split("\n");
  const starts = [];
  lines.forEach((l, i) => {
    const m = l.match(/const (\w*[Cc]olumns\w*)\b/);
    if (m) starts.push([i, m[1]]);
  });

  for (let k = 0; k < starts.length; k++) {
    const [from, name] = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1][0] : lines.length;
    const block = lines.slice(from, to).join("\n");
    const widths = [...block.matchAll(/width: "([\d.]+)rem"/g)].map((m) => Number(m[1]));
    if (widths.length < 2) continue; // not a table row worth budgeting

    const rem = widths.reduce((a, b) => a + b, 0);
    const px = rem * 16 + CHROME;
    checked++;

    if (px > MIN_PANE) {
      failed++;
      console.error(
        `FAIL  ${relative(".", file)}  ${name}\n` +
          `      ${widths.length} columns = ${rem}rem + ${CHROME}px chrome = ${px}px\n` +
          `      exceeds the ${MIN_PANE}px minimum pane by ${px - MIN_PANE}px, so the table\n` +
          `      scrolls sideways on a 1366x768 laptop at 100%. Trim ${((px - MIN_PANE) / 16).toFixed(2)}rem.`,
      );
    }
    if (threshold > MIN_PANE - THRESHOLD_MARGIN) {
      failed++;
      console.error(
        `FAIL  ${relative(".", file)}  ${name}\n` +
          `      tableFrom switches at ${threshold}px — only ${MIN_PANE - threshold}px under the ${MIN_PANE}px
` +
          `      minimum pane, where ${THRESHOLD_MARGIN}px is required. A scrollbar or one notch
` +
          `      of zoom flips the table to stacked cards. Use a lower tableFrom.`,
      );
    }
    if (px <= MIN_PANE && threshold <= MIN_PANE - THRESHOLD_MARGIN) {
      console.log(
        `ok    ${name.padEnd(22)} ${String(widths.length).padStart(2)} cols  ` +
          `${String(px).padStart(4)}px  (${MIN_PANE - px}px headroom, switches at ${threshold})`,
      );
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} grid budget check(s) failed.`);
  process.exit(1);
}
console.log(`\nEvery tableFrom grid fits the ${MIN_PANE}px minimum pane (${checked} checked).`);
