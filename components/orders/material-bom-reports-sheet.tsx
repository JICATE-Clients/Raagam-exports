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
  mbomRequirementTiles,
} from "@/lib/orders/material-bom-amendment/requirement-report-export";
import {
  ORDER_REPORTS,
  isMaterialBomSheetReport,
  type MaterialBomReportKey,
} from "@/lib/orders/order-reports";
import {
  OrderFacts,
  ReportTable,
  SectionCard,
  SheetLabel,
  SheetMasthead,
  SignOff,
  SummaryTiles,
  Swatch,
  Td,
  Th,
  stripeRow,
} from "@/components/orders/report-kit";

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
      title="Accessories Plan Reports"
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

      {/* THE SHEET FORMAT (user 2026-09-29, "this is okay apply it") — masthead,
          the order's facts, the tiles, then the table as a card. The PDF draws
          the same blocks (`requirement-report-export.ts`). */}
      <div className="grid gap-5">
        <div>
          <SheetMasthead
            company={{ name: c.name, logo: c.logo }}
            kind="Accessories Plan Requirement"
            reNo={h.scNo}
            meta={[h.bomCode, h.computedAt ? `Stored ${fmtDateTime(h.computedAt)}` : null].filter(Boolean).join(" · ")}
          />
          <OrderFacts
            facts={[
              { label: "Customer", value: h.customer },
              { label: "Order No", value: h.orderNo, mono: true },
              { label: "BOM Date", value: fmtDate(h.bomDate), mono: true },
            ]}
          />
        </div>

        <div>
          <SheetLabel>Summary</SheetLabel>
          <SummaryTiles
            tiles={mbomRequirementTiles(data).map((t) => ({ label: t.label, value: String(t.value), note: t.note }))}
          />
        </div>

        {/* No total: the lines are in different units, and a sum of pieces and
            grams is no figure. The columns and their order are unchanged. */}
        <SectionCard
          title="Material Requirement"
          total={`${data.rows.length} line${data.rows.length === 1 ? "" : "s"}`}
        >
          <ReportTable bare>
            <thead>
              <tr>
                {/* THE REPORT STANDARD'S ORDER (user 2026-09-29) for the columns
                    this report shares with it — Item Name → Color → UOM →
                    Required Qty; the Accessories sheet's Consumption / Size /
                    Specification live inside Item Name here. Calculated Qty is
                    Required before process loss, so it stays beside it. */}
                <Th>Item Name</Th>
                <Th>Item Color</Th>
                <Th>Uom</Th>
                <Th right>Calculated Qty</Th>
                <Th right>Required Qty</Th>
                {/* THE PURCHASE FIGURE SITS BESIDE ITS UNIT (client
                    2026-09-20). Without it the row read "5,225 · NOS · GROSS"
                    — pieces printed under a unit they are not in. */}
                <Th right>Purchase Qty</Th>
                <Th>Purchase Uom</Th>
                <Th>Stage</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.key} style={stripeRow(i)}>
                  <Td>{r.material}</Td>
                  <Td>
                    <Swatch name={r.colour} />
                    {r.colour}
                  </Td>
                  <Td>{r.uom}</Td>
                  <Td right mono className="text-[#5b6472]">
                    {r.calculated != null ? fmtQty(r.calculated, r.decimals) : "—"}
                  </Td>
                  <Td right mono wrap={r.required == null} className="font-semibold">
                    {/* A REFUSAL PRINTS ITS SENTENCE — never 0, which reads
                        as "none needed". */}
                    {r.required != null ? (
                      fmtQty(r.required, r.decimals)
                    ) : (
                      <span className="font-sans font-normal text-muted-foreground">{r.refusal}</span>
                    )}
                  </Td>
                  <Td right mono>
                    {r.purchaseQty != null ? fmtQty(r.purchaseQty, r.purchaseDecimals) : "—"}
                  </Td>
                  <Td>{r.purchaseUom}</Td>
                  <Td>{r.stage}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </SectionCard>

        <SignOff />
      </div>
    </div>
  );
}
