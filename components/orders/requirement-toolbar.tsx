"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportAccessoriesCsv, exportAccessoriesRequirementPdf } from "@/lib/orders/requirement/export";
import type { RequirementSheetData } from "@/lib/orders/requirement/service";

/**
 * The three ways off the screen — the sheet's only behaviour.
 *
 * Its own client island so the document stays a server component with nothing
 * to hydrate, exactly as `GosToolbar` is next door.
 *
 * ## PRINT PRINTS THE RP PRINTOUT, NOT THE WEB PAGE (client 2026-09-24)
 *
 * The client handed over the legacy "Accessories Requirement.pdf" as the
 * format. The PDF is drawn to it (`exportAccessoriesRequirementPdf`), so Print
 * opens that same PDF with the print dialog up — the Yarn & Fabric
 * Requirement's Print does the same. Printing the browser page would put a
 * second, different layout on paper under the same title.
 *
 * `size="md"` on all three: this is a header row, and AGENTS.md fixes every
 * control in that band at `h-9`.
 */
export function RequirementToolbar({ data }: { data: RequirementSheetData }) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button variant="outline" size="md" onClick={() => exportAccessoriesCsv(data)}>
        <FileSpreadsheet className="h-4 w-4" />
        Excel
      </Button>
      <Button variant="outline" size="md" onClick={() => void exportAccessoriesRequirementPdf(data, "print")}>
        <Printer className="h-4 w-4" />
        Print
      </Button>
      <Button size="md" onClick={() => void exportAccessoriesRequirementPdf(data)}>
        <Download className="h-4 w-4" />
        Download PDF
      </Button>
    </div>
  );
}
