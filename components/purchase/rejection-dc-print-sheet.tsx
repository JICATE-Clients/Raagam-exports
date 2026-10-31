import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { SectionCard, SheetLabel, SheetMasthead, SignOff, Td, Th, stripeRow } from "@/components/orders/report-kit";
import { fmtDate, fmtFixed, fmtNumber } from "@/lib/format";
import type { RejectionPrintData } from "@/lib/purchase/rejection-print";

/**
 * THE REJECTION DELIVERY CHALLAN, AS PRINTED — and the Debit Note copy that goes with it
 * (doc/purchase/grn.md §2B). Same report kit and print styles as the PO print, so the
 * vendor receives one family of paper: masthead, To block, the lines, sign-off.
 *
 * What the vendor reads, in the order they act on it: what came back and why, then
 * whether they are to SEND IT AGAIN (replace — no credit is asked) or CREDIT it (return &
 * re-buy), and finally the debit note against their invoice. A server component.
 */
export function RejectionDcPrintSheet({ data }: { data: RejectionPrintData }) {
  const toReplace = data.lines.filter((l) => l.action === "replace");
  const toCredit = data.lines.filter((l) => l.action === "return");

  return (
    <>
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="mb-4">
          <SheetMasthead
            company={{ name: data.company.name ?? "RAAGAM EXPORTS", unit: data.company.unit, logo: data.company.logo }}
            kind={data.dcKind === "replacement" ? "Replacement Delivery Challan" : "Rejection Delivery Challan"}
            reNo={data.code}
            meta={<span className="tabular-nums">{data.returnDate ? fmtDate(data.returnDate) : null}</span>}
          />
          {data.company.address || data.company.gstin ? (
            <p className="border-x border-b border-border bg-white px-4 py-1.5 text-[11px] text-[#5b6472]">
              {data.company.address}
              {data.company.address && data.company.gstin ? " · " : ""}
              {data.company.gstin ? `GSTIN ${data.company.gstin}` : ""}
            </p>
          ) : null}
        </div>

        <div className="po-keep mb-5 grid grid-cols-2 gap-4">
          <div className="rounded-md border border-border px-3 py-2">
            <SheetLabel>Returned to</SheetLabel>
            <div className="text-[14px] font-bold">{data.vendor.name ?? "—"}</div>
            {data.vendor.address ? <div className="mt-0.5 text-[11.5px] text-[#5b6472]">{data.vendor.address}</div> : null}
            {data.vendor.gstin ? <div className="mt-1 font-mono text-[11px]">GSTIN {data.vendor.gstin}</div> : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-border px-3 py-2">
            {[
              ["DC Date", data.returnDate ? fmtDate(data.returnDate) : "—"],
              ["Against GRN", data.grn ? `${data.grn.code ?? "—"}${data.grn.date ? ` · ${fmtDate(data.grn.date)}` : ""}` : "—"],
              [
                "Your Invoice",
                data.grn?.invoiceNo
                  ? `${data.grn.invoiceNo}${data.grn.invoiceDate ? ` · ${fmtDate(data.grn.invoiceDate)}` : ""}`
                  : "—",
              ],
              [
                "Your DC",
                data.grn?.dcNo
                  ? `${data.grn.dcNo}${!data.grn.invoiceNo && data.grn.invoiceDate ? ` · ${fmtDate(data.grn.invoiceDate)}` : ""}`
                  : "—",
              ],
              ["Purchase Order", data.poCodes.join(", ") || "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10.5px] text-[#7b8594] uppercase">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <SectionCard
          title="Goods returned"
          total={`₹ ${fmtFixed(data.taxable, 2)}`}
          totalLabel="Value"
          note={
            toReplace.length && toCredit.length
              ? "Lines marked REPLACE: send the same qty again against the same PO. Lines marked CREDIT: covered by the debit note below; do not resend."
              : toReplace.length
                ? "Please send the same qty again against the same Purchase Order. No debit note is raised: your invoice stands and the replacement fills it."
                : "These goods are not to be resent. The debit note below is raised against your invoice for their value."
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Item</Th>
                  <Th right>Qty</Th>
                  <Th right>Rate</Th>
                  <Th right>GST</Th>
                  <Th right>Value</Th>
                  <Th>Reason</Th>
                  <Th>To do</Th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={l.key} style={stripeRow(i)} className="po-keep align-top">
                    <Td mono>{i + 1}</Td>
                    <Td>{l.description}</Td>
                    <Td right>
                      {fmtNumber(l.qty)} <span className="text-[10.5px] text-[#7b8594]">{l.uom ?? ""}</span>
                    </Td>
                    <Td right>{fmtFixed(l.rate, 2)}</Td>
                    <Td right>{l.gstPct}%</Td>
                    <Td right>
                      <span className="font-semibold">{fmtFixed(l.amount, 2)}</span>
                    </Td>
                    <Td>{l.reason ?? "—"}</Td>
                    <Td>
                      <span className="font-semibold">{l.action === "replace" ? "REPLACE" : "CREDIT"}</span>
                      {l.action === "replace" && l.replaced > 0 ? (
                        <div className="text-[10.5px] text-[#5b6472] tabular-nums">{fmtNumber(l.replaced)} received back</div>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {data.debitNote ? (
          <div className="po-keep mt-5">
            <SectionCard
              title={`Debit Note copy · ${data.debitNote.code ?? ""}`}
              total={`₹ ${fmtFixed(data.debitNote.amount, 2)}`}
              totalLabel={data.debitNote.status === "cancelled" ? "Cancelled — replaced" : "Debited"}
            >
              <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 px-3.5 py-2.5 text-[12px]">
                <div>
                  <dt className="text-[10.5px] text-[#7b8594] uppercase">Date</dt>
                  <dd className="font-semibold">{data.debitNote.date ? fmtDate(data.debitNote.date) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-[10.5px] text-[#7b8594] uppercase">Against</dt>
                  <dd className="font-semibold">
                    {data.grn?.invoiceNo ? `Your invoice ${data.grn.invoiceNo}` : `GRN ${data.grn?.code ?? "—"}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10.5px] text-[#7b8594] uppercase">Value incl. GST</dt>
                  <dd className="font-semibold tabular-nums">₹ {fmtFixed(data.total, 2)}</dd>
                </div>
                <div className="col-span-3">
                  <dt className="text-[10.5px] text-[#7b8594] uppercase">Reason</dt>
                  <dd>{data.debitNote.reason ?? "—"}</dd>
                </div>
              </dl>
            </SectionCard>
          </div>
        ) : null}

        <div className="po-keep">
          <SignOff names={{ prepared: data.preparedBy }} />
          <p className="mt-6 text-[11px] text-[#5b6472]">Received the above goods in good condition — vendor&apos;s signature &amp; seal</p>
          <div className="mt-10 w-64 border-t border-[#17202b]" />
        </div>
      </article>
    </>
  );
}
