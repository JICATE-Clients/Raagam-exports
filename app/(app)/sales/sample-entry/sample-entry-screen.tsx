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

import { RowHoverRemove } from "@/components/ui/row-hover-remove";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTabResume } from "@/lib/workspace-tabs";
import { useOpenIntent } from "@/lib/use-open-intent";
import { Boxes, Calculator, ClipboardList, Package, Palette, Plus, Shirt, Users, CalendarRange, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { focusFirstField } from "@/lib/focus";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow, FIELD_WIDTH_CSS, fieldWidthStep } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup } from "@/components/ui/segmented";
import { Truncated } from "@/components/ui/truncated";
import { MultiSelect } from "@/components/ui/multi-select";
import { ChildGrid, gridKeyNav, RowRemoveChip, type ChildGridColumn } from "@/components/masters/child-grid";
import { StyleProcessGrid } from "@/components/orders/style-process-grid";
import type { ProcessKind, StyleProcessRow } from "@/lib/orders/amendments/style-processes";
import { Tooltip } from "@/components/ui/tooltip";
import { StyleIdentityBand } from "@/components/orders/style-identity-band";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { MATRIX_SIZE_TOKEN, sizeColPx } from "@/components/orders/matrix-grid";
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
import { BackLink } from "@/components/ui/back-link";
import { useToast } from "@/components/ui/toast";
import { StatusPill } from "@/components/ui/status-pill";
import { HUG, hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdByFacet, createdDateFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { TypeOrPick } from "@/app/(app)/orders/_garment-order/type-or-pick";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useCreateIntent } from "@/lib/use-create-intent";
import Link from "next/link";
import { sampleEntryLock } from "@/lib/sales/sample-revisions/actions";
import { sectionValidity, type Problem } from "@/lib/screens/validity";
import { isInactive } from "@/lib/masters/inactive";
import { sizeFamily, sortBySize } from "@/lib/masters/size-order";
import { orderUnitLabel } from "@/lib/orders/amendments/types";
import { UNIT_KIND_OPTIONS, coordinatesFull, isUnitKind, pieceCoordinateId } from "@/lib/orders/styles/rules";
import {
  DELIVERY_MODES,
  DEFAULT_SAMPLE_TYPE,
  ENQUIRY_ACTIONS,
  ENQUIRY_AGAINST,
  RECEIPT_MODES,
  SAMPLE_FILE_KINDS,
  SAMPLE_TYPE_OPTIONS,
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
  type StructureDraft,
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
 * and line 2 (user 2026-10-13, was three lines): Agent term 176 + Received Mode
 *   code 144 + Receipt Dt 144 + Merchandiser term 176 + Sample Type 144 +
 *   Tech Pack 144 = 928 + 60 gap = 988 ≤ 1152. (Delivery Mode came off on
 *   2026-10-14, user — it lives on Product Info ▸ Order.)
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

/**
 * Product Info's ONE grid (Option A, user 2026-10-13): six 9rem (`code`) tracks
 * that Order and Billing snap to (Fabric is its own hugging table above them),
 * so a field stands over the field
 * below it. 6 × 144 + 5 × 12 = 924px, inside `PRODUCT_W`. Two equal columns
 * until the editor is 64rem wide, where six tracks fit with their gaps.
 */
const PI_GRID = "grid grid-cols-2 items-end gap-3 @5xl/editor:grid-cols-[repeat(6,9rem)]";

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
  merchandiser_id: null,
  // Fit Sample unless the planner says otherwise (client spec 2026-10-12 §2).
  sample_type: DEFAULT_SAMPLE_TYPE,
  tech_pack: "",
});

/** Style Name → Article No (client spec 2026-10-12 §1). */
const articleKey = (name: string) => name.trim().toUpperCase();

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
  /** Why this entry cannot be saved (0716: an approved costing locks the
   *  sample; a Sample Revision opens it) — the database's own sentence. */
  const [lock, setLock] = useState<string | null>(null);
  /** The latest PD Request to the Sample Department (0719), keyed `forId` so a
   *  late answer never paints another entry's status. ABOVE the early return
   *  below (AGENTS.md, hooks above every early return). */
  const [editCode, setEditCode] = useState<string | null>(null);
  const [header, setHeader] = useState<SampleHeaderDraft>(blankHeader);
  const [styles, setStyles] = useState<StyleDraft[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** The style tab "+ Add style" just opened — its first field takes the
   *  cursor once the tab has rendered (the Styles tabs, user 2026-10-13). */
  const focusStyleRef = useRef<string | null>(null);
  useEffect(() => {
    const key = focusStyleRef.current;
    if (!key) return;
    focusStyleRef.current = null;
    focusFirstField(document.querySelector<HTMLElement>(`[data-style-panel="${CSS.escape(key)}"]`));
  }, [styles, activeKey]);

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
  const blankStructure = (): StructureDraft => ({ key: newKey(), structure_id: null, gsm: "", composition_id: null });
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
  const blankProcess = (kind: ProcessKind): StyleProcessRow => ({ key: newKey(), kind, process_id: null, component_id: null, details: "" });
  /* ONE BLANK ROW PER EMBELLISHMENT GRID (user 2026-10-15). Combos shows two
     fixed-kind grids over this one list, and each shows only its own kind — so
     the old single `kind: null` seed was in NEITHER grid, both then seeded via
     `seedRow` in the same render off the same stale list, and the second write
     (Garment) erased the first: Component Process opened empty. Seeded here in
     state, one per kind; a kind-stamped blank row is not "started"
     (`kindStamped`) and the save drops any row with no Process. */
  const seedProcesses = (rows: StyleProcessRow[]): StyleProcessRow[] => {
    const kept = rows.filter((r) => r.kind);
    return [
      ...kept,
      ...(["component", "garment"] as const).filter((k) => !kept.some((r) => r.kind === k)).map(blankProcess),
    ];
  };
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
    structures: [blankStructure()],
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
    processes: seedProcesses([]),
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
    processes: seedProcesses(s.processes),
    // Product Info ▸ Fabric's Structure · GSM grid opens on a row to pick in.
    structures: s.structures.length ? s.structures : [blankStructure()],
  });

  // ---- open -------------------------------------------------------------------
  function openAdd() {
    setLock(null);
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
  /* THE TOP-NAVIGATION TAB REMEMBERS THE OPEN ENQUIRY (user 2026-10-09): leaving from
     an enquiry and coming back through the tab reopens THAT enquiry, not the list.
     `?open=<id>` is consumed by `useOpenIntent`, which strips it from the URL. The
     same param is a Sample Revision's "Open Sample Entry" — loaded by id, so it
     opens an enquiry the list does not hold. */
  useOpenIntent((id) => openEdit({ id } as SampleEntryListRow));
  const tabPath = usePathname();
  useTabResume(tabPath, mode === "edit" && editId ? `?open=${editId}` : null);

  function openEdit(r: SampleEntryListRow) {
    start(async () => {
      const res = await loadSampleEntry(r.id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setLock(await sampleEntryLock(res.record.id));
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
  /** Style Name → Article No (client spec 2026-10-12 §1) — a plain const, not
   *  a memo: a cheap map, and no hook to place above an early return. */
  const articleByName = new Map(data.articles.map((a) => [a.name, a.article_no]));
  const active = styles.find((s) => s.key === activeKey) ?? realStyles[0] ?? styles[0] ?? null;
  const billableStyles = realStyles.filter((s) => s.billable);
  const indexOf = (s: StyleDraft) => styles.findIndex((x) => x.key === s.key);
  const styleLabel = (s: StyleDraft) => `${indexOf(s) + 1} · ${s.name.trim() || "Unnamed style"}`;


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
        router.refresh();
        // SAVE CLOSES THE ENTRY (user 2026-10-14, later the same day: "after
        // saving the entries close it immediately … no staying the screen
        // again"). This reverses the earlier "stay on the entry" re-open; a
        // Sample Entry has no Submit of its own to stay for. Draft or full
        // save, the operator lands back on the list.
        setMode("list");
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
        menu={[
          { label: "Cost this sample", icon: Calculator, onClick: () => router.push(`/sales/sample-costing?costFor=${r.id}`) },
        ]}
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
    // The open tab closing hands over to its LEFT neighbour (the right one for
    // the first), as a closed document tab does — never back to tab 1.
    const at = styles.findIndex((x) => x.key === key);
    const next = styles[at - 1] ?? styles[at + 1] ?? null;
    mutStyles((xs) => xs.filter((x) => x.key !== key));
    if (active?.key === key) setActiveKey(next?.key ?? null);
  };
  /** "+ Add style" opens the new line as its own tab, cursor in its first field. */
  const addStyle = () => {
    const s = blankStyle();
    mutStyles((xs) => [...xs, s]);
    setActiveKey(s.key);
    focusStyleRef.current = s.key;
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
          onChange={(e) => {
            /* ARTICLE NO FOLLOWS THE STYLE (client spec 2026-10-12 §1: "auto-
               fetch and populate Article No when Style Name / No is entered").
               From the Garment Style master, else an earlier sample of that
               name (`articles`). Only a blank Article No, or one this box
               filled itself, is overwritten — a typed one is the operator's. */
            const name = e.target.value;
            const hit = articleByName.get(articleKey(name));
            const prev = articleByName.get(articleKey(r.name)) ?? "";
            const auto = !r.article_no.trim() || r.article_no === prev;
            patchStyle(r.key, auto ? { name, article_no: hit ?? "" } : { name });
          }}
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
    // No Delivery Dt column (user 2026-10-14) — the line's date is asked on
    // Product Info ▸ Order.
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
      {/* THE COORDINATE TABLE, AS ORDER ENTRY DRAWS IT (user 2026-10-13: "order
          module mari neat aa") — a headed `# · Coordinate` table, not bare
          boxes, then "+ Add coordinate" under it.
          CELLS, NOT BOXES (user 2026-10-13, screenshot 115109: "coordinate
          table la irukka table mari cell mari venum") — OE's own sheet wrapper
          (`data-grid-style="sheet"` + `data-grid-cells="flat"`, erp-sheet-grid),
          so the picker draws as a flat ruled cell. A FIXED 10rem = `#` 2.5 +
          Coordinate 7.5, OE's width: `hideRemove` means no Actions column, and
          ChildGrid's root is an `@container`, so only a definite width holds
          the pane open (a `w-fit` collapses it and slides Sizes under it). */}
      <div className="w-40 min-w-40 flex-none">
        <Field label="Coordinate" required className="w-full">
          <div data-grid-style="sheet" data-grid-cells="flat" className="[&_table]:table-fixed">
          <ChildGrid<CoordinateDraft>
            tableAlways
            frameless
            headerClassName={COMPOSITION_HEAD}
            columns={[
              {
                header: "Coordinate",
                // A declared width makes the table HUG (`hugsContent`) instead of
                // `min-w-[420px]`, which scrolled sideways in this pane.
                // OE's `COORDINATE_W`: # 2.5rem + 7.5rem = the w-40 pane above.
                width: "7.5rem",
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
            addClassName="w-fit whitespace-nowrap px-2"
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
          </div>
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
      {/* FILES AS A CELL, like Order Entry's (user 2026-10-13): one "Click" box on
          the composition line instead of a full-width strip under it. Same
          rows, bucket and kinds; not mandatory here. */}
      <div className="min-w-0 w-32 flex-none">
        <Field label="Files" className="w-full">
          <FileAttachments
            variant="cell"
            label="Files"
            rows={r.files}
            onChange={(next) => patchStyle(r.key, { files: next })}
            bucket="sample-docs"
            folder={`sample/${editId ?? uploadFolder}`}
            kinds={SAMPLE_FILE_KINDS}
            disabled={editId ? !perms.canEdit : !perms.canCreate}
          />
        </Field>
      </div>
    </div>
  );

  // ---- Combos: one combo × size matrix per style ---------------------------------
  /**
   * A SIZE-ACROSS MATRIX (orders-precedent §5): a sticky Combo column on the
   * left, the style's sizes across the top, each size column sized for its label
   * and its data (`sizeColPx`) rather than a flat 72px, and a Total on the right
   * with a totals row underneath. It NEVER folds to cards — the sizes ARE the
   * axis, so a run too long for the pane scrolls inside its own frame. The
   * 2026-10-06 build used ChildGrid columns at a flat `num` and turned past eight
   * sizes into a stack of one-field boxes with no shared header. How it is
   * DRAWN changed on 2026-10-14 — see the next comment.
   */
  /*
   * THE EMBELLISHMENTS TABLE'S LOOK, SIZED TO ITS COLUMNS (user 2026-10-14, Sample
   * Entry ▸ Combos: "intha screenshot mari combo field venum" — the Embellishments
   * grid under it). A `#` column, bold capitals headers, a rounded frame with
   * hairlines between columns, and the app's own boxed fields in padded cells;
   * "+ Add combo" is the outline button below. NOT `data-grid-style="sheet"` — the
   * client asked for this boxed look by name, after the flat sheet look had been
   * tried on this table. The frame is `w-fit max-w-full`, so it is as wide as its
   * columns (`erp-table-fit`).
   *
   * Two things this look does not change:
   *   - the sizes ARE the axis, so a run too long for the pane scrolls INSIDE the
   *     frame, with the Combo column sticky;
   *   - the row's x rides in the LAST cell, hover-only (`erp-row-hover-remove`), in
   *     a slot that is always 28px wide so the figures stay aligned.
   */
  const NUM_W = 48;
  const COMBO_ID_W = 220;
  const MATRIX_QTY_W = 104;
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
    /* THE SIZE NAME IS NEVER CUT (user 2026-10-14: "XS" read "X…", "XXXXL"
       "XXXX…"). `sizeColPx` sizes a column for its label as bare text, but the
       header draws it inside `MATRIX_SIZE_TOKEN` (px-1.5 + border) and the sheet
       header cell adds 8px a side, and its `overflow: hidden; text-overflow:
       ellipsis` clipped the chip. So the column is the wider of the data's width
       and the chip's: 13px mono ≈ 8px a character + 14px chip + 16px cell. */
    const colW = (z: string) => Math.max(sizeColPx(z, digits(z)), Math.ceil(z.trim().length * 8 + 14 + 16 + 4));
    const widths = [NUM_W, COMBO_ID_W, ...sizes.map(colW), MATRIX_QTY_W];
    const tableWidth = widths.reduce((t, w) => t + w, 0);
    const orderSum = s.combos.reduce((t, c) => t + comboOrderQty(c, sizes), 0);
    const want = Number(s.sample_qty) || 0;

    return (
      <div className="space-y-2">
        <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="table-fixed border-separate border-spacing-0" style={{ width: tableWidth }}>
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="h-10 px-2 text-center text-[13px] font-bold uppercase tracking-wide">#</th>
                <th className="sticky left-0 z-20 h-10 border-l border-border bg-surface px-3 text-left text-[13px] font-bold uppercase tracking-wide">
                  Combo / Color
                </th>
                {sizes.map((z) => (
                  <th key={z} className="h-10 border-l border-border px-2 text-right text-[13px] font-bold">
                    <span className={MATRIX_SIZE_TOKEN}>{z}</span>
                  </th>
                ))}
                <th className="h-10 border-l border-border px-2 text-right text-[13px] font-bold uppercase tracking-wide">
                  Total
                </th>
              </tr>
            </thead>
            <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
              {s.combos.map((c, i) => (
                <tr key={c.key} data-grid-row>
                  <td className="border-t border-border px-2 pt-3.5 text-center align-top text-[13px] tabular-nums text-muted-foreground">
                    {i + 1}
                  </td>
                  <td className="sticky left-0 z-10 border-l border-t border-border bg-surface p-1.5 align-top">
                    <TypeOrPick
                      id={`se-cb-name-${c.key}`}
                      label="Combo / Color"
                      placeholder=""
                      options={colourOptions}
                      valueId={colourOptions.find((o) => o.name.toUpperCase() === c.combo.trim().toUpperCase())?.id ?? null}
                      text={c.combo}
                      onChange={(next) => patchCombo(s, c.key, { combo: next.name })}
                    />
                  </td>
                  {sizes.map((z) => (
                    <td key={z} className="border-l border-t border-border p-1.5 align-top">
                      <Input
                        type="number"
                        min={0}
                        inputMode="decimal"
                        aria-label={`${c.combo || "Combo"} ${z} pieces`}
                        className="w-full text-right tabular-nums"
                        value={c.sizes[z] ?? ""}
                        onChange={(e) => patchCombo(s, c.key, { sizes: { ...c.sizes, [z]: e.target.value } })}
                      />
                    </td>
                  ))}
                  <td className="border-l border-t border-border px-2 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="text-[13px] font-semibold tabular-nums">{fmtNumber(comboOrderQty(c, sizes))}</span>
                      {/* Hover x in the last cell (user 2026-10-12, erp-row-hover-remove). */}
                      {s.combos.length > 1 ? (
                        <RowHoverRemove
                          label="Remove combo"
                          onClick={() => patchStyle(s.key, { combos: s.combos.filter((x) => x.key !== c.key) })}
                        />
                      ) : (
                        <span className="h-5 w-5 shrink-0" aria-hidden />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-muted font-semibold">
                <td className="border-t border-border" />
                <td className="sticky left-0 z-10 border-l border-t border-border bg-surface-muted px-3 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  Total
                </td>
                {sizes.map((z) => (
                  <td key={z} className="border-l border-t border-border px-2 py-2 text-right text-[13px] tabular-nums">
                    {fmtNumber(sizeSum(z))}
                  </td>
                ))}
                <td className="border-l border-t border-border px-2 py-2 text-right text-[13px] tabular-nums">
                  <span className="pr-[1.625rem]">{fmtNumber(orderSum)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
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
      identity={{ ref: s.name.trim() || `Line ${indexOf(s) + 1}`, style: "", article: s.article_no.trim() }}
      // NO PRD NUMBER IN THE SAMPLE MODULE (client 2026-10-14: PRD is a bulk
      // production number; a sample is named by its SMP Number).
      omit={["style"]}
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
    const held = header.merchandiser_id;
    return held && !base.some((m) => m.id === held)
      ? [...base, ...data.merchandisers.filter((m) => m.id === held)]
      : base;
  })();
  // No Fabric Code on Product Info any more (client spec 2026-10-12 §1); a
  // line's stored `fabric_id` passes through a save unchanged.

  // The editor's own title strip still names the customer (Product Info no longer does).
  const customerName = customerOf(header.customer_id)?.name ?? "";
  const structureName = (id: string) => data.fabricStructures.find((x) => x.id === id)?.name ?? "";
  /** One Structure · GSM row edited (Product Info ▸ Fabric). */
  const patchStructure = (st: StyleDraft, key: string, patch: Partial<StructureDraft>) =>
    patchStyle(st.key, { structures: st.structures.map((x) => (x.key === key ? { ...x, ...patch } : x)) });
  /** Product Info ▸ Fabric's Structure · Composition · GSM columns for one
   *  style line — COMPACT (user 2026-10-13: "compact titten pannu"): # 2.5 +
   *  Structure `party` 12.5 (holds "2X2 LYCRA DURBY RIB") + Composition `party`
   *  12.5 (0726, holds "BCI COTTON 97%, ELASTANE 3%") + GSM 6 (a 3-4 digit GSM
   *  and its hover ✕) = the 33.5rem pane they sit in. */
  const structureColumnsFor = (active: StyleDraft): ChildGridColumn<StructureDraft>[] => [
    {
      header: "Structure",
      width: FIELD_WIDTH_CSS.party,
      cell: (x) => (
        <RecordPicker
          label="Fabric Structure"
          compact
          items={data.fabricStructures.filter(
            (o) =>
              o.id === x.structure_id ||
              (!o.inactive && !active.structures.some((y) => y.key !== x.key && y.structure_id === o.id)),
          )}
          value={x.structure_id}
          onChange={(id) => patchStructure(active, x.key, { structure_id: id })}
        />
      ),
    },
    {
      /* COMPOSITION (spec v8 §7.1, user 2026-10-14 Q5; 0726): optional, from the
         Composition master. The costing seeds this fabric's Yarn Mix from it, so
         a composition typed once here is not typed again there. */
      header: "Composition",
      width: FIELD_WIDTH_CSS.party,
      cell: (x) => (
        <RecordPicker
          label="Composition"
          compact
          items={data.compositions.filter((o) => o.id === x.composition_id || !o.inactive)}
          value={x.composition_id}
          onChange={(id) => patchStructure(active, x.key, { composition_id: id })}
        />
      ),
    },
    {
      header: "GSM",
      width: "6rem",
      align: "right",
      cell: (x) => (
        <div
          className={cn(
            "flex items-center",
            x.structure_id && !x.gsm.trim() && "bg-[color-mix(in_srgb,var(--danger)_6%,transparent)]",
          )}
        >
          <Input
            id={`se-pi-gsm-${x.key}`}
            aria-label={`GSM · ${structureName(x.structure_id ?? "") || "Structure"}`}
            type="number"
            min={0}
            className="text-right"
            value={x.gsm}
            onChange={(e) => patchStructure(active, x.key, { gsm: e.target.value })}
          />
          {active.structures.length > 1 && (
            <RowHoverRemove
              label={`Remove ${structureName(x.structure_id ?? "") || "this structure"}`}
              className="mr-1"
              onClick={() =>
                patchStyle(active.key, { structures: active.structures.filter((y) => y.key !== x.key) })
              }
            />
          )}
        </div>
      ),
    },
  ];
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
      done: !!header.customer_id && !!header.received_date && !!header.merchandiser_id,
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
                  keepOrder
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
              {/* NO COUNTRY BOX (user 2026-10-12: "remove the field from sample
                  info"). It was a read-only echo of the customer master; the
                  customer pick still stores `country_id`, so nothing that reads
                  the entry's country loses it. */}
              {/* A VENDOR (client 2026-10-06): Vendor master ▸ Service Provider ▸
                  Buying Agent / Service Agent — `getAgents` in the service. */}
              <Field label="Agent" w="term">
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
              <Field label="Received Mode" w="code" htmlFor="se-rmode">
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
              {/* No Delivery Mode here (user 2026-10-14) — it is asked per
                  style on Product Info ▸ Order. */}
            {/* MERCHANDISER AND SAMPLE TYPE ARE THE ENTRY'S (client spec
                2026-10-12 §2) — said once here and stamped on every style line
                at Save. Merchandiser was asked per line on Product Info.
                Same FieldRow as the line above: TWO rows in all (user
                2026-10-13), seven fields each — see `HEADER_W`. */}
              <Field label="Merchandiser" required w="term">
                <RecordPicker
                  id="se-merch"
                  label="Merchandiser"
                  compact
                  required
                  items={merchItems}
                  value={header.merchandiser_id}
                  onChange={(id) => setH({ merchandiser_id: id })}
                />
              </Field>
              <Field label="Sample Type" w="code" htmlFor="se-stype">
                <Select id="se-stype" value={header.sample_type} onChange={(e) => setH({ sample_type: e.target.value })}>
                  {SAMPLE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* ONE TECH PACK STATUS FOR THE ENTRY, beside Sample Type (user
                  2026-10-12) — stamped on every style line at Save. */}
              <Field label="Tech Pack" w="code" htmlFor="se-techpack">
                <Select id="se-techpack" value={header.tech_pack} onChange={(e) => setH({ tech_pack: e.target.value })}>
                  <option value=""></option>
                  {TECH_PACK.map((o) => (
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
      // NO SectionBody — the rail row names the section (OE: "NO WRAPPER").
      /* ONE TAB PER STYLE (user 2026-10-13: "add style filed button tab aa venum
         add style kudutha tab aa varanum"). The lines were a stack of cards with
         "+ Add style" under the last one; now each line is a tab, "+ Add style"
         sits at the end of the strip and opens the new line as the active tab,
         cursor in its first field. The open tab is `activeKey` — the SAME key
         Product Info / Combos switch on — so picking a style here carries over.
         The last line cannot be removed (the ✕ shows only with two or more),
         which is the `keepOne` the grid gave. A tab's red count is that line's
         own Styles problems. */
      content: (
        <Tabs
          value={active?.key}
          onChange={setActiveKey}
          after={
            <Button type="button" variant="outline" onClick={addStyle} disabled={editId ? !perms.canEdit : !perms.canCreate}>
              <Plus aria-hidden className="size-4" />
              Add style
            </Button>
          }
          items={styles.map((r, i) => ({
            key: r.key,
            label: styleLabel(r),
            problems: sampleProblems.filter((p) => p.section === "styles" && p.styleKey === r.key).length,
            done: !isBlankStyle(r),
            content: (
              // The row draws its own chrome, so `Field required` is the ONLY
              // place a column's `required` reaches the control.
              <div data-style-panel={r.key} className="relative space-y-2 pr-8 max-sm:pr-0">
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
            ),
          }))}
        />
      ),
    },
    {
      key: "product",
      label: "Product Info",
      icon: Package,
      done: realStyles.length > 0 && realStyles.every((s) => s.structures.some((x) => !!x.structure_id)),
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
                    /* SMP NUMBER, NOT THE PRD (client 2026-10-14): PRD is a bulk
                       production number and read as one here. The entry's own
                       number is the sample's name — "Enquiry No" was it too. */
                    ["SMP Number", (editId ? editCode : preview.enquiryNo) ?? ""],
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
              {/* FABRIC (client spec 2026-10-12 §1). Fabric Structure is a
                  MULTI-select, and each structure picked takes its own GSM —
                  "fabric-based GSM … linked to the selected structure(s)"
                  (0715 `sample_style_fabric_structures`; the first is mirrored
                  onto the line for Costing and Grouping). Fabric Code, Order Dt,
                  the Agent override and the Customer read-out came off; the
                  Merchandiser and Tech Pack moved to Sample Info. */}
              {/* OPTION A OF THE 2026-10-13 MOCK-UPS, applied (user: "itha apply
                  pannidu" — artifact HjRt8AFFNSZtRCKKSSGcZ8). ONE SIX-TRACK GRID
                  (`PI_GRID`) that Order and Billing snap to, so
                  Delivery Dt stands over Ship Type and Delivery Mode over Ship
                  Mode. Before it each row was a FieldRow with its own widths
                  (Delivery Mode `term`, Ship Mode `range`) and nothing lined up;
                  the structure chips wrapped under the picker while their GSM
                  boxes floated to the right of them, so a structure and its GSM
                  sat on different lines. */}
              <PiLegend>Fabric</PiLegend>
              {/* THE DROPDOWN IN THE ROW, "+ Add structure" UNDER THE TABLE (user
                  2026-10-13: "table column laye drop down vachi kela add button
                  vaikkara mari … table row kullaye selected field irukkara mari
                  venum"). The Styles ▸ Coordinate table's shape: a headed
                  `# · Structure · GSM` sheet with flat cells, 21rem wide, one structure
                  picked per row, its GSM beside it. It replaces a multi-select
                  in the table's head whose ticks became the rows — the field and
                  the value it set were two different places.
                  Opens on one row ready (`blankStructure`, seeded in STATE by
                  `blankStyle` / `withSeeds`, never `seedRow`, which would mark
                  the entry "Unsaved"); a row left without a structure is dropped
                  at save (`toSampleEntryPayload`). A structure already on another
                  row is not offered again — it would be one structure counted
                  twice. The hover ✕ rides in the GSM cell (`RowHoverRemove`,
                  Ctrl+Del through `data-row-remove`); the last row keeps none. */}
              <div className="w-[33.5rem] max-w-full">
                <div data-grid-style="sheet" data-grid-cells="flat" className="[&_table]:table-fixed">
                  <ChildGrid<StructureDraft>
                    tableAlways
                    frameless
                    headerClassName={COMPOSITION_HEAD}
                    columns={structureColumnsFor(active)}
                    rows={active.structures}
                    hideRemove
                    addClassName="w-fit whitespace-nowrap px-2"
                    addLabel="+ Add structure"
                    onAdd={() => {
                      // Refused while the last row is still blank — fill it
                      // before asking for another (the Coordinate grid's rule).
                      const last = active.structures[active.structures.length - 1];
                      if (last && !last.structure_id) return false;
                      patchStyle(active.key, { structures: [...active.structures, blankStructure()] });
                    }}
                    onRemove={(x) => patchStyle(active.key, { structures: active.structures.filter((y) => y.key !== x.key) })}
                  />
                </div>
                {(() => {
                  const blank = active.structures.filter((x) => x.structure_id && !x.gsm.trim()).length;
                  return blank > 0 ? <p className="mt-1 text-xs text-muted-foreground">{blank} GSM still to fill.</p> : null;
                })()}
              </div>

              {/* DELIVERY DT · DELIVERY MODE, then the two switches on the same
                  line. Delivery Dt is the line's own (asked only here since
                  2026-10-14); Delivery Mode starts as Sample Info's
                  and may be overridden (spec §2.3). */}
              <PiLegend>Order</PiLegend>
              <div className={PI_GRID}>
                <Field label="Delivery Dt" htmlFor="se-pi-ddt" className="w-full min-w-0">
                  <Input
                    id="se-pi-ddt"
                    type="date"
                    value={active.delivery_date}
                    onChange={(e) => patchStyle(active.key, { delivery_date: e.target.value })}
                  />
                </Field>
                <Field label="Delivery Mode" htmlFor="se-pi-dmode" className="w-full min-w-0">
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
                {/* COMMERCIAL (spec §4.3). Billable = No greys the Billing group
                    below, and a greyed field is never saved
                    (`toSampleEntryPayload`) and never required. */}
                <div className="col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 self-end @5xl/editor:col-span-4">
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
                    className="@2xl/editor:min-h-8"
                  />
                </div>
              </div>

              {/* BILLING, ITS OWN LABELLED GROUP (Option A): six greyed fields
                  with nothing saying why read as broken, so the legend says it
                  while Billable is No.
                  GREYED, NOT HIDDEN, WHEN BILLABLE = NO (user 2026-10-06): showing
                  and hiding the fields made the section jump on every toggle. A
                  native <fieldset disabled> disables every control inside it —
                  the pickers included, which have no `disabled` prop of their
                  own — and `display: contents` keeps the fields in the grid.
                  Still never SAVED and never REQUIRED while No
                  (`toSampleEntryPayload`, `sampleEntryProblems`). `disabled`
                  alone does not read as off under the raagam skin, so the fields
                  are dimmed as well (checked in the browser, 2026-10-06). */}
              <PiLegend>
                Billing
                {!active.billable && (
                  <span className="rounded-md bg-warning-soft px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-warning">
                    Turn on Billable to fill these
                  </span>
                )}
              </PiLegend>
              <div className={PI_GRID}>
                <fieldset
                  disabled={!active.billable}
                  aria-label="Billing — only for a billable sample"
                  className="contents"
                >
                    <Field label="Ship Type" className={cn("w-full min-w-0", billOff)}>
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
                    <Field label="Ship Mode" className={cn("w-full min-w-0", billOff)} htmlFor="se-pi-smode">
                      <Select id="se-pi-smode" value={active.ship_mode} onChange={(e) => patchStyle(active.key, { ship_mode: e.target.value })}>
                        <option value=""></option>
                        {SHIP_MODES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Currency" required={active.billable} className={cn("w-full min-w-0", billOff)}>
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
                    <Field label="Price" required={active.billable} className={cn("w-full min-w-0", billOff)} htmlFor="se-pi-price">
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
                    <Field label="Exchange Rate" required={active.billable} className={cn("w-full min-w-0", billOff)} htmlFor="se-pi-exrate">
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
                    <Field label="Local Value" className={cn("w-full min-w-0", billOff)} htmlFor="se-pi-local">
                      <Input
                        id="se-pi-local"
                        readOnly
                        className="bg-surface-muted text-right tabular-nums"
                        value={(() => {
                          const v = active.billable ? sampleLocalValue(active) : null;
                          return v == null ? "" : fmtMoney(v, "INR");
                        })()}
                      />
                    </Field>
                </fieldset>
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
              {/* EMBELLISHMENTS (client 2026-10-14, 0722) — BOTH kinds under
                  Combos: a Component Process on a cut panel (chest print on the
                  Front Body) and a Garment Process on the stitched garment
                  (enzyme wash). ORDER ENTRY'S Style ▸ Process grid, not a copy
                  of it: Type picks the kind, Process narrows by the master's
                  for_components / for_garments flag, Component is live only on
                  a Component Process. No rate — Sample Costing opens one
                  Embellishment line per row for the rate to be typed. Needs no
                  sizes, so it shows under the matrix's hint as well. */}
              {/* TWO CATEGORIES, TWO GRIDS (spec v8 §5, 2026-10-14): Component
                  Process — on a cut panel before stitching (chest print,
                  embroidery, appliqué) — and Garment Process — on the whole
                  garment (enzyme wash, tie & dye). One `processes` list
                  underneath; each grid shows and adds only its own kind. */}
              {/* EXCEL-SHEET LOOK, SIZED TO ITS COLUMNS (user 2026-10-14, Sample
                  Entry ▸ Combos ▸ Embellishments: "excel sheet la irukkum column
                  table athu mari venum"; `erp-sheet-grid` + `erp-table-fit`). It
                  went sheet, then back to boxed, then sheet again — the client's
                  last word is the sheet. The sheet + flat markers make the
                  gridline the box, round the four outer corners and sentence-case
                  the headers. Every column declares a width, so the grid hugs
                  them — ChildGrid hugs its declared widths by itself, which IS
                  `erp-table-fit` for a grid. `table-fixed` stops the columns
                  re-splitting as values are typed. Marker on THESE call sites
                  only: the same grid on Order Entry's Style ▸ Process keeps its
                  own look until asked.

                  NO `w-fit` ON THE WRAPPERS (screenshot 155732: the table collapsed
                  to stacked cards of ~44px fields). ChildGrid's table/cards switch
                  is a CONTAINER query on its own frame; under a shrink-to-fit
                  parent that frame has no intrinsic width, measures a few pixels,
                  falls below the 512px `@lg` threshold and stacks. The hug already
                  comes from the declared column widths. */}
              <PiLegend>Embellishments · Component Process</PiLegend>
              <div data-grid-style="sheet" data-grid-cells="flat" className="[&_table]:table-fixed">
                <StyleProcessGrid
                  kind="component"
                  rows={s.processes}
                  onChange={(next) => patchStyle(s.key, { processes: next })}
                  processes={data.processes}
                  components={data.components}
                  newKey={newKey}
                  readOnly={!!lock}
                  tableAlways
                />
              </div>
              <PiLegend>Embellishments · Garment Process</PiLegend>
              <div data-grid-style="sheet" data-grid-cells="flat" className="[&_table]:table-fixed">
                <StyleProcessGrid
                  kind="garment"
                  rows={s.processes}
                  onChange={(next) => patchStyle(s.key, { processes: next })}
                  processes={data.processes}
                  components={data.components}
                  newKey={newKey}
                  readOnly={!!lock}
                  tableAlways
                />
              </div>
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
  /* COMBOS ARE HIDDEN ON A QUOTE (user 2026-10-12: "if Sample Info's Action is
     Quote, hide the Combos tab") — a quote prices the style, it plans no
     colourways. Hidden, not cleared: combos already typed stay stored and come
     back if the Action changes, and their rules stand down while hidden
     (`sampleEntryProblems`), so a section nobody can see never blocks Save. */
  const railSections = sections.filter(
    (x) => !(x.key === "quantities" && !billableStyles.length) && !(x.key === "combos" && header.enquiry_action === "quote"),
  );

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
          {/* THE WAY BACK IS SAID ON A DESKTOP TOO (user 2026-10-14: "add clear
              Back buttons"), reversing 10-09's footer-Cancel-only. The app's own
              BackLink, so it reads like every other Back and asks before
              discarding. */}
          <BackLink onBack={closeEditor} label="Sample Entry" className="max-md:hidden" />
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
          /* LOCKED ONCE ITS COSTING IS APPROVED (0716) — read-only with the
             reason, and the way through: a Sample Revision that opens Sample
             Info & Qty. `?raise=` opens the form, or the revision already open. */
          locked={
            lock && editId
              ? {
                  message: lock,
                  action: (
                    <Link href={`/sales/sample-revision?raise=${editId}`} className="font-medium text-primary underline underline-offset-2">
                      {lock.includes("SMP-REV/") ? "Open the revision" : "Raise Revision"}
                    </Link>
                  ),
                }
              : false
          }
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
      {/* THE ROW ICONS MUST NEVER BE CUT (user 2026-10-09, live at 125% zoom: the calculator /
          pencil / bin were clipped to a sliver). Below a 1900px viewport the two Created
          columns step aside and the frame scrolls instead of hiding the overflow; the
          no-scrollbar look stays on a wide screen where everything fits. */}
      <div className="w-fit max-w-full min-[1900px]:[&_.overflow-x-auto]:overflow-x-hidden [&_td:nth-last-child(2)]:max-w-[8rem] [&_td:nth-last-child(2)]:truncate">
        <DataTable
          columns={hugCreated(withCreatedColumns(listColumns, filtered)).map((c) =>
            c.header === "Created Date" || c.header === "Created User"
              ? { ...c, className: [c.className, "max-[1899px]:hidden"].filter(Boolean).join(" ") }
              : c,
          )}
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
