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
 * through ordinary Order Entry. The value decides which BOM plans the work
 * order — IWO Fabric BOM for Yarn / Fabric (0581), IWO Material BOM for
 * Accessories (0584) — each of whose guards refuses an IWO of the other kind,
 * and `iwo_for_lock` refuses a change of For once a BOM exists.
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

// ---------------------------------------------------------------------------
// What the screen sends — THE HEADER, AND NOTHING ELSE (2026-09-19).
//
// An IWO is a header; what it procures is planned on its BOM: IWO Fabric BOM
// for Yarn / Fabric (0581), IWO Material BOM for Accessories (0584). The line
// grids this schema used to carry, and their tables, went with 0582 / 0585.
// ---------------------------------------------------------------------------

const uuidN = z.string().uuid().nullable().default(null);

export const iwoInput = z.object({
  iwo_date: z.string().min(1, "Date is required"),
  iwo_for: z.enum(IWO_FOR, { message: "Choose what this work order is For" }),
  sales_order_id: uuidN,
  style_ref_no: capsTextNullable(),
  deli_date: z.string().nullable().default(null),
  remarks: capsTextNullable(),
});

/** `z.input`, not `z.infer` — what callers SEND, before the action parses it;
 *  every `.default()` field is optional going in. */
export type IwoInput = z.input<typeof iwoInput>;
export type IwoParsed = z.infer<typeof iwoInput>;
