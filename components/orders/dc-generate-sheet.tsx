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
import { Select } from "@/components/ui/select";
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
  locations,
  defaultLocationId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  amendmentId: string;
  candidates: DcCandidate[];
  locations: { id: string; code: string; name: string }[];
  defaultLocationId: string | null;
  onDone: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [dcDate, setDcDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
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
      for (const g of groups) {
        const res = await createDcFromBom({
          amendmentId,
          vendorId: g.vendorId,
          dcDate,
          locationId: locationId || null,
          rowUids: g.rows.map((r) => r.rowUid),
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
      }
      success(
        codes.length === 1
          ? "Delivery Challan raised"
          : `${codes.length} Delivery Challans raised`,
      );
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
          {/* The goods physically leave from a PLACE, and only the operator
              knows which. Defaulted from the order, shown, and changeable. */}
          <Field label="Despatched from" size="md">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
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
