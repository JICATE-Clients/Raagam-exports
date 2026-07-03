import { requirePermission, can } from "@/lib/auth/server";
import { listAccounts } from "@/lib/finance/gl-service";
import { PageHeader } from "@/components/ui/page-header";
import { AccountsClient } from "./accounts-client";

export default async function AccountsPage() {
  await requirePermission("finance", "view");

  const [accounts, canCreate, canEdit, canExport, canDelete] = await Promise.all([
    listAccounts(),
    can("finance", "create"),
    can("finance", "edit"),
    can("finance", "export"),
    can("finance", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chart of Accounts"
        description={`${accounts.length} accounts · asset, liability, equity, income, expense`}
      />
      <AccountsClient
        accounts={accounts}
        canCreate={canCreate}
        canEdit={canEdit}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
