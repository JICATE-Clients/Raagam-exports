"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { GosSheetDocument } from "@/components/orders/gos-sheet";
import { OrderBudgetReportView } from "@/components/orders/order-budget-report";
import { FabricBomReportView } from "@/components/orders/fabric-bom-reports-sheet";
import { MaterialBomReportView } from "@/components/orders/material-bom-reports-sheet";
import {
  ORDER_REPORTS,
  isFabricBomSheetReport,
  isMaterialBomSheetReport,
  orderReportHref,
  type OrderReportDef,
} from "@/lib/orders/order-reports";
import { isRefusal } from "@/lib/orders/gos/types";
import type { OrderFullData, OrderFullDataPart } from "@/lib/orders/full-data/types";

/**
 * "VIEW FULL ORDER DATA" — THE MD'S READ-ONLY LOOK AT EVERYTHING BEHIND THE
 * NUMBERS (client 2026-09-30: tapping the itemized budget & profit margin opens
 * "every single data point entered during Order Entry").
 *
 * THE TABS ARE THE ORDER'S OWN REPORTS, FROM THE REGISTRY (`ORDER_REPORTS`),
 * never a re-assembly: the Garment Order Sheet (header, styles, size
 * assortment), the Fabric BOM reports (greige kg, loss, shades, process
 * routing), the Material BOM requirement (trims, consumption, specs, required
 * quantities) and the Order Budget (every cost head, price vs cost per unit,
 * margin). Each renders with the SAME view component its report page uses, so
 * the pop-up and the page cannot show two documents under one name — and a
 * report added to the registry later appears here without touching this file.
 * A report that is a page only (no embeddable view) is a link that opens it.
 *
 * ONE TAB LOADS AT A TIME, WHEN OPENED (`GET /api/orders/<id>/full-data`), and
 * is kept for the life of the pop-up. `Tabs` renders only the open tab, so the
 * tab's own mount is the "opened" event — no effect sets loading state.
 *
 * LIVE DATA: the order as submitted for this approval — on a revision, the
 * proposal. The approved (V0) copy prints on each report's page, linked from
 * the tab.
 */
export function OrderFullDataSheet({
  open,
  onClose,
  salesOrderId,
  title,
  revision = false,
}: {
  open: boolean;
  onClose: () => void;
  salesOrderId: string;
  /** The RE No, for the title. */
  title: string;
  /** A revision is being approved — the tabs show the proposal. */
  revision?: boolean;
}) {
  const [loaded, setLoaded] = useState<Partial<Record<OrderFullDataPart, OrderFullData>>>({});
  const inflight = useRef(new Set<OrderFullDataPart>());

  const load = (part: OrderFullDataPart) => {
    if (loaded[part] || inflight.current.has(part)) return;
    inflight.current.add(part);
    fetch(`/api/orders/${salesOrderId}/full-data?part=${part}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => ((await res.json().catch(() => null)) as OrderFullData | null) ?? { part, refused: `The server answered ${res.status}` })
      .catch((e: unknown): OrderFullData => ({ part, refused: e instanceof Error ? e.message : String(e) }))
      .then((d) => {
        inflight.current.delete(part);
        setLoaded((m) => ({ ...m, [part]: d }));
      });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={`${title} — complete order data`}
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-3 bg-[#f1f3f5] p-4">
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
          Read only.{" "}
          {revision
            ? "These are the figures of the revision you are approving; the approved (V0) copy prints on each report's own page."
            : "These are the figures submitted for your approval."}
        </p>
        <Tabs
          items={POPUP_ORDER.map((r) => ({
            key: r.key,
            label: r.label,
            content: <ReportTab report={r} salesOrderId={salesOrderId} loaded={loaded} load={load} />,
          }))}
        />
      </div>
    </Sheet>
  );
}

/**
 * THE POP-UP'S TAB ORDER (client 2026-09-30, doc/order/budgetupdate.md §7D):
 * Order Info & Size Assortment → Fabric BOM & Yarn Sourcing → Accessories BOM
 * → Itemized Budget Sheet — the order an MD reads an order in, fabric before
 * trims. The registry's own order (Order · Material · Fabric · Budget) is the
 * report strip's and stays as it is; only this pop-up re-ranks it, by SOURCE,
 * keeping the registry's order within each source.
 */
const SOURCE_RANK: Record<OrderReportDef["source"], number> = {
  order: 0,
  "fabric-bom": 1,
  "material-bom": 2,
  budget: 3,
};
const POPUP_ORDER = ORDER_REPORTS.map((r, i) => ({ r, i }))
  .sort((a, b) => SOURCE_RANK[a.r.source] - SOURCE_RANK[b.r.source] || a.i - b.i)
  .map((x) => x.r);

/** Which loaded part renders this report — null for a report that is a page only. */
function partOf(r: OrderReportDef): OrderFullDataPart | null {
  if (r.key === "gos") return "gos";
  if (r.source === "budget") return "budget";
  if (isFabricBomSheetReport(r)) return "fabric";
  if (isMaterialBomSheetReport(r)) return "material";
  return null;
}

function ReportTab({
  report,
  salesOrderId,
  loaded,
  load,
}: {
  report: OrderReportDef;
  salesOrderId: string;
  loaded: Partial<Record<OrderFullDataPart, OrderFullData>>;
  load: (part: OrderFullDataPart) => void;
}) {
  const part = partOf(report);
  const href = orderReportHref(salesOrderId, report);
  // Mounting IS opening (`Tabs` renders only the open tab): ask for this part.
  useEffect(() => {
    if (part) load(part);
  }, [part, load]);

  const pageLink = (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      Open {report.label} as a page <ExternalLink className="size-3" aria-hidden />
    </a>
  );

  if (!part) {
    return (
      <div className="rounded-md border border-border bg-surface p-4 text-sm">
        <p className="mb-2 text-muted-foreground">{report.label} is a full-page document.</p>
        {pageLink}
      </div>
    );
  }

  const d = loaded[part];
  if (!d) return <div className="p-6 text-sm text-muted-foreground">Loading {report.label}…</div>;

  let body: React.ReactNode;
  if ("refused" in d) {
    body = <Refused message={d.refused} />;
  } else if (d.part === "gos") {
    body = isRefusal(d.sheet) ? (
      <Refused message={d.sheet.refused} />
    ) : (
      <GosSheetDocument sheet={d.sheet} company={d.company} styleImages={d.styleImages} />
    );
  } else if (d.part === "budget") {
    body = "refused" in d.data ? <Refused message={d.data.refused} /> : <OrderBudgetReportView data={d.data} />;
  } else if (d.part === "fabric" && isFabricBomSheetReport(report)) {
    body = (
      <FabricBomReportView report={report.key} register={d.register} requirement={d.requirement} thumbnail={d.thumbnail} />
    );
  } else if (d.part === "material" && isMaterialBomSheetReport(report)) {
    body = <MaterialBomReportView report={report.key} requirement={d.requirement} />;
  } else {
    body = <Refused message={`${report.label} has no view here yet.`} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end print:hidden">{pageLink}</div>
      {body}
    </div>
  );
}

function Refused({ message }: { message: string }) {
  /* A REFUSAL IS ITS SENTENCE, never an empty document — a blank tab would read
     as "nothing was entered", which the MD might approve. */
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-sm font-medium">Nothing to show</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
