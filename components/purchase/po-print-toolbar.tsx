"use client";

import { Printer } from "lucide-react";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";

/**
 * The PO print page's top row: the way back, and Print. Its own client island so the
 * sheet beneath stays a server component. Print is the browser's: `DocumentPrintStyles`
 * on the sheet puts only the PO on the paper, paginated, so Ctrl+P prints the same.
 */
export function PoPrintToolbar({ backHref, backLabel, printable = true }: { backHref: string; backLabel: string; printable?: boolean }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2 print:hidden">
      <BackLink target={{ href: backHref, label: backLabel }} />
      {/* No Print until approved — the page says why instead (spec point 8). */}
      {printable ? (
        <Button variant="primary" size="md" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          Print
        </Button>
      ) : null}
    </div>
  );
}
