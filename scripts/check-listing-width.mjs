// npm run check:listing-width — A LISTING IS FULL WIDTH, AND ITS PAGER IS THE PRIMITIVE'S
// (user 2026-10-16, screenshots 3575 / 3576: "the sample entry table and pagination
// over all application", then "i need to make ensure it").
//
// Sample Entry's list filled the pane with its pager pinned to the bottom edge;
// Plan Approval's stopped short of the right edge, because the screen wrapped its
// table in `md:w-fit`. Seven screens had done the same, each copying the last —
// the shape every rule in AGENTS.md records: a per-screen choice spreads by being
// cloned. Two rules, both read from the TypeScript AST (not regex), so a wrapper
// is found however far above the table it sits:
//
//   1. NO SHRINKING WRAPPER. A listing table (`<DataTable>`, `<OrderQueueTable>`,
//      `<SampleCards>`, `<MasterListShell>`, `<BomQueue>`) may not sit inside an
//      element whose className shrinks it to its content or caps it: `w-fit`,
//      `w-max`, `w-min`, `inline-block` / `inline-flex` / …, a fixed `w-…` or a
//      `max-w-…` cap — at any breakpoint (`md:w-fit` too). Walked up to the
//      component's own function. NOT a listing, and so not checked:
//        - a table inside a pop-up (`…Sheet`, `…Dialog`, `…Modal`, `Popover`)
//          or inside an editor (`MasterFullScreen`, a `data-focus-scope` element);
//        - a DOCUMENT table (`paginate={false}`) or a `bare` dashboard card.
//   2. THE PRIMITIVE KEEPS THE RULE. `data-table-frame.tsx` must still decide the
//      pager with `useIsListing` — "simplifying" `showBar` back to `paging` alone
//      would quietly take the pager off every list that fits on one page.
//
// Opt out per element with `listing-width: exempt -- <reason>` within the 6 lines
// above the wrapper or the table tag. Verified by being made to FAIL first,
// against the seven screens as committed before the 2026-10-16 sweep.
//
// FLOOR: a list drawn as a hand-written `<table>` never reaches the primitive and
// is invisible here. Build lists on `<DataTable>`.
//
// Usage: node scripts/check-listing-width.mjs [root]   (root defaults to cwd)

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = process.argv[2] ?? process.cwd();
const DIRS = ["app", "components"].map((d) => join(ROOT, d)).filter(existsSync);
const EXEMPT = /listing-width:\s*exempt\s*--/;
const LISTINGS = new Set(["DataTable", "OrderQueueTable", "SampleCards", "MasterListShell", "BomQueue"]);
/** Surfaces a listing never lives on — a table under one is not the page's list. */
const NOT_A_PAGE = /(Sheet|Dialog|Modal|Popover|Drawer)$|^MasterFullScreen$/;

// One class token, with any variant prefixes (`md:`, `min-[1250px]:`, `[&_x]:`).
const SHRINK = [
  /^w-(fit|max|min)$/,
  /^inline-(block|flex|grid|table)$/,
  /^w-(\d+(\.5)?|\d+\/\d+|\[(?!100%)[^\]]+\]|(3xs|2xs|xs|sm|md|lg|xl|[2-7]xl))$/,
  /^max-w-(?!full$|none$|\[100%\]$|screen$)\S+$/,
];
const baseOf = (token) => token.replace(/^!/, "").split(":").pop();
/** `[&_td]:max-w-[8rem]` styles the element's DESCENDANTS (one column's cells),
 *  never the wrapper's own width — so an arbitrary-selector variant is skipped.
 *  `min-[1250px]:w-fit` is a breakpoint, not a selector, and still counts. */
const targetsChildren = (token) => token.split(":").slice(0, -1).some((v) => v.startsWith("["));
const shrinkTokens = (cls) =>
  cls.split(/\s+/).filter((t) => t && !targetsChildren(t) && SHRINK.some((re) => re.test(baseOf(t))));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const tagName = (el) => el.tagName.getText();
const attr = (el, name) => el.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);

/** Every string literal in a className expression: "…", `…`, cn("…", x && "…"). */
function classText(a) {
  if (!a || !a.initializer) return "";
  const out = [];
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text);
      n.templateSpans.forEach((s) => out.push(s.literal.text));
    }
    ts.forEachChild(n, visit);
  };
  visit(a.initializer);
  return out.join(" ");
}

/** `paginate={false}` or `bare` — a document table or a dashboard card. */
function notAListing(el) {
  if (attr(el, "bare")) return true;
  const p = attr(el, "paginate");
  return !!p && p.initializer && ts.isJsxExpression(p.initializer) && p.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword;
}

function exemptAbove(lines, line) {
  for (let i = Math.max(0, line - 6); i <= line; i++) if (EXEMPT.test(lines[i] ?? "")) return true;
  return false;
}

const findings = [];
const files = DIRS.flatMap((d) => walk(d));

for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!/<(DataTable|OrderQueueTable|SampleCards|MasterListShell|BomQueue)\b/.test(text)) continue;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = text.split("\n");
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
  const rel = relative(ROOT, file).split(sep).join("/");

  /** `{table}` placements of a variable, in the function that declares it. */
  const placementsOf = (decl) => {
    const name = decl.name.getText();
    let scope = decl.parent;
    while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
    const out = [];
    const find = (n) => {
      if (ts.isJsxExpression(n) && n.expression && ts.isIdentifier(n.expression) && n.expression.text === name) out.push(n);
      ts.forEachChild(n, find);
    };
    if (scope) find(scope);
    return out;
  };

  /** Walk up from `start`; true once a finding is recorded or a stop is reached. */
  const climb = (el, start, seen = new Set()) => {
    for (let p = start.parent; p; p = p.parent) {
      if (ts.isFunctionLike(p)) return; // the component's edge — a caller is checked at its own tag
      // STORED, THEN PLACED: `const table = <DataTable/>; … <div className="w-fit">{table}</div>`
      // (OrderQueueTable did exactly this). Follow the variable to each place it is rendered.
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
        if (seen.has(p)) return;
        seen.add(p);
        for (const use of placementsOf(p)) climb(el, use, seen);
        return;
      }
      if (!ts.isJsxElement(p)) continue;
      const open = p.openingElement;
      const name = tagName(open);
      if (NOT_A_PAGE.test(name)) return;
      if (attr(open, "data-focus-scope")) return;
      const bad = shrinkTokens(classText(attr(open, "className")));
      if (bad.length && !exemptAbove(lines, lineOf(open))) {
        findings.push(`${rel}:${lineOf(open) + 1}  <${name} className> shrinks the <${tagName(el)}> on line ${lineOf(el) + 1}: ${bad.join(" ")}`);
        return;
      }
    }
  };

  const check = (el) => {
    if (!LISTINGS.has(tagName(el)) || notAListing(el)) return;
    if (exemptAbove(lines, lineOf(el))) return;
    // The listing's own JSX node (element or self-closing), then up.
    climb(el, ts.isJsxSelfClosingElement(el) ? el : el.parent);
  };
  const visit = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) check(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// Rule 2 — the primitive keeps the main-listing pager.
const frame = join(ROOT, "components/ui/data-table-frame.tsx");
if (existsSync(frame)) {
  const src = readFileSync(frame, "utf8");
  if (!/function useIsListing\(/.test(src) || !/showBar\s*=\s*paging\s*\|\|\s*listing/.test(src) || !/\{showBar\s*&&/.test(src)) {
    findings.push("components/ui/data-table-frame.tsx  the pager no longer follows `useIsListing` (`showBar = paging || listing`, rendered on `showBar`) — a list that fits one page would lose its pager");
  }
}

if (findings.length) {
  console.error(`check:listing-width — ${findings.length} problem(s). A listing is full width and shows the primitive's pager (AGENTS.md "Pagination"):`);
  for (const f of findings) console.error("  " + f);
  console.error("Drop the shrinking class, or add `listing-width: exempt -- <reason>` above it.");
  process.exit(1);
}
console.log(`check:listing-width — ok: no listing is shrink-wrapped (${files.length} files), and the pager rule is in the primitive.`);
