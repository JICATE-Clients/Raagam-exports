"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { DENSE, DOC_BOTTOM_BAR, DOC_CHIP, DOC_FRAME, DOC_RULE, DocDateChip, DocHint, DocTotals, GRID_HEAD, type HintKind } from "@/components/purchase/doc-surface";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { createDepartmentDelivery } from "@/lib/purchase/department-delivery-actions";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * DEPARTMENT DELIVERY — material handed from one department's store to another's (Stores →
 * Cutting, Cutting → Packing). A kind of the ONE Delivery Challans hub since 2026-11-04 (user:
 * "Department Delivery move it to the delivery challans"); its own page and sidebar row are
 * gone and `/purchase/interdept` redirects to the hub's Department tab.
 *
 * Same fields as the old pop-up (0365): it records the hand-over and moves no stock. It wears
 * the purchase document surface (`doc-surface.tsx`) like every DC type — one frame, a title
 * row of chips, hairline bands, a frameless grid, the sticky bottom bar — and its item lines
 * keep a blank end row instead of "+ Add" (AGENTS, "Tab lands on fields").
 */

type Option = { id: string; code?: string | null; name: string };
type Line = { key: string; itemId: string; qty: string };

let seq = 0;
const blankLine = (): Line => ({ key: `d${++seq}`, itemId: "", qty: "" });
/** The end row nobody typed into (`tailRow`) — never saved. */
const isBlank = (l: Line) => !l.itemId && !l.qty;
const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

export function DepartmentDeliveryForm({
  stores,
  items,
  home = "/purchase/dc?type=department",
}: {
  stores: Option[];
  items: Option[];
  /** Where Cancel and a saved delivery go back to — the hub on its Department tab. */
  home?: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [fromDept, setFromDept] = useState("");
  const [toDept, setToDept] = useState("");
  const [fromStore, setFromStore] = useState("");
  const [toStore, setToStore] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(() => today());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  useUnsavedGuard(dirty || isPending);

  const touch =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setDirty(true);
      set(v);
    };
  const update = (key: string, patch: Partial<Line>) => {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const storeOptions: ComboboxOption[] = useMemo(() => stores.map((s) => ({ value: s.id, label: s.name })), [stores]);
  const toStoreOptions = storeOptions.filter((o) => o.value !== fromStore);
  const itemOptions: ComboboxOption[] = useMemo(() => items.map((i) => ({ value: i.id, label: i.name })), [items]);

  const filled = lines.filter((l) => !isBlank(l));
  const blocker = !fromDept.trim()
    ? "Type the department it comes from"
    : !toDept.trim()
      ? "Type the department it goes to"
      : !fromStore
        ? "Pick the store it leaves"
        : !toStore
          ? "Pick the store it goes to"
          : filled.length === 0
            ? "Add at least one item"
            : filled.some((l) => !l.itemId || num(l.qty) <= 0)
              ? "Every line needs an item and a qty"
              : null;
  const canSave = !isPending && !blocker;

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await createDepartmentDelivery({
        from_department: fromDept,
        to_department: toDept,
        from_store_id: fromStore,
        to_store_id: toStore,
        delivery_date: deliveryDate || null,
        notes: notes.trim() || null,
        lines: filled.map((l) => ({ item_id: l.itemId, quantity: num(l.qty) })),
      });
      if (result.ok) {
        setDirty(false);
        success("Department delivery saved");
        router.push(home);
      } else {
        toastError(result.error);
        router.refresh();
      }
    });
  }

  /* Item 200 · Qty 88 = 288, + 72 chrome (`#` and ✕) = 360 <= 1155 -> tableFrom="5xl". */
  const departmentDeliveryLineColumns: ChildGridColumn<Line>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.party,
      required: true,
      // The same item twice on one delivery is one line typed twice.
      unique: (l) => l.itemId || null,
      cell: (l) => (
        <Combobox aria-label="Item" compact options={itemOptions} value={l.itemId} openOnFocus={false} onChange={(v) => update(l.key, { itemId: v })} />
      ),
    },
    {
      header: "Qty",
      width: FIELD_WIDTH_CSS.hug,
      required: true,
      cell: (l) => (
        <Input
          type="number"
          min={0}
          step="0.001"
          inputMode="decimal"
          aria-label="Qty"
          className="h-8 text-right tabular-nums"
          value={l.qty}
          onChange={(e) => update(l.key, { qty: e.target.value })}
        />
      ),
    },
  ];

  const hintKind: HintKind = canSave ? "ready" : "todo";
  const totalQty = filled.reduce((n, l) => n + num(l.qty), 0);

  return (
    <div data-focus-scope>
      <div className={cn("max-w-[88rem]", DOC_FRAME)}>
        {/* TITLE ROW (the Job Work DC's): the document, its number (given on save), its date. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
          <h2 className="text-base font-bold">Department Delivery</h2>
          <span className={DOC_CHIP} title="The number is given when it is saved">
            No · on save
          </span>
          <DocDateChip id="idd-date" label="Delivery Date" value={deliveryDate} onChange={touch(setDeliveryDate)} />
          <span className="ml-auto text-xs text-muted-foreground">Hand-over between departments — moves no stock</span>
        </div>

        {/* WHO AND WHERE, ONE ROW: From 176 · To 176 · From Store 176 · To Store 176 ·
            Notes 288 = 992 + 4 × 12 = 1040px inside 88rem. */}
        <div className={cn(DOC_RULE, "px-4 py-2.5")}>
          <FieldRow>
            <Field label="From Department" required w="term" htmlFor="idd-from">
              <Input id="idd-from" value={fromDept} placeholder="Stores" onChange={(e) => touch(setFromDept)(e.target.value)} />
            </Field>
            <Field label="To Department" required w="term" htmlFor="idd-to">
              <Input id="idd-to" value={toDept} placeholder="Cutting" onChange={(e) => touch(setToDept)(e.target.value)} />
            </Field>
            <Field label="From Store" required w="term" htmlFor="idd-from-store">
              <Combobox
                id="idd-from-store"
                options={storeOptions}
                value={fromStore}
                required
                onChange={(v) => {
                  touch(setFromStore)(v);
                  if (v && v === toStore) setToStore("");
                }}
              />
            </Field>
            <Field label="To Store" required w="term" htmlFor="idd-to-store">
              <Combobox id="idd-to-store" options={toStoreOptions} value={toStore} required onChange={touch(setToStore)} />
            </Field>
            <Field label="Notes" w="name" htmlFor="idd-notes">
              <Input id="idd-notes" value={notes} onChange={(e) => touch(setNotes)(e.target.value)} />
            </Field>
          </FieldRow>
        </div>

        {/* THE ITEMS, frameless under the hairline with the Orders table band. */}
        <div className={cn(DOC_RULE, "min-w-0 p-2", DENSE)}>
          <ChildGrid<Line>
            columns={departmentDeliveryLineColumns}
            rows={lines}
            tableFrom="5xl"
            flatRows
            tailRow={isBlank}
            frameless
            headerClassName={GRID_HEAD}
            onAdd={() => setLines((prev) => [...prev, blankLine()])}
            onRemove={(r) => {
              setDirty(true);
              setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== r.key) : [blankLine()]));
            }}
          />
        </div>

        {/* THE BOTTOM BAR: what is handed over, why Save waits, and the buttons. Enter off the
            last field and Ctrl+S press its LAST button (lib/focus.ts), so Save is last. */}
        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          <DocTotals
            items={[
              ["Lines", filled.length],
              ["Qty", fmtNumber(totalQty)],
            ]}
          />
          <div className="flex min-w-0 flex-1">{!isPending ? <DocHint kind={hintKind}>{blocker ?? "Ready to save"}</DocHint> : null}</div>
          <Button variant="ghost" onClick={() => router.push(home)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
