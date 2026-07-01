import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getStore,
  getStoreBalances,
  getStoreLedger,
  getItems,
  getAccessibleStoresForTransfer,
  getStoreAccess,
  getProfiles,
} from "@/lib/stores/service";
import { STORE_TYPE_LABELS } from "@/lib/stores/types";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { StoreTabs } from "./store-tabs";
import type { StoreType } from "@/lib/stores/types";
import type { StatusTone } from "@/components/ui/status-pill";

function storeTypeTone(type: StoreType): StatusTone {
  switch (type) {
    case "purchase":
      return "info";
    case "processing":
      return "warning";
    case "material":
      return "success";
    case "rejection":
      return "danger";
    case "surplus":
      return "neutral";
  }
}

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  await requirePermission("stores", "view");
  const { storeId } = await params;

  const [
    store,
    balances,
    ledger,
    items,
    transferStores,
    accessRows,
    profiles,
    canApprove,
  ] = await Promise.all([
    getStore(storeId),
    getStoreBalances(storeId),
    getStoreLedger(storeId, 200),
    getItems(),
    getAccessibleStoresForTransfer(storeId),
    getStoreAccess(storeId),
    getProfiles(),
    can("stores", "approve"),
  ]);

  if (!store) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={store.name}
        description={store.code}
        actions={
          <StatusPill tone={storeTypeTone(store.store_type)}>
            {STORE_TYPE_LABELS[store.store_type]}
          </StatusPill>
        }
      />

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="font-mono font-medium">{store.code}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Type</dt>
              <dd className="font-medium">{STORE_TYPE_LABELS[store.store_type]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Items tracked</dt>
              <dd className="tabular-nums font-medium">{balances.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="tabular-nums font-medium">{fmtDate(store.created_at)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <StoreTabs
        store={store}
        balances={balances}
        ledger={ledger}
        items={items}
        transferStores={transferStores}
        accessRows={accessRows}
        profiles={profiles}
        canApprove={canApprove}
      />
    </div>
  );
}
