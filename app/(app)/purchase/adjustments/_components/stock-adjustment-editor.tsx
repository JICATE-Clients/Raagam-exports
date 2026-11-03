"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ToggleGroup } from "@/components/ui/segmented";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { DOC_BOTTOM_BAR, DOC_FRAME } from "@/components/purchase/doc-surface";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  cancelStockAdjustment,
  loadAdjustmentLayers,
  postStockAdjustment,
  saveStockAdjustment,
} from "@/lib/stores/stock-adjustment-actions";
import {
  ADJ_DIRECTIONS,
  ADJ_REASONS,
  ADJ_STOCK_TYPES,
  STOCK_ADJUSTMENT_STATUS_LABELS,
  signedQty,
  storeFitsType,
  type AdjDirection,
  type AdjLayer,
  type AdjOrderOption,
  type AdjReason,
  type AdjStockType,
  type AdjStoreOption,
  type StockAdjustment,
  type StockAdjustmentLine,
} from "@/lib/stores/stock-adjustment-types";

const BASE = "/purchase/adjustments";
/** The Group box's value for General Stock (an order id otherwise). */
const GENERAL = "general";

type Row = {
  key: string;
  layerId: string;
  direction: AdjDirection;
  reason: AdjReason;
  qty: string;
  bags: string;
};

const EMPTY: Omit<Row, "key"> = { layerId: "", direction: "increase", reason: "moisture", qty: "", bags: "" };
/**
 * Nothing the operator TYPED — Type and Reason are pre-filled defaults, so they are not evidence
 * (AGENTS "the seeded row is saved unless the save drops it").
 */
const isBlank = (r: Row) => !r.layerId && !r.qty.trim() && !r.bags.trim();

function rowsFrom(lines: StockAdjustmentLine[]): Row[] {
  return lines.map((l) => ({
    key: l.id,
    layerId: l.source_ledger_id,
    direction: l.direction,
    reason: l.reason,
    qty: String(l.quantity),
    bags: l.bags == null ? "" : String(l.bags),
  }));
}

/**
 * STOCK ADJUSTMENT — one screen for new, draft and posted (read-only). DB 0805.
 *
 * The header says WHERE (store), WHAT STATUS (Accepted / Rejected / Replacement — which also
 * decides the stores offered) and WHOSE (General Stock or an RE / IWO / SWO). Each line picks one
 * LOT on hand there and says Increase or Decrease; Rate is the lot's, never typed, and the post
 * keeps the lot's place in FIFO, so a moisture gain does not age-reset the yarn. Save keeps a
 * draft; Post writes the ledger in one transaction and the document is read-only after.
 */
export function StockAdjustmentEditor({
  doc,
  lines,
  stores,
  orders,
  initialLayers,
  canSeeMoney,
  today = "",
  canEdit,
  canPost,
}: {
  doc: StockAdjustment | null;
  lines: StockAdjustmentLine[];
  stores: AdjStoreOption[];
  orders: AdjOrderOption[];
  initialLayers: AdjLayer[];
  canSeeMoney: boolean;
  today?: string;
  canEdit: boolean;
  canPost: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [isLoading, startLoad] = useTransition();

  const readOnly = !canEdit || (!!doc && doc.status !== "draft");

  const [date, setDate] = useState(doc?.adjustment_date ?? today);
  const [stockType, setStockType] = useState<AdjStockType>(doc?.stock_type ?? "accepted");
  const [storeId, setStoreId] = useState(doc?.store_id ?? "");
  const [group, setGroup] = useState(doc ? (doc.garment_order_id ?? doc.iwo_id ?? GENERAL) : GENERAL);
  const [remarks, setRemarks] = useState(doc?.remarks ?? "");
  // Row keys: saved lines keep their id; new rows draw from a counter bumped only in handlers,
  // so render stays pure for the React Compiler.
  const keySeq = useRef(0);
  const blankRow = (): Row => ({ key: `new-${keySeq.current++}`, ...EMPTY });
  const [rows, setRows] = useState<Row[]>(() => {
    const r = rowsFrom(lines);
    return readOnly ? r : [...r, { key: "tail-0", ...EMPTY }];
  });
  const [layers, setLayers] = useState<AdjLayer[]>(initialLayers);
  const [confirm, setConfirm] = useState<"post" | "cancel" | null>(null);

  const typed = rows.filter((r) => !isBlank(r));
  const current = JSON.stringify([date, stockType, storeId, group, remarks.trim().toUpperCase(), typed.map((r) => [r.layerId, r.direction, r.reason, r.qty, r.bags])]);
  const [baseline, setBaseline] = useState(current);
  const dirty = !readOnly && current !== baseline;
  useUnsavedGuard(dirty || isPending);

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const layerById = useMemo(() => new Map(layers.map((l) => [l.layer_id, l])), [layers]);
  const savedById = useMemo(() => new Map(lines.map((l) => [l.source_ledger_id, l])), [lines]);

  const groupOrder = group === GENERAL ? undefined : orderById.get(group);
  const groupName = group === GENERAL ? "GENSTK · General Stock" : (groupOrder?.label ?? "—");
  const storeOptions = stores.filter((s) => storeFitsType(s.store_type, stockType) || s.id === storeId);

  function ids(g: string): { re: string | null; iwo: string | null } {
    if (g === GENERAL) return { re: null, iwo: null };
    const o = orderById.get(g);
    if (!o) return { re: null, iwo: null };
    return o.kind === "re" ? { re: o.id, iwo: null } : { re: null, iwo: o.id };
  }

  /** Reload the lots on hand. Every line drew on the old list, so the lines go too (unless only the date moved). */
  function reload(store: string, g: string, type: AdjStockType, d: string, keepRows = false) {
    if (!keepRows) setRows([blankRow()]);
    if (!store) return setLayers([]);
    const o = ids(g);
    startLoad(async () => {
      const res = await loadAdjustmentLayers(store, o.re, o.iwo, type, d || null);
      if (!res.ok) return toastError(res.error);
      setLayers(res.layers);
    });
  }

  function pickType(t: AdjStockType) {
    setStockType(t);
    const fits = stores.find((s) => s.id === storeId);
    const next = fits && storeFitsType(fits.store_type, t) ? storeId : "";
    setStoreId(next);
    reload(next, group, t, date);
  }
  function pickStore(id: string) {
    setStoreId(id);
    reload(id, group, stockType, date);
  }
  function pickGroup(id: string) {
    const g = id || GENERAL;
    setGroup(g);
    reload(storeId, g, stockType, date);
  }
  function pickDate(d: string) {
    setDate(d);
    if (storeId) reload(storeId, group, stockType, d, true);
  }
  function setRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  // ---------- what the screen can answer before Post ----------
  const qtyOf = (r: Row) => Number(r.qty);
  const availOf = (r: Row) => layerById.get(r.layerId)?.qty_on_hand ?? 0;
  const overAvail = (r: Row) =>
    !readOnly && r.direction === "decrease" && !!r.layerId && Number.isFinite(qtyOf(r)) && qtyOf(r) > availOf(r) + 1e-9;
  const gone = (r: Row) => !readOnly && !!r.layerId && !layerById.has(r.layerId);
  const anyBad = typed.some((r) => overAvail(r) || gone(r) || !r.layerId || !(qtyOf(r) > 0));
  const canSave = !readOnly && !!date && !!storeId && !!remarks.trim() && typed.length > 0 && !anyBad;

  const rateOf = (r: Row): number | null =>
    readOnly ? (savedById.get(r.layerId)?.rate ?? null) : (layerById.get(r.layerId)?.rate ?? null);
  const valueOf = (r: Row): number | null => {
    const rate = rateOf(r);
    return rate == null || !Number.isFinite(qtyOf(r)) ? null : signedQty(r.direction, qtyOf(r)) * rate;
  };

  function save() {
    if (!canSave) return;
    const o = ids(group);
    start(async () => {
      const res = await saveStockAdjustment(doc?.id ?? null, {
        adjustment_date: date,
        stock_type: stockType,
        store_id: storeId,
        garment_order_id: o.re,
        iwo_id: o.iwo,
        remarks: remarks.trim() || null,
        // The blank tail row is never saved.
        lines: typed.map((r) => ({
          source_ledger_id: r.layerId,
          direction: r.direction,
          reason: r.reason,
          quantity: qtyOf(r),
          bags: r.bags.trim() ? Number(r.bags) : null,
        })),
      });
      if (!res.ok) return toastError(res.error);
      success("Stock adjustment saved");
      setBaseline(current);
      if (!doc) router.replace(`${BASE}/${res.id}`);
      else router.refresh();
    });
  }

  function post() {
    if (!doc) return;
    start(async () => {
      const res = await postStockAdjustment(doc.id);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Posted — stock and value are adjusted");
      router.refresh();
    });
  }

  function cancelDoc() {
    if (!doc) return;
    start(async () => {
      const res = await cancelStockAdjustment(doc.id);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Stock adjustment cancelled");
      router.refresh();
    });
  }

  const groupOptions: ComboboxOption[] = [
    { value: GENERAL, label: "GENSTK · General Stock" },
    ...orders
      .filter((o) => !o.inactive || o.id === group)
      .map((o) => ({ value: o.id, label: o.label, sublabel: [o.kind.toUpperCase(), o.customer].filter(Boolean).join(" · ") })),
  ];

  const layerOptions: ComboboxOption[] = layers.map((l) => ({
    value: l.layer_id,
    label: l.item_name,
    sublabel: [l.item_class, l.lot_no ? `Lot ${l.lot_no}` : null, l.bin_code, `${fmtNumber(l.qty_on_hand)} ${l.uom_code ?? ""}`.trim()]
      .filter(Boolean)
      .join(" · "),
    search: [l.item_name, l.lot_no, l.grn_code, l.bin_code, l.category].filter(Boolean).join(" "),
  }));

  /*
   * 200 + 176 + 88 + 112 + 112 + 72 + 112 + 112 = 984, + 72 chrome (`#` and ✕)
   * = 1056 <= 1155 -> tableFrom="5xl". Item class and UOM ride in the lot picker's sub-line,
   * the store is the header's (one store per adjustment), Rate sits under Value.
   */
  const adjustmentLineColumns: ChildGridColumn<Row>[] = [
    {
      header: "Item · Lot",
      width: FIELD_WIDTH_CSS.party,
      required: true,
      unique: (r) => r.layerId || null,
      cell: (r) => {
        const saved = savedById.get(r.layerId);
        if (readOnly) return <span className="text-sm">{saved?.item_name ?? "—"}</span>;
        return (
          <Combobox
            options={
              r.layerId && !layerById.has(r.layerId)
                ? [{ value: r.layerId, label: saved?.item_name ?? "No longer on hand", disabled: true }, ...layerOptions]
                : layerOptions
            }
            value={r.layerId}
            onChange={(v) => setRow(r.key, { layerId: v })}
            placeholder={storeId ? (isLoading ? "Loading…" : layers.length ? "Pick a lot" : "Nothing on hand") : "Pick the store"}
            disabled={!storeId}
            required
          />
        );
      },
    },
    {
      header: "Lot · Bin · Age",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => {
        const l = layerById.get(r.layerId);
        const saved = savedById.get(r.layerId);
        if (!l && !saved) return <span className="text-sm text-muted-foreground">—</span>;
        const lot = l?.lot_no ?? saved?.lot_no;
        const bin = l?.bin_code ?? saved?.bin_code;
        return (
          <span className="text-xs leading-tight">
            <span className="block">
              {lot ? `Lot ${lot}` : "No lot"}
              {bin ? ` · ${bin}` : ""}
            </span>
            {l ? (
              <span className="block text-muted-foreground">
                {l.grn_code ?? "—"} · {l.age_days ?? 0} d
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      header: "On hand",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => {
        if (readOnly || !r.layerId) return <span className="text-sm text-muted-foreground">—</span>;
        if (gone(r)) return <span className="text-xs text-destructive">Gone</span>;
        const l = layerById.get(r.layerId);
        return (
          <span className="tabular-nums text-sm">
            {fmtNumber(l?.qty_on_hand ?? 0)} <span className="text-xs text-muted-foreground">{l?.uom_code ?? ""}</span>
          </span>
        );
      },
    },
    {
      header: "Type",
      width: FIELD_WIDTH_CSS.range,
      // pick-once: exempt -- every line is an Increase or a Decrease; the word repeats by nature
      cell: (r) =>
        readOnly ? (
          <span className={`text-sm font-medium ${r.direction === "increase" ? "text-success" : "text-destructive"}`}>
            {ADJ_DIRECTIONS.find((d) => d.value === r.direction)?.label}
          </span>
        ) : (
          <Select aria-label="Increase or decrease" value={r.direction} onChange={(e) => setRow(r.key, { direction: e.target.value as AdjDirection })}>
            {ADJ_DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        ),
    },
    {
      header: "Reason",
      width: FIELD_WIDTH_CSS.range,
      // pick-once: exempt -- a fixed list of reasons; many lines share one
      cell: (r) =>
        readOnly ? (
          <span className="text-sm">{ADJ_REASONS.find((x) => x.value === r.reason)?.label}</span>
        ) : (
          <Select aria-label="Reason" value={r.reason} onChange={(e) => setRow(r.key, { reason: e.target.value as AdjReason })}>
            {ADJ_REASONS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
        ),
    },
    {
      header: "Bags",
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      cell: (r) =>
        readOnly ? (
          <span className="tabular-nums text-sm">{r.bags || "—"}</span>
        ) : (
          <Input type="number" min="0" step="1" aria-label="Bags" value={r.bags} onChange={(e) => setRow(r.key, { bags: e.target.value })} />
        ),
    },
    {
      header: "Adj. Qty",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      required: true,
      total: { kind: "sum", of: (r) => (isBlank(r) || !Number.isFinite(qtyOf(r)) ? 0 : signedQty(r.direction, qtyOf(r))) },
      cell: (r) => {
        if (readOnly) {
          return (
            <span className="tabular-nums text-sm font-semibold">
              {r.direction === "decrease" ? "−" : "+"}
              {fmtNumber(qtyOf(r))}
            </span>
          );
        }
        const after = r.layerId && Number.isFinite(qtyOf(r)) && qtyOf(r) > 0 ? availOf(r) + signedQty(r.direction, qtyOf(r)) : null;
        return (
          <span className="block">
            <Input
              type="number"
              min="0"
              step="any"
              aria-label="Adjustment qty"
              aria-invalid={overAvail(r) || undefined}
              title={overAvail(r) ? `Only ${fmtNumber(availOf(r))} in this lot` : undefined}
              value={r.qty}
              onChange={(e) => setRow(r.key, { qty: e.target.value })}
              required
            />
            {after != null && !overAvail(r) ? (
              <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">After: {fmtNumber(after)}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      header: "Value",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      total: canSeeMoney ? { kind: "sum", of: (r) => valueOf(r) ?? 0, format: (n) => fmtMoney(n) } : { kind: "blank" },
      cell: (r) => {
        const v = valueOf(r);
        const rate = rateOf(r);
        if (!canSeeMoney || v == null) return <span className="text-sm text-muted-foreground">—</span>;
        return (
          <span className="text-xs leading-tight">
            <span className={`block tabular-nums text-sm ${v < 0 ? "text-destructive" : "text-success"}`}>
              {v > 0 ? "+" : ""}
              {fmtMoney(v)}
            </span>
            <span className="block tabular-nums text-muted-foreground">@ {fmtMoney(rate)}</span>
          </span>
        );
      },
    },
  ];

  const status = doc?.status ?? "draft";
  const title = doc ? (doc.code ?? "Stock Adjustment") : "New Stock Adjustment";
  const anyOver = typed.some(overAvail);
  const anyGone = typed.some(gone);

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={doc ? `${stores.find((s) => s.id === storeId)?.name ?? "—"} · ${groupName}` : "Increase or decrease a lot to match the scale — moisture, recount, damage"}
        actions={doc ? <StatusPill tone={statusTone(status)}>{STOCK_ADJUSTMENT_STATUS_LABELS[status]}</StatusPill> : null}
      />

      {/* 72rem: the 1056px line grid plus the frame's padding. */}
      <form
        className={`${DOC_FRAME} max-w-[72rem]`}
        data-focus-scope=""
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="space-y-4 p-4">
          <FieldRow>
            <Field label="Date" required w="code">
              <Input type="date" value={date} max={today || undefined} readOnly={readOnly} onChange={(e) => pickDate(e.target.value)} required />
            </Field>
            <Field label="Stock Type" required>
              {readOnly ? (
                <Input readOnly value={ADJ_STOCK_TYPES.find((t) => t.value === stockType)?.label ?? ""} />
              ) : (
                <ToggleGroup<AdjStockType>
                  label="Stock type"
                  value={stockType}
                  onChange={pickType}
                  options={ADJ_STOCK_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                />
              )}
            </Field>
            <Field label="Entry No" w="code">
              <Input readOnly value={doc?.code ?? "(auto)"} />
            </Field>
          </FieldRow>

          {/* 200 + 288 + 200 + 2 × 12 gap = 712px. */}
          <FieldRow>
            <Field label="Store" required w="party">
              {readOnly ? (
                <Input readOnly value={stores.find((s) => s.id === storeId)?.name ?? "—"} />
              ) : (
                <Select value={storeId} onChange={(e) => pickStore(e.target.value)} required>
                  <option value=""></option>
                  {storeOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Group No" required w="name">
              {readOnly ? (
                <Input readOnly value={groupName} />
              ) : (
                <Combobox options={groupOptions} value={group} onChange={pickGroup} placeholder="General Stock or an order" required />
              )}
            </Field>
            <Field label="Customer" w="party">
              <Input readOnly value={groupOrder?.customer ?? "—"} />
            </Field>
          </FieldRow>

          {stockType !== "accepted" && !readOnly && storeOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">This unit has no Rejection store — Rejected and Replacement stock is kept there.</p>
          ) : null}

          {/* default-row: exempt -- a blank tail row stands in for the seeded row (tailRow); the save drops it */}
          <ChildGrid<Row>
            label={readOnly ? "Adjusted" : "Lots to adjust"}
            columns={adjustmentLineColumns}
            rows={rows}
            tableFrom="5xl"
            flatRows
            hideAdd={readOnly}
            lockExisting={readOnly}
            keepOne={false}
            tailRow={readOnly ? undefined : isBlank}
            onAdd={() => {
              setRows((rs) => [...rs, blankRow()]);
            }}
            onRemove={(r) => setRows((rs) => rs.filter((x) => x.key !== r.key))}
          />
          {anyOver ? <p className="text-sm text-destructive">A decrease is more than that lot holds on the adjustment date.</p> : null}
          {anyGone ? <p className="text-sm text-destructive">A line&apos;s lot is no longer on hand — remove it or pick another lot.</p> : null}

          <FieldRow>
            <Field label="Remarks" required w="name">
              <Textarea
                rows={2}
                value={remarks}
                readOnly={readOnly}
                placeholder="e.g. Rainy season moisture gain — weighment audit"
                onChange={(e) => setRemarks(e.target.value)}
                required
              />
            </Field>
          </FieldRow>

          {doc?.posted_at ? <p className="text-xs text-muted-foreground">Posted {fmtDate(doc.posted_at)} — stock and value are adjusted. A posted adjustment cannot be changed.</p> : null}
        </div>

        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          {!readOnly && doc ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => setConfirm("cancel")}
              disabled={isPending}
            >
              Cancel this adjustment
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Link href={BASE} className={buttonClasses({ variant: "outline" })}>
              {readOnly ? "Close" : "Cancel"}
            </Link>
            {!readOnly ? (
              <Button type="submit" variant={doc && !dirty ? "outline" : "primary"} disabled={isPending || !canSave || (!!doc && !dirty)}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            ) : null}
            {!readOnly && doc && !dirty && canPost ? (
              <Button type="button" disabled={isPending || anyOver || anyGone || lines.length === 0} onClick={() => setConfirm("post")}>
                Post
              </Button>
            ) : null}
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirm === "post"}
        title={`Post ${doc?.code ?? "this adjustment"}?`}
        body="Each lot's stock and value change at the lot's own rate, keeping its GRN and inward date. A posted adjustment cannot be changed or deleted."
        confirmLabel="Post"
        tone="primary"
        isPending={isPending}
        onConfirm={post}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        title={`Cancel ${doc?.code ?? "this adjustment"}?`}
        body="Nothing has changed in stock yet. A cancelled adjustment stays on the list, read-only."
        confirmLabel="Cancel adjustment"
        cancelLabel="Keep"
        isPending={isPending}
        onConfirm={cancelDoc}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
