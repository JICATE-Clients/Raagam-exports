"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { Sheet } from "@/components/ui/sheet";
import { DetailSection } from "@/components/masters/detail-section";

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

/** Label→value rows. Exported so a bespoke section can reuse the same grid. */
export function ViewPairs({ pairs }: { pairs: readonly ViewPair[] }) {
  const shown = pairs.filter(([, v]) => !isEmpty(v));
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          {/* Truncated renders spans, so it goes INSIDE the <dt> rather than
              replacing it — the grid places `dt`/`dd` directly (the row div is
              `contents`), and the pair is what makes this a description list. */}
          <dt className="min-w-0 text-muted-foreground">
            <Truncated text={k} />
          </dt>
          <dd className="min-w-0 break-words text-foreground">{v}</dd>
        </div>
      ))}
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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="min-w-0 text-lg font-semibold text-foreground">
              <Truncated text={title} />
            </h3>
            {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {status}
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">This record has no details filled in yet.</p>
        ) : (
          /* Two columns on a wide editor, one below it. Sections flow down the
             pair rather than being split evenly, so a long section does not drag
             a short one down with it. */
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {shown.map((s) => (
              <DetailSection key={s.label} label={s.label}>
                {s.pairs && <ViewPairs pairs={s.pairs} />}
                {s.content}
              </DetailSection>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
