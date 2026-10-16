import Link from "next/link";
import { Lock, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLAN_KIND_LABEL } from "@/lib/sales/plan-reports/types";
import {
  planRevisionHref,
  planRevisionIsOpen,
  type PlanRevisionRow,
  type PlanRevisionTab,
} from "@/lib/sales/plan-revisions/types";

/**
 * THE PLAN REVISION WORKSPACE'S TABS — Orders ▸ Order Revisions' own shape
 * (`components/orders/amendment-tabs.tsx`): Overview is the step page, and
 * each other tab hosts the plan's OWN editor, embedded, on this SWO's plan
 * (`useEmbeddedEditor`). Only the plans this revision reopened get a tab — an
 * SWO revised for its Fabric Plan alone shows no Accessories tab to wonder at.
 * A plan still being worked is marked editable, a decided one read-only, the
 * same answer the plan lock gives.
 *
 * Server-safe: plain links, the current tab from the route.
 */
export function PlanRevisionTabs({ plans, current }: { plans: readonly PlanRevisionRow[]; current: PlanRevisionTab }) {
  const entryId = plans[0]?.entryId ?? "";
  const tabs: { key: PlanRevisionTab; label: string; plan: PlanRevisionRow | null }[] = [
    { key: "overview", label: "Overview", plan: null },
    ...plans.map((p) => ({ key: p.kind, label: PLAN_KIND_LABEL[p.kind], plan: p })),
  ];
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Revision">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={planRevisionHref(entryId, t.key)}
          aria-current={current === t.key ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
            current === t.key ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.plan &&
            (planRevisionIsOpen(t.plan.status) ? (
              <Pencil className="h-3.5 w-3.5" aria-label="editable" />
            ) : (
              <Lock className="h-3.5 w-3.5" aria-label="read-only" />
            ))}
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** One line above an embedded plan editor: which revision it belongs to, and the way back. */
export function PlanRevisionTabHeader({ plans, current }: { plans: readonly PlanRevisionRow[]; current: PlanRevisionTab }) {
  const head = plans[0];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={planRevisionHref(head?.entryId ?? "")} className="text-sm text-muted-foreground hover:text-foreground">
          ← Revision · {head?.swoCode ?? head?.iwoCode ?? "—"}
        </Link>
        <span className="text-xs text-muted-foreground">
          {plans.map((p) => `${PLAN_KIND_LABEL[p.kind]} Rev #${p.revisionNo}`).join(" · ")}
        </span>
      </div>
      <PlanRevisionTabs plans={plans} current={current} />
    </div>
  );
}
