"use client";

/**
 * ONE PLAN REVISION — the workspace's Overview, after Orders ▸ Order
 * Revisions' entry page (`orders/order-amendments/[entryId]/entry-screen.tsx`)
 * and its rule: the page answers ONE question, what do I do next?
 *
 *  1. THE FACTS — SWO, each plan's Rev #, why, who asked, who raised it when.
 *  2. THE STEP BAR — Raised → Editing → Submitted → Approved / Sent back.
 *  3. THE NEXT STEP — one sentence, one filled button: Send for Approval (each
 *     reopened plan's own Submit, the same action the plan editor offers).
 *  4. PER PLAN — what changed against what was approved (`planChanges` /
 *     `shadeChanges` over 0727's snapshot, the comparison the approver reads
 *     on Plan Approval) and the approval trail.
 *  5. ABANDON — a text link at the foot, with an in-page confirm: every plan of
 *     the revision goes back exactly as approved and locks again (0730).
 *     Withheld while the approver holds it.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { creatorName } from "@/components/ui/created-columns";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { PlanRevisionTabs } from "@/components/sales/plan-revision-tabs";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TimelineRow } from "@/lib/approvals/types";
import { originLabel } from "@/lib/orders/amendments/amendment-entry";
import { submitSampleFabricPlan } from "@/lib/orders/iwo-fabric-bom/approval-actions";
import { submitSampleAccessoriesPlan } from "@/lib/orders/iwo-material-bom/approval-actions";
import {
  PLAN_KIND_LABEL,
  currentPurchaseLines,
  planChanges,
  planReportHref,
  shadeChanges,
  type PlanReport,
} from "@/lib/sales/plan-reports/types";
import { abandonPlanRevision } from "@/lib/sales/plan-revisions/actions";
import {
  PLAN_REVISION_STATUS_LABEL,
  abandonRefusal,
  entryStepOf,
  planRevisionHref,
  planRevisionIsOpen,
  planRevisionTone,
  type PlanRevisionRow,
} from "@/lib/sales/plan-revisions/types";

/** What the server read for one plan of the revision — empty once the plan has left it. */
export type PlanSide = { report: PlanReport | null; timeline: TimelineRow[]; names: Record<string, string> };

const STEPS = ["Raised", "Editing", "Submitted", "Decided"] as const;

export function PlanRevisionOverview({
  plans,
  sides,
  canEdit,
  askAbandon,
}: {
  plans: PlanRevisionRow[];
  sides: PlanSide[];
  canEdit: boolean;
  /** `?abandon=1` — the register's Abandon icon lands with the confirm open. */
  askAbandon: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const refusal = abandonRefusal(plans.map((p) => p.status));
  const [confirming, setConfirming] = useState(askAbandon && canEdit && !refusal);

  const head = plans[0];
  const swo = head.swoCode ?? head.iwoCode ?? "—";
  const { step, outcome } = entryStepOf(plans.map((p) => p.status));
  const current = STEPS.indexOf(step === "raised" ? "Raised" : step === "editing" ? "Editing" : step === "submitted" ? "Submitted" : "Decided");
  const decidedLabel = outcome === "returned" ? "Sent back" : outcome === "abandoned" ? "Abandoned" : "Approved";
  const open = plans.filter((p) => planRevisionIsOpen(p.status));
  const sideOf = (p: PlanRevisionRow) => sides[plans.indexOf(p)];
  const drafts = open.filter((p) => sideOf(p)?.report?.report.header.isDraft);
  const planNames = (xs: PlanRevisionRow[]) => xs.map((p) => PLAN_KIND_LABEL[p.kind]).join(" and ");
  const remark = (p: PlanRevisionRow) => sideOf(p)?.report?.report.header.decisionRemark ?? null;

  function sendForApproval() {
    start(async () => {
      const sent: PlanRevisionRow[] = [];
      for (const p of open) {
        const res = await (p.kind === "fabric" ? submitSampleFabricPlan : submitSampleAccessoriesPlan)(p.bomId);
        if (!res.ok) {
          // Each plan has its own approval run, so a plan already sent stays sent.
          toastError(sent.length ? `${planNames(sent)} sent, but the ${PLAN_KIND_LABEL[p.kind]} was not: ${res.error}` : res.error);
          router.refresh();
          return;
        }
        sent.push(p);
      }
      success(`Revision on ${swo} sent for approval — the ${planNames(sent)} ${sent.length > 1 ? "are" : "is"} locked until the approver decides`);
      router.refresh();
    });
  }

  function abandon() {
    start(async () => {
      const res = await abandonPlanRevision(head.entryId);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setConfirming(false);
      success(`Revision on ${swo} abandoned — the approved plan${res.plans === 1 ? " is" : "s are"} back and locked again`);
      router.replace(planRevisionHref(head.entryId));
      router.refresh();
    });
  }

  type Next = { tone: "info" | "warning" | "success" | "danger" | "neutral"; title: string; body?: string; action?: React.ReactNode };
  const next: Next = (() => {
    if (outcome === "abandoned") {
      return { tone: "neutral", title: "Abandoned", body: "The plans went back to their approved version and are locked again. Raise a new revision to change them." };
    }
    const returned = open.filter((p) => p.status === "returned");
    if (open.length > 0 && drafts.length > 0) {
      return {
        tone: "warning",
        title: `Save the ${planNames(drafts)}`,
        body: "Open its tab above, finish the plan and Save — a plan saved as a draft cannot be sent.",
      };
    }
    if (open.length > 0) {
      return {
        tone: returned.length ? "danger" : "info",
        title: returned.length ? "The approver sent this back" : `Edit the ${planNames(open)}, then send it`,
        body: returned.length
          ? `${returned.map((p) => (remark(p) ? `${PLAN_KIND_LABEL[p.kind]}: “${remark(p)}”` : PLAN_KIND_LABEL[p.kind])).join(" · ")} — rework it on its tab, save, and send it again, or abandon the revision.`
          : "Open its tab above, change what the revision is for, and save — you come straight back here. Then send it for approval.",
        action:
          canEdit ? (
            <Button size="md" onClick={sendForApproval} disabled={isPending}>
              <Send className="h-4 w-4" /> {isPending ? "Sending…" : "Send for Approval"}
            </Button>
          ) : undefined,
      };
    }
    if (step === "submitted") {
      return { tone: "info", title: "Waiting for the approver", body: "Nothing can change until they decide — approving makes this the plan purchasing follows; sending it back reopens it here." };
    }
    return { tone: "success", title: "Approved", body: "The revised plans are locked again and purchasing follows their quantities." };
  })();
  const toneBox: Record<Next["tone"], string> = {
    info: "border-info bg-info-soft text-info",
    warning: "border-warning bg-warning-soft text-warning",
    success: "border-success bg-success-soft text-success",
    danger: "border-danger bg-danger-soft text-danger",
    neutral: "border-border bg-surface-muted text-foreground",
  };

  const facts: [string, string][] = [
    ["SWO No", swo],
    ["Revision", plans.map((p) => `${PLAN_KIND_LABEL[p.kind]} Rev #${p.revisionNo}`).join(" · ")],
    ["Origin", originLabel(head.origin)],
    ["Raised by", creatorName(head) ?? "—"],
    ["Raised", fmtDateTime(head.raisedAt)],
    ...(head.season ? ([["Season", head.season]] as [string, string][]) : []),
    ...(head.smpNos.length ? ([["Samples", head.smpNos.join(", ")]] as [string, string][]) : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Revision · ${swo}`}
        description={[planNames(plans), originLabel(head.origin), `raised ${fmtDate(head.raisedAt)}`].join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {plans.map((p) => (
              <StatusPill key={p.id} tone={planRevisionTone(p.status)}>
                {plans.length > 1 ? `${PLAN_KIND_LABEL[p.kind]}: ` : ""}
                {PLAN_REVISION_STATUS_LABEL[p.status]}
              </StatusPill>
            ))}
          </div>
        }
      />
      <PlanRevisionTabs plans={plans} current="overview" />

      {/* 64rem, Order Revisions' Overview cap: the facts card and the per-plan
          cards read as one column, never stretched across a wide pane. */}
      <div className="max-w-[64rem] space-y-4">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Revision progress">
          {STEPS.map((label, i) => {
            const done = i < current || (i === current && step === "decided" && outcome === "approved");
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full font-semibold",
                    done ? "bg-success text-white" : i === current ? "bg-primary text-white" : "bg-surface-muted text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className={cn(i === current ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {label === "Decided" ? (step === "decided" ? decidedLabel : "Approved / Sent back") : label}
                </span>
                {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
              </li>
            );
          })}
        </ol>

        <div className={cn("rounded-md border px-4 py-3", toneBox[next.tone])} role="status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Next: {next.title}</p>
              {next.body && <p className="mt-0.5 text-xs opacity-90">{next.body}</p>}
            </div>
            {next.action}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>The revision</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1">
                  <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
                  <dd className="m-0 min-w-0 text-right">
                    <Truncated text={value} className="block text-xs font-semibold text-foreground" />
                  </dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="text-xs text-muted-foreground">Reason</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{head.reason}</p>
            </div>
            {head.abandonReason && <p className="text-xs text-muted-foreground">Abandoned: {head.abandonReason}</p>}
          </CardBody>
        </Card>

        {plans.map((p, i) => (
          <PlanCard key={p.id} plan={p} side={sides[i]} onOpen={() => router.push(planRevisionHref(p.entryId, p.kind))} />
        ))}

        {/* ABANDON — a text link at the foot (Orders' entry page), and a
            confirm step on the page rather than a browser dialog. */}
        {canEdit && outcome !== "abandoned" && (
          <div className="flex flex-col items-end gap-2">
            {confirming ? (
              <div className="w-full rounded-md border border-danger bg-danger-soft px-4 py-3 text-danger" role="alertdialog" aria-label="Abandon this revision">
                <p className="text-sm font-semibold">Abandon this revision?</p>
                <p className="mt-0.5 text-xs opacity-90">
                  {`The ${planNames(open.length ? open : plans)} go${open.length === 1 ? "es" : ""} back exactly as approved and lock again — every change made since the revision was raised is discarded, and purchasing resumes on the approved quantities.`}
                </p>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button variant="outline" size="md" onClick={() => setConfirming(false)} disabled={isPending}>
                    Keep the revision
                  </Button>
                  <Button variant="danger" size="md" onClick={abandon} disabled={isPending}>
                    <Undo2 className="h-4 w-4" /> {isPending ? "Abandoning…" : "Abandon revision"}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-danger disabled:opacity-50 disabled:hover:text-muted-foreground"
                onClick={() => setConfirming(true)}
                disabled={isPending || !!refusal}
                title={refusal ?? undefined}
              >
                <Undo2 className="mr-1 inline h-3.5 w-3.5" />
                Abandon revision{refusal ? ` — ${refusal.toLowerCase()}` : " and go back to the approved version"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One plan of the revision: what changed against what was approved, and its approval trail. */
function PlanCard({ plan, side, onOpen }: { plan: PlanRevisionRow; side: PlanSide | undefined; onOpen: () => void }) {
  const router = useRouter();
  const report = side?.report ?? null;
  const rev = report?.report.header.revision ?? null;
  const changes = report && rev ? planChanges(rev.approved, currentPurchaseLines(report)) : null;
  // 0727: null when the revision predates its snapshot.
  const shades = rev?.shadesBefore ? shadeChanges(rev.shadesBefore, rev.shadesNow) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{`${PLAN_KIND_LABEL[plan.kind]} · Rev #${plan.revisionNo}`}</CardTitle>
        <div className="flex items-center gap-3">
          <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => router.push(planReportHref(plan.kind, plan.bomId))}>
            Report
          </button>
          {planRevisionIsOpen(plan.status) && (
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={onOpen}>
              {`Edit the ${PLAN_KIND_LABEL[plan.kind]} →`}
            </button>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {!report ? (
          <p className="text-sm text-muted-foreground">
            {plan.status === "abandoned"
              ? `Abandoned${plan.abandonedAt ? ` ${fmtDate(plan.abandonedAt)}` : ""} — the ${PLAN_KIND_LABEL[plan.kind]} went back to its approved version.`
              : `Approved — the ${PLAN_KIND_LABEL[plan.kind]} has since moved on to a later revision.`}
          </p>
        ) : (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approved vs proposed</h3>
            {!changes || changes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {shades && shades.length ? "No purchase quantity changed." : "No purchase quantity changed — only the plan’s details, if anything."}
              </p>
            ) : (
              <ChangeTable rows={changes.map((c) => ({ label: c.name, sub: c.kind === "added" ? "new" : c.kind === "removed" ? "dropped" : null, before: c.before, now: c.now, uom: c.uom }))} />
            )}
            {shades && shades.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-foreground">Shades &amp; colours</h3>
                <ChangeTable
                  rows={shades.map((c) => ({
                    label: `${c.name} · ${c.colour}`,
                    sub: `${c.part} · ${c.kind === "added" ? "new" : c.kind === "removed" ? "dropped" : "qty changed"}`,
                    before: c.before,
                    now: c.now,
                    uom: c.uom,
                  }))}
                />
              </>
            )}
            {side && side.timeline.length > 0 && (
              <>
                <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval</h3>
                <ApprovalTimeline rows={side.timeline} resolveUserName={(id) => side.names[id]} />
              </>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ChangeTable({ rows }: { rows: { label: string; sub: string | null; before: number | null; now: number | null; uom: string | null }[] }) {
  return (
    <table className="w-full max-w-[40rem] text-xs">
      <thead>
        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
          <th scope="col" className="py-1 pr-2 text-left font-semibold">Material</th>
          <th scope="col" className="px-2 py-1 text-right font-semibold">Approved</th>
          <th scope="col" className="py-1 pl-2 text-right font-semibold">Proposed</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((c, i) => (
          <tr key={i} className="border-b border-border/60">
            <th scope="row" className="py-1 pr-2 text-left font-normal">
              <Truncated text={c.label} className="block max-w-[18rem]" />
              {c.sub && <span className="text-[10px] text-muted-foreground">{c.sub}</span>}
            </th>
            <td className="px-2 py-1 text-right text-muted-foreground">{c.before == null ? "—" : fmtNumber(c.before)}</td>
            <td className={cn("py-1 pl-2 text-right font-semibold", c.before != null && c.now != null && c.now > c.before ? "text-warning" : "text-foreground")}>
              {c.now == null ? "—" : `${fmtNumber(c.now)}${c.uom ? ` ${c.uom}` : ""}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
