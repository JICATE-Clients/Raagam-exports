// npm run check:grid-cells — AN EDITABLE GRID IS AN EXCEL SHEET (user 2026-11-06:
// "full application is using this single separated cell kind of UI, but we need to make it
// as tightened excel kind of cell — in future also the table should create like that format").
//
// The look is ChildGrid's DEFAULT (`cells = "sheet"`), so a new grid is a sheet without its
// author knowing the rule exists. Two things can undo that, and both are refused here:
//
//   1. THE PRIMITIVE LOSES ITS DEFAULT. `components/masters/child-grid.tsx` must still default
//      `cells = "sheet"` and still stamp `data-grid-cells` on its root. Flipping the default
//      back would turn ~120 grids back into a box per field with every call site unchanged.
//   2. A SCREEN OPTS OUT SILENTLY. `cells="boxed"` needs `grid-cells: exempt -- <reason>`
//      within the 6 lines above it.
//
// FLOOR: a hand-rolled `<table>` grid (~22 screens) never reaches ChildGrid and is invisible
// here; wrap one in `data-grid-style="sheet" data-grid-cells="flat"` to give it the look.
//
// Usage: node scripts/check-grid-cells.mjs [root]   (root defaults to cwd)

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.argv[2] ?? process.cwd();
const DIRS = ["app", "components"].map((d) => join(ROOT, d)).filter(existsSync);
const EXEMPT = /grid-cells:\s*exempt\s*--/;
const PRIMITIVE = join(ROOT, "components", "masters", "child-grid.tsx");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const problems = [];

// 1. The primitive keeps the default.
const prim = existsSync(PRIMITIVE) ? readFileSync(PRIMITIVE, "utf8") : "";
if (!/\bcells\s*=\s*"sheet"/.test(prim)) problems.push(`${relative(ROOT, PRIMITIVE)}: ChildGrid no longer defaults cells = "sheet"`);
if (!/data-grid-cells=\{/.test(prim)) problems.push(`${relative(ROOT, PRIMITIVE)}: ChildGrid no longer stamps data-grid-cells on its root`);

// 2. No silent opt-out.
let optOuts = 0;
for (const file of DIRS.flatMap((d) => walk(d))) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/\bcells\s*=\s*(\{\s*)?["']boxed["']/.test(line)) return;
    optOuts++;
    const above = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
    if (!EXEMPT.test(above)) {
      problems.push(`${relative(ROOT, file).split(sep).join("/")}:${i + 1}: cells="boxed" without a "grid-cells: exempt -- <reason>" comment`);
    }
  });
}

if (problems.length) {
  console.error(`check:grid-cells — ${problems.length} problem(s):`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`check:grid-cells — ok (ChildGrid defaults to Excel cells; ${optOuts} exempt opt-out(s))`);
