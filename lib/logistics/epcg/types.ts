import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";
import { statusTone } from "@/lib/ui/status-tone";

export const EPCG_STATUSES = [
  "active",
  "fulfilled",
  "expired",
  "cancelled",
] as const;
export type EpcgStatus = (typeof EPCG_STATUSES)[number];

export const EPCG_STATUS_LABELS: Record<EpcgStatus, string> = {
  active: "Active",
  fulfilled: "Fulfilled",
  expired: "Expired",
  cancelled: "Cancelled",
};

// An ACTIVE licence still owes its export obligation — Fulfilled is the
// success state here, so Active reads as "in progress", not "done".
const EPCG_TONES = { active: "info" } as const;

export function epcgStatusTone(status: EpcgStatus): StatusTone {
  return statusTone(status, EPCG_TONES);
}

export interface EpcgDeclaration {
  id: string;
  code: string | null;
  license_number: string | null;
  authorisation_date: string | null;
  expiry_date: string | null;
  currency_code: string | null;
  duty_saved: number;
  export_obligation: number;
  obligation_fulfilled: number;
  status: EpcgStatus;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Percentage of the export obligation fulfilled (0–100, capped). */
export function obligationPct(
  e: Pick<EpcgDeclaration, "export_obligation" | "obligation_fulfilled">,
): number {
  if (!e.export_obligation) return 0;
  return Math.min(100, Math.round((e.obligation_fulfilled / e.export_obligation) * 100));
}

export const epcgInput = z.object({
  license_number: z.string().optional().nullable(),
  authorisation_date: z.string().optional().nullable(),
  expiry_date: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  duty_saved: z.coerce.number().nonnegative().default(0),
  export_obligation: z.coerce.number().nonnegative().default(0),
  obligation_fulfilled: z.coerce.number().nonnegative().default(0),
  remarks: z.string().optional().nullable(),
});
export type EpcgInput = z.infer<typeof epcgInput>;
