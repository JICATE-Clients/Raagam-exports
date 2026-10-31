"use client";

/**
 * Raise Out-Processing Delivery Challans from the Material BOM's Processes tab
 * (client 2026-08-21).
 *
 * ## IT GROUPS BY VENDOR, AND THAT IS THE WHOLE SHAPE OF IT
 *
 * Rule 55's challan accompanies the GOODS, so one consignment is one document.
 * Rows going to the same processor on the same day belong on one challan; rows
 * going to two processors are two. The operator does not choose that grouping —
 * the vendor on each row already decided it — so this states it rather than
 * asking, and creates one challan per group.
 *
 * It says "This will create N challans" out loud for the same reason: a button
 * that silently produces three legal documents when the operator expected one is
 * the kind of surprise that is discovered at the gate.
 */

import { useMemo, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { createDcFromBom } from "@/lib/purchase/dc-from-bom-actions";

export type DcCandidate = {
  rowUid: string;
  vendorId: string;
  vendorName: string;
  materialName: string;
  processName: string;
  qtyOut: number;
};

export function DcGenerateSheet({
  open,
  onClose,
  amendmentId,
  candidates,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  amendmentId: string;
  candidates: DcCandidate[];
  /** No longer shown: the DC leaves from the working unit, where its Process Order lives (0788). */
  locations?: { id: string; code: string; name: string }[];
  defaultLocationId?: string | null;
  onDone: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [dcDate, setDcDate] = useState(() => new Date().toISOString().slice(0, 10));
  /* THE JOB-WORK RATE per row (₹ per unit sent) — it goes on the Process Order raised with
     the challan (0788), and the draft bill on receipt is that rate × what was processed.
     Blank = 0: the order is still raised; the rate can be settled before the bill is paid. */
  const [rates, setRates] = useState<Record<string, string>>({});
  /* Everything is checked to begin with: the operator opened this having already
     decided to send material out. Unchecking is the exception. */
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const chosen = candidates.filter((c) => !skipped.has(c.rowUid));

  const groups = useMemo(() => {
    const by = new Map<string, { vendorName: string; rows: DcCandidate[] }>();
    for (const c of chosen) {
      const g = by.get(c.vendorId) ?? { vendorName: c.vendorName, rows: [] };
      g.rows.push(c);
      by.set(c.vendorId, g);
    }
    return [...by.entries()].map(([vendorId, g]) => ({ vendorId, ...g }));
  }, [chosen]);

  const toggle = (uid: string) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  function submit() {
    if (groups.length === 0) return;
    start(async () => {
      const codes: string[] = [];
      const drafts: string[] = [];
      for (const g of groups) {
        const res = await createDcFromBom({
          amendmentId,
          vendorId: g.vendorId,
          dcDate,
          locationId: null,
          rowUids: g.rows.map((r) => r.rowUid),
          rates: Object.fromEntries(
            g.rows.map((r) => [r.rowUid, parseFloat(rates[r.rowUid] ?? "") || 0]),
          ),
        });
        if (!res.ok) {
          /* STOPS AT THE FIRST FAILURE and reports it. The challans already
             written stay written — they are numbered documents, not a draft —
             so the message says how far it got rather than implying nothing
             happened. */
          toastError(
            codes.length
              ? `${codes.length} challan(s) raised, then: ${res.error}`
              : res.error,
          );
          onDone();
          return;
        }
        codes.push(res.dcId);
        if (!res.dispatched && res.note) drafts.push(`${g.vendorName}: ${res.note}`);
      }
      const raised =
        codes.length === 1 ? "Process Order and Delivery Challan raised" : `${codes.length} Process Orders and Delivery Challans raised`;
      if (drafts.length) toastError(`${raised}, but ${drafts.join("; ")}`);
      else success(`${raised} and dispatched`);
      onDone();
      onClose();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Send material out"
      fullScreen={false}
      size="lg"
      footer={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {groups.length === 0
              ? "Nothing selected"
              : `This will create ${groups.length} challan${groups.length === 1 ? "" : "s"}`}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="ml-auto">
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isPending || groups.length === 0}
            onClick={submit}
          >
            {isPending ? "Raising…" : "Raise challan"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <FieldGrid>
          <Field label="Challan date" size="md" required>
            <Input
              type="date"
              value={dcDate}
              onChange={(e) => setDcDate(e.target.value)}
            />
          </Field>
        </FieldGrid>

        {groups.map((g) => (
          <div key={g.vendorId} className="rounded-lg border border-border">
            <div className="border-b border-border bg-surface-muted px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.vendorName} &mdash; 1 challan, {g.rows.length} line
              {g.rows.length === 1 ? "" : "s"}
            </div>
            {g.rows.map((r) => (
              <label
                key={r.rowUid}
                className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <input
                  type="checkbox"
                  checked
                  onChange={() => toggle(r.rowUid)}
                  className="h-3.5 w-3.5"
                />
                <span className="min-w-0 flex-1 truncate text-[13px]">{r.materialName}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{r.processName}</span>
                <span className="shrink-0 tabular-nums text-[13px] font-medium">
                  {fmtNumber(r.qtyOut)}
                </span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  aria-label={`Job-work rate, ${r.materialName}`}
                  placeholder="Rate ₹"
                  className="h-8 w-24 shrink-0 text-right tabular-nums"
                  value={rates[r.rowUid] ?? ""}
                  onChange={(e) => setRates((prev) => ({ ...prev, [r.rowUid]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        ))}

        {candidates
          .filter((c) => skipped.has(c.rowUid))
          .map((c) => (
            <label
              key={c.rowUid}
              className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 opacity-60"
            >
              <input
                type="checkbox"
                checked={false}
                onChange={() => toggle(c.rowUid)}
                className="h-3.5 w-3.5"
              />
              <span className="min-w-0 flex-1 truncate text-[13px]">{c.materialName}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">not being sent</span>
            </label>
          ))}
      </div>
    </Sheet>
  );
}
