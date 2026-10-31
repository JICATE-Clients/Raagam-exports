import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import {
  OrderFacts,
  ReportTable,
  SectionCard,
  SheetMasthead,
  SignOff,
  Td,
  Th,
  stripeRow,
  totalRowStyle,
  type SheetFact,
} from "@/components/orders/report-kit";
import { AmountCard, CompanyLine, DocumentFoot, presentFacts } from "@/components/documents/document-kit";
import { fmtDate, fmtDateTime, fmtFixed, fmtNumber } from "@/lib/format";
import type { PoPrintData } from "@/lib/purchase/po-print";

/**
 * THE VENDOR PO, AS PRINTED (user 2026-10-27). The document the supplier receives,
 * printed through `DocumentPrintStyles` ("po" scope): white paper in both themes, the
 * app shell left off the page, and a long PO continuing onto the next sheet instead of
 * being clipped.
 *
 * THE CLIENT'S FIELDS IN OUR SHEET FORMAT (user 2026-10-31, "PO FORMAT.pdf": "follow our
 * layout styling with that sample format's required fields … which should follow our
 * style report"). Every box of the sample is here, drawn with the report kit in the
 * order every Raagam sheet reads (report-kit.tsx, "THE SHEET FORMAT"):
 *
 *   SheetMasthead  company · "YARN PURCHASE ORDER" · PO No large · date · Approved
 *   OrderFacts     Vendor, PO / Delivery Date, Reference, Terms of Delivery and Payment,
 *                  Place of Delivery, Transporter, Invoice To, Port of Shipment, GST
 *   SectionCard    Items — Description of Goods · Unit · Quantity · Rate · Value; under
 *                  each item its Customer · RE · Qty · Delivery and the rate opened up
 *                  (Gross Rate · GST · Net Rate · Quote No); the Total row in tone
 *   SectionCard    Amount — Gross Value → CGST / SGST → charges → Round off → Net Value,
 *                  the value in words as its note
 *   SectionCard    Remarks · Terms and Conditions (only when there are any)
 *   SignOff        Prepared · Verified · Received (vendor) · Authorised Signatory
 *
 * The sample's "Group No" (the SQ) is not on a PO line here, so it is not printed rather
 * than guessed. The budget rate is never on this page: it is ours, not the vendor's.
 *
 * A server component with nothing to hydrate; the Print button above it is the page's.
 */
export function PoPrintSheet({ data }: { data: PoPrintData }) {
  const sym = data.currency === "INR" ? "₹" : data.currency;
  const half = (pct: number) => Number((pct / 2).toFixed(2));
  const qtyText = data.totalQty.map((q) => `${fmtNumber(q.qty)}${data.totalQty.length > 1 ? ` ${q.uom}` : ""}`).join(" · ");
  const isImport = data.currency !== "INR";

  /* A FACT WITH NO VALUE IS LEFT OFF (user 2026-10-31, the facts grid pasted back with four
     dashes): Reference, Place of Delivery, Transporter and Invoice To print once they are
     filled in. The grid sizes itself to what is left (OrderFacts `dense`), one row as a rule. */
  const facts: SheetFact[] = presentFacts([
    {
      label: "Vendor",
      value: data.vendor.name ?? "—",
      sub: [data.vendor.address, data.vendor.gstin ? `GSTIN ${data.vendor.gstin}` : null].filter(Boolean).join(" · ") || undefined,
    },
    { label: "PO Date", value: data.orderDate ? fmtDate(data.orderDate) : "—", mono: true },
    { label: "Delivery Date", value: data.head.deliveryDate ? fmtDate(data.head.deliveryDate) : "—", mono: true },
    { label: "Reference", value: data.head.reference },
    { label: "Terms of Delivery and Payment", value: data.head.paymentTerms ?? "—" },
    { label: "GST", value: data.gstKind === "igst" ? "IGST" : "CGST + SGST" },
    { label: "Place of Delivery", value: data.head.placeOfDelivery },
    { label: "Transporter", value: data.head.transporter },
    { label: "Invoice to be sent to", value: data.head.invoiceTo },
    // Port of Shipment and the currency only mean something on an import (or once typed).
    ...(isImport || data.head.portOfShipment ? [{ label: "Port of Shipment", value: data.head.portOfShipment ?? "—" }] : []),
    ...(isImport
      ? [{ label: "Currency", value: data.currency, sub: data.exchangeRate ? `1 ${data.currency} = ₹ ${fmtFixed(data.exchangeRate, 2)}` : undefined }]
      : []),
  ]);

  // The money, in the order a GST invoice will be checked against it.
  const amountRows: { label: string; value: number }[] = [
    { label: "Gross Value", value: data.taxable },
    ...data.gstBySlab.flatMap((g) =>
      data.gstKind === "igst"
        ? [{ label: `IGST ${g.pct}%`, value: g.amount }]
        : [
            { label: `CGST ${half(g.pct)}%`, value: g.amount / 2 },
            { label: `SGST ${half(g.pct)}%`, value: g.amount / 2 },
          ],
    ),
    ...data.charges.map((c) => ({ label: c.label || (c.kind === "less" ? "Less" : "Add"), value: c.kind === "less" ? -c.amount : c.amount })),
    ...(data.roundOff ? [{ label: "Round off", value: data.roundOff }] : []),
  ];

  return (
    <>
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep">
          <SheetMasthead
            company={{ name: data.company.name ?? "RAAGAM EXPORTS", unit: data.company.unit, logo: data.company.logo }}
            kind={data.title}
            reNo={data.code}
            meta={<span className="tabular-nums">{data.orderDate ? fmtDate(data.orderDate) : null}</span>}
            status={data.status === "approved" ? "Approved" : null}
            dense
          />
          <CompanyLine company={data.company} />
          <OrderFacts facts={facts} dense />
        </div>

        <SectionCard dense title="Items" total={`${sym} ${fmtFixed(data.taxable, 2)}`} totalLabel="Gross Value">
          <ReportTable bare>
            <thead>
              <tr>
                <Th right>#</Th>
                <Th>Description of Goods</Th>
                <Th>Unit</Th>
                <Th right>Quantity</Th>
                <Th right>Rate ({sym})</Th>
                <Th right>Value ({sym})</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.key} style={stripeRow(i)} className="po-keep align-top">
                  <Td right>
                    <span className="text-[#7b8594]">{i + 1}</span>
                  </Td>
                  <Td>
                    {/* The item with the Purchase Manager's note in its name (0755), colour under it. */}
                    <div className="font-semibold">{r.name}</div>
                    {r.spec ? <div className="mt-0.5 text-[11px] text-[#344054]">{r.spec}</div> : null}
                    {/* THE DETAIL UNDER THE ITEM — sizes, bags, or rolls and dia (0757 · 0758). */}
                    {r.sizes.length ? (
                      <div className="mt-0.5 text-[11px] text-[#5b6472] tabular-nums">
                        {r.sizes.map((z) => `${z.size} ${fmtNumber(z.qty)}`).join(" · ")}
                      </div>
                    ) : null}
                    {r.bags != null && r.bagWeight != null ? (
                      <div className="mt-0.5 text-[11px] text-[#5b6472] tabular-nums">
                        {r.bags} bag{r.bags === 1 ? "" : "s"} × {fmtNumber(r.bagWeight)} kg
                      </div>
                    ) : null}
                    {r.rolls != null || r.dia ? (
                      <div className="mt-0.5 text-[11px] text-[#5b6472] tabular-nums">
                        {[r.rolls != null ? `${r.rolls} roll${r.rolls === 1 ? "" : "s"}` : null, r.dia ? `Dia ${r.dia}` : null].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                    {/* The cloth's construction for the knitter (0762); Ply and Gauge apart, LL in cm (0774). */}
                    {r.gsm != null || r.ply || r.gauge || r.loopLength != null ? (
                      <div className="mt-0.5 text-[11px] text-[#5b6472] tabular-nums">
                        {[
                          r.gsm != null ? `${r.gsm} GSM` : null,
                          r.gauge ? `Gauge ${r.gauge}` : null,
                          r.ply ? `Ply ${r.ply}` : null,
                          r.loopLength != null ? `LL (cm) ${r.loopLength}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    ) : null}
                    {/* WHICH ORDER, FOR WHOM, BY WHEN — the sample's small table under each item,
                        in the kit's header grey. */}
                    <table className="mt-1 w-full max-w-[32rem] border-collapse text-[10.5px]">
                      <thead>
                        <tr className="bg-[#f6f7f9] text-left text-[10px] text-[#5b6472]">
                          <th className="border border-border px-1.5 py-px font-semibold">Customer</th>
                          <th className="border border-border px-1.5 py-px font-semibold">RE / SWO / IWO</th>
                          <th className="border border-border px-1.5 py-px text-right font-semibold">{r.uom ?? "Qty"}</th>
                          <th className="border border-border px-1.5 py-px font-semibold">Delivery</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="tabular-nums">
                          <td className="border border-border px-1.5 py-px">{r.customer ?? "—"}</td>
                          <td className="border border-border px-1.5 py-px font-mono">{r.sourceNo?.split(" · ")[0] ?? "—"}</td>
                          <td className="border border-border px-1.5 py-px text-right">{fmtNumber(r.qty)}</td>
                          <td className="border border-border px-1.5 py-px">{r.delivery ? fmtDate(r.delivery) : "—"}</td>
                        </tr>
                      </tbody>
                    </table>
                    {/* The rate opened up: billed per unit, its GST, and where it lands. */}
                    <div className="mt-0.5 text-[10.5px] text-[#5b6472] tabular-nums">
                      Gross Rate {fmtFixed(r.rate, 2)} · {data.gstKind === "igst" ? "IGST" : "GST"} {r.gstPct}% {fmtFixed(r.gstPerUnit, 2)} · Net Rate{" "}
                      <span className="font-semibold text-[#17202b]">{fmtFixed(r.netRate, 2)}</span>
                      {r.quoteNo ? <span> · Quote No {r.quoteNo}</span> : null}
                    </div>
                  </Td>
                  <Td>{r.uom ?? "—"}</Td>
                  <Td right>{fmtNumber(r.qty)}</Td>
                  <Td right>{fmtFixed(r.rate, 2)}</Td>
                  <Td right>
                    <span className="font-semibold">{fmtFixed(r.amount, 2)}</span>
                  </Td>
                </tr>
              ))}
              <tr style={totalRowStyle()} className="font-semibold">
                <Td colSpan={3} right>
                  Total
                </Td>
                <Td right>{qtyText}</Td>
                <Td> </Td>
                <Td right>{fmtFixed(data.taxable, 2)}</Td>
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>

        {/* THE FOOT, ONE BAND (document-kit.tsx): words · remarks · terms left, money right. */}
        <DocumentFoot
          words={data.valueInWords}
          remarks={data.notes}
          terms={data.terms}
          amount={
            <AmountCard
              sym={sym}
              rows={amountRows}
              net={data.netValue}
              after={data.totalInr != null ? [{ label: "In INR", value: `₹ ${fmtFixed(data.totalInr, 2)}` }] : undefined}
            />
          }
        />

        <div className="po-keep">
          {/* ONE ROW (user 2026-10-31: "compacted, make it single row"). The four signatures
              side by side, one line each: the Digital Approval stamp is no longer a band of
              its own above them — it is the Authorised Signatory's line (escalation spec §3:
              who approved and when, on the PO itself), and the vendor's Name / Mobile No /
              Sign are one ruled blank to write on. */}
          <SignOff
            dense
            approvedSignature={data.approverSignature}
            cells={[
              ["Prepared By", data.preparedBy],
              ["Verified By", null],
              ["Received By", "Name · Mobile No · Sign"],
              // Short lines that fit a quarter of the page (screenshot 3942: the long label
              // wrapped to three lines and lifted this rule above the other three).
              [
                "Authorised Signatory",
                <span key="ok">
                  For {data.company.name ?? "RAAGAM EXPORTS"}
                  {data.approvedBy ? (
                    <span className="block text-[10.5px] text-[#16643a]">
                      Digitally approved by {data.approvedBy}
                      {data.approvedAt ? <span className="block">{fmtDateTime(data.approvedAt)}</span> : null}
                    </span>
                  ) : null}
                </span>,
              ],
            ]}
          />
        </div>
      </article>
    </>
  );
}
