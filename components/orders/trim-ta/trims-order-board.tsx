"use client";

import { useMemo, useState } from "react";
import { TrimStepSheet } from "@/components/orders/trim-ta/trim-step-sheet";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  TRIM_STATUS_LABEL,
  summariseByClass,
  type InHouseTarget,
  type TrimClass,
  type TrimClassStep,
  type TrimStep,
} from "@/lib/orders/trim-ta/engine";
import type { TrimTaOrder, TrimTaMaterial } from "@/lib/orders/trim-ta/service";

/**
 * Material BOM ▸ Trims T&A — the board, drawn EXACTLY like Order Entry's T&A
 * tab (client 2026-09-21: "UI should match the Order Entry T&A tab
 * activities"): one `w-fit` card, a 10px uppercase header band, dense flex
 * rows (`gap-x-4 px-3 py-2 min-h-9`), mono tabular dates, a red 3px left
 * stripe on a late row instead of a status pill, and a footer band that
 * counts. The constants below mirror `garment-order-screen.tsx`'s
 * `TA_*_COL_W` / `TA_ROW_GUTTER`; they are copied rather than imported
 * because that file is a 20k-line client screen and importing a constant from
 * it would pull the whole editor into this bundle.
 *
 * Two views over the SAME item-wise steps (client, same day: "two options —
 * item wise, and sewing items / packing items wise"), switched in the card's
 * top band the way the T&A tab's mode picker sits there:
 *
 *   - **Sewing / Packing** — six rows (12–17) in two groups, the spec's own
 *     table, rolled up by `summariseByClass`.
 *   - **Item wise** — a row per trim per step, grouped by trim; click the
 *     Activity to open the step's sheet (tolerance, done date, owner).
 */
export function TrimsOrderBoard({
  order,
  staffNames,
  viewerEmployeeId,
  canEdit,
  today,
  onChanged,
}: {
  order: TrimTaOrder;
  staffNames: Record<string, string>;
  viewerEmployeeId: string | null;
  canEdit: boolean;
  today: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ material: TrimTaMaterial; step: TrimStep; origin: DOMRect } | null>(null);
  const [view, setView] = useState<"item" | "class">("class");
  const byClass = useMemo(() => summariseByClass(order.materials), [order.materials]);

  const openStep = (material: TrimTaMaterial, step: TrimStep, el: HTMLElement) => {
    if (!canEdit || step.status === "BYPASSED") return;
    setEditing({ material, step, origin: el.getBoundingClientRect() });
  };

  const liveSteps = order.materials.flatMap((m) => m.steps).filter((s) => s.status !== "BYPASSED");
  const lateSteps = liveSteps.filter((s) => s.status === "OVERDUE").length;
  const doneSteps = liveSteps.filter((s) => s.status === "COMPLETED").length;

  return (
    <>
      <div className="w-fit max-w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        {/* TOP BAND — where the T&A tab keeps its mode picker: the in-house
            dates this schedule hangs off, and the view switch. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-3 py-1.5 text-[11px] leading-none">
          <InHouse label="Sewing trims in store by" target={order.inHouse.SEWING} />
          <InHouse label="Packing trims in store by" target={order.inHouse.PACKING} />
          <div className="ml-auto inline-flex rounded border border-border text-[11px]" role="group" aria-label="View">
            <ViewButton active={view === "class"} onClick={() => setView("class")}>
              Sewing / Packing
            </ViewButton>
            <ViewButton active={view === "item"} onClick={() => setView("item")}>
              Item wise
            </ViewButton>
          </div>
        </div>

        <div className="overflow-x-auto [scrollbar-width:thin] [scrollbar-color:var(--color-gray-300)_transparent] [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300">
          {view === "class" ? (
            <ClassLadder byClass={byClass} />
          ) : (
            <ItemLadder materials={order.materials} staffNames={staffNames} viewerEmployeeId={viewerEmployeeId} canEdit={canEdit} onOpen={openStep} />
          )}
        </div>

        {/* FOOTER BAND — the T&A tab's count line. */}
        <div className={cn(ROW_GUTTER, "flex items-center gap-x-6 border-t border-border py-1.5 text-[10px] uppercase leading-none tracking-[0.14em] text-muted-foreground")}>
          <span>
            {order.materials.length} trim{order.materials.length === 1 ? "" : "s"}
          </span>
          <span>
            {doneSteps} / {liveSteps.length} steps done
          </span>
          {lateSteps > 0 && <span className="text-danger">{lateSteps} late</span>}
        </div>
      </div>

      {editing && (
        <TrimStepSheet
          key={`${editing.material.itemId}|${editing.step.code}`}
          open
          onClose={() => setEditing(null)}
          origin={editing.origin}
          salesOrderId={order.salesOrderId}
          itemId={editing.material.itemId}
          itemName={editing.material.itemName}
          uom={editing.material.uom}
          step={editing.step}
          viewerEmployeeId={viewerEmployeeId}
          ownerName={editing.step.assignedStaffId ? (staffNames[editing.step.assignedStaffId] ?? null) : null}
          today={today}
          onSaved={onChanged}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * The T&A tab's metrics, mirrored (see the file comment for why not imported).
 * ------------------------------------------------------------------------- */
const ROW_GUTTER = "gap-x-4 px-3";
const ACTIVITY_W = "11rem";
const TRIM_W = "12rem";
const DEPT_W = "6rem";
const OWNER_W = "8rem";
const QTY_W = "7rem";
const DATE_W = "5.25rem";
const HEAD = cn(
  ROW_GUTTER,
  "flex items-center border-b border-l-[3px] border-b-border border-l-transparent py-2 text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground",
);
const ROW = cn(ROW_GUTTER, "flex min-h-9 items-center border-l-[3px] bg-surface py-2 leading-none transition-colors hover:bg-surface-muted/40");
const GROUP = cn(ROW_GUTTER, "border-l-[3px] border-l-transparent bg-surface-muted/60 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground");
const MONO = "flex-none whitespace-nowrap font-mono text-xs leading-none tabular-nums";
const CLASS_TITLE: Record<TrimClass, string> = { SEWING: "Sewing trims", PACKING: "Packing trims" };
/** Which desk a step belongs to — the T&A tab's Department column. */
const DEPT_OF: Record<TrimStep["doc"], string> = { PO: "Purchase", GRN: "Stores", DC: "Stores" };

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "px-2 py-1 font-medium leading-none transition-colors first:rounded-l last:rounded-r",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}

function InHouse({ label, target }: { label: string; target: InHouseTarget }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      {target.date ? (
        <span
          className="font-mono font-semibold tabular-nums text-foreground"
          title={"source" in target && target.source === "ladder" ? "From the order's T&A tab" : "1 working day before the start on the order's T&A tab"}
        >
          {fmtDate(target.date)}
        </span>
      ) : (
        <span className="font-medium text-danger" title={"refused" in target ? target.refused : undefined}>
          not scheduled
        </span>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Sewing / Packing — # · Activity · Department · Trims done · Target · Actual
 * ------------------------------------------------------------------------- */
function ClassLadder({ byClass }: { byClass: Record<TrimClass, TrimClassStep[]> }) {
  const classes = (["SEWING", "PACKING"] as const).filter((c) => byClass[c].length > 0);
  if (classes.length === 0) return <p className="px-3 py-3 text-xs text-muted-foreground">No sewing or packing trims on this BOM.</p>;
  return (
    <>
      <div className={HEAD}>
        <span className="w-6 flex-none text-center">#</span>
        <span className="flex-none" style={{ width: ACTIVITY_W }}>Activity</span>
        <span className="flex-none" style={{ width: DEPT_W }}>Department</span>
        <span className="flex-none" style={{ width: QTY_W }}>Trims done</span>
        <span className="flex-none" style={{ width: DATE_W }}>Target</span>
        <span className="flex-none" style={{ width: DATE_W }}>Actual</span>
      </div>
      {classes.map((c) => (
        <div key={c}>
          <div className={GROUP}>{CLASS_TITLE[c]}</div>
          {byClass[c].map((s) => {
            const bypassed = s.status === "BYPASSED";
            const critical = s.status === "OVERDUE";
            return (
              <div
                key={s.code}
                className={cn(ROW, "border-t border-t-border", critical ? "border-l-danger" : "border-l-transparent", bypassed && "opacity-60")}
                title={critical ? `Late — waiting: ${s.openItems.join(", ")}` : s.openItems.length ? `Waiting: ${s.openItems.join(", ")}` : undefined}
              >
                <span className="w-6 flex-none text-center font-mono text-xs leading-none tabular-nums text-muted-foreground">{s.number}</span>
                <span className="min-w-0 flex-none" style={{ width: ACTIVITY_W }}>
                  <Truncated text={s.short} className="block text-xs font-semibold leading-none text-foreground" />
                </span>
                <span className="min-w-0 flex-none" style={{ width: DEPT_W }}>
                  <Truncated text={bypassed ? "—" : DEPT_OF[s.doc]} className="block text-xs leading-none text-foreground" />
                </span>
                <span className={cn(MONO, "text-foreground")} style={{ width: QTY_W }}>
                  {bypassed ? <span className="font-sans text-muted-foreground">not needed</span> : `${s.doneCount} / ${s.totalCount}`}
                </span>
                <span className={cn(MONO, "text-foreground")} style={{ width: DATE_W }}>
                  {bypassed || !s.target ? "—" : fmtDate(s.target)}
                </span>
                <span className={cn(MONO, s.actualDate ? "text-foreground" : critical ? "text-danger" : "text-muted-foreground")} style={{ width: DATE_W }}>
                  {bypassed ? "—" : s.actualDate ? fmtDate(s.actualDate) : TRIM_STATUS_LABEL[s.status].toLowerCase()}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Item wise — # · Activity · Trim · Department · Owner · Qty · Target · Actual
 * ------------------------------------------------------------------------- */
function ItemLadder({
  materials,
  staffNames,
  viewerEmployeeId,
  canEdit,
  onOpen,
}: {
  materials: TrimTaMaterial[];
  staffNames: Record<string, string>;
  viewerEmployeeId: string | null;
  canEdit: boolean;
  onOpen: (m: TrimTaMaterial, s: TrimStep, el: HTMLElement) => void;
}) {
  const classes = (["SEWING", "PACKING"] as const).filter((c) => materials.some((m) => m.trimClass === c));
  if (classes.length === 0) return <p className="px-3 py-3 text-xs text-muted-foreground">No sewing or packing trims on this BOM.</p>;
  return (
    <>
      <div className={HEAD}>
        <span className="w-6 flex-none text-center">#</span>
        <span className="flex-none" style={{ width: ACTIVITY_W }}>Activity</span>
        <span className="flex-none" style={{ width: TRIM_W }}>Trim</span>
        <span className="flex-none" style={{ width: DEPT_W }}>Department</span>
        <span className="flex-none" style={{ width: OWNER_W }}>Owner</span>
        <span className="flex-none text-right" style={{ width: QTY_W }}>Qty</span>
        <span className="flex-none" style={{ width: DATE_W }}>Target</span>
        <span className="flex-none" style={{ width: DATE_W }}>Actual</span>
      </div>
      {classes.map((c) => (
        <div key={c}>
          <div className={GROUP}>{CLASS_TITLE[c]}</div>
          {materials
            .filter((m) => m.trimClass === c)
            .flatMap((m) => m.steps.filter((s) => s.status !== "BYPASSED").map((s, i) => ({ m, s, first: i === 0 })))
            .map(({ m, s, first }) => {
              const critical = s.status === "OVERDUE";
              const owner = ownerOf(s, staffNames, viewerEmployeeId);
              const clickable = canEdit;
              return (
                <div
                  key={`${m.itemId}|${s.code}`}
                  className={cn(ROW, first ? "border-t border-t-border" : "border-t border-t-border/40", critical ? "border-l-danger" : "border-l-transparent")}
                  title={critical ? `${Math.abs(s.float ?? 0)} day${Math.abs(s.float ?? 0) === 1 ? "" : "s"} past target, not received` : (s.targetNote ?? undefined)}
                >
                  <span className="w-6 flex-none text-center font-mono text-xs leading-none tabular-nums text-muted-foreground">{s.number}</span>
                  <span
                    className={cn("min-w-0 flex-none", clickable && "cursor-pointer rounded hover:bg-surface-muted")}
                    style={{ width: ACTIVITY_W }}
                    title={clickable ? `${s.short} — click to change` : undefined}
                    onClick={clickable ? (e) => onOpen(m, s, e.currentTarget) : undefined}
                  >
                    <Truncated text={s.short} className="block text-xs font-semibold leading-none text-foreground" />
                  </span>
                  {/* The trim's name once per group of its steps — the eye reads
                      the blank as "same as above", the way a ledger does. */}
                  <span className="min-w-0 flex-none" style={{ width: TRIM_W }}>
                    <Truncated text={first ? m.itemName : ""} className="block text-xs leading-none text-foreground">
                      {first ? m.itemName : ""}
                      {first && (m.needsProcess || m.freeIssue) && (
                        <span className="ml-1 text-[10px] text-muted-foreground">{m.freeIssue ? "free issue" : "job-work"}</span>
                      )}
                    </Truncated>
                  </span>
                  <span className="min-w-0 flex-none" style={{ width: DEPT_W }}>
                    <Truncated text={DEPT_OF[s.doc]} className="block text-xs leading-none text-foreground" />
                  </span>
                  <span className="min-w-0 flex-none" style={{ width: OWNER_W }}>
                    <Truncated text={owner ?? "—"} className="block text-xs leading-none text-foreground" />
                  </span>
                  <span className={cn(MONO, "text-right text-foreground")} style={{ width: QTY_W }} title={s.tolerancePct ? `tolerance ${s.tolerancePct}%` : undefined}>
                    {m.unresolved ? (
                      <span className="text-danger" title="A slice of the BOM could not be computed — see the Requirement tab">?</span>
                    ) : (
                      <>
                        {fmtNumber(s.doneQty)}
                        <span className="text-muted-foreground"> / {s.requiredQty == null ? "—" : fmtNumber(s.requiredQty)}</span>
                      </>
                    )}
                  </span>
                  <span className={cn(MONO, "text-foreground")} style={{ width: DATE_W }}>
                    {s.target ? fmtDate(s.target) : "—"}
                  </span>
                  <span className={cn(MONO, s.actualDate ? "text-foreground" : critical ? "text-danger" : "text-muted-foreground")} style={{ width: DATE_W }} title={s.actualSource === "manual" ? "Entered by hand" : s.docCodes.length ? s.docCodes.join(", ") : undefined}>
                    {s.actualDate ? fmtDate(s.actualDate) : TRIM_STATUS_LABEL[s.status].toLowerCase()}
                  </span>
                </div>
              );
            })}
        </div>
      ))}
    </>
  );
}

function ownerOf(s: TrimStep, names: Record<string, string>, viewer: string | null): string | null {
  if (!s.assignedStaffId) return null;
  if (s.assignedStaffId === viewer) return "You";
  return names[s.assignedStaffId] ?? "Assigned";
}
