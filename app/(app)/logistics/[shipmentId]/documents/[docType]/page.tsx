import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getDocument } from "@/lib/logistics/service";
import { fmtMoney, fmtDate, fmtNumber } from "@/lib/format";
import { Card, CardBody } from "@/components/ui/card";
import { PrintButton } from "./print-button";
import {
  DOC_TYPE_LABELS,
  DOC_TYPES,
  type DocType,
} from "@/lib/logistics/types";

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

// ---------- Shared document header ----------

function DocHeader({
  docTitle,
  docNo,
  shipment,
  buyer,
}: {
  docTitle: string;
  docNo: string | null;
  shipment: ShipmentSnapshot;
  buyer: BuyerSnapshot;
}) {
  return (
    <div className="mb-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Exporter
          </p>
          <p className="text-base font-bold text-foreground">Raagam Exports</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-foreground">{docTitle}</p>
          {docNo && (
            <p className="mt-0.5 font-mono text-sm text-muted-foreground">
              {docNo}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 border-t border-border pt-4 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Consignee
          </p>
          <p className="mt-1 font-medium">{shipment.consignee_name ?? "—"}</p>
          {shipment.consignee_address && (
            <p className="mt-0.5 whitespace-pre-line text-muted-foreground">
              {shipment.consignee_address}
            </p>
          )}
          {buyer?.name && (
            <p className="mt-1 text-xs text-muted-foreground">
              Buyer: {buyer.name}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">Invoice no.</span>
            <p className="font-medium">{shipment.invoice_no ?? docNo ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Invoice date</span>
            <p className="font-medium">{fmtDate(shipment.invoice_date)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Port of loading</span>
            <p className="font-medium">{shipment.port_of_loading ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Destination</span>
            <p className="font-medium">
              {[shipment.destination_port, shipment.destination_country]
                .filter(Boolean)
                .join(", ") || "—"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Vessel / voyage</span>
            <p className="font-medium">
              {[shipment.vessel, shipment.voyage_no].filter(Boolean).join(" / ") || "—"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">ETD</span>
            <p className="font-medium tabular-nums">{fmtDate(shipment.etd)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Incoterm</span>
            <p className="font-medium">{shipment.incoterm ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Currency</span>
            <p className="font-medium">{shipment.currency_code ?? "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Commercial Invoice ----------

function CommercialInvoice({ snap, docNo }: { snap: DocSnapshot; docNo: string | null }) {
  const { shipment, lines, buyer } = snap;
  const total = lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div>
      <DocHeader
        docTitle="Commercial Invoice"
        docNo={docNo}
        shipment={shipment}
        buyer={buyer}
      />

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
              Description
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
              HSN
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
              Qty
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
              Unit price
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className="border-b border-border last:border-0">
              <td className="px-3 py-2">{l.description}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {l.hsn_code ?? "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNumber(l.quantity)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.unit_price.toLocaleString("en-IN")}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">
                {fmtMoney(l.amount, shipment.currency_code)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border">
            <td
              colSpan={4}
              className="px-3 py-2 text-right text-sm font-semibold"
            >
              Total
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-sm font-bold">
              {fmtMoney(total, shipment.currency_code)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>Incoterm: {shipment.incoterm ?? "FOB"} — {shipment.port_of_loading ?? "Tuticorin"}</p>
        <p className="mt-1">
          We certify that the merchandise described above is of Indian origin and
          that the prices stated are true and correct.
        </p>
      </div>
    </div>
  );
}

// ---------- Packing List ----------

function PackingList({ snap, docNo }: { snap: DocSnapshot; docNo: string | null }) {
  const { shipment, lines, buyer } = snap;
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const totalCartons = lines.reduce((s, l) => s + (l.cartons ?? 0), 0);
  const totalNetWt = lines.reduce((s, l) => s + (l.net_weight ?? 0), 0);
  const totalGrossWt = lines.reduce((s, l) => s + (l.gross_weight ?? 0), 0);

  return (
    <div>
      <DocHeader
        docTitle="Packing List"
        docNo={docNo}
        shipment={shipment}
        buyer={buyer}
      />

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
              Description
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
              Qty
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
              Cartons
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
              Net wt (kg)
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
              Gross wt (kg)
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className="border-b border-border last:border-0">
              <td className="px-3 py-2">{l.description}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNumber(l.quantity)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.cartons ?? "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.net_weight != null
                  ? l.net_weight.toLocaleString("en-IN")
                  : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.gross_weight != null
                  ? l.gross_weight.toLocaleString("en-IN")
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border">
            <td className="px-3 py-2 text-right text-sm font-semibold">Totals</td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">
              {fmtNumber(totalQty)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">
              {totalCartons > 0 ? fmtNumber(totalCartons) : "—"}
            </td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">
              {totalNetWt > 0 ? totalNetWt.toLocaleString("en-IN") : "—"}
            </td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">
              {totalGrossWt > 0 ? totalGrossWt.toLocaleString("en-IN") : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------- Generic document (BL, GST Invoice, DGFT) ----------

function GenericDoc({
  snap,
  docType,
  docNo,
}: {
  snap: DocSnapshot;
  docType: DocType;
  docNo: string | null;
}) {
  const { shipment, lines, buyer } = snap;
  const total = lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div>
      <DocHeader
        docTitle={DOC_TYPE_LABELS[docType]}
        docNo={docNo}
        shipment={shipment}
        buyer={buyer}
      />

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
              Description
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
              Qty
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className="border-b border-border last:border-0">
              <td className="px-3 py-2">{l.description}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNumber(l.quantity)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtMoney(l.amount, shipment.currency_code)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border">
            <td
              colSpan={2}
              className="px-3 py-2 text-right text-sm font-semibold"
            >
              Total
            </td>
            <td className="px-3 py-2 text-right tabular-nums font-bold">
              {fmtMoney(total, shipment.currency_code)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-6 rounded-md border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
        <p>Document type: {DOC_TYPE_LABELS[docType]}</p>
        <p>Generated: {fmtDate(snap.generated_at)}</p>
      </div>
    </div>
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

  const doc = await getDocument(shipmentId, docType);

  if (!doc || doc.status !== "generated") {
    notFound();
  }

  const snap = extractSnapshot(doc.data);

  return (
    <div className="min-h-screen bg-surface-muted py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl px-4">
        {/* Top bar — hidden when printing */}
        <div className="mb-4 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-3">
            <Link
              href={`/logistics/${shipmentId}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back to shipment
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-medium">{DOC_TYPE_LABELS[docType]}</span>
          </div>
          <PrintButton />
        </div>

        {/* Document card */}
        <Card className="print:shadow-none print:border-0">
          <CardBody className="p-8 print:p-4">
            {docType === "commercial_invoice" && (
              <CommercialInvoice snap={snap} docNo={doc.doc_no} />
            )}
            {docType === "packing_list" && (
              <PackingList snap={snap} docNo={doc.doc_no} />
            )}
            {docType !== "commercial_invoice" &&
              docType !== "packing_list" && (
                <GenericDoc snap={snap} docType={docType} docNo={doc.doc_no} />
              )}

            <div className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground print:text-gray-400">
              <p>
                Shipment: {snap.shipment.code ?? shipmentId} &nbsp;|&nbsp; Generated:{" "}
                {fmtDate(doc.generated_at)}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
