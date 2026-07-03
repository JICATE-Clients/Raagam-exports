import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getExportCategories } from "@/lib/logistics/export-categories/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ExportCategoriesClient } from "./export-categories-client";

export default async function ExportCategoriesPage() {
  await requirePermission("logistics", "view");

  const [categories, canCreate, canEdit, canExport, canDelete] = await Promise.all([
    getExportCategories(),
    can("logistics", "create"),
    can("logistics", "edit"),
    can("logistics", "export"),
    can("logistics", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Export Categories"
        description="Commodity category master for export documentation"
        actions={
          <Link href="/logistics">
            <Button variant="outline" size="sm">
              ← Logistics
            </Button>
          </Link>
        }
      />

      <ExportCategoriesClient
        categories={categories}
        canCreate={canCreate}
        canEdit={canEdit}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
