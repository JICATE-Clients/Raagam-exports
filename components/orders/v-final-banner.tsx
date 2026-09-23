import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import type { VFinalState } from "@/lib/orders/amendments/v-final";
import type { VFinalSource } from "@/lib/orders/order-reports";

/**
 * WHICH VERSION THIS REPORT IS PRINTING (doc/order/amenment update.md §4B,
 * 0619) — said above the document, and never printed with it (`print:hidden`
 * is deliberately NOT set on the frozen case: a sheet printed from V_final
 * carries its own "approved version" line so a copy on the floor can be told
 * from a proposal).
 *
 *   frozen   → "Approved version V1 — amendment AMD/… is open"; a link to
 *              the proposed data for the merchandiser who is working on it.
 *   proposed → the same banner in warning tone, saying the figures are NOT
 *              approved, with the way back.
 *   missing  → the approved version was never captured (an entry raised
 *              before 0619, or a capture that failed): the report shows the
 *              live rows, and this says loudly that they are unapproved.
 *
 * Server-safe: no hooks, no client state.
 */
export function VFinalBanner({
  state,
  proposed,
  hrefApproved,
  hrefProposed,
}: {
  state: VFinalState<VFinalSource>;
  /** The operator asked for the proposed (in-flight) data. */
  proposed: boolean;
  hrefApproved: string;
  hrefProposed: string;
}) {
  if (state.state === "live") return null;
  const entry = state.entryNo ?? "an open revision";
  const version = `V${state.version}`;

  if (state.state === "missing") {
    return (
      <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
        Revision {entry} is open, and this report&apos;s approved version ({version}) was not captured when it was
        raised. The figures below are the revision&apos;s — NOT APPROVED — and must not be issued until the MD decides.
      </p>
    );
  }

  if (proposed) {
    return (
      <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs text-warning print:hidden" role="alert">
        Showing the PROPOSED revision {entry} — not approved.{" "}
        <Link href={hrefApproved} className="font-semibold underline">
          Back to the approved version ({version})
        </Link>
      </p>
    );
  }

  return (
    <p className="rounded-md border border-info bg-info-soft px-3 py-2 text-xs text-info" role="status">
      Approved version {version} — as approved before revision {entry} (captured {fmtDateTime(state.capturedAt)}).
      The revision&apos;s changes are not on this report until the MD approves them.{" "}
      <Link href={hrefProposed} className="font-semibold underline print:hidden">
        Show the proposed changes
      </Link>
    </p>
  );
}
