"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { FileText, Layers, LayoutGrid, Tag, User } from "lucide-react";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { StatusSegment, type QuickCounts, type QuickWord } from "@/components/orders/bom-queue";
import type { Column } from "@/components/ui/data-table";
import { FilterPill, type FilterPillOption } from "@/components/ui/filter-pill";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { fmtMoney } from "@/lib/format";
import { PO_STATUS_LABELS, type PoStatus } from "@/lib/purchase/types";
import { statusTone } from "@/lib/ui/status-tone";
import { KIND_OPTIONS, NO_BUYER } from "@/lib/purchase/re-po/filters";
import { lineKindOf, type RaisedPo, type RequirementLine, type SourceKind } from "@/lib/purchase/re-po/types";
import { RequirementPoForm } from "./requirement-po-form";

/**
 * RAISE PO — THE ORDERS SHAPE (user 2026-10-26: "if I raise a request in the Raise
 * PO page it went to the Purchase Order page — instead make it like the order
 * module, pending · updated · draft, in the Raise PO page"). A list first, the
 * editor opened from it, and Save returns HERE on the word the PO now counts as.
 *
 * What the three words mean on this screen:
 * - **Pending** — an RE / SWO / IWO with something still to buy: the work. Its
 *   pencil opens the editor with that order already chosen.
 * - **Updated** — a PO raised here and submitted (approved, with the MD, or on).
 * - **Draft** — a PO raised here and saved as draft.
 *
 * A PO row opens the PO itself on Purchase Orders — that is where it is
 * approved, printed and received; this screen only raises it.
 */

/* Same override the Purchase Orders list declares: Approved is a step, not the end. */
const PO_STATUS_TONE_OVERRIDES = { approved: "info" } as const;

type Row = {
  key: string;
  word: QuickWord;
  /** Pending → the order's id (opens the editor); Updated / Draft → the PO's id. */
  id: string;
  no: string;
  party: string;
  refs: string;
  /** Pending: lines still to buy. PO: its value. */
  amount: number;
  status: string;
  created_at: string | null;
  created_by: string | null;
};

const LABEL: Record<"pending" | "updated" | "draft", string> = { pending: "Pending", updated: "Updated", draft: "Draft" };

/** Everything the editor takes except the three this screen owns — passed through
 *  whole, so a prop the editor gains reaches it without this file changing. */
type FormProps = Omit<ComponentProps<typeof RequirementPoForm>, "initialOrderId" | "onSaved" | "onCancel">;

/**
 * THE FILTER ROW ABOVE THE PENDING LIST (user 2026-10-31, screenshot 3927 — "Complete
 * Filter Workflow for the Raise PO Screen"). One cascade, each pill narrowed by every
 * pill before it (Cascading filters, AGENTS.md):
 *
 *   Order Type -> Buyer -> RE / SWO / IWO -> Item Class -> Category
 *
 * - **Item Class lists only the classes the chosen orders actually plan** — read off
 *   their own requirement lines — so an unplanned class is not on offer at all.
 * - **Category is hidden while only Yarn is picked**: a yarn count has no sub-category.
 * - Narrowing an upstream pill drops a downstream pick that fell out of scope, and
 *   keeps one that is still in it.
 *
 * The picks then CARRY INTO THE EDITOR — the pencil on a row, and the Raise PO button
 * (which takes every order picked here, the consolidated-PO case). PO Type and Vendor
 * are not here: they decide the PO itself, so they stay on the editor's row.
 */
type ListFilters = { kind: string[]; buyer: string[]; order: string[]; cls: string[]; category: string[] };
const NO_LIST_FILTERS: ListFilters = { kind: [], buyer: [], order: [], cls: [], category: [] };
const FACETS: (keyof ListFilters)[] = ["kind", "buyer", "order", "cls", "category"];
const buyerOf = (l: RequirementLine) => (l.source_kind === "re" ? (l.customer ?? NO_BUYER) : NO_BUYER);
const facetOf = (l: RequirementLine, k: keyof ListFilters): string | null =>
  k === "kind" ? l.source_kind : k === "buyer" ? buyerOf(l) : k === "order" ? l.source_id : k === "cls" ? l.item_class_id : l.category_id;
/** Does a line pass every pick in `f`, ignoring the facet `skip` (so a pill counts its own options)? */
function linePasses(l: RequirementLine, f: ListFilters, skip?: keyof ListFilters): boolean {
  return FACETS.every((k) => {
    if (k === skip || !f[k].length) return true;
    const v = facetOf(l, k);
    return v != null && f[k].includes(v);
  });
}
/** One option per value the other picks leave, counted in ORDERS — what this list lists. */
function optionsOf(
  lines: RequirementLine[],
  f: ListFilters,
  k: keyof ListFilters,
  labelOf: (l: RequirementLine) => string,
): FilterPillOption[] {
  const by = new Map<string, { label: string; orders: Set<string> }>();
  for (const l of lines) {
    const v = facetOf(l, k);
    if (!v || !linePasses(l, f, k)) continue;
    const e = by.get(v) ?? { label: labelOf(l), orders: new Set<string>() };
    e.orders.add(l.source_id);
    by.set(v, e);
  }
  return [...by.entries()]
    .map(([value, e]) => ({ value, label: e.label, count: e.orders.size }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function RaisePoScreen({ raised, form }: { raised: RaisedPo[]; form: FormProps }) {
  /** Requirement lines with a balance — Pending is built from these. */
  const lines = form.lines;
  const router = useRouter();
  const [word, setWord] = useState<QuickWord>("pending");
  /** null = the list; "" = a fresh PO; an id = a PO for that order. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Remounts the form per open, so New starts blank (a useState seed fires once per mount). */
  const [openSeq, setOpenSeq] = useState(0);
  const [lf, setLf] = useState<ListFilters>(NO_LIST_FILTERS);
  /** What the editor opens with — set by the pencil or the Raise PO button. */
  const [seed, setSeed] = useState<ComponentProps<typeof RequirementPoForm>["seed"]>(undefined);
  /** The lines the filter row leaves — Pending is built from these. */
  const shownLines = useMemo(() => lines.filter((l) => linePasses(l, lf)), [lines, lf]);

  const rows = useMemo<Row[]>(() => {
    const byOrder = new Map<string, Row & { classes: Set<string> }>();
    for (const l of shownLines) {
      const o =
        byOrder.get(l.source_id) ??
        {
          key: `o:${l.source_id}`,
          word: "pending" as const,
          id: l.source_id,
          no: l.source_no,
          party: l.customer ?? "",
          refs: "",
          amount: 0,
          status: "",
          created_at: null,
          created_by: null,
          classes: new Set<string>(),
        };
      o.amount += 1;
      if (l.item_class) o.classes.add(l.item_class);
      byOrder.set(l.source_id, o);
    }
    const pending: Row[] = [...byOrder.values()]
      .map(({ classes, ...o }) => ({ ...o, refs: [...classes].sort().join(", ") }))
      .sort((a, b) => a.no.localeCompare(b.no));
    const pos: Row[] = raised
      .filter((p) => p.status !== "cancelled")
      .map((p) => ({
        key: `p:${p.id}`,
        word: p.status === "draft" ? ("draft" as const) : ("updated" as const),
        id: p.id,
        no: p.code ?? "—",
        party: p.vendor ?? "",
        refs: p.source_nos.join(", "),
        amount: p.total_amount,
        status: p.status,
        created_at: p.created_at,
        created_by: p.created_by,
      }));
    return [...pending, ...pos];
  }, [shownLines, raised]);

  const counts = useMemo<QuickCounts>(() => {
    const c: QuickCounts = {};
    for (const r of rows) c[r.word] = (c[r.word] ?? 0) + 1;
    return c;
  }, [rows]);
  const shown = useMemo(() => rows.filter((r) => r.word === word), [rows, word]);

  const isPendingView = word === "pending";
  const yarnOnly = (ids: string[]) =>
    ids.length > 0 && ids.every((id) => lineKindOf(lines.find((l) => l.item_class_id === id)?.item_class) === "yarn");
  /* Downstream picks that fall out of scope go; ones still in scope stay. */
  function setUpstream(k: keyof ListFilters, v: string[]) {
    setLf((f) => {
      const next: ListFilters = { ...f, [k]: v };
      for (const d of FACETS.slice(FACETS.indexOf(k) + 1)) {
        next[d] = next[d].filter((x) => lines.some((l) => facetOf(l, d) === x && linePasses(l, next, d)));
      }
      if (yarnOnly(next.cls)) next.category = [];
      return next;
    });
  }
  const kindCounts = optionsOf(lines, lf, "kind", () => "");
  const categoryOptions = (() => {
    // The class comes back only on a name two classes share (COTTON is a Yarn and a Fabric).
    const opts = optionsOf(lines, lf, "category", (l) => `${l.category ?? "—"}|${l.item_class ?? "—"}`);
    const nameOf = (label: string) => label.slice(0, label.lastIndexOf("|"));
    const seen = new Map<string, number>();
    for (const o of opts) seen.set(nameOf(o.label), (seen.get(nameOf(o.label)) ?? 0) + 1);
    return opts
      .map((o) => {
        const name = nameOf(o.label);
        const cls = o.label.slice(o.label.lastIndexOf("|") + 1);
        return { ...o, label: (seen.get(name) ?? 0) > 1 ? `${name} (${cls})` : name };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  })();
  /* BEHIND ONE "FILTERS" BUTTON (user 2026-10-31, screenshot 3929 → "like this": the
     Filters button the other lists carry). The pills open in the FilterBar's panel,
     in the drawer's shape — two groups, the order first, then what to buy. */
  const activeFilters = FACETS.filter((k) => lf[k].length > 0).length;
  const filterPanel = (
    <section
      aria-label="Filters"
      className="grid max-w-[60rem] grid-cols-1 divide-y divide-border rounded-lg border border-border bg-surface shadow-xs lg:grid-cols-[3fr_2fr] lg:divide-x lg:divide-y-0"
    >
      <div className="grid content-start gap-2 p-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <FileText className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden />
          Order
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill
            label="Order Type"
            family="order"
            icon={LayoutGrid}
            options={KIND_OPTIONS.map((k) => ({ ...k, count: kindCounts.find((o) => o.value === k.value)?.count ?? 0 }))}
            multiple
            value={lf.kind}
            onChange={(v) => setUpstream("kind", v)}
          />
          <FilterPill
            label="Buyer"
            family="order"
            icon={User}
            wide
            options={optionsOf(lines, lf, "buyer", (l) => (buyerOf(l) === NO_BUYER ? "Not recorded (SWO / IWO)" : buyerOf(l)))}
            multiple
            value={lf.buyer}
            onChange={(v) => setUpstream("buyer", v)}
          />
          <FilterPill
            label="RE No"
            family="order"
            icon={FileText}
            wide
            options={optionsOf(lines, lf, "order", (l) => l.source_no.split(" · ")[0])}
            multiple
            value={lf.order}
            emptyText="No order of this buyer has anything left to buy"
            onChange={(v) => setUpstream("order", v)}
          />
        </div>
      </div>
      <div className="grid content-start gap-2 p-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <Layers className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden />
          Item
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill
            label="Item Class"
            family="item"
            icon={Layers}
            options={optionsOf(lines, lf, "cls", (l) => l.item_class ?? "—")}
            multiple
            value={lf.cls}
            emptyText="The orders chosen have nothing left to buy"
            onChange={(v) => setUpstream("cls", v)}
          />
          {yarnOnly(lf.cls) ? null : (
            <FilterPill
              label="Category"
              family="item"
              icon={Tag}
              disabled={categoryOptions.length === 0}
              options={categoryOptions}
              multiple
              value={lf.category}
              onChange={(v) => setUpstream("category", v)}
            />
          )}
        </div>
      </div>
    </section>
  );
  /** The editor's opening state from the filter row; `orderId` = a row's pencil. */
  const seedFrom = (orderId: string | null) => {
    const orderIds = orderId ? [orderId] : lf.order;
    // Only the picked classes the order(s) actually plan — never a class with nothing in it.
    const classIds = lf.cls.filter((c) =>
      lines.some((l) => l.item_class_id === c && (!orderIds.length || orderIds.includes(l.source_id))),
    );
    return {
      orderIds,
      classIds,
      filters: { kind: lf.kind as SourceKind[], buyer: lf.buyer, category: lf.category },
    };
  };
  const open = (r: Row) => {
    if (r.word === "pending") {
      setSeed(seedFrom(r.id));
      setOpenSeq((n) => n + 1);
      setEditing(r.id);
    } else router.push(`/purchase/orders/${r.id}`);
  };

  if (editing !== null) {
    return (
      <RequirementPoForm
        key={openSeq}
        {...form}
        initialOrderId={editing || null}
        seed={seed}
        onCancel={() => setEditing(null)}
        onSaved={(w) => {
          setEditing(null);
          setWord(w);
          router.refresh();
        }}
      />
    );
  }

  const columns: Column<Row>[] = isPendingView
    ? [
        {
          header: "RE / SWO / IWO",
          cell: (r) => (
            <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => open(r)}>
              {r.no}
            </button>
          ),
        },
        { header: "Buyer", cell: (r) => <Truncated>{r.party || "—"}</Truncated> },
        { header: "Item classes", cell: (r) => <Truncated>{r.refs || "—"}</Truncated> },
        { header: "Lines to buy", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.amount}</span> },
      ]
    : [
        {
          header: "PO No",
          cell: (r) => (
            <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => open(r)}>
              {r.no}
            </button>
          ),
        },
        { header: "Vendor", cell: (r) => <Truncated>{r.party || "—"}</Truncated> },
        { header: "RE / SWO / IWO", cell: (r) => <Truncated>{r.refs || "—"}</Truncated> },
        { header: "Value", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.amount)}</span> },
        {
          header: "Status",
          cell: (r) => (
            <StatusPill tone={statusTone(r.status, PO_STATUS_TONE_OVERRIDES)}>
              {PO_STATUS_LABELS[r.status as PoStatus] ?? r.status}
            </StatusPill>
          ),
        },
      ];

  return (
    <MasterListShell<Row>
      rows={shown}
      filterPanel={isPendingView ? filterPanel : undefined}
      panelActiveCount={isPendingView ? activeFilters : 0}
      onPanelReset={() => setLf(NO_LIST_FILTERS)}
      filterLeading={
        <>
          <StatusSegment value={word} onChange={setWord} draft counts={counts} />
        </>
      }
      getKey={(r) => r.key}
      perms={{ canCreate: true, canEdit: true, canDelete: false }}
      addLabel="Raise PO"
      onAdd={() => {
        setSeed(seedFrom(null));
        setOpenSeq((n) => n + 1);
        setEditing("");
      }}
      searchText={(r) => [r.no, r.party, r.refs].filter(Boolean).join(" ")}
      searchPlaceholder={isPendingView ? "Search RE No, buyer or class…" : "Search PO No, vendor or RE No…"}
      columns={columns}
      actions={{
        onEdit: open,
        /* PRINT PO (user 2026-10-27) — an icon on a raised PO's row, never a ⋮ (AGENTS, Row
           actions). Greyed until the PO is approved, saying why, rather than hidden: the
           row is the same PO either way, only its state differs. */
        menuAs: "icons",
        /* THE REPORT ICON REPORTS THE ENTRY (client 2026-10-30, screenshots
           3877–3879) — never a view, and on THIS screen never the order sheet:
           a pending RE / SWO / IWO opens its PURCHASE STATUS (items, the POs
           raised for each, balance to buy); a PO opens its print. */
        menu: (r) =>
          r.word === "pending"
            ? [
                {
                  // The PURCHASE side of the RE — items, POs raised, balance (not its order sheet).
                  label: "Purchase status report",
                  icon: FileText,
                  onClick: () => router.push(`/purchase/requirement-po/${r.id}/report`),
                },
              ]
            : [
                {
                  label: r.status === "approved" ? "PO Report" : "Report opens after approval",
                  icon: FileText,
                  disabled: r.status !== "approved",
                  onClick: () => router.push(`/purchase/orders/${r.id}/print`),
                },
              ],
      }}
      rowLabel={(r) => r.no}
      empty={
        rows.length === 0
          ? "No requirement has anything left to buy, and no PO has been raised here yet."
          : `Nothing ${LABEL[word as keyof typeof LABEL] ?? ""} — the other words list the rest.`
      }
      mobile={{
        title: (r) => r.no,
        subtitle: (r) => r.party,
        meta: (r) =>
          r.word === "pending" ? `${r.amount} line(s) to buy · ${r.refs}` : `${r.refs} · ${fmtMoney(r.amount)}`,
        pill: (r) =>
          r.word === "pending" ? null : (
            <StatusPill tone={statusTone(r.status, PO_STATUS_TONE_OVERRIDES)}>
              {PO_STATUS_LABELS[r.status as PoStatus] ?? r.status}
            </StatusPill>
          ),
        onEdit: open,
      }}
    />
  );
}
