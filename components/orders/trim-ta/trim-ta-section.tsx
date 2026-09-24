"use client";

import { useCallback, useEffect, useState } from "react";
import { loadTrimTaForGarmentOrder } from "@/lib/orders/trim-ta/actions";
import type { TrimTaResult } from "@/lib/orders/trim-ta/service";
import { recallTaView, rememberTaView } from "@/lib/orders/ta-view-cache";
import { TrimsOrderBoard } from "./trims-order-board";

type Loaded = { key: string; result: { ok: true; data: TrimTaResult } | { ok: false; error: string } };

/**
 * Material BOM ▸ Trims T&A — steps 12–17 of `doc/order/materialbomtana.md`
 * for the order this BOM belongs to (client 2026-09-21: a tab of Material BOM,
 * not a separate screen).
 *
 * ## IT SHOWS THE RECORDED BOM, NOT THE GRID ABOVE IT
 *
 * The schedule is judged against the same BOM the PO gate caps against — the
 * newest one saved out of draft. So an edit in the Items grid appears here only
 * after Save, and this section says so rather than leaving the operator to
 * wonder why a material they just added has no steps. Its own edits (tolerance,
 * done date, owner) save immediately and never touch the BOM's dirty state.
 */
export function TrimTaSection({ garmentOrderId, bomDirty }: { garmentOrderId: string | null; bomDirty: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [nonce, setNonce] = useState(0);
  // `bomDirty` is in the key so a BOM Save (dirty → clean) re-reads: the
  // recorded BOM this section judges against may just have changed.
  const key = `${garmentOrderId ?? ""}|${nonce}|${bomDirty ? 1 : 0}`;

  useEffect(() => {
    if (!garmentOrderId) return;
    let alive = true;
    loadTrimTaForGarmentOrder(garmentOrderId).then((result) => {
      if (result.ok) rememberTaView(`trim:${garmentOrderId}`, result.data);
      if (alive) setLoaded({ key, result });
    });
    return () => {
      alive = false;
    };
  }, [garmentOrderId, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  if (!garmentOrderId) {
    return <p className="text-xs text-muted-foreground">Pick a garment order first — trims are scheduled against its cutting and packing dates.</p>;
  }
  // Keep showing the previous answer while a reload after an edit is in flight,
  // so the board does not blink out under the operator's cursor.
  // Before the first answer for this order lands, the last one read for it
  // stands in — the section remounts on every return (`ta-view-cache.ts`).
  const remembered = recallTaView<TrimTaResult>(`trim:${garmentOrderId}`);
  const current =
    loaded && (loaded.key === key || loaded.key.startsWith(`${garmentOrderId}|`))
      ? loaded
      : remembered
        ? { key, result: { ok: true as const, data: remembered } }
        : null;
  if (!current) return <p className="text-xs text-muted-foreground">Reading the trims schedule…</p>;
  if (!current.result.ok) return <p className="text-xs text-danger">{current.result.error}</p>;

  const ta = current.result.data;
  const order = ta.orders[0] ?? null;

  return (
    <div className="space-y-3">
      {order ? (
        <p className="text-xs text-muted-foreground">
          From the recorded Material BOM{order.bomCode ? ` ${order.bomCode}` : ""} — each trim&apos;s PO, receipt and
          job-work steps, completed automatically from purchase orders, GRNs and delivery challans.
          {bomDirty && " Unsaved changes above appear here after Save."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {ta.notes[0] ??
            "No sewing or packing trims on a recorded Material BOM for this order yet — save the BOM (not as draft) to schedule them."}
        </p>
      )}
      {order &&
        ta.notes.map((n) => (
          <p key={n} className="text-xs text-muted-foreground">
            {n}
          </p>
        ))}
      {order && (
        <TrimsOrderBoard
          order={order}
          staffNames={ta.staffNames}
          viewerEmployeeId={ta.viewerEmployeeId}
          canEdit={ta.canEdit}
          today={ta.today}
          onChanged={reload}
        />
      )}
    </div>
  );
}
