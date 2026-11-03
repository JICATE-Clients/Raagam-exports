"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Segmented } from "@/components/ui/segmented";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker } from "@/components/masters/record-picker";
import { BinQtyCell } from "@/components/purchase/store-bin-editor";
import { DOC_BOTTOM_BAR, DOC_CHIP, DOC_FRAME, DOC_RULE } from "@/components/purchase/doc-surface";
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

/** A fresh line. Its store is the header's, so the line carries none of its own. */
function blankRow(): Row {
  return { key: nextKey("l"), itemId: "", bins: [blankBin()], lot: "", refNo: "", refDate: "", bags: "", bagWt: "", qty: "", rate: "" };
}

/**
 * BLANK = NOTHING THE OPERATOR TYPED (AGENTS.md "A table may keep a blank end row"). The
 * store is pre-filled from the header, so it is not evidence; every other field is. This is
 * the grid's `tailRow` AND the save-side filter, so the blank end row is never saved.
 */
function isBlank(r: Row): boolean {
  return !r.itemId && !r.lot.trim() && !r.refNo.trim() && !r.refDate && !r.bags.trim() && !r.qty.trim() && !r.rate.trim() && pickedBins(r.bins).length === 0;
}

function rowsFrom(lines: OpeningStockLine[]): Row[] {
  const rows = lines.map<Row>((l) => {
    const qty = Number(l.quantity);
    const bins: SplitRow[] = l.bins.map((b) => ({ key: nextKey("b"), binId: b.bin_id, qty: String(b.qty), typed: true }));
    return {
      key: nextKey("l"),
      itemId: l.item_id,
      bins: withTailBin(bins, blankBin, qty, false),
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
    .map((r) => [r.itemId, pickedBins(r.bins).map((b) => [b.binId, num(b.qty)]), r.lot.trim().toUpperCase(), r.refNo.trim().toUpperCase(), r.refDate, num(r.bags), num(r.bagWt), num(r.qty), r.rate.trim()]);
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
 *   status off the store type), Store (the document's ONE store — lines pick bins in it), Group Type → Order
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
    const r = rowsFrom(lines);
    return readOnly ? r : [...r, blankRow()];
  });
  const [bins, setBins] = useState(initialBins);
  const [baseline, setBaseline] = useState(() => stateKey(initialHeader, rowsFrom(lines)));
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
        // GRN's rule (user 2026-11-03): nothing auto-filled — each bin holds what is typed,
        // and a blank bin row waits while the bins hold less than the qty.
        return { ...next, bins: withTailBin(next.bins, blankBin, num(next.qty), false) };
      }),
    );

  function setStockType(t: StockType) {
    const store = t === "accepted" ? (header.storeId && header.storeId !== rejectionStore?.id ? header.storeId : (firstAccepted?.id ?? "")) : (rejectionStore?.id ?? "");
    setHeader((h) => ({ ...h, stockType: t, storeId: store }));
    // Every line moves with it; a bin of another store goes (0800).
    if (store !== header.storeId) setRows((rs) => rs.map((r) => ({ ...r, bins: [blankBin()] })));
  }

  /** GRN's Received Store (user 2026-11-03): every line is in this store, so changing it
   *  clears every line's bins — the Bin list follows the Store (0800). */
  function setHeaderStore(id: string) {
    if (id === header.storeId) return;
    setHeader((h) => ({ ...h, storeId: id }));
    setRows((rs) => rs.map((r) => ({ ...r, bins: [blankBin()] })));
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
    return splitBinsProblem(r.bins, num(r.qty));
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
              store_id: header.storeId,
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
   * 200 + 112 + 144 + 176 + 112 + 112 + 88 + 112 = 1056, + 72 chrome (the `#` and the ✕)
   * = 1128 <= 1155 -> tableFrom="5xl". Item Class is a header filter, not a column, and the
   * UOM sits under the qty, which is what buys the room. Bags takes `range`, not `hug`, so
   * "Bags × Wt" fits its header on one line (screenshot 4030: it wrapped).
   *
   * ONE BASELINE (screenshot 4030): a cell with nothing to type — a dash, a read-only
   * figure — sits in an `h-9` box, the height of the inputs beside it, so it lines up with
   * the first field of the row instead of floating at the cell's top edge.
   */
  const lineCell = (align: "left" | "right", children: ReactNode) => (
    <div className={`flex h-9 items-center ${align === "right" ? "justify-end" : ""}`}>{children}</div>
  );
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
      /*
       * BIN · QTY, NO STORE — GRN's cell (user 2026-11-03, GRN entry). The store is the
       * header's, so the line asks only WHERE in it: a Bin picker (that store's bins, 0800)
       * with its Qty box beside it, nothing pre-filled, and a blank bin row waiting while the
       * bins hold less than the line's qty. Bins are optional; picked ones must hold the qty
       * exactly (`splitBinsProblem`, re-checked by opening_stock_post).
       */
      header: "Bin",
      width: FIELD_WIDTH_CSS.term,
      // pick-once: exempt -- one bin takes many items
      cell: (r) => {
        const it = itemById.get(r.itemId);
        if (readOnly) {
          const picked = pickedBins(r.bins);
          return (
            <div className="grid gap-0.5 text-sm">
              {picked.length === 0
                ? lineCell("left", <span className="text-xs text-muted-foreground">No bin</span>)
                : picked.map((b) => (
                    <span key={b.key} className="flex h-9 items-center justify-between gap-2">
                      <span>{bins.find((x) => x.id === b.binId)?.code ?? "bin"}</span>
                      <span className="tabular-nums">{fmtNumber(num(b.qty))}</span>
                    </span>
                  ))}
            </div>
          );
        }
        return (
          <BinQtyCell<SplitRow>
            description={it?.name ?? "this line"}
            storeId={header.storeId}
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
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => {
        const it = itemById.get(r.itemId);
        if (!it?.is_yarn) return lineCell("left", <span className="text-xs text-muted-foreground">—</span>);
        return readOnly ? (
          lineCell("left", <span className="text-sm tabular-nums">{r.bags ? `${fmtNumber(num(r.bags))} × ${fmtNumber(num(r.bagWt))}` : "—"}</span>)
        ) : (
          <div className="grid gap-1">
            <Input type="number" min={0} inputMode="decimal" aria-label="Bags" placeholder="Bags" className="h-8 text-right tabular-nums" value={r.bags} onChange={(e) => setBags(r, { bags: e.target.value })} />
            <Input type="number" min={0} inputMode="decimal" aria-label="Bag weight (kg)" placeholder="Wt kg" className="h-8 text-right tabular-nums" value={r.bagWt} onChange={(e) => setBags(r, { bagWt: e.target.value })} />
          </div>
        );
      },
    },
    {
      // "Qty", not "Opening Qty" — the whole document is opening stock, and the longer word
      // wrapped the header onto two lines (screenshot 4030). The UOM sits under the box.
      header: "Qty",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      required: true,
      cell: (r) => {
        const u = itemById.get(r.itemId)?.uom_code;
        return (
          <div className="grid gap-0.5">
            {readOnly ? (
              lineCell("right", <span className="text-sm font-semibold tabular-nums">{fmtNumber(num(r.qty))}</span>)
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
          lineCell("right", <span className="text-sm tabular-nums">{fmtFixed(num(r.rate))}</span>)
        ) : (
          <Input type="number" min={0} inputMode="decimal" aria-label="Rate" required className="text-right tabular-nums" value={r.rate} onChange={(e) => patchRow(r.key, { rate: e.target.value })} />
        ),
    },
    {
      header: "Value ₹",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (r) =>
        lineCell(
          "right",
          num(r.qty) && r.rate.trim() ? (
            <span className="text-sm font-semibold tabular-nums">{fmtFixed(num(r.qty) * num(r.rate))}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        ),
    },
  ];

  const status = doc?.status ?? "draft";

  return (
    <div className="space-y-4">
      {/* Title and description only; the entry's own facts live in the frame's title row. */}
      <PageHeader
        title={doc ? (doc.code ?? "Opening Stock") : "New Opening Stock"}
        description="Stock already on hand, counted into a store with its bin, lot and rate."
      />

      {/* 72rem: the 1128px line grid plus the frame's padding. */}
      <form
        className={`${DOC_FRAME} max-w-[72rem]`}
        data-focus-scope=""
        onSubmit={(e) => {
          e.preventDefault();
          if (!readOnly) setConfirmPost(true);
        }}
      >
        {/* THE TITLE ROW IS PART OF THE DOCUMENT (GRN / Raise PO surface): the Entry No and
            status sit on the frame's top edge, not floating above it (screenshot 4030). */}
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2.5">
          <span className="text-sm font-semibold">Opening Stock Balance</span>
          <span className={DOC_CHIP}>{doc?.code ?? "New"}</span>
          {doc ? <StatusPill tone={statusTone(status)}>{OPENING_STOCK_STATUS_LABELS[status]}</StatusPill> : null}
        </div>
        <div className={`${DOC_RULE} space-y-4 p-4`}>
          {/*
           * ONE COLUMN GRID FOR BOTH ROWS (screenshot 4030: Stock Type ended where Group did
           * not, the store started where Buyer did not). Each column has one width and
           * holds one pair, read top then bottom:
           *   code 144  Opening Date / Group Type
           *   name 288  Stock Type   / Group or Order No
           *   party 200 Store        / Buyer
           *   name 288  Remarks      / Item Class (the line filter)
           * 144 + 288 + 200 + 288 = 920 + 3 x 12 gap = 956px. No field carries a hint: a hint
           * under one field lifted its label above the row's (Item Class did).
           */}
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
            {/* THE ONLY STORE ON THE DOCUMENT — GRN's Received Store (user 2026-11-03). Every
                line is put away here; the line's Bin list is this store's bins. */}
            <Field label="Store" required w="party" htmlFor="opening-store">
              {readOnly || header.stockType !== "accepted" ? (
                <Input id="opening-store" readOnly value={header.storeId ? storeName(header.storeId) : "No Rejection store in this unit"} />
              ) : (
                <Combobox
                  id="opening-store"
                  options={lineStores.map((st) => ({ value: st.id, label: st.name }))}
                  value={header.storeId}
                  placeholder="Store…"
                  openOnFocus={false}
                  onChange={(sid) => {
                    if (sid) setHeaderStore(sid);
                  }}
                />
              )}
            </Field>
            <Field label="Remarks" w="name">
              <Input value={header.notes} readOnly={readOnly} onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))} />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Group Type" w="code">
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
              <Field label="Item Class (filter)" w="name">
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
            onAdd={() => setRows((rs) => [...rs, blankRow()])}
            onRemove={(r) => setRows((rs) => rs.filter((x) => x.key !== r.key))}
          />

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
