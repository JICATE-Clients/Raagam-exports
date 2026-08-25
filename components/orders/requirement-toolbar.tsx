"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportRequirementCsv, exportRequirementPdf, type SheetMeta } from "@/lib/orders/requirement/export";
import type { SheetRow } from "@/lib/orders/requirement/sheet";

/**
 * The three ways off the screen — the sheet's only behaviour.
 *
 * Its own client island so the document stays a server component with nothing
 * to hydrate, exactly as `GosPrintButton` is next door.
 *
 * ## NO INK-SAFE TOGGLE HERE, DELIBERATELY
 *
 * The medium decides. Print takes the `@media print` rules; the PDF is drawn
 * mono by `exportRequirementPdf`. Offering a colour/mono choice would put a
 * decision in front of an operator that they have no way to get right — the
 * person who suffers a colour sheet on a mono laser is a supplier three days
 * later, not the person clicking.
 *
 * `size="md"` on all three: this is a header row, and AGENTS.md fixes every
 * control in that band at `h-9`.
 */
export function RequirementToolbar({ rows, meta }: { rows: SheetRow[]; meta: SheetMeta }) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button variant="outline" size="md" onClick={() => exportRequirementCsv(rows, meta)}>
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
      <Button variant="outline" size="md" onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        Print
      </Button>
      <Button size="md" onClick={() => exportRequirementPdf(rows, meta)}>
        <Download className="h-4 w-4" />
        Download PDF
      </Button>
    </div>
  );
}
