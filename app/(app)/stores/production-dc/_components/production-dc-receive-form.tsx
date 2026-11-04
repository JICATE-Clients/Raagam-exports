"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { DENSE, DOC_BOTTOM_BAR, DOC_CHIP, DOC_FRAME, DOC_RULE, DocHint, DocTotals, GRID_HEAD, type HintKind } from "@/components/purchase/doc-surface";
import { FieldError, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { StoreBinPickCell } from "@/components/purchase/store-bin-editor";
import { useToast } from "@/components/ui/toast";
import { receiveProductionDc } from "@/lib/stores/production-dc-actions";
import type { BinOption, ProductionDc, StoreOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtDate, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * PRODUCTION DC — RECEIVE (0784), at the unit it was sent to. Every line is settled in one
 * go: what arrived goes into this unit's store and bin, the rest is a SHORTAGE with a
 * mandatory reason (written off the sender's In Transit store). Received opens on the
 * sent qty, so a clean delivery is one click.
 */

type Line = {
  key: string;
  item: string;
  uom: string | null;
  sent: number;
  received: string;
  reason: string;
  storeId: string;
  binId: string;
};

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function ProductionDcReceiveForm({
  dc,
  stores,
  bins,
  home = "/purchase/dc",
}: {
  dc: ProductionDc;
  stores: StoreOption[];
  bins: BinOption[];
  /** Where Cancel and a saved receipt go back to — the Delivery Challans hub. */
  home?: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const defaultStore = stores.find((s) => s.store_type === "material")?.id ?? stores[0]?.id ?? "";
  const [lines, setLines] = useState<Line[]>(() =>
    dc.lines.map((l) => ({
      key: l.id,
      item: l.item_name,
      uom: l.uom,
      sent: l.sent_qty,
      received: String(l.sent_qty),
      reason: "",
      storeId: defaultStore,
      binId: "",
    })),
  );
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  function update(key: string, patch: Partial<Omit<Line, "key">>) {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  const short = (l: Line) => Math.max(0, Math.round((l.sent - num(l.received)) * 1000) / 1000);
  const problemOf = (l: Line): string | null =>
    num(l.received) < 0 || num(l.received) > l.sent + 1e-9 ? `Between 0 and ${fmtNumber(l.sent)}` : null;
  const blocked = lines.some((l) => problemOf(l) || (short(l) > 0 && !l.reason.trim()) || (num(l.received) > 0 && !l.storeId));
  const canSave = !isPending && lines.length > 0 && !blocked;

  function receive() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await receiveProductionDc(
        dc.id,
        lines.map((l) => ({
          line_id: l.key,
          received_qty: num(l.received),
          shortage_reason: short(l) > 0 ? l.reason.trim() : null,
          store_id: l.storeId || null,
          bin_id: l.binId || null,
        })),
      );
      if (result.ok) {
        setDirty(false);
        success("Received into this unit's stock");
        router.push(home);
      } else {
        toastError(result.error);
      }
    });
  }

  /*
   * Item 288 · Sent 88 · Received 88 · Short 88 · Reason 176 · Store · Bin 176 (one button,
   * 2026-11-03) = 904, + 40 (`#`; no ✕ — the lines are the DC's own) = 944 <= 1155 ->
   * tableFrom="5xl".
   */
  const columns: ChildGridColumn<Line>[] = [
    { header: "Item", width: FIELD_WIDTH_CSS.name, cell: (l) => <Truncated className="text-sm">{l.item}</Truncated> },
    {
      header: "Sent",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm">
          {fmtNumber(l.sent)} <span className="text-xs text-muted-foreground">{l.uom ?? ""}</span>
        </span>
      ),
    },
    {
      header: "Received",
      width: FIELD_WIDTH_CSS.hug,
      required: true,
      cell: (l) => {
        const problem = problemOf(l);
        return (
          <>
            <Input
              type="number"
              min={0}
              max={l.sent}
              inputMode="decimal"
              aria-label={`Received, ${l.item}`}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `pdcr-${l.key}-error` : undefined}
              className="h-8 text-right tabular-nums"
              value={l.received}
              onChange={(e) => update(l.key, { received: e.target.value })}
            />
            <FieldError id={`pdcr-${l.key}-error`}>{problem}</FieldError>
          </>
        );
      },
    },
    {
      header: "Short",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (l) =>
        short(l) > 0 ? <span className="tabular-nums text-sm font-semibold text-danger">{fmtNumber(short(l))}</span> : null,
    },
    {
      header: "Shortage Reason",
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => {
        // Mandatory exactly when something is short — and only then on the Tab path.
        const needed = short(l) > 0;
        return (
          <div data-focus-optional={needed ? undefined : ""}>
            <Input
              aria-label={`Shortage reason, ${l.item}`}
              required={needed}
              disabled={!needed}
              className="h-8"
              value={l.reason}
              onChange={(e) => update(l.key, { reason: e.target.value })}
            />
          </div>
        );
      },
    },
    {
      // ONE BUTTON, STORE AND BIN IN A POP-UP — GRN's cell (user 2026-11-03, screenshot 095545).
      header: "Store · Bin",
      width: FIELD_WIDTH_CSS.term,
      // pick-once: exempt -- several lines may go into the same store and bin
      cell: (l) => (
        <StoreBinPickCell
          description={l.item}
          parent="Receipt"
          stores={stores}
          storeId={l.storeId}
          onStore={(v) => update(l.key, { storeId: v })}
          bins={bins}
          binId={l.binId}
          onBin={(v) => update(l.key, { binId: v })}
        />
      ),
    },
  ];

  const sentQty = lines.reduce((n, l) => n + l.sent, 0);
  const receivedQty = lines.reduce((n, l) => n + num(l.received), 0);
  const shortQty = lines.reduce((n, l) => n + short(l), 0);
  const hintKind: HintKind = canSave ? "ready" : blocked ? "md" : "todo";

  return (
    <div data-focus-scope>
      <div className={cn("max-w-[88rem]", DOC_FRAME)}>
        {/* TITLE ROW: the DC being received and its facts as chips (the Job Work DC's shape). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
          <h2 className="text-base font-bold">Receive Inter-Unit DC</h2>
          <span className={DOC_CHIP} title="DC No">
            {dc.code ?? "—"}
          </span>
          <span className={DOC_CHIP} title="DC Date">
            {fmtDate(dc.dc_date)}
          </span>
          <span className={DOC_CHIP} title="From → To">
            {dc.from_unit} → {dc.to_unit}
          </span>
          {dc.vehicle_no ? (
            <span className={DOC_CHIP} title="Vehicle No">
              {dc.vehicle_no}
            </span>
          ) : null}
          {dc.eway_bill_no ? (
            <span className={DOC_CHIP} title="E-way Bill No">
              E-way {dc.eway_bill_no}
            </span>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">Received opens on what was sent — lower it if less arrived, and say why</span>
        </div>

        {/* THE LINES, frameless under the hairline with the Orders table band. */}
        <div className={cn(DOC_RULE, "min-w-0 p-2", DENSE)}>
          {/* default-row: exempt -- the rows are the DC's own lines, derived; nothing is added here */}
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
        </div>

        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          <DocTotals
            items={[
              ["Sent", fmtNumber(sentQty)],
              ["Received", fmtNumber(receivedQty)],
              ["Short", fmtNumber(shortQty)],
            ]}
          />
          <div className="flex min-w-0 flex-1">
            {!isPending ? <DocHint kind={hintKind}>{blocked ? "Give a reason for every shortage and pick a store" : "Ready to receive"}</DocHint> : null}
          </div>
          <Button variant="ghost" onClick={() => router.push(home)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={receive} disabled={!canSave}>
            {isPending ? "Receiving…" : "Receive"}
          </Button>
        </div>
      </div>
    </div>
  );
}
