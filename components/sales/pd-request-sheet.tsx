"use client";

import { useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { PdRequestDetails } from "@/components/sales/pd-request-details";
import {
  DecisionFacts,
  DecisionTitle,
  SampleDecisionColumns,
  SampleDecisionSheet,
  SampleDecisionWait,
} from "@/components/sales/sample-decision-sheet";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { loadPdReview } from "@/lib/sales/pd-requests/actions";
import { PD_TO_DEPARTMENT, type PdRequestRow } from "@/lib/sales/pd-requests/types";
import { PD_STATUS_TONE } from "@/lib/sales/sample-entry/types";
import { pdStatusLabel } from "@/lib/sales/pd-requests/words";

type Review = Awaited<ReturnType<typeof loadPdReview>>;

/** The request's number, as every PD surface leads with it: the SMP No (0724
 *  — one request per SMP), with "+n" on the one 0723 request raised per SWO. */
export function pdRequestNo(r: Pick<PdRequestRow, "smp_nos" | "swo_no">): string {
  const [first, ...more] = r.smp_nos;
  if (!first) return r.swo_no ?? "—";
  return more.length ? `${first} +${more.length}` : first;
}

/**
 * ONE PD REQUEST, OPENED — the same document on both screens (client spec
 * 2026-10-14), in the sample decision sheet's three columns (2026-10-15):
 * the SMP's facts on the left, its styles and tech pack in the middle, the
 * status and approval trail on the right. On Sample ▸ PD Request the
 * merchandiser reads where it stands; on Sample ▸ PD Acknowledge the
 * department decides with it in front of them: `decide` puts Acknowledge /
 * Not Acknowledged in the header, and the bar renders nothing unless the
 * engine says this user may act (`approval_can_act`).
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
  const decided = row?.decided_at && (row.status === "acknowledged" || row.status === "not_acknowledged");

  return (
    <SampleDecisionSheet
      open={!!row}
      onClose={onClose}
      title={decide ? "PD Acknowledge" : "PD Request"}
      crumb={decide ? "Sample / PD Acknowledge" : "Sample / PD Request"}
      recordNo={row ? pdRequestNo(row) : ""}
      actions={
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
            overrideNote={false}
          />
        ) : undefined
      }
    >
      {row && review?.sample ? (
        <SampleDecisionColumns
          override={decide && !!review.verdict?.can_act && !!review.verdict.is_override}
          identity={
            <Card>
              <CardBody className="space-y-3">
                <DecisionTitle
                  tile="PD"
                  number={pdRequestNo(row)}
                  sub={
                    // The SWO only when the request has one — the 0723 request,
                    // raised per SWO before 0724 moved it back onto the SMP.
                    <Truncated text={row.swo_no ? `SWO ${row.swo_no}` : "PD Request"} className="block text-xs text-muted-foreground" />
                  }
                />
                <DecisionFacts
                  facts={[
                    ["Customer", row.customer ?? review.sample.customer],
                    ["Season", row.season ?? review.sample.season],
                    ["Qty", `${fmtNumber(review.sample.total_pieces)} pcs`],
                    ["Sample type", row.sample_types.join(", ") || null],
                    ["Target date", row.target_date ? fmtDate(row.target_date) : null],
                    ["From", row.created_by_name ?? null],
                    ["To Department", PD_TO_DEPARTMENT],
                    ["Sent", fmtDateTime(row.created_at)],
                    ...(decided ? ([["Answered", fmtDateTime(row.decided_at as string)]] as [string, string][]) : []),
                  ]}
                />
              </CardBody>
            </Card>
          }
          body={
            <Card>
              <CardBody>
                <PdRequestDetails sample={review.sample} from={row.created_by_name ?? null} facts={false}>
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">Remarks / Special Instructions</h3>
                    <p className="whitespace-pre-wrap text-sm">{row.note || <span className="text-muted-foreground">None given.</span>}</p>
                  </section>
                </PdRequestDetails>
              </CardBody>
            </Card>
          }
          trail={
            <Card>
              <CardBody className="space-y-3">
                <h2 className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                  Status
                  <StatusPill tone={PD_STATUS_TONE[row.status]}>{pdStatusLabel(row)}</StatusPill>
                </h2>
                {decided ? (
                  <p className="text-xs text-muted-foreground">
                    {`${row.status === "acknowledged" ? "Acknowledged" : "Answered"} ${fmtDateTime(row.decided_at as string)}${row.decided_by_name ? ` by ${row.decided_by_name}` : ""}`}
                  </p>
                ) : null}
                {row.decision_remark ? (
                  <p className={`whitespace-pre-wrap text-sm ${row.status === "not_acknowledged" ? "text-danger" : ""}`}>{row.decision_remark}</p>
                ) : null}
                {review.timeline.length ? <ApprovalTimeline rows={review.timeline} resolveUserName={(uid) => review.names[uid]} /> : null}
              </CardBody>
            </Card>
          }
        />
      ) : (
        <SampleDecisionWait>
          {row && review && !review.sample ? "This SMP could not be read — it may have been deleted." : "Loading the request…"}
        </SampleDecisionWait>
      )}
    </SampleDecisionSheet>
  );
}
