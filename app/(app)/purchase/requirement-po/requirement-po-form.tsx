"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Lock } from "lucide-react";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/segmented";
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
 * PO FROM REQUIREMENT — the plain form the client chose (2026-10-23, after three
 * richer mockups were turned down as "non user friendly"): RE numbers in ONE
 * multi-choice dropdown, the requirement lines list themselves, the Purchase
 * Manager types the rate. Canvas: claude.ai artifact RViuS3PdDiYsLwFPbK9c8z (V4).
 *
 * What the screen shows and what decides it:
 * - Items, units and balances are the requirement sheet's — never typed.
 * - Order Qty starts at the balance and can be lowered for a part order; typed
 *   above the balance it snaps back (spec 6). 0 = "not on this PO".
 * - The budget rate is never sent here. Each priced line is asked of the server
 *   (`checkRatesAgainstBudget`) and comes back as within / above / no budget.
 * - Submit: all within → approved by rule; anything above (or unbudgeted) → MD.
 *   `savePoFromRequirement` decides that again from the database.
 */

type RowState = { qty: string; rate: string; date: string };

/**
 * THE GRID HEADER IN THE ORDERS TABLE BAND (user 2026-10-23, screenshot 3697): the
 * soft blue `--table-head-bg` every `DataTable` header wears, labels on ONE line.
 * `ChildGrid`'s own header is white and wraps a label that is wider than its column
 * ("ORDER / QTY" on two lines), so both are set here through `headerClassName`.
 */
const GRID_HEAD = "whitespace-nowrap bg-[var(--table-head-bg)]";
type GridRow = RequirementLine & { key: string; row: RowState; /** the chosen vendor supplies this line's class */ supplied: boolean };

const CURRENCIES = ["USD", "EUR", "GBP"] as const;

export function RequirementPoForm({
  lines,
  vendorsByClass,
  nextPoNo,
}: {
  lines: RequirementLine[];
  vendorsByClass: Record<string, ClassVendor[]>;
  /** HO/PO/26-27/0001 — the number this PO will take on Save (0745, a preview). */
  nextPoNo: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [vendorPick, setVendorPick] = useState("");
  const [poType, setPoType] = useState<"local" | "import">("local");
  const [currency, setCurrency] = useState<string>("USD");
  const [exRate, setExRate] = useState("");
  const [gst, setGst] = useState<string>("c12");
  const [paymentTerms, setPaymentTerms] = useState("30 DAYS FROM GRN");
  const [dateAll, setDateAll] = useState(() => today());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [flags, setFlags] = useState<Record<string, BudgetFlag>>({});
  const [dirty, setDirty] = useState(false);
  /* ONE RE OPEN AT A TIME (user 2026-10-23, screenshot 3694: "like fabric and process
     for every single fabric — RE number 1 filled then automatically open RE number 2,
     close it"). The app's fold rule, `useAccordion`; the auto-advance is below. */
  const fold = useAccordion(null);
  /* ITEM-WISE (client via user 2026-10-23: "multi order, multiple item — we are missing
     the multiple item concept"). The same item needed by several orders is ONE line to
     the vendor. `viewPick` is the operator's choice; until they make one, two or more
     orders open item-wise and a single order order-wise. One item's breakup open at a
     time — the app's fold rule again. */
  const [viewPick, setViewPick] = useState<"order" | "item" | null>(null);
  const itemFold = useAccordion(null);
  const advancedRef = useRef<Record<string, boolean>>({});

  useUnsavedGuard(dirty || isPending);

  // ---------- options ----------
  const reOptions = useMemo(() => {
    const byOrder = new Map<string, { re: string; customer: string; n: number }>();
    for (const l of lines) {
      const o = byOrder.get(l.source_id) ?? { re: l.source_no, customer: l.customer ?? "", n: 0 };
      o.n++;
      byOrder.set(l.source_id, o);
    }
    return [...byOrder.entries()]
      .sort((a, b) => a[1].re.localeCompare(b[1].re))
      // SHORT: the label is also what the closed trigger reads (summarizeLabels), so
      // two picks must fit one 288px box — "HO/RE/26-27/0003 (4)". The buyer is
      // the RE's, and the RE number is what the manager picks by.
      .map(([id, o]) => ({ id, label: `${o.re} (${o.n})` }));
  }, [lines]);

  const chosen = new Set(orderIds);
  const inOrders = lines.filter((l) => chosen.has(l.source_id));
  /*
   * ITEM CLASS IS THE LINE'S, NOT THE PO'S (user 2026-10-23: "class is indicating in
   * top which is the requirement item class — it should come under the table").
   * The header no longer asks for it. The VENDOR decides what this PO carries:
   * the list is every bought-item vendor who supplies ANY class in the chosen
   * orders (spec point 2 — still filtered by "Is Bought Item Vendor" + class), and
   * once one is picked, the lines in a class that vendor does not supply stay on
   * screen, greyed, not ordered — their balance waits for another vendor's PO.
   */
  const classNames = new Map(
    inOrders.filter((l) => l.item_class_id).map((l) => [l.item_class_id as string, l.item_class ?? "—"] as const),
  );
  const vendorClasses = new Map<string, { vendor: ClassVendor; classIds: Set<string> }>();
  for (const classId of classNames.keys()) {
    for (const v of vendorsByClass[classId] ?? []) {
      const e = vendorClasses.get(v.id) ?? { vendor: v, classIds: new Set<string>() };
      e.classIds.add(classId);
      vendorClasses.set(v.id, e);
    }
  }
  const vendorList = [...vendorClasses.values()].sort((a, b) => a.vendor.name.localeCompare(b.vendor.name));
  // A single vendor for everything chosen picks itself — there is nothing to choose.
  const vendorId = vendorClasses.has(vendorPick) ? vendorPick : vendorList.length === 1 ? vendorList[0].vendor.id : "";
  const vendorName = vendorClasses.get(vendorId)?.vendor.name ?? "";
  const suppliedClasses = vendorClasses.get(vendorId)?.classIds ?? new Set<string>();
  const shortClass = (c: string) => c.replace(/\s+ACCESSORIES$/i, "").toLowerCase().replace(/^./, (x) => x.toUpperCase());
  const vendorOptions: ComboboxOption[] = vendorList.map(({ vendor: v, classIds }) => ({
    value: v.id,
    label: v.name,
    sublabel: [
      [...classIds].map((id) => shortClass(classNames.get(id) ?? "")).join(" · "),
      v.on_time_pct == null ? "no deliveries yet" : `${v.on_time_pct}% on time`,
    ].join(" · "),
    search: v.code,
  }));

  const gridRows: GridRow[] = inOrders
    // Class first, then item, so a band's lines read class by class.
    .slice()
    // The vendor's own classes first, then the rest (greyed); within each, class then item.
    .sort(
      (a, b) =>
        Number(!!b.item_class_id && suppliedClasses.has(b.item_class_id)) -
          Number(!!a.item_class_id && suppliedClasses.has(a.item_class_id)) ||
        (a.item_class ?? "").localeCompare(b.item_class ?? "") ||
        a.item_name.localeCompare(b.item_name),
    )
    .map((l) => {
      const key = lineKeyOf(l);
      return {
        ...l,
        key,
        supplied: !!vendorId && !!l.item_class_id && suppliedClasses.has(l.item_class_id),
        row: rows[key] ?? { qty: String(l.balance_qty), rate: "", date: "" },
      };
    });

  const num = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };
  const fx = poType === "import" ? num(exRate) : 1;
  const active = gridRows.filter((r) => r.supplied && num(r.row.qty) > 0);
  const unpriced = active.filter((r) => num(r.row.rate) <= 0).length;
  const slab = gstSlab(gst);
  const totals = poTotals(active.map((r) => ({ qty: num(r.row.qty), rate: num(r.row.rate) })), slab.pct);
  const above = active.filter((r) => flags[r.key]?.above).length;
  const unbudgeted = active.filter((r) => num(r.row.rate) > 0 && flags[r.key] && !flags[r.key].hasBudget).length;
  const goesToMd = above + unbudgeted > 0;
  const cur = poType === "import" ? currency : "₹";

  // ---------- one fold per RE ----------
  const groups = [...new Set(gridRows.map((r) => r.source_id))].map((id) => {
    const rs = gridRows.filter((r) => r.source_id === id);
    const act = rs.filter((r) => r.supplied && num(r.row.qty) > 0);
    const priced = act.filter((r) => num(r.row.rate) > 0).length;
    return {
      id,
      re: rs[0].source_no,
      customer: rs[0].customer ?? "",
      delivery: rs[0].delivery_date,
      rows: rs,
      active: act.length,
      priced,
      // COMPLETE = every line being ordered has its rate. A fold with nothing to order is not
      // "complete" — it must never trigger the move to the next one.
      done: act.length > 0 && priced === act.length,
      subtotal: act.reduce((a, r) => a + num(r.row.qty) * num(r.row.rate), 0),
      above: act.filter((r) => flags[r.key]?.above).length,
      unbudgeted: act.filter((r) => num(r.row.rate) > 0 && flags[r.key] && !flags[r.key].hasBudget).length,
    };
  });
  const groupIdsSig = groups.map((g) => g.id).join("|");
  const completeSig = groups.map((g) => `${g.id}:${g.done}`).join("|");
  const openGroup = groups.find((g) => g.id === fold.openKey);
  const openSig = openGroup ? openGroup.rows.map((r) => `${r.row.qty}/${r.row.rate}`).join("|") : "";

  /* A NEW SET OF REs (or class) OPENS THE FIRST ONE STILL TO PRICE. Keyed on the ids
     only, so shutting a fold by hand is not undone by the next render. */
  useEffect(() => {
    if (groups.length === 0) return;
    if (!groups.some((g) => g.id === fold.openKey)) fold.setOpenKey((groups.find((g) => !g.done) ?? groups[0]).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdsSig]);

  /* RE FILLED → NEXT RE. When the open RE BECOMES complete, wait for typing to stop
     (900 ms, restarted by every keystroke in it), then fold it and open the next RE
     still to price, cursor on its first rate. Only the incomplete → complete step
     advances — editing a finished RE never throws the operator out of it. */
  useEffect(() => {
    for (const g of groups) if (!g.done) advancedRef.current[g.id] = false;
    const g = openGroup;
    if (!g || !g.done || advancedRef.current[g.id]) return;
    const t = setTimeout(() => {
      advancedRef.current[g.id] = true;
      const i = groups.findIndex((x) => x.id === g.id);
      const next = [...groups.slice(i + 1), ...groups.slice(0, i)].find((x) => !x.done);
      if (!next) return; // the last one: stay open, the totals and Submit are right below
      fold.setOpenKey(next.id);
      /* THE CURSOR LANDS ON ITS FIRST RATE once the opened fold has rendered its grid —
         two frames: one for React to commit, one for layout. A focus move, not a key
         handler (the GRN form's landing, same reason). */
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-rpo-group="${next.id}"] [data-rpo-rate]`);
          if (el) focusField(el);
        }),
      );
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completeSig, openSig]);


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
          lines: gridRows.filter((r) => r.supplied).map((r) => ({
            source_id: r.source_id,
            req_key: r.req_key,
            qty: num(r.row.qty),
            rate: num(r.row.rate) > 0 ? num(r.row.rate) : null,
            delivery_date: r.row.date || dateAll,
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
      router.push(`/purchase/orders/${res.poId}`);
    });
  }

  // ---------- grid ----------
  /*
   * 288 + 72 + 112 + 88 + 144 + 112 + 112 = 928, + 40 chrome (the `#`;
   * no ✕ — `hideRemove`, the rows are the requirement's own) = 968 <= 1155
   * -> tableFrom="5xl".
   *
   * NO RE COLUMN: each RE is its own fold now, and its header names it.
   *
   * NO BALANCE COLUMN (user 2026-10-23, screenshot 3692): Order Qty already starts
   * AT the balance and cannot go past it, so a second column of the same number
   * read as a different fact. Where the balance comes from — required on the
   * requirement sheet less what other POs already order — is the Order Qty
   * cell's tooltip.
   *
   * COMPACT (screenshot 3691): "HO/RE/26-27/0003" repeated down every row took
   * 144px and squeezed the item name to "SEWING THREAD / COTT…". The column now
   * reads the RE's running number (0003) with the whole number on hover, and the
   * item takes the width back.
   */
  const poLineColumns: ChildGridColumn<GridRow>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => (
        <div className="min-w-0">
          <Truncated className="text-sm font-medium">{r.item_name}</Truncated>
          <Truncated className="text-xs text-muted-foreground">
            {lineDescription({ item_name: "", slice_label: r.slice_label, colour: r.colour }).replace(/^ · /, "")}
          </Truncated>
        </div>
      ),
    },
    { header: "UOM", width: FIELD_WIDTH_CSS.num, cell: (r) => <span className="text-sm">{r.uom_code ?? ""}</span> },
    {
      header: "Order Qty",
      // `range`, not `hug`: "ORDER QTY" is wider than 88px on one line.
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <Input
          type="number"
          min={0}
          max={r.balance_qty}
          inputMode="decimal"
          aria-label={`Order qty, ${lineDescription(r)}, at most ${r.balance_qty}`}
          title={`At most ${fmtNumber(r.balance_qty)} ${r.uom_code ?? ""}: ${fmtNumber(r.required_qty)} on the requirement sheet${r.ordered_qty > 0 ? `, less ${fmtNumber(r.ordered_qty)} already on other POs` : ""}`}
          className="h-8 text-right tabular-nums"
          value={r.row.qty}
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
      cell: (r) => (
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          data-rpo-rate
          aria-label={`Rate per ${r.uom_code ?? "unit"}, ${lineDescription(r)}`}
          className="h-8 text-right tabular-nums"
          value={r.row.rate}
          onChange={(e) => setRow(r, { rate: e.target.value })}
        />
      ),
    },
    {
      header: "Delivery",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <Input
          type="date"
          max="9999-12-31"
          aria-label={`Promised delivery, ${lineDescription(r)}`}
          className="h-8"
          value={r.row.date || dateAll}
          onChange={(e) => setRow(r, { date: e.target.value })}
        />
      ),
    },
    {
      header: "Amount",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (r) => {
        const a = num(r.row.qty) * num(r.row.rate);
        return <span className="text-sm font-medium tabular-nums">{a > 0 ? fmtFixed(a, 2) : ""}</span>;
      },
    },
    {
      header: "Budget",
      width: FIELD_WIDTH_CSS.range,
      // Short words in the cell; the spec's exact "Above Approved Budget" is the
      // pill's title and the footer's sentence.
      cell: (r) => {
        if (vendorId && !r.supplied) return <span title={`${vendorName} does not supply ${r.item_class ?? "this class"}`}><StatusPill tone="neutral">Other vendor</StatusPill></span>;
        if (num(r.row.qty) <= 0) return <StatusPill tone="neutral">Not ordered</StatusPill>;
        const f = flags[r.key];
        if (!f || num(r.row.rate) <= 0) return null;
        if (f.above) return <span title="Above Approved Budget"><StatusPill tone="danger">Above budget</StatusPill></span>;
        if (!f.hasBudget) return <span title="No approved budget for this RE"><StatusPill tone="warning">No budget</StatusPill></span>;
        return null;
      },
    },
  ];

  // ---------- item-wise: one row per item across the chosen orders ----------
  const view: "order" | "item" = viewPick ?? (orderIds.length >= 2 ? "item" : "order");
  type ItemGroup = {
    key: string;
    item_name: string;
    spec: string;
    uom_code: string | null;
    item_class: string | null;
    supplied: boolean;
    members: GridRow[];
    qty: number;
    rate: string;
    mixedRate: boolean;
    date: string;
    amount: number;
    orders: number;
    above: number;
    unbudgeted: number;
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
      const act = ms.filter((m) => m.supplied && num(m.row.qty) > 0);
      const rates = [...new Set(act.map((m) => m.row.rate.trim()))];
      const dates = [...new Set(act.map((m) => m.row.date || dateAll))];
      itemGroups.push({
        key,
        item_name: ms[0].item_name,
        spec: lineDescription({ item_name: "", slice_label: ms[0].slice_label, colour: ms[0].colour }).replace(/^ · /, ""),
        uom_code: ms[0].uom_code,
        item_class: ms[0].item_class,
        supplied: ms[0].supplied,
        members: ms,
        qty: act.reduce((a, m) => a + num(m.row.qty), 0),
        rate: rates.length === 1 ? rates[0] : "",
        mixedRate: rates.length > 1,
        date: dates.length === 1 ? dates[0] : dateAll,
        amount: act.reduce((a, m) => a + num(m.row.qty) * num(m.row.rate), 0),
        orders: ms.length,
        above: act.filter((m) => flags[m.key]?.above).length,
        unbudgeted: act.filter((m) => num(m.row.rate) > 0 && flags[m.key] && !flags[m.key].hasBudget).length,
      });
    }
  }
  const openItem = itemGroups.find((g) => g.key === itemFold.openKey) ?? null;

  /*
   * 288 + 72 + 88 + 112 + 88 + 144 + 112 + 112 = 1016, + 40 chrome = 1056 <= 1155
   * -> tableFrom="5xl". The rate and delivery typed here go to every order line
   * under the item; the breakup below edits one order at a time.
   */
  const itemColumns: ChildGridColumn<ItemGroup>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.name,
      cell: (g) => (
        <div className="min-w-0">
          <Truncated className="text-sm font-medium">{g.item_name}</Truncated>
          {g.spec ? <Truncated className="text-xs text-muted-foreground">{g.spec}</Truncated> : null}
        </div>
      ),
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
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (g) => <span className="text-sm font-medium tabular-nums">{g.qty > 0 ? fmtNumber(g.qty) : ""}</span>,
    },
    {
      header: `Rate ${cur}`,
      width: FIELD_WIDTH_CSS.hug,
      cell: (g) => (
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          data-rpo-rate
          aria-label={`Rate per ${g.uom_code ?? "unit"}, ${g.item_name} ${g.spec}, for all ${g.orders} orders`}
          className="h-8 text-right tabular-nums"
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
      cell: (g) => (
        <Input
          type="date"
          max="9999-12-31"
          aria-label={`Promised delivery, ${g.item_name} ${g.spec}`}
          className="h-8"
          disabled={!g.supplied}
          value={g.date}
          onChange={(e) => setMembers(g.members, { date: e.target.value })}
        />
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
      cell: (g) => {
        if (vendorId && !g.supplied) return <StatusPill tone="neutral">Other vendor</StatusPill>;
        if (g.above > 0)
          return (
            <span title="Above Approved Budget">
              <StatusPill tone="danger">Above · {g.above}/{g.orders}</StatusPill>
            </span>
          );
        if (g.unbudgeted > 0) return <span title="No approved budget for one or more of its orders"><StatusPill tone="warning">No budget</StatusPill></span>;
        return null;
      },
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
    ...poLineColumns.filter((c) => ["Order Qty", "Delivery", "Amount", "Budget"].includes(c.header)),
  ];

  const canSave = !isPending && orderIds.length > 0 && !!vendorId && active.length > 0 && (poType === "local" || num(exRate) > 0);
  const canSubmit = canSave && unpriced === 0;
  const hint =
    orderIds.length === 0
      ? "" // nothing chosen yet: the empty form says it (user 2026-10-23: no sentence here)
      : !vendorId
        ? vendorList.length === 0
          ? `No bought-item vendor is mapped to ${[...classNames.values()].join(", ")} — add one in Master Data ▸ Vendors.`
          : "Choose the vendor — its classes are the lines this PO carries."
        : active.length === 0
          ? "Every line has quantity 0 — there is nothing to order."
          : unpriced > 0
            ? `${unpriced} rate(s) to type.`
            : goesToMd
              ? `Above Approved Budget on ${above} line(s)${unbudgeted ? `, no approved budget on ${unbudgeted}` : ""} — Submit saves the PO and sends it to the MD; printing stays locked.`
              : "Every rate is within budget — Submit approves the PO by rule.";

  return (
    <div data-focus-scope className="space-y-5">
      {/* ONE ROW (user 2026-10-23, screenshots 3691 / 3692): RE No, Item Class and Vendor
          176 each, Type, Delivery Date, GST and Payment Terms 144 each = 1104 + 6 × 12 gap
          = 1176px nominal. The first cut (1312px) still wrapped Payment Terms: at this
          app's type scale a step renders ~25% wider than its nominal px, so the row is
          sized one step down per field, not against the nominal sum. Import adds Currency
          + Exchange Rate, which wrap — the one case that needs them.
          ONE CAP FOR BOTH CARDS AND THE BUTTON ROW, so their edges line up. */}
      <Card className="max-w-[84rem]">
        <CardHeader>
          <CardTitle>Purchase Order</CardTitle>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            Print opens after approval
          </span>
        </CardHeader>
        <CardBody className="space-y-3">
          <FieldRow>
            {/* PO NO (user 2026-10-23, screenshot 3699): read-only, the house series
                HO/PO/26-27/0001 (0745). Given on Save by the database under a lock —
                what shows here is the next number in this unit, so a PO saved by someone
                else in between moves it on by one. */}
            <Field label="PO No" w="code" htmlFor="rpo-no">
              <Input
                id="rpo-no"
                readOnly
                value={nextPoNo ? `${nextPoNo}` : ""}
                title="Given when the PO is saved"
                className="font-mono tabular-nums"
              />
            </Field>
            <Field w="term">
              <MultiSelect
                label="RE / SWO / IWO No"
                required
                options={reOptions}
                values={orderIds}
                // The picks read IN the trigger, so ticking a third RE never grows
                // the row and pushes Item Class / Vendor down (screenshot 3691).
                hideChips
                summarizeLabels
                summaryNoun="orders"
                // THE LIST SHOWS THE WHOLE NUMBER (screenshot 3698: "HO/RE/26-27/0…"): the
                // panel is as wide as the trigger by default; "SWO/26-27/0001 · SIW/26-27/0002"
                // needs ~24rem.
                panelClassName="w-[26rem] max-w-[90vw]"
                emptyLabel="No requirement sheet has anything left to buy"
                onChange={(next) => {
                  setDirty(true);
                  setOrderIds(next);
                }}
              />
            </Field>
            <Field label="Vendor" required w="party" htmlFor="rpo-vendor">
              <Combobox
                id="rpo-vendor"
                options={vendorOptions}
                value={vendorId}
                openOnFocus={false}
                disabled={vendorList.length === 0}
                onChange={(v) => {
                  setDirty(true);
                  setVendorPick(v);
                }}
              />
            </Field>
            <Field label="Type" w="code">
              <ToggleGroup
                label="PO type"
                value={poType}
                onChange={(v) => {
                  setDirty(true);
                  setPoType(v);
                }}
                options={[
                  { value: "local", label: "Local" },
                  { value: "import", label: "Import" },
                ]}
              />
            </Field>
            {poType === "import" ? (
              <>
                <Field label="Currency" required w="hug" htmlFor="rpo-ccy">
                  <Select id="rpo-ccy" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Exchange Rate" required w="hug" htmlFor="rpo-fx">
                  <Input
                    id="rpo-fx"
                    type="number"
                    min={0}
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    value={exRate}
                    onChange={(e) => {
                      setDirty(true);
                      setExRate(e.target.value);
                    }}
                  />
                </Field>
              </>
            ) : null}
            {/* No hint line under it: a second line made this one field taller than its
                row (screenshot 3691). That it fills every line is said in the grid's header. */}
            <Field label="Delivery Date" required w="code" htmlFor="rpo-date">
              <Input
                id="rpo-date"
                type="date"
                max="9999-12-31"
                value={dateAll}
                onChange={(e) => {
                  setDirty(true);
                  setDateAll(e.target.value);
                  // The header date is the default for every line — a new default replaces the per-line ones.
                  setRows((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, date: "" }])));
                }}
              />
            </Field>
            <Field label="GST" required w="code" htmlFor="rpo-gst">
              <Select id="rpo-gst" value={gst} onChange={(e) => setGst(e.target.value)}>
                {GST_SLABS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Payment Terms" w="code" htmlFor="rpo-terms">
              <Input
                id="rpo-terms"
                value={paymentTerms}
                onChange={(e) => {
                  setDirty(true);
                  setPaymentTerms(e.target.value);
                }}
              />
            </Field>
          </FieldRow>
          {/* ONE SURFACE (user 2026-10-23: "can merge this also into single page … why
              separated section"). The header fields and the RE bands are one document,
              so they share one card; a hairline is the only thing between them. */}
          <div className="space-y-3 border-t border-[#dde4eb] pt-3">
          {gridRows.length === 0 ? (
            orderIds.length === 0 ? null : (
              <p className="text-sm text-muted-foreground">Nothing left to buy on the chosen orders.</p>
            )
          ) : (
            <>
              {/* THE COSTING ▸ FABRIC PROCESSING SHAPE (user 2026-10-23, screenshot 3695; canvas V5):
                  one band per RE — a grey row with caret, RE number, a muted second line,
                  priced count, green amount and the budget chip — and the open band shows
                  a white card with a blue group label over the lines. Same grid as the
                  band header row, so the columns line up down the whole list. */}
              <div className="flex flex-wrap items-center gap-3">
                <ToggleGroup
                  label="Lines"
                  value={view}
                  onChange={(v) => setViewPick(v)}
                  options={[
                    { value: "order", label: "Order-wise" },
                    { value: "item", label: "Item-wise" },
                  ]}
                />
              </div>
              {view === "order" ? (
              <div className="-mx-1 border-y border-[#dde4eb]">
                {groups.map((g, gi) => {
                  const open = fold.isOpen(g.id);
                  return (
                    <div key={g.id} data-rpo-group={g.id} {...fold.focusProps(g.id)}>
                      {/* ONE LINE (user 2026-10-23): caret · RE · buyer · delivery on the left,
                          amount and budget chip on the right — no column-header row above the
                          bands and no second muted line, so a folded RE is a single row. */}
                      <div
                        className={cn(
                          "flex min-h-10 items-center gap-3 bg-[#f5f7f9] px-3 py-1.5 hover:bg-[#eef4f9]",
                          gi > 0 && "border-t-2 border-[#c8dce9]",
                        )}
                      >
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => fold.toggle(g.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <ChevronRight
                            aria-hidden
                            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
                          />
                          <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{g.re}</span>
                          <span className="truncate text-[12.5px] text-muted-foreground">
                            {[g.customer, g.delivery ? `delivery ${fmtDate(g.delivery)}` : ""].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                        <span className="w-28 shrink-0 text-right font-mono text-[13.5px] font-bold tabular-nums text-[#3f7d17]">
                          {g.subtotal > 0 ? `${cur} ${fmtFixed(g.subtotal, 2)}` : ""}
                        </span>
                        <span className="flex w-36 shrink-0 justify-end">
                          {g.above > 0 ? (
                            <StatusPill tone="danger">Above budget · {g.above}</StatusPill>
                          ) : g.unbudgeted > 0 ? (
                            <StatusPill tone="warning">No budget</StatusPill>
                          ) : g.done && g.active > 0 ? (
                            <StatusPill tone="success">
                              <Check aria-hidden className="size-3.5" /> Priced
                            </StatusPill>
                          ) : (
                            <StatusPill tone="neutral">
                              {g.priced} of {g.active} priced
                            </StatusPill>
                          )}
                        </span>
                      </div>
                      {open ? (
                        /* ONE BORDER (user 2026-10-23, screenshot 3697): the list's own frame is
                           the only one — no grey panel, no white card, and the grid `frameless`.
                           Three nested frames read as three boxes for one table. */
                        <div className="border-t border-[#dde4eb] bg-white px-3 py-2">
                          {/* ONE SUB-GRID PER ITEM CLASS, a small heading over each — the class is the
                              line's (it left the header, 2026-10-23). */}
                          {[...new Set(g.rows.map((r) => r.item_class ?? "—"))].map((cls, ci) => {
                            const clsRows = g.rows.filter((r) => (r.item_class ?? "—") === cls);
                            const off = !!vendorId && !clsRows[0].supplied;
                            return (
                              <div key={cls} className={cn(ci > 0 && "mt-2")}>
                                <div
                                  className={cn(
                                    "mb-1 flex flex-wrap items-baseline gap-2 text-[10.5px] font-bold uppercase tracking-[0.07em]",
                                    off ? "text-muted-foreground" : "text-[#037bb8]",
                                  )}
                                >
                                  {cls} · {clsRows.length}
                                  {off ? (
                                    <span className="font-medium normal-case tracking-normal">
                                      {`— ${vendorName} does not supply this class; it stays for another vendor's PO`}
                                    </span>
                                  ) : null}
                                </div>
                                <div className={cn(off && "pointer-events-none opacity-50")} aria-disabled={off || undefined}>
                                  {/* default-row: exempt -- the rows are the RE's requirement lines, derived; nothing is added here */}
                                  <ChildGrid<GridRow>
                                    columns={poLineColumns}
                                    rows={clsRows}
                                    tableFrom="5xl"
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
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              ) : (
                <div className="space-y-3">
                  {[...new Set(itemGroups.map((g) => g.item_class ?? "—"))].map((cls, ci) => {
                    const clsItems = itemGroups.filter((g) => (g.item_class ?? "—") === cls);
                    const off = !!vendorId && !clsItems[0].supplied;
                    const open = openItem && (openItem.item_class ?? "—") === cls ? openItem : null;
                    return (
                      <div key={cls}>
                        <div
                          className={cn(
                            "mb-1 flex flex-wrap items-baseline gap-2 text-[10.5px] font-bold uppercase tracking-[0.07em]",
                            off ? "text-muted-foreground" : "text-[#037bb8]",
                          )}
                        >
                          {cls} · {clsItems.length}
                          {off ? (
                            <span className="font-medium normal-case tracking-normal">
                              {`— ${vendorName} does not supply this class; it stays for another vendor's PO`}
                            </span>
                          ) : null}
                        </div>
                        <div className={cn(off && "pointer-events-none opacity-50")} aria-disabled={off || undefined}>
                          {/* default-row: exempt -- one row per item across the chosen orders, derived; nothing is added here */}
                          <ChildGrid<ItemGroup>
                            columns={itemColumns}
                            rows={clsItems}
                            tableFrom="5xl"
                            flatRows
                            hideAdd
                            hideRemove
                            keepOne={false}
                            onAdd={() => false}
                            onRemove={() => {}}
                            frameless
                            headerClassName={GRID_HEAD}
                            hideHeader={ci > 0}
                          />
                        </div>
                        {open ? (
                          <div className="mt-1 border-l-2 border-[#037bb8] pl-3">
                            <div className="mb-1 text-[11.5px] font-semibold text-muted-foreground">
                              {open.item_name}
                              {open.spec ? ` · ${open.spec}` : ""} — {open.orders} order{open.orders === 1 ? "" : "s"}
                            </div>
                            {/* default-row: exempt -- the item's order lines, derived; nothing is added here */}
                            <ChildGrid<GridRow>
                              columns={breakupColumns}
                              rows={open.members}
                              tableFrom="5xl"
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
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm tabular-nums">
                <span className="text-muted-foreground">Taxable {cur} {fmtFixed(totals.taxable, 2)}</span>
                <span className="text-muted-foreground">{slab.kind === "igst" ? "IGST" : "CGST + SGST"} {cur} {fmtFixed(totals.gst, 2)}</span>
                <span className="font-semibold">Total {cur} {fmtFixed(totals.total, 2)}</span>
              </div>
            </>
          )}
          </div>
        </CardBody>
      </Card>

      <div className="flex max-w-[84rem] flex-wrap items-center justify-end gap-2" data-focus-region="footer">
        <span className="mr-auto text-sm text-muted-foreground">
          {hint}
        </span>
        <Button type="button" variant="ghost" onClick={() => router.push("/purchase/orders")}>
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
  );
}
