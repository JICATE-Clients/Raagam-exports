"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GosSheet } from "@/lib/orders/gos/types";
import type { ReportStyleImages } from "@/lib/orders/gos/style-images";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import { exportGosCsv, exportGosPdf } from "@/lib/orders/gos/export";

/**
 * The Garment Order Sheet's Excel · Print · Download PDF — the order documents'
 * three buttons (client 2026-09-23: "follow our new format"). Its own client
 * island, so the sheet itself stays a server component with nothing to hydrate.
 *
 * It replaces `GosPrintButton`, which called `window.print()`. Print now goes
 * through the same PDF as Download, as every sibling document's does, so the
 * printout and the saved file are one document. Ctrl+P on the page still
 * prints the on-screen sheet through `DocumentPrintStyles`.
 */
export function GosToolbar({
  sheet,
  company,
  styleImages,
}: {
  sheet: GosSheet;
  company: DocLetterhead;
  styleImages: ReportStyleImages | { failed: string };
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 print:hidden">
      <Button variant="outline" size="md" onClick={() => exportGosCsv(sheet)}>
        <FileSpreadsheet className="h-4 w-4" aria-hidden />
        Excel
      </Button>
      <Button variant="outline" size="md" onClick={() => exportGosPdf(sheet, company, styleImages, "print")}>
        <Printer className="h-4 w-4" aria-hidden />
        Print
      </Button>
      <Button size="md" onClick={() => exportGosPdf(sheet, company, styleImages, "download")}>
        <Download className="h-4 w-4" aria-hidden />
        Download PDF
      </Button>
    </div>
  );
}
