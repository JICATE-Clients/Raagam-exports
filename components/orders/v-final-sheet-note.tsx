"use client";

import { fmtDateTime } from "@/lib/format";

/** What `loadVFinalForBom` hands a sheet — its payload is read by the sheet itself. */
export type SheetVFinal =
  | { state: "live" }
  | { state: "error"; error: string }
  | { state: "missing"; entryId: string; entryNo: string | null; version: number }
  | { state: "frozen"; entryId: string; entryNo: string | null; capturedAt: string; version: number; payload: unknown };

/**
 * The editors' report sheets say which version they print (0619, spec §4B) —
 * the sheet twin of `VFinalBanner`, with a button instead of a link because
 * the sheet has no URL of its own.
 */
export function VFinalSheetNote({
  vf,
  proposed,
  onToggle,
}: {
  vf: SheetVFinal;
  proposed: boolean;
  onToggle: () => void;
}) {
  if (vf.state === "live") return null;
  if (vf.state === "error") {
    return (
      <p className="mb-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
        Could not tell whether this order is being amended ({vf.error}) — treat the figures below as unconfirmed.
      </p>
    );
  }
  const entry = vf.entryNo ?? "an open revision";
  if (vf.state === "missing") {
    return (
      <p className="mb-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
        Revision {entry} is open and the approved version (V{vf.version}) was not captured — these figures are the
        revision&apos;s, NOT APPROVED.
      </p>
    );
  }
  return (
    <p
      className={
        proposed
          ? "mb-3 rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs text-warning"
          : "mb-3 rounded-md border border-info bg-info-soft px-3 py-2 text-xs text-info"
      }
      role="status"
    >
      {proposed
        ? `Showing the PROPOSED revision ${entry} — not approved. `
        : `Approved version V${vf.version} — as approved before revision ${entry} (captured ${fmtDateTime(vf.capturedAt)}). `}
      <button type="button" className="font-semibold underline hover:no-underline" onClick={onToggle}>
        {proposed ? `Back to the approved version (V${vf.version})` : "Show the proposed changes"}
      </button>
    </p>
  );
}
