import Link from "next/link";
import { ClipboardList, FileText, Layers, Printer, Spool, Table, type LucideIcon } from "lucide-react";
import {
  ORDER_REPORTS,
  ORDER_REPORT_SOURCES,
  orderReportHref,
  type OrderReportIcon,
  type OrderReportKey,
} from "@/lib/orders/order-reports";

/**
 * The switcher across an order's reports — every entry in `ORDER_REPORTS`
 * (`lib/orders/order-reports.ts`), grouped by the document it is computed from.
 *
 * ## WHY IT EXISTS
 *
 * Before this, every route off the Garment Order list was a CUL-DE-SAC. The row
 * menu was the only way to reach a document, so comparing the trims sheet
 * against the fabric sheet for one order meant: back to the list, find the row
 * again, open the ⋮, pick the other one. Three navigations to answer a question
 * about ONE order, and the list is paginated, so "find the row again" is real
 * work on an order that has scrolled away.
 *
 * ## IT READS THE REGISTRY, NOT A LITERAL (client 2026-09-19)
 *
 * It used to carry its own list of three, and the reports built after it were
 * never added — the Fabric BOM's Entry Register, Yarn & Fabric Requirement and
 * Printing Requirement could only be opened from inside the Fabric BOM editor.
 * A report declared in the registry now appears here with no edit to this file.
 *
 * ## IT IS A LINK STRIP, NOT TABS, AND THE DISTINCTION IS LOAD-BEARING
 *
 * Each entry is a real `<Link>` to a real route, so every document keeps its own
 * URL, its own print output and its own back button. Tab state would fold
 * printable documents into one page — and `window.print()` prints the PAGE, so
 * the Print button would then have to know which panel was showing. The strip
 * is `print:hidden` for the same reason: it is navigation, and navigation is not
 * part of a document a supplier signs.
 *
 * ## A SERVER COMPONENT
 *
 * No state — the current document is a prop, not something to discover — so this
 * adds nothing to hydrate on pages that are otherwise entirely static.
 *
 * ## IT NEVER DISABLES AN ENTRY
 *
 * Deliberately, and it is the same call the row menu made on 2026-09-02: a
 * document with no BOM behind it answers with a named refusal and a link on to
 * the screen that would create one. Greying the entry here would put the
 * operator back in the cul-de-sac this component exists to remove — and worse,
 * knowing whether each report has data would cost a query per entry on every
 * document page to grey something out.
 */

const ICONS: Record<OrderReportIcon, LucideIcon> = {
  "file-text": FileText,
  "clipboard-list": ClipboardList,
  layers: Layers,
  table: Table,
  spool: Spool,
  printer: Printer,
};

export type OrderDocumentKey = OrderReportKey;

export function OrderDocumentTabs({
  orderId,
  current,
}: {
  orderId: string;
  current: OrderDocumentKey;
}) {
  return (
    <nav
      aria-label="Order reports"
      className="flex flex-wrap items-stretch gap-2 rounded-md border border-border bg-surface-muted p-1 print:hidden"
    >
      {ORDER_REPORT_SOURCES.map(({ source, label }) => {
        const reports = ORDER_REPORTS.filter((r) => r.source === source);
        if (reports.length === 0) return null;
        return (
          /* ONE GROUP PER SOURCE DOCUMENT. With six reports a flat strip read
             "Fabric Requirement · Fabric BOM Entry Register · …" and left the
             operator to work out which BOM each came from; the heading says it
             once, in the words the old strip's tabs used. */
          <div key={source} role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
            <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            {reports.map((d) => {
              const active = d.key === current;
              const Icon = ICONS[d.icon];
              return (
                <Link
                  key={d.key}
                  href={orderReportHref(orderId, d)}
                  /* THE CURRENT PAGE IS STILL A LINK. `aria-current` carries the
                     state to a screen reader, and leaving it clickable means the
                     strip has no dead element — clicking the page you are on
                     reloads it, which is a harmless outcome and a cheaper rule
                     than a branch. */
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium bg-surface text-foreground shadow-sm"
                      : "inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {d.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
