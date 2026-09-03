"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { GRID_HEADER_TEXT, gridKeyNav } from "@/components/masters/child-grid";
import { cn } from "@/lib/utils";

/**
 * A LIST OF SUBJECTS, EACH OPENING ONTO ITS OWN GRID — legacy's `[+]` row.
 *
 * Client, 2026-09-03, screenshots 2652 (YarnProcess) and 2653 (FabricProcess):
 * "list the yarn — if the yarn is clicked show the S No / Stage / Process / For
 * / Descriptions / Loss %", and the same shape again for the fabric. Legacy
 * draws an outer "Yarn Detail" / "Fabric Detail" grid whose rows carry a `[+]`,
 * and unfolds the treatment grid UNDER the row that was clicked.
 *
 * ## WHY THIS EXISTS RATHER THAN A `ChildGrid` PROP
 *
 * `ChildGrid` cannot draw a panel beneath a row, and the reason is structural
 * rather than missing work:
 *
 *  - **Its table layout is a real `<table>`.** A panel spanning the row has to
 *    be a SECOND `<tr>`, which then falls outside the first one's
 *    `data-grid-row` — and `tabFieldsIn` (child-grid.tsx) resolves a row's Tab
 *    axis by querying INSIDE that element. A panel outside it is invisible to
 *    Tab, which is precisely the defect of 2026-08-05: a Material Attribute's
 *    values were reachable with the mouse alone.
 *  - **Its inline layout is a `flex` row**, so a block under the cells would
 *    need every existing inline caller's row to become a column.
 *
 * So the panel is rendered INSIDE `data-grid-row`, and the whole keyboard
 * contract follows from that one fact: `tabFieldsIn` walks the row's chevron and
 * then the panel's fields, `gridKeyNav` on `data-grid-body` gives the arrows and
 * Ctrl+Del, and `enterShutFold` (child-grid.tsx) recognises the chevron by
 * `data-row-open` + `aria-expanded`.
 *
 * ## ONE COMPONENT, TWO TABS
 *
 * Yarn Process and Fabric Process ask the identical question — a subject, its
 * summary, and a route grid under it — and the alternative was two hand-rolled
 * accordions. AGENTS.md records what a per-screen answer to a contract-level
 * shape costs (~22 hand-rolled grid rows, and one keyboard rule fixed twice).
 * `bom-slice-grid.tsx` is the precedent for the shape itself: a `div` grid
 * carrying `data-grid-body` / `data-grid-row` / `data-row-open`, keyed by
 * `gridKeyNav`.
 *
 * ## IT OWNS NO ROWS AND NO OPEN STATE
 *
 * `openKey` is the caller's, like `bom-slice-grid`'s `openGroup`. The screen
 * already holds the rows these panels edit, and an accordion whose state lived
 * here could not be pointed at a row by anything else.
 *
 * ## THE SUMMARY CELLS ARE READ-ONLY BY CONSTRUCTION
 *
 * Every column here is a derived description of the subject — the fabric's name,
 * its knit family, the colourways it serves. The one focusable thing in the row
 * is the chevron, which is what makes the responsive pair below free: the narrow
 * layout is a second rendering of the SAME text, and a hidden twin with no
 * fields in it cannot confuse Tab. (`ChildGrid` needs `renderMobileRow` for the
 * opposite reason — its cells are controls.)
 */

export interface FoldListColumn<T> {
  /** The legacy header, word for word. */
  header: string;
  /**
   * What the stacked layout labels this cell, when `header` is not enough on its
   * own. Legacy's Fabric Detail row carries **two** columns headed "Type" — the
   * knit family and the roll form — which is unambiguous under a header band and
   * meaningless as two identical labels in a stack.
   */
  cardLabel?: string;
  /** Track width, e.g. "8rem". Omit to take the remaining space. */
  width?: string;
  align?: "left" | "right";
  cell: (row: T, index: number) => ReactNode;
}

export function ProcessFoldList<T extends { key: string }>({
  columns,
  rows,
  openKey,
  onToggle,
  foldHeader,
  foldSummary,
  renderPanel,
  startIndex = 0,
}: {
  columns: FoldListColumn<T>[];
  rows: T[];
  /** Which row is unfolded. `null` — the mount state — is all of them shut. */
  openKey: string | null;
  /** Fires with the row's key, or `null` when the open row is clicked again. */
  onToggle: (key: string | null) => void;
  /** The last column's header — "Treatments", "Process". */
  foldHeader: string;
  /** One line naming what is inside: "2 steps", "no route yet". */
  foldSummary: (row: T) => string;
  renderPanel: (row: T, index: number) => ReactNode;
  startIndex?: number;
}) {
  return (
    /* `@container` FOR THE SAME REASON `ChildGrid` PUTS ONE AT ITS ROOT: the
       aligned-vs-stacked choice must be measured against the space this list
       actually has, not against the viewport. Any narrower and it would measure
       a row instead. */
    <div className="@container">
      <div className="overflow-hidden rounded-lg border border-border">
        {/* THE HEADER BAND, and it is only drawn where the cells line up under
            it. Stacked, each value carries its own label — a band over a column
            of wrapped pairs would be a heading for nothing. */}
        <div
          className={cn(
            "hidden items-center gap-2 border-b border-border px-2 py-1.5 @4xl:flex",
            GRID_HEADER_TEXT,
          )}
        >
          {/* `S No` — legacy's own first column, and the one thing the client
              named that this list did not have. `w-8`, matching the row. */}
          <span className="w-8 shrink-0 text-center">S No</span>
          {columns.map((c, ci) => (
            <span
              key={ci}
              className={cn(
                "min-w-0",
                c.width ? "shrink-0" : "flex-1",
                c.align === "right" ? "text-right" : "text-left",
              )}
              style={c.width ? { width: c.width } : undefined}
            >
              {c.header}
            </span>
          ))}
          <span className="w-28 shrink-0 text-left">{foldHeader}</span>
        </div>

        {/* `data-grid-body` + `data-grid-row` ARE THE WHOLE KEYBOARD — see the
            header. `gridKeyNav` is bound here, on the element that owns the
            rows, exactly as `ChildGrid` binds it to its `<tbody>`. */}
        <div data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
          {rows.map((row, i) => {
            const open = row.key === openKey;
            return (
              <div
                key={row.key}
                data-grid-row
                className="border-b border-border last:border-b-0"
              >
                <div
                  className={cn(
                    "flex items-start gap-2 px-2 py-1",
                    /* FULL STRENGTH, NEVER `/60`. `--surface-muted` is
                       `#f0f8e5`; 60% of it over white is not a state change, and
                       `globals.css` already records the same trap for row
                       hovers. An open row with no marker but the panel itself is
                       what "which one did I click" looks like. */
                    open ? "bg-surface-muted" : "hover:bg-surface-muted",
                  )}
                  /* THE WHOLE LINE IS THE TARGET, because the chevron is a poor
                     one and the summary is the thing being pointed at.

                     `[data-row-remove]`, NOT `closest("button")`. That guard was
                     written for a row's own ✕ and sweeps in `FieldAffordance`'s
                     clear ✕ — a real `<button>` on every filled picker — which
                     is how the Colourways accordion stopped opening on
                     2026-09-03. There is no picker in these cells today; the
                     marker is what keeps that true if one arrives. */
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-row-remove]")) return;
                    onToggle(open ? null : row.key);
                  }}
                >
                  <span className="flex min-h-7 w-8 shrink-0 items-center justify-center text-xs text-muted-foreground">
                    {startIndex + i + 1}
                  </span>

                  {/* ALIGNED — the columns line up across every subject, which is
                      the half of the request that says "alignment". */}
                  <div className="hidden min-w-0 flex-1 items-start gap-2 @4xl:flex">
                    {columns.map((c, ci) => (
                      <div
                        key={ci}
                        className={cn(
                          "flex min-h-7 min-w-0 flex-col justify-center",
                          c.width ? "shrink-0" : "flex-1",
                          c.align === "right" ? "text-right" : "text-left",
                        )}
                        style={c.width ? { width: c.width } : undefined}
                      >
                        {c.cell(row, i)}
                      </div>
                    ))}
                  </div>

                  {/* STACKED — the same values, each under its own name. It
                      wraps; it never scrolls sideways (the operator's rule 4). */}
                  <div className="min-w-0 flex-1 space-y-0.5 @4xl:hidden">
                    {columns.map((c, ci) => (
                      <div key={ci} className="flex min-w-0 items-baseline gap-1.5">
                        <span className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {c.cardLabel ?? c.header}
                        </span>
                        <div className="min-w-0 flex-1">{c.cell(row, i)}</div>
                      </div>
                    ))}
                  </div>

                  {/* THE FOLD. `data-row-open` is what puts it on the Tab path
                      (`ROW_FIELDS` counts the marker) and what `enterShutFold`
                      steers by; `aria-expanded` is both the screen reader's
                      answer and that function's shut/open test.

                      NO `onFocus` HANDLER. The Colourways accordion opens on
                      focus and therefore cannot mount closed inside
                      `MasterFullScreen`, whose `land()` focuses the section's
                      first field ~60ms in. Opening is a deliberate act here —
                      a click, or Enter on the button, which needs no code
                      (`enterAdvances` stands down on a button). */}
                  <button
                    type="button"
                    data-row-open
                    aria-expanded={open}
                    onClick={(e) => {
                      /* The line's own handler would toggle it straight back. */
                      e.stopPropagation();
                      onToggle(open ? null : row.key);
                    }}
                    className="flex min-h-7 w-28 shrink-0 items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
                  >
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {/* truncate-reveal: exempt -- a generated count from a closed
                        vocabulary ("2 steps", "No route yet"), not a stored
                        value. It cannot be long enough to clip at the declared
                        width, and a hover bubble repeating chrome is noise. */}
                    <span className="min-w-0 truncate">{foldSummary(row)}</span>
                  </button>
                </div>

                {/* INSIDE THE ROW — see the header. Indented past the S No track
                    so the panel reads as belonging to the line above it, which is
                    how legacy draws the unfolded grid.

                    THE INDENT IS A WIDTH BUDGET, NOT A MARGIN (client 2026-09-03,
                    "check the field size"). Every pixel here comes off the route
                    grid's container, and that container decides whether the grid
                    is a TABLE or a stack of full-width labelled boxes — see
                    `tableFrom` in `fabric-process-grid.tsx`. `pl-9` + `px-1.5`
                    costs 48px; `pl-10` + `px-2` cost 56, and the difference is
                    real on a 1536px screen. Do not widen it for looks. */}
                {open && (
                  <div className="border-t border-border bg-surface px-1.5 pb-2 pt-1.5 @4xl:pl-9">
                    {renderPanel(row, i)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
