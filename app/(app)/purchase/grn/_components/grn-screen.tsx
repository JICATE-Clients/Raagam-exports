"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Layers, LayoutGrid, Store, User } from "lucide-react";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { StatusSegment, type QuickCounts, type QuickWord } from "@/components/orders/bom-queue";
import type { Column } from "@/components/ui/data-table";
import { FilterPill, type FilterPillOption } from "@/components/ui/filter-pill";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtNumber } from "@/lib/format";
import type {
  GrnBinOption,
  GrnGroupKind,
  GrnStoreOption,
  GrnWithVendor,
  OpenPoLine,
  ReplacementDue,
} from "@/lib/purchase/grn-service";
import { statusTone } from "@/lib/ui/status-tone";
import { GrnNewForm } from "./grn-new-form";

/**
 * GRN RECEIVING (doc/purchase/grn.md §1, plan doc/purchase/grn-plan.md Phase 2) — the
 * Raise PO shape: a list first, the entry opened from it.
 *
 * - **Pending** — a PO with something still to receive (approved / partially received),
 *   one row per PO. Its pencil opens the GRN entry with that PO's lines loaded.
 * - **Updated** — a POSTED GRN. **Draft** — a GRN saved and not yet posted. Both open
 *   the GRN itself, where it is posted, quality-checked and read.
 *
 * THE FILTERS (one button, as on Raise PO — user 2026-10-31) cascade in the spec's order,
 * each narrowed by every one before it (Cascading filters, AGENTS.md):
 *
 *   Group Type → Buyer → Vendor → Item Class → RE / Order No
 *
 * Vendor lists only vendors with something pending under the picks above it; Item Class
 * only the classes in those vendors' open POs; RE No only orders with something pending
 * under that vendor and class. Narrowing an upstream pill drops a downstream pick that
 * fell out of scope and keeps one still in it. The picks are read off the PO LINES, so a
 * PO carrying two classes is listed under either.
 *
 * REPLACEMENTS DUE (0780) sit on Pending too: a Rejection DC whose goods the vendor is to
 * send again. Its pencil opens a Replacement GRN on just the owed lines. It is narrowed by
 * Vendor and by its PO lines' other facts, like any pending PO.
 */

type Row = {
  key: string;
  word: QuickWord;
  /** A Pending row that is a Rejection DC owed a replacement (0780), not a PO. */
  replacement?: ReplacementDue;
  /** Pending → the PO's id (opens the entry); Updated / Draft → the GRN's id. */
  id: string;
  no: string;
  vendor: string;
  /** Pending: its RE / SWO / IWO numbers. GRN: the vendor's invoice / DC. */
  refs: string;
  /** Pending: its item classes. GRN: the GRN date. */
  detail: string;
  /** Pending: lines still to receive. GRN: its line count. */
  lines: number;
  status: string;
  created_at: string | null;
  created_by: string | null;
};

const KIND_OPTIONS: { value: GrnGroupKind; label: string }[] = [
  { value: "re", label: "RE" },
  { value: "swo", label: "SWO" },
  { value: "iwo", label: "IWO" },
  { value: "general", label: "General" },
];
const NO_BUYER = "__none__";

type ListFilters = { kind: string[]; buyer: string[]; vendor: string[]; cls: string[]; order: string[] };
const NO_FILTERS: ListFilters = { kind: [], buyer: [], vendor: [], cls: [], order: [] };
/** The spec's order — a pick is narrowed by every facet BEFORE it in this list. */
const FACETS: (keyof ListFilters)[] = ["kind", "buyer", "vendor", "cls", "order"];
const facetOf = (l: OpenPoLine, k: keyof ListFilters): string | null =>
  k === "kind"
    ? l.group_kind
    : k === "buyer"
      ? (l.buyer ?? NO_BUYER)
      : k === "vendor"
        ? l.vendor_id || null
        : k === "cls"
          ? (l.item_class_id ?? l.item_class)
          : l.order_id;
function linePasses(l: OpenPoLine, f: ListFilters, skip?: keyof ListFilters): boolean {
  return FACETS.every((k) => {
    if (k === skip || !f[k].length) return true;
    const v = facetOf(l, k);
    return v != null && f[k].includes(v);
  });
}
/** One option per value the other picks leave, counted in POs — what Pending lists. */
function optionsOf(lines: OpenPoLine[], f: ListFilters, k: keyof ListFilters, labelOf: (l: OpenPoLine) => string): FilterPillOption[] {
  const by = new Map<string, { label: string; pos: Set<string> }>();
  for (const l of lines) {
    const v = facetOf(l, k);
    if (!v || !linePasses(l, f, k)) continue;
    const e = by.get(v) ?? { label: labelOf(l), pos: new Set<string>() };
    e.pos.add(l.purchase_order_id);
    by.set(v, e);
  }
  return [...by.entries()]
    .map(([value, e]) => ({ value, label: e.label, count: e.pos.size }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function GrnScreen({
  openPoLines,
  grns,
  replacements,
  locations,
  defaultLocationId,
  canCreate,
  stores,
  bins,
  defaultStoreId,
}: {
  openPoLines: OpenPoLine[];
  grns: GrnWithVendor[];
  replacements: ReplacementDue[];
  locations: { id: string; code: string; name: string; postable: boolean }[];
  defaultLocationId: string | null;
  canCreate: boolean;
  stores: GrnStoreOption[];
  bins: GrnBinOption[];
  defaultStoreId: string | null;
}) {
  const router = useRouter();
  const [word, setWord] = useState<QuickWord>("pending");
  /** null = the list; "" = a fresh GRN; an id = a GRN for that PO. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Set when the entry is a Replacement GRN for this Rejection DC. */
  const [replacing, setReplacing] = useState<ReplacementDue | null>(null);
  /** Remounts the entry per open, so New starts blank (a useState seed fires once per mount). */
  const [openSeq, setOpenSeq] = useState(0);
  const [lf, setLf] = useState<ListFilters>(NO_FILTERS);

  /** Only lines with something left to receive make a PO Pending — and a qty owed as a
   *  REPLACEMENT is not left to receive on the PO: it comes in on its Rejection DC's row,
   *  so the same goods are never offered twice (and never billed twice, 0780). */
  const pendingLines = useMemo(() => {
    const owed = new Map<string, number>();
    for (const d of replacements) for (const x of d.lines) owed.set(x.po_line_item_id, (owed.get(x.po_line_item_id) ?? 0) + x.due);
    return openPoLines.filter((l) => l.open_balance - (owed.get(l.id) ?? 0) > 1e-9);
  }, [openPoLines, replacements]);
  const shownLines = useMemo(() => pendingLines.filter((l) => linePasses(l, lf)), [pendingLines, lf]);

  const rows = useMemo<Row[]>(() => {
    const byPo = new Map<string, Row & { orders: Set<string>; classes: Set<string> }>();
    for (const l of shownLines) {
      const r =
        byPo.get(l.purchase_order_id) ??
        {
          key: `p:${l.purchase_order_id}`,
          word: "pending" as const,
          id: l.purchase_order_id,
          no: l.po_code ?? "—",
          vendor: l.vendor_name,
          refs: "",
          detail: "",
          lines: 0,
          status: "",
          created_at: null,
          created_by: null,
          orders: new Set<string>(),
          classes: new Set<string>(),
        };
      r.lines += 1;
      r.orders.add(l.order_no ?? (l.group_kind === "general" ? "General" : "—"));
      if (l.item_class) r.classes.add(l.item_class);
      byPo.set(l.purchase_order_id, r);
    }
    const pending: Row[] = [...byPo.values()].map(({ orders, classes, ...r }) => ({
      ...r,
      refs: [...orders].sort().join(", "),
      detail: [...classes].sort().join(", "),
    }));
    const docs: Row[] = grns.map((g) => ({
      key: `g:${g.id}`,
      word: g.status === "posted" ? ("updated" as const) : ("draft" as const),
      id: g.id,
      no: g.code ?? "—",
      vendor: g.vendors?.name ?? "",
      refs: [g.invoice_no ? `Inv ${g.invoice_no}` : null, g.dc_no ? `DC ${g.dc_no}` : null, !g.invoice_no && !g.dc_no ? g.challan_no : null]
        .filter(Boolean)
        .join(" · "),
      detail: g.grn_date ?? "",
      lines: g.line_count,
      status: g.status,
      created_at: g.created_at,
      created_by: g.created_by,
    }));
    /* A Rejection DC owed a replacement — kept when any of its PO lines passes the filters. */
    const lineById = new Map(openPoLines.map((l) => [l.id, l]));
    const owed: Row[] = replacements
      .filter((d) => d.lines.some((x) => {
        const l = lineById.get(x.po_line_item_id);
        return l ? linePasses(l, lf) : !Object.values(lf).some((v) => v.length);
      }))
      .map((d) => ({
        key: `r:${d.id}`,
        word: "pending" as const,
        replacement: d,
        id: d.id,
        no: d.code ?? "—",
        vendor: d.vendor_name,
        refs: d.grn_code ? `Pending replacement from vendor · ${d.grn_code}` : "Pending replacement from vendor",
        detail: [...new Set(d.lines.map((x) => lineById.get(x.po_line_item_id)?.item_class).filter(Boolean))].join(", "),
        lines: d.lines.length,
        status: "",
        created_at: null,
        created_by: null,
      }));
    return [...pending, ...owed, ...docs];
  }, [shownLines, grns, replacements, openPoLines, lf]);

  const counts = useMemo<QuickCounts>(() => {
    const c: QuickCounts = {};
    for (const r of rows) c[r.word] = (c[r.word] ?? 0) + 1;
    return c;
  }, [rows]);
  const shown = useMemo(() => rows.filter((r) => r.word === word), [rows, word]);

  if (editing !== null) {
    return (
      <GrnNewForm
        key={openSeq}
        openPoLines={openPoLines}
        locations={locations}
        defaultLocationId={defaultLocationId}
        stores={stores}
        bins={bins}
        defaultStoreId={defaultStoreId}
        initialPoId={editing || null}
        initialVendorId={lf.vendor.length === 1 ? lf.vendor[0] : null}
        replacement={replacing}
        replacements={replacements}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const isPendingView = word === "pending";
  const open = (r: Row) => {
    if (r.word === "pending") {
      setOpenSeq((n) => n + 1);
      setReplacing(r.replacement ?? null);
      setEditing(r.replacement ? "" : r.id);
    } else router.push(`/purchase/grn/${r.id}`);
  };

  /* Downstream picks that fall out of scope go; ones still in scope stay. */
  function setUpstream(k: keyof ListFilters, v: string[]) {
    setLf((f) => {
      const next: ListFilters = { ...f, [k]: v };
      for (const d of FACETS.slice(FACETS.indexOf(k) + 1)) {
        next[d] = next[d].filter((x) => pendingLines.some((l) => facetOf(l, d) === x && linePasses(l, next, d)));
      }
      return next;
    });
  }
  const kindCounts = optionsOf(pendingLines, lf, "kind", () => "");
  const activeFilters = FACETS.filter((k) => lf[k].length > 0).length;
  const filterPanel = (
    <section
      aria-label="Filters"
      className="grid max-w-[60rem] grid-cols-1 divide-y divide-border rounded-lg border border-border bg-surface shadow-xs lg:grid-cols-[3fr_2fr] lg:divide-x lg:divide-y-0"
    >
      <div className="grid content-start gap-2 p-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <User className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden />
          Who
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill
            label="Group Type"
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
            options={optionsOf(pendingLines, lf, "buyer", (l) => l.buyer ?? "Not recorded (IWO / General)")}
            multiple
            value={lf.buyer}
            onChange={(v) => setUpstream("buyer", v)}
          />
          <FilterPill
            label="Vendor"
            family="vendor"
            icon={Store}
            wide
            options={optionsOf(pendingLines, lf, "vendor", (l) => l.vendor_name || "—")}
            multiple
            value={lf.vendor}
            emptyText="No vendor has anything pending for these picks"
            onChange={(v) => setUpstream("vendor", v)}
          />
        </div>
      </div>
      <div className="grid content-start gap-2 p-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <Layers className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden />
          What
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill
            label="Item Class"
            family="item"
            icon={Layers}
            options={optionsOf(pendingLines, lf, "cls", (l) => l.item_class ?? "—")}
            multiple
            value={lf.cls}
            emptyText="Nothing pending from the vendors chosen"
            onChange={(v) => setUpstream("cls", v)}
          />
          <FilterPill
            label="RE No"
            family="order"
            icon={FileText}
            wide
            options={optionsOf(pendingLines, lf, "order", (l) => l.order_no ?? "—")}
            multiple
            value={lf.order}
            emptyText="No order has anything pending for these picks"
            onChange={(v) => setUpstream("order", v)}
          />
        </div>
      </div>
    </section>
  );

  const docCell = (r: Row) => (
    <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => open(r)}>
      {r.no}
    </button>
  );
  const columns: Column<Row>[] = isPendingView
    ? [
        { header: "PO / DC No", cell: docCell },
        { header: "Vendor", cell: (r) => <Truncated>{r.vendor || "—"}</Truncated> },
        { header: "RE / SWO / IWO", cell: (r) => <Truncated>{r.refs || "—"}</Truncated> },
        { header: "Item classes", cell: (r) => <Truncated>{r.detail || "—"}</Truncated> },
        { header: "Lines to receive", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.lines)}</span> },
      ]
    : [
        { header: "GRN No", cell: docCell },
        { header: "Vendor", cell: (r) => <Truncated>{r.vendor || "—"}</Truncated> },
        { header: "Invoice / DC", cell: (r) => <Truncated>{r.refs || "—"}</Truncated> },
        { header: "GRN Date", cell: (r) => <span className="text-sm">{fmtDate(r.detail || null)}</span> },
        { header: "Lines", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.lines)}</span> },
        {
          header: "Status",
          cell: (r) => (
            <StatusPill tone={statusTone(r.status)}>{r.status === "posted" ? "Posted" : "Draft"}</StatusPill>
          ),
        },
      ];

  return (
    <MasterListShell<Row>
      rows={shown}
      filterLeading={<StatusSegment value={word} onChange={setWord} draft counts={counts} />}
      filterPanel={isPendingView ? filterPanel : undefined}
      panelActiveCount={isPendingView ? activeFilters : 0}
      onPanelReset={() => setLf(NO_FILTERS)}
      getKey={(r) => r.key}
      perms={{ canCreate, canEdit: true, canDelete: false }}
      addLabel="New GRN"
      onAdd={() => {
        setOpenSeq((n) => n + 1);
        setReplacing(null);
        setEditing("");
      }}
      searchText={(r) => [r.no, r.vendor, r.refs, r.detail].filter(Boolean).join(" ")}
      searchPlaceholder={isPendingView ? "Search PO No, vendor, RE No or class…" : "Search GRN No, vendor or invoice…"}
      columns={columns}
      actions={{ onEdit: open, menuAs: "icons" }}
      rowLabel={(r) => r.no}
      empty={
        isPendingView
          ? pendingLines.length === 0
            ? "No approved PO has anything left to receive."
            : "Nothing pending for these filters."
          : word === "draft"
            ? "No GRN is waiting to be posted."
            : "No GRN has been posted yet."
      }
      mobile={{
        title: (r) => r.no,
        subtitle: (r) => r.vendor,
        meta: (r) => (r.word === "pending" ? `${r.lines} line(s) to receive · ${r.refs}` : `${r.refs} · ${fmtDate(r.detail || null)}`),
        pill: (r) =>
          r.word === "pending" ? null : (
            <StatusPill tone={statusTone(r.status)}>{r.status === "posted" ? "Posted" : "Draft"}</StatusPill>
          ),
        onEdit: open,
      }}
    />
  );
}
