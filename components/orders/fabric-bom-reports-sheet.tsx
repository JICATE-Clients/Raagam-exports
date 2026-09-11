"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import {
  loadFabricBomEntryRegister,
  loadYarnFabricRequirementReport,
} from "@/lib/orders/fabric-bom/actions";
import type { BomDocHeader, EntryRegister, YarnFabricRequirementReport } from "@/lib/orders/fabric-bom/reports";
import { isReportRefusal } from "@/lib/orders/fabric-bom/report-refusal";
import {
  exportEntryRegisterCsv,
  exportEntryRegisterPdf,
  exportYarnRequirementCsv,
  exportYarnRequirementPdf,
} from "@/lib/orders/fabric-bom/reports-export";

/**
 * Orders ▸ Fabric BOM ▸ Reports — a `size="lg"` Sheet holding both per-BOM
 * documents (see `lib/orders/fabric-bom/reports.ts`'s header for what each
 * reads). `lg`, not `sm`: this is a dense multi-section document register,
 * not the small nested-picker popup the sub-detail-sheet-size convention is
 * about — see the `raagam-screen-layout` skill's own distinction.
 *
 * READ-ONLY: no fields, no Save, no `useUnsavedGuard` — nothing here can be
 * left half-typed. `footer` names how it closes and nothing else, the same
 * `SubSheetFooter` shape a sub-detail with nothing of its own to save already
 * uses elsewhere in this module.
 */
export function FabricBomReportsSheet({
  bomId,
  open,
  onClose,
}: {
  bomId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  /* KEYED BY THE BOM IT WAS LOADED FOR, never reset synchronously — the same
     `paletteState.forOrder` idiom this screen already uses. `set-state-in-
     effect` (React Compiler) is an ERROR here: a `setLoading(true)` / reset
     pair at the top of the effect body is exactly the shape it refuses, and
     AGENTS.md already records the fix for this file's siblings — derive
     "loading" and "stale for a different BOM" at render time instead of
     stamping them from the effect. */
  const [register, setRegister] = useState<{
    forBom: string;
    data: EntryRegister | { refused: string };
  } | null>(null);
  const [requirement, setRequirement] = useState<{
    forBom: string;
    data: YarnFabricRequirementReport | { refused: string };
  } | null>(null);

  useEffect(() => {
    if (!open || !bomId) return;
    let cancelled = false;
    Promise.all([loadFabricBomEntryRegister(bomId), loadYarnFabricRequirementReport(bomId)]).then(
      ([r, y]) => {
        if (cancelled) return;
        setRegister({ forBom: bomId, data: r });
        setRequirement({ forBom: bomId, data: y });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, bomId]);

  const registerData = register && bomId && register.forBom === bomId ? register.data : null;
  const requirementData =
    requirement && bomId && requirement.forBom === bomId ? requirement.data : null;
  const loading = open && !!bomId && registerData == null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title="Fabric BOM Reports"
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Close
          </button>
        </div>
      }
    >
      {loading || !bomId ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <Tabs
          items={[
            {
              key: "register",
              label: "Fabric BOM Entry Register",
              content: <EntryRegisterView data={registerData} />,
            },
            {
              key: "requirement",
              label: "Yarn & Fabric Requirement",
              content: <RequirementReportView data={requirementData} />,
            },
          ]}
        />
      )}
    </Sheet>
  );
}

function ReportHeaderBand({ header }: { header: BomDocHeader }) {
  const qty = header.qty;
  return (
    <div className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Field label="SC No" value={header.scNo} />
        <Field label="Order No" value={header.orderNo} />
        <Field label="Style Ref No" value={header.styleRefNo} />
        <Field label="Style No" value={header.styleNo} />
        <Field label="Customer" value={header.customer} />
        <Field label="Delivery" value={fmtDate(header.deliveryFromDate)} />
        <Field label="BOM Dt" value={fmtDate(header.bomDate)} />
        <Field
          label="Computed"
          value={header.computedAt ? fmtDateTime(header.computedAt) : "—"}
        />
      </div>
      {isReportRefusal(qty) ? (
        <div className="mt-2 text-sm font-medium text-destructive">{qty.refused}</div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
          <span>Order Qty {fmtNumber(qty.orderQty)}</span>
          <span>
            Excess {header.excessPct != null ? `${header.excessPct}%` : ""} (
            {fmtNumber(qty.excessQty)})
          </span>
          <span>Rejection Allowance {fmtNumber(qty.rejectionQty)}</span>
          <span>Approval Allowance {fmtNumber(qty.approvalQty)}</span>
          <span className="font-semibold text-foreground">SQ Qty {fmtNumber(qty.sqQty)}</span>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span>
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </span>
  );
}

function EntryRegisterView({ data }: { data: EntryRegister | { refused: string } | null }) {
  if (!data) return null;
  if (isReportRefusal(data)) {
    return <div className="p-4 text-sm text-destructive">{data.refused}</div>;
  }
  return (
    <div className="p-1">
      <div className="mb-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => exportEntryRegisterCsv(data)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          <FileSpreadsheet className="h-4 w-4" />
          Excel
        </button>
        <button
          type="button"
          onClick={() => exportEntryRegisterPdf(data)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" />
          Download PDF
        </button>
      </div>
      <ReportHeaderBand header={data.header} />
      {data.groups.map((g) => (
        <div key={g.itemId} className="mb-4">
          <div className="mb-1 text-sm font-semibold">{g.fabricName}</div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 pr-2">Assort Colour</th>
                <th className="py-1 pr-2">Component</th>
                <th className="py-1 pr-2">Size</th>
                <th className="py-1 pr-2 text-right">SQ Qty</th>
                <th className="py-1 pr-2 text-right">Piece Wt</th>
                <th className="py-1 pr-2 text-right">Wastage %</th>
                <th className="py-1 pr-2 text-right">Net Req Wt</th>
                <th className="py-1 pr-2 text-right">Total Wt</th>
                <th className="py-1">Unit</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-1 pr-2">{l.combo || "—"}</td>
                  <td className="py-1 pr-2">{l.components.join(", ") || "—"}</td>
                  <td className="py-1 pr-2">{l.sizeLabel}</td>
                  <td className="py-1 pr-2 text-right font-mono">{fmtNumber(l.sqQty)}</td>
                  <td className="py-1 pr-2 text-right font-mono">
                    {l.pieceWt != null ? fmtNumber(l.pieceWt) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono">
                    {l.wastagePct != null ? `${l.wastagePct}%` : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right font-mono">{fmtNumber(l.netReqWt)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{fmtNumber(l.grossWt)}</td>
                  <td className="py-1">{l.uomCode ?? "—"}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1 pr-2" colSpan={3}>
                  Subtotal
                </td>
                <td className="py-1 pr-2 text-right font-mono">{fmtNumber(g.subtotal.sqQty)}</td>
                <td className="py-1 pr-2" colSpan={2} />
                <td className="py-1 pr-2 text-right font-mono">
                  {fmtNumber(g.subtotal.netReqWt)}
                </td>
                <td className="py-1 pr-2 text-right font-mono">
                  {fmtNumber(g.subtotal.grossWt)}
                </td>
                <td className="py-1" />
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <div className="mb-6 flex justify-end gap-4 border-t border-border pt-2 text-sm font-semibold">
        <span>Grand Total</span>
        <span className="font-mono">SQ {fmtNumber(data.grandTotal.sqQty)}</span>
        <span className="font-mono">Wt {fmtNumber(data.grandTotal.grossWt)}</span>
      </div>

      <div className="text-sm font-semibold">Process Sequence &amp; Stage Loss Ledger</div>
      <table className="mt-1 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1 pr-2">Class</th>
            <th className="py-1 pr-2">Item</th>
            <th className="py-1 pr-2">Stage</th>
            <th className="py-1 pr-2">Process</th>
            <th className="py-1 text-right">Loss %</th>
          </tr>
        </thead>
        <tbody>
          {data.stageLedger.map((r, i) => (
            <tr key={i} className="border-b border-border/50">
              <td className="py-1 pr-2">{r.className}</td>
              <td className="py-1 pr-2">{r.itemName}</td>
              <td className="py-1 pr-2">{r.stageName ?? "—"}</td>
              <td className="py-1 pr-2">{r.processName ?? "—"}</td>
              <td className="py-1 text-right font-mono">
                {r.lossPct != null ? `${r.lossPct.toFixed(2)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequirementReportView({
  data,
}: {
  data: YarnFabricRequirementReport | { refused: string } | null;
}) {
  if (!data) return null;
  if (isReportRefusal(data)) {
    return <div className="p-4 text-sm text-destructive">{data.refused}</div>;
  }
  return (
    <div className="p-1">
      <div className="mb-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => exportYarnRequirementCsv(data)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          <FileSpreadsheet className="h-4 w-4" />
          Excel
        </button>
        <button
          type="button"
          onClick={() => exportYarnRequirementPdf(data)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" />
          Download PDF
        </button>
      </div>
      <ReportHeaderBand header={data.header} />

      <div className="text-sm font-semibold">Yarn Purchase Requirement</div>
      <table className="mt-1 mb-4 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1 pr-2">Yarn</th>
            <th className="py-1 pr-2 text-right">Purchase Wt</th>
            <th className="py-1">Unit</th>
          </tr>
        </thead>
        <tbody>
          {data.yarns.map((y) => (
            <tr key={y.itemId} className="border-b border-border/50">
              <td className="py-1 pr-2">{y.yarnName}</td>
              <td className="py-1 pr-2 text-right font-mono">
                {y.purchaseQty != null ? fmtNumber(y.purchaseQty) : "—"}
              </td>
              <td className="py-1">{y.uomCode ?? "—"}</td>
              {y.refusalReason && (
                <td className="py-1 text-destructive" colSpan={1}>
                  {y.refusalReason}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="text-sm font-semibold">Process Stage Ledger</div>
      {data.stageBreakdown.map((g) => (
        <div key={g.processName} className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.processName}
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 pr-2">Details</th>
                <th className="py-1 pr-2">Colour</th>
                <th className="py-1 pr-2 text-right">Planned Wt</th>
                <th className="py-1 pr-2 text-right">Loss %</th>
                <th className="py-1 pr-2 text-right">To Ordered Wt</th>
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-1 pr-2">{l.fabricName}</td>
                  <td className="py-1 pr-2">{l.combo ?? "—"}</td>
                  <td className="py-1 pr-2 text-right font-mono">{fmtNumber(l.plannedWt)}</td>
                  <td className="py-1 pr-2 text-right font-mono">{l.lossPct.toFixed(2)}%</td>
                  <td className="py-1 pr-2 text-right font-mono">{fmtNumber(l.toOrderedWt)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1 pr-2" colSpan={2}>
                  Grand Total
                </td>
                <td className="py-1 pr-2 text-right font-mono">{fmtNumber(g.plannedTotal)}</td>
                <td className="py-1 pr-2" />
                <td className="py-1 pr-2 text-right font-mono">{fmtNumber(g.toOrderedTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
