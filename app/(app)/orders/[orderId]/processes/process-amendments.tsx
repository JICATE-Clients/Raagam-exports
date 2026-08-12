"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  raiseProcessAmendment,
  approveProcessAmendment,
  rejectProcessAmendment,
} from "@/lib/orders/garment-processes/amendments-actions";
import {
  GP_AMENDMENT_TYPES,
  GP_AMENDMENT_TYPE_LABELS,
  gpAmendmentStatusTone,
  type GpAmendmentType,
  type GarmentProcessAmendment,
} from "@/lib/orders/garment-processes/amendments-types";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";

interface Props {
  orderId: string;
  amendments: GarmentProcessAmendment[];
  canCreate: boolean;
  canApprove: boolean;
}

export function ProcessAmendments({
  orderId,
  amendments,
  canCreate,
  canApprove,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState<GpAmendmentType>("add");
  const [description, setDescription] = useState("");
  const [rejectForm, setRejectForm] = useState<{ id: string; reason: string } | null>(
    null,
  );

  // Expand-in-place forms, invisible to the guard's DOM scan — see
  // new-order-form.tsx. `rejectForm` counts too: the typed reason is the whole
  // content of that action and is not recoverable once discarded.
  useUnsavedGuard(formOpen || rejectForm !== null || isPending);

  function resetForm() {
    setType("add");
    setDescription("");
    setFormOpen(false);
  }

  function handleRaise(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await raiseProcessAmendment({
        sales_order_id: orderId,
        amendment_type: type,
        description: description.trim() || null,
      });
      if (result.ok) {
        success("Amendment raised");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      const result = await approveProcessAmendment(id);
      if (result.ok) {
        success("Amendment approved");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleReject() {
    if (!rejectForm) return;
    const { id, reason } = rejectForm;
    startTransition(async () => {
      const result = await rejectProcessAmendment(id, reason);
      if (result.ok) {
        success("Amendment rejected");
        setRejectForm(null);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<GarmentProcessAmendment>[] = [
    {
      header: "Type",
      cell: (a) => (
        <span className="text-sm">{GP_AMENDMENT_TYPE_LABELS[a.amendment_type]}</span>
      ),
    },
    {
      header: "Description",
      cell: (a) => (
        <span className="text-sm text-muted-foreground">{a.description ?? "—"}</span>
      ),
    },
    {
      header: "Status",
      cell: (a) => (
        <StatusPill tone={gpAmendmentStatusTone(a.status)}>
          {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
        </StatusPill>
      ),
    },
    ...(canApprove
      ? [
          {
            header: "Action",
            cell: (a: GarmentProcessAmendment) => {
              if (a.status !== "pending") return null;
              if (rejectForm?.id === a.id) {
                return (
                  <div className="flex flex-col gap-1.5">
                    <Input
                      placeholder="Reason for rejection"
                      value={rejectForm.reason}
                      onChange={(e) =>
                        setRejectForm((f) => (f ? { ...f, reason: e.target.value } : null))
                      }
                      className="h-7 w-48 text-xs"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={handleReject}
                        disabled={isPending}
                        className="h-7 text-xs"
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRejectForm(null)}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => handleApprove(a.id)}
                    disabled={isPending}
                    className="h-7 text-xs"
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejectForm({ id: a.id, reason: "" })}
                    className="h-7 text-xs"
                  >
                    Reject
                  </Button>
                </div>
              );
            },
          } satisfies Column<GarmentProcessAmendment>,
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Process amendments ({amendments.length})</CardTitle>
        {canCreate && !formOpen && (
          <Button size="sm" variant="subtle" onClick={() => setFormOpen(true)}>
            + Raise amendment
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        <DataTable
          columns={columns}
          rows={amendments}
          getKey={(a) => a.id}
          empty="No amendments raised for this order's process plan."
        />

        {canCreate && formOpen && (
          <form
            onSubmit={handleRaise}
            // ONE MARKER, NEVER A HANDLER. This is a page-level editor, and
            // AGENTS.md counts ~51 of them as missing exactly this attribute:
            // without it `isEditorScope()` is false, so Tab keeps native order,
            // leaves the form and stops on the buttons below it. Declaring the
            // scope is all it takes — the contract is delivered by the single
            // listener in keyboard-nav-provider.tsx (see the
            // `raagam-keyboard-contract` skill).
            data-focus-scope
            className="space-y-3 rounded-md border border-border bg-surface-muted p-4"
          >
            {/* `FieldGrid`, not a hand-rolled `grid-cols-1 sm:grid-cols-2` — a
                screen composes primitives, it does not draw. This one wrote its
                own two-column track around a single field, so the Type box was
                half-width for no stated reason while Description below it ran
                full width. */}
            <FieldGrid>
              <Field label="Type" size="sm" htmlFor="gpa-type">
                <Select
                  id="gpa-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as GpAmendmentType)}
                >
                  {GP_AMENDMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {GP_AMENDMENT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* `full` is not a field width — it is the row, which is what a
                  textarea takes. See LAYOUT.md §3. */}
              <Field label="Description" size="full" htmlFor="gpa-desc">
                <Textarea
                  id="gpa-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Describe the change to the process plan…"
                />
              </Field>
            </FieldGrid>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Raise amendment"}
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
