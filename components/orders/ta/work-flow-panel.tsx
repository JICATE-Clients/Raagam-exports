"use client";

import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { RecordPicker } from "@/components/masters/record-picker";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  workFlowDef,
  workFlowOwnerOptions,
  workFlowView,
  type WorkFlowRow,
} from "@/lib/orders/work-flow/types";
import {
  loadWorkFlow,
  updateWorkFlowMilestone,
  type WorkFlowLoad,
  type WorkFlowPatch,
} from "@/lib/orders/work-flow/actions";

/**
 * Order Entry ▸ T&A ▸ Work Flow — the six office milestones between an order
 * arriving and bulk production starting (0607; doc/order/orderentry-workflow-plan.md).
 *
 * ## THE OPERATOR TYPES TWO THINGS, AND NEVER A COMPLETION
 *
 * Days and Owner. Actual is the MODULES' — the CAD sheet being submitted, a BOM
 * leaving draft, the budget being submitted or approved stamps it through
 * database triggers, and nothing on this panel can: a typed date could say
 * "done" over a draft BOM.
 *
 * ## IT SAVES ITS OWN ROWS
 *
 * The rows belong to the RE and live outside the order's payload, so each edit
 * is written when it is made (Owner on pick, Days on leaving the box), the same
 * shape as the TA Followup tab. The order's Save neither carries nor can
 * clobber them. `useUnsavedGuard` covers the moment between typing and the
 * write landing.
 *
 * ## IT LOOKS LIKE THE ACTIVITY LADDER, ON PURPOSE (client 2026-09-21)
 *
 * Same stat-tile band, same `w-fit` card with its hairline scroller, same
 * 10px uppercase header band, same flex rows with the red left stripe on a
 * late row. The class strings and column widths below are copied from
 * `garment-order-screen.tsx` (`TA_ROW_GUTTER`, `TA_ACTIVITY_COL_W`,
 * `TA_DATE_COL_W`) — change one there, change it here. Unlike the ladder,
 * Days and Owner stay live controls at rest rather than text-until-clicked,
 * so Tab keeps landing on them (AGENTS.md "Tab lands on fields").
 */

const ROW_GUTTER = "gap-x-4 px-3"; //    = TA_ROW_GUTTER
const MILESTONE_COL_W = "10rem"; //       = TA_ACTIVITY_COL_W
const OWNER_COL_W = "12.5rem"; //          party step — a live picker, not text
const DATE_COL_W = "5.25rem"; //           = TA_DATE_COL_W

const TILE = "min-w-[9rem] flex-1 border-r border-border bg-surface-muted/40 px-3 py-1.5 last:border-r-0";
const TILE_LABEL = "text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground";

type Draft = { days: string };

export function WorkFlowPanel({ amendmentId }: { amendmentId: string | null }) {
  const toast = useToast();
  const [data, setData] = useState<WorkFlowLoad | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    /* A REJECTED LOAD MUST END THE SPINNER. Without the `catch`, a server
       action that throws (or a dev server still holding a stale action id)
       left "Loading Work Flow…" on screen for ever with nothing to report. */
    loadWorkFlow(amendmentId ?? "")
      .then((res) => {
        if (!live) return;
        setData(res);
        setDrafts({});
      })
      .catch((e: unknown) => {
        if (!live) return;
        setData({
          ok: false,
          error: `Work Flow could not load: ${e instanceof Error ? e.message : String(e)}. Reload the page; if it persists, restart the dev server.`,
        });
      });
    return () => {
      live = false;
    };
  }, [amendmentId]);

  const rows = data?.ok ? data.rows : [];
  const dirty = rows.some((r) => {
    const d = drafts[r.id];
    return !!d && d.days !== String(r.days);
  });
  useUnsavedGuard(dirty || pending);

  if (!amendmentId) {
    return <p className="text-sm text-muted-foreground">Save the order first — its Work Flow starts once the order exists.</p>;
  }
  if (!data) return <p className="text-sm text-muted-foreground">Loading Work Flow…</p>;
  if (!data.ok) return <p className="text-sm text-danger">{data.error}</p>;

  const { day0, today, employees } = data;

  function patchRow(id: string, next: Partial<WorkFlowRow>) {
    setData((prev) =>
      prev && prev.ok ? { ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, ...next } : r)) } : prev,
    );
  }

  function save(row: WorkFlowRow, patch: WorkFlowPatch, optimistic: Partial<WorkFlowRow>) {
    startTransition(async () => {
      const res = await updateWorkFlowMilestone(row.id, patch);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      patchRow(row.id, { ...optimistic, target_date: res.target_date });
      setDrafts((d) => {
        const rest = { ...d };
        delete rest[row.id];
        return rest;
      });
    });
  }

  function commitDays(row: WorkFlowRow) {
    const raw = drafts[row.id]?.days;
    if (raw === undefined || raw === String(row.days)) return;
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(n) || n < 0 || n > 365) {
      toast.error(`${workFlowDef(row.code)?.label}: Days must be a whole number from 0 to 365`);
      setDrafts((d) => ({ ...d, [row.id]: { days: String(row.days) } }));
      return;
    }
    save(row, { days: n }, { days: n });
  }

  const views = rows.map((r) => workFlowView(r, today));
  const doneCount = views.filter((v) => v.state === "done" || v.state === "done_late").length;
  const overdueCount = views.filter((v) => v.state === "overdue").length;

  return (
    <div className="space-y-4">
      {/* THE STAT BAND — the ladder's Anchor / Work starts / Needs attention tiles. */}
      <div className="flex flex-wrap overflow-hidden rounded-md border border-border">
        <div className={TILE}>
          <div className={TILE_LABEL}>Day 0</div>
          <div className="text-sm font-semibold leading-tight tabular-nums text-foreground">{fmtDate(day0.date)}</div>
          <div className="text-[10px] leading-none text-muted-foreground">
            {day0.source === "received" ? "Received Date" : "Order Date — Received Date not entered"}
          </div>
        </div>
        <div className={TILE}>
          <div className={TILE_LABEL}>Done</div>
          <div className="text-sm font-semibold leading-tight tabular-nums text-foreground">
            {doneCount} of {rows.length}
          </div>
          <div className="text-[10px] leading-none text-muted-foreground">Milestones finished</div>
        </div>
        {overdueCount > 0 && (
          <div className={TILE}>
            <div className={TILE_LABEL}>Needs attention</div>
            <div className="text-sm font-semibold leading-tight text-danger">
              {overdueCount} row{overdueCount === 1 ? "" : "s"}
            </div>
            <div className="text-[10px] leading-none text-muted-foreground">Past target, not finished</div>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-danger">
          This order has no Work Flow rows. They are created when the order is saved — save it once and reopen.
        </p>
      ) : (
        <div className="w-fit max-w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <div className="overflow-x-auto [scrollbar-width:thin] [scrollbar-color:var(--color-gray-300)_transparent] [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300">
            <div
              className={cn(
                ROW_GUTTER,
                "flex items-center border-b border-l-[3px] border-b-border border-l-transparent py-2 text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground",
              )}
            >
              <span className="w-6 flex-none text-center">#</span>
              <span className="flex-none" style={{ width: MILESTONE_COL_W }}>Milestone</span>
              <span className="flex-none" style={{ width: OWNER_COL_W }}>Owner</span>
              <span className="w-14 flex-none text-center">Days</span>
              <span className="flex-none" style={{ width: DATE_COL_W }}>Target</span>
              <span className="flex-none" style={{ width: DATE_COL_W }}>Actual</span>
            </div>

            {rows.map((r, i) => {
              const def = workFlowDef(r.code);
              const late = views[i].state === "overdue";
              const owners = workFlowOwnerOptions(employees, r.code, r.owner_id);
              return (
                <div
                  key={r.id}
                  className={cn(
                    ROW_GUTTER,
                    "flex min-h-9 items-center border-l-[3px] bg-surface py-2 leading-none",
                    "transition-colors hover:bg-surface-muted/40",
                    i > 0 && "border-t border-t-border",
                    late ? "border-l-danger" : "border-l-transparent",
                  )}
                  title={late ? `${views[i].daysLate} day${views[i].daysLate === 1 ? "" : "s"} past target, not finished` : undefined}
                >
                  <span className="w-6 flex-none text-center font-mono text-xs leading-none tabular-nums text-muted-foreground">
                    {r.sn}
                  </span>
                  <span
                    className="block min-w-0 flex-none truncate text-xs font-semibold leading-none text-foreground"
                    style={{ width: MILESTONE_COL_W }}
                  >
                    {def?.label ?? r.code}
                  </span>
                  <div className="min-w-0 flex-none" style={{ width: OWNER_COL_W }}>
                    <RecordPicker
                      compact
                      label={`${def?.label} owner`}
                      items={owners.items}
                      emptyHint={owners.hint}
                      placeholder={owners.shortHint ?? undefined}
                      value={r.owner_id}
                      onChange={(id) => {
                        if (id === r.owner_id) return;
                        const name = employees.find((e) => e.id === id)?.name ?? null;
                        save(r, { owner_id: id }, { owner_id: id, owner_name: name });
                      }}
                    />
                  </div>
                  <div className="w-14 flex-none">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={365}
                      aria-label={`${def?.label} days`}
                      className="h-7 px-1.5 text-center text-xs tabular-nums"
                      value={drafts[r.id]?.days ?? String(r.days)}
                      onChange={(e) => setDrafts((p) => ({ ...p, [r.id]: { days: e.target.value } }))}
                      onBlur={() => commitDays(r)}
                    />
                  </div>
                  <div
                    className={cn(
                      "flex-none whitespace-nowrap font-mono text-xs leading-none tabular-nums",
                      late ? "text-danger" : "text-foreground",
                    )}
                    style={{ width: DATE_COL_W }}
                  >
                    {fmtDate(r.target_date)}
                  </div>
                  <div
                    className={cn(
                      "flex-none whitespace-nowrap font-mono text-xs leading-none tabular-nums",
                      r.actual_date ? "text-foreground" : "text-muted-foreground",
                    )}
                    style={{ width: DATE_COL_W }}
                  >
                    {r.actual_date ? fmtDate(r.actual_date) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
