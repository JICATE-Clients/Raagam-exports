"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { fmtQty } from "@/lib/uom/convert";
import { loadMaterialBomRequirementReport } from "@/lib/orders/material-bom-amendment/report-actions";
import { loadVFinalForBom } from "@/lib/orders/amendments/v-final-actions";
import { VFinalSheetNote, type SheetVFinal } from "@/components/orders/v-final-sheet-note";
import type { MbaRequirementReport } from "@/lib/orders/material-bom-amendment/requirement-report-types";
import {
  exportMaterialBomRequirementCsv,
  exportMaterialBomRequirementPdf,
} from "@/lib/orders/material-bom-amendment/requirement-report-export";
import {
  ORDER_REPORTS,
  isMaterialBomSheetReport,
  type MaterialBomReportKey,
} from "@/lib/orders/order-reports";

/**
 * Orders ▸ Material BOM ▸ Reports (client 2026-09-20: "there is no material bom
 * report … need add report icon … the material bom requirement tab is for can
 * take for report").
 *
 * THE FABRIC BOM'S SHAPE, ON PURPOSE — a `size="lg"` read-only Sheet opened
 * from the editor header or straight off the queue card, whose tabs are the
 * registry's `material-bom` entries with no page of their own. A report added
 * to `ORDER_REPORTS` appears here AND on Order Entry's Reports strip at once;
 * a tab typed here by hand would be the drift the registry exists to stop.
 *
 * READ-ONLY: no fields, no Save, no `useUnsavedGuard` — nothing can be left
 * half-typed, and `Sheet` registers itself as a modal for the reload guard.
 */
export function MaterialBomReportsSheet({
  bomId,
  open,
  onClose,
}: {
  bomId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  /* KEYED BY THE BOM IT WAS LOADED FOR and never reset inside the effect —
     "loading" is derived at render time, the idiom `FabricBomReportsSheet`
     records (a synchronous reset in the effect is what React Compiler's
     `set-state-in-effect` refuses). */
  const [loaded, setLoaded] = useState<{
    forBom: string;
    data: MbaRequirementReport | { refused: string };
  } | null>(null);

  /* V_FINAL (0619, spec §4B) — the approved version while the order is
     amending; see `FabricBomReportsSheet`. */
  const [vf, setVf] = useState<{ forBom: string; data: SheetVFinal } | null>(null);
  const [showProposed, setShowProposed] = useState(false);

  useEffect(() => {
    if (!open || !bomId) return;
    let cancelled = false;
    Promise.all([loadMaterialBomRequirementReport(bomId), loadVFinalForBom("material", bomId)]).then(([data, v]) => {
      if (cancelled) return;
      setLoaded({ forBom: bomId, data });
      setVf({ forBom: bomId, data: v as SheetVFinal });
    });
    return () => {
      cancelled = true;
    };
  }, [open, bomId]);

  const vFinal = vf && bomId && vf.forBom === bomId ? vf.data : null;
  const frozen =
    vFinal && vFinal.state === "frozen" && !showProposed && !("refused" in (vFinal.payload as object))
      ? (vFinal.payload as { requirement: MbaRequirementReport | { refused: string } }).requirement
      : null;
  const data = frozen ?? (loaded && bomId && loaded.forBom === bomId ? loaded.data : null);
  const reports = ORDER_REPORTS.filter(isMaterialBomSheetReport);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title="Material BOM Reports"
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {!data ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="bg-[#f1f3f5] p-4">
          {vFinal && <VFinalSheetNote vf={vFinal} proposed={showProposed} onToggle={() => setShowProposed((v) => !v)} />}
          {/* ONE REPORT TODAY, SO NO TAB STRIP — a strip of one is chrome. The
              moment the registry holds a second `material-bom` sheet report
              this becomes tabs with no edit here. */}
          {reports.length === 1 ? (
            <MaterialBomReportView report={reports[0].key} requirement={data} />
          ) : (
            <Tabs
              items={reports.map((r) => ({
                key: r.key,
                label: r.label,
                content: <MaterialBomReportView report={r.key} requirement={data} />,
              }))}
            />
          )}
        </div>
      )}
    </Sheet>
  );
}

type MaterialBomReportData = {
  requirement: MbaRequirementReport | { refused: string } | null;
};

/* A `Record`, not a switch: a `material-bom` key added to `ORDER_REPORTS`
   without a view here is a TYPE ERROR, and `check:order-reports` looks for the
   key in this block. */
const MATERIAL_BOM_REPORT_VIEWS: Record<MaterialBomReportKey, (d: MaterialBomReportData) => React.ReactNode> = {
  "material-bom-requirement": (d) => <RequirementView data={d.requirement} />,
};

/** ONE MATERIAL BOM REPORT, BY REGISTRY KEY — the body both this sheet and
 *  `/orders/<id>/reports/<key>` render, so the two cannot show different
 *  documents under one name. */
export function MaterialBomReportView({
  report,
  ...data
}: MaterialBomReportData & { report: MaterialBomReportKey }) {
  return <>{MATERIAL_BOM_REPORT_VIEWS[report](data)}</>;
}

function RequirementView({ data }: { data: MbaRequirementReport | { refused: string } | null }) {
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if ("refused" in data) {
    /* A REFUSAL IS ITS SENTENCE, never an empty table — a blank requirement
       reads as "this order needs no trims". */
    return (
      <div className="rounded-md border border-border bg-white p-4">
        <p className="text-sm font-medium">Nothing to print</p>
        <p className="mt-1 text-sm text-muted-foreground">{data.refused}</p>
      </div>
    );
  }
  const h = data.header;
  const c = h.company;
  const contact = [c.address, c.gstin ? `GSTIN ${c.gstin}` : null].filter(Boolean).join("  ·  ");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Button variant="outline" size="md" onClick={() => exportMaterialBomRequirementCsv(data)}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden />
          Excel
        </Button>
        <Button variant="outline" size="md" onClick={() => exportMaterialBomRequirementPdf(data, "print")}>
          <Printer className="h-4 w-4" aria-hidden />
          Print
        </Button>
        <Button size="md" onClick={() => exportMaterialBomRequirementPdf(data, "download")}>
          <Download className="h-4 w-4" aria-hidden />
          Download PDF
        </Button>
      </div>

      <div>
        {/* THE LETTERHEAD — the Fabric BOM reports' frame (green rule, dark
            rule, blue title), so the order's documents read as one family. */}
        <div className="overflow-hidden rounded-t-md border border-b-0 border-border bg-white">
          <div className="h-[3px] bg-[#85c227]" />
          <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#16181d] px-5 py-3">
            <div className="flex min-w-0 items-center gap-4">
              {c.logo && (
                // A plain <img>: a stored data URL or an external Company
                // Profile URL, which next/image would need configuring for.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logo} alt={c.name ?? "Company logo"} className="h-12 w-auto shrink-0 object-contain" />
              )}
              <div className="min-w-0">
                <div className="text-[16px] font-bold uppercase tracking-wide text-[#16181d]">
                  {c.name ?? "RAAGAM EXPORTS"}
                </div>
                {contact && <div className="mt-0.5 text-[11.5px] text-[#5b6472]">{contact}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[12.5px] font-bold uppercase tracking-[.12em] text-[#037bb8]">
                Material BOM Requirement
              </div>
              {h.bomCode && <div className="font-mono text-[12px] text-[#5b6472]">{h.bomCode}</div>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border border-t-0 border-border bg-white px-5 py-2.5 text-[12.5px]">
          <Fact label="Customer" value={h.customer} />
          <Fact label="RE No" value={h.scNo} mono />
          <Fact label="Order No" value={h.orderNo} mono />
          <Fact label="Date" value={fmtDate(h.bomDate)} mono />
        </div>

        <div className="overflow-x-auto border-x border-b border-border bg-white">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead>
              <tr>
                <Th>Item Name</Th>
                <Th>Item Color</Th>
                <Th right>Calculated Qty</Th>
                <Th right>Required Qty</Th>
                <Th>Uom</Th>
                {/* THE PURCHASE FIGURE SITS BESIDE ITS UNIT (client
                    2026-09-20). Without it the row read "5,225 · NOS · GROSS"
                    — pieces printed under a unit they are not in. */}
                <Th right>Purchase Qty</Th>
                <Th>Purchase Uom</Th>
                <Th>Stage</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-1">{r.material}</td>
                  <td className="px-2 py-1">{r.colour}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-[#5b6472]">
                    {r.calculated != null ? fmtQty(r.calculated, r.decimals) : "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums font-semibold">
                    {/* A REFUSAL PRINTS ITS SENTENCE — never 0, which reads
                        as "none needed". */}
                    {r.required != null ? (
                      fmtQty(r.required, r.decimals)
                    ) : (
                      <span className="font-normal text-muted-foreground">{r.refusal}</span>
                    )}
                  </td>
                  <td className="px-2 py-1">{r.uom}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {r.purchaseQty != null ? fmtQty(r.purchaseQty, r.purchaseDecimals) : "—"}
                  </td>
                  <td className="px-2 py-1">{r.purchaseUom}</td>
                  <td className="px-2 py-1">{r.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {h.computedAt && (
          <div className="mt-1 text-right text-[11px] text-muted-foreground">
            Requirement stored {fmtDateTime(h.computedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <span>
      <span className="text-[#8b95a3]">{label}: </span>
      <span className={mono ? "font-mono" : ""}>{value || "—"}</span>
    </span>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`border-b border-border bg-[#f6f7f9] px-2 py-1 font-semibold text-[#5b6472] ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}
