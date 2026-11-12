import { ReportTable, SectionCard, SheetMasthead, SignOff, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { CompanyLine } from "@/components/documents/document-kit";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { ProcessDc } from "@/lib/stores/process-dc-service";

/**
 * THE KNITTER'S JOB-WORK CHALLAN (doc/process/knitting update.md §5, client 2026-11-12): one A4
 * page the yarn travels on — DC and order refs at the left, the knitter at the right, the
 * program each fabric is knitted to, the yarn with its program / earlier / this-DC quantities
 * and source bin, the declaration and three signatures.
 *
 * Every figure is READ, never typed here: the spec off the knitting order's fabric rows, Program
 * Qty off the yarn row's required kg, Prev Sent off the OTHER dispatched DCs raised before this
 * one on the same order line. The company block is the letterhead every print uses — the spec's
 * sample address and GSTIN are placeholders.
 */

export type KnitChallanFabric = {
  key: string;
  ko: string | null;
  fabric: string;
  finished_dia: string | null;
  knit_dia: string | null;
  width_form: string | null;
  finished_gsm: number | null;
  knit_gsm: number | null;
  gauge: string | null;
  loop_length: number | null;
  ply: string | null;
};

export type KnitChallanLine = {
  id: string;
  item_name: string;
  uom: string | null;
  ko: string | null;
  program_qty: number | null;
  prev_sent: number;
  send_qty: number;
  /** A bin code, or null with `vendor_held` when the yarn is already at the knitter. */
  bin: string | null;
  vendor_held: boolean;
  bags: number | null;
};

const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");
const kg = (n: number | null | undefined) => (n == null ? "—" : fmtNumber(n));

export function KnitJobWorkChallan({
  dc,
  company,
  vendor,
  fabrics,
  lines,
  koNos,
  reNos,
  preparedBy,
}: {
  dc: ProcessDc;
  company: { name: string; unit: string | null; logo: string | null; address: string | null; phone: string | null; email: string | null; gstin: string | null };
  vendor: { name: string | null; address: string | null; gstin: string | null; place: string | null };
  fabrics: readonly KnitChallanFabric[];
  lines: readonly KnitChallanLine[];
  koNos: readonly string[];
  reNos: readonly string[];
  preparedBy: string | null;
}) {
  const manyOrders = koNos.length > 1;
  const sendTotal = lines.reduce((t, l) => t + l.send_qty, 0);
  const programTotal = lines.reduce((t, l) => t + (l.program_qty ?? 0), 0);
  const prevTotal = lines.reduce((t, l) => t + l.prev_sent, 0);
  const bagsTotal = lines.reduce((t, l) => t + (l.bags ?? 0), 0);
  const anyBags = lines.some((l) => l.bags != null);
  const held = lines.filter((l) => l.vendor_held);
  const uoms = [...new Set(lines.map((l) => l.uom).filter(Boolean))];
  const unit = uoms.length === 1 ? uoms[0] : null;
  const transfer = !!dc.knit_transfer_from;

  const left: [string, React.ReactNode][] = [
    ["DC No", dc.code],
    ["DC Date", dc.dc_date ? fmtDate(dc.dc_date) : null],
    [manyOrders ? "Order Refs" : "Order Ref", [koNos.join(", "), reNos.length ? `RE ${reNos.join(", ")}` : ""].filter(Boolean).join(" · ") || null],
  ];
  if (dc.vehicle_no) left.push(["Vehicle No", dc.vehicle_no]);
  const right: [string, React.ReactNode][] = [
    ["Vendor", vendor.name],
    ["Address", vendor.address],
    ["Vendor GST", vendor.gstin],
    ["Place of Delivery", vendor.place],
  ];

  const facts = (rows: [string, React.ReactNode][]) => (
    <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-0.5 px-3 py-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#7b8594]">{k}</dt>
          <dd className="m-0 break-words text-[12px] font-semibold text-[#17202b]">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <article className="po-sheet knit-dc mx-auto max-w-[1100px] space-y-2.5 bg-white pb-6 text-[12px] text-[#17202b]">
      {/* A4, one page for a typical 1–5 line DC: the sheet is held to the page's printable width. */}
      <style>{`@page { size: A4 portrait; margin: 10mm; } @media print { .knit-dc { max-width: none; } .knit-dc .po-keep { break-inside: avoid; } }`}</style>
      <div className="po-keep">
        <SheetMasthead company={{ name: company.name, unit: company.unit, logo: company.logo }} kind="Delivery Challan — Job Work" reNo={dc.code} dense />
        <CompanyLine company={{ address: company.address, phone: company.phone, email: company.email, gstin: company.gstin }} />
        <div className="border border-t-0 border-border bg-white px-4 py-1.5 text-center">
          <div className="text-[15px] font-extrabold uppercase tracking-[.12em]">Delivery Challan – Job Work</div>
          <div className="text-[11px] text-[#4b5563]">
            {transfer ? "(Yarn already held at the knitter, moved between knitting orders — no goods travelled)" : "(Goods sent for job work, not for sale)"}
          </div>
        </div>
        <div className="grid grid-cols-2 border border-t-0 border-border bg-white">
          <div className="border-r border-border">{facts(left)}</div>
          {facts(right)}
        </div>
      </div>

      {fabrics.length ? (
        <SectionCard dense title="Fabric technical specifications">
          <ReportTable bare>
            <thead>
              <tr>
                {manyOrders ? <Th>KO No</Th> : null}
                <Th>Fabric</Th>
                <Th>Finishing Dia</Th>
                <Th>Knitting Dia</Th>
                <Th right>Finishing GSM</Th>
                <Th right>Knitting GSM</Th>
                <Th>Gauge</Th>
                <Th right>Loop Length</Th>
                <Th>Ply</Th>
              </tr>
            </thead>
            <tbody>
              {fabrics.map((f, i) => (
                <tr key={f.key} style={stripeRow(i)} className="po-keep align-top">
                  {manyOrders ? <Td mono>{dash(f.ko)}</Td> : null}
                  <Td>
                    <span className="font-semibold">{dash(f.fabric)}</span>
                    {f.width_form ? <div className="text-[10.5px] text-[#4b5563]">{f.width_form === "open_width" ? "OPEN WIDTH" : f.width_form === "tubular" ? "TUBULAR" : f.width_form.toUpperCase()}</div> : null}
                  </Td>
                  <Td>{dash(f.finished_dia)}</Td>
                  <Td>{dash(f.knit_dia)}</Td>
                  <Td right>{kg(f.finished_gsm)}</Td>
                  <Td right>{kg(f.knit_gsm)}</Td>
                  <Td>{f.gauge ? `${f.gauge}${/gg|gauge/i.test(f.gauge) ? "" : " GG"}` : "—"}</Td>
                  <Td right>{f.loop_length != null ? `${fmtNumber(f.loop_length)} mm` : "—"}</Td>
                  <Td>{dash(f.ply?.toUpperCase())}</Td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </SectionCard>
      ) : null}

      <SectionCard dense title="Yarn sent" total={fmtNumber(sendTotal)} totalLabel={`Send qty${unit ? ` (${unit})` : ""}`}>
        <ReportTable bare>
          <thead>
            <tr>
              <Th right>#</Th>
              <Th>Yarn Description</Th>
              <Th right>Program Qty</Th>
              <Th right>Prev Sent</Th>
              <Th right>Send Qty</Th>
              <Th>Source Bin</Th>
              {anyBags ? <Th right>Bags</Th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} style={stripeRow(i)} className="po-keep align-top">
                <Td right>
                  <span className="text-[#7b8594]">{i + 1}</span>
                </Td>
                <Td>
                  <span className="font-semibold">{l.item_name}</span>
                  {manyOrders && l.ko ? <div className="text-[10.5px] font-semibold text-[#4b5563]">{l.ko}</div> : null}
                </Td>
                <Td right>{kg(l.program_qty)}</Td>
                <Td right>{kg(l.prev_sent)}</Td>
                <Td right>
                  <span className="font-semibold">{fmtNumber(l.send_qty)}</span>
                  {l.vendor_held ? "*" : ""} <span className="text-[10.5px] text-[#7b8594]">{l.uom ?? ""}</span>
                </Td>
                <Td mono>{l.vendor_held ? "Vendor Stk" : dash(l.bin)}</Td>
                {anyBags ? <Td right>{l.bags ?? "—"}</Td> : null}
              </tr>
            ))}
            <tr style={totalRowStyle()} className="font-semibold">
              <Td colSpan={2} right>
                Total
              </Td>
              <Td right>{fmtNumber(programTotal)}</Td>
              <Td right>{fmtNumber(prevTotal)}</Td>
              <Td right>
                {fmtNumber(sendTotal)}
                {unit ? <span className="text-[10.5px] text-[#7b8594]"> {unit}</span> : null}
              </Td>
              <Td>{""}</Td>
              {anyBags ? <Td right>{bagsTotal || "—"}</Td> : null}
            </tr>
          </tbody>
        </ReportTable>
        {held.length ? (
          <div className="border-t border-[#eef1f4] px-3 py-1 text-[11px] text-[#4a5563]">
            *Note: {held.map((l) => l.item_name).join(", ")} allocated from vendor-held stock at {vendor.name ?? "the knitter"}.
          </div>
        ) : null}
      </SectionCard>

      <div className="po-keep space-y-2">
        <div className="rounded-lg border border-border bg-white px-3 py-1.5 text-[11px] text-[#4a5563]">
          <span className="font-bold uppercase tracking-[.06em] text-[#17202b]">Declaration: </span>
          We declare that this Delivery Challan shows the actual quantity and description of goods dispatched for job work processing. The goods
          are to be returned after processing and are not for sale.
        </div>
        <SignOff
          dense
          cells={[
            ["Prepared By", preparedBy],
            ["Store In-Charge", null],
            ["Authorized Signatory", `For ${company.name}`],
          ]}
        />
      </div>
    </article>
  );
}
