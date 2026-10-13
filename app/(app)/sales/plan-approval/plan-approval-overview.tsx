"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, ExternalLink } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { PlanReportView } from "@/components/sales/plan-reports";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import type { TimelineRow } from "@/lib/approvals/types";
import type { PlanApprovalRow } from "@/lib/sales/plan-reports/service";
import {
  PLAN_EDITOR_PATH,
  PLAN_KIND_LABEL,
  currentPurchaseLines,
  planChanges,
  planReportHref,
  type PlanReport,
} from "@/lib/sales/plan-reports/types";
import { planStatusText, planStatusTone } from "./plan-words";

/**
 * ONE PLAN, IN ORDER APPROVAL'S LAYOUT (user 2026-10-13: "approval screen and
 * that work also like … order"). `orders/budget-approval/approval-overview.tsx`
 * is the model, column for column, with the plan's figures in the budget's
 * place:
 *
 *   left   → the PLAN: kind tile, SWO No, version and status pills, its facts,
 *            then "View full plan report" (the document, in a sheet — the
 *            order's "View full order data") and the direct link to the plan;
 *   middle → four tiles, then what the approval buys: fabric by sample and the
 *            yarn to buy, or the accessories to buy;
 *   right  → the approval trail, what changed in a revision (the order's
 *            V0 vs proposed), and the override warning.
 *
 * Every figure is the stored plan's (`PlanReport`), the same object the report
 * and its PDF print, so what is approved here is what the document says.
 */
export function PlanApprovalOverview({
  row,
  plan,
  timeline,
  names,
  override = false,
}: {
  row: PlanApprovalRow;
  plan: PlanReport;
  timeline: TimelineRow[] | null;
  names: Record<string, string>;
  override?: boolean;
}) {
  const router = useRouter();
  const [reportOpen, setReportOpen] = useState(false);
  const h = plan.report.header;
  const changes = h.revision ? planChanges(h.revision.approved, currentPurchaseLines(plan)) : null;

  return (
    <div className="grid items-start gap-3 xl:grid-cols-12">
      {/* ═══ LEFT — the plan's identity ═══ */}
      <div className="xl:col-span-3">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-primary-soft text-lg font-bold text-primary">
                {plan.kind === "fabric" ? "FP" : "AP"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-semibold text-foreground">{h.swoCode ?? h.iwoCode ?? "—"}</div>
                <Truncated text={`Sample ${PLAN_KIND_LABEL[plan.kind]}`} className="block text-xs text-muted-foreground" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill tone="info">{h.revisionNo ? `Rev #${h.revisionNo}` : "V0 · First approval"}</StatusPill>
              <StatusPill tone={planStatusTone(row)}>{planStatusText(row)}</StatusPill>
            </div>
            <dl className="divide-y divide-border rounded-lg border border-border">
              {(
                [
                  ["SWO", h.description ?? h.swoCode],
                  ["Season", h.season],
                  ["Samples", h.samples.map((x) => x.smpNo ?? x.sampleNo).filter(Boolean).join(", ") || null],
                  ["Work order", h.iwoCode],
                  ["Plan date", h.planDate ? fmtDate(h.planDate) : null],
                  ["Submitted by", row.submitted_by_name],
                  ["Submitted", row.submitted_at ? fmtDateTime(row.submitted_at) : null],
                  ...(row.decided_at ? ([["Decided", fmtDateTime(row.decided_at)]] as [string, string][]) : []),
                ] as [string, string | null][]
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
                  <dd className="m-0 min-w-0 text-right">
                    <Truncated text={value ?? "—"} className="block text-xs font-semibold text-foreground" />
                  </dd>
                </div>
              ))}
            </dl>
            {/* THE DOCUMENT, AND THE PLAN ITSELF — the order's "View full order
                data", plus the direct link the user asked for (2026-10-13). */}
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="flex h-8 w-full items-center justify-center gap-1 rounded-control border border-border px-3 text-xs font-medium text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View full plan report
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => router.push(planReportHref(plan.kind, h.bomId))}
                className="flex h-8 items-center justify-center gap-1 rounded-control border border-border px-2 text-xs font-medium text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Report page
                <ExternalLink className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => router.push(`${PLAN_EDITOR_PATH[plan.kind]}?open=${h.bomId}`)}
                className="flex h-8 items-center justify-center gap-1 rounded-control border border-border px-2 text-xs font-medium text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {`Open ${PLAN_KIND_LABEL[plan.kind]}`}
                <ExternalLink className="size-3.5" aria-hidden />
              </button>
            </div>
            {reportOpen && (
              <Sheet
                open
                onClose={() => setReportOpen(false)}
                title={`Sample ${PLAN_KIND_LABEL[plan.kind]} · ${h.swoCode ?? ""}`}
                size="lg"
              >
                <PlanReportView plan={plan} />
              </Sheet>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ═══ MIDDLE — tiles, then what this approval buys ═══ */}
      <div
        className="min-w-0 cursor-pointer space-y-3 xl:col-span-6"
        /* CLICK ANYWHERE ON THE FIGURES OPENS THE FULL REPORT — the order
           page's own pointer shortcut; the left card's button is the
           keyboard's way in, so this is never mouse-only. */
        onClick={() => setReportOpen(true)}
      >
        {plan.kind === "fabric" ? <FabricMiddle plan={plan.report} /> : <AccessoriesMiddle plan={plan.report} />}
      </div>

      {/* ═══ RIGHT — the trail, what changed, the override ═══ */}
      <div className="space-y-3 xl:col-span-3">
        {timeline && timeline.length > 0 && (
          <Card>
            <CardBody className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Approval</h2>
              <ApprovalTimeline rows={timeline} resolveUserName={(id) => names[id]} />
            </CardBody>
          </Card>
        )}

        {/* A REVISION IS DECIDED ON WHAT CHANGED — the order page's V0 vs
            proposed, here the purchase lines against what was approved before
            the revision reopened the plan. */}
        {h.revision && changes && (
          <Card>
            <CardBody className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">{`What changed · Rev #${h.revision.revisionNo}`}</h2>
              <p className="text-xs text-muted-foreground">{`Reason: ${h.revision.reason} · raised ${fmtDate(h.revision.raisedAt)}`}</p>
              {changes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No purchase quantity changed — only the plan&apos;s details.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-1 pr-2 text-left font-semibold">Material</th>
                      <th scope="col" className="px-2 py-1 text-right font-semibold">Was</th>
                      <th scope="col" className="py-1 pl-2 text-right font-semibold">Now</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {changes.map((c, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <th scope="row" className="py-1 pr-2 text-left font-normal">
                          <Truncated text={c.name} className="block max-w-[9rem]" />
                        </th>
                        <td className="px-2 py-1 text-right text-muted-foreground">{c.before == null ? "—" : fmtNumber(c.before)}</td>
                        <td
                          className={cn(
                            "py-1 pl-2 text-right font-semibold",
                            c.before != null && c.now != null && c.now > c.before ? "text-warning" : "text-foreground",
                          )}
                        >
                          {c.now == null ? "—" : `${fmtNumber(c.now)}${c.uom ? ` ${c.uom}` : ""}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        )}

        {/* THE OVERRIDE, SAID BEFORE THE CLICK (the order page's rule) — the
            header's action bar runs with `overrideNote={false}`. */}
        {override && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            You are not an approver on this step — acting here is recorded as an override.
          </div>
        )}
      </div>
    </div>
  );
}

const TILE = "min-w-0 rounded-xl border border-border bg-surface px-3 py-2";

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={TILE}>
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className={cn("truncate text-base font-bold leading-6 tabular-nums", tone)}>{value}</div>
      {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

const TH = "py-1.5 pr-3 text-left font-semibold";
const THR = "px-3 py-1.5 text-right font-semibold";

function FabricMiddle({ plan }: { plan: Extract<PlanReport, { kind: "fabric" }>["report"] }) {
  const fabricsBySample = new Map<string, Set<string>>();
  for (const f of plan.fabrics) {
    const set = fabricsBySample.get(f.sample) ?? new Set<string>();
    set.add(f.fabric);
    fabricsBySample.set(f.sample, set);
  }
  const refused = plan.yarns.filter((y) => y.purchaseQty == null).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Fabric required" value={`${fmtNumber(plan.fabricTotalKg)} kg`} sub={`${plan.fabrics.length} rows`} tone="text-primary" />
        <Tile
          label="Yarn to buy"
          value={plan.yarnTotal ? `${fmtNumber(plan.yarnTotal.qty)}${plan.yarnTotal.uom ? ` ${plan.yarnTotal.uom}` : ""}` : "—"}
          sub={refused ? `${refused} yarn without a weight` : `${plan.yarns.length} yarn${plan.yarns.length === 1 ? "" : "s"}`}
          tone={refused ? "text-warning" : undefined}
        />
        <Tile label="Fabrics" value={String(new Set(plan.fabrics.map((f) => f.fabric)).size)} sub={`${plan.routes.length} routed`} />
        <Tile label="Samples" value={String(plan.header.samples.length)} sub={plan.header.season ?? undefined} />
      </div>

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Fabric by Sample</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className={TH}>Sample</th>
                <th scope="col" className={THR}>Fabrics</th>
                <th scope="col" className={THR}>Req Kg</th>
                <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Share</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {plan.bySample.map((x) => (
                <tr key={x.sample} className="border-b border-border/60">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    <Truncated text={x.sample} className="block max-w-[18rem]" />
                  </th>
                  <td className="px-3 py-1.5 text-right">{fabricsBySample.get(x.sample)?.size ?? 0}</td>
                  <td className="px-3 py-1.5 text-right">{fmtNumber(x.kg)}</td>
                  <td className="py-1.5 pl-3 text-right">
                    {plan.fabricTotalKg > 0 ? `${((x.kg / plan.fabricTotalKg) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
              <tr className="bg-surface-muted font-semibold">
                <th scope="row" className="py-1.5 pr-3 text-left">Total</th>
                <td className="px-3 py-1.5" />
                <td className="px-3 py-1.5 text-right">{fmtNumber(plan.fabricTotalKg)}</td>
                <td className="py-1.5 pl-3" />
              </tr>
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Yarn to Buy</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className={TH}>Yarn</th>
                <th scope="col" className="px-3 py-1.5 text-left font-semibold">Bought as</th>
                <th scope="col" className={THR}>Planned Kg</th>
                <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Purchase</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {plan.yarns.map((y, i) => (
                <tr key={i} className="border-b border-border/60">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    <Truncated text={y.yarn} className="block max-w-[18rem]" />
                    {y.shades.length ? (
                      <span className="block text-[11px] text-muted-foreground">{y.shades.map((sh) => sh.colour).join(" · ")}</span>
                    ) : null}
                  </th>
                  <td className="px-3 py-1.5 text-muted-foreground">{y.buyStage ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right">{y.plannedKg == null ? "—" : fmtNumber(y.plannedKg)}</td>
                  <td className={cn("py-1.5 pl-3 text-right", y.purchaseQty == null && "text-danger")}>
                    {y.purchaseQty == null ? (y.refusal ?? "Not worked out") : `${fmtNumber(y.purchaseQty)}${y.uom ? ` ${y.uom}` : ""}`}
                  </td>
                </tr>
              ))}
              {plan.yarns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-1.5 text-muted-foreground">No yarn is derived from this plan yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}

function AccessoriesMiddle({ plan }: { plan: Extract<PlanReport, { kind: "accessories" }>["report"] }) {
  const advised = plan.items.filter((i) => i.advised).length;
  const unpriced = plan.items.filter((i) => i.purchaseQty == null).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Accessories" value={String(plan.items.length)} sub={`${plan.processes.length} processed`} tone="text-primary" />
        <Tile label="Samples" value={String(plan.header.samples.length)} sub={plan.header.season ?? undefined} />
        <Tile
          label="Advised"
          value={String(advised)}
          sub={advised ? "Cannot be bought until confirmed" : "Nothing waits on the buyer"}
          tone={advised ? "text-warning" : undefined}
        />
        <Tile label="Without a purchase qty" value={String(unpriced)} tone={unpriced ? "text-danger" : undefined} />
      </div>

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Accessories to Buy</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className={TH}>Accessory</th>
                <th scope="col" className="px-3 py-1.5 text-left font-semibold">Colour</th>
                <th scope="col" className={THR}>Samples</th>
                <th scope="col" className={THR}>Required</th>
                <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Purchase</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {plan.items.map((it, i) => (
                <tr key={i} className="border-b border-border/60">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    <Truncated text={it.item} className="block max-w-[16rem]" />
                    {it.advised || it.foc ? (
                      <span className="block text-[11px] text-warning">{[it.advised ? "Advised" : null, it.foc ? "FOC" : null].filter(Boolean).join(" · ")}</span>
                    ) : null}
                  </th>
                  <td className="px-3 py-1.5 text-muted-foreground">{it.colour ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right">{new Set(it.breakup.map((b) => b.sample)).size || "—"}</td>
                  <td className="px-3 py-1.5 text-right">{it.requiredQty == null ? "—" : fmtNumber(it.requiredQty)}</td>
                  <td className={cn("py-1.5 pl-3 text-right", it.purchaseQty == null && "text-danger")}>
                    {it.purchaseQty == null ? (it.refusal ?? "Not worked out") : `${fmtNumber(it.purchaseQty)}${it.purchaseUom ? ` ${it.purchaseUom}` : ""}`}
                  </td>
                </tr>
              ))}
              {plan.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-1.5 text-muted-foreground">No accessory is planned yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
