import Link from "next/link";
import { ClipboardList, FileText, Layers } from "lucide-react";

/**
 * The switcher across an order's three documents — Order sheet, Material BOM,
 * Fabric BOM.
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
 * ## IT IS A LINK STRIP, NOT TABS, AND THE DISTINCTION IS LOAD-BEARING
 *
 * Each entry is a real `<Link>` to a real route, so every document keeps its own
 * URL, its own print output and its own back button. Tab state would fold three
 * printable documents into one page — and `window.print()` prints the PAGE, so
 * the Print button would then have to know which panel was showing. The strip
 * is `print:hidden` for the same reason: it is navigation, and navigation is not
 * part of a document a supplier signs.
 *
 * ## A SERVER COMPONENT
 *
 * No state — the current document is a prop, not something to discover — so this
 * adds nothing to hydrate on three pages that are otherwise entirely static.
 *
 * ## IT NEVER DISABLES AN ENTRY
 *
 * Deliberately, and it is the same call the row menu made on 2026-09-02: a
 * document with no BOM behind it answers with a named refusal and a link on to
 * the screen that would create one. Greying the entry here would put the
 * operator back in the cul-de-sac this component exists to remove — and worse,
 * knowing whether the other two have data would cost two queries on every
 * document page to grey something out.
 */

const DOCUMENTS = [
  { key: "gos", label: "Order sheet", icon: FileText, path: "gos" },
  { key: "material", label: "Material BOM", icon: ClipboardList, path: "requirement" },
  { key: "fabric", label: "Fabric BOM", icon: Layers, path: "fabric-requirement" },
] as const;

export type OrderDocumentKey = (typeof DOCUMENTS)[number]["key"];

export function OrderDocumentTabs({
  orderId,
  current,
}: {
  orderId: string;
  current: OrderDocumentKey;
}) {
  return (
    <nav
      aria-label="Order documents"
      className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface-muted p-1 print:hidden"
    >
      {DOCUMENTS.map((d) => {
        const active = d.key === current;
        const Icon = d.icon;
        return (
          <Link
            key={d.key}
            href={`/orders/${orderId}/${d.path}`}
            /* THE CURRENT PAGE IS STILL A LINK. `aria-current` carries the state
               to a screen reader, and leaving it clickable means the strip has
               no dead element — clicking the page you are on reloads it, which
               is a harmless outcome and a cheaper rule than a branch. */
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
    </nav>
  );
}
