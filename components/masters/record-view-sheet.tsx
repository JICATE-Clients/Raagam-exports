"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

/**
 * Read-only record view, shared by every master list (client 2026-07-29).
 *
 * Opening the editor was the only way to look at a record, which meant every
 * "what is this?" carried the risk of saving something — and on the auto-named
 * screens, of re-composing the Name on the way out. A master's list shows a
 * handful of columns; the record behind it routinely holds five times that
 * (Employee is 43 fields behind 6 columns), and none of it was readable without
 * entering an editor.
 *
 * Generalised from `material-view-sheet.tsx`, which proved the shape first and
 * stays bespoke — its Units of Measure block renders conversions through
 * `describeConversion` and its Mixing block resolves component yarns, neither of
 * which is a label→value pair.
 *
 * THERE IS NO EDIT BUTTON, AND `onEdit` IS NOT A PROP (client 2026-07-30). It
 * used to offer one, which quietly made View a second doorway into the editor —
 * so "let me just look at this" and "let me change this" started from the same
 * click and ended in the same place. View is now a dead end by construction:
 * read it, close it, and open the editor from the row's pencil if you meant to
 * change something. The prop is deleted rather than merely left unpassed,
 * because an optional `onEdit` is an invitation to wire it back up.
 *
 * TWO RULES THAT MAKE THIS WORTH USING:
 *
 * 1. **An empty value is not rendered, and an all-empty section disappears.** A
 *    fixed grid of "—" tells the reader less than a short list of what is
 *    actually there, and these records are sparse by nature — a domestic vendor
 *    fills a different third of the form than an export one.
 * 2. **It renders what the list ALREADY holds.** Master lists select the full
 *    row, so there is nothing to fetch here, no loading state to design and no
 *    spinner. If a screen finds itself fetching to populate this, something has
 *    gone wrong upstream.
 *
 * Hosted in `Sheet`, which registers with the reload guard on its own
 * (AGENTS.md), so no `useModalGuard` call is needed at the call site.
 */

/** One label→value row. `value` is a ReactNode so a caller can pass a pill. */
export type ViewPair = readonly [label: string, value: ReactNode];

export type ViewSection = {
  label: string;
  /** Label→value rows. The section hides itself when every value is empty. */
  pairs?: ViewPair[];
  /**
   * Anything that is not a label→value pair — a child grid's rows, a computed
   * summary line. Rendered under `pairs` when both are given. A section with
   * `content` is never auto-hidden: the caller decides, because only it knows
   * whether an empty list is worth saying out loud.
   */
  content?: ReactNode;
};

function isEmpty(v: ReactNode): boolean {
  if (v == null || v === false) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return false;
  return false;
}

/**
 * Rotating section accent, cycling through the app's own status palette
 * (client 2026-09-07: "colorful, professional" — the view sheet read as a
 * flat grey form, section after section with nothing to tell them apart at a
 * glance). Deliberately the SAME five tokens every status pill in the app
 * already uses (`--primary` / `--accent` / `--success` / `--warning` /
 * `--info`), not new hexes — see AGENTS.md "Brand colours": brand goes on
 * controls, never invented fresh for a surface. Five is enough that the
 * common 1–3 section case never repeats a colour, and it wraps rather than
 * growing, so a 43-field record (Employee) never runs out.
 */
const SECTION_ACCENTS = [
  { bar: "bg-primary", chip: "bg-primary-soft text-primary" },
  { bar: "bg-accent", chip: "bg-accent-soft text-accent" },
  { bar: "bg-success", chip: "bg-success-soft text-success" },
  { bar: "bg-warning", chip: "bg-warning-soft text-warning" },
  { bar: "bg-info", chip: "bg-info-soft text-info" },
] as const;

/**
 * The exact strings `lib/record-pairs.ts` `scalar()` hands back for a boolean
 * column — "Yes"/"No" for a plain flag, "Active"/"Inactive"/"Blocked" for the
 * three `STATUS_FLAGS` columns folded onto one "Status" label. Matched by
 * VALUE rather than by key, because by the time it reaches this component the
 * boolean is already gone — `pairsFromRow` only ever hands over strings — and
 * matching the word is exact where guessing at the key would not be (client
 * 2026-09-07: "formatted data … more professional" — a column of plain "No"s
 * read as inert text with nothing to tell a reader which ones matter).
 */
const BOOLEAN_TONE: Record<string, "success" | "neutral" | "danger"> = {
  Yes: "success",
  Active: "success",
  No: "neutral",
  Inactive: "neutral",
  Blocked: "danger",
};

/** A bare number, exactly as `scalar()` stringifies one — never a formatted
 *  date or code, both of which fail this on purpose. */
const NUMERIC_VALUE = /^-?\d+(\.\d+)?$/;

/** Label→value rows. Exported so a bespoke section can reuse the same grid. */
export function ViewPairs({ pairs }: { pairs: readonly ViewPair[] }) {
  const shown = pairs.filter(([, v]) => !isEmpty(v));
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 text-sm">
      {shown.map(([k, v], i) => {
        const last = i === shown.length - 1;
        // Only a plain string value is ever a candidate — a caller-supplied
        // pill (`value` is a `ReactNode`) passes through untouched, so this
        // never double-badges a status a screen already styled itself.
        const tone = typeof v === "string" ? BOOLEAN_TONE[v] : undefined;
        // NUMERIC ALIGNS RIGHT, THE SAME RULE `data-table.tsx` STATES FOR A
        // TABLE COLUMN ("Numerics should use align:right + tabular-nums"):
        // a figure reads as a figure when it lines up with the ones above and
        // below it, not when it starts flush against a text label like prose.
        const numeric = typeof v === "string" && NUMERIC_VALUE.test(v);
        return (
          <div key={k} className="contents">
            {/* Truncated renders spans, so it goes INSIDE the <dt> rather than
                replacing it — the grid places `dt`/`dd` directly (the row div
                is `contents`), and the pair is what makes this a description
                list. The bottom border is set on BOTH `dt` and `dd` — a
                `contents` row has no box of its own to hang a divider on, so
                each cell draws its own half of the same line. */}
            <dt
              className={cn(
                "min-w-0 py-1.5 text-muted-foreground",
                !last && "border-b border-border/60",
              )}
            >
              <Truncated text={k} />
            </dt>
            <dd
              className={cn(
                "min-w-0 break-words py-1.5 text-foreground",
                tone ? "py-1" : "font-medium",
                numeric && "text-right font-mono tabular-nums",
                !last && "border-b border-border/60",
              )}
            >
              {tone ? <StatusPill tone={tone}>{v}</StatusPill> : v}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function RecordViewSheet({
  open,
  onClose,
  title,
  subtitle,
  status,
  sections,
}: {
  open: boolean;
  onClose: () => void;
  /** The record's name — the one thing always shown. */
  title: string;
  /** Muted line under the title: a code, a country, a parent record. */
  subtitle?: ReactNode;
  /** Right of the title — typically a StatusPill. */
  status?: ReactNode;
  sections: ViewSection[];
}) {
  // Sections with nothing in them are dropped before layout, so the two columns
  // below balance on what is actually there rather than on what was declared.
  const shown = sections.filter(
    (s) => s.content != null || (s.pairs ?? []).some(([, v]) => !isEmpty(v)),
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      fullScreen
      title={title}
      footer={
        <Button variant="outline" size="md" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {/* A banded header, not a bare heading — the record's initial in a
            coloured bubble is what used to be missing: the sheet opened on a
            page of grey text with nothing to anchor the eye before reading
            started. */}
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted/60 p-3">
          <div className="flex min-w-0 items-start gap-3">
            <div
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-base font-bold text-primary"
            >
              {title.trim().charAt(0).toUpperCase() || "?"}
            </div>
            <div className="min-w-0 pt-0.5">
              <h3 className="min-w-0 text-lg font-semibold text-foreground">
                <Truncated text={title} />
              </h3>
              {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          {status}
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-muted/40 px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">This record has no details filled in yet.</p>
          </div>
        ) : (
          /* Two columns on a wide editor, one below it. Sections flow down the
             pair rather than being split evenly, so a long section does not drag
             a short one down with it. */
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {shown.map((s, i) => {
              const accent = SECTION_ACCENTS[i % SECTION_ACCENTS.length];
              return (
                <div
                  key={s.label}
                  className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
                >
                  {/* The accent bar is the thing that makes sections tell apart
                      at a glance without reading a word — a colour a reader can
                      scan for, the way a filing cabinet uses coloured tabs. */}
                  <div aria-hidden className={cn("h-1", accent.bar)} />
                  <div className="space-y-2.5 p-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[.06em]",
                        accent.chip,
                      )}
                    >
                      {s.label}
                    </span>
                    {s.pairs && <ViewPairs pairs={s.pairs} />}
                    {s.content}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
