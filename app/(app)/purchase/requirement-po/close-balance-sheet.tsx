"use client";

import { useEffect, useState, useTransition } from "react";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtNumber } from "@/lib/format";
import { closeRequirementBalance, loadCloseBalances, reopenRequirementBalance } from "@/lib/purchase/re-po/actions";
import type { CloseBalanceLine, RequirementClosure } from "@/lib/purchase/re-po/types";
import { CloseReasonField, EMPTY_REASON, reasonText, type CloseReasonState } from "./close-reason";

/**
 * CLOSE BALANCES (0799, user 2026-11-03). One RE / SWO / IWO's lines that still have
 * something to order, each with Close: the remaining balance is closed with a
 * MANDATORY reason ("vendor cannot supply the balance") and leaves Raise PO's to-order
 * list. The lines already closed are listed below with their reason, and Reopen brings
 * a balance back. Opened from the pending row's lock icon on Raise PO.
 *
 * Every action writes at once (the database does the permission and visibility
 * checks), so the sheet has no Save of its own: Done closes it.
 *
 * CLOSE ALL (user 2026-11-06, the Close Balance spec: "closes all un-ordered residual lines
 * under the selected RE / SWO / IWO in one click"). One reason for every line still to
 * order, closed line by line through the same action, so each keeps its own audit row.
 * The reason is picked from the shared list (`close-reason.tsx`) or typed under OTHER.
 */
export function CloseBalanceSheet({
  source,
  origin,
  onClose,
  onChanged,
}: {
  /** The pending row: its id and number. `null` = closed. */
  source: { id: string; no: string } | null;
  origin?: SheetOrigin | null;
  onClose: () => void;
  /** A balance was closed or reopened: the list behind needs a refresh. */
  onChanged: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [lines, setLines] = useState<CloseBalanceLine[] | null>(null);
  const [closed, setClosed] = useState<RequirementClosure[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The line whose reason box is open ("*all*" = Close all), and the reason picked. */
  const [closing, setClosing] = useState<string | null>(null);
  const [reason, setReason] = useState<CloseReasonState>(EMPTY_REASON);
  const why = reasonText(reason);
  const [isPending, startTransition] = useTransition();
  // A half-typed reason must survive a silent deploy reload (AGENTS, "Auto-reload guard").
  useUnsavedGuard(!!reason.pick || isPending);

  const sourceId = source?.id ?? null;
  const reload = (id: string) =>
    startTransition(async () => {
      const res = await loadCloseBalances(id);
      if (res.ok) {
        setLines(res.lines);
        setClosed(res.closed);
        setLoadError(null);
      } else setLoadError(res.error);
    });

  // Load when it opens. The caller KEYS this sheet by source, so a different RE mounts it
  // fresh: its lines, reason box and closed list start clean without a reset here.
  useEffect(() => {
    if (sourceId) reload(sourceId);
  }, [sourceId]);

  const open = lines?.filter((l) => l.balance > 0.0005) ?? [];
  const lineOf = new Map((lines ?? []).map((l) => [l.req_key, l]));

  const refresh = async (id: string) => {
    const again = await loadCloseBalances(id);
    if (again.ok) {
      setLines(again.lines);
      setClosed(again.closed);
    }
  };

  const doCloseAll = () => {
    if (!sourceId || !why) return;
    const todo = open;
    startTransition(async () => {
      let done = 0;
      for (const l of todo) {
        const res = await closeRequirementBalance(sourceId, l.req_key, why);
        if (!res.ok) {
          toastError(done ? `Closed ${done} of ${todo.length}, then: ${res.error}` : res.error);
          break;
        }
        done++;
      }
      if (done === todo.length) success(`Closed all ${done} balance${done === 1 ? "" : "s"}`);
      setClosing(null);
      setReason(EMPTY_REASON);
      if (done) onChanged();
      await refresh(sourceId);
    });
  };

  const doClose = (l: CloseBalanceLine) => {
    if (!sourceId || !why) return;
    startTransition(async () => {
      const res = await closeRequirementBalance(sourceId, l.req_key, why);
      if (res.ok) {
        success(`Closed ${fmtNumber(res.closed)}${l.uom ? ` ${l.uom}` : ""} of ${l.item}`);
        setClosing(null);
        setReason(EMPTY_REASON);
        onChanged();
        const again = await loadCloseBalances(sourceId);
        if (again.ok) {
          setLines(again.lines);
          setClosed(again.closed);
        }
      } else toastError(res.error);
    });
  };

  const doReopen = (c: RequirementClosure) => {
    if (!sourceId) return;
    startTransition(async () => {
      const res = await reopenRequirementBalance(sourceId, c.req_key);
      if (res.ok) {
        success("Balance reopened — it is to order again");
        onChanged();
        const again = await loadCloseBalances(sourceId);
        if (again.ok) {
          setLines(again.lines);
          setClosed(again.closed);
        }
      } else toastError(res.error);
    });
  };

  return (
    <Sheet
      open={!!source}
      onClose={onClose}
      title={source ? `Close balances · ${source.no}` : "Close balances"}
      size="sm"
      /* Item name over its figures, a Close button, and the reason box under it: one
         column of ~26rem reads without wrapping the figures line. */
      maxWidthClass="max-w-[30rem]"
      alignToPane
      origin={origin}
      footer={
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Done
          </Button>
        </div>
      }
    >
      {loadError ? (
        <p className="text-sm text-danger" role="alert">
          {loadError}
        </p>
      ) : lines === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Still to order</h3>
              {open.length > 1 && closing !== "*all*" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    setClosing("*all*");
                    setReason(EMPTY_REASON);
                  }}
                >
                  Close all {open.length}
                </Button>
              ) : null}
            </div>
            {closing === "*all*" ? (
              <div className="space-y-2 rounded-lg border border-warning/50 bg-warning-soft/40 px-3 py-2.5">
                <p className="text-xs">Every line below stops being ordered. Each can still be reopened.</p>
                <CloseReasonField id="close-all-reason" value={reason} onChange={setReason} />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      setClosing(null);
                      setReason(EMPTY_REASON);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="danger" size="sm" disabled={isPending || !why} onClick={doCloseAll}>
                    Close all {open.length}
                  </Button>
                </div>
              </div>
            ) : null}
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing left to order on this one.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {open.map((l) => {
                  const u = l.uom ? ` ${l.uom}` : "";
                  const isOpen = closing === l.req_key;
                  return (
                    <li key={l.req_key} className="space-y-2 px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <Truncated className="block text-sm font-medium" text={l.item} />
                          {l.detail ? <Truncated className="block text-xs text-muted-foreground" text={l.detail} /> : null}
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            Required {fmtNumber(l.required)}
                            {u} · Ordered {fmtNumber(l.ordered)}
                            {u} · <span className="font-semibold text-warning">Balance {fmtNumber(l.balance)}
                            {u}</span>
                          </p>
                        </div>
                        {!isOpen ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => {
                              setClosing(l.req_key);
                              setReason(EMPTY_REASON);
                            }}
                          >
                            Close
                          </Button>
                        ) : null}
                      </div>
                      {isOpen ? (
                        <div className="space-y-2">
                          <CloseReasonField id={`close-reason-${l.req_key}`} value={reason} onChange={setReason} />
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isPending}
                              onClick={() => {
                                setClosing(null);
                                setReason(EMPTY_REASON);
                              }}
                            >
                              Cancel
                            </Button>
                            <Button variant="danger" size="sm" disabled={isPending || !why} onClick={() => doClose(l)}>
                              Close {fmtNumber(l.balance)}
                              {u}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {closed.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Closed</h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {closed.map((c) => {
                  const l = lineOf.get(c.req_key);
                  const u = l?.uom ? ` ${l.uom}` : "";
                  return (
                    <li key={c.req_key} className="flex items-start gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <Truncated className="block text-sm font-medium" text={l ? l.item : c.req_key} />
                        <p className="text-xs tabular-nums text-muted-foreground">
                          Closed {fmtNumber(c.closed_qty)}
                          {u} · {c.closed_by_name ?? "—"} · {fmtDate(c.closed_at)}
                        </p>
                        <p className="mt-0.5 text-xs">{c.reason}</p>
                      </div>
                      <Button variant="outline" size="sm" disabled={isPending} onClick={() => doReopen(c)}>
                        Reopen
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
