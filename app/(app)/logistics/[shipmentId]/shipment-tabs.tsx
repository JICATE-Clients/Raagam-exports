"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { fmtNumber, fmtDate } from "@/lib/format";
import {
  updateShipment,
  addLine,
  updateLine,
  deleteLine,
  pullLinesFromOrders,
  generateAllDocuments,
  generateDocument,
  markShipped,
  markDelivered,
  closeShipment,
} from "@/lib/logistics/actions";
import {
  DOC_TYPE_LABELS,
  DOC_TYPES,
  REQUIRED_DOC_TYPES,
  SHIPMENT_STATUS_LABELS,
  docChecklist,
  allDocsReady,
  lineAmount,
  type ShipmentLine,
  type ShipmentDocument,
  type ShipmentStatus,
  type ShipmentLineInput,
} from "@/lib/logistics/types";
import type { ShipmentWithBuyer, ShipmentOrderRow } from "@/lib/logistics/service";
import type { StatusTone } from "@/components/ui/status-pill";

// ---------- helpers ----------

function docStatusTone(done: boolean): StatusTone {
  return done ? "success" : "neutral";
}

function shipmentStatusTone(status: ShipmentStatus): StatusTone {
  switch (status) {
    case "planning":
      return "neutral";
    case "docs_ready":
      return "info";
    case "shipped":
      return "warning";
    case "delivered":
      return "success";
    case "closed":
      return "neutral";
  }
}

// ---------- Details tab ----------

function DetailsTab({
  shipment,
  shipmentOrders,
  canEdit,
}: {
  shipment: ShipmentWithBuyer;
  shipmentOrders: ShipmentOrderRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  // editable fields
  const [consigneeName, setConsigneeName] = useState(shipment.consignee_name ?? "");
  const [consigneeAddress, setConsigneeAddress] = useState(
    shipment.consignee_address ?? "",
  );
  const [destinationPort, setDestinationPort] = useState(
    shipment.destination_port ?? "",
  );
  const [destinationCountry, setDestinationCountry] = useState(
    shipment.destination_country ?? "",
  );
  const [vessel, setVessel] = useState(shipment.vessel ?? "");
  const [voyageNo, setVoyageNo] = useState(shipment.voyage_no ?? "");
  const [incoterm, setIncoterm] = useState(shipment.incoterm ?? "FOB");
  const [etd, setEtd] = useState(shipment.etd ?? "");
  const [eta, setEta] = useState(shipment.eta ?? "");
  const [invoiceNo, setInvoiceNo] = useState(shipment.invoice_no ?? "");
  const [invoiceDate, setInvoiceDate] = useState(shipment.invoice_date ?? "");

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateShipment(shipment.id, {
        consignee_name: consigneeName || null,
        consignee_address: consigneeAddress || null,
        destination_port: destinationPort || null,
        destination_country: destinationCountry || null,
        vessel: vessel || null,
        voyage_no: voyageNo || null,
        incoterm: incoterm || "FOB",
        etd: etd || null,
        eta: eta || null,
        invoice_no: invoiceNo || null,
        invoice_date: invoiceDate || null,
      });
      if (result.ok) {
        success("Shipment updated");
        setEditing(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Shipment header</CardTitle>
          {canEdit && !editing && (
            <Button size="sm" variant="subtle" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </CardHeader>

        <CardBody>
          {editing ? (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="dt-consignee">Consignee name</Label>
                  <Input
                    id="dt-consignee"
                    value={consigneeName}
                    onChange={(e) => setConsigneeName(e.target.value)}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label htmlFor="dt-consignee-addr">Consignee address</Label>
                  <Textarea
                    id="dt-consignee-addr"
                    rows={2}
                    value={consigneeAddress}
                    onChange={(e) => setConsigneeAddress(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="dt-dest-port">Destination port</Label>
                  <Input
                    id="dt-dest-port"
                    value={destinationPort}
                    onChange={(e) => setDestinationPort(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="dt-dest-country">Destination country</Label>
                  <Input
                    id="dt-dest-country"
                    value={destinationCountry}
                    onChange={(e) => setDestinationCountry(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="dt-vessel">Vessel</Label>
                  <Input
                    id="dt-vessel"
                    value={vessel}
                    onChange={(e) => setVessel(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="dt-voyage">Voyage no.</Label>
                  <Input
                    id="dt-voyage"
                    value={voyageNo}
                    onChange={(e) => setVoyageNo(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="dt-incoterm">Incoterm</Label>
                  <Select
                    id="dt-incoterm"
                    value={incoterm}
                    onChange={(e) => setIncoterm(e.target.value)}
                  >
                    {["FOB", "CIF", "CFR", "EXW", "DDP", "DAP"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Label htmlFor="dt-etd">ETD</Label>
                  <Input
                    id="dt-etd"
                    type="date"
                    value={etd}
                    onChange={(e) => setEtd(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="dt-eta">ETA</Label>
                  <Input
                    id="dt-eta"
                    type="date"
                    value={eta}
                    onChange={(e) => setEta(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="dt-inv-no">Invoice no.</Label>
                  <Input
                    id="dt-inv-no"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="dt-inv-date">Invoice date</Label>
                  <Input
                    id="dt-inv-date"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Consignee</dt>
                <dd className="font-medium">{shipment.consignee_name ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Consignee address</dt>
                <dd className="font-medium whitespace-pre-line">
                  {shipment.consignee_address ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Destination port</dt>
                <dd className="font-medium">{shipment.destination_port ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Destination country</dt>
                <dd className="font-medium">{shipment.destination_country ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Vessel</dt>
                <dd className="font-medium">{shipment.vessel ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Voyage no.</dt>
                <dd className="font-medium">{shipment.voyage_no ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Incoterm</dt>
                <dd className="font-medium">{shipment.incoterm ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">ETD</dt>
                <dd className="tabular-nums font-medium">{fmtDate(shipment.etd)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">ETA</dt>
                <dd className="tabular-nums font-medium">{fmtDate(shipment.eta)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Invoice no.</dt>
                <dd className="font-medium">{shipment.invoice_no ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Invoice date</dt>
                <dd className="tabular-nums font-medium">
                  {fmtDate(shipment.invoice_date)}
                </dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>

      {/* Linked orders */}
      <Card>
        <CardHeader>
          <CardTitle>Linked sales orders</CardTitle>
        </CardHeader>
        <CardBody>
          {shipmentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders linked.</p>
          ) : (
            <ul className="space-y-1">
              {shipmentOrders.map((row) => (
                <li key={row.sales_order_id} className="flex items-center gap-3 text-sm">
                  <Link
                    href={`/orders/${row.sales_order_id}`}
                    className="font-mono text-xs font-medium text-primary hover:underline"
                  >
                    {row.sales_orders?.order_number ?? row.sales_order_id.slice(0, 8)}
                  </Link>
                  {row.sales_orders && (
                    <span className="text-xs text-muted-foreground">
                      {row.sales_orders.currency_code} {row.sales_orders.fob_price}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------- Line items tab ----------

type LineFormState = {
  description: string;
  hsn_code: string;
  quantity: string;
  unit_price: string;
  cartons: string;
  net_weight: string;
  gross_weight: string;
};

function emptyLineForm(): LineFormState {
  return {
    description: "",
    hsn_code: "",
    quantity: "",
    unit_price: "",
    cartons: "",
    net_weight: "",
    gross_weight: "",
  };
}

function formToInput(f: LineFormState): ShipmentLineInput {
  return {
    description: f.description,
    hsn_code: f.hsn_code || null,
    quantity: Number(f.quantity) || 0,
    unit_price: Number(f.unit_price) || 0,
    cartons: f.cartons ? Number(f.cartons) : null,
    net_weight: f.net_weight ? Number(f.net_weight) : null,
    gross_weight: f.gross_weight ? Number(f.gross_weight) : null,
    sort_order: 0,
  };
}

function LineForm({
  initial,
  shipmentId,
  lineId,
  onDone,
  onCancel,
}: {
  initial: LineFormState;
  shipmentId: string;
  lineId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<LineFormState>(initial);

  function setField(field: keyof LineFormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const previewAmount = lineAmount(
    Number(form.quantity) || 0,
    Number(form.unit_price) || 0,
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim()) {
      toastError("Description is required");
      return;
    }
    const input = formToInput(form);
    startTransition(async () => {
      const result = lineId
        ? await updateLine(lineId, shipmentId, input)
        : await addLine(shipmentId, input);
      if (result.ok) {
        success(lineId ? "Line updated" : "Line added");
        onDone();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-border bg-surface-muted p-3 space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor={`lf-desc-${lineId ?? "new"}`}>Description</Label>
          <Input
            id={`lf-desc-${lineId ?? "new"}`}
            placeholder="e.g. Knitted cotton t-shirt / Navy / M"
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            required
          />
        </div>

        <div>
          <Label htmlFor={`lf-hsn-${lineId ?? "new"}`}>HSN code</Label>
          <Input
            id={`lf-hsn-${lineId ?? "new"}`}
            placeholder="e.g. 6109"
            value={form.hsn_code}
            onChange={(e) => setField("hsn_code", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={`lf-qty-${lineId ?? "new"}`}>Quantity</Label>
          <Input
            id={`lf-qty-${lineId ?? "new"}`}
            type="number"
            min="0"
            step="1"
            placeholder="0"
            value={form.quantity}
            onChange={(e) => setField("quantity", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={`lf-up-${lineId ?? "new"}`}>Unit price</Label>
          <Input
            id={`lf-up-${lineId ?? "new"}`}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.unit_price}
            onChange={(e) => setField("unit_price", e.target.value)}
          />
        </div>

        <div>
          <Label>Amount (auto)</Label>
          <div className="h-9 flex items-center px-2 text-sm tabular-nums text-muted-foreground">
            {previewAmount.toLocaleString("en-IN")}
          </div>
        </div>

        <div>
          <Label htmlFor={`lf-ctn-${lineId ?? "new"}`}>Cartons</Label>
          <Input
            id={`lf-ctn-${lineId ?? "new"}`}
            type="number"
            min="0"
            placeholder="—"
            value={form.cartons}
            onChange={(e) => setField("cartons", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={`lf-nw-${lineId ?? "new"}`}>Net weight (kg)</Label>
          <Input
            id={`lf-nw-${lineId ?? "new"}`}
            type="number"
            min="0"
            step="0.01"
            placeholder="—"
            value={form.net_weight}
            onChange={(e) => setField("net_weight", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={`lf-gw-${lineId ?? "new"}`}>Gross weight (kg)</Label>
          <Input
            id={`lf-gw-${lineId ?? "new"}`}
            type="number"
            min="0"
            step="0.01"
            placeholder="—"
            value={form.gross_weight}
            onChange={(e) => setField("gross_weight", e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : lineId ? "Update" : "Add line"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function LinesTab({
  shipmentId,
  lines,
  canEdit,
  canDelete,
}: {
  shipmentId: string;
  lines: ShipmentLine[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function handleDelete(lineId: string) {
    startTransition(async () => {
      const result = await deleteLine(lineId, shipmentId);
      if (result.ok) {
        success("Line deleted");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handlePull() {
    startTransition(async () => {
      const result = await pullLinesFromOrders(shipmentId);
      if (result.ok) {
        success("Lines pulled from linked orders");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const lineColumns: Column<ShipmentLine>[] = [
    {
      header: "Description",
      cell: (l) => <span className="text-sm">{l.description}</span>,
    },
    {
      header: "HSN",
      cell: (l) => (
        <span className="text-xs text-muted-foreground">{l.hsn_code ?? "—"}</span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm">{fmtNumber(l.quantity)}</span>
      ),
    },
    {
      header: "Unit price",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm">
          {l.unit_price.toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm">{fmtNumber(l.amount)}</span>
      ),
    },
    {
      header: "Cartons",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm">{l.cartons ?? "—"}</span>
      ),
    },
    ...(canEdit || canDelete
      ? [
          {
            header: "Actions",
            cell: (l: ShipmentLine) => (
              <div className="flex gap-1">
                {canEdit && editingId !== l.id && (
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => setEditingId(l.id)}
                    className="h-7 px-2 text-xs"
                  >
                    Edit
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(l.id)}
                    disabled={isPending}
                    className="h-7 px-2 text-xs text-danger hover:border-danger"
                  >
                    Del
                  </Button>
                )}
              </div>
            ),
          } satisfies Column<ShipmentLine>,
        ]
      : []),
  ];

  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="subtle"
            onClick={handlePull}
            disabled={isPending}
          >
            Pull from orders
          </Button>
          {!addOpen && (
            <Button size="sm" variant="subtle" onClick={() => setAddOpen(true)}>
              + Add line
            </Button>
          )}
        </div>
      )}

      {addOpen && (
        <LineForm
          initial={emptyLineForm()}
          shipmentId={shipmentId}
          onDone={() => setAddOpen(false)}
          onCancel={() => setAddOpen(false)}
        />
      )}

      <DataTable
        columns={lineColumns}
        rows={lines}
        getKey={(l) => l.id}
        empty="No line items yet. Use 'Pull from orders' or '+ Add line' above."
      />

      {/* Inline edit form renders below the table for the selected row */}
      {editingId !== null && (() => {
        const line = lines.find((l) => l.id === editingId);
        if (!line) return null;
        const initial: LineFormState = {
          description: line.description,
          hsn_code: line.hsn_code ?? "",
          quantity: String(line.quantity),
          unit_price: String(line.unit_price),
          cartons: line.cartons != null ? String(line.cartons) : "",
          net_weight: line.net_weight != null ? String(line.net_weight) : "",
          gross_weight: line.gross_weight != null ? String(line.gross_weight) : "",
        };
        return (
          <LineForm
            initial={initial}
            shipmentId={shipmentId}
            lineId={editingId}
            onDone={() => setEditingId(null)}
            onCancel={() => setEditingId(null)}
          />
        );
      })()}

      {lines.length > 0 && (
        <div className="flex justify-end pr-3 text-sm font-semibold tabular-nums">
          Total: {fmtNumber(totalAmount)}
        </div>
      )}
    </div>
  );
}

// ---------- Documents tab ----------

function DocumentsTab({
  shipmentId,
  lines,
  documents,
  canEdit,
}: {
  shipmentId: string;
  lines: ShipmentLine[];
  documents: ShipmentDocument[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const checklist = docChecklist(documents);
  const allReady = allDocsReady(documents);
  const noLines = lines.length === 0;

  function handleGenerateAll() {
    startTransition(async () => {
      const result = await generateAllDocuments(shipmentId);
      if (result.ok) {
        success("All documents generated");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleGenerateOne(docType: (typeof DOC_TYPES)[number]) {
    startTransition(async () => {
      const result = await generateDocument(shipmentId, docType);
      if (result.ok) {
        success("Document generated");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const docByType = new Map(documents.map((d) => [d.doc_type, d]));

  return (
    <div className="space-y-4">
      {noLines && (
        <div className="rounded-md border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          No line items — add lines before generating documents.
        </div>
      )}

      {canEdit && (
        <Button
          onClick={handleGenerateAll}
          disabled={isPending || noLines}
          variant={allReady ? "outline" : "primary"}
        >
          {isPending
            ? "Generating…"
            : allReady
            ? "Re-generate all documents"
            : "Generate all documents"}
        </Button>
      )}

      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {REQUIRED_DOC_TYPES.map((docType) => {
          const item = checklist.find((c) => c.doc_type === docType);
          const doc = docByType.get(docType);
          return (
            <div
              key={docType}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <StatusPill tone={docStatusTone(item?.done ?? false)}>
                  {item?.done ? "Generated" : "Pending"}
                </StatusPill>
                <span className="text-sm font-medium">
                  {DOC_TYPE_LABELS[docType]}
                </span>
                {doc?.doc_no && (
                  <span className="text-xs text-muted-foreground">
                    {doc.doc_no}
                  </span>
                )}
              </div>

              {doc?.status === "generated" && (
                <Link
                  href={`/logistics/${shipmentId}/documents/${docType}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  View
                </Link>
              )}
            </div>
          );
        })}

        {/* optional export documents — generatable, not part of the required set */}
        {DOC_TYPES.filter((dt) => !REQUIRED_DOC_TYPES.includes(dt)).map((docType) => {
          const doc = docByType.get(docType);
          const generated = doc?.status === "generated";
          return (
            <div
              key={docType}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <StatusPill tone={generated ? "success" : "neutral"}>
                  {generated ? "Generated" : "Optional"}
                </StatusPill>
                <span className="text-sm font-medium">
                  {DOC_TYPE_LABELS[docType]}
                </span>
                {doc?.doc_no && (
                  <span className="text-xs text-muted-foreground">{doc.doc_no}</span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleGenerateOne(docType)}
                    disabled={isPending || noLines}
                    className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
                  >
                    {generated ? "Re-generate" : "Generate"}
                  </button>
                )}
                {generated && (
                  <Link
                    href={`/logistics/${shipmentId}/documents/${docType}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    View
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {documents.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Last generated:{" "}
          {fmtDate(
            documents
              .filter((d) => d.generated_at)
              .sort((a, b) =>
                (b.generated_at ?? "") > (a.generated_at ?? "") ? 1 : -1,
              )[0]?.generated_at ?? null,
          )}
        </p>
      )}
    </div>
  );
}

// ---------- Status tab ----------

function StatusTab({
  shipmentId,
  shipment,
  documents,
  canEdit,
}: {
  shipmentId: string;
  shipment: ShipmentWithBuyer;
  documents: ShipmentDocument[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const status = shipment.status;
  const docsReady = allDocsReady(documents);

  function handleMarkShipped() {
    startTransition(async () => {
      const result = await markShipped(shipmentId);
      if (result.ok) {
        success("Marked as shipped");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleMarkDelivered() {
    startTransition(async () => {
      const result = await markDelivered(shipmentId);
      if (result.ok) {
        success("Marked as delivered");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleClose() {
    startTransition(async () => {
      const result = await closeShipment(shipmentId);
      if (result.ok) {
        success("Shipment closed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const workflow: { label: string; from: ShipmentStatus; to: ShipmentStatus }[] = [
    { label: "Docs Ready", from: "planning", to: "docs_ready" },
    { label: "Shipped", from: "docs_ready", to: "shipped" },
    { label: "Delivered", from: "shipped", to: "delivered" },
    { label: "Closed", from: "delivered", to: "closed" },
  ];

  return (
    <div className="space-y-4">
      {/* Current status strip */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Current status:</span>
            <StatusPill tone={shipmentStatusTone(status)}>
              {SHIPMENT_STATUS_LABELS[status]}
            </StatusPill>
          </div>
        </CardBody>
      </Card>

      {/* Workflow steps */}
      <div className="flex flex-wrap items-center gap-2">
        {workflow.map((step, i) => {
          const isActive = status === step.from;
          const isPast =
            ["planning", "docs_ready", "shipped", "delivered", "closed"].indexOf(status) >
            ["planning", "docs_ready", "shipped", "delivered", "closed"].indexOf(step.from);
          return (
            <div key={step.to} className="flex items-center gap-2">
              {i > 0 && (
                <span className="text-muted-foreground">→</span>
              )}
              <span
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  isPast
                    ? "border-success bg-success-soft text-success"
                    : isActive
                    ? "border-primary bg-surface text-primary"
                    : "border-border bg-surface-muted text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Workflow actions */}
      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {status === "planning" && !docsReady && (
            <p className="text-sm text-muted-foreground">
              Generate all required documents first to advance to &ldquo;Docs Ready&rdquo;.
            </p>
          )}

          {status === "docs_ready" && (
            <Button onClick={handleMarkShipped} disabled={isPending}>
              {isPending ? "Saving…" : "Mark as Shipped"}
            </Button>
          )}

          {status === "shipped" && (
            <Button onClick={handleMarkDelivered} disabled={isPending}>
              {isPending ? "Saving…" : "Mark as Delivered"}
            </Button>
          )}

          {status === "delivered" && (
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
            >
              {isPending ? "Closing…" : "Close Shipment"}
            </Button>
          )}

          {status === "closed" && (
            <p className="text-sm text-muted-foreground">
              This shipment is closed and no further actions are available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- main export ----------

interface Props {
  shipment: ShipmentWithBuyer;
  shipmentOrders: ShipmentOrderRow[];
  lines: ShipmentLine[];
  documents: ShipmentDocument[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ShipmentTabs({
  shipment,
  shipmentOrders,
  lines,
  documents,
  canEdit,
  canDelete,
}: Props) {
  const items = [
    {
      key: "details",
      label: "Details",
      content: (
        <DetailsTab
          shipment={shipment}
          shipmentOrders={shipmentOrders}
          canEdit={canEdit}
        />
      ),
    },
    {
      key: "lines",
      label: `Line items (${lines.length})`,
      content: (
        <LinesTab
          shipmentId={shipment.id}
          lines={lines}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      ),
    },
    {
      key: "documents",
      label: "Documents",
      content: (
        <DocumentsTab
          shipmentId={shipment.id}
          lines={lines}
          documents={documents}
          canEdit={canEdit}
        />
      ),
    },
    {
      key: "status",
      label: "Status & workflow",
      content: (
        <StatusTab
          shipmentId={shipment.id}
          shipment={shipment}
          documents={documents}
          canEdit={canEdit}
        />
      ),
    },
  ];

  return <Tabs items={items} defaultKey="details" />;
}
