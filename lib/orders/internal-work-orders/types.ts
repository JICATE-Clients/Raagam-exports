import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";
import { capsTextNullable } from "@/lib/validation/formats";

export const IWO_STATUSES = [
  "draft",
  "issued",
  "completed",
  "cancelled",
] as const;
export type IwoStatus = (typeof IWO_STATUSES)[number];

export const IWO_STATUS_LABELS: Record<IwoStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function iwoStatusTone(status: IwoStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "issued":
      return "info";
    case "completed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

/**
 * WHAT THE IWO PROCURES — the header's `For` (client 2026-09-18, screenshot
 * 2936). Three kinds, and GARMENT IS DELIBERATELY NOT ONE: garment work goes
 * through ordinary Order Entry. The value decides which line table the lines
 * live in (0578), and `iwo_line_guard` refuses a line of any other kind.
 */
export const IWO_FOR = ["yarn", "fabric", "accessories"] as const;
export type IwoFor = (typeof IWO_FOR)[number];

export const IWO_FOR_LABELS: Record<IwoFor, string> = {
  yarn: "Yarn",
  fabric: "Fabric",
  accessories: "Accessories",
};

export const isIwoFor = (v: string | null | undefined): v is IwoFor =>
  (IWO_FOR as readonly string[]).includes(v ?? "");

// ---------------------------------------------------------------------------
// Stored rows
// ---------------------------------------------------------------------------

export interface InternalWorkOrder {
  id: string;
  /** U2/IWO/2627/0005 — assigned by `assign_iwo_number()` on insert. */
  code: string | null;
  /** Reference (RE No) — optional; an IWO usually precedes any buyer order. */
  sales_order_id: string | null;
  location_id: string | null;
  status: IwoStatus;
  issued_at: string | null;
  iwo_for: IwoFor;
  iwo_date: string;
  style_ref_no: string | null;
  deli_date: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IwoYarnProcessRow {
  id: string;
  yarn_item_id: string;
  sno: number;
  process_id: string;
  shade_id: string | null;
  qty_kgs: number;
  rate_per_kg: number | null;
}

export interface IwoYarnItemRow {
  id: string;
  iwo_id: string;
  sno: number;
  item_id: string;
  stage_id: string;
  planned_kgs: number;
  iwo_yarn_process_details: IwoYarnProcessRow[];
}

export interface IwoFabricProcessRow {
  id: string;
  fabric_item_id: string;
  sno: number;
  process_id: string;
  loss_pct: number;
  rate_per_kg: number | null;
}

export interface IwoFabricItemRow {
  id: string;
  iwo_id: string;
  sno: number;
  item_id: string;
  stage_id: string;
  color_id: string | null;
  print_id: string | null;
  gsm: number | null;
  /** 'open' | 'tubular' — Fabric BOM's `FABRIC_FORM_OPTIONS`. */
  fabric_form: string | null;
  dia: string | null;
  planned_kgs: number;
  iwo_fabric_process_details: IwoFabricProcessRow[];
}

export interface IwoAccessoryProcessRow {
  id: string;
  accessory_item_id: string;
  sno: number;
  process_id: string;
  vendor_id: string | null;
  rate_per_unit: number | null;
}

export interface IwoAccessoryItemRow {
  id: string;
  iwo_id: string;
  sno: number;
  item_id: string;
  specs: string | null;
  color_id: string | null;
  size_id: string | null;
  uom_id: string;
  planned_qty: number;
  /** Spec / buyer approval pending — recorded now, PO-blocking later (0578). */
  is_advised: boolean;
  iwo_accessory_process_details: IwoAccessoryProcessRow[];
}

// ---------------------------------------------------------------------------
// What the screen sends
//
// EVERY FIELD IS NULLABLE GOING IN, including the ones the tables declare
// NOT NULL. The screen seeds a blank row into each grid (AGENTS.md, "Editable
// sub-tables open with a row"), and that row reaches the action — so the schema
// must accept it for `lines.ts` to drop it. What a SURVIVING row must carry is
// `lineProblems`' job, one function read by the Save gate and the action alike.
// ---------------------------------------------------------------------------

const uuidN = z.string().uuid().nullable().default(null);
const numN = z.number().finite().nullable().default(null);

export const iwoYarnProcessInput = z.object({
  process_id: uuidN,
  shade_id: uuidN,
  qty_kgs: numN,
  rate_per_kg: numN,
});

export const iwoYarnLineInput = z.object({
  item_id: uuidN,
  stage_id: uuidN,
  planned_kgs: numN,
  processes: z.array(iwoYarnProcessInput).default([]),
});

export const iwoFabricProcessInput = z.object({
  process_id: uuidN,
  loss_pct: numN,
  rate_per_kg: numN,
});

export const iwoFabricLineInput = z.object({
  item_id: uuidN,
  stage_id: uuidN,
  color_id: uuidN,
  print_id: uuidN,
  gsm: numN,
  fabric_form: z.enum(["open", "tubular"]).nullable().default(null),
  // A dia is written like `30" OPEN` — text, capitalised in the schema so a
  // spreadsheet import could never miss it (AGENTS.md, CAPITALS).
  dia: capsTextNullable(),
  planned_kgs: numN,
  processes: z.array(iwoFabricProcessInput).default([]),
});

export const iwoAccessoryProcessInput = z.object({
  process_id: uuidN,
  vendor_id: uuidN,
  rate_per_unit: numN,
});

export const iwoAccessoryLineInput = z.object({
  item_id: uuidN,
  specs: capsTextNullable(),
  color_id: uuidN,
  size_id: uuidN,
  uom_id: uuidN,
  planned_qty: numN,
  is_advised: z.boolean().default(false),
  processes: z.array(iwoAccessoryProcessInput).default([]),
});

export const iwoInput = z.object({
  iwo_date: z.string().min(1, "Date is required"),
  iwo_for: z.enum(IWO_FOR, { message: "Choose what this work order is For" }),
  sales_order_id: uuidN,
  style_ref_no: capsTextNullable(),
  deli_date: z.string().nullable().default(null),
  remarks: capsTextNullable(),
  // Only the array matching `iwo_for` is written; the action clears the rest.
  yarn: z.array(iwoYarnLineInput).default([]),
  fabric: z.array(iwoFabricLineInput).default([]),
  accessories: z.array(iwoAccessoryLineInput).default([]),
});

/** `z.input`, not `z.infer` — what callers SEND, before the action parses it;
 *  every `.default()` field is optional going in. */
export type IwoInput = z.input<typeof iwoInput>;
export type IwoParsed = z.infer<typeof iwoInput>;
export type IwoYarnLineInput = z.infer<typeof iwoYarnLineInput>;
export type IwoYarnProcessInput = z.infer<typeof iwoYarnProcessInput>;
export type IwoFabricLineInput = z.infer<typeof iwoFabricLineInput>;
export type IwoFabricProcessInput = z.infer<typeof iwoFabricProcessInput>;
export type IwoAccessoryLineInput = z.infer<typeof iwoAccessoryLineInput>;
export type IwoAccessoryProcessInput = z.infer<typeof iwoAccessoryProcessInput>;
