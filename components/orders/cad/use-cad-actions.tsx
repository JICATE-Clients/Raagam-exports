"use client";

/**
 * The CAD lifecycle's row behaviour, ONCE — read by Orders ▸ CAD ▸ CAD
 * Lifecycle (every order's styles, the CAD team's work list) and by Order
 * Entry ▸ CAD (one order's styles, the merchandiser's view). User 2026-09-24:
 * "Both" — so the two surfaces must never offer different steps for the same
 * style. Each owns only its table; the next step, the corrections menu and the
 * four sheets come from here.
 *
 * `onChanged` runs after every successful write. The listing page needs
 * nothing (the actions revalidate its route); the Order Entry tab reads its
 * rows itself, so it re-reads.
 */

import { useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { RowMenuItem } from "@/components/ui/row-actions";
import type { SheetOrigin } from "@/components/ui/sheet";
import { cadNextStep, latestVersion, type CadStyleRow, type PatternMakerRow } from "@/lib/orders/cad-lifecycle/types";
import { deleteCadAllocation, reopenCadDecision, undoCadDispatch } from "@/lib/orders/cad-lifecycle/actions";
import { AllocationSheet, DecisionSheet, DispatchSheet, HistorySheet, type AllocationMode } from "./cad-sheets";

type Open =
  | { kind: "allocate"; mode: AllocationMode; row: CadStyleRow; origin: SheetOrigin | null }
  | { kind: "dispatch" | "decide" | "history"; row: CadStyleRow; origin: SheetOrigin | null }
  | null;

export const CAD_STEP_LABEL = {
  allocate: "Allocate",
  dispatch: "Dispatch",
  decide: "Record decision",
  reallocate: "Re-allocate",
} as const;

export function useCadActions({
  employees,
  canEdit,
  onChanged,
}: {
  employees: PatternMakerRow[];
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [isPending, start] = useTransition();

  const originOf = (e: MouseEvent<HTMLElement>) => e.currentTarget.getBoundingClientRect();

  function startStep(r: CadStyleRow, origin: SheetOrigin | null) {
    const step = cadNextStep(r.state);
    if (step === "allocate") setOpen({ kind: "allocate", mode: "new", row: r, origin });
    else if (step === "reallocate") setOpen({ kind: "allocate", mode: "reallocate", row: r, origin });
    else if (step === "dispatch") setOpen({ kind: "dispatch", row: r, origin });
    else if (step === "decide") setOpen({ kind: "decide", row: r, origin });
  }

  const showHistory = (r: CadStyleRow, origin: SheetOrigin | null = null) =>
    setOpen({ kind: "history", row: r, origin });

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Failed");
      else {
        toast.success(done);
        onChanged?.();
      }
    });
  }

  /** The corrections — each bounded exactly as 0628 bounds it. */
  function menuFor(r: CadStyleRow): RowMenuItem[] {
    if (!canEdit) return [];
    const v = latestVersion(r.versions);
    if (!v) return [];
    if (!v.dispatch) {
      return [
        {
          label: `Edit V${v.version_no} allocation`,
          onClick: () => setOpen({ kind: "allocate", mode: "edit", row: r, origin: null }),
        },
        {
          label: `Delete V${v.version_no} allocation`,
          danger: true,
          onClick: () => run(() => deleteCadAllocation(v.id), `V${v.version_no} allocation deleted`),
        },
      ];
    }
    if (v.decision?.status === "pending") {
      return [
        { label: "Undo dispatch", danger: true, onClick: () => run(() => undoCadDispatch(v.dispatch!.id), "Dispatch undone") },
      ];
    }
    return [
      {
        label: "Reopen decision",
        onClick: () => run(() => reopenCadDecision(v.dispatch!.id), "Decision reopened — awaiting buyer"),
      },
    ];
  }

  /** The row's next-step button, or nothing when there is no step to take. */
  function stepButton(r: CadStyleRow): ReactNode {
    const step = cadNextStep(r.state);
    if (!step || !canEdit || !r.on_order) return null;
    return (
      <Button
        type="button"
        size="sm"
        variant={step === "decide" ? "primary" : "outline"}
        disabled={isPending}
        // A marker, never a handler — the row's keyboard axis reaches it like a
        // cell (the Fabric BOM Components [Click] precedent).
        data-row-open
        onClick={(e) => startStep(r, originOf(e))}
      >
        {CAD_STEP_LABEL[step]}
      </Button>
    );
  }

  const close = (changed: boolean) => {
    setOpen(null);
    if (changed) onChanged?.();
  };

  /* A sheet closes on Cancel and on success alike, so the re-read runs on every
     close of a WRITING sheet — one cheap read, never a stale row. */
  const sheets = (
    <>
      {open?.kind === "allocate" && (
        <AllocationSheet row={open.row} mode={open.mode} employees={employees} origin={open.origin} onClose={() => close(true)} />
      )}
      {open?.kind === "dispatch" && <DispatchSheet row={open.row} origin={open.origin} onClose={() => close(true)} />}
      {open?.kind === "decide" && <DecisionSheet row={open.row} origin={open.origin} onClose={() => close(true)} />}
      {open?.kind === "history" && <HistorySheet row={open.row} origin={open.origin} onClose={() => close(false)} />}
    </>
  );

  return { startStep, showHistory, menuFor, stepButton, sheets, isPending };
}
