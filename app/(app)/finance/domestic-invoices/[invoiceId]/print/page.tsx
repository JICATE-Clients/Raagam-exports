import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getDomesticInvoice } from "@/lib/finance/domestic-invoices/service";
import { DGI_STATUS_LABELS, invoiceTotal } from "@/lib/finance/domestic-invoices/types";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { amountInWords } from "@/lib/purchase/amount-words";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import { OrderFacts, SheetMasthead, SignOff } from "@/components/orders/report-kit";
import { AmountCard, CompanyLine, DocumentFoot, presentFacts } from "@/components/documents/document-kit";
import { fmtDate } from "@/lib/format";

/**
 * THE DOMESTIC INVOICE, AS PRINTED — the outside-party document shape (user 2026-10-31,
 * the compact vendor PO print, Phase 2): masthead → company line → facts (blank ones left
 * off) → foot (value in words · remarks left, the money right) → one-row sign-off.
 * The invoice carries no line items, so there is no items card.
 *
 * Issued / Paid get the masthead's pill; a Draft or Cancelled invoice SAYS so beside the
 * date, in red for Cancelled, so a copy printed off it cannot pass for a live invoice.
 */
export default async function DomesticInvoicePrintPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  await requirePermission("finance", "view");
  const { invoiceId } = await params;
  const inv = await getDomesticInvoice(invoiceId);
  if (!inv) notFound();

  const s = await createClient();
  const { data: co } = await s.from("company_profile").select("*").limit(1).maybeSingle();
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const companyName = cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS";

  const total = invoiceTotal(inv);
  const live = inv.status === "issued" || inv.status === "paid";
  const statusLabel = DGI_STATUS_LABELS[inv.status];

  const facts = presentFacts([
    { label: "Buyer", value: inv.buyers?.name ?? null },
    { label: "Invoice No", value: inv.code, mono: true },
    { label: "Invoice Date", value: inv.invoice_date ? fmtDate(inv.invoice_date) : null, mono: true },
    { label: "Status", value: statusLabel },
  ]);

  return (
    <div>
      <PoPrintToolbar backHref="/finance/domestic-invoices" backLabel="Domestic Invoices" />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        <div className="po-keep">
          <SheetMasthead
            company={{ name: companyName, logo: letterheadLogoOf(c) }}
            kind="Domestic Invoice"
            reNo={inv.code}
            meta={
              <span className="tabular-nums">
                {inv.invoice_date ? fmtDate(inv.invoice_date) : null}
                {live ? null : (
                  <span className={`ml-2 font-semibold uppercase ${inv.status === "cancelled" ? "text-[#b42318]" : "text-[#7b8594]"}`}>
                    {statusLabel}
                  </span>
                )}
              </span>
            }
            status={live ? statusLabel : null}
            dense
          />
          <CompanyLine
            company={{
              address: registeredAddressOf(c),
              phone: cs("phone") ?? cs("mobile"),
              email: cs("email"),
              gstin: cs("gstin"),
            }}
          />
          <OrderFacts facts={facts} dense />
        </div>

        <DocumentFoot
          words={amountInWords(total, "INR")}
          remarks={inv.remarks}
          amount={
            <AmountCard
              sym="₹"
              rows={[
                { label: "Taxable Value", value: inv.taxable_amount || 0 },
                { label: "GST", value: inv.gst_amount || 0 },
              ]}
              net={total}
              netLabel="Invoice Value"
            />
          }
        />

        <div className="po-keep">
          <SignOff
            dense
            cells={[
              ["Prepared By", inv.created_by_name ?? null],
              ["Checked By", null],
              ["Authorised Signatory", `For ${companyName}`],
            ]}
          />
        </div>
      </article>
    </div>
  );
}
