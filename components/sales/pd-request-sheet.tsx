"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { PdRequestDetails } from "@/components/sales/pd-request-details";
import { fmtDateTime } from "@/lib/format";
import { loadPdReview } from "@/lib/sales/pd-requests/actions";
import type { PdRequestRow } from "@/lib/sales/pd-requests/types";
import { PD_STATUS_LABEL, PD_STATUS_TONE } from "@/lib/sales/sample-entry/types";

type Review = Awaited<ReturnType<typeof loadPdReview>>;

/**
 * ONE PD REQUEST, OPENED — the same document on both screens (client spec
 * 2026-10-14). On Sample ▸ PD Request the merchandiser reads where it stands;
 * on Sample ▸ Acknowledge PD Request the department decides with it in front
 * of them: `decide` puts Acknowledge / Not Acknowledged in the header, and the
 * bar renders nothing unless the engine says this user may act
 * (`approval_can_act`).
 */
export function PdRequestSheet({
  row,
  onClose,
  decide = false,
  subjectPath,
  onDecided,
}: {
  row: PdRequestRow | null;
  onClose: () => void;
  decide?: boolean;
  /** The screen's own route — revalidated with the queue after a decision. */
  subjectPath: string;
  onDecided?: () => void;
}) {
  /** Keyed by request, so a late answer never paints the previous request
   *  under this one (Plan Approval's `forKey`). */
  const [loaded, setLoaded] = useState<{ forId: string; data: Review } | null>(null);
  const id = row?.id ?? null;
  useEffect(() => {
    if (!id) return;
    void loadPdReview(id).then((data) => setLoaded({ forId: id, data }));
  }, [id]);
  const review = loaded && loaded.forId === id ? loaded.data : null;

  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      title={
        <span className="flex flex-col">
          <span>{decide ? "Acknowledge PD Request" : "PD Request"}</span>
          <span className="text-xs font-normal text-muted-foreground">
            Sample / PD Request / <span className="font-mono text-foreground">{row?.swo_no ?? row?.smp_nos[0] ?? ""}</span>
          </span>
        </span>
      }
      headerActions={
        decide && review?.run && review.verdict ? (
          <ApprovalActionBar
            run={review.run}
            verdict={review.verdict}
            subjectPath={subjectPath}
            onDone={() => {
              onClose();
              onDecided?.();
            }}
            acknowledge
            compact
          />
        ) : undefined
      }
    >
      {row && review?.sample ? (
        <PdRequestDetails sample={review.sample} from={row.created_by_name ?? null}>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Remarks / Special Instructions</h3>
            <p className="whitespace-pre-wrap text-sm">{row.note || <span className="text-muted-foreground">None given.</span>}</p>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              Status
              <StatusPill tone={PD_STATUS_TONE[row.status]}>{PD_STATUS_LABEL[row.status]}</StatusPill>
            </h3>
            <p className="text-sm text-muted-foreground">
              {`Sent ${fmtDateTime(row.created_at)}`}
              {row.decided_at
                ? ` · ${row.status === "acknowledged" ? "acknowledged" : "answered"} ${fmtDateTime(row.decided_at)}${row.decided_by_name ? ` by ${row.decided_by_name}` : ""}`
                : ""}
            </p>
            {row.decision_remark ? (
              <p className={`whitespace-pre-wrap text-sm ${row.status === "not_acknowledged" ? "text-danger" : ""}`}>{row.decision_remark}</p>
            ) : null}
            {review.timeline.length ? <ApprovalTimeline rows={review.timeline} resolveUserName={(uid) => review.names[uid]} /> : null}
          </section>
        </PdRequestDetails>
      ) : (
        <p className="text-sm text-muted-foreground">
          {row && review && !review.sample ? "This SWO could not be read — it may have been deleted." : "Loading the request…"}
        </p>
      )}
    </Sheet>
  );
}
