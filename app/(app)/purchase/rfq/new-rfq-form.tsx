"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createRfq } from "@/lib/purchase/po-actions";
import type { RfqInput, RfqLineInput } from "@/lib/purchase/types";
import type { BudgetForPicker } from "@/lib/purchase/po-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

type LineFields = {
  description: string;
  quantity: string;
};

function emptyLine(): LineFields {
  return { description: "", quantity: "1" };
}

export function NewRfqForm({ budgets }: { budgets: BudgetForPicker[] }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [show, setShow] = useState(false);
  useCreateIntent(() => setShow(true));
  const [title, setTitle] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineFields[]>([emptyLine()]);

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof LineFields, value: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)),
    );
  }

  function reset() {
    setTitle("");
    setBudgetId("");
    setNotes("");
    setLines([emptyLine()]);
    setShow(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const rfqLines: RfqLineInput[] = lines
      .filter((l) => l.description.trim())
      .map((l, i) => ({
        description: l.description.trim(),
        quantity: parseFloat(l.quantity) || 1,
        item_id: null,
        uom_id: null,
        sort_order: i,
      }));

    const payload: RfqInput = {
      title: title.trim(),
      budget_id: budgetId || null,
      notes: notes.trim() || null,
      lines: rfqLines,
    };

    startTransition(async () => {
      const result = await createRfq(payload);
      if (result.ok) {
        success("RFQ created.");
        reset();
        router.push(`/purchase/rfq/${result.rfqId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!show) {
    return (
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShow(true)}>
          + New RFQ
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New RFQ</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="rfq-title">Title *</Label>
              <Input
                id="rfq-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Cotton yarn Q3 purchase"
                required
              />
            </div>

            {budgets.length > 0 && (
              <div>
                <Label htmlFor="rfq-budget">Budget (optional)</Label>
                <Select
                  id="rfq-budget"
                  value={budgetId}
                  onChange={(e) => setBudgetId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {budgets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className={budgets.length > 0 ? "" : "sm:col-span-2"}>
              <Label htmlFor="rfq-notes">Notes</Label>
              <Textarea
                id="rfq-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Specifications, delivery requirements…"
              />
            </div>
          </div>

          {/* Lines */}
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Line items
            </p>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder="Description *"
                      value={line.description}
                      onChange={(e) =>
                        updateLine(idx, "description", e.target.value)
                      }
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(idx, "quantity", e.target.value)
                      }
                    />
                  </div>
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-danger hover:text-danger shrink-0"
                      onClick={() => removeLine(idx)}
                    >
                      ×
                    </Button>
                  )}
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

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={reset}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !title.trim()}
            >
              {isPending ? "Creating…" : "Create RFQ"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
