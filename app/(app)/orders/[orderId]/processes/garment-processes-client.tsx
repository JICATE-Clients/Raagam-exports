"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  addOrderProcess,
  deleteOrderProcess,
} from "@/lib/orders/garment-processes/actions";
import {
  PROCESS_MODES,
  PROCESS_MODE_LABELS,
  processModeTone,
  COMMON_PROCESSES,
  type OrderGarmentProcess,
  type ProcessMode,
} from "@/lib/orders/garment-processes/types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";

interface Props {
  orderId: string;
  processes: OrderGarmentProcess[];
  canCreate: boolean;
  canDelete: boolean;
}

export function GarmentProcessesClient({
  orderId,
  processes,
  canCreate,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<ProcessMode>("in_house");
  const [notes, setNotes] = useState("");

  // Expand-in-place form, invisible to the guard's DOM scan — see
  // new-order-form.tsx.
  useUnsavedGuard(formOpen || isPending);

  function resetForm() {
    setName("");
    setMode("in_house");
    setNotes("");
    setFormOpen(false);
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    // next sequence = last + 10 (leaves room to re-order later)
    const nextSeq =
      (processes.reduce((max, p) => Math.max(max, p.sequence), 0) || 0) + 10;
    startTransition(async () => {
      const result = await addOrderProcess({
        sales_order_id: orderId,
        name: name.trim(),
        mode,
        sequence: nextSeq,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        success("Process added");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(processId: string) {
    startTransition(async () => {
      const result = await deleteOrderProcess(processId, orderId);
      if (result.ok) {
        success("Process removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<OrderGarmentProcess>[] = [
    {
      header: "#",
      cell: (p) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {p.sequence}
        </span>
      ),
    },
    { header: "Process", cell: (p) => <span className="text-sm font-medium">{p.name}</span> },
    {
      header: "Mode",
      cell: (p) => (
        <StatusPill tone={processModeTone(p.mode)}>
          {PROCESS_MODE_LABELS[p.mode]}
        </StatusPill>
      ),
    },
    {
      header: "Notes",
      cell: (p) => (
        <span className="text-sm text-muted-foreground">{p.notes ?? "—"}</span>
      ),
    },
    ...(canDelete
      ? [
          rowActionsColumn<OrderGarmentProcess>((p) => (
            <RowActions
              onDelete={() => handleDelete(p.id)}
              isPending={isPending}
            />
          )),
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Process sequence ({processes.length})</CardTitle>
        {canCreate && !formOpen && (
          <Button size="sm" variant="subtle" onClick={() => setFormOpen(true)}>
            + Add process
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        <DataTable
          columns={columns}
          rows={processes}
          getKey={(p) => p.id}
          empty="No garment processes defined yet — add the first step below."
        />

        {canCreate && formOpen && (
          <form
            // ONE MARKER, NEVER A HANDLER. Without it `isEditorScope()` is
            // false, so Tab keeps native order, leaves the form and stops on
            // buttons — one of the ~51 page-level editors AGENTS.md counts as
            // missing this. See the `raagam-keyboard-contract` skill.
            data-focus-scope
            onSubmit={handleAdd}
            className="space-y-3 rounded-md border border-border bg-surface-muted p-3"
          >
            {/* `FieldGrid` and one field width, in place of a
                `flex flex-wrap items-end gap-3` of `w-40` / `w-36` boxes.
                Sizing each control to its own data is what LAYOUT.md §3 fixes a
                field at ~280px to avoid. */}
            <FieldGrid>
              {/* `required` on the Field, not a `*` typed into the label — the
                  same prop draws the star AND stamps `data-required-empty`, so
                  the cursor holds on a blank box. */}
              <Field label="Process" required size="sm" htmlFor="gp-name">
                <Input
                  id="gp-name"
                  uppercase
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  list="common-processes"
                  required
                />
                {/* The datalist stays INSIDE the field: it is referenced by the
                    input's `list` and renders nothing itself, so it belongs with
                    the control it feeds rather than loose in the form. */}
                <datalist id="common-processes">
                  {COMMON_PROCESSES.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>
              <Field label="Mode" size="sm" htmlFor="gp-mode">
                <Select
                  id="gp-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ProcessMode)}
                >
                  {PROCESS_MODES.map((m) => (
                    <option key={m} value={m}>
                      {PROCESS_MODE_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notes" size="sm" htmlFor="gp-notes">
                <Input
                  id="gp-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
            </FieldGrid>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
                {isPending ? "Adding…" : "Add"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
