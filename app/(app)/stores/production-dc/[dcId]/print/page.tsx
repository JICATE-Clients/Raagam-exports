import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductionDc } from "@/lib/stores/production-dc-service";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { OrderFacts, ReportTable, SectionCard, SheetMasthead, SignOff, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { CompanyLine, DocumentFoot, presentFacts } from "@/components/documents/document-kit";
import { fmtDate, fmtNumber } from "@/lib/format";
import { withCreators } from "@/lib/created-by";

/**
 * THE PRODUCTION DC, AS PRINTED (doc/stores/dc-plan.md §3): the challan the goods travel
 * on between units. The three units share one GSTIN, so the items card states a stock
 * transfer, not a sale.
 *
 * THE OUTSIDE-PARTY DOCUMENT SHAPE (user 2026-10-31, the compact vendor PO print):
 * masthead → company line → facts (blank ones left off) → items with a Total row →
 * remarks → one-row sign-off. A DC carries no money, so there is no Amount card.
 */
export default async function ProductionDcPrintPage({ params }: { params: Promise<{ dcId: string }> }) {
  await requirePermission("stores", "view");
  const { dcId } = await params;
  const dc = await getProductionDc(dcId);
  if (!dc) notFound();

  const s = await createClient();
  // Prepared By's name (created-by.ts `creator_names`), alongside the letterhead reads.
  const [{ data: co }, { data: units }, preparedBy] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    s.from("locations").select("id, gst_number").in("id", [dc.location_id, dc.to_location_id]),
    withCreators([dc]).then((r) => (r[0] as { created_by_name?: string | null }).created_by_name ?? null),
  ]);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const gstOf = (id: string) => ((units ?? []) as { id: string; gst_number: string | null }[]).find((u) => u.id === id)?.gst_number ?? cs("gstin");
  const total = dc.lines.reduce((a, l) => a + l.sent_qty, 0);
  const received = dc.status === "received";
  const totalReceived = dc.lines.reduce((a, l) => a + l.received_qty, 0);
  const totalShort = dc.lines.reduce((a, l) => a + l.shortage_qty, 0);
  const uoms = [...new Set(dc.lines.map((l) => l.uom).filter(Boolean))];
  const companyName = cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS";
  const toGst = gstOf(dc.to_location_id);

  const facts = presentFacts([
    { label: "Sent to", value: dc.to_unit, sub: toGst ? `GSTIN ${toGst}` : undefined },
    { label: "From Unit", value: dc.from_unit },
    { label: "DC Date", value: dc.dc_date ? fmtDate(dc.dc_date) : null, mono: true },
    { label: "Vehicle No", value: dc.vehicle_no, mono: true },
    { label: "Transporter", value: dc.transporter },
    { label: "E-way Bill No", value: dc.eway_bill_no, mono: true },
    { label: "Status", value: dc.status === "draft" ? "DRAFT — not dispatched" : received ? "Received" : "In transit" },
  ]);

  return (
    <div>
      <PoPrintToolbar backHref="/stores/production-dc" backLabel="Production DC" printable={dc.status !== "draft"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep">
          <SheetMasthead
            company={{ name: companyName, unit: dc.from_unit, logo: letterheadLogoOf(c) }}
            kind="Delivery Challan — Stock Transfer"
            reNo={dc.code}
            meta={<span className="tabular-nums">{fmtDate(dc.dc_date)}</span>}
            dense
          />
          <CompanyLine
            company={{
              address: registeredAddressOf(c),
              phone: cs("phone") ?? cs("mobile"),
              email: cs("email"),
              gstin: gstOf(dc.location_id),
            }}
          />
          <OrderFacts facts={facts} dense />
        </div>

        <SectionCard
          dense
          title="Goods sent"
          total={fmtNumber(total)}
          totalLabel="Total qty"
          note="Stock transfer between units of the same company — not a sale."
        >
          <ReportTable bare>
            <thead>
              <tr>
                <Th right>#</Th>
                <Th>Item</Th>
                <Th>From Store</Th>
                <Th>Lot No</Th>
                <Th right>Qty</Th>
                {received ? <Th right>Received</Th> : null}
                {received ? <Th>Shortage</Th> : null}
              </tr>
            </thead>
            <tbody>
              {dc.lines.map((l, i) => (
                <tr key={l.id} style={stripeRow(i)} className="po-keep align-top">
                  <Td right>
                    <span className="text-[#7b8594]">{i + 1}</span>
                  </Td>
                  <Td>
                    <span className="font-semibold">{l.item_name}</span>
                  </Td>
                  <Td>{l.from_store ?? ""}</Td>
                  <Td>{l.lot_no ?? ""}</Td>
                  <Td right>
                    {fmtNumber(l.sent_qty)} <span className="text-[10.5px] text-[#7b8594]">{l.uom ?? ""}</span>
                  </Td>
                  {received ? <Td right>{fmtNumber(l.received_qty)}</Td> : null}
                  {received ? <Td>{l.shortage_qty > 0 ? `${fmtNumber(l.shortage_qty)} — ${l.shortage_reason ?? ""}` : ""}</Td> : null}
                </tr>
              ))}
              <tr style={totalRowStyle()} className="font-semibold">
                <Td colSpan={4} right>
                  Total
                </Td>
                <Td right>
                  {fmtNumber(total)}
                  {uoms.length === 1 ? <span className="text-[10.5px] text-[#7b8594]"> {uoms[0]}</span> : null}
                </Td>
                {received ? <Td right>{fmtNumber(totalReceived)}</Td> : null}
                {received ? <Td>{totalShort > 0 ? fmtNumber(totalShort) : ""}</Td> : null}
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>

        <DocumentFoot remarks={dc.notes} />

        <div className="po-keep">
          <SignOff
            dense
            cells={[
              ["Prepared By", preparedBy],
              ["Checked By", null],
              ["Received By", "Name · Sign · Seal"],
              ["Authorised Signatory", `For ${companyName}`],
            ]}
          />
        </div>
      </article>
    </div>
  );
}
