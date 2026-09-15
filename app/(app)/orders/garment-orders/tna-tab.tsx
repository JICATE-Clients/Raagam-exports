"use client";

/**
 * ORDERS ▸ GARMENT ORDERS ▸ **T&A LADDER** — the read-only tracking view.
 *
 * ## WHAT THIS IS NOT
 *
 * It is NOT a second T&A ladder. `garment-order-screen.tsx` already renders the
 * EDITABLE one — a `ChildGrid` seeded from the `ta_activities` master, whose
 * Target Date column comes out of `orderTaLadder()` on every keystroke — and
 * that is where a ladder is typed. This is the view beside it: the counts, the
 * slipped rungs and the dates, for someone who is reading the order rather than
 * building it. It shares that screen's vocabulary rather than starting a new one
 * (`lib/orders/ta/tna-types.ts`), which is the whole reason the types went into
 * `lib/orders/ta/` beside `order-ladder.ts`.
 *
 * ## THE ROWS ARE PLACEHOLDERS AND THE SCREEN SAYS SO
 *
 * `DEMO_LADDER` below is example data, marked as such on screen. It is here so
 * the layout can be reviewed before the read side exists; it is NOT a fallback.
 * When the loader arrives, pass `milestones` and the demo rows stop being
 * reachable — see the prop's own note. Never let dummy rows become the
 * no-data branch: an empty ladder is a real answer and must look like one.
 *
 * ## `today` IS RESOLVED ONCE, HERE
 *
 * Both halves of the tab judge lateness, and they have to agree. `today()`
 * (lib/calendar.ts) is pinned to Asia/Kolkata — the factory's date, not the
 * machine's — so this is stable across a server render and the browser.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TnaDataGrid } from "@/components/orders/tna-data-grid";
import { TnaSummary } from "@/components/orders/tna-summary";
import { today } from "@/lib/calendar";
import { tnaSummary, type TnaMilestone } from "@/lib/orders/ta/tna-types";

/**
 * EXAMPLE ROWS — the ten activities in EXECUTION order, which is the order
 * `order-ladder.ts` says the grid renders (Fabric Plan → Shipment) and the
 * reverse of the order the arithmetic runs in. Nothing here re-reverses;
 * that file does it on the way in and back on the way out, and its header is
 * explicit that "a list that has to be reversed before use is a list that will
 * be reversed twice by someone".
 *
 * The dates are consistent with the rule they illustrate: targets increase
 * toward the ship date, a rung is late only when its target has gone by with no
 * actual, and no rung is undated — the backward walk stops at the first rung
 * with no Days, so a hole here would have to null out every rung before it.
 */
const DEMO_LADDER: TnaMilestone[] = [
  {
    rowUid: "demo-01",
    activityId: null,
    activity: "Fabric Plan",
    departmentName: "Merchandising",
    assignedStaffName: "R. KAVITHA",
    daysRequired: 3,
    targetDate: "2026-08-14",
    actualDate: "2026-08-13",
    status: "done",
    notes: null,
  },
  {
    rowUid: "demo-02",
    activityId: null,
    activity: "Accessories BOM",
    departmentName: "Merchandising",
    assignedStaffName: "R. KAVITHA",
    daysRequired: 4,
    targetDate: "2026-08-20",
    actualDate: "2026-08-21",
    status: "done",
    notes: null,
  },
  {
    rowUid: "demo-03",
    activityId: null,
    activity: "Yarn Purchase",
    departmentName: "Purchase",
    assignedStaffName: "S. MURUGAN",
    daysRequired: 5,
    targetDate: "2026-08-27",
    actualDate: "2026-08-27",
    status: "done",
    notes: null,
  },
  {
    rowUid: "demo-04",
    activityId: null,
    activity: "Knitting",
    departmentName: "Knitting",
    assignedStaffName: "A. SELVAM",
    daysRequired: 8,
    targetDate: "2026-09-05",
    actualDate: "2026-09-08",
    status: "done",
    notes: null,
  },
  {
    /* IN PROGRESS *AND* PAST ITS TARGET — the case the derivation exists for.
       The stored status is `in_progress`; the badge reads Delayed, because
       lateness is a fact about the calendar and not a value anyone sets. */
    rowUid: "demo-05",
    activityId: null,
    activity: "Dyeing",
    departmentName: "Dyeing",
    assignedStaffName: "P. VIJAY",
    daysRequired: 6,
    targetDate: "2026-09-09",
    actualDate: null,
    status: "in_progress",
    notes: null,
  },
  {
    rowUid: "demo-06",
    activityId: null,
    activity: "Cutting",
    departmentName: "Cutting",
    assignedStaffName: "M. ARUN",
    daysRequired: 4,
    targetDate: "2026-09-11",
    actualDate: null,
    status: "pending",
    notes: null,
  },
  {
    rowUid: "demo-07",
    activityId: null,
    activity: "Sewing",
    departmentName: "Sewing",
    assignedStaffName: "K. LAKSHMI",
    daysRequired: 10,
    targetDate: "2026-09-22",
    actualDate: null,
    status: "in_progress",
    notes: null,
  },
  {
    /* NO OWNER IS A REAL STATE, not a gap — an unclaimed rung belongs to every
       eligible member of its department (0547). */
    rowUid: "demo-08",
    activityId: null,
    activity: "Packing",
    departmentName: "Packing",
    assignedStaffName: null,
    daysRequired: 3,
    targetDate: "2026-09-26",
    actualDate: null,
    status: "pending",
    notes: null,
  },
  {
    rowUid: "demo-09",
    activityId: null,
    activity: "Inspection",
    departmentName: "Quality",
    assignedStaffName: "D. RAMESH",
    daysRequired: 2,
    targetDate: "2026-09-29",
    actualDate: null,
    status: "pending",
    notes: null,
  },
  {
    rowUid: "demo-10",
    activityId: null,
    activity: "Shipment",
    departmentName: "Logistics",
    assignedStaffName: null,
    daysRequired: 1,
    targetDate: "2026-09-30",
    actualDate: null,
    status: "pending",
    notes: null,
  },
];

export function TnaTab({
  /**
   * The order's rungs, IN LADDER ORDER. Row order is part of the contract:
   * `order-ladder.ts` zips its dates back on by POSITION, so a permuted list is
   * still a well-formed list whose every date attaches to the wrong activity.
   * Hand them over as `ta_activities.sequence` gives them.
   *
   * Omitted → the example ladder, and the banner that says it is one.
   */
  milestones,
  /**
   * What the ladder hangs off, stated on screen. `TaLadderAnchor`'s own note
   * gives the reason: "a ladder shown without saying what it hangs off is a
   * plan the operator cannot check". Omitted → the line is not drawn, rather
   * than drawn with a guess in it.
   */
  anchorLabel,
  anchorDate,
  /**
   * Lay the ladder out from a template. Omitted → the button still renders and
   * still explains itself, it just refuses: `aria-disabled`, never `disabled`,
   * which is this app's standing treatment for a blocked action (see
   * `SubSheetFooter`). A truly disabled button stops firing pointer events, so
   * its `title` never surfaces and the operator is left with a grey control and
   * no reason — the silent refusal AGENTS.md rules out.
   */
  onApplyTemplate,
}: {
  milestones?: readonly TnaMilestone[];
  anchorLabel?: string;
  anchorDate?: string | null;
  onApplyTemplate?: () => void;
} = {}) {
  /* Resolved once per mount, not per render: the tab must not change its mind
     about what "late" means while the operator is reading it. */
  const [todayIso] = useState(today);

  const isDemo = milestones === undefined;
  const rows = milestones ?? DEMO_LADDER;
  const stats = tnaSummary(rows, todayIso);
  const templateBlocked = !onApplyTemplate;
  const blockedReason = "Templates aren't wired to this tab yet";

  return (
    <div className="space-y-4">
      {/* SAID ONCE, AT THE TOP, AND ONLY WHILE IT IS TRUE. A screen showing
          invented rows that does not say so is worse than an empty one — the
          numbers look like this order's numbers. */}
      {isDemo && (
        <p className="rounded-lg border border-dashed border-border-strong px-3.5 py-2.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">UI preview.</span> Example ladder, not
          live data — these rungs stand in for the order&apos;s own until this tab is wired to
          its T&amp;A activities.
        </p>
      )}

      {/* THE HEADER ROW. `size="md"` is the Button default and is what the band
          above a list takes (AGENTS.md, "The header row") — the row's fixed
          element is a 36px control, so a `sm` button here would sit 4px short of
          every other screen's. `items-end` keeps the button on the baseline of
          the title block rather than floating beside its description. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Time &amp; Action ladder</h2>
          <p className="mt-0.5 max-w-[62ch] text-xs text-muted-foreground">
            Target dates are computed backwards over working days, skipping Sundays and the
            factory holiday set. A rung with no Days shows — rather than a guessed date.
            {anchorLabel && anchorDate && (
              <>
                {" "}
                Hangs off <span className="font-medium text-foreground">{anchorLabel}</span>.
              </>
            )}
          </p>
        </div>
        <Button
          size="md"
          aria-disabled={templateBlocked || undefined}
          aria-label={templateBlocked ? `Apply Template — ${blockedReason}` : undefined}
          title={templateBlocked ? blockedReason : undefined}
          className={templateBlocked ? "cursor-not-allowed opacity-60" : undefined}
          onClick={() => onApplyTemplate?.()}
        >
          Apply Template
        </Button>
      </div>

      <TnaSummary stats={stats} />

      <TnaDataGrid rows={rows} today={todayIso} />

      {/* The rule, beside the thing it governs. AGENTS.md's 2026-08-20 finding
          is that a rule stated several inches from where it applies is a rule
          the operator meets at Save — and the arithmetic here is exactly the
          kind a reader wants to check against the cards above. */}
      <p className="text-xs text-muted-foreground">
        Delayed is derived, never stored: open past its target, counted in calendar days so a
        slip across a weekend earns no grace. Completed means an actual date or a signed-off
        status — either half counts. Completed + Delayed + Upcoming always equals Total.
      </p>
    </div>
  );
}
