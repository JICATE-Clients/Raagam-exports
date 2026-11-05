"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ToggleGroup } from "@/components/ui/segmented";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { BinQtyCell } from "@/components/purchase/store-bin-editor";
import { pickedBins, splitBinsProblem, withTailBin, type SplitRow } from "@/lib/purchase/bin-split";
import {
  DENSE,
  DOC_BOTTOM_BAR,
  DOC_CHIP,
  DOC_FRAME,
  DOC_PILL_ROW,
  DOC_RULE,
  DocRemarksLine,
  GRID_HEAD,
  HINT_CHIP_TONES,
  type HintKind,
} from "@/components/purchase/doc-surface";
import { DocBackLink, DocFacts, DocPrintIcon } from "@/components/purchase/doc-facts";
import { cn } from "@/lib/utils";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  cancelStockTransfer,
  loadStoreStockOwners,
  loadTransferLayers,
  loadTransferReqLines,
  postStockTransfer,
  saveStockTransfer,
} from "@/lib/stores/stock-transfer-actions";
import {
  STOCK_TRANSFER_STATUS_LABELS,
  TRANSFER_TYPES,
  TRANSFER_TYPE_LABELS,
  remarksRequired,
  sidesFor,
  type StockTransfer,
  type StockTransferLine,
  type StockTransferLineInput,
  type TransferBinOption,
  type TransferLayer,
  type TransferOrderOption,
  type TransferReqLine,
  type TransferStoreOption,
  type TransferType,
} from "@/lib/stores/stock-transfer-types";

const BASE = "/purchase/transfers";
/** The From / To owner box's value for General Stock (an order id otherwise). */
const GENERAL = "general";

/**
 * ONE ROW PER LOT, ITS TO BINS INSIDE IT (0813, user 2026-11-05: GRN's bin concept for To
 * Bin). `bins` is GRN's split (lib/purchase/bin-split.ts): Bin + Qty rows that must hold the
 * Transfer Qty exactly, a blank bin row opening on Enter while qty is left. The save writes
 * one `stock_transfer_lines` row per picked bin, all naming the same layer; no bin picked is
 * one line with no To bin (a same-store move then keeps the bin it is in).
 */
type Row = {
  key: string;
  layerId: string;
  qty: string;
  bins: SplitRow[];
  reqKey: string;
  bags: string;
  cones: string;
};

let binSeq = 0;
const blankBin = (): SplitRow => ({ key: `bin-${binSeq++}`, binId: "", qty: "" });
const EMPTY = (): Omit<Row, "key"> => ({ layerId: "", qty: "", bins: [blankBin()], reqKey: "", bags: "", cones: "" });
/** Nothing the operator typed — the grid's tail row (AGENTS "a blank end row instead of + Add"). */
const isBlank = (r: Row) =>
  !r.layerId && !r.qty.trim() && pickedBins(r.bins).length === 0 && !r.reqKey && !r.bags.trim() && !r.cones.trim();
const numOf = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

/** Saved lines → screen rows: the lines of one layer (one per bin) fold back into one row. */
function rowsFrom(lines: StockTransferLine[]): Row[] {
  const byLayer = new Map<string, StockTransferLine[]>();
  for (const l of lines) byLayer.set(l.source_ledger_id, [...(byLayer.get(l.source_ledger_id) ?? []), l]);
  return [...byLayer.values()].map((group) => {
    const first = group[0];
    const qty = group.reduce((t, l) => t + (Number(l.quantity) || 0), 0);
    const sum = (k: "bags" | "cones") => (group.some((l) => l[k] != null) ? String(group.reduce((t, l) => t + (Number(l[k]) || 0), 0)) : "");
    const bins: SplitRow[] = group
      .filter((l) => l.to_bin_id)
      .map((l) => ({ key: `bin-${binSeq++}`, binId: l.to_bin_id as string, qty: String(l.quantity), typed: true }));
    return {
      key: first.id,
      layerId: first.source_ledger_id,
      qty: String(qty),
      bins: withTailBin(bins, blankBin, qty, false),
      reqKey: first.req_key ?? "",
      bags: sum("bags"),
      cones: sum("cones"),
    };
  });
}

/** The owners with a positive balance in the From store (loadStoreStockOwners). */
type StoreOwners = { orderIds: string[]; general: boolean };

function ownerOf(doc: StockTransfer | null, side: "from" | "to"): string {
  if (!doc) return GENERAL;
  const id = side === "from" ? (doc.from_garment_order_id ?? doc.from_iwo_id) : (doc.to_garment_order_id ?? doc.to_iwo_id);
  return id ?? GENERAL;
}

function stateKey(v: unknown): string {
  return JSON.stringify(v);
}

/**
 * STOCK TRANSFER — one screen for new, draft and posted (read-only). Plan:
 * doc/stores/stock-transfer-plan.md; DB 0803 / 0804.
 *
 * The TYPE decides which sides name an order: General → Order, Order → Order, Order → General
 * (the order must be closed — the DB refuses an open one at Post), Store → Store (the owner
 * travels with the stock). Each line draws on one LAYER of the From store and owner — a lot as
 * it came in on one GRN — so its GRN, in-date and rate move with it; Rate is never typed. Save
 * keeps a draft; Post moves the stock in one transaction (`stock_transfer_post`, which re-checks
 * every qty with the balance locked).
 */
export function StockTransferEditor({
  doc,
  lines,
  stores,
  bins: initialBins,
  orders,
  initialLayers,
  initialReqLines,
  initialStoreOwners = null,
  canSeeMoney,
  unitName,
  today = "",
  canEdit,
  canPost,
}: {
  doc: StockTransfer | null;
  lines: StockTransferLine[];
  stores: TransferStoreOption[];
  bins: TransferBinOption[];
  orders: TransferOrderOption[];
  initialLayers: TransferLayer[];
  initialReqLines: TransferReqLine[];
  /** Who holds stock in the From store (null = no store yet). */
  initialStoreOwners?: StoreOwners | null;
  canSeeMoney: boolean;
  /** The working unit, shown as a chip in the title row (GRN's). */
  unitName: string | null;
  today?: string;
  canEdit: boolean;
  canPost: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [isLoading, startLoad] = useTransition();

  const readOnly = !canEdit || (!!doc && doc.status !== "draft");

  const [transferDate, setTransferDate] = useState(doc?.transfer_date ?? today);
  const [type, setType] = useState<TransferType>(doc?.transfer_type ?? "general_to_order");
  const [fromStore, setFromStore] = useState(doc?.from_store_id ?? "");
  const [toStore, setToStore] = useState(doc?.to_store_id ?? "");
  const [fromOwner, setFromOwner] = useState(ownerOf(doc, "from"));
  const [toOwner, setToOwner] = useState(ownerOf(doc, "to"));
  const [remarks, setRemarks] = useState(doc?.remarks ?? "");
  // Row keys: saved lines keep their id; a new row draws from a counter bumped only in
  // handlers (approval-flows-screen's `newKey`), so render stays pure for the React Compiler.
  const keySeq = useRef(0);
  const blankRow = (): Row => ({ key: `new-${keySeq.current++}`, ...EMPTY() });
  const [rows, setRows] = useState<Row[]>(() => {
    const r = rowsFrom(lines);
    return readOnly ? r : [...r, { key: "tail-0", ...EMPTY() }];
  });
  // The unit's bins. No quick-create on this screen (it never had one), so this never grows.
  const [bins] = useState(initialBins);
  const [layers, setLayers] = useState<TransferLayer[]>(initialLayers);
  const [reqLines, setReqLines] = useState<TransferReqLine[]>(initialReqLines);
  const [confirm, setConfirm] = useState<"post" | "cancel" | null>(null);
  const [storeOwners, setStoreOwners] = useState<StoreOwners | null>(initialStoreOwners);
  /** From Bin — a FILTER on the Stock box, never saved: each line's layer already names its bin. */
  const [fromBin, setFromBin] = useState("");

  const typed = rows.filter((r) => !isBlank(r));
  const current = stateKey([
    transferDate,
    type,
    fromStore,
    toStore,
    fromOwner,
    toOwner,
    remarks.trim().toUpperCase(),
    typed.map((r) => [r.layerId, r.qty, pickedBins(r.bins).map((b) => [b.binId, numOf(b.qty)]), r.reqKey, r.bags, r.cones]),
  ]);
  const [baseline, setBaseline] = useState(current);
  const dirty = !readOnly && current !== baseline;
  useUnsavedGuard(dirty || isPending);

  const sides = sidesFor(type);
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const layerById = useMemo(() => new Map(layers.map((l) => [l.layer_id, l])), [layers]);
  const savedById = useMemo(() => new Map(lines.map((l) => [l.source_ledger_id, l])), [lines]);
  const reqByKey = useMemo(() => new Map(reqLines.map((r) => [r.req_key, r])), [reqLines]);

  const ownerName = (id: string) => (id === GENERAL ? "General Stock" : (orderById.get(id)?.name ?? "—"));
  const effectiveTo = sides.to === "same" ? fromOwner : sides.to === "general" ? GENERAL : toOwner;
  const toIsOrder = effectiveTo !== GENERAL;

  /**
   * Order options: active orders, plus whichever one this document already names.
   * `holders` (the FROM side): only owners with stock in the From store — an order with
   * nothing there is not a choice, it is a dead end that shows "Nothing on hand".
   */
  function orderOptions(keep: string, withGeneral: boolean, holders?: StoreOwners | null): ComboboxOption[] {
    const held = holders ? new Set(holders.orderIds) : null;
    const list: ComboboxOption[] =
      withGeneral && (!holders || holders.general || keep === GENERAL) ? [{ value: GENERAL, label: "General Stock" }] : [];
    for (const o of orders) {
      if (held && !held.has(o.id) && o.id !== keep) continue;
      if (o.inactive && o.id !== keep && type !== "order_to_general") continue;
      list.push({
        value: o.id,
        label: o.name,
        sublabel: `${o.kind.toUpperCase()}${o.inactive ? " · closed" : ""}`,
      });
    }
    return list;
  }

  function ids(owner: string): { re: string | null; iwo: string | null } {
    if (owner === GENERAL) return { re: null, iwo: null };
    const o = orderById.get(owner);
    if (!o) return { re: null, iwo: null };
    return o.kind === "re" ? { re: o.id, iwo: null } : { re: null, iwo: o.id };
  }

  /** Reload what the From side holds. Every line drew on the old list, so the lines go too. */
  function reloadLayers(store: string, owner: string, date: string, keepRows = false) {
    if (!keepRows) {
      setRows([blankRow()]);
      setFromBin("");
    }
    // No owner picked yet is NOT General Stock — `ids("")` would read as both-null and list it.
    if (!store || owner === "") return setLayers([]);
    const o = ids(owner);
    startLoad(async () => {
      const res = await loadTransferLayers(store, o.re, o.iwo, date || null);
      if (!res.ok) return toastError(res.error);
      setLayers(res.layers);
    });
  }

  function reloadReqLines(owner: string) {
    setRows((rs) => rs.map((r) => ({ ...r, reqKey: "" })));
    if (owner === GENERAL) return setReqLines([]);
    startLoad(async () => {
      const res = await loadTransferReqLines(owner);
      if (res.ok) setReqLines(res.lines);
    });
  }

  function pickType(t: TransferType) {
    setType(t);
    const s = sidesFor(t);
    const nextFrom = s.from === "general" ? GENERAL : s.from === "order" && fromOwner === GENERAL ? "" : fromOwner;
    const nextTo = s.to === "order" ? (toOwner === GENERAL ? "" : toOwner) : GENERAL;
    if (nextFrom !== fromOwner) {
      setFromOwner(nextFrom);
      reloadLayers(fromStore, nextFrom, transferDate);
    }
    if (nextTo !== toOwner) {
      setToOwner(nextTo);
      reloadReqLines(nextTo || GENERAL);
    }
    if (s.to !== "same" && !toStore) changeToStore(fromStore);
  }

  function pickFromStore(id: string) {
    setFromStore(id);
    if (sides.to !== "same" && (!toStore || toStore === fromStore)) changeToStore(id);
    setStoreOwners(null);
    if (!id) return reloadLayers("", fromOwner, transferDate);
    // An order picked for the OLD store may hold nothing in this one: it drops, rather than
    // leaving a From Stock Of the list would no longer offer and a Stock box reading "Nothing".
    startLoad(async () => {
      const res = await loadStoreStockOwners(id);
      if (!res.ok) return toastError(res.error);
      setStoreOwners({ orderIds: res.orderIds, general: res.general });
      const keeps =
        fromOwner === GENERAL ? res.general || sides.from === "general" : !fromOwner || res.orderIds.includes(fromOwner);
      const owner = keeps ? fromOwner : sides.from === "any" && res.general ? GENERAL : "";
      if (owner !== fromOwner) setFromOwner(owner);
      reloadLayers(id, owner, transferDate);
    });
  }

  function pickFromOwner(id: string) {
    setFromOwner(id || "");
    reloadLayers(fromStore, id || "", transferDate);
  }

  function pickToOwner(id: string) {
    setToOwner(id || "");
    reloadReqLines(id || GENERAL);
  }

  function pickDate(d: string) {
    setTransferDate(d);
    // Quantities on hand are dated: keep the lines, refresh what each can draw.
    if (fromStore) reloadLayers(fromStore, fromOwner, d, true);
  }

  /** GRN's rule after every change: nothing auto-filled, a blank bin row only on Enter while
   *  the bins hold less than the Transfer Qty (`withTailBin(…, false)`). */
  function setRow(key: string, patch: Partial<Row>) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        return { ...next, bins: withTailBin(next.bins, blankBin, numOf(next.qty), false) };
      }),
    );
  }

  /** The To bins are the To store's (0800): a new To store clears every line's bins. */
  function changeToStore(id: string) {
    if (id === toStore) return;
    setToStore(id);
    setRows((rs) => rs.map((r) => ({ ...r, bins: [blankBin()] })));
  }

  // ---------- checks the screen can answer before Post ----------
  const qtyOf = (r: Row) => Number(r.qty);
  const availOf = (r: Row) => layerById.get(r.layerId)?.qty_on_hand ?? 0;
  const overAvail = (r: Row) => !readOnly && !!r.layerId && Number.isFinite(qtyOf(r)) && qtyOf(r) > availOf(r) + 1e-9;
  const gone = (r: Row) => !readOnly && !!r.layerId && !layerById.has(r.layerId);
  const overNeed = (r: Row) => {
    const req = r.reqKey ? reqByKey.get(r.reqKey) : undefined;
    return !!req && Number.isFinite(qtyOf(r)) && qtyOf(r) > req.balance_qty + 1e-9;
  };
  /** GRN's bin refusal: picked bins must hold the Transfer Qty exactly (null when fine). */
  const binProblem = (r: Row) => (readOnly ? null : splitBinsProblem(r.bins, Number.isFinite(qtyOf(r)) ? qtyOf(r) : 0));
  const anyBad = typed.some((r) => overAvail(r) || gone(r) || !r.layerId || !(qtyOf(r) > 0) || !!binProblem(r));
  const ownersOk =
    (sides.from !== "order" || (fromOwner !== "" && fromOwner !== GENERAL)) &&
    (sides.to !== "order" || (toOwner !== "" && toOwner !== GENERAL)) &&
    !(type === "order_to_order" && fromOwner === toOwner);
  const storesOk = !!fromStore && !!toStore && (type !== "store_to_store" || fromStore !== toStore);
  const remarksOk = !remarksRequired(type) || !!remarks.trim();
  const canSave = !readOnly && !!transferDate && storesOk && ownersOk && remarksOk && typed.length > 0 && !anyBad;

  const valueOf = (r: Row): number | null => {
    if (readOnly) {
      // A split lot is several saved lines; the row's qty is their sum, the rate is the lot's.
      const s = savedById.get(r.layerId);
      return s?.rate == null ? null : qtyOf(r) * s.rate;
    }
    const rate = layerById.get(r.layerId)?.rate;
    return rate == null || !Number.isFinite(qtyOf(r)) ? null : qtyOf(r) * rate;
  };
  const rateOf = (r: Row): number | null =>
    readOnly ? (savedById.get(r.layerId)?.rate ?? null) : (layerById.get(r.layerId)?.rate ?? null);

  function save() {
    if (!canSave) return;
    const f = ids(fromOwner);
    const t = ids(effectiveTo);
    start(async () => {
      const res = await saveStockTransfer(doc?.id ?? null, {
        transfer_date: transferDate,
        // A Bin → Bin transfer is posted the moment it is made (assignBin), so it is never a
        // draft here to save — the editor only ever saves the four types on its toggle.
        transfer_type: type as Exclude<TransferType, "bin_to_bin">,
        from_store_id: fromStore,
        to_store_id: toStore,
        from_garment_order_id: f.re,
        from_iwo_id: f.iwo,
        to_garment_order_id: t.re,
        to_iwo_id: t.iwo,
        remarks: remarks.trim() || null,
        // The blank tail row is never saved (AGENTS "the seeded row is saved unless the save drops it").
        // ONE LINE PER PICKED BIN (0813): a lot split over MAT01 60 + MAT02 40 is two lines of
        // one layer; Bags / Cones ride on the first so the printed counts are not doubled.
        lines: typed.flatMap((r): StockTransferLineInput[] => {
          const bags = r.bags.trim() ? Number(r.bags) : null;
          const cones = r.cones.trim() ? Number(r.cones) : null;
          const picked = pickedBins(r.bins);
          if (picked.length === 0) {
            return [{ source_ledger_id: r.layerId, quantity: qtyOf(r), to_bin_id: null, req_key: r.reqKey || null, bags, cones }];
          }
          return picked.map((b, i) => ({
            source_ledger_id: r.layerId,
            quantity: numOf(b.qty),
            to_bin_id: b.binId,
            req_key: r.reqKey || null,
            bags: i === 0 ? bags : null,
            cones: i === 0 ? cones : null,
          }));
        }),
      });
      if (!res.ok) return toastError(res.error);
      success("Stock transfer saved");
      setBaseline(current);
      if (!doc) router.replace(`${BASE}/${res.id}`);
      else router.refresh();
    });
  }

  function post() {
    if (!doc) return;
    start(async () => {
      const res = await postStockTransfer(doc.id);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Posted — the stock has moved");
      router.refresh();
    });
  }

  function cancelTransfer() {
    if (!doc) return;
    start(async () => {
      const res = await cancelStockTransfer(doc.id);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Stock transfer cancelled");
      router.refresh();
    });
  }

  /*
   * FROM BIN: only the From store's bins that HOLD this owner's stock — derived from the
   * layers, so a bin with nothing in it (or another store's bin) cannot be offered.
   */
  const NO_BIN = "none";
  const fromBinOptions = (() => {
    const seen = new Map<string, string>();
    for (const l of layers) seen.set(l.bin_id ?? NO_BIN, l.bin_code ?? "No bin");
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  })();
  const binLayers = fromBin ? layers.filter((l) => (l.bin_id ?? NO_BIN) === fromBin) : layers;
  const layerOption = (l: TransferLayer): ComboboxOption => ({
    value: l.layer_id,
    label: l.item_name,
    sublabel: [l.item_class, l.category, l.lot_no ? `Lot ${l.lot_no}` : null, l.grn_code, `${fmtNumber(l.qty_on_hand)} ${l.uom_code ?? ""}`.trim()]
      .filter(Boolean)
      .join(" · "),
    search: [l.item_name, l.lot_no, l.grn_code, l.bin_code, l.category].filter(Boolean).join(" "),
  });
  const layerOptions: ComboboxOption[] = binLayers.map(layerOption);
  /** A line keeps the stock it holds even when the From Bin filter now points elsewhere. */
  const optionsFor = (layerId: string): ComboboxOption[] => {
    if (!layerId) return layerOptions;
    const own = layerById.get(layerId);
    if (!own) return [{ value: layerId, label: savedById.get(layerId)?.item_name ?? "No longer on hand", disabled: true }, ...layerOptions];
    return binLayers.includes(own) ? layerOptions : [layerOption(own), ...layerOptions];
  };
  const toStoreName = stores.find((s) => s.id === toStore)?.name ?? "Store";

  /*
   * COMPACTED (user 2026-11-05, Opening Stock's table): Stock 200 → 176, Lot · GRN · Age
   * 176 → 144; To Bin 112 → 144 the same day for GRN's Bin + Qty cell (0813).
   * 176 + 144 + 88 + 144 + 144 + 112 + 112 + 112 = 1032, + 72 chrome (`#` and ✕)
   * = 1104 <= 1155 -> tableFrom="5xl". Class · Category ride in the picker's sub-line,
   * Rate in the Value cell, Bags and Cones share one cell — the plan's 11 columns were 1440.
   */
  const transferLineColumns: ChildGridColumn<Row>[] = [
    {
      header: "Stock",
      width: FIELD_WIDTH_CSS.term,
      required: true,
      unique: (r) => r.layerId || null,
      cell: (r) => {
        const saved = savedById.get(r.layerId);
        if (readOnly) return <span className="text-sm">{saved?.item_name ?? "—"}</span>;
        return (
          <Combobox
            options={optionsFor(r.layerId)}
            value={r.layerId}
            onChange={(v) => setRow(r.key, { layerId: v, reqKey: "", bins: [blankBin()] })}
            placeholder={
              !fromStore
                ? "Pick From store"
                : fromOwner === ""
                  ? "Pick From Stock Of"
                  : isLoading
                    ? "Loading…"
                    : binLayers.length
                      ? "Pick stock"
                      : "Nothing on hand"
            }
            disabled={!fromStore || fromOwner === ""}
            required
          />
        );
      },
    },
    {
      header: "Lot · GRN · Age",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => {
        const l = layerById.get(r.layerId);
        const saved = savedById.get(r.layerId);
        if (!l && !saved) return <span className="text-sm text-muted-foreground">—</span>;
        if (!l) return <span className="text-sm">{saved?.lot_no ? `Lot ${saved.lot_no}` : "No lot"}</span>;
        return (
          <span className="text-xs leading-tight">
            <span className="block">{l.lot_no ? `Lot ${l.lot_no}` : "No lot"}{l.bin_code ? ` · ${l.bin_code}` : ""}</span>
            <span className="block text-muted-foreground">
              {l.grn_code ?? "—"} · {l.age_days ?? 0} d
            </span>
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
        return <span className="tabular-nums text-sm">{fmtNumber(l?.qty_on_hand ?? 0)}</span>;
      },
    },
    {
      header: "Against",
      width: FIELD_WIDTH_CSS.code,
      // pick-once: exempt -- two lots of one item can both answer the same requirement line
      cell: (r) => {
        if (!toIsOrder) return <span className="text-sm text-muted-foreground">—</span>;
        const item = layerById.get(r.layerId)?.item_id ?? lines.find((l) => l.source_ledger_id === r.layerId)?.item_id;
        const options = reqLines.filter((q) => q.item_id === item);
        if (readOnly) return <span className="text-sm">{r.reqKey ? (reqByKey.get(r.reqKey)?.label ?? "Requirement") : "—"}</span>;
        return (
          <Select
            aria-label="Requirement line this stock answers"
            value={r.reqKey}
            disabled={!r.layerId || options.length === 0}
            onChange={(e) => setRow(r.key, { reqKey: e.target.value })}
          >
            <option value="">{options.length ? "—" : "No open need"}</option>
            {options.map((q) => (
              <option key={q.req_key} value={q.req_key}>
                {q.label} · needs {fmtNumber(q.balance_qty)}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      /*
       * TO BIN · QTY — GRN'S CELL (0813, user 2026-11-05): a Bin picker of the TO store's bins
       * with its Qty box beside it; Enter on the last bin's Qty opens the next bin while the
       * Transfer Qty is not all put away. Picked bins must hold the Transfer Qty exactly
       * (`splitBinsProblem`). No bin picked = one line with no To bin (a same-store move keeps
       * the bin it is in). code 144: the picker ~68px + its 72px qty box, as on Opening Stock.
       */
      header: "To Bin · Qty",
      width: FIELD_WIDTH_CSS.code,
      // pick-once: exempt -- one bin takes several lots
      cell: (r) => {
        if (readOnly) {
          const picked = pickedBins(r.bins);
          if (picked.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
          return (
            <span className="grid gap-0.5 text-sm">
              {picked.map((b) => (
                <span key={b.key} className="flex items-center justify-between gap-2">
                  <span>{bins.find((x) => x.id === b.binId)?.code ?? "bin"}</span>
                  <span className="tabular-nums">{fmtNumber(numOf(b.qty))}</span>
                </span>
              ))}
            </span>
          );
        }
        const problem = r.layerId ? binProblem(r) : null;
        return (
          <span className="block">
            <BinQtyCell<SplitRow>
              description={layerById.get(r.layerId)?.item_name ?? "this line"}
              storeId={toStore}
              rows={r.bins}
              onRow={(k, patch) => setRow(r.key, { bins: r.bins.map((b) => (b.key === k ? { ...b, ...patch } : b)) })}
              accepted={Number.isFinite(qtyOf(r)) ? qtyOf(r) : 0}
              uom={layerById.get(r.layerId)?.uom_code ?? null}
              bins={bins}
            />
            {problem ? <span className="mt-0.5 block px-1.5 text-[11px] leading-tight text-danger">{problem}</span> : null}
          </span>
        );
      },
    },
    {
      header: "Bags · Cones",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) =>
        readOnly ? (
          <span className="tabular-nums text-sm">
            {r.bags || "—"} · {r.cones || "—"}
          </span>
        ) : (
          <span className="flex divide-x divide-border">
            <Input type="number" min="0" step="1" aria-label="Bags" placeholder="Bags" value={r.bags} onChange={(e) => setRow(r.key, { bags: e.target.value })} />
            <Input
              type="number"
              min="0"
              step="1"
              aria-label="Cones or rolls"
              placeholder="Cones"
              value={r.cones}
              onChange={(e) => setRow(r.key, { cones: e.target.value })}
            />
          </span>
        ),
    },
    {
      header: "Transfer Qty",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      required: true,
      total: { kind: "sum", of: (r) => (isBlank(r) ? 0 : qtyOf(r)) },
      cell: (r) =>
        readOnly ? (
          <span className="tabular-nums text-sm font-semibold">{fmtNumber(qtyOf(r))}</span>
        ) : (
          <span className="block">
            <Input
              type="number"
              min="0"
              step="any"
              aria-label="Transfer qty"
              aria-invalid={overAvail(r) || undefined}
              max={r.layerId ? availOf(r) : undefined}
              value={r.qty}
              onChange={(e) => setRow(r.key, { qty: e.target.value })}
              required
            />
            {/* QUANTITY GUARD, INLINE (2026-11-05): said under the box, not only in a tooltip —
                Save and Post stay refused while it shows, and the DB re-checks at Post. */}
            {overAvail(r) ? (
              <span className="mt-0.5 block text-[11px] leading-tight text-danger">
                Only {fmtNumber(availOf(r))} on hand in {layerById.get(r.layerId)?.bin_code ?? "this store"}
              </span>
            ) : overNeed(r) ? (
              <span className="mt-0.5 block text-[11px] leading-tight text-warning">More than the order needs</span>
            ) : null}
          </span>
        ),
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
            <span className="block tabular-nums text-sm">{fmtMoney(v)}</span>
            <span className="block tabular-nums text-muted-foreground">@ {fmtMoney(rate)}</span>
          </span>
        );
      },
    },
  ];

  const status = doc?.status ?? "draft";
  const anyOver = typed.some(overAvail);
  const anyGone = typed.some(gone);
  const fromStoreName = stores.find((s) => s.id === fromStore)?.name ?? null;

  // Totals per unit of measure — a yarn line in KG and a trim line in PCS never add up.
  const byUom = new Map<string, number>();
  for (const r of typed) {
    const uom = (readOnly ? savedById.get(r.layerId)?.uom_code : layerById.get(r.layerId)?.uom_code) ?? "";
    const q = qtyOf(r);
    if (Number.isFinite(q)) byUom.set(uom, (byUom.get(uom) ?? 0) + q);
  }
  const totalValue = canSeeMoney ? typed.reduce((t, r) => t + (valueOf(r) ?? 0), 0) : null;

  /*
   * WHY SAVE WAITS, ONE CHIP (GRN's bottom bar, doc-surface HINT_CHIP_TONES) — instead of red
   * paragraphs under the grid. The first thing missing is the one said; "md" is a defect on a
   * line, "todo" a field not filled yet, "ready" the next step.
   */
  const hint: { kind: HintKind; text: string } | null = readOnly
    ? null
    : anyOver
      ? { kind: "md", text: "A transfer qty is more than that stock holds on the transfer date" }
      : anyGone
        ? { kind: "md", text: "A line's stock is no longer on hand — remove it or pick other stock" }
        : typed.some((r) => !!binProblem(r))
          ? { kind: "md", text: `To bins: ${typed.map(binProblem).find(Boolean)}` }
        : !fromStore || !toStore
          ? { kind: "todo", text: "Pick the From and To store" }
          : !ownersOk
            ? { kind: "todo", text: sides.to === "order" && (toOwner === "" || toOwner === GENERAL) ? "Pick the order the stock goes to" : "Pick the order the stock comes from" }
            : typed.length === 0
              ? { kind: "todo", text: layers.length ? "Pick the stock to move" : "Nothing on hand for this store and owner" }
              : !remarksOk
                ? { kind: "todo", text: "Remarks are required — this moves cost off an order's books" }
                : dirty || !doc
                  ? { kind: "ready", text: "Ready to save" }
                  : { kind: "ready", text: "Saved — Post moves the stock" };
  const HINT = hint ? HINT_CHIP_TONES[hint.kind] : null;

  const grid = (
    /* EXCEL-STYLE, CELL BY CELL — Opening Stock's table (user 2026-11-05): every cell ruled,
       the control borderless so the gridline is the box, `flat` cells, 12px type. */
    <div className={cn(DENSE, "[&_table]:table-fixed")} data-grid-style="sheet" data-grid-cells="flat">
      {/* default-row: exempt -- a blank tail row stands in for the seeded row (tailRow); the save drops it */}
      <ChildGrid<Row>
        columns={transferLineColumns}
        rows={rows}
        tableFrom="5xl"
        flatRows
        headerClassName={GRID_HEAD}
        hideAdd={readOnly}
        lockExisting={readOnly}
        keepOne={false}
        tailRow={readOnly ? undefined : isBlank}
        onAdd={() => {
          setRows((rs) => [...rs, blankRow()]);
        }}
        onRemove={(r) => setRows((rs) => rs.filter((x) => x.key !== r.key))}
      />
    </div>
  );

  const figures = (
    <dl className="flex items-center gap-3 text-[12.5px] whitespace-nowrap tabular-nums">
      {[...byUom.entries()].map(([uom, qty], i) => (
        <div key={uom || "-"} className="flex items-center gap-3">
          {i > 0 ? <span aria-hidden className="h-4 w-px bg-[#dde4eb]" /> : null}
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Qty</dt>
            <dd className="font-semibold">
              {fmtNumber(qty)} {uom}
            </dd>
          </div>
        </div>
      ))}
      {totalValue != null && byUom.size > 0 ? (
        <>
          <span aria-hidden className="h-4 w-px bg-[#dde4eb]" />
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Value</dt>
            <dd className="font-semibold">{fmtMoney(totalValue)}</dd>
          </div>
        </>
      ) : null}
    </dl>
  );

  // ---------- POSTED / CANCELLED: the detail page's shape (GRN [grnId]) ----------
  if (readOnly && doc) {
    return (
      <div className="space-y-4">
        <PageHeader title={doc.code ?? "Stock Transfer"} description={`Stock Transfer — ${STOCK_TRANSFER_STATUS_LABELS[status]}`} />
        {/* ONE STRIP (doc-facts.tsx): the facts, then status · print · the way out on the same row. */}
        <DocFacts
          trailing={
            <>
              <StatusPill tone={statusTone(status)}>{STOCK_TRANSFER_STATUS_LABELS[status]}</StatusPill>
              {doc.status === "posted" ? <DocPrintIcon href={`${BASE}/${doc.id}/print`} label="Print Stock Transfer" /> : null}
              <DocBackLink href={BASE} />
            </>
          }
          facts={[
            { label: "Transfer No", value: doc.code ?? "—", mono: true },
            { label: "Date", value: fmtDate(doc.transfer_date), mono: true },
            { label: "Type", value: TRANSFER_TYPE_LABELS[type] ?? "—" },
            { label: "From", value: `${ownerName(fromOwner || GENERAL)} · ${fromStoreName ?? "—"}` },
            { label: "To", value: `${ownerName(effectiveTo || GENERAL)} · ${toStoreName}` },
            doc.posted_at ? { label: "Posted", value: fmtDate(doc.posted_at), mono: true } : null,
          ]}
        >
          {doc.remarks ? <p className="text-sm text-muted-foreground">Remarks · {doc.remarks}</p> : null}
        </DocFacts>
        <div className={DOC_FRAME}>
          <div className="p-2">{grid}</div>
          {byUom.size ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-xl border-t border-[#dde4eb] bg-[#fafbfc] px-4 py-2.5">{figures}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={doc ? (doc.code ?? "Stock Transfer") : "New Stock Transfer"}
        description="Move stock between General Stock and an order, between orders, or between stores — lot, GRN, age and rate travel with it."
      />

      {/* ONE SURFACE, GRN / RAISE PO'S (doc-surface.tsx): title row · pill row · From → To ·
          the lines · remarks · the bottom bar, parted by hairlines inside one frame. 72rem: the
          1128px grid plus the frame's padding. */}
      <form
        className={cn("max-w-[72rem]", DOC_FRAME)}
        data-focus-scope=""
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {/* TITLE ROW: the document, its number (given on save), its date, the unit. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
          <h2 className="text-base font-bold">Stock Transfer</h2>
          <span className={DOC_CHIP} title={doc?.code ? undefined : "The Transfer No is given when it is saved"}>
            {doc?.code ?? "STR No · on save"}
          </span>
          {/* THE TRANSFER DATE IS THE DATE CHIP (GRN's) — today, and a click changes it. */}
          <label className={cn(DOC_CHIP, "inline-flex items-center gap-1 focus-within:border-[#037bb8]")} title="Transfer date">
            <span className="sr-only">Transfer Date</span>
            <input
              type="date"
              required
              max={today || "9999-12-31"}
              aria-label="Transfer Date"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              className="h-5 bg-transparent text-xs tabular-nums text-foreground outline-none"
              value={transferDate}
              onChange={(e) => pickDate(e.target.value)}
            />
          </label>
          {unitName ? (
            <span className={DOC_CHIP} title="Moved inside the unit you are working in">
              {unitName}
            </span>
          ) : (
            <span className="text-xs text-danger">No unit — pick your working unit in the top bar</span>
          )}
          {doc ? (
            <span className="ml-auto">
              <StatusPill tone={statusTone(status)}>{STOCK_TRANSFER_STATUS_LABELS[status]}</StatusPill>
            </span>
          ) : null}
        </div>

        {/* THE PILL ROW: the type decides which side names an order, so it comes first. */}
        <div className={DOC_PILL_ROW}>
          <ToggleGroup<TransferType>
            label="Transfer type"
            value={type}
            onChange={pickType}
            options={TRANSFER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
          {type === "order_to_general" ? (
            <span className="ml-2 text-xs text-muted-foreground">Only a closed order&apos;s leftover — Post refuses an open order</span>
          ) : type === "store_to_store" ? (
            <span className="ml-2 text-xs text-muted-foreground">The owner travels with the stock</span>
          ) : null}
        </div>

        {/* FROM → TO, ONE ROW, COMPACT (user 2026-11-05: "details into single row, compact
            with field widths" — Opening Stock's header). Briefly two bands the same day, at the
            old 200 / 288 widths; compacted they fit one line again:
              From Store 144 · From Stock Of 176 · From Bin 112 · → 16 · To Store 144 · To Order 176
              = 768 + 5 x 10 nowrap gap = 818px, inside the 1120px the frame leaves.
            Everything on the FROM side narrows to what that store HOLDS ("Strict Store & Order
            Filtering"): Stock Of lists only owners with stock there, Bin only the bins that hold
            it, each line's Stock box only lots with qty > 0. The To bin is per line. */}
        <div className={cn(DOC_RULE, "px-4 py-2.5")}>
          <FieldRow nowrap>
            <Field label="From Store" required w="code">
              <Select aria-label="From Store" value={fromStore} onChange={(e) => pickFromStore(e.target.value)} required>
                <option value=""></option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From Stock Of" required w="term">
              {sides.from === "general" ? (
                <Input readOnly value={storeOwners && !storeOwners.general ? "General Stock · none here" : "General Stock"} />
              ) : (
                <Combobox
                  options={orderOptions(fromOwner, sides.from === "any", storeOwners)}
                  value={fromOwner}
                  onChange={pickFromOwner}
                  placeholder={
                    !fromStore ? "Pick the store first" : storeOwners && !storeOwners.orderIds.length ? "No order holds stock here" : "Pick the order"
                  }
                  disabled={!fromStore}
                  required
                />
              )}
            </Field>
            <Field label="From Bin" w="range">
              {/* pick-once: exempt -- a header filter, not a grid column */}
              <Select
                aria-label="From Bin"
                value={fromBin}
                onChange={(e) => setFromBin(e.target.value)}
                disabled={!fromStore || fromBinOptions.length === 0}
              >
                <option value="">{fromBinOptions.length ? "All bins" : "—"}</option>
                {fromBinOptions.map(([id, code]) => (
                  <option key={id} value={id}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <span aria-hidden className="w-4 self-end pb-2 text-center text-lg leading-none text-muted-foreground">
              →
            </span>
            <Field label="To Store" required w="code">
              <Select aria-label="To Store" value={toStore} onChange={(e) => changeToStore(e.target.value)} required>
                <option value=""></option>
                {stores
                  .filter((s) => type !== "store_to_store" || s.id !== fromStore)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="To Order" required={sides.to === "order"} w="term">
              {sides.to !== "order" ? (
                <Input readOnly value={ownerName(effectiveTo || GENERAL)} />
              ) : (
                <Combobox
                  options={orderOptions(toOwner, false).filter((o) => o.value !== fromOwner)}
                  value={toOwner}
                  onChange={pickToOwner}
                  placeholder="Pick the order"
                  required
                />
              )}
            </Field>
          </FieldRow>
        </div>

        {/* THE LINES */}
        <div className={cn(DOC_RULE, "p-2")}>
          {fromStore ? (
            grid
          ) : (
            <p className="grid min-h-32 place-items-center p-6 text-center text-sm text-muted-foreground">
              Pick the From store and owner. What they hold lists in each line&apos;s Stock box.
            </p>
          )}
        </div>

        {/* Remarks, the closing line as wide as the grid (1104px) — mandatory where the move
            takes cost off an order's books (Order → Order, Order → General). */}
        <div className={cn(DOC_RULE, "px-4 py-2.5")}>
          <DocRemarksLine maxWidthClass="max-w-[69rem]" value={remarks} required={remarksRequired(type)} onChange={setRemarks} />
        </div>

        {/* THE BOTTOM BAR (GRN's): the figures, why Save waits, and the buttons — kept in view
            while the lines scroll. Enter off the last field and Ctrl+S press its LAST button
            (lib/focus.ts submitTargetOf), so Post / Save sit after Cancel. */}
        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          {figures}
          <div className="flex min-w-0 flex-1">
            {hint && HINT && !isPending ? (
              <span
                role="status"
                className={cn("inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium", HINT.box)}
              >
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", HINT.dot)} />
                <Truncated className="min-w-0">{hint.text}</Truncated>
              </span>
            ) : null}
          </div>
          {doc ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => setConfirm("cancel")}
              disabled={isPending}
            >
              Cancel this transfer
            </button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => router.push(BASE)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" variant={doc && !dirty ? "outline" : "primary"} disabled={isPending || !canSave || (!!doc && !dirty)}>
            {isPending ? "Saving…" : "Save"}
          </Button>
          {doc && !dirty && canPost ? (
            <Button type="button" disabled={isPending || anyOver || anyGone || lines.length === 0} onClick={() => setConfirm("post")}>
              Post
            </Button>
          ) : null}
        </div>
      </form>

      <ConfirmDialog
        open={confirm === "post"}
        title={`Post ${doc?.code ?? "this transfer"}?`}
        body={`The stock moves from ${ownerName(fromOwner)} to ${ownerName(effectiveTo)}, keeping its lot, GRN, inward date and rate. A posted transfer cannot be changed.`}
        confirmLabel="Post"
        tone="primary"
        isPending={isPending}
        onConfirm={post}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        title={`Cancel ${doc?.code ?? "this transfer"}?`}
        body="Nothing has moved in stock yet. A cancelled transfer stays on the list, read-only."
        confirmLabel="Cancel transfer"
        cancelLabel="Keep"
        isPending={isPending}
        onConfirm={cancelTransfer}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
