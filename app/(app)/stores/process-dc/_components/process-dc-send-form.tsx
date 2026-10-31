"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { saveProcessDc } from "@/lib/stores/process-dc-actions";
import type { OpenProcessOrder, ProcessDc } from "@/lib/stores/process-dc-service";
import type { BinOption, StockOption, StoreOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";

/**
 * PROCESS DC — SEND (doc/stores/dc-plan.md Phase 2, 0786). Job work goes out against a
 * PROCESS ORDER, always (user 2026-10-31): pick the order and its lines load with what is
 * still to send. The vendor and process are the order's. A line's qty is locked to BOTH
 * the order's balance and what the chosen store holds; `process_dc_dispatch` re-checks
 * both and moves the goods into this unit's Processing store ("at vendor").
 */

type Line = {
  key: string;
  itemId: string;
  item: string;
  uom: string | null;
  ordered: number;
  sent: number;
  balance: number;
  qty: string;
  storeId: string;
  binId: string;
  lotNo: string;
};

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function ProcessDcSendForm({
  orders,
  stores,
  bins,
  stock,
  existing,
  initialOrderId,
}: {
  orders: OpenProcessOrder[];
  stores: StoreOption[];
  bins: BinOption[];
  stock: StockOption[];
  existing: ProcessDc | null;
  initialOrderId: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  // Send FROM a holding store, never from Processing (that IS the vendor's side) or Transit.
  const sendStores = stores.filter((s) => s.store_type !== "processing");
  const defaultStore = sendStores.find((s) => s.store_type === "material")?.id ?? sendStores[0]?.id ?? "";

  const linesOf = (orderId: string): Line[] => {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return [];
    return o.lines
      .filter((l) => l.item_id && l.balance > 0)
      .map((l) => {
        const was = existing?.lines.find((x) => x.process_order_line_id === l.id);
        return {
          key: l.id,
          itemId: l.item_id!,
          item: l.item_name,
          uom: l.uom,
          ordered: l.ordered,
          sent: l.sent,
          balance: l.balance,
          qty: was ? String(was.sent_qty) : "",
          storeId: was?.from_store_id ?? defaultStore,
          binId: was?.bin_id ?? "",
          lotNo: was?.lot_no ?? "",
        };
      });
  };

  const startOrder = existing?.process_order_id ?? initialOrderId ?? "";
  const [orderId, setOrderId] = useState(startOrder);
  const [lines, setLines] = useState<Line[]>(() => (startOrder ? linesOf(startOrder) : []));
  const order = orders.find((o) => o.id === orderId) ?? null;
  const [dcDate, setDcDate] = useState(existing?.dc_date ?? today());
  const [expected, setExpected] = useState(existing?.expected_return_date ?? order?.expected_date ?? "");
  const [vehicle, setVehicle] = useState(existing?.vehicle_no ?? "");
  const [transporter, setTransporter] = useState(existing?.transporter ?? "");
  const [eway, setEway] = useState(existing?.eway_bill_no ?? "");
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const orderOptions: ComboboxOption[] = orders.map((o) => ({
    value: o.id,
    label: o.code ?? "(no number)",
    sublabel: `${o.vendor_name} · ${o.process_type.toUpperCase()}${o.order_no ? ` · ${o.order_no}` : ""}`,
    search: `${o.vendor_name} ${o.process_type} ${o.order_no ?? ""}`,
  }));

  const have = (l: Line) => stock.find((s) => s.store_id === l.storeId && s.item_id === l.itemId)?.qty ?? 0;
  function update(key: string, patch: Partial<Omit<Line, "key">>) {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  const problemOf = (l: Line): string | null => {
    const q = num(l.qty);
    if (q <= 0) return null;
    if (q > l.balance + 1e-9) return `Only ${fmtNumber(l.balance)} left on the order`;
    if (q > have(l) + 1e-9) return `Only ${fmtNumber(have(l))} in this store`;
    return null;
  };
  const sending = lines.filter((l) => num(l.qty) > 0);
  const problems = sending.some((l) => !!problemOf(l) || !l.storeId);
  const canSave = !isPending && !!orderId && !!dcDate && sending.length > 0 && !problems;

  function save(dispatch: boolean) {
    if (!canSave) return;
    startTransition(async () => {
      const result = await saveProcessDc(
        existing?.id ?? null,
        {
          process_order_id: orderId,
          dc_date: dcDate,
          expected_return_date: expected || null,
          vehicle_no: vehicle.trim() || null,
          transporter: transporter.trim() || null,
          eway_bill_no: eway.trim() || null,
          lines: sending.map((l) => ({
            process_order_line_id: l.key,
            item_id: l.itemId,
            description: l.item,
            sent_qty: num(l.qty),
            from_store_id: l.storeId,
            bin_id: l.binId || null,
            lot_no: l.lotNo.trim() || null,
          })),
        },
        dispatch,
      );
      if (result.ok) {
        setDirty(false);
        success(dispatch ? "Dispatched — the goods are at the processor" : "Saved as a draft");
        router.push(dispatch ? `/stores/process-dc/${result.id}/print` : "/stores/process-dc");
      } else {
        toastError(result.error);
        router.refresh();
      }
    });
  }

  /*
   * Item 288 · Ordered 88 · Balance 88 · Send Qty 112 · From Store 112 · Bin 112 · Lot No 112
   * = 912, + 40 (`#`; no ✕ — the rows are the order's own lines) = 952 <= 1155 ->
   * tableFrom="5xl". Send Qty is `range` for its two refusals.
   */
  const columns: ChildGridColumn<Line>[] = [
    { header: "Item", width: FIELD_WIDTH_CSS.name, cell: (l) => <Truncated className="text-sm">{l.item}</Truncated> },
    {
      header: "Ordered",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (l) => (
        <div className="text-right leading-tight">
          <div className="tabular-nums text-sm">
            {fmtNumber(l.ordered)} <span className="text-xs text-muted-foreground">{l.uom ?? ""}</span>
          </div>
          <div className="text-[11px] tabular-nums text-muted-foreground">sent {fmtNumber(l.sent)}</div>
        </div>
      ),
    },
    { header: "Balance", width: FIELD_WIDTH_CSS.hug, align: "right", cell: (l) => <span className="tabular-nums text-sm font-semibold">{fmtNumber(l.balance)}</span> },
    {
      header: "Send Qty",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => {
        const problem = problemOf(l);
        return (
          <>
            <Input
              type="number"
              min={0}
              max={l.balance}
              inputMode="decimal"
              aria-label={`Send qty, ${l.item}`}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `pdc-send-${l.key}-error` : undefined}
              className="h-8 text-right tabular-nums"
              value={l.qty}
              onChange={(e) => update(l.key, { qty: e.target.value })}
            />
            <FieldError id={`pdc-send-${l.key}-error`}>{problem}</FieldError>
          </>
        );
      },
    },
    {
      header: "From Store",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <div data-focus-optional>
          <Select aria-label={`From store, ${l.item}`} className="h-8" value={l.storeId} onChange={(e) => update(l.key, { storeId: e.target.value })}>
            {sendStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">in stock {fmtNumber(have(l))}</div>
        </div>
      ),
    },
    {
      header: "Bin",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Select aria-label={`Bin, ${l.item}`} className="h-8" value={l.binId} onChange={(e) => update(l.key, { binId: e.target.value })}>
          <option value="">{bins.length === 0 ? "No bins yet" : "—"}</option>
          {bins.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => <Input aria-label={`Lot No, ${l.item}`} className="h-8" value={l.lotNo} onChange={(e) => update(l.key, { lotNo: e.target.value })} />,
    },
  ];

  return (
    <div data-focus-scope className="space-y-5">
      {/* Process Order 176 · DC Date 144 · Expected Return 144 · Vehicle 144 · Transporter 176
          · E-way 144 = 928 + 5 × 12 gap = 988px + padding ≈ 64rem → cap at 66rem. */}
      <Card className="max-w-[66rem]">
        <CardHeader>
          <CardTitle>{existing ? `Process DC ${existing.code ?? ""}` : "New Process DC"}</CardTitle>
          {order ? (
            <span className="text-xs text-muted-foreground">
              To {order.vendor_name} · {order.process_type.toUpperCase()}
              {order.order_no ? ` · ${order.order_no}` : ""} · goods sent for job work, not for sale
            </span>
          ) : null}
        </CardHeader>
        <CardBody>
          <FieldRow>
            <Field
              label="Process Order"
              required
              w="term"
              htmlFor="pdc-order"
              error={orders.length === 0 ? "No issued Process Order has anything left to send" : null}
            >
              <Combobox
                id="pdc-order"
                options={orderOptions}
                value={orderId}
                disabled={!!existing}
                openOnFocus={false}
                onChange={(v) => {
                  setDirty(true);
                  setOrderId(v);
                  setLines(v ? linesOf(v) : []);
                  const o = orders.find((x) => x.id === v);
                  if (o?.expected_date) setExpected(o.expected_date);
                }}
              />
            </Field>
            <Field label="DC Date" required w="code" htmlFor="pdc-date">
              <Input
                id="pdc-date"
                type="date"
                max="9999-12-31"
                value={dcDate}
                onChange={(e) => {
                  setDirty(true);
                  setDcDate(e.target.value);
                }}
              />
            </Field>
            <Field label="Expected Return" w="code" htmlFor="pdc-expected">
              <Input
                id="pdc-expected"
                type="date"
                max="9999-12-31"
                value={expected}
                onChange={(e) => {
                  setDirty(true);
                  setExpected(e.target.value);
                }}
              />
            </Field>
            <Field label="Vehicle No" w="code" htmlFor="pdc-vehicle">
              <Input
                id="pdc-vehicle"
                value={vehicle}
                onChange={(e) => {
                  setDirty(true);
                  setVehicle(e.target.value);
                }}
              />
            </Field>
            <Field label="Transporter" w="term" htmlFor="pdc-transporter">
              <Input
                id="pdc-transporter"
                value={transporter}
                onChange={(e) => {
                  setDirty(true);
                  setTransporter(e.target.value);
                }}
              />
            </Field>
            <Field label="E-way Bill No" w="code" htmlFor="pdc-eway">
              <Input
                id="pdc-eway"
                value={eway}
                onChange={(e) => {
                  setDirty(true);
                  setEway(e.target.value);
                }}
              />
            </Field>
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items Sent</CardTitle>
          {lines.length > 0 ? <span className="text-xs text-muted-foreground">Blank Send Qty = not on this DC</span> : null}
        </CardHeader>
        <CardBody>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Pick a Process Order above and its lines load here.</p>
          ) : (
            // default-row: exempt -- the rows are the Process Order's own lines, derived; nothing is added here
            <ChildGrid<Line>
              columns={columns}
              rows={lines}
              tableFrom="5xl"
              flatRows
              hideAdd
              hideRemove
              keepOne={false}
              onAdd={() => false}
              onRemove={() => {}}
            />
          )}
        </CardBody>
      </Card>

      <div data-focus-region="footer" className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => router.push("/stores/process-dc")} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="outline" onClick={() => save(false)} disabled={!canSave}>
          Save draft
        </Button>
        <Button onClick={() => save(true)} disabled={!canSave}>
          {isPending ? "Saving…" : "Dispatch"}
        </Button>
        {!canSave && !isPending ? (
          <span className="text-sm text-muted-foreground">
            {!orderId ? "Pick the Process Order" : sending.length === 0 ? "Enter a Send Qty on at least one line" : problems ? "Fix the lines marked in red" : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
