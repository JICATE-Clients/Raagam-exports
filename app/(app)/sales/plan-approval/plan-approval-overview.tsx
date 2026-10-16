"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { PlanReportView } from "@/components/sales/plan-reports";
import { DecisionFacts, DecisionTitle, SampleDecisionColumns } from "@/components/sales/sample-decision-sheet";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import type { TimelineRow } from "@/lib/approvals/types";
import type { PlanApprovalRow } from "@/lib/sales/plan-reports/service";
import {
  PLAN_EDITOR_PATH,
  PLAN_KIND_LABEL,
  currentPurchaseLines,
  planChanges,
  shadeChanges,
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
  // 0727 (spec v8 §8.2 "dyeing shade changes"): null when the revision predates its snapshot.
  const shades = h.revision?.shadesBefore ? shadeChanges(h.revision.shadesBefore, h.revision.shadesNow) : null;

  return (
    <SampleDecisionColumns
      override={override}
      /* CLICK ANYWHERE ON THE FIGURES OPENS THE FULL REPORT — the order
         page's own pointer shortcut; the left card's button is the
         keyboard's way in, so this is never mouse-only. */
      onBodyClick={() => setReportOpen(true)}
      identity={
        <Card>
          <CardBody className="space-y-3">
            <DecisionTitle
              tile={plan.kind === "fabric" ? "FP" : "AP"}
              number={h.swoCode ?? h.iwoCode ?? "—"}
              sub={<Truncated text={`Sample ${PLAN_KIND_LABEL[plan.kind]}`} className="block text-xs text-muted-foreground" />}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill tone="info">{h.revisionNo ? `Rev #${h.revisionNo}` : "V0 · First approval"}</StatusPill>
              <StatusPill tone={planStatusTone(row)}>{planStatusText(row)}</StatusPill>
            </div>
            <DecisionFacts
              facts={[
                // The SWO's own words, only when it has some — the title above
                // already says its number.
                ...(h.description ? ([["Description", h.description]] as [string, string][]) : []),
                ["Season", h.season],
                ["Work order", h.iwoCode],
                ["Plan date", h.planDate ? fmtDate(h.planDate) : null],
                ["Submitted by", row.submitted_by_name],
                ["Submitted", row.submitted_at ? fmtDateTime(row.submitted_at) : null],
                // Only a plan that IS decided — a revision back with the approver
                // still carries the last decision's time, which read as this one's.
                ...(row.decided_at && (row.status === "approved" || row.status === "returned")
                  ? ([["Decided", fmtDateTime(row.decided_at)]] as [string, string][])
                  : []),
              ]}
            >
              {/* EVERY SAMPLE, ONE PER LINE — a run-on list cut off at "…" hid
                  which samples the approval covers (2026-10-13). */}
              <div className="flex items-start justify-between gap-3 px-3 py-1.5">
                <dt className="shrink-0 text-xs text-muted-foreground">{`Samples (${h.samples.length})`}</dt>
                <dd className="m-0 min-w-0 space-y-0.5 text-right">
                  {h.samples.length
                    ? h.samples.map((x) => (
                        <span key={x.styleId} className="block text-xs font-semibold text-foreground">
                          <span className="font-mono">{x.smpNo ?? x.sampleNo ?? "—"}</span>
                          {x.styleName ? <span className="block text-[11px] font-normal text-muted-foreground">{x.styleName}</span> : null}
                        </span>
                      ))
                    : "—"}
                </dd>
              </div>
            </DecisionFacts>
            {/* THE DOCUMENT, AND THE PLAN ITSELF — the order's "View full order
                data", plus the direct link the user asked for (2026-10-13). */}
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className={buttonClasses({ variant: "outline", size: "sm", className: "w-full" })}
            >
              View full plan report
              <ChevronRight aria-hidden />
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => router.push(planReportHref(plan.kind, h.bomId))}
                className={buttonClasses({ variant: "outline", size: "sm" })}
              >
                Report page
                <ExternalLink aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => router.push(`${PLAN_EDITOR_PATH[plan.kind]}?open=${h.bomId}`)}
                className={buttonClasses({ variant: "outline", size: "sm" })}
              >
                Open plan
                <ExternalLink aria-hidden />
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
      }
      body={plan.kind === "fabric" ? <FabricMiddle plan={plan.report} /> : <AccessoriesMiddle plan={plan.report} />}
      trail={
        <>
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
                  <p className="text-xs text-muted-foreground">
                    {shades && shades.length ? "No purchase quantity changed." : "No purchase quantity changed — only the plan’s details."}
                  </p>
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
                {/* SHADES & COLOURS (0727) — a shade swapped at the same kilos is
                    invisible to the purchase table above; this is where it shows.
                    Absent on a revision raised before its snapshot existed. */}
                {shades && shades.length > 0 ? (
                  <>
                    <h3 className="pt-1 text-xs font-semibold text-foreground">Shades &amp; colours</h3>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th scope="col" className="py-1 pr-2 text-left font-semibold">Material · colour</th>
                          <th scope="col" className="px-2 py-1 text-right font-semibold">Was</th>
                          <th scope="col" className="py-1 pl-2 text-right font-semibold">Now</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {shades.map((c, i) => (
                          <tr key={i} className="border-b border-border/60">
                            <th scope="row" className="py-1 pr-2 text-left font-normal">
                              <Truncated text={`${c.name} · ${c.colour}`} className="block max-w-[11rem]" />
                              <span className={cn("text-[10px]", c.kind === "added" ? "text-success" : c.kind === "removed" ? "text-danger" : "text-muted-foreground")}>
                                {`${c.part} · ${c.kind === "added" ? "new" : c.kind === "removed" ? "dropped" : "qty changed"}`}
                              </span>
                            </th>
                            <td className="px-2 py-1 text-right text-muted-foreground">{c.before == null ? "—" : fmtNumber(c.before)}</td>
                            <td className="py-1 pl-2 text-right font-semibold text-foreground">
                              {c.now == null ? "—" : `${fmtNumber(c.now)}${c.uom ? ` ${c.uom}` : ""}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : null}
              </CardBody>
            </Card>
          )}
        </>
      }
    />
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
  // A column every row leaves blank says nothing — a Fabric-mode plan's yarns
  // are derived from its cloths and carry no buy stage or planned kilos.
  const hasStage = plan.yarns.some((y) => y.buyStage);
  const hasPlanned = plan.yarns.some((y) => y.plannedKg != null);
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
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className={TH}>Sample</th>
                <th scope="col" className={cn(THR, "max-sm:hidden")}>Fabrics</th>
                <th scope="col" className={THR}>Req Kg</th>
                <th scope="col" className="py-1.5 pl-3 text-right font-semibold max-sm:hidden">Share</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {plan.bySample.map((x) => (
                <tr key={x.sample} className="border-b border-border/60">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">{x.sample}</th>
                  <td className="px-3 py-1.5 text-right max-sm:hidden">{fabricsBySample.get(x.sample)?.size ?? 0}</td>
                  <td className="px-3 py-1.5 text-right">{fmtNumber(x.kg)}</td>
                  <td className="py-1.5 pl-3 text-right max-sm:hidden">
                    {plan.fabricTotalKg > 0 ? `${((x.kg / plan.fabricTotalKg) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
              <tr className="bg-surface-muted font-semibold">
                <th scope="row" className="py-1.5 pr-3 text-left">Total</th>
                <td className="px-3 py-1.5 max-sm:hidden" />
                <td className="px-3 py-1.5 text-right">{fmtNumber(plan.fabricTotalKg)}</td>
                <td className="py-1.5 pl-3 max-sm:hidden" />
              </tr>
            </tbody>
          </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Yarn to Buy</h2>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className={TH}>Yarn</th>
                {hasStage ? <th scope="col" className="px-3 py-1.5 text-left font-semibold max-sm:hidden">Bought as</th> : null}
                {hasPlanned ? <th scope="col" className={cn(THR, "max-sm:hidden")}>Planned Kg</th> : null}
                <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Purchase</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {plan.yarns.map((y, i) => (
                <tr key={i} className="border-b border-border/60">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {y.yarn}
                    {y.shades.length ? (
                      <span className="block text-[11px] text-muted-foreground">{y.shades.map((sh) => sh.colour).join(" · ")}</span>
                    ) : null}
                  </th>
                  {hasStage ? <td className="px-3 py-1.5 text-muted-foreground max-sm:hidden">{y.buyStage ?? "—"}</td> : null}
                  {hasPlanned ? (
                    <td className="px-3 py-1.5 text-right max-sm:hidden">{y.plannedKg == null ? "—" : fmtNumber(y.plannedKg)}</td>
                  ) : null}
                  <td className={cn("whitespace-nowrap py-1.5 pl-3 text-right", y.purchaseQty == null && "whitespace-normal text-danger")}>
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
          </div>
        </CardBody>
      </Card>
    </>
  );
}

/**
 * THE ACCESSORIES PLAN, IN THE FABRIC PLAN'S SHAPE (user 2026-10-14: "follow
 * the fabric plan approval same"): four tiles, then the plan BY SAMPLE (the
 * Fabric side's "Fabric by Sample"), then what it buys. The buy list is
 * grouped under its category the way Order Entry's Accessories Requirement
 * prints it — a category band written once over its trims — so the approver
 * reads the same grouping here as on the report beside it.
 */
function AccessoriesMiddle({ plan }: { plan: Extract<PlanReport, { kind: "accessories" }>["report"] }) {
  const advised = plan.items.filter((i) => i.advised).length;
  const unpriced = plan.items.filter((i) => i.purchaseQty == null).length;
  const categories = [...new Set(plan.items.map((i) => i.category ?? "Uncategorised"))];

  // By sample: how many trims each SMP uses, and how many of those wait on the buyer.
  const bySample = new Map<string, { trims: Set<string>; advised: Set<string> }>();
  for (const it of plan.items) {
    for (const b of it.breakup) {
      const row = bySample.get(b.sample) ?? { trims: new Set<string>(), advised: new Set<string>() };
      row.trims.add(`${it.sno}`);
      if (it.advised) row.advised.add(`${it.sno}`);
      bySample.set(b.sample, row);
    }
  }
  const unassigned = plan.items.filter((it) => it.breakup.length === 0).length;

  // To buy, grouped by category in the plan's own order (first line entered first).
  const groups: { category: string; items: typeof plan.items }[] = [];
  for (const it of [...plan.items].sort((x, y) => x.sno - y.sno)) {
    const c = it.category ?? "Uncategorised";
    const g = groups.find((x) => x.category === c);
    if (g) g.items.push(it);
    else groups.push({ category: c, items: [it] });
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Trims to buy" value={String(plan.items.length)} sub={`${categories.length} categor${categories.length === 1 ? "y" : "ies"}`} tone="text-primary" />
        <Tile label="Samples" value={String(plan.header.samples.length)} sub={plan.header.season ?? undefined} />
        <Tile
          label="Advised"
          value={String(advised)}
          sub={advised ? "Cannot be bought until confirmed" : "Nothing waits on the buyer"}
          tone={advised ? "text-warning" : undefined}
        />
        <Tile
          label="Without a purchase qty"
          value={String(unpriced)}
          sub={unpriced ? "Cannot be bought yet" : "Every trim is worked out"}
          tone={unpriced ? "text-danger" : undefined}
        />
      </div>

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Accessories by Sample</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className={TH}>Sample</th>
                  <th scope="col" className={THR}>Trims</th>
                  <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Advised</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[...bySample].map(([sample, x]) => (
                  <tr key={sample} className="border-b border-border/60">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">{sample}</th>
                    <td className="px-3 py-1.5 text-right">{x.trims.size}</td>
                    <td className={cn("py-1.5 pl-3 text-right", x.advised.size ? "font-semibold text-warning" : "text-muted-foreground")}>
                      {x.advised.size || "—"}
                    </td>
                  </tr>
                ))}
                {unassigned ? (
                  <tr className="border-b border-border/60">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">Not split by sample</th>
                    <td className="px-3 py-1.5 text-right">{unassigned}</td>
                    <td className="py-1.5 pl-3" />
                  </tr>
                ) : null}
                {bySample.size === 0 && !unassigned ? (
                  <tr>
                    <td colSpan={3} className="py-1.5 text-muted-foreground">No accessory is planned yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Accessories to Buy</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className={TH}>Accessory</th>
                  <th scope="col" className="px-3 py-1.5 text-left font-semibold max-sm:hidden">Colour</th>
                  <th scope="col" className={cn(THR, "max-sm:hidden")}>Required</th>
                  <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Purchase</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.category} className="tabular-nums">
                  {/* THE CATEGORY BAND — written once over its trims, as the report prints it. */}
                  <tr className="bg-primary-soft/60">
                    <th scope="colgroup" colSpan={4} className="px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wide text-primary">
                      {`${g.category} · ${g.items.length}`}
                    </th>
                  </tr>
                  {g.items.map((it, i) => (
                    <tr key={`${g.category}-${i}`} className="border-b border-border/60">
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                        {it.item}
                        {it.advised || it.foc || it.sendOut ? (
                          <span className="block text-[11px] text-warning">
                            {[it.advised ? "Advised" : null, it.foc ? "FOC" : null, it.sendOut ? "Send out" : null].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </th>
                      <td className="px-3 py-1.5 text-muted-foreground max-sm:hidden">{it.colour ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right max-sm:hidden">
                        {it.requiredQty == null ? "—" : `${fmtNumber(it.requiredQty)}${it.consumptionUom ? ` ${it.consumptionUom}` : ""}`}
                      </td>
                      <td className={cn("whitespace-nowrap py-1.5 pl-3 text-right", it.purchaseQty == null && "whitespace-normal text-danger")}>
                        {it.purchaseQty == null ? (it.refusal ?? "Not worked out") : `${fmtNumber(it.purchaseQty)}${it.purchaseUom ? ` ${it.purchaseUom}` : ""}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
              {plan.items.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={4} className="py-1.5 text-muted-foreground">No accessory is planned yet.</td>
                  </tr>
                </tbody>
              ) : null}
            </table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
