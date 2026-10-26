"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Ban, Boxes, Check, ChevronRight, Lock, Undo2, X } from "lucide-react";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { FilterPill, type FilterPillOption } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useAccordion } from "@/lib/ui/use-accordion";
import { focusField } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { today } from "@/lib/calendar";
import { fmtDate, fmtFixed, fmtNumber } from "@/lib/format";
import { checkRatesAgainstBudget, savePoFromRequirement } from "@/lib/purchase/re-po/actions";
import { CommercialSection, blankCommercial, chargesNet, chargesToSave, type CommercialValue } from "./commercial-section";
import {
  BUDGET_STATES,
  INSPECTION_DAYS,
  KIND_OPTIONS,
  NO_BUYER,
  NO_FILTERS,
  ORDER_BY_BANDS,
  PROGRESS_STATES,
  addDays,
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
  capQty,
  gstSlab,
  lineDescription,
  lineKeyOf,
  poTotals,
  type BudgetFlag,
  type ClassVendor,
  type RequirementLine,
} from "@/lib/purchase/re-po/types";

/**
 * RAISE PO (PO from Requirement) — the plain form the client chose (2026-10-23,
 * after three richer mockups were turned down as "non user friendly"): the
 * requirement lines list themselves, the Purchase Manager types the rate.
 *
 * FILTERS ON TOP (user 2026-10-26, canvas "PO Order Filters" v6). One row of
 * `FilterPill`s — Item Class · Vendor │ Order by · Type · Category · Budget ·
 * Buyer · Progress — and under it the orders as a TICK LIST, which replaced the
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

type RowState = { qty: string; rate: string; date: string; skip?: boolean };

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

  const [classId, setClassId] = useState(
    () => (initialOrderId ? lines.find((l) => l.source_id === initialOrderId)?.item_class_id : null) ?? "",
  );
  /** The TICKED orders — what this PO carries, in the order they were ticked. */
  const [orderIds, setOrderIds] = useState<string[]>(() => (initialOrderId ? [initialOrderId] : []));
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
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
      const c = byClass.get(l.item_class_id) ?? { label: l.item_class ?? "—", orders: new Set<string>() };
      c.orders.add(l.source_id);
      byClass.set(l.item_class_id, c);
    }
    // The classes with something to buy first, so the greyed ones never push them down.
    return [...byClass.entries()]
      .sort((a, b) => Number(b[1].orders.size > 0) - Number(a[1].orders.size > 0) || a[1].label.localeCompare(b[1].label))
      .map(([value, c]) => ({ value, label: c.label, count: c.orders.size }));
  }, [lines, itemClasses]);
  const classLines = useMemo(() => lines.filter((l) => l.item_class_id === classId), [lines, classId]);

  /* THE VENDOR IS CHOSEN, NEVER ASSUMED (V7 point 5). Best on-time first, so the
     reliable vendor is the one at the top — with its lead days beside it, because a
     slow vendor on an urgent order is a mistake you can only avoid if you see it. */
  const classVendors = useMemo(
    () =>
      (vendorsByClass[classId] ?? [])
        .slice()
        .sort((a, b) => (b.on_time_pct ?? -1) - (a.on_time_pct ?? -1) || a.name.localeCompare(b.name)),
    [vendorsByClass, classId],
  );
  const vendor = classVendors.find((v) => v.id === vendorPick) ?? null;
  const vendorId = vendor?.id ?? "";
  const vendorName = vendor?.name ?? "";
  /* LEAD DAYS FOR "ORDER BY": the chosen vendor's, else the SLOWEST of the class —
     before a vendor is chosen, an order is only "in time" if it is in time for all. */
  const leadDays = vendor ? (vendor.lead_days ?? 0) : Math.max(0, ...classVendors.map((v) => v.lead_days ?? 0));

  // ---------- the orders and the filters ----------
  const facts = useMemo(() => orderFacts(classLines, budgeted, draftHolds, lineKeyOf), [classLines, budgeted, draftHolds]);
  const daysLeft = new Map(facts.map((o) => [o.id, daysToOrder(o.shipDate, poDate, leadDays)] as const));
  const bands = new Map<string, OrderByBand>(facts.map((o) => [o.id, orderByBand(daysLeft.get(o.id) ?? null)]));
  const visible = visibleOrders(facts, bands, filters, orderIds);
  const anyFilter = Object.values(filters).some(Boolean);
  const count = (k: FilterKey, v: string) => countFor(facts, bands, filters, k, v);
  const anyCount = (k: FilterKey) => facts.filter((o) => passes(o, filters, bands.get(o.id) ?? "nodate", k)).length;
  const setFilter = (k: FilterKey, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const categoryOptions: FilterPillOption[] = (() => {
    const byCat = new Map<string, string>();
    for (const l of classLines) if (l.category_id) byCat.set(l.category_id, l.category ?? "—");
    return [...byCat.entries()]
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
  const inOrders = filters.category ? inClassOrders.filter((l) => l.category_id === filters.category) : inClassOrders;

  /**
   * A LINE'S DEFAULT DELIVERY, and why (V7 point 6). The chosen vendor's lead days
   * when it has them — PO date + lead. WITHOUT them (user 2026-10-26, screenshot 3720:
   * "why not enabled for sending to MD" — a vendor with no lead days left all 9 lines
   * blank and Submit locked), the latest the material can arrive and still be in time:
   * the order's ship date less the inspection days, never before the PO date. Blank
   * only when there is neither — then the line must be typed.
   */
  type DeliveryDefault = { date: string; why: string };
  const defaultFor = (shipDate: string | null): DeliveryDefault | null => {
    if (vendor && vendor.lead_days != null)
      return { date: addDays(poDate, vendor.lead_days), why: `PO date + ${vendor.lead_days} days lead (${vendor.name})` };
    if (shipDate) {
      const byShip = addDays(shipDate, -INSPECTION_DAYS);
      return {
        date: byShip < poDate ? poDate : byShip,
        why: byShip < poDate ? "As soon as possible — the order is already late" : `Ship date ${fmtDate(shipDate)} less ${INSPECTION_DAYS} days inspection`,
      };
    }
    return null;
  };
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
        row: rows[key] ?? { qty: String(l.balance_qty), rate: "", date: "" },
      };
    });

  const num = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };
  const fx = poType === "import" ? num(exRate) : 1;
  const isActive = (r: GridRow) => r.supplied && !r.row.skip && num(r.row.qty) > 0;
  const active = gridRows.filter(isActive);
  const unpriced = active.filter((r) => num(r.row.rate) <= 0).length;
  const undated = active.filter((r) => !(r.row.date || defaultFor(r.delivery_date))).length;
  const slab = gstSlab(gst);
  const totals = poTotals(active.map((r) => ({ qty: num(r.row.qty), rate: num(r.row.rate) })), slab.pct);
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
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById(rateId(first.key));
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
  /** One edit to every order line under an item — the item-wise rate and delivery. */
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

  /** One line, the item then its slice · colour in grey — not two stacked lines (V6). */
  const itemCell = (name: string, spec: string, struck = false) => (
    <div className={cn("flex min-w-0 items-baseline gap-1.5", struck && "text-muted-foreground line-through")}>
      <Truncated className="min-w-0 shrink text-sm font-medium">{name}</Truncated>
      {spec ? <Truncated className="min-w-0 shrink-[2] text-xs text-muted-foreground">{spec}</Truncated> : null}
    </div>
  );
  /** THE ONE COLUMN TO TYPE IN is tinted (V6) — the cells around it are read, this is filled. */
  const RATE_COL = "bg-[#fffaeb]";

  // ---------- grid ----------
  /*
   * A TIGHT TABLE (user 2026-10-24, screenshot 3704). 200 + 72 + 88 + 88 + 144 + 112
   * + 72 = 776, + 40 chrome = 816 (no Budget column since 2026-10-26 — see Amount),
   * so it fits beside the 17rem order list with no sideways scroll; ChildGrid's DEFAULT switch (a table from a
   * 512px pane, cards below it on a phone).
   *
   * NO ORDER COLUMN: the list on the left names the order on screen. NO BALANCE COLUMN
   * (screenshot 3692): Qty starts AT the balance and cannot pass it; where the balance
   * comes from is the Qty cell's tooltip.
   */
  const poLineColumns: ChildGridColumn<GridRow>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.name,
      cell: (r) =>
        itemCell(r.item_name, lineDescription({ item_name: "", slice_label: r.slice_label, colour: r.colour }).replace(/^ · /, ""), r.row.skip),
    },
    { header: "UOM", width: FIELD_WIDTH_CSS.num, cell: (r) => <span className="text-sm">{r.uom_code ?? ""}</span> },
    {
      // "Qty", not "Order Qty": the longer label is wider than `hug` on one line.
      header: "Qty",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <Input
          type="number"
          min={0}
          max={r.balance_qty}
          inputMode="decimal"
          aria-label={`Order qty, ${lineDescription(r)}, at most ${r.balance_qty}`}
          title={`At most ${fmtNumber(r.balance_qty)} ${r.uom_code ?? ""}: ${fmtNumber(r.required_qty)} on the requirement sheet${r.ordered_qty > 0 ? `, less ${fmtNumber(r.ordered_qty)} already on other POs` : ""}`}
          className={cn(CELL_INPUT, "text-right tabular-nums")}
          disabled={r.row.skip}
          value={r.row.skip ? "0" : r.row.qty}
          onChange={(e) => {
            const typed = num(e.target.value);
            // Spec 6: excess is never possible — a figure above the balance snaps back to it.
            setRow(r, { qty: e.target.value === "" ? "" : typed > r.balance_qty ? String(capQty(typed, r.balance_qty)) : e.target.value });
          }}
        />
      ),
    },
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
          disabled={r.row.skip}
          value={r.row.rate}
          onChange={(e) => setRow(r, { rate: e.target.value })}
        />
      ),
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
      width: FIELD_WIDTH_CSS.range,
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
        date: dates.length === 1 ? dates[0] : (def?.date ?? ""),
        amount: act.reduce((a, m) => a + num(m.row.qty) * num(m.row.rate), 0),
        orders: ms.length,
        above: act.filter((m) => flags[m.key]?.above).length,
      });
    }
  }
  const openItem = itemGroups.find((g) => g.key === itemFold.openKey) ?? null;

  /*
   * 200 + 72 + 88 + 88 + 88 + 144 + 112 + 112 = 904, + 40 chrome = 944, on the same
   * default switch as the order grid (see its note). The rate and delivery typed here go to every order line
   * under the item; the breakup below edits one order at a time.
   */
  const itemColumns: ChildGridColumn<ItemGroup>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.party,
      cell: (g) => itemCell(g.item_name, g.spec),
    },
    { header: "UOM", width: FIELD_WIDTH_CSS.num, cell: (g) => <span className="text-sm">{g.uom_code ?? ""}</span> },
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
      header: "Total Qty",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (g) => <span className="text-sm font-medium tabular-nums">{g.qty > 0 ? fmtNumber(g.qty) : ""}</span>,
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
          disabled={!g.supplied}
          value={g.rate}
          onChange={(e) => setMembers(g.members, { rate: e.target.value })}
        />
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
      width: FIELD_WIDTH_CSS.range,
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
    ...poLineColumns.filter((c) => ["Qty", "Delivery", "Amount", ""].includes(c.header)),
  ];

  const canSave =
    !isPending && !!classId && orderIds.length > 0 && !!vendorId && active.length > 0 && undated === 0 && (poType === "local" || num(exRate) > 0);
  const canSubmit = canSave && unpriced === 0;
  const hint = !classId
    ? "Choose the item class."
    : orderIds.length === 0
      ? "Tick the orders for this PO."
      : !vendorId
        ? classVendors.length === 0
          ? `No bought-item vendor is mapped to ${classOptions.find((c) => c.value === classId)?.label ?? "this class"} — add one in Master Data ▸ Vendors.`
          : "Choose the vendor. Its lead days set each line's delivery."
        : active.length === 0
          ? "Every line is skipped or 0 — there is nothing to order."
          : undated > 0
            ? `Type the delivery date on ${undated} line${undated === 1 ? "" : "s"} — the order has no ship date and ${vendorName} no lead days.`
            : poType === "import" && num(exRate) <= 0
              ? "Type the exchange rate."
              : unpriced > 0
                ? "Submit opens once every rate is typed."
                : goesToMd
                  ? `Above Approved Budget on ${above} line(s)${unbudgeted ? `, no approved budget on ${unbudgeted}` : ""} — Submit saves the PO and sends it to the MD; printing stays locked.`
                  : "Every rate is within budget — Submit approves the PO by rule.";
  /* THE BAR'S MESSAGE IS A STATUS CHIP (user 2026-10-26: "make it better, single row,
     better colouring"): amber = something still to do, red = Submit goes to the MD,
     green = ready. Fixed colour pairs, as in FilterPill — the skin cannot repaint them. */
  const hintKind: "todo" | "md" | "ready" =
    unpriced > 0 || !vendorId || undated > 0 || orderIds.length === 0 || !classId || active.length === 0 ? "todo" : goesToMd ? "md" : "ready";
  const HINT_CHIP = {
    todo: { box: "border-[#f1d48a] bg-[#fff7e0] text-[#8a5800]", dot: "bg-[#d9a400]" },
    md: { box: "border-[#f5b8b0] bg-[#fdecea] text-[#b42318]", dot: "bg-[#d92d20]" },
    ready: { box: "border-[#a6dcb9] bg-[#e8f6ee] text-[#14803f]", dot: "bg-[#14803f]" },
  }[hintKind];
  const charges = chargesNet(commercial);

  const itemsToPrice = itemGroups.filter((g) => g.supplied && g.qty > 0 && !g.rate && !g.mixedRate).length;

  const rePane = (g: (typeof groups)[number]) => (
    // default-row: exempt -- the rows are the order's requirement lines, derived; nothing is added here
    <ChildGrid<GridRow>
      columns={poLineColumns}
      rows={g.rows}
      flatRows
      hideAdd
      hideRemove
      keepOne={false}
      onAdd={() => false}
      onRemove={() => {}}
      frameless
      headerClassName={GRID_HEAD}
    />
  );

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
          {/* THE FILTER ROW (canvas v6). Item Class and Vendor lead it as required pills;
              the rest only narrow the tick list below. Counts are "what this choice would
              leave", so a greyed choice is one that would empty the list. */}
          <div className="flex flex-wrap items-center gap-1 border-t border-[#dde4eb] bg-[#fafbfc] px-4 py-2">
            {/* PO TYPE LEADS THE ROW (user 2026-10-26: "type local/import also as filter,
                move it before item class"). Always set, so it never holds the cursor. */}
            <FilterPill
              id="rpo-type"
              label="PO Type"
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
            <FilterPill
              id="rpo-class"
              label="Item Class"
              required
              options={classOptions}
              value={classId}
              /* EVERY CLASS PICKS (user 2026-10-26: "why the remaining item class in disable
                 mode"). Greyed read as broken; the 0 beside a class already says it has nothing
                 pending, and picking it says so again in the list below. */
              zeroPickable
              emptyText="No requirement sheet has anything left to buy"
              onChange={(v) => {
                if (v === classId) return;
                setDirty(true);
                setClassId(v);
                // A new class keeps only the ticked orders that still have something of it to buy;
                // its vendors and categories are its own, so neither carries across.
                setOrderIds((prev) => prev.filter((id) => lines.some((l) => l.source_id === id && l.item_class_id === v)));
                setVendorPick("");
                setFilters((f) => ({ ...f, category: "", buyer: "" }));
              }}
            />
            <FilterPill
              id="rpo-vendor"
              label="Vendor"
              required
              wide
              placeholder="Choose vendor"
              disabled={!classId}
              options={classVendors.map((v) => ({
                value: v.id,
                label: v.name,
                sublabel: [
                  v.lead_days == null ? "no lead days set" : `${v.lead_days} d lead`,
                  v.on_time_pct == null ? "no deliveries yet" : `${v.on_time_pct}% on time`,
                ].join(" · "),
              }))}
              value={vendorId}
              emptyText="No bought-item vendor for this class — add one in Master Data ▸ Vendors"
              onChange={(v) => {
                setDirty(true);
                setVendorPick(v);
              }}
            />
            <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-[#dde4eb] sm:block" />
            <FilterPill
              label="Order by"
              wide
              disabled={!classId}
              note={leadNote}
              tone={filters.orderBy === "late" ? "danger" : undefined}
              options={ORDER_BY_BANDS.map((b) => ({ ...b, count: count("orderBy", b.value), tone: b.value === "late" ? "danger" : undefined }))}
              anyCount={anyCount("orderBy")}
              value={filters.orderBy}
              onChange={(v) => setFilter("orderBy", v)}
            />
            <FilterPill
              // "Order Type", not "Type": PO Type (Local / Import) leads the same row.
              label="Order Type"
              disabled={!classId}
              options={KIND_OPTIONS.map((k) => ({ ...k, count: count("kind", k.value) }))}
              anyCount={anyCount("kind")}
              value={filters.kind}
              onChange={(v) => setFilter("kind", v)}
            />
            <FilterPill
              label="Category"
              disabled={!classId || categoryOptions.length === 0}
              options={categoryOptions}
              anyCount={anyCount("category")}
              value={filters.category}
              onChange={(v) => setFilter("category", v)}
            />
            <FilterPill
              label="Budget"
              disabled={!classId}
              options={BUDGET_STATES.map((b) => ({ ...b, count: count("budget", b.value) }))}
              anyCount={anyCount("budget")}
              value={filters.budget}
              onChange={(v) => setFilter("budget", v)}
            />
            <FilterPill
              label="Buyer"
              wide
              disabled={!classId}
              options={buyerOptions}
              anyCount={anyCount("buyer")}
              value={filters.buyer}
              onChange={(v) => setFilter("buyer", v)}
            />
            <FilterPill
              label="Progress"
              disabled={!classId}
              options={PROGRESS_STATES.map((p) => ({ ...p, count: count("progress", p.value) }))}
              anyCount={anyCount("progress")}
              value={filters.progress}
              onChange={(v) => setFilter("progress", v)}
            />
          </div>


          {!classId ? null : (
            <div className="border-t border-[#dde4eb] md:grid md:grid-cols-[12.5rem_minmax(0,1fr)]">
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
                          rows={openItem.members}
                          flatRows
                          hideAdd
                          hideRemove
                          keepOne={false}
                          onAdd={() => false}
                          onRemove={() => {}}
                          frameless
                          headerClassName={GRID_HEAD}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : activeGroup ? (
                  rePane(activeGroup)
                ) : orderIds.length && gridRows.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">
                    {filters.category ? "Nothing of this category left to buy on the ticked orders." : "Nothing left to buy on the ticked orders."}
                  </p>
                ) : (
                  <p className="grid h-full min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">
                    Tick orders on the left. Their lines list here with the balance filled in; only the rate is typed.
                  </p>
                )}
              </div>
            </div>
          )}

      {/* COMMERCIAL, after the rates and before Submit to MD (user 2026-10-26). */}
      {orderIds.length ? (
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
      ) : null}

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
