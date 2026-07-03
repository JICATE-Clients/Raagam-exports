import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";

export default async function AdminPage() {
  await requirePermission("system_admin", "view");

  return (
    <div className="space-y-4">
      <PageHeader
        title="System Administration"
        description="Manage users, roles, and permission assignments."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-2xl">
        <Link href="/admin/users">
          <Card className="hover:bg-surface-muted transition-colors cursor-pointer h-full">
            <CardBody>
              <div className="font-semibold text-foreground">Users</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Create and manage user accounts, assign roles and work
                locations.
              </p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/admin/roles">
          <Card className="hover:bg-surface-muted transition-colors cursor-pointer h-full">
            <CardBody>
              <div className="font-semibold text-foreground">
                Roles &amp; Permissions
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Define roles and configure the module-level permission matrix
                for each role.
              </p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/admin/audit">
          <Card className="hover:bg-surface-muted transition-colors cursor-pointer h-full">
            <CardBody>
              <div className="font-semibold text-foreground">Audit Log</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Full change history — who created or edited each record, when,
                and the previous &rarr; new values.
              </p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/admin/assets">
          <Card className="hover:bg-surface-muted transition-colors cursor-pointer h-full">
            <CardBody>
              <div className="font-semibold text-foreground">Assets</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Fixed-asset register with assignment (delivery/return) tracking.
              </p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/admin/couriers">
          <Card className="hover:bg-surface-muted transition-colors cursor-pointer h-full">
            <CardBody>
              <div className="font-semibold text-foreground">Courier</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Courier companies, despatches, invoices and proof-of-delivery.
              </p>
            </CardBody>
          </Card>
        </Link>
      </div>
    </div>
  );
}
