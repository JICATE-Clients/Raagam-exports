import { StatusPill } from "@/components/ui/status-pill";
import { statusTone, type StatusTone } from "@/lib/ui/status-tone";
import { TRANSPORT_STATUS_LABEL } from "@/lib/logistics/transport/types";
import { cn } from "@/lib/utils";

/**
 * TRANSPORT'S OWN WORDS ON THE SHARED STATUS TABLE (AGENTS.md "Status colours
 * come from one table"). Three of them disagree with the table on purpose and
 * the rest are not in it at all:
 *
 * - `planned` is success in the table (a PLAN that is in force). A planned TRIP
 *   has not moved yet — neutral, like a requisition still pending a vehicle.
 * - `loading` / `unloading` are the vehicle standing at a gate — warning, the
 *   two states a dispatcher watches for a truck stuck at a dock.
 * - `en_route` is out of our hands — info, the table's "moving" bucket.
 * - `pooled` is a request picked for a trip not yet dispatched — info, beside
 *   `assigned`.
 * - `idle` is a vehicle free to take a trip — neutral; `maintenance` is one that
 *   cannot — warning.
 */
const TRANSPORT_STATUS = {
  planned: "neutral",
  loading: "warning",
  unloading: "warning",
  en_route: "info",
  pooled: "info",
  idle: "neutral",
  maintenance: "warning",
} as const;

export function transportStatusTone(status: string | null | undefined): StatusTone {
  return statusTone(status, TRANSPORT_STATUS);
}

export function TransportStatusPill({ status }: { status: string }) {
  return (
    <StatusPill tone={transportStatusTone(status)}>
      {TRANSPORT_STATUS_LABEL[status as keyof typeof TRANSPORT_STATUS_LABEL] ?? status}
    </StatusPill>
  );
}

/** "1,250 kg" — weights are always shown with their unit, never a bare figure. */
export function fmtKg(kg: number | null | undefined): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  return `${kg.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`;
}

/**
 * LOAD AGAINST PAYLOAD. Green to 90 %, amber 90–100 %, red past 100 % — the
 * one state Dispatch refuses (plan §Screens 4). The bar is clamped at 100 %
 * wide; the FIGURE is not, so an overload reads "112 %" rather than a full bar
 * that looks the same as a perfect load.
 */
export function UtilisationBar({ pct, className }: { pct: number; className?: string }) {
  const over = pct > 100;
  const tone = over ? "bg-danger" : pct >= 90 ? "bg-warning" : "bg-success";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"
        role="meter"
        aria-label="Load against payload"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={cn("w-12 text-right text-xs tabular-nums", over ? "font-semibold text-danger" : "text-muted-foreground")}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

/** A label · value pair in a document band — the shape the shipment page draws. */
export function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[9rem]">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}
