import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProductionDc } from "@/lib/stores/production-dc-service";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { SectionCard, SheetLabel, SheetMasthead, SignOff, Td, Th, stripeRow } from "@/components/orders/report-kit";
import { fmtDate, fmtNumber } from "@/lib/format";

/**
 * THE PRODUCTION DC, AS PRINTED (doc/stores/dc-plan.md §3): the challan the goods travel
 * on between units. Same report kit as the PO and Rejection DC prints. The three units
 * share one GSTIN, so the footer states a stock transfer, not a sale.
 */
export default async function ProductionDcPrintPage({ params }: { params: Promise<{ dcId: string }> }) {
  await requirePermission("stores", "view");
  const { dcId } = await params;
  const dc = await getProductionDc(dcId);
  if (!dc) notFound();

  const s = await createClient();
  const [{ data: co }, { data: units }] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    s.from("locations").select("id, gst_number").in("id", [dc.location_id, dc.to_location_id]),
  ]);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const gstOf = (id: string) => ((units ?? []) as { id: string; gst_number: string | null }[]).find((u) => u.id === id)?.gst_number ?? cs("gstin");
  const total = dc.lines.reduce((a, l) => a + l.sent_qty, 0);
  const received = dc.status === "received";

  return (
    <div>
      <PoPrintToolbar backHref="/stores/production-dc" backLabel="Production DC" printable={dc.status !== "draft"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="mb-4">
          <SheetMasthead
            company={{ name: cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS", unit: dc.from_unit, logo: letterheadLogoOf(c) }}
            kind="Delivery Challan — Stock Transfer"
            reNo={dc.code}
            meta={<span className="tabular-nums">{fmtDate(dc.dc_date)}</span>}
          />
          <p className="border-x border-b border-border bg-white px-4 py-1.5 text-[11px] text-[#5b6472]">
            {registeredAddressOf(c)}
            {gstOf(dc.location_id) ? ` · GSTIN ${gstOf(dc.location_id)}` : ""}
          </p>
        </div>

        <div className="po-keep mb-5 grid grid-cols-2 gap-4">
          <div className="rounded-md border border-border px-3 py-2">
            <SheetLabel>Sent to</SheetLabel>
            <div className="text-[14px] font-bold">{dc.to_unit}</div>
            {gstOf(dc.to_location_id) ? <div className="mt-1 font-mono text-[11px]">GSTIN {gstOf(dc.to_location_id)}</div> : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-border px-3 py-2">
            {[
              ["DC Date", fmtDate(dc.dc_date)],
              ["From Unit", dc.from_unit],
              ["Vehicle No", dc.vehicle_no ?? "—"],
              ["Transporter", dc.transporter ?? "—"],
              ["E-way Bill No", dc.eway_bill_no ?? "—"],
              ["Status", dc.status === "draft" ? "DRAFT — not dispatched" : received ? "Received" : "In transit"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10.5px] text-[#7b8594] uppercase">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <SectionCard title="Goods sent" total={fmtNumber(total)} totalLabel="Total qty">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>#</Th>
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
                    <Td mono>{i + 1}</Td>
                    <Td>{l.item_name}</Td>
                    <Td>{l.from_store ?? "—"}</Td>
                    <Td>{l.lot_no ?? "—"}</Td>
                    <Td right>
                      {fmtNumber(l.sent_qty)} <span className="text-[10.5px] text-[#7b8594]">{l.uom ?? ""}</span>
                    </Td>
                    {received ? <Td right>{fmtNumber(l.received_qty)}</Td> : null}
                    {received ? <Td>{l.shortage_qty > 0 ? `${fmtNumber(l.shortage_qty)} — ${l.shortage_reason ?? ""}` : "—"}</Td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="po-keep">
          <p className="mt-4 text-[11px] font-semibold text-[#17202b]">
            Stock transfer between units of the same company — not a sale.
          </p>
          <SignOff />
          <p className="mt-6 text-[11px] text-[#5b6472]">Received the above goods — receiving unit&apos;s signature &amp; seal</p>
          <div className="mt-10 w-64 border-t border-[#17202b]" />
        </div>
      </article>
    </div>
  );
}
