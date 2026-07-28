"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaginationBar } from "@/components/ui/pagination";
import { usePagination } from "@/lib/use-pagination";
import { atCaretEdge } from "@/lib/focus";
import { cn } from "@/lib/utils";

/**
 * The controls that form a row's navigable axis, in DOM order.
 *
 * `[data-field-trigger]` (a dialog-picker trigger) counts as a field even
 * though it is a <button>: to the operator it IS a column. Leaving it out made
 * Enter mean "down one row" on a text cell but "along to the next cell" on the
 * picker beside it, and left arrow keys dead on pickers entirely — the same
 * split this whole pass exists to remove (client 2026-07-25).
 */
const ROW_FIELDS =
  'input:not([type="button"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, [data-field-trigger]';

/** Enter-on-last-row must not grow a grid that has its "+ Add" hidden (a
 *  Single-Yarn fabric is capped at exactly one component). */
const NO_ADD = () => {};

/** Focus a cell and put the caret at the end, so typing appends rather than
 *  overwrites. number/email inputs reject selection ranges — hence the catch. */
function focusField(el: HTMLElement) {
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* number/email inputs reject selection ranges */
    }
  }
}

/** Direct descendants only — a nested ChildGrid must not steal the outer one's rows. */
function ownDescendants(scope: HTMLElement, selector: string, boundary: string): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.closest(boundary) === scope,
  );
}

/**
 * Excel-like vertical movement inside a child grid (checklist "Better Table
 * Navigation"): Enter / ArrowDown move to the same column one row down; ArrowUp
 * moves up. On Enter in the last row we call `onAdd` and focus the same column
 * in the freshly-added row. Horizontal movement stays on native Tab (and the
 * Sheet's row-major Enter-advance, which this overrides via stopPropagation for
 * the keys it handles). Only fires for text-like inputs, so pickers keep their
 * native Enter (e.g. opening a picker dialog).
 *
 * Deliberately shape-agnostic: rows are found via `data-grid-row` /
 * `data-grid-body` rather than `<tr>`/`<td>`, and a row's "column" is the
 * position of the control among that row's fields. It previously keyed off
 * `closest("td")`, so it silently did nothing outside the table — which is
 * every Material grid, since none of them render one (they pass `inlineCards`;
 * they passed `forceCards` when this was written). That is why arrow keys
 * appeared to work on some screens and not others (client 2026-07-24 #2).
 */
export function gridKeyNav(e: React.KeyboardEvent<HTMLElement>, addRow: () => void) {
  const vertical = e.key === "ArrowDown" || e.key === "ArrowUp";
  const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
  if (e.key !== "Enter" && !vertical && !horizontal) return;
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  // Text-like inputs and picker triggers navigate; native selects and textareas
  // keep their own Enter/arrow meaning (change value / insert newline).
  const isTrigger = el.matches("[data-field-trigger]");
  if (!isTrigger) {
    if (!(el instanceof HTMLInputElement)) return;
    if (/^(button|submit|reset|checkbox|radio)$/.test(el.type)) return;
  }
  // Same rule the Sheet's Enter-advance follows: don't COMMIT out of a field
  // that is currently invalid. gridKeyNav stopPropagations, so without this the
  // validation gate was bypassed inside every grid.
  //
  // Enter only — deliberately NOT arrows. ValidatedInput reveals its message on
  // Enter (validated-input.tsx), so a blocked Enter explains itself; a blocked
  // ArrowDown would just be a dead key with no feedback, and would also kill the
  // native caret-to-start/end that arrows do in a text input.
  if (e.key === "Enter" && el.getAttribute("aria-invalid") === "true") {
    e.preventDefault();
    return;
  }
  // The grid this handler OWNS — not `el.closest("[data-grid-body]")`, which
  // always resolves to the innermost. That distinction is the whole fix: when a
  // nested grid reaches its own boundary it declines the key (no
  // preventDefault) so the event bubbles to the parent's handler — but the
  // parent then re-derived the SAME inner grid from the target, found the same
  // boundary, and returned. A nested grid could never hand off to its parent
  // (client 2026-07-25: ↓ dead-ended on the Attribute values list).
  const body = e.currentTarget;
  const rows = ownDescendants(body, "[data-grid-row]", "[data-grid-body]");
  const row = rows.find((r) => r.contains(el));
  if (!row) return;

  const fieldsIn = (r: HTMLElement) => ownDescendants(r, ROW_FIELDS, "[data-grid-row]");
  // -1 means the target belongs to a NESTED grid inside this row (ownDescendants
  // scopes by nearest marker, so a child grid's fields are correctly not ours).
  // We still handle the key: the child has already declined it, so this is the
  // hand-off — move a whole row and land on its first field.
  const col = fieldsIn(row).indexOf(el);
  const fromChildGrid = col === -1;

  // ←/→ move within the row; only once the caret has nowhere left to go, so
  // typing inside a cell still works. Same rule as lib/focus.ts arrowNavigate.
  if (horizontal) {
    if (fromChildGrid) return;
    const forward = e.key === "ArrowRight";
    if (!atCaretEdge(el, forward ? "next" : "prev")) return;
    const fields = fieldsIn(row);
    const target = fields[forward ? col + 1 : col - 1];
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    focusField(target);
    return;
  }

  const idx = rows.indexOf(row);

  const focusColIn = (target?: HTMLElement) => {
    if (!target) return false;
    const fields = fieldsIn(target);
    // Arriving from a nested grid has no column of its own — land on the first.
    // Otherwise clamp to the last field when the destination row is SHORTER
    // than this one (rows are ragged wherever a cell is conditional), rather
    // than letting `fields[col]` come back undefined.
    const next = fromChildGrid
      ? fields[0]
      : (fields[col] ?? fields[fields.length - 1]);
    if (!next) return false;
    focusField(next);
    return true;
  };

  if (e.key === "ArrowUp") {
    if (idx > 0) {
      e.preventDefault();
      e.stopPropagation();
      focusColIn(rows[idx - 1]);
    }
    return;
  }
  // Enter or ArrowDown
  if (idx < rows.length - 1) {
    e.preventDefault();
    e.stopPropagation();
    focusColIn(rows[idx + 1]);
  } else if (e.key === "Enter") {
    // Last row + Enter → add a new row and land in the same column.
    //
    // Only from a typed field. From a picker trigger this looped: the new row's
    // trigger is again the last row, so a second Enter added another row, and
    // on a picker-ONLY grid (customer Agents / Category / Vendor) Enter had no
    // other meaning — holding it wrote a run of blank child records to the
    // server. Enter on a last-row picker is a no-op; Space still opens it.
    if (isTrigger) return;
    e.preventDefault();
    e.stopPropagation();
    addRow();
    window.setTimeout(() => {
      const fresh = ownDescendants(body, "[data-grid-row]", "[data-grid-body]");
      focusColIn(fresh[fresh.length - 1]);
    }, 30);
  }
}

export interface ChildGridColumn<T> {
  header: string;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  /** Card-mode track width, e.g. "6rem" for a percentage or "auto" to hug.
   *  Omit to flex and take the remaining space (the picker/name column). */
  width?: string;
}

/**
 * Reusable "repeating line items" editor for masters child grids (mixing
 * lines, attribute values, coordinates, description lines, sub-categories,
 * etc.) — a real table on desktop (`md:` and up), a stacked-card list on
 * mobile, a numbered `#` column, a per-row remove button, and a configurable
 * "+ Add {label}" button. Generalizes the desktop-table/mobile-card pattern
 * first built (four times) in `material-master-screen.tsx`.
 */
export function ChildGrid<T extends { key: string }>({
  label,
  badge,
  columns,
  rows,
  onAdd,
  onRemove,
  addLabel = "+ Add row",
  renderMobileRow,
  pageSize,
  forceCards = false,
  frameless = false,
  keyboardNav = true,
  hideAdd = false,
  inlineCards = false,
  startIndex = 0,
}: {
  label: ReactNode;
  /** Optional trailing status next to the label, e.g. a "83% of 100%" running-total badge. */
  badge?: ReactNode;
  columns: ChildGridColumn<T>[];
  rows: T[];
  onAdd: () => void;
  onRemove: (row: T) => void;
  addLabel?: string;
  /** Custom mobile-card body per row; falls back to stacking every column's cell if omitted. */
  renderMobileRow?: (row: T, index: number) => ReactNode;
  /** Paginate the rows at N per page with a Prev/Next bar, instead of an inner
   *  scrollbar (client 2026-07-25 — no scroll-in-a-box). The pager self-hides
   *  when everything fits; "+ Add" jumps to the last page. Omit for no paging. */
  pageSize?: number;
  /** Always render the stacked row-cards, never the wide table — for grids
   *  living inside a half-width column (Fabric organized layout 2026-07-23). */
  forceCards?: boolean;
  /** Drop the outer bordered card so the grid can nest INSIDE a DetailSection
   *  (e.g. Attributes (Mixing) under Composition) without a double border. */
  frameless?: boolean;
  /** Excel-like Enter/↑/↓ vertical cell navigation on the desktop table (on by
   *  default). Set false for grids where Enter should keep its native meaning. */
  keyboardNav?: boolean;
  /** Hide the trailing "+ Add" button — for grids capped at a fixed row count
   *  (e.g. Single Yarn fabric = exactly one component). */
  hideAdd?: boolean;
  /** One flex row per record with a single shared header, honouring each
   *  column's `width`. Use instead of `forceCards` for grids of narrow fields
   *  (Mixing %, Shade) that shouldn't stack. Ignores `renderMobileRow`. */
  inlineCards?: boolean;
  /** Offset for the displayed "#" numbers — set to the page offset when the
   *  caller paginates `rows`, so numbering stays global (11, 12… on page 2)
   *  instead of restarting at 1 each page. Defaults to 0. */
  startIndex?: number;
}) {
  const align = { left: "text-left", right: "text-right", center: "text-center" };
  // Optional pagination (no inner scroll). When pageSize is unset we use a huge
  // page so every row lands on a single page (a fixed big number, NOT rows.length
  // — usePagination captures its size once, so a growing grid must not re-page).
  const paginated = !!(pageSize && pageSize > 0);
  const pg = usePagination(rows, paginated ? pageSize! : 1_000_000);
  const offset = (pg.page - 1) * pg.pageSize;
  const view = pg.paged;
  // Add a row, then jump to the (new) last page so the fresh row is visible.
  const handleAdd = () => {
    onAdd();
    if (paginated) pg.setPage(Number.MAX_SAFE_INTEGER);
  };
  const addFn = hideAdd ? NO_ADD : handleAdd;
  /**
   * Three layouts, ONE choice.
   *
   * `forceCards` and `inlineCards` arrived at different times as independent
   * booleans, which made a nonsense combination representable: a caller could
   * ask for the inline rows AND leave the responsive table switched on. The
   * table is only `hidden` BELOW `@lg` (512px of this grid's own inline size),
   * so nothing looked wrong in a narrow column — but at ≥512px both rendered
   * and every row appeared twice, once as a `#`-numbered table row and once as
   * an inline row beneath it. All four Material grids hit exactly that (they
   * were migrated `forceCards` → `inlineCards` and this gate was never
   * updated); it only became visible when the editor surface widened to 1180px
   * and pushed their container past the threshold.
   *
   * Deriving one mode makes that state unrepresentable rather than merely
   * unused. The props stay as they are — they are the public API across ~32
   * screens — but nothing downstream reads them directly any more.
   */
  const mode: "inline" | "cards" | "responsive" = inlineCards
    ? "inline"
    : forceCards
      ? "cards"
      : "responsive";
  return (
    <div className={cn("@container space-y-3", !frameless && "rounded-lg border border-border p-3")}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        {badge}
      </div>

      {/* wide-container table — only in `responsive` mode. The inline layout is
          a REPLACEMENT for this, not a companion to it. */}
      {mode === "responsive" && (
      <div className="hidden overflow-x-auto rounded-lg border border-border @lg:block">
        <table
          className="w-full min-w-[420px] border-collapse text-sm"
        >
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="w-10 px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground">#</th>
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={cn(
                    "border-l border-border px-2 py-1.5 text-xs font-semibold text-muted-foreground",
                    align[c.align ?? "left"],
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
              <th className="w-8 border-l border-border" />
            </tr>
          </thead>
          {/* The handler must sit on the SAME element as `data-grid-body` —
              gridKeyNav takes its grid from `e.currentTarget`. It used to be on
              the <table>, which still worked when the grid was derived from the
              event target, but would now resolve to a node that owns no rows. */}
          <tbody data-grid-body onKeyDown={keyboardNav ? (e) => gridKeyNav(e, addFn) : undefined}>
            {view.map((row, localI) => {
              const i = offset + localI;
              return (
              <tr key={row.key} data-grid-row className="border-b border-border last:border-0">
                <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">{startIndex + i + 1}</td>
                {columns.map((c, ci) => (
                  <td key={ci} className={cn("border-l border-border px-2 py-1.5", align[c.align ?? "left"], c.className)}>
                    {c.cell(row, i)}
                  </td>
                ))}
                <td className="border-l border-border px-1 py-1.5 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => onRemove(row)}
                    aria-label="Remove row"
                  >
                    <X className="h-4 w-4 shrink-0" />
                  </Button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Inline rows — a flex "table" that survives a half-width column, where a
          real <table> would overflow. Each column keeps its own width, so a
          Mixing % stays a small box instead of stretching and shoving the next
          field onto a second line (client 2026-07-24 #4). */}
      {mode === "inline" ? (
        <div
          data-grid-body
          className="space-y-1.5"
          onKeyDown={keyboardNav ? (e) => gridKeyNav(e, addFn) : undefined}
        >
          {view.length > 0 && (
            <div className="flex items-center gap-2 px-2 pb-0.5">
              <span className="w-4 shrink-0" />
              {columns.map((c, ci) => (
                <div
                  key={ci}
                  className={cn(
                    "min-w-0 text-xs font-semibold text-muted-foreground",
                    c.width ? "shrink-0" : "flex-1",
                    align[c.align ?? "left"],
                  )}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {c.header}
                </div>
              ))}
              <span className="w-8 shrink-0" />
            </div>
          )}
          {view.map((row, localI) => {
            const i = offset + localI;
            return (
            <div
              key={row.key}
              data-grid-row
              className="flex items-center gap-2 rounded-md border border-border p-1.5"
            >
              <span className="w-4 shrink-0 text-center text-xs text-muted-foreground">{startIndex + i + 1}</span>
              {columns.map((c, ci) => (
                <div
                  key={ci}
                  className={cn("min-w-0", c.width ? "shrink-0" : "flex-1", c.className)}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {c.cell(row, i)}
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-8 shrink-0 px-0 text-muted-foreground hover:text-danger"
                onClick={() => onRemove(row)}
                aria-label="Remove row"
              >
                <X className="h-4 w-4 shrink-0" />
              </Button>
            </div>
            );
          })}
        </div>
      ) : (
      /* stacked row-cards — the whole grid in `cards` mode, and the narrow half
          of `responsive` mode (hence `@lg:hidden`, the partner to the table's
          `hidden @lg:block`). Carries the same keyboard nav as the table:
          where these ARE the grid, binding nav only to the table left arrow
          keys dead. */
      <div
        data-grid-body
        className={cn("space-y-2", mode === "responsive" && "@lg:hidden")}
        onKeyDown={keyboardNav ? (e) => gridKeyNav(e, addFn) : undefined}
      >
        {view.map((row, localI) => {
          const i = offset + localI;
          return (
          <div key={row.key} data-grid-row className="space-y-2 rounded-lg border border-border p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">#{startIndex + i + 1}</span>
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger" onClick={() => onRemove(row)} aria-label="Remove row">
                <X className="h-4 w-4 shrink-0" />
              </Button>
            </div>
            {renderMobileRow ? renderMobileRow(row, i) : columns.map((c, ci) => <div key={ci}>{c.cell(row, i)}</div>)}
          </div>
          );
        })}
      </div>
      )}

      {paginated && (
        <PaginationBar
          page={pg.page}
          pageCount={pg.pageCount}
          total={pg.total}
          pageSize={pg.pageSize}
          onPageChange={pg.setPage}
        />
      )}

      {!hideAdd && (
        <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
          {addLabel}
        </Button>
      )}
    </div>
  );
}
