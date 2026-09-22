"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { FabricStepSheet } from "@/components/orders/fabric-ta/fabric-step-sheet";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FABRIC_TA_STATUS_LABEL, FABRIC_TA_STATUS_TONE, type FabricTaStep } from "@/lib/orders/fabric-ta/engine";
import type { FabricTaOrder, FabricTaRow } from "@/lib/orders/fabric-ta/service";

/**
 * One order's Fabric T&A: every yarn (steps 6–8) and every fabric (9–11), each
 * with all of its steps — bypassed ones included and greyed. A bypassed step is
 * kept OUT of the queue, not out of the record: the store should still see WHY
 * a purchased cloth is not asked for a knitting receipt.
 *
 * Laid out like the Trims T&A board, deliberately.
 */
export function FabricOrderBoard({
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
  /** Passed through to the step sheet — see `FabricStepSheet.onSaved`. */
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState<{ row: FabricTaRow; step: FabricTaStep; origin: DOMRect } | null>(null);
  const open = (row: FabricTaRow, step: FabricTaStep, el: HTMLElement) =>
    setEditing({ row, step, origin: el.getBoundingClientRect() });

  const section = (title: string, hint: string, rows: FabricTaRow[]) => (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {rows.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
          {title.startsWith("Yarn")
            ? "No yarn is bought for this order — every fabric is purchased as cloth, or the BOM has no yarn."
            : "No fabric on this BOM."}
        </div>
      )}
      {rows.map((m) => (
        <section key={m.itemId} className="rounded-lg border border-border bg-surface">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
            <h3 className="text-sm font-semibold">{m.itemName}</h3>
            {m.sourceLabel && <StatusPill tone={m.sourceLabel.startsWith("Bought") ? "warning" : "info"}>{m.sourceLabel}</StatusPill>}
            {m.refusal && <span className="text-xs text-danger">{m.refusal}</span>}
          </header>

          {/* Desktop: the steps as a table. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Step</th>
                  <th className="px-2 py-2 font-medium">Target</th>
                  <th className="px-2 py-2 text-right font-medium">Done / Required (kg)</th>
                  <th className="px-2 py-2 font-medium">Actual</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {m.steps.map((s) => (
                  <tr key={s.code} className={cn("border-t border-border align-top", s.status === "BYPASSED" && "opacity-55")}>
                    <td className="px-4 py-2 tabular-nums">{s.number}</td>
                    <td className="px-2 py-2">
                      <div>{s.label}</div>
                      {s.status !== "BYPASSED" && <div className="text-xs text-muted-foreground">{s.judgedBy}</div>}
                      {s.docCodes.length > 0 && <div className="text-xs text-muted-foreground">{s.docCodes.join(", ")}</div>}
                      {s.remarks && <div className="text-xs text-muted-foreground">{s.remarks}</div>}
                    </td>
                    <td className="px-2 py-2">
                      <div className="tabular-nums">{fmtDate(s.target)}</div>
                      {s.targetNote && <div className="text-xs text-muted-foreground">{s.targetNote}</div>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {s.status === "BYPASSED" ? "—" : `${fmtNumber(s.doneQty)} / ${s.requiredQty == null ? "—" : fmtNumber(s.requiredQty)}`}
                      {s.tolerancePct > 0 && <div className="text-xs text-muted-foreground">tol {s.tolerancePct}%</div>}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {fmtDate(s.actualDate)}
                      {s.actualSource === "manual" && <div className="text-xs text-muted-foreground">manual</div>}
                    </td>
                    <td className="px-2 py-2">
                      <StatusPill tone={FABRIC_TA_STATUS_TONE[s.status]}>{FABRIC_TA_STATUS_LABEL[s.status]}</StatusPill>
                    </td>
                    <td className="px-2 py-2">{ownerOf(s, staffNames, viewerEmployeeId)}</td>
                    <td className="px-4 py-2 text-right">
                      {canEdit && s.status !== "BYPASSED" && (
                        <Button variant="outline" size="sm" onClick={(e) => open(m, s, e.currentTarget)}>
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: one card per step. */}
          <ul className="divide-y divide-border md:hidden">
            {m.steps.map((s) => (
              <li key={s.code} className={cn("space-y-1 px-4 py-3 text-sm", s.status === "BYPASSED" && "opacity-55")}>
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="tabular-nums text-muted-foreground">{s.number} · </span>
                    {s.label}
                  </span>
                  <StatusPill tone={FABRIC_TA_STATUS_TONE[s.status]}>{FABRIC_TA_STATUS_LABEL[s.status]}</StatusPill>
                </div>
                <div className="text-muted-foreground">
                  Target {fmtDate(s.target)}
                  {s.actualDate && <> · Done {fmtDate(s.actualDate)}</>}
                  {s.status !== "BYPASSED" && (
                    <>
                      {" "}
                      · {fmtNumber(s.doneQty)} / {s.requiredQty == null ? "—" : fmtNumber(s.requiredQty)} kg
                    </>
                  )}
                </div>
                {s.targetNote && <div className="text-xs text-muted-foreground">{s.targetNote}</div>}
                {canEdit && s.status !== "BYPASSED" && (
                  <Button variant="outline" size="sm" onClick={(e) => open(m, s, e.currentTarget)}>
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {section("Yarn — steps 6 to 8", "Bought, received, then issued to the knitter. Every colourway sharing a yarn is one lot.", order.yarns)}
      {section(
        "Fabric — steps 9 to 11",
        "Greige back from the knitter, out to the dye house, finished rolls in for cutting.",
        order.fabrics,
      )}

      {editing && (
        <FabricStepSheet
          key={`${editing.row.itemId}|${editing.step.code}`}
          open
          onClose={() => setEditing(null)}
          origin={editing.origin}
          salesOrderId={order.salesOrderId}
          itemId={editing.row.itemId}
          itemName={editing.row.itemName}
          step={editing.step}
          viewerEmployeeId={viewerEmployeeId}
          ownerName={editing.step.assignedStaffId ? (staffNames[editing.step.assignedStaffId] ?? null) : null}
          today={today}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function ownerOf(s: FabricTaStep, names: Record<string, string>, viewer: string | null): string {
  if (!s.assignedStaffId) return "—";
  if (s.assignedStaffId === viewer) return "You";
  return names[s.assignedStaffId] ?? "Assigned";
}
