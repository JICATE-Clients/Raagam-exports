import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const ORDER_STATUSES = [
  "confirmed",
  "in_production",
  "shipped",
  "closed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const AMENDMENT_TYPES = [
  "quantity",
  "colour",
  "price",
  "sizes",
  "delivery_date",
  "consignee",
  "packing",
  "style",
] as const;
export type AmendmentType = (typeof AMENDMENT_TYPES)[number];

export const AMENDMENT_TYPE_LABELS: Record<AmendmentType, string> = {
  quantity: "Quantity change",
  colour: "Colour change",
  price: "Price change",
  sizes: "Add new sizes",
  delivery_date: "Delivery date change",
  consignee: "Consignee change",
  packing: "Packing method change",
  style: "Style change",
};

export const AMENDMENT_STATUSES = ["pending", "approved", "rejected"] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];

export const MILESTONE_STATUSES = ["pending", "in_progress", "done"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export interface SalesOrder {
  id: string;
  order_number: string | null;
  buyer_id: string;
  opportunity_id: string | null;
  quote_id: string | null;
  location_id: string | null;
  currency_code: string | null;
  order_qty: number;
  fob_price: number;
  total_value: number;
  baseline_fob: number | null;
  ship_date: string | null;
  status: OrderStatus;
  current_version: number;
  merchandiser_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SoLineItem {
  id: string;
  sales_order_id: string;
  color: string | null;
  size: string | null;
  quantity: number;
  created_at: string;
}

export interface OrderAmendment {
  id: string;
  sales_order_id: string;
  amendment_type: AmendmentType;
  description: string | null;
  details: Record<string, unknown>;
  profit_impact: number | null;
  status: AmendmentStatus;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decided_reason: string | null;
  created_at: string;
}

export interface TaPlan {
  id: string;
  sales_order_id: string;
  method: "template" | "auto";
  template_id: string | null;
  created_at: string;
}

export interface TaMilestone {
  id: string;
  ta_plan_id: string;
  sales_order_id: string;
  name: string;
  sequence: number;
  planned_date: string | null;
  actual_date: string | null;
  status: MilestoneStatus;
  created_at: string;
}

// ---------- input schemas ----------
export const orderLineInput = z.object({
  color: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative().default(0),
});

export const salesOrderInput = z.object({
  buyer_id: z.string().uuid(),
  opportunity_id: z.string().uuid().optional().nullable(),
  quote_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  fob_price: z.coerce.number().nonnegative().default(0),
  order_qty: z.coerce.number().nonnegative().default(0),
  ship_date: z.string().optional().nullable(),
  lines: z.array(orderLineInput).default([]),
});
export type SalesOrderInput = z.infer<typeof salesOrderInput>;

export const amendmentInput = z.object({
  sales_order_id: z.string().uuid(),
  amendment_type: z.enum(AMENDMENT_TYPES),
  description: z.string().optional().nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
  profit_impact: z.coerce.number().optional().nullable(),
});
export type AmendmentInput = z.infer<typeof amendmentInput>;

export const taPlanInput = z.object({
  sales_order_id: z.string().uuid(),
  method: z.enum(["template", "auto"]),
  template_id: z.string().uuid().optional().nullable(),
});
export type TaPlanInput = z.infer<typeof taPlanInput>;

/**
 * Traffic-light tone for a T&A milestone.
 * done → success; overdue → danger; due within 7 days → warning; else info.
 */
export function milestoneTone(
  m: Pick<TaMilestone, "planned_date" | "status">,
  now: Date = new Date(),
): StatusTone {
  if (m.status === "done") return "success";
  if (!m.planned_date) return "neutral";
  const planned = new Date(m.planned_date + "T00:00:00");
  const days = Math.floor((planned.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return "danger";
  if (days <= 7) return "warning";
  return "info";
}
