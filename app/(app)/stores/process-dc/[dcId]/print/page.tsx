import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getProcessDc } from "@/lib/stores/process-dc-service";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { SectionCard, SheetLabel, SheetMasthead, SignOff, Td, Th, stripeRow } from "@/components/orders/report-kit";
import { fmtDate, fmtNumber } from "@/lib/format";

/**
 * THE PROCESS DC, AS PRINTED (doc/stores/dc-plan.md §3): the job-work challan the goods
 * travel on to the processor — vendor with address and GSTIN, the Process Order and RE it
 * is against, expected return, transport, the lines with HSN and lot, and the job-work
 * declaration. Same report kit as the PO, Rejection DC and Production DC prints.
 */
export default async function ProcessDcPrintPage({ params }: { params: Promise<{ dcId: string }> }) {
  await requirePermission("stores", "view");
  const { dcId } = await params;
  const dc = await getProcessDc(dcId);
  if (!dc) notFound();

  const s = await createClient();
  const [{ data: co }, { data: unit }, { data: vendor }, { data: addr }] = await Promise.all([
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

  return (
    <div>
      <PoPrintToolbar backHref="/stores/process-dc" backLabel="Process DC" printable={dc.status !== "draft"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="mb-4">
          <SheetMasthead
            company={{ name: cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS", unit: u?.name ?? null, logo: letterheadLogoOf(c) }}
            kind="Delivery Challan — Job Work"
            reNo={dc.code}
            meta={<span className="tabular-nums">{fmtDate(dc.dc_date)}</span>}
          />
          <p className="border-x border-b border-border bg-white px-4 py-1.5 text-[11px] text-[#5b6472]">
            {registeredAddressOf(c)}
            {u?.gst_number ?? cs("gstin") ? ` · GSTIN ${u?.gst_number ?? cs("gstin")}` : ""}
          </p>
        </div>

        <div className="po-keep mb-5 grid grid-cols-2 gap-4">
          <div className="rounded-md border border-border px-3 py-2">
            <SheetLabel>Sent to (processor)</SheetLabel>
            <div className="text-[14px] font-bold">{v?.name ?? dc.vendor_name}</div>
            {vendorAddress ? <div className="mt-0.5 text-[11.5px] text-[#5b6472]">{vendorAddress}</div> : null}
            {v?.gst_no ? <div className="mt-1 font-mono text-[11px]">GSTIN {v.gst_no}</div> : null}
            <div className="mt-1 text-[11.5px] font-semibold">Process: {(dc.process_type ?? "").toUpperCase()}</div>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-border px-3 py-2">
            {[
              ["Process Order", dc.process_order_code ?? "—"],
              ["RE No", dc.order_no ?? "—"],
              ["Expected Return", fmtDate(dc.expected_return_date)],
              ["Vehicle No", dc.vehicle_no ?? "—"],
              ["Transporter", dc.transporter ?? "—"],
              ["E-way Bill No", dc.eway_bill_no ?? "—"],
            ].map(([k, val]) => (
              <div key={k}>
                <dt className="text-[10.5px] text-[#7b8594] uppercase">{k}</dt>
                <dd className="font-semibold tabular-nums">{val}</dd>
              </div>
            ))}
          </dl>
        </div>

        <SectionCard title="Goods sent for job work" total={fmtNumber(total)} totalLabel="Total qty">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Item</Th>
                  <Th>HSN</Th>
                  <Th>Lot No</Th>
                  <Th right>Qty</Th>
                </tr>
              </thead>
              <tbody>
                {dc.lines.map((l, i) => (
                  <tr key={l.id} style={stripeRow(i)} className="po-keep align-top">
                    <Td mono>{i + 1}</Td>
                    <Td>{l.item_name}</Td>
                    <Td mono>{l.hsn ?? "—"}</Td>
                    <Td>{l.lot_no ?? "—"}</Td>
                    <Td right>
                      {fmtNumber(l.sent_qty)} <span className="text-[10.5px] text-[#7b8594]">{l.uom ?? ""}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="po-keep">
          <p className="mt-4 text-[11px] font-semibold text-[#17202b]">
            Goods sent for job work and to be returned after processing — not for sale.
          </p>
          <SignOff />
          <p className="mt-6 text-[11px] text-[#5b6472]">Received the above goods — processor&apos;s signature &amp; seal</p>
          <div className="mt-10 w-64 border-t border-[#17202b]" />
        </div>
      </article>
    </div>
  );
}
