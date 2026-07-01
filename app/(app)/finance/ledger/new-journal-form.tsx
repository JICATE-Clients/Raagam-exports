"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JournalEntryInput, JournalLineInput } from "@/lib/finance/types";
import { createJournal } from "@/lib/finance/gl-actions";
import type { GlAccountForPicker, LocationForPicker } from "@/lib/finance/gl-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

type LineFields = { gl_account_id: string; debit: string; credit: string; description: string };

function emptyLine(): LineFields {
  return { gl_account_id: "", debit: "0", credit: "0", description: "" };
}

function parseMoney(v: string): number {
  return Math.max(0, parseFloat(v) || 0);
}

export function NewJournalForm({
  accounts,
  locations,
}: {
  accounts: GlAccountForPicker[];
  locations: LocationForPicker[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [show, setShow] = useState(false);

  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [locationId, setLocationId] = useState("");
  const [lines, setLines] = useState<LineFields[]>([emptyLine(), emptyLine()]);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number) {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof LineFields, value: string) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const updated = { ...l, [field]: value };
        // clear opposing side when entering an amount
        if (field === "debit" && parseFloat(value) > 0) updated.credit = "0";
        if (field === "credit" && parseFloat(value) > 0) updated.debit = "0";
        return updated;
      }),
    );
  }

  const totalDebit = lines.reduce((s, l) => s + parseMoney(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + parseMoney(l.credit), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  function reset() {
    setEntryDate(new Date().toISOString().slice(0, 10));
    setNarration("");
    setLocationId("");
    setLines([emptyLine(), emptyLine()]);
    setShow(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!balanced) return;

    const journalLines: JournalLineInput[] = lines
      .filter((l) => l.gl_account_id)
      .map((l, i) => ({
        gl_account_id: l.gl_account_id,
        debit: parseMoney(l.debit),
        credit: parseMoney(l.credit),
        description: l.description.trim() || null,
        sort_order: i,
      }));

    const payload: JournalEntryInput = {
      entry_date: entryDate,
      narration: narration.trim() || null,
      location_id: locationId || null,
      lines: journalLines,
    };

    startTransition(async () => {
      const result = await createJournal(payload);
      if (result.ok) {
        success("Journal entry created.");
        router.push(`/finance/ledger/${result.entryId}`);
        reset();
      } else {
        toastError(result.error);
      }
    });
  }

  if (!show) {
    return (
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShow(true)}>
          + New Journal
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Journal Entry</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Header */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="je-date">Entry date *</Label>
              <Input
                id="je-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                required
              />
            </div>

            {locations.length > 0 && (
              <div>
                <Label htmlFor="je-location">Location</Label>
                <Select
                  id="je-location"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">— All locations —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="sm:col-span-3">
              <Label htmlFor="je-narration">Narration</Label>
              <Textarea
                id="je-narration"
                rows={2}
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="Brief description of this journal entry…"
              />
            </div>
          </div>

          {/* Lines */}
          <div>
            <div className="mb-1 grid grid-cols-[1fr_6rem_6rem_1fr_auto] gap-2 px-1 text-xs font-semibold text-muted-foreground">
              <span>Account</span>
              <span className="text-right">Debit</span>
              <span className="text-right">Credit</span>
              <span>Description</span>
              <span />
            </div>
            <div className="space-y-1.5">
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_6rem_6rem_1fr_auto] items-center gap-2"
                >
                  <Select
                    value={line.gl_account_id}
                    onChange={(e) => updateLine(idx, "gl_account_id", e.target.value)}
                  >
                    <option value="">— Account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.debit}
                    onChange={(e) => updateLine(idx, "debit", e.target.value)}
                    className="text-right tabular-nums"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.credit}
                    onChange={(e) => updateLine(idx, "credit", e.target.value)}
                    className="text-right tabular-nums"
                  />
                  <Input
                    placeholder="Note"
                    value={line.description}
                    onChange={(e) => updateLine(idx, "description", e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(idx)}
                    disabled={lines.length <= 2}
                    className="shrink-0 text-muted-foreground hover:text-danger"
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={addLine}
            >
              + Add line
            </Button>
          </div>

          {/* Totals + balance indicator */}
          <div className="flex items-center justify-between rounded-md border border-border bg-surface-muted px-4 py-2 text-sm">
            <span className="text-muted-foreground">Totals</span>
            <span className="tabular-nums">
              Dr {totalDebit.toFixed(2)} / Cr {totalCredit.toFixed(2)}
            </span>
            <span
              className={
                balanced
                  ? "text-xs font-semibold text-success"
                  : "text-xs font-semibold text-danger"
              }
            >
              {balanced ? "Balanced" : "Not balanced"}
            </span>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !balanced}
              title={!balanced ? "Journal must be balanced before saving" : undefined}
            >
              {isPending ? "Saving…" : "Save as Draft"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
