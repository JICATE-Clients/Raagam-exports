import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getRePurchaseStatus } from "@/lib/purchase/re-po/purchase-status";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { SectionCard, SheetLabel, SheetMasthead, Td, Th, stripeRow } from "@/components/orders/report-kit";
import { PO_STATUS_LABELS, type PoStatus } from "@/lib/purchase/types";
import { fmtDate, fmtFixed, fmtNumber } from "@/lib/format";

/**
 * RE PURCHASE STATUS — `/purchase/requirement-po/<sourceId>/report`, what a pending
 * row's Report icon opens on Raise PO (client 2026-10-30). The PURCHASE side of one
 * RE / SWO / IWO, not its order sheet: each item it needs, the PO raised for it, and
 * the balance still to buy. Same report kit and print styles as the PO print, so it
 * reads as one family with every Raagam document.
 */
export default async function RePurchaseStatusPage({ params }: { params: Promise<{ sourceId: string }> }) {
  await requirePermission("materials_purchase", "view");
  const { sourceId } = await params;
  const data = await getRePurchaseStatus(sourceId);
  if (!data) notFound();

  const toBuy = data.lines.filter((l) => l.balance > 0).length;

  return (
    <div>
      <PoPrintToolbar backHref="/purchase/requirement-po" backLabel="Raise PO" />
      <DocumentPrintStyles scope="rps" />
      <article className="rps-sheet mx-auto max-w-[1100px] bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="mb-4">
          <SheetMasthead
            company={{ name: data.company.name ?? "RAAGAM EXPORTS", logo: data.company.logo }}
            kind={`${data.kindLabel} Purchase Status`}
            reNo={data.sourceNo}
            meta={data.deliveryDate ? <span className="tabular-nums">Delivery {fmtDate(data.deliveryDate)}</span> : null}
          />
          {data.company.address ? (
            <p className="border-x border-b border-border bg-white px-4 py-1.5 text-[11px] text-[#5b6472]">{data.company.address}</p>
          ) : null}
        </div>

        <dl className="rps-keep mb-5 grid grid-cols-4 gap-4 rounded-md border border-border px-3 py-2">
          <div>
            <SheetLabel>Buyer</SheetLabel>
            <dd className="font-semibold">{data.customer ?? "—"}</dd>
          </div>
          <div>
            <SheetLabel>Items needed</SheetLabel>
            <dd className="font-semibold tabular-nums">{data.lines.length}</dd>
          </div>
          <div>
            <SheetLabel>POs raised</SheetLabel>
            <dd className="font-semibold tabular-nums">{data.poCount}</dd>
          </div>
          <div>
            <SheetLabel>Still to buy</SheetLabel>
            <dd className={`font-semibold tabular-nums ${toBuy ? "text-[#b42318]" : "text-[#067647]"}`}>
              {toBuy ? `${toBuy} item${toBuy === 1 ? "" : "s"}` : "Nothing — fully ordered"}
            </dd>
          </div>
        </dl>

        <SectionCard title="Items and their POs">
          <div className="rps-scroll">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <Th right>#</Th>
                  <Th>Item</Th>
                  <Th>Class</Th>
                  <Th right>Required</Th>
                  <Th>PO No</Th>
                  <Th>Vendor</Th>
                  <Th right>PO Qty</Th>
                  <Th right>Rate</Th>
                  <Th>PO Status</Th>
                  <Th right>Balance</Th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => {
                  const uom = l.uom ? ` ${l.uom}` : "";
                  // One row per PO on the line; a line with no PO yet still gets its row.
                  const pos = l.pos.length ? l.pos : [null];
                  return pos.map((p, j) => (
                    <tr key={`${l.key}:${p?.poId ?? "none"}:${j}`} style={stripeRow(i)} className="rps-keep align-top">
                      <Td right>{j === 0 ? <span className="text-[#7b8594]">{i + 1}</span> : ""}</Td>
                      <Td>
                        {j === 0 ? (
                          <>
                            <div className="font-semibold">{l.item}</div>
                            {l.slice && l.slice !== l.item ? <div className="mt-0.5 text-[11px] text-[#5b6472]">{l.slice}</div> : null}
                          </>
                        ) : (
                          ""
                        )}
                      </Td>
                      <Td>{j === 0 ? (l.itemClass ?? "—") : ""}</Td>
                      <Td right>{j === 0 ? `${fmtNumber(l.required)}${uom}` : ""}</Td>
                      <Td mono>
                        {p ? (
                          <Link href={`/purchase/orders/${p.poId}`} className="text-[#037bb8] hover:underline">
                            {p.code ?? "Draft PO"}
                          </Link>
                        ) : (
                          <span className="text-[#b42318]">Not raised</span>
                        )}
                      </Td>
                      <Td>{p?.vendor ?? "—"}</Td>
                      <Td right>{p ? `${fmtNumber(p.qty)}${uom}` : "—"}</Td>
                      <Td right>{p ? `₹ ${fmtFixed(p.rate, 2)}` : "—"}</Td>
                      <Td>{p ? (PO_STATUS_LABELS[p.status as PoStatus] ?? p.status) : "—"}</Td>
                      <Td right>
                        {j === 0 ? (
                          <span className={`font-semibold ${l.balance > 0 ? "text-[#b42318]" : "text-[#067647]"}`}>
                            {`${fmtNumber(l.balance)}${uom}`}
                          </span>
                        ) : (
                          ""
                        )}
                      </Td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </article>
    </div>
  );
}
