"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Ban, Boxes, Check, ChevronRight, Clock, FileText, History, Layers, LayoutGrid, Lock, Package, Ruler, Store, Tag, TrendingUp, Truck, Undo2, User, Wallet, X } from "lucide-react";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Field, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { FilterPill, type FilterPillOption } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { StatusPill } from "@/components/ui/status-pill";
import { statusTone } from "@/lib/ui/status-tone";
import { Tooltip } from "@/components/ui/tooltip";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useAccordion } from "@/lib/ui/use-accordion";
import { focusField } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { today } from "@/lib/calendar";
import { fmtDate, fmtFixed, fmtNumber } from "@/lib/format";
import { checkRatesAgainstBudget, getLastPurchases, getLastRates, savePoFromRequirement } from "@/lib/purchase/re-po/actions";
import { CommercialSection, blankCommercial, chargesNet, chargesToSave, type CommercialValue } from "./commercial-section";
import {
  BUDGET_STATES,
  INSPECTION_DAYS,
  KIND_OPTIONS,
  NO_BUYER,
  NO_FILTERS,
  hasFilters,
  ORDER_BY_BANDS,
  PROGRESS_STATES,
  countFor,
  daysToOrder,
  orderByBand,
  orderFacts,
  passes,
  visibleOrders,
  type DraftHold,
  type FilterKey,
  type FilterState,
  type OrderByBand,
  type OrderFacts,
} from "@/lib/purchase/re-po/filters";
import {
  GST_SLABS,
  LINE_GST_PCTS,
  capQty,
  gstSlab,
  lineDescription,
  lineKeyOf,
  lineKindOf,
  maxBags,
  withNote,
  poTotals,
  type BudgetFlag,
  type ClassVendor,
  type LastPurchase,
  type LastRate,
  type RequirementLine,
} from "@/lib/purchase/re-po/types";

/**
 * RAISE PO (PO from Requirement) — the plain form the client chose (2026-10-23,
 * after three richer mockups were turned down as "non user friendly"): the
 * requirement lines list themselves, the Purchase Manager types the rate.
 *
 * FILTERS ON TOP (user 2026-10-26, canvas "PO Order Filters" v6). One row of
 * `FilterPill`s — PO Type · Order Type · Buyer · Item Class · Orders · Category · Vendor │
 * Order by · Budget · Progress (reordered 2026-10-26, screenshot 3728) — and under it the orders as a TICK LIST, which replaced the
 * RE / SWO / IWO No dropdown: on a touch screen a visible list is one tap per
 * order and no typing. The rules are `lib/purchase/re-po/filters.ts`.
 *
 * What the screen shows and what decides it:
 * - Items, units and balances are the requirement sheet's — never typed.
 * - Order Qty starts at the balance and can be lowered for a part order; typed
 *   above the balance it snaps back (spec 6). Skip = 0 on this PO, balance kept.
 * - The vendor is never picked for the operator (V7 point 5), even when only
 *   one is mapped to the class.
 * - No PO-wide delivery date (V7 point 6): a line's delivery starts at the PO
 *   date plus the vendor's lead days, and can be changed per line.
 * - The budget rate is never sent here. Each priced line is asked of the server
 *   (`checkRatesAgainstBudget`) and comes back as within / above / no budget.
 * - Submit: all within → approved by rule; anything above (or unbudgeted) → MD.
 *   `savePoFromRequirement` decides that again from the database.
 */

/** `note` — the item-level instruction to the vendor (0755), appended to the line's description on save. */
type RowState = {
  qty: string;
  rate: string;
  date: string;
  skip?: boolean;
  note?: string;
  /** own GST % (0756); unset = the header's */
  gst?: number;
  /** Yarn (0758): whole bags and the kg in one — qty is their product. */
  bags?: string;
  bagWt?: string;
  /** Fabric (0758). */
  rolls?: string;
  dia?: string;
};

/**
 * THE GRID HEADER IN THE ORDERS TABLE BAND (user 2026-10-23, screenshot 3697): the
 * soft blue `--table-head-bg` every `DataTable` header wears, labels on ONE line.
 * `ChildGrid`'s own header is white and wraps a label that is wider than its column
 * ("ORDER / QTY" on two lines), so both are set here through `headerClassName`.
 */
const GRID_HEAD = "whitespace-nowrap bg-[var(--table-head-bg)]";
/**
 * A CELL YOU TYPE IN, NOT A BOX IN A CELL (user 2026-10-24, screenshot 3707: "that
 * separate cell border for the rate, qty, delivery date — as table"). The grid's own
 * gridlines are the only frame: the input drops its border, corners and ground, and
 * the cell it is in shows focus by an inset ring and a white fill — a sheet, not a
 * form laid in a table. Hover tints the cell so it still reads as editable.
 */
const CELL_INPUT =
  "h-8 rounded-none border-0 bg-transparent shadow-none hover:bg-[#f2f7fb] focus:bg-white focus-visible:ring-2 focus-visible:ring-inset";
type GridRow = RequirementLine & { key: string; row: RowState; /** a vendor is chosen, so this line can be ordered */ supplied: boolean };

const CURRENCIES = ["USD", "EUR", "GBP"] as const;

/** One order-grid row: an item in one slice and colour, its sizes underneath (0757). */
type SizeGroup = { key: string; first: GridRow; members: GridRow[]; sized: boolean };
function sizeGroupsOf(rows: readonly GridRow[]): SizeGroup[] {
  const by = new Map<string, GridRow[]>();
  for (const r of rows) {
    const k = `${r.source_id}|${r.item_id}|${r.slice_base.trim().toUpperCase()}|${(r.colour ?? "").toUpperCase()}|${r.uom_id ?? ""}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by].map(([key, ms]) => {
    // The order's own size sequence (XS S M L XL), never alphabetical.
    const members = ms
      .slice()
      .sort((a, b) => (a.size_sort ?? 1e9) - (b.size_sort ?? 1e9) || (a.size_name ?? "").localeCompare(b.size_name ?? ""));
    return { key, first: members[0], members, sized: members.some((m) => !!m.size_name) };
  });
}

/** Why a rate outruns its budget (user 2026-10-27) — the reasons the Purchase Manager picks
 *  from before an above-budget PO goes to the MD. OTHER takes their own words. */
const BUDGET_REASONS = ["MARKET PRICE INCREASE", "SUPPLIER NON-NEGOTIABLE", "MOQ / WHOLE BAG ROUNDING"] as const;

export function RequirementPoForm({
  lines,
  vendorsByClass,
  nextPoNo,
  budgetedKeys = [],
  draftHolds = [],
  itemClasses = [],
  initialOrderId = null,
  onSaved,
  onCancel,
}: {
  lines: RequirementLine[];
  vendorsByClass: Record<string, ClassVendor[]>;
  /** HO/PO/26-27/0001 — the number this PO will take on Save (0745, a preview). */
  nextPoNo: string | null;
  /** Line keys with an approved budget line (`po_budget_check`, asked with no rate). */
  budgetedKeys?: string[];
  /** Draft POs already holding part of a balance. */
  draftHolds?: DraftHold[];
  /** Every active item class — the pill lists them all, greying those with nothing to buy. */
  itemClasses?: { id: string; name: string }[];
  /** Opened from a Pending row: that order is already chosen, under its first item class. */
  initialOrderId?: string | null;
  /** Back to Raise PO's list (user 2026-10-26: stay here, not Purchase Orders) — told which word the PO now counts as. */
  onSaved?: (word: "updated" | "draft") => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  /* ITEM CLASS IS MULTI-SELECT (user 2026-10-26). One PO may carry several classes —
     `savePoFromRequirement` already checks the vendor supplies every one of them. */
  const [classIds, setClassIds] = useState<string[]>(() => {
    const first = initialOrderId ? lines.find((l) => l.source_id === initialOrderId)?.item_class_id : null;
    return first ? [first] : [];
  });
  const hasClass = classIds.length > 0;
  /** The TICKED orders — what this PO carries, in the order they were ticked. */
  const [orderIds, setOrderIds] = useState<string[]>(() => (initialOrderId ? [initialOrderId] : []));
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
  const [vendorPick, setVendorPick] = useState("");
  const [poType, setPoType] = useState<"local" | "import">("local");
  const [currency, setCurrency] = useState<string>("USD");
  const [exRate, setExRate] = useState("");
  const [gst, setGst] = useState<string>("c12");
  const [paymentTerms, setPaymentTerms] = useState("30 DAYS FROM GRN");
  /** Why a rate is above budget — MANDATORY when Submit goes to the MD (0761). One of the
   *  common reasons, or OTHER with the Purchase Manager's own words. */
  const [reasonPick, setReasonPick] = useState("");
  const [reasonText, setReasonText] = useState("");
  const budgetReason = reasonPick === "OTHER" ? reasonText.trim() : reasonPick;
  /* The Commercial terms, typed BEFORE the MD sees the PO (user 2026-10-26) — commercial-section.tsx. */
  const [commercial, setCommercial] = useState<CommercialValue>(blankCommercial);
  // In an initialiser, not the render: `today()` reads the clock.
  const [poDate] = useState(() => today());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [flags, setFlags] = useState<Record<string, BudgetFlag>>({});
  const [dirty, setDirty] = useState(false);
  /* One ticked order's lines on the right at a time (the fold rule); "items" = the
     All Items view. */
  const [activeKey, setActiveKey] = useState(initialOrderId ?? "");
  /** The open Size Breakup — which item row, and the button it grows out of. */
  const [sizeSheet, setSizeSheet] = useState<{ key: string; origin: SheetOrigin } | null>(null);
  /** The open Yarn bags / Fabric rolls pop-up — which line, and the cell it grows out of. */
  const [qtySheet, setQtySheet] = useState<{ key: string; origin: SheetOrigin } | null>(null);
  /** Show Last PO — the item asked about, and its earlier POs once they arrive (null = loading). */
  const [lastPo, setLastPo] = useState<{
    itemId: string;
    title: string;
    origin: SheetOrigin;
    rows: LastPurchase[] | null;
    error: string | null;
  } | null>(null);
  /** The last rate each item was bought at, by item id — pre-fills an untouched Rate box. */
  const [lastRates, setLastRates] = useState<Record<string, LastRate>>({});
  /** Items bought on an earlier PO — the only ones that get the Show Last PO icon. */
  const [boughtIds, setBoughtIds] = useState<ReadonlySet<string>>(() => new Set());
  /* ITEM-WISE (client via user 2026-10-23: "multi order, multiple item — we are missing
     the multiple item concept"). The same item needed by several orders is ONE line to
     the vendor — offered once two orders are ticked. One item's breakup open at a time. */
  const itemFold = useAccordion(null);
  const advancedRef = useRef<Record<string, boolean>>({});

  useUnsavedGuard(dirty || isPending);

  const budgeted = useMemo(() => new Set(budgetedKeys), [budgetedKeys]);

  // ---------- Item Class and Vendor: the two required pills ----------
  /* EVERY CLASS IS LISTED (user 2026-10-26: "only listing two"). Each counts the orders
     with a balance in it; a class at 0 is greyed by FilterPill — shown, not pickable
     into an empty PO. Classes only the requirement lines know (no master row) still list. */
  const classOptions: FilterPillOption[] = useMemo(() => {
    const byClass = new Map<string, { label: string; orders: Set<string> }>(
      itemClasses.map((c) => [c.id, { label: c.name, orders: new Set<string>() }]),
    );
    for (const l of lines) {
      if (!l.item_class_id) continue;
      /* ORDER TYPE AND BUYER COME FIRST (user 2026-10-26, screenshot 3728), so a class
         counts only the orders those two leave — "SWO" then reads each class's SWOs. */
      if (filters.kind.length && !filters.kind.includes(l.source_kind)) continue;
      if (filters.buyer.length && !filters.buyer.includes(l.source_kind === "re" ? (l.customer ?? NO_BUYER) : NO_BUYER)) continue;
      const c = byClass.get(l.item_class_id) ?? { label: l.item_class ?? "—", orders: new Set<string>() };
      c.orders.add(l.source_id);
      byClass.set(l.item_class_id, c);
    }
    // The classes with something to buy first, so the greyed ones never push them down.
    return [...byClass.entries()]
      .sort((a, b) => Number(b[1].orders.size > 0) - Number(a[1].orders.size > 0) || a[1].label.localeCompare(b[1].label))
      .map(([value, c]) => ({ value, label: c.label, count: c.orders.size }));
  }, [lines, itemClasses, filters.kind, filters.buyer]);
  const classLines = useMemo(() => lines.filter((l) => !!l.item_class_id && classIds.includes(l.item_class_id)), [lines, classIds]);
  /* Before a class is picked the filters read EVERY line, so Order Type and Buyer —
     which lead the row — have something to count. The tick list waits for a class. */
  const scopeLines = hasClass ? classLines : lines;

  /* THE VENDOR IS CHOSEN, NEVER ASSUMED (V7 point 5). Best on-time first, so the
     reliable vendor is the one at the top — with its lead days beside it, because a
     slow vendor on an urgent order is a mistake you can only avoid if you see it.
     SEVERAL CLASSES → ONLY THE VENDORS MAPPED TO ALL OF THEM: one PO is one vendor, and the
     save refuses a vendor missing any class on it. */
  const classVendors = useMemo(() => {
    const [first, ...rest] = classIds;
    if (!first) return [];
    return (vendorsByClass[first] ?? [])
      .filter((v) => rest.every((c) => (vendorsByClass[c] ?? []).some((x) => x.id === v.id)))
      .sort((a, b) => (b.on_time_pct ?? -1) - (a.on_time_pct ?? -1) || a.name.localeCompare(b.name));
  }, [vendorsByClass, classIds]);
  const vendor = classVendors.find((v) => v.id === vendorPick) ?? null;
  const vendorId = vendor?.id ?? "";
  const vendorName = vendor?.name ?? "";
  /* LEAD DAYS FOR "ORDER BY": the chosen vendor's, else the SLOWEST of the class —
     before a vendor is chosen, an order is only "in time" if it is in time for all. */
  const leadDays = vendor ? (vendor.lead_days ?? 0) : Math.max(0, ...classVendors.map((v) => v.lead_days ?? 0));

  // ---------- the orders and the filters ----------
  const facts = useMemo(() => orderFacts(scopeLines, budgeted, draftHolds, lineKeyOf), [scopeLines, budgeted, draftHolds]);
  const daysLeft = new Map(facts.map((o) => [o.id, daysToOrder(o.shipDate, poDate, leadDays)] as const));
  const bands = new Map<string, OrderByBand>(facts.map((o) => [o.id, orderByBand(daysLeft.get(o.id) ?? null)]));
  const visible = visibleOrders(facts, bands, filters, orderIds);
  const anyFilter = hasFilters(filters);
  const count = (k: FilterKey, v: string) => countFor(facts, bands, filters, k, v);
  const anyCount = (k: FilterKey) => facts.filter((o) => passes(o, filters, bands.get(o.id) ?? "nodate", k)).length;
  const setFilter = (k: FilterKey, v: string[]) => setFilters((f) => ({ ...f, [k]: v }));

  const categoryOptions: FilterPillOption[] = (() => {
    // THE CATEGORY NAME ONLY (user 2026-10-27, screenshot 3767: "just show category").
    // The class comes back on a name two ticked classes share — COTTON is a Yarn and a
    // Fabric — so two identical choices never sit side by side (Cascading filters).
    const byCat = new Map<string, { name: string; cls: string }>();
    for (const l of classLines) if (l.category_id) byCat.set(l.category_id, { name: l.category ?? "—", cls: l.item_class ?? "—" });
    const seen = new Map<string, number>();
    for (const c of byCat.values()) seen.set(c.name.toUpperCase(), (seen.get(c.name.toUpperCase()) ?? 0) + 1);
    return [...byCat.entries()]
      .map(([id, c]): [string, string] => [id, (seen.get(c.name.toUpperCase()) ?? 0) > 1 ? `${c.name} (${c.cls})` : c.name])
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label, count: count("category", value) }));
  })();
  const buyerOptions: FilterPillOption[] = (() => {
    const names = [...new Set(facts.map((o) => o.buyer).filter((b): b is string => !!b))].sort();
    const opts = names.map((b) => ({ value: b, label: b, count: count("buyer", b) }));
    // An SWO's / IWO's buyer is not on the requirement row yet — said, not guessed.
    if (facts.some((o) => !o.buyer)) opts.push({ value: NO_BUYER, label: "Not recorded (SWO / IWO)", count: count("buyer", NO_BUYER) });
    return opts;
  })();

  /** Tick or untick an order. Ticking also opens it on the right. */
  function toggleOrder(id: string) {
    setDirty(true);
    setOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    if (!orderIds.includes(id)) setActiveKey(id);
  }

  const chosen = new Set(orderIds);
  const inClassOrders = classLines.filter((l) => chosen.has(l.source_id));
  // Category narrows the LINES of a ticked order too — the filter means "buy only these".
  const inOrders = filters.category.length
    ? inClassOrders.filter((l) => !!l.category_id && filters.category.includes(l.category_id))
    : inClassOrders;

  /**
   * A LINE'S DEFAULT DELIVERY: TODAY (user 2026-10-27, spec "Promised Delivery Date …
   * default to Today's Date", option "Today only"). Every line opens at the PO date and
   * the operator types the vendor's promised date over it. This REPLACES the earlier
   * default (V7 point 6 — PO date + the vendor's lead days, else the order's ship date
   * less inspection days); the lead days still drive the Order by bands, not this date.
   * Never blank, so no line can hold Submit for want of a date.
   */
  type DeliveryDefault = { date: string; why: string };
  // The ship date is no longer read; the parameter stays so the four callers are unchanged.
  const defaultFor = (_shipDate: string | null): DeliveryDefault => ({ date: poDate, why: "Today — the PO date" });
  /** Ship dates of several lines → the earliest, for an item-wise row. */
  const earliest = (ds: (string | null)[]) => ds.filter((d): d is string => !!d).sort()[0] ?? null;

  const gridRows: GridRow[] = inOrders
    .slice()
    .sort((a, b) => a.item_name.localeCompare(b.item_name))
    .map((l) => {
      const key = lineKeyOf(l);
      return {
        ...l,
        key,
        supplied: !!vendorId,
        // An untouched line opens at the item's last rate (user 2026-10-27); once edited, the operator's rate stands.
        row: rows[key] ?? { qty: String(l.balance_qty), rate: lastRates[l.item_id] ? String(lastRates[l.item_id].rate) : "", date: "" },
      };
    });

  const num = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };
  const fx = poType === "import" ? num(exRate) : 1;
  const isActive = (r: GridRow) => r.supplied && !r.row.skip && num(r.row.qty) > 0;
  const active = gridRows.filter(isActive);

  /* LAST RATE (user 2026-10-27: "for same item fetch and show the last entered rate").
     Asked once per set of items × vendor × currency — the chosen vendor's own last rate
     outranks anyone else's, so a vendor change asks again. */
  const rateCurrency = poType === "import" ? currency : "INR";
  const rateItemsSig = [...new Set(gridRows.map((r) => r.item_id).filter(Boolean))].sort().join(",");
  useEffect(() => {
    if (!rateItemsSig) return;
    let live = true;
    void getLastRates(rateItemsSig.split(","), vendorId || null, rateCurrency).then((res) => {
      if (!live || !res.ok) return;
      setLastRates(res.rates);
      setBoughtIds(new Set(res.bought));
    });
    return () => {
      live = false;
    };
  }, [rateItemsSig, vendorId, rateCurrency]);
  /** "Last ₹ 1.20 · VENDOR · PO/… · 12/10/2026" — the Rate box's tooltip. */
  const lastRateTitle = (itemId: string | null | undefined) => {
    const l = itemId ? lastRates[itemId] : undefined;
    if (!l) return "No earlier PO for this item";
    const sym = l.currency === "INR" ? "₹" : l.currency;
    return `Last rate ${sym} ${fmtFixed(l.rate, 2)}${l.sameVendor ? " from this vendor" : ""} · ${[l.vendor, l.code, l.orderDate ? fmtDate(l.orderDate) : null].filter(Boolean).join(" · ")}`;
  };
  const unpriced = active.filter((r) => num(r.row.rate) <= 0).length;
  const undated = active.filter((r) => !(r.row.date || defaultFor(r.delivery_date))).length;
  const slab = gstSlab(gst);
  const totals = poTotals(active.map((r) => ({ qty: num(r.row.qty), rate: num(r.row.rate), gstPct: r.row.gst })), slab.pct);
  const above = active.filter((r) => flags[r.key]?.above).length;
  const unbudgeted = active.filter((r) => num(r.row.rate) > 0 && flags[r.key] && !flags[r.key].hasBudget).length;
  const goesToMd = above + unbudgeted > 0;
  const cur = poType === "import" ? currency : "₹";

  // ---------- one group per ticked order ----------
  const groups = orderIds
    .filter((id) => gridRows.some((r) => r.source_id === id))
    .map((id) => {
      const rs = gridRows.filter((r) => r.source_id === id);
      const act = rs.filter(isActive);
      const priced = act.filter((r) => num(r.row.rate) > 0).length;
      // Rates still to type. Before a vendor is chosen nothing is "supplied" yet, so
      // count every line being ordered — the number must not read 0 on an order nobody priced.
      const toPrice = rs.filter((r) => (!vendorId || r.supplied) && !r.row.skip && num(r.row.qty) > 0 && num(r.row.rate) <= 0);
      return {
        id,
        re: rs[0].source_no,
        toPrice,
        rows: rs,
        active: act.length,
        priced,
        // COMPLETE = every line being ordered has its rate. A group with nothing to order is not
        // "complete" — it must never trigger the move to the next one.
        done: act.length > 0 && priced === act.length,
        subtotal: act.reduce((a, r) => a + num(r.row.qty) * num(r.row.rate), 0),
      };
    });
  const completeSig = groups.map((g) => `${g.id}:${g.done}`).join("|");
  /* What the right side shows: the operator's pick while it still exists, else the
     first order still to price — derived, so a new set of orders never needs an effect. */
  const showItems = groups.length >= 2;
  const selKey =
    groups.some((g) => g.id === activeKey) || (activeKey === "items" && showItems)
      ? activeKey
      : ((groups.find((g) => !g.done) ?? groups[0])?.id ?? "");
  const activeGroup = groups.find((g) => g.id === selKey);
  const activeSig = activeGroup ? activeGroup.rows.map((r) => `${r.row.qty}/${r.row.rate}/${r.row.skip ? 1 : 0}`).join("|") : "";
  /** The id a line's rate box carries — where `openRe` lands the cursor. */
  const rateId = (key: string) => `rpo-rate-${key}`;

  /** Show an order on the right and put the cursor on its first blank rate — two frames:
   *  one for React to commit the new grid, one for layout (the GRN form's landing). */
  function openRe(g: (typeof groups)[number]) {
    setActiveKey(g.id);
    const first = g.toPrice[0] ?? g.rows[0];
    const row = sizeGroupsOf(g.rows).find((sg) => sg.members.some((m) => m.key === first.key));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById(rateId(row?.first.key ?? first.key));
        if (el) focusField(el);
      }),
    );
  }

  /* ORDER FILLED → NEXT ORDER (user 2026-10-23, screenshot 3694: "RE number 1 filled then
     automatically open RE number 2"). When the order on screen BECOMES complete, wait for
     typing to stop (900 ms, restarted by every keystroke in it), then show the next order
     still to price, cursor on its first blank rate. Only the incomplete → complete step
     advances — editing a finished order never throws the operator out of it. */
  useEffect(() => {
    for (const g of groups) if (!g.done) advancedRef.current[g.id] = false;
    const g = activeGroup;
    if (!g || !g.done || advancedRef.current[g.id]) return;
    const t = setTimeout(() => {
      advancedRef.current[g.id] = true;
      const i = groups.findIndex((x) => x.id === g.id);
      const next = [...groups.slice(i + 1), ...groups.slice(0, i)].find((x) => !x.done);
      if (!next) return; // the last one: stay, the totals and Submit are in the footer
      openRe(next);
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completeSig, activeSig, selKey]);

  // ---------- the hidden budget check: asked per priced line, 400 ms after typing stops ----------
  const checkSignature = active
    .filter((r) => num(r.row.rate) > 0)
    .map((r) => `${r.key}=${r.row.rate}`)
    .join("|") + `|fx=${fx}`;
  useEffect(() => {
    const priced = active.filter((r) => num(r.row.rate) > 0);
    if (priced.length === 0 || fx <= 0) return;
    const t = setTimeout(() => {
      void checkRatesAgainstBudget(
        priced.map((r) => ({
          key: r.key,
          garment_order_id: r.garment_order_id,
          item_id: r.item_id,
          uom_id: r.uom_id,
          slice_label: r.slice_label,
          colour: r.colour,
          rate: num(r.row.rate) * fx,
        })),
      ).then((res) => {
        if (!res.ok) return toastError(res.error);
        setFlags((prev) => ({ ...prev, ...Object.fromEntries(res.flags.map((f) => [f.key, f])) }));
      });
    }, 400);
    return () => clearTimeout(t);
    // The signature is the dependency: it changes exactly when a priced line or the rate of exchange does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkSignature]);

  // ---------- edits ----------
  /** One edit to every order line under an item — the item-wise note, rate, GST and delivery. */
  function setMembers(members: readonly GridRow[], patch: Partial<RowState>) {
    setDirty(true);
    setRows((prev) => {
      const next = { ...prev };
      for (const m of members) next[m.key] = { ...(prev[m.key] ?? m.row), ...patch };
      return next;
    });
  }

  function setRow(r: GridRow, patch: Partial<RowState>) {
    setDirty(true);
    setRows((prev) => ({ ...prev, [r.key]: { ...r.row, ...patch } }));
  }

  function save(mode: "draft" | "submit") {
    startTransition(async () => {
      const res = await savePoFromRequirement(
        {
          source_ids: orderIds,
          vendor_id: vendorId,
          po_type: poType,
          currency_code: poType === "import" ? currency : null,
          exchange_rate: poType === "import" ? num(exRate) || null : null,
          gst,
          payment_terms: paymentTerms.trim() || null,
          budget_reason: goesToMd ? budgetReason || null : null,
          commercial: {
            pay_mode: commercial.pay_mode.trim() || null,
            ship_mode: commercial.ship_mode.trim() || null,
            ship_type: commercial.ship_type.trim() || null,
            place_of_delivery: commercial.place_of_delivery.trim() || null,
            invoice_send_to: commercial.invoice_send_to.trim() || null,
            vat_against: commercial.vat_against.trim() || null,
            duty_against: commercial.duty_against.trim() || null,
            freight_type: commercial.freight_type || null,
          },
          charges: chargesToSave(commercial),
          lines: gridRows.filter((r) => r.supplied).map((r) => ({
            source_id: r.source_id,
            req_key: r.req_key,
            // A skipped line goes up as 0 — "not on this PO", its balance kept (V7 point 7).
            qty: r.row.skip ? 0 : num(r.row.qty),
            rate: num(r.row.rate) > 0 ? num(r.row.rate) : null,
            // The PO date only fills a line that is not ordered — the schema wants a date on every line.
            delivery_date: r.row.date || defaultFor(r.delivery_date)?.date || poDate,
            note: r.row.note?.trim() || null,
            gst_pct: r.row.gst ?? null,
            ...materialPayload(r),
          })),
        },
        mode,
      );
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setDirty(false);
      success(
        res.status === "approved"
          ? `${res.code ?? "PO"} approved — every rate is within budget`
          : res.status === "pending_approval"
            ? `${res.code ?? "PO"} sent to the MD — ${res.aboveCount} line(s) above the approved budget; printing stays locked`
            : `${res.code ?? "PO"} saved as draft`,
      );
      if (onSaved) onSaved(res.status === "draft" ? "draft" : "updated");
      else router.push(`/purchase/orders/${res.poId}`);
    });
  }

  /** A line's delivery: its default (`defaultFor`) unless changed, shown as that date in
   *  grey (a button, so Tab — fields only — passes over it; a click opens the date there).
   *  With no default at all, the box is empty and must be typed. */
  const deliveryCell = (id: string, own: string, label: string, disabled: boolean, def: DeliveryDefault | null, set: (v: string) => void) => {
    // ALWAYS TYPEABLE (user 2026-10-26: "why the delivery date in disabled mode"). It
    // used to read "—" until a vendor was chosen, which looked locked; now a date can be
    // typed at any time, and a vendor's lead days only fill the lines left blank.
    if (own || !def)
      return (
        <div className="flex items-center">
          <Input
            id={id}
            type="date"
            max="9999-12-31"
            aria-label={`Promised delivery, ${label}`}
            // Amber only once a vendor is chosen and it still has no date — before that, blank is fine.
            className={cn(CELL_INPUT, "min-w-0 flex-1", !own && !disabled && !!vendorId && "bg-[#fff7e0]")}
            disabled={disabled}
            value={own}
            onChange={(e) => set(e.target.value)}
          />
          {own && def ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => set("")}
              aria-label={`Use the default date for ${label}`}
              title={`Back to ${fmtDate(def.date)} — ${def.why}`}
              className="shrink-0 px-1 text-muted-foreground hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </div>
      );
    return (
      <button
        type="button"
        disabled={disabled}
        title={`${def.why} — click to change`}
        aria-label={`Change delivery for ${label}, now ${fmtDate(def.date)}`}
        onClick={() => {
          set(def.date);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const el = document.getElementById(id);
              if (el) focusField(el);
            }),
          );
        }}
        className="flex h-8 w-full items-center justify-center text-sm tabular-nums text-muted-foreground hover:bg-[#f2f7fb] hover:text-[#037bb8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
      >
        {fmtDate(def.date)}
      </button>
    );
  };

  /* THE ITEM CELL IS TWO LINES (user 2026-10-27): the name, and under it in grey the
     colour / shade — "SEWING THREAD 3-PLY" over "DTM NAVY BLUE", no icon. This REVERSES the
     2026-10-26 "name only" (the colour was a hover then) on the later instruction: on
     its own line it no longer pushes the Qty and Rate columns sideways, which is what
     the inline version did. Size still lives in the Size Breakup, never here. */
  /* AND ITS CATEGORY, ONLY ACROSS CLASSES (user 2026-10-27): with two or more Item
     Classes ticked the second line leads with the category — "SEWING THREAD · DTM NAVY
     BLUE" — so a thread and a label are told apart at a glance. With one class every
     line shares the class and the header already says it, so it is left off. */
  const itemCell = (name: string, colourSpec: string, struck = false, itemId?: string, category?: string | null) => {
    const describe = [classIds.length > 1 ? category?.trim() : "", colourSpec].filter(Boolean).join(" · ");
    return (
    <div className="flex min-w-0 items-center gap-1">
      <div title={describe ? `${name} · ${describe}` : name} className={cn("min-w-0 flex-1 py-0.5", struck && "text-muted-foreground line-through")}>
        <Truncated className="min-w-0 text-sm leading-tight font-medium">{name}</Truncated>
        {describe ? (
          <Truncated className="min-w-0 text-[11px] leading-tight text-[#667085]">{describe}</Truncated>
        ) : null}
      </div>
      {/* SHOW LAST PO (user 2026-10-26, Task 3): the rate this item was last bought at, from
          whom and when — a benchmark to negotiate with, asked only when the icon is pressed.
          A button, so Tab (fields only) passes over it; it stays in screen-reader order.
          ONLY WHERE THERE IS ONE (user 2026-10-27): an item never bought before has no
          icon, rather than one that opens onto "no earlier PO". */}
      {itemId && boughtIds.has(itemId) ? (
        <button
          type="button"
          aria-label={`Show last PO, ${name}${describe ? ` ${describe}` : ""}`}
          title="Last PO — rate, vendor, date"
          onClick={(e) => openLastPo(itemId, describe ? `${name} · ${describe}` : name, e.currentTarget)}
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-[#eef4f9] hover:text-[#037bb8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <History aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
    );
  };
  /** Open Show Last PO and ask the server — a newer request replaces an older answer. */
  function openLastPo(itemId: string, title: string, el: HTMLElement) {
    setLastPo({ itemId, title, origin: el.getBoundingClientRect(), rows: null, error: null });
    void getLastPurchases(itemId).then((res) =>
      setLastPo((cur) =>
        cur && cur.itemId === itemId ? { ...cur, rows: res.ok ? res.rows : [], error: res.ok ? null : res.error } : cur,
      ),
    );
  }
  /** "₹ 1.20", "USD 0.85 – 0.90". */
  const rateText = (p: LastPurchase) => {
    const sym = p.currency === "INR" ? "₹" : p.currency;
    return p.rateMin === p.rateMax ? `${sym} ${fmtFixed(p.rateMin, 2)}` : `${sym} ${fmtFixed(p.rateMin, 2)} – ${fmtFixed(p.rateMax, 2)}`;
  };
  /* THE QUANTITY WORDS FOLLOW WHAT IS BOUGHT (user 2026-10-26): yarn and fabric are bought
     by weight, so a grid holding only those reads Weight (Kg); anything else — or a mix,
     now that Item Class is multi-select — reads Qty, with the UOM column beside it. */
  const byWeight = gridRows.length > 0 && gridRows.every((r) => /\b(yarn|fabric)\b/i.test(r.item_class ?? ""));
  const QTY = byWeight
    ? { required: "Required Wt", toOrder: "To Order Wt", po: "Order PO Wt (Kg)" }
    : { required: "Required Qty", toOrder: "To Order Qty", po: "Order PO Qty" };
  /** The Order PO box itself — capped at To Order (spec 6). Shared by the row and the Size Breakup. */
  const qtyInput = (r: GridRow, id?: string) => (
    <Input
      id={id}
      type="number"
      min={0}
      max={r.balance_qty}
      inputMode="decimal"
      aria-label={`${QTY.po}, ${lineDescription(r)}${r.size_name ? `, size ${r.size_name}` : ""}, at most ${r.balance_qty} ${r.uom_code ?? ""}`}
      // NO `title` (user 2026-10-27, screenshot 3763: two messages on one box). The black
      // Req · To order tooltip around the cell already says it; the browser's own bubble
      // ("At most … on the requirement sheet") repeated it underneath.
      className={cn(CELL_INPUT, "min-w-0 flex-1 text-right tabular-nums")}
      disabled={r.row.skip}
      value={r.row.skip ? "0" : r.row.qty}
      onChange={(e) => {
        const typed = num(e.target.value);
        // Spec 6: excess is never possible — a figure above the balance snaps back to it.
        setRow(r, { qty: e.target.value === "" ? "" : typed > r.balance_qty ? String(capQty(typed, r.balance_qty)) : e.target.value });
      }}
    />
  );
  /** A line's Qty cell: the box and its unit on ONE line; Required · To Order float under it on focus. */
  const qtyBox = (r: GridRow) => (lineKindOf(r.item_class) === "general" ? qtyBoxPlain(r) : materialCell(r));
  const qtyBoxPlain = (r: GridRow) =>
    qtyFacts(
      r.required_qty,
      r.balance_qty,
      r.ordered_qty,
      <>
        {qtyInput(r)}
        {/* The Purchase UOM rides inside the quantity — it is what the number is counted in. */}
        <Truncated className="w-10 shrink-0 text-[11px] font-semibold text-muted-foreground uppercase">{r.uom_code ?? ""}</Truncated>
      </>,
    );
  /*
   * YARN BAGS · FABRIC ROLLS (user 2026-10-26, Task 2; 0758). The same pattern as the
   * size breakup — the cell is the total, an icon says it opens, and the detail is in a
   * small pop-up — so the grid keeps one width and one line per row.
   *
   * YARN: the Purchase Manager types the Bag Weight and the No. of Bags; the PO weight
   * is their product and is never typed. Whole bags may round the line UP past To
   * Order, but by less than one bag (user decision 2026-10-26) — `maxBags` caps the
   * count, and the save and `po_line_requirement_cap` apply the same rule. Before a bag
   * weight is typed the weight box works as on any other line (capped at To Order).
   *
   * FABRIC: the weight is typed as usual, with the No. of Rolls and the Dia beside it.
   */
  const round3 = (n: number) => Number(n.toFixed(3));
  function setBags(r: GridRow, bagsTyped: string, bagWtTyped: string) {
    const bw = num(bagWtTyped);
    if (!(bw > 0) || bagsTyped === "") {
      setRow(r, { bags: bagsTyped, bagWt: bagWtTyped });
      return;
    }
    const most = maxBags(r.balance_qty, bw);
    const b = Math.min(Math.max(0, Math.floor(num(bagsTyped))), most);
    setRow(r, { bags: String(b), bagWt: bagWtTyped, qty: String(round3(b * bw)) });
  }
  /** A yarn line is "in bags" once both are typed — then its weight is theirs, not the box's. */
  const bagsOf = (r: GridRow) => {
    const bw = num(r.row.bagWt ?? "");
    const b = r.row.bags ?? "";
    return lineKindOf(r.item_class) === "yarn" && bw > 0 && b !== "" ? { bags: Math.floor(num(b)), bagWeight: bw } : null;
  };
  /** What goes up to the save for this line's bags / rolls / dia (0758). */
  const materialPayload = (r: GridRow) => {
    const kind = lineKindOf(r.item_class);
    const inBags = bagsOf(r);
    return {
      bags: inBags?.bags ?? null,
      bag_weight: inBags?.bagWeight ?? null,
      rolls: kind === "fabric" && (r.row.rolls ?? "") !== "" ? Math.max(0, Math.floor(num(r.row.rolls ?? ""))) : null,
      dia: kind === "fabric" ? (r.row.dia ?? "").trim() || null : null,
    };
  };
  /** How much a bag line goes over To Order (0 when it does not). */
  const overBy = (r: GridRow) => Math.max(0, round3(num(r.row.qty) - r.balance_qty));
  /** The cell: icon + the weight, drawn like every other quantity; click or ↓ opens the pop-up. */
  const materialCell = (r: GridRow) => {
    const kind = lineKindOf(r.item_class);
    const inBags = bagsOf(r);
    const over = overBy(r);
    const summary =
      kind === "yarn"
        ? inBags
          ? `${inBags.bags} bag${inBags.bags === 1 ? "" : "s"} × ${inBags.bagWeight} kg`
          : "Set the bags"
        : [r.row.rolls ? `${r.row.rolls} rolls` : "", r.row.dia ? `Dia ${r.row.dia}` : ""].filter(Boolean).join(" · ") || "Set the rolls and dia";
    const Icon = kind === "yarn" ? Package : Layers;
    const open = (el: HTMLElement) => setQtySheet({ key: r.key, origin: el.getBoundingClientRect() });
    return qtyFacts(
      r.required_qty,
      r.balance_qty,
      r.ordered_qty,
      <>
        <button
          type="button"
          data-field-trigger
          aria-haspopup="dialog"
          aria-label={`${kind === "yarn" ? "Yarn bags" : "Fabric rolls and dia"}, ${lineDescription(r)} — ${num(r.row.qty)} ${r.uom_code ?? ""}, ${summary}. Press down arrow to open.`}
          title={`${summary} — open`}
          disabled={r.row.skip}
          onClick={(e) => open(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              open(e.currentTarget);
            }
          }}
          className="flex h-8 min-w-0 flex-1 items-center pr-2.5 pl-2 text-sm tabular-nums hover:bg-[#f2f7fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
        >
          <Icon aria-hidden className="size-4 shrink-0 text-[#037bb8]" />
          {/* Amber when whole bags took it over To Order — allowed, and said. */}
          <span className={cn("ml-auto", over > 0 && "font-semibold text-[#8a5800]")}>{r.row.skip ? 0 : num(r.row.qty)}</span>
        </button>
        <Truncated className="w-10 shrink-0 text-[11px] font-semibold text-muted-foreground uppercase">{r.uom_code ?? ""}</Truncated>
      </>,
    );
  };
  const qtySheetRow = qtySheet ? (gridRows.find((r) => r.key === qtySheet.key) ?? null) : null;

  /*
   * REQUIRED · TO ORDER ON DEMAND (user 2026-10-26, screenshot 3736: "for all same like
   * that … if the field is clicked they can see that details, like compact it"). Printed
   * under every box they made each row two lines tall and ran into the Rate column; now
   * they are a small tag that floats under the box while it has the cursor (or the
   * pointer), over the row beneath rather than pushing it down — so nothing jumps. The
   * A sized row has no tag: its pop-up shows both.
   *
   * PORTALED, NOT `absolute` (user 2026-10-27, screenshot 3739: "qty details are
   * hidden"). The grid scrolls sideways, and `overflow-x: auto` forces the vertical
   * axis to clip too — so a tag hanging under the LAST row was cut off by the table's
   * own edge and only grew a scrollbar. `Tooltip` is fixed-positioned in a portal,
   * the same answer `DropdownMenu` gives for a row control inside `DataTable`.
   */
  const qtyFacts = (required: number, toOrder: number, ordered: number, children: ReactNode) => (
    <Tooltip
      side="bottom"
      className="flex w-full items-center gap-1"
      label={`Req ${fmtNumber(required)} · To order ${fmtNumber(toOrder)}${ordered > 0 ? ` · ${fmtNumber(ordered)} on other POs` : ""}`}
    >
      {children}
    </Tooltip>
  );
  /* GST % PER LINE (user 2026-10-26, 0756). A line follows the header's slab until it is
     changed here, so the header box still sets every untouched line at once. CGST+SGST vs
     IGST is not chosen per line — it is the vendor's state, and stays on the header. */
  const gstCell = (id: string, label: string, value: number | null, disabled: boolean, set: (pct: number) => void) => (
    <Select
      id={id}
      aria-label={`GST %, ${label}`}
      title={slab.kind === "igst" ? "IGST" : "CGST + SGST, split in half"}
      // THE WHOLE CELL OPENS THE LIST (user 2026-10-27, screenshot 3743). The cell look used to
      // go through `className`, which `Select` also puts on the Combobox's WRAPPER — its `pr-6`
      // padded the wrapper, so the box shrank to a sliver that hid the value and the ▼ sat
      // outside it, where a click opened nothing. Wrapper: width only; box: the cell look.
      className="w-full"
      inputClassName={cn(CELL_INPUT, "pl-2 tabular-nums")}
      compact
      disabled={disabled}
      value={value == null ? "" : String(value)}
      onChange={(e) => set(Number(e.target.value))}
    >
      {/* Only when the orders under an item were given different slabs — never offered as a choice. */}
      {value == null ? (
        <option value="" disabled>
          mixed
        </option>
      ) : null}
      {LINE_GST_PCTS.map((p) => (
        <option key={p} value={p}>
          {p}%
        </option>
      ))}
    </Select>
  );
  /** THE ONE COLUMN TO TYPE IN is tinted (V6) — the cells around it are read, this is filled. */
  const RATE_COL = "bg-[#fffaeb]";

  // ---------- grid ----------
  /*
   * A TIGHT TABLE (user 2026-10-24, screenshot 3704). Item 200 + Note 112 + Qty 144 +
   * Rate 88 + GST 88 + Delivery 144 + Amount 88 + 72 = 936, + 40 chrome = 976 — inside
   * the ~1,060px pane beside the order list (1920 screen at 125%), so no sideways scroll.
   * Every row is ONE line: Required · To Order float under the Qty box on focus (`qtyFacts`).
   * ChildGrid's DEFAULT switch (a table from a 512px pane, cards below it on a phone). No
   * Budget column since 2026-10-26 — see Amount.
   *
   * NO ORDER COLUMN: the list on the left names the order on screen.
   *
   * THE THREE QUANTITIES LIVE IN ONE CELL (user 2026-10-26: "qty detail inside can show
   * all the three qty detail"): Order PO Qty is the box, its unit beside it, and Required
   * · To Order read underneath. Three columns of their own made the grid 1,224px and it
   * scrolled sideways; this is one 144px cell. It REVERSES "no balance column"
   * (screenshot 3692, 2026-10-24) on the later instruction — the balance was a tooltip,
   * and the Purchase Manager wants to read it, not hover for it.
   */
  const poLineColumns: ChildGridColumn<GridRow>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.party,
      cell: (r) =>
        itemCell(r.item_name, lineDescription({ item_name: "", slice_label: r.slice_label, colour: r.colour }).replace(/^ · /, ""), r.row.skip, r.item_id, r.category),
    },
    {
      /* NOTE / REMARK (user 2026-10-26): the Purchase Manager's instruction for THIS item —
         "PROCESS: CUT & SEAL", "SHADE 402". Saved onto the line's description as
         "ITEM (NOTE)", which is what the print, GRN and store logs read. */
      header: "Note / Remark",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <Input
          id={`rpo-note-${r.key}`}
          maxLength={200}
          aria-label={`Note to the vendor, ${lineDescription(r)}`}
          title={r.row.note ? `Prints as: ${withNote(lineDescription(r), r.row.note).toUpperCase()}` : "Printed after the item on the PO, e.g. PROCESS: CUT & SEAL"}
          className={CELL_INPUT}
          disabled={r.row.skip}
          value={r.row.note ?? ""}
          onChange={(e) => setRow(r, { note: e.target.value })}
        />
      ),
    },
    { header: QTY.po, width: FIELD_WIDTH_CSS.code, cell: (r) => qtyBox(r) },
    {
      header: `Rate ${cur}`,
      width: FIELD_WIDTH_CSS.hug,
      className: RATE_COL,
      cell: (r) => (
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          id={rateId(r.key)}
          aria-label={`Rate per ${r.uom_code ?? "unit"}, ${lineDescription(r)}`}
          className={cn(CELL_INPUT, "text-right tabular-nums")}
          title={lastRateTitle(r.item_id)}
          disabled={r.row.skip}
          value={r.row.rate}
          onChange={(e) => setRow(r, { rate: e.target.value })}
        />
      ),
    },
    {
      header: "GST %",
      // 88, not 72 (user 2026-10-27, screenshot 3769): at 72 the ▼ and padding left the
      // value ~22px and "12%" read "1…".
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => gstCell(`rpo-gst-${r.key}`, lineDescription(r), r.row.gst ?? slab.pct, !!r.row.skip, (pct) => setRow(r, { gst: pct })),
    },
    {
      header: "Delivery",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) =>
        deliveryCell(`rpo-date-${r.key}`, r.row.date, lineDescription(r), !!r.row.skip, defaultFor(r.delivery_date), (v) => setRow(r, { date: v })),
    },
    {
      /* AMOUNT CARRIES THE BUDGET WORD (user 2026-10-26: "PO sheet on the right side" —
         the table was wider than its pane and scrolled sideways). The Budget column held
         one of three short states; each now reads in this cell instead: an amount above
         the approved budget is red with a warning mark, a skipped line says so, a line at
         0 is a dash. The spec's exact "Above Approved Budget" is the title and the bar. */
      header: "Amount",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => {
        if (r.row.skip)
          return (
            <span className="text-xs font-semibold text-muted-foreground" title="Not on this PO — its balance stays for another vendor's PO">
              Skipped
            </span>
          );
        if (num(r.row.qty) <= 0)
          return (
            <span className="text-muted-foreground" title="Not ordered on this PO">
              —
            </span>
          );
        const a = num(r.row.qty) * num(r.row.rate);
        if (a <= 0) return null;
        const above = !!flags[r.key]?.above;
        return (
          <span
            title={above ? "Above Approved Budget" : undefined}
            className={cn("inline-flex items-center gap-1 text-sm font-medium tabular-nums", above && "font-semibold text-[#b42318]")}
          >
            {above ? <AlertTriangle aria-label="Above Approved Budget" className="size-3.5" /> : null}
            {fmtFixed(a, 2)}
          </span>
        );
      },
    },
    {
      /* SKIP (V7 point 7): this PO goes without the line, its balance waits for the
         next vendor's. Reversible in place — the row greys and the icon turns to Undo.
         A button, so it is off the Tab path like every row action. */
      header: "",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={r.row.skip ? `Put ${lineDescription(r)} back on this PO` : `Skip ${lineDescription(r)} on this PO`}
          title={r.row.skip ? "Put back on this PO" : "Skip on this PO — the balance stays for another PO"}
          onClick={() => setRow(r, { skip: !r.row.skip })}
        >
          {r.row.skip ? <Undo2 aria-hidden className="size-4" /> : <Ban aria-hidden className="size-4 text-muted-foreground" />}
        </Button>
      ),
    },
  ];

  // ---------- item-wise: one row per item across the ticked orders ----------
  type ItemGroup = {
    key: string;
    item_name: string;
    spec: string;
    uom_code: string | null;
    supplied: boolean;
    members: GridRow[];
    qty: number;
    rate: string;
    mixedRate: boolean;
    note: string;
    mixedNote: boolean;
    /** null = the orders under it carry different slabs */
    gst: number | null;
    date: string;
    amount: number;
    orders: number;
    above: number;
  };
  const itemGroups: ItemGroup[] = [];
  {
    const byKey = new Map<string, GridRow[]>();
    for (const r of gridRows) {
      // The SAME purchase: item, slice, colour and the unit it is bought in.
      const k = `${r.item_id}|${r.slice_label.trim().toUpperCase()}|${(r.colour ?? "").toUpperCase()}|${r.uom_id ?? ""}`;
      byKey.set(k, [...(byKey.get(k) ?? []), r]);
    }
    for (const [key, ms] of byKey) {
      const act = ms.filter(isActive);
      const rates = [...new Set(act.map((m) => m.row.rate.trim()))];
      const notes = [...new Set(ms.map((m) => (m.row.note ?? "").trim()))];
      const gsts = [...new Set(ms.map((m) => m.row.gst ?? slab.pct))];
      const def = defaultFor(earliest(ms.map((m) => m.delivery_date)));
      const dates = [...new Set(act.map((m) => m.row.date || defaultFor(m.delivery_date)?.date || ""))];
      itemGroups.push({
        key,
        item_name: ms[0].item_name,
        spec: lineDescription({ item_name: "", slice_label: ms[0].slice_label, colour: ms[0].colour }).replace(/^ · /, ""),
        uom_code: ms[0].uom_code,
        supplied: ms[0].supplied,
        members: ms,
        qty: act.reduce((a, m) => a + num(m.row.qty), 0),
        rate: rates.length === 1 ? rates[0] : "",
        mixedRate: rates.length > 1,
        note: notes.length === 1 ? notes[0] : "",
        mixedNote: notes.length > 1,
        gst: gsts.length === 1 ? gsts[0] : null,
        date: dates.length === 1 ? dates[0] : (def?.date ?? ""),
        amount: act.reduce((a, m) => a + num(m.row.qty) * num(m.row.rate), 0),
        orders: ms.length,
        above: act.filter((m) => flags[m.key]?.above).length,
      });
    }
  }
  const openItem = itemGroups.find((g) => g.key === itemFold.openKey) ?? null;

  /*
   * Item 200 + Note 88 + Orders 88 + Qty 144 + Rate 88 + GST 88 + Delivery 144 + Amount 88
   * + Budget 112 = 1040, + 40 chrome = 1080 — about the pane beside the order list; the unit
   * rides inside Qty, as on the order grid. Same default switch as the order grid (see its note). The note, rate, GST
   * and delivery typed here go to every order line under the item; the breakup below edits
   * one order at a time.
   */
  const itemColumns: ChildGridColumn<ItemGroup>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.party,
      cell: (g) => itemCell(g.item_name, g.spec, false, g.members[0]?.item_id, g.members[0]?.category),
    },
    {
      header: "Note / Remark",
      width: FIELD_WIDTH_CSS.hug,
      cell: (g) => (
        <Input
          id={`rpo-inote-${g.key}`}
          maxLength={200}
          aria-label={`Note to the vendor, ${g.item_name} ${g.spec}, for all ${g.orders} orders`}
          className={CELL_INPUT}
          // MIXED: the orders were noted apart in the order view — typing here sets them all again.
          placeholder={g.mixedNote ? "mixed" : undefined}
          value={g.note}
          onChange={(e) => setMembers(g.members, { note: e.target.value })}
        />
      ),
    },
    {
      header: "Orders",
      width: FIELD_WIDTH_CSS.hug,
      cell: (g) => (
        <button
          type="button"
          aria-expanded={itemFold.isOpen(g.key)}
          onClick={() => itemFold.toggle(g.key)}
          className="inline-flex items-center gap-1 text-sm font-medium text-[#037bb8] hover:underline"
        >
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", itemFold.isOpen(g.key) && "rotate-90")} />
          {g.orders}
        </button>
      ),
    },
    {
      header: QTY.po,
      width: FIELD_WIDTH_CSS.code,
      cell: (g) =>
        qtyFacts(
          g.members.reduce((a, m) => a + m.required_qty, 0),
          g.members.reduce((a, m) => a + m.balance_qty, 0),
          g.members.reduce((a, m) => a + m.ordered_qty, 0),
          <div className="flex h-8 w-full items-center justify-end gap-1 px-2 text-sm font-medium tabular-nums">
            {g.qty > 0 ? fmtNumber(g.qty) : "—"}
            <Truncated className="w-10 shrink-0 text-left text-[11px] font-semibold text-muted-foreground uppercase">{g.uom_code ?? ""}</Truncated>
          </div>,
        ),
    },
    {
      header: `Rate ${cur}`,
      width: FIELD_WIDTH_CSS.hug,
      className: RATE_COL,
      cell: (g) => (
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          aria-label={`Rate per ${g.uom_code ?? "unit"}, ${g.item_name} ${g.spec}, for all ${g.orders} orders`}
          className={cn(CELL_INPUT, "text-right tabular-nums")}
          // MIXED: the orders were priced apart in the breakup — typing here sets them all again.
          placeholder={g.mixedRate ? "mixed" : undefined}
          title={lastRateTitle(g.members[0]?.item_id)}
          disabled={!g.supplied}
          value={g.rate}
          onChange={(e) => setMembers(g.members, { rate: e.target.value })}
        />
      ),
    },
    {
      header: "GST %",
      // 88, not 72 (user 2026-10-27, screenshot 3769): at 72 the ▼ and padding left the
      // value ~22px and "12%" read "1…".
      width: FIELD_WIDTH_CSS.hug,
      cell: (g) =>
        gstCell(`rpo-igst-${g.key}`, `${g.item_name} ${g.spec}, for all ${g.orders} orders`, g.gst, !g.supplied, (pct) =>
          setMembers(g.members, { gst: pct }),
        ),
    },
    {
      header: "Delivery",
      width: FIELD_WIDTH_CSS.code,
      cell: (g) =>
        deliveryCell(
          `rpo-idate-${g.key}`,
          g.members.some((m) => m.row.date) ? g.date : "",
          `${g.item_name} ${g.spec}`,
          !g.supplied,
          defaultFor(earliest(g.members.map((m) => m.delivery_date))),
          (v) => setMembers(g.members, { date: v }),
        ),
    },
    {
      header: "Amount",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (g) => <span className="text-sm font-medium tabular-nums">{g.amount > 0 ? fmtFixed(g.amount, 2) : ""}</span>,
    },
    {
      header: "Budget",
      width: FIELD_WIDTH_CSS.range,
      cell: (g) =>
        g.above > 0 ? (
          <span title="Above Approved Budget">
            <StatusPill tone="danger">Above · {g.above}/{g.orders}</StatusPill>
          </span>
        ) : null,
    },
  ];
  /* The breakup under an open item: one row per order, its own qty (capped at that
     order's balance) and delivery — the cells are the order-wise grid's own. */
  const breakupColumns: ChildGridColumn<GridRow>[] = [
    {
      header: "Order",
      width: FIELD_WIDTH_CSS.party,
      cell: (r) => (
        <div className="min-w-0">
          <Truncated className="font-mono text-sm tabular-nums">{r.source_no}</Truncated>
          {r.customer ? <Truncated className="text-xs text-muted-foreground">{r.customer}</Truncated> : null}
        </div>
      ),
    },
    ...poLineColumns.filter((c) => [QTY.po, "GST %", "Delivery", "Amount", ""].includes(c.header)),
  ];

  const canSave =
    !isPending && hasClass && orderIds.length > 0 && !!vendorId && active.length > 0 && undated === 0 && (poType === "local" || num(exRate) > 0);
  // Above budget → the reason is mandatory before it can go to the MD (user 2026-10-27).
  const canSubmit = canSave && unpriced === 0 && (!goesToMd || !!budgetReason);
  const hint = !hasClass
    ? "Choose the item class."
    : orderIds.length === 0
      ? "Tick the orders for this PO."
      : !vendorId
        ? classVendors.length === 0
          ? classIds.length > 1
            ? "No bought-item vendor is mapped to every class ticked — untick one, or map a vendor in Master Data ▸ Vendors."
            : `No bought-item vendor is mapped to ${classOptions.find((c) => c.value === classIds[0])?.label ?? "this class"} — add one in Master Data ▸ Vendors.`
          : "Choose the vendor."
        : active.length === 0
          ? "Every line is skipped or 0 — there is nothing to order."
          : undated > 0
            ? `Type the delivery date on ${undated} line${undated === 1 ? "" : "s"} — the order has no ship date and ${vendorName} no lead days.`
            : poType === "import" && num(exRate) <= 0
              ? "Type the exchange rate."
              : unpriced > 0
                ? "Submit opens once every rate is typed."
                : goesToMd
                  ? `More than Budget on ${above} line(s)${unbudgeted ? `, no approved budget on ${unbudgeted}` : ""} — ${budgetReason ? "Submit sends it to the MD; printing stays locked." : "give the reason, then Submit to MD."}`
                  : "Every rate is within budget — Submit approves the PO by rule.";
  /* THE BAR'S MESSAGE IS A STATUS CHIP (user 2026-10-26: "make it better, single row,
     better colouring"): amber = something still to do, red = Submit goes to the MD,
     green = ready. Fixed colour pairs, as in FilterPill — the skin cannot repaint them. */
  const hintKind: "todo" | "md" | "ready" =
    unpriced > 0 || !vendorId || undated > 0 || orderIds.length === 0 || !hasClass || active.length === 0 ? "todo" : goesToMd ? "md" : "ready";
  const HINT_CHIP = {
    todo: { box: "border-[#f1d48a] bg-[#fff7e0] text-[#8a5800]", dot: "bg-[#d9a400]" },
    md: { box: "border-[#f5b8b0] bg-[#fdecea] text-[#b42318]", dot: "bg-[#d92d20]" },
    ready: { box: "border-[#a6dcb9] bg-[#e8f6ee] text-[#14803f]", dot: "bg-[#14803f]" },
  }[hintKind];
  const charges = chargesNet(commercial);

  const itemsToPrice = itemGroups.filter((g) => g.supplied && g.qty > 0 && !g.rate && !g.mixedRate).length;

  // ---------- SIZE BREAKUP (user 2026-10-26, 0757) ----------
  /*
   * ONE ROW PER ITEM, NOT PER SIZE. A trim bought in S · M · L · XL was five rows; it is
   * now one — item + slice-without-size + colour + unit — and its sizes open in a pop-up.
   * The requirement lines underneath are untouched: each size is still its own line with
   * its own req_key, balance and saved PO line, so nothing about the save, the cap or the
   * GRN changes. A row's Note, Rate, GST, Delivery and Skip are typed ONCE and go to every
   * size under it (the item-wise view's `setMembers`); only the quantity is per size.
   */
  /** What the item cell's hover says: the slice without its size, and the colour. */
  const describeGroup = (g: SizeGroup) =>
    lineDescription({ item_name: "", slice_label: g.first.slice_base, colour: g.first.colour }).replace(/^ · /, "");
  /** One value when every size agrees, else null — the cell then reads "mixed". */
  const common = <T,>(vals: T[]): T | null => (new Set(vals).size === 1 ? vals[0] : null);
  const groupSkip = (g: SizeGroup) => g.members.every((m) => m.row.skip);
  const groupQty = (g: SizeGroup) => g.members.reduce((a, m) => a + (m.row.skip ? 0 : num(m.row.qty)), 0);
  const openSizes = (g: SizeGroup, el: HTMLElement) => setSizeSheet({ key: g.key, origin: el.getBoundingClientRect() });

  /*
   * The order grid on size rows. Same widths as `poLineColumns` (936 + 40 = 976). The
   * Qty cell of a sized row is a BUTTON showing the total — click it, or ↓ on it (the
   * key that opens any list here), for the per-size quantities. It is `data-field-trigger`
   * so Tab lands on it like a field (AGENTS, Tab lands on fields) and ↓ is the way in.
   */
  const groupColumns: ChildGridColumn<SizeGroup>[] = [
    { header: "Item", width: FIELD_WIDTH_CSS.party, cell: (g) => itemCell(g.first.item_name, describeGroup(g), groupSkip(g), g.first.item_id, g.first.category) },
    {
      header: "Note / Remark",
      width: FIELD_WIDTH_CSS.range,
      cell: (g) => {
        const note = common(g.members.map((m) => (m.row.note ?? "").trim()));
        return (
          <Input
            id={`rpo-note-${g.first.key}`}
            maxLength={200}
            aria-label={`Note to the vendor, ${g.first.item_name} ${describeGroup(g)}`}
            title={note ? `Prints as: ${withNote(lineDescription(g.first), note).toUpperCase()}` : "Printed after the item on the PO, e.g. PROCESS: CUT & SEAL"}
            className={CELL_INPUT}
            placeholder={note == null ? "mixed" : undefined}
            disabled={groupSkip(g)}
            value={note ?? ""}
            onChange={(e) => setMembers(g.members, { note: e.target.value })}
          />
        );
      },
    },
    {
      header: QTY.po,
      width: FIELD_WIDTH_CSS.code,
      cell: (g) => {
        if (!g.sized) return qtyBox(g.first);
        const sizes = g.members.map((m) => m.size_name).filter(Boolean);
        return (
          <div className="group/qty flex items-center gap-1">
            <button
                type="button"
                data-field-trigger
                aria-haspopup="dialog"
                aria-label={`Size breakup, ${g.first.item_name} ${describeGroup(g)} — ${sizes.length} sizes, ${fmtNumber(groupQty(g))} ${g.first.uom_code ?? ""} on this PO. Press down arrow to open.`}
                title={`${sizes.join(" · ")} — open the size breakup`}
                disabled={groupSkip(g)}
                onClick={(e) => openSizes(g, e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    openSizes(g, e.currentTarget);
                  }
                }}
                /* LOOKS LIKE EVERY OTHER QUANTITY (user 2026-10-26: "why this much large pill",
                   screenshot 3737 "looks mistake", screenshot 3738 "remove that 7 sizes, just the
                   icon, which is clickable — align it"). The total is drawn exactly as the boxes
                   draw theirs: foreground, no grouping, right-aligned, and `pr-2.5` because that
                   is `Input`'s own padding — so 3230 here ends where 3230 ends in the box above.
                   The ruler on the left is the only sign it opens; the count is in the label. */
                className="flex h-8 min-w-0 flex-1 items-center pr-2.5 pl-2 text-sm tabular-nums hover:bg-[#f2f7fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
              >
                <Ruler aria-hidden className="size-4 shrink-0 text-[#037bb8]" />
                <span className="ml-auto">{Number(groupQty(g).toFixed(3))}</span>
              </button>
            <Truncated className="w-10 shrink-0 text-[11px] font-semibold text-muted-foreground uppercase">{g.first.uom_code ?? ""}</Truncated>
            {/* NO Req · To order HERE (user 2026-10-26, screenshot 3735): the pop-up shows both per size. */}
          </div>
        );
      },
    },
    {
      header: `Rate ${cur}`,
      width: FIELD_WIDTH_CSS.hug,
      className: RATE_COL,
      cell: (g) => {
        const rate = common(g.members.filter((m) => !m.row.skip).map((m) => m.row.rate.trim()));
        return (
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            id={rateId(g.first.key)}
            aria-label={`Rate per ${g.first.uom_code ?? "unit"}, ${g.first.item_name} ${describeGroup(g)}${g.sized ? ", every size" : ""}`}
            className={cn(CELL_INPUT, "text-right tabular-nums")}
            placeholder={rate == null ? "mixed" : undefined}
            title={lastRateTitle(g.first.item_id)}
            disabled={groupSkip(g)}
            value={rate ?? ""}
            onChange={(e) => setMembers(g.members, { rate: e.target.value })}
          />
        );
      },
    },
    {
      header: "GST %",
      // 88, not 72 (user 2026-10-27, screenshot 3769): at 72 the ▼ and padding left the
      // value ~22px and "12%" read "1…".
      width: FIELD_WIDTH_CSS.hug,
      cell: (g) =>
        gstCell(
          `rpo-gst-${g.first.key}`,
          `${g.first.item_name} ${describeGroup(g)}`,
          common(g.members.map((m) => m.row.gst ?? slab.pct)),
          groupSkip(g),
          (pct) => setMembers(g.members, { gst: pct }),
        ),
    },
    {
      header: "Delivery",
      width: FIELD_WIDTH_CSS.code,
      cell: (g) =>
        deliveryCell(
          `rpo-date-${g.first.key}`,
          common(g.members.map((m) => m.row.date)) ?? "",
          `${g.first.item_name} ${describeGroup(g)}`,
          groupSkip(g),
          defaultFor(g.first.delivery_date),
          (v) => setMembers(g.members, { date: v }),
        ),
    },
    {
      header: "Amount",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (g) => {
        if (groupSkip(g))
          return (
            <span className="text-xs font-semibold text-muted-foreground" title="Not on this PO — its balance stays for another vendor's PO">
              Skipped
            </span>
          );
        if (groupQty(g) <= 0)
          return (
            <span className="text-muted-foreground" title="Not ordered on this PO">
              —
            </span>
          );
        const live = g.members.filter((m) => !m.row.skip);
        const a = live.reduce((t, m) => t + num(m.row.qty) * num(m.row.rate), 0);
        if (a <= 0) return null;
        const above = live.some((m) => flags[m.key]?.above);
        return (
          <span
            title={above ? "Above Approved Budget" : undefined}
            className={cn("inline-flex items-center gap-1 text-sm font-medium tabular-nums", above && "font-semibold text-[#b42318]")}
          >
            {above ? <AlertTriangle aria-label="Above Approved Budget" className="size-3.5" /> : null}
            {fmtFixed(a, 2)}
          </span>
        );
      },
    },
    {
      header: "",
      width: FIELD_WIDTH_CSS.num,
      cell: (g) => {
        const skip = groupSkip(g);
        const what = `${g.first.item_name} ${describeGroup(g)}${g.sized ? " (every size)" : ""}`;
        return (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={skip ? `Put ${what} back on this PO` : `Skip ${what} on this PO`}
            title={skip ? "Put back on this PO" : "Skip on this PO — the balance stays for another PO"}
            onClick={() => setMembers(g.members, { skip: !skip })}
          >
            {skip ? <Undo2 aria-hidden className="size-4" /> : <Ban aria-hidden className="size-4 text-muted-foreground" />}
          </Button>
        );
      },
    },
  ];

  /* The pop-up's own grid: one row per size — Size · Required · To Order · Order PO Qty,
     the four the spec names, each in its own column (the pop-up has the room the order
     grid does not). 72 + 112 + 112 + 144 + 40 = 480, inside `md`'s ~1,100px. */
  const sizeColumns: ChildGridColumn<GridRow>[] = [
    // Size `hug` and Order PO `term` (not num / code): the table must be 528px so it FILLS the
    // pop-up (see its Sheet) — a narrower table left a gap, and a narrower pop-up drops to cards.
    { header: "Size", width: FIELD_WIDTH_CSS.hug, cell: (r) => <span className="text-sm font-semibold">{r.size_name ?? "—"}</span> },
    {
      header: QTY.required,
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (r) => <span className="text-sm tabular-nums text-muted-foreground">{fmtNumber(r.required_qty)}</span>,
    },
    {
      header: QTY.toOrder,
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (r) => (
        <span
          className="text-sm font-medium tabular-nums"
          title={r.ordered_qty > 0 ? `${fmtNumber(r.required_qty)} required less ${fmtNumber(r.ordered_qty)} already on other POs (drafts count)` : undefined}
        >
          {fmtNumber(r.balance_qty)}
        </span>
      ),
    },
    {
      header: QTY.po,
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <div className="flex items-center gap-1">
          {qtyInput(r, `rpo-sqty-${r.key}`)}
          <Truncated className="w-10 shrink-0 text-[11px] font-semibold text-muted-foreground uppercase">{r.uom_code ?? ""}</Truncated>
        </div>
      ),
    },
  ];
  const sheetGroup = sizeSheet && activeGroup ? (sizeGroupsOf(activeGroup.rows).find((g) => g.key === sizeSheet.key) ?? null) : null;

  /*
   * A SKIPPED LINE LEAVES THE TABLE (user 2026-10-27: "if skipped can remove it from
   * table instead strike it out"). It used to stay, struck through, between the lines
   * being ordered. Now it drops out and is named in this strip under the table — the one
   * way back, since its ⊘ left with it. Still saved as 0, its balance kept for another PO.
   */
  const skippedStrip = (items: readonly { key: string; label: string; members: readonly GridRow[] }[]) =>
    items.length ? (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-2 text-xs text-muted-foreground">
        <span>Skipped on this PO — balance kept:</span>
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            aria-label={`Put ${i.label} back on this PO`}
            title="Put back on this PO"
            onClick={() => setMembers(i.members, { skip: false })}
            className="inline-flex max-w-[16rem] items-center gap-1 rounded-control border border-[#dde4eb] bg-surface px-2 py-0.5 font-medium text-foreground hover:border-[#037bb8] hover:text-[#037bb8]"
          >
            <Undo2 aria-hidden className="size-3 shrink-0" />
            <Truncated touch={false} className="min-w-0">
              {i.label}
            </Truncated>
          </button>
        ))}
      </div>
    ) : null;

  const rePane = (g: (typeof groups)[number]) => {
    const all = sizeGroupsOf(g.rows);
    return (
      <>
        {/* default-row: exempt -- the rows are the order's requirement lines, derived; nothing is added here */}
        <ChildGrid<SizeGroup>
          columns={groupColumns}
          rows={all.filter((x) => !groupSkip(x))}
          flatRows
          hideAdd
          hideRemove
          keepOne={false}
          onAdd={() => false}
          onRemove={() => {}}
          frameless
          headerClassName={GRID_HEAD}
        />
        {skippedStrip(all.filter(groupSkip).map((x) => ({ key: x.key, label: x.first.item_name, members: x.members })))}
      </>
    );
  };

  /* ONE ORDER, ONE LINE (user 2026-10-26, screenshot 2026-10-26 103442: "compact this
     left rail … without scroll … remove Late, No budget … I can see two times the number,
     make it one"). Tick and the number once, nothing else (the buyer went too, same day):
     - Late and No budget are what the Order by and Budget FILTERS are for; said again on
       every row they were the loudest thing on screen and decided nothing.
     - An SWO's number carries its SIW after " · ", and an IWO's note repeats its own
       number ("IWO/003(TRIMS)"), so the row reads the order number alone — the whole of
       it on hover — and a buyer only where there is one (an RE).
     - A draft holding the balance stays: it is the one fact here no filter shows.
     Two buttons, not one — the tick toggles, the rest opens a ticked order on the right
     (and ticks an unticked one). Both are buttons, so Tab — fields only — passes over. */
  const orderRow = (o: OrderFacts) => {
    const on = chosen.has(o.id);
    const g = groups.find((x) => x.id === o.id);
    const toPrice = g?.toPrice.length ?? 0;
    const shortNo = o.no.split(" · ")[0];
    return (
      <div
        key={o.id}
        className={cn(
          "grid h-8 grid-cols-[1.75rem_minmax(0,1fr)] items-center border-b border-[#e8edf2]",
          on && "bg-white shadow-[inset_3px_0_0_#037bb8]",
          on && selKey === o.id && "bg-[#eef6fc]",
        )}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          aria-label={`${on ? "Untick" : "Tick"} ${o.no}`}
          onClick={() => toggleOrder(o.id)}
          className="grid h-full place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className={cn(
              "grid size-4 place-items-center rounded border-[1.5px] border-muted-foreground text-white",
              on && "border-[#037bb8] bg-[#037bb8]",
            )}
          >
            {on ? <Check className="size-3" strokeWidth={3} /> : null}
          </span>
        </button>
        <button
          type="button"
          aria-current={on && selKey === o.id ? true : undefined}
          title={[o.no, o.buyer, `${o.lines} item${o.lines === 1 ? "" : "s"}`, o.shipDate ? `ships ${fmtDate(o.shipDate)}` : null]
            .filter(Boolean)
            .join(" · ")}
          onClick={() => (on ? setActiveKey(o.id) : toggleOrder(o.id))}
          className="mr-1 flex h-full min-w-0 items-center gap-1.5 rounded px-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#037bb8]"
        >
          <Truncated className="min-w-0 font-mono text-xs font-semibold tabular-nums">{shortNo}</Truncated>
          {/* No buyer on the row (user 2026-10-26: "no need customer name") — the Buyer
              filter narrows by it, and the row's hover still names it. */}
          <span className="flex-1" />
          {o.held ? (
            <span
              title={`Held by draft ${o.held.code}${o.held.by ? ` · ${o.held.by}` : ""} — drafts count as ordered`}
              className="shrink-0 rounded-full bg-[#fff7e0] px-1.5 text-[11px] font-semibold text-[#8a5800]"
            >
              Draft
            </span>
          ) : null}
          {on && toPrice > 0 ? (
            <span
              aria-label={`${toPrice} rate${toPrice === 1 ? "" : "s"} to type`}
              className="shrink-0 rounded-full bg-[#fdecea] px-1.5 text-[11px] font-semibold tabular-nums text-[#b42318]"
            >
              {toPrice}
            </span>
          ) : on && g?.done ? (
            <Check aria-label="Priced" className="size-3.5 shrink-0 text-[#14803f]" />
          ) : null}
        </button>
      </div>
    );
  };

  const leadNote = vendor
    ? `Ship date − ${vendor.lead_days ?? 0} d lead (${vendor.name}) − ${INSPECTION_DAYS} d inspection`
    : `Ship date − slowest vendor's ${leadDays} d lead − ${INSPECTION_DAYS} d inspection`;
  const shown = visible.ticked.length + visible.rest.length;

  const sectionLabel = (text: ReactNode) => (
    <div className="flex h-6 items-center border-b border-[#dde4eb] bg-[#f5f7f9] px-2.5 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
      {text}
    </div>
  );

  return (
    <div data-focus-scope>
      {/* ONE SURFACE (user 2026-10-26: "each section have separate division, make it
          single clean page design"). Title row · filter row · list and lines · totals
          bar, parted by hairlines inside ONE frame — no card inside a card, no boxed
          grid, no footer floating as a box of its own. The PO's own terms (GST, Payment
          Terms, the exchange rate) ride the title row beside its number: they are facts
          about this PO, as the number and date are. */}
      <div className="max-w-[88rem] rounded-xl border border-[#dde4eb] bg-white">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
          <h2 className="text-base font-bold">Purchase Order</h2>
          {/* PO NO (0745): the next number in this unit, given for real on Save under a
              lock — a chip beside the title, not a read-only field in the row (V6). */}
          {nextPoNo ? (
            <span title="Given when the PO is saved" className="rounded-md border border-[#dde4eb] px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
              {nextPoNo}
            </span>
          ) : null}
          <span className="rounded-md border border-[#dde4eb] px-2 py-0.5 text-xs tabular-nums text-muted-foreground" title="PO date">
            {fmtDate(poDate)}
          </span>
          {/* GST and Terms moved into the Commercial section (user 2026-10-26). */}
          {poType === "import" ? (
            /* ONE BOX, NOT TWO (user 2026-10-24, screenshot 3711): Currency and Exchange
               Rate are one fact, "1 USD = ₹ x". */
            <label className="inline-flex h-8 items-center gap-1 rounded-control border border-[#d9a400] pl-1 text-[13px] text-muted-foreground focus-within:border-[#037bb8]">
              <select
                id="rpo-ccy"
                aria-label="Currency"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-7 rounded bg-transparent px-1 text-[13px] font-semibold text-foreground"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              → ₹<span aria-hidden className="text-danger">*</span>
              <Input
                id="rpo-fx"
                type="number"
                min={0}
                inputMode="decimal"
                required
                aria-label={`Rupees for 1 ${currency}`}
                className="h-7 w-20 border-0 bg-transparent px-1 text-right text-[13px] font-semibold tabular-nums text-foreground shadow-none focus-visible:ring-0"
                value={exRate}
                onChange={(e) => {
                  setDirty(true);
                  setExRate(e.target.value);
                }}
              />
            </label>
          ) : null}
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            Print opens after approval
          </span>
        </div>
          {/* THE FILTER ROW (canvas v6). PO Type, Item Class and Vendor are required pills;
              the rest only narrow the tick list below. Counts are "what this choice would
              leave", so a greyed choice is one that would empty the list. */}
          {/* ONE ROW from md up (screenshot 3744): the pills shrink to fit instead of wrapping. */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-3 border-t border-[#dde4eb] bg-[#fafbfc] px-4 pt-4 pb-2.5 md:flex-nowrap">
            {/* PO TYPE LEADS THE ROW (user 2026-10-26: "type local/import also as filter,
                move it before item class"). Always set, so it never holds the cursor. */}
            <FilterPill
              id="rpo-type"
              label="PO Type"
              family="vendor"
              icon={Truck}
              required
              options={[
                { value: "local", label: "Local" },
                { value: "import", label: "Import" },
              ]}
              value={poType}
              onChange={(v) => {
                setDirty(true);
                setPoType(v === "import" ? "import" : "local");
              }}
            />
            {/* THE ROW'S ORDER (user 2026-10-26, screenshot 3728): narrow the sources first —
                Order Type, Buyer — then pick what to buy and from whom — Item Class, Orders, Category,
                Vendor — and the rest only filter the tick list. */}
            <FilterPill
              // "Order Type", not "Type": PO Type (Local / Import) leads the same row.
              label="Order Type"
              family="order"
              icon={LayoutGrid}
              options={KIND_OPTIONS.map((k) => ({ ...k, count: count("kind", k.value) }))}
              anyCount={anyCount("kind")}
              multiple
              value={filters.kind}
              onChange={(v) => setFilter("kind", v)}
            />
            <FilterPill
              label="Buyer"
              family="order"
              icon={User}
              wide
              options={buyerOptions}
              anyCount={anyCount("buyer")}
              multiple
              value={filters.buyer}
              onChange={(v) => setFilter("buyer", v)}
            />
            <FilterPill
              id="rpo-class"
              label="Item Class"
              family="item"
              icon={Layers}
              required
              options={classOptions}
              multiple
              value={classIds}
              /* EVERY CLASS PICKS (user 2026-10-26: "why the remaining item class in disable
                 mode"). Greyed read as broken; the 0 beside a class already says it has nothing
                 pending, and picking it says so again in the list below. */
              zeroPickable
              emptyText="No requirement sheet has anything left to buy"
              onChange={(v) => {
                setDirty(true);
                setClassIds(v);
                const inV = (l: RequirementLine) => !!l.item_class_id && v.includes(l.item_class_id);
                // What no longer has anything of the ticked classes drops off: ticked orders, the
                // vendor (unless it supplies every class still ticked), and the Orders / Category
                // picks. Buyer and Order Type are chosen BEFORE the class, so they carry.
                setOrderIds((prev) => prev.filter((id) => lines.some((l) => l.source_id === id && inV(l))));
                setVendorPick((cur) => (cur && v.length && v.every((c) => (vendorsByClass[c] ?? []).some((x) => x.id === cur)) ? cur : ""));
                setFilters((f) => ({
                  ...f,
                  order: f.order.filter((id) => lines.some((l) => l.source_id === id && inV(l))),
                  // One class or none hides Category (below), so a pick it held is dropped
                  // rather than left filtering out of sight.
                  category: v.length > 1 ? f.category.filter((c) => lines.some((l) => l.category_id === c && inV(l))) : [],
                }));
              }}
            />
            {/* ORDERS (user 2026-10-26: "add the new filter option after the item class Orders
                which will list order number"). The numbers the pills before it leave, nearest
                ship date first — the tick list's own order — and one picked narrows that list
                to it. A ticked order still stays pinned: a filter never takes a line off the PO.
                THE ORDER NUMBER ONLY (user 2026-10-27, screenshot 3741: "no need to show buyer
                … just show order no is enough") — no buyer line, and a sample's "SWO · SIW"
                cut to its SWO, as the tick list beside it already draws it. */}
            <FilterPill
              id="rpo-order"
              label="Orders"
              family="order"
              icon={FileText}
              wide
              disabled={!hasClass}
              options={facts.map((o) => ({ value: o.id, label: o.no.split(" · ")[0], count: count("order", o.id) }))}
              anyCount={anyCount("order")}
              multiple
              value={filters.order}
              emptyText="No order of this class has anything left to buy"
              onChange={(v) => setFilter("order", v)}
            />
            {/* CATEGORY ONLY ACROSS CLASSES (user 2026-10-27): hidden with one Item Class
                ticked — the class already narrows the lines — and shown once two or more
                are, to pick out e.g. Sewing Thread from Woven Label. */}
            {classIds.length > 1 ? (
            <FilterPill
              label="Category"
              family="item"
              icon={Tag}
              disabled={categoryOptions.length === 0}
              options={categoryOptions}
              anyCount={anyCount("category")}
              multiple
              value={filters.category}
              onChange={(v) => setFilter("category", v)}
            />
            ) : null}
            <FilterPill
              id="rpo-vendor"
              label="Vendor"
              family="vendor"
              icon={Store}
              required
              wide
              placeholder="Choose vendor"
              disabled={!hasClass}
              options={classVendors.map((v) => ({
                value: v.id,
                label: v.name,
                sublabel: [
                  v.lead_days == null ? "no lead days set" : `${v.lead_days} d lead`,
                  v.on_time_pct == null ? "no deliveries yet" : `${v.on_time_pct}% on time`,
                ].join(" · "),
              }))}
              value={vendorId}
              emptyText={
                classIds.length > 1
                  ? "No bought-item vendor supplies every class ticked — untick one, or map one in Master Data ▸ Vendors"
                  : "No bought-item vendor for this class — add one in Master Data ▸ Vendors"
              }
              onChange={(v) => {
                setDirty(true);
                setVendorPick(v);
              }}
            />
            <span aria-hidden className="mx-0.5 hidden h-5 w-px shrink-0 bg-[#dde4eb] sm:block" />
            <FilterPill
              label="Order by"
              family="status"
              icon={Clock}
              wide
              disabled={!hasClass}
              note={leadNote}
              tone={filters.orderBy.includes("late") ? "danger" : undefined}
              options={ORDER_BY_BANDS.map((b) => ({ ...b, count: count("orderBy", b.value), tone: b.value === "late" ? "danger" : undefined }))}
              anyCount={anyCount("orderBy")}
              multiple
              value={filters.orderBy}
              onChange={(v) => setFilter("orderBy", v)}
            />
            <FilterPill
              label="Budget"
              family="status"
              icon={Wallet}
              disabled={!hasClass}
              options={BUDGET_STATES.map((b) => ({ ...b, count: count("budget", b.value) }))}
              anyCount={anyCount("budget")}
              multiple
              value={filters.budget}
              onChange={(v) => setFilter("budget", v)}
            />
            <FilterPill
              label="Progress"
              family="status"
              icon={TrendingUp}
              disabled={!hasClass}
              options={PROGRESS_STATES.map((p) => ({ ...p, count: count("progress", p.value) }))}
              anyCount={anyCount("progress")}
              multiple
              value={filters.progress}
              onChange={(v) => setFilter("progress", v)}
            />
          </div>


          {/* ITEMS | COMMERCIAL (user 2026-10-26: "move the commercial as separate tab item |
              commercial"). The lines and the PO's terms were one long page with Commercial
              under the grid; they are two pages of one document, so they take the app's
              document tab strip (components/ui/tabs.tsx). Items counts the lines still
              without a rate — what holds Submit — so the blocker shows from either tab. */}
          {!hasClass ? null : (
            <div className="border-t border-[#dde4eb] px-2 pt-1">
              <Tabs
                defaultKey="items"
                items={[
                  {
                    key: "items",
                    label: "Items",
                    problems: vendorId ? unpriced : 0,
                    content: (
                      <div className="-mx-2 -mt-4 md:grid md:grid-cols-[12.5rem_minmax(0,1fr)]">
                        {/* THE TICK LIST — the orders of this class with a balance, ticked ones pinned
                            on top whatever the filters say (they narrow the list, never the PO). */}
                        <nav
                          aria-label="RE / SWO / IWO / HO numbers"
                          className="border-b border-[#dde4eb] bg-[#fafbfc] md:border-r md:border-b-0"
                        >
                          {/* THE COUNT AND CLEAR FILTERS HEAD THE LIST THEY COUNT — at the end of the
                              filter row they pushed it onto a second line (screenshot 3717). */}
                          {/* COMPACT (user 2026-10-26: "now compact the side rail"): the rail holds a tick
                              and a number, so it is 12.5rem and its head says "Orders 11 · 1 ✓". */}
                          <div
                            className="flex h-8 items-center gap-1.5 border-b border-[#dde4eb] bg-white px-2.5 text-xs whitespace-nowrap text-muted-foreground"
                            title={`RE / SWO / IWO / HO numbers — ${shown} shown${orderIds.length ? `, ${orderIds.length} ticked` : ""}`}
                          >
                            <span className="font-semibold text-foreground">Orders</span>
                            <span className="tabular-nums">
                              {shown}
                              {orderIds.length ? ` · ${orderIds.length} ✓` : ""}
                            </span>
                            {anyFilter ? (
                              <button
                                type="button"
                                onClick={() => setFilters(NO_FILTERS)}
                                className="ml-auto font-semibold text-[#037bb8] hover:underline"
                              >
                                Clear
                              </button>
                            ) : null}
                          </div>
                          {visible.ticked.length ? (
                            <>
                              {sectionLabel("On this PO")}
                              {visible.ticked.map(orderRow)}
                              {/* ITEM-WISE: the same purchase across every ticked order is ONE line to
                                  the vendor — offered once two orders are ticked. */}
                              {showItems ? (
                                <button
                                  type="button"
                                  aria-current={selKey === "items" || undefined}
                                  onClick={() => setActiveKey("items")}
                                  className={cn(
                                    "flex h-8 w-full items-center gap-1.5 border-b border-[#dde4eb] px-2.5 text-left hover:bg-[#eef4f9]",
                                    selKey === "items" && "bg-[#eef6fc] shadow-[inset_3px_0_0_#037bb8]",
                                  )}
                                >
                                  <Boxes aria-hidden className="size-4 text-muted-foreground" />
                                  <span className="flex-1 text-xs font-bold">All items together</span>
                                  {itemsToPrice > 0 ? (
                                    <span className="rounded-full bg-danger-soft px-1.5 text-[11px] font-semibold tabular-nums text-danger">{itemsToPrice}</span>
                                  ) : null}
                                </button>
                              ) : null}
                              {visible.rest.length ? sectionLabel("More orders") : null}
                            </>
                          ) : null}
                          {visible.rest.map(orderRow)}
                          {shown === 0 ? (
                            <div className="px-3 py-4 text-sm text-muted-foreground">
                              {facts.length === 0 ? (
                                "No order has anything of this item class left to buy."
                              ) : (
                                <>
                                  No order matches.{" "}
                                  <button type="button" onClick={() => setFilters(NO_FILTERS)} className="font-semibold text-[#037bb8] hover:underline">
                                    Clear filters
                                  </button>
                                </>
                              )}
                            </div>
                          ) : null}
                        </nav>
                        <div className="min-w-0 p-2">
                          {selKey === "items" ? (
                            <div className="space-y-2">
                              {/* default-row: exempt -- one row per item across the ticked orders, derived; nothing is added here */}
                              <ChildGrid<ItemGroup>
                                columns={itemColumns}
                                rows={itemGroups}
                                flatRows
                                hideAdd
                                hideRemove
                                keepOne={false}
                                onAdd={() => false}
                                onRemove={() => {}}
                                frameless
                                headerClassName={GRID_HEAD}
                              />
                              {openItem ? (
                                <div className="border-l-2 border-[#037bb8] pl-3">
                                  <div className="mb-1 text-[11.5px] font-semibold text-muted-foreground">
                                    {openItem.item_name}
                                    {openItem.spec ? ` · ${openItem.spec}` : ""} — {openItem.orders} order{openItem.orders === 1 ? "" : "s"}
                                  </div>
                                  {/* default-row: exempt -- the item's order lines, derived; nothing is added here */}
                                  <ChildGrid<GridRow>
                                    columns={breakupColumns}
                                    rows={openItem.members.filter((m) => !m.row.skip)}
                                    flatRows
                                    hideAdd
                                    hideRemove
                                    keepOne={false}
                                    onAdd={() => false}
                                    onRemove={() => {}}
                                    frameless
                                    headerClassName={GRID_HEAD}
                                  />
                                  {skippedStrip(
                                    openItem.members
                                      .filter((m) => m.row.skip)
                                      .map((m) => ({ key: m.key, label: `${m.source_no.split(" · ")[0]}${m.size_name ? ` · ${m.size_name}` : ""}`, members: [m] })),
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ) : activeGroup ? (
                            rePane(activeGroup)
                          ) : orderIds.length && gridRows.length === 0 ? (
                            <p className="p-6 text-sm text-muted-foreground">
                              {filters.category.length ? "Nothing of this category left to buy on the ticked orders." : "Nothing left to buy on the ticked orders."}
                            </p>
                          ) : (
                            <p className="grid h-full min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">
                              Tick orders on the left. Their lines list here with the balance filled in; only the rate is typed.
                            </p>
                          )}
                        </div>
                      </div>
                    ),
                  },
                  {
                    key: "commercial",
                    label: "Commercial",
                    content: (
                      <div className="-mx-2">
                      <CommercialSection
                        value={commercial}
                        onChange={(v) => {
                          setDirty(true);
                          setCommercial(v);
                        }}
                        currency={cur}
                        gst={gst}
                        gstOptions={GST_SLABS.map((g) => ({ value: g.id, label: g.label }))}
                        onGst={(v) => {
                          setDirty(true);
                          setGst(v);
                        }}
                        terms={paymentTerms}
                        onTerms={(v) => {
                          setDirty(true);
                          setPaymentTerms(v);
                        }}
                      />
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          )}


      {/* SHOW LAST PO — read-only, so `sm` with no footer: there is nothing to save. The newest
          purchase leads in its own box (the benchmark); the two before it sit under it, so a
          rate that has crept up is visible at a glance. The budget rate is never here. */}
      <Sheet
        open={!!lastPo}
        onClose={() => setLastPo(null)}
        size="sm"
        alignToPane
        origin={lastPo?.origin ?? null}
        title={lastPo ? `Last PO — ${lastPo.title}` : "Last PO"}
      >
        {!lastPo ? null : lastPo.rows === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Looking up earlier POs…</p>
        ) : lastPo.error ? (
          <p className="rounded-md border border-[#f5b8b0] bg-[#fdecea] px-3 py-2 text-sm text-[#b42318]">{lastPo.error}</p>
        ) : lastPo.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">This item has not been bought on a PO yet.</p>
        ) : (
          <div className="space-y-3">
            {(() => {
              const p = lastPo.rows[0];
              return (
                <div className="rounded-lg border border-[#b9d6ea] bg-[#f2f8fc] p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Last purchase rate</span>
                    <StatusPill tone={statusTone(p.status)}>{p.status.replace(/_/g, " ")}</StatusPill>
                  </div>
                  <div className="mt-0.5 text-2xl font-bold tabular-nums text-[#035c8c]">
                    {rateText(p)}
                    {p.uom ? <span className="ml-1 text-sm font-medium text-muted-foreground">/ {p.uom}</span> : null}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Vendor</dt>
                      <dd className="font-medium">{p.vendor ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">PO No · date</dt>
                      <dd className="font-mono text-[13px] tabular-nums">
                        {p.code ?? "—"} · {p.orderDate ? fmtDate(p.orderDate) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Quantity</dt>
                      <dd className="tabular-nums">
                        {fmtNumber(p.qty)} {p.uom ?? ""}
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })()}
            {lastPo.rows.length > 1 ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Before that</div>
                <ul className="divide-y divide-[#e8edf2] rounded-md border border-[#dde4eb] text-sm">
                  {lastPo.rows.slice(1).map((p) => (
                    <li key={p.poId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-1.5">
                      <span className="min-w-0">
                        <Truncated className="font-medium">{p.vendor ?? "—"}</Truncated>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {p.code ?? "—"} · {p.orderDate ? fmtDate(p.orderDate) : "—"} · {fmtNumber(p.qty)} {p.uom ?? ""}
                        </span>
                      </span>
                      <span className="self-center font-semibold tabular-nums">{rateText(p)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Sheet>

      {/* YARN BAGS / FABRIC ROLLS POP-UP — a sub-detail with no grid, so `sm` (AGENTS, A
          sub-detail Sheet's size), centred on the pane, grown from the Qty cell, no Save of
          its own: the bags, rolls and dia are written by the PO's Save. */}
      <Sheet
        open={!!qtySheetRow}
        onClose={() => setQtySheet(null)}
        size="sm"
        alignToPane
        origin={qtySheet?.origin ?? null}
        title={
          qtySheetRow
            ? `${lineKindOf(qtySheetRow.item_class) === "yarn" ? "Yarn bags" : "Fabric rolls"} — ${qtySheetRow.item_name}`
            : "Quantity"
        }
        footer={<SubSheetFooter onDone={() => setQtySheet(null)} />}
      >
        {qtySheetRow
          ? (() => {
              const r = qtySheetRow;
              const kind = lineKindOf(r.item_class);
              const inBags = bagsOf(r);
              const over = overBy(r);
              const bw = num(r.row.bagWt ?? "");
              return (
                <div className="space-y-4">
                  {/* What it is typed against — read, never typed. */}
                  <dl className="grid grid-cols-2 gap-3 rounded-md border border-[#dde4eb] bg-[#fafbfc] px-3 py-2 text-sm tabular-nums">
                    <div>
                      <dt className="text-xs text-muted-foreground">{QTY.required}</dt>
                      <dd className="font-semibold">
                        {fmtNumber(r.required_qty)} {r.uom_code ?? ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{QTY.toOrder}</dt>
                      <dd className="font-semibold">
                        {fmtNumber(r.balance_qty)} {r.uom_code ?? ""}
                      </dd>
                    </div>
                  </dl>
                  {kind === "yarn" ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Bag weight (kg)" htmlFor={`rpo-bw-${r.key}`}>
                          <Input
                            id={`rpo-bw-${r.key}`}
                            type="number"
                            min={0}
                            inputMode="decimal"
                            value={r.row.bagWt ?? ""}
                            onChange={(e) => setBags(r, r.row.bags ?? "", e.target.value)}
                          />
                        </Field>
                        <Field label="No. of bags" htmlFor={`rpo-bags-${r.key}`}>
                          <Input
                            id={`rpo-bags-${r.key}`}
                            type="number"
                            min={0}
                            step={1}
                            max={bw > 0 ? maxBags(r.balance_qty, bw) : undefined}
                            inputMode="numeric"
                            disabled={!(bw > 0)}
                            title={bw > 0 ? `At most ${maxBags(r.balance_qty, bw)} — one bag past To Order is the limit` : "Type the bag weight first"}
                            value={r.row.bags ?? ""}
                            onChange={(e) => setBags(r, e.target.value, r.row.bagWt ?? "")}
                          />
                        </Field>
                      </div>
                      <div className="flex items-baseline justify-between rounded-md border border-[#dde4eb] px-3 py-2">
                        <span className="text-sm text-muted-foreground">PO weight = bags × bag weight</span>
                        {inBags ? (
                          <span className={cn("text-base font-bold tabular-nums", over > 0 && "text-[#8a5800]")}>
                            {num(r.row.qty)} kg
                          </span>
                        ) : (
                          // No bags yet: the weight is typed as on any line (capped at To Order).
                          <div className="flex w-36 items-center gap-1">{qtyInput(r, `rpo-yqty-${r.key}`)}</div>
                        )}
                      </div>
                      {over > 0 ? (
                        <p className="rounded-md border border-[#f1d48a] bg-[#fff7e0] px-3 py-1.5 text-sm text-[#8a5800]">
                          {over} kg over To Order — whole bags. Allowed up to one bag.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="PO weight (kg)" htmlFor={`rpo-fqty-${r.key}`}>
                        <div className="flex items-center rounded-md border border-border">{qtyInput(r, `rpo-fqty-${r.key}`)}</div>
                      </Field>
                      <Field label="No. of rolls" htmlFor={`rpo-rolls-${r.key}`}>
                        <Input
                          id={`rpo-rolls-${r.key}`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={r.row.rolls ?? ""}
                          onChange={(e) => setRow(r, { rolls: e.target.value })}
                        />
                      </Field>
                      <Field label="Dia" htmlFor={`rpo-dia-${r.key}`}>
                        <Input
                          id={`rpo-dia-${r.key}`}
                          maxLength={20}
                          value={r.row.dia ?? ""}
                          onChange={(e) => setRow(r, { dia: e.target.value })}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              );
            })()
          : null}
      </Sheet>

      {/* THE SIZE BREAKUP POP-UP — a sub-detail of the open PO (AGENTS, A sub-detail Sheet's
          size): `md` because it carries a ChildGrid, centred on the pane, grown out of the
          Qty button, and no Save of its own — the sizes are written by the PO's Save. */}
      {/* AS WIDE AS ITS TABLE (user 2026-10-27, screenshots 3745 · 3746: "blank space …
          compact it", then "still some gap on right side"). The table is # 40 + Size 88 +
          Required 112 + To Order 112 + Order PO 176 = 528px; the card is 528 + px-5 (40) +
          border (2) + 2 spare = 572px. It cannot go narrower: under a 512px container
          ChildGrid drops the table for header-less cards — which is why the columns grew
          to meet the card rather than the card shrinking to the old 480px table. */}
      <Sheet
        open={!!sheetGroup}
        onClose={() => setSizeSheet(null)}
        size="md"
        maxWidthClass="max-w-[572px]"
        alignToPane
        origin={sizeSheet?.origin ?? null}
        title={sheetGroup ? `Size breakup — ${sheetGroup.first.item_name}${describeGroup(sheetGroup) ? ` · ${describeGroup(sheetGroup)}` : ""}` : "Size breakup"}
        footer={<SubSheetFooter onDone={() => setSizeSheet(null)} />}
      >
        {sheetGroup ? (
          <div className="space-y-2">
            {/* default-row: exempt -- one row per size of the item, derived from the requirement; nothing is added here */}
            <ChildGrid<GridRow>
              columns={sizeColumns}
              rows={sheetGroup.members}
              flatRows
              hideAdd
              hideRemove
              keepOne={false}
              onAdd={() => false}
              onRemove={() => {}}
              frameless
              headerClassName={GRID_HEAD}
            />
            <p className="px-2 text-sm text-muted-foreground">
              Total on this PO:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {fmtNumber(groupQty(sheetGroup))} {sheetGroup.first.uom_code ?? ""}
              </span>{" "}
              of {fmtNumber(sheetGroup.members.reduce((a, m) => a + m.balance_qty, 0))} to order
            </p>
          </div>
        ) : null}
      </Sheet>

      {/* THE BOTTOM BAR (V6): the total, why Submit waits, a way to the next blank rate,
          and the buttons — kept in view while the lines scroll.
          ON THE BOTTOM EDGE, NOT ABOVE IT (user 2026-10-24, screenshot 3713: "floating").
          A sticky box stops at its scroll container's PADDING edge, and `<main>` has
          `md:pb-6` — so `bottom-0` hung 24px up with lines scrolling through the gap.
          `md:-bottom-6` cancels exactly that padding. Phone keeps `bottom-0`: there the
          padding is the bottom tab bar's room, and the bar must sit above it. */}
      <div
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-xl border-t border-[#dde4eb] bg-[#fafbfc] px-4 py-2.5 md:-bottom-6"
        data-focus-region="footer"
      >
        {/* THE FIGURES ON ONE LINE: each label muted, its value beside it, parted by
            hairlines; the Total last and set apart in its own tinted box. */}
        <dl className="flex items-center gap-3 text-[13px] whitespace-nowrap tabular-nums">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Taxable</dt>
            <dd className="font-semibold">
              {cur} {fmtFixed(totals.taxable, 2)}
            </dd>
          </div>
          <span aria-hidden className="h-4 w-px bg-[#dde4eb]" />
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">{slab.kind === "igst" ? "IGST" : "CGST + SGST"}</dt>
            <dd className="font-semibold">
              {cur} {fmtFixed(totals.gst, 2)}
            </dd>
          </div>
          {charges !== 0 ? (
            <>
              <span aria-hidden className="h-4 w-px bg-[#dde4eb]" />
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground">Charges</dt>
                <dd className="font-semibold">
                  {cur} {fmtFixed(charges, 2)}
                </dd>
              </div>
            </>
          ) : null}
          <div className="flex h-8 items-baseline gap-2 rounded-control border border-[#b9dcf0] bg-[#e8f3fb] px-3 leading-8 text-[#035c8c]">
            <dt className="text-xs font-semibold tracking-wide uppercase">Total</dt>
            <dd className="text-[15px] font-bold">
              {cur} {fmtFixed(totals.total + charges, 2)}
            </dd>
          </div>
        </dl>
        <div className="flex min-w-0 flex-1">
          <span
            role="status"
            className={cn("inline-flex h-8 max-w-full min-w-0 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold", HINT_CHIP.box)}
          >
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", HINT_CHIP.dot)} />
            <Truncated className="min-w-0">{hint}</Truncated>
          </span>
        </div>
        {/* WHY ABOVE BUDGET — MANDATORY (user 2026-10-27, escalation spec: "prompts them to
            enter a mandatory remark/reason"). The three reasons a rate outruns its budget, or
            OTHER with the Purchase Manager's own words; Submit to MD stays shut until given.
            Carried on the PO to the MD's review screen and alert. */}
        {goesToMd && !isPending ? (
          <>
            <Select
              id="rpo-budget-reason"
              aria-label="Reason above budget"
              className="w-56"
              required
              value={reasonPick}
              onChange={(e) => {
                setReasonPick(e.target.value);
                setDirty(true);
              }}
            >
              <option value="">Reason above budget *</option>
              {BUDGET_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value="OTHER">OTHER (TYPE IT)</option>
            </Select>
            {reasonPick === "OTHER" ? (
              <Input
                aria-label="Reason above budget, in your words"
                placeholder="Type the reason"
                className="h-9 w-56"
                required
                maxLength={300}
                value={reasonText}
                onChange={(e) => {
                  setReasonText(e.target.value);
                  setDirty(true);
                }}
              />
            ) : null}
          </>
        ) : null}
        {unpriced > 0 && groups.some((g) => g.toPrice.length > 0) ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const g = groups.find((x) => x.toPrice.length > 0);
              if (g) openRe(g);
            }}
          >
            Go to next blank rate
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={() => (onCancel ? onCancel() : router.push("/purchase/orders"))}>
          Cancel
        </Button>
        <Button type="button" variant="outline" disabled={!canSave} onClick={() => save("draft")}>
          Save draft
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={() => save("submit")}>
          {goesToMd ? "Submit to MD" : "Submit"}
        </Button>
      </div>
      </div>
    </div>
  );
}
