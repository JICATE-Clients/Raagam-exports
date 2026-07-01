import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getDc, getDcLines } from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber } from "@/lib/format";
import { dcLineBalance } from "@/lib/purchase/types";
import { RecordReturnButton } from "./_components/record-return-button";
import type { DcLineItem, DcStatus } from "@/lib/purchase/types";

const statusTone: Record<DcStatus, "info" | "warning" | "success"> = {
  issued: "info",
  partially_returned: "warning",
  closed: "success",
};

const statusLabel: Record<DcStatus, string> = {
  issued: "Issued",
  partially_returned: "Partially Returned",
  closed: "Closed",
};

export default async function DcDetailPage({
  params,
}: {
  params: Promise<{ dcId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { dcId } = await params;

  const [dc, lines] = await Promise.all([getDc(dcId), getDcLines(dcId)]);
  if (!dc) notFound();

  const isClosed = dc.status === "closed";

  return (
    <div className="space-y-4">
      <PageHeader
        title={dc.code ?? "DC"}
        description="Delivery Challan — track material sent to processor and returns"
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={statusTone[dc.status]}>
              {statusLabel[dc.status]}
            </StatusPill>
            <Link
              href="/purchase/dc"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to list
            </Link>
          </div>
        }
      />

      {/* DC header */}
      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Code</dt>
              <dd className="mt-0.5 font-medium">{dc.code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Vendor / Processor
              </dt>
              <dd className="mt-0.5">{dc.vendors?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Date</dt>
              <dd className="mt-0.5">{fmtDate(dc.dc_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Purpose</dt>
              <dd className="mt-0.5">{dc.purpose ?? "—"}</dd>
            </div>
            {dc.notes && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 text-muted-foreground">{dc.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Lines table */}
      <Card>
        <CardHeader>
          <CardTitle>Lines ({lines.length})</CardTitle>
          {!isClosed && (
            <span className="text-xs text-muted-foreground">
              Record returns as material comes back from the processor
            </span>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {lines.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No lines on this DC.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Description
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Sent Qty
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Returned
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Balance
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line: DcLineItem) => {
                    const balance = dcLineBalance(line);
                    return (
                      <tr
                        key={line.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-3 py-2">{line.description}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtNumber(line.sent_qty)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtNumber(line.returned_qty)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span
                            className={
                              balance > 0 ? "text-warning" : "text-success"
                            }
                          >
                            {fmtNumber(balance)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!isClosed && (
                            <RecordReturnButton
                              lineId={line.id}
                              sentQty={line.sent_qty}
                              returnedQty={line.returned_qty}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
