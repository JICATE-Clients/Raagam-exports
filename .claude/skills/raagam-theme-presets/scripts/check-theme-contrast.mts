/**
 * Proves every colour option (`ACCENTS`) in lib/appearance.ts is readable.
 * Fonts carry no colour and are not checked here.
 *
 *   node --experimental-strip-types .claude/skills/raagam-theme-presets/scripts/check-theme-contrast.mts
 *   (npm run check:themes)
 *
 * Each pair below is a place the app really draws one colour on another. A
 * theme that fails any of them is not "a different taste", it is a Save button
 * whose label cannot be read — exit 1.
 *
 * DARK `white on primary` IS HELD TO 4.3, NOT 4.5, and that is inherited, not
 * invented: the default dark palette (globals.css) ships #0380be at 4.34:1 as a
 * recorded trade-off against its 4.13:1 on the dark surface. A theme may match
 * that balance; it may not go below it.
 *
 * THE DEFAULT IS THE FLOOR WHERE IT IS ITSELF BELOW WCAG. "raagam" is the
 * client-approved look and several of its light pairs sit at 4.15-4.33 (brand
 * blue text on the canvas and on its own tints). This check does not get to
 * overrule that approval, so those pairs are REPORTED for raagam, not failed,
 * and every other theme must be at least as readable as raagam on them —
 * never worse than what the operator already reads every day.
 */
import { ACCENTS } from "../../../../lib/appearance.ts";

const LIGHT_SURFACE = "#ffffff";
const LIGHT_CANVAS = "#f6f7f9";
const DARK_SURFACE = "#14171d";
const WHITE = "#ffffff";

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let failures = 0;
const rows: string[] = [];
const baseline = new Map<string, number>();

for (const t of ACCENTS) {
  const L = t.light;
  const D = t.dark;
  const checks: [string, string, string, number][] = [
    ["light: white on primary", WHITE, L.primary, 4.5],
    ["light: white on primary-hover", WHITE, L.primaryHover, 4.5],
    ["light: white on primary-active", WHITE, L.primaryActive, 4.5],
    ["light: primary text on surface", L.primary, LIGHT_SURFACE, 4.5],
    ["light: primary text on canvas", L.primary, LIGHT_CANVAS, 4.5],
    ["light: primary text on primary-soft", L.primary, L.primarySoft, 4.5],
    ["light: primary text on cell-active", L.primary, L.cellActive, 4.5],
    ["light: info text on info-soft", L.info, L.infoSoft, 4.5],
    ["dark: white on primary", WHITE, D.primary, 4.3],
    ["dark: white on primary-hover", WHITE, D.primaryHover, 3.0],
    ["dark: info text on surface", D.info, DARK_SURFACE, 4.5],
    ["dark: info text on info-soft", D.info, D.infoSoft, 4.5],
    ["dark: primary ring on surface (non-text)", D.primary, DARK_SURFACE, 3.0],
  ];
  // A gradient's second stop carries the same white text as `primary`.
  if (L.gradientTo) checks.push(["light: white on gradient end", WHITE, L.gradientTo, 4.5]);
  if (D.gradientTo) checks.push(["dark: white on gradient end", WHITE, D.gradientTo, 4.3]);
  for (const [name, fg, bg, wcag] of checks) {
    const r = ratio(fg, bg);
    const isDefault = t.id === ACCENTS[0].id;
    if (isDefault) baseline.set(name, r);
    const floor = Math.min(wcag, baseline.get(name) ?? wcag);
    const ok = r + 1e-9 >= floor;
    const tag = ok ? "  ok " : isDefault ? "base " : "FAIL ";
    if (!ok && !isDefault) failures++;
    rows.push(`${tag} ${t.id.padEnd(9)} ${name.padEnd(42)} ${r.toFixed(2).padStart(5)} (min ${floor.toFixed(2)})`);
  }
}

console.log(rows.join("\n"));
console.log(
  failures
    ? `\ncheck:themes — ${failures} unreadable pair(s) across ${ACCENTS.length} colours.`
    : `\ncheck:themes — ${ACCENTS.length} colours, every pair readable.`,
);
process.exit(failures ? 1 : 0);
