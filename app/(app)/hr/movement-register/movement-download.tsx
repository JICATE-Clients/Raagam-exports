"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportExcel } from "@/lib/reports/export-excel";

/**
 * Excel of exactly what the register shows — same filters, same columns, the
 * times already in the screen's 12-hour form (the page formats them on the
 * server, in IST, so a browser in another zone cannot shift a punch).
 */
export function MovementDownload({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy || rows.length === 0}
      onClick={async () => {
        setBusy(true);
        try {
          await exportExcel({
            title,
            columns: headers.map((h, i) => ({ key: `c${i}`, header: h, value: (r: string[]) => r[i] })),
            rows,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download className="h-4 w-4" aria-hidden />
      {busy ? "Preparing…" : "Download Excel"}
    </Button>
  );
}
