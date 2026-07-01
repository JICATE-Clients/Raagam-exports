import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import {
  getOpportunity,
  getStyles,
  getCostSheets,
  getQuotes,
  getSamples,
  getUoms,
} from "@/lib/sales/service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { OpportunityTabs } from "../opportunity-tabs";
import type { StatusTone } from "@/components/ui/status-pill";
import type { OpportunityStage } from "@/lib/sales/types";

const STAGE_TONE: Record<OpportunityStage, StatusTone> = {
  enquiry: "neutral",
  costing: "info",
  quoted: "warning",
  won: "success",
  lost: "danger",
};

interface PageProps {
  params: Promise<{ opportunityId: string }>;
}

export default async function OpportunityDetailPage({ params }: PageProps) {
  await requirePermission("sales", "view");

  const { opportunityId } = await params;

  const [opportunity, styles, costSheets, quotes, samples, uoms] =
    await Promise.all([
      getOpportunity(opportunityId),
      getStyles(opportunityId),
      getCostSheets(opportunityId),
      getQuotes(opportunityId),
      getSamples(opportunityId),
      getUoms(),
    ]);

  if (!opportunity) notFound();

  return (
    <div>
      <PageHeader
        title={opportunity.title}
        description={
          opportunity.code
            ? `${opportunity.code} · Created ${fmtDate(opportunity.created_at)}`
            : `Created ${fmtDate(opportunity.created_at)}`
        }
        actions={
          <Link
            href="/sales"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to pipeline
          </Link>
        }
      />

      {/* Opportunity summary strip */}
      <div className="mb-6 flex flex-wrap gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Buyer:</span>
          <span className="font-medium">{opportunity.buyer_name ?? "—"}</span>
        </div>
        {opportunity.season && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Season:</span>
            <span className="font-medium">{opportunity.season}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Stage:</span>
          <StatusPill tone={STAGE_TONE[opportunity.stage]}>
            {opportunity.stage.charAt(0).toUpperCase() +
              opportunity.stage.slice(1)}
          </StatusPill>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Target FOB:</span>
          <span className="tabular-nums font-medium">
            {fmtMoney(opportunity.target_fob, opportunity.currency_code)}
          </span>
        </div>
        {opportunity.notes && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Notes:</span>
            <span className="line-clamp-1 text-foreground">
              {opportunity.notes}
            </span>
          </div>
        )}
      </div>

      <OpportunityTabs
        opportunity={opportunity}
        styles={styles}
        costSheets={costSheets}
        quotes={quotes}
        samples={samples}
        buyers={[]}
        uoms={uoms}
      />
    </div>
  );
}
