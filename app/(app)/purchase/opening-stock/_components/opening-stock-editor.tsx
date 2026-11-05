"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { RecordPicker } from "@/components/masters/record-picker";
import { BinQtyCell } from "@/components/purchase/store-bin-editor";
import { DENSE, DOC_BOTTOM_BAR, DOC_CHIP, DOC_FRAME, DOC_RULE, DocRemarksLine, GRID_HEAD } from "@/components/purchase/doc-surface";
import { fmtDate, fmtFixed, fmtMoney, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { pickedBins, splitBinsProblem, withTailBin, type SplitRow } from "@/lib/purchase/bin-split";
import { loadOpeningOrderPlan, saveOpeningStock } from "@/lib/stores/opening-stock/actions";
import {
  GROUP_KINDS,
  OPENING_STOCK_STATUS_LABELS,
  STOCK_TYPES,
  STOCK_TYPE_LABELS,
  type GroupKind,
  type OpeningBinOption,
  type OpeningGroupOption,
  type OpeningItemOption,
  type OpeningOrderPlan,
  type OpeningPlanItem,
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
  initialPlan,
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
  /** The saved order's requirement plan (null for General or a new entry). */
  initialPlan: OpeningOrderPlan | null;
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
  /* The picked order's requirement plan (2026-11-05). Null = none asked for yet (General, or
     no order); a plan whose orderId is not the header's is a stale answer and is ignored. */
  const [plan, setPlan] = useState<OpeningOrderPlan | null>(initialPlan);

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

  /*
   * THE ORDER DECIDES THE ITEMS (doc/stores/opening-stock-order-items-plan.md). With an order
   * picked the Item list is that order's requirement plan; General keeps the whole master.
   * `planned` is null while the plan is not known (loading, or the read failed) — never an
   * empty Map, because an empty plan says "build the BOM" and a failed read must not.
   */
  const byOrder = header.kind !== "general";
  const livePlan = plan && plan.orderId === header.orderId ? plan : null;
  const planned: Map<string, OpeningPlanItem> | null =
    livePlan && "items" in livePlan ? new Map(livePlan.items.map((p) => [p.item_id, p])) : null;
  const planError = livePlan && "error" in livePlan ? livePlan.error : null;
  const orderLabel = order?.name.split(" — ")[0] ?? "This order";

  /** Order No changed: fetch its plan, then blank the item on lines the plan does not hold
   *  (their bins / qty stay, so nothing typed is lost). */
  function setOrder(id: string) {
    setHeader((h) => ({ ...h, orderId: id }));
    if (!id) return setPlan(null);
    start(async () => {
      const res = await loadOpeningOrderPlan(id);
      setPlan(res);
      if (!("items" in res)) return;
      const keep = new Set(res.items.map((p) => p.item_id));
      const cleared = rows.filter((r) => r.itemId && !keep.has(r.itemId)).length;
      setRows((rs) => rs.map((r) => (!r.itemId || keep.has(r.itemId) ? r : { ...r, itemId: "" })));
      if (cleared) toastError(`${cleared} line${cleared === 1 ? "" : "s"} cleared — not in this order's requirement plan`);
    });
  }

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
    if (byOrder && planned && !planned.has(r.itemId)) return `not in ${orderLabel}'s requirement plan`;
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
        : byOrder && !planned
          ? (planError ?? "Reading the order's requirement plan…")
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
      // An order's lines offer its plan only; the item a line already holds always survives.
      .filter((i) => !byOrder || i.id === r.itemId || !!planned?.has(i.id))
      .map((i) => {
        // With no class chosen, say each item's class (AGENTS.md "Cascading filters").
        const name = classFilter || !i.item_class ? i.name : `${i.item_class} · ${i.name}`;
        const p = byOrder ? planned?.get(i.id) : undefined;
        // The plan beside the item, so the storekeeper books against a real line.
        return { ...i, name: p ? `${name} · Bal ${fmtNumber(p.balance_qty)} ${p.uom_code ?? ""}`.trimEnd() : name };
      });

  /*
   * ONE LINE PER ROW (2026-11-05, "plan this table look fit"): Ref No and Ref Date are two
   * columns, Bags and Wt sit side by side, so no cell stacks two boxes.
   *   Item 176 · Lot 88 · Ref No 88 · Ref Date 144 · Bags×Wt 112 · Qty 112 · Rate 88 ·
   *   Bin 144 · Value 88 = 1040, + 72 chrome (the `#` and the ✕) = 1112 <= 1155 ->
   *   tableFrom="5xl". COMPACTED (user 2026-11-05, "compact the field widths"): Item
   *   200 → 176 (a long name reveals on hover), Bin 176 → 144 (picker ~68px + its 72px
   *   qty box; bin codes are short). Ref Date 112 → 144 the same day: at 112 the date
   *   box clipped its year (screenshot 4072). Item Class is a header filter, not a column, and the
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
      width: FIELD_WIDTH_CSS.term,
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
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) =>
        readOnly ? (
          <span className="text-sm">{r.lot || "—"}</span>
        ) : (
          <Input aria-label="Lot no" value={r.lot} onChange={(e) => patchRow(r.key, { lot: e.target.value })} />
        ),
    },
    // REF NO AND REF DATE, SIDE BY SIDE (2026-11-05): stacked in one cell they made every
    // row two boxes tall beside cells holding one box or a dash.
    {
      header: "Ref No",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) =>
        readOnly ? (
          lineCell("left", <span className="text-sm">{r.refNo || "—"}</span>)
        ) : (
          <Input aria-label="Stock-take ref no" value={r.refNo} onChange={(e) => patchRow(r.key, { refNo: e.target.value })} />
        ),
    },
    {
      header: "Ref Date",
      // code, not range: at 112px the date box clipped its year ("dd-mm-yy", screenshot 4072).
      width: FIELD_WIDTH_CSS.code,
      cell: (r) =>
        readOnly ? (
          lineCell("left", <span className="text-sm tabular-nums">{r.refDate ? fmtDate(r.refDate) : "—"}</span>)
        ) : (
          <Input type="date" aria-label="Stock-take ref date" value={r.refDate} onChange={(e) => patchRow(r.key, { refDate: e.target.value })} />
        ),
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
          // Side by side, one line (Stock Transfer's Bags · Cones cell).
          <div className="flex divide-x divide-border">
            <Input type="number" min={0} inputMode="decimal" aria-label="Bags" placeholder="Bags" className="text-right tabular-nums" value={r.bags} onChange={(e) => setBags(r, { bags: e.target.value })} />
            <Input type="number" min={0} inputMode="decimal" aria-label="Bag weight (kg)" placeholder="Wt" className="text-right tabular-nums" value={r.bagWt} onChange={(e) => setBags(r, { bagWt: e.target.value })} />
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
          // The UOM sits INSIDE the cell, after the figure — under it, it made the row two lines tall.
          <div className="flex items-center">
            {readOnly ? (
              lineCell("right", <span className="text-sm font-semibold tabular-nums">{fmtNumber(num(r.qty))}</span>)
            ) : (
              <Input type="number" min={0} inputMode="decimal" aria-label="Opening qty" required className="min-w-0 flex-1 text-right tabular-nums" value={r.qty} onChange={(e) => patchRow(r.key, { qty: e.target.value })} />
            )}
            {u ? <span className="shrink-0 pr-1.5 text-[11px] text-muted-foreground">{u}</span> : null}
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
      /*
       * BIN · QTY, NO STORE — GRN's cell (user 2026-11-03, GRN entry). The store is the
       * header's, so the line asks only WHERE in it: a Bin picker (that store's bins, 0800)
       * with its Qty box beside it, nothing pre-filled, and a blank bin row waiting while the
       * bins hold less than the line's qty. Bins are optional; picked ones must hold the qty
       * exactly (`splitBinsProblem`, re-checked by opening_stock_post).
       * AFTER QTY AND RATE (user 2026-11-05: "Bags × Wt, Qty, Rate … not after the bin,
       * swap"): the bins split the line's Qty, so the Qty is typed first, then where it sits.
       */
      header: "Bin",
      width: FIELD_WIDTH_CSS.code,
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
      header: "Value ₹",
      width: FIELD_WIDTH_CSS.hug,
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
           * ONE ROW, COMPACT (user 2026-11-05: "into single row, stock type as dropdown,
           * compact the field width"). Was two rows on a 144 / 288 / 200 / 288 column grid.
           *   code 144  Opening Date     code 144  Stock Type (a dropdown, was 3 radios)
           *   code 144  Store            code 144  Group Type ("Internal / IWO")
           *   term 176  Group / Order No (the Buyer has its own box, so the order needs only its no.)
           *   code 144  Buyer            code 144  Item Class (filter)
           * 6 x 144 + 176 = 1040 + 6 x 10 nowrap gap = 1100px, inside the 1120px the 72rem
           * frame leaves. Remarks is free text with no width of its own to fit, so it takes
           * the line under the items — where Stock Transfer and GRN keep theirs.
           */}
          <FieldRow nowrap>
            <Field label="Opening Date" required w="code">
              <Input type="date" value={header.date} readOnly={readOnly} required onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))} />
            </Field>
            <Field label="Stock Type" required w="code">
              {readOnly ? (
                <Input readOnly value={STOCK_TYPE_LABELS[header.stockType]} />
              ) : (
                <Select aria-label="Stock Type" value={header.stockType} onChange={(e) => setStockType(e.target.value as StockType)} required>
                  {STOCK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {/* THE ONLY STORE ON THE DOCUMENT — GRN's Received Store (user 2026-11-03). Every
                line is put away here; the line's Bin list is this store's bins. */}
            <Field label="Store" required w="code" htmlFor="opening-store">
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
            <Field label="Group Type" w="code">
              {readOnly ? (
                <Input readOnly value={GROUP_KINDS.find((g) => g.value === header.kind)?.label ?? ""} />
              ) : (
                <Select value={header.kind} onChange={(e) => {
                    setHeader((h) => ({ ...h, kind: e.target.value as GroupKind, orderId: "" }));
                    setPlan(null);
                  }}>
                  {GROUP_KINDS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {header.kind === "general" ? (
              <Field label="Group" w="term">
                <Input readOnly value="GENERAL STOCK" />
              </Field>
            ) : (
              <Field label="Order No" required w="term">
                {readOnly ? (
                  <Input readOnly value={order?.name ?? "—"} />
                ) : (
                  <RecordPicker label="Order No" compact required items={kindOrders} value={header.orderId || null} onChange={(id) => setOrder(id ?? "")} />
                )}
              </Field>
            )}
            <Field label="Buyer" w="code">
              <Input readOnly value={order?.customer_name ?? ""} />
            </Field>
            {!readOnly ? (
              <Field label="Item Class (filter)" w="code">
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
          {!readOnly && byOrder && header.orderId && planned && planned.size === 0 ? (
            <p className="text-sm text-[#8a5800]">
              {orderLabel} has no requirement plan yet — build its BOM, or enter this stock as General.
            </p>
          ) : null}
          {!readOnly && byOrder && planError ? <p className="text-sm text-destructive">{planError}</p> : null}

          {/* EXCEL-STYLE, CELL BY CELL (user 2026-11-05: "separate separate cell like excel,
              tighten table view"). `data-grid-style="sheet"` — the app's one spreadsheet look
              (erp-sheet-grid; Order Entry ▸ Components, Fabric Process, T&A): every cell ruled,
              the control inside it borderless so the GRIDLINE is the box, a blue inset on the
              focused cell and a red one on an error. `flat` drops the cell padding; DENSE keeps
              the 12px type of the other store documents. */}
          <div className={`${DENSE} [&_table]:table-fixed`} data-grid-style="sheet" data-grid-cells="flat">
            <ChildGrid<Row>
              label="Items"
              columns={openingLineColumns}
              rows={rows}
              tableFrom="5xl"
              flatRows
              headerClassName={GRID_HEAD}
              hideAdd={readOnly}
              hideRemove={readOnly}
              keepOne
              tailRow={readOnly ? undefined : isBlank}
              onAdd={() => setRows((rs) => [...rs, blankRow()])}
              onRemove={(r) => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            />
          </div>

          {/* REMARKS, THE DOCUMENT'S CLOSING LINE (user 2026-11-05, screenshot 4072: a 288px
              box under the table "looks orphaned"). One line as wide as the table, its label
              beside it rather than above — read as the note at the foot of the sheet, the way
              a printed document closes, not as a stray field. `max-w-[69.5rem]` = the table's
              1112px, so the line ends where the grid does. */}
          <DocRemarksLine
            maxWidthClass="max-w-[69.5rem]"
            value={header.notes}
            readOnly={readOnly}
            onChange={(v) => setHeader((h) => ({ ...h, notes: v }))}
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
