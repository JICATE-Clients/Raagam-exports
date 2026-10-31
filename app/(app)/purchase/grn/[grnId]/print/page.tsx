import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getGrn, getGrnLines } from "@/lib/purchase/grn-service";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { SectionCard, SheetLabel, SheetMasthead, SignOff, Td, Th, stripeRow } from "@/components/orders/report-kit";
import { fmtDate, fmtNumber } from "@/lib/format";

/**
 * THE GRN SLIP (user 2026-10-31, multi-bin rule §5): the receipt the store keeps and checks
 * the shelves against. Per line: what arrived, QC, what was accepted and rejected, the store,
 * and — the point of the slip — the BIN BREAKDOWN printed under the line when the accepted
 * qty was split across bins (0782), so the stock can be found and audited bin by bin.
 * A draft prints too, marked DRAFT: the keeper puts goods away before the GRN is posted.
 */
export default async function GrnSlipPage({ params }: { params: Promise<{ grnId: string }> }) {
  await requirePermission("materials_purchase", "view");
  const { grnId } = await params;
  const [grn, lines] = await Promise.all([getGrn(grnId), getGrnLines(grnId)]);
  if (!grn) notFound();

  const s = await createClient();
  const [{ data: co }, { data: unit }] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    grn.location_id ? s.from("locations").select("name, gst_number").eq("id", grn.location_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const u = (unit ?? null) as { name: string | null; gst_number: string | null } | null;
  const g = grn as typeof grn & { invoice_no?: string | null; invoice_date?: string | null; dc_no?: string | null; kind?: string | null };
  const draft = grn.status === "draft";
  const totals = lines.reduce(
    (a, l) => ({ recd: a.recd + (Number(l.received_qty) || 0), acc: a.acc + (Number(l.accepted_qty) || 0), rej: a.rej + (Number(l.rejected_qty) || 0) }),
    { recd: 0, acc: 0, rej: 0 },
  );

  return (
    <div>
      <PoPrintToolbar backHref={`/purchase/grn/${grnId}`} backLabel={grn.code ?? "GRN"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="mb-4">
          <SheetMasthead
            company={{ name: cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS", unit: u?.name ?? null, logo: letterheadLogoOf(c) }}
            kind={g.kind === "replacement" ? "Replacement GRN" : "Goods Receipt Note"}
            reNo={grn.code}
            meta={<span className="tabular-nums">{fmtDate(grn.grn_date)}{draft ? " · DRAFT" : ""}</span>}
          />
          <p className="border-x border-b border-border bg-white px-4 py-1.5 text-[11px] text-[#5b6472]">
            {registeredAddressOf(c)}
            {u?.gst_number ?? cs("gstin") ? ` · GSTIN ${u?.gst_number ?? cs("gstin")}` : ""}
          </p>
        </div>

        <div className="po-keep mb-5 grid grid-cols-2 gap-4">
          <div className="rounded-md border border-border px-3 py-2">
            <SheetLabel>Received from</SheetLabel>
            <div className="text-[14px] font-bold">{grn.vendors?.name ?? "—"}</div>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-border px-3 py-2">
            {[
              ["GRN Date", fmtDate(grn.grn_date)],
              ["PO No", [...new Set(lines.map((l) => l.po_code).filter(Boolean))].join(", ") || "—"],
              [g.invoice_no ? "Invoice No" : "DC No", g.invoice_no ?? g.dc_no ?? "—"],
              [g.invoice_no ? "Invoice Date" : "DC Date", fmtDate(g.invoice_date ?? null)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10.5px] text-[#7b8594] uppercase">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <SectionCard title="Goods received" total={fmtNumber(totals.acc)} totalLabel="Accepted">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Item</Th>
                  <Th>Lot No</Th>
                  <Th right>Received</Th>
                  <Th>QC</Th>
                  <Th right>Accepted</Th>
                  <Th right>Rejected</Th>
                  <Th>Store</Th>
                  <Th>Bin</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id} style={stripeRow(i)} className="po-keep align-top">
                    <Td mono>{i + 1}</Td>
                    <Td>{l.description}</Td>
                    <Td>{l.roll_batch_no ?? "—"}</Td>
                    <Td right>{fmtNumber(Number(l.received_qty) || 0)}</Td>
                    <Td>{String(l.qc_status ?? "").toUpperCase() || "—"}</Td>
                    <Td right>
                      <span className="font-semibold">{fmtNumber(Number(l.accepted_qty) || 0)}</span>
                    </Td>
                    <Td right>
                      {(Number(l.rejected_qty) || 0) > 0 ? (
                        <>
                          {fmtNumber(Number(l.rejected_qty))}
                          <div className="text-[10.5px] text-[#7b8594]">to Rejection store</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{l.store_name ?? "—"}</Td>
                    <Td>
                      {/* THE BIN BREAKDOWN — one line per bin, under the line it belongs to. */}
                      {l.bin_split.length > 0 ? (
                        <ul className="space-y-0.5">
                          {l.bin_split.map((b, j) => (
                            <li key={j} className="flex justify-between gap-3 tabular-nums">
                              <span className="font-mono">{b.code}</span>
                              <span>{fmtNumber(b.qty)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="font-mono">{l.bin_code ?? "—"}</span>
                      )}
                    </Td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <Td> </Td>
                  <Td>Total</Td>
                  <Td> </Td>
                  <Td right>{fmtNumber(totals.recd)}</Td>
                  <Td> </Td>
                  <Td right>{fmtNumber(totals.acc)}</Td>
                  <Td right>{totals.rej > 0 ? fmtNumber(totals.rej) : "—"}</Td>
                  <Td> </Td>
                  <Td> </Td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="po-keep">
          <SignOff />
          <p className="mt-6 text-[11px] text-[#5b6472]">Put away as above — store keeper&apos;s signature</p>
          <div className="mt-10 w-64 border-t border-[#17202b]" />
        </div>
      </article>
    </div>
  );
}
