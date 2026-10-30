"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/format";
import { hhmm, type TimeoffRequest } from "@/lib/hr/timeoff-types";

/** Shared pieces of the HR ▸ Time Off screens (0765). */

/** One label/value line of a record summary. */
export function Fact({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={className}>{children}</dd>
    </div>
  );
}

/** The leave type's colour, as a dot before its name. */
export function TypeDot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

/** "12/11/2026", "12/11/2026 (1st half)", "12/11/2026 10:00–11:30", "12/11 → 14/11/2026". */
export function whenOf(r: Pick<TimeoffRequest, "start_date" | "end_date" | "day_part" | "start_time" | "end_time">): string {
  if (r.day_part === "hourly") return `${fmtDate(r.start_date)} ${hhmm(r.start_time)}–${hhmm(r.end_time)}`;
  if (r.start_date === r.end_date) {
    if (r.day_part === "first_half") return `${fmtDate(r.start_date)} (1st half)`;
    if (r.day_part === "second_half") return `${fmtDate(r.start_date)} (2nd half)`;
    return fmtDate(r.start_date);
  }
  return `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`;
}

/**
 * A small sheet that asks for a reason before a consequential step — withdraw,
 * cancel, revoke, reject. The reason is mandatory everywhere it is used, as in
 * the database.
 */
export function ReasonSheet({
  open,
  title,
  intro,
  confirmLabel,
  danger = false,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  intro: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Sheet
      open={open}
      onClose={() => {
        setReason("");
        onClose();
      }}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy || !reason.trim()}
            onClick={() => {
              onConfirm(reason);
              setReason("");
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <div>{intro}</div>
        <Field label="Reason" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
