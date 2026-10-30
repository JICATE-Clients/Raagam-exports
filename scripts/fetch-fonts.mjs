// Downloads the app's fonts from Google Fonts into public/fonts, and
// writes app/fonts.css with the same @font-face blocks (unicode-range per
// subset) pointing at the local copies. Run by hand from the repo root:
//   node scripts/fetch-fonts.mjs
// Never part of the build — that is the point (see app/fonts.css).
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FAMILIES = [
  { dir: "inter", query: "Inter:wght@400..800", google: "Inter", name: "Raagam Inter", cssVar: "--font-inter" },
  { dir: "ibm-plex-sans", query: "IBM+Plex+Sans:wght@100..700", google: "IBM Plex Sans", name: "Raagam IBM Plex Sans", cssVar: "--font-plex" },
  { dir: "source-sans-3", query: "Source+Sans+3:wght@200..900", google: "Source Sans 3", name: "Raagam Source Sans 3", cssVar: "--font-source" },
  { dir: "roboto", query: "Roboto:wght@100..900", google: "Roboto", name: "Raagam Roboto", cssVar: "--font-roboto" },
  // The login screen's face and the dashboard welcome card's brand face.
  { dir: "urbanist", query: "Urbanist:wght@500..800", google: "Urbanist", name: "Raagam Urbanist", cssVar: "--font-urbanist" },
  { dir: "baloo-2", query: "Baloo+2:wght@700", google: "Baloo 2", name: "Raagam Baloo 2", cssVar: "--font-baloo" },
];

let css = "";
const summary = [];
for (const f of FAMILIES) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${f.query}&display=swap`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${f.google}: CSS ${res.status}`);
  const text = await res.text();
  const blocks = [...text.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)];
  if (!blocks.length) throw new Error(`${f.google}: no @font-face blocks`);
  const outDir = path.join(ROOT, "public/fonts", f.dir);
  fs.mkdirSync(outDir, { recursive: true });
  css += `/* ${f.google} — ${f.cssVar} */\n`;
  for (const [, subset, body] of blocks) {
    const url = /url\((https:[^)]+\.woff2)\)/.exec(body)?.[1];
    if (!url) throw new Error(`${f.google} ${subset}: no woff2 url`);
    const file = `${subset}.woff2`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    if (buf.length < 1000) throw new Error(`${f.google} ${subset}: file too small`);
    fs.writeFileSync(path.join(outDir, file), buf);
    const keep = body
      .split(";")
      .map((l) => l.trim())
      .filter((l) => /^(font-style|font-weight|font-display|unicode-range)/.test(l));
    css += `@font-face {\n  font-family: "${f.name}";\n  src: url("/fonts/${f.dir}/${file}") format("woff2");\n${keep.map((l) => `  ${l};`).join("\n")}\n}\n`;
    summary.push(`${f.dir}/${file} ${(buf.length / 1024).toFixed(0)} KB`);
  }
  css += "\n";
}

const header = `/*
 * The app's fonts, SELF-HOSTED from public/fonts (2026-10-30). They used to be
 * fetched from Google Fonts by next/font/google AT BUILD TIME, and a bad answer
 * from Google failed a Vercel build ("An error occurred in next/font") with no
 * change to the code. Now the build never contacts Google.
 *
 * Same files and the same @font-face blocks Google serves: one file per
 * subset, each with its unicode-range, so a browser downloads only the subsets
 * a page uses (latin always; latin-ext for ₹). Variable fonts — one file
 * covers every weight. Family names carry a "Raagam" prefix so a copy
 * installed on the machine can never be picked instead.
 *
 * Regenerate with "node scripts/fetch-fonts.mjs" (writes this file and the
 * files); never edit the @font-face blocks by hand.
 */
:root {
${FAMILIES.map((f) => `  ${f.cssVar}: "${f.name}";`).join("\n")}
}

`;
// The two faces used by ONE element each (they were next/font's `.className`).
const classes = `/* The login screen (app/(login)/layout.tsx) and the dashboard welcome card's
   heading (components/dashboard/nool-greeter.tsx). */
.font-urbanist {
  font-family: var(--font-urbanist), ui-sans-serif, system-ui, sans-serif;
}
.font-baloo {
  font-family: var(--font-baloo), ui-rounded, ui-sans-serif, system-ui, sans-serif;
}
`;
fs.writeFileSync(path.join(ROOT, "app/fonts.css"), header + css + classes);
console.log(summary.join("\n"));
