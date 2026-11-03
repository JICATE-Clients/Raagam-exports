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
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { StoreBinPickCell } from "@/components/purchase/store-bin-editor";
import { saveGeneralDc } from "@/lib/purchase/general-dc-actions";
import type { GeneralDc, UomOption, VendorOption } from "@/lib/purchase/general-dc-service";
import type { BinOption, StockOption, StoreOption, UnitOption } from "@/lib/stores/production-dc-service";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtNumber } from "@/lib/format";

/**
 * GENERAL DC — SEND (0796). Material going OUT to someone outside that is neither job work
 * nor a vendor return: a machine to the repairer, a sample, a loan, a gift. RETURNABLE goods
 * move into this unit's Processing store ("at party") and come back on a Delivery Return;
 * NON-RETURNABLE goods are issued out for good. A line is a stock item (store · bin · lot,
 * qty locked to what the store holds) or FREE TEXT — a description only, which moves no
 * stock (a sewing machine with its serial number).
 */

type Line = {
  key: string;
  itemId: string;
  description: string;
  storeId: string;
  binId: string;
  lotNo: string;
  qty: string;
  uomId: string;
  value: string;
};

let seq = 0;
const blankLine = (): Line => ({
  key: `g${++seq}`,
  itemId: "",
  description: "",
  storeId: "",
  binId: "",
  lotNo: "",
  qty: "",
  uomId: "",
  value: "",
});
/** The end row the operator has not typed into (`tailRow`) — never saved. */
const isBlank = (l: Line) => !l.itemId && !l.description.trim() && !l.qty && !l.value;

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

type PartyMode = "vendor" | "other";

export function GeneralDcSendForm({
  unit,
  stores,
  bins,
  stock,
  vendors,
  uoms,
  existing,
  home = "/purchase/dc?type=general",
}: {
  unit: UnitOption;
  stores: StoreOption[];
  bins: BinOption[];
  stock: StockOption[];
  vendors: VendorOption[];
  uoms: UomOption[];
  /** A draft being edited; null = a new DC. */
  existing: GeneralDc | null;
  /** Where Cancel and a saved draft go back to. */
  home?: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  // Goods leave from a stock store, never from where goods already out are held.
  const sendStores = stores.filter((s) => s.store_type !== "processing");

  const [dcDate, setDcDate] = useState(existing?.dc_date ?? today());
  const [returnable, setReturnable] = useState<"yes" | "no">(existing && !existing.is_returnable ? "no" : "yes");
  const [partyMode, setPartyMode] = useState<PartyMode>(existing && !existing.vendor_id && existing.party_name ? "other" : "vendor");
  const [vendorId, setVendorId] = useState(existing?.vendor_id ?? "");
  const [partyName, setPartyName] = useState(existing?.party_name ?? "");
  const [partyAddress, setPartyAddress] = useState(existing?.party_address ?? "");
  const [purpose, setPurpose] = useState(existing?.purpose ?? "");
  const [expected, setExpected] = useState(existing?.expected_return_date ?? "");
  const [vehicle, setVehicle] = useState(existing?.vehicle_no ?? "");
  const [transporter, setTransporter] = useState(existing?.transporter ?? "");
  // An editable sub-table opens with a row (AGENTS.md); the grid keeps one blank end row.
  const [lines, setLines] = useState<Line[]>(() => [
    ...(existing?.lines ?? []).map((l) => ({
      key: l.id,
      itemId: l.item_id ?? "",
      description: l.description,
      storeId: l.from_store_id ?? "",
      binId: l.bin_id ?? "",
      lotNo: l.lot_no ?? "",
      qty: String(l.sent_qty),
      uomId: l.uom_id ?? "",
      value: l.approx_value == null ? "" : String(l.approx_value),
    })),
    blankLine(),
  ]);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setDirty(true);
    set(v);
  };
  function update(key: string, patch: Partial<Omit<Line, "key">>) {
    setDirty(true);
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const stockOf = (storeId: string, itemId: string) => stock.find((s) => s.store_id === storeId && s.item_id === itemId);
  // One option per item the unit holds anywhere it can send from; the store follows the item.
  const itemOptions: ComboboxOption[] = (() => {
    const seen = new Map<string, { label: string; qty: number; uom: string | null }>();
    for (const s of stock) {
      if (!sendStores.some((x) => x.id === s.store_id)) continue;
      const a = seen.get(s.item_id) ?? { label: s.item_name, qty: 0, uom: s.uom };
      a.qty += s.qty;
      seen.set(s.item_id, a);
    }
    return [...seen.entries()].map(([value, a]) => ({ value, label: a.label, sublabel: `${fmtNumber(a.qty)} ${a.uom ?? ""}`.trim() }));
  })();
  const vendorOptions: ComboboxOption[] = vendors
    .filter((v) => !v.inactive || v.id === vendorId)
    .map((v) => ({ value: v.id, label: v.name }));

  function pickItem(l: Line, itemId: string) {
    if (!itemId) {
      update(l.key, { itemId: "", storeId: "", binId: "", lotNo: "" });
      return;
    }
    const held = stock.filter((s) => s.item_id === itemId && sendStores.some((x) => x.id === s.store_id)).sort((a, b) => b.qty - a.qty);
    const storeId = held.some((h) => h.store_id === l.storeId) ? l.storeId : (held[0]?.store_id ?? "");
    const s = held[0];
    const uomId = s?.uom ? (uoms.find((u) => u.code === s.uom)?.id ?? l.uomId) : l.uomId;
    update(l.key, { itemId, storeId, uomId, description: l.description.trim() ? l.description : (s?.item_name ?? "") });
  }

  const filled = lines.filter((l) => !isBlank(l));
  const problemOf = (l: Line): string | null => {
    if (isBlank(l)) return null;
    if (num(l.qty) <= 0) return "Enter the qty";
    if (!l.itemId) return null;
    const have = stockOf(l.storeId, l.itemId)?.qty ?? 0;
    return num(l.qty) > have + 1e-9 ? `Only ${fmtNumber(have)} in this store` : null;
  };
  const lineProblems = filled.some((l) => !!problemOf(l) || !l.description.trim() || (!!l.itemId && !l.storeId));
  const partyOk = partyMode === "vendor" ? !!vendorId : !!partyName.trim();
  const blocker = !dcDate
    ? "Pick the DC date"
    : !partyOk
      ? partyMode === "vendor"
        ? "Pick the vendor"
        : "Type the party's name"
      : !purpose.trim()
        ? "Say why the goods are going out"
        : returnable === "yes" && !expected
          ? "Pick the expected return date"
          : filled.length === 0
            ? "Add at least one line"
            : lineProblems
              ? "Fix the lines marked in red"
              : null;
  const canSave = !isPending && !blocker;

  function save(dispatch: boolean) {
    if (!canSave) return;
    startTransition(async () => {
      const result = await saveGeneralDc(
        existing?.id ?? null,
        {
          dc_date: dcDate,
          is_returnable: returnable === "yes",
          vendor_id: partyMode === "vendor" ? vendorId || null : null,
          party_name: partyMode === "other" ? partyName.trim() || null : null,
          party_address: partyMode === "other" ? partyAddress.trim() || null : null,
          purpose: purpose.trim(),
          expected_return_date: returnable === "yes" ? expected || null : null,
          vehicle_no: vehicle.trim() || null,
          transporter: transporter.trim() || null,
          notes: null,
          lines: filled.map((l) => ({
            item_id: l.itemId || null,
            description: l.description.trim(),
            sent_qty: num(l.qty),
            uom_id: l.uomId || null,
            from_store_id: l.itemId ? l.storeId || null : null,
            bin_id: l.itemId ? l.binId || null : null,
            lot_no: l.itemId ? l.lotNo.trim() || null : null,
            approx_value: l.value.trim() ? num(l.value) : null,
          })),
        },
        dispatch,
      );
      if (result.ok) {
        setDirty(false);
        success(dispatch ? (returnable === "yes" ? "Dispatched — due back on a Delivery Return" : "Dispatched") : "Saved as a draft");
        router.push(dispatch ? `/purchase/general-delivery/${result.id}/print` : home);
      } else {
        toastError(result.error);
        router.refresh();
      }
    });
  }

  /*
   * Item 176 · Description 200 · From Store · Bin 176 (one button, 2026-11-03) · Lot No 112 ·
   * Qty 88 · UOM 88 · Approx. Value 112 = 952, + 72 chrome (`#` and ✕) = 1024 <= 1155 ->
   * tableFrom="5xl".
   */
  const generalDcLineColumns: ChildGridColumn<Line>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.term,
      // The same stock item twice on one challan is one line typed twice.
      unique: (l) => l.itemId || null,
      cell: (l) => (
        <Combobox
          aria-label="Item"
          compact
          clearable
          options={itemOptions}
          value={l.itemId}
          openOnFocus={false}
          placeholder="Free text"
          onChange={(v) => pickItem(l, v)}
        />
      ),
    },
    {
      header: "Description",
      width: FIELD_WIDTH_CSS.party,
      required: true,
      cell: (l) => (
        <Input aria-label="Description" className="h-8" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
      ),
    },
    {
      // ONE BUTTON, STORE AND BIN IN A POP-UP — GRN's cell (user 2026-11-03, screenshot 095545).
      // A free-text line moves no stock, so it has no store or bin to pick.
      header: "From Store · Bin",
      width: FIELD_WIDTH_CSS.term,
      // pick-once: exempt -- several lines may leave from the same store and bin
      cell: (l) =>
        l.itemId ? (
          <StoreBinPickCell
            description={l.description || "line"}
            parent="DC"
            stores={sendStores}
            storeId={l.storeId}
            onStore={(v) => update(l.key, { storeId: v })}
            storeLabel="From store"
            allowNoStore
            bins={bins}
            binId={l.binId}
            onBin={(v) => update(l.key, { binId: v })}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Free text — no stock</span>
        ),
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Input aria-label="Lot No" className="h-8" value={l.lotNo} disabled={!l.itemId} onChange={(e) => update(l.key, { lotNo: e.target.value })} />
      ),
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
              aria-describedby={problem ? `gdc-qty-${l.key}-error` : undefined}
              className="h-8 text-right tabular-nums"
              value={l.qty}
              onChange={(e) => update(l.key, { qty: e.target.value })}
            />
            <FieldError id={`gdc-qty-${l.key}-error`}>{problem}</FieldError>
          </>
        );
      },
    },
    {
      header: "UOM",
      width: FIELD_WIDTH_CSS.hug,
      // pick-once: exempt -- a unit of measure repeats across lines
      cell: (l) => (
        <Select aria-label="UOM" className="h-8" value={l.uomId} onChange={(e) => update(l.key, { uomId: e.target.value })}>
          <option value="">—</option>
          {uoms.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Approx. Value",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (l) => (
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          aria-label="Approx. value"
          className="h-8 text-right tabular-nums"
          value={l.value}
          onChange={(e) => update(l.key, { value: e.target.value })}
        />
      ),
    },
  ];

  return (
    <div data-focus-scope className="space-y-5">
      {/* Unit 176 · Date 144 · Returnable 200 · Party 200 · (Address 288) · Purpose 176 ·
          Expected 144 · Vehicle 144 · Transporter 176 — wraps to two rows inside 72rem. */}
      <Card className="max-w-[72rem]">
        <CardHeader>
          <CardTitle>{existing ? `General DC ${existing.code ?? ""}` : "New General DC"}</CardTitle>
          <span className="text-xs text-muted-foreground">Repair, sample, loan or gift — not for sale</span>
        </CardHeader>
        <CardBody>
          <FieldRow>
            <Field label="Unit" w="term" htmlFor="gdc-unit">
              <Input id="gdc-unit" value={unit.name} readOnly />
            </Field>
            <Field label="DC Date" required w="code" htmlFor="gdc-date">
              <Input id="gdc-date" type="date" max="9999-12-31" value={dcDate} onChange={(e) => touch(setDcDate)(e.target.value)} />
            </Field>
            <Field label="Returnable" w="party">
              <Segmented<"yes" | "no">
                name="gdc-returnable"
                value={returnable}
                onChange={touch(setReturnable)}
                options={[
                  { value: "yes", label: "Returnable" },
                  { value: "no", label: "Non-returnable" },
                ]}
              />
            </Field>
            <Field label="Party Is" w="party">
              <Segmented<PartyMode>
                name="gdc-party-mode"
                value={partyMode}
                onChange={touch(setPartyMode)}
                options={[
                  { value: "vendor", label: "Vendor" },
                  { value: "other", label: "Other" },
                ]}
              />
            </Field>
            {partyMode === "vendor" ? (
              <Field label="Vendor" required w="party" htmlFor="gdc-vendor">
                <Combobox id="gdc-vendor" options={vendorOptions} value={vendorId} onChange={touch(setVendorId)} required />
              </Field>
            ) : (
              <>
                <Field label="Party Name" required w="party" htmlFor="gdc-party">
                  <Input id="gdc-party" value={partyName} onChange={(e) => touch(setPartyName)(e.target.value)} />
                </Field>
                <Field label="Address" w="name" htmlFor="gdc-address">
                  <Input id="gdc-address" value={partyAddress} onChange={(e) => touch(setPartyAddress)(e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Purpose" required w="term" htmlFor="gdc-purpose">
              <Input id="gdc-purpose" value={purpose} placeholder="Repair, sample…" onChange={(e) => touch(setPurpose)(e.target.value)} />
            </Field>
            {returnable === "yes" ? (
              <Field label="Expected Return" required w="code" htmlFor="gdc-expected">
                <Input
                  id="gdc-expected"
                  type="date"
                  max="9999-12-31"
                  min={dcDate || undefined}
                  value={expected}
                  onChange={(e) => touch(setExpected)(e.target.value)}
                />
              </Field>
            ) : null}
            <Field label="Vehicle No" w="code" htmlFor="gdc-vehicle">
              <Input id="gdc-vehicle" value={vehicle} onChange={(e) => touch(setVehicle)(e.target.value)} />
            </Field>
            <Field label="Transporter" w="term" htmlFor="gdc-transporter">
              <Input id="gdc-transporter" value={transporter} onChange={(e) => touch(setTransporter)(e.target.value)} />
            </Field>
          </FieldRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items Sent</CardTitle>
          <span className="text-xs text-muted-foreground">Pick a stock item, or leave Item blank and describe it (moves no stock)</span>
        </CardHeader>
        <CardBody>
          <ChildGrid<Line>
            columns={generalDcLineColumns}
            rows={lines}
            tableFrom="5xl"
            flatRows
            tailRow={isBlank}
            onAdd={() => setLines((prev) => [...prev, blankLine()])}
            onRemove={(r) => {
              setDirty(true);
              setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== r.key) : [blankLine()]));
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
        {blocker && !isPending ? <span className="text-sm text-muted-foreground">{blocker}</span> : null}
      </div>
    </div>
  );
}
