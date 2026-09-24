"use client";

import { useCallback, useEffect, useState } from "react";
import { loadFabricTaForGarmentOrder } from "@/lib/orders/fabric-ta/actions";
import type { FabricTaResult } from "@/lib/orders/fabric-ta/service";
import { recallTaView, rememberTaView } from "@/lib/orders/ta-view-cache";
import { FabricTaLadder } from "./fabric-ta-ladder";

/**
 * Fabric BOM ▸ T&A — steps 6–11 for the order this BOM belongs to (client
 * 2026-09-21: "move it inside the Fabric BOM as a tab"; it was its own sidebar
 * row, Orders ▸ Fabric T&A, for an afternoon).
 *
 * ## IT FETCHES ITS OWN DATA, SO THE EDITOR GAINS ONE SECTION ENTRY AND NO STATE
 *
 * The Fabric BOM screen is one client component opening many BOMs; the tracker's
 * read (the requirement report, the order's T&A dates, every PO / GRN / process
 * document) is heavy. Keeping the fetch here means the 11,000-line editor holds
 * no tracker state, and the read happens only for a BOM whose tab is shown.
 *
 * ## IT TRACKS THE ORDER'S CURRENT RECORDED BOM, NOT NECESSARILY THIS ONE
 *
 * The documents belong to the ORDER, and the requirement they are judged
 * against is the order's current recorded Fabric BOM — `currentFabricBom()`,
 * the one rule every per-order report resolves "current" by. A draft, or an
 * older revision, is not what the store is buying against. When the BOM open in
 * the editor is not that one, the tab says so rather than silently showing
 * another document's figures under this one's heading.
 */
export function FabricTaTab({
  garmentOrderId,
  bomId,
}: {
  /** The editor's `form.garment_order_id` — null until an order is picked. */
  garmentOrderId: string | null;
  /** The BOM open in the editor — null for one not yet saved. */
  bomId: string | null;
}) {
  const [state, setState] = useState<
    | { for: string; data: FabricTaResult; error?: undefined }
    | { for: string; error: string; data?: undefined }
    | null
  >(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!garmentOrderId) return;
    let cancelled = false;
    loadFabricTaForGarmentOrder(garmentOrderId).then((res) => {
      if (res.ok) rememberTaView(`fabric:${garmentOrderId}`, res.result);
      if (cancelled) return;
      setState(res.ok ? { for: garmentOrderId, data: res.result } : { for: garmentOrderId, error: res.error });
    });
    return () => {
      cancelled = true;
    };
  }, [garmentOrderId, nonce]);

  if (!garmentOrderId) {
    return <p className="text-sm text-muted-foreground">Pick the garment order first — the T&A follows that order.</p>;
  }
  // A result for a PREVIOUS order is never shown under this one. With no
  // answer yet for THIS order, the last one read for it stands in while the
  // fresh read runs (`ta-view-cache.ts` — the tab remounts on every return).
  const remembered = recallTaView<FabricTaResult>(`fabric:${garmentOrderId}`);
  const current =
    state && state.for === garmentOrderId ? state : remembered ? { for: garmentOrderId, data: remembered } : null;
  if (!current) return <p className="text-sm text-muted-foreground">Reading the order&apos;s T&A…</p>;
  if (!current.data) return <p className="text-sm text-danger">{current.error}</p>;

  const ta = current.data;
  const order = ta.orders[0] ?? null;
  if (!order) {
    return (
      <p className="text-sm text-muted-foreground">
        {ta.notes[0] ??
          "This order has no recorded Fabric BOM yet — save one out of draft and its yarn, knitting and processing steps are scheduled here."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {bomId !== order.bomId && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {bomId
            ? "This is not the order's current recorded Fabric BOM, so the steps below are measured against that one — the store buys against the current BOM, not a draft or an older revision."
            : "This BOM is not saved yet. The steps below are measured against the order's current recorded Fabric BOM."}
        </p>
      )}
      {ta.notes.map((n) => (
        <p key={n} className="text-sm text-muted-foreground">
          {n}
        </p>
      ))}
      {/* ONE GROUPED LADDER (client 2026-09-21), the per-material board
          folded beneath it as the backup. */}
      <FabricTaLadder
        order={order}
        staffNames={ta.staffNames}
        viewerEmployeeId={ta.viewerEmployeeId}
        canEdit={ta.canEdit}
        today={ta.today}
        onSaved={reload}
      />
    </div>
  );
}
