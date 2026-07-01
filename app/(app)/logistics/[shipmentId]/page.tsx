import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getShipment,
  getShipmentOrders,
  getShipmentLines,
  getShipmentDocuments,
} from "@/lib/logistics/service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { ShipmentTabs } from "./shipment-tabs";
import {
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from "@/lib/logistics/types";
import type { StatusTone } from "@/components/ui/status-pill";

function shipmentStatusTone(status: ShipmentStatus): StatusTone {
  switch (status) {
    case "planning":
      return "neutral";
    case "docs_ready":
      return "info";
    case "shipped":
      return "warning";
    case "delivered":
      return "success";
    case "closed":
      return "neutral";
  }
}

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ shipmentId: string }>;
}) {
  await requirePermission("logistics", "view");
  const { shipmentId } = await params;

  const [shipment, shipmentOrders, lines, documents, canEdit, canDelete] =
    await Promise.all([
      getShipment(shipmentId),
      getShipmentOrders(shipmentId),
      getShipmentLines(shipmentId),
      getShipmentDocuments(shipmentId),
      can("logistics", "edit"),
      can("logistics", "delete"),
    ]);

  if (!shipment) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={shipment.code ?? "Shipment"}
        description={shipment.buyers?.name ?? undefined}
        actions={
          <StatusPill tone={shipmentStatusTone(shipment.status)}>
            {SHIPMENT_STATUS_LABELS[shipment.status]}
          </StatusPill>
        }
      />

      {/* Shipment summary strip */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Buyer</dt>
              <dd className="font-medium">{shipment.buyers?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Consignee</dt>
              <dd className="font-medium">{shipment.consignee_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Port of loading</dt>
              <dd className="font-medium">{shipment.port_of_loading ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Destination</dt>
              <dd className="font-medium">
                {[shipment.destination_country, shipment.destination_port]
                  .filter(Boolean)
                  .join(" / ") || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Vessel / voyage</dt>
              <dd className="font-medium">
                {[shipment.vessel, shipment.voyage_no].filter(Boolean).join(" / ") || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Incoterm</dt>
              <dd className="font-medium">{shipment.incoterm ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ETD / ETA</dt>
              <dd className="tabular-nums font-medium">
                {fmtDate(shipment.etd)}
                {shipment.eta ? ` → ${fmtDate(shipment.eta)}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total value</dt>
              <dd className="tabular-nums font-medium">
                {fmtMoney(shipment.total_value, shipment.currency_code)}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      {/* Tabbed sections */}
      <ShipmentTabs
        shipment={shipment}
        shipmentOrders={shipmentOrders}
        lines={lines}
        documents={documents}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
