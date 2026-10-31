import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getGrn, getGrnLines } from "@/lib/purchase/grn-service";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { OrderFacts, ReportTable, SectionCard, SheetMasthead, SignOff, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { CompanyLine, DocumentFoot, presentFacts } from "@/components/documents/document-kit";
import { fmtDate, fmtNumber } from "@/lib/format";
import { withCreators } from "@/lib/created-by";

/**
 * THE GRN SLIP (user 2026-10-31, multi-bin rule §5): the receipt the store keeps and checks
 * the shelves against. Per line: what arrived, QC, what was accepted and rejected, the store,
 * and — the point of the slip — the BIN BREAKDOWN printed under the line when the accepted
 * qty was split across bins (0782), so the stock can be found and audited bin by bin.
 * A draft prints too, marked DRAFT: the keeper puts goods away before the GRN is posted.
 *
 * THE OUTSIDE-PARTY DOCUMENT SHAPE (user 2026-10-31, the compact vendor PO print):
 * masthead → company line → facts (blank ones left off) → items with a Total row →
 * remarks → one-row sign-off. A GRN carries no money, so there is no Amount card.
 */
export default async function GrnSlipPage({ params }: { params: Promise<{ grnId: string }> }) {
  await requirePermission("materials_purchase", "view");
  const { grnId } = await params;
  const [grn, lines] = await Promise.all([getGrn(grnId), getGrnLines(grnId)]);
  if (!grn) notFound();

  const s = await createClient();
  // Received By's name (created-by.ts `creator_names`), alongside the letterhead reads.
  const [{ data: co }, { data: unit }, receivedBy] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    grn.location_id ? s.from("locations").select("name, gst_number").eq("id", grn.location_id).maybeSingle() : Promise.resolve({ data: null }),
    withCreators([grn]).then((r) => (r[0] as { created_by_name?: string | null }).created_by_name ?? null),
  ]);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const u = (unit ?? null) as { name: string | null; gst_number: string | null } | null;
  const draft = grn.status === "draft";
  const companyName = cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS";
  const totals = lines.reduce(
    (a, l) => ({ recd: a.recd + (Number(l.received_qty) || 0), acc: a.acc + (Number(l.accepted_qty) || 0), rej: a.rej + (Number(l.rejected_qty) || 0) }),
    { recd: 0, acc: 0, rej: 0 },
  );

  const facts = presentFacts([
    { label: "Received from", value: grn.vendors?.name ?? null },
    { label: "GRN Date", value: grn.grn_date ? fmtDate(grn.grn_date) : null, mono: true },
    { label: "PO No", value: [...new Set(lines.map((l) => l.po_code).filter(Boolean))].join(", "), mono: true },
    { label: "Invoice No", value: grn.invoice_no, mono: true },
    { label: "Invoice Date", value: grn.invoice_date ? fmtDate(grn.invoice_date) : null, mono: true },
    { label: "DC No", value: grn.dc_no, mono: true },
  ]);

  return (
    <div>
      <PoPrintToolbar backHref={`/purchase/grn/${grnId}`} backLabel={grn.code ?? "GRN"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep">
          <SheetMasthead
            company={{ name: companyName, unit: u?.name ?? null, logo: letterheadLogoOf(c) }}
            kind={grn.kind === "replacement" ? "Replacement GRN" : "Goods Receipt Note"}
            reNo={grn.code}
            meta={
              <span className="tabular-nums">
                {fmtDate(grn.grn_date)}
                {draft ? " · DRAFT" : ""}
              </span>
            }
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

        <SectionCard dense title="Goods received" total={fmtNumber(totals.acc)} totalLabel="Accepted">
          <ReportTable bare>
            <thead>
              <tr>
                <Th right>#</Th>
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
              {lines.map((l, i) => {
                const rej = Number(l.rejected_qty) || 0;
                return (
                  <tr key={l.id} style={stripeRow(i)} className="po-keep align-top">
                    <Td right>
                      <span className="text-[#7b8594]">{i + 1}</span>
                    </Td>
                    <Td>
                      <span className="font-semibold">{l.description}</span>
                    </Td>
                    <Td>{l.roll_batch_no ?? ""}</Td>
                    <Td right>{fmtNumber(Number(l.received_qty) || 0)}</Td>
                    <Td>{String(l.qc_status ?? "").toUpperCase()}</Td>
                    <Td right>
                      <span className="font-semibold">{fmtNumber(Number(l.accepted_qty) || 0)}</span>
                    </Td>
                    <Td right>
                      {rej > 0 ? (
                        <>
                          {fmtNumber(rej)}
                          <div className="text-[10.5px] text-[#7b8594]">to Rejection store</div>
                        </>
                      ) : null}
                    </Td>
                    <Td>{l.store_name ?? ""}</Td>
                    <Td>
                      {/* THE BIN BREAKDOWN — one line per bin, under the line it belongs to. */}
                      {l.bin_split.length > 0 ? (
                        <ul className="space-y-px">
                          {l.bin_split.map((b, j) => (
                            <li key={j} className="flex justify-between gap-3 tabular-nums">
                              <span className="font-mono">{b.code}</span>
                              <span>{fmtNumber(b.qty)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="font-mono">{l.bin_code ?? ""}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
              <tr style={totalRowStyle()} className="font-semibold">
                <Td colSpan={3} right>
                  Total
                </Td>
                <Td right>{fmtNumber(totals.recd)}</Td>
                <Td> </Td>
                <Td right>{fmtNumber(totals.acc)}</Td>
                <Td right>{totals.rej > 0 ? fmtNumber(totals.rej) : ""}</Td>
                <Td colSpan={2}> </Td>
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>

        <DocumentFoot remarks={grn.notes} />

        <div className="po-keep">
          <SignOff
            dense
            cells={[
              ["Received By", receivedBy],
              ["QC By", null],
              ["Store Keeper", "Put away as above"],
              ["Authorised Signatory", `For ${companyName}`],
            ]}
          />
        </div>
      </article>
    </div>
  );
}
