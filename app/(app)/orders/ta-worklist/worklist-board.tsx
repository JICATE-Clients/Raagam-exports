"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { acquireBusy } from "@/lib/reload-guard";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
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
export function WorklistBoard({
  rows,
  canComplete,
  showDepartment,
}: {
  rows: WorklistRow[];
  canComplete: boolean;
  /** True when the list spans departments, so each row must say whose it is. */
  showDepartment: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
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
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className={cn(
            "rounded-lg border border-border bg-surface p-3 sm:p-4",
            // The escalation is a BORDER, not a badge in a corner: a manager
            // scanning the page has to see it without reading it.
            row.escalated && "border-danger/50",
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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

              {/* Line 2 — the quantity and the material, which is the half a
                  legacy T&A screen never showed. */}
              <p className="text-xs text-muted-foreground">
                {row.orderQty > 0 && (
                  <span className="tabular-nums text-foreground">
                    {fmtNumber(row.orderQty)} {row.orderUom ?? "pcs"}
                  </span>
                )}
                {row.styleRefs.length > 0 && (
                  <span> · Style {row.styleRefs.join(", ")}</span>
                )}
                {row.materials.length > 0 && (
                  <>
                    {" · "}
                    <span title="The ORDER's material requirement. The schedule carries no per-activity material.">
                      Order needs{" "}
                      {row.materials
                        .map(
                          (m) =>
                            `${fmtNumber(m.qty)} ${m.uom ?? ""} ${m.name}`.replace(/\s+/g, " ").trim(),
                        )
                        .join(", ")}
                      {row.materialsOmitted > 0 && ` +${row.materialsOmitted} more`}
                    </span>
                  </>
                )}
              </p>

              {row.notes && (
                <Truncated
                  text={row.notes}
                  className="block max-w-[40rem] text-xs text-muted-foreground"
                />
              )}
            </div>

            {/* The date, the slip, and the two actions. */}
            <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
              <div className="flex items-center gap-2">
                <span className="tabular-nums text-xs text-muted-foreground">
                  {fmtDate(row.targetDate)}
                </span>
                <SlipPill row={row} />
                {showDepartment && row.departmentName && (
                  <StatusPill tone="neutral">{row.departmentName}</StatusPill>
                )}
              </div>

              {canComplete && (
                <div className="flex items-center gap-1.5">
                  {row.status !== "in_progress" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() =>
                        run(row.id, () => startTaActivity(row.id), "Marked in progress")
                      }
                      // toolbar-size: exempt -- a per-row action inside a card, not a
                      // header row; `sm` is the compact size the row is built at.
                    >
                      <Clock aria-hidden /> Start
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
                  <Button
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() =>
                      run(row.id, () => completeTaActivity(row.id), "Marked done")
                    }
                    // toolbar-size: exempt -- per-row action, see above.
                  >
                    <CheckCircle2 aria-hidden /> Done
                  </Button>
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
 */
function SlipPill({ row }: { row: WorklistRow }) {
  if (row.daysLate > 0) {
    return (
      <StatusPill tone={row.escalated ? "danger" : "warning"}>
        {row.daysLate} {row.daysLate === 1 ? "day" : "days"} late
      </StatusPill>
    );
  }
  if (row.daysLate === 0) return <StatusPill tone="info">Due today</StatusPill>;
  return (
    <StatusPill tone="neutral">
      in {-row.daysLate} {row.daysLate === -1 ? "day" : "days"}
    </StatusPill>
  );
}
