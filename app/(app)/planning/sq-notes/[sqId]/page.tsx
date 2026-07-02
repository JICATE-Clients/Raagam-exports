import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import {
  getSqNote,
  getSqAllocations,
  getItems,
  getUoms,
} from "@/lib/planning/extras-service";
import { SQ_STATUS_LABELS, type SqStatus } from "@/lib/planning/types";
import { SqNoteDetail } from "./sq-note-detail";

function tone(s: SqStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "allocated" ? "success" : "danger";
}

export default async function SqNoteDetailPage({
  params,
}: {
  params: Promise<{ sqId: string }>;
}) {
  await requirePermission("planning", "view");
  const { sqId } = await params;
  const [note, allocations, items, uoms, canEdit, canDelete] = await Promise.all([
    getSqNote(sqId),
    getSqAllocations(sqId),
    getItems(),
    getUoms(),
    can("planning", "edit"),
    can("planning", "delete"),
  ]);
  if (!note) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={note.code ?? "SQ Note"}
        description={note.description}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(note.status)}>{SQ_STATUS_LABELS[note.status]}</StatusPill>
            <Link href="/planning/sq-notes" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-0.5">{SQ_STATUS_LABELS[note.status]}</dd>
            </div>
            {note.notes && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 text-muted-foreground">{note.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>
      <SqNoteDetail
        sqId={sqId}
        status={note.status}
        allocations={allocations}
        items={items}
        uoms={uoms}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
