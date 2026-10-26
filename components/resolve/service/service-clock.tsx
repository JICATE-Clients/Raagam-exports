import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/lib/ui/tone";
import { spanWords } from "@/lib/resolve/sla";
import type { ResolutionState, ResponseState } from "@/lib/resolve/desk-types";
import { SERVICE_STATUS_LABEL, type ServiceStatus, type TicketStatus } from "@/lib/resolve/types";

/*
 * The words and tones a service ticket's two SLA clocks are read in. The
 * STATE is always the server's (`response_state` / `resolution_state`,
 * computed in SQL — never `Date.now()` in a render); this only words it.
 */

// status-tone: exempt -- an SLA CLOCK state (rh_sd_queue), not a record status
export const RESPONSE_TONE: Record<ResponseState, StatusTone> = {
  met: "success",
  pending: "info",
  breached: "danger",
};

// status-tone: exempt -- an SLA CLOCK state (rh_sd_queue), not a record status
export const RESOLUTION_TONE: Record<ResolutionState, StatusTone> = {
  on_track: "success",
  at_risk: "warning",
  breached: "danger",
  paused: "neutral",
  done: "neutral",
};

const RESPONSE_WORD: Record<ResponseState, string> = {
  met: "Responded",
  pending: "Waiting for a response",
  breached: "Response overdue",
};

const RESOLUTION_WORD: Record<ResolutionState, string> = {
  on_track: "On track",
  at_risk: "At risk",
  breached: "Overdue",
  paused: "Paused while on hold",
  done: "Done",
};

/** "45 min left" · "2 hours over" — from the server's minutes. */
export function minutesWords(minutesLeft: number | null): string {
  if (minutesLeft == null) return "";
  const ms = minutesLeft * 60_000;
  return minutesLeft >= 0 ? `${spanWords(ms)} left` : `${spanWords(ms)} over`;
}

export function ResponseClock({ state }: { state: ResponseState }) {
  return <StatusPill tone={RESPONSE_TONE[state]}>{RESPONSE_WORD[state]}</StatusPill>;
}

export function ResolutionClock({ state, minutesLeft }: { state: ResolutionState; minutesLeft: number | null }) {
  const extra = state === "on_track" || state === "at_risk" || state === "breached" ? minutesWords(minutesLeft) : "";
  return (
    <StatusPill tone={RESOLUTION_TONE[state]}>
      {RESOLUTION_WORD[state]}
      {extra ? ` · ${extra}` : ""}
    </StatusPill>
  );
}

/** A status word for any kind: a service ticket's `open` reads "New". */
export function statusLabelFor(kind: string, status: TicketStatus, fallback: Record<string, string>): string {
  if (kind === "service") return SERVICE_STATUS_LABEL[status as ServiceStatus] ?? status;
  return fallback[status] ?? status;
}
