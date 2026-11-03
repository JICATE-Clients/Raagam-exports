import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getGeneralDc, partyOf } from "@/lib/purchase/general-dc-service";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { OrderFacts, ReportTable, SectionCard, SheetMasthead, SignOff, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { CompanyLine, DocumentFoot, presentFacts } from "@/components/documents/document-kit";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { withCreators } from "@/lib/created-by";

/**
 * THE GENERAL DC, AS PRINTED (0796) — the DC print kit (Production DC's shape): masthead →
 * company line → facts → items with a Total row → remarks → sign-off. Titled Returnable /
 * Non-returnable; the goods are not a sale, and the card says so.
 */
export default async function GeneralDcPrintPage({ params }: { params: Promise<{ dcId: string }> }) {
  if (!(await can("stores", "view"))) await requirePermission("materials_purchase", "view");
  const { dcId } = await params;
  const dc = await getGeneralDc(dcId);
  if (!dc) notFound();

  const s = await createClient();
  const [{ data: co }, { data: unit }, preparedBy] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    s.from("locations").select("gst_number").eq("id", dc.location_id).maybeSingle(),
    withCreators([dc]).then((r) => (r[0] as { created_by_name?: string | null }).created_by_name ?? null),
  ]);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const companyName = cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS";
  const total = dc.lines.reduce((a, l) => a + l.sent_qty, 0);
  const totalValue = dc.lines.reduce((a, l) => a + (l.approx_value ?? 0), 0);
  const uoms = [...new Set(dc.lines.map((l) => l.uom).filter(Boolean))];
  const anyBack = dc.lines.some((l) => l.returned_qty > 0 || l.closed_qty > 0);

  const facts = presentFacts([
    {
      label: "Sent to",
      value: partyOf(dc),
      sub: dc.vendor_gst ? `GSTIN ${dc.vendor_gst}` : (dc.party_address ?? undefined),
    },
    { label: "Purpose", value: dc.purpose },
    { label: "DC Date", value: dc.dc_date ? fmtDate(dc.dc_date) : null, mono: true },
    { label: "Expected Return", value: dc.is_returnable && dc.expected_return_date ? fmtDate(dc.expected_return_date) : null, mono: true },
    { label: "Vehicle No", value: dc.vehicle_no, mono: true },
    { label: "Transporter", value: dc.transporter },
    { label: "Status", value: dc.status === "draft" ? "DRAFT — not dispatched" : null },
  ]);

  return (
    <div>
      <PoPrintToolbar backHref="/purchase/dc?type=general" backLabel="Delivery Challans" printable={dc.status !== "draft"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep">
          <SheetMasthead
            company={{ name: companyName, unit: dc.unit_name, logo: letterheadLogoOf(c) }}
            kind={dc.is_returnable ? "Delivery Challan — Returnable" : "Delivery Challan — Non-returnable"}
            reNo={dc.code}
            meta={<span className="tabular-nums">{fmtDate(dc.dc_date)}</span>}
            dense
          />
          <CompanyLine
            company={{
              address: registeredAddressOf(c),
              phone: cs("phone") ?? cs("mobile"),
              email: cs("email"),
              gstin: (unit as { gst_number: string | null } | null)?.gst_number ?? cs("gstin"),
            }}
          />
          <OrderFacts facts={facts} dense />
        </div>

        <SectionCard
          dense
          title="Goods sent"
          total={fmtNumber(total)}
          totalLabel="Total qty"
          note={dc.is_returnable ? "Goods sent on returnable basis — to be returned. Not for sale." : "Goods sent on non-returnable basis. Not for sale."}
        >
          <ReportTable bare>
            <thead>
              <tr>
                <Th right>#</Th>
                <Th>Description</Th>
                <Th>Lot No</Th>
                <Th right>Qty</Th>
                <Th right>Approx. Value</Th>
                {anyBack ? <Th right>Returned</Th> : null}
              </tr>
            </thead>
            <tbody>
              {dc.lines.map((l, i) => (
                <tr key={l.id} style={stripeRow(i)} className="po-keep align-top">
                  <Td right>
                    <span className="text-[#7b8594]">{i + 1}</span>
                  </Td>
                  <Td>
                    <span className="font-semibold">{l.description}</span>
                    {l.item_name && l.item_name !== l.description ? <span className="block text-[10.5px] text-[#7b8594]">{l.item_name}</span> : null}
                  </Td>
                  <Td>{l.lot_no ?? ""}</Td>
                  <Td right>
                    {fmtNumber(l.sent_qty)} <span className="text-[10.5px] text-[#7b8594]">{l.uom ?? ""}</span>
                  </Td>
                  <Td right>{l.approx_value != null ? fmtMoney(l.approx_value) : ""}</Td>
                  {anyBack ? (
                    <Td right>
                      {fmtNumber(l.returned_qty)}
                      {l.closed_qty > 0 ? <span className="block text-[10.5px] text-[#7b8594]">{fmtNumber(l.closed_qty)} not returning</span> : null}
                    </Td>
                  ) : null}
                </tr>
              ))}
              <tr style={totalRowStyle()} className="font-semibold">
                <Td colSpan={3} right>
                  Total
                </Td>
                <Td right>
                  {fmtNumber(total)}
                  {uoms.length === 1 ? <span className="text-[10.5px] text-[#7b8594]"> {uoms[0]}</span> : null}
                </Td>
                <Td right>{totalValue > 0 ? fmtMoney(totalValue) : ""}</Td>
                {anyBack ? <Td right>{fmtNumber(dc.lines.reduce((a, l) => a + l.returned_qty, 0))}</Td> : null}
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
