import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getKnittingPrograms,
  getOrderOptions,
} from "@/lib/process/knitting/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { KnittingProgramsClient } from "./knitting-client";

export default async function KnittingProgramsPage() {
  await requirePermission("process_planning", "view");

  const [programs, orders, canCreate, canEdit, canDelete, canExport] = await Promise.all([
    getKnittingPrograms(),
    getOrderOptions(),
    can("process_planning", "create"),
    can("process_planning", "edit"),
    can("process_planning", "delete"),
    can("process_planning", "export"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Knitting Programs"
        description="Knitting specifications & production schedule"
        actions={
          <Link href="/process">
            <Button variant="outline" size="sm">
              ← Process Planning
            </Button>
          </Link>
        }
      />

      <KnittingProgramsClient
        programs={programs}
        orders={orders}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
