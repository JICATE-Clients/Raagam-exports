"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { DENSE, DOC_BOTTOM_BAR, DOC_CHIP, DOC_FRAME, DOC_RULE, DocDateChip, DocHint, DocTotals, GRID_HEAD, type HintKind } from "@/components/purchase/doc-surface";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { StoreBinPickCell } from "@/components/purchase/store-bin-editor";
import { saveProductionDc } from "@/lib/stores/production-dc-actions";
import type { BinOption, ProductionDc, StockOption, StoreOption, UnitOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * PRODUCTION DC — SEND (doc/stores/dc-plan.md, 0784). The sending unit picks where it
 * goes and what leaves which store. Dispatch moves each line from its store into this
 * unit's In Transit store (`production_dc_dispatch`); until the other unit receives it the
 * goods show as in transit. A line's qty is LOCKED to what its store holds — the database
 * refuses the same (a negative balance raises), so the screen only says it first.
 */

type Line = { key: string; storeId: string; itemId: string; qty: string; binId: string; lotNo: string };

let seq = 0;
const blankLine = (storeId: string): Line => ({ key: `l${++seq}`, storeId, itemId: "", qty: "", binId: "", lotNo: "" });

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function ProductionDcSendForm({
  unit,
  toUnits,
  stores,
  bins,
  stock,
  existing,
  home = "/purchase/dc",
}: {
  /** Where Cancel and a saved draft go back to — the Delivery Challans hub. */
  home?: string;
  unit: UnitOption;
  toUnits: UnitOption[];
  stores: StoreOption[];
  bins: BinOption[];
  stock: StockOption[];
  /** A draft being edited; null = a new DC. */
  existing: ProductionDc | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  /* Sending opens on the Material store — where most goods that move between units live. */
  const defaultStore = stores.find((s) => s.store_type === "material")?.id ?? stores[0]?.id ?? "";

  const [toUnit, setToUnit] = useState(existing?.to_location_id ?? (toUnits.length === 1 ? toUnits[0].id : ""));
  const [dcDate, setDcDate] = useState(existing?.dc_date ?? today());
  const [vehicle, setVehicle] = useState(existing?.vehicle_no ?? "");
  const [transporter, setTransporter] = useState(existing?.transporter ?? "");
  const [eway, setEway] = useState(existing?.eway_bill_no ?? "");
  // An editable sub-table opens with a row (AGENTS.md); `[]` falls back to one blank too.
  const [lines, setLines] = useState<Line[]>(() =>
    existing && existing.lines.length > 0
      ? existing.lines.map((l) => ({
          key: l.id,
          storeId: l.from_store_id ?? defaultStore,
          itemId: l.item_id,
          qty: String(l.sent_qty),
          binId: l.bin_id ?? "",
          lotNo: l.lot_no ?? "",
        }))
      : [blankLine(defaultStore)],
  );
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const stockOf = (storeId: string, itemId: string) => stock.find((s) => s.store_id === storeId && s.item_id === itemId);
  function update(key: string, patch: Partial<Omit<Line, "key">>) {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /* The blank row the grid opens with is never saved: only a line naming an item counts. */
  const filled = lines.filter((l) => l.itemId);
  const problemOf = (l: Line): string | null => {
    if (!l.itemId) return null;
    const have = stockOf(l.storeId, l.itemId)?.qty ?? 0;
    if (num(l.qty) <= 0) return "Enter the qty";
    return num(l.qty) > have + 1e-9 ? `Only ${fmtNumber(have)} in this store` : null;
  };
  const problems = filled.some((l) => !!problemOf(l) || !l.storeId);
  const canSave = !isPending && !!toUnit && !!dcDate && filled.length > 0 && !problems;

  function save(dispatch: boolean) {
    if (!canSave) return;
    startTransition(async () => {
      const result = await saveProductionDc(
        existing?.id ?? null,
        {
          to_location_id: toUnit,
          dc_date: dcDate,
          vehicle_no: vehicle.trim() || null,
          transporter: transporter.trim() || null,
          eway_bill_no: eway.trim() || null,
          notes: null,
          lines: filled.map((l) => ({
            item_id: l.itemId,
            description: stockOf(l.storeId, l.itemId)?.item_name ?? null,
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
        success(dispatch ? "Dispatched — the goods are in transit" : "Saved as a draft");
        router.push(dispatch ? `/stores/production-dc/${result.id}/print` : home);
      } else {
        toastError(result.error);
        router.refresh();
      }
    });
  }

  /*
   * From Store 112 · Item 288 · In Stock 88 · Qty 88 · Bin 176 (store · bin button) · Lot No
   * 112 = 864, + 72 chrome (`#` and ✕) = 936 <= 1155 -> tableFrom="5xl".
   */
  const lineColumns: ChildGridColumn<Line>[] = [
    {
      header: "From Store",
      width: FIELD_WIDTH_CSS.range,
      required: true,
      cell: (l) => (
        <Select
          aria-label="From store"
          className="h-8"
          value={l.storeId}
          // A different store holds different stock: the item picked for the old one goes.
          onChange={(e) => update(l.key, { storeId: e.target.value, itemId: "", qty: "" })}
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Item",
      // pick-once: exempt -- the same material repeats across colour / size / component lines
      width: FIELD_WIDTH_CSS.name,
      required: true,
      cell: (l) => {
        // Only what THIS store holds is offered — a unit cannot send what it does not have.
        const options: ComboboxOption[] = stock
          .filter((s) => s.store_id === l.storeId)
          .map((s) => ({ value: s.item_id, label: s.item_name, sublabel: `${fmtNumber(s.qty)} ${s.uom ?? ""}`.trim() }));
        return (
          <Combobox
            aria-label="Item"
            options={options}
            value={l.itemId}
            openOnFocus={false}
            placeholder={options.length === 0 ? "Nothing in stock here" : undefined}
            onChange={(v) => update(l.key, { itemId: v })}
          />
        );
      },
    },
    {
      header: "In Stock",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (l) => {
        const s = l.itemId ? stockOf(l.storeId, l.itemId) : undefined;
        return s ? (
          <span className="tabular-nums text-sm text-muted-foreground">
            {fmtNumber(s.qty)} <span className="text-xs">{s.uom ?? ""}</span>
          </span>
        ) : null;
      },
    },
    {
      header: "Qty",
      width: FIELD_WIDTH_CSS.hug,
      required: true,
      cell: (l) => {
        const problem = problemOf(l);
        return (
          <>
            <Input
              type="number"
              min={0}
              inputMode="decimal"
              aria-label="Qty"
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `pdc-qty-${l.key}-error` : undefined}
              className="h-8 text-right tabular-nums"
              value={l.qty}
              onChange={(e) => update(l.key, { qty: e.target.value })}
            />
            <FieldError id={`pdc-qty-${l.key}-error`}>{problem}</FieldError>
          </>
        );
      },
    },
    {
      // GRN's one-line button (user 2026-11-03, screenshot 095545). From Store stays its own
      // first column — it decides which items are offered — so the pop-up edits the bin only.
      header: "Bin",
      width: FIELD_WIDTH_CSS.term,
      // pick-once: exempt -- several lines may leave from the same bin
      cell: (l) => (
        <StoreBinPickCell
          description={l.itemId ? (stockOf(l.storeId, l.itemId)?.item_name ?? "line") : "line"}
          parent="DC"
          stores={stores}
          storeId={l.storeId}
          bins={bins}
          binId={l.binId}
          onBin={(v) => update(l.key, { binId: v })}
        />
      ),
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => <Input aria-label="Lot No" className="h-8" value={l.lotNo} onChange={(e) => update(l.key, { lotNo: e.target.value })} />,
    },
  ];

  const blocker = !toUnit ? "Pick the unit it goes to" : filled.length === 0 ? "Add at least one item" : problems ? "Fix the lines marked in red" : null;
  const hintKind: HintKind = canSave ? "ready" : problems ? "md" : "todo";
  const sendingQty = filled.reduce((n, l) => n + (parseFloat(l.qty) || 0), 0);
  const set =
    (fn: (v: string) => void) =>
    (v: string) => {
      setDirty(true);
      fn(v);
    };

  return (
    <div data-focus-scope>
      <div className={cn("max-w-[88rem]", DOC_FRAME)}>
        {/* TITLE ROW (the Job Work DC's): the DC, its number (given on save), its date, the unit it leaves. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
          <h2 className="text-base font-bold">Inter-Unit DC</h2>
          <span className={DOC_CHIP} title={existing?.code ? "DC No" : "The DC No is given when it is saved"}>
            {existing?.code ?? "DC No · on save"}
          </span>
          <DocDateChip id="pdc-date" label="DC Date" value={dcDate} onChange={set(setDcDate)} />
          <span className={DOC_CHIP} title="From unit">
            From {unit.name}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">Stock transfer between units — not a sale</span>
        </div>

        {/* WHERE AND HOW, ONE ROW: To Unit 176 · Vehicle 144 · Transporter 176 · E-way 144 =
            640 + 3 × 12 = 676px. */}
        <div className={cn(DOC_RULE, "px-4 py-2.5")}>
          <FieldRow>
            <Field label="To Unit" required w="term" htmlFor="pdc-to">
              <Select id="pdc-to" value={toUnit} onChange={(e) => set(setToUnit)(e.target.value)}>
                <option value="">—</option>
                {toUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vehicle No" w="code" htmlFor="pdc-vehicle">
              <Input id="pdc-vehicle" value={vehicle} onChange={(e) => set(setVehicle)(e.target.value)} />
            </Field>
            <Field label="Transporter" w="term" htmlFor="pdc-transporter">
              <Input id="pdc-transporter" value={transporter} onChange={(e) => set(setTransporter)(e.target.value)} />
            </Field>
            <Field label="E-way Bill No" w="code" htmlFor="pdc-eway">
              <Input id="pdc-eway" value={eway} onChange={(e) => set(setEway)(e.target.value)} />
            </Field>
          </FieldRow>
        </div>

        {/* THE ITEMS SENT, frameless under the hairline with the Orders table band. */}
        <div className={cn(DOC_RULE, "min-w-0 p-2", DENSE)}>
          <ChildGrid<Line>
            columns={lineColumns}
            rows={lines}
            tableFrom="5xl"
            flatRows
            frameless
            headerClassName={GRID_HEAD}
            addLabel="Add line"
            onAdd={() => {
              setDirty(true);
              setLines((prev) => [...prev, blankLine(defaultStore)]);
            }}
            onRemove={(r) => {
              setDirty(true);
              setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== r.key) : [blankLine(defaultStore)]));
            }}
          />
        </div>

        {/* THE BOTTOM BAR: what goes out, why Dispatch waits, and the buttons. Dispatch is last
            (Enter off the last field and Ctrl+S press the LAST button, lib/focus.ts). */}
        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          <DocTotals
            items={[
              ["Lines", filled.length],
              ["Sending", fmtNumber(sendingQty)],
            ]}
          />
          <div className="flex min-w-0 flex-1">{!isPending ? <DocHint kind={hintKind}>{blocker ?? "Ready to dispatch"}</DocHint> : null}</div>
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
