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
// ## WHAT IT CHECKS, PER GRID
//
//   1. the declared columns + chrome <= MIN_PANE, so the table never scrolls
//      sideways there (doc/ui/LAYOUT.md rules that out, and the operator had
//      those scrollbars removed on 2026-08-10);
//   2. the grid's `tableFrom` threshold is at least THRESHOLD_MARGIN below
//      MIN_PANE. "Below" alone is not enough, and that is the sharpest lesson
//      here: `6xl` is 1152 against a 1155px pane, so it cleared the switch by
//      THREE pixels — and a scrollbar, an unmaximised window or one notch of
//      zoom put it under, turning the table into stacked cards.
//
// ## TWO THINGS IT GOT WRONG ON ITS SECOND RUN, AND WHY THEY MATTERED
//
// It failed two CORRECT grids in `component-map-sheet.tsx` on the very next
// merge, and a check that cries wolf gets switched off — which is worse than no
// check at all.
//
//   · IT READ A COMMENT AS A PROP. That file explains, in prose, why one of its
//     grids "still declares tableFrom 6xl". Comments are stripped now, the way
//     `audit_layout.py` has always stripped them, and for the same reason: most
//     mentions of a rule in this codebase are comments RECORDING it.
//   · IT JUDGED EVERY ARRAY IN A FILE BY THE FILE'S STRICTEST THRESHOLD. So
//     `panelColumns` — a `forceCards` grid with no `tableFrom` at all — was
//     measured against a threshold belonging to a different grid two hundred
//     lines away. A grid that never renders a table has no column budget to
//     blow. Props are attributed per `<ChildGrid>` now, by indentation.
//
// ## WHAT IT STILL CANNOT SEE
//
// A grid's container, only the pane. A grid nested inside a master-detail pane
// has far less width than MIN_PANE, so passing here is necessary and not
// sufficient for one of those. `grid-budget: exempt -- <reason>` opts a column
// array out, the way every other check in this repo does.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The smallest pane the app must look right in, in CSS px.
 *
 * MEASURED, NOT CHOSEN: a 1366x768 laptop at 100% scaling, which is the machine
 * the client tested on. 1366 viewport - 191px section rail - ~20px of pane
 * padding = 1155. Verified from a screenshot of that machine by measuring a
 * 32 CSS px input at 32 device px (so: no scaling) and the table's header rule
 * at exactly 1155px wide.
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

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".next-") || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (p.includes("worktrees")) continue;
      walk(p);
    } else if (e.endsWith(".tsx")) files.push(p);
  }
})(".");

/** Comments removed, so prose ABOUT a prop is never read as the prop. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\w])\/\/[^\r\n]*/g, "$1");
}

/**
 * The `<ChildGrid>` elements in a file, each with its OWN props.
 *
 * Found by INDENTATION: a `<ChildGrid`'s own props sit one step in from it, and
 * anything deeper belongs to a render prop's nested JSX. That is what keeps a
 * nested grid's `tableFrom` from being read as its parent's.
 */
function grids(src) {
  const lines = strip(src).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)<ChildGrid/);
    if (!m) continue;
    const own = m[1].length + 2;
    const props = [];
    for (let j = i + 1; j < lines.length; j++) {
      const ind = lines[j].search(/\S/);
      if (ind === -1) continue;
      if (ind < own) break; // the element has closed
      if (ind === own) props.push(lines[j]);
    }
    const text = props.join("\n");
    const cols = text.match(/columns=\{(\w+)/);
    const tf = text.match(/tableFrom="(5xl|6xl|7xl)"/);
    out.push({
      columns: cols ? cols[1] : null,
      tableFrom: tf ? tf[1] : null,
      cardsOnly: /^\s*(forceCards|inlineCards|across)\b/m.test(text),
    });
  }
  return out;
}

let failed = 0;
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const found = grids(src);
  if (found.length === 0) continue;

  const lines = src.split("\n");
  const starts = [];
  lines.forEach((l, i) => {
    const m = l.match(/const (\w*[Cc]olumns\w*)\b/);
    if (m) starts.push([i, m[1]]);
  });
  const widthsOf = {};
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k][0];
    const name = starts[k][1];
    const to = k + 1 < starts.length ? starts[k + 1][0] : lines.length;
    const raw = lines.slice(from, to).join("\n");
    widthsOf[name] = /grid-budget: exempt --/.test(raw)
      ? null
      : [...strip(raw).matchAll(/width: "([\d.]+)rem"/g)].map((mm) => Number(mm[1]));
  }

  /**
   * WHICH ARRAYS BELONG TO A CARDS-ONLY GRID, so they can be skipped: a grid
   * that never renders a table has no column budget to blow.
   */
  const cardsOnly = new Set(found.filter((g) => g.cardsOnly && g.columns).map((g) => g.columns));
  /** And which have a `tableFrom` this can hold them to. */
  const thresholdOf = {};
  for (const g of found) if (g.columns && g.tableFrom) thresholdOf[g.columns] = THRESHOLD[g.tableFrom];

  /**
   * EVERY SIZED ARRAY IS BUDGETED, NOT ONLY `<ChildGrid>`'S — because the two
   * grids that started this were HAND-ROLLED `<table>`s, and a scan that only
   * knew about the primitive stopped seeing exactly the code that needed it.
   * `manualEntryColumns` was the worst-budgeted array in the repo at 1176px and
   * belongs to no `<ChildGrid>` at all.
   *
   * The THRESHOLD half still needs a `tableFrom` to hold the grid to, so it only
   * applies where one was attributable; a hand-rolled table has no breakpoint to
   * get wrong, only a width.
   */
  for (const name of Object.keys(widthsOf)) {
    if (cardsOnly.has(name)) continue;
    const widths = widthsOf[name];
    if (!widths || widths.length < 2) continue;
    const g = { columns: name };
    const threshold = thresholdOf[name] ?? null;

    const rem = widths.reduce((a, b) => a + b, 0);
    const px = rem * 16 + CHROME;
    checked++;

    if (px > MIN_PANE) {
      failed++;
      console.error(
        `FAIL  ${relative(".", file)}  ${g.columns}\n` +
          `      ${widths.length} columns = ${rem}rem + ${CHROME}px chrome = ${px}px\n` +
          `      exceeds the ${MIN_PANE}px minimum pane by ${px - MIN_PANE}px, so the table\n` +
          `      scrolls sideways on a 1366x768 laptop at 100%. Trim ${((px - MIN_PANE) / 16).toFixed(2)}rem.`,
      );
    } else if (threshold !== null && threshold > MIN_PANE - THRESHOLD_MARGIN) {
      failed++;
      console.error(
        `FAIL  ${relative(".", file)}  ${g.columns}\n` +
          `      tableFrom switches at ${threshold}px — only ${MIN_PANE - threshold}px under the ${MIN_PANE}px\n` +
          `      minimum pane, where ${THRESHOLD_MARGIN}px is required. A scrollbar or one notch\n` +
          `      of zoom flips the table to stacked cards. Use a lower tableFrom.`,
      );
    } else {
      console.log(
        `ok    ${g.columns.padEnd(22)} ${String(widths.length).padStart(2)} cols  ` +
          `${String(px).padStart(4)}px  (${MIN_PANE - px}px headroom, ` +
          `${threshold === null ? "hand-rolled table" : `switches at ${threshold}`})`,
      );
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} grid budget check(s) failed.`);
  process.exit(1);
}
console.log(`\nEvery tableFrom grid fits the ${MIN_PANE}px minimum pane (${checked} checked).`);
