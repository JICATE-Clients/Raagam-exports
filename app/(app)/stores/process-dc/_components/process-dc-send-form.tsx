"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import {
  DENSE,
  DOC_BOTTOM_BAR,
  DOC_CHIP,
  DOC_FRAME,
  DOC_RULE,
  GRID_HEAD,
  HINT_CHIP_TONES,
  RailSectionLabel,
  RailTickRow,
  type HintKind,
} from "@/components/purchase/doc-surface";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { StoreBinPickCell } from "@/components/purchase/store-bin-editor";
import { useToast } from "@/components/ui/toast";
import { saveProcessDc } from "@/lib/stores/process-dc-actions";
import type { OpenProcessOrder, ProcessDc } from "@/lib/stores/process-dc-service";
import type { BinOption, StockOption, StoreOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * PROCESS DC — SEND (doc/stores/dc-plan.md Phase 2, 0786). Job work goes out against a
 * PROCESS ORDER, always (user 2026-10-31): pick the order and its lines load with what is
 * still to send. The vendor and process are the order's. A line's qty is locked to BOTH
 * the order's balance and what the chosen store holds; `process_dc_dispatch` re-checks
 * both and moves the goods into this unit's Processing store ("at vendor").
 *
 * LAYOUT = RAISE PO'S SURFACE (user 2026-11-02, as the GRN entry): one frame · a title row
 * of chips · the transport row · the open Process Orders in a rail beside the lines ·
 * a sticky bottom bar. One DC carries ONE order, so the rail's tick picks it.
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
  home = "/purchase/dc",
}: {
  /** Where Cancel and a saved draft go back to — the Delivery Challans hub. */
  home?: string;
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

  const have = (l: Line) => stock.find((s) => s.store_id === l.storeId && s.item_id === l.itemId)?.qty ?? 0;
  function update(key: string, patch: Partial<Omit<Line, "key">>) {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  /** The rail's tick: this DC's one Process Order (a saved DC keeps the one it has). */
  function pickOrder(v: string) {
    if (existing || v === orderId) return;
    setDirty(true);
    setOrderId(v);
    setLines(v ? linesOf(v) : []);
    const o = orders.find((x) => x.id === v);
    if (o?.expected_date) setExpected(o.expected_date);
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
        router.push(dispatch ? `/stores/process-dc/${result.id}/print` : home);
      } else {
        toastError(result.error);
        router.refresh();
      }
    });
  }

  /*
   * BESIDE THE ORDER RAIL: Item 176 · Ordered 88 · Balance 88 · Send Qty 112 · From Store · Bin
   * 176 (one button, 2026-11-03) · Lot No 112 = 752, + 40 (`#`; no ✕ — the rows are the
   * order's own lines) = 792 <= 1155 -> tableFrom="5xl". Was Item 288 (952) with no rail. Send Qty is `range`
   * for its two refusals.
   */
  const columns: ChildGridColumn<Line>[] = [
    { header: "Item", width: FIELD_WIDTH_CSS.term, cell: (l) => <Truncated className="text-sm">{l.item}</Truncated> },
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
      // ONE BUTTON, STORE AND BIN IN A POP-UP — GRN's cell (user 2026-11-03, screenshot 095545).
      header: "From Store · Bin",
      width: FIELD_WIDTH_CSS.term,
      // pick-once: exempt -- several lines may leave from the same store and bin
      cell: (l) => (
        <StoreBinPickCell
          description={l.item}
          parent="DC"
          stores={sendStores}
          storeId={l.storeId}
          onStore={(v) => update(l.key, { storeId: v })}
          storeLabel="From store"
          bins={bins}
          binId={l.binId}
          onBin={(v) => update(l.key, { binId: v })}
          note={`in stock ${fmtNumber(have(l))}`}
        />
      ),
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => <Input aria-label={`Lot No, ${l.item}`} className="h-8" value={l.lotNo} onChange={(e) => update(l.key, { lotNo: e.target.value })} />,
    },
  ];

  // ---------- the bar ----------
  const byUom = new Map<string, number>();
  for (const l of sending) byUom.set(l.uom ?? "", (byUom.get(l.uom ?? "") ?? 0) + num(l.qty));
  const hint = !orderId
    ? orders.length === 0
      ? "No issued Process Order has anything left to send — issue one first"
      : "Tick a Process Order on the left"
    : sending.length === 0
      ? "Enter a Send Qty on at least one line"
      : problems
        ? "Fix the lines marked in red"
        : "Ready to dispatch";
  const hintKind: HintKind = canSave ? "ready" : problems ? "md" : "todo";
  const HINT = HINT_CHIP_TONES[hintKind];
  // A saved draft shows only its own order; a new DC lists every open one.
  const railOrders = existing ? orders.filter((o) => o.id === orderId) : orders;
  const others = railOrders.filter((o) => o.id !== orderId);

  return (
    <div data-focus-scope>
      <div className={cn("max-w-[88rem]", DOC_FRAME)}>
        {/* TITLE ROW: the DC, its number (given on save), its date, and who it goes to. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
          <h2 className="text-base font-bold">Process DC</h2>
          <span className={DOC_CHIP} title={existing?.code ? "DC No" : "The DC No is given when it is saved"}>
            {existing?.code ?? "DC No · on save"}
          </span>
          {/* THE DC DATE IS THE DATE CHIP — today, and a click changes it. */}
          <label className={cn(DOC_CHIP, "inline-flex items-center gap-1 focus-within:border-[#037bb8]")} title="DC date">
            <input
              id="pdc-date"
              type="date"
              max="9999-12-31"
              required
              aria-label="DC Date"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              className="h-5 bg-transparent text-xs tabular-nums text-foreground outline-none"
              value={dcDate}
              onChange={(e) => {
                setDirty(true);
                setDcDate(e.target.value);
              }}
            />
          </label>
          {order ? (
            <span className={DOC_CHIP}>
              To {order.vendor_name} · {order.process_type.toUpperCase()}
              {order.order_no ? ` · ${order.order_no}` : ""}
            </span>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">Goods sent for job work, not for sale</span>
        </div>

        {/* THE TRANSPORT, ONE ROW: Expected Return 144 · Vehicle No 144 · Transporter 176 ·
            E-way Bill No 144 = 608 + 3 × 12 = 644px. */}
        <div className={cn(DOC_RULE, "px-4 py-2.5")}>
          <FieldRow>
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
        </div>

        {/* THE OPEN PROCESS ORDERS beside the lines (Raise PO's rail). */}
        <div className={cn(DOC_RULE, "md:grid md:grid-cols-[11.5rem_minmax(0,1fr)]")}>
          <nav aria-label="Process Orders" className="border-b border-[#dde4eb] bg-[#fafbfc] md:border-r md:border-b-0">
            <div className="flex h-8 items-center gap-1.5 border-b border-[#dde4eb] bg-white px-2.5 text-xs whitespace-nowrap text-muted-foreground">
              <span className="font-semibold text-foreground">Process Orders</span>
              <span className="tabular-nums">{railOrders.length}</span>
            </div>
            {order ? (
              <>
                <RailSectionLabel>On this DC</RailSectionLabel>
                <RailTickRow
                  on
                  active
                  label={order.code ?? "(no number)"}
                  title={`${order.code ?? ""} · ${order.vendor_name} · ${order.process_type}`}
                  badge={
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {sending.length}/{lines.length}
                    </span>
                  }
                  onTick={() => (existing ? undefined : pickOrder(""))}
                  onOpen={() => undefined}
                />
                {others.length ? <RailSectionLabel>Other open orders</RailSectionLabel> : null}
              </>
            ) : null}
            {others.map((o) => (
              <RailTickRow
                key={o.id}
                on={false}
                active={false}
                label={o.code ?? "(no number)"}
                title={`${o.code ?? ""} · ${o.vendor_name} · ${o.process_type}${o.order_no ? ` · ${o.order_no}` : ""}`}
                badge={<Truncated className="max-w-[5.5rem] text-[10.5px] text-muted-foreground">{o.vendor_name}</Truncated>}
                onTick={() => pickOrder(o.id)}
                onOpen={() => pickOrder(o.id)}
              />
            ))}
            {railOrders.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">No issued Process Order has anything left to send.</p>
            ) : null}
          </nav>
          <div className={cn("min-w-0 p-2", DENSE)}>
            {lines.length === 0 ? (
              <p className="grid h-full min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">
                {orderId ? "Nothing left to send on this order." : "Tick a Process Order on the left. Its lines list here with the balance to send."}
              </p>
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
                frameless
                headerClassName={GRID_HEAD}
              />
            )}
          </div>
        </div>

        {/* THE BOTTOM BAR: what goes out, why Dispatch waits, and the buttons. Enter off the
            last field and Ctrl+S press its LAST button (lib/focus.ts), so Dispatch is last. */}
        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          <dl className="flex items-center gap-3 text-[12.5px] whitespace-nowrap tabular-nums">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">Lines</dt>
              <dd className="font-semibold">{sending.length}</dd>
            </div>
            {[...byUom.entries()].map(([uom, qty]) => (
              <div key={uom || "-"} className="flex items-center gap-3">
                <span aria-hidden className="h-4 w-px bg-[#dde4eb]" />
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">Sending</dt>
                  <dd className="font-semibold">
                    {fmtNumber(qty)} {uom}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
          <div className="flex min-w-0 flex-1">
            {!isPending ? (
              <span
                role="status"
                className={cn("inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium", HINT.box)}
              >
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", HINT.dot)} />
                <Truncated className="min-w-0">{hint}</Truncated>
              </span>
            ) : null}
          </div>
          <Button variant="ghost" onClick={() => router.push(home)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => save(false)} disabled={!canSave}>
            Save draft
          </Button>
          <Button onClick={() => save(true)} disabled={!canSave}>
            {isPending ? "Saving…" : "Dispatch"}
          </Button>
        </div>
      </div>
    </div>
  );
}
