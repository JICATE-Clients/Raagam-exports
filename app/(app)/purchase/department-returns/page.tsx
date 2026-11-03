import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { listDepartmentReturns } from "@/lib/stores/department-return-service";
import { DepartmentReturnsList } from "./_components/department-returns-list";

export default async function DepartmentReturnsPage() {
  await requirePermission("stores", "view");
  const [rows, canCreate, canEdit, canDelete] = await Promise.all([
    listDepartmentReturns(),
    can("stores", "create"),
    can("stores", "edit"),
    can("stores", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Department Return"
        description="Unused or excess material a department gives back to the store, against an issued requisition."
        actions={
          canCreate ? (
            <Link href="/purchase/department-returns/new" className={buttonClasses({ size: "md" })}>
              <Plus className="h-4 w-4" aria-hidden />
              Add Department Return
            </Link>
          ) : null
        }
      />
      <DepartmentReturnsList rows={rows} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
