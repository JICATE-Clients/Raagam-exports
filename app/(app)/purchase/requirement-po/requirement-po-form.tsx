"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Ban, Boxes, Check, ChevronRight, Clock, FileText, History, Layers, LayoutGrid, Lock, Package, Ruler, Store, Tag, TrendingUp, Truck, Undo2, User, Wallet, X } from "lucide-react";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FIELD_WIDTH_CSS } from "@/components/ui/field";
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
import { useFormDraft } from "@/lib/use-form-draft";
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
  gstKindFor,
  slabOfKind,
  budgetWords,
  capQty,
  gstSlab,
  lineDescription,
  lineKeyOf,
  lineKindOf,
  bomDiaOf,
  maxBags,
  withNote,
  poTotals,
  budgetRateOf,
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
 * `FilterPill`s — PO Type · Order Type · Buyer · Orders · Item Class · Category · Vendor │
 * Order by · Budget · Progress (reordered 2026-10-28: the dependent chain Buyer → RE /
 * Order Numbers → Item Class → Category → Vendor, each narrowed only by the pills before
 * it) — and under it the orders as a TICK LIST, which replaced the
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
 * - Submit: every PO waits for approval (0765) — all within → the item class's
 *   approver (Approvals ▸ Flows); anything above (or unbudgeted) → MD.
 *   `savePoFromRequirement` decides that again from the database.
 */

/** `note` — the item-level instruction to the vendor (0755), appended to the line's description on save. */
type RowState = {
  qty: string;
  rate: string;
  date: string;
  skip?: boolean;
  note?: string;
  /** Why this line goes to the MD (2026-10-28, picked on the line): a preset, or "OTHER:<words>". */
  reason?: string;
  /** own GST % (0756); unset = the header's */
  gst?: number;
  /** Yarn (0758): whole bags and the kg in one — qty is their product. */
  bags?: string;
  bagWt?: string;
  /** Fabric (0758): rolls — typed. Dia and GSM are the plan's (2026-10-30). */
  rolls?: string;
  /** Fabric: Gauge and Loop length — typed here, PO-only (2026-10-30). Unset = the BOM's old value. */
  gauge?: string;
  /** Fabric: Ply, its own field since 0774 (2026-10-31). */
  ply?: string;
  /** LL (cm) — free text since 0774: a figure, a range or a note. */
  loopLength?: string;
};

/**
 * THE GRID HEADER IN THE ORDERS TABLE BAND (user 2026-10-23, screenshot 3697): the
 * soft blue `--table-head-bg` every `DataTable` header wears, labels on ONE line.
 * `ChildGrid`'s own header is white and wraps a label that is wider than its column
 * ("ORDER / QTY" on two lines), so both are set here through `headerClassName`.
 */
const GRID_HEAD = "whitespace-nowrap bg-[var(--table-head-bg)]";
/**
 * DENSE, ONE SIZE WITH THE RAIL (user 2026-10-30, plan B, mockup "Raise PO column widths"):
 * the PO grids read 12px — the rail's RE number is 12px — with 11px headers, so the item
 * name gets the width to show in full. One wrapper on the grid pane rather than a size on
 * every cell. The typed boxes take their 12px from `CELL_INPUT` (which out-merges the
 * `Input` primitive's `md:text-sm`). This screen only — not the app-wide type scale.
 */
const DENSE = "[&_td]:text-xs [&_.text-sm]:text-xs [&_th]:text-[11px]";
/**
 * A CELL YOU TYPE IN, NOT A BOX IN A CELL (user 2026-10-24, screenshot 3707: "that
 * separate cell border for the rate, qty, delivery date — as table"). The grid's own
 * gridlines are the only frame: the input drops its border, corners and ground, and
 * the cell it is in shows focus by an inset ring and a white fill — a sheet, not a
 * form laid in a table. Hover tints the cell so it still reads as editable.
 */
const CELL_INPUT =
  "h-8 text-xs md:text-xs rounded-none border-0 bg-transparent shadow-none hover:bg-[#f2f7fb] focus:bg-white focus-visible:ring-2 focus-visible:ring-inset";
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
/** On the Budget control's hover — the one comparison, said once (2026-10-31: budgets include GST). */
const GST_RULE =
  "Each line's rate plus its GST is compared with the approved budget rate, which includes GST. Printing stays locked until the MD approves.";
/** A line with NO approved budget is not "above" anything — it has its own reasons (2026-10-28). */
const NO_BUDGET_REASONS = ["ITEM NOT IN APPROVED BUDGET"] as const;

export function RequirementPoForm({
  lines,
  vendorsByClass,
  nextPoNo,
  budgetedKeys = [],
  draftHolds = [],
  itemClasses = [],
  gstPlaces,
  initialOrderId = null,
  seed,
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
  /** GST state codes ("33") of the current unit and of each vendor (`getGstPlaces`) — picks
   *  CGST + SGST vs IGST when a vendor is chosen. Absent → the slab is never changed for you. */
  gstPlaces?: { unit: string | null; vendors: Record<string, string>; names: Record<string, string> };
  /** Opened from a Pending row: that order is already chosen, under its first item class. */
  initialOrderId?: string | null;
  /** WHAT THE LIST'S FILTER ROW HAD PICKED (user 2026-10-31, screenshot 3927): the
   *  orders, item classes, Order Type, Buyer and Category chosen above the Pending list
   *  carry into the editor, so the operator never picks them twice. Wins over
   *  `initialOrderId`'s "first class" guess where both are given. */
  seed?: { orderIds?: string[]; classIds?: string[]; filters?: Partial<FilterState> };
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
    // AN RE OPENS ON ALL ITS CLASSES (user 2026-10-31, screenshot 3939, option 1): no
    // "first class" guess — clicking an RE shows everything it still needs to buy.
    return seed?.classIds?.length ? seed.classIds : [];
  });
  /** A class TICKED on the pill. None ticked = All (2026-10-31); `effClassIds` is what applies. */
  const hasClass = classIds.length > 0;
  /** The TICKED orders — what this PO carries, in the order they were ticked. */
  const [orderIds, setOrderIds] = useState<string[]>(() =>
    seed?.orderIds?.length ? seed.orderIds : initialOrderId ? [initialOrderId] : [],
  );
  const [filters, setFilters] = useState<FilterState>(() => ({ ...NO_FILTERS, ...seed?.filters }));
  const [vendorPick, setVendorPick] = useState("");
  const [poType, setPoType] = useState<"local" | "import">("local");
  const [currency, setCurrency] = useState<string>("USD");
  const [exRate, setExRate] = useState("");
  const [gst, setGst] = useState<string>("c12");
  const [paymentTerms, setPaymentTerms] = useState("30 DAYS FROM GRN");
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

  /* AUTOSAVE, NO "SAVE DRAFT" BUTTON (user 2026-10-29: "we will save automatically …
     then why that save draft button — remove it"). Everything typed is kept in this
     browser as it is typed (useFormDraft, ~1 s after the last key) and offered back on
     the next visit by the Restore / Discard notice above the title. Kept LOCAL on
     purpose: a server draft was a real PO — every press took a PO number and the lines'
     balance — so autosaving that way would raise a new PO each pause in typing. Cleared
     on Submit and on Cancel. */
  const draft = useFormDraft({
    storageKey: `purchase:raise-po:${initialOrderId ?? "new"}`,
    enabled: true,
    value: { classIds, orderIds, vendorPick, poType, currency, exRate, gst, paymentTerms, commercial, rows, flags },
    onRestore: (v) => {
      setClassIds(v.classIds);
      setOrderIds(v.orderIds);
      setVendorPick(v.vendorPick);
      setPoType(v.poType);
      setCurrency(v.currency);
      setExRate(v.exRate);
      setGst(v.gst);
      setPaymentTerms(v.paymentTerms);
      setCommercial(v.commercial);
      setRows(v.rows);
      setFlags(v.flags);
      setActiveKey(v.orderIds[0] ?? "");
      setDirty(true);
    },
  });

  const budgeted = useMemo(() => new Set(budgetedKeys), [budgetedKeys]);

  // ---------- Item Class and Vendor: the two required pills ----------
  /* EVERY CLASS IS LISTED (user 2026-10-26: "only listing two"). Each counts the orders
     with a balance in it; a class at 0 is greyed by FilterPill — shown, not pickable
     into an empty PO. Classes only the requirement lines know (no master row) still list.
     ONCE AN RE IS CHOSEN, ONLY ITS CLASSES (user 2026-10-30, screenshot 3861): an RE
     picked on the Orders pill or ticked on the left lists just the classes its approved
     requirement lines carry — an RE with only Yarn and Trims never offers Fabric. A class
     already ticked survives (Disabled rows: the value held is never dropped from view). */
  const classOptions: FilterPillOption[] = useMemo(() => {
    const chosen = new Set([...filters.order, ...orderIds]);
    const byClass = new Map<string, { label: string; orders: Set<string> }>(
      itemClasses.map((c) => [c.id, { label: c.name, orders: new Set<string>() }]),
    );
    for (const l of lines) {
      if (!l.item_class_id) continue;
      /* ORDER TYPE AND BUYER COME FIRST (user 2026-10-26, screenshot 3728), so a class
         counts only the orders those two leave — "SWO" then reads each class's SWOs. */
      if (filters.kind.length && !filters.kind.includes(l.source_kind)) continue;
      if (filters.buyer.length && !filters.buyer.includes(l.source_kind === "re" ? (l.customer ?? NO_BUYER) : NO_BUYER)) continue;
      // …and the RE / order numbers, which now stand before Item Class (2026-10-28).
      if (chosen.size && !chosen.has(l.source_id)) continue;
      const c = byClass.get(l.item_class_id) ?? { label: l.item_class ?? "—", orders: new Set<string>() };
      c.orders.add(l.source_id);
      byClass.set(l.item_class_id, c);
    }
    // The classes with something to buy first, so the greyed ones never push them down.
    return [...byClass.entries()]
      .filter(([id, c]) => !chosen.size || c.orders.size > 0 || classIds.includes(id))
      .sort((a, b) => Number(b[1].orders.size > 0) - Number(a[1].orders.size > 0) || a[1].label.localeCompare(b[1].label))
      .map(([value, c]) => ({ value, label: c.label, count: c.orders.size }));
  }, [lines, itemClasses, filters.kind, filters.buyer, filters.order, orderIds, classIds]);
  /* ITEM CLASS IS OPTIONAL — "ALL" UNTIL NARROWED (user 2026-10-31, option 1). Nothing ticked
     reads as every class the pills before it leave (the chosen orders' classes, once an RE
     is picked), so an RE's whole requirement lists at once, grouped by class. Picking a
     VENDOR narrows it to the classes that vendor supplies (its onChange ticks them), which
     is what keeps one PO to what one vendor can supply. */
  const effClassIds = useMemo(
    () => (classIds.length ? classIds : classOptions.filter((o) => (o.count ?? 0) > 0).map((o) => o.value)),
    [classIds, classOptions],
  );
  const anyClass = effClassIds.length > 0;
  const classLines = useMemo(() => lines.filter((l) => !!l.item_class_id && effClassIds.includes(l.item_class_id)), [lines, effClassIds]);
  /* NO CATEGORY FOR YARN (user 2026-10-30): a yarn has no sub-category in the master, so
     with only Yarn ticked the Category pill is hidden and its picks cleared. Yarn beside
     Trims keeps it — the trims still have categories to narrow by. */
  const yarnOnly = (ids: string[]) =>
    ids.length > 0 && ids.every((id) => lineKindOf(classOptions.find((o) => o.value === id)?.label) === "yarn");
  /* Before a class is picked the filters read EVERY line, so Order Type and Buyer —
     which lead the row — have something to count. The tick list waits for a class. */
  const scopeLines = anyClass ? classLines : lines;

  /* THE VENDOR IS CHOSEN, NEVER ASSUMED (V7 point 5). Best on-time first, so the
     reliable vendor is the one at the top — with its lead days beside it, because a
     slow vendor on an urgent order is a mistake you can only avoid if you see it.
     SEVERAL CLASSES → ONLY THE VENDORS MAPPED TO ALL OF THEM: one PO is one vendor, and the
     save refuses a vendor missing any class on it. */
  const classVendors = useMemo(() => {
    // UNDER ALL (2026-10-31): every vendor of ANY class listed — picking one then ticks the
    // classes it supplies. Ticked classes keep the old rule: vendors of ALL of them.
    const pool = hasClass
      ? (vendorsByClass[classIds[0]] ?? []).filter((v) => classIds.slice(1).every((c) => (vendorsByClass[c] ?? []).some((x) => x.id === v.id)))
      : [...new Map(effClassIds.flatMap((c) => vendorsByClass[c] ?? []).map((v) => [v.id, v] as const)).values()];
    return pool
      // LOCAL / IMPORT SCOPES THE LIST (0773, user 2026-10-31): Import lists only vendors
      // outside India, Local only the Indian ones (and any with no country recorded).
      .filter((v) => v.is_import === (poType === "import"))
      .sort((a, b) => (b.on_time_pct ?? -1) - (a.on_time_pct ?? -1) || a.name.localeCompare(b.name));
  }, [vendorsByClass, classIds, effClassIds, hasClass, poType]);
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

  /* TOP-DOWN (user 2026-10-28): Buyer → Orders → Item Class → Category → Vendor. Each
     pill lists only what the pills BEFORE it leave; the ones after never narrow it. */
  const upstreamOrderIds = new Set(
    facts.filter((o) => (!filters.kind.length || filters.kind.includes(o.kind)) && (!filters.buyer.length || filters.buyer.includes(o.buyer ?? NO_BUYER))).map((o) => o.id),
  );
  const orderOptions: FilterPillOption[] = facts
    .filter((o) => upstreamOrderIds.has(o.id) || filters.order.includes(o.id))
    .map((o) => ({ value: o.id, label: o.no.split(" · ")[0], count: count("order", o.id) }));
  const upstreamLines = scopeLines.filter(
    (l) => upstreamOrderIds.has(l.source_id) && (!filters.order.length || filters.order.includes(l.source_id)),
  );
  const categoryOptions: FilterPillOption[] = (() => {
    // THE CATEGORY NAME ONLY (user 2026-10-27, screenshot 3767: "just show category").
    // The class comes back on a name two ticked classes share — COTTON is a Yarn and a
    // Fabric — so two identical choices never sit side by side (Cascading filters).
    // EVERY ITEM CLASS (user 2026-10-28): shown with one class ticked too, and narrowed
    // by everything above it — Buyer, Orders, Item Class — never the full list.
    const byCat = new Map<string, { name: string; cls: string }>();
    for (const l of upstreamLines) if (l.category_id) byCat.set(l.category_id, { name: l.category ?? "—", cls: l.item_class ?? "—" });
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

  /* A PICK ABOVE DROPS WHAT IT NO LONGER REACHES BELOW — and only that (Cascading
     filters): narrowing Buyer around an order still of that buyer keeps it. */
  const buyerOf = (l: RequirementLine) => (l.source_kind === "re" ? (l.customer ?? NO_BUYER) : NO_BUYER);
  function setUpstream(k: "kind" | "buyer" | "order", v: string[]) {
    setFilters((f) => {
      const next = { ...f, [k]: v } as FilterState;
      const reach = lines.filter(
        (l) =>
          (!next.kind.length || next.kind.includes(l.source_kind)) &&
          (!next.buyer.length || next.buyer.includes(buyerOf(l))),
      );
      next.order = next.order.filter((id) => reach.some((l) => l.source_id === id));
      const below = reach.filter((l) => !next.order.length || next.order.includes(l.source_id));
      next.category = next.category.filter((c) => below.some((l) => l.category_id === c));
      return next;
    });
  }

  /** Tick or untick an order. Ticking also opens it on the right. */
  function toggleOrder(id: string) {
    setDirty(true);
    setOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    if (!orderIds.includes(id)) setActiveKey(id);
  }

  const chosen = new Set(orderIds);
  const inClassOrders = classLines.filter((l) => chosen.has(l.source_id));
  // Category narrows the LINES of a ticked order too — the filter means "buy only these".
  // A hidden pill never narrows: with Yarn alone the Category picks are ignored.
  const inOrders = filters.category.length && !yarnOnly(classIds)
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
    // Grouped by class, then by name — several classes list Yarn together, Trims together.
    .sort((a, b) => (a.item_class ?? "").localeCompare(b.item_class ?? "") || a.item_name.localeCompare(b.item_name))
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
  /* WHY THE SLAB IS CGST + SGST OR IGST, said under the GST box (2026-10-31). */
  const vendorState = vendorId ? (gstPlaces?.vendors[vendorId] ?? null) : null;
  const autoKind = poType === "local" ? gstKindFor(vendorState, gstPlaces?.unit) : null;
  const stateName = (c: string | null | undefined) => (c ? (gstPlaces?.names[c] ?? c) : "");
  const gstHint = !vendorId
    ? "Set from the vendor's state once a vendor is chosen."
    : !autoKind
      ? poType === "local"
        ? "The vendor's or the unit's state is not recorded — choose CGST + SGST or IGST."
        : null
      : autoKind !== slab.kind
        ? `Changed by hand — the vendor's state says ${autoKind === "igst" ? "IGST" : "CGST + SGST"}.`
        : autoKind === "igst"
          ? `Vendor in ${stateName(vendorState)}, unit in ${stateName(gstPlaces?.unit)} — IGST.`
          : `Vendor and unit both in ${stateName(vendorState)} — CGST + SGST.`;
  const totals = poTotals(active.map((r) => ({ qty: num(r.row.qty), rate: num(r.row.rate), gstPct: r.row.gst })), slab.pct);
  // `rate > 0` as on the line below: a rate typed above budget and then cleared keeps its old flag.
  /* THE BUDGET IS ASKED BEFORE THE VENDOR IS CHOSEN (user 2026-10-28, screenshot 3784: a rate
     typed, no vendor yet, no signal). The answer needs only the rate, its GST and the order —
     so, as `toPrice` counts below, every line being ordered counts until a vendor narrows it. */
  const budgetLines = gridRows.filter((r) => (!vendorId || r.supplied) && !r.row.skip && num(r.row.qty) > 0);
  const above = budgetLines.filter((r) => num(r.row.rate) > 0 && flags[r.key]?.above).length;
  const unbudgeted = budgetLines.filter((r) => num(r.row.rate) > 0 && flags[r.key] && !flags[r.key].hasBudget).length;
  const goesToMd = above + unbudgeted > 0;

  /* THE BUDGET SIGNAL, ON THE LINE (user 2026-10-28, screenshot 3785: "no need TO MD and the
     item name again … near the skip option show the status and reason inline … no need that
     bottom style"). Every priced line says Within · Above · No budget in its Budget cell,
     beside Skip, and a line that sends the PO to the MD takes its reason in that same box.
     The figure never shows (spec point 7): only the state does. */
  type BudgetMark = "above" | "none" | "within";
  /** The worst state among priced lines on this PO; null while nothing here is priced. */
  const budgetMarkOf = (rs: readonly GridRow[]): BudgetMark | null => {
    const priced = rs.filter((m) => !m.row.skip && num(m.row.qty) > 0 && num(m.row.rate) > 0 && flags[m.key]);
    if (priced.length === 0) return null;
    if (priced.some((m) => flags[m.key].above)) return "above";
    if (priced.some((m) => !flags[m.key].hasBudget)) return "none";
    return "within";
  };
  // Fixed colour pairs, as HINT_CHIP below: the skin cannot repaint them.
  const BUDGET_MARK: Record<BudgetMark, { dot: string; text: string; word: string }> = {
    above: { dot: "bg-[#d92d20]", text: "text-[#b42318]", word: "Above" },
    none: { dot: "bg-[#d9a400]", text: "text-[#8a5800]", word: "No budget" },
    within: { dot: "bg-[#14803f]", text: "text-[#14803f]", word: "Within" },
  };
  const budgetWhy = (m: BudgetMark) =>
    m === "above"
      ? "Above Approved Budget — rate + GST is above the approved budget"
      : m === "none"
        ? "No budget — this item is not in the order's approved budget"
        : "Within budget — rate + GST is within the approved budget";
  /** A line's reason as the MD reads it — "" while unpicked, or OTHER still untyped. */
  const reasonOf = (r: GridRow) => {
    const v = r.row.reason ?? "";
    return v.startsWith("OTHER") ? v.replace(/^OTHER:?/, "").trim() : v;
  };
  /** The lines that send the PO to the MD — each needs its reason before Submit. */
  const mdLines = budgetLines.filter((r) => {
    const m = budgetMarkOf([r]);
    return m === "above" || m === "none";
  });
  const unreasoned = mdLines.filter((r) => !reasonOf(r)).length;
  /* THE ONE `budget_reason` THE MD READS (0761): each reason once, with the items it covers —
     "MARKET PRICE INCREASE (SEWING THREAD); BUDGET NOT APPROVED YET (CARE LABEL)". */
  const budgetReason = (() => {
    const by = new Map<string, Set<string>>();
    for (const r of mdLines) {
      const t = reasonOf(r);
      if (t) by.set(t, (by.get(t) ?? new Set<string>()).add(r.item_name));
    }
    return [...by].map(([t, items]) => `${t} (${[...items].join(", ")})`).join("; ").slice(0, 300);
  })();

  /**
   * THE BUDGET CELL: the state, and for a line going to the MD its reason, as ONE box — a
   * dropdown whose empty choice reads the state ("● No budget *"). Coloured as the state.
   * Not `required`: a held cursor would cage the operator in a row they are still pricing;
   * Submit is the gate. `apply` writes every line under the row (sizes, orders).
   */
  const budgetCell = (rs: readonly GridRow[], apply: (p: Partial<RowState>) => void) => {
    const mark = budgetMarkOf(rs);
    if (!mark) return null;
    const why = `${budgetWhy(mark)}. ${GST_RULE}`;
    if (mark === "within")
      return (
        <span title={why} className={cn("inline-flex items-center gap-1.5 px-1 text-xs font-semibold", BUDGET_MARK.within.text)}>
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", BUDGET_MARK.within.dot)} />
          Within
        </span>
      );
    const live = rs.filter((r) => !r.row.skip);
    const vals = [...new Set(live.map((r) => r.row.reason ?? ""))];
    const v = vals.length === 1 ? vals[0] : "";
    const tone = mark === "above" ? "border-[#f5b8b0] bg-[#fdecea] text-[#b42318]" : "border-[#f1d48a] bg-[#fff7e0] text-[#8a5800]";
    const word = BUDGET_MARK[mark].word;
    /* THE ASK SITS ON THE BOX (user 2026-10-28, screenshot 3808): the empty option's
       "● No budget *" is a placeholder, and placeholders are blanked app-wide (`hint`), so
       the box read as an empty yellow dropdown while the footer said "Give the reason …"
       and was cut off. The state and, while unpicked, the ask are a visible line above. */
    const asking = !(v.startsWith("OTHER") ? v.replace(/^OTHER:?/, "").trim() : v);
    const label = (
      <span className={cn("mb-0.5 flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold leading-tight", BUDGET_MARK[mark].text)} title={why}>
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", BUDGET_MARK[mark].dot)} />
        {asking ? `${word} · reason *` : word}
      </span>
    );
    if (v.startsWith("OTHER"))
      return (
        <div className="min-w-0">
        {label}
        <Input
          aria-label={`${word} — reason, in your words`}
          title={why}
          placeholder={`${word} · reason *`}
          className={cn("h-8 w-full px-2 text-xs font-semibold", tone)}
          maxLength={120}
          value={v.replace(/^OTHER:?/, "")}
          onChange={(e) => apply({ reason: `OTHER:${e.target.value}` })}
          // Emptied and left: back to the list.
          onBlur={(e) => {
            if (!e.target.value.trim()) apply({ reason: "" });
          }}
        />
        </div>
      );
    const options: readonly string[] = mark === "above" ? BUDGET_REASONS : NO_BUDGET_REASONS;
    return (
      <div className="min-w-0">
      {label}
      <Select
        aria-label={`${word} — reason`}
        title={why}
        className={cn("h-8 w-full px-2 text-xs font-semibold", tone)}
        value={v}
        onChange={(e) => apply({ reason: e.target.value === "OTHER" ? "OTHER:" : e.target.value })}
      >
        <option value="">{`● ${word} *`}</option>
        {/* A reason picked before the state changed stays listed rather than vanish. */}
        {[...options, ...(v && !options.includes(v) ? [v] : [])].map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="OTHER">OTHER (TYPE IT)</option>
      </Select>
      </div>
    );
  };

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
  const checkSignature = budgetLines
    .filter((r) => num(r.row.rate) > 0)
    // The GST is part of the compared rate now (2026-10-31), so changing it re-asks.
    .map((r) => `${r.key}=${r.row.rate}@${r.row.gst ?? slab.pct}`)
    .join("|") + `|fx=${fx}`;
  useEffect(() => {
    const priced = budgetLines.filter((r) => num(r.row.rate) > 0);
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
          // GST-inclusive budget (re-po/types.ts, 2026-10-31): the rate with this line's GST.
          rate: budgetRateOf(num(r.row.rate), r.row.gst ?? slab.pct) * fx,
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
      draft.clear();
      success(
        res.status === "draft"
          ? `${res.code ?? "PO"} saved as draft`
          : res.aboveCount > 0 || res.unbudgetedCount > 0
            ? `${res.code ?? "PO"} sent to the MD — ${budgetWords(res.aboveCount, res.unbudgetedCount)}; printing stays locked`
            : `${res.code ?? "PO"} sent for approval — every rate is within budget; printing opens once approved`,
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
            // px-1: dd/mm/yyyy and the calendar icon, no more — the column is as wide as this box (2026-10-31).
            className={cn(CELL_INPUT, "min-w-0 flex-1 px-1", !own && !disabled && !!vendorId && "bg-[#fff7e0]")}
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
        className="flex h-8 w-full items-center justify-center px-1 whitespace-nowrap text-sm tabular-nums text-muted-foreground hover:bg-[#f2f7fb] hover:text-[#037bb8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
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
  /* REGULAR WEIGHT IN THE CELLS (user 2026-10-31: "fonts look little bit larger"). Item
     names, quantities, units, rates and values were semi-bold, which read larger than the
     same 13px on every other grid. Only a WARNING stays bold — an above-budget value. */
  const itemCell = (name: string, colourSpec: string, struck = false, itemId?: string, category?: string | null, extra?: ReactNode) => {
    const describe = [classIds.length > 1 ? category?.trim() : "", colourSpec].filter(Boolean).join(" · ");
    return (
    // CAPPED AT 20rem (user 2026-10-31, "compact this field size"): the grids hug their
    // content (`autoFit`), so the Item column is as wide as its longest name — up to here,
    // past which the name truncates and reveals on hover. Without a cap one long name
    // would widen the whole table.
    <div className="flex max-w-[20rem] min-w-0 items-start gap-1">
      {/* No `title` here (user 2026-10-30): each line is a <Truncated>, whose black
          bubble is the one reveal — a native title on the wrapper drew a second,
          white tooltip over it. */}
      <div className={cn("min-w-0 flex-1", struck && "text-muted-foreground line-through")}>
        {/* The name on the row's 32px line (figureBox note), its second line under it. */}
        <div className="flex h-8 min-w-0 items-center">
          <Truncated className="min-w-0 text-sm leading-tight">{name}</Truncated>
        </div>
        {/* LINE 2 CARRIES NOTE AND GST (plan B, user 2026-10-30): their two columns gave
            their width to the item name, which now shows whole on one line. */}
        {describe || extra ? (
          <div className="flex min-w-0 items-center gap-1.5">
            {describe ? <Truncated className="min-w-0 shrink text-[10.5px] leading-tight text-[#667085]">{describe}</Truncated> : null}
            {extra}
          </div>
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
          className="mt-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-[#eef4f9] hover:text-[#037bb8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <History aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
    );
  };
  /**
   * NOTE UNDER THE ITEM (plan B, 2026-10-30). Still a FIELD — Tab lands on it — it just
   * moved from its own 88px column onto the item's second line. GST rode here too until
   * 2026-10-31; it now sits under the rate it taxes (`rateWithGst`).
   */
  const lineExtras = (
    key: string,
    label: string,
    note: string | null,
    disabled: boolean,
    setNote: (v: string) => void,
    printsAs: string,
  ) => (
    <>
      {/* A visible word, not a placeholder: placeholders are off app-wide (lib/ui/placeholders). */}
      <label htmlFor={`rpo-note-${key}`} className="shrink-0 text-[10.5px] font-semibold text-[#037bb8]">
        {note == null ? "Note (mixed)" : "Note"}
      </label>
      <Input
        id={`rpo-note-${key}`}
        maxLength={200}
        aria-label={`Note to the vendor, ${label}`}
        title={note ? `Prints as: ${withNote(printsAs, note).toUpperCase()}` : "Printed after the item on the PO, e.g. PROCESS: CUT & SEAL"}
        disabled={disabled}
        value={note ?? ""}
        onChange={(e) => setNote(e.target.value)}
        className="h-5 min-w-[3.5rem] flex-1 rounded-none border-0 border-b border-dashed border-[#c8dce9] bg-transparent px-1 text-[10.5px] font-medium shadow-none @2xl/editor:h-5 md:text-[10.5px] hover:bg-[#f2f7fb] focus:bg-white focus-visible:ring-1 focus-visible:ring-inset"
      />
    </>
  );
  /**
   * GST UNDER THE RATE (user 2026-10-31, screenshot 3928: "move it under rate"). The slab
   * taxes the basic rate, so it reads beneath it in the same tinted column — basic rate on
   * top, its GST % below; the budget compares the two together (Net Rate). Tab: Rate, then GST.
   */
  const rateWithGst = (
    rate: ReactNode,
    key: string,
    label: string,
    gst: number | null,
    disabled: boolean,
    setGst: (pct: number) => void,
  ) => (
    <div className="flex min-w-0 flex-col">
      {rate}
      <div className="flex min-w-0 items-center gap-1 pl-1.5">
        <span aria-hidden className="shrink-0 text-[10.5px] font-semibold text-[#667085]">
          GST
        </span>
        {gstCell(`rpo-gst-${key}`, label, gst, disabled, setGst, true)}
      </div>
    </div>
  );
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
    ? { required: "Required Wt", toOrder: "To Order Wt", po: "PO Wt (kg)" }
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
      className={cn(CELL_INPUT, "min-w-0 flex-1 field-sizing-content px-1.5 text-right tabular-nums")}
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
        <Truncated className="w-10 shrink-0 text-left text-[11px] text-muted-foreground uppercase">{r.uom_code ?? ""}</Truncated>
      </>,
    );
  /*
   * YARN BAGS · FABRIC ROLLS (user 2026-10-26, Task 2; 0758). The same pattern as the
   * size breakup — the cell is the total, an icon says it opens, and the detail is in a
   * small pop-up — so the grid keeps one width and one line per row.
   *
   * YARN: the Purchase Manager types the Bag Weight, the No. of Bags fills itself rounded
   * up to cover To Order, and can be stepped down; the PO weight is their product, and may
   * be typed lower for a part-filled last bag (`setBagQty`). Whole bags may round the line UP past To
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
  /**
   * Typing the BAG WEIGHT fills the bag count, rounded UP to cover To Order (user
   * 2026-10-28: "auto-calculated rounded-up bag count"). 259 kg in 60 kg bags → 5 bags,
   * 300 kg. The count is re-derived on every change of the weight, because a count typed
   * against 50 kg bags means nothing once the bag is 60 kg; the operator then steps it
   * down (or not) in No. of bags, which `setBags` still caps at that same figure.
   */
  function setBagWeight(r: GridRow, bagWtTyped: string) {
    const bw = num(bagWtTyped);
    setBags(r, bw > 0 ? String(maxBags(r.balance_qty, bw)) : "", bagWtTyped);
  }
  /**
   * THE PO WEIGHT IS TYPED TOO, IN BAGS (user 2026-10-28, screenshot 3814). Up to To Order any
   * weight goes — the last bag part-filled, 259.88 kg in 5 × 60 kg. Above To Order only as
   * WHOLE bags (bags × bag weight, 0758's rule, which the DB and the save hold too), so any
   * other figure past To Order comes back to To Order.
   */
  function setBagQty(r: GridRow, typed: string) {
    const inBags = bagsOf(r);
    if (!inBags || typed === "") return setRow(r, { qty: typed });
    const v = Math.max(0, num(typed));
    const whole = round3(inBags.bags * inBags.bagWeight);
    setRow(r, { qty: v <= r.balance_qty + 1e-4 || Math.abs(v - whole) < 1e-3 ? typed : String(round3(r.balance_qty)) });
  }
  /** A yarn line is "in bags" once both are typed — then its weight is theirs, not the box's. */
  const bagsOf = (r: GridRow) => {
    const bw = num(r.row.bagWt ?? "");
    const b = r.row.bags ?? "";
    return lineKindOf(r.item_class) === "yarn" && bw > 0 && b !== "" ? { bags: Math.floor(num(b)), bagWeight: bw } : null;
  };
  /* DIA FROM THE FABRIC BOM (user 2026-10-30) — `bomDiaOf`, the same rule the save reads.
     Shown locked, never typed, so the vendor's PO cannot drift from the plan. */
  const diaOf = (r: GridRow) => bomDiaOf(r) ?? "";
  /** What goes up to the save for this line's bags / rolls (0758), and a fabric's Gauge and
   *  Loop length. Dia and GSM are not sent — the save reads them off the plan. */
  const gaugeOf = (r: GridRow) => r.row.gauge ?? r.gauge ?? "";
  const loopOf = (r: GridRow) => r.row.loopLength ?? (r.loop_length != null ? String(r.loop_length) : "");
  const materialPayload = (r: GridRow) => {
    const kind = lineKindOf(r.item_class);
    const inBags = bagsOf(r);
    return {
      bags: inBags?.bags ?? null,
      bag_weight: inBags?.bagWeight ?? null,
      rolls: kind === "fabric" && (r.row.rolls ?? "") !== "" ? Math.max(0, Math.floor(num(r.row.rolls ?? ""))) : null,
      gauge: kind === "fabric" ? gaugeOf(r).trim() || null : null,
      ply: kind === "fabric" ? (r.row.ply ?? "").trim() || null : null,
      // Free text (0774): "2.80", "2.85-2.90", "AS PER SAMPLE" all go up as typed.
      loop_length: kind === "fabric" ? loopOf(r).trim() || null : null,
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
        : [r.row.rolls ? `${r.row.rolls} rolls` : "", diaOf(r) ? `Dia ${diaOf(r)}` : ""].filter(Boolean).join(" · ") || "Set the rolls and dia";
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
          className="flex h-8 min-w-0 flex-1 items-center gap-1.5 pr-1.5 pl-1.5 text-sm tabular-nums hover:bg-[#f2f7fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
        >
          <Icon aria-hidden className="size-4 shrink-0 text-[#037bb8]" />
          {/* Amber when whole bags took it over To Order — allowed, and said. */}
          <span className={cn("ml-auto", over > 0 && "font-semibold text-[#8a5800]")}>{r.row.skip ? 0 : num(r.row.qty)}</span>
        </button>
        {/* NO UNIT WHEN THE HEADER SAYS IT (user 2026-10-28, screenshot 3816): icon + figure +
            "KGS" in 112px overlapped, and "PO Wt (kg)" above already names it. A mixed grid's
            header reads "Order PO Qty", so the unit stays there. */}
        {byWeight ? null : <Truncated className="w-10 shrink-0 text-left text-[11px] text-muted-foreground uppercase">{r.uom_code ?? ""}</Truncated>}
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
  const gstCell = (id: string, label: string, value: number | null, disabled: boolean, set: (pct: number) => void, small = false) => (
    <Select
      id={id}
      aria-label={`GST %, ${label}`}
      title={slab.kind === "igst" ? "IGST" : "CGST + SGST, split in half"}
      // THE WHOLE CELL OPENS THE LIST (user 2026-10-27, screenshot 3743). The cell look used to
      // go through `className`, which `Select` also puts on the Combobox's WRAPPER — its `pr-6`
      // padded the wrapper, so the box shrank to a sliver that hid the value and the ▼ sat
      // outside it, where a click opened nothing. Wrapper: width only; box: the cell look.
      // SMALL (plan B, 2026-10-30): under the item name, beside the Note — no column of its own.
      // Under the rate (2026-10-31): fills what the "GST" word leaves of the Rate column.
      // min 3.25rem: under automatic layout this is what keeps "12% ▾" whole — the cell
      // grows to it rather than clipping the value to "1…" (screenshot 3769's bug).
      className={small ? "min-w-[3.25rem] flex-1" : "w-full"}
      inputClassName={
        small
          ? "h-5 rounded border-0 bg-transparent pl-1 text-[11px] tabular-nums text-[#667085] shadow-none hover:bg-[#f2f7fb] focus:bg-white focus-visible:ring-1 focus-visible:ring-inset"
          : cn(CELL_INPUT, "pl-2 tabular-nums")
      }
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
  /* NET RATE AND VALUE (user 2026-10-31): Net Rate = Basic Rate + GST % of it; Value
     (was "Amount") = Net Rate × Qty, so the row reads what the line costs paid out. The
     budget compares this NET rate — it includes GST (re-po/types.ts, 2026-10-31). */
  /* ONE LINE PER ROW (user 2026-10-31, screenshot 3930: "looks shaky, no clean
     alignment"). The typed boxes are 32px (`CELL_INPUT` h-8) and centre their figure at
     20px from the cell top; read-only text sat at the top of its cell (~14px) and the
     row's first line read as three different heights. Every read-only figure now sits
     in the same 32px band, with the same 6px right inset the boxes have (`px-1.5`), so
     every figure on the row shares one centre line and one right edge. */
  const figureBox = (child: ReactNode, className?: string) => (
    <div className={cn("flex h-8 min-w-0 items-center justify-end pr-1.5 text-sm tabular-nums", className)}>{child}</div>
  );
  /** The row's `#` on the same line. ChildGrid's index is now as tall as `Input` (36px, 32px in
   *  an editor); this page is not an editor yet its boxes are 32px (`CELL_INPUT`), so it says so. */
  const INDEX_ON_LINE = "[&>tr>td:first-child]:leading-8";
  const lineGst = (r: GridRow) => r.row.gst ?? slab.pct;
  const netRateOf = (r: GridRow) => num(r.row.rate) * (1 + lineGst(r) / 100);
  const lineValue = (r: GridRow) => num(r.row.qty) * netRateOf(r);
  /** One net rate for the rows under a cell; "mixed" when their rates or slabs differ. */
  const netRateCell = (rows: GridRow[]) => {
    const live = rows.filter((r) => !r.row.skip && num(r.row.rate) > 0);
    const vals = [...new Set(live.map((r) => fmtFixed(netRateOf(r), 2)))];
    if (vals.length === 0) return null;
    if (vals.length > 1) return figureBox(<span className="text-xs text-muted-foreground">mixed</span>);
    return figureBox(<Truncated text={vals[0]} className="min-w-0" />);
  };
  /* SIZED TO THE VALUE (user 2026-10-31: "compact the field width … if the rate value
     exceeds the cell it dynamically adjusts, like Order Entry's Quantities tab"). The
     same `field-sizing: content` + `min-w-full` Order Entry's Avg Rate / Gross Value use:
     the box is the figure plus its padding, never narrower than its cell, and a longer
     figure widens the cell instead of scrolling out of sight inside it. This grid's table
     runs automatic layout (the Item column has no width), so a column's `width` below is a
     FLOOR — `num`, the smallest step — and the Item column takes what is left. */
  const FIT_BOX = "w-auto min-w-full field-sizing-content";
  /** THE ONE COLUMN TO TYPE IN is tinted (V6) — the cells around it are read, this is filled. */
  const RATE_COL = "bg-[#fffaeb]";

  // ---------- grid ----------
  /*
   * A TIGHT TABLE (user 2026-10-24, screenshot 3704). Item 200 + Note 88 + Qty 112 +
   * Rate 88 + GST 88 + Delivery 112 + Amount 112 + Budget·Skip 176 = 976, + 40 chrome = 1,016 — inside
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
      header: "Note",
      width: FIELD_WIDTH_CSS.hug,
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
    { header: QTY.po, width: FIELD_WIDTH_CSS.range, align: "right", cell: (r) => qtyBox(r) },
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
      // A floor (FIT_BOX note, user 2026-10-31 "compact this field"): the date sets the width.
      width: FIELD_WIDTH_CSS.num,
      cell: (r) =>
        deliveryCell(`rpo-date-${r.key}`, r.row.date, lineDescription(r), !!r.row.skip, defaultFor(r.delivery_date), (v) => setRow(r, { date: v })),
    },
    {
      /* AMOUNT CARRIES THE BUDGET WORD (user 2026-10-26: "PO sheet on the right side" —
         the table was wider than its pane and scrolled sideways). The Budget column held
         one of three short states; each now reads in this cell instead: an amount above
         the approved budget is red with a warning mark, a skipped line says so, a line at
         0 is a dash. The spec's exact "Above Approved Budget" is the title and the bar. */
      // "Value", was "Amount" (user 2026-10-31): Net Rate × Qty, GST included.
      header: "Value",
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      cell: (r) => {
        if (r.row.skip)
          return figureBox(
            <span className="text-xs font-semibold text-muted-foreground" title="Not on this PO — its balance stays for another vendor's PO">
              Skipped
            </span>,
          );
        if (num(r.row.qty) <= 0)
          return figureBox(
            <span className="text-muted-foreground" title="Not ordered on this PO">
              —
            </span>,
          );
        const a = lineValue(r);
        if (a <= 0) return null;
        const mark = budgetMarkOf([r]);
        return figureBox(
          // Truncated (user 2026-10-28, screenshot 3810): a long figure spilled into Budget.
          <Truncated text={fmtFixed(a, 2)} className={cn("min-w-0", mark === "above" && "font-semibold text-[#b42318]")} />,
        );
      },
    },
    {
      /* BUDGET · SKIP. The line's budget state and its reason (above), then SKIP (V7 point 7):
         this PO goes without the line, its balance waits for the next vendor's. Reversible in
         place — the row greys and the icon turns to Undo. A button, so it is off the Tab path
         like every row action. */
      header: "Budget",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">{budgetCell([r], (p) => setRow(r, p))}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={r.row.skip ? `Put ${lineDescription(r)} back on this PO` : `Skip ${lineDescription(r)} on this PO`}
          title={r.row.skip ? "Put back on this PO" : "Skip on this PO — the balance stays for another PO"}
          onClick={() => setRow(r, { skip: !r.row.skip })}
        >
          {r.row.skip ? <Undo2 aria-hidden className="size-4" /> : <Ban aria-hidden className="size-4 text-muted-foreground" />}
        </Button>
        </div>
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
      // Compared trimmed, but SHOWN as typed (user 2026-10-31): showing the trimmed copy ate
      // the space the moment it was typed, so "CUT SEAL" came out "CUTSEAL". The save trims.
      const notes = [...new Set(ms.map((m) => (m.row.note ?? "").trim()))];
      const typedNote = ms[0].row.note ?? "";
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
        note: notes.length === 1 ? typedNote : "",
        mixedNote: notes.length > 1,
        gst: gsts.length === 1 ? gsts[0] : null,
        date: dates.length === 1 ? dates[0] : (def?.date ?? ""),
        amount: act.reduce((a, m) => a + lineValue(m), 0),
        orders: ms.length,
        above: act.filter((m) => flags[m.key]?.above).length,
      });
    }
  }
  const openItem = itemGroups.find((g) => g.key === itemFold.openKey) ?? null;

  /*
   * PLAN B (2026-10-30; re-ordered 2026-10-31): Item flexes, Orders 88 + Basic Rate 88 + Net Rate 88 + Qty 112 + Value 88 + Delivery 112
   * + Budget 112 = 688, + 40 chrome; Note under the item name, GST under the rate. The unit
   * rides inside Qty, as on the order grid. Same default switch as the order grid (see its note). The note, rate, GST
   * and delivery typed here go to every order line under the item; the breakup below edits
   * one order at a time.
   */
  const itemColumns: ChildGridColumn<ItemGroup>[] = [
    {
      // No width — the item takes what is left; Note and GST under it (plan B, 2026-10-30).
      header: "Item",
      cell: (g) =>
        itemCell(
          g.item_name,
          g.spec,
          false,
          g.members[0]?.item_id,
          g.members[0]?.category,
          lineExtras(
            `i-${g.key}`,
            `${g.item_name} ${g.spec}, for all ${g.orders} orders`,
            // MIXED: the orders were noted / taxed apart in the breakup — typing here sets them all again.
            g.mixedNote ? null : g.note,
            !g.supplied,
            (v) => setMembers(g.members, { note: v }),
            g.members[0] ? lineDescription(g.members[0]) : g.item_name,
          ),
        ),
    },
    {
      header: "Orders",
      width: FIELD_WIDTH_CSS.num,
      cell: (g) => (
        <button
          type="button"
          aria-expanded={itemFold.isOpen(g.key)}
          onClick={() => itemFold.toggle(g.key)}
          className="inline-flex h-8 items-center gap-1 text-sm font-medium text-[#037bb8] hover:underline"
        >
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", itemFold.isOpen(g.key) && "rotate-90")} />
          {g.orders}
        </button>
      ),
    },
    {
      /* BASIC RATE → GST % → NET RATE → QTY → VALUE (user 2026-10-31): the sequence the
         line is worked out in, left to right. Qty used to come before the rate. */
      header: `Basic Rate ${cur}`,
      // A FLOOR, not a width (FIT_BOX): the rate box and "GST 12% ▾" set it, and a long rate widens it.
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      className: RATE_COL,
      cell: (g) =>
        rateWithGst(
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            aria-label={`Rate per ${g.uom_code ?? "unit"}, ${g.item_name} ${g.spec}, for all ${g.orders} orders`}
            className={cn(CELL_INPUT, FIT_BOX, "px-1.5 text-right tabular-nums")}
            // MIXED: the orders were priced apart in the breakup — typing here sets them all again.
            placeholder={g.mixedRate ? "mixed" : undefined}
            title={lastRateTitle(g.members[0]?.item_id)}
            disabled={!g.supplied}
            value={g.rate}
            onChange={(e) => setMembers(g.members, { rate: e.target.value })}
          />,
          `i-${g.key}`,
          `${g.item_name} ${g.spec}, for all ${g.orders} orders`,
          // MIXED: the orders were taxed apart in the breakup — picking here sets them all again.
          g.gst,
          !g.supplied,
          (pct) => setMembers(g.members, { gst: pct }),
        ),
    },
    {
      header: `Net Rate ${cur}`,
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      cell: (g) => netRateCell(g.members),
    },
    {
      header: QTY.po,
      // A floor (FIT_BOX note): the figure and its unit set the width.
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      cell: (g) =>
        qtyFacts(
          g.members.reduce((a, m) => a + m.required_qty, 0),
          g.members.reduce((a, m) => a + m.balance_qty, 0),
          g.members.reduce((a, m) => a + m.ordered_qty, 0),
          <div className="flex h-8 w-full items-center justify-end gap-1 px-1.5 text-sm tabular-nums">
            {g.qty > 0 ? fmtNumber(g.qty) : "—"}
            <Truncated className="w-10 shrink-0 text-left text-[11px] text-muted-foreground uppercase">{g.uom_code ?? ""}</Truncated>
          </div>,
        ),
    },
    {
      // "Value", was "Amount" (user 2026-10-31): Net Rate × Qty, GST included.
      header: "Value",
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      cell: (g) => (g.amount > 0 ? figureBox(<Truncated text={fmtFixed(g.amount, 2)} className="min-w-0" />) : null),
    },
    {
      header: "Delivery",
      // A floor (FIT_BOX note, user 2026-10-31 "compact this field"): the date sets the width.
      width: FIELD_WIDTH_CSS.num,
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
      header: "Budget",
      width: FIELD_WIDTH_CSS.range,
      // The order grid's own control; the reason goes to every order line under the item.
      cell: (g) => <div className="flex h-8 items-center">{budgetCell(g.members, (p) => setMembers(g.members, p))}</div>,
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
          <div className="flex h-8 min-w-0 items-center">
            <Truncated className="min-w-0 font-mono text-sm tabular-nums">{r.source_no}</Truncated>
          </div>
          {r.customer ? <Truncated className="text-xs text-muted-foreground">{r.customer}</Truncated> : null}
        </div>
      ),
    },
    ...poLineColumns.filter((c) => [QTY.po, "GST %", "Delivery", "Value", ""].includes(c.header)),
  ];

  const canSave =
    !isPending && anyClass && orderIds.length > 0 && !!vendorId && active.length > 0 && undated === 0 && (poType === "local" || num(exRate) > 0);
  // Above budget → the reason is mandatory before it can go to the MD (user 2026-10-27).
  const canSubmit = canSave && unpriced === 0 && (!goesToMd || unreasoned === 0);
  /* EACH WARNING UNDER ITS OWN FIELD (user 2026-10-29: "Choose the item class … its in
     top but message is showing in bottom … show the warning message under the exact
     field"). These four were the bottom bar's first four answers, a page away from the
     pill, box or list they meant. They now render beside it (FilterPill `error`, the
     tick list's head, the rate box), and the bar below says only what belongs to the
     LINES — a count of rates or dates still to type, or where Submit will send it. */
  const fieldErrors = {
    // Item Class is optional since 2026-10-31 — none ticked is All.
    itemClass: null,
    orders: anyClass && orderIds.length === 0 ? "Tick the orders for this PO." : null,
    vendor:
      anyClass && !vendorId
        ? classVendors.length === 0
          ? "No vendor mapped — add one in Master Data ▸ Vendors."
          : "Choose the vendor."
        : null,
    exRate: poType === "import" && num(exRate) <= 0 ? "Type the exchange rate." : null,
  };
  const fieldBlocked = Object.values(fieldErrors).some(Boolean);
  /* WHICH RATE IS MISSING (user 2026-10-29, screenshot 3842: "1 rate still to type …
     indicate"). A bare count left the operator scanning the grid for the blank box; the
     chip now names the line — numbered as the grid numbers it, skipped rows left out —
     and a click puts the cursor in that box (`openRe`). The order on screen first, then
     the next order still to price. */
  const priceTarget = (activeGroup?.toPrice.length ? activeGroup : groups.find((g) => g.toPrice.length > 0)) ?? null;
  const priceLine = priceTarget
    ? sizeGroupsOf(priceTarget.rows)
        .filter((sg) => !sg.members.every((m) => m.row.skip))
        .findIndex((sg) => sg.members.some((m) => m.key === priceTarget.toPrice[0].key)) + 1
    : 0;
  const priceWhere = priceTarget && priceLine > 0 ? `${groups.length > 1 ? `${priceTarget.re.split(" · ")[0]}, ` : ""}line ${priceLine}` : "";
  const hint = fieldBlocked
    ? null
    : active.length === 0
          ? "Every line is skipped or 0 — there is nothing to order."
          : undated > 0
            ? `Type the delivery date on ${undated} line${undated === 1 ? "" : "s"} — the order has no ship date and ${vendorName} no lead days.`
            : unpriced > 0
                ? // Short enough to read whole in the chip (user 2026-10-29: "not look clear").
                  `Type the rate${priceWhere ? ` on ${priceWhere}` : ""}${unpriced > 1 ? ` · ${unpriced} left` : ""}`
                : goesToMd
                  ? unreasoned
                    ? `Pick ${unreasoned} budget reason${unreasoned === 1 ? "" : "s"}`
                    : `${budgetWords(above, unbudgeted)} — Submit sends it to the MD`
                  : // Short, like the chips above it (user 2026-10-29: "fix it"); was a sentence
                    // with a full stop, cut off by the chip's own width.
                    "Within budget — ready to submit";
  /* THE BAR'S MESSAGE IS A STATUS CHIP (user 2026-10-26: "make it better, single row,
     better colouring"): amber = something still to do, red = Submit goes to the MD,
     green = ready. Fixed colour pairs, as in FilterPill — the skin cannot repaint them. */
  const hintKind: "todo" | "md" | "ready" =
    unpriced > 0 || !vendorId || undated > 0 || orderIds.length === 0 || !anyClass || active.length === 0 ? "todo" : goesToMd ? "md" : "ready";
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
   * The order grid on size rows. PLAN B (user 2026-10-30): Item flexes into what is left,
   * Basic Rate 88 + Net Rate 88 + Qty 144 + Value 88 + Delivery 112 + Budget 112 = 632 (2026-10-31), + 40 `#` —
   * Note under the item name, GST under the rate; the rail gave back 16px (11.5rem). The
   * Qty cell of a sized row is a BUTTON showing the total — click it, or ↓ on it (the
   * key that opens any list here), for the per-size quantities. It is `data-field-trigger`
   * so Tab lands on it like a field (AGENTS, Tab lands on fields) and ↓ is the way in.
   */
  const groupColumns: ChildGridColumn<SizeGroup>[] = [
    {
      /* NO WIDTH: THE ITEM TAKES WHAT IS LEFT (plan B, user 2026-10-30: "show the item name
         full in single"). Note and GST ride on its second line (`lineExtras`). */
      header: "Item",
      cell: (g) =>
        itemCell(
          g.first.item_name,
          describeGroup(g),
          groupSkip(g),
          g.first.item_id,
          g.first.category,
          lineExtras(
            g.first.key,
            `${g.first.item_name} ${describeGroup(g)}`,
            // Compared trimmed, SHOWN as typed — a trimmed copy ate each space as it was typed
            // (user 2026-10-31, screenshot 3937). The save trims.
            common(g.members.map((m) => (m.row.note ?? "").trim())) == null ? null : (g.first.row.note ?? ""),
            groupSkip(g),
            (v) => setMembers(g.members, { note: v }),
            lineDescription(g.first),
          ),
        ),
    },
    {
      header: `Basic Rate ${cur}`,
      // A FLOOR, not a width (FIT_BOX): the rate box and "GST 12% ▾" set it, and a long rate widens it.
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      className: RATE_COL,
      cell: (g) => {
        const rate = common(g.members.filter((m) => !m.row.skip).map((m) => m.row.rate.trim()));
        return rateWithGst(
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            id={rateId(g.first.key)}
            aria-label={`Rate per ${g.first.uom_code ?? "unit"}, ${g.first.item_name} ${describeGroup(g)}${g.sized ? ", every size" : ""}`}
            className={cn(CELL_INPUT, FIT_BOX, "px-1.5 text-right tabular-nums")}
            placeholder={rate == null ? "mixed" : undefined}
            title={lastRateTitle(g.first.item_id)}
            disabled={groupSkip(g)}
            value={rate ?? ""}
            onChange={(e) => setMembers(g.members, { rate: e.target.value })}
          />,
          g.first.key,
          `${g.first.item_name} ${describeGroup(g)}`,
          common(g.members.map((m) => m.row.gst ?? slab.pct)),
          groupSkip(g),
          (pct) => setMembers(g.members, { gst: pct }),
        );
      },
    },
    {
      header: `Net Rate ${cur}`,
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      cell: (g) => netRateCell(g.members),
    },
    {
      header: QTY.po,
      /* `code` (144px), one step past `range` (user 2026-10-29, screenshots 101621 /
         102705: "fix this field ui"). At 112px the box left of the 40px unit had ~52px,
         and ruler + gap + a 4-digit total + `pr-2.5` need ~74, so the number ran into its
         own padding and touched the unit. Shrinking the icon did not buy enough; the
         column is the fix. This grid stays inside the 1155px pane.
         NOW A FLOOR (2026-10-31, FIT_BOX note): the table runs automatic layout, so the
         ruler + total + unit set the width themselves and can no longer touch. */
      width: FIELD_WIDTH_CSS.num,
      align: "right",
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
                /* ROOM BETWEEN ICON, NUMBER AND UNIT (user 2026-10-29, screenshot 101621:
                   "the field cell squeezing the value"). In the 112px column the 16px ruler
                   + pl-2 left a 4-digit total touching both the icon and "NOS". The ruler
                   is 14px with pl-1 and a gap-2 keeps it off the number; the number still
                   ends at `pr-2.5` and the unit keeps the w-10 every other row uses, so
                   both line up with the typed boxes below. */
                className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-1.5 pl-1 text-sm tabular-nums hover:bg-[#f2f7fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
              >
                <Ruler aria-hidden className="size-3.5 shrink-0 text-[#037bb8]" />
                <span className="ml-auto">{Number(groupQty(g).toFixed(3))}</span>
              </button>
            <Truncated className="w-10 shrink-0 text-left text-[11px] text-muted-foreground uppercase">{g.first.uom_code ?? ""}</Truncated>
            {/* NO Req · To order HERE (user 2026-10-26, screenshot 3735): the pop-up shows both per size. */}
          </div>
        );
      },
    },
    {
      // "Value", was "Amount" (user 2026-10-31): Net Rate × Qty, GST included.
      header: "Value",
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      cell: (g) => {
        if (groupSkip(g))
          return figureBox(
            <span className="text-xs font-semibold text-muted-foreground" title="Not on this PO — its balance stays for another vendor's PO">
              Skipped
            </span>,
          );
        if (groupQty(g) <= 0)
          return figureBox(
            <span className="text-muted-foreground" title="Not ordered on this PO">
              —
            </span>,
          );
        const live = g.members.filter((m) => !m.row.skip);
        const a = live.reduce((t, m) => t + lineValue(m), 0);
        if (a <= 0) return null;
        const mark = budgetMarkOf(live);
        return figureBox(
          // Truncated (user 2026-10-28, screenshot 3810): a long figure spilled into Budget.
          <Truncated text={fmtFixed(a, 2)} className={cn("min-w-0", mark === "above" && "font-semibold text-[#b42318]")} />,
        );
      },
    },
    {
      header: "Delivery",
      // A floor (FIT_BOX note, user 2026-10-31 "compact this field"): the date sets the width.
      width: FIELD_WIDTH_CSS.num,
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
      // BUDGET · SKIP, as on the order grid; the reason goes to every size under the row.
      // 112 since plan B (was 176): the word and the reason box at 12px, then Skip.
      header: "Budget",
      width: FIELD_WIDTH_CSS.range,
      cell: (g) => {
        const skip = groupSkip(g);
        const what = `${g.first.item_name} ${describeGroup(g)}${g.sized ? " (every size)" : ""}`;
        return (
          <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">{budgetCell(g.members, (p) => setMembers(g.members, p))}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={skip ? `Put ${what} back on this PO` : `Skip ${what} on this PO`}
            title={skip ? "Put back on this PO" : "Skip on this PO — the balance stays for another PO"}
            onClick={() => setMembers(g.members, { skip: !skip })}
          >
            {skip ? <Undo2 aria-hidden className="size-4" /> : <Ban aria-hidden className="size-4 text-muted-foreground" />}
          </Button>
          </div>
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
          className="text-sm tabular-nums"
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
          <Truncated className="w-10 shrink-0 text-left text-[11px] text-muted-foreground uppercase">{r.uom_code ?? ""}</Truncated>
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
          bodyClassName={INDEX_ON_LINE}
          rows={all.filter((x) => !groupSkip(x))}
          // Hug the content (user 2026-10-31, screenshot 120815): no pane-wide Item column.
          autoFit
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
          "grid h-7 grid-cols-[1.75rem_minmax(0,1fr)] items-center border-b border-[#e8edf2]",
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
    // `data-rpo-editor`: page.tsx hides the page's floating "← Back" while this is open.
    <div data-focus-scope data-rpo-editor>
      {/* ONE SURFACE (user 2026-10-26: "each section have separate division, make it
          single clean page design"). Title row · filter row · list and lines · totals
          bar, parted by hairlines inside ONE frame — no card inside a card, no boxed
          grid, no footer floating as a box of its own. The PO's own terms (GST, Payment
          Terms, the exchange rate) ride the title row beside its number: they are facts
          about this PO, as the number and date are. */}
      {/* The autosaved work from last time — links, not buttons (AGENTS.md "Buttons"). */}
      {draft.hasDraft ? (
        <p className="mb-2 flex max-w-[88rem] flex-wrap items-center gap-x-3 text-[13px] text-muted-foreground">
          <span>You have an unfinished PO from last time.</span>
          <button type="button" className="font-semibold text-primary hover:underline" onClick={draft.restore}>
            Restore
          </button>
          <button type="button" className="hover:underline" onClick={draft.discard}>
            Discard
          </button>
        </p>
      ) : null}
      <div className="max-w-[88rem] rounded-xl border border-[#dde4eb] bg-white">
        {/* Room under the row while the exchange rate's warning hangs there (user
            2026-10-29, screenshot 105223: it sat on the pill labels below). */}
        <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-2 px-4 pt-2.5", fieldErrors.exRate ? "pb-7" : "pb-2.5")}>
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
            /* ONE RING FOR THE ONE BOX (screenshot 105223): the app's global focus ring
               drew a second box round the ₹ input inside this one. The input's own ring is
               switched off below and the label carries it instead. */
            <label className="relative inline-flex h-8 items-center gap-1 rounded-control border border-[#d9a400] pl-1 text-[13px] text-muted-foreground focus-within:border-[#037bb8] focus-within:shadow-[0_0_0_2px_var(--ring)]">
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
                className="h-7 w-20 border-0 bg-transparent px-1 text-right text-[13px] font-semibold tabular-nums text-foreground shadow-none focus-visible:ring-0 focus-visible:shadow-none! @2xl/editor:h-7"
                value={exRate}
                aria-describedby={fieldErrors.exRate ? "rpo-fx-error" : undefined}
                onChange={(e) => {
                  setDirty(true);
                  setExRate(e.target.value);
                }}
              />
              {/* Under the box, hung so the title row does not grow (FilterPill's shape). */}
              {fieldErrors.exRate ? (
                <span className="pointer-events-none absolute top-full left-0 whitespace-nowrap [&>p]:mt-1">
                  <FieldError id="rpo-fx-error">{fieldErrors.exRate}</FieldError>
                </span>
              ) : null}
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
          {/* ONE ROW (screenshots 3744, 120804): a chosen pill stacks its label over its value
              and enters the row at a small basis, growing toward its full width (filter-pill.tsx),
              so the row breaks only when even the minimums do not fit. */}
          {/* Room under the row for a pill's warning line (FilterPill `error` hangs below it). */}
          <div
            className={cn(
              // Wraps rather than overflows: with option A's inline labels the row can outgrow a laptop pane.
              // 4px between pills (was 6px): with Progress the ten pills need ~1,520px and a
              // full-HD pane gives 1,500, so Progress dropped to a line of its own (user
              // 2026-10-29, screenshot 3840). Tighter gaps keep it on one row there; a narrower
              // laptop still wraps rather than clipping a pill's dropdown.
              "flex flex-wrap items-center gap-x-1 border-t border-[#dde4eb] bg-[#fafbfc] px-4 pt-2.5",
              fieldErrors.itemClass || fieldErrors.vendor ? "gap-y-6 pb-6" : "gap-y-2 pb-2.5",
            )}
          >
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
                const next = v === "import" ? "import" : "local";
                setPoType(next);
                // A vendor of the other kind is not on the new list — drop it rather than keep a hidden pick.
                setVendorPick((cur) =>
                  cur && Object.values(vendorsByClass).some((vs) => vs.some((x) => x.id === cur && x.is_import !== (next === "import"))) ? "" : cur,
                );
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
              onChange={(v) => setUpstream("kind", v)}
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
              onChange={(v) => setUpstream("buyer", v)}
            />
            {/* ORDERS — AFTER BUYER, BEFORE ITEM CLASS (user 2026-10-28, filter hierarchy Buyer →
                RE / Order Numbers → Item Class → Category → Vendor). Open before a class is
                picked; lists the chosen buyers' orders. Was (user 2026-10-26): "add the new filter option after the item class Orders
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
              options={orderOptions}
              anyCount={anyCount("order")}
              multiple
              value={filters.order}
              emptyText="No order of this buyer has anything left to buy"
              onChange={(v) => setUpstream("order", v)}
            />
            <FilterPill
              id="rpo-class"
              label="Item Class"
              family="item"
              icon={Layers}
              anyLabel="All"
              error={fieldErrors.itemClass}
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
                // vendor (unless it supplies every class still ticked), and the Category picks.
                // Buyer, Order Type and Orders are chosen BEFORE the class, so they carry.
                setOrderIds((prev) => prev.filter((id) => lines.some((l) => l.source_id === id && inV(l))));
                setVendorPick((cur) => (cur && v.length && v.every((c) => (vendorsByClass[c] ?? []).some((x) => x.id === cur)) ? cur : ""));
                setFilters((f) => ({
                  ...f,
                  category: yarnOnly(v) ? [] : f.category.filter((c) => lines.some((l) => l.category_id === c && (!v.length || inV(l)))),
                }));
              }}
            />
            {/* CATEGORY FOR EVERY ITEM CLASS (user 2026-10-28) — one class ticked as well as
                several. This reverses 2026-10-27's "only across classes"; it lists only the
                categories the pills before it leave. Except Yarn alone (2026-10-30, above). */}
            {yarnOnly(classIds) ? null : (
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
            )}
            <FilterPill
              id="rpo-vendor"
              label="Vendor"
              family="vendor"
              icon={Store}
              required
              wide
              placeholder="Choose vendor"
              error={fieldErrors.vendor}
              disabled={!anyClass}
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
                poType === "import"
                  ? "No import vendor (outside India) for this class — set the vendor's country in Master Data ▸ Vendors, or switch PO Type to Local"
                  : classIds.length > 1
                  ? "No bought-item vendor supplies every class ticked — untick one, or map one in Master Data ▸ Vendors"
                  : "No bought-item vendor for this class — add one in Master Data ▸ Vendors"
              }
              onChange={(v) => {
                setDirty(true);
                setVendorPick(v);
                // Under All, the vendor decides the classes: tick the ones it supplies, and drop
                // ticked orders left with nothing of them (as narrowing the class pill does).
                if (!hasClass && v) {
                  const vc = effClassIds.filter((c) => (vendorsByClass[c] ?? []).some((x) => x.id === v));
                  setClassIds(vc);
                  setOrderIds((prev) => prev.filter((id) => lines.some((l) => l.source_id === id && !!l.item_class_id && vc.includes(l.item_class_id))));
                }
                // CGST + SGST OR IGST FOLLOWS THE VENDOR (user 2026-10-31): same state as the
                // unit → CGST + SGST, another state → IGST, the % kept. Applied on the PICK, so
                // a slab changed by hand on Commercial stays until the vendor is changed again;
                // an import PO and a side with no known state leave it as it is.
                const kind = poType === "local" ? gstKindFor(gstPlaces?.vendors[v], gstPlaces?.unit) : null;
                if (kind) setGst((cur) => slabOfKind(kind, gstSlab(cur).pct));
              }}
            />
            <span aria-hidden className="mx-0.5 hidden h-5 w-px shrink-0 bg-[#dde4eb] sm:block" />
            {/* THE THREE STATUS PILLS SHOW THEIR ICON ALONE until used (2026-10-29, screenshot
                120804), name on hover: they only narrow the tick list, and their ~210px is
                what lets every chosen pill keep its value on one row. */}
            <FilterPill
              label="Order by"
              family="status"
              icon={Clock}
              collapse
              wide
              disabled={!anyClass}
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
              collapse
              disabled={!anyClass}
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
              collapse
              disabled={!anyClass}
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
          {!anyClass ? null : (
            <div className="border-t border-[#dde4eb] px-2 pt-1">
              <Tabs
                defaultKey="items"
                items={[
                  {
                    key: "items",
                    label: "Items",
                    problems: vendorId ? unpriced : 0,
                    content: (
                      <div className="-mx-2 -mt-4 md:grid md:grid-cols-[11.5rem_minmax(0,1fr)]">
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
                          {fieldErrors.orders ? (
                            <div className="px-2.5 pb-1.5">
                              <FieldError>{fieldErrors.orders}</FieldError>
                            </div>
                          ) : null}
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
                        <div className={cn("min-w-0 p-2", DENSE)}>
                          {selKey === "items" ? (
                            <div className="space-y-2">
                              {/* default-row: exempt -- one row per item across the ticked orders, derived; nothing is added here */}
                              <ChildGrid<ItemGroup>
                                columns={itemColumns}
                                bodyClassName={INDEX_ON_LINE}
                                rows={itemGroups}
                                // Hug the content (user 2026-10-31, screenshot 120815): no pane-wide Item column.
                                autoFit
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
                                    bodyClassName={INDEX_ON_LINE}
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
                        gstHint={gstHint}
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
          its own: the bags, rolls and dia are written by the PO's Save.
          FABRIC IS ONE ROW OF SEVEN (user 2026-10-28: "in single row") — Dia · GSM · Gauge · Ply ·
          LL (cm) · Rolls · PO weight (Ply split off Gauge 2026-10-31), 7 × 112 + 6 × 12 gaps = 856 + px-5 (40) + border = ~900px,
          so it opens wider than `sm`; yarn's three boxes stay `sm`. */}
      <Sheet
        open={!!qtySheetRow}
        onClose={() => setQtySheet(null)}
        size={qtySheetRow && lineKindOf(qtySheetRow.item_class) === "fabric" ? "md" : "sm"}
        maxWidthClass={qtySheetRow && lineKindOf(qtySheetRow.item_class) === "fabric" ? "max-w-[900px]" : undefined}
        alignToPane
        origin={qtySheet?.origin ?? null}
        title={
          qtySheetRow
            ? qtySheetRow.item_name
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
              const unit = (r.uom_code ?? "kg").toLowerCase();
              /* ONE LAYOUT FOR BOTH, EVERY BOX THE SAME (user 2026-10-28, screenshot 3815: "clean,
                 aligned, remove duplicate words"). Three boxes on one row, the unit said once in
                 each label, the item only in the title, one muted line under the row. The weight
                 was a borderless grid cell inside a hand-drawn border, so it stood shorter and
                 differently boxed than Rolls and Dia beside it. */
              const weightBox = (
                <Field label={`PO weight (${unit})`} htmlFor={`rpo-sqty-${r.key}`}>
                  <Input
                    id={`rpo-sqty-${r.key}`}
                    type="number"
                    min={0}
                    inputMode="decimal"
                    className={cn("text-right tabular-nums", over > 0 && "font-semibold text-[#8a5800]")}
                    disabled={r.row.skip}
                    value={r.row.skip ? "0" : r.row.qty}
                    onChange={(e) => {
                      if (inBags) return setBagQty(r, e.target.value);
                      const typed = num(e.target.value);
                      // Spec 6: excess is never possible — a figure above the balance snaps back to it.
                      setRow(r, { qty: e.target.value === "" ? "" : typed > r.balance_qty ? String(capQty(typed, r.balance_qty)) : e.target.value });
                    }}
                  />
                </Field>
              );
              const fact = (label: string, value: ReactNode) => (
                <div>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-semibold tabular-nums">{value}</dd>
                </div>
              );
              return (
                <div className="space-y-4">
                  {/* What it is typed against — read, never typed. */}
                  <dl className="grid grid-cols-3 gap-3 rounded-md border border-[#dde4eb] bg-[#fafbfc] px-3 py-2 text-sm">
                    {fact(`Required (${unit})`, fmtNumber(r.required_qty))}
                    {fact(`To order (${unit})`, fmtNumber(r.balance_qty))}
                  </dl>
                  {kind === "yarn" ? (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-3 gap-3">
                        <Field label="Bag weight (kg)" htmlFor={`rpo-bw-${r.key}`}>
                          <Input
                            id={`rpo-bw-${r.key}`}
                            type="number"
                            min={0}
                            inputMode="decimal"
                            className="text-right tabular-nums"
                            value={r.row.bagWt ?? ""}
                            onChange={(e) => setBagWeight(r, e.target.value)}
                          />
                        </Field>
                        <Field label="Bags" htmlFor={`rpo-bags-${r.key}`}>
                          <Input
                            id={`rpo-bags-${r.key}`}
                            type="number"
                            min={0}
                            step={1}
                            max={bw > 0 ? maxBags(r.balance_qty, bw) : undefined}
                            inputMode="numeric"
                            className="text-right tabular-nums"
                            disabled={!(bw > 0)}
                            title={bw > 0 ? `At most ${maxBags(r.balance_qty, bw)}` : "Type the bag weight first"}
                            value={r.row.bags ?? ""}
                            onChange={(e) => setBags(r, e.target.value, r.row.bagWt ?? "")}
                          />
                        </Field>
                        {weightBox}
                      </div>
                      <p className={cn("text-xs", over > 0 ? "text-[#8a5800]" : "text-muted-foreground")}>
                        {over > 0
                          ? `${over} ${unit} over To order — allowed, up to one bag.`
                          : "Bags × bag weight. Type less for a part-filled last bag."}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                    {/* THE SPEC'S SEQUENCE (user 2026-10-30; Ply apart 2026-10-31): Dia · GSM · Gauge · Ply · LL (cm)
                        · Rolls · Weight. Dia and GSM are the plan's and LOCKED — Dia off the
                        requirement row, GSM off the order's colourway; the save reads both off
                        the plan, so the lock is not only on screen. Gauge and Loop length are
                        TYPED here (user 2026-10-30: "only for PO" — taken off Fabric BOM ▸
                        Manual entry), pre-filled from a BOM entry that held one before then. A
                        readOnly Input drops out of Tab, so Tab lands on Gauge. */}
                    <div className="grid grid-cols-7 gap-3">
                      <Field label="Dia" htmlFor={`rpo-dia-${r.key}`}>
                        <Input id={`rpo-dia-${r.key}`} readOnly title="From the Fabric BOM" value={diaOf(r)} />
                      </Field>
                      <Field label="GSM" htmlFor={`rpo-gsm-${r.key}`}>
                        <Input
                          id={`rpo-gsm-${r.key}`}
                          readOnly
                          title="From the order's colourway"
                          className="text-right tabular-nums"
                          value={r.gsm != null ? String(r.gsm) : ""}
                        />
                      </Field>
                      {/* PLY AND GAUGE APART (user 2026-10-31): one "Ply / Gauge" box carried
                          both as one string; each is its own field and its own PO column now. */}
                      <Field label="Gauge" htmlFor={`rpo-gauge-${r.key}`}>
                        <Input
                          id={`rpo-gauge-${r.key}`}
                          maxLength={40}
                          value={gaugeOf(r)}
                          onChange={(e) => setRow(r, { gauge: e.target.value })}
                        />
                      </Field>
                      <Field label="Ply" htmlFor={`rpo-ply-${r.key}`}>
                        <Input
                          id={`rpo-ply-${r.key}`}
                          maxLength={40}
                          value={r.row.ply ?? ""}
                          onChange={(e) => setRow(r, { ply: e.target.value })}
                        />
                      </Field>
                      {/* LL (cm), FREE TEXT (user 2026-10-31): "2.80", "2.85-2.90", "AS PER
                          SAMPLE" — no number type, nothing refused. Was "Loop length (mm)". */}
                      <Field label="LL (cm)" htmlFor={`rpo-loop-${r.key}`}>
                        <Input
                          id={`rpo-loop-${r.key}`}
                          maxLength={40}
                          value={loopOf(r)}
                          onChange={(e) => setRow(r, { loopLength: e.target.value })}
                        />
                      </Field>
                      <Field label="Rolls" htmlFor={`rpo-rolls-${r.key}`}>
                        <Input
                          id={`rpo-rolls-${r.key}`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          className="text-right tabular-nums"
                          value={r.row.rolls ?? ""}
                          onChange={(e) => setRow(r, { rolls: e.target.value })}
                        />
                      </Field>
                      {weightBox}
                    </div>
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
        {/* COMPACT (user 2026-10-29: "why this much large"): figures 12.5px, the Total
            box 28px tall at 14px, the status chip 28px at 12px medium. */}
        <dl className="flex items-center gap-3 text-[12.5px] whitespace-nowrap tabular-nums">
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
          <div className="flex h-7 items-baseline gap-2 rounded-control border border-[#b9dcf0] bg-[#e8f3fb] px-2.5 leading-7 text-[#035c8c]">
            <dt className="text-[11px] font-semibold tracking-wide uppercase">Total</dt>
            <dd className="text-[14px] font-bold">
              {cur} {fmtFixed(totals.total + charges, 2)}
            </dd>
          </div>
        </dl>
        {/* No chip while a FIELD is what's missing — that warning is under the field. */}
        <div className="flex min-w-0 flex-1">
          {hint ? (
            <span
              role="status"
              className={cn("inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium", HINT_CHIP.box)}
            >
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", HINT_CHIP.dot)} />
              {/* A missing rate is a place to go: the words are a link to that box.
                  tabIndex -1 — Tab lands on fields only (lib/focus.ts). */}
              {unpriced > 0 && priceTarget && !fieldBlocked && active.length > 0 && undated === 0 ? (
                <button type="button" tabIndex={-1} onClick={() => openRe(priceTarget)} className="min-w-0 underline-offset-2 hover:underline">
                  <Truncated className="min-w-0">{hint}</Truncated>
                </button>
              ) : (
                <Truncated className="min-w-0">{hint}</Truncated>
              )}
            </span>
          ) : null}
        </div>
        {/* "Go to next blank rate" and "Save draft" are gone (user 2026-10-29): the chip
            already says how many rates are left, and the work autosaves (see `draft`). */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            draft.clear();
            if (onCancel) onCancel();
            else router.push("/purchase/orders");
          }}
        >
          Cancel
        </Button>
        {/* "Submit" whichever way it goes (user 2026-10-28) — red while the strip says MD. */}
        <Button type="button" variant={goesToMd ? "danger" : "primary"} disabled={!canSubmit} onClick={() => save("submit")}>
          Submit
        </Button>
      </div>
      </div>
    </div>
  );
}
