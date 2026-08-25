/**
 * THE PRINT STYLESHEET FOR THE GARMENT ORDER SHEET.
 *
 * A raw `<style>` rather than a Tailwind class soup or an edit to
 * `app/globals.css`. Two reasons, and the first is the one that matters:
 * @page, break-before and the ancestor selectors below cannot be written as
 * utility classes at all, and every rule here is scoped to `.doc-sheet`, so
 * shipping it beside the component keeps the whole print contract in one file
 * instead of half of it in a global nobody reads.
 *
 * ## WHY PRINTING INSIDE THE APP SHELL NEEDS HELP
 *
 * `app/(app)/layout.tsx` wraps every page in `<div class="flex h-screen
 * overflow-hidden">` with `<main class="flex-1 overflow-y-auto">` inside it.
 * Both are correct for an app and fatal for a document: `h-screen` in print is
 * ONE PAGE TALL, and an `overflow` that is not `visible` CLIPS rather than
 * paginating. A ten-page order sheet would come out as page one and nothing
 * else — and it would look deliberate.
 *
 * `app/globals.css` then adds a second problem. Its report-printing block sets
 * `body * { visibility: hidden }` unconditionally and re-reveals only
 * `.report-print-area`, so ANY other page in this app currently prints blank —
 * including the logistics document pages, which were written before that rule
 * existed and still carry `print:hidden` toolbars as if they were the only
 * defence needed. That is a real bug in a shipped feature and it is reported
 * rather than fixed here (globals.css is outside this lane).
 *
 * ## THE SHELL IS SELECTED BY RELATION, NEVER BY NAME
 *
 * The rules below say "everything that is not on the path to the sheet", using
 * `:has()`. Nothing here names `aside`, `header`, the sidebar's classes or the
 * mobile nav, so a shell that grows a new fixed element, or renames one, cannot
 * put it on the page. A hand-listed set of chrome selectors is a list that goes
 * stale silently — the printed sheet is the only place the staleness shows, and
 * by then it is on paper.
 *
 * `:has()` is Chrome 105+ / Safari 15.4+ / Firefox 121+. This is an internal
 * ERP printed from a desktop browser; there is no supported browser here
 * without it.
 */
/**
 * ONE STYLESHEET, ONE PER DOCUMENT SCOPE.
 *
 * The rules below are authored against a neutral `.doc-` prefix and rewritten to
 * the caller's scope, so the Garment Order Sheet and the Accessories Requirement
 * share one contract instead of two copies drifting apart. Everything that was
 * hard-won here — undoing the shell's `h-screen`, releasing `overflow`,
 * re-revealing past globals.css's blanket hide — is the same problem for every
 * printed document in this app, and solving it twice is how one of them silently
 * stops paginating.
 *
 * `scope` is the class the document's root carries: `gos` -> `.gos-sheet`,
 * `req` -> `.req-sheet`.
 */
export function DocumentPrintStyles({ scope = "gos" }: { scope?: string }) {
  const css = CSS.replaceAll(".doc-", `.${scope}-`);
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

const CSS = `
/*
 * THE SHEET IS PAPER IN BOTH THEMES.
 *
 * Deliberately NOT theme-aware, which is a break from every other surface in
 * this app. It is a preview of a physical document: a dark-theme operator who
 * sees a dark sheet on screen and a white one out of the printer is looking at
 * two different documents, and the ink-saving greys below only read correctly
 * against white. The chrome around it (toolbar, page background) stays on the
 * theme tokens, so the app still looks like itself.
 */
.doc-sheet {
  background: #ffffff;
  color: #111827;
  --gos-rule: #d4d4d8;
  --gos-rule-strong: #52525b;
  --gos-muted: #52525b;
  --gos-fill: #f4f4f5;
  /* The greys are structure, not decoration — a matrix with no banding is
     unreadable at 9pt. Browsers drop background graphics from print by
     default, so say explicitly that these must survive. */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.doc-sheet table { border-collapse: collapse; width: 100%; }
.doc-sheet th, .doc-sheet td {
  border: 1px solid var(--gos-rule);
  padding: 3px 6px;
  vertical-align: top;
}
.doc-sheet thead th {
  background: var(--gos-fill);
  font-weight: 600;
  text-align: left; /* color-token: exempt -- a CSS declaration inside a stylesheet, not a Tailwind utility class */
  white-space: nowrap;
}
.doc-sheet tfoot td { background: var(--gos-fill); font-weight: 700; }
.doc-num { text-align: right; font-variant-numeric: tabular-nums; } /* color-token: exempt -- a CSS declaration inside a stylesheet, not a Tailwind utility class */

/* A wide matrix scrolls INSIDE its own box on screen; the page body never
   scrolls sideways. In print it is released — see the print block. */
.doc-scroll { overflow-x: auto; }

@page { size: A4 portrait; margin: 10mm; }

@media print {
  html {
    height: auto !important;
    overflow: visible !important;
    background: #fff !important;
  }

  /*
   * 1. Anything that is not the sheet and not on the path to it is not part of
   *    this document. Sidebar, topbar, mobile nav, install prompt, bug
   *    reporter, the page's own toolbar — none of them named.
   */
  :is(body:has(.doc-sheet), body:has(.doc-sheet) *:has(.doc-sheet))
    > *:not(:has(.doc-sheet)):not(.doc-sheet) {
    display: none !important;
  }

  /*
   * 2. Every ancestor of the sheet becomes a plain block of its natural
   *    height. This is what undoes 'h-screen' and 'overflow-y-auto', and it is
   *    the difference between a sheet that paginates and a sheet that stops at
   *    the bottom of page one.
   */
  :is(body:has(.doc-sheet), body:has(.doc-sheet) *:has(.doc-sheet)) {
    display: block !important;
    position: static !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    width: auto !important;
    max-width: none !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: #fff !important;
  }

  /*
   * 3. globals.css hides everything in print to isolate a REPORT
   *    ('body * { visibility: hidden }') and re-reveals only
   *    '.report-print-area'. Re-reveal this sheet the same way rather than
   *    borrowing that class, whose companion rule pins it 'position: absolute'
   *    — which is exactly what stops a long document from paginating.
   */
  .doc-sheet, .doc-sheet * { visibility: visible !important; }

  .doc-sheet {
    box-shadow: none !important;
    border: 0 !important;
    border-radius: 0 !important; /* color-token: exempt -- a CSS declaration inside a stylesheet, not a Tailwind utility class */
    padding: 0 !important;
    font-size: 9pt;
    line-height: 1.35;
  }

  /* A table released from its scroll box: in print there is nowhere to scroll
     to, so a clipped column is a column nobody ever sees. */
  .doc-scroll { overflow: visible !important; }

  /* One style per sheet. A style split across a fold is two half-directives. */
  .doc-style + .doc-style { break-before: page; }
  .doc-keep { break-inside: avoid; }
  .doc-sheet tr { break-inside: avoid; }
  /* A table that does span a fold repeats its own headings, or page two is a
     grid of numbers with no size above them. */
  .doc-sheet thead { display: table-header-group; }
  .doc-sheet tfoot { display: table-footer-group; }
}
`;
