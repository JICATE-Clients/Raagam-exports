import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getRfq, getRfqComparison } from "@/lib/purchase/po-service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { fmtMoney, fmtNumber } from "@/lib/format";
import Link from "next/link";

export default async function RfqComparePage({
  params,
}: {
  params: Promise<{ rfqId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { rfqId } = await params;

  const [rfq, comparison] = await Promise.all([
    getRfq(rfqId),
    getRfqComparison(rfqId),
  ]);

  if (!rfq) notFound();

  // collect unique vendors across all quotes
  const vendorSet = new Map<string, string>();
  for (const row of comparison) {
    for (const q of row.quotes) {
      if (!vendorSet.has(q.vendor_id)) {
        vendorSet.set(q.vendor_id, q.vendor_name ?? "Unknown");
      }
    }
  }
  const vendors = Array.from(vendorSet.entries());

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Quote Comparison: ${rfq.code ?? rfq.title}`}
        description={`${rfq.quotes.length} vendor quotes across ${comparison.length} line items`}
        actions={
          <Link
            href={`/purchase/rfq/${rfqId}`}
            className="text-sm text-primary hover:underline"
          >
            Back to RFQ
          </Link>
        }
      />

      {comparison.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground">
              No quote line data available. Add per-line prices from the RFQ
              detail page first.
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  {vendors.map(([vid, vname]) => (
                    <th
                      key={vid}
                      className="px-3 py-2 text-right font-medium"
                    >
                      {vname}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => {
                  // find lowest price across vendors for highlighting
                  const prices = row.quotes
                    .filter((q) => q.unit_price > 0)
                    .map((q) => q.unit_price);
                  const lowest = prices.length > 0 ? Math.min(...prices) : 0;

                  return (
                    <tr
                      key={row.rfq_line_id}
                      className="border-b border-border/50"
                    >
                      <td className="max-w-xs truncate px-3 py-2">
                        {row.description}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtNumber(row.quantity)}
                      </td>
                      {vendors.map(([vid]) => {
                        const q = row.quotes.find(
                          (quote) => quote.vendor_id === vid,
                        );
                        const isLowest =
                          q && q.unit_price > 0 && q.unit_price === lowest;
                        return (
                          <td
                            key={vid}
                            className={`px-3 py-2 text-right tabular-nums ${
                              isLowest
                                ? "font-semibold text-success"
                                : ""
                            }`}
                          >
                            {q ? fmtMoney(q.unit_price) : "--"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2" />
                  {vendors.map(([vid]) => {
                    const total = comparison.reduce((sum, row) => {
                      const q = row.quotes.find(
                        (quote) => quote.vendor_id === vid,
                      );
                      return sum + (q?.amount ?? 0);
                    }, 0);
                    return (
                      <td
                        key={vid}
                        className="px-3 py-2 text-right tabular-nums"
                      >
                        {fmtMoney(total)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
