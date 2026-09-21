"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtNumber } from "@/lib/format";
import { saveFabricTaMark } from "@/lib/orders/fabric-ta/actions";
import {
  FABRIC_TA_STATUS_LABEL,
  FABRIC_TA_STATUS_TONE,
  MAX_TOLERANCE_PCT,
  type FabricTaStep,
} from "@/lib/orders/fabric-ta/engine";

/**
 * What a PERSON may say about one Fabric T&A step (6–11): a receipt tolerance, a
 * manual done date for what no document shows (a PO raised outside the ERP, a
 * knitter's receipt never entered), a remark, and who owns it.
 *
 * The trims tracker's `TrimStepSheet`, for the fabric steps — kept as a sibling
 * rather than a shared component because the two trackers save to different
 * tables through different actions, and a prop that picks the table is the
 * shape that lets one board write to the other's marks.
 *
 * `size="sm"`, `alignToPane`, `origin`: AGENTS.md "A sub-detail Sheet's size".
 * It saves on its own, so its footer is Save / Cancel.
 */
export function FabricStepSheet({
  open,
  onClose,
  origin,
  salesOrderId,
  itemId,
  itemName,
  step,
  viewerEmployeeId,
  ownerName,
  today,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  origin?: DOMRect | null;
  salesOrderId: string;
  itemId: string;
  itemName: string;
  step: FabricTaStep;
  viewerEmployeeId: string | null;
  ownerName: string | null;
  today: string;
  /** After a save. The Fabric BOM tab passes its re-fetch — its data is
   *  client-loaded, so `router.refresh()` alone would not redraw it. */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const initial = {
    tolerance: String(step.tolerancePct),
    doneOn: step.actualSource === "manual" ? (step.actualDate ?? "") : "",
    remarks: step.remarks ?? "",
    owner: step.assignedStaffId,
  };
  const [form, setForm] = useState(initial);
  const dirty =
    form.tolerance !== initial.tolerance ||
    form.doneOn !== initial.doneOn ||
    form.remarks !== initial.remarks ||
    form.owner !== initial.owner;
  useUnsavedGuard(dirty || isPending);

  const tol = Number(form.tolerance);
  const tolBad = form.tolerance.trim() === "" || !Number.isFinite(tol) || tol < 0 || tol > MAX_TOLERANCE_PCT;

  function save() {
    if (tolBad) return;
    startTransition(async () => {
      const r = await saveFabricTaMark({
        salesOrderId,
        itemId,
        stepCode: step.code,
        tolerancePct: tol,
        doneOn: form.doneOn || null,
        remarks: form.remarks,
        assignedStaffId: form.owner,
      });
      if (!r.ok) {
        error(r.error);
        return;
      }
      success("Step updated");
      onClose();
      if (onSaved) onSaved();
      else router.refresh();
    });
  }

  const ownerLabel =
    form.owner == null
      ? "Unassigned"
      : form.owner === viewerEmployeeId
        ? "You"
        : form.owner === step.assignedStaffId
          ? (ownerName ?? "Assigned")
          : "Assigned";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      alignToPane
      origin={origin ?? undefined}
      title={`${step.number} · ${step.label}`}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending || tolBad || !dirty} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1 text-sm">
          <div className="font-semibold">{itemName}</div>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <StatusPill tone={FABRIC_TA_STATUS_TONE[step.status]}>{FABRIC_TA_STATUS_LABEL[step.status]}</StatusPill>
            <span>Target {fmtDate(step.target)}</span>
            <span>
              · {fmtNumber(step.doneQty)} of {step.requiredQty == null ? "—" : fmtNumber(step.requiredQty)} kg
            </span>
          </div>
          <div className="text-muted-foreground">{step.judgedBy}</div>
          {step.docCodes.length > 0 && <div className="text-muted-foreground">Documents: {step.docCodes.join(", ")}</div>}
        </div>

        <FieldRow>
          {/* 0–10 % — past that it is a different required quantity, which
              belongs on the Fabric BOM (0609's CHECK says the same). */}
          <Field label="Tolerance %" w="num" hint={tolBad ? `0 to ${MAX_TOLERANCE_PCT}` : undefined}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_TOLERANCE_PCT}
              step="0.5"
              value={form.tolerance}
              onChange={(e) => setForm((f) => ({ ...f, tolerance: e.target.value }))}
              aria-invalid={tolBad || undefined}
            />
          </Field>
          {/* `max={today}`: a done date cannot be in the future, and a 4-digit
              `max` also caps the year segment (the Date year cap rule). */}
          <Field label="Done on" w="range">
            <Input
              type="date"
              max={today}
              value={form.doneOn}
              onChange={(e) => setForm((f) => ({ ...f, doneOn: e.target.value }))}
            />
          </Field>
        </FieldRow>
        <p className="text-xs text-muted-foreground">
          Leave Done on blank to let the documents decide. Set it only for what the ERP cannot see — a PO raised
          outside it, or a knitter&apos;s receipt that was never entered.
        </p>

        <Field label="Remarks">
          <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
        </Field>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Owner:</span>
          <span className="font-medium">{ownerLabel}</span>
          {viewerEmployeeId && form.owner !== viewerEmployeeId && (
            <Button variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, owner: viewerEmployeeId }))}>
              Assign to me
            </Button>
          )}
          {form.owner && (
            <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, owner: null }))}>
              Release
            </Button>
          )}
          {!viewerEmployeeId && (
            <span className="text-xs text-muted-foreground">
              (your login is not linked to an employee, so it cannot take ownership)
            </span>
          )}
        </div>
      </div>
    </Sheet>
  );
}
