"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/ui/segmented";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker } from "@/components/masters/record-picker";
import { StoreBinCell } from "@/components/purchase/store-bin-editor";
import { DOC_BOTTOM_BAR, DOC_CHIP, DOC_FRAME } from "@/components/purchase/doc-surface";
import { fmtDate, fmtFixed, fmtMoney, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { pickedBins, splitBinsProblem, withTailBin, type SplitRow } from "@/lib/purchase/bin-split";
import { saveOpeningStock } from "@/lib/stores/opening-stock/actions";
import {
  GROUP_KINDS,
  OPENING_STOCK_STATUS_LABELS,
  STOCK_TYPES,
  STOCK_TYPE_LABELS,
  type GroupKind,
  type OpeningBinOption,
  type OpeningGroupOption,
  type OpeningItemOption,
  type OpeningStock,
  type OpeningStockLine,
  type OpeningStoreOption,
  type StockType,
} from "@/lib/stores/opening-stock/types";

const BASE = "/purchase/opening-stock";

/** One line as the screen holds it — strings while typed, numbers only at save. */
type Row = {
  key: string;
  itemId: string;
  storeId: string;
  bins: SplitRow[];
  lot: string;
  refNo: string;
  refDate: string;
  bags: string;
  bagWt: string;
  qty: string;
  rate: string;
};

let seq = 0;
const nextKey = (p: string) => `${p}${++seq}`;
const blankBin = (): SplitRow => ({ key: nextKey("b"), binId: "", qty: "" });
const num = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** A fresh line. The store is the header's — a value the operator did not type. */
function blankRow(storeId: string): Row {
  return { key: nextKey("l"), itemId: "", storeId, bins: [blankBin()], lot: "", refNo: "", refDate: "", bags: "", bagWt: "", qty: "", rate: "" };
}

/**
 * BLANK = NOTHING THE OPERATOR TYPED (AGENTS.md "A table may keep a blank end row"). The
 * store is pre-filled from the header, so it is not evidence; every other field is. This is
 * the grid's `tailRow` AND the save-side filter, so the blank end row is never saved.
 */
function isBlank(r: Row): boolean {
  return !r.itemId && !r.lot.trim() && !r.refNo.trim() && !r.refDate && !r.bags.trim() && !r.qty.trim() && !r.rate.trim() && pickedBins(r.bins).length === 0;
}

function rowsFrom(lines: OpeningStockLine[], headerStore: string): Row[] {
  const rows = lines.map<Row>((l) => {
    const qty = Number(l.quantity);
    const bins: SplitRow[] = l.bins.map((b) => ({ key: nextKey("b"), binId: b.bin_id, qty: String(b.qty), typed: true }));
    return {
      key: nextKey("l"),
      itemId: l.item_id,
      storeId: l.store_id ?? headerStore,
      bins: withTailBin(bins, blankBin, qty),
      lot: l.lot_no ?? "",
      refNo: l.ref_no ?? "",
      refDate: l.ref_date ?? "",
      bags: l.bags == null ? "" : String(l.bags),
      bagWt: l.bag_weight == null ? "" : String(l.bag_weight),
      qty: String(qty),
      rate: l.rate == null ? "" : String(l.rate),
    };
  });
  return rows;
}

/** What "unsaved" compares: the header and the typed lines, never the blank end row. */
function stateKey(h: Header, rows: Row[]): string {
  const lines = rows
    .filter((r) => !isBlank(r))
    .map((r) => [r.itemId, r.storeId, pickedBins(r.bins).map((b) => [b.binId, num(b.qty)]), r.lot.trim().toUpperCase(), r.refNo.trim().toUpperCase(), r.refDate, num(r.bags), num(r.bagWt), num(r.qty), r.rate.trim()]);
  return JSON.stringify([h, lines]);
}

type Header = {
  date: string;
  stockType: StockType;
  kind: GroupKind;
  orderId: string;
  storeId: string;
  notes: string;
};

/**
 * OPENING STOCK BALANCE — one screen for new, draft and posted (read-only). 0801, user
 * 2026-11-03: the legacy screen's fields and logic, on this app's document surface (GRN's
 * frame, a Store · Bin cell that lists only that store's bins, a sticky bottom bar).
 *
 *   Header — Opening Date, Stock Type (Accepted / Rejected / Replacement — Rejected and
 *   Replacement lock the store to the unit's Rejection store, because Stock Statement reads
 *   status off the store type), Target Store (every new line's store), Group Type → Order
 *   No, with the Buyer read off the order, never typed. Item Class is a FILTER on the line's
 *   item list and is not stored — the item already knows its class.
 *
 *   Lines — Item, Lot, the stock-take slip (Ref No / Date), Store · Bin (+ split), Bags ×
 *   Bag Wt for yarn (fills the qty), Qty, Rate (typed — opening stock has no PO; the item's
 *   budget rate is offered), Value. One blank row always waits at the end (`tailRow`).
 *
 *   Save keeps a draft; Save & Post writes the stock in the same transaction
 *   (`opening_stock_save`), and a refused post leaves nothing behind.
 */
export function OpeningStockEditor({
  doc,
  lines,
  items,
  stores,
  bins: initialBins,
  orders,
  today,
  canEdit,
  canCreateBin,
}: {
  doc: OpeningStock | null;
  lines: OpeningStockLine[];
  items: OpeningItemOption[];
  stores: OpeningStoreOption[];
  bins: OpeningBinOption[];
  orders: OpeningGroupOption[];
  today: string;
  canEdit: boolean;
  canCreateBin: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const readOnly = !canEdit || (!!doc && doc.status !== "draft");
  const rejectionStore = stores.find((s) => s.store_type === "rejection") ?? null;
  const firstAccepted = stores.find((s) => s.store_type === "material") ?? stores.find((s) => s.store_type !== "rejection") ?? null;

  const initialHeader: Header = {
    date: doc?.opening_date ?? today,
    stockType: doc?.stock_type ?? "accepted",
    kind: doc?.group_kind ?? "general",
    orderId: (doc?.group_kind === "re" ? doc?.garment_order_id : doc?.iwo_id) ?? "",
    storeId: doc?.store_id ?? firstAccepted?.id ?? "",
    notes: doc?.notes ?? "",
  };
  const [header, setHeader] = useState<Header>(initialHeader);
  const [classFilter, setClassFilter] = useState("");
  const [rows, setRows] = useState<Row[]>(() => {
    const r = rowsFrom(lines, initialHeader.storeId);
    return readOnly ? r : [...r, blankRow(initialHeader.storeId)];
  });
  const [bins, setBins] = useState(initialBins);
  const [baseline, setBaseline] = useState(() => stateKey(initialHeader, rowsFrom(lines, initialHeader.storeId)));
  const [confirmPost, setConfirmPost] = useState(false);

  const dirty = !readOnly && stateKey(header, rows) !== baseline;
  useUnsavedGuard(dirty || isPending);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const classes = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.item_class_id && i.item_class) m.set(i.item_class_id, i.item_class);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";

  /* Stock type decides which stores a line may use (0801 / 0793: status = store type). */
  const lineStores = header.stockType === "accepted" ? stores.filter((s) => s.store_type !== "rejection") : rejectionStore ? [rejectionStore] : [];
  const kindOrders = orders.filter((o) => o.kind === header.kind);
  const order = header.orderId ? (orders.find((o) => o.id === header.orderId) ?? null) : null;

  const patchRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // The bins follow the qty: an untyped Bin 1 holds it all (bin-split.ts).
        return { ...next, bins: withTailBin(next.bins, blankBin, num(next.qty)) };
      }),
    );

  function setStockType(t: StockType) {
    const store = t === "accepted" ? (header.storeId && header.storeId !== rejectionStore?.id ? header.storeId : (firstAccepted?.id ?? "")) : (rejectionStore?.id ?? "");
    setHeader((h) => ({ ...h, stockType: t, storeId: store }));
    // Every line moves with it; a bin of another store goes (0800).
    setRows((rs) => rs.map((r) => ({ ...r, storeId: store, bins: [blankBin()] })).map((r) => ({ ...r, bins: withTailBin(r.bins, blankBin, num(r.qty)) })));
  }

  function setHeaderStore(id: string) {
    const old = header.storeId;
    setHeader((h) => ({ ...h, storeId: id }));
    // Lines still on the old default follow the new one; a line the operator moved stays.
    setRows((rs) => rs.map((r) => (r.storeId === old ? { ...r, storeId: id, bins: withTailBin([blankBin()], blankBin, num(r.qty)) } : r)));
  }

  function pickItem(r: Row, id: string | null) {
    const it = id ? itemById.get(id) : undefined;
    const patch: Partial<Row> = { itemId: id ?? "" };
    if (it && !r.rate.trim() && it.budget_rate != null) patch.rate = String(it.budget_rate);
    if (it && !it.is_yarn) Object.assign(patch, { bags: "", bagWt: "" });
    patchRow(r.key, patch);
  }

  /** Bags × Bag Wt = Qty (yarn). A bag weight left blank is 50 kg — GRN's rule. */
  function setBags(r: Row, patch: { bags?: string; bagWt?: string }) {
    const bags = patch.bags ?? r.bags;
    let bagWt = patch.bagWt ?? r.bagWt;
    if (patch.bags !== undefined && bags.trim() && !bagWt.trim()) bagWt = "50";
    const qty = num(bags) > 0 && num(bagWt) > 0 ? String(round3(num(bags) * num(bagWt))) : r.qty;
    patchRow(r.key, { bags, bagWt, qty });
  }

  const typed = rows.filter((r) => !isBlank(r));
  const lineProblem = (r: Row): string | null => {
    if (!r.itemId) return "Pick the item";
    if (num(r.qty) <= 0) return "Enter the opening qty";
    if (!r.rate.trim() || num(r.rate) < 0) return "Enter the rate";
    if (!r.storeId) return "Pick the store";
    if (pickedBins(r.bins).length > 1 || pickedBins(r.bins).some((b) => b.typed)) return splitBinsProblem(r.bins, num(r.qty));
    return null;
  };
  const firstProblem = typed.map((r) => ({ r, p: lineProblem(r) })).find((x) => x.p);
  const headerProblem = !header.date
    ? "Enter the opening date"
    : !header.storeId
      ? "Pick the target store"
      : header.kind !== "general" && !header.orderId
        ? "Pick the order the stock is held for"
        : typed.length === 0
          ? "Add at least one line"
          : null;
  const problem = headerProblem ?? (firstProblem ? `${itemById.get(firstProblem.r.itemId)?.name ?? `Line ${rows.indexOf(firstProblem.r) + 1}`}: ${firstProblem.p}` : null);

  /* Totals: per UOM (kg and pieces are never added together) and value. */
  const qtyByUom = new Map<string, number>();
  let totalValue = 0;
  for (const r of typed) {
    const u = itemById.get(r.itemId)?.uom_code ?? "—";
    qtyByUom.set(u, round3((qtyByUom.get(u) ?? 0) + num(r.qty)));
    totalValue += num(r.qty) * num(r.rate);
  }

  function save(post: boolean) {
    if (problem) return toastError(problem);
    start(async () => {
      const res = await saveOpeningStock(
        doc?.id ?? null,
        {
          store_id: header.storeId,
          opening_date: header.date,
          stock_type: header.stockType,
          group_kind: header.kind,
          garment_order_id: header.kind === "re" ? header.orderId || null : null,
          iwo_id: header.kind === "iwo" || header.kind === "swo" ? header.orderId || null : null,
          notes: header.notes.trim() || null,
          lines: typed.map((r) => {
            const it = itemById.get(r.itemId);
            return {
              item_id: r.itemId,
              store_id: r.storeId || null,
              lot_no: r.lot.trim() || null,
              ref_no: r.refNo.trim() || null,
              ref_date: r.refDate || null,
              bags: it?.is_yarn && r.bags.trim() ? num(r.bags) : null,
              bag_weight: it?.is_yarn && r.bagWt.trim() ? num(r.bagWt) : null,
              quantity: num(r.qty),
              rate: num(r.rate),
              uom_id: it?.uom_id ?? null,
              note: null,
              bins: pickedBins(r.bins)
                .filter((b) => num(b.qty) > 0)
                .map((b) => ({ bin_id: b.binId, qty: num(b.qty) })),
            };
          }),
        },
        post,
      );
      setConfirmPost(false);
      if (!res.ok) return toastError(res.error);
      success(post ? "Posted — the opening stock is in the store" : "Opening stock saved");
      setBaseline(stateKey(header, rows));
      if (!doc) router.replace(`${BASE}/${res.id}`);
      else router.refresh();
    });
  }

  const itemOptions = (r: Row) =>
    items
      .filter((i) => !classFilter || i.item_class_id === classFilter || i.id === r.itemId)
      // With no class chosen, say each item's class (AGENTS.md "Cascading filters").
      .map((i) => (classFilter || !i.item_class ? i : { ...i, name: `${i.item_class} · ${i.name}` }));

  /*
   * 200 + 112 + 144 + 176 + 88 + 112 + 88 + 112 = 1032, + 72 chrome (the `#` and the ✕)
   * = 1104 <= 1155 -> tableFrom="5xl". Item Class is a header filter, not a column, and the
   * UOM sits under the qty, which is what buys the room.
   */
  const openingLineColumns: ChildGridColumn<Row>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.party,
      required: true,
      // pick-once: exempt -- the same item in two lots or two bins is real stock, not a duplicate
      cell: (r) => {
        const it = itemById.get(r.itemId);
        return readOnly ? (
          <div className="grid">
            <span className="text-sm">{it?.name ?? "—"}</span>
            {it?.item_class ? <span className="text-[11px] text-muted-foreground">{it.item_class}</span> : null}
          </div>
        ) : (
          <RecordPicker label="Item" compact required items={itemOptions(r)} value={r.itemId || null} onChange={(id) => pickItem(r, id)} />
        );
      },
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) =>
        readOnly ? (
          <span className="text-sm">{r.lot || "—"}</span>
        ) : (
          <Input aria-label="Lot no" value={r.lot} onChange={(e) => patchRow(r.key, { lot: e.target.value })} />
        ),
    },
    {
      header: "Ref No · Date",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) =>
        readOnly ? (
          <div className="grid text-sm">
            <span>{r.refNo || "—"}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{r.refDate ? fmtDate(r.refDate) : ""}</span>
          </div>
        ) : (
          <div className="grid gap-1">
            <Input aria-label="Stock-take ref no" placeholder="Ref No" className="h-8" value={r.refNo} onChange={(e) => patchRow(r.key, { refNo: e.target.value })} />
            <Input type="date" aria-label="Stock-take ref date" className="h-8" value={r.refDate} onChange={(e) => patchRow(r.key, { refDate: e.target.value })} />
          </div>
        ),
    },
    {
      header: "Store · Bin",
      width: FIELD_WIDTH_CSS.term,
      // pick-once: exempt -- one store and one bin take many items
      cell: (r) => {
        const it = itemById.get(r.itemId);
        if (readOnly) {
          const picked = pickedBins(r.bins);
          const codes = picked.map((b) => `${bins.find((x) => x.id === b.binId)?.code ?? "bin"} (${fmtNumber(num(b.qty))})`).join(", ");
          return (
            <div className="grid text-sm">
              <span>{storeName(r.storeId)}</span>
              <span className="text-[11px] text-muted-foreground">{codes || "no bin"}</span>
            </div>
          );
        }
        return (
          <StoreBinCell<SplitRow>
            inline
            parent="Opening Stock"
            description={it?.name ?? "this line"}
            stores={lineStores}
            storeId={r.storeId}
            onStore={(id) => patchRow(r.key, { storeId: id })}
            rows={r.bins}
            onRow={(k, patch) => patchRow(r.key, { bins: r.bins.map((b) => (b.key === k ? { ...b, ...patch } : b)) })}
            accepted={num(r.qty)}
            uom={it?.uom_code ?? null}
            bins={bins}
            canCreateBin={canCreateBin}
            onBinCreated={(b) => setBins((list) => [...list, { id: b.id, code: b.code, description: null, store_id: b.store_id }])}
          />
        );
      },
    },
    {
      header: "Bags × Wt",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => {
        const it = itemById.get(r.itemId);
        if (!it?.is_yarn) return <span className="text-xs text-muted-foreground">—</span>;
        return readOnly ? (
          <span className="text-sm tabular-nums">{r.bags ? `${fmtNumber(num(r.bags))} × ${fmtNumber(num(r.bagWt))}` : "—"}</span>
        ) : (
          <div className="grid gap-1">
            <Input type="number" min={0} inputMode="decimal" aria-label="Bags" placeholder="Bags" className="h-8 text-right tabular-nums" value={r.bags} onChange={(e) => setBags(r, { bags: e.target.value })} />
            <Input type="number" min={0} inputMode="decimal" aria-label="Bag weight (kg)" placeholder="Wt kg" className="h-8 text-right tabular-nums" value={r.bagWt} onChange={(e) => setBags(r, { bagWt: e.target.value })} />
          </div>
        );
      },
    },
    {
      header: "Opening Qty",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      required: true,
      cell: (r) => {
        const u = itemById.get(r.itemId)?.uom_code;
        return (
          <div className="grid gap-0.5">
            {readOnly ? (
              <span className="text-sm font-semibold tabular-nums">{fmtNumber(num(r.qty))}</span>
            ) : (
              <Input type="number" min={0} inputMode="decimal" aria-label="Opening qty" required className="text-right tabular-nums" value={r.qty} onChange={(e) => patchRow(r.key, { qty: e.target.value })} />
            )}
            {u ? <span className="text-right text-[11px] text-muted-foreground">{u}</span> : null}
          </div>
        );
      },
    },
    {
      header: "Rate ₹",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      required: true,
      cell: (r) =>
        readOnly ? (
          <span className="text-sm tabular-nums">{fmtFixed(num(r.rate))}</span>
        ) : (
          <Input type="number" min={0} inputMode="decimal" aria-label="Rate" required className="text-right tabular-nums" value={r.rate} onChange={(e) => patchRow(r.key, { rate: e.target.value })} />
        ),
    },
    {
      header: "Value ₹",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (r) => <span className="text-sm tabular-nums">{num(r.qty) && r.rate.trim() ? fmtFixed(num(r.qty) * num(r.rate)) : "—"}</span>,
    },
  ];

  const status = doc?.status ?? "draft";

  return (
    <div className="space-y-4">
      <PageHeader
        title={doc ? (doc.code ?? "Opening Stock") : "New Opening Stock"}
        description="Stock already on hand, counted into a store with its bin, lot and rate."
        actions={
          <div className="flex items-center gap-2">
            <span className={DOC_CHIP}>{doc?.code ?? "New"}</span>
            {doc ? <StatusPill tone={statusTone(status)}>{OPENING_STOCK_STATUS_LABELS[status]}</StatusPill> : null}
          </div>
        }
      />

      {/* 72rem: the 1104px line grid plus the frame's padding. */}
      <form
        className={`${DOC_FRAME} max-w-[72rem]`}
        data-focus-scope=""
        onSubmit={(e) => {
          e.preventDefault();
          if (!readOnly) setConfirmPost(true);
        }}
      >
        <div className="space-y-4 p-4">
          {/* 144 + 288 + 200 = 632 + 2 × 12 gap = 656px. */}
          <FieldRow>
            <Field label="Opening Date" required w="code">
              <Input type="date" value={header.date} readOnly={readOnly} required onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))} />
            </Field>
            <Field label="Stock Type" required w="name">
              {readOnly ? (
                <Input readOnly value={STOCK_TYPE_LABELS[header.stockType]} />
              ) : (
                <Segmented<StockType> name="opening-stock-type" value={header.stockType} onChange={setStockType} options={STOCK_TYPES.map((t) => ({ ...t }))} />
              )}
            </Field>
            <Field label="Target Store" required w="party">
              {readOnly || header.stockType !== "accepted" ? (
                <Input readOnly value={header.storeId ? storeName(header.storeId) : "No Rejection store in this unit"} />
              ) : (
                <Select value={header.storeId} required onChange={(e) => setHeaderStore(e.target.value)}>
                  {lineStores.length === 0 ? <option value="">No store in this unit</option> : null}
                  {lineStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </FieldRow>

          {/* 176 + 288 + 200 + 176 = 840 + 3 × 12 gap = 876px. */}
          <FieldRow>
            <Field label="Group Type" w="term">
              {readOnly ? (
                <Input readOnly value={GROUP_KINDS.find((g) => g.value === header.kind)?.label ?? ""} />
              ) : (
                <Select value={header.kind} onChange={(e) => setHeader((h) => ({ ...h, kind: e.target.value as GroupKind, orderId: "" }))}>
                  {GROUP_KINDS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {header.kind === "general" ? (
              <Field label="Group" w="name">
                <Input readOnly value="GENERAL STOCK" />
              </Field>
            ) : (
              <Field label="Order No" required w="name">
                {readOnly ? (
                  <Input readOnly value={order?.name ?? "—"} />
                ) : (
                  <RecordPicker label="Order No" compact required items={kindOrders} value={header.orderId || null} onChange={(id) => setHeader((h) => ({ ...h, orderId: id ?? "" }))} />
                )}
              </Field>
            )}
            <Field label="Buyer" w="party">
              <Input readOnly value={order?.customer_name ?? ""} />
            </Field>
            {!readOnly ? (
              <Field label="Item Class" w="term" hint="Narrows the item list">
                <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                  <option value="">All classes</option>
                  {classes.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </FieldRow>

          {header.stockType !== "accepted" && !rejectionStore ? (
            <p className="text-sm text-destructive">This unit has no Rejection store, so Rejected or Replacement stock has nowhere to go.</p>
          ) : null}

          <ChildGrid<Row>
            label="Items"
            columns={openingLineColumns}
            rows={rows}
            tableFrom="5xl"
            hideAdd={readOnly}
            hideRemove={readOnly}
            keepOne
            tailRow={readOnly ? undefined : isBlank}
            onAdd={() => setRows((rs) => [...rs, blankRow(header.storeId)])}
            onRemove={(r) => setRows((rs) => rs.filter((x) => x.key !== r.key))}
          />

          {/* 288px. */}
          <FieldRow>
            <Field label="Remarks" w="name">
              <Textarea rows={1} value={header.notes} readOnly={readOnly} onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))} />
            </Field>
          </FieldRow>

          {doc?.posted_at ? <p className="text-xs text-muted-foreground">Posted {fmtDate(doc.posted_at)} — the stock is in the ledger and on Stock Statement.</p> : null}
        </div>

        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          <span className="text-xs text-muted-foreground">
            Lines <span className="font-semibold text-foreground tabular-nums">{typed.length}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            Qty{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {qtyByUom.size === 0 ? "—" : [...qtyByUom].map(([u, q]) => `${fmtNumber(q)} ${u}`).join(" · ")}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            Value <span className="font-semibold text-foreground tabular-nums">{fmtMoney(totalValue)}</span>
          </span>
          {!readOnly && problem && typed.length > 0 ? <span className="text-xs text-[#8a5800]">{problem}</span> : null}
          <div className="ml-auto flex items-center gap-2">
            <Link href={BASE} className={buttonClasses({ variant: "outline" })}>
              {readOnly ? "Close" : "Cancel"}
            </Link>
            {!readOnly ? (
              <>
                <Button type="button" variant="outline" disabled={isPending || !!problem || (!!doc && !dirty)} onClick={() => save(false)}>
                  {isPending ? "Saving…" : "Save draft"}
                </Button>
                <Button type="submit" disabled={isPending || !!problem}>
                  Save &amp; Post
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmPost}
        title="Post this opening stock?"
        body={`${typed.length} line${typed.length === 1 ? "" : "s"}, ${fmtMoney(totalValue)}, go into stock as ${STOCK_TYPE_LABELS[header.stockType]} on ${fmtDate(header.date)}. A posted opening stock cannot be changed.`}
        confirmLabel="Save & Post"
        tone="primary"
        isPending={isPending}
        onConfirm={() => save(true)}
        onCancel={() => setConfirmPost(false)}
      />
    </div>
  );
}
