"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  updatePpmCompletion,
  submitPpmCompletion,
  approvePpmCompletion,
  deletePpmCompletion,
} from "@/lib/planning/ppm-actions";
import type { getPpmCompletion } from "@/lib/planning/ppm-service";
import type { PpmStatus } from "@/lib/planning/ppm-types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { fmtDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type CompletionDetail = NonNullable<Awaited<ReturnType<typeof getPpmCompletion>>>;

const PPM_STATUS_LABELS: Record<PpmStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function ppmStatusTone(status: PpmStatus): StatusTone {
  switch (status) {
    case "draft":     return "neutral";
    case "submitted": return "warning";
    case "approved":  return "success";
    case "rejected":  return "danger";
  }
}

export function PpmCompletionDetail({
  completion,
  canEdit,
  canDelete,
  canApprove,
}: {
  completion: CompletionDetail;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState(completion.notes ?? "");

  const isDraft = completion.status === "draft";
  const isSubmitted = completion.status === "submitted";
  const canMutate = isDraft && canEdit;

  const notesDirty = notes !== (completion.notes ?? "");

  useUnsavedGuard(notesDirty || isPending);

  function handleSaveNotes() {
    startTransition(async () => {
      const res = await updatePpmCompletion(completion.id, {
        entry_date: completion.entry_date ?? "",
        customer_id: completion.customer_id ?? "",
        ppm_id: completion.ppm_id ?? "",
        group_no: completion.group_no ?? undefined,
        group_description: completion.group_description ?? undefined,
        notes: notes.trim() || undefined,
        location_id: completion.location_id ?? undefined,
      });
      if (res.ok) { success("Notes saved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await submitPpmCompletion(completion.id);
      if (res.ok) { success("Submitted for approval."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approvePpmCompletion(completion.id);
      if (res.ok) { success("PPM Completion approved."); router.refresh(); }
      else toastError(res.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deletePpmCompletion(completion.id);
      if (res.ok) { success("Deleted."); router.push("/planning/ppm-completion"); }
      else toastError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {/* Header summary card */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-medium">{completion.code ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Entry Date</dt>
              <dd className="tabular-nums">{fmtDate(completion.entry_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="font-medium">{completion.customer_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">PPM Ref</dt>
              <dd>{completion.ppm_id ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group No</dt>
              <dd>{completion.group_no ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Group Description</dt>
              <dd>{completion.group_description ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd>
                <StatusPill tone={ppmStatusTone(completion.status)}>
                  {PPM_STATUS_LABELS[completion.status]}
                </StatusPill>
              </dd>
            </div>
            {completion.approved_at && (
              <div>
                <dt className="text-xs text-muted-foreground">Approved On</dt>
                <dd className="tabular-nums">{fmtDate(completion.approved_at)}</dd>
              </div>
            )}
          </dl>

          {/* Notes — editable when draft+canEdit, read-only otherwise */}
          <div className="mt-4">
            <Label>Notes</Label>
            {canMutate ? (
              <div className="space-y-2">
                <Textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                {notesDirty && (
                  <div className="flex justify-end">
                    <Button size="sm" disabled={isPending} onClick={handleSaveNotes}>
                      {isPending ? "Saving..." : "Save notes"}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              notes ? (
                <div className="rounded-md border border-border bg-surface-muted p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                  {notes}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No notes recorded.</p>
              )
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isDraft && canEdit && (
              <Button variant="outline" disabled={isPending} onClick={handleSubmit}>
                {isPending ? "Submitting..." : "Submit for Approval"}
              </Button>
            )}
            {isSubmitted && canApprove && (
              <Button disabled={isPending} onClick={handleApprove}>
                {isPending ? "Approving..." : "Approve"}
              </Button>
            )}
            {isSubmitted && !canApprove && (
              <p className="text-sm text-muted-foreground">Awaiting approval by an authorised reviewer.</p>
            )}
            {completion.status === "approved" && (
              <p className="text-sm text-muted-foreground">
                Approved{completion.approved_at ? ` on ${fmtDate(completion.approved_at)}` : ""}.
              </p>
            )}
            {isDraft && canDelete && (
              <Button
                variant="danger"
                disabled={isPending}
                onClick={handleDelete}
              >
                {isPending ? "Deleting..." : "Delete"}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
