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
import { useToast } from "@/components/ui/toast";
import { saveProductionDc } from "@/lib/stores/production-dc-actions";
import type { BinOption, ProductionDc, StockOption, StoreOption, UnitOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";

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
   * From Store 112 · Item 288 · In Stock 88 · Qty 88 · Bin 112 · Lot No 112 = 800, + 72
   * chrome (`#` and ✕) = 872 <= 1155 -> tableFrom="5xl".
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
      header: "Bin",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Select aria-label="Bin" className="h-8" value={l.binId} onChange={(e) => update(l.key, { binId: e.target.value })}>
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
      cell: (l) => <Input aria-label="Lot No" className="h-8" value={l.lotNo} onChange={(e) => update(l.key, { lotNo: e.target.value })} />,
    },
  ];

  return (
    <div data-focus-scope className="space-y-5">
      {/* From 176 · To 176 · Date 144 · Vehicle 144 · Transporter 176 · E-way 144 = 960 +
          5 × 12 gap = 1020px + padding ≈ 66rem → cap at 68rem. */}
      <Card className="max-w-[68rem]">
        <CardHeader>
          <CardTitle>{existing ? `Production DC ${existing.code ?? ""}` : "New Production DC"}</CardTitle>
          <span className="text-xs text-muted-foreground">Stock transfer between units — not a sale</span>
        </CardHeader>
        <CardBody>
          <FieldRow>
            <Field label="From Unit" w="term" htmlFor="pdc-from">
              <Input id="pdc-from" value={unit.name} readOnly />
            </Field>
            <Field label="To Unit" required w="term" htmlFor="pdc-to">
              <Select
                id="pdc-to"
                value={toUnit}
                onChange={(e) => {
                  setDirty(true);
                  setToUnit(e.target.value);
                }}
              >
                <option value="">—</option>
                {toUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
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
        </CardHeader>
        <CardBody>
          <ChildGrid<Line>
            columns={lineColumns}
            rows={lines}
            tableFrom="5xl"
            flatRows
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
        </CardBody>
      </Card>

      <div data-focus-region="footer" className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => router.push(home)} disabled={isPending}>
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
            {!toUnit
              ? "Pick the unit it goes to"
              : filled.length === 0
                ? "Add at least one item"
                : problems
                  ? "Fix the lines marked in red"
                  : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
