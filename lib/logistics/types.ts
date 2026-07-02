import { z } from "zod";

export const SHIPMENT_STATUSES = [
  "planning",
  "docs_ready",
  "shipped",
  "delivered",
  "closed",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  planning: "Planning",
  docs_ready: "Docs Ready",
  shipped: "Shipped",
  delivered: "Delivered",
  closed: "Closed",
};

export const DOC_TYPES = [
  "commercial_invoice",
  "packing_list",
  "bill_of_lading",
  "gst_invoice",
  "dgft",
  "certificate_of_origin",
  "gsp",
  "single_country_declaration",
  "ep_copy_receipt",
  "boe",
  "tt_advice",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  bill_of_lading: "Bill of Lading",
  gst_invoice: "GST Invoice",
  dgft: "DGFT Filing",
  certificate_of_origin: "Certificate of Origin",
  gsp: "GSP Certificate",
  single_country_declaration: "Single Country Declaration",
  ep_copy_receipt: "EP Copy Receipt",
  boe: "Bill of Entry (BOE)",
  tt_advice: "TT Advice",
};

/** Documents that make up a complete export set (drives the checklist). */
export const REQUIRED_DOC_TYPES: DocType[] = [
  "commercial_invoice",
  "packing_list",
  "bill_of_lading",
  "gst_invoice",
];

export interface Shipment {
  id: string;
  code: string | null;
  buyer_id: string | null;
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
  status: ShipmentStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentLine {
  id: string;
  shipment_id: string;
  sales_order_id: string | null;
  description: string;
  hsn_code: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  cartons: number | null;
  net_weight: number | null;
  gross_weight: number | null;
  sort_order: number;
}

export interface ShipmentDocument {
  id: string;
  shipment_id: string;
  doc_type: DocType;
  doc_no: string | null;
  status: "pending" | "generated";
  data: Record<string, unknown>;
  generated_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- input schemas ----------
export const shipmentInput = z.object({
  buyer_id: z.string().uuid().optional().nullable(),
  consignee_name: z.string().optional().nullable(),
  consignee_address: z.string().optional().nullable(),
  port_of_loading: z.string().default("Tuticorin"),
  destination_port: z.string().optional().nullable(),
  destination_country: z.string().optional().nullable(),
  vessel: z.string().optional().nullable(),
  voyage_no: z.string().optional().nullable(),
  incoterm: z.string().default("FOB"),
  currency_code: z.string().optional().nullable(),
  etd: z.string().optional().nullable(),
  eta: z.string().optional().nullable(),
  invoice_no: z.string().optional().nullable(),
  invoice_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sales_order_ids: z.array(z.string().uuid()).default([]),
});
export type ShipmentInput = z.infer<typeof shipmentInput>;

export const shipmentLineInput = z.object({
  sales_order_id: z.string().uuid().optional().nullable(),
  description: z.string().min(1),
  hsn_code: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative().default(0),
  unit_price: z.coerce.number().nonnegative().default(0),
  cartons: z.coerce.number().nonnegative().optional().nullable(),
  net_weight: z.coerce.number().nonnegative().optional().nullable(),
  gross_weight: z.coerce.number().nonnegative().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type ShipmentLineInput = z.infer<typeof shipmentLineInput>;

// ---------- helpers ----------
export function lineAmount(quantity: number, unitPrice: number): number {
  return quantity * unitPrice;
}

/** Which required docs are generated vs missing (drives the checklist UI). */
export function docChecklist(
  docs: Pick<ShipmentDocument, "doc_type" | "status">[],
): { doc_type: DocType; done: boolean }[] {
  const generated = new Set(
    docs.filter((d) => d.status === "generated").map((d) => d.doc_type),
  );
  return REQUIRED_DOC_TYPES.map((doc_type) => ({
    doc_type,
    done: generated.has(doc_type),
  }));
}

export function allDocsReady(
  docs: Pick<ShipmentDocument, "doc_type" | "status">[],
): boolean {
  return docChecklist(docs).every((d) => d.done);
}
