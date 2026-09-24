import Link from "next/link";
import { Lock, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AMENDMENT_ENTRY_TYPE_VALUES,
  modulesOf,
  type AmendmentModule,
} from "@/lib/orders/amendments/amendment-entry";
import type { AmendmentHead } from "@/lib/orders/order-amendments/service";

/**
 * THE AMENDMENT WORKSPACE'S TABS (user 2026-09-23: "the update also needs to
 * happen in the amendment — no more need to go to Order Entry"). Overview is
 * the step page; each other tab hosts the module's OWN editor, embedded, on
 * this order (`useEmbeddedEditor`). A module the amendment opened is marked
 * editable, the rest read-only — the same answer the database gives.
 *
 * Server-safe: plain links, the current tab from the route.
 */
export type AmendmentTab = "overview" | "order" | "fabric-bom" | "material-bom" | "budget";

const TABS: { key: AmendmentTab; label: string; module: AmendmentModule | null }[] = [
  { key: "overview", label: "Overview", module: null },
  { key: "order", label: "Order", module: "order_entry" },
  { key: "fabric-bom", label: "Fabric BOM", module: "fabric_bom" },
  { key: "material-bom", label: "Material BOM", module: "material_bom" },
  { key: "budget", label: "Budget", module: "order_budget" },
];

export function amendmentTabHref(entryId: string, tab: AmendmentTab): string {
  return tab === "overview" ? `/orders/order-amendments/${entryId}` : `/orders/order-amendments/${entryId}/${tab}`;
}

/**
 * WHERE A REVISION OPENS (client 2026-09-24: "selecting a revision category
 * … will automatically redirect the user to that specific tab"). The category
 * picked at Raise names the work, so opening the revision lands on it — the
 * module's tab and, for Order Entry, the rail section — instead of on
 * Overview, where the operator only read "open the Order tab" and clicked.
 *
 * ONE MAP, IN THE KINDS' OWN ORDER. With several picked, the first in
 * `AMENDMENT_ENTRY_TYPES` order wins, so the order's own changes come before
 * the modules they recalculate. An Order Entry section is a key of the Order
 * editor's rail; `ORDER_TAB_SECTIONS` is the set the Order tab accepts back.
 *
 * READ AT THE DOORS ONLY — Raise and the register's open. The Overview route
 * itself never redirects: Save and Cancel inside a tab return there, and a
 * redirect on arrival would put the operator straight back in the tab.
 */
const LANDING: Partial<Record<string, { tab: AmendmentTab; section?: string }>> = {
  qty_addition: { tab: "order", section: "quantities" },
  qty_cancellation: { tab: "order", section: "quantities" },
  price_change: { tab: "order", section: "prices" },
  delivery_date_ext: { tab: "order", section: "orderinfo" },
  combo_colour_change: { tab: "order", section: "combos" },
  fabric_bom_revision: { tab: "fabric-bom" },
  material_bom_revision: { tab: "material-bom" },
  budget_revision: { tab: "budget" },
  bom_revision: { tab: "fabric-bom" },
};
export const ORDER_TAB_SECTIONS: readonly string[] = ["quantities", "prices", "orderinfo", "combos"];

export function revisionLandingOf(entryId: string, types: readonly string[]): string {
  const first = AMENDMENT_ENTRY_TYPE_VALUES.find((k) => types.includes(k));
  const to = first ? LANDING[first] : undefined;
  if (!to) return amendmentTabHref(entryId, "overview");
  const href = amendmentTabHref(entryId, to.tab);
  return to.section ? `${href}?section=${to.section}` : href;
}

export function AmendmentTabs({ head, current }: { head: AmendmentHead; current: AmendmentTab }) {
  const open = head.outcome === "open";
  const modules = modulesOf(head.types);
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Revision">
      {TABS.map((t) => {
        /* The budget is always visited — its missing rates are filled there,
           and it is what goes to the MD — so it is never marked read-only;
           Order Budget only decides which of its cells are. */
        const editable = open && (t.module === null || t.module === "order_budget" || modules.includes(t.module));
        return (
          <Link
            key={t.key}
            href={amendmentTabHref(head.id, t.key)}
            aria-current={current === t.key ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
              current === t.key
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.module && open && (editable ? (
              <Pencil className="h-3.5 w-3.5" aria-label="editable" />
            ) : (
              <Lock className="h-3.5 w-3.5" aria-label="read-only" />
            ))}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** One line above an embedded editor: which amendment it belongs to, and the way back. */
export function AmendmentTabHeader({ head, current }: { head: AmendmentHead; current: AmendmentTab }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={amendmentTabHref(head.id, "overview")} className="text-sm text-muted-foreground hover:text-foreground">
          ← Revision {head.entry_no ?? ""}
        </Link>
        <span className="text-xs text-muted-foreground">
          {[head.re_no, head.customer_name].filter(Boolean).join(" · ")}
        </span>
      </div>
      <AmendmentTabs head={head} current={current} />
    </div>
  );
}
