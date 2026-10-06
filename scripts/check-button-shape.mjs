// npm run check:button-shape — ONE BUTTON SHAPE (user 2026-10-06).
//
// "this is the button shape i prefer for the whole application" (the Pending /
// Updated / Draft box on the BOM and Budget queues), then "button size also
// issue … make it even size". The app had drawn one job seven ways and given
// one Button five heights, and every one of them was a call site overriding the
// primitive: 59 `<Button size="sm" className="h-7">`, toggle groups hand-rolled
// with their own track, corners and lit colour. The shape now lives in two
// places only — `components/ui/button.tsx` (`rounded-control`, h-9 / h-8) and
// `components/ui/segmented.tsx` (`ToggleGroup` / `Segmented`) — and this check
// is what keeps it there:
//
//   1. A `<Button>` whose className sets a HEIGHT (`h-7`) or a RADIUS
//      (`rounded-full`). The size belongs to `size=`, the corner to the
//      primitive. Responsive (`md:h-10`) and container (`@2xl/editor:`) forms
//      are not flagged; an icon-square `h-8 w-8` is not a different shape.
//   2. A hand-rolled `<button aria-pressed>` outside components/ui — a toggle
//      group built by hand, which is how the seven shapes happened. Use
//      `ToggleGroup`. A lone on/off button is legitimate: say so.
//
// Opt out per element with `button-shape: exempt -- <reason>` on one of the
// three lines above it. Verified by being made to FAIL first, against the tree
// as it stood before the sweep (66 findings in rule 1).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const DIRS = ["app", "components"];
const OWNERS = new Set(["components/ui/button.tsx", "components/ui/segmented.tsx"]);
const EXEMPT = /button-shape:\s*exempt\s*--/;

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

// Unprefixed only: `md:h-10` / `@2xl/editor:h-8` / `[&_svg]:…` are left alone.
const HEIGHT = /(?<![\w:/[-])h-(\d+(?:\.5)?|\[[^\]]+\])(?![\w./-])/g;
const RADIUS = /(?<![\w:/[-])rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?(?![\w./-])/g;
const WIDTH = /(?<![\w:/[-])w-(\d+(?:\.5)?)(?![\w./-])/g;

const findings = [];
for (const file of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const slug = relative(ROOT, file).split(sep).join("/");
  if (OWNERS.has(slug)) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  const exempt = (line) => lines.slice(Math.max(0, line - 4), line).some((l) => EXEMPT.test(l));

  for (const m of src.matchAll(/<(Button|button)\b/g)) {
    const tag = src.slice(m.index, openingEnd(src, m.index + m[0].length));
    const line = lineOf(m.index);
    if (m[1] === "Button") {
      // Every string literal inside className — a plain "…" or the pieces of cn(…).
      const cls = tag.match(/className=(?:"([^"]*)"|\{([\s\S]*)\})/);
      if (!cls) continue;
      const text = cls[1] ?? (cls[2].match(/"[^"]*"|`[^`]*`/g) ?? []).join(" ");
      const heights = [...text.matchAll(HEIGHT)].map((x) => x[1]);
      const widths = new Set([...text.matchAll(WIDTH)].map((x) => x[1]));
      const off = [
        ...heights.filter((h) => !widths.has(h)).map((h) => `h-${h}`),
        ...[...text.matchAll(RADIUS)].map((x) => x[0]),
      ];
      if (off.length && !exempt(line)) {
        findings.push(`${slug}:${line}  <Button className> sets ${off.join(", ")} — the height is \`size=\`'s and the corner is the primitive's`);
      }
    } else if (/\baria-pressed=/.test(tag) && !slug.startsWith("components/ui/") && !exempt(line)) {
      findings.push(`${slug}:${line}  hand-rolled <button aria-pressed> — a toggle group is \`ToggleGroup\` (components/ui/segmented.tsx)`);
    }
  }
}

if (findings.length) {
  console.error(`check:button-shape — ${findings.length} finding(s):\n`);
  for (const f of findings) console.error("  " + f);
  console.error("\nFix the call site, or add `// button-shape: exempt -- <reason>` above the element.");
  process.exit(1);
}
console.log("check:button-shape — ok: every Button takes the primitive's shape; every toggle group is ToggleGroup.");
