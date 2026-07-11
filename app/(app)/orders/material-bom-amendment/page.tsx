import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  listMaterialBomAmendments,
  getMbaFormData,
} from "@/lib/orders/material-bom-amendment/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { MbaMasterScreen } from "./mba-master-screen";

export default async function MaterialBomAmendmentPage() {
  await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete, mCreate, mEdit] =
    await Promise.all([
      listMaterialBomAmendments(),
      getMbaFormData(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Material BOM Amendment"
        description="Amend an accepted order's material BOM — items, processes & calculated quantities."
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Garment Orders
            </Button>
          </Link>
        }
      />

      <MbaMasterScreen
        rows={rows}
        data={data}
        perms={{ canCreate, canEdit, canDelete }}
        masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
      />
    </div>
  );
}
