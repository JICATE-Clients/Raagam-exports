"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  RotateCcw,
  UserRound,
  UserRoundX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { acquireBusy } from "@/lib/reload-guard";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/ui/tone";
import {
  assignTaActivity,
  completeTaActivity,
  reopenTaActivity,
  startTaActivity,
} from "@/lib/ta/worklist-actions";
import type { WorklistRow } from "@/lib/ta/worklist";

/**
 * The worklist's rows. Client-side only because completing an activity is a
 * button, not a form — everything else on this screen is a server component.
 *
 * ## THE ROW IS AN INSTRUCTION, NOT A TABLE CELL
 *
 * A `DataTable` was the obvious choice and is the wrong one. The client's own
 * example of a good line is *"Today you must receive 500 kgs of Yarn for Order
 * Ref 12"* — a quantity, a material and an order reference in one readable
 * sentence — and that does not survive being cut into six columns, three of
 * which are empty on most rows. Legacy T&A already showed an activity name and a
 * date in a grid, and that is exactly the screen nobody read.
 *
 * ## No fields, therefore no keyboard-contract surface
 *
 * There is nothing typable here: Done, Start and Undo are buttons, the
 * completion date is `today()` on the server. So the mandatory-field hold, the
 * duplicate hold, `cycleTab` and the grid axes have nothing to act on and this
 * screen inherits native tab order like any other list page — which is what
 * `isEditorScope` in `lib/focus.ts` intends for a page that is not an editor.
 *
 * ## `acquireBusy()` AND NOT `useUnsavedGuard`, DELIBERATELY
 *
 * The reload guard has to be declared — a silent auto-update landing mid-action
 * loses the toast and leaves the operator unsure whether their completion
 * committed (AGENTS.md, "Auto-reload guard"). But `useUnsavedGuard` does TWO
 * things: it blocks the reload *and* it increments `dirtyCount`, which is what
 * makes Escape ask "discard unsaved changes?". There is no half-typed work on
 * this screen to discard, so that second half would put a false confirm in front
 * of an operator during a 200 ms button press — and a prompt that is wrong
 * sometimes is a prompt that gets dismissed unread every time.
 *
 * `acquireBusy()` is the busy half on its own, exported for exactly this, and it
 * is also the honest answer to `--check tab-page-form`: that check reads
 * `useUnsavedGuard` as the codebase's own statement that a surface is an editor,
 * which is right everywhere it fires and wrong here. Adding `data-focus-scope`
 * to quiet it would have been actively harmful — `isEditorScope` would then
 * claim Tab, `cycleTab` moves between FIELDS, and this screen has none, so the
 * three buttons that are its entire purpose would stop being reachable from the
 * keyboard. That is the "removing a grid's blank row removes the keyboard's only
 * way in" lesson in a new place.
 */

/**
 * The row's bucket, shared by the left accent bar and `SlipPill` so the two
 * never disagree (2026-09-10 redesign — see the file's own header for the
 * "too confusing" complaint this answers). One function, read twice, instead
 * of the border and the pill each re-deriving "is this late" their own way.
 */
function rowTone(row: WorklistRow): StatusTone {
  if (row.daysLate > 0) {
    if (row.bypassInProgress) return "info";
    return row.escalated ? "danger" : "warning";
  }
  if (row.daysLate === 0) return "info";
  return "neutral";
}

/** Static literals, never `border-l-` + tone — Tailwind can't see through a
 *  template string. Same map/reasoning as `TONE_EDGE` in mobile-card-list.tsx. */
const TONE_EDGE: Record<StatusTone, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
  info: "border-l-info",
  neutral: "border-l-border-strong",
};

/**
 * A tinted, bordered box behind the date/SlipPill/assignee cluster
 * (2026-09-10, follow-up to the redesign above — operator screenshot: the
 * status line sat as plain text directly above the action buttons and read
 * as "more text near more buttons" rather than as the row's STATUS). Same
 * tone word as `TONE_EDGE`, same `StatusPill` soft-background family
 * (`bg-*-soft`), just applied to the whole cluster instead of only the pill,
 * so status is the one thing on the row with a visible boundary around it.
 */
const STATUS_BOX: Record<StatusTone, string> = {
  success: "border-success/30 bg-success-soft/60",
  warning: "border-warning/30 bg-warning-soft/60",
  danger: "border-danger/30 bg-danger-soft/60",
  info: "border-info/30 bg-info-soft/60",
  neutral: "border-border bg-surface-muted/60",
};

export function WorklistBoard({
  rows,
  canComplete,
  showDepartment,
  viewerEmployeeId,
}: {
  rows: WorklistRow[];
  canComplete: boolean;
  /** True when the list spans departments, so each row must say whose it is. */
  showDepartment: boolean;
  /** `wl.viewerEmployeeId` (0547) — what Claim sends; null on an unlinked login. */
  viewerEmployeeId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // The delay attribution the operator has picked, per row, before Done is
  // pressed on a LATE row (0547). Local-only and thrown away on completion —
  // there is nothing to restore it from and nothing else reads it.
  const [delayChoice, setDelayChoice] = useState<Record<string, string>>({});
  const { success, error } = useToast();

  // Block the silent auto-update for as long as an action is in flight. See the
  // header for why this is not `useUnsavedGuard`.
  useEffect(() => {
    if (!pending) return;
    return acquireBusy();
  }, [pending]);

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.ok) success(done);
      else error(res.error ?? "Could not save");
    });
  };

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li
          key={row.id}
          className={cn(
            // COMPACT PASS (2026-09-10, operator: "compact the cards") —
            // p-3/sm:p-4 and the space-y-2 stack below read as roomy once a
            // bucket holds more than a couple of rows and the tab (not the
            // page) is the thing scrolling now. Tightened padding/gaps
            // throughout this card; nothing shrank below the `sm` (h-8)
            // button/control floor the keyboard/touch-target rules require.
            "rounded-lg border border-border bg-surface p-2.5 sm:p-3",
            // A 3px LEFT ACCENT BAR, not a full-card border (2026-09-10
            // redesign) — every bucket gets a consistent stripe (neutral for
            // "not due yet" through danger for escalated), rather than only
            // the worst case getting a treatment and everything else looking
            // unstated. `border-l-*` is a different tailwind-merge group from
            // the `border`/`border-border` above, so both survive `cn()`.
            "border-l-[3px]",
            TONE_EDGE[rowTone(row)],
          )}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1.5">
              {/* Line 1 — the instruction. */}
              <p className="text-sm font-medium">
                <span>{row.activity}</span>
                {row.orderRef && (
                  <>
                    <span className="text-muted-foreground"> for </span>
                    {/* `/orders/amendments` is a list-then-open screen — it has
                        no `[id]` route, so this links to the door rather than
                        inventing a deep link that would 404. */}
                    <Link
                      href="/orders/amendments"
                      className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                      title={row.amendmentCode ? `Amendment ${row.amendmentCode}` : undefined}
                    >
                      {row.orderRef}
                    </Link>
                  </>
                )}
                {row.buyer && (
                  <span className="text-muted-foreground"> · {row.buyer}</span>
                )}
              </p>

              {/* Meta row — discrete chips, not a "·"-joined sentence
                  (2026-09-10 redesign, client: the screen "look total
                  confusion"). Qty, style, department and bypass% used to
                  compete for attention at the same weight inside one run-on
                  line; each fact now scans on its own instead of being read
                  as prose. Reuses `StatusPill` (tone="neutral", a border and
                  tighter padding via `className`) rather than a second pill
                  component. */}
              {(row.orderQty > 0 ||
                row.styleRefs.length > 0 ||
                (showDepartment && row.departmentName) ||
                row.bypassPercent != null) && (
                <div className="flex flex-wrap items-center gap-1">
                  {row.orderQty > 0 && (
                    <StatusPill tone="neutral" className="border border-border/60 px-1.5 py-0.5 tabular-nums">
                      {fmtNumber(row.orderQty)} {row.orderUom ?? "pcs"}
                    </StatusPill>
                  )}
                  {row.styleRefs.length > 0 && (
                    <StatusPill tone="neutral" className="border border-border/60 px-1.5 py-0.5">
                      Style {row.styleRefs.join(", ")}
                    </StatusPill>
                  )}
                  {showDepartment && row.departmentName && (
                    <StatusPill tone="neutral" className="border border-border/60 px-1.5 py-0.5">
                      {row.departmentName}
                    </StatusPill>
                  )}
                  {row.bypassPercent != null && (
                    <StatusPill tone="neutral" className="border border-border/60 px-1.5 py-0.5">
                      {Math.round(row.bypassPercent * 100)}% bypassed
                      {row.bypassedQty != null ? ` (${fmtNumber(row.bypassedQty)} pcs)` : ""}
                    </StatusPill>
                  )}
                </div>
              )}

              {/* Materials — kept separate from the chips above and left as
                  plain muted text: this is supplementary detail (the ORDER's
                  requirement, not the activity's), not a headline fact. */}
              {row.materials.length > 0 && (
                <p
                  className="text-xs text-muted-foreground"
                  title="The ORDER's material requirement. The schedule carries no per-activity material."
                >
                  Order needs{" "}
                  {row.materials
                    .map(
                      (m) =>
                        `${fmtNumber(m.qty)} ${m.uom ?? ""} ${m.name}`.replace(/\s+/g, " ").trim(),
                    )
                    .join(", ")}
                  {row.materialsOmitted > 0 && ` +${row.materialsOmitted} more`}
                </p>
              )}

              {row.notes && (
                <Truncated
                  text={row.notes}
                  className="block max-w-[40rem] text-xs text-muted-foreground"
                />
              )}
            </div>

            {/* The date, the slip, and the two actions. Stacked (flex-col)
                at every width, not just sm+: the action zone below can
                itself be two rows of buttons, and laying that out in a ROW
                beside the date/pill/assignee cluster — which `sm:flex-col`
                alone would do on mobile, since unprefixed `flex` defaults to
                row — is exactly the "flex-wrap soup" this redesign exists to
                remove, just moved up one level. `sm:items-end` is the only
                thing that changes at the breakpoint: right-aligned once this
                becomes its own column beside the content on desktop. */}
            <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
              <div className="flex items-center gap-1.5">
                {/* ONE badge, not a pill floating beside plain date text
                    (2026-09-10, operator screenshot: the status line read
                    as "more text near more buttons", not as the row's
                    status). Icon + date + the slip label share one tinted,
                    bordered box, toned off the same `rowTone()` the accent
                    bar and the delay group already use — this is the thing
                    on the row a manager scans FIRST, so it is the one thing
                    that gets a visible boundary around it. */}
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-1.5 py-0.5",
                    STATUS_BOX[rowTone(row)],
                  )}
                >
                  <StatusIcon row={row} className="size-3.5 shrink-0" />
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {fmtDate(row.targetDate)}
                  </span>
                  <span className={cn("text-xs font-semibold", STATUS_ICON_COLOR[rowTone(row)])}>
                    {slipLabel(row)}
                  </span>
                </div>
                {/* WHO THIS IS ON TODAY (0547) — "You" rather than the
                    operator's own name repeated back at them; anyone else's
                    claim shows the name they'd otherwise have to ask about.
                    Kept OUTSIDE the status box on purpose: this is identity,
                    not lateness, and nesting an `info`-toned pill inside a
                    (possibly) `danger`-toned box would read as an error on
                    the assignment itself. */}
                {row.assignedStaffId && (
                  <StatusPill tone={row.assignedStaffId === viewerEmployeeId ? "info" : "neutral"}>
                    {row.assignedStaffId === viewerEmployeeId
                      ? "You"
                      : (row.assignedStaffName ?? "Claimed")}
                  </StatusPill>
                )}
              </div>

              {/* Action zone — two rows, not one `flex-wrap` soup (2026-09-10
                  redesign). Left-to-right / top-to-bottom order is always
                  [Claim/Release] [Start/Undo] [Done]; Claim/Release and Undo
                  are the lighter `ghost` actions and sit together on the
                  first row, Start and the Done group are the dominant
                  actions (`outline` / default `Button`) and sit together on
                  the second — which is also what keeps mobile predictable:
                  the light actions wrap on their own line, the primary
                  action never gets crowded off-screen by them. */}
              {canComplete && (
                <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                  <div className="flex flex-wrap items-center gap-1 empty:hidden">
                    {/* CLAIM / RELEASE — self-serve only in this pass: an
                        operator claims their own row or gives up their own
                        claim. Reassigning someone ELSE's row is a manager
                        action this board does not offer yet; the underlying
                        `assignTaActivity` accepts any staffId when that is
                        built, this UI just never sends one. Absent entirely
                        when the login has no employee link — there is
                        nothing truthful for it to claim AS. */}
                    {viewerEmployeeId && !row.assignedStaffId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === row.id}
                        onClick={() =>
                          run(
                            row.id,
                            () => assignTaActivity(row.id, viewerEmployeeId),
                            "Claimed",
                          )
                        }
                        // toolbar-size: exempt -- per-row action, see the Done note below.
                      >
                        <UserRound aria-hidden /> Claim
                      </Button>
                    )}
                    {viewerEmployeeId && row.assignedStaffId === viewerEmployeeId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === row.id}
                        onClick={() =>
                          run(row.id, () => assignTaActivity(row.id, null), "Released")
                        }
                        // toolbar-size: exempt -- per-row action, see the Done note below.
                      >
                        <UserRoundX aria-hidden /> Release
                      </Button>
                    )}
                    {row.status === "in_progress" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === row.id}
                        onClick={() =>
                          run(row.id, () => reopenTaActivity(row.id), "Moved back to pending")
                        }
                        // toolbar-size: exempt -- per-row action, see above.
                      >
                        <RotateCcw aria-hidden /> Undo
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {row.status !== "in_progress" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === row.id || row.cuttingBlocked}
                        title={
                          row.cuttingBlocked
                            ? "Cutting is locked until PP Sample is Approved on the Approvals Worklist"
                            : undefined
                        }
                        onClick={() =>
                          run(row.id, () => startTaActivity(row.id), "Marked in progress")
                        }
                        // toolbar-size: exempt -- a per-row action inside a card, not a
                        // header row; `sm` is the compact size the row is built at.
                      >
                        <Clock aria-hidden /> Start
                      </Button>
                    )}
                    {row.daysLate > 0 ? (
                      // The delay picker and Done are one visually-bounded
                      // mini-group on a late row, so a disabled Done reads
                      // as "pick a reason" rather than "broken" — the two
                      // used to sit side by side with nothing tying them
                      // together (2026-09-10 redesign).
                      <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-muted/50 p-1">
                        {/* LATE ALREADY — completing it now is still a late
                            completion, so the attribution has to be picked
                            before Done fires (0547). This is the courtesy
                            half; the server re-checks `target_date` itself
                            and refuses a missing attribution on a late row
                            regardless of what this control did or didn't
                            show, so a stale `daysLate` from page load can
                            never write an unattributed delay. */}
                        <Select
                          value={delayChoice[row.id] ?? ""}
                          onChange={(e) =>
                            setDelayChoice((xs) => ({ ...xs, [row.id]: e.target.value }))
                          }
                          className="h-8 w-36 text-xs"
                          disabled={busyId === row.id}
                        >
                          <option value="">Delay caused by…</option>
                          <option value="internal_staff">Staff</option>
                          <option value="buyer_delay">Buyer</option>
                          <option value="material_supplier">Material Supplier</option>
                        </Select>
                        <Button
                          size="sm"
                          disabled={busyId === row.id || !delayChoice[row.id]}
                          onClick={() =>
                            run(
                              row.id,
                              () =>
                                completeTaActivity(
                                  row.id,
                                  undefined,
                                  (delayChoice[row.id] as
                                    | "internal_staff"
                                    | "buyer_delay"
                                    | "material_supplier"
                                    | undefined) || undefined,
                                ),
                              "Marked done",
                            )
                          }
                          // toolbar-size: exempt -- per-row action, see above.
                        >
                          <CheckCircle2 aria-hidden /> Done
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busyId === row.id}
                        onClick={() =>
                          run(row.id, () => completeTaActivity(row.id, undefined, undefined), "Marked done")
                        }
                        // toolbar-size: exempt -- per-row action, see above.
                      >
                        <CheckCircle2 aria-hidden /> Done
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * How late, in words.
 *
 * "3 days late" and not "-3": a negative number in a Days column is the shape
 * `backwardSchedule` reports float in, and reusing it here would make two
 * different facts look like one.
 *
 * A row with `bypassInProgress` never reads as an alert here (§7.4) — the
 * floor is actively producing past this activity, so "N days late" would be
 * a false positive on the calendar half alone. `daysLate` itself is left
 * untouched (it still sorts/buckets the row); only the label's TONE softens,
 * same split `escalated` makes in `lib/ta/worklist.ts`.
 *
 * Returns plain text, not a `StatusPill` — this used to render its own pill,
 * but that meant a pill nested inside the tinted `STATUS_BOX` (2026-09-10
 * follow-up), a badge inside a badge. The box supplies the color now; this
 * only supplies the words.
 */
function slipLabel(row: WorklistRow): string {
  if (row.daysLate > 0) {
    if (row.bypassInProgress) {
      return `${row.daysLate} ${row.daysLate === 1 ? "day" : "days"} late · bypass in progress`;
    }
    return `${row.daysLate} ${row.daysLate === 1 ? "day" : "days"} late`;
  }
  if (row.daysLate === 0) return "Due today";
  return `in ${-row.daysLate} ${row.daysLate === -1 ? "day" : "days"}`;
}

/** The icon half of the status box — late/escalated gets the alert glyph,
 *  due today gets a clock, anything upcoming gets a plain calendar. Reads
 *  `rowTone()`, so it can never disagree with the box color or the accent
 *  bar it sits beside. */
const STATUS_ICON_COLOR: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-muted-foreground",
};

function StatusIcon({ row, className }: { row: WorklistRow; className?: string }) {
  const tone = rowTone(row);
  const cls = cn(STATUS_ICON_COLOR[tone], className);
  if (tone === "danger" || tone === "warning") return <AlertTriangle className={cls} aria-hidden />;
  if (tone === "info") return <Clock className={cls} aria-hidden />;
  return <CalendarClock className={cls} aria-hidden />;
}
