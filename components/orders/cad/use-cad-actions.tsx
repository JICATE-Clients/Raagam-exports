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
import { useRouter } from "next/navigation";
import { findOrderReport, orderReportHref } from "@/lib/orders/order-reports";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { RowMenuItem } from "@/components/ui/row-actions";
import type { SheetOrigin } from "@/components/ui/sheet";
import { cadNextStep, latestVersion, type CadStyleRow, type PatternMakerRow } from "@/lib/orders/cad-lifecycle/types";
import { deleteCadAllocation, reopenCadDecision, undoCadDispatch } from "@/lib/orders/cad-lifecycle/actions";
import { AllocationSheet, DecisionSheet, DispatchSheet, HistorySheet, type AllocationMode } from "./cad-sheets";
import { PatternWorkForm } from "./cad-pattern-work";

type Open =
  | { kind: "allocate"; mode: AllocationMode; row: CadStyleRow; origin: SheetOrigin | null }
  | { kind: "dispatch" | "decide" | "history" | "pattern"; row: CadStyleRow; origin: SheetOrigin | null }
  | null;

export const CAD_STEP_LABEL = {
  allocate: "Assign CAD",
  dispatch: "Send CAD",
  decide: "CAD Approval",
  reallocate: "Re-assign CAD",
  /** 0638 — the dispatch step while the pattern is not Ready yet. */
  pattern: "Pattern Status",
} as const;

export function useCadActions({
  employees,
  canEdit,
  onChanged,
  assignOnly = false,
}: {
  employees: PatternMakerRow[];
  canEdit: boolean;
  onChanged?: () => void;
  /** Order Entry ▸ CAD: assign only — no Pattern Sheet in the menu (user 2026-09-25). */
  assignOnly?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [isPending, start] = useTransition();

  const originOf = (e: MouseEvent<HTMLElement>) => e.currentTarget.getBoundingClientRect();

  function startStep(r: CadStyleRow, origin: SheetOrigin | null) {
    const step = cadNextStep(r.state);
    if (step === "allocate") setOpen({ kind: "allocate", mode: "new", row: r, origin });
    else if (step === "reallocate") setOpen({ kind: "allocate", mode: "reallocate", row: r, origin });
    // 0638: Send only once the Pattern Master has marked the pattern Ready;
    // until then the step IS the pattern work (status + Order Sheet).
    else if (step === "dispatch")
      setOpen({ kind: latestVersion(r.versions)?.pattern_status === "ready" ? "dispatch" : "pattern", row: r, origin });
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

  /**
   * VIEW ORDER SHEET, on every row, for everyone who can see the row
   * (2026-09-25 spec: "a direct View Order Sheet action on each queue card so
   * the pattern maker can open the full Garment Order Sheet"). The href comes
   * from the ORDER_REPORTS registry, never typed here (AGENTS.md "An order's
   * reports are declared once").
   */
  function viewItems(r: CadStyleRow): RowMenuItem[] {
    const gos = findOrderReport("gos");
    if (!gos || !r.sales_order_id) return [];
    const href = orderReportHref(r.sales_order_id, gos);
    return [{ label: "View Order Sheet", onClick: () => router.push(href) }];
  }

  /** The corrections — each bounded exactly as 0628 bounds it — after View Order Sheet. */
  function menuFor(r: CadStyleRow): RowMenuItem[] {
    return [...viewItems(r), ...correctionsFor(r)];
  }

  function correctionsFor(r: CadStyleRow): RowMenuItem[] {
    if (!canEdit) return [];
    const v = latestVersion(r.versions);
    if (!v) return [];
    if (!v.dispatch) {
      return [
        // PATTERN SHEET + DELETE. "Edit V1 assignment" went on 2026-09-25
        // (screenshot 3071) and the delete is just "Delete". The Pattern sheet
        // came HERE the same day (screenshot 3076: "move this to CAD queue …
        // Order Entry just assign only") — it is the Pattern Maker's form, and
        // the queue is the Pattern Maker's screen.
        ...(assignOnly
          ? []
          : [{ label: "Pattern Sheet", onClick: () => setOpen({ kind: "pattern", row: r, origin: null }) }]),
        {
          label: "Delete",
          danger: true,
          onClick: () => run(() => deleteCadAllocation(v.id), "CAD assignment deleted"),
        },
      ];
    }
    if (v.decision?.status === "pending") {
      return [
        { label: "Undo send", danger: true, onClick: () => run(() => undoCadDispatch(v.dispatch!.id), "Send undone") },
      ];
    }
    return [
      {
        label: "Reopen decision",
        onClick: () => run(() => reopenCadDecision(v.dispatch!.id), "Decision reopened — awaiting buyer"),
      },
    ];
  }

  /** The next step's WORD for a row — the same label the button and the menu item show. */
  function stepLabel(r: CadStyleRow): string | null {
    const step = cadNextStep(r.state);
    if (!step) return null;
    return step === "dispatch" && latestVersion(r.versions)?.pattern_status !== "ready"
      ? CAD_STEP_LABEL.pattern
      : CAD_STEP_LABEL[step];
  }

  /**
   * The next step as a MENU ITEM — for a list that shows no Next column (the
   * CAD Queue since 2026-09-25). Same gate as the button: editable, on the order.
   */
  function stepItems(r: CadStyleRow): RowMenuItem[] {
    const label = stepLabel(r);
    if (!label || !canEdit || !r.on_order) return [];
    // No "Pattern Status" item (user 2026-09-25, screenshot 3071): the status
    // is set on Order Entry ▸ CAD. Once it is Ready the step is Send CAD again.
    if (label === CAD_STEP_LABEL.pattern) return [];
    return [{ label, onClick: () => startStep(r, null) }];
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
        {stepLabel(r)}
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
      {open?.kind === "pattern" && <PatternWorkForm row={open.row} origin={open.origin} onClose={() => close(true)} />}
      {open?.kind === "dispatch" && <DispatchSheet row={open.row} origin={open.origin} onClose={() => close(true)} />}
      {open?.kind === "decide" && <DecisionSheet row={open.row} origin={open.origin} onClose={() => close(true)} />}
      {open?.kind === "history" && <HistorySheet row={open.row} origin={open.origin} onClose={() => close(false)} />}
    </>
  );

  return { startStep, showHistory, menuFor, stepItems, stepButton, sheets, isPending };
}
