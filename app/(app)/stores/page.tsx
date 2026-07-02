import Link from "next/link";
import { PackagePlus, ClipboardList, Undo2, Boxes, Warehouse } from "lucide-react";
import { requirePermission } from "@/lib/auth/server";
import { listAccessibleStores } from "@/lib/stores/service";
import { STORE_TYPE_LABELS } from "@/lib/stores/types";
import { fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

const operations = [
  { href: "/stores/opening-stock", label: "Opening Stock", desc: "Set initial balances", icon: PackagePlus },
  { href: "/stores/requisitions", label: "Requisitions (MRS)", desc: "Issue material to departments", icon: ClipboardList },
  { href: "/stores/vendor-returns", label: "Vendor Returns", desc: "Return + replacement", icon: Undo2 },
  { href: "/stores/csp-receipts", label: "CSP Receipts", desc: "Customer-supplied material", icon: Boxes },
];
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

export default async function StoresPage() {
  await requirePermission("stores", "view");
  const stores = await listAccessibleStores();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stores"
        description="Stock locations and live balances"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {operations.map((op) => {
          const Icon = op.icon;
          return (
            <Link key={op.href} href={op.href} className="block">
              <Card className="h-full transition-colors hover:border-primary">
                <CardBody className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{op.label}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{op.desc}</p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          );
        })}
      </div>

      {stores.length === 0 ? (
        <Card>
          <CardBody className="text-center text-sm text-muted-foreground">
            No stores accessible. Contact your administrator.
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stores.map((s) => (
            <Link key={s.id} href={`/stores/${s.id}`} className="block">
              <Card className="h-full transition-colors hover:border-primary">
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Warehouse className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-foreground">
                          {s.name}
                        </h2>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {s.code}
                        </p>
                      </div>
                    </div>
                    <StatusPill tone={s.is_active ? "success" : "neutral"}>
                      {s.is_active ? "Active" : "Inactive"}
                    </StatusPill>
                  </div>

                  <StatusPill tone={storeTypeTone(s.store_type)}>
                    {STORE_TYPE_LABELS[s.store_type]}
                  </StatusPill>

                  <div className="flex gap-4 border-t border-border pt-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Items</span>
                      <p className="tabular-nums text-sm font-medium text-foreground">
                        {fmtNumber(s.item_count)}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total qty</span>
                      <p className="tabular-nums text-sm font-medium text-foreground">
                        {fmtNumber(s.total_qty)}
                      </p>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
