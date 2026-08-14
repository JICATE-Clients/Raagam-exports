"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addIwoLine,
  deleteIwoLine,
  setIwoStatus,
} from "@/lib/orders/internal-work-orders/actions";
import {
  IWO_STATUS_LABELS,
  iwoStatusTone,
  type IwoLine,
  type IwoStatus,
} from "@/lib/orders/internal-work-orders/types";
import type { IwoDetail as IwoDetailType } from "@/lib/orders/internal-work-orders/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtNumber, fmtDate } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";

interface Props {
  iwo: IwoDetailType;
  lines: IwoLine[];
  canEdit: boolean;
  canDelete: boolean;
}

export function IwoDetail({ iwo, lines, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");

  // Expand-in-place form, invisible to the guard's DOM scan — see
  // new-order-form.tsx.
  useUnsavedGuard(formOpen || isPending);

  function resetForm() {
    setDescription("");
    setQuantity("");
    setUnit("");
    setNotes("");
    setFormOpen(false);
  }

  function handleAddLine(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await addIwoLine(iwo.id, {
        description: description.trim(),
        quantity: Number(quantity) || 0,
        unit: unit.trim() || null,
        notes: notes.trim() || null,
        sort_order: (lines.length + 1) * 10,
      });
      if (result.ok) {
        success("Line added");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDeleteLine(lineId: string) {
    startTransition(async () => {
      const result = await deleteIwoLine(lineId, iwo.id);
      if (result.ok) {
        success("Line removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function changeStatus(status: IwoStatus, msg: string) {
    startTransition(async () => {
      const result = await setIwoStatus(iwo.id, status);
      if (result.ok) {
        success(msg);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const lineColumns: Column<IwoLine>[] = [
    {
      header: "Description",
      cell: (l) => <span className="text-sm font-medium">{l.description}</span>,
    },
    {
      header: "Qty",
      align: "right",
      cell: (l) => <span className="tabular-nums text-sm">{fmtNumber(l.quantity)}</span>,
    },
    {
      header: "Unit",
      cell: (l) => <span className="text-sm text-muted-foreground">{l.unit ?? "—"}</span>,
    },
    {
      header: "Notes",
      cell: (l) => (
        <span className="text-sm text-muted-foreground">{l.notes ?? "—"}</span>
      ),
    },
    ...(canDelete
      ? [
          rowActionsColumn<IwoLine>((l) => (
            <RowActions
              onDelete={() => handleDeleteLine(l.id)}
              isPending={isPending}
            />
          )),
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle>Work order</CardTitle>
          <div className="flex items-center gap-2">
            <StatusPill tone={iwoStatusTone(iwo.status)}>
              {IWO_STATUS_LABELS[iwo.status]}
            </StatusPill>
            {canEdit && iwo.status === "draft" && (
              <Button
                size="sm"
                onClick={() => changeStatus("issued", "Work order issued")}
                disabled={isPending}
              >
                Issue
              </Button>
            )}
            {canEdit && iwo.status === "issued" && (
              <Button
                size="sm"
                onClick={() => changeStatus("completed", "Work order completed")}
                disabled={isPending}
              >
                Mark complete
              </Button>
            )}
            {canEdit && (iwo.status === "draft" || iwo.status === "issued") && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => changeStatus("cancelled", "Work order cancelled")}
                disabled={isPending}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody>
          {/* A READ-ONLY BAND ON THE FIELD TRACK, not its own `grid-cols-2
              sm:grid-cols-4`. `Field` gives the label and the ~280px slot; the
              children stay plain text rather than becoming `readOnly` inputs,
              because these are facts being reported, not values being edited,
              and boxing them would invite a click that does nothing.

              Same trade as `color-card-detail.tsx`: it costs the `<dl>/<dt>/<dd>`
              grouping, so the pairs are no longer announced as ONE list, but each
              stays a labelled value and the whole card shares the left edge and
              width of the form beneath it.

              Found only because this file gained a layout primitive — the audit
              skips any file with none, so this grid had been invisible. */}
          <FieldGrid>
            <Field label="Code" size="sm">
              <div className="font-mono text-sm font-medium">{iwo.code ?? "—"}</div>
            </Field>
            <Field label="Type" size="sm">
              <div className="text-sm font-medium">{iwo.iwo_type ?? "—"}</div>
            </Field>
            <Field label="Order" size="sm">
              <div className="text-sm font-medium">
                {iwo.sales_order_id ? (
                  <Link
                    href={`/orders/${iwo.sales_order_id}`}
                    className="text-primary hover:underline"
                  >
                    {iwo.sales_orders?.order_number ?? "—"}
                  </Link>
                ) : (
                  "—"
                )}
              </div>
            </Field>
            <Field label="Customer" size="sm">
              <div className="text-sm font-medium">{iwo.customer?.name ?? "—"}</div>
            </Field>
            <Field label="Style" size="sm">
              <div className="text-sm font-medium">{iwo.style?.style_name ?? "—"}</div>
            </Field>
            <Field label="Deli Dt" size="sm">
              <div className="text-sm font-medium tabular-nums">{fmtDate(iwo.deli_date)}</div>
            </Field>
            <Field label="Unit / Location" size="sm">
              <div className="text-sm font-medium">
                {iwo.locations ? iwo.locations.name : "—"}
              </div>
            </Field>
            <Field label="Issued" size="sm">
              <div className="text-sm font-medium tabular-nums">{fmtDate(iwo.issued_at)}</div>
            </Field>
            {iwo.instructions && (
              // `full` is the row — instructions run long and read badly in a
              // quarter of one.
              <Field label="Instructions" size="full">
                <div className="text-sm">{iwo.instructions}</div>
              </Field>
            )}
          </FieldGrid>
        </CardBody>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Lines ({lines.length})</CardTitle>
          {canEdit && !formOpen && (
            <Button size="sm" variant="subtle" onClick={() => setFormOpen(true)}>
              + Add line
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-3">
          <DataTable
            columns={lineColumns}
            rows={lines}
            getKey={(l) => l.id}
            empty="No lines yet."
          />

          {canEdit && formOpen && (
            <form
              // ONE MARKER, NEVER A HANDLER. Without it `isEditorScope()` is
              // false, so Tab keeps native order, leaves the form and stops on
              // buttons — one of the ~51 page-level editors AGENTS.md counts as
              // missing this. See the `raagam-keyboard-contract` skill.
              data-focus-scope
              onSubmit={handleAddLine}
              className="space-y-3 rounded-md border border-border bg-surface-muted p-3"
            >
              {/* `FieldGrid` and one field width, in place of a
                  `flex flex-wrap items-end gap-3` of `w-24` / `min-w-48 flex-1`
                  boxes. Sizing each control to its own data is what LAYOUT.md §3
                  fixes a field at ~280px to avoid — nothing lined up with the
                  lines table above it. */}
              <FieldGrid>
                {/* `required` on the Field, not a `*` typed into the label — the
                    same prop draws the star AND stamps `data-required-empty`, so
                    the cursor holds on a blank box. Typed by hand it was
                    decoration and Tab walked straight past. */}
                <Field label="Description" required size="sm" htmlFor="l-desc">
                  <Input
                    id="l-desc"
                    uppercase
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Body panels"
                    required
                  />
                </Field>
                <Field label="Qty" size="sm" htmlFor="l-qty">
                  <Input
                    id="l-qty"
                    type="number"
                    min="0"
                    step="0.01"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label="Unit" size="sm" htmlFor="l-unit">
                  <Input
                    id="l-unit"
                    uppercase
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="pcs"
                  />
                </Field>
                <Field label="Notes" size="sm" htmlFor="l-notes">
                  <Input
                    id="l-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
              </FieldGrid>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending || !description.trim()}
                >
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
    </div>
  );
}
