"use client";

import { useState, useTransition } from "react";
import { Lock } from "lucide-react";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtNumber } from "@/lib/format";
import { closeRequirementBalance } from "@/lib/purchase/re-po/actions";
import { CloseReasonField, EMPTY_REASON, reasonText, type CloseReasonState } from "./close-reason";

/** What one editor row closes: every size under it is its own requirement line. */
export type CloseLineTarget = {
  title: string;
  detail: string;
  uom: string | null;
  required: number;
  ordered: number;
  balance: number;
  /** Each size's requirement line: the RE / SWO / IWO it belongs to and its key. */
  members: { sourceId: string; reqKey: string }[];
  origin: SheetOrigin | null;
};

/**
 * CLOSE BALANCE ON THE ROW (user 2026-11-06, the Close Balance spec: "close balance per line
 * … disables further PO generation for the line item"). The editor's lock icon, beside Skip:
 *
 *   Skip  — not on THIS PO; the balance stays to order on another.
 *   Close — never order the rest: the balance leaves Raise PO until someone reopens it.
 *
 * It writes at once through the same action as the list's Close balances sheet (0799 — the
 * database checks permission and visibility, the reason is mandatory, an audit row is kept),
 * one call per size. The row then leaves the editor, because the page only lists lines with
 * a balance. Reopen is on the list's sheet and on the RE's purchase-status report.
 */
export function CloseLineSheet({ target, onClose, onClosed }: { target: CloseLineTarget | null; onClose: () => void; onClosed: () => void }) {
  const { success, error: toastError } = useToast();
  const [reason, setReason] = useState<CloseReasonState>(EMPTY_REASON);
  const [isPending, start] = useTransition();
  // A picked reason must survive a silent deploy reload (AGENTS, "Auto-reload guard").
  useUnsavedGuard(!!reason.pick || isPending);

  const why = reasonText(reason);
  const u = target?.uom ? ` ${target.uom}` : "";

  const doClose = () => {
    if (!target || !why) return;
    start(async () => {
      let closed = 0;
      for (const m of target.members) {
        const res = await closeRequirementBalance(m.sourceId, m.reqKey, why);
        if (!res.ok) {
          toastError(closed ? `Closed part of it, then: ${res.error}` : res.error);
          if (closed) onClosed();
          return;
        }
        closed += res.closed;
      }
      success(`Closed ${fmtNumber(closed)}${u} of ${target.title} — it will not be ordered again`);
      setReason(EMPTY_REASON);
      onClosed();
    });
  };

  return (
    <Sheet
      open={!!target}
      onClose={() => {
        setReason(EMPTY_REASON);
        onClose();
      }}
      title="Close balance"
      size="sm"
      maxWidthClass="max-w-[28rem]"
      alignToPane
      origin={target?.origin ?? null}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => {
              setReason(EMPTY_REASON);
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button variant="danger" disabled={isPending || !why} onClick={doClose}>
            <Lock aria-hidden className="size-4" />
            Close {target ? fmtNumber(target.balance) : ""}
            {u}
          </Button>
        </div>
      }
    >
      {target ? (
        <div className="space-y-4">
          <div>
            <Truncated className="block text-sm font-semibold" text={target.title} />
            {target.detail ? <Truncated className="block text-xs text-muted-foreground" text={target.detail} /> : null}
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              Required {fmtNumber(target.required)}
              {u} · Ordered {fmtNumber(target.ordered)}
              {u} · <span className="font-semibold text-warning">Balance {fmtNumber(target.balance)}
              {u}</span>
            </p>
          </div>
          <CloseReasonField id="close-line-reason" value={reason} onChange={setReason} />
        </div>
      ) : null}
    </Sheet>
  );
}
