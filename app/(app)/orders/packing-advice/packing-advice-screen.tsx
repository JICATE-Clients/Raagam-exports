"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, CalendarRange, ClipboardList, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { RecordPicker } from "@/components/masters/record-picker";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  createdByFacet,
  createdDateFacet,
  flagFacet,
  useFacetFilter,
  type FacetGroup,
} from "@/components/ui/filter-drawer";
import { fmtDate, fmtNumber } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useCreateIntent } from "@/lib/use-create-intent";
import { sectionValidity } from "@/lib/screens/validity";
import { isInactive } from "@/lib/masters/inactive";
import { styleKey } from "@/lib/orders/amendments/style-key";
import { computeCbm } from "@/lib/orders/packing-advice/cbm";
import { deletePackingAdvice, savePackingAdvice } from "@/lib/orders/packing-advice/actions";
import {
  ASSORTMENT_TYPES,
  ASSORTMENT_TYPE_LABELS,
  PLA_STATUSES,
  PLA_STATUS_LABELS,
  isAssortmentType,
  plaStatusTone,
  type AssortmentType,
  type PackingAdvice,
  type PackingAdviceInput,
  type PlaStatus,
} from "@/lib/orders/packing-advice/types";
import {
  adviceTotals,
  blockingProblems,
  isBlankLine,
  lineProblems,
  lineTotalPcs,
  orderFactsFor,
  totalCartons,
  type PackingLineDraft,
} from "@/lib/orders/packing-advice/lines";
import type { PackingAdviceFormData } from "@/lib/orders/packing-advice/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

// ---------------------------------------------------------------------------
// Draft rows. Numbers stay STRINGS until the payload is built, so a half-typed
// "12." survives a render. EVERY SEED IS BLANK — `isBlankLine` drops an
// untouched row by testing typed fields, and a stamped default would make that
// test the constant `true` and save a phantom carton line.
// ---------------------------------------------------------------------------

type LineRow = {
  key: string;
  style_ref_no: string;
  combo: string;
  from_carton_no: string;
  to_carton_no: string;
  assortment_type: AssortmentType | "";
  pcs_per_carton: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  gross_weight: string;
  net_weight: string;
};

type Form = {
  advice_date: string;
  customer_id: string | null;
  sales_order_id: string | null;
  country_id: string | null;
  remarks: string;
};

const blankForm = (): Form => ({
  advice_date: today(),
  customer_id: null,
  sales_order_id: null,
  country_id: null,
  remarks: "",
});

/** "" → null; anything else → a number, or NaN, which the rules refuse by name. */
const num = (s: string): number | null => {
  const t = s.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};
const str = (n: number | null | undefined) => (n == null ? "" : String(n));

const toDraft = (r: LineRow): PackingLineDraft => ({
  style_ref_no: r.style_ref_no || null,
  combo: r.combo || null,
  from_carton_no: num(r.from_carton_no),
  to_carton_no: num(r.to_carton_no),
  assortment_type: r.assortment_type || null,
  pcs_per_carton: num(r.pcs_per_carton),
  length_cm: num(r.length_cm),
  width_cm: num(r.width_cm),
  height_cm: num(r.height_cm),
  gross_weight: num(r.gross_weight),
  net_weight: num(r.net_weight),
});

/**
 * THE HEADER'S CAP — a definite length, never `max-w-fit` (a content-sized cap
 * computes to 0 under `@container/section`). The first line is the five fields
 * the operator fills in order:
 *   code 144 + code 144 + party 200 + party 200 + party 200 = 888
 *   + 4 × 12 gap                                           = 936  → 60rem (960)
 * so the two totals and Remarks fold onto a second line together, the same place
 * on a laptop and on a 1920 monitor.
 */
const HEADER_W = "max-w-[60rem]";

/**
 * THE CARTON GRID'S CAP. Fourteen fields per line do not fit a fixed-width
 * table: at the narrowest honest step each (Style, Colour, Assortment `code`;
 * Line Total Pcs `hug`; the other ten `num`) they come to 1,240px, + 72px of
 * chrome = 1,312 against a 1,155px pane. Dropping the derived CBM still leaves
 * 1,240. So each line WRAPS inside one frame (`forceCards` + `flatRows`). The first line
 * of a record is what goes into the cartons:
 *   term 176 × 2 + num 72 × 3 + code 144 + num 72 + range 112 = 896
 *   + 7 × 12 gap                                              = 980
 *   + the row's ✕ band (~36)                                  = 1016 → 64rem (1024)
 * and the carton's size and weight fold beneath it as the second line.
 */
const LINES_W = "max-w-[64rem]";

/** A line column with the vocabulary width its field takes in the wrapped row. */
type LineCol = ChildGridColumn<LineRow> & { w: FieldWidth };

/**
 * THE LIST'S FILTERS — the grouped drawer (user, 2026-09-23: "implement the
 * Material BOM filter in every Orders child"). The list had no filter bar at
 * all. Every facet is read off the `PackingAdvice` row the table already
 * shows (its lines ride with it for the Cartons / Packed Pcs columns), so
 * none costs a query.
 *
 * NO DELIVERY URGENCY: an advice carries no delivery date of its own, and
 * reaching through to the order's would be a new query for a facet the list
 * cannot show. Assortment Type matches an advice holding ANY line of that
 * type — an advice can mix them; "Weights" asks whether every carton line is
 * weighed (a NULL weight is "not weighed yet", never 0).
 */
const PLA_FACETS: FacetGroup<PackingAdvice>[] = [
  {
    title: "Status & dates",
    icon: <CalendarRange />,
    facets: [
      {
        key: "status",
        label: "Status",
        all: "All statuses",
        wide: true,
        counted: true,
        options: PLA_STATUSES.map((s) => ({ value: s, label: PLA_STATUS_LABELS[s] })),
        match: (r, v) => r.status === v,
      },
      { key: "adviceDate", label: "Date", all: "Any date", date: (r) => r.advice_date },
      createdDateFacet(),
    ],
  },
  {
    title: "Customer & destination",
    icon: <Users />,
    facets: [
      { key: "customer", label: "Customer", all: "All customers", wide: true, value: (r) => r.customer?.name },
      { key: "reNo", label: "RE No", all: "All", value: (r) => r.sales_order?.order_number },
      { key: "destination", label: "Destination", all: "All", value: (r) => r.country?.name },
    ],
  },
  {
    title: "Cartons",
    icon: <Boxes />,
    facets: [
      {
        key: "assortment",
        label: "Assortment Type",
        all: "Any",
        wide: true,
        counted: true,
        options: ASSORTMENT_TYPES.map((a) => ({ value: a, label: ASSORTMENT_TYPE_LABELS[a] })),
        match: (r, v) => r.lines.some((l) => l.assortment_type === v),
      },
      flagFacet<PackingAdvice>(
        "weighed",
        "Weights",
        (r) => r.lines.length > 0 && r.lines.every((l) => l.gross_weight != null && l.net_weight != null),
        "All cartons weighed",
        "Weights missing",
      ),
      createdByFacet(),
    ],
  },
];

export function PackingAdviceScreen({
  rows,
  data,
  perms,
}: {
  rows: PackingAdvice[];
  data: PackingAdviceFormData;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blankForm);
  const [lines, setLines] = useState<LineRow[]>([]);

  /**
   * Real edits, never "is the editor open". The overlay mount only calls
   * `useModalGuard`, which `confirmDiscard()` does not read — so this is what
   * stands between Escape and a silently discarded advice.
   */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);

  // ---- the list's filters (this component has no early return) --------------
  const [query, setQuery] = useState("");
  const facets = useFacetFilter(rows, PLA_FACETS);
  const facetMatches = facets.matches;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!facetMatches(r)) return false;
      if (!needle) return true;
      return [r.code, r.customer?.name, r.sales_order?.order_number, r.country?.name, r.remarks].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [rows, query, facetMatches]);
  const newKey = () => `k${keySeq.current++}`;

  const blankLine = (): LineRow => ({
    key: newKey(),
    style_ref_no: "",
    combo: "",
    from_carton_no: "",
    to_carton_no: "",
    assortment_type: "",
    pcs_per_carton: "",
    length_cm: "",
    width_cm: "",
    height_cm: "",
    gross_weight: "",
    net_weight: "",
  });

  // ---- lookups ---------------------------------------------------------------

  const orderById = useMemo(() => new Map(data.orders.map((o) => [o.id, o])), [data.orders]);
  const countryName = useMemo(() => {
    const m = new Map(data.countries.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "") : "");
  }, [data.countries]);

  const order = form.sales_order_id ? (orderById.get(form.sales_order_id) ?? null) : null;

  /**
   * THE CASCADE: Customer narrows RE No (AGENTS.md "Cascading filters", the
   * form-field half). With no customer chosen every order is offered, and
   * picking one fills the customer — so either field can be the first typed.
   * The order the advice already holds survives the narrowing (Disabled rows).
   */
  const orderItems = useMemo(
    () =>
      data.orders.filter(
        (o) => !form.customer_id || o.customer_id === form.customer_id || o.id === form.sales_order_id,
      ),
    [data.orders, form.customer_id, form.sales_order_id],
  );

  /** Destinations = the countries on the order's Quantities tab (spec §2). */
  const destinationOptions = useMemo(() => {
    const ids = (order?.destinations ?? []).map((d) => d.country_id);
    if (form.country_id && !ids.includes(form.country_id)) ids.push(form.country_id);
    return ids
      .filter((id) => {
        const c = data.countries.find((x) => x.id === id);
        return !c || !isInactive(c) || id === form.country_id;
      })
      .map((id) => ({ id, name: countryName(id) || "(unknown country)" }));
  }, [order, form.country_id, data.countries, countryName]);

  const facts = useMemo(
    () => (order ? orderFactsFor(order, form.country_id) : null),
    [order, form.country_id],
  );

  /** Styles that ship to the chosen destination, in the order's own sequence. */
  const styleOptions = useMemo(
    () =>
      (order?.styles ?? [])
        .filter((s) => facts?.stylesForDestination.has(styleKey(s.style_ref_no)))
        .map((s) => s.style_ref_no),
    [order, facts],
  );
  const combosOf = (style: string): string[] =>
    order?.styles.find((s) => styleKey(s.style_ref_no) === styleKey(style))?.combos ?? [];

  // ---- mutation ----------------------------------------------------------------

  // Every mutation marks the record dirty in the same breath.
  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutLines = (fn: (xs: LineRow[]) => LineRow[]) => {
    setLines(fn);
    setDirty(true);
  };
  const patchLine = (key: string, patch: Partial<LineRow>) =>
    mutLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function pickCustomer(id: string | null) {
    const held = form.sales_order_id ? orderById.get(form.sales_order_id) : null;
    // A held order that is not this customer's falls out of scope — and takes
    // the destination with it, since that was read off the order.
    const keepOrder = !!held && (!id || held.customer_id === id);
    set({
      customer_id: id,
      ...(keepOrder ? {} : { sales_order_id: null, country_id: null }),
    });
  }

  function pickOrder(id: string | null) {
    const o = id ? orderById.get(id) : null;
    const dests = o?.destinations ?? [];
    const keepCountry = !!form.country_id && dests.some((d) => d.country_id === form.country_id);
    set({
      sales_order_id: id,
      customer_id: o?.customer_id ?? form.customer_id,
      // One destination on the order is the only possible answer — filled on
      // the operator's pick, never seeded.
      country_id: keepCountry ? form.country_id : dests.length === 1 ? dests[0].country_id : null,
    });
  }

  function pickStyle(key: string, style: string) {
    const combos = style ? combosOf(style) : [];
    patchLine(key, {
      style_ref_no: style,
      // A style with one colour has one answer; otherwise the colour is re-chosen.
      combo: combos.length === 1 ? combos[0] : "",
    });
  }

  // ---- open --------------------------------------------------------------------

  /** Seeded HERE, before `setDirty(false)` — not `seedRow`, whose `onAdd` would
   *  open every advice reading "Unsaved changes". */
  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setLines([blankLine()]);
    setDirty(false);
    setMode("edit");
  }
  // The palette's "New packing advice" (`?new=1`). No early return in this
  // component, so its hooks cannot be skipped.
  useCreateIntent(() => {
    if (perms.canCreate) openAdd();
  });

  function openEdit(r: PackingAdvice) {
    setEditId(r.id);
    setForm({
      advice_date: r.advice_date ?? today(),
      customer_id: r.customer_id,
      sales_order_id: r.sales_order_id,
      country_id: r.country_id,
      remarks: r.remarks ?? "",
    });
    setLines(
      r.lines.length
        ? r.lines.map((l) => ({
            key: newKey(),
            style_ref_no: l.style_ref_no,
            combo: l.combo,
            from_carton_no: str(l.from_carton_no),
            to_carton_no: str(l.to_carton_no),
            assortment_type: isAssortmentType(l.assortment_type) ? l.assortment_type : "",
            pcs_per_carton: str(l.pcs_per_carton),
            length_cm: str(l.length_cm),
            width_cm: str(l.width_cm),
            height_cm: str(l.height_cm),
            gross_weight: str(l.gross_weight),
            net_weight: str(l.net_weight),
          }))
        : [blankLine()],
    );
    setDirty(false);
    setMode("edit");
  }

  // ---- validity ------------------------------------------------------------------

  const drafts = lines.map(toDraft);
  const totals = adviceTotals(drafts);
  const allProblems = lineProblems(drafts, facts);
  // Every `custom` problem blocks in `sectionValidity`, so an advisory (a
  // skipped carton number) never reaches it — it is shown under the grid instead.
  const problems = blockingProblems(allProblems);
  const advisories = allProblems.filter((p) => p.advisory);

  /** DERIVED, never hand-assembled: the header's four mandatory fields mirror
   *  their `required` props; every line rule is `lineProblems`, the SAME
   *  function the action runs before it writes. */
  const validity = sectionValidity({
    sections: [{ key: "header" }, { key: "lines" }],
    values: form,
    fields: [
      { section: "header", id: "pa-date", label: "Date", required: true, empty: (f) => !f.advice_date },
      { section: "header", id: "pa-customer", label: "Customer", required: true, empty: (f) => !f.customer_id },
      { section: "header", id: "pa-order", label: "RE No", required: true, empty: (f) => !f.sales_order_id },
      { section: "header", id: "pa-dest", label: "Destination", required: true, empty: (f) => !f.country_id },
    ],
    extra: problems.map((p) => ({
      section: "lines",
      label: "Cartons",
      message: p.message,
      kind: "custom" as const,
    })),
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  function submit(status: PlaStatus) {
    // Draft or final, the same rules: the database refuses an incomplete line
    // either way, so a draft that skipped them would only fail later and vaguer.
    if (!validity.canSave || !form.customer_id || !form.sales_order_id || !form.country_id)
      return revealFirstProblem();
    const payload: PackingAdviceInput = {
      status,
      advice_date: form.advice_date,
      customer_id: form.customer_id,
      sales_order_id: form.sales_order_id,
      country_id: form.country_id,
      remarks: form.remarks.trim() || null,
      // The rules have passed, so every kept line is complete; blanks stay behind.
      lines: drafts
        .filter((d) => !isBlankLine(d))
        .map((d) => ({
          style_ref_no: d.style_ref_no ?? "",
          combo: d.combo ?? "",
          from_carton_no: d.from_carton_no ?? 0,
          to_carton_no: d.to_carton_no ?? 0,
          assortment_type: d.assortment_type ?? "solid_size",
          pcs_per_carton: d.pcs_per_carton ?? 0,
          length_cm: d.length_cm,
          width_cm: d.width_cm,
          height_cm: d.height_cm,
          gross_weight: d.gross_weight,
          net_weight: d.net_weight,
        })),
    };
    start(async () => {
      const res = await savePackingAdvice(editId, payload);
      if (res.ok) {
        success(editId ? "Packing advice updated" : "Packing advice created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: PackingAdvice) {
    // No confirm() — <RowActions> asks in the row (LAYOUT.md §6a).
    start(async () => {
      const res = await deletePackingAdvice(r.id);
      if (res.ok) {
        success("Packing advice deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the list ------------------------------------------------------------------

  const listTotals = (r: PackingAdvice) =>
    r.lines.reduce(
      (t, l) => ({ cartons: t.cartons + (l.total_cartons ?? 0), pcs: t.pcs + (l.line_total_pcs ?? 0) }),
      { cartons: 0, pcs: 0 },
    );

  const columns: Column<PackingAdvice>[] = [
    {
      header: "Packing Advice No",
      cell: (r) => (
        <button
          type="button"
          onClick={() => perms.canEdit && openEdit(r)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {r.code ?? "—"}
        </button>
      ),
    },
    { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.advice_date)}</span> },
    { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
    {
      header: "RE No",
      cell: (r) => <span className="font-mono text-xs">{r.sales_order?.order_number ?? "—"}</span>,
    },
    { header: "Destination", cell: (r) => <span className="text-sm">{r.country?.name ?? "—"}</span> },
    {
      header: "Cartons",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(listTotals(r).cartons)}</span>,
    },
    {
      header: "Packed Pcs",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(listTotals(r).pcs)}</span>,
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={plaStatusTone(r.status)}>{PLA_STATUS_LABELS[r.status]}</StatusPill>,
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.code}
        onEdit={() => openEdit(r)}
        canEdit={perms.canEdit}
        onDelete={() => del(r)}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
  ];

  // ---- the carton grid -------------------------------------------------------------

  const numCell = (value: string, onChange: (v: string) => void, required = false) => (
    <Input
      className="h-8 text-right"
      inputMode="decimal"
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  const derivedCell = (value: string) => (
    <Input readOnly className="h-8 bg-surface-muted text-right" value={value} />
  );

  /** The thirteen fields of a carton line, declared once — labels and cells of
   *  the wrapped row are both read off this array. */
  const lineColumns: LineCol[] = [
    {
      header: "Style / Article No",
      required: true,
      w: "term",
      cell: (r) => {
        // The style a line already holds survives, even if it left the order.
        const opts = styleOptions.includes(r.style_ref_no) || !r.style_ref_no
          ? styleOptions
          : [r.style_ref_no, ...styleOptions];
        return (
          <Select className="h-8" value={r.style_ref_no} onChange={(e) => pickStyle(r.key, e.target.value)}>
            <option value=""></option>
            {opts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "Colour / Shade",
      required: true,
      w: "term",
      cell: (r) => {
        const combos = r.style_ref_no ? combosOf(r.style_ref_no) : [];
        const opts = combos.includes(r.combo) || !r.combo ? combos : [r.combo, ...combos];
        return (
          <Select className="h-8" value={r.combo} onChange={(e) => patchLine(r.key, { combo: e.target.value })}>
            <option value=""></option>
            {opts.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "Ctn From",
      required: true,
      w: "num",
      cell: (r) => numCell(r.from_carton_no, (v) => patchLine(r.key, { from_carton_no: v }), true),
    },
    {
      header: "Ctn To",
      required: true,
      w: "num",
      cell: (r) => numCell(r.to_carton_no, (v) => patchLine(r.key, { to_carton_no: v }), true),
    },
    {
      header: "Total Ctns",
      w: "num",
      cell: (r) => derivedCell(str(totalCartons(num(r.from_carton_no), num(r.to_carton_no)))),
    },
    {
      header: "Assortment Type",
      required: true,
      w: "code",
      cell: (r) => (
        <Select
          className="h-8"
          value={r.assortment_type}
          onChange={(e) =>
            patchLine(r.key, { assortment_type: isAssortmentType(e.target.value) ? e.target.value : "" })
          }
        >
          <option value=""></option>
          {ASSORTMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ASSORTMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Pcs / Ctn",
      required: true,
      w: "num",
      cell: (r) => numCell(r.pcs_per_carton, (v) => patchLine(r.key, { pcs_per_carton: v }), true),
    },
    {
      header: "Line Total Pcs",
      w: "range",
      cell: (r) => derivedCell(str(lineTotalPcs(toDraft(r)))),
    },
    // One carton's size — CBM beside it is DERIVED (`computeCbm`), never typed.
    { header: "L (cm)", w: "num", cell: (r) => numCell(r.length_cm, (v) => patchLine(r.key, { length_cm: v })) },
    { header: "W (cm)", w: "num", cell: (r) => numCell(r.width_cm, (v) => patchLine(r.key, { width_cm: v })) },
    { header: "H (cm)", w: "num", cell: (r) => numCell(r.height_cm, (v) => patchLine(r.key, { height_cm: v })) },
    {
      header: "CBM",
      w: "num",
      cell: (r) => {
        const d = toDraft(r);
        const cbm = computeCbm(d.length_cm, d.width_cm, d.height_cm, totalCartons(d.from_carton_no, d.to_carton_no));
        return derivedCell(cbm != null ? cbm.toFixed(3) : "");
      },
    },
    // Per carton, blank until weighed (never 0) — for the shipping bill and B/L.
    { header: "Gross Wt (kg)", w: "hug", cell: (r) => numCell(r.gross_weight, (v) => patchLine(r.key, { gross_weight: v })) },
    { header: "Net Wt (kg)", w: "hug", cell: (r) => numCell(r.net_weight, (v) => patchLine(r.key, { net_weight: v })) },
  ];

  // ---- sections ------------------------------------------------------------------

  const code = editId ? (rows.find((r) => r.id === editId)?.code ?? null) : null;
  const orderLabel = order?.code ?? null;

  /** THE SCREEN'S OWN NAME IS THE FIRST RAIL ROW (operator's rule 1). */
  const sections: FullScreenSection[] = [
    {
      key: "header",
      label: "Packing List Advice",
      icon: ClipboardList,
      done: !!form.sales_order_id && !!form.country_id,
      content: (
        <SectionBody title="Packing List Advice">
          <div className={HEADER_W}>
            <FieldRow>
              {/* `Input readOnly` takes itself off the Tab path. */}
              <Field label="Packing Advice No" w="code" htmlFor="pa-no">
                <Input id="pa-no" readOnly value={code ?? ""} className="font-mono" />
              </Field>
              <Field label="Date" required w="code" htmlFor="pa-date">
                <Input
                  id="pa-date"
                  type="date"
                  value={form.advice_date}
                  onChange={(e) => set({ advice_date: e.target.value })}
                />
              </Field>
              {/* The pickers draw their own label; `Field` carries the width. */}
              <Field w="party">
                <RecordPicker
                  id="pa-customer"
                  label="Customer"
                  required
                  items={data.customers}
                  value={form.customer_id}
                  onChange={pickCustomer}
                />
              </Field>
              <Field w="party">
                <RecordPicker
                  id="pa-order"
                  label="Order Ref (RE No)"
                  required
                  items={orderItems}
                  value={form.sales_order_id}
                  onChange={pickOrder}
                />
              </Field>
              <Field label="Destination / Country" required w="party" htmlFor="pa-dest">
                <Select
                  id="pa-dest"
                  value={form.country_id ?? ""}
                  onChange={(e) => set({ country_id: e.target.value || null })}
                >
                  <option value=""></option>
                  {destinationOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* Sums over the carton lines, never stored (0579 §3). */}
              <Field label="Total Cartons" w="hug" htmlFor="pa-ctns">
                <Input id="pa-ctns" readOnly className="bg-surface-muted text-right" value={fmtNumber(totals.cartons)} />
              </Field>
              <Field label="Total Packed Pcs" w="range" htmlFor="pa-pcs">
                <Input id="pa-pcs" readOnly className="bg-surface-muted text-right" value={fmtNumber(totals.pcs)} />
              </Field>
              <Field label="Remarks" w="name" htmlFor="pa-remarks">
                <Input id="pa-remarks" value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
              </Field>
            </FieldRow>
            {order && order.destinations.length === 0 && (
              <p className="mt-2 text-xs text-warning">
                This order&apos;s Quantities tab names no destination, so there is nothing to pack it for yet.
              </p>
            )}
          </div>
        </SectionBody>
      ),
    },
    {
      key: "lines",
      label: "Cartons",
      icon: Boxes,
      done: drafts.some((d) => !isBlankLine(d)),
      content: (
        <SectionBody title="Cartons">
          <div className={LINES_W}>
            <ChildGrid<LineRow>
              columns={lineColumns}
              rows={lines}
              forceCards
              flatRows
              renderMobileRow={(row, i) => (
                <FieldRow>
                  {lineColumns.map((c, ci) => (
                    // `required` goes on the Field too — cards mode only wraps a
                    // cell in `RequiredScope` when it renders the columns itself.
                    <Field key={ci} label={c.header} required={c.required} w={c.w}>
                      {c.cell(row, i)}
                    </Field>
                  ))}
                </FieldRow>
              )}
              onAdd={() => mutLines((xs) => [...xs, blankLine()])}
              onRemove={(r) => mutLines((xs) => xs.filter((x) => x.key !== r.key))}
              addLabel="+ Add carton line"
            />
            {/* Amber, never a hold: a withheld carton (inspection, sample, split
                shipment) is legitimate, so this is said and Save stays open. */}
            {advisories.map((p, i) => (
              <p key={i} className="mt-2 text-xs text-warning">
                {p.message}
              </p>
            ))}
          </div>
        </SectionBody>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Packing List Advice"
          description="Carton ranges, assortment and weights for an order's destination."
          actions={perms.canCreate ? <Button onClick={openAdd}>New packing advice</Button> : undefined}
        />
        <FilterBar
          search={query}
          onSearch={setQuery}
          searchPlaceholder="Search advice no, customer or RE No…"
          activeCount={facets.activeCount}
          onReset={facets.activeCount ? facets.reset : undefined}
          panel={facets.panel}
          right={`${filtered.length} of ${rows.length}`}
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={filtered}
          getKey={(r) => r.id}
          empty={rows.length ? "No packing advices match these filters." : "No packing advices yet."}
        />
      </div>

      {/* A FULL-SCREEN TAKEOVER (operator's rule 3): the module sidebar beside a
          section rail is two navigation lists on one screen. */}
      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">packing list advice</span>
          </>
        }
        header={{
          initials: "PL",
          title: code ?? "New packing advice",
          badges: dirty ? <span className="text-[11px] font-medium text-warning">● Unsaved</span> : null,
          meta: (
            <>
              {orderLabel && <span>{orderLabel}</span>}
              {form.country_id && <span>· {countryName(form.country_id)}</span>}
              <span>
                · {fmtNumber(totals.cartons)} ctns · {fmtNumber(totals.pcs)} pcs
              </span>
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New packing advice",
          onCancel: () => setMode("list"),
          onSaveDraft: perms.canCreate || perms.canEdit ? () => submit("draft") : undefined,
          onSave: () => submit("finalised"),
          saveLabel: "Save packing advice",
          canSave: validity.canSave,
          // Save stays clickable when blocked, names the problem and steers there.
          onBlockedSave: revealFirstProblem,
          isPending,
        }}
      />
    </>
  );
}
