import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { OrderFacts, ReportTable, SectionCard, SheetMasthead, SignOff, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { AmountCard, CompanyLine, DocumentFoot, presentFacts } from "@/components/documents/document-kit";
import { fmtDate, fmtFixed, fmtNumber } from "@/lib/format";
import type { RejectionPrintData } from "@/lib/purchase/rejection-print";

/**
 * THE REJECTION DELIVERY CHALLAN, AS PRINTED — and the Debit Note copy that goes with it
 * (doc/purchase/grn.md §2B). Same report kit and print styles as the PO print, so the
 * vendor receives one family of paper.
 *
 * What the vendor reads, in the order they act on it: what came back and why, then
 * whether they are to SEND IT AGAIN (replace — no credit is asked) or CREDIT it (return &
 * re-buy), and finally the debit note against their invoice. A server component.
 *
 * THE OUTSIDE-PARTY DOCUMENT SHAPE (user 2026-10-31, the compact vendor PO print):
 * masthead → company line → facts (blank ones left off) → items with a Total row →
 * the foot (debit note left, the money right) → one-row sign-off.
 */
export function RejectionDcPrintSheet({ data }: { data: RejectionPrintData }) {
  const toReplace = data.lines.filter((l) => l.action === "replace");
  const toCredit = data.lines.filter((l) => l.action === "return");
  const companyName = data.company.name ?? "RAAGAM EXPORTS";
  const uoms = [...new Set(data.lines.map((l) => l.uom).filter(Boolean))];
  const totalQty = data.lines.reduce((a, l) => a + l.qty, 0);
  const gst = Math.round((data.total - data.taxable) * 100) / 100;

  const facts = presentFacts([
    {
      label: "Returned to",
      value: data.vendor.name,
      sub: [data.vendor.address, data.vendor.gstin ? `GSTIN ${data.vendor.gstin}` : null].filter(Boolean).join(" · ") || undefined,
    },
    { label: "DC Date", value: data.returnDate ? fmtDate(data.returnDate) : null, mono: true },
    { label: "Against GRN", value: data.grn?.code ?? null, sub: data.grn?.date ? fmtDate(data.grn.date) : undefined, mono: true },
    {
      label: "Your Invoice",
      value: data.grn?.invoiceNo ?? null,
      sub: data.grn?.invoiceDate ? fmtDate(data.grn.invoiceDate) : undefined,
      mono: true,
    },
    {
      label: "Your DC",
      value: data.grn?.dcNo ?? null,
      sub: !data.grn?.invoiceNo && data.grn?.invoiceDate ? fmtDate(data.grn.invoiceDate) : undefined,
      mono: true,
    },
    { label: "Purchase Order", value: data.poCodes.join(", "), mono: true },
  ]);

  const debitFacts = data.debitNote
    ? presentFacts([
        { label: "Date", value: data.debitNote.date ? fmtDate(data.debitNote.date) : null },
        {
          label: "Against",
          value: data.grn?.invoiceNo ? `Your invoice ${data.grn.invoiceNo}` : data.grn?.code ? `GRN ${data.grn.code}` : null,
        },
        { label: "Value incl. GST", value: `₹ ${fmtFixed(data.total, 2)}` },
        { label: "Reason", value: data.debitNote.reason },
      ])
    : [];

  return (
    <>
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep">
          <SheetMasthead
            company={{ name: companyName, unit: data.company.unit, logo: data.company.logo }}
            kind={data.dcKind === "replacement" ? "Replacement Delivery Challan" : "Rejection Delivery Challan"}
            reNo={data.code}
            meta={<span className="tabular-nums">{data.returnDate ? fmtDate(data.returnDate) : null}</span>}
            dense
          />
          <CompanyLine company={{ address: data.company.address, gstin: data.company.gstin }} />
          <OrderFacts facts={facts} dense />
        </div>

        <SectionCard
          dense
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
          <ReportTable bare>
            <thead>
              <tr>
                <Th right>#</Th>
                <Th>Item</Th>
                <Th right>Qty</Th>
                <Th right>Rate (₹)</Th>
                <Th right>GST</Th>
                <Th right>Value (₹)</Th>
                <Th>Reason</Th>
                <Th>To do</Th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={l.key} style={stripeRow(i)} className="po-keep align-top">
                  <Td right>
                    <span className="text-[#7b8594]">{i + 1}</span>
                  </Td>
                  <Td>
                    <span className="font-semibold">{l.description}</span>
                  </Td>
                  <Td right>
                    {fmtNumber(l.qty)} <span className="text-[10.5px] text-[#7b8594]">{l.uom ?? ""}</span>
                  </Td>
                  <Td right>{fmtFixed(l.rate, 2)}</Td>
                  <Td right>{l.gstPct}%</Td>
                  <Td right>
                    <span className="font-semibold">{fmtFixed(l.amount, 2)}</span>
                  </Td>
                  <Td>{l.reason ?? ""}</Td>
                  <Td>
                    <span className="font-semibold">{l.action === "replace" ? "REPLACE" : "CREDIT"}</span>
                    {l.action === "replace" && l.replaced > 0 ? (
                      <div className="text-[10.5px] text-[#5b6472] tabular-nums">{fmtNumber(l.replaced)} received back</div>
                    ) : null}
                  </Td>
                </tr>
              ))}
              <tr style={totalRowStyle()} className="font-semibold">
                <Td colSpan={2} right>
                  Total
                </Td>
                <Td right>
                  {fmtNumber(totalQty)}
                  {uoms.length === 1 ? <span className="text-[10.5px] text-[#7b8594]"> {uoms[0]}</span> : null}
                </Td>
                <Td colSpan={2}> </Td>
                <Td right>{fmtFixed(data.taxable, 2)}</Td>
                <Td colSpan={2}> </Td>
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>

        {/* THE FOOT, ONE BAND (document-kit.tsx): the debit note copy leads the left where a PO
            has its words and terms, the money on the right. */}
        <DocumentFoot
          lead={
            data.debitNote ? (
            <SectionCard
              dense
              title={`Debit Note copy · ${data.debitNote.code ?? ""}`}
              total={`₹ ${fmtFixed(data.debitNote.amount, 2)}`}
              totalLabel={data.debitNote.status === "cancelled" ? "Cancelled — replaced" : "Debited"}
            >
              <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 px-3 py-1.5">
                {debitFacts.map((f) => (
                  <div key={f.label} className={f.label === "Reason" ? "col-span-3" : undefined}>
                    <dt className="text-[10.5px] text-[#7b8594] uppercase">{f.label}</dt>
                    <dd className="font-semibold tabular-nums">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </SectionCard>
            ) : null
          }
          amount={
            <AmountCard
              sym="₹"
              rows={[
                { label: "Value", value: data.taxable },
                { label: "GST", value: gst },
              ]}
              net={data.total}
              netLabel="Value incl. GST"
            />
          }
        />

        <div className="po-keep">
          <SignOff
            dense
            cells={[
              ["Prepared By", data.preparedBy],
              ["Checked By", null],
              ["Received By", "Name · Mobile No · Sign"],
              ["Authorised Signatory", `For ${companyName}`],
            ]}
          />
        </div>
      </article>
    </>
  );
}
