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
import { receiveProcessDc } from "@/lib/stores/process-dc-actions";
import type { ProcessDc } from "@/lib/stores/process-dc-service";
import type { BinOption, StoreOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";

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
}: {
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
        router.push("/stores/process-dc");
      } else {
        toastError(result.error);
      }
    });
  }

  /*
   * Sent Item 176 · At Vendor 88 · Output Item 176 · Received 88 · Used 88 · Loss 112 ·
   * Close 88 · Store 112 · Bin 112 = 1040, + 40 (`#`; no ✕ — the rows are the DC's own)
   * = 1080 <= 1155 -> tableFrom="5xl". Lot No rides under the Bin (one cell, two controls).
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
      header: "Store",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <div data-focus-optional>
          <Select aria-label={`Store, ${l.item}`} className="h-8" value={l.storeId} onChange={(e) => update(l.key, { storeId: e.target.value })}>
            {intoStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      ),
    },
    {
      header: "Bin / Lot",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <div className="space-y-1">
          <Select aria-label={`Bin, ${l.item}`} className="h-8" value={l.binId} onChange={(e) => update(l.key, { binId: e.target.value })}>
            <option value="">{bins.length === 0 ? "No bins yet" : "Bin —"}</option>
            {bins.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </Select>
          <Input aria-label={`Lot No, ${l.item}`} placeholder="Lot No" className="h-7 text-xs" value={l.lotNo} onChange={(e) => update(l.key, { lotNo: e.target.value })} />
        </div>
      ),
    },
  ];

  return (
    <div data-focus-scope className="space-y-5">
      <Card className="max-w-[60rem]">
        <CardHeader>
          <CardTitle>Receive job work · {dc.code ?? ""}</CardTitle>
          <span className="text-xs text-muted-foreground">
            {dc.vendor_name} · {(dc.process_type ?? "").toUpperCase()} · Process Order {dc.process_order_code ?? "—"}
            {allowed != null ? ` · allowed loss ${allowed}%` : " · no loss limit set on the order"}
          </span>
        </CardHeader>
        <CardBody>
          {/* Receipt Date 144 · Vendor DC No 144 = 288 + 12 — a short row; the card caps at 60rem for the title line. */}
          <FieldRow>
            <Field label="Receipt Date" required w="code" htmlFor="prc-date">
              <Input
                id="prc-date"
                type="date"
                max="9999-12-31"
                value={receiptDate}
                onChange={(e) => {
                  setDirty(true);
                  setReceiptDate(e.target.value);
                }}
              />
            </Field>
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
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What came back</CardTitle>
          <span className="text-xs text-muted-foreground">Blank Received and no Close = nothing back on that line yet</span>
        </CardHeader>
        <CardBody>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everything on this DC has come back.</p>
          ) : (
            // default-row: exempt -- the rows are the DC's own lines, derived; nothing is added here
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
        <Button onClick={post} disabled={!canSave}>
          {isPending ? "Receiving…" : "Receive"}
        </Button>
        {!canSave && !isPending ? (
          <span className="text-sm text-muted-foreground">
            {sending.length === 0 ? "Enter Received (or tick Close) on at least one line" : blocked ? "Fix the lines marked in red" : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
