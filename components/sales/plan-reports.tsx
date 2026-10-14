"use client";

/**
 * THE SAMPLE PLAN REPORTS ON SCREEN (user 2026-10-13: "like order entry
 * report … for sample module fabric plan and accessories plan"; 2026-10-14:
 * "same format from order entry"). Each plan prints through ORDER ENTRY'S OWN
 * report component, fed the sample plan in the order report's shape:
 *
 *   - Fabric Plan      → `FabricBomReportView`, the Yarn & Fabric Requirement
 *                        (lib/sales/plan-reports/yarn-fabric.ts);
 *   - Accessories Plan → `RequirementSheetDocument`, the Accessories
 *                        Requirement (lib/sales/plan-reports/accessories-requirement.ts).
 *
 * Their PDF / Print / Excel are the order reports' exporters too, so screen,
 * file and Order Entry cannot drift. Shown on the report pages and inside
 * Sample ▸ Plan Approval, where the approver reads it before deciding.
 */

import { FabricBomReportView } from "@/components/orders/fabric-bom-reports-sheet";
import { RequirementSheetDocument } from "@/components/orders/requirement-sheet";
import { RequirementToolbar } from "@/components/orders/requirement-toolbar";
import type { AccessoriesPlanReport, FabricPlanReport, PlanReport } from "@/lib/sales/plan-reports/types";

// ---------------------------------------------------------------------------
// Fabric Plan — ORDER ENTRY'S FABRIC PLAN REPORT, the same component
// ---------------------------------------------------------------------------

/**
 * THE SAMPLE FABRIC PLAN PRINTS AS ORDER ENTRY'S (user 2026-10-14: "the fabric
 * plan report need to same as like order entry fabric plan report"). Not a
 * copy of its look: the order report's own `FabricBomReportView` — Yarn &
 * Fabric Requirement — fed the sample plan in the order report's shape
 * (`lib/sales/plan-reports/yarn-fabric.ts`). Its Download PDF / Print are the
 * order report's exporter too, so screen, file and Order Entry cannot drift.
 * `exportable` stays for the Accessories twin's signature; the order report
 * always carries its own bar.
 */
export function FabricPlanReportView({ report }: { report: FabricPlanReport; exportable?: boolean }) {
  return <FabricBomReportView report="yarn-fabric-requirement" register={null} requirement={report.requirement} />;
}

// ---------------------------------------------------------------------------
// Accessories Plan — ORDER ENTRY'S ACCESSORIES PLAN REPORT, the same component
// ---------------------------------------------------------------------------

/**
 * THE SAMPLE ACCESSORIES PLAN PRINTS AS ORDER ENTRY'S (user 2026-10-14: "the
 * report is take reference same format from order entry accessories plan
 * report format"). Not a copy of its look: the order report's own
 * `RequirementSheetDocument` — the Accessories Requirement — fed the sample
 * plan in the order report's shape (`lib/sales/plan-reports/accessories-
 * requirement.ts`), with its own Excel / Print / Download PDF. The Fabric Plan
 * twin above does the same with the Yarn & Fabric Requirement.
 *
 * `exportable={false}` (the approval screen's sheet) drops the toolbar only.
 */
export function AccessoriesPlanReportView({ report, exportable = true }: { report: AccessoriesPlanReport; exportable?: boolean }) {
  return (
    <div className="space-y-3">
      {exportable && (
        <div className="flex justify-end print:hidden">
          <RequirementToolbar data={report.requirement} />
        </div>
      )}
      <RequirementSheetDocument data={report.requirement} />
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
