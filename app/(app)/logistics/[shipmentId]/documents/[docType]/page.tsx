import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getDocument } from "@/lib/logistics/service";
import { fmtDate, fmtFixed, fmtNumber } from "@/lib/format";
import { amountInWords } from "@/lib/purchase/amount-words";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { DocumentPrintStyles } from "@/components/orders/document-print-styles";
import {
  OrderFacts,
  ReportTable,
  SectionCard,
  SheetMasthead,
  SignOff,
  Td,
  Th,
  stripeRow,
  totalRowStyle,
  type SheetFact,
} from "@/components/orders/report-kit";
import { AmountCard, CompanyLine, DocumentFoot, money, presentFacts } from "@/components/documents/document-kit";
import { PoPrintToolbar } from "@/components/purchase/po-print-toolbar";
import { DOC_TYPE_LABELS, DOC_TYPES, type DocType } from "@/lib/logistics/types";

/**
 * A SHIPMENT'S EXPORT DOCUMENT, AS PRINTED — Commercial Invoice, Packing List and the
 * generic ones (BL, GST Invoice, DGFT). The compact outside-party layout the vendor PO
 * was given on 2026-10-31 (`components/purchase/po-print-sheet.tsx`), built from the same
 * parts (`components/documents/document-kit.tsx`):
 *
 *   SheetMasthead dense → CompanyLine → OrderFacts dense (only the filled facts)
 *   → the lines in a SectionCard, Total row in tone → DocumentFoot → SignOff, one row
 *
 * `DocumentPrintStyles` is what lets this page print at all: globals.css hides everything
 * but `.report-print-area` on paper, and this page predated both (see that file's header).
 * Layout only — every figure and field printed before is still printed.
 */

// ---------- snapshot shape (mirrors what _generateDoc stores) ----------

type LineSnapshot = {
  id: string;
  description: string;
  hsn_code: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  cartons: number | null;
  net_weight: number | null;
  gross_weight: number | null;
};

type ShipmentSnapshot = {
  id: string;
  code: string | null;
  consignee_name: string | null;
  consignee_address: string | null;
  port_of_loading: string | null;
  destination_port: string | null;
  destination_country: string | null;
  vessel: string | null;
  voyage_no: string | null;
  incoterm: string | null;
  currency_code: string | null;
  etd: string | null;
  eta: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  total_value: number;
};

type BuyerSnapshot = {
  id: string;
  name: string | null;
  code: string | null;
  address: string | null;
} | null;

type DocSnapshot = {
  shipment: ShipmentSnapshot;
  lines: LineSnapshot[];
  buyer: BuyerSnapshot;
  generated_at: string;
};

function extractSnapshot(data: Record<string, unknown>): DocSnapshot {
  return {
    shipment: (data.shipment ?? {}) as ShipmentSnapshot,
    lines: (data.lines ?? []) as LineSnapshot[],
    buyer: (data.buyer ?? null) as BuyerSnapshot,
    generated_at: (data.generated_at ?? "") as string,
  };
}

type Company = {
  name: string;
  logo: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
};

type SheetProps = { snap: DocSnapshot; docNo: string | null; company: Company };

/** "₹" for INR, else the currency code — the PO print's rule. */
function symOf(code: string | null): string {
  return !code || code === "INR" ? "₹" : code;
}

// ---------- Shared head: masthead, company line, facts ----------

function DocHead({ kind, snap, docNo, company }: SheetProps & { kind: string }) {
  const { shipment, buyer } = snap;
  const facts: SheetFact[] = presentFacts([
    { label: "Exporter", value: company.name },
    { label: "Consignee", value: shipment.consignee_name, sub: shipment.consignee_address || undefined },
    { label: "Buyer", value: buyer?.name },
    { label: "Invoice No", value: shipment.invoice_no ?? docNo, mono: true },
    { label: "Invoice Date", value: shipment.invoice_date ? fmtDate(shipment.invoice_date) : null, mono: true },
    { label: "Port of Loading", value: shipment.port_of_loading },
    { label: "Destination", value: [shipment.destination_port, shipment.destination_country].filter(Boolean).join(", ") },
    { label: "Vessel / Voyage", value: [shipment.vessel, shipment.voyage_no].filter(Boolean).join(" / ") },
    { label: "ETD", value: shipment.etd ? fmtDate(shipment.etd) : null, mono: true },
    { label: "Incoterm", value: shipment.incoterm },
    { label: "Currency", value: shipment.currency_code },
  ]);
  return (
    <div className="po-keep">
      <SheetMasthead
        company={{ name: company.name, logo: company.logo }}
        kind={kind}
        reNo={docNo}
        meta={shipment.invoice_date ? <span className="tabular-nums">{fmtDate(shipment.invoice_date)}</span> : null}
        dense
      />
      <CompanyLine company={company} />
      <OrderFacts facts={facts} dense />
    </div>
  );
}

/** Prepared · Checked · Authorised Signatory — one row, short lines. */
function DocSignOff({ company }: { company: Company }) {
  return (
    <div className="po-keep">
      <SignOff
        dense
        cells={[
          ["Prepared By", null],
          ["Checked By", null],
          ["Authorised Signatory", `For ${company.name}`],
        ]}
      />
    </div>
  );
}

// ---------- Commercial Invoice ----------

function CommercialInvoice({ snap, docNo, company }: SheetProps) {
  const { shipment, lines } = snap;
  const sym = symOf(shipment.currency_code);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <>
      <DocHead kind="COMMERCIAL INVOICE" snap={snap} docNo={docNo} company={company} />

      <SectionCard dense title="Items" total={money(sym, total)} totalLabel="Total">
        <ReportTable bare>
          <thead>
            <tr>
              <Th right>#</Th>
              <Th>Description</Th>
              <Th>HSN</Th>
              <Th right>Qty</Th>
              <Th right>Unit Price ({sym})</Th>
              <Th right>Amount ({sym})</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id ?? i} style={stripeRow(i)} className="po-keep align-top">
                <Td right>
                  <span className="text-[#7b8594]">{i + 1}</span>
                </Td>
                <Td>{l.description}</Td>
                <Td mono>{l.hsn_code ?? "—"}</Td>
                <Td right>{fmtNumber(l.quantity)}</Td>
                <Td right>{fmtFixed(l.unit_price, 2)}</Td>
                <Td right>
                  <span className="font-semibold">{fmtFixed(l.amount, 2)}</span>
                </Td>
              </tr>
            ))}
            <tr style={totalRowStyle()} className="font-semibold">
              <Td colSpan={3} right>
                Total
              </Td>
              <Td right>{fmtNumber(totalQty)}</Td>
              <Td> </Td>
              <Td right>{fmtFixed(total, 2)}</Td>
            </tr>
          </tbody>
        </ReportTable>
      </SectionCard>

      <DocumentFoot
        words={amountInWords(total, shipment.currency_code ?? "INR")}
        terms={[
          { label: "Terms of Delivery", value: `${shipment.incoterm ?? "FOB"} — ${shipment.port_of_loading ?? "Tuticorin"}` },
          {
            label: "Declaration",
            value: "We certify that the merchandise described above is of Indian origin and that the prices stated are true and correct.",
          },
        ]}
        amount={<AmountCard sym={sym} rows={[{ label: "Goods Value", value: total }]} net={total} netLabel="Invoice Value" />}
      />

      <DocSignOff company={company} />
    </>
  );
}

// ---------- Packing List ----------

function PackingList({ snap, docNo, company }: SheetProps) {
  const { lines } = snap;
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const totalCartons = lines.reduce((s, l) => s + (l.cartons ?? 0), 0);
  const totalNetWt = lines.reduce((s, l) => s + (l.net_weight ?? 0), 0);
  const totalGrossWt = lines.reduce((s, l) => s + (l.gross_weight ?? 0), 0);

  return (
    <>
      <DocHead kind="PACKING LIST" snap={snap} docNo={docNo} company={company} />

      <SectionCard dense title="Packing" total={totalCartons > 0 ? fmtNumber(totalCartons) : null} totalLabel="Cartons">
        <ReportTable bare>
          <thead>
            <tr>
              <Th right>#</Th>
              <Th>Description</Th>
              <Th right>Qty</Th>
              <Th right>Cartons</Th>
              <Th right>Net Wt (kg)</Th>
              <Th right>Gross Wt (kg)</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id ?? i} style={stripeRow(i)} className="po-keep align-top">
                <Td right>
                  <span className="text-[#7b8594]">{i + 1}</span>
                </Td>
                <Td>{l.description}</Td>
                <Td right>{fmtNumber(l.quantity)}</Td>
                <Td right>{l.cartons ?? "—"}</Td>
                <Td right>{fmtNumber(l.net_weight)}</Td>
                <Td right>{fmtNumber(l.gross_weight)}</Td>
              </tr>
            ))}
            <tr style={totalRowStyle()} className="font-semibold">
              <Td colSpan={2} right>
                Total
              </Td>
              <Td right>{fmtNumber(totalQty)}</Td>
              <Td right>{totalCartons > 0 ? fmtNumber(totalCartons) : "—"}</Td>
              <Td right>{totalNetWt > 0 ? fmtNumber(totalNetWt) : "—"}</Td>
              <Td right>{totalGrossWt > 0 ? fmtNumber(totalGrossWt) : "—"}</Td>
            </tr>
          </tbody>
        </ReportTable>
      </SectionCard>

      {/* No money on a packing list, and no remarks or terms in the snapshot today, so
          there is no foot: DocumentFoot renders nothing for an empty left column. */}

      <DocSignOff company={company} />
    </>
  );
}

// ---------- Generic document (BL, GST Invoice, DGFT) ----------

function GenericDoc({ snap, docType, docNo, company }: SheetProps & { docType: DocType }) {
  const { shipment, lines } = snap;
  const sym = symOf(shipment.currency_code);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <>
      <DocHead kind={DOC_TYPE_LABELS[docType].toUpperCase()} snap={snap} docNo={docNo} company={company} />

      <SectionCard
        dense
        title="Items"
        total={money(sym, total)}
        totalLabel="Total"
        note={`Document type: ${DOC_TYPE_LABELS[docType]} · Generated: ${fmtDate(snap.generated_at)}`}
      >
        <ReportTable bare>
          <thead>
            <tr>
              <Th right>#</Th>
              <Th>Description</Th>
              <Th right>Qty</Th>
              <Th right>Amount ({sym})</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id ?? i} style={stripeRow(i)} className="po-keep align-top">
                <Td right>
                  <span className="text-[#7b8594]">{i + 1}</span>
                </Td>
                <Td>{l.description}</Td>
                <Td right>{fmtNumber(l.quantity)}</Td>
                <Td right>{fmtFixed(l.amount, 2)}</Td>
              </tr>
            ))}
            <tr style={totalRowStyle()} className="font-semibold">
              <Td colSpan={2} right>
                Total
              </Td>
              <Td right>{fmtNumber(totalQty)}</Td>
              <Td right>{fmtFixed(total, 2)}</Td>
            </tr>
          </tbody>
        </ReportTable>
      </SectionCard>

      <DocSignOff company={company} />
    </>
  );
}

// ---------- page ----------

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ shipmentId: string; docType: string }>;
}) {
  await requirePermission("logistics", "view");
  const { shipmentId, docType: docTypeRaw } = await params;

  // validate docType param
  if (!(DOC_TYPES as readonly string[]).includes(docTypeRaw)) {
    notFound();
  }
  const docType = docTypeRaw as DocType;

  // One round: the document and the letterhead it prints under.
  const s = await createClient();
  const [doc, { data: co }] = await Promise.all([
    getDocument(shipmentId, docType),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
  ]);

  if (!doc || doc.status !== "generated") {
    notFound();
  }

  const snap = extractSnapshot(doc.data);
  const c = (co ?? null) as Record<string, unknown> | null;
  const cs = (k: string) => (typeof c?.[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const company: Company = {
    // The exporter was hand-typed "Raagam Exports" before; the company profile names it now.
    name: cs("company_name") ?? cs("company_short_name") ?? "RAAGAM EXPORTS",
    logo: letterheadLogoOf(c),
    address: registeredAddressOf(c),
    phone: cs("phone") ?? cs("mobile"),
    email: cs("email"),
    gstin: cs("gstin"),
  };

  return (
    <div>
      <PoPrintToolbar backHref={`/logistics/${shipmentId}`} backLabel={snap.shipment.code ?? "Shipment"} />
      <DocumentPrintStyles scope="po" />
      <article className="po-sheet mx-auto max-w-[1100px] space-y-3 bg-white pb-6 text-[12px] text-[#17202b]">
        {docType === "commercial_invoice" ? (
          <CommercialInvoice snap={snap} docNo={doc.doc_no} company={company} />
        ) : docType === "packing_list" ? (
          <PackingList snap={snap} docNo={doc.doc_no} company={company} />
        ) : (
          <GenericDoc snap={snap} docType={docType} docNo={doc.doc_no} company={company} />
        )}

        <p className="text-[10.5px] text-[#7b8594]">
          Shipment: {snap.shipment.code ?? shipmentId} · Generated: {fmtDate(doc.generated_at)}
        </p>
      </article>
    </div>
  );
}
