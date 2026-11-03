import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import {
  canSeeStockValue,
  getStockTransfer,
  getTransferOrderOptions,
  ownerLabel,
} from "@/lib/stores/stock-transfer-service";
import { loadTransferReqLines } from "@/lib/stores/stock-transfer-actions";
import { TRANSFER_TYPE_LABELS } from "@/lib/stores/stock-transfer-types";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { OrderFacts, ReportTable, SectionCard, SheetMasthead, SignOff, Td, Th, stripeRow, totalRowStyle } from "@/components/orders/report-kit";
import { CompanyLine, DocumentFoot, presentFacts } from "@/components/documents/document-kit";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { withCreators } from "@/lib/created-by";

/**
 * THE STOCK TRANSFER SLIP (0803) — the Production DC print's shape (masthead → company line →
 * facts → items with a Total row → remarks → sign-off). Bags and cones are printed here and
 * nowhere else (user 2026-11-03). Rate and Value only for a holder of the Stock Statement with
 * Value grant, the same rule as the screen.
 */
export default async function StockTransferPrintPage({ params }: { params: Promise<{ transferId: string }> }) {
  await requirePermission("stores", "view");
  const { transferId } = await params;
  const found = await getStockTransfer(transferId);
  if (!found) notFound();
  const { doc, lines } = found;

  const s = await createClient();
  const [{ data: co }, { data: storeRows }, orders, money, preparedBy, reqLines] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    s.from("stores").select("id, name, locations(name, gst_number)").in("id", [doc.from_store_id, doc.to_store_id]),
    getTransferOrderOptions(),
    canSeeStockValue(),
    withCreators([doc]).then((r) => (r[0] as { created_by_name?: string | null }).created_by_name ?? null),
    loadTransferReqLines(doc.to_garment_order_id ?? doc.to_iwo_id),
  ]);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  type StoreRow = { id: string; name: string; locations: { name: string | null; gst_number: string | null } | null };
  const storeOf = (id: string) => ((storeRows ?? []) as unknown as StoreRow[]).find((x) => x.id === id);
  const from = storeOf(doc.from_store_id);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const reqByKey = new Map((reqLines.ok ? reqLines.lines : []).map((r) => [r.req_key, r.label]));
  const companyName = cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS";
  const total = lines.reduce((a, l) => a + l.quantity, 0);
  const totalValue = lines.reduce((a, l) => a + (l.rate == null ? 0 : l.quantity * l.rate), 0);
  const showMoney = money && lines.some((l) => l.rate != null);

  const facts = presentFacts([
    { label: "Type", value: TRANSFER_TYPE_LABELS[doc.transfer_type] },
    { label: "From", value: ownerLabel(doc.from_garment_order_id, doc.from_iwo_id, byId), sub: from?.name },
    { label: "To", value: ownerLabel(doc.to_garment_order_id, doc.to_iwo_id, byId), sub: storeOf(doc.to_store_id)?.name },
    { label: "Transfer Date", value: fmtDate(doc.transfer_date), mono: true },
    { label: "Status", value: doc.status === "draft" ? "DRAFT — not posted" : doc.status === "cancelled" ? "Cancelled" : "Posted" },
  ]);

  return (
    <div>
      <PoPrintToolbar backHref={`/purchase/transfers/${doc.id}`} backLabel={doc.code ?? "Stock Transfer"} printable={doc.status === "posted"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep">
          <SheetMasthead
            company={{ name: companyName, unit: from?.locations?.name ?? null, logo: letterheadLogoOf(c) }}
            kind="Stock Transfer"
            reNo={doc.code}
            meta={<span className="tabular-nums">{fmtDate(doc.transfer_date)}</span>}
            dense
          />
          <CompanyLine
            company={{
              address: registeredAddressOf(c),
              phone: cs("phone") ?? cs("mobile"),
              email: cs("email"),
              gstin: from?.locations?.gst_number ?? cs("gstin"),
            }}
          />
          <OrderFacts facts={facts} dense />
        </div>

        <SectionCard dense title="Stock moved" total={fmtNumber(total)} totalLabel="Total qty" note="Moved inside one unit — lot, GRN, inward date and rate are unchanged.">
          <ReportTable bare>
            <thead>
              <tr>
                <Th right>#</Th>
                <Th>Item</Th>
                <Th>Lot No</Th>
                <Th>From Bin</Th>
                <Th>To Bin</Th>
                <Th>Against</Th>
                <Th right>Bags</Th>
                <Th right>Cones / Rolls</Th>
                <Th right>Qty</Th>
                {showMoney ? <Th right>Rate</Th> : null}
                {showMoney ? <Th right>Value</Th> : null}
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
                  </Td>
                  <Td>{l.lot_no ?? ""}</Td>
                  <Td>{l.from_bin_code ?? ""}</Td>
                  <Td>{l.to_bin_code ?? l.from_bin_code ?? ""}</Td>
                  <Td>{l.req_key ? (reqByKey.get(l.req_key) ?? "") : ""}</Td>
                  <Td right>{l.bags ?? ""}</Td>
                  <Td right>{l.cones ?? ""}</Td>
                  <Td right>{fmtNumber(l.quantity)}</Td>
                  {showMoney ? <Td right>{l.rate == null ? "" : fmtMoney(l.rate)}</Td> : null}
                  {showMoney ? <Td right>{l.rate == null ? "" : fmtMoney(l.quantity * l.rate)}</Td> : null}
                </tr>
              ))}
              <tr style={totalRowStyle()} className="font-semibold">
                <Td colSpan={8} right>
                  Total
                </Td>
                <Td right>{fmtNumber(total)}</Td>
                {showMoney ? <Td right>{""}</Td> : null}
                {showMoney ? <Td right>{fmtMoney(totalValue)}</Td> : null}
              </tr>
            </tbody>
          </ReportTable>
        </SectionCard>

        <DocumentFoot remarks={doc.remarks} />

        <div className="po-keep">
          <SignOff
            dense
            cells={[
              ["Prepared By", preparedBy],
              ["Checked By", null],
              ["Store In-charge", null],
              ["Authorised Signatory", `For ${companyName}`],
            ]}
          />
        </div>
      </article>
    </div>
  );
}
