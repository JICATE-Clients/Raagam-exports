"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { fmtNumber } from "@/lib/format";

/**
 * QC FAILED → REJECTION OR REPLACEMENT (user 2026-10-31, doc/purchase/grn.md §2B–C).
 * Opened the moment a line's QC is set to Failed. Two explicit choices, each saying what
 * posting the GRN will then do — the operator is choosing a consequence, not a word:
 *
 *   Rejection   — Debit Note against the invoice + Rejection DC; the PO line is closed by
 *                 that qty and the requirement reopens, so a fresh PO can be raised.
 *   Replacement — Replacement DC, NO debit note; the qty stays owed on the same PO and
 *                 arrives as a Replacement GRN, raising no new bill.
 *
 * Stored as `rejection_action` 'return' | 'replace' (0780) — the columns did not change.
 */
export type QcFailChoice = { qty: number; reason: string; action: "replace" | "return" };

const CHOICES: { value: "return" | "replace"; title: string; lines: string[] }[] = [
  {
    value: "return",
    title: "Rejection",
    lines: ["Debit Note against the vendor's invoice", "Rejection DC sends the goods back", "Requirement reopens for a fresh PO"],
  },
  {
    value: "replace",
    title: "Replacement",
    lines: ["Replacement DC sends the goods back", "No debit note — the invoice stands", "Vendor resends on the same PO (Replacement GRN)"],
  },
];

export function QcFailedSheet({
  open,
  description,
  received,
  initial,
  isReplacement,
  onConfirm,
  onClose,
}: {
  open: boolean;
  description: string;
  received: number;
  initial?: QcFailChoice | null;
  /** A Replacement GRN's own failure is still owed on the same DC — no choice offered. */
  isReplacement: boolean;
  onConfirm: (choice: QcFailChoice) => void;
  onClose: () => void;
}) {
  // Remounted per open (keyed by the caller), so the state seeds from `initial` each time.
  const [qty, setQty] = useState(() => (initial?.qty ? String(initial.qty) : received > 0 ? String(received) : ""));
  const [reason, setReason] = useState(initial?.reason ?? "QC FAILED");
  const [action, setAction] = useState<"replace" | "return">(isReplacement ? "replace" : (initial?.action ?? "return"));

  const n = parseFloat(qty);
  const problem =
    !Number.isFinite(n) || n <= 0
      ? "Enter the failed qty"
      : n > received
        ? `More than received (${fmtNumber(received)})`
        : !reason.trim()
          ? "Enter a reason"
          : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      alignToPane
      title="QC Failed"
      footer={
        <div data-focus-region="footer" className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!problem} onClick={() => onConfirm({ qty: n, reason: reason.trim(), action })}>
            {isReplacement ? "Confirm" : action === "return" ? "Confirm Rejection" : "Confirm Replacement"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm">
          {description} <span className="text-muted-foreground">— received {fmtNumber(received)}</span>
        </p>
        <FieldRow>
          <Field label="Failed Qty" required w="hug" htmlFor="qc-fail-qty" error={qty !== "" && problem?.startsWith("More") ? problem : null}>
            <Input
              id="qc-fail-qty"
              type="number"
              min={0}
              max={received}
              inputMode="decimal"
              className="text-right tabular-nums"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </Field>
          <Field label="Reason" required w="term" htmlFor="qc-fail-reason">
            <Input id="qc-fail-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </FieldRow>
        {isReplacement ? (
          <p className="text-xs text-muted-foreground">
            This is a replacement delivery: the failed qty goes back on a Replacement DC and stays owed by the vendor.
          </p>
        ) : (
          <div role="radiogroup" aria-label="What happens to the failed goods" className="grid grid-cols-2 gap-2">
            {CHOICES.map((c) => {
              const on = action === c.value;
              return (
                // button-shape: exempt -- a two-way choice card with three lines of consequence, not an action button
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setAction(c.value)}
                  className={
                    "rounded-control border p-3 text-left transition-colors " +
                    (on ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50")
                  }
                >
                  <div className="text-sm font-semibold">{c.title}</div>
                  <ul className="mt-1 space-y-0.5 text-[11.5px] text-muted-foreground">
                    {c.lines.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
