"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Label } from "@/components/ui/label";
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
            className="space-y-3 rounded-md border border-border bg-surface-muted p-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="gpa-type">Type</Label>
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
              </div>
            </div>
            <div>
              <Label htmlFor="gpa-desc">Description</Label>
              <Textarea
                id="gpa-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Describe the change to the process plan…"
              />
            </div>
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
