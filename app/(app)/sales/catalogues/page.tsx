import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listCatalogues, listPriceLists, listPiEnquiries } from "@/lib/sales/catalogue-service";
import { CataloguesClient } from "./catalogues-client";

export default async function CataloguesPage() {
  await requirePermission("sales", "view");
  const [catalogues, priceLists, piEnquiries] = await Promise.all([
    listCatalogues(),
    listPriceLists(),
    listPiEnquiries(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Catalogues, Price Lists & PI Enquiries"
        description="Style catalogues, zone-based pricing and proforma invoice enquiries."
      />
      <CataloguesClient
        catalogues={catalogues}
        priceLists={priceLists}
        piEnquiries={piEnquiries}
      />
    </div>
  );
}
