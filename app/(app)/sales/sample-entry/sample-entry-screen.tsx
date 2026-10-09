"use client";

/**
 * Sample ▸ Samples & Development ▸ Sample Entry — the list, and the entry
 * editor as an OVERLAY mode of it (raagam-screen-layout, the operator's rule 3).
 *
 * doc/sample/sample-module-specification.md merges the legacy "Create
 * Opportunities" and "Define Styles" into ONE document (0683):
 *
 *   Sample Info        the enquiry header (spec §3.1)
 *     Styles           the style lines, Unit PCS / SET + Coordinates (§3.2–3.3)
 *   Product Info       per style line: merchandising, fabric, delivery, billing (§4)
 *     Combos           colourways × sizes (§5)
 *     Quantities       destinations + Assortment — only for a BILLABLE line (§4.3, §6)
 *
 * Product Info is a FORM per style line, so it leads with a style switcher.
 * Combos and Quantities are GRIDS per style line, and follow Order Entry
 * instead (raagam-screen-layout, references/orders-precedent.md §8): every
 * style's grid is on screen at once, each under a `StyleIdentityBand`, never
 * one style at a time behind a switcher.
 *
 * THE CHILD GRIDS WERE REBUILT ON 2026-10-06 to Order Entry's shapes (user:
 * "the new sample implement child came wrong"): the Styles row carries its
 * Coordinates and Sizes on a composition line under it (precedent §3), the
 * combo × size matrix and the Assortment are `matrix-grid.ts` CSS grids that
 * never fold to cards (§5), Quantities is the spreadsheet table (§4), and no
 * cell sets its own height.
 *
 * NO EARLY RETURN — the list and the overlay render side by side, so there is
 * no "hooks below the branch" hazard (AGENTS.md "Hooks above every early
 * return"). Keep it that way.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Calculator, ClipboardList, Package, Palette, Shirt, Users, CalendarRange, Layers, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow, FIELD_WIDTH_CSS, fieldWidthStep } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup } from "@/components/ui/segmented";
import { Truncated } from "@/components/ui/truncated";
import { MultiSelect } from "@/components/ui/multi-select";
import { ChildGrid, gridKeyNav, RowRemoveChip, type ChildGridColumn } from "@/components/masters/child-grid";
import { Tooltip } from "@/components/ui/tooltip";
import { StyleIdentityBand } from "@/components/orders/style-identity-band";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import {
  MATRIX_FOOT,
  MATRIX_HEAD,
  MATRIX_SIZE_TOKEN,
  matrixCell,
  sizeColPx,
} from "@/components/orders/matrix-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { RecordPicker } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CountryPicker } from "@/components/masters/country-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { FileAttachments } from "@/components/ui/file-attachments";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdByFacet, createdDateFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { TypeOrPick } from "@/app/(app)/orders/_garment-order/type-or-pick";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useCreateIntent } from "@/lib/use-create-intent";
import { sectionValidity, type Problem } from "@/lib/screens/validity";
import { isInactive } from "@/lib/masters/inactive";
import { sizeFamily, sortBySize } from "@/lib/masters/size-order";
import { orderUnitLabel } from "@/lib/orders/amendments/types";
import { UNIT_KIND_OPTIONS, coordinatesFull, isUnitKind, pieceCoordinateId } from "@/lib/orders/styles/rules";
import {
  DELIVERY_MODES,
  ENQUIRY_ACTIONS,
  ENQUIRY_AGAINST,
  RECEIPT_MODES,
  SAMPLE_FILE_KINDS,
  SHIP_MODES,
  TECH_PACK,
  comboOrderQty,
  effectiveValue,
  isBlankCombo,
  isBlankQuantity,
  isBlankStyle,
  assortStarted,
  assortTotal,
  labelOf,
  sampleAssortMode,
  sampleEntryProblems,
  sampleLocalValue,
  toSampleEntryPayload,
  type ComboDraft,
  type CoordinateDraft,
  type InheritedField,
  type QuantityDraft,
  type SampleEntryListRow,
  type SampleHeaderDraft,
  type SampleProblem,
  type StyleDraft,
} from "@/lib/sales/sample-entry/types";
import type { SampleEntryFormData } from "@/lib/sales/sample-entry/service";
import {
  deleteSampleEntry,
  loadSampleEntry,
  previewSampleNumbers,
  saveSampleEntry,
} from "@/lib/sales/sample-entry/actions";
import { AssortmentSheet } from "./assortment-sheet";
import { AllocationStrip } from "./allocation-strip";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type MasterPerms = { canCreate: boolean; canEdit: boolean };

/**
 * THE HEADER'S CAP — a definite length, never `max-w-fit` (a content-sized cap
 * computes to 0 under `@container/section`). Two lines (client 2026-10-08),
 * seven fields on the first:
 *   Enquiry No code 144 + Date code 144 + Against term 176 + Action party 200
 *   + Customer party 200 + Season range 112 + Year hug 88          = 1064
 *   + 6 × 12 gap                                                   = 1136 → 71rem
 * and line 2: Country 176 + Agent 200 + Received Mode 176 + Receipt Dt 144
 *   + Delivery Mode 176 = 872 + 48 gap = 920.
 * 72rem (1152) fits the 1155px content width from 1366 up.
 * (Cust Ref and Delivery To came off on 2026-10-06, client; Receipt Dt moved
 * here from Product Info the same day.)
 */
const HEADER_W = "max-w-[72rem]";

/**
 * Product Info's cap. The inherited identity is a text band now, not boxes, so
 * the widest FIELD row is Merchandiser · Fabric Structure · Fabric Code (party
 * 200 each) + GSM num 72 + Tech Pack term 176 = 848 + 4 × 12 gap = 896, under
 * 61rem (976); the receipt row with Order Dt is 888.
 */
// 67rem (1072px): Merchandiser 200 + Order Dt 144 + Agent 200 + Delivery Mode
// 176 + the two switches (~270) + gaps ≈ 1035px, so the whole Order row fits on
// ONE line and Billable is not pushed under Accessories Reqd (user 2026-10-08).
const PRODUCT_W = "max-w-[67rem]";

/** A hairline-ruled group label above a row of Product Info fields. */
function PiLegend({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground after:h-px after:flex-1 after:bg-border">
      {children}
    </div>
  );
}

/** Year choices for "Season & Year" — last year to three ahead, no typing. */
const yearOptions = (() => {
  const y = new Date().getFullYear();
  return [y - 1, y, y + 1, y + 2, y + 3].map(String);
})();

/** Earlier Shipment Dt defaults to a week before Delivery — Order Entry's rule. */
const weekBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() - 7);
  return today(d);
};

const blankHeader = (): SampleHeaderDraft => ({
  received_date: today(),
  enquiry_against: "",
  enquiry_action: "",
  customer_id: null,
  country_id: null,
  season_id: null,
  season_year: String(new Date().getFullYear()),
  customer_reference: "",
  agent_id: null,
  receipt_mode: "",
  receipt_date: "",
  delivery_to: "",
  delivery_mode: "",
  multi_order: false,
});

const SAMPLE_FACETS: FacetGroup<SampleEntryListRow>[] = [
  {
    title: "Status & dates",
    icon: <CalendarRange />,
    facets: [
      {
        key: "status",
        label: "Status",
        all: "All",
        counted: true,
        options: [
          { value: "draft", label: "Draft" },
          { value: "saved", label: "Saved" },
        ],
        match: (r, v) => (r.is_draft ? "draft" : "saved") === v,
      },
      { key: "date", label: "Date", all: "Any date", date: (r) => r.received_date },
    ],
  },
  {
    title: "Enquiry",
    icon: <Layers />,
    facets: [
      {
        key: "against",
        label: "Against",
        all: "Any",
        counted: true,
        options: ENQUIRY_AGAINST.map((o) => ({ value: o.value, label: o.label })),
        match: (r, v) => r.enquiry_against === v,
      },
      {
        key: "action",
        label: "Action",
        all: "Any",
        counted: true,
        options: ENQUIRY_ACTIONS.map((o) => ({ value: o.value, label: o.label })),
        match: (r, v) => r.enquiry_action === v,
      },
      {
        key: "billable",
        label: "Billable",
        all: "Any",
        counted: true,
        options: [
          { value: "yes", label: "Has a billable style" },
          { value: "no", label: "Free of cost only" },
        ],
        match: (r, v) => (r.billable_count > 0 ? "yes" : "no") === v,
      },
    ],
  },
  { title: "Created", icon: <Users />, facets: [createdDateFacet(), createdByFacet()] },
];

/**
 * THE PENDING · UPDATED · DRAFT BOX — the one every Orders list carries
 * (`useQuickStatus`, the Garment Orders list's `leading` slot). A saved entry is
 * PENDING: the next step, the PD Request (spec §7.1), is not built yet, so
 * nothing moves an entry on to Updated today and that word counts 0 until it
 * does. Module-level so its identity is stable (the hook memoises on it).
 */
const sampleWordOf = (r: SampleEntryListRow): QuickWord => (r.is_draft ? "draft" : "pending");
const QUICK_LABEL: Record<QuickWord, string> = { pending: "Pending", updated: "Updated", draft: "Draft" };

export function SampleEntryScreen({
  rows,
  data,
  perms,
  masterPerms,
  nextEnquiryNo,
}: {
  rows: SampleEntryListRow[];
  data: SampleEntryFormData;
  perms: Perms;
  masterPerms: MasterPerms;
  /** Fetched with the page so a new entry's Enquiry No is filled on first paint. */
  nextEnquiryNo: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [header, setHeader] = useState<SampleHeaderDraft>(blankHeader);
  const [styles, setStyles] = useState<StyleDraft[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  /**
   * Real edits, never "is the editor open". The overlay mount means
   * `MasterFullScreen` only calls `useModalGuard`, which `confirmDiscard()`
   * deliberately does not read — so THIS is what stands between Escape and a
   * silently discarded entry, and what holds off the silent auto-reload.
   */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  /** Enquiry No / Sample No PREDICTIONS for a new entry (0683 `peek_sample_number`). */
  const [preview, setPreview] = useState<{ enquiryNo: string | null; sampleNos: string[] }>({
    enquiryNo: nextEnquiryNo,
    sampleNos: [],
  });
  const previewSeq = useRef(0);
  const askPreview = (on: string) => {
    const seq = ++previewSeq.current;
    void previewSampleNumbers(on || null, 12).then((p) => {
      if (seq === previewSeq.current) setPreview(p);
    });
  };

  const shellRef = useRef<MasterFullScreenHandle>(null);
  /** Where a NEW entry's attachments upload before it has an id — one folder
   *  per editor session; a saved entry uploads under its own id. */
  const [uploadFolder] = useState(() => `new-${crypto.randomUUID()}`);
  const keySeq = useRef(0);
  const newKey = () => `n${keySeq.current++}`;

  // ---- the Assortment sub-sheet (one quantity line of one style) -----------
  const [assortSheet, setAssortSheet] = useState<{ styleKey: string; qtyKey: string } | null>(null);

  // ---- the list's filters ------------------------------------------------
  const [query, setQuery] = useState("");
  const facets = useFacetFilter(rows, SAMPLE_FACETS);
  const facetMatches = facets.matches;
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!facetMatches(r)) return false;
      if (!needle) return true;
      return [r.code, r.customer_name].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [rows, query, facetMatches]);
  // Counted over every OTHER filter, so a word's figure is what clicking it shows.
  const quick = useQuickStatus(sampleWordOf, { countRows: searched });
  const filtered = searched.filter(quick.matches);

  // ---- option lists (derived; cheap passes over props) --------------------
  const lookupsOf = (kind: string) => data.lookups.filter((l) => l.kind === kind);
  /** Agent = a qualifying vendor (Buying / Service Agent, 0686) — plus the one
   *  this field already holds, so a re-classified vendor still shows. */
  const agentItemsFor = (held: string | null) => data.agents.filter((a) => a.qualifies || a.id === held);
  const shipTypeLookups = lookupsOf("ship_type");
  const assortTypeLookups = lookupsOf("assortment_type");
  const colourOptions = lookupsOf("fabric_color")
    .filter((l) => !isInactive(l))
    .map((l) => ({ id: l.id, name: l.name }));
  const sizeOptions = sortBySize(
    lookupsOf("size").map((l) => ({ id: l.name, label: l.name, inactive: isInactive(l) })),
    (o) => o.label,
  );
  /** The PIECES coordinate a PCS line is prefilled with (Order Entry, client
   *  2026-08-29: "if choose the PCS it automatically choosing … PIECES"). */
  const piecesCoordinateId = pieceCoordinateId(data.coordinates);
  const customerOf = (id: string | null) => data.customers.find((c) => c.id === id) ?? null;
  const countryName = (id: string | null) => data.countries.find((c) => c.id === id)?.name ?? "";

  // ---- mutation helpers -----------------------------------------------------
  const setH = (patch: Partial<SampleHeaderDraft>) => {
    setHeader((h) => ({ ...h, ...patch }));
    setDirty(true);
  };
  const mutStyles = (fn: (xs: StyleDraft[]) => StyleDraft[]) => {
    setStyles(fn);
    setDirty(true);
  };
  const patchStyle = (key: string, patch: Partial<StyleDraft>) =>
    mutStyles((xs) => xs.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const patchQty = (styleKey: string, qtyKey: string, patch: Partial<QuantityDraft>) =>
    mutStyles((xs) =>
      xs.map((s) =>
        s.key === styleKey
          ? { ...s, quantities: s.quantities.map((q) => (q.key === qtyKey ? { ...q, ...patch } : q)) }
          : s,
      ),
    );

  // ---- factories (every key the factory stamps is blank — AGENTS.md
  // "THE SEEDED ROW IS SAVED UNLESS THE SAVE SIDE DROPS IT") ----------------
  const blankCombo = (): ComboDraft => ({ key: newKey(), combo: "", sizes: {} });
  /** Order Entry's `blankQuantity`: the dates start from the line's Delivery Dt
   *  (OE: the header's), Earlier Shipment a week before it. */
  const blankQuantity = (st?: StyleDraft | null): QuantityDraft => ({
    key: newKey(),
    country_id: null,
    ref_no: "",
    consignee_id: null,
    assortment_type_id: null,
    po_qty: "",
    delivery_date: st?.delivery_date ?? "",
    earlier_shipment_date: st?.delivery_date ? weekBefore(st.delivery_date) : "",
    discharge_port_id: null,
    final_destination_id: null,
    pack: "",
    no_of_cartons: "",
    master_carton_name: "",
    po_no: "",
    ratio_for: "",
    is_single_style_pack: true,
    lines: [],
  });
  const blankStyle = (): StyleDraft => ({
    key: newKey(),
    id: null,
    sample_no: null,
    name: "",
    article_no: "",
    description: "",
    // BLANK and required, as Order Entry's Order Unit is (7924) — a default PCS
    // is an answer nobody gave. Answering it seeds the coordinates (`setUnit`).
    unit_kind: "",
    sample_qty: "",
    delivery_date: "",
    merchandiser_id: null,
    order_date: today(),
    fabric_structure_id: null,
    fabric_id: null,
    gsm: "",
    tech_pack: "",
    customer_reference: "",
    receipt_mode: "",
    receipt_date: "",
    delivery_to: "",
    agent_id: null,
    delivery_mode: "",
    delivery_through: "",
    accessories_reqd: false,
    billable: false,
    ship_type_id: null,
    ship_mode: "",
    currency_code: null,
    price: "",
    exchange_rate: "",
    files: [],
    coordinates: [],
    sizes: [],
    combos: [blankCombo()],
    // Quantities is ONE grid for the entry (Order Entry's), which seeds its own
    // first row — a blank row per style would put N blanks in it.
    quantities: [],
  });

  /** Every grid opens with one row ready (AGENTS.md "Editable sub-tables open
   *  with a row") — seeded in STATE here, before `setDirty(false)`, never by a
   *  grid's `seedRow`, which would mark an untouched entry "Unsaved". */
  const withSeeds = (s: StyleDraft): StyleDraft => ({
    ...s,
    // A PCS line saved before PIECES was prefilled opens with it, here and not
    // through a grid's `seedRow` (which would mark the entry "Unsaved").
    coordinates:
      s.unit_kind === "piece" && s.coordinates.length === 0
        ? [{ key: newKey(), coordinate_id: piecesCoordinateId }]
        : s.coordinates,
    combos: s.combos.length ? s.combos : [blankCombo()],
  });

  // ---- open -------------------------------------------------------------------
  function openAdd() {
    const first = blankStyle();
    setEditId(null);
    setEditCode(null);
    setHeader(blankHeader());
    setStyles([first]);
    setActiveKey(first.key);
    setPreview({ enquiryNo: nextEnquiryNo, sampleNos: [] });
    askPreview(today());
    setDirty(false);
    setMode("edit");
  }
  useCreateIntent(() => {
    if (perms.canCreate) openAdd();
  });

  function openEdit(r: SampleEntryListRow) {
    start(async () => {
      const res = await loadSampleEntry(r.id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const seeded = res.record.styles.map(withSeeds);
      const list = seeded.length ? seeded : [blankStyle()];
      setEditId(res.record.id);
      setEditCode(res.record.code);
      setHeader({
        ...res.record.header,
        // An enquiry raised on the old bulk screen has no Date; today stands in.
        received_date: res.record.header.received_date || today(),
      });
      setStyles(list);
      setActiveKey(list[0]?.key ?? null);
      setDirty(false);
      setMode("edit");
    });
  }

  // ---- the active style line --------------------------------------------------
  const realStyles = styles.filter((s) => !isBlankStyle(s));
  const active = styles.find((s) => s.key === activeKey) ?? realStyles[0] ?? styles[0] ?? null;
  const billableStyles = realStyles.filter((s) => s.billable);
  const indexOf = (s: StyleDraft) => styles.findIndex((x) => x.key === s.key);
  const styleLabel = (s: StyleDraft) => `${indexOf(s) + 1} · ${s.name.trim() || "Unnamed style"}`;

  /** A new line's Sample No is a prediction, in the order the new lines sit. */
  const sampleNoOf = (s: StyleDraft) => {
    if (s.sample_no) return s.sample_no;
    const fresh = styles.filter((x) => !x.id && !isBlankStyle(x));
    const i = fresh.findIndex((x) => x.key === s.key);
    return i >= 0 ? (preview.sampleNos[i] ?? "") : "";
  };

  // ---- validity ---------------------------------------------------------------
  /** The Assortment Type's mode, for the save rules (declared before them). */
  const modeOfTypeEarly = (id: string | null) => sampleAssortMode(assortTypeLookups.find((l) => l.id === id));
  const sampleProblems = sampleEntryProblems(header, styles, { modeOf: (id) => modeOfTypeEarly(id) });
  const asProblem = (p: SampleProblem): Problem => ({
    section: p.section,
    fieldId: p.fieldId,
    label: p.label,
    message: p.message,
    kind: "custom",
  });
  const validity = sectionValidity({
    sections: [{ key: "info" }, { key: "styles" }, { key: "product" }, { key: "combos" }, { key: "quantities" }],
    values: header,
    // Every rule is in `sampleEntryProblems`, the list the server's schema
    // mirrors — so the star, the hold, this gate and the action cannot drift.
    fields: [],
    extra: sampleProblems.map(asProblem),
  });

  /** Switch to the offending style line FIRST, then the section and field. */
  const reveal = (p: SampleProblem | undefined) => {
    if (!p) return;
    toastError(p.message);
    if (p.styleKey) setActiveKey(p.styleKey);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };
  const revealFirstProblem = () =>
    reveal(sampleProblems.find((p) => p.message === validity.first?.message) ?? sampleProblems[0]);

  function submit(asDraft: boolean) {
    if (asDraft) {
      // A draft still needs what makes it a record at all.
      const structural = sampleEntryProblems(header, styles, { draft: true, modeOf: (id) => modeOfTypeEarly(id) });
      if (structural.length) {
        reveal(structural[0]);
        return;
      }
    } else if (!validity.canSave) {
      revealFirstProblem();
      return;
    }
    const payload = toSampleEntryPayload(header, styles, asDraft);
    start(async () => {
      const res = await saveSampleEntry(editId, payload);
      if (res.ok) {
        success(
          asDraft
            ? `Draft saved${res.code ? ` — ${res.code}` : ""}`
            : editId
              ? "Sample entry updated"
              : `Sample entry created${res.code ? ` — ${res.code}` : ""}`,
        );
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: SampleEntryListRow) {
    // No confirm() — <RowActions> asks in the row (LAYOUT.md §6a).
    start(async () => {
      const res = await deleteSampleEntry(r.id);
      if (res.ok) {
        success("Sample entry deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the list -----------------------------------------------------------------
  /**
   * THE GARMENT ORDERS LIST'S CELLS (garment-order-screen.tsx, `compact` table):
   * text-xs throughout, the number a mono link, dates `tabular-nums`, figures
   * right-aligned `font-mono`. No Status column — the Pending · Draft box above
   * answers it, as it does on Orders. No eye: the Enquiry No link already opens
   * the entry, and on Orders the eye's slot is the Reports icon, which an entry
   * gains once a sample report exists (spec §7, deferred).
   */
  const listColumns: Column<SampleEntryListRow>[] = [
    {
      header: "Enquiry No",
      className: HUG,
      cell: (r) => (
        <button
          type="button"
          onClick={() => openEdit(r)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {r.code ?? "—"}
        </button>
      ),
    },
    { header: "Date", className: HUG, cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.received_date)}</span> },
    {
      header: "Customer",
      cell: (r) => (
        <Truncated className="block max-w-[11rem] text-xs">{r.customer_name ?? "—"}</Truncated>
      ),
    },
    { header: "Against", className: HUG, cell: (r) => <span className="text-xs">{labelOf(ENQUIRY_AGAINST, r.enquiry_against) || "—"}</span> },
    { header: "Action", className: HUG, cell: (r) => <span className="text-xs">{labelOf(ENQUIRY_ACTIONS, r.enquiry_action) || "—"}</span> },
    {
      header: "Season",
      className: HUG,
      cell: (r) => (
        <span className="text-xs">{[r.season, r.season_year].filter(Boolean).join(" ") || "—"}</span>
      ),
    },
    {
      header: "Styles",
      align: "right",
      className: HUG,
      cell: (r) => <span className="block text-right font-mono tabular-nums text-xs">{r.style_count}</span>,
    },
    {
      header: "Sample Qty",
      align: "right",
      className: HUG,
      cell: (r) => <span className="block text-right font-mono tabular-nums text-xs">{fmtNumber(r.sample_qty)}</span>,
    },
    {
      header: "Billable",
      className: HUG,
      cell: (r) =>
        r.billable_count > 0 ? (
          <StatusPill tone="info">{`${r.billable_count} billable`}</StatusPill>
        ) : (
          <span className="text-xs text-muted-foreground">Free</span>
        ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.code}
        view={false}
        // COST THIS SAMPLE (Sample Costing UX plan P1.3): opens the enquiry's
        // latest costing, or starts one on it — never a second chain.
        menu={[{ label: "Cost this sample", icon: Calculator, onClick: () => router.push(`/sales/sample-costing?costFor=${r.id}`) }]}
        menuAs="icons"
        onEdit={() => openEdit(r)}
        canEdit={perms.canEdit}
        onDelete={() => del(r)}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
  ];

  // ---- the style switcher (Product Info · Combos · Quantities) ------------------
  const switcher = (list: StyleDraft[], current: StyleDraft | null) =>
    list.length > 1 && current ? (
      <div className="mb-4">
        <ToggleGroup<string>
          label="Style line"
          value={current.key}
          onChange={setActiveKey}
          options={list.map((s) => ({ value: s.key, label: styleLabel(s) }))}
        />
      </div>
    ) : null;

  // ---- Styles grid ----------------------------------------------------------------
  /**
   * ORDER ENTRY'S STYLE LINE (references/orders-precedent.md §3): each style is
   * ONE row of fields, and what belongs TO the line — its Coordinates and its
   * Sizes — sits on a composition line directly under it. Not a table with a
   * [Coordinates] button opening a sheet, and not Sizes on another section:
   * that was the 2026-10-06 build, and it put a line's own children two clicks
   * and one rail row away from the line.
   *
   * Widths are OE's `STYLE_FIELD_W` steps: Style `term`, codes `code`, Unit and
   * Sample Qty `num`, and Description is the ONE GROWING cell (`range` floor +
   * `flex-[1_1_7rem]` at the call site) instead of a fixed `name`.
   *
   * NO CELL SETS ITS OWN HEIGHT (OE, client 2026-08-21) — every `h-8` that sat on
   * these cells is gone; pickers carry `h-9 @2xl/editor:h-8` themselves.
   */
  const removeStyle = (key: string) => {
    mutStyles((xs) => xs.filter((x) => x.key !== key));
    if (activeKey === key) setActiveKey(null);
  };

  /**
   * ANSWERING UNIT — Order Entry's `answerUnitKind`, rule for rule (user
   * 2026-10-06: "the logic from order entry order module"):
   *   - PCS on a line with NO coordinate picked writes PIECES into the first
   *     row (or makes the row). Editable — "a default nobody can overrule is not
   *     a default" (OE 18400).
   *   - PCS on a line that already names one keeps it.
   *   - SET, or blank, only records the answer: nothing is seeded or cleared,
   *     and a line over its new cap says so (`coordinateCountMessage`) rather
   *     than losing rows the operator typed.
   */
  const setUnit = (r: StyleDraft, v: string) => {
    if (v !== "" && !isUnitKind(v)) return;
    const picked = r.coordinates.some((c) => !!c.coordinate_id);
    const coordinates: CoordinateDraft[] =
      v === "piece" && !picked && piecesCoordinateId
        ? r.coordinates.length
          ? r.coordinates.map((c, ci) => (ci === 0 ? { ...c, coordinate_id: piecesCoordinateId } : c))
          : [{ key: newKey(), coordinate_id: piecesCoordinateId }]
        : r.coordinates;
    patchStyle(r.key, { unit_kind: v, coordinates });
  };

  const styleColumns: ChildGridColumn<StyleDraft>[] = [
    {
      header: "Style Name",
      required: true,
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <Input
          id={`se-st-name-${r.key}`}
          aria-label="Style Name"
          required
          maxLength={60}
          value={r.name}
          onChange={(e) => patchStyle(r.key, { name: e.target.value })}
        />
      ),
    },
    {
      header: "Article No",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <Input
          aria-label="Article No"
          maxLength={40}
          value={r.article_no}
          onChange={(e) => patchStyle(r.key, { article_no: e.target.value })}
        />
      ),
    },
    {
      header: "Style Description",
      // The FLOOR of the one growing cell — see the note above.
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <Input
          aria-label="Style Description"
          value={r.description}
          onChange={(e) => patchStyle(r.key, { description: e.target.value })}
        />
      ),
    },
    {
      header: "Unit",
      required: true,
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => (
        <Select
          id={`se-st-unit-${r.key}`}
          aria-label="Unit"
          required
          value={r.unit_kind}
          onChange={(e) => setUnit(r, e.target.value)}
        >
          <option value=""></option>
          {UNIT_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {orderUnitLabel(o.value)}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Sample Qty",
      required: true,
      align: "right",
      // `hug`, not `num`: a two-word label needs ≥ hug or it wraps (the skill's
      // width rule) — at `num` "Sample Qty" broke onto two lines.
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <Input
          id={`se-st-qty-${r.key}`}
          aria-label="Sample Qty"
          required
          type="number"
          min={0}
          className="text-right"
          value={r.sample_qty}
          onChange={(e) => patchStyle(r.key, { sample_qty: e.target.value })}
        />
      ),
    },
    {
      header: "Delivery Dt",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <Input
          aria-label="Delivery Dt"
          type="date"
          value={r.delivery_date}
          onChange={(e) => patchStyle(r.key, { delivery_date: e.target.value })}
        />
      ),
    },
  ];

  /** Order Entry's `STYLE_SECTION_HEAD` — the composition line's grid heading
   *  reads like the field labels above it, not like a bold capital grid header. */
  const COMPOSITION_HEAD = "ty-label text-xs font-semibold normal-case tracking-normal text-muted-foreground";


  /**
   * THE COMPOSITION LINE (OE `componentsAndSizes`): Coordinates as a nested
   * `ChildGrid narrow frameless` in a fixed column, Sizes as the gridded
   * `MultiSelect` in a strict 220px column beside it, so ticking sizes grows
   * that column downward and never pushes the row above. `listRows` is what
   * lets `lib/focus.ts` walk into the nested grid (traps.md #11).
   */
  const composition = (r: StyleDraft) => (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="w-44 min-w-44 flex-none">
        <Field label="Coordinates" required className="w-full">
          <ChildGrid<CoordinateDraft>
            narrow
            frameless
            hideHeader
            headerClassName={COMPOSITION_HEAD}
            columns={[
              {
                // BLANK ON PURPOSE: in a 176px pane `narrow` drops to its
                // phone cards, which print each column's header above the box —
                // "Coordinates / Coordinate", one name twice (Order Entry draws
                // the same doubled label). The `Field` above names it, and the
                // picker's own `label` names it for a screen reader.
                header: "",
                cell: (c) => (
                  <RecordPicker
                    label="Coordinate"
                    compact
                    // A coordinate named twice is one component counted twice.
                    items={data.coordinates.filter(
                      (o) =>
                        o.id === c.coordinate_id ||
                        !r.coordinates.some((x) => x.key !== c.key && x.coordinate_id === o.id),
                    )}
                    value={c.coordinate_id}
                    onChange={(id) =>
                      patchStyle(r.key, {
                        coordinates: r.coordinates.map((x) => (x.key === c.key ? { ...x, coordinate_id: id } : x)),
                      })
                    }
                  />
                ),
              },
            ]}
            rows={r.coordinates}
            // OE: PCS holds one row, SET six, an unanswered Unit six — rows,
            // blank ones included (`coordinatesFull`, rules.ts).
            hideAdd={coordinatesFull(r.unit_kind, r.coordinates)}
            // The coordinates grid opens on a row to pick in, as OE's does.
            seedRow
            // Clearing IS removing — a blank coordinate is dropped at save
            // (OE: the ✕ beside each box and the picker's own clear were two
            // X's a few pixels apart).
            hideRemove
            bodyClassName="space-y-1.5 [&>[data-row-box]]:rounded-none [&>[data-row-box]]:border-0 [&>[data-row-box]]:p-0"
            addClassName="w-full whitespace-nowrap px-2"
            addLabel="+ Add coordinate"
            onAdd={() => {
              // OE `addStyleCoordinate`: refused at the cap, and while the last
              // row is still blank — fill it before asking for another.
              const last = r.coordinates[r.coordinates.length - 1];
              if (coordinatesFull(r.unit_kind, r.coordinates) || (last && !last.coordinate_id)) return false;
              patchStyle(r.key, { coordinates: [...r.coordinates, { key: newKey(), coordinate_id: null }] });
            }}
            onRemove={(c) => patchStyle(r.key, { coordinates: r.coordinates.filter((x) => x.key !== c.key) })}
          />
        </Field>
      </div>
      <div className="w-[220px] min-w-[220px] flex-none self-start">
        {/* `required` ON THE FIELD AND THE CONTROL (OE, client 2026-08-31): a
            compact MultiSelect draws no label, so the Field carries the star
            and the control carries the hold. */}
        <Field label="Sizes" required className="w-full">
          <MultiSelect
            id={`se-st-sizes-${r.key}`}
            compact
            required
            label="Sizes"
            framed
            // The frame's p-2.5 pushed the box ~10px below Coordinates' beside
            // it (user 2026-10-08): both start on the label's own baseline.
            className="border-0 p-0 @2xl/editor:p-0"
            gridded
            gridColumns={6}
            gridDense
            groupBy={(o) => sizeFamily(o.label)}
            inputClassName="h-8 max-h-8"
            triggerClassName="h-8 max-h-8"
            // THE LIST IS WIDER THAN ITS 220px BOX — Order Entry's own width.
            // Without it six ticks a row were crushed into 220px and every
            // label read "X…" / "3…" (user 2026-10-06: "while selecting the
            // size it came like squeezed").
            panelClassName="w-[27rem]"
            options={sizeOptions}
            values={r.sizes}
            // Kept in size order, whatever order they were ticked in.
            onChange={(next) => patchStyle(r.key, { sizes: sortBySize(next, (z) => z) })}
          />
        </Field>
      </div>
    </div>
  );

  // ---- Combos: one combo × size matrix per style ---------------------------------
  /**
   * A SIZE-ACROSS MATRIX, DRAWN THE WAY ORDER ENTRY DRAWS ONE (orders-precedent
   * §5, `components/orders/matrix-grid.ts`): a sticky Combo column on the left,
   * the style's sizes across the top, each size column sized for its label and
   * its data (`sizeColPx`) rather than a flat 72px, the computed figures as
   * plain `tabular-nums` text, a sticky Total on the right and a totals band
   * underneath. It NEVER folds to cards — the sizes ARE the axis, so a run too
   * long for the pane scrolls inside its own frame. The 2026-10-06 build used
   * ChildGrid columns at a flat `num` and turned past eight sizes into a stack
   * of one-field boxes with no shared header.
   *
   * Matrix inputs keep OE's own `h-8` (its `assortGrid` cells): a matrix square
   * is not a field in a row of pickers, so the "no cell sets its own height"
   * rule is about the line grids, not this.
   */
  const COMBO_ID_W = 220;
  const MATRIX_QTY_W = 80;
  /* COMPACTED LIKE APPROVAL QTY'S BREAKUP (user 2026-10-08: "approval qty la
     irukka mari table … compacted aa") — `approval-qty-lines.tsx`'s chrome:
     a box that hugs its columns, 26px rows, a hairline between size columns,
     right-aligned digits, and a 2px rule before the Total. */
  const MX_ROW_H = "min-h-[26px]";
  const MX_HEAD = `${MATRIX_HEAD} ${MX_ROW_H} justify-end pr-2`;
  const MX_FOOT = `${MATRIX_FOOT} ${MX_ROW_H}`;
  const CELL = matrixCell(MX_ROW_H);
  const MX_SEP = "border-r border-border";
  const MX_TOTAL = "border-l-2 border-border-strong font-semibold";
  const MX_BOX =
    "h-[28px] @2xl/editor:h-[28px] w-full min-w-0 rounded-[6px] px-1 text-right text-[12.5px] md:text-[12.5px] font-semibold tabular-nums";
  const patchCombo = (s: StyleDraft, key: string, patch: Partial<ComboDraft>) =>
    patchStyle(s.key, { combos: s.combos.map((c) => (c.key === key ? { ...c, ...patch } : c)) });

  const comboMatrix = (s: StyleDraft) => {
    const sizes = s.sizes;
    const sizeSum = (z: string) => s.combos.reduce((t, c) => t + (Number(c.sizes[z]) || 0), 0);
    const digits = (z: string) =>
      Math.max(2, String(sizeSum(z)).length, ...s.combos.map((c) => (c.sizes[z] ?? "").trim().length));
    /* NO EXTRA QTY, AND SO NO SEPARATE ORDER QTY (client 2026-10-06): the
       pieces wanted are typed straight into the sizes, so Order Qty and Total
       would be one number printed twice. Total is the one kept. */
    const track = [
      `${COMBO_ID_W}px`,
      ...sizes.map((z) => `${sizeColPx(z, digits(z))}px`),
      `${MATRIX_QTY_W}px`,
    ].join(" ");
    const orderSum = s.combos.reduce((t, c) => t + comboOrderQty(c, sizes), 0);
    const want = Number(s.sample_qty) || 0;

    return (
      <div className="space-y-2">
        <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-border bg-surface">
          <div data-grid-body className="grid w-fit" style={{ gridTemplateColumns: track }} onKeyDown={(e) => gridKeyNav(e)}>
            <div className={`${MX_HEAD} sticky left-0 z-30 justify-start pl-2`}>Combo / Color</div>
            {sizes.map((z) => (
              <div key={z} className={`${MX_HEAD} ${MX_SEP}`}>
                <span className={MATRIX_SIZE_TOKEN}>{z}</span>
              </div>
            ))}
            <div className={`${MX_HEAD} ${MX_TOTAL} sticky right-0 z-30`}>Total</div>

            {s.combos.map((c) => (
              <div key={c.key} data-grid-row className="contents">
                <div className={`${CELL} sticky left-0 z-10 gap-1 border-r border-border-strong bg-surface px-2`}>
                  <div className="min-w-0 flex-1">
                    <TypeOrPick
                      id={`se-cb-name-${c.key}`}
                      label="Combo / Color"
                      placeholder=""
                      options={colourOptions}
                      valueId={colourOptions.find((o) => o.name.toUpperCase() === c.combo.trim().toUpperCase())?.id ?? null}
                      text={c.combo}
                      inputClassName="h-[28px]"
                      onChange={(next) => patchCombo(s, c.key, { combo: next.name })}
                    />
                  </div>
                  {s.combos.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-row-remove
                      className="shrink-0 text-muted-foreground hover:text-danger"
                      aria-label="Remove combo"
                      onClick={() => patchStyle(s.key, { combos: s.combos.filter((x) => x.key !== c.key) })}
                    >
                      <Trash2 className="h-4 w-4 shrink-0" />
                    </Button>
                  )}
                </div>
                {sizes.map((z) => (
                  <div key={z} className={`${CELL} min-h-[32px] px-1 ${MX_SEP}`}>
                    <Input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      aria-label={`${c.combo || "Combo"} ${z} pieces`}
                      className={MX_BOX}
                      value={c.sizes[z] ?? ""}
                      onChange={(e) => patchCombo(s, c.key, { sizes: { ...c.sizes, [z]: e.target.value } })}
                    />
                  </div>
                ))}
                <div className={`${CELL} ${MX_TOTAL} sticky right-0 z-10 justify-end bg-surface pr-2 text-[12.5px] tabular-nums`}>
                  {fmtNumber(comboOrderQty(c, sizes))}
                </div>
              </div>
            ))}

            <div className={`${MX_FOOT} sticky left-0 z-30 justify-start pl-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground`}>
              Total
            </div>
            {sizes.map((z) => (
              <div key={z} className={`${MX_FOOT} ${MX_SEP} justify-end px-2`}>
                {fmtNumber(sizeSum(z))}
              </div>
            ))}
            <div className={`${MX_FOOT} ${MX_TOTAL} sticky right-0 z-30 justify-end pr-2`}>{fmtNumber(orderSum)}</div>
          </div>
        </div>
        {/* ADVISORY, NOT A HOLD — a sample may carry spares beyond the combos.
            Order Entry's balance strip, against the style's Sample Qty. */}
        {want > 0 && <AllocationStrip allocated={orderSum} target={want} />}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-add
          className="mt-3"
          onClick={() => patchStyle(s.key, { combos: [...s.combos, blankCombo()] })}
        >
          + Add combo
        </Button>
      </div>
    );
  };

  // ---- Quantities: ORDER ENTRY'S TAB, COPIED (user 2026-10-06: "if billable is
  // enabled the quantities tab should open the qty tab from order module order
  // entry ... copy to here same") -----------------------------------------------
  /**
   * ONE GRID FOR THE ENTRY, as Order Entry has one for the order. Its Ref No
   * names the destination's style; here that is a pick of the billable styles,
   * and each row is STORED under the style it names (sample_style_quantities is
   * per style), so choosing another Ref No moves the row. Discharge Port, Final
   * Destination and the carton fields are not on Order Entry's tab and are gone
   * from this one; their stored values pass through a save untouched.
   */
  type QuantityRow = QuantityDraft & { styleKey: string };
  const consigneeItems = data.consignees.filter(
    (c) => !header.customer_id || c.customer_id === header.customer_id || !c.customer_id,
  );
  const styleByKey = (key: string) => styles.find((x) => x.key === key) ?? null;
  const modeOfType = (id: string | null) => sampleAssortMode(assortTypeLookups.find((l) => l.id === id));
  const stripRow = ({ styleKey: _k, ...q }: QuantityRow): QuantityDraft => q;
  const qtyRows: QuantityRow[] = billableStyles.flatMap((st) =>
    st.quantities.map((q) => ({ ...q, styleKey: st.key })),
  );
  /** A new line belongs to the style the last line names — or the first billable one. */
  const addQty = () => {
    const st = styleByKey(qtyRows[qtyRows.length - 1]?.styleKey ?? "") ?? billableStyles[0];
    if (!st) return false;
    patchStyle(st.key, { quantities: [...st.quantities, blankQuantity(st)] });
  };
  const removeQty = (r: QuantityRow) => {
    const st = styleByKey(r.styleKey);
    if (st) patchStyle(st.key, { quantities: st.quantities.filter((q) => q.key !== r.key) });
  };
  /** Ref No changed: the row moves to that style's quantities. */
  const moveQty = (r: QuantityRow, toKey: string) => {
    if (!toKey || toKey === r.styleKey) return;
    mutStyles((xs) =>
      xs.map((x) =>
        x.key === r.styleKey
          ? { ...x, quantities: x.quantities.filter((q) => q.key !== r.key) }
          : x.key === toKey
            ? { ...x, quantities: [...x.quantities, stripRow(r)] }
            : x,
      ),
    );
  };
  /** Order Entry's `setRowDeliveryDate`: Earlier Shipment follows the Delivery
   *  Dt only while it is blank or still the week-before it was given. */
  const setQtyDelivery = (r: QuantityRow, v: string) =>
    patchQty(r.styleKey, r.key, {
      delivery_date: v,
      ...(!r.earlier_shipment_date || r.earlier_shipment_date === weekBefore(r.delivery_date)
        ? { earlier_shipment_date: v ? weekBefore(v) : "" }
        : {}),
    });
  /** The breakup's total when it disagrees with PO Qty — OE's "Assort: N — use". */
  const assortDisagrees = (r: QuantityRow): number | null => {
    const mode = modeOfType(r.assortment_type_id);
    if (!mode || !assortStarted(r)) return null;
    const total = assortTotal(r, mode);
    return total !== (Number(r.po_qty) || 0) ? total : null;
  };

  /**
   * ORDER ENTRY'S `quantityColumns`, in its order and at its widths
   * (garment-order-screen.tsx, "NO CELL SETS ITS OWN HEIGHT"):
   *   Country range 112 + Ref No hug 88 [+ PO No range 112] + Consignee code 144
   *   + PO Qty num 72 + Delivery Dt code 144 + Earlier Shipment Dt code 144
   *   + Assortment Type code 144 + Details hug 88       = 936 [1,048]
   *   + 72 chrome                                       = 1,008 [1,120] <= 1,155.
   */
  const sampleQuantityColumns: ChildGridColumn<QuantityRow>[] = [
    {
      header: "Country",
      required: true,
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <CountryPicker
          compact
          required
          countries={data.countries}
          value={r.country_id}
          onChange={(id) => patchQty(r.styleKey, r.key, { country_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
        />
      ),
    },
    {
      header: "Ref No",
      required: true,
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <Select
          aria-label="Ref No"
          required
          value={r.styleKey}
          onChange={(e) => moveQty(r, e.target.value)}
        >
          {billableStyles.map((st) => (
            <option key={st.key} value={st.key}>
              {st.name.trim() || `Line ${indexOf(st) + 1}`}
            </option>
          ))}
        </Select>
      ),
    },
    ...(header.multi_order
      ? [
          {
            header: "PO No",
            width: FIELD_WIDTH_CSS.range,
            cell: (r: QuantityRow) => (
              // caps-input: exempt -- the buyer's PO number is kept as typed (AGENTS.md CAPITALS, 2026-09-30).
              <Input
                aria-label="PO No"
                uppercase={false}
                maxLength={60}
                value={r.po_no}
                onChange={(e) => patchQty(r.styleKey, r.key, { po_no: e.target.value })}
              />
            ),
          } satisfies ChildGridColumn<QuantityRow>,
        ]
      : []),
    {
      header: "Consignee",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <RecordPicker
          label="Consignee"
          compact
          required
          // Scoped to the entry's customer (the Order Entry rule, client
          // 2026-08-17); a consignee the line already holds always survives.
          items={
            consigneeItems.some((c) => c.id === r.consignee_id)
              ? consigneeItems
              : [...consigneeItems, ...data.consignees.filter((c) => c.id === r.consignee_id)]
          }
          value={r.consignee_id}
          onChange={(id) => patchQty(r.styleKey, r.key, { consignee_id: id })}
        />
      ),
    },
    {
      header: "PO Qty",
      required: true,
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      total: { kind: "sum", of: (r) => Number(r.po_qty) || 0 },
      cell: (r) => {
        const assorted = assortDisagrees(r);
        return (
          <div>
            <Input
              aria-label="PO Qty"
              required
              inputMode="decimal"
              className="text-right"
              value={r.po_qty}
              onChange={(e) => patchQty(r.styleKey, r.key, { po_qty: e.target.value })}
            />
            {assorted != null && (
              <button
                type="button"
                tabIndex={-1}
                className="mt-0.5 block w-full text-right text-[11px] font-medium text-danger hover:underline"
                onClick={() => patchQty(r.styleKey, r.key, { po_qty: String(assorted) })}
              >
                Assort: {fmtNumber(assorted)} — use
              </button>
            )}
          </div>
        );
      },
    },
    {
      header: "Delivery Dt",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <Input
          aria-label="Delivery Dt"
          type="date"
          required
          value={r.delivery_date}
          onChange={(e) => setQtyDelivery(r, e.target.value)}
        />
      ),
    },
    {
      header: "Earlier Shipment Dt",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <Input
          aria-label="Earlier Shipment Dt"
          type="date"
          required
          value={r.earlier_shipment_date}
          onChange={(e) => patchQty(r.styleKey, r.key, { earlier_shipment_date: e.target.value })}
        />
      ),
    },
    {
      header: "Assortment Type",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <LookupDialogPicker
          kind="assortment_type"
          label="Assortment Type"
          compact
          required
          options={assortTypeLookups}
          value={r.assortment_type_id}
          onChange={(id) => patchQty(r.styleKey, r.key, { assortment_type_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
        />
      ),
    },
    {
      header: "Details",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => {
        // OE `assortGateFor`: the Assortment Type decides what Details asks for.
        const why = modeOfType(r.assortment_type_id) ? null : "Pick an Assortment Type on this row";
        return (
          <Tooltip label={why || "Open assortment details"} touch={!!why}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-row-open
              aria-disabled={why ? true : undefined}
              aria-label={why ? `Details — ${why}` : "Details"}
              className={why ? "cursor-not-allowed opacity-50" : undefined}
              onClick={() => {
                if (why) return;
                const st = styleByKey(r.styleKey);
                // OE `openAssort`: seeded only when the destination has no lines —
                // one line per combo of its style, or one blank line. Without
                // `setDirty`: blank lines are dropped at save.
                if (st && r.lines.length === 0) {
                  const named = st.combos.filter((c) => c.combo.trim());
                  const lines = (named.length ? named : [null]).map((c) => ({
                    key: newKey(),
                    style_ref: "",
                    combo: c?.combo.trim() ?? "",
                    no_of_cartons: "",
                    inners_per_carton: "",
                    sizes: {},
                  }));
                  setStyles((xs) =>
                    xs.map((x) =>
                      x.key === st.key
                        ? { ...x, quantities: x.quantities.map((q) => (q.key === r.key ? { ...q, lines } : q)) }
                        : x,
                    ),
                  );
                }
                setAssortSheet({ styleKey: r.styleKey, qtyKey: r.key });
              }}
            >
              Details
            </Button>
          </Tooltip>
        );
      },
    },
  ];

  /**
   * ORDER ENTRY'S AVG RATE / GROSS VALUE / INR VALUE. The rate is each billable
   * style's Price (Product Info — a sample has no Prices tab). One currency for
   * the entry, as an order has one; styles priced in DIFFERENT currencies cannot
   * be added up, so the figures stay blank rather than sum a mix. INR Value is
   * Σ PO Qty × Price × that style's Exchange Rate (0686) — blank until every
   * billable style has a rate, never a partial sum that reads as the whole.
   */
  const qtyValue = (() => {
    const priced = billableStyles.map((st) => ({
      price: Number(st.price) || 0,
      rate: Number(st.exchange_rate) || 0,
      qty: st.quantities.reduce((t, q) => t + (Number(q.po_qty) || 0), 0),
      currency: st.currency_code ?? "",
    }));
    const currencies = new Set(priced.map((x) => x.currency));
    if (!priced.length || priced.some((x) => !(x.price > 0)) || currencies.size !== 1) return null;
    const qty = priced.reduce((t, x) => t + x.qty, 0);
    const gross = priced.reduce((t, x) => t + x.price * x.qty, 0);
    const currency = [...currencies][0];
    return qty > 0
      ? {
          avgRate: Math.round((gross / qty) * 1e6) / 1e6,
          gross,
          currency,
          inr: priced.every((x) => x.rate > 0)
            ? Math.round(priced.reduce((t, x) => t + x.price * x.qty * x.rate, 0) * 100) / 100
            : null,
        }
      : null;
  })();

  /** Every style grid sits under its identity — OE's `StyleIdentityBand`, never
   *  a switcher that hides the other styles' rows (orders-precedent §8). */
  const styleBand = (s: StyleDraft) => (
    <StyleIdentityBand
      styleRefNo={s.name.trim() || `Line ${indexOf(s) + 1}`}
      identity={{ ref: s.name.trim() || `Line ${indexOf(s) + 1}`, style: sampleNoOf(s), article: s.article_no.trim() }}
    />
  );

  // ---- Product Info helpers ----------------------------------------------------------
  /** An inherited field shows the header's value until the line overrides it. */
  const inherited = (s: StyleDraft, f: InheritedField) => effectiveValue(s, header, f);
  const setInherited = (s: StyleDraft, f: InheritedField, v: string | null) =>
    patchStyle(s.key, { [f]: f === "agent_id" ? v : (v ?? "") } as Partial<StyleDraft>);

  const merchItems = (() => {
    const named = data.merchandisers.filter((m) => m.is_merchandiser);
    const base = named.length ? named : data.merchandisers;
    const held = active?.merchandiser_id;
    return held && !base.some((m) => m.id === held)
      ? [...base, ...data.merchandisers.filter((m) => m.id === held)]
      : base;
  })();
  // Fabric Code narrows to the picked Structure — the cascading-picker rule.
  const fabricItems = (() => {
    const st = active?.fabric_structure_id;
    const scoped = st ? data.fabrics.filter((f) => f.category_id === st) : data.fabrics;
    const held = active?.fabric_id;
    return held && !scoped.some((f) => f.id === held) ? [...scoped, ...data.fabrics.filter((f) => f.id === held)] : scoped;
  })();

  const customerName = customerOf(header.customer_id)?.name ?? "";
  /** The billing fields' look while the active line is not billable. */
  const billOff = active?.billable ? undefined : "opacity-50";
  const seasonText = [data.seasons.find((x) => x.id === header.season_id)?.name ?? "", header.season_year]
    .filter(Boolean)
    .join(" ");

  // ---- sections -------------------------------------------------------------------
  const sections: FullScreenSection[] = [
    {
      key: "info",
      label: "Sample Info",
      icon: ClipboardList,
      done: !!header.customer_id && !!header.received_date,
      problems: validity.bySection.info,
      content: (
        <SectionBody title="Sample Info">
          <div className={`${HEADER_W} space-y-1`}>
            <FieldRow>
              {/* `Input readOnly` takes itself off the Tab path. */}
              <Field label="Enquiry No" w="code" htmlFor="se-no">
                <Input id="se-no" readOnly className="font-mono" value={(editId ? editCode : preview.enquiryNo) ?? ""} />
              </Field>
              <Field label="Date" required w="code" htmlFor="se-date">
                <Input
                  id="se-date"
                  type="date"
                  required
                  value={header.received_date}
                  onChange={(e) => {
                    setH({ received_date: e.target.value });
                    // The Date decides the financial year of a NEW entry's number.
                    if (!editId) askPreview(e.target.value);
                  }}
                />
              </Field>
              <Field label="Against" w="term" htmlFor="se-against">
                <Select id="se-against" value={header.enquiry_against} onChange={(e) => setH({ enquiry_against: e.target.value })}>
                  <option value=""></option>
                  {/* A legacy word (new / repeat) the scaffold stored still shows. */}
                  {[...ENQUIRY_AGAINST, ...(header.enquiry_against && !ENQUIRY_AGAINST.some((o) => o.value === header.enquiry_against)
                    ? [{ value: header.enquiry_against, label: header.enquiry_against }]
                    : [])].map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Action" w="party" htmlFor="se-action">
                <Select id="se-action" value={header.enquiry_action} onChange={(e) => setH({ enquiry_action: e.target.value })}>
                  <option value=""></option>
                  {ENQUIRY_ACTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Customer" required w="party">
                <RecordPicker
                  id="se-customer"
                  label="Customer"
                  compact
                  required
                  items={data.customers}
                  value={header.customer_id}
                  onChange={(id) => {
                    const c = customerOf(id);
                    setH({
                      customer_id: id,
                      // Country is the customer master's (spec §3.1 "Text (Auto)").
                      country_id: c?.country_id ?? null,
                    });
                  }}
                />
              </Field>
              {/* THE SEASON MASTER (client 2026-10-06) — Q1–Q4 buying cycles,
                  maintained under Master Data ▸ System ▸ Season. */}
              <Field label="Season" w="range">
                <RecordPicker
                  id="se-season"
                  label="Season"
                  compact
                  items={data.seasons}
                  value={header.season_id}
                  onChange={(id) => setH({ season_id: id })}
                />
              </Field>
              <Field label="Year" w="hug" htmlFor="se-year">
                <Select id="se-year" value={header.season_year} onChange={(e) => setH({ season_year: e.target.value })}>
                  <option value=""></option>
                  {[...new Set([...yearOptions, ...(header.season_year ? [header.season_year] : [])])].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Country" w="term" htmlFor="se-country">
                <Input id="se-country" readOnly value={countryName(header.country_id)} />
              </Field>
              {/* A VENDOR (client 2026-10-06): Vendor master ▸ Service Provider ▸
                  Buying Agent / Service Agent — `getAgents` in the service. */}
              <Field label="Agent" w="party">
                <RecordPicker
                  id="se-agent"
                  label="Agent"
                  compact
                  items={agentItemsFor(header.agent_id)}
                  emptyHint="No vendor is classified Buying Agent or Service Agent yet — set it on the Vendor master's Service grid."
                  value={header.agent_id}
                  onChange={(id) => setH({ agent_id: id })}
                />
              </Field>
              <Field label="Received Mode" w="term" htmlFor="se-rmode">
                <Select id="se-rmode" value={header.receipt_mode} onChange={(e) => setH({ receipt_mode: e.target.value })}>
                  <option value=""></option>
                  {RECEIPT_MODES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* Receipt Dt sits beside the mode it dates (client 2026-10-06,
                  moved here from Product Info). */}
              <Field label="Receipt Dt" w="code" htmlFor="se-rdate">
                <Input
                  id="se-rdate"
                  type="date"
                  value={header.receipt_date}
                  onChange={(e) => setH({ receipt_date: e.target.value })}
                />
              </Field>
              <Field label="Delivery Mode" w="term" htmlFor="se-dmode">
                <Select id="se-dmode" value={header.delivery_mode} onChange={(e) => setH({ delivery_mode: e.target.value })}>
                  <option value=""></option>
                  {DELIVERY_MODES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
          </div>
        </SectionBody>
      ),
    },
    {
      key: "styles",
      label: "Styles",
      icon: Shirt,
      done: realStyles.length > 0,
      problems: validity.bySection.styles,
      // NO SectionBody — the rail row names the grid (OE: "NO WRAPPER").
      content: (
        <ChildGrid<StyleDraft>
          // grid-caption: exempt -- Order Entry's own Styles grid carries this caption (label="Styles Details"); copied for parity.
          label="Styles Details"
          columns={styleColumns}
          rows={styles}
          forceCards
          listRows
          frameless
          keepOne
          pageSize={5}
          addLabel="+ Add style"
          onAdd={() => {
            const s = blankStyle();
            mutStyles((xs) => [...xs, s]);
          }}
          onRemove={(r) => removeStyle(r.key)}
          // `listRows`: the row draws its own chrome, so `Field required` is
          // the ONLY place a column's `required` reaches the control.
          renderMobileRow={(r, i) => (
            <div className="relative space-y-2 pr-8 max-sm:pr-0">
              {styles.length > 1 && <RowRemoveChip label="Remove style" onClick={() => removeStyle(r.key)} />}
              <FieldRow nowrap gap="row">
                {styleColumns.map((c) => (
                  <Field
                    key={c.header}
                    label={c.header}
                    required={c.required}
                    w={fieldWidthStep(c.width) ?? "code"}
                    className={c.header === "Style Description" ? "flex-[1_1_7rem]" : undefined}
                  >
                    {c.cell(r, i)}
                  </Field>
                ))}
              </FieldRow>
              {composition(r)}
            </div>
          )}
        />
      ),
    },
    {
      key: "product",
      label: "Product Info",
      icon: Package,
      done: realStyles.length > 0 && realStyles.every((s) => !!s.merchandiser_id),
      problems: validity.bySection.product,
      content: (
        <SectionBody title="Product Info">
          {switcher(styles, active)}
          {active && (
            <div className="space-y-1">
              {/* INHERITED FROM SAMPLE INFO, READ-ONLY HERE (spec §4.1, §2.3):
                  edited where they are owned, so they cannot drift apart.
                  A LABELLED BAND, NOT A ROW OF INERT BOXES (user 2026-10-06,
                  compared with Order Entry): a read-only <Input> is a box shaped
                  like something to type into, and Order Entry states a style's
                  identity as label · value text — `StyleIdentityBand`, the same
                  type and hairline — never as disabled fields. */}
              <dl className="mb-2 flex w-full flex-wrap items-baseline gap-x-6 gap-y-1">
                {(
                  [
                    ["Sample No", sampleNoOf(active)],
                    ["Enquiry No", (editId ? editCode : preview.enquiryNo) ?? ""],
                    ["Customer", customerName],
                    ["Style", active.name.trim()],
                    ["Article No", active.article_no.trim()],
                    ["Description", active.description.trim()],
                    [
                      "Qty",
                      active.sample_qty
                        ? `${fmtNumber(Number(active.sample_qty) || 0)} ${orderUnitLabel(active.unit_kind)}`.trim()
                        : "",
                    ],
                    ["Season", seasonText],
                  ] as const
                )
                  // ONLY WHAT IS KNOWN (user 2026-10-06: "just show one details"):
                  // a band of eight labels over seven dashes said nothing.
                  .filter(([, value]) => !!value)
                  .map(([label, value]) => (
                  <div key={label} className="flex min-w-0 max-w-[18rem] items-baseline gap-2">
                    <dt className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="m-0 min-w-0 text-sm font-medium">
                      <Truncated>{value}</Truncated>
                    </dd>
                  </div>
                ))}
                <div aria-hidden className="h-px min-w-[2rem] flex-1 self-center bg-border" />
              </dl>
              <div className={`${PRODUCT_W} space-y-1`}>

              {/* FABRIC (spec §4.2). Two labelled groups — Fabric · Order —
                  (user 2026-10-08, artifact mock-up; the two switches sit with the Order row, billing fields under them) — so the
                  section reads as groups rather than one long run of fields.
                  Merchandiser moved down into Order, where it belongs. */}
              <PiLegend>Fabric</PiLegend>
              <FieldRow>
                <Field label="Fabric Structure" w="party">
                  <RecordPicker
                    label="Fabric Structure"
                    compact
                    items={data.fabricStructures}
                    value={active.fabric_structure_id}
                    onChange={(id) => {
                      const keep =
                        !id || !active.fabric_id || data.fabrics.find((f) => f.id === active.fabric_id)?.category_id === id;
                      // A Fabric Code out of the new Structure's scope is cleared;
                      // one still in scope is kept (AGENTS.md "Cascading filters").
                      patchStyle(active.key, { fabric_structure_id: id, ...(keep ? {} : { fabric_id: null }) });
                    }}
                  />
                </Field>
                <Field label="Fabric Code" w="party">
                  <RecordPicker
                    label="Fabric Code"
                    compact
                    items={fabricItems}
                    value={active.fabric_id}
                    onChange={(id) => patchStyle(active.key, { fabric_id: id })}
                  />
                </Field>
                <Field label="GSM" w="num" htmlFor="se-pi-gsm">
                  <Input
                    id="se-pi-gsm"
                    type="number"
                    min={0}
                    className="text-right"
                    value={active.gsm}
                    onChange={(e) => patchStyle(active.key, { gsm: e.target.value })}
                  />
                </Field>
                <Field label="Tech Pack" w="term" htmlFor="se-pi-tp">
                  <Select id="se-pi-tp" value={active.tech_pack} onChange={(e) => patchStyle(active.key, { tech_pack: e.target.value })}>
                    <option value=""></option>
                    {TECH_PACK.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FieldRow>

              {/* ORDER DATE · AGENT · DELIVERY MODE. Agent and Delivery Mode start
                  as Sample Info's value and may be overridden for this line
                  (spec §2.3). Customer Reference, Received Mode, Receipt Date,
                  Delivery To and Delivery Through came off on 2026-10-06
                  (client) — the receipt facts are the header's now, and the
                  lines inherit them without a field to override. */}
              <PiLegend>Order</PiLegend>
              <FieldRow>
                <Field label="Merchandiser" required w="party">
                  <RecordPicker
                    id="se-pi-merch"
                    label="Merchandiser"
                    compact
                    required
                    items={merchItems}
                    value={active.merchandiser_id}
                    onChange={(id) => patchStyle(active.key, { merchandiser_id: id })}
                  />
                </Field>
                <Field label="Order Dt" w="code" htmlFor="se-pi-odt">
                  <Input
                    id="se-pi-odt"
                    type="date"
                    value={active.order_date}
                    onChange={(e) => patchStyle(active.key, { order_date: e.target.value })}
                  />
                </Field>
                <Field label="Agent" w="party">
                  <RecordPicker
                    id="se-pi-agent"
                    label="Agent"
                    compact
                    items={agentItemsFor(inherited(active, "agent_id") || null)}
                    value={inherited(active, "agent_id") || null}
                    onChange={(id) => setInherited(active, "agent_id", id)}
                  />
                </Field>
                <Field label="Delivery Mode" w="term" htmlFor="se-pi-dmode">
                  <Select
                    id="se-pi-dmode"
                    value={inherited(active, "delivery_mode")}
                    onChange={(e) => setInherited(active, "delivery_mode", e.target.value)}
                  >
                    <option value=""></option>
                    {DELIVERY_MODES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {/* COMMERCIAL (spec §4.3). The two switches sit in the Order
                    row; Billable = No greys the billing fields below, and a
                    greyed field is never saved (`toSampleEntryPayload`) and
                    never required. */}
                <div className="flex items-center gap-4">
                  <Toggle
                    id="se-pi-acc"
                    label="Accessories Reqd"
                    checked={active.accessories_reqd}
                    onChange={(v) => patchStyle(active.key, { accessories_reqd: v })}
                    // Same h-9 → @2xl/editor:h-8 step as Input, so the switch centres on the boxes beside it.
                    className="@2xl/editor:min-h-8"
                  />
                  {/* A TOGGLE, like Order Entry's Pack and Multi Style switches and
                      the spec's own word ("Billable Toggle (No / Yes)", §1). */}
                  <Toggle
                    id="se-pi-billable"
                    label="Billable"
                    checked={active.billable}
                    onChange={(v) => patchStyle(active.key, { billable: v })}
                    // Same h-9 → @2xl/editor:h-8 step as Input, so the switch centres on the boxes beside it.
                    className="@2xl/editor:min-h-8"
                  />
                </div>
              </FieldRow>

              {/* Own row, so the two switches stay together beside Delivery Mode
                  instead of Billable being pushed down by the six billing fields. */}
              <FieldRow>
                {/* GREYED, NOT HIDDEN, WHEN BILLABLE = NO (user 2026-10-06): showing
                    and hiding four fields made the row jump on every toggle. A
                    native <fieldset disabled> disables every control inside it —
                    the pickers included, which have no `disabled` prop of their
                    own — and `display: contents` keeps the fields in this row.
                    Still never SAVED and never REQUIRED while No
                    (`toSampleEntryPayload`, `sampleEntryProblems`). */}
                {/* `disabled` alone does not read as off under the raagam skin,
                    which draws a disabled box like a live one — so the four are
                    dimmed as well (checked in the browser, 2026-10-06). */}
                <fieldset
                  disabled={!active.billable}
                  aria-label="Billing — only for a billable sample"
                  className="contents"
                >
                    <Field label="Ship Type" w="term" className={billOff}>
                      <LookupDialogPicker
                        kind="ship_type"
                        label="Ship Type"
                        compact
                        options={shipTypeLookups}
                        value={active.ship_type_id}
                        onChange={(id) => patchStyle(active.key, { ship_type_id: id })}
                        canCreate={masterPerms.canCreate}
                        canEdit={masterPerms.canEdit}
                      />
                    </Field>
                    <Field label="Ship Mode" w="range" className={billOff} htmlFor="se-pi-smode">
                      <Select id="se-pi-smode" value={active.ship_mode} onChange={(e) => patchStyle(active.key, { ship_mode: e.target.value })}>
                        <option value=""></option>
                        {SHIP_MODES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Currency" required={active.billable} w="range" className={billOff}>
                      <CurrencyPicker
                        label="Currency"
                        compact
                        currencies={data.currencies}
                        value={active.currency_code}
                        onChange={(code) =>
                          patchStyle(active.key, {
                            currency_code: code,
                            // Order Entry's rule: picking INR fills a BLANK rate with 1.
                            ...(code === "INR" && !active.exchange_rate.trim() ? { exchange_rate: "1" } : {}),
                          })
                        }
                        canCreate={masterPerms.canCreate}
                        canEdit={masterPerms.canEdit}
                      />
                    </Field>
                    <Field label="Price" required={active.billable} w="range" className={billOff} htmlFor="se-pi-price">
                      <Input
                        id="se-pi-price"
                        type="number"
                        required={active.billable}
                        min={0}
                        step="0.0001"
                        className="text-right"
                        value={active.price}
                        onChange={(e) => patchStyle(active.key, { price: e.target.value })}
                      />
                    </Field>
                    {/* EXCHANGE RATE + LOCAL VALUE (client 2026-10-06). Local
                        Value = Price × Exchange Rate, derived on every render
                        and never stored (`sampleLocalValue`). */}
                    <Field label="Exchange Rate" required={active.billable} w="range" className={billOff} htmlFor="se-pi-exrate">
                      <Input
                        id="se-pi-exrate"
                        type="number"
                        required={active.billable}
                        min={0}
                        step="0.0001"
                        className="text-right"
                        value={active.exchange_rate}
                        onChange={(e) => patchStyle(active.key, { exchange_rate: e.target.value })}
                      />
                    </Field>
                    <Field label="Local Value" w="range" className={billOff} htmlFor="se-pi-local">
                      <Input
                        id="se-pi-local"
                        readOnly
                        className="text-right tabular-nums"
                        value={(() => {
                          const v = active.billable ? sampleLocalValue(active) : null;
                          return v == null ? "" : fmtMoney(v, "INR");
                        })()}
                      />
                    </Field>
                </fieldset>
              </FieldRow>

              {/* IMAGE & TECH PACK (client 2026-10-06) — garment pictures and
                  the buyer's tech pack, per style line. PRIVATE bucket, signed
                  reads (0686). After the fields, so the kind <Select> never
                  becomes the section's Tab edge ahead of them. */}
              <div className="pt-2">
                <FileAttachments
                  dense
                  label="Image & Tech Pack"
                  hint="JPG, PNG, WEBP or PDF"
                  rows={active.files}
                  onChange={(next) => patchStyle(active.key, { files: next })}
                  bucket="sample-docs"
                  folder={`sample/${editId ?? uploadFolder}`}
                  kinds={SAMPLE_FILE_KINDS}
                  disabled={editId ? !perms.canEdit : !perms.canCreate}
                />
              </div>
              </div>
            </div>
          )}
        </SectionBody>
      ),
    },
    {
      key: "combos",
      label: "Combos",
      icon: Palette,
      done: realStyles.some((s) => s.combos.some((c) => !isBlankCombo(c))),
      problems: validity.bySection.combos,
      // EVERY STYLE AT ONCE, each under its band (orders-precedent §8) — the
      // spec's Coordinates read-out (§5.1) is the Coordinates on Styles.
      content: (
        <div className="space-y-6">
          {(realStyles.length ? realStyles : styles.slice(0, 1)).map((s) => (
            <div key={s.key} className="space-y-2">
              {styleBand(s)}
              {s.sizes.length === 0 ? (
                // Names a cause ELSEWHERE, so it survives the de-clutter rule.
                <p className="text-sm text-muted-foreground">Pick this style&apos;s sizes on Styles first.</p>
              ) : (
                comboMatrix(s)
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      key: "quantities",
      label: "Quantities",
      icon: Boxes,
      // Spec §4.3 — present only while a style is billable; see `railSections`.
      done: billableStyles.some((s) => s.quantities.some((q) => !isBlankQuantity(q))),
      problems: validity.bySection.quantities,
      content: (
        <>
          {/* ORDER ENTRY'S MULTI ORDER SWITCH (0427; here 0685). On adds a PO No
              column; off hides it and never clears what it holds. */}
          <div className="mb-3 flex items-center gap-3">
            <Toggle
              id="qt-multiorder"
              label="Multi Order"
              checked={header.multi_order}
              onChange={(v) => setH({ multi_order: v })}
            />
            <span className="text-xs text-muted-foreground">
              {header.multi_order
                ? "Each line names the buyer PO it belongs to."
                : "One PO for the whole entry."}
            </span>
          </div>
                    <div data-grid-style="sheet" data-grid-cells="flat" className="[&_table]:table-fixed">
            <ChildGrid<QuantityRow>
              columns={sampleQuantityColumns}
              rows={qtyRows}
              keepOne
              seedRow
              totalsLabel="Total PO Qty"
              tableFrom="5xl"
              onAdd={addQty}
              onRemove={removeQty}
              addLabel="+ Add quantity"
              removeHeader="Actions"
            />
          </div>
          <FieldRow className="mt-3">
            <Field label="Avg Rate" htmlFor="qt-avgrate" className="max-sm:w-full">
              <Input
                id="qt-avgrate"
                readOnly
                className="w-auto min-w-full field-sizing-content text-right"
                value={qtyValue ? String(qtyValue.avgRate) : ""}
              />
            </Field>
            <Field label="Gross Value" htmlFor="qt-gross" className="max-sm:w-full">
              <Input
                id="qt-gross"
                readOnly
                className="w-auto min-w-full field-sizing-content text-right"
                value={
                  qtyValue
                    ? qtyValue.currency
                      ? fmtMoney(qtyValue.gross, qtyValue.currency)
                      : fmtNumber(qtyValue.gross)
                    : ""
                }
              />
            </Field>
            <Field label="INR Value" htmlFor="qt-inr" className="max-sm:w-full">
              <Input
                id="qt-inr"
                readOnly
                className="w-auto min-w-full field-sizing-content text-right"
                value={qtyValue?.inr != null ? fmtMoney(qtyValue.inr, "INR") : ""}
              />
            </Field>
          </FieldRow>
        </>
      ),
    },
  ];

  // ---- sub-sheet targets ------------------------------------------------------
  const assortStyle = assortSheet ? styles.find((s) => s.key === assortSheet.styleKey) ?? null : null;
  const assortQty = assortStyle?.quantities.find((q) => q.key === assortSheet?.qtyKey) ?? null;

  const totalSampleQty = realStyles.reduce((t, x) => t + (Number(x.sample_qty) || 0), 0);
  const closeEditor = () => setMode("list");

  /**
   * THE EDITOR IS A PAGE MOUNT UNDER ORDER ENTRY'S OWN HEADER BAND (user
   * 2026-10-06, compared side by side in the browser). The first build was an
   * OVERLAY with an initials header ("SE") — the operator's rule 3 shape — and
   * read as a different application next to Order Entry, which mounts its
   * editor as a page and draws this band itself: what the screen is · the
   * number · a hairline · the figures · "← Back to list". The app sidebar steps
   * aside for it the same way (6261e14).
   *
   * `flex h-full flex-col` is what a page mount needs (shells.md): the shell
   * takes `flex-1 min-h-0` and divides a definite height.
   */
  /**
   * QUANTITIES IS HIDDEN, NOT GREYED, WHILE NO STYLE IS BILLABLE (user
   * 2026-10-06; spec §1 "Quantities Tab Hidden"). A free sample's counts are
   * already on Combos, and a greyed row read as a section still owed. The
   * Billable switches live on Styles and Product Info, never on Quantities, so
   * the row can only vanish while the operator is somewhere else.
   */
  const railSections = billableStyles.length ? sections : sections.filter((x) => x.key !== "quantities");

  if (mode === "edit") {
    return (
      <div className="flex h-full flex-col gap-4">
        <div data-focus-region="header" className="mb-3 flex w-full flex-wrap items-baseline gap-x-6 gap-y-2 max-md:gap-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={closeEditor}
            aria-label="Back to list"
            className="h-10 w-10 shrink-0 px-0 text-lg md:hidden"
          >
            ←
          </Button>
          <div className="flex min-w-0 shrink-0 items-baseline gap-2 max-md:shrink max-md:flex-col max-md:items-start max-md:gap-0">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
              {editId ? "Edit Sample Entry" : "New Sample Entry"}
            </dt>
            <dd className="m-0 text-sm font-semibold text-foreground">
              {(editId ? editCode : preview.enquiryNo) ?? "—"}
            </dd>
          </div>
          <div aria-hidden className="h-px min-w-[2rem] flex-1 self-center bg-border" />
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden items-baseline gap-1.5 text-xs sm:flex">
              <span className="text-muted-foreground">{customerName || "Customer not chosen"}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium tabular-nums text-foreground">{realStyles.length}</span>
              <span className="text-muted-foreground">{realStyles.length === 1 ? "style" : "styles"} ·</span>
              <span className="font-medium tabular-nums text-foreground">{fmtNumber(totalSampleQty)}</span>
              <span className="text-muted-foreground">pcs</span>
            </span>
            {/* No desktop "← Back to list" (user 2026-10-09, button plan Rule
                1): the footer's Cancel runs the same closeEditor. The phone
                keeps its ← at the start of this band. */}
          </div>
        </div>

        <MasterFullScreen
          ref={shellRef}
          mount="page"
          open
          dirty={dirty}
          onClose={closeEditor}
          modeLabel={null}
          sections={railSections}
          footer={{
            status: dirty ? "Unsaved changes" : editId ? "Editing sample entry" : "New sample entry",
            onCancel: closeEditor,
            onSave: () => submit(false),
            saveLabel: "Save sample entry",
            canSave: validity.canSave,
            // Keeps Save clickable when blocked, so it names the missing field and
            // steers there — and so Ctrl+S and Enter-off-the-last-field reach the
            // same handler.
            onBlockedSave: revealFirstProblem,
            // Order Entry's red "N to fix" beside the buttons: there is something
            // to fix WITHOUT pressing a button first, and clicking it reveals it.
            extra:
              validity.blocking.length > 0 ? (
                <button
                  type="button"
                  onClick={revealFirstProblem}
                  className="text-xs font-medium text-danger hover:underline"
                >
                  {validity.blocking.length} to fix
                </button>
              ) : undefined,
            onSaveDraft: (editId ? perms.canEdit : perms.canCreate) ? () => submit(true) : undefined,
            isPending,
            // Next until the last section, as on Order Entry.
            stepper: true,
            // OE: Next refuses to LEAVE Quantities while a style's Sample Qty
            // and its destinations' PO Qty disagree. The rail stays live.
            stepGuard: (from) =>
              from === "quantities"
                ? (sampleProblems.find((p) => p.section === "quantities" && p.message.includes("does not match Quantities PO Qty"))
                    ?.message ?? null)
                : null,
            onStepBlocked: (why) => toastError(why),
          }}
        />

        <AssortmentSheet
          open={!!assortQty}
          onClose={() => setAssortSheet(null)}
          onBlocked={(why) => toastError(why)}
          quantity={assortQty}
          mode={assortQty ? modeOfType(assortQty.assortment_type_id) : null}
          destStyle={assortStyle}
          styles={realStyles}
          assortmentTypeName={assortTypeLookups.find((l) => l.id === assortQty?.assortment_type_id)?.name ?? ""}
          onChange={(patch) => assortStyle && assortQty && patchQty(assortStyle.key, assortQty.key, patch)}
          newKey={newKey}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sample Entry"
        description="Buyer sample enquiries — styles, product details, combos and billable quantities in one entry."
        actions={perms.canCreate ? <Button onClick={openAdd}>New Sample Entry</Button> : undefined}
      />
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search Enquiry No or customer…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        leading={quick.segment}
        right={
          quick.value
            ? `${filtered.length} of ${rows.length} ${QUICK_LABEL[quick.value]}`
            : `${filtered.length} of ${rows.length}`
        }
      />
      {/* erp-table-fit (user 2026-10-08): short columns hug, the frame is w-fit, Customer stays unsized. */}
      {/* ONE LINE PER CELL (user 2026-10-08: "one line la iruntha pothum, 2 line
          aa split aagirukku"). The wrapping override that kept the table inside
          the pane split Enquiry No, Customer, Season and Created User over two
          lines; `dense` already tightens the columns enough to fit at desk width,
          so the primitive's own nowrap stands. NO SCROLLBAR EITHER (same day: "but
          scroll bar vendam"): Customer and Created User are the two long values, so
          they carry a max width and end in "…" (Customer reveals the whole name on
          hover) instead of widening the row past the pane. */}
      <div className="w-fit max-w-full [&_.overflow-x-auto]:overflow-x-hidden [&_td:nth-last-child(2)]:max-w-[8rem] [&_td:nth-last-child(2)]:truncate">
        <DataTable
          columns={hugCreated(withCreatedColumns(listColumns, filtered))}
          rows={filtered}
          // TIGHT ROWS, px-2 py-1 (user 2026-10-08: remove the sideways scrollbar,
          // "innum compact"). `compact` kept px-3 and, with Created Date / User
          // added, ran ~40px wider than the pane — a scrollbar under one row and
          // the row icons cut off. `dense` takes 8px off every column's padding.
          dense
          getKey={(r) => r.id}
          empty={
            !rows.length
              ? "No sample entries yet. Use 'New Sample Entry' to create the first."
              : quick.value && !searched.some(quick.matches)
                ? `No sample entries are ${QUICK_LABEL[quick.value]} — the counts above show which word they are in.`
                : "No sample entries match the search or filters."
          }
        />
      </div>
    </div>
  );
}
