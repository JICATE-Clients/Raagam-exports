"use client";

import { useState, useTransition, useEffect } from "react";
import {
  addPoSizeDelivery,
  deletePoSizeDelivery,
  addPoDeliverySize,
  deletePoDeliverySize,
  addPoItemSizeDelivery,
  deletePoItemSizeDelivery,
  // Reads come through actions, not from `po-service` directly: the service is
  // `server-only` and this is a client component, so importing it here failed
  // the build outright.
  fetchPoSizeDeliveries,
  fetchPoDeliverySizes,
  fetchPoItemSizeDeliveries,
} from "@/lib/purchase/po-actions";
import type {
  PoSizeDelivery,
  PoDeliverySize,
  PoItemSizeDelivery,
} from "@/lib/purchase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate, fmtNumber, fmtMoney } from "@/lib/format";
import { useToast } from "@/components/ui/toast";

// ---------- Band 2: Size Deliveries ----------

function SizeDeliveryRow({
  sd,
  poId,
  canEdit,
}: {
  sd: PoSizeDelivery;
  poId: string;
  canEdit: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [sizes, setSizes] = useState<PoDeliverySize[]>([]);

  function loadSizes() {
    setExpanded((v) => {
      if (!v) {
        fetchPoDeliverySizes(sd.id).then(setSizes);
      }
      return !v;
    });
  }

  function handleDeleteSd() {
    startTransition(async () => {
      const result = await deletePoSizeDelivery(sd.id, poId);
      if (result.ok) success("Delivery schedule removed.");
      else toastError(result.error);
    });
  }

  function handleAddSize() {
    startTransition(async () => {
      const result = await addPoDeliverySize(poId, {
        po_size_delivery_id: sd.id,
        quantity: 0,
        sort_order: sizes.length,
      });
      if (result.ok) {
        success("Size added.");
        fetchPoDeliverySizes(sd.id).then(setSizes);
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDeleteSize(sizeId: string) {
    startTransition(async () => {
      const result = await deletePoDeliverySize(sizeId, poId);
      if (result.ok) {
        success("Size removed.");
        setSizes((prev) => prev.filter((s) => s.id !== sizeId));
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="rounded border border-border p-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-4">
          <button type="button" onClick={loadSizes} className="text-xs text-primary hover:underline">
            {expanded ? "[-]" : "[+]"} Sizes
          </button>
          <span>Date: {sd.delivery_date ? fmtDate(sd.delivery_date) : "--"}</span>
          <span>Qty: {fmtNumber(sd.quantity)}</span>
          <span>Rolls: {fmtNumber(sd.rolls)}</span>
          <span>Wt: {fmtNumber(sd.weight)}</span>
          <span className="font-medium">Value: {fmtMoney(sd.po_value)}</span>
        </div>
        {canEdit && (
          <Button size="sm" variant="ghost" className="text-danger" disabled={isPending} onClick={handleDeleteSd}>
            Delete
          </Button>
        )}
      </div>

      {expanded && (
        <div className="mt-2 ml-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Delivery Sizes (Band 3)</span>
            {canEdit && (
              <Button size="sm" variant="outline" disabled={isPending} onClick={handleAddSize}>+ Add Size</Button>
            )}
          </div>
          {sizes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sizes.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="px-2 py-1 text-left">BOM Size</th>
                  <th className="px-2 py-1 text-left">Item Size</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1 text-right">Wt</th>
                  <th className="px-2 py-1 text-right">Value</th>
                  {canEdit && <th className="px-2 py-1" />}
                </tr>
              </thead>
              <tbody>
                {sizes.map((sz) => (
                  <tr key={sz.id} className="border-b border-border/30">
                    <td className="px-2 py-1">{sz.bom_size ?? "--"}</td>
                    <td className="px-2 py-1">{sz.item_size ?? "--"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtNumber(sz.quantity)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtNumber(sz.weight)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(sz.po_value)}</td>
                    {canEdit && (
                      <td className="px-2 py-1 text-right">
                        <Button size="sm" variant="ghost" className="text-danger" disabled={isPending} onClick={() => handleDeleteSize(sz.id)}>X</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Band 4: Item Size Deliveries ----------

function ItemSizeDeliveriesPanel({
  lineItemId,
  poId,
  canEdit,
}: {
  lineItemId: string;
  poId: string;
  canEdit: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [deliveries, setDeliveries] = useState<PoItemSizeDelivery[]>([]);
  const [loaded, setLoaded] = useState(false);

  function load() {
    fetchPoItemSizeDeliveries(lineItemId).then((d) => {
      setDeliveries(d);
      setLoaded(true);
    });
  }

  useEffect(() => { load(); }, [lineItemId]);

  function handleAdd() {
    startTransition(async () => {
      const result = await addPoItemSizeDelivery(poId, {
        po_line_item_id: lineItemId,
        quantity: 0,
        sort_order: deliveries.length,
      });
      if (result.ok) {
        success("Item size delivery added.");
        load();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePoItemSizeDelivery(id, poId);
      if (result.ok) {
        success("Removed.");
        setDeliveries((prev) => prev.filter((d) => d.id !== id));
      } else {
        toastError(result.error);
      }
    });
  }

  if (!loaded) return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Item Size Deliveries (Band 4)</span>
        {canEdit && (
          <Button size="sm" variant="outline" disabled={isPending} onClick={handleAdd}>+ Add</Button>
        )}
      </div>
      {deliveries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No item size deliveries.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50">
              <th className="px-2 py-1 text-left">BOM Size</th>
              <th className="px-2 py-1 text-left">Item Size</th>
              <th className="px-2 py-1 text-right">Stitch Len</th>
              <th className="px-2 py-1 text-right">Loop Len</th>
              <th className="px-2 py-1 text-right">Qty</th>
              <th className="px-2 py-1 text-right">Wt</th>
              <th className="px-2 py-1 text-right">Value</th>
              {canEdit && <th className="px-2 py-1" />}
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id} className="border-b border-border/30">
                <td className="px-2 py-1">{d.bom_size ?? "--"}</td>
                <td className="px-2 py-1">{d.item_size ?? "--"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{d.stitch_length ?? "--"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{d.loop_length ?? "--"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtNumber(d.quantity)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtNumber(d.weight)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(d.po_value)}</td>
                {canEdit && (
                  <td className="px-2 py-1 text-right">
                    <Button size="sm" variant="ghost" className="text-danger" disabled={isPending} onClick={() => handleDelete(d.id)}>X</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Main export: Delivery Editor per PO line ----------

export function PoDeliveryEditor({
  lineItemId,
  poId,
  isSizeWise,
  canEdit,
}: {
  lineItemId: string;
  poId: string;
  isSizeWise: boolean;
  canEdit: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [sizeDeliveries, setSizeDeliveries] = useState<PoSizeDelivery[]>([]);
  const [loaded, setLoaded] = useState(false);

  function load() {
    fetchPoSizeDeliveries(lineItemId).then((d) => {
      setSizeDeliveries(d);
      setLoaded(true);
    });
  }

  useEffect(() => {
    if (isSizeWise) load();
    else setLoaded(true);
  }, [lineItemId, isSizeWise]);

  function handleAddSizeDelivery() {
    startTransition(async () => {
      const result = await addPoSizeDelivery(poId, {
        po_line_item_id: lineItemId,
        quantity: 0,
        sort_order: sizeDeliveries.length,
      });
      if (result.ok) {
        success("Delivery schedule added.");
        load();
      } else {
        toastError(result.error);
      }
    });
  }

  if (!loaded) return null;

  return (
    <div className="mt-2 space-y-2 rounded border border-dashed border-border/60 bg-surface-muted/50 p-3">
      {/* Band 2: Size Deliveries (if size-wise) */}
      {isSizeWise && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Size-wise Deliveries (Band 2)</span>
            {canEdit && (
              <Button size="sm" variant="outline" disabled={isPending} onClick={handleAddSizeDelivery}>+ Add Delivery</Button>
            )}
          </div>
          {sizeDeliveries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No size-wise deliveries. Add one above.</p>
          ) : (
            <div className="space-y-2">
              {sizeDeliveries.map((sd) => (
                <SizeDeliveryRow key={sd.id} sd={sd} poId={poId} canEdit={canEdit} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Band 4: Item Size Deliveries (always available as alternate) */}
      {!isSizeWise && (
        <ItemSizeDeliveriesPanel lineItemId={lineItemId} poId={poId} canEdit={canEdit} />
      )}
    </div>
  );
}
