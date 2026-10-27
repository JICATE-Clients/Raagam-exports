import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { SectionCard, SheetLabel, SheetMasthead, SignOff, Td, Th, stripeRow } from "@/components/orders/report-kit";
import { fmtDate, fmtFixed, fmtNumber } from "@/lib/format";
import type { PoPrintData } from "@/lib/purchase/po-print";

/**
 * THE VENDOR PO, AS PRINTED (user 2026-10-27). The document the supplier receives —
 * built from the same report kit as every order sheet (masthead, section cards, sign
 * off) so a Raagam printout looks like one family, and printed through
 * `DocumentPrintStyles` ("po" scope): white paper in both themes, the app shell left
 * off the page, and a long PO continuing onto the next sheet instead of being clipped.
 *
 * What the vendor reads on each line, in the order they act on it: which item —
 * with the Purchase Manager's note already in its name ("MAIN LABEL · WHITE
 * (PROCESS: CUT & SEAL)", 0755) — then, under it in grey, the size breakup, the
 * whole bags of a yarn, or the rolls and dia of a fabric (0757 · 0758). The budget
 * rate is never on this page: it is ours, not the vendor's.
 *
 * A server component with nothing to hydrate; the Print button above it is the page's.
 */
export function PoPrintSheet({ data }: { data: PoPrintData }) {
  const sym = data.currency === "INR" ? "₹" : data.currency;
  const half = (pct: number) => Number((pct / 2).toFixed(2));
  const sizeCount = data.rows.filter((r) => r.sizes.length > 0).length;

  return (
    <>
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="mb-4">
          <SheetMasthead
            company={{ name: data.company.name ?? "RAAGAM EXPORTS", unit: data.company.unit, logo: data.company.logo }}
            kind="Purchase Order"
            reNo={data.code}
            meta={<span className="tabular-nums">{data.orderDate ? fmtDate(data.orderDate) : null}</span>}
            status={data.status === "approved" ? "Approved" : null}
          />
          {data.company.address || data.company.gstin ? (
            <p className="border-x border-b border-border bg-white px-4 py-1.5 text-[11px] text-[#5b6472]">
              {data.company.address}
              {data.company.address && data.company.gstin ? " · " : ""}
              {data.company.gstin ? `GSTIN ${data.company.gstin}` : ""}
            </p>
          ) : null}
        </div>

        {/* TO WHOM, AND ON WHAT TERMS OF MONEY — the two blocks a supplier reads first. */}
        <div className="po-keep mb-5 grid grid-cols-2 gap-4">
          <div className="rounded-md border border-border px-3 py-2">
            <SheetLabel>To</SheetLabel>
            <div className="text-[14px] font-bold">{data.vendor.name ?? "—"}</div>
            {data.vendor.address ? <div className="mt-0.5 text-[11.5px] text-[#5b6472]">{data.vendor.address}</div> : null}
            {data.vendor.gstin ? <div className="mt-1 font-mono text-[11px]">GSTIN {data.vendor.gstin}</div> : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-border px-3 py-2">
            <div>
              <dt className="text-[10.5px] text-[#7b8594] uppercase">PO Date</dt>
              <dd className="font-semibold tabular-nums">{data.orderDate ? fmtDate(data.orderDate) : "—"}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] text-[#7b8594] uppercase">Currency</dt>
              <dd className="font-semibold">
                {data.currency}
                {data.exchangeRate ? <span className="font-normal text-[#5b6472]"> · 1 {data.currency} = ₹ {fmtFixed(data.exchangeRate, 2)}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-[10.5px] text-[#7b8594] uppercase">GST</dt>
              <dd className="font-semibold">{data.gstKind === "igst" ? "IGST" : "CGST + SGST"}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] text-[#7b8594] uppercase">Lines</dt>
              <dd className="font-semibold tabular-nums">
                {data.rows.length}
                {sizeCount ? <span className="font-normal text-[#5b6472]"> · {sizeCount} with sizes</span> : null}
              </dd>
            </div>
          </dl>
        </div>

        <SectionCard title="Items" total={`${sym} ${fmtFixed(data.taxable, 2)}`} totalLabel="Taxable">
          <div className="po-scroll">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <Th right>#</Th>
                  <Th>RE / SWO / IWO</Th>
                  <Th>Item</Th>
                  <Th right>Qty</Th>
                  <Th right>Rate ({sym})</Th>
                  <Th right>GST %</Th>
                  <Th right>Amount ({sym})</Th>
                  <Th>Delivery</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.key} style={stripeRow(i)} className="po-keep align-top">
                    <Td right>
                      <span className="text-[#7b8594]">{i + 1}</span>
                    </Td>
                    <Td mono>{r.sourceNo?.split(" · ")[0] ?? "—"}</Td>
                    <Td>
                      <div className="font-semibold">{r.description}</div>
                      {/* THE DETAIL UNDER THE ITEM — sizes, bags, or rolls and dia. */}
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
                    </Td>
                    <Td right>
                      {fmtNumber(r.qty)} <span className="text-[10.5px] text-[#7b8594]">{r.uom ?? ""}</span>
                    </Td>
                    <Td right>{fmtFixed(r.rate, 2)}</Td>
                    <Td right>{r.gstPct}%</Td>
                    <Td right>
                      <span className="font-semibold">{fmtFixed(r.amount, 2)}</span>
                    </Td>
                    <Td mono>{r.delivery ? fmtDate(r.delivery) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* THE MONEY, the way a GST invoice will be checked against it: per slab, split. */}
        <div className="po-keep mt-3 flex justify-end">
          <dl className="w-[22rem] rounded-md border border-border text-[12px] tabular-nums">
            <div className="flex justify-between px-3 py-1">
              <dt className="text-[#5b6472]">Taxable</dt>
              <dd>
                {sym} {fmtFixed(data.taxable, 2)}
              </dd>
            </div>
            {data.gstBySlab.map((g) =>
              data.gstKind === "igst" ? (
                <div key={g.pct} className="flex justify-between px-3 py-1">
                  <dt className="text-[#5b6472]">IGST {g.pct}%</dt>
                  <dd>
                    {sym} {fmtFixed(g.amount, 2)}
                  </dd>
                </div>
              ) : (
                <div key={g.pct} className="flex justify-between px-3 py-1">
                  <dt className="text-[#5b6472]">
                    CGST {half(g.pct)}% + SGST {half(g.pct)}%
                  </dt>
                  <dd>
                    {sym} {fmtFixed(g.amount, 2)}
                  </dd>
                </div>
              ),
            )}
            {data.charges.map((c, i) => (
              <div key={i} className="flex justify-between px-3 py-1">
                <dt className="text-[#5b6472]">
                  {c.kind === "less" ? "Less" : "Add"}: {c.label}
                </dt>
                <dd>
                  {c.kind === "less" ? "− " : ""}
                  {sym} {fmtFixed(c.amount, 2)}
                </dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-border bg-[#f2f8fc] px-3 py-1.5 text-[13px] font-bold">
              <dt>Total</dt>
              <dd>
                {sym} {fmtFixed(data.total, 2)}
              </dd>
            </div>
            {data.totalInr != null ? (
              <div className="flex justify-between px-3 py-1 text-[#5b6472]">
                <dt>In INR</dt>
                <dd>₹ {fmtFixed(data.totalInr, 2)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {data.terms.length ? (
          <div className="po-keep mt-5">
            <SheetLabel>Terms</SheetLabel>
            <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 rounded-md border border-border px-3 py-2">
              {data.terms.map((t) => (
                <div key={t.label}>
                  <dt className="text-[10.5px] text-[#7b8594] uppercase">{t.label}</dt>
                  <dd className="font-medium">{t.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {data.notes ? (
          <div className="po-keep mt-4">
            <SheetLabel>Notes</SheetLabel>
            <p className="rounded-md border border-border px-3 py-2 whitespace-pre-wrap">{data.notes}</p>
          </div>
        ) : null}

        <div className="po-keep">
          <SignOff names={{ prepared: data.preparedBy, approved: data.approvedBy }} />
        </div>
      </article>
    </>
  );
}
