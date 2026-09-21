"use client";

import { useState } from "react";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { workingDaysGap, type FabricTaLadderRow, type FabricTaStepCode } from "@/lib/orders/fabric-ta/engine";
import type { FabricTaOrder, FabricTaRow } from "@/lib/orders/fabric-ta/service";
import { FabricOrderBoard } from "./fabric-order-board";

/**
 * Fabric BOM ▸ T&A — THE GROUPED LADDER, drawn as the Order Entry T&A tab
 * draws its own (client 2026-09-21: "the UI of the T&A tab in Fabric BOM needs
 * to match the Order Entry activity"). Same stat band (Anchor · Work starts ·
 * Needs attention), same `w-fit` card, same 10px tracked header, the same
 * seven columns `# · Activity · Department · Owner · Days · Target · Actual`,
 * plain-text rows with the red left stripe on a late one — and no status
 * pills, no quantity column: those were this ladder's own inventions and the
 * client asked for the other screen's shape instead. The figures survive as
 * the 10px subtitle under Activity, the way Order Entry's Bypass line sits
 * under its activity name.
 *
 * COLUMN WIDTHS AND GUTTER ARE THE ORDER ENTRY LADDER'S (`TA_ROW_GUTTER`,
 * `TA_ACTIVITY_COL_W`, `TA_DEPT_COL_W`, `TA_OWNER_COL_W`, `TA_DATE_COL_W` in
 * `garment-order-screen.tsx`, and the Work Flow panel's copy of them) — change
 * one there, change it here, or the two ladders stop lining up when read one
 * after the other.
 *
 * "Days" is the working days from the previous step's target (Sunday off, the
 * house rule), which is what Order Entry's Days column means. Rows are rolled
 * up over every yarn or fabric carrying the step (`fabricTaLadder`); the
 * per-material board — where tolerance, a manual done date and an owner are
 * set — stays behind one link as the client's "backup".
 */
const ROW_GUTTER = "gap-x-4 px-3"; //      = TA_ROW_GUTTER
const ACTIVITY_COL_W = "10rem"; //          = TA_ACTIVITY_COL_W
const DEPT_COL_W = "7rem"; //                = TA_DEPT_COL_W
const OWNER_COL_W = "8rem"; //               = TA_OWNER_COL_W (also the literal `w-[8rem]` below)
const DATE_COL_W = "5.25rem"; //             = TA_DATE_COL_W
const TILE = "min-w-[9rem] flex-1 border-r border-border bg-surface-muted/40 px-3 py-1.5 last:border-r-0";
const TILE_LABEL = "text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground";

/** The department a step is owed by — the same kind of word Order Entry's
 *  ladder shows on its rows, read off the step rather than an employee master. */
const DEPT: Record<FabricTaStepCode, string> = {
  YARN_PO: "Purchase",
  YARN_GRN: "Stores",
  KNIT_DC: "Stores",
  KNIT_GRN: "Stores",
  PROCESS_DC: "Stores",
  PROCESS_GRN: "Stores",
};

export function FabricTaLadder({
  order,
  staffNames,
  viewerEmployeeId,
  canEdit,
  today,
  onSaved,
}: {
  order: FabricTaOrder;
  staffNames: Record<string, string>;
  viewerEmployeeId: string | null;
  canEdit: boolean;
  today: string;
  onSaved?: () => void;
}) {
  const [detailed, setDetailed] = useState(false);
  const rows = order.ladder;
  const live = rows.filter((r) => r.status !== "BYPASSED");
  const attention = live.filter((r) => r.status === "OVERDUE").length;
  const first = live[0] ?? null;

  /* THE OWNER OF A GROUPED ROW: one name when every material's step names the
     same person, "n owners" when they differ, "—" when nobody has taken it.
     Owners are set per material on the detail board. */
  const ownerOf = (code: FabricTaStepCode): string => {
    const ids = new Set<string>();
    for (const m of [...order.yarns, ...order.fabrics] as FabricTaRow[]) {
      const s = m.steps.find((x) => x.code === code);
      if (s && s.status !== "BYPASSED" && s.assignedStaffId) ids.add(s.assignedStaffId);
    }
    if (ids.size === 0) return "—";
    if (ids.size > 1) return `${ids.size} owners`;
    const id = [...ids][0];
    return id === viewerEmployeeId ? "You" : (staffNames[id] ?? "Assigned");
  };

  const subtitle = (r: FabricTaLadderRow): string | null => {
    if (r.status === "BYPASSED") return r.targetNote;
    const qty = `${fmtNumber(r.doneQty)} / ${r.requiredQty == null ? "—" : fmtNumber(r.requiredQty)} kg`;
    if (r.status === "COMPLETED") return qty;
    if (r.waitingOn.length && r.waitingOn.length < r.total) return `${qty} · waiting on ${r.waitingOn.join(", ")}`;
    return `${qty} · ${r.total} material${r.total === 1 ? "" : "s"}`;
  };

  return (
    <div className="space-y-3">
      {/* THE STAT BAND — the Order Entry ladder's Anchor / Work starts /
          Needs attention, with this ladder's own three facts in those slots:
          the cutting gate every step is dated back from, the first open
          step, and the late count. */}
      <div className="flex flex-wrap overflow-hidden rounded-md border border-border">
        <div className={TILE}>
          <div className={TILE_LABEL}>Anchor</div>
          <div className={cn("text-sm font-semibold leading-tight tabular-nums", order.inHouse.date ? "text-foreground" : "text-danger")}>
            {order.inHouse.date ? fmtDate(order.inHouse.date) : "Not scheduled"}
          </div>
          <div className="text-[10px] leading-none text-muted-foreground">{order.inHouse.note}</div>
        </div>
        <div className={TILE}>
          <div className={TILE_LABEL}>Work starts</div>
          {first ? (
            <>
              <div className={cn("text-sm font-semibold leading-tight tabular-nums", first.status === "OVERDUE" ? "text-danger" : "text-foreground")}>
                {fmtDate(first.target)}
              </div>
              <div className={cn("text-[10px] leading-none", first.status === "OVERDUE" ? "font-medium text-danger" : "text-muted-foreground")}>
                {first.float != null && first.float < 0
                  ? `${-first.float} day${first.float === -1 ? "" : "s"} late already`
                  : first.float === 0
                    ? "Starting today"
                    : first.float != null
                      ? `${first.float} day${first.float === 1 ? "" : "s"} from today`
                      : first.label}
              </div>
            </>
          ) : (
            <div className="text-sm font-semibold leading-tight text-muted-foreground">Nothing to schedule</div>
          )}
        </div>
        {attention > 0 && (
          <div className={TILE}>
            <div className={TILE_LABEL}>Needs attention</div>
            <div className="text-sm font-semibold leading-tight text-warning">
              {attention} row{attention === 1 ? "" : "s"}
            </div>
            <div className="text-[10px] leading-none text-muted-foreground">Past target, not finished</div>
          </div>
        )}
      </div>

      <div className="w-fit max-w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto [scrollbar-width:thin] [scrollbar-color:var(--color-gray-300)_transparent] [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300">
          <div
            className={cn(
              ROW_GUTTER,
              "flex items-center border-b border-l-[3px] border-b-border border-l-transparent py-2 text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground",
            )}
          >
            <span className="w-6 flex-none text-center">#</span>
            <span className="flex-none" style={{ width: ACTIVITY_COL_W }}>Activity</span>
            <span className="flex-none" style={{ width: DEPT_COL_W }}>Department</span>
            <span className="flex-none" style={{ width: OWNER_COL_W }}>Owner</span>
            <span className="w-14 flex-none text-center">Days</span>
            <span className="flex-none" style={{ width: DATE_COL_W }}>Target</span>
            <span className="flex-none" style={{ width: DATE_COL_W }}>Actual</span>
          </div>

          {rows.map((r, i) => {
            const late = r.status === "OVERDUE";
            const off = r.status === "BYPASSED";
            /* Days = working days from the previous DATED step's target. */
            const prev = rows.slice(0, i).reverse().find((p) => p.target)?.target ?? null;
            const days = off ? null : workingDaysGap(prev, r.target);
            const sub = subtitle(r);
            return (
              <div
                key={r.code}
                className={cn(
                  ROW_GUTTER,
                  "flex min-h-9 items-center border-l-[3px] bg-surface py-2 leading-none transition-colors hover:bg-surface-muted/40",
                  i > 0 && "border-t border-t-border",
                  late ? "border-l-danger" : "border-l-transparent",
                  off && "opacity-55",
                )}
                title={late && r.float != null ? `${-r.float} day${r.float === -1 ? "" : "s"} past target, not finished` : (r.targetNote ?? undefined)}
              >
                <span className="w-6 flex-none text-center font-mono text-xs leading-none tabular-nums text-muted-foreground">{r.number}</span>
                <div className="min-w-0 flex-none" style={{ width: ACTIVITY_COL_W }}>
                  <Truncated className="block text-xs font-semibold leading-none text-foreground" text={r.label} />
                  {sub && <Truncated className="mt-0.5 block text-[10px] leading-none text-muted-foreground" text={sub} />}
                </div>
                {/* truncate-reveal: exempt -- a fixed vocabulary (Purchase / Stores, `DEPT`) that never reaches 7rem */}
                <span className="min-w-0 flex-none truncate text-xs leading-none text-foreground" style={{ width: DEPT_COL_W }}>
                  {off ? "—" : DEPT[r.code]}
                </span>
                <Truncated
                  className="block min-w-0 flex-none w-[8rem] text-xs leading-none text-foreground"
                  text={off ? "—" : ownerOf(r.code)}
                />
                <span className="w-14 flex-none text-center font-mono text-xs leading-none tabular-nums text-foreground">
                  {days == null ? "—" : days}
                </span>
                <div
                  className={cn("flex-none whitespace-nowrap font-mono text-xs leading-none tabular-nums", late ? "text-danger" : "text-foreground")}
                  style={{ width: DATE_COL_W }}
                >
                  {fmtDate(r.target)}
                </div>
                <div
                  className={cn("flex-none whitespace-nowrap font-mono text-xs leading-none tabular-nums", r.actualDate ? "text-foreground" : "text-muted-foreground")}
                  style={{ width: DATE_COL_W }}
                >
                  {fmtDate(r.actualDate)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* THE BACKUP — per yarn / per fabric, where tolerance, a manual done
          date and an owner are set. Closed by default; the ladder is the
          answer, this is the working. */}
      <button
        type="button"
        className="text-xs text-primary hover:underline"
        aria-expanded={detailed}
        onClick={() => setDetailed((v) => !v)}
      >
        {detailed ? "Hide" : "Show"} the detail by yarn and fabric
      </button>
      {detailed && (
        <FabricOrderBoard
          order={order}
          staffNames={staffNames}
          viewerEmployeeId={viewerEmployeeId}
          canEdit={canEdit}
          today={today}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
