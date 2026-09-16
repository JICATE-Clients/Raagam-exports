"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  exportFabricRequirementCsv,
  exportFabricRequirementPdf,
  type FabricSheetMeta,
} from "@/lib/orders/fabric-requirement/export";
import type { FabricSheetRow } from "@/lib/orders/fabric-requirement/sheet";
/* THE RULE 2 DEMAND (0564) — the same lines the document renders, handed to
   both exports so the screen, the paper and the spreadsheet carry one answer. */
import type { ClothPurchaseLine } from "@/lib/orders/fabric-bom/reports";

/**
 * The three ways off the screen — the fabric sheet's only behaviour.
 *
 * Its own client island so the document stays a server component with nothing to
 * hydrate, exactly as `RequirementToolbar` and `GosPrintButton` are beside it.
 *
 * ## NO INK-SAFE TOGGLE HERE, DELIBERATELY
 *
 * The medium decides. Print takes the `@media print` rules; the PDF is drawn
 * mono by `exportFabricRequirementPdf`. Offering a colour/mono choice would put
 * a decision in front of an operator that they have no way to get right — the
 * person who suffers a colour sheet on a mono laser is a knitter three days
 * later, not the person clicking.
 *
 * `size="md"` on all three: this is a header row, and AGENTS.md fixes every
 * control in that band at `h-9`.
 */
export function FabricRequirementToolbar({
  rows,
  yarns,
  cloth,
  meta,
}: {
  rows: FabricSheetRow[];
  yarns: FabricSheetRow[];
  /** Empty on an all-Rule-1 document, which is every BOM before 2026-09-16 —
   *  both exports then produce exactly the file they always did. */
  cloth: ClothPurchaseLine[];
  meta: FabricSheetMeta;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button variant="outline" size="md" onClick={() => exportFabricRequirementCsv(rows, yarns, meta, cloth)}>
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
      <Button variant="outline" size="md" onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        Print
      </Button>
      <Button size="md" onClick={() => exportFabricRequirementPdf(rows, yarns, meta, cloth)}>
        <Download className="h-4 w-4" />
        Download PDF
      </Button>
    </div>
  );
}
