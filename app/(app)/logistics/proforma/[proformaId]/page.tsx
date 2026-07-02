import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getProformaInvoice,
  getProformaLines,
} from "@/lib/logistics/proforma/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ProformaDetail } from "./proforma-detail";

export default async function ProformaDetailPage({
  params,
}: {
  params: Promise<{ proformaId: string }>;
}) {
  await requirePermission("logistics", "view");
  const { proformaId } = await params;

  const [proforma, lines, canEdit, canDelete] = await Promise.all([
    getProformaInvoice(proformaId),
    getProformaLines(proformaId),
    can("logistics", "edit"),
    can("logistics", "delete"),
  ]);

  if (!proforma) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Proforma ${proforma.code ?? ""}`}
        description={proforma.buyers?.name ?? "Buyer"}
        actions={
          <Link href="/logistics/proforma">
            <Button variant="outline" size="sm">
              ← All proformas
            </Button>
          </Link>
        }
      />

      <ProformaDetail
        proforma={proforma}
        lines={lines}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
