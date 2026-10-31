import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProcessDc } from "@/lib/stores/process-dc-service";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { OrderFacts, ReportTable, SectionCard, SheetMasthead, SignOff, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { CompanyLine, presentFacts } from "@/components/documents/document-kit";
import { fmtDate, fmtNumber } from "@/lib/format";
import { withCreators } from "@/lib/created-by";

/**
 * THE PROCESS DC, AS PRINTED (doc/stores/dc-plan.md §3): the job-work challan the goods
 * travel on to the processor — vendor with address and GSTIN, the Process Order and RE it
 * is against, expected return, transport, the lines with HSN and lot, and the job-work
 * declaration.
 *
 * THE OUTSIDE-PARTY DOCUMENT SHAPE (user 2026-10-31, the compact vendor PO print):
 * masthead → company line → facts (blank ones left off) → items with a Total row →
 * one-row sign-off. A DC carries no money, so there is no Amount card.
 */
export default async function ProcessDcPrintPage({ params }: { params: Promise<{ dcId: string }> }) {
  await requirePermission("stores", "view");
  const { dcId } = await params;
  const dc = await getProcessDc(dcId);
  if (!dc) notFound();

  const s = await createClient();
  // Prepared By's name (created-by.ts `creator_names`), alongside the letterhead reads.
  const [{ data: co }, { data: unit }, { data: vendor }, { data: addr }, preparedBy] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    s.from("locations").select("name, gst_number").eq("id", dc.location_id).maybeSingle(),
    dc.vendor_id ? s.from("master_vendors").select("name, gst_no").eq("id", dc.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
    dc.vendor_id
      ? s
          .from("master_vendor_addresses")
          .select("street, pin, config_lookups!city_id(name), states!state_id(name)")
          .eq("vendor_id", dc.vendor_id)
          .order("sno")
          .limit(1)
      : Promise.resolve({ data: [] }),
    withCreators([dc]).then((r) => (r[0] as { created_by_name?: string | null }).created_by_name ?? null),
  ]);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const u = (unit ?? null) as { name: string | null; gst_number: string | null } | null;
  const v = (vendor ?? null) as { name: string | null; gst_no: string | null } | null;
  const a = ((addr ?? []) as unknown as {
    street: string | null;
    pin: string | null;
    config_lookups: { name: string | null } | null;
    states: { name: string | null } | null;
  }[])[0];
  const vendorAddress = a
    ? [a.street, a.config_lookups?.name, a.states?.name, a.pin].filter((x) => !!x && String(x).trim()).join(", ")
    : null;
  const total = dc.lines.reduce((t, l) => t + l.sent_qty, 0);
  const uoms = [...new Set(dc.lines.map((l) => l.uom).filter(Boolean))];
  const companyName = cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS";

  const facts = presentFacts([
    {
      label: "Sent to (processor)",
      value: v?.name ?? dc.vendor_name,
      sub: [vendorAddress, v?.gst_no ? `GSTIN ${v.gst_no}` : null].filter(Boolean).join(" · ") || undefined,
    },
    { label: "Process", value: (dc.process_type ?? "").toUpperCase() },
    { label: "DC Date", value: dc.dc_date ? fmtDate(dc.dc_date) : null, mono: true },
    { label: "Process Order", value: dc.process_order_code, mono: true },
    { label: "RE No", value: dc.order_no, mono: true },
    { label: "Expected Return", value: dc.expected_return_date ? fmtDate(dc.expected_return_date) : null, mono: true },
    { label: "Vehicle No", value: dc.vehicle_no, mono: true },
    { label: "Transporter", value: dc.transporter },
    { label: "E-way Bill No", value: dc.eway_bill_no, mono: true },
  ]);

  return (
    <div>
      <PoPrintToolbar backHref="/stores/process-dc" backLabel="Process DC" printable={dc.status !== "draft"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep">
          <SheetMasthead
            company={{ name: companyName, unit: u?.name ?? null, logo: letterheadLogoOf(c) }}
            kind="Delivery Challan — Job Work"
            reNo={dc.code}
            meta={<span className="tabular-nums">{fmtDate(dc.dc_date)}</span>}
            dense
          />
          <CompanyLine
            company={{
              address: registeredAddressOf(c),
              phone: cs("phone") ?? cs("mobile"),
              email: cs("email"),
              gstin: u?.gst_number ?? cs("gstin"),
            }}
          />
          <OrderFacts facts={facts} dense />
        </div>

        <SectionCard
          dense
          title="Goods sent for job work"
          total={fmtNumber(total)}
          totalLabel="Total qty"
          note="Goods sent for job work and to be returned after processing — not for sale."
        >
          <ReportTable bare>
            <thead>
              <tr>
                <Th right>#</Th>
                <Th>Item</Th>
                <Th>HSN</Th>
                <Th>Lot No</Th>
                <Th right>Qty</Th>
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
                  <Td mono>{l.hsn ?? ""}</Td>
                  <Td>{l.lot_no ?? ""}</Td>
                  <Td right>
                    {fmtNumber(l.sent_qty)} <span className="text-[10.5px] text-[#7b8594]">{l.uom ?? ""}</span>
                  </Td>
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
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>

        <div className="po-keep">
          <SignOff
            dense
            cells={[
              ["Prepared By", preparedBy],
              ["Checked By", null],
              ["Received By", "Name · Mobile No · Sign"],
              ["Authorised Signatory", `For ${companyName}`],
            ]}
          />
        </div>
      </article>
    </div>
  );
}
