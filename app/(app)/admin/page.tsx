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
        description="Manage users, roles, system configuration and maintenance utilities."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-2xl">
        <Link href="/admin/company">
          <Card className="hover:bg-surface-muted transition-colors cursor-pointer h-full">
            <CardBody>
              <div className="font-semibold text-foreground">Company Profile</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Legal entity details, registration numbers and export
                certifications.
              </p>
            </CardBody>
          </Card>
        </Link>
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
        <Link href="/admin/divisions">
          <Card className="hover:bg-surface-muted transition-colors cursor-pointer h-full">
            <CardBody>
              <div className="font-semibold text-foreground">Divisions</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Business units / divisions with document prefix configuration.
              </p>
            </CardBody>
          </Card>
        </Link>
        {/* Document No Format's card is gone from here (client 2026-08-12): the
            screen moved to Master Data ▸ System. Leaving the tile would have sent
            the operator through a `redirect()` into another module without
            warning — a card that silently teleports is worse than no card. This
            grid is hand-maintained rather than rendered from
            `lib/nav/module-groups.ts`, which is why removing the registry entry
            did not remove this. */}
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
