"use client";

/**
 * THE SAMPLE PLAN REPORTS ON SCREEN (user 2026-10-13: "like order entry
 * report … for sample module fabric plan and accessories plan"). Drawn with
 * the order reports' one look (`components/orders/report-kit.tsx`, AGENTS.md
 * "Report look kit") so a sample plan reads as the same kind of document as
 * an order's Yarn & Fabric Requirement — masthead, facts, the figures to buy
 * as tiles, then one card per section, signed at the foot.
 *
 * The SAME object goes to the PDF (`lib/sales/plan-reports/export.ts`), so the
 * screen and the file cannot disagree. Shown on the report pages and inside
 * Sample ▸ Plan Approval, where the approver reads it before deciding.
 */

import { Fragment } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BRAND,
  OrderFacts,
  ReportTable,
  STAGE_STYLES,
  SectionCard,
  SheetLabel,
  SheetMasthead,
  SignOff,
  SummaryTiles,
  Td,
  Th,
  stripeRow,
  totalRowStyle,
  type SheetFact,
} from "@/components/orders/report-kit";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import type { PdfOutput } from "@/lib/orders/fabric-bom/reports-export";
import { exportAccessoriesPlanPdf, exportFabricPlanPdf } from "@/lib/sales/plan-reports/export";
import {
  PLAN_KIND_LABEL,
  planApprovalLabel,
  type AccessoriesPlanReport,
  type FabricPlanReport,
  type PlanReport,
  type PlanReportHeader,
} from "@/lib/sales/plan-reports/types";

const kg = (v: number | null) => (v == null ? "—" : fmtNumber(v));

/** Download PDF, then Print — both the SAME PDF, as the order reports do. */
function ExportBar({ pdf }: { pdf: (output: PdfOutput) => Promise<void> }) {
  const { error: toastError } = useToast();
  const run = (o: PdfOutput) => pdf(o).catch((e: unknown) => toastError(e instanceof Error ? e.message : "Could not build the PDF"));
  return (
    <div className="mb-3 flex justify-end gap-2 print:hidden">
      <Button type="button" variant="primary" onClick={() => void run("download")}>
        <Download className="h-4 w-4" />
        Download PDF
      </Button>
      <Button type="button" variant="outline" onClick={() => void run("print")}>
        <Printer className="h-4 w-4" />
        Print / Print Preview
      </Button>
    </div>
  );
}

/** The plan's facts — what an approver checks first: which SWO, which season,
 *  which samples, and where the plan stands. */
export function planFacts(h: PlanReportHeader): SheetFact[] {
  return [
    { label: "SWO No", value: h.swoCode ?? "—", mono: true, sub: h.description },
    { label: "Season", value: h.season ?? "—" },
    { label: "Plan Date", value: h.planDate ? fmtDate(h.planDate) : "—", sub: h.iwoCode ? `Work order ${h.iwoCode}` : null },
    {
      label: `Samples (${h.samples.length})`,
      value: h.samples.map((x) => x.smpNo ?? x.sampleNo).filter(Boolean).join(", ") || "—",
      mono: true,
    },
    {
      label: "Approval",
      value: h.isDraft ? "Draft" : planApprovalLabel(h.status, h.revisionNo),
      sub:
        h.status === "approved" && h.approvedAt
          ? `Approved ${fmtDate(h.approvedAt)}`
          : h.status === "submitted" && h.submittedAt
            ? `Submitted ${fmtDate(h.submittedAt)}`
            : h.status === "returned" && h.decisionRemark
              ? `Sent back: ${h.decisionRemark}`
              : null,
    },
    {
      label: "Revision",
      value: h.revisionNo ? `Rev ${h.revisionNo}` : "Rev 0",
      sub: h.revision ? h.revision.reason : null,
    },
  ];
}

function Opening({ h }: { h: PlanReportHeader }) {
  return (
    <>
      <SheetMasthead
        company={h.company}
        kind={`Sample ${PLAN_KIND_LABEL[h.kind]}`}
        reNo={h.swoCode}
        meta={h.planDate ? <span>{fmtDate(h.planDate)}</span> : null}
        status={h.status === "approved" ? (h.revisionNo ? `Approved · Rev ${h.revisionNo}` : "Approved") : null}
      />
      <OrderFacts facts={planFacts(h)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Fabric Plan
// ---------------------------------------------------------------------------

export function FabricPlanReportView({ report, exportable = true }: { report: FabricPlanReport; exportable?: boolean }) {
  const r = report;
  // One sample's rows run together; its name prints once, on the first.
  const firstOfSample = (i: number) => i === 0 || r.fabrics[i - 1].sample !== r.fabrics[i].sample;
  const lastOfSample = (i: number) => i === r.fabrics.length - 1 || r.fabrics[i + 1].sample !== r.fabrics[i].sample;
  const sampleKg = new Map(r.bySample.map((x) => [x.sample, x.kg]));
  return (
    <div className="space-y-4">
      {exportable && <ExportBar pdf={(o) => exportFabricPlanPdf(r, o)} />}
      <div>
        <Opening h={r.header} />
      </div>

      <div>
        <SheetLabel>To buy and make for this SWO</SheetLabel>
        <SummaryTiles
          tiles={[
            { label: "Fabric required", value: fmtNumber(r.fabricTotalKg), unit: "kg", tone: STAGE_STYLES.greige },
            {
              label: "Yarn to buy",
              value: r.yarnTotal ? fmtNumber(r.yarnTotal.qty) : "—",
              unit: r.yarnTotal?.uom ?? undefined,
              note: r.yarnTotal ? `${r.yarns.length} yarn${r.yarns.length === 1 ? "" : "s"}` : "A yarn has no purchase weight",
              tone: STAGE_STYLES.yarn,
            },
            { label: "Fabrics", value: String(new Set(r.fabrics.map((f) => f.fabric)).size), tone: BRAND },
            { label: "Samples", value: String(r.header.samples.length), tone: BRAND },
          ]}
        />
      </div>

      <SectionCard tone={STAGE_STYLES.greige} title="Fabric requirement — sample by sample" total={`${fmtNumber(r.fabricTotalKg)} kg`} totalLabel="Total">
        <ReportTable bare>
          <thead>
            <tr>
              <Th>Sample</Th>
              <Th>Fabric</Th>
              <Th>Structure</Th>
              <Th>Stage</Th>
              <Th>Form</Th>
              <Th right>GSM</Th>
              <Th>Colour</Th>
              <Th>Dia</Th>
              <Th>Print</Th>
              <Th right>Req Kg</Th>
            </tr>
          </thead>
          <tbody>
            {r.fabrics.length === 0 ? (
              <tr>
                <Td colSpan={10}>No fabric is planned yet.</Td>
              </tr>
            ) : (
              r.fabrics.map((f, i) => (
                <Fragment key={i}>
                  <tr style={stripeRow(i)}>
                    <Td className="font-medium">{firstOfSample(i) ? f.sample : ""}</Td>
                    <Td>{f.fabric}</Td>
                    <Td>{f.structure ?? "—"}</Td>
                    <Td>{f.stage ?? "—"}</Td>
                    <Td>{f.form ?? "—"}</Td>
                    <Td right mono>{f.gsm == null ? "—" : fmtNumber(f.gsm)}</Td>
                    <Td>{f.colour ?? "—"}</Td>
                    <Td mono>{f.dia ?? "—"}</Td>
                    <Td>{f.print ?? "—"}</Td>
                    <Td right mono>{kg(f.reqKg)}</Td>
                  </tr>
                  {lastOfSample(i) && r.bySample.length > 1 ? (
                    <tr style={totalRowStyle(STAGE_STYLES.greige)}>
                      <Td colSpan={9} className="text-right">{`${f.sample} total`}</Td>
                      <Td right mono>{kg(sampleKg.get(f.sample) ?? null)}</Td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </ReportTable>
      </SectionCard>

      <SectionCard
        tone={STAGE_STYLES.yarn}
        title="Yarn purchase"
        total={r.yarnTotal ? `${fmtNumber(r.yarnTotal.qty)}${r.yarnTotal.uom ? ` ${r.yarnTotal.uom}` : ""}` : null}
        totalLabel="To order"
      >
        <ReportTable bare>
          <thead>
            <tr>
              <Th>Yarn</Th>
              <Th>Bought as</Th>
              <Th>Colour by</Th>
              <Th right>Planned Kg</Th>
              <Th right>Purchase</Th>
              <Th>Unit</Th>
            </tr>
          </thead>
          <tbody>
            {r.yarns.length === 0 ? (
              <tr>
                <Td colSpan={6}>No yarn is derived from this plan yet.</Td>
              </tr>
            ) : (
              r.yarns.map((y, i) => (
                <Fragment key={i}>
                  <tr style={stripeRow(i)}>
                    <Td className="font-medium">{y.yarn}</Td>
                    <Td>{y.buyStage ?? "—"}</Td>
                    <Td>{y.colourBy ?? "—"}</Td>
                    <Td right mono>{kg(y.plannedKg)}</Td>
                    <Td right mono>{kg(y.purchaseQty)}</Td>
                    <Td>{y.uom ?? "—"}</Td>
                  </tr>
                  {y.shades.map((sh, j) => (
                    <tr key={`${i}-${j}`}>
                      <Td className="pl-6 text-[#5b6472]">{`↳ ${sh.colour}`}</Td>
                      <Td>{""}</Td>
                      <Td>{""}</Td>
                      <Td right mono>{kg(sh.plannedKg)}</Td>
                      <Td right mono>{kg(sh.purchaseQty)}</Td>
                      <Td>{y.uom ?? ""}</Td>
                    </tr>
                  ))}
                  {y.purchaseQty == null && y.refusal ? (
                    <tr>
                      <Td colSpan={6} className="text-danger">{y.refusal}</Td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </ReportTable>
      </SectionCard>

      <SectionCard tone={STAGE_STYLES.dyed} title="Processing route">
        <ReportTable bare>
          <thead>
            <tr>
              <Th>Fabric</Th>
              <Th right>Step</Th>
              <Th>Stage</Th>
              <Th>Process</Th>
              <Th>Type</Th>
              <Th right>Loss %</Th>
            </tr>
          </thead>
          <tbody>
            {r.routes.length === 0 ? (
              <tr>
                <Td colSpan={6}>No processing route is planned.</Td>
              </tr>
            ) : (
              r.routes.flatMap((route, ri) =>
                route.steps.map((st, si) => (
                  <tr key={`${ri}-${si}`} style={stripeRow(ri)}>
                    <Td className="font-medium">{si === 0 ? route.fabric : ""}</Td>
                    <Td right mono>{si + 1}</Td>
                    <Td>{st.stage ?? "—"}</Td>
                    <Td>{st.process}</Td>
                    <Td>{st.type ?? "—"}</Td>
                    <Td right mono>{st.lossPct == null ? "—" : fmtNumber(st.lossPct)}</Td>
                  </tr>
                )),
              )
            )}
          </tbody>
        </ReportTable>
      </SectionCard>

      <SignOff />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accessories Plan
// ---------------------------------------------------------------------------

export function AccessoriesPlanReportView({ report, exportable = true }: { report: AccessoriesPlanReport; exportable?: boolean }) {
  const r = report;
  const advised = r.items.filter((i) => i.advised).length;
  const flags = (i: AccessoriesPlanReport["items"][number]) =>
    [i.advised ? "Advised" : null, i.foc ? "FOC" : null, i.sendOut ? "Send out" : null].filter(Boolean).join(" · ");
  return (
    <div className="space-y-4">
      {exportable && <ExportBar pdf={(o) => exportAccessoriesPlanPdf(r, o)} />}
      <div>
        <Opening h={r.header} />
      </div>

      <div>
        <SheetLabel>To buy for this SWO</SheetLabel>
        <SummaryTiles
          tiles={[
            { label: "Accessories", value: String(r.items.length), tone: BRAND },
            { label: "Samples", value: String(r.header.samples.length), tone: BRAND },
            {
              label: "Advised",
              value: String(advised),
              note: advised ? "Cannot be bought until confirmed" : "Nothing waits on the buyer",
              tone: advised ? STAGE_STYLES.yarn : BRAND,
            },
            {
              label: "Without a purchase qty",
              value: String(r.items.filter((i) => i.purchaseQty == null).length),
              tone: BRAND,
            },
          ]}
        />
      </div>

      <SectionCard tone={BRAND} title="Accessories — consolidated, with each sample's share">
        <ReportTable bare>
          <thead>
            <tr>
              <Th right>#</Th>
              <Th>Category</Th>
              <Th>Accessory</Th>
              <Th>Specification</Th>
              <Th>Colour</Th>
              <Th right>Planned</Th>
              <Th right>MOQ</Th>
              <Th right>Required</Th>
              <Th right>Purchase</Th>
              <Th>Unit</Th>
              <Th>Flags</Th>
            </tr>
          </thead>
          <tbody>
            {r.items.length === 0 ? (
              <tr>
                <Td colSpan={11}>No accessory is planned yet.</Td>
              </tr>
            ) : (
              r.items.map((it, i) => (
                <Fragment key={i}>
                  <tr style={stripeRow(i)}>
                    <Td right mono>{it.sno}</Td>
                    <Td>{it.category ?? "—"}</Td>
                    <Td className="font-medium">{it.item}</Td>
                    <Td>{it.specification ?? "—"}</Td>
                    <Td>{it.colour ?? "—"}</Td>
                    <Td right mono>{kg(it.plannedQty)}</Td>
                    <Td right mono>{kg(it.moq)}</Td>
                    <Td right mono>{kg(it.requiredQty)}</Td>
                    <Td right mono>{kg(it.purchaseQty)}</Td>
                    <Td>{it.purchaseUom ?? "—"}</Td>
                    <Td>{flags(it) || "—"}</Td>
                  </tr>
                  {it.breakup.map((b, j) => (
                    <tr key={`${i}-${j}`}>
                      <Td>{""}</Td>
                      <Td colSpan={2} className="pl-6 text-[#5b6472]">{`↳ ${b.sample}`}</Td>
                      <Td>{""}</Td>
                      <Td>{[b.colour, b.size].filter(Boolean).join(" · ") || "—"}</Td>
                      <Td right mono>{kg(b.qty)}</Td>
                      <Td colSpan={5}>{""}</Td>
                    </tr>
                  ))}
                  {it.purchaseQty == null && it.refusal ? (
                    <tr>
                      <Td colSpan={11} className="text-danger">{it.refusal}</Td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </ReportTable>
      </SectionCard>

      {r.processes.length > 0 && (
        <SectionCard tone={STAGE_STYLES.print} title="Accessory processing">
          <ReportTable bare>
            <thead>
              <tr>
                <Th>Accessory</Th>
                <Th>Stage</Th>
                <Th>Process</Th>
                <Th right>Loss %</Th>
                <Th>Vendor</Th>
              </tr>
            </thead>
            <tbody>
              {r.processes.map((p, i) => (
                <tr key={i} style={stripeRow(i)}>
                  <Td className="font-medium">{p.item}</Td>
                  <Td>{p.stage ?? "—"}</Td>
                  <Td>{p.process}</Td>
                  <Td right mono>{p.lossPct == null ? "—" : fmtNumber(p.lossPct)}</Td>
                  <Td>{p.vendor ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </SectionCard>
      )}

      <SignOff />
    </div>
  );
}

/** Either report, by kind — what the approval screen renders. */
export function PlanReportView({ plan, exportable = true }: { plan: PlanReport; exportable?: boolean }) {
  return plan.kind === "fabric" ? (
    <FabricPlanReportView report={plan.report} exportable={exportable} />
  ) : (
    <AccessoriesPlanReportView report={plan.report} exportable={exportable} />
  );
}
