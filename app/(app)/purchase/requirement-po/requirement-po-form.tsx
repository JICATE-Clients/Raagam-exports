"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Boxes, CalendarDays, Check, ChevronRight, Lock, X } from "lucide-react";
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
/**
 * A CELL YOU TYPE IN, NOT A BOX IN A CELL (user 2026-10-24, screenshot 3707: "that
 * separate cell border for the rate, qty, delivery date — as table"). The grid's own
 * gridlines are the only frame: the input drops its border, corners and ground, and
 * the cell it is in shows focus by an inset ring and a white fill — a sheet, not a
 * form laid in a table. Hover tints the cell so it still reads as editable.
 */
const CELL_INPUT =
  "h-8 rounded-none border-0 bg-transparent shadow-none hover:bg-[#f2f7fb] focus:bg-white focus-visible:ring-2 focus-visible:ring-inset";
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

  const [classId, setClassId] = useState("");
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
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
  /* RE LIST LEFT, ITEMS RIGHT (user 2026-10-24, after screenshot 3703: "old screen
     details … only list RE numbers as rail … details under RE number left side, right
     side item"). The header card stays exactly as it was; under it, the chosen REs are
     a list on the left — each RE number with its buyer, delivery and progress beneath
     it — and the picked RE's lines fill the right. NOT `MasterFullScreen`: a first cut
     put the header in the rail too, and the operator wanted only the REs there.
     One RE shown at a time (the fold rule); "items" = the All Items view. */
  const [activeKey, setActiveKey] = useState("");
  /* ITEM-WISE (client via user 2026-10-23: "multi order, multiple item — we are missing
     the multiple item concept"). The same item needed by several orders is ONE line to
     the vendor — the All Items rail row, offered once two orders are chosen. One item's
     breakup open at a time — the app's fold rule. */
  const itemFold = useAccordion(null);
  const advancedRef = useRef<Record<string, boolean>>({});

  useUnsavedGuard(dirty || isPending);

  // ---------- options ----------
  /*
   * THE HEADER READS ITEM CLASS · RE NO · CATEGORY · VENDOR (user 2026-10-24,
   * screenshot 3702), each narrowing the next — the app's cascading rule:
   * the class offers only the REs with something of that class left to buy, the
   * category only what those REs' items carry under it (the item master's own
   * category, 0748), and the vendor only that class's bought-item vendors.
   * Category is optional: blank = every category of the class.
   */
  const classOptions: ComboboxOption[] = useMemo(() => {
    const byClass = new Map<string, string>();
    for (const l of lines) if (l.item_class_id) byClass.set(l.item_class_id, l.item_class ?? "—");
    return [...byClass.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [lines]);
  const classLines = useMemo(() => lines.filter((l) => l.item_class_id === classId), [lines, classId]);

  const reOptions = useMemo(() => {
    const byOrder = new Map<string, { re: string; customer: string; n: number }>();
    for (const l of classLines) {
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
  }, [classLines]);

  const chosen = new Set(orderIds);
  const inClassOrders = classLines.filter((l) => chosen.has(l.source_id));
  // FROM THE CHOSEN ORDERS ONLY (user 2026-10-24): the categories their requirement lines
  // carry under this class — empty, and the field disabled, until an order is picked.
  const categoryOptions: ComboboxOption[] = (() => {
    const byCat = new Map<string, string>();
    for (const l of inClassOrders)
      if (l.category_id) byCat.set(l.category_id, l.category ?? "—");
    return [...byCat.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  })();
  const inOrders = categoryId ? inClassOrders.filter((l) => l.category_id === categoryId) : inClassOrders;
  /*
   * ITEM CLASS IS THE LINE'S, NOT THE PO'S (user 2026-10-23: "class is indicating in
   * top which is the requirement item class — it should come under the table").
   * REVERSED 2026-10-24 (screenshot 3702): the header asks for it again, FIRST, and
   * scopes every line to it — so the greying below now only ever sees one class.
   * What follows is the 10-23 shape, kept because it still reads correctly then.
   * The VENDOR decides what this PO carries:
   * the list is every bought-item vendor who supplies ANY class in the chosen
   * orders (spec point 2 — still filtered by "Is Bought Item Vendor" + class), and
   * once one is picked, the lines in a class that vendor does not supply stay on
   * screen, greyed, not ordered — their balance waits for another vendor's PO.
   */
  // The header's Item Class (2026-10-24) now scopes every line, so this is that one class —
  // the per-class machinery below stays, and keeps the save's per-class check honest.
  const classNames = new Map(classOptions.filter((o) => o.value === classId).map((o) => [o.value, o.label] as const));
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

  // ---------- one rail row per RE ----------
  const groups = [...new Set(gridRows.map((r) => r.source_id))].map((id) => {
    const rs = gridRows.filter((r) => r.source_id === id);
    const act = rs.filter((r) => r.supplied && num(r.row.qty) > 0);
    const priced = act.filter((r) => num(r.row.rate) > 0).length;
    // The rail's count: rates still to type. Before a vendor is chosen nothing is
    // "supplied" yet, so count every line being ordered — the number must not read 0
    // on an RE nobody has priced.
    const toPrice = rs.filter((r) => (!vendorId || r.supplied) && num(r.row.qty) > 0 && num(r.row.rate) <= 0);
    return {
      id,
      re: rs[0].source_no,
      toPrice,
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
  const completeSig = groups.map((g) => `${g.id}:${g.done}`).join("|");
  /* What the right side shows: the operator's pick while it still exists, else the
     first RE still to price — derived, so a new set of REs never needs an effect. */
  const showItems = orderIds.length >= 2;
  const selKey =
    groups.some((g) => g.id === activeKey) || (activeKey === "items" && showItems)
      ? activeKey
      : ((groups.find((g) => !g.done) ?? groups[0])?.id ?? "");
  const activeGroup = groups.find((g) => g.id === selKey);
  const activeSig = activeGroup ? activeGroup.rows.map((r) => `${r.row.qty}/${r.row.rate}`).join("|") : "";
  /** The id a line's rate box carries — where `openRe` lands the cursor. */
  const rateId = (key: string) => `rpo-rate-${key}`;

  /** Show an RE on the right and put the cursor on its first blank rate — two frames:
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

  /* RE FILLED → NEXT RE (user 2026-10-23, screenshot 3694: "RE number 1 filled then
     automatically open RE number 2"). Kept through the move to the RE list: when the RE
     on screen BECOMES complete, wait for typing to stop (900 ms, restarted by every
     keystroke in it), then show the next RE still to price, cursor on its
     first blank rate. Only the incomplete → complete step advances — editing a finished
     RE never throws the operator out of it. */
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

  /** A line's delivery: the PO's date unless changed. Until it is, the cell is a calendar
   *  button rather than the date again — every line repeating the Terms' "Deliver by" was
   *  the same fact N times (user 2026-10-24, canvas V6). A button, so Tab — fields only —
   *  passes over it; Enter or a click opens the date there and lands in it. */
  const deliveryCell = (id: string, own: string, label: string, disabled: boolean, set: (v: string) => void) =>
    own ? (
      <div className="flex items-center">
        <Input
          id={id}
          type="date"
          max="9999-12-31"
          aria-label={`Promised delivery, ${label}`}
          className={cn(CELL_INPUT, "min-w-0 flex-1")}
          disabled={disabled}
          value={own}
          onChange={(e) => set(e.target.value)}
        />
        {/* Back to the PO's date — the calendar button returns. */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => set("")}
          aria-label={`Use the PO date for ${label}`}
          title="Use the PO date"
          className="shrink-0 px-1 text-muted-foreground hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
    ) : (
      <button
        type="button"
        disabled={disabled}
        title={`Same as the PO (${fmtDate(dateAll)}) — click to change`}
        aria-label={`Change delivery for ${label}, now the PO date`}
        onClick={() => {
          set(dateAll);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const el = document.getElementById(id);
              if (el) focusField(el);
            }),
          );
        }}
        className="flex h-8 w-full items-center justify-center text-muted-foreground hover:bg-[#f2f7fb] hover:text-[#037bb8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
      >
        <CalendarDays aria-hidden className="size-4" />
      </button>
    );

  /** One line, the item then its slice · colour in grey — not two stacked lines (V6). */
  const itemCell = (name: string, spec: string) => (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <Truncated className="min-w-0 shrink text-sm font-medium">{name}</Truncated>
      {spec ? <Truncated className="min-w-0 shrink-[2] text-xs text-muted-foreground">{spec}</Truncated> : null}
    </div>
  );
  /** THE ONE COLUMN TO TYPE IN is tinted (V6) — the cells around it are read, this is filled. */
  const RATE_COL = "bg-[#fffaeb]";

  // ---------- grid ----------
  /*
   * A TIGHT TABLE (user 2026-10-24, screenshot 3704: "the items as tighten table").
   * Beside the RE list, `tableFrom="5xl"` (a table only from a 1024px container)
   * dropped the lines to stacked cards, one field per line (screenshot 3704). Now 200 + 72 + 88 + 88 + 144 + 112 + 112 = 816, + 40 chrome (the `#`;
   * no ✕ — `hideRemove`) = 856, and the grid takes ChildGrid's DEFAULT switch (a
   * table from a 512px pane, cards below it on a phone) — there is no `tableFrom`
   * tier under 1024. Item drops name → party (the full name is on hover) and
   * Order Qty is headed "Qty" so it fits `hug`.
   *
   * NO RE COLUMN: the RE list on the left names the RE on screen.
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
      // `name`, not `party`: one line now carries the item AND its slice · colour.
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => itemCell(r.item_name, lineDescription({ item_name: "", slice_label: r.slice_label, colour: r.colour }).replace(/^ · /, "")),
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
      className: RATE_COL,
      cell: (r) => (
        <Input
          type="number"
          min={0}
          inputMode="decimal"
          id={rateId(r.key)}
          aria-label={`Rate per ${r.uom_code ?? "unit"}, ${lineDescription(r)}`}
          className={cn(CELL_INPUT, "text-right tabular-nums")}
          value={r.row.rate}
          onChange={(e) => setRow(r, { rate: e.target.value })}
        />
      ),
    },
    {
      header: "Delivery",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => deliveryCell(`rpo-date-${r.key}`, r.row.date, lineDescription(r), false, (v) => setRow(r, { date: v })),
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
        // "No budget" is the ORDER's, not the line's — it is said once, on the RE's card.
        return null;
      },
    },
  ];

  // ---------- item-wise: one row per item across the chosen orders ----------
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
      cell: (g) => {
        if (vendorId && !g.supplied) return <StatusPill tone="neutral">Other vendor</StatusPill>;
        if (g.above > 0)
          return (
            <span title="Above Approved Budget">
              <StatusPill tone="danger">Above · {g.above}/{g.orders}</StatusPill>
            </span>
          );
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
    ...poLineColumns.filter((c) => ["Qty", "Delivery", "Amount", "Budget"].includes(c.header)),
  ];

  const canSave = !isPending && !!classId && orderIds.length > 0 && !!vendorId && active.length > 0 && (poType === "local" || num(exRate) > 0);
  const canSubmit = canSave && unpriced === 0;
  const hint =
    !classId || orderIds.length === 0
      ? "" // nothing chosen yet: the empty form says it (user 2026-10-23: no sentence here)
      : !vendorId
        ? vendorList.length === 0
          ? `No bought-item vendor is mapped to ${[...classNames.values()].join(", ")} — add one in Master Data ▸ Vendors.`
          : "Choose the vendor — its classes are the lines this PO carries."
        : active.length === 0
          ? "Every line has quantity 0 — there is nothing to order."
          : poType === "import" && num(exRate) <= 0
            ? "Type the exchange rate."
            : unpriced > 0
            ? // The count is the red number on each RE — the bar says only why Submit waits.
              "Submit opens once every rate is typed."
            : goesToMd
              ? `Above Approved Budget on ${above} line(s)${unbudgeted ? `, no approved budget on ${unbudgeted}` : ""} — Submit saves the PO and sends it to the MD; printing stays locked.`
              : "Every rate is within budget — Submit approves the PO by rule.";

  /* THE BUDGET WARNING, IN THE RE'S LIST ENTRY. Only the two states that are news —
     Above budget, No budget. "0 of 3 priced" and "Priced" were the red count and the
     green tick said again, so they went with the pane's heading (below). */
  const budgetWarning = (g: (typeof groups)[number]) =>
    // Above budget is per LINE (the Budget column); no approved budget is the ORDER's.
    g.unbudgeted > 0 ? (
      <span title="No approved budget for this RE — its PO goes to the MD">
        <StatusPill tone="warning">No approved budget</StatusPill>
      </span>
    ) : null;
  const hintTone =
    unpriced > 0 || !vendorId ? "text-[#8a5800]" : goesToMd ? "text-danger" : "text-[#14803f]";

  const itemsToPrice = itemGroups.filter((g) => g.supplied && g.qty > 0 && !g.rate && !g.mixedRate).length;

  /* THE RIGHT SIDE IS THE TABLE AND NOTHING ABOVE IT (user 2026-10-24, screenshot
     3707: "remove this duplicated from item table above"). The RE number is the
     selected entry on the left, the class is the header's Item Class (one class per
     PO since 2026-10-24, so no per-class headings either), and the priced count is
     the red number beside the RE. */
  const rePane = (g: (typeof groups)[number]) => (
    // default-row: exempt -- the rows are the RE's requirement lines, derived; nothing is added here
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

  /** One entry of the left list: the number, and its details UNDER it (user 2026-10-24). */
  const listButton = (key: string, selected: boolean, onClick: () => void, body: ReactNode, count: number, done: boolean) => (
    <button
      key={key}
      type="button"
      aria-current={selected || undefined}
      onClick={onClick}
      className={cn(
        "block w-full border-l-[3px] px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-l-[#037bb8] bg-white"
          : "border-l-transparent hover:bg-[#eef4f9]",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{body}</div>
        {/* Rates still to type, red; a green tick once every line being ordered is priced. */}
        {count > 0 ? (
          <span
            aria-label={`${count} rate${count === 1 ? "" : "s"} to type`}
            className="mt-0.5 shrink-0 rounded-full bg-danger-soft px-1.5 text-[11px] font-semibold tabular-nums text-danger"
          >
            {count}
          </span>
        ) : done ? (
          <Check aria-label="Priced" className="mt-0.5 size-4 shrink-0 text-[#3f7d17]" />
        ) : null}
      </div>
    </button>
  );

  return (
    <div data-focus-scope className="space-y-3">
      {/* ONE CAP FOR THE CARD AND THE BUTTON ROW, so their edges line up. 88rem, not the
          10-23 84rem: the RE list takes 224px off the left, and the item-wise grid
          (1056px) must still fit beside it on a wide screen; narrower, ChildGrid stacks. */}
      <Card className="max-w-[88rem]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Purchase Order</CardTitle>
            {/* PO NO (0745): the next number in this unit, given for real on Save under a
                lock — a chip beside the title, not a read-only field in the row (V6). */}
            {nextPoNo ? (
              <span title="Given when the PO is saved" className="rounded-md border border-[#dde4eb] px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                {nextPoNo}
              </span>
            ) : null}
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            Print opens after approval
          </span>
        </CardHeader>
        <CardBody className="space-y-3">
          {/* ONE ROW, IMPORT INCLUDED (user 2026-10-24: "make this into single row", then
              screenshot 3712 — Import wrapped GST and Payment Terms — answered "keep GST,
              make all boxes smaller"). Item Class 112 · RE No 144 · Category 88 · Vendor 144
              · Type 112 · [Import: currency + rate 144] · Delivery Date 144 · GST 112 ·
              Payment Terms 112 = 1112 nominal (the currency box inside its 144 is 80: at 68 the
              select's chevron room left "U…" for USD, screenshot 3713) + 8 × 12 gap. MEASURED, not assumed: a step
              renders ×1.236 here and a gap 16px, so 1112 × 1.236 + 8 × 16 = 1502px against
              the ~1540px the card offers at 1920 — Category at `hug` is the margin. Long
              values truncate and show whole on hover. */}
          <FieldRow>
            <Field label="Item Class" required w="range" htmlFor="rpo-class">
              <Combobox
                id="rpo-class"
                required
                options={classOptions}
                value={classId}
                openOnFocus={false}
                onChange={(v) => {
                  setDirty(true);
                  setClassId(v);
                  // A new class keeps only the REs that still have something of it to buy,
                  // and its own categories — a category is never carried across classes.
                  setOrderIds((prev) => prev.filter((id) => lines.some((l) => l.source_id === id && l.item_class_id === v)));
                  setCategoryId("");
                }}
              />
            </Field>
            <Field w="code">
              <MultiSelect
                label="RE / SWO / IWO No"
                required
                options={reOptions}
                values={orderIds}
                disabled={!classId}
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
                  // Keep the category while the new set of REs still carries it; drop it only when it falls out.
                  if (categoryId && !classLines.some((l) => next.includes(l.source_id) && l.category_id === categoryId))
                    setCategoryId("");
                }}
              />
            </Field>
            <Field label="Category" w="hug" htmlFor="rpo-category">
              <Combobox
                id="rpo-category"
                options={categoryOptions}
                value={categoryId}
                placeholder="All categories"
                clearable
                openOnFocus={false}
                disabled={!classId || categoryOptions.length === 0}
                onChange={(v) => {
                  setDirty(true);
                  setCategoryId(v);
                }}
              />
            </Field>
            <Field label="Vendor" required w="code" htmlFor="rpo-vendor">
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
            <Field label="Type" w="range">
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
              /* ONE FIELD, NOT TWO (user 2026-10-24, screenshot 3711): Currency and Exchange
                 Rate were two boxes — the row broke and "Exchange Rate" wrapped its label onto
                 two lines at `hug`. They are one fact, "1 USD = ₹ x", so they share a box. */
              <Field label={`${currency} → ₹ rate`} required w="code" htmlFor="rpo-fx">
                <div className="flex gap-1">
                  <div className="w-[5rem] shrink-0">
                    <Select id="rpo-ccy" aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Input
                    id="rpo-fx"
                    type="number"
                    min={0}
                    inputMode="decimal"
                    aria-label={`Rupees for 1 ${currency}`}
                    title={`Rupees for 1 ${currency}`}
                    className="min-w-0 flex-1 text-right tabular-nums"
                    value={exRate}
                    onChange={(e) => {
                      setDirty(true);
                      setExRate(e.target.value);
                    }}
                  />
                </div>
              </Field>
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
            <Field label="GST" required w="range" htmlFor="rpo-gst">
              <Select id="rpo-gst" value={gst} onChange={(e) => setGst(e.target.value)}>
                {GST_SLABS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Payment Terms" w="range" htmlFor="rpo-terms">
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
          {/* Only once an order is chosen: empty, the rule and its padding were a blank
              band under the fields (screenshot 3710). */}
          {orderIds.length === 0 ? null : (
          <div className="space-y-3 border-t border-[#dde4eb] pt-3">
            {gridRows.length === 0 ? (
              (
                <p className="text-sm text-muted-foreground">
                  {categoryId ? "Nothing of this category left to buy on the chosen orders." : "Nothing left to buy on the chosen orders."}
                </p>
              )
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border border-[#dde4eb] md:grid md:grid-cols-[14rem_minmax(0,1fr)]">
                  {/* THE RE LIST. Buttons, so Tab — which lands on fields only — passes
                      over it; the mouse picks an RE, and pricing one moves to the next. */}
                  <nav
                    aria-label="RE / SWO / IWO numbers"
                    className="divide-y divide-[#dde4eb] border-b border-[#dde4eb] bg-[#f5f7f9] md:border-r md:border-b-0"
                  >
                    {groups.map((g) =>
                      listButton(
                        g.id,
                        g.id === selKey,
                        () => setActiveKey(g.id),
                        <>
                          <Truncated className="font-mono text-[13px] font-bold tabular-nums">{g.re}</Truncated>
                          {g.customer ? <Truncated className="text-xs font-semibold">{g.customer}</Truncated> : null}
                          {/* "Ships", not "Delivery": this is the ORDER's date to the buyer, and the
                              table's Delivery is the vendor's to us — unlabelled, the two read as one
                              date shown twice (user 2026-10-24). */}
                          {g.delivery ? (
                            <div className="text-xs text-muted-foreground" title="When this order ships to the buyer — the material must arrive before it">
                              Ships {fmtDate(g.delivery)}
                            </div>
                          ) : null}
                          {g.subtotal > 0 ? (
                            <div className="font-mono text-xs font-semibold tabular-nums text-[#3f7d17]">
                              {cur} {fmtFixed(g.subtotal, 2)}
                            </div>
                          ) : null}
                          {budgetWarning(g) ? <div className="mt-1">{budgetWarning(g)}</div> : null}
                        </>,
                        g.toPrice.length,
                        g.done,
                      ),
                    )}
                    {/* ITEM-WISE: the same purchase across every chosen order is ONE line to
                        the vendor — offered once two orders are chosen. */}
                    {showItems
                      ? listButton(
                          "items",
                          selKey === "items",
                          () => setActiveKey("items"),
                          <>
                            <div className="inline-flex items-center gap-1.5 text-[13px] font-bold">
                              <Boxes aria-hidden className="size-3.5 text-muted-foreground" />
                              All items together
                            </div>
                            <div className="text-xs text-muted-foreground">One line per item, one rate</div>
                          </>,
                          itemsToPrice,
                          groups.length > 0 && groups.every((g) => g.done),
                        )
                      : null}
                  </nav>
                  <div className="min-w-0 bg-white p-2">
                    {selKey === "items" ? (
                      <div className="space-y-2">
                        {/* default-row: exempt -- one row per item across the chosen orders, derived; nothing is added here */}
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
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
          )}
        </CardBody>
      </Card>

      {/* THE BOTTOM BAR (V6): the total, why Submit waits, a way to the next blank rate,
          and the buttons — kept in view while the lines scroll.
          ON THE BOTTOM EDGE, NOT ABOVE IT (user 2026-10-24, screenshot 3713: "floating").
          A sticky box stops at its scroll container's PADDING edge, and `<main>` has
          `md:pb-6` — so `bottom-0` hung 24px up with lines scrolling through the gap.
          `md:-bottom-6` cancels exactly that padding. Phone keeps `bottom-0`: there the
          padding is the bottom tab bar's room, and the bar must sit above it. */}
      <div
        className="sticky bottom-0 z-10 flex max-w-[88rem] flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[#dde4eb] bg-white px-4 py-2 shadow-[0_-4px_12px_rgba(15,27,38,0.08)] md:-bottom-6 md:rounded-b-none md:border-b-0"
        data-focus-region="footer"
      >
        <div className="flex flex-col leading-tight tabular-nums">
          <span className="text-xs text-muted-foreground">
            Taxable {cur} {fmtFixed(totals.taxable, 2)} · {slab.kind === "igst" ? "IGST" : "CGST + SGST"} {cur} {fmtFixed(totals.gst, 2)}
          </span>
          <span className="text-base font-bold">
            Total {cur} {fmtFixed(totals.total, 2)}
          </span>
        </div>
        <span className={cn("min-w-0 flex-1 text-[13px] font-semibold", hintTone)}>{hint}</span>
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
