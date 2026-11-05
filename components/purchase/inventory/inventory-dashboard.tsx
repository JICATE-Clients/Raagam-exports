"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, X } from "lucide-react";
import { facetGroups } from "@/components/reports/stock-statement-view";
import { storeStyle } from "@/components/masters/bin-rack";
import { FilterBar } from "@/components/ui/filter-bar";
import { useFacetFilter } from "@/components/ui/filter-drawer";
import { Button } from "@/components/ui/button";
import { DATE_MAX, Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/segmented";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { assignBin } from "@/lib/stores/stock-transfer-actions";
import { loadBinHistory, type BinMove } from "@/lib/stores/bin-history-actions";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/reports/stock-statement-types";
import { cn } from "@/lib/utils";
import { InventoryTable, isAsset, type Row } from "./inventory-table";
import { BinPanel } from "./inventory-bin-panel";
import {
  AGE_TONE,
  AgeTape,
  classColour,
  Dot,
  HeadlineStrip,
  NeedsDoing,
  oldestBand,
  titleCase,
  ValueByClass,
  VizCard,
  YarnCones,
  type Headline,
} from "./inventory-visuals";

/**
 * PURCHASE ▸ PURCHASE STORE ▸ OVERVIEW — where the bins are kept (user 2026-11-04: "in this screen
 * we are going to maintain bin details", phase 1 of claude.ai/artifact/CXG8BjwjqJLEGzaMsKfqMt, after
 * the visual dashboard of claude.ai/artifact/T5MtSqBScF3SfXqDvdhSQm).
 *
 * THREE TABS, ONE FILTER ROW:
 *   Bins     — bin health, the store's rack (or a bin list), the floor tray and the bin panel.
 *              It draws EVERY lot: the search and Filters LIGHT UP the bins that match and dim the
 *              rest, never hide stock — a filter must not make a mixed bin look clean or a full
 *              bin look empty.
 *   Stock    — the stock picture (value, yarn cones, value by class, age, what needs doing), filtered.
 *   All lots — the Detailed / Summary table with the age matrix and Download / Print, filtered.
 *
 * MOVING STOCK (0809) is one flow wherever it starts — the floor tray, a lot's Move →, Move whole
 * bin, the Mixed fix, Put away here: pick lots → a bin on the rack → confirm → `assignBin` posts a
 * Bin → Bin Stock Transfer per owner; the lot keeps its GRN, rate and age. Shown only to a login
 * with Stores create + edit, which the post needs.
 */

export type DashBin = { id: string; bin_code: string | null; store_id: string; inactive: boolean; description: string | null };
export type DashStore = { id: string; name: string; store_type: string };

const GROUPS = facetGroups();
const NO_BIN = "—";
type Tab = "bins" | "stock" | "lots";

/** More than one item class or order in one bin (accepted stock only — a claim on a vendor is not a lot on the shelf). */
function mixOf(lots: Row[]): { classes: string[]; orders: string[]; minority: string } | null {
  const own = lots.filter(isAsset);
  const classes = [...new Set(own.map((r) => r.item_class))];
  const orders = [...new Set(own.map((r) => (r.order_no === "—" ? "General Stock" : r.order_no)))];
  if (classes.length < 2 && orders.length < 2) return null;
  // The minority is what moves out: the item class (else the order) holding the least stock.
  const by = new Map<string, number>();
  for (const r of own) {
    const k = classes.length > 1 ? r.item_class : r.order_no === "—" ? "General Stock" : r.order_no;
    by.set(k, (by.get(k) ?? 0) + (r.value ?? 0) + r.qty / 1e6);
  }
  const minority = [...by.entries()].sort((a, b) => a[1] - b[1])[0][0];
  return { classes, orders, minority };
}

/**
 * THE BINS TAB FITS THE WINDOW (user 2026-11-04, screenshot 4051: "screen fitting kind of layout").
 * On a wide screen the tab is exactly as tall as the space left below where it starts, so the
 * rack and the bin panel share one screen with no page scroll — the panel scrolls inside itself.
 * Measured, not guessed: the top bar, the tab strip and the filter row above it differ by screen.
 * A ResizeObserver both measures on mount and re-measures on resize (it fires once on observe).
 * Below 1280px the layout stacks and simply scrolls, so no height is set.
 */
function useFitHeight(enabled: boolean): [React.RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const calc = () => {
      const el = ref.current;
      if (!el || window.innerWidth < 1280) return setH(null);
      const main = el.closest("main");
      const top = el.getBoundingClientRect().top + (main?.scrollTop ?? 0) - (main?.getBoundingClientRect().top ?? 0);
      const mainTop = main?.getBoundingClientRect().top ?? 0;
      // `<main>` carries md:pb-6 (24px) — leave it, so the cards do not touch the window edge.
      setH(Math.max(520, Math.floor(window.innerHeight - mainTop - top - 24)));
    };
    const ro = new ResizeObserver(calc);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [enabled]);
  return [ref, enabled ? h : null];
}

export function InventoryDashboard({
  rows,
  bins,
  stores,
  asOf,
  unit,
  withValue,
  canMove,
}: {
  rows: Row[];
  bins: DashBin[];
  stores: DashStore[];
  asOf: string;
  unit: string;
  withValue: boolean;
  canMove: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [tab, setTab] = useState<Tab>("bins");

  /* ---------------- one filter row: Bins lights matches, the other tabs filter by them ---------------- */
  const facets = useFacetFilter(rows, GROUPS);
  const matches = facets.matches;
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const q = search.trim().toLowerCase();
  const isHit = useMemo(
    () => (r: Row) => matches(r) && (!q || [r.order_no, r.po, r.reference, r.item, r.lot, r.bin].some((x) => x.toLowerCase().includes(q))),
    [matches, q],
  );
  const lighting = !!q || facets.activeCount > 0;
  const shown = useMemo(() => rows.filter(isHit), [rows, isHit]);

  /* "/" jumps to the search box from anywhere on the screen that is not already a field. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------- stores and their bins (from EVERY lot) ---------------- */
  const binsByStore = useMemo(() => {
    const m = new Map<string, DashBin[]>();
    for (const b of bins) m.set(b.store_id, [...(m.get(b.store_id) ?? []), b]);
    return m;
  }, [bins]);
  const storeByName = useMemo(() => new Map(stores.map((s) => [s.name, s])), [stores]);
  const storeTabs = useMemo(() => {
    const holding = new Set(rows.map((r) => r.store));
    return stores
      .filter((s) => binsByStore.has(s.id) || holding.has(s.name))
      .sort((a, b) => Number(binsByStore.has(b.id)) - Number(binsByStore.has(a.id)) || a.name.localeCompare(b.name));
  }, [stores, binsByStore, rows]);
  const [storeId, setStoreId] = useState<string>(() => {
    const busiest = [...rows].sort((a, b) => b.qty - a.qty)[0]?.store;
    return storeByName.get(busiest ?? "")?.id ?? storeTabs[0]?.id ?? "";
  });
  const store = stores.find((s) => s.id === storeId) ?? null;
  const storeBins = useMemo(() => (store ? (binsByStore.get(store.id) ?? []) : []), [store, binsByStore]);
  const storeRows = useMemo(() => (store ? rows.filter((r) => r.store === store.name) : []), [rows, store]);
  const rowsByBin = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of storeRows) if (r.bin !== NO_BIN) m.set(r.bin, [...(m.get(r.bin) ?? []), r]);
    return m;
  }, [storeRows]);
  const floor = useMemo(() => (storeBins.length ? storeRows.filter((r) => r.bin === NO_BIN) : []), [storeRows, storeBins]);

  /* The rack: numbered bins on shelves of ten (Bin master's numbering), anything else in a row under it. */
  const rack = useMemo(() => {
    const style = storeStyle(storeBins);
    const byNumber = new Map<number, DashBin>();
    const numberOf = new Map<string, number>();
    const loose: DashBin[] = [];
    for (const b of storeBins) {
      const m = (b.bin_code ?? "").match(/^(.*?)(\d+)$/);
      if (b.inactive && !rowsByBin.has(b.bin_code ?? "")) continue;
      if (style && m && m[1] === style.prefix && !byNumber.has(Number(m[2]))) {
        byNumber.set(Number(m[2]), b);
        numberOf.set(b.id, Number(m[2]));
      } else loose.push(b);
    }
    const nums = [...byNumber.keys()];
    const lo = nums.length ? Math.min(...nums) : 0;
    const hi = nums.length ? Math.max(...nums) : 0;
    const shelves: number[] = [];
    for (let s = Math.floor((lo - 1) / 10) * 10 + 1; nums.length && s <= hi; s += 10) shelves.push(s);
    return { style, byNumber, numberOf, loose, shelves, lo, hi };
  }, [storeBins, rowsByBin]);
  const pad = (n: number) => String(n).padStart(rack.style?.width ?? 2, "0");
  const placeOf = (b: DashBin) => {
    const n = rack.numberOf.get(b.id);
    return n == null ? "not in the numbering" : `shelf ${pad(Math.floor((n - 1) / 10) * 10 + 1)} · position ${((n - 1) % 10) + 1}`;
  };

  /* ---------------- the picked bin ---------------- */
  const [binId, setBinId] = useState<string | null>(null);
  const defaultBin = storeBins.find((b) => rowsByBin.has(b.bin_code ?? "")) ?? storeBins.find((b) => !b.inactive) ?? null;
  const selectedBin = (binId ? storeBins.find((b) => b.id === binId) : null) ?? defaultBin;
  const selectedRows = selectedBin ? (rowsByBin.get(selectedBin.bin_code ?? "") ?? []) : [];
  const selectedMix = mixOf(selectedRows);

  /* The nearest EMPTY bin by number — where a Mixed bin's minority should go. */
  const nearestEmpty = (from: DashBin | null): DashBin | null => {
    if (!from) return null;
    const n0 = rack.numberOf.get(from.id) ?? 0;
    return (
      storeBins
        .filter((b) => b.id !== from.id && !b.inactive && !rowsByBin.has(b.bin_code ?? ""))
        .sort((a, b) => Math.abs((rack.numberOf.get(a.id) ?? 1e9) - n0) - Math.abs((rack.numberOf.get(b.id) ?? 1e9) - n0))[0] ?? null
    );
  };
  const suggestion = selectedMix ? nearestEmpty(selectedBin) : null;

  /* Its history, read when the bin is picked (and again after a move changes it). */
  const [history, setHistory] = useState<Record<string, BinMove[]>>({});
  const selectedId = selectedBin?.id ?? null;
  useEffect(() => {
    if (!selectedId || history[selectedId]) return;
    let live = true;
    loadBinHistory(selectedId).then((res) => {
      if (live && res.ok) setHistory((h) => ({ ...h, [selectedId]: res.moves }));
    });
    return () => {
      live = false;
    };
  }, [selectedId, history]);

  /* ---------------- moving stock: one flow ---------------- */
  const [moving, setMoving] = useState<string[]>([]); // layer keys picked to move
  const [target, setTarget] = useState<DashBin | null>(null);
  const picking = moving.length > 0;
  useUnsavedGuard(isPending);
  const movingRows = useMemo(() => storeRows.filter((r) => moving.includes(r.key)), [storeRows, moving]);

  const cancelMove = () => {
    setMoving([]);
    setTarget(null);
  };
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMoving([]);
        setTarget(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [picking]);

  const pickStore = (id: string) => {
    setStoreId(id);
    setBinId(null);
    cancelMove();
  };
  const clickBin = (b: DashBin) => {
    if (picking) {
      if (movingRows.length && movingRows.every((r) => r.bin === b.bin_code)) return; // already there
      setTarget(b);
      return;
    }
    setBinId(b.id);
  };
  const toggleLot = (key: string) => setMoving((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]));

  function move() {
    if (!target || !movingRows.length) return;
    const from = [...new Set(movingRows.map((r) => r.bin))];
    const ids = movingRows.filter((r) => r.bin !== target.bin_code).map((r) => r.key);
    start(async () => {
      const res = await assignBin(ids, target.id);
      if (res.ok) {
        success(`Moved into ${target.bin_code} — ${res.codes.filter(Boolean).join(", ") || "Stock Transfer posted"}`);
        // Both bins' histories changed: forget them so they are read again.
        setHistory((h) => {
          const next = { ...h };
          delete next[target.id];
          for (const code of from) {
            const b = storeBins.find((x) => x.bin_code === code);
            if (b) delete next[b.id];
          }
          return next;
        });
        setBinId(target.id);
        cancelMove();
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  /* ---------------- figures ---------------- */
  /* Bins holding stock, per store — read by the store tabs ("Material Store · 1/30"), which are now
   * the one place the page says how full each store is (user 2026-11-04: the header strip said it a
   * second time, beside Mixed / Empty / On the floor boxes the rack, the bin panel and the floor tray
   * already show — removed). */
  const usedByStore = new Map<string, number>();
  {
    const held = new Set(rows.filter((r) => r.bin !== NO_BIN).map((r) => `${r.store}|${r.bin}`));
    const storeName = new Map(stores.map((st) => [st.id, st.name]));
    for (const bn of bins) if (held.has(`${storeName.get(bn.store_id) ?? ""}|${bn.bin_code ?? ""}`)) usedByStore.set(bn.store_id, (usedByStore.get(bn.store_id) ?? 0) + 1);
  }

  /** Start Assign a bin on the first store that has lots on its floor. */
  const putAwayFloor = () => {
    const s = rows.find((r) => r.bin === NO_BIN && binsByStore.has(storeByName.get(r.store)?.id ?? ""));
    const id = s ? storeByName.get(s.store)?.id : undefined;
    if (!s || !id) return;
    setStoreId(id);
    setBinId(null);
    setTarget(null);
    setMoving(rows.filter((r) => r.store === s.store && r.bin === NO_BIN).map((r) => r.key));
  };

  const headline: Headline = useMemo(() => {
    const assets = shown.filter(isAsset);
    const yarn = assets.filter((r) => r.item_class.toUpperCase().startsWith("YARN"));
    const usedBins = new Set(shown.filter((r) => r.bin !== NO_BIN).map((r) => `${r.store}|${r.bin}`));
    const usedNames = [...usedBins].map((k) => k.split("|")[1]);
    const storesWithBins = new Set(bins.map((b) => b.store_id));
    const floorAll = shown.filter((r) => r.bin === NO_BIN && storesWithBins.has(storeByName.get(r.store)?.id ?? ""));
    const idle = assets.filter((r) => r.band === "90+");
    return {
      value: withValue ? assets.reduce((a, r) => a + (r.value ?? 0), 0) : null,
      yarnKg: yarn.reduce((a, r) => a + r.qty, 0),
      yarnValue: withValue ? yarn.reduce((a, r) => a + (r.value ?? 0), 0) : null,
      yarnCounts: new Set(yarn.map((r) => r.item)).size,
      binsUsed: usedBins.size,
      binsTotal: bins.filter((b) => !b.inactive).length,
      binsUsedHint: usedNames.length ? usedNames.slice(0, 3).join(", ") + (usedNames.length > 3 ? ` +${usedNames.length - 3}` : "") : "No bin holds stock",
      floorLots: floorAll.length,
      floorQty: floorAll.reduce((a, r) => a + r.qty, 0),
      idleLots: idle.length,
      idleValue: withValue ? idle.reduce((a, r) => a + (r.value ?? 0), 0) : null,
      idleQty: idle.reduce((a, r) => a + r.qty, 0),
      oldestDays: shown.reduce((a, r) => Math.max(a, r.age_days), 0),
      lots: assets.length,
    };
  }, [shown, bins, storeByName, withValue]);

  const owed = shown.filter((r) => !isAsset(r));
  const idleRows = shown.filter((r) => isAsset(r) && r.band === "90+");
  const [view, setView] = useState<"rack" | "list">("rack");
  const [fitRef, fitHeight] = useFitHeight(tab === "bins");

  /* ---------------- pieces ---------------- */
  const binCell = (b: DashBin, label: string) => {
    const inBin = rowsByBin.get(b.bin_code ?? "") ?? [];
    const has = inBin.length > 0;
    const shares = new Map<string, number>();
    for (const r of inBin) shares.set(r.item_class, (shares.get(r.item_class) ?? 0) + 1);
    const band = has ? oldestBand(inBin) : null;
    const mixed = has && !!mixOf(inBin);
    const hit = lighting && inBin.some(isHit);
    const isTarget = target?.id === b.id;
    const isHome = picking && movingRows.length > 0 && movingRows.every((r) => r.bin === b.bin_code);
    const isSuggestion = !picking && suggestion?.id === b.id;
    return (
      // button-shape: exempt -- a rack compartment that selects its bin (or the move's target), not an action button
      <button
        key={b.id}
        type="button"
        onClick={() => clickBin(b)}
        disabled={isHome}
        aria-label={`${b.bin_code}${has ? `, ${inBin.length} lots${mixed ? ", mixed" : ""}` : ", empty"}`}
        title={
          has
            ? `${b.bin_code} · ${inBin.length} lot${inBin.length === 1 ? "" : "s"}${withValue ? ` · ${fmtMoney(inBin.reduce((a, r) => a + (r.value ?? 0), 0))}` : ""}${mixed ? " · Mixed" : ""}\n${inBin.map((r) => `${r.item} — ${fmtNumber(r.qty)} ${r.uom}`).join("\n")}`
            : `${b.bin_code} · empty${isSuggestion ? " — nearest free bin" : ""}`
        }
        className={cn(
          "relative flex h-full min-w-0 flex-col justify-end overflow-hidden rounded-t-md border border-b-0 border-border bg-surface transition-[box-shadow,border-color,transform,opacity] duration-200 hover:-translate-y-px hover:border-primary motion-reduce:transition-none",
          has && "border-primary/40 shadow-[0_4px_12px_-8px_rgba(3,123,184,.55)]",
          mixed && "border-warning ring-1 ring-warning/40",
          selectedBin?.id === b.id && !picking && "outline outline-2 outline-offset-1 outline-primary shadow-[0_0_0_4px_rgba(3,123,184,.14),0_8px_22px_-4px_rgba(3,123,184,.65)]",
          lighting && !picking && (hit ? "outline outline-2 outline-offset-1 outline-warning shadow-[0_0_0_4px_rgba(250,178,25,.22),0_8px_22px_-4px_rgba(250,178,25,.75)]" : "opacity-25"),
          isSuggestion && "border-dashed border-success shadow-[0_0_0_3px_rgba(84,123,25,.14)]",
          picking && !isHome && "border-dashed border-primary/60",
          isTarget && "outline outline-2 outline-offset-1 outline-success shadow-[0_0_0_4px_rgba(84,123,25,.16),0_8px_22px_-4px_rgba(84,123,25,.6)]",
          isHome && "cursor-not-allowed opacity-40",
          b.inactive && "opacity-60",
        )}
      >
        {/* ONE COMPARTMENT, THREE FACTS, NO OVERLAP (user 2026-11-04, screenshot 195527: an M chip,
            the number and the age dot were all crammed into the top edge, the M sitting on the
            number, and the stock drawn as separate bars of uneven height). Now:
              top    — the bin number on the left, the age dot on the right, nothing else;
              body   — the stock as ONE load sitting on the shelf, its layers the kinds it holds
                       (share of lots), so a two-colour load already SAYS "mixed";
              edge   — a mixed bin's frame turns amber, which reads across a whole rack at a glance
                       where a 9px letter did not. */}
        <span className="absolute inset-x-1.5 top-1 z-10 flex items-center justify-between">
          <span className={cn("font-mono text-[11px] font-semibold", mixed ? "text-warning" : has ? "text-foreground" : "text-muted-foreground")}>{label}</span>
          {band ? <Dot colour={AGE_TONE[band].colour} className="size-[7px]" /> : null}
        </span>
        {has ? (
          <span className="mx-[3px] mb-[3px] flex h-[52%] flex-col-reverse overflow-hidden rounded-[4px] ring-1 ring-black/5 ring-inset">
            {[...shares.entries()].map(([cls, n]) => (
              <span key={cls} style={{ backgroundColor: classColour(cls), flexGrow: n, flexBasis: 0 }} />
            ))}
          </span>
        ) : null}
      </button>
    );
  };

  const lotChip = (r: Row, opts: { selectable: boolean }) => {
    const on = moving.includes(r.key);
    const hit = lighting && isHit(r);
    const body = (
      <>
        <span className="h-7 w-2 shrink-0 rounded-[3px]" style={{ background: classColour(r.item_class), boxShadow: `0 0 8px 0 ${classColour(r.item_class)}` }} />
        <span className="min-w-0 text-left">
          <Truncated className="block text-xs font-semibold">{r.item}</Truncated>
          <span className="block text-[11px] text-muted-foreground tabular-nums">
            {fmtNumber(r.qty)} {r.uom} · {r.reference}
            {r.status !== "accepted" ? ` · ${STATUS_LABEL[r.status]}` : ""}
          </span>
        </span>
      </>
    );
    const frame = cn(
      "flex max-w-[17rem] min-w-0 items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5 transition-shadow",
      hit && "border-warning shadow-[0_0_0_3px_rgba(250,178,25,.2)]",
    );
    return opts.selectable ? (
      // button-shape: exempt -- a lot card that toggles into the move selection, not an action button
      <button
        key={r.key}
        type="button"
        aria-pressed={on}
        onClick={() => toggleLot(r.key)}
        className={cn(frame, on ? "border-primary shadow-[0_0_0_3px_rgba(3,123,184,.15)]" : !hit && "border-border hover:border-primary/60")}
      >
        {body}
      </button>
    ) : (
      <span key={r.key} className={cn(frame, !hit && "border-border")}>
        {body}
      </span>
    );
  };

  /*
   * THE MOVE STEP lives at the head of the RIGHT column, above the bin panel (user 2026-11-05:
   * "the bin movement showing top look not good fit"). It used to open as a strip across the
   * top of the rack, which pushed every shelf down the moment Move was pressed — the rack the
   * operator is about to click jumped away from the pointer. Here the rack stays still, and
   * the step sits beside the panel whose Move button started it.
   */
  /*
   * Laid out as the move itself, in two lines (user 2026-11-05: "show clearly", then "compact
   * it"): Move [FROM] → [TO] ✕, then what is going and, once a bin is clicked, Change · Move.
   * The TO chip is dashed until a bin on the rack is clicked.
   */
  const fromBins = [...new Set(movingRows.map((r) => (!r.bin || r.bin === NO_BIN ? "Floor" : r.bin)))];
  const chip = (code: string | null, tone: "from" | "to") => (
    <span
      className={cn(
        "inline-flex h-7 max-w-[9rem] items-center rounded-md border px-2 font-mono text-[12.5px] font-bold",
        tone === "from" && "border-border bg-surface",
        tone === "to" && code && "border-primary bg-surface text-primary ring-2 ring-primary/20",
        tone === "to" && !code && "border-dashed border-primary/60 font-sans text-[11.5px] font-medium text-primary",
      )}
    >
      <span className="truncate">{code ?? "click a bin"}</span>
    </span>
  );
  // One line for what is going: the item when there is one lot, else a count.
  const goingText =
    movingRows.length === 1
      ? `${movingRows[0].item} · ${fmtNumber(movingRows[0].qty)} ${movingRows[0].uom}`
      : `${movingRows.length} lots · ${movingRows.map((r) => `${fmtNumber(r.qty)} ${r.uom}`).join(" + ")}`;
  const moveCard = picking ? (
    <div className="shrink-0 rounded-xl border border-primary/40 bg-primary-soft px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="font-semibold text-primary">Move</span>
        {chip(fromBins.join(", "), "from")}
        <span className="text-primary" aria-hidden>→</span>
        {chip(target?.bin_code ?? null, "to")}
        <button type="button" onClick={cancelMove} disabled={isPending} aria-label="Cancel move" title="Cancel (Esc)" className="ml-auto text-muted-foreground hover:text-foreground">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {movingRows.length ? (
          <Truncated className="min-w-0 flex-1 text-foreground">{goingText}</Truncated>
        ) : (
          <span className="min-w-0 flex-1 text-muted-foreground">Pick the lots, then a bin on the rack</span>
        )}
        {target ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setTarget(null)} disabled={isPending}>
              Change
            </Button>
            <Button size="sm" onClick={move} disabled={isPending}>
              {isPending ? "Moving…" : "Move"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  ) : null;

  const rackView = rack.shelves.length ? (
    <div className="overflow-x-auto px-3.5 pt-2.5 pb-1.5">
      <div className="grid min-w-[36rem] grid-cols-[2.25rem_1fr] gap-x-2.5">
        <div className="grid auto-rows-[3.6rem] gap-2 pt-2" aria-hidden>
          {rack.shelves.map((s) => (
            <span key={s} className="flex items-center justify-end font-mono text-[11px] text-muted-foreground">
              {pad(s)}
            </span>
          ))}
        </div>
        {/* frame: soft hairline uprights and a beam under every shelf (Bin master's rack) */}
        <div className="relative px-3 pt-2">
          <span className="absolute inset-y-0 left-0 w-px bg-border" aria-hidden />
          <span className="absolute inset-y-0 right-0 w-px bg-border" aria-hidden />
          {rack.shelves.map((start) => (
            <div key={start} className="relative mb-2 grid h-[3.6rem] grid-cols-10 gap-1.5 px-1 pb-[5px] last:mb-0">
              {Array.from({ length: 10 }, (_, i) => {
                const n = start + i;
                const b = rack.byNumber.get(n);
                if (b) return binCell(b, pad(n));
                if (n < rack.lo || n > rack.hi) return <span key={n} aria-hidden />;
                return (
                  <span
                    key={n}
                    title={`${rack.style?.prefix ?? ""}${pad(n)} is not made`}
                    className="grid place-items-center rounded-t-md border border-b-0 border-dashed border-border font-mono text-[11px] text-muted-foreground"
                  >
                    {pad(n)}
                  </span>
                );
              })}
              <span className="absolute -inset-x-3 bottom-0 h-px bg-border" aria-hidden />
            </div>
          ))}
        </div>
      </div>
    </div>
  ) : (
    <p className="px-3.5 py-4 text-sm text-muted-foreground">{store ? `${store.name} has no bins — its stock is listed below.` : "No store holds stock."}</p>
  );

  /* THE BIN LIST — the same bins as rows, for a store too big to walk on screen. */
  const listView = (
    <div className="overflow-x-auto px-2 py-2">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-[var(--table-head-bg)] text-left text-[11px] font-semibold whitespace-nowrap text-muted-foreground">
            <th className="px-2.5 py-1.5">Bin</th>
            <th className="px-2.5 py-1.5">Place</th>
            <th className="px-2.5 py-1.5">Holds</th>
            <th className="px-2.5 py-1.5 text-right">Lots</th>
            <th className="px-2.5 py-1.5 text-right">{withValue ? "Value" : "Qty"}</th>
            <th className="px-2.5 py-1.5 text-right">Oldest</th>
            <th className="px-2.5 py-1.5">Flags</th>
          </tr>
        </thead>
        <tbody>
          {storeBins
            .filter((b) => !b.inactive || rowsByBin.has(b.bin_code ?? ""))
            .map((b) => {
              const ls = rowsByBin.get(b.bin_code ?? "") ?? [];
              const hit = lighting && ls.some(isHit);
              return (
                <tr
                  key={b.id}
                  className={cn(
                    "border-t border-border",
                    selectedBin?.id === b.id && "bg-primary-soft",
                    lighting && !hit && "opacity-40",
                    hit && "bg-warning-soft/60",
                  )}
                >
                  <td className="px-2.5 py-1.5">
                    <button type="button" onClick={() => clickBin(b)} className="font-mono font-semibold text-primary hover:underline">
                      {b.bin_code}
                    </button>
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap text-muted-foreground">{placeOf(b)}</td>
                  <td className="max-w-[18rem] px-2.5 py-1.5">
                    {ls.length ? <Truncated className="block">{[...new Set(ls.map((r) => r.item))].join(", ")}</Truncated> : <span className="text-muted-foreground">empty</span>}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{ls.length || "—"}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">
                    {ls.length ? (withValue ? fmtMoney(ls.reduce((a, r) => a + (r.value ?? 0), 0)) : fmtNumber(ls.reduce((a, r) => a + r.qty, 0))) : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{ls.length ? `${Math.max(...ls.map((r) => r.age_days))} d` : "—"}</td>
                  <td className="px-2.5 py-1.5">
                    {mixOf(ls) ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">Mixed</span> : null}
                    {b.inactive ? <span className="ml-1 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-muted-foreground">Inactive</span> : null}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {!storeBins.length ? <p className="px-1 py-3 text-sm text-muted-foreground">{store?.name ?? "This store"} has no bins.</p> : null}
    </div>
  );

  /* ---------------- render ---------------- */
  return (
    <div className="space-y-2.5">
      <FilterBar
        search={search}
        onSearch={setSearch}
        searchRef={searchRef}
        searchPlaceholder="Find an item, lot, GRN, order or bin…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        leading={
          /* As-on date: a plain GET, so the URL is the screen and a past date is shareable. */
          <form method="get" className="flex flex-wrap items-center gap-2">
            <ToggleGroup<Tab>
              label="View"
              value={tab}
              onChange={setTab}
              options={[
                { value: "bins", label: "Bins" },
                { value: "stock", label: "Stock" },
                { value: "lots", label: `All lots (${shown.length})` },
              ]}
            />
            {/* No unit badge here (user 2026-11-04: "remove it") — the unit switcher at the foot of
                the sidebar already names it. `unit` still feeds All lots' print heading. */}
            {/* NO "Show" BUTTON (user 2026-11-04: "remove this too") — a complete date reloads the
                screen by itself. A year under 1900 is a year still being typed (2 → 0002 → 0020 →
                0202 → 2026), so only the finished date navigates. */}
            <Input
              type="date"
              name="asOf"
              aria-label="Stock as on"
              title="Stock as on"
              max={DATE_MAX}
              defaultValue={asOf}
              className="w-40"
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v && Number(v.slice(0, 4)) >= 1900 && v !== asOf) e.currentTarget.form?.requestSubmit();
              }}
            />
          </form>
        }
      />

      {tab === "bins" ? (
        <div ref={fitRef} style={fitHeight ? { height: fitHeight } : undefined} className="flex flex-col gap-2.5">
          <div className="grid items-start gap-2.5 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.75fr)_minmax(22rem,1fr)] xl:items-stretch">
            <VizCard
              className="xl:flex xl:h-full xl:min-h-0 xl:flex-col"
              title="Where is everything?"
              right={
                <span className="flex flex-wrap items-center gap-2">
                  {storeTabs.length ? (
                    <ToggleGroup<string>
                      label="Store"
                      value={storeId}
                      onChange={pickStore}
                      options={storeTabs.map((s) => ({ value: s.id, label: `${s.name} · ${usedByStore.get(s.id) ?? 0}/${binsByStore.get(s.id)?.length ?? 0}` }))}
                    />
                  ) : null}
                  {storeBins.length ? (
                    <ToggleGroup<"rack" | "list">
                      label="Bins as"
                      value={view}
                      onChange={setView}
                      options={[
                        { value: "rack", label: "Rack" },
                        { value: "list", label: "List" },
                      ]}
                    />
                  ) : null}
                </span>
              }
            >
              {/* The rack (or list) scrolls inside the card; the floor tray stays at its foot. */}
              <div className="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-y-auto">
              {view === "rack" || !storeBins.length ? rackView : listView}
              {view === "rack" && rack.loose.length ? (
                <div className="flex flex-wrap items-center gap-2 px-3.5 pb-2 text-xs text-muted-foreground">
                  <span>Not in the numbering</span>
                  {rack.loose.map((b) => (
                    <span key={b.id} className="h-9 w-16">
                      {binCell(b, b.bin_code ?? "—")}
                    </span>
                  ))}
                </div>
              ) : null}

              {view === "rack" && storeBins.length ? (
                /* ONE ROW, ONE RHYTHM (user 2026-11-05: "look un aligned"): every marker sits in the
                   same 12px box, so a square and a dot centre on one line and every label starts
                   the same distance after its marker. The row starts under the first bin
                   (px-3.5 + 2.25rem shelf column + gap-x-2.5 + the frame's px-3 + px-1 = 4.75rem),
                   not under the shelf numbers. */
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pr-3.5 pb-2 pl-[4.75rem] text-[11.5px] leading-4 text-muted-foreground">
                  {[...new Set(storeRows.map((r) => r.item_class))].map((c) => (
                    <span key={c} className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="grid size-3 shrink-0 place-items-center">
                        <i className="size-3 rounded-[3px]" style={{ background: classColour(c) }} />
                      </span>
                      {titleCase(c)}
                    </span>
                  ))}
                  {/* Kinds of stock, then a rule, then age — two different keys (user 2026-11-05: "look merged"). */}
                  <span aria-hidden className="h-3.5 w-px bg-border" />
                  {(["0-30", "61-90", "90+"] as const).map((b) => (
                    <span key={b} className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="grid size-3 shrink-0 place-items-center">
                        <Dot colour={AGE_TONE[b].colour} />
                      </span>
                      {AGE_TONE[b].word}
                    </span>
                  ))}
                </div>
              ) : null}

              </div>

              {/* ---------------- on the floor ---------------- */}
              {floor.length ? (
                <div className="mx-3.5 mt-1 mb-3 shrink-0 rounded-lg border border-dashed border-warning/60 bg-warning-soft/40 px-3 py-2 shadow-[0_0_18px_-8px_rgba(250,178,25,.8)]">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <h3 className="text-[12.5px] font-semibold text-warning">
                      On the floor — received into {store?.name} without a bin ({floor.length} lot{floor.length === 1 ? "" : "s"})
                    </h3>
                    {canMove ? (
                      <span className="ml-auto flex items-center gap-2">
                        {!picking ? (
                          <Button size="sm" variant="outline" onClick={() => setMoving(floor.map((r) => r.key))}>
                            <ArrowRightLeft className="size-3.5" aria-hidden />
                            Assign a bin
                          </Button>
                        ) : (
                          <span className="text-[11.5px] text-muted-foreground">Tap a lot to leave it out or add it</span>
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">{floor.map((r) => lotChip(r, { selectable: canMove && picking }))}</div>
                </div>
              ) : storeRows.length && !storeBins.length ? (
                <div className="mx-3.5 mb-3 flex flex-wrap gap-2">{storeRows.map((r) => lotChip(r, { selectable: false }))}</div>
              ) : null}
            </VizCard>

            <div className="flex min-w-0 flex-col gap-2.5 xl:min-h-0">
            {moveCard}
            <BinPanel
              bin={selectedBin}
              storeName={store?.name ?? ""}
              place={selectedBin ? placeOf(selectedBin) : ""}
              lots={selectedRows}
              history={selectedBin ? (history[selectedBin.id] ?? null) : []}
              withValue={withValue}
              canMove={canMove}
              mixed={selectedMix}
              suggestion={suggestion?.bin_code ?? null}
              floorCount={floor.length}
              onMove={(keys) => {
                setMoving(keys);
                setTarget(null);
              }}
              onFixMixed={() => {
                if (!selectedMix || !suggestion) return;
                const m = selectedMix;
                const byClass = m.classes.length > 1;
                setMoving(
                  selectedRows
                    .filter(isAsset)
                    .filter((r) => (byClass ? r.item_class === m.minority : (r.order_no === "—" ? "General Stock" : r.order_no) === m.minority))
                    .map((r) => r.key),
                );
                setTarget(suggestion);
              }}
              onPutHere={() => {
                if (!selectedBin) return;
                setMoving(floor.map((r) => r.key));
                setTarget(selectedBin);
              }}
            />
            </div>
          </div>
        </div>
      ) : tab === "stock" ? (
        <>
          <HeadlineStrip h={headline} />
          <div className="grid gap-2.5 lg:grid-cols-3">
            <YarnCones rows={shown} withValue={withValue} />
            <ValueByClass rows={shown} withValue={withValue} />
            <AgeTape rows={shown} withValue={withValue} />
          </div>
          <NeedsDoing
            floorLots={headline.floorLots}
            floorText={
              headline.floorLots
                ? [...new Set(shown.filter((r) => r.bin === NO_BIN && binsByStore.has(storeByName.get(r.store)?.id ?? "")).map((r) => `${r.item} (${r.reference})`))].join(" · ")
                : "Every lot is in a bin"
            }
            canMove={canMove}
            onPutAway={() => {
              setView("rack");
              putAwayFloor();
              setTab("bins");
            }}
            owedQty={owed.length ? `${fmtNumber(owed.reduce((a, r) => a + r.qty, 0))} ${owed[0].uom}${owed.length > 1 ? " +" : ""}` : null}
            owedText={owed.length ? owed.map((r) => `${r.item} · ${STATUS_LABEL[r.status]} · ${r.reference}`).join(" · ") : "Nothing waiting on a vendor"}
            idleLots={idleRows.length}
            idleText={idleRows.length ? idleRows.map((r) => `${r.item} (${r.age_days} days)`).join(" · ") : "Nothing older than 90 days"}
          />
        </>
      ) : (
        /* ALL LOTS: Detailed (lot · bin) or Summary (item), with the age matrix and Download / Print. */
        <InventoryTable rows={shown} asOf={asOf} unit={unit} withValue={withValue} />
      )}
    </div>
  );
}
