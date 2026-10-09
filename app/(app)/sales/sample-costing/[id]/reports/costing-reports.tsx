"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, FileText, GitBranchPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ToggleGroup } from "@/components/ui/segmented";
import { CostSheetDocument } from "@/components/sales/cost-sheet-document";
import { QuotationDocument } from "@/components/sales/quotation-document";
import type { CostSheetModel } from "@/lib/sales/sample-costing/cost-sheet";
import type { QuotationModel } from "@/lib/sales/sample-costing/quotation";

/**
 * Costing ▸ Reports — one door, two documents (client 2026-10-09: "make it like
 * the Order Entry report icon … cost sheet and quotation had separate download
 * icons"). The list row now carries ONE Reports icon, as Order Entry's does, and
 * it lands here: the internal Cost Sheet and the buyer's Quotation as tabs, each
 * a document you can READ first and then download or print.
 *
 * Both models are built on the server from the one saved costing, so switching
 * tabs is instant and neither can drift from the other.
 */

type Tab = "cost-sheet" | "quotation";

export function CostingReports({
  cost,
  quote,
  initial,
  revise,
}: {
  cost: CostSheetModel;
  quote: QuotationModel;
  initial: Tab;
  /** Null only when the reader may not edit. `reason` is why Revise is unavailable (greyed), or null when it works. */
  revise: { id: string; nextLabel: string; reason: string | null } | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initial);

  const pick = (t: Tab) => {
    setTab(t);
    // Keep the address honest, so a refresh or a shared link reopens this tab.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
      <ToggleGroup<Tab>
        role="tablist"
        label="Report"
        value={tab}
        onChange={pick}
        options={[
          { value: "cost-sheet", label: "Cost Sheet", icon: ClipboardList },
          { value: "quotation", label: "Quotation", icon: FileText },
        ]}
      />
      {revise ? (
        <Tooltip label={revise.reason ?? "Open this costing as the next revision, to change the price"}>
          <Button
            variant="outline"
            size="md"
            disabled={!!revise.reason}
            onClick={() => router.push(`/sales/sample-costing?reviseFrom=${revise.id}`)}
          >
            <GitBranchPlus className="h-4 w-4" />
            {revise.reason ? "Revise" : `Revise → ${revise.nextLabel}`}
          </Button>
        </Tooltip>
      ) : null}
      </div>
      {tab === "cost-sheet" ? <CostSheetDocument model={cost} /> : <QuotationDocument model={quote} />}
    </div>
  );
}
