"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The Print control — the sheet's only piece of behaviour.
 *
 * Its own client island, exactly like
 * `app/(app)/logistics/[shipmentId]/documents/[docType]/print-button.tsx`, so
 * the document itself stays a server component with nothing to hydrate.
 *
 * `size="md"` and not `sm`: it lives in the band above the sheet, which is a
 * header row, and every control in a header row is `h-9` (AGENTS.md, "The
 * header row" — the `sm` drift there cost 28 screens).
 */
export function GosPrintButton() {
  return (
    <Button variant="outline" size="md" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" />
      Print
    </Button>
  );
}
