"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fmtDateTime } from "@/lib/format";

/**
 * THE ONE TIME AN ANONYMOUS COMPLAINANT SEES THEIR TRACKING LINK.
 *
 * Only the token's hash is stored (plan §10.2), so nothing — not the handler,
 * not an administrator, not this app — can show it again. That is why it is
 * rendered from the submit action's result IN PLACE and never travels anywhere
 * else: not into a URL of this app (history, logs, referrers), not into
 * localStorage, not into a toast or the console.
 *
 * The parent keeps the reload guard up while this is on screen: a silent
 * deploy reload here would destroy the only copy of the link.
 */
export function AnonymousReceipt({
  refNo,
  trackingUrl,
  responseDueAt,
  onDone,
}: {
  refNo: string;
  trackingUrl: string;
  responseDueAt: string | null;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="w-full max-w-[40rem] space-y-4">
      <div role="status" className="rounded-lg border border-success/40 bg-success-soft/50 p-4">
        <p className="text-sm font-semibold text-foreground">
          Complaint sent anonymously — reference <span className="font-mono">{refNo}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your name was not stored with it.
          {responseDueAt ? ` The handler must respond by ${fmtDateTime(responseDueAt)}, or it is escalated.` : ""}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-warning/50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-warning" aria-hidden />
          Your private tracking link
        </p>
        <p className="break-all rounded-md bg-surface-muted p-3 font-mono text-sm text-foreground select-all">
          {trackingUrl}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={copy}>
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          {copyError ? (
            <span className="text-xs text-warning">Copy did not work here — select the link above and copy it by hand.</span>
          ) : null}
        </div>
        <p className="flex items-start gap-2 text-sm text-foreground">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <span>
            <strong>Save this link now. It will not be shown again</strong> and cannot be recovered —
            we do not know who sent this complaint, so we cannot send it to you. Anyone with the
            link can see the complaint&apos;s status, so keep it private. It works without signing in.
          </span>
        </p>
      </div>

      {/* No link off this screen but the one below — leaving is the moment the
          token is lost, so it is a deliberate press, confirmed if nothing was copied. */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => (copied ? onDone() : setConfirmLeave(true))}>
          I have saved the link
        </Button>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title="Leave without copying the link?"
        body="You did not press Copy. Once you leave, the tracking link is gone for good and this complaint can only be followed by its handler."
        confirmLabel="Leave anyway"
        cancelLabel="Stay"
        tone="danger"
        onConfirm={onDone}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
