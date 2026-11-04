"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { DENSE, DOC_BOTTOM_BAR, DOC_CHIP, DOC_FRAME, DOC_RULE, DocDateChip, DocHint, DocTotals, GRID_HEAD, type HintKind } from "@/components/purchase/doc-surface";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import { StoreBinPickCell } from "@/components/purchase/store-bin-editor";
import { useToast } from "@/components/ui/toast";
import { receiveProcessDc } from "@/lib/stores/process-dc-actions";
import type { ProcessDc } from "@/lib/stores/process-dc-service";
import type { BinOption, StoreOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * PROCESS RECEIPT (doc/stores/dc-plan.md Phase 3, 0787) — job work coming back.
 *
 * Per DC line: the OUTPUT item (grey went, dyed comes back — opens on what the order said
 * comes back), how much arrived, and how much of what was sent it used (opens on all that
 * is still at the vendor). Loss = used − received, shown with its % against the order's
 * Allowed Loss %; past it the line turns amber and says so — a WARNING, never a block (the
 * user's rule), and the excess is flagged on the draft bill. "Close bal." says the vendor
 * sends nothing more on that line: everything still there counts as used.
 */

type Line = {
  key: string;
  item: string;
  uom: string | null;
  left: number;
  outputId: string;
  received: string;
  used: string;
  close: boolean;
  storeId: string;
  binId: string;
  lotNo: string;
};

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function ProcessReceiptForm({
  dc,
  items,
  stores,
  bins,
  home = "/purchase/dc",
}: {
  /** Where Cancel and a saved draft go back to — the Delivery Challans hub. */
  home?: string;
  dc: ProcessDc;
  items: { id: string; code: string | null; name: string }[];
  stores: StoreOption[];
  bins: BinOption[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const intoStores = stores.filter((s) => s.store_type !== "processing");
  const defaultStore = intoStores.find((s) => s.store_type === "material")?.id ?? intoStores[0]?.id ?? "";
  const [receiptDate, setReceiptDate] = useState(() => today());
  const [vendorDc, setVendorDc] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    dc.lines
      .map((l) => ({
        key: l.id,
        item: l.item_name,
        uom: l.uom,
        left: r3(l.sent_qty - l.returned_qty),
        outputId: l.output_item_id ?? l.item_id,
        received: "",
        used: String(r3(l.sent_qty - l.returned_qty)),
        close: false,
        storeId: defaultStore,
        binId: "",
        lotNo: "",
      }))
      .filter((l) => l.left > 0),
  );
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const itemOptions: ComboboxOption[] = items.map((i) => ({ value: i.id, label: i.name, search: i.code ?? undefined }));
  function update(key: string, patch: Partial<Omit<Line, "key">>) {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  const usedOf = (l: Line) => (l.close ? l.left : num(l.used));
  const lossOf = (l: Line) => r3(usedOf(l) - num(l.received));
  const pctOf = (l: Line) => (usedOf(l) > 0 ? Math.round((lossOf(l) / usedOf(l)) * 10000) / 100 : 0);
  const active = (l: Line) => num(l.received) > 0 || l.close;
  const problemOf = (l: Line): string | null => {
    if (!active(l)) return null;
    if (usedOf(l) <= 0) return "Say how much it used";
    if (usedOf(l) > l.left + 1e-9) return `Only ${fmtNumber(l.left)} is at the vendor`;
    if (lossOf(l) < -1e-9) return "More back than was used";
    if (num(l.received) > 0 && !l.storeId) return "Pick a store";
    return null;
  };
  const sending = lines.filter(active);
  const blocked = sending.some((l) => !!problemOf(l));
  const canSave = !isPending && !!receiptDate && sending.length > 0 && !blocked;
  const allowed = dc.allowed_loss_pct;

  function post() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await receiveProcessDc(dc.id, {
        receipt_date: receiptDate,
        vendor_dc_no: vendorDc.trim() || null,
        lines: sending.map((l) => ({
          dc_line_id: l.key,
          output_item_id: l.outputId || null,
          received_qty: num(l.received),
          input_used_qty: usedOf(l),
          close_balance: l.close,
          store_id: l.storeId || null,
          bin_id: l.binId || null,
          lot_no: l.lotNo.trim() || null,
        })),
      });
      if (result.ok) {
        setDirty(false);
        success("Received — stock and the draft bill are updated");
        router.push(home);
      } else {
        toastError(result.error);
      }
    });
  }

  /*
   * Sent Item 176 · At Vendor 88 · Output Item 176 · Received 88 · Used 88 · Loss 112 ·
   * Close 88 · Store · Bin 176 (one button, 2026-11-03) · Lot No 112 = 1104, + 40 (`#`; no
   * ✕ — the rows are the DC's own) = 1144 <= 1155 -> tableFrom="5xl".
   */
  const columns: ChildGridColumn<Line>[] = [
    { header: "Sent Item", width: FIELD_WIDTH_CSS.term, cell: (l) => <Truncated className="text-sm">{l.item}</Truncated> },
    {
      header: "At Vendor",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-sm">
          {fmtNumber(l.left)} <span className="text-xs text-muted-foreground">{l.uom ?? ""}</span>
        </span>
      ),
    },
    {
      header: "Output Item",
      // pick-once: exempt -- the same material repeats across colour / size / component lines
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => (
        <div data-focus-optional>
          <Combobox aria-label={`Output item, ${l.item}`} options={itemOptions} value={l.outputId} openOnFocus={false} onChange={(v) => update(l.key, { outputId: v })} />
        </div>
      ),
    },
    {
      header: "Received",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          aria-label={`Received, ${l.item}`}
          className="h-8 text-right tabular-nums"
          value={l.received}
          onChange={(e) => update(l.key, { received: e.target.value })}
        />
      ),
    },
    {
      header: "Used",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <Input
          type="number"
          min={0}
          max={l.left}
          inputMode="decimal"
          aria-label={`Input used, ${l.item}`}
          disabled={l.close}
          className="h-8 text-right tabular-nums"
          value={l.close ? String(l.left) : l.used}
          onChange={(e) => update(l.key, { used: e.target.value })}
        />
      ),
    },
    {
      header: "Loss",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => {
        if (!active(l)) return null;
        const problem = problemOf(l);
        const over = allowed != null && pctOf(l) > allowed + 1e-9;
        return (
          <div className="leading-tight">
            <div className={"tabular-nums text-sm " + (over ? "font-semibold text-warning" : "")}>
              {fmtNumber(lossOf(l))} · {pctOf(l)}%
            </div>
            {over ? (
              <div className="text-[11px] text-warning">
                over {allowed}% by {Math.round((pctOf(l) - allowed!) * 100) / 100}%
              </div>
            ) : null}
            <FieldError id={`prc-${l.key}-error`}>{problem}</FieldError>
          </div>
        );
      },
    },
    {
      header: "Close bal.",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <label data-focus-optional className="flex items-center gap-1 text-[11px]" title="Nothing more is coming on this line — all still at the vendor counts as used">
          <input
            type="checkbox"
            aria-label={`Close the balance, ${l.item}`}
            checked={l.close}
            onChange={(e) => update(l.key, { close: e.target.checked })}
          />
          <span className="text-muted-foreground">close</span>
        </label>
      ),
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
          stores={intoStores}
          storeId={l.storeId}
          onStore={(v) => update(l.key, { storeId: v })}
          bins={bins}
          binId={l.binId}
          onBin={(v) => update(l.key, { binId: v })}
        />
      ),
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => <Input aria-label={`Lot No, ${l.item}`} className="h-8" value={l.lotNo} onChange={(e) => update(l.key, { lotNo: e.target.value })} />,
    },
  ];

  const blocker = sending.length === 0 ? "Enter Received (or tick Close) on at least one line" : blocked ? "Fix the lines marked in red" : null;
  const hintKind: HintKind = canSave ? "ready" : blocked ? "md" : "todo";

  return (
    <div data-focus-scope>
      <div className={cn("max-w-[88rem]", DOC_FRAME)}>
        {/* TITLE ROW: the DC coming back, the receipt date, and the order it is against. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
          <h2 className="text-base font-bold">Receive Job Work</h2>
          <span className={DOC_CHIP} title="DC No">
            {dc.code ?? "—"}
          </span>
          <DocDateChip
            id="prc-date"
            label="Receipt Date"
            value={receiptDate}
            onChange={(v) => {
              setDirty(true);
              setReceiptDate(v);
            }}
          />
          <span className={DOC_CHIP} title="Processor · process · Process Order">
            {dc.vendor_name} · {(dc.process_type ?? "").toUpperCase()} · {dc.process_order_code ?? "—"}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {allowed != null ? `Allowed loss ${allowed}%` : "No loss limit set on the order"}
          </span>
        </div>

        {/* THE VENDOR'S PAPER, ONE FIELD: Vendor DC / Bill No 144. */}
        <div className={cn(DOC_RULE, "px-4 py-2.5")}>
          <FieldRow>
            <Field label="Vendor DC / Bill No" w="code" htmlFor="prc-vdc">
              <Input
                id="prc-vdc"
                value={vendorDc}
                onChange={(e) => {
                  setDirty(true);
                  setVendorDc(e.target.value);
                }}
              />
            </Field>
          </FieldRow>
        </div>

        {/* WHAT CAME BACK, frameless under the hairline with the Orders table band. */}
        <div className={cn(DOC_RULE, "min-w-0 p-2", DENSE)}>
          {lines.length === 0 ? (
            <p className="grid min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">Everything on this DC has come back.</p>
          ) : (
            <>
              <p className="px-1 pb-1.5 text-xs text-muted-foreground">Blank Received and no Close = nothing back on that line yet</p>
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
            </>
          )}
        </div>

        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          <DocTotals
            items={[
              ["Lines", lines.length],
              ["Receiving", sending.length],
            ]}
          />
          <div className="flex min-w-0 flex-1">{!isPending ? <DocHint kind={hintKind}>{blocker ?? "Ready to receive"}</DocHint> : null}</div>
          <Button variant="ghost" onClick={() => router.push(home)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={post} disabled={!canSave}>
            {isPending ? "Receiving…" : "Receive"}
          </Button>
        </div>
      </div>
    </div>
  );
}
