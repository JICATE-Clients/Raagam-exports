import Link from "next/link";
import { DocBackLink, DocFacts, DocPrintIcon } from "@/components/purchase/doc-facts";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getDc, getDcLines } from "@/lib/purchase/grn-service";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { statusTone } from "@/lib/ui/status-tone";
import { fmtDate, fmtNumber } from "@/lib/format";
import { dcLineBalance } from "@/lib/purchase/types";
import { RecordReturnButton } from "./_components/record-return-button";
import type { DcLineItem, DcStatus } from "@/lib/purchase/types";

// A delivery challan CLOSED is every piece back from the job worker — its
// normal completion, so success rather than the shared table's retired grey.
const DC_TONES = { closed: "success" } as const;

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
      />

      {/* ONE STRIP, NOT A TITLED CARD (user 2026-11-03, screenshot 4000) — components/purchase/doc-facts.tsx. */}
      <DocFacts
        trailing={
          <>
            <StatusPill tone={statusTone(dc.status, DC_TONES)}>{statusLabel[dc.status]}</StatusPill>
            <DocBackLink href="/purchase/dc" />
          </>
        }
        facts={[
          { label: "DC No", value: dc.code ?? "—", mono: true },
          { label: "Vendor / Processor", value: dc.master_vendors?.name ?? "—" },
          { label: "Date", value: fmtDate(dc.dc_date) },
          { label: "Purpose", value: dc.purpose ?? "—" },
          dc.notes ? { label: "Notes", value: <span className="font-normal text-muted-foreground">{dc.notes}</span> } : null,
        ]}
      />

      {/* Lines table */}
      <div className="space-y-3">
        {/* NO "Lines" CARD (user 2026-11-03: "lines layout remove it from overall module"): the
          table sits on the page, full width — the card only added a second frame and a title. */}
        {!isClosed && (
            <span className="text-xs text-muted-foreground">
              Record returns as material comes back from the processor
            </span>
          )}
        <div className="p-0">
          {lines.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No lines on this DC.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">
                      Description
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">
                      Sent Qty
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">
                      Returned
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">
                      Balance
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground" />
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
        </div>
      </div>
    </div>
  );
}
