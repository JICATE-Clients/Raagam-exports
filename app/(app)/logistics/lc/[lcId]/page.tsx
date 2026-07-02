import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getLcDetail,
  getBuyerOptions,
  getCurrencyOptions,
} from "@/lib/logistics/lc/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { LcDetailClient } from "./lc-detail";

export default async function LcDetailPage({
  params,
}: {
  params: Promise<{ lcId: string }>;
}) {
  await requirePermission("logistics", "view");
  const { lcId } = await params;

  const [lc, buyers, currencies, canEdit, canDelete] = await Promise.all([
    getLcDetail(lcId),
    getBuyerOptions(),
    getCurrencyOptions(),
    can("logistics", "edit"),
    can("logistics", "delete"),
  ]);

  if (!lc) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={`LC ${lc.code ?? ""}`}
        description={lc.lc_number ?? lc.buyers?.name ?? "Letter of Credit"}
        actions={
          <Link href="/logistics/lc">
            <Button variant="outline" size="sm">
              ← All LCs
            </Button>
          </Link>
        }
      />

      <LcDetailClient
        lc={lc}
        buyers={buyers}
        currencies={currencies}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
