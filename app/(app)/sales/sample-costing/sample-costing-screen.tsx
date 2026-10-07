"use client";

/**
 * Sample ▸ Sample Costing — the list, and the cost sheet editor as a PAGE mode
 * of it. Data: doc/sample/sample-costing-specification.md (0688 · 0689 · 0690).
 * Layout: doc/sample/sample-costing-uiux-design-spec.md (2026-10-07).
 *
 * THE LAYOUT, AND WHERE IT DEPARTS FROM THE UI/UX SPEC ON PURPOSE
 *
 *   ┌ CONTEXT RIBBON — Costing No · Rev · status · style + thumb · buyer | season · currency · actions ┐
 *   │ 1 Details    │  CANVAS — one scrolling page of numbered cards           │ COMMERCIAL RAIL     │
 *   │ 2 Fabric     │   1 Costing details                                      │ (sticky)            │
 *   │ 3 Consumption│   2 Fabric rates — an accordion card per fabric          │ live breakdown      │
 *   │ 4 CMT        │   3 Consumption & component weights                      │ margin · overhead   │
 *   │ 5 Trims      │   4 CMT & garment processing                             │ currency · rate     │
 *   │ 6 Commercial │   5 Trims & accessories · 6 Overheads & commercial       │ HERO FOB PRICE      │
 *   └──────────────┴──────────────────────────────────────────────────────────┴─────────────────────┘
 *
 * - ONE SCROLLING CANVAS, sticky numbered anchors on the left (spec §1, §3).
 *   The anchors scroll; a scroll-spy lights the card in view and each anchor
 *   carries its card's "to fix" count.
 * - THE RAIL IS 21rem ON A LAPTOP, NOT 35%. The client's machine is 1366px
 *   (spec §6 tests it too): the pane is 1346px with no section rail, and 35%
 *   plus a 10rem anchor column would leave the cards ~690px — every grid
 *   would fold to stacked boxes. 1346 − 160 − 336 − 2 × 16 = 818px of canvas;
 *   every table below is cut to fit 818 (arithmetic above each `…Columns`).
 *   From `2xl` (1536px) the rail takes 30%, where the canvas can afford it.
 * - COLOURS ARE THE APP'S TOKENS, NOT THE SPEC'S INDIGO / SLATE. Indigo is
 *   not Raagam's brand (primary is the brand blue, AA-checked against white)
 *   and a hard-coded hex would break every theme preset and the dark mode.
 *   The spec's ROLES are kept: primary for actions and the hero price,
 *   success / warning / danger for margin health, a white card on the pane.
 * - KEYBOARD IS THE APP CONTRACT (raagam-keyboard-contract): Tab / Enter /
 *   arrows / Ctrl+S / Ctrl+Del come from lib/focus.ts. The spec's "Esc
 *   restores the cell" is NOT built — Esc is the app-wide close-one-layer
 *   ladder, and a per-screen key handler would replace the contract here.
 * - NO "Recalculate" BUTTON and NO DEBOUNCE: every figure is a pure function
 *   of the inputs (lib/sales/sample-costing/calc.ts) and recomputes on the
 *   keystroke; a 200ms debounce would only make the rail lag the typing.
 * - NO SLIDERS for Margin / Overhead: a number box is typed and tabbed; a
 *   slider is neither, and the operators work by keyboard.
 *
 * HOOKS ABOVE EVERY EARLY RETURN (AGENTS.md): the editor returns at
 * `if (mode === "edit")`, so every hook here is declared above it.
 */

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  CalendarRange,
  ChevronDown,
  FileDown,
  FileText,
  Layers,
  Palette,
  RefreshCw,
  Ruler,
  Scissors,
  Tag,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup } from "@/components/ui/segmented";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS, fieldWidthStep } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { Tooltip } from "@/components/ui/tooltip";
import { ChildGrid, RowRemoveChip, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { RecordPicker } from "@/components/masters/record-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { SubDetailSheet, useSubSheetOrigin } from "@/components/orders/sub-detail-sheet";
import { useQuickStatus, type QuickWord } from "@/components/orders/bom-queue";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdByFacet, createdDateFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { TypeOrPick } from "@/app/(app)/orders/_garment-order/type-or-pick";
import { fmtDate } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { useAccordion } from "@/lib/ui/use-accordion";
import { focusFirstField } from "@/lib/focus";
import { sectionValidity, type Problem } from "@/lib/screens/validity";
import { isInactive } from "@/lib/masters/inactive";
import type { StatusTone } from "@/lib/ui/tone";
import type { ApprovalRun, CanActVerdict } from "@/lib/approvals/types";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import type { SampleCostingFormData, CostingStyleOption } from "@/lib/sales/sample-costing/service";
import {
  MARGIN_FLOOR_PCT,
  componentCost,
  dimensionalGrams,
  fabricPricePerKg,
  fabricSubtotal,
  hasYarnMix,
  marginHealth,
  num,
  processTotal,
  quoteKey,
  yarnMixTotal,
  yarnRateOf,
  type CostingSummary,
  type MarginHealth,
} from "@/lib/sales/sample-costing/calc";
import {
  SHIP_MODES,
  STATUS_LABEL,
  costingFieldId,
  costingProblems,
  floorSentence,
  isBlankFabric,
  isBlankTrim,
  isEditableStatus,
  liveRows,
  revisionLabel,
  revisionShort,
  summaryOf,
  type CostingDraft,
  type CostingHeaderDraft,
  type CostingListRow,
  type CostingProblem,
  type CostingSection,
  type CostingStatus,
  type FabricDraft,
  type FabricProcessDraft,
  type PieceDraft,
  type RevisionRow,
  type TrimDraft,
  type WeightDraft,
  type YarnMixDraft,
} from "@/lib/sales/sample-costing/types";
import {
  deleteSampleCosting,
  fetchQuoteRate,
  getCostingApproval,
  loadSampleCosting,
  previewCostingNo,
  saveSampleCosting,
  submitSampleCosting,
} from "@/lib/sales/sample-costing/actions";
import { exportCostSheetPdf, exportQuotationPdf } from "@/lib/sales/sample-costing/quotation-export";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Costing Details is TWO DELIBERATE ROWS (screenshot 3360: the five fields on
 * one row wrapped Revision alone onto a second line at 1366):
 *   the document  — Costing No (~120, content-sized) · Date code 144 · Revision term 176
 *   what it costs — Sample No name 288 · Style name 288 = 576 + 12 = 588
 * → 37rem (592) cap, well inside the 818px canvas.
 */
const DETAILS_W = "max-w-[37rem]";
/**
 * Overheads & Commercial — every label on ONE line (screenshot 3361:
 * "Insurance / pc ₹" and "Bank Charges ₹" wrapped at `hug` and dropped their
 * boxes out of line). Wastage / Discount `hug` 88 ×2 · Ship Mode code 144 ·
 * Freight / Insurance / Bank range 112 ×3 = 656 + 5 × 12 = 716 → 45rem (720),
 * inside the 818px canvas. A SET's extra bank boxes wrap onto a second row.
 */
const TERMS_W = "max-w-[45rem]";

/** The spec's default Wastage Allowance on a new component line (§4.3). */
const DEFAULT_ALLOWANCE = "3";

/** The DOM id a canvas card is scrolled to. */
const cardAnchor = (k: CostingSection) => `sc-card-${k}`;

/**
 * The canvas cards, in calculation order — the anchor nav reads this.
 *
 * `nav` is the anchor's SHORT word. The nav is a 10rem column (the canvas
 * cannot spare more at 1366), and "Overheads & Commercial" at 12px plus its
 * number and a problem count is ~210px — it was the label that stretched the
 * whole column (screenshot 3360, 2026-10-07). The card keeps its full title.
 */
const CARD_ORDER: { key: CostingSection; label: string; nav: string; icon: FullScreenSection["icon"] }[] = [
  { key: "info", label: "Costing Details", nav: "Details", icon: Calculator },
  { key: "fabrics", label: "Fabric Rates", nav: "Fabric Rates", icon: Palette },
  { key: "consumption", label: "Consumption & Component Weights", nav: "Consumption", icon: Layers },
  { key: "cmt", label: "CMT & Garment Processing", nav: "CMT & Process", icon: Scissors },
  { key: "trims", label: "Trims & Accessories", nav: "Trims", icon: Tag },
  { key: "quotation", label: "Overheads & Commercial", nav: "Commercial", icon: Wallet },
];

const STATUS_TONE: Record<CostingStatus, StatusTone> = {
  draft: "neutral",
  submitted: "warning",
  approved: "success",
  rejected: "danger",
  superseded: "neutral",
};

/** Margin health → the app's own status tones (spec §4.5). */
const HEALTH: Record<MarginHealth, { tone: StatusTone; text: string; label: string }> = {
  good: { tone: "success", text: "text-success", label: "Healthy" },
  tight: { tone: "warning", text: "text-warning", label: "Tight — MD approval" },
  poor: { tone: "danger", text: "text-danger", label: "Below cost target — MD approval" },
};

/** The Pending · Updated · Draft box: a saved sheet is pending until it is
 *  approved (on submit or by the MD), which moves it to Updated. */
const costingWordOf = (r: CostingListRow): QuickWord =>
  r.is_draft ? "draft" : r.status === "approved" ? "updated" : "pending";
const QUICK_LABEL: Record<QuickWord, string> = { pending: "Pending", updated: "Updated", draft: "Draft" };

const COSTING_FACETS: FacetGroup<CostingListRow>[] = [
  {
    title: "Status & dates",
    icon: <CalendarRange />,
    facets: [
      {
        key: "approval",
        label: "Approval",
        all: "All",
        counted: true,
        options: (["draft", "submitted", "approved", "rejected"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] })),
        match: (r, v) => r.status === v,
      },
      { key: "date", label: "Costing Date", all: "Any date", date: (r) => r.costing_date },
    ],
  },
  { title: "Created", icon: <Users />, facets: [createdDateFacet(), createdByFacet()] },
];

const blankHeader = (): CostingHeaderDraft => ({
  opportunity_id: null,
  style_id: null,
  costing_date: today(),
  currency_code: null,
  exchange_rate: "",
  margin_pct: "",
  garment_waste_pct: "",
  overhead_pct: "",
  discount_pct: "",
  ship_mode: "",
  freight_per_pc: "",
  insurance_per_pc: "",
  notes: "",
});

/** Money in Indian grouping at a fixed precision (spec §2.2: rates 2 dp,
 *  foreign quotes 2 or 4 dp). A missing figure is a dash, never a zero. */
const money = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);

/**
 * A NUMBER BOX AS THE SPEC ASKS (§6): `inputMode="decimal"` for the phone
 * keypad, and the whole value selected on focus so a typed figure REPLACES the
 * old one — the spreadsheet habit. Focus behaviour only; no key is bound here.
 */
function NumInput(props: React.ComponentProps<typeof Input>) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      {...props}
      className={`text-right tabular-nums ${props.className ?? ""}`}
      onFocus={(e) => {
        e.currentTarget.select();
        props.onFocus?.(e);
      }}
    />
  );
}

/**
 * A COMPUTED FIGURE THAT FLASHES WHEN IT CHANGES (spec §5.2 "Live Calculation
 * Pulse"). Re-keyed on its own text, so React mounts a fresh span and the
 * `recalc-flash` animation (globals.css) runs once; reduced-motion users get
 * the global clamp. `formula` is the tooltip the spec's checklist asks for.
 */
function Flash({
  value,
  formula,
  className = "",
}: {
  value: string;
  formula?: string;
  className?: string;
}) {
  const span = (
    <span key={value} className={`inline-block rounded px-1 tabular-nums motion-safe:animate-recalc ${className}`}>
      {value}
    </span>
  );
  return formula ? (
    <Tooltip label={formula} className="inline-flex justify-end">
      {span}
    </Tooltip>
  ) : (
    span
  );
}

/** A right-aligned computed cell. */
function Figure({ value, dp = 2, formula }: { value: number | null | undefined; dp?: number; formula?: string }) {
  return (
    <span className={`block text-right text-sm ${value == null ? "text-muted-foreground" : "text-foreground"}`}>
      <Flash value={money(value, dp)} formula={formula} />
    </span>
  );
}

/** Δ as the spec's badge: "+0.03 / +0.9%". Green over, red under. */
function DeltaBadge({ delta, pctValue }: { delta: number | null; pctValue: number | null }) {
  if (delta == null) return <span className="text-xs text-muted-foreground">—</span>;
  const tone = delta > 0.00005 ? "text-success" : delta < -0.00005 ? "text-danger" : "text-muted-foreground";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={`text-xs font-medium tabular-nums ${tone}`}>
      {`${sign}${delta.toFixed(4)}`}
      {pctValue != null ? ` / ${sign}${pctValue.toFixed(1)}%` : ""}
    </span>
  );
}

export function SampleCostingScreen({
  rows,
  data,
  perms,
  nextCostingNo,
  letterhead,
}: {
  rows: CostingListRow[];
  data: SampleCostingFormData;
  perms: Perms;
  /** Fetched with the page so a new sheet's Costing No is filled on first paint. */
  nextCostingNo: string | null;
  letterhead: DocLetterhead;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    code: string | null;
    version: number;
    status: CostingStatus;
    isDraft: boolean;
    decisionRemark: string | null;
  }>({ code: null, version: 1, status: "draft", isDraft: false, decisionRemark: null });
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  /** Set while the editor holds the NEXT revision of this sheet (not yet saved). */
  const [revisingFrom, setRevisingFrom] = useState<string | null>(null);
  const [header, setHeader] = useState<CostingHeaderDraft>(blankHeader);
  const [pieces, setPieces] = useState<PieceDraft[]>([]);
  const [fabrics, setFabrics] = useState<FabricDraft[]>([]);
  const [weights, setWeights] = useState<WeightDraft[]>([]);
  const [trims, setTrims] = useState<TrimDraft[]>([]);
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(nextCostingNo);
  const [approval, setApproval] = useState<{ forId: string; run: ApprovalRun | null; verdict: CanActVerdict | null } | null>(null);
  /** A Save was attempted — a row's messages show from then on. */
  const [tried, setTried] = useState(false);
  /** Which size group the rail shows when the sheet costs more than one. */
  const [railGroup, setRailGroup] = useState<string>("all");

  /**
   * Real edits, never "is the editor open" — what stands between Escape and a
   * silently discarded sheet, and what holds off the silent auto-reload.
   */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `n${keySeq.current++}`;

  /**
   * FABRIC CARDS ARE AN ACCORDION (spec §4.2 "Smart Accordion Cards";
   * AGENTS.md "Folds are accordions"): one open at a time, and tabbing into a
   * card opens it. The header line — quality, Direct, Price / KG — is always
   * visible, so a folded card still says what the fabric costs.
   */
  const fab = useAccordion(null);

  // ---- the L × W × GSM sub-sheet (one component line) ------------------------
  const [dimsFor, setDimsFor] = useState<string | null>(null);
  const [dimsOrigin, captureDimsOrigin] = useSubSheetOrigin();

  // ---- the canvas anchor nav ---------------------------------------------------
  const [activeCard, setActiveCard] = useState<CostingSection>("info");
  const scrollToCard = (k: CostingSection, land = false) => {
    setActiveCard(k);
    const el = document.getElementById(cardAnchor(k));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    // From the nav: the cursor follows the eye into the card's first field.
    if (land && el) focusFirstField(el);
  };
  /*
   * SCROLL-SPY: the card crossing the upper third of the viewport is the one
   * the nav lights. `root: null` (the viewport) works whatever element really
   * scrolls — a page mount scrolls <main>, not the window. Re-armed when a
   * different sheet opens, since its cards are re-mounted.
   */
  useEffect(() => {
    if (mode !== "edit") return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-card]"));
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
        const k = hit?.target.getAttribute("data-card") as CostingSection | null;
        if (k) setActiveCard(k);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [mode, editId, revisingFrom]);

  // ---- the list's filters ----------------------------------------------------
  const [query, setQuery] = useState("");
  /** A superseded revision lives behind its successor's Revision picker. */
  const current = useMemo(() => rows.filter((r) => r.status !== "superseded"), [rows]);
  const facets = useFacetFilter(current, COSTING_FACETS);
  const facetMatches = facets.matches;
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return current.filter((r) => {
      if (!facetMatches(r)) return false;
      if (!needle) return true;
      return [r.code, r.enquiry_no, r.sample_no, r.customer_name, r.style_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [current, query, facetMatches]);
  const quick = useQuickStatus(costingWordOf, { countRows: searched });
  const filtered = searched.filter(quick.matches);

  // ---- derived state (cheap passes over the sheet's own rows) ---------------
  const draft: CostingDraft = { header, pieces, fabrics, weights, trims, quotes };
  const summary: CostingSummary = summaryOf(draft);
  const live = liveRows(draft);
  const multiPiece = pieces.length > 1;
  const editable = isEditableStatus(meta.status) || !!revisingFrom;
  const enquiry = data.enquiries.find((e) => e.id === header.opportunity_id) ?? null;
  const style: CostingStyleOption | null = data.styles.find((s) => s.id === header.style_id) ?? null;
  const enquiryStyles = data.styles.filter((s) => s.opportunity_id === header.opportunity_id);
  const isSet = style?.unit_kind === "set" || multiPiece;
  const ccy = header.currency_code;
  const pieceName = (key: string) => pieces.find((p) => p.key === key)?.piece_name || "GARMENT";
  const groupName = (id: string | null) =>
    id ? (data.sizeGroups.find((g) => g.id === id)?.name ?? "Size group") : "All sizes";
  const fabricLabel = (f: FabricDraft, i: number) =>
    f.quality.trim() || data.fabrics.find((x) => x.id === f.fabric_id)?.name || `Fabric ${i + 1}`;
  const componentName = (id: string | null) => data.components.find((c) => c.id === id)?.name ?? "";

  // ---- mutation helpers -------------------------------------------------------
  const setH = (patch: Partial<CostingHeaderDraft>) => {
    setHeader((h) => ({ ...h, ...patch }));
    setDirty(true);
  };
  const mut = <T,>(set: (fn: (xs: T[]) => T[]) => void) => (fn: (xs: T[]) => T[]) => {
    set(fn);
    setDirty(true);
  };
  const mutPieces = mut<PieceDraft>(setPieces);
  const mutFabrics = mut<FabricDraft>(setFabrics);
  const mutWeights = mut<WeightDraft>(setWeights);
  const mutTrims = mut<TrimDraft>(setTrims);
  const patchPiece = (key: string, patch: Partial<PieceDraft>) =>
    mutPieces((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const patchFabric = (key: string, patch: Partial<FabricDraft>) =>
    mutFabrics((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const patchWeight = (key: string, patch: Partial<WeightDraft>) =>
    mutWeights((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const patchTrim = (key: string, patch: Partial<TrimDraft>) =>
    mutTrims((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  // ---- factories — every key a factory stamps is blank, except a row's piece
  // and the spec's 3 % allowance, neither of which `isBlank*` reads (AGENTS.md
  // "THE SEEDED ROW IS SAVED UNLESS THE SAVE SIDE DROPS IT"). ---------------
  const blankPiece = (name: string, coordinateId: string | null): PieceDraft => ({
    key: newKey(),
    piece_name: name,
    coordinate_id: coordinateId,
    cmt: "",
    print_cost: "",
    embroidery_cost: "",
    wash_cost: "",
    testing_cost: "",
    bank_cost: "",
  });
  const blankYarn = (): YarnMixDraft => ({ key: newKey(), item_id: null, yarn_name: "", mix_pct: "", rate: "" });
  const blankProcess = (): FabricProcessDraft => ({ key: newKey(), process_id: null, process_name: "", rate: "" });
  const blankFabric = (): FabricDraft => ({
    key: newKey(),
    fabric_id: null,
    quality: "",
    yarn_rate: "",
    // Both nested grids open with a row ready (AGENTS.md "Editable sub-tables
    // open with a row"); a blank one is dropped by `isBlankYarn` / `isBlankProcess`.
    yarns: [blankYarn()],
    knitting_rate: "",
    dyeing_rate: "",
    finishing_rate: "",
    process_loss_pct: "",
    is_direct: false,
    direct_rate: "",
    processes: [blankProcess()],
  });
  const blankWeight = (pieceKey: string): WeightDraft => ({
    key: newKey(),
    piece_key: pieceKey,
    fabric_key: null,
    component_id: null,
    size_group_id: null,
    weight_g: "",
    length_cm: "",
    width_cm: "",
    gsm: "",
    wastage_pct: DEFAULT_ALLOWANCE,
  });
  const blankTrim = (pieceKey: string): TrimDraft => ({
    key: newKey(),
    piece_key: pieceKey,
    item_id: null,
    description: "",
    qty: "",
    rate: "",
  });

  /**
   * THE PIECES ARE THE STYLE LINE'S COORDINATES (Sample Entry, 0683): a SET's
   * Top and Pants each get their own costing; a PCS line is one piece.
   * Re-picking the style keeps the figures of a piece whose name survives, and
   * moves the lines of a piece that vanished onto the first piece rather than
   * dropping what the operator typed.
   */
  function piecesFor(st: CostingStyleOption | null, prev: PieceDraft[]): PieceDraft[] {
    const coords = st?.coordinates.length
      ? st.unit_kind === "set"
        ? st.coordinates
        : st.coordinates.slice(0, 1)
      : [{ id: null, name: "GARMENT" }];
    return coords.map((c, i) => {
      const same =
        prev.find((p) => p.piece_name === c.name) ?? (i === 0 && prev.length === 1 ? prev[0] : undefined);
      return same ? { ...same, piece_name: c.name, coordinate_id: c.id } : blankPiece(c.name, c.id);
    });
  }
  function applyStyle(st: CostingStyleOption | null) {
    const next = piecesFor(st, pieces);
    const keep = new Set(next.map((p) => p.key));
    const first = next[0].key;
    setPieces(next);
    setWeights((xs) => xs.map((w) => (keep.has(w.piece_key) ? w : { ...w, piece_key: first })));
    setTrims((xs) => xs.map((t) => (keep.has(t.piece_key) ? t : { ...t, piece_key: first })));
    setDirty(true);
  }

  // ---- open / close -----------------------------------------------------------
  function seedAndOpen(d: CostingDraft) {
    const firstPiece = d.pieces[0]?.key ?? "";
    const seededFabrics = (d.fabrics.length ? d.fabrics : [blankFabric()]).map((f) => ({
      ...f,
      yarns: f.yarns.length ? f.yarns : [blankYarn()],
      processes: f.processes.length ? f.processes : [blankProcess()],
    }));
    setHeader(d.header);
    setPieces(d.pieces);
    // Seeded in STATE before `setDirty(false)`, never by a grid's `seedRow`,
    // which would mark an untouched sheet "Unsaved".
    setFabrics(seededFabrics);
    setWeights(d.weights.length ? d.weights : [blankWeight(firstPiece)]);
    setTrims(d.trims.length ? d.trims : [blankTrim(firstPiece)]);
    setQuotes(d.quotes);
    fab.setOpenKey(seededFabrics[0]?.key ?? null);
    setRailGroup("all");
    setActiveCard("info");
    setTried(false);
    setDirty(false);
    setMode("edit");
  }

  function openAdd() {
    setEditId(null);
    setRevisingFrom(null);
    setRevisions([]);
    setApproval(null);
    setMeta({ code: null, version: 1, status: "draft", isDraft: false, decisionRemark: null });
    setPreview(nextCostingNo);
    seedAndOpen({ header: blankHeader(), pieces: [blankPiece("GARMENT", null)], fabrics: [], weights: [], trims: [], quotes: {} });
  }
  useCreateIntent(() => {
    if (perms.canCreate) openAdd();
  });

  function openById(id: string) {
    start(async () => {
      const res = await loadSampleCosting(id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const r = res.record;
      setEditId(r.id);
      setRevisingFrom(null);
      setRevisions(res.revisions);
      setMeta({ code: r.code, version: r.version, status: r.status, isDraft: r.is_draft, decisionRemark: r.decision_remark });
      seedAndOpen({ ...r.draft, pieces: r.draft.pieces.length ? r.draft.pieces : [blankPiece("GARMENT", null)] });
      setApproval(null);
      if (r.status === "submitted") {
        const panel = await getCostingApproval(r.id);
        setApproval({ forId: r.id, run: panel.run, verdict: panel.verdict });
      }
    });
  }
  // `?open=<id>` — the approvals inbox's row link (WORKFLOWS.sample_costing).
  useOpenIntent((id) => openById(id));

  function closeEditor() {
    setMode("list");
    setDirty(false);
    setDimsFor(null);
  }

  /**
   * REVISE (costing spec §2 "Version / Revision": negotiation history). The
   * editor keeps every figure and becomes the NEXT revision — unsaved until
   * Save, which writes version + 1 under the same Costing No and supersedes
   * this one in the same transaction (0688).
   */
  function revise() {
    if (!editId) return;
    setRevisingFrom(editId);
    setMeta((m) => ({ ...m, version: m.version + 1, status: "draft", isDraft: false, decisionRemark: null }));
    setApproval(null);
    setDirty(true);
  }

  // ---- validity ---------------------------------------------------------------
  const problems = costingProblems(draft);
  const asProblem = (p: CostingProblem): Problem => ({
    // ONE section: the canvas holds every card.
    section: "costing",
    fieldId: p.fieldId,
    label: p.label,
    message: p.message,
    kind: "custom",
  });
  const validity = sectionValidity({
    sections: [{ key: "costing" }],
    values: header,
    // Every rule is in `costingProblems`, which the server action re-runs.
    fields: [],
    extra: problems.map(asProblem),
  });
  const countFor = (k: CostingSection) => problems.filter((p) => p.section === k).length;
  const reveal = (p: CostingProblem | undefined) => {
    if (!p) return;
    toastError(p.message);
    // A field inside a folded fabric card has no DOM node — open it first.
    const fabricKey = fabrics.find((f) => p.fieldId?.endsWith(f.key))?.key;
    if (fabricKey) fab.claim(fabricKey);
    if (p.fieldId) {
      const id = p.fieldId;
      // After the fold opens (next frame), land on the field itself.
      requestAnimationFrame(() => shellRef.current?.goToSection("costing", { fieldId: id }));
    } else {
      scrollToCard(p.section);
    }
  };
  const revealFirstProblem = () => {
    setTried(true);
    reveal(problems[0]);
  };
  /** A row's message, once a Save was attempted. */
  const msgFor = (fieldId: string) => (tried ? (problems.find((p) => p.fieldId === fieldId)?.message ?? null) : null);

  function submit(asDraft: boolean) {
    if (asDraft) {
      const structural = costingProblems(draft, { draft: true });
      if (structural.length) {
        reveal(structural[0]);
        return;
      }
    } else if (!validity.canSave) {
      revealFirstProblem();
      return;
    }
    start(async () => {
      const res = await saveSampleCosting(revisingFrom ? null : editId, draft, { isDraft: asDraft, parentId: revisingFrom });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(
        asDraft
          ? `Draft saved — ${res.code ?? ""}`
          : revisingFrom
            ? `${revisionShort(res.version)} saved — ${res.code ?? ""}`
            : editId
              ? "Costing updated"
              : `Costing created — ${res.code ?? ""}`,
      );
      router.refresh();
      // Re-open what was written: the stored rows get their ids back, and a
      // Submit right after Save reads exactly what the server holds.
      openById(res.id);
    });
  }

  function sendForApproval() {
    if (!editId) return;
    if (dirty) {
      toastError("Save the costing before submitting it.");
      return;
    }
    start(async () => {
      const res = await submitSampleCosting(editId);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      success(
        res.outcome === "approved"
          ? `Approved — every quote earns at least ${MARGIN_FLOOR_PCT}%.`
          : `Sent to the MD — the lowest margin is ${res.lowest?.toFixed(1) ?? "—"}%, under ${MARGIN_FLOOR_PCT}%.`,
      );
      router.refresh();
      openById(editId);
    });
  }

  function fetchRate() {
    if (!header.currency_code) {
      toastError("Choose the currency first.");
      return;
    }
    const code = header.currency_code;
    start(async () => {
      const res = await fetchQuoteRate(code, header.costing_date || null);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setH({ exchange_rate: String(res.rate) });
      success(`${code} rate ${res.rate} from the Quotes / Orders register${res.effectiveFrom ? `, effective ${fmtDate(res.effectiveFrom)}` : ""}.`);
    });
  }

  function del(r: CostingListRow) {
    start(async () => {
      const res = await deleteSampleCosting(r.id);
      if (res.ok) {
        success("Costing deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- PDFs: the buyer's quotation (prices only) and the internal cost sheet ----
  const pdfBase = () => ({
    costingNo: meta.code ?? preview,
    revision: revisionShort(meta.version),
    date: header.costing_date || null,
    customer: enquiry?.customer_name ?? null,
    enquiryNo: enquiry?.code ?? null,
    sampleNo: style?.sample_no ?? null,
    style: style?.name ?? null,
    description: style?.description ?? null,
    season: [enquiry?.season, enquiry?.season_year].filter(Boolean).join(" ") || null,
    currency: ccy,
    shipMode: SHIP_MODES.find((m) => m.value === header.ship_mode)?.label ?? null,
    isSet,
    pieceName,
    groupName,
    summary,
    approved: meta.status === "approved",
  });
  const pdfFailed = (e: unknown) => toastError(e instanceof Error ? e.message : "Could not build the PDF.");
  function downloadQuotation() {
    void exportQuotationPdf(pdfBase(), letterhead).catch(pdfFailed);
  }
  function downloadCostSheet() {
    const f2 = (v: string) => (num(v) == null ? "" : money(num(v)));
    void exportCostSheetPdf(
      {
        ...pdfBase(),
        fabrics: live.fabrics.map((f, i) => ({
          name: fabricLabel(f, i),
          yarn: f.is_direct ? "" : money(yarnRateOf(f)),
          knit: f.is_direct ? "" : f2(f.knitting_rate),
          dye: f.is_direct ? "" : f2(f.dyeing_rate),
          fin: f.is_direct ? "" : f2(f.finishing_rate),
          proc: f.is_direct ? "" : money(processTotal(f)),
          loss: f.is_direct ? "Direct" : f.process_loss_pct ? `${f.process_loss_pct}%` : "",
          price: money(fabricPricePerKg(f)),
        })),
        weights: live.weights.map((w) => ({
          piece: pieceName(w.piece_key),
          component: componentName(w.component_id),
          fabric: (() => {
            const i = live.fabrics.findIndex((f) => f.key === w.fabric_key);
            return i >= 0 ? fabricLabel(live.fabrics[i], i) : "";
          })(),
          group: groupName(w.size_group_id),
          grams: money(dimensionalGrams(w) ?? num(w.weight_g), 1),
          allowance: w.wastage_pct ? `${w.wastage_pct}%` : "",
          cost: money(componentCost(w, live.fabrics)),
        })),
        labour: pieces.map((p) => ({
          piece: p.piece_name,
          cmt: f2(p.cmt),
          print: f2(p.print_cost),
          emb: f2(p.embroidery_cost),
          wash: f2(p.wash_cost),
          testing: f2(p.testing_cost),
          bank: f2(p.bank_cost),
        })),
        trims: live.trims.map((t) => ({
          piece: pieceName(t.piece_key),
          name: t.description || data.trims.find((x) => x.id === t.item_id)?.name || "",
          qty: t.qty,
          rate: f2(t.rate),
          amount: money((num(t.qty) ?? 0) * (num(t.rate) ?? 0)),
        })),
        terms: [
          { label: "Margin", value: header.margin_pct ? `${header.margin_pct}%` : "—" },
          { label: "Wastage", value: header.garment_waste_pct ? `${header.garment_waste_pct}%` : "—" },
          { label: "Overhead", value: header.overhead_pct ? `${header.overhead_pct}%` : "—" },
          { label: "Discount", value: header.discount_pct ? `${header.discount_pct}%` : "—" },
          { label: "Exchange rate", value: header.exchange_rate || "—" },
        ],
      },
      letterhead,
    ).catch(pdfFailed);
  }

  // ---- the list -----------------------------------------------------------------
  const lockReason = (r: CostingListRow) =>
    isEditableStatus(r.status) ? null : `${STATUS_LABEL[r.status]} — open it to view or revise.`;
  const listColumns: Column<CostingListRow>[] = [
    {
      header: "Costing No",
      cell: (r) => (
        <button type="button" onClick={() => openById(r.id)} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code ?? "—"}
        </button>
      ),
    },
    { header: "Rev", cell: (r) => <span className="tabular-nums text-xs">{revisionShort(r.version)}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.costing_date)}</span> },
    { header: "Sample No", cell: (r) => <span className="font-mono text-xs">{r.enquiry_no ?? "—"}</span> },
    { header: "Customer", cell: (r) => <span className="text-xs">{r.customer_name ?? "—"}</span> },
    {
      header: "Style",
      cell: (r) => <span className="text-xs">{[r.sample_no, r.style_name].filter(Boolean).join(" · ") || "—"}</span>,
    },
    {
      header: "Quoted",
      align: "right",
      cell: (r) => (
        <span className="block text-right font-mono tabular-nums text-xs">
          {r.target_fob != null ? `${r.currency_code ?? ""} ${money(r.target_fob)}` : "—"}
        </span>
      ),
    },
    {
      header: "Margin",
      align: "right",
      cell: (r) => {
        const h = marginHealth(r.profit_loss_pct);
        return (
          <span className={`block text-right font-mono tabular-nums text-xs ${h ? HEALTH[h].text : ""}`}>
            {r.profit_loss_pct != null ? `${r.profit_loss_pct.toFixed(1)}%` : "—"}
          </span>
        );
      },
    },
    {
      header: "Approval",
      cell: (r) =>
        r.is_draft ? (
          <span className="text-xs text-muted-foreground">Draft</span>
        ) : (
          <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
        ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.code}
        view={false}
        onEdit={() => openById(r.id)}
        canEdit={perms.canEdit}
        editDisabledReason={lockReason(r)}
        onDelete={() => del(r)}
        canDelete={perms.canDelete}
        deleteDisabledReason={lockReason(r)}
        isPending={isPending}
      />
    )),
  ];

  // ==========================================================================
  // CARD 2 — FABRIC RATES (spec §4.2): an accordion card per fabric
  // ==========================================================================
  /*
   * The fabric's HEADER LINE, always visible: Fabric Quality party 200 ·
   * Direct num 72 · Price / KG code 144 = 416 + gaps. Declared as columns so
   * the stars, the holds and the card read ONE declaration (`listRows`: the row
   * draws its own chrome, so `Field required` is the only place a column's
   * `required` reaches its control).
   */
  const costingFabricColumns: ChildGridColumn<FabricDraft>[] = [
    {
      header: "Fabric Quality",
      required: true,
      width: FIELD_WIDTH_CSS.party,
      cell: (r) => (
        <TypeOrPick
          label="Fabric Quality"
          id={costingFieldId.fabric(r.key)}
          options={data.fabrics.filter((f) => !isInactive(f) || f.id === r.fabric_id).map((f) => ({ id: f.id, name: f.name }))}
          valueId={r.fabric_id}
          text={r.quality || (data.fabrics.find((f) => f.id === r.fabric_id)?.name ?? "")}
          onChange={(v) => patchFabric(r.key, { fabric_id: v.id, quality: v.name })}
          placeholder=""
          uppercase
        />
      ),
    },
    {
      header: "Direct Rate",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => (
        <div className="flex h-9 items-center">
        <Toggle
          ariaLabel="Direct rate mode — one flat price per KG"
          checked={r.is_direct}
          onChange={(v) => {
            patchFabric(r.key, { is_direct: v });
            if (!v) fab.claim(r.key);
          }}
        />
        </div>
      ),
    },
    {
      header: "Price / KG ₹",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) =>
        r.is_direct ? (
          // DIRECT RATE MODE (spec §4.2): the whole derivation collapses into
          // this ONE box — "a flat rate in 2 seconds".
          <NumInput
            id={costingFieldId.fabricDirect(r.key)}
            aria-label="Flat fabric price per KG"
            className="font-semibold"
            value={r.direct_rate}
            onChange={(e) => patchFabric(r.key, { direct_rate: e.target.value })}
          />
        ) : (
          <span className="flex h-9 items-center justify-end rounded-md bg-info-soft px-2 text-base font-semibold text-info">
            <Flash
              value={money(fabricPricePerKg(r))}
              formula={`(Yarn ${money(yarnRateOf(r))} + Knit + Dye + Finishing + Special ${money(processTotal(r))} = ${money(fabricSubtotal(r))}) × (1 + ${r.process_loss_pct || 0}% loss)`}
            />
          </span>
        ),
    },
  ];

  /** The derivation row under an open card: Yarn / Knitting / Dyeing /
   *  Finishing hug 88 ×4 + Loss % num 72 = 424 + gaps. */
  const rateField = (r: FabricDraft, k: "knitting_rate" | "dyeing_rate" | "finishing_rate", label: string) => (
    <Field label={label} w="hug">
      <NumInput aria-label={label} value={r[k]} onChange={(e) => patchFabric(r.key, { [k]: e.target.value })} />
    </Field>
  );

  /** Yarn Mix (spec §4.2 "Material %, Yarn Rate/kg, Weighted Cost"): Yarn term
   *  176 · Mix % num 72 · Rate / KG hug 88 · Weighted hug 88 = 424 + 72 = 496. */
  const mixRows = (f: FabricDraft) => f.yarns;
  const setMix = (f: FabricDraft, fn: (xs: YarnMixDraft[]) => YarnMixDraft[]) => patchFabric(f.key, { yarns: fn(f.yarns) });
  const costingYarnColumns = (f: FabricDraft): ChildGridColumn<YarnMixDraft>[] => [
    {
      header: "Yarn",
      width: FIELD_WIDTH_CSS.term,
      cell: (y) => (
        <TypeOrPick
          label="Yarn"
          options={data.yarns.filter((x) => !isInactive(x) || x.id === y.item_id).map((x) => ({ id: x.id, name: x.name }))}
          valueId={y.item_id}
          text={y.yarn_name || (data.yarns.find((x) => x.id === y.item_id)?.name ?? "")}
          onChange={(v) => setMix(f, (xs) => xs.map((x) => (x.key === y.key ? { ...x, item_id: v.id, yarn_name: v.name } : x)))}
          placeholder=""
          uppercase
        />
      ),
    },
    {
      header: "Mix %",
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      total: { kind: "derived", value: () => pct(yarnMixTotal(f)) },
      cell: (y) => (
        <NumInput
          aria-label="Mix percent"
          value={y.mix_pct}
          onChange={(e) => setMix(f, (xs) => xs.map((x) => (x.key === y.key ? { ...x, mix_pct: e.target.value } : x)))}
        />
      ),
    },
    {
      header: "Rate / KG",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (y) => (
        <NumInput
          aria-label="Yarn rate per KG"
          value={y.rate}
          onChange={(e) => setMix(f, (xs) => xs.map((x) => (x.key === y.key ? { ...x, rate: e.target.value } : x)))}
        />
      ),
    },
    {
      header: "Weighted",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      total: { kind: "derived", value: () => money(yarnRateOf(f)) },
      cell: (y) => <Figure value={num(y.mix_pct) != null ? ((num(y.mix_pct) ?? 0) * (num(y.rate) ?? 0)) / 100 : null} formula="Mix % × Rate ÷ 100" />,
    },
  ];

  /** Special Processing (costing spec §3.1 — Stentering, Brushing, Sueding …):
   *  Process term 176 · Rate / KG hug 88 = 264 + 72 = 336. */
  const setProc = (f: FabricDraft, fn: (xs: FabricProcessDraft[]) => FabricProcessDraft[]) =>
    patchFabric(f.key, { processes: fn(f.processes) });
  const costingProcessColumns = (f: FabricDraft): ChildGridColumn<FabricProcessDraft>[] => [
    {
      header: "Special Process",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <TypeOrPick
          label="Special process"
          options={data.processes.filter((p) => !isInactive(p) || p.id === r.process_id).map((p) => ({ id: p.id, name: p.name }))}
          valueId={r.process_id}
          text={r.process_name}
          onChange={(v) => setProc(f, (xs) => xs.map((x) => (x.key === r.key ? { ...x, process_id: v.id, process_name: v.name } : x)))}
          placeholder=""
          uppercase
        />
      ),
    },
    {
      header: "Rate / KG",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      total: { kind: "derived", value: () => money(processTotal(f)) },
      cell: (r) => (
        <NumInput
          aria-label="Process rate per KG"
          value={r.rate}
          onChange={(e) => setProc(f, (xs) => xs.map((x) => (x.key === r.key ? { ...x, rate: e.target.value } : x)))}
        />
      ),
    },
  ];

  /** A folded card says what it holds in one line. */
  const fabricSummary = (f: FabricDraft) =>
    f.is_direct
      ? "Direct rate"
      : [
          `Yarn ${money(yarnRateOf(f))}${hasYarnMix(f) ? " (mix)" : ""}`,
          f.knitting_rate && `Knit ${f.knitting_rate}`,
          f.dyeing_rate && `Dye ${f.dyeing_rate}`,
          f.finishing_rate && `Fin ${f.finishing_rate}`,
          processTotal(f) ? `Special ${money(processTotal(f))}` : "",
          f.process_loss_pct && `Loss ${f.process_loss_pct}%`,
        ]
          .filter(Boolean)
          .join(" · ");

  const fabricCard = (f: FabricDraft, i: number) => {
    const bodyProblem = tried && problems.some((p) => p.fieldId === costingFieldId.fabricRate(f.key) || p.fieldId === costingFieldId.yarnMix(f.key));
    // A body field the record needs is never hidden behind the fold.
    const open = !f.is_direct && (fab.isOpen(f.key) || bodyProblem);
    const mix = hasYarnMix(f);
    return (
      <div {...fab.focusProps(f.key)} className="relative space-y-3 pr-8 max-sm:pr-0">
        {fabrics.length > 1 && <RowRemoveChip label="Remove fabric" onClick={() => mutFabrics((xs) => xs.filter((x) => x.key !== f.key))} />}
        {/* `align="start"`: every label on ONE line across the row, and every
            control is h-9 underneath it — the Toggle and the Price / KG figure
            are centred in an h-9 box so they sit on the inputs' line rather
            than bottom-aligned 4px low (screenshot 3360). */}
        <FieldRow gap="row" align="start">
          {costingFabricColumns.map((c) => (
            <Field key={c.header} label={c.header} required={c.required} w={fieldWidthStep(c.width) ?? "code"}>
              {c.cell(f, i)}
            </Field>
          ))}
          {!f.is_direct ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => fab.toggle(f.key)}
              className="inline-flex h-9 items-center gap-1 self-end text-xs font-medium text-primary hover:underline"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
              {open ? "Hide breakdown" : "Breakdown"}
            </button>
          ) : null}
        </FieldRow>
        <FieldError>{msgFor(costingFieldId.fabric(f.key)) ?? (f.is_direct ? msgFor(costingFieldId.fabricDirect(f.key)) : null)}</FieldError>

        {open ? (
          <div className="space-y-4 border-l-2 border-primary/30 pl-4">
            <FieldRow gap="row" align="start">
              <Field label="Yarn / KG" w="hug" htmlFor={costingFieldId.fabricRate(f.key)}>
                {mix ? (
                  // With a mix, the yarn rate IS the weighted sum — shown, not typed.
                  <span className="flex h-9 items-center justify-end rounded-md bg-info-soft px-2 text-sm font-medium text-info">
                    <Flash value={money(yarnRateOf(f))} formula="Σ Mix % × Rate ÷ 100" />
                  </span>
                ) : (
                  <NumInput
                    id={costingFieldId.fabricRate(f.key)}
                    aria-label="Yarn rate per KG"
                    value={f.yarn_rate}
                    onChange={(e) => patchFabric(f.key, { yarn_rate: e.target.value })}
                  />
                )}
              </Field>
              {rateField(f, "knitting_rate", "Knitting / KG")}
              {rateField(f, "dyeing_rate", "Dyeing / KG")}
              {rateField(f, "finishing_rate", "Finishing / KG")}
              <Field label="Process Loss %" w="range">
                <NumInput aria-label="Process loss percent" value={f.process_loss_pct} onChange={(e) => patchFabric(f.key, { process_loss_pct: e.target.value })} />
              </Field>
            </FieldRow>
            <FieldError>{msgFor(costingFieldId.fabricRate(f.key))}</FieldError>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
              <div id={costingFieldId.yarnMix(f.key)} className="w-[31rem] max-w-full">
                {/* default-row: exempt -- a fabric with no blend needs no mix line; the seeded one is dropped as blank */}
                <div data-grid-style="sheet" className="[&_table]:table-fixed">
                  <ChildGrid<YarnMixDraft>
                    // grid-caption: exempt -- two nested grids share the fabric card
                    label="Yarn mix"
                    columns={costingYarnColumns(f)}
                    rows={mixRows(f)}
                    tableAlways
                    narrow
                    keepOne
                    removeHeader="Actions"
                    totalsLabel="Blend"
                    addLabel="+ Add yarn"
                    onAdd={() => setMix(f, (xs) => [...xs, blankYarn()])}
                    onRemove={(y) => setMix(f, (xs) => xs.filter((x) => x.key !== y.key))}
                  />
                </div>
                <FieldError>{msgFor(costingFieldId.yarnMix(f.key))}</FieldError>
              </div>
              <div className="w-[21rem] max-w-full">
                <div data-grid-style="sheet" className="[&_table]:table-fixed">
                  <ChildGrid<FabricProcessDraft>
                    // grid-caption: exempt -- two nested grids share the fabric card
                    label="Special processing"
                    columns={costingProcessColumns(f)}
                    rows={f.processes}
                    tableAlways
                    narrow
                    keepOne
                    removeHeader="Actions"
                    totalsLabel="Total"
                    addLabel="+ Add process"
                    onAdd={() => setProc(f, (xs) => [...xs, blankProcess()])}
                    onRemove={(r) => setProc(f, (xs) => xs.filter((x) => x.key !== r.key))}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : !f.is_direct ? (
          <Truncated className="text-xs text-muted-foreground">{fabricSummary(f) || "No rates yet"}</Truncated>
        ) : null}
      </div>
    );
  };

  // ==========================================================================
  // CARD 3 — CONSUMPTION & COMPONENT WEIGHTS (spec §4.3)
  // ==========================================================================
  /** The Piece cell, for a SET only (a single piece needs no column — Order
   *  Entry's Style-column rule). Width is given at the call site, because
   *  `check:grid-budget` reads `width:` inside each named `…Columns` const. */
  const pieceSelect = <T extends { key: string; piece_key: string }>(
    patch: (key: string, p: { piece_key: string }) => void,
  ): ChildGridColumn<T> => ({
    header: "Piece",
    required: true,
    cell: (r) => (
      <Select aria-label="Piece" value={r.piece_key} onChange={(e) => patch(r.key, { piece_key: e.target.value })}>
        {pieces.map((p) => (
          <option key={p.key} value={p.key}>
            {p.piece_name}
          </option>
        ))}
      </Select>
    ),
  });
  /**
   * [Piece range 112] · Component range 112 · Fabric range 112 · Size Group
   * range 112 · Weight (g) code 144 (the box + its L×W×GSM button) ·
   * Allowance % num 72 · Cost ₹ num 72 = 736 (624 without Piece) + 72 chrome
   * = 808 ≤ the 818px canvas at 1366. `tableAlways`: the canvas is narrower
   * than `5xl`'s 1024 by design (the rail), and these columns fit it.
   */
  const costingWeightColumns: ChildGridColumn<WeightDraft>[] = [
    ...(multiPiece ? [{ ...pieceSelect<WeightDraft>(patchWeight), width: FIELD_WIDTH_CSS.range }] : []),
    {
      header: "Component",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <Select aria-label="Component" value={r.component_id ?? ""} onChange={(e) => patchWeight(r.key, { component_id: e.target.value || null })}>
          <option value=""></option>
          {data.components
            .filter((c) => !isInactive(c) || c.id === r.component_id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </Select>
      ),
    },
    {
      header: "Fabric",
      required: true,
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <div>
          <Select
            id={costingFieldId.weightFabric(r.key)}
            aria-label="Fabric"
            value={r.fabric_key ?? ""}
            onChange={(e) => patchWeight(r.key, { fabric_key: e.target.value || null })}
          >
            <option value=""></option>
            {fabrics
              .filter((f) => !isBlankFabric(f))
              .map((f, i) => (
                <option key={f.key} value={f.key}>
                  {fabricLabel(f, i)}
                </option>
              ))}
          </Select>
          <FieldError>{msgFor(costingFieldId.weightFabric(r.key))}</FieldError>
        </div>
      ),
    },
    {
      header: "Size Group",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <Select aria-label="Size group" value={r.size_group_id ?? ""} onChange={(e) => patchWeight(r.key, { size_group_id: e.target.value || null })}>
          <option value="">All sizes</option>
          {data.sizeGroups
            .filter((g) => !isInactive(g) || g.id === r.size_group_id)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
        </Select>
      ),
    },
    {
      header: "Weight (g)",
      align: "right",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => {
        // Dimensional calc (costing spec §3.2): once L, W and GSM are in, the
        // grams are DERIVED — shown as a figure, not a box to overtype.
        const dim = dimensionalGrams(r);
        return (
          <div>
            <div className="flex items-center gap-1">
              {dim != null ? (
                <span className="flex h-9 flex-1 items-center justify-end rounded-md bg-info-soft px-2 text-sm text-info">
                  <Flash value={money(dim, 1)} formula={`${r.length_cm} × ${r.width_cm} × ${r.gsm} GSM ÷ 10 000`} />
                </span>
              ) : (
                <NumInput
                  id={costingFieldId.weightGrams(r.key)}
                  aria-label="Weight in grams"
                  value={r.weight_g}
                  onChange={(e) => patchWeight(r.key, { weight_g: e.target.value })}
                />
              )}
              <Tooltip label="Length × Width × GSM">
                {/* button-shape: exempt -- a 28px icon square beside a cell box */}
                <button
                  type="button"
                  data-row-open
                  aria-label="Calculate weight from length, width and GSM"
                  onClick={captureDimsOrigin(() => setDimsFor(r.key))}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-primary-soft hover:text-primary"
                >
                  <Ruler className="h-3.5 w-3.5" aria-hidden />
                </button>
              </Tooltip>
            </div>
            <FieldError>{msgFor(costingFieldId.weightGrams(r.key))}</FieldError>
          </div>
        );
      },
    },
    {
      header: "Allow %",
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => (
        <NumInput aria-label="Wastage allowance percent" value={r.wastage_pct} onChange={(e) => patchWeight(r.key, { wastage_pct: e.target.value })} />
      ),
    },
    {
      header: "Cost ₹",
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      total: {
        kind: "derived",
        value: (rs) => money(rs.reduce((t, w) => t + (componentCost(w, live.fabrics) ?? 0), 0)),
      },
      cell: (r) => <Figure value={componentCost(r, live.fabrics)} formula="Price / KG ÷ 1000 × grams × (1 + allowance %)" />,
    },
  ];

  // ==========================================================================
  // CARD 4 — CMT & GARMENT PROCESSING (spec §4.4) · CARD 5 — TRIMS
  // ==========================================================================
  const pieceNameColumn: ChildGridColumn<PieceDraft> = {
    header: "Piece",
    cell: (r) => <Truncated className="text-sm font-medium">{r.piece_name}</Truncated>,
  };
  const pieceInput = (k: keyof PieceDraft, header: string, label: string): ChildGridColumn<PieceDraft> => ({
    header,
    align: "right",
    total: { kind: "sum", of: (r) => num(r[k] as string) ?? 0, format: (n) => money(n) },
    cell: (r) => (
      <NumInput aria-label={`${label} — ${r.piece_name}`} value={r[k] as string} onChange={(e) => patchPiece(r.key, { [k]: e.target.value })} />
    ),
  });
  const labourOf = (p: PieceDraft) =>
    ["cmt", "print_cost", "embroidery_cost", "wash_cost", "testing_cost"].reduce((t, k) => t + (num(p[k as keyof PieceDraft] as string) ?? 0), 0);
  /** Piece range 112 · CMT hug 88 · Print hug 88 · Embroidery range 112 (its
   *  header is the floor) · Wash hug 88 · Testing hug 88 · Total hug 88 = 664
   *  + 72 = 736 ≤ 818. */
  const costingCmtColumns: ChildGridColumn<PieceDraft>[] = [
    { ...pieceNameColumn, width: FIELD_WIDTH_CSS.range },
    { ...pieceInput("cmt", "CMT", "CMT"), width: FIELD_WIDTH_CSS.hug },
    { ...pieceInput("print_cost", "Print", "Print"), width: FIELD_WIDTH_CSS.hug },
    { ...pieceInput("embroidery_cost", "Embroidery", "Embroidery"), width: FIELD_WIDTH_CSS.range },
    { ...pieceInput("wash_cost", "Wash", "Garment wash"), width: FIELD_WIDTH_CSS.hug },
    { ...pieceInput("testing_cost", "Testing", "Testing and FOB charges"), width: FIELD_WIDTH_CSS.hug },
    {
      header: "Total ₹",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      total: { kind: "derived", value: (rs) => money(rs.reduce((t, p) => t + labourOf(p), 0)) },
      cell: (r) => <Figure value={labourOf(r)} formula="CMT + Print + Embroidery + Wash + Testing" />,
    },
  ];

  /** [Piece range 112] · Trim party 200 · Qty num 72 · Rate hug 88 · Amount
   *  hug 88 = 560 (448 without Piece) + 72 = 632 ≤ 818. */
  const costingTrimColumns: ChildGridColumn<TrimDraft>[] = [
    ...(multiPiece ? [{ ...pieceSelect<TrimDraft>(patchTrim), width: FIELD_WIDTH_CSS.range }] : []),
    {
      header: "Trim / Accessory",
      width: FIELD_WIDTH_CSS.party,
      cell: (r) => (
        <TypeOrPick
          label="Trim"
          options={data.trims.filter((t) => !isInactive(t) || t.id === r.item_id).map((t) => ({ id: t.id, name: t.name }))}
          valueId={r.item_id}
          text={r.description || (data.trims.find((t) => t.id === r.item_id)?.name ?? "")}
          onChange={(v) => patchTrim(r.key, { item_id: v.id, description: v.name })}
          placeholder=""
          uppercase
        />
      ),
    },
    {
      header: "Qty",
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => <NumInput aria-label="Qty per piece" value={r.qty} onChange={(e) => patchTrim(r.key, { qty: e.target.value })} />,
    },
    {
      header: "Rate ₹",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <div>
          <NumInput id={costingFieldId.trimRate(r.key)} aria-label="Rate" value={r.rate} onChange={(e) => patchTrim(r.key, { rate: e.target.value })} />
          <FieldError>{msgFor(costingFieldId.trimRate(r.key))}</FieldError>
        </div>
      ),
    },
    {
      header: "Amount ₹",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      total: { kind: "sum", of: (r) => (num(r.qty) ?? 0) * (num(r.rate) ?? 0), format: (n) => money(n) },
      cell: (r) => <Figure value={isBlankTrim(r) ? null : (num(r.qty) ?? 0) * (num(r.rate) ?? 0)} formula="Qty × Rate" />,
    },
  ];

  // ==========================================================================
  // CARD 6 — OVERHEADS & COMMERCIAL: the quote matrix (a SET or > 1 size group)
  // ==========================================================================
  type QuoteRow = { key: string; pieceKey: string; groupId: string | null; fig: CostingSummary["groups"][number]["pieces"][number] };
  const quoteRows: QuoteRow[] = summary.groups.flatMap((g) =>
    g.pieces.map((p) => ({ key: quoteKey(p.pieceKey, g.groupId), pieceKey: p.pieceKey, groupId: g.groupId, fig: p })),
  );
  const setQuote = (key: string, v: string) => {
    setQuotes((q) => ({ ...q, [key]: v }));
    setDirty(true);
  };
  /** Piece range 112 · Size Group range 112 · Gross Cost / Calc / Quoted hug
   *  88 ×3 · Δ range 112 · Margin hug 88 = 688 + 72 = 760 ≤ 818. */
  const costingQuoteColumns: ChildGridColumn<QuoteRow>[] = [
    { header: "Piece", width: FIELD_WIDTH_CSS.range, cell: (r) => <Truncated className="text-sm font-medium">{pieceName(r.pieceKey)}</Truncated> },
    { header: "Size Group", width: FIELD_WIDTH_CSS.range, cell: (r) => <span className="text-sm">{groupName(r.groupId)}</span> },
    { header: "Gross Cost ₹", align: "right", width: FIELD_WIDTH_CSS.hug, cell: (r) => <Figure value={r.fig.grossCost} formula="Net + Wastage + Overhead" /> },
    {
      header: `Calc ${ccy ?? ""}`.trim(),
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => <Figure value={r.fig.calc} dp={4} formula="(Gross cost + Margin − Discount + Freight + Insurance) ÷ Exchange rate" />,
    },
    {
      header: `Quoted ${ccy ?? ""}`.trim(),
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <NumInput
          aria-label={`Quoted price — ${pieceName(r.pieceKey)}, ${groupName(r.groupId)}`}
          className="font-semibold"
          value={quotes[r.key] ?? ""}
          onChange={(e) => setQuote(r.key, e.target.value)}
        />
      ),
    },
    {
      header: "Δ vs Calc",
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <span className="block text-right">
          <DeltaBadge delta={r.fig.delta} pctValue={r.fig.deltaPct} />
        </span>
      ),
    },
    {
      header: "Margin",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => {
        const h = marginHealth(r.fig.effectiveMarginPct);
        return (
          <span className={`block text-right text-sm font-semibold tabular-nums ${h ? HEALTH[h].text : "text-muted-foreground"}`}>
            {pct(r.fig.effectiveMarginPct)}
          </span>
        );
      },
    },
  ];

  // ==========================================================================
  // THE CARDS
  // ==========================================================================
  const inherited: { label: string; value: string }[] = [
    { label: "Customer", value: enquiry?.customer_name ?? "" },
    { label: "Season", value: [enquiry?.season, enquiry?.season_year].filter(Boolean).join(" ") },
    { label: "Description", value: style?.description ?? "" },
    {
      label: "Unit",
      value: style ? (style.unit_kind === "set" ? `SET · ${pieces.map((p) => p.piece_name).join(" + ")}` : style.unit_kind === "piece" ? "PCS" : "") : "",
    },
  ].filter((x) => x.value);

  const head = summary.groups[0]?.total ?? null;
  const fabricCost = head?.fabric ?? null;

  const cardBody: Record<CostingSection, { right?: ReactNode; content: ReactNode }> = {
    info: {
      content: (
        <div className="space-y-4">
          <div className={`${DETAILS_W} space-y-3`}>
            <FieldRow gap="row" align="start">
              <Field label="Costing No" htmlFor="sc-no">
                <Input
                  id="sc-no"
                  readOnly
                  value={meta.code ?? preview ?? ""}
                  className="w-auto min-w-[5.5rem] field-sizing-content font-mono max-sm:w-full"
                />
              </Field>
              <Field label="Costing Date" required w="code" htmlFor={costingFieldId.date}>
                <Input
                  id={costingFieldId.date}
                  type="date"
                  value={header.costing_date}
                  onChange={(e) => {
                    setH({ costing_date: e.target.value });
                    if (!editId && e.target.value) void previewCostingNo(e.target.value).then(setPreview);
                  }}
                />
              </Field>
              <Field label="Revision" w="term" htmlFor="sc-rev">
                <Select
                  id="sc-rev"
                  disabled={!editId || revisions.length < 2 || !!revisingFrom}
                  value={revisingFrom ? "next" : (editId ?? "")}
                  onChange={(e) => {
                    if (dirty) {
                      toastError("Save or cancel your changes before opening another revision.");
                      return;
                    }
                    openById(e.target.value);
                  }}
                >
                  {revisingFrom ? <option value="next">{revisionLabel(meta.version)} (new)</option> : null}
                  {(revisions.length ? revisions : [{ id: editId ?? "", version: meta.version, status: meta.status }]).map((r) => (
                    <option key={r.id} value={r.id}>
                      {`${revisionLabel(r.version)}${r.status === "superseded" ? "" : ` · ${STATUS_LABEL[r.status]}`}`}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldRow>
            <FieldRow gap="row" align="start">
              <Field label="Sample No" required w="name" htmlFor={costingFieldId.sample}>
                <RecordPicker
                  id={costingFieldId.sample}
                  label="Sample No"
                  compact
                  required
                  disabled={!!editId || !!revisingFrom}
                  items={data.enquiries.map((e) => ({ id: e.id, code: e.code, name: e.name, inactive: e.is_draft && e.id !== header.opportunity_id }))}
                  value={header.opportunity_id}
                  onChange={(id) => {
                    setH({ opportunity_id: id, style_id: null });
                    // A one-style enquiry answers the Style question itself.
                    const only = data.styles.filter((s) => s.opportunity_id === id);
                    if (only.length === 1) {
                      setH({ opportunity_id: id, style_id: only[0].id });
                      applyStyle(only[0]);
                    }
                  }}
                />
              </Field>
              <Field label="Style" required w="name" htmlFor={costingFieldId.style}>
                <RecordPicker
                  id={costingFieldId.style}
                  label="Style"
                  compact
                  required
                  disabled={!header.opportunity_id || !!editId || !!revisingFrom}
                  items={enquiryStyles.map((s) => ({ id: s.id, code: s.sample_no, name: [s.sample_no, s.name].filter(Boolean).join(" · ") }))}
                  value={header.style_id}
                  onChange={(id) => {
                    setH({ style_id: id });
                    applyStyle(data.styles.find((s) => s.id === id) ?? null);
                  }}
                />
              </Field>
            </FieldRow>
          </div>
          {/* Inherited from Sample Entry — label · value, only what exists (precedent §2b). */}
          {inherited.length > 0 && (
            <dl className="m-0 flex flex-wrap items-baseline gap-x-6 gap-y-2">
              {inherited.map((x) => (
                <div key={x.label} className="flex min-w-0 items-baseline gap-2">
                  <dt className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{x.label}</dt>
                  <dd className="m-0 max-w-[22rem] text-sm font-medium text-foreground">
                    <Truncated>{x.value}</Truncated>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {meta.decisionRemark && meta.status === "rejected" ? (
            <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
              Sent back for rework: {meta.decisionRemark}
            </p>
          ) : null}
        </div>
      ),
    },
    fabrics: {
      right: live.fabrics.length ? `${live.fabrics.length} ${live.fabrics.length === 1 ? "fabric" : "fabrics"}` : null,
      content: (
        <ChildGrid<FabricDraft>
          columns={costingFabricColumns}
          rows={fabrics}
          forceCards
          listRows
          frameless
          keepOne
          addLabel="+ Add fabric"
          onAdd={() => {
            const f = blankFabric();
            mutFabrics((xs) => [...xs, f]);
            fab.claim(f.key);
          }}
          onRemove={(r) => mutFabrics((xs) => xs.filter((x) => x.key !== r.key))}
          // grid-required-mobile: exempt -- the row is drawn by `fabricCard`, whose Fields carry `required={c.required}`
          renderMobileRow={(r, i) => fabricCard(r, i)}
        />
      ),
    },
    consumption: {
      right: fabricCost != null ? <Flash value={`₹${money(fabricCost)}`} formula="Fabric cost per piece (first size group)" /> : null,
      content: (
        <div data-grid-style="sheet" className="[&_table]:table-fixed">
          <ChildGrid<WeightDraft>
            columns={costingWeightColumns}
            rows={weights}
            tableAlways
            keepOne
            removeHeader="Actions"
            totalsLabel="Fabric cost"
            addLabel="+ Add component"
            onAdd={() => mutWeights((xs) => [...xs, blankWeight(xs[xs.length - 1]?.piece_key ?? pieces[0]?.key ?? "")])}
            onRemove={(r) => mutWeights((xs) => xs.filter((x) => x.key !== r.key))}
          />
        </div>
      ),
    },
    cmt: {
      right: head ? <Flash value={`₹${money(head.cmt + head.process + pieces.reduce((t, p) => t + (num(p.testing_cost) ?? 0), 0))}`} /> : null,
      content: (
        // default-row: exempt -- one row per garment piece, DERIVED from the style line's coordinates; it cannot grow
        <div data-grid-style="sheet" className="[&_table]:table-fixed">
          <ChildGrid<PieceDraft>
            columns={costingCmtColumns}
            rows={pieces}
            tableAlways
            keepOne
            hideAdd
            hideRemove
            onAdd={() => false}
            onRemove={() => undefined}
          />
        </div>
      ),
    },
    trims: {
      right: head ? <Flash value={`₹${money(head.trims)}`} /> : null,
      content: (
        <div data-grid-style="sheet" className="[&_table]:table-fixed">
          <ChildGrid<TrimDraft>
            columns={costingTrimColumns}
            rows={trims}
            tableAlways
            keepOne
            removeHeader="Actions"
            addLabel="+ Add trim"
            onAdd={() => mutTrims((xs) => [...xs, blankTrim(xs[xs.length - 1]?.piece_key ?? pieces[0]?.key ?? "")])}
            onRemove={(r) => mutTrims((xs) => xs.filter((x) => x.key !== r.key))}
          />
        </div>
      ),
    },
    quotation: {
      content: (
        <div className="space-y-5">
          <div className={TERMS_W}>
            <FieldRow gap="row" align="start">
              <Field label="Wastage %" w="hug" htmlFor="sc-waste">
                <NumInput id="sc-waste" value={header.garment_waste_pct} onChange={(e) => setH({ garment_waste_pct: e.target.value })} />
              </Field>
              <Field label="Discount %" w="hug" htmlFor="sc-disc">
                <NumInput id="sc-disc" value={header.discount_pct} onChange={(e) => setH({ discount_pct: e.target.value })} />
              </Field>
              <Field label="Ship Mode" w="code" htmlFor="sc-ship">
                <Select id="sc-ship" value={header.ship_mode} onChange={(e) => setH({ ship_mode: e.target.value })}>
                  <option value=""></option>
                  {SHIP_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Freight / pc ₹" w="range" htmlFor="sc-freight">
                <NumInput id="sc-freight" value={header.freight_per_pc} onChange={(e) => setH({ freight_per_pc: e.target.value })} />
              </Field>
              <Field label="Insurance / pc ₹" w="range" htmlFor="sc-ins">
                <NumInput id="sc-ins" value={header.insurance_per_pc} onChange={(e) => setH({ insurance_per_pc: e.target.value })} />
              </Field>
              {/* Bank charges are per PIECE (costing spec §3.4) — one box each,
                  on the same row as the other charges. */}
              {pieces.map((p) => (
                <Field key={p.key} label={multiPiece ? `Bank ₹ · ${p.piece_name}` : "Bank Charges ₹"} w="range">
                  <NumInput aria-label={`Bank charges — ${p.piece_name}`} value={p.bank_cost} onChange={(e) => patchPiece(p.key, { bank_cost: e.target.value })} />
                </Field>
              ))}
            </FieldRow>
          </div>
          {quoteRows.length > 1 ? (
            // default-row: exempt -- rows are DERIVED: one per piece × size group the Consumption names
            <div data-grid-style="sheet" className="[&_table]:table-fixed">
              <ChildGrid<QuoteRow>
                // grid-caption: exempt -- the card holds terms fields above this grid
                label="Quote matrix — price each piece"
                columns={costingQuoteColumns}
                rows={quoteRows}
                tableAlways
                keepOne
                hideAdd
                hideRemove
                onAdd={() => false}
                onRemove={() => undefined}
              />
            </div>
          ) : null}
        </div>
      ),
    },
  };

  // ==========================================================================
  // THE STICKY COMMERCIAL RAIL (spec §4.5)
  // ==========================================================================
  const railData =
    summary.groups.find((g) => (g.groupId ?? "all") === railGroup) ?? summary.groups[0] ?? null;
  const t = railData?.total ?? null;
  const health = marginHealth(t?.effectiveMarginPct ?? null);
  const single = quoteRows.length === 1 ? quoteRows[0] : null;
  const unitWord = isSet ? "SET" : "PCS";
  const heroValue = t ? (t.quoted ?? t.calc) : null;
  /**
   * One breakdown line: label left, figure right, every figure on ONE right
   * edge (`tabular-nums`, fixed 2 dp) so the column reads like a ledger.
   * `total` lines are ruled above and bold — Net, Gross cost, Price.
   */
  const line = (label: string, value: string, opts: { total?: boolean; formula?: string } = {}) => (
    <div className={`flex items-baseline justify-between gap-3 leading-5 ${opts.total ? "mt-1 border-t border-border pt-1" : ""}`}>
      <dt className={`text-xs ${opts.total ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</dt>
      <dd className={`m-0 text-right text-xs ${opts.total ? "font-semibold text-foreground" : "text-foreground"}`}>
        <Flash value={value} formula={opts.formula} />
      </dd>
    </div>
  );
  /** A labelled stat in the price card — label ABOVE value, so three of them
   *  line up as columns instead of floating in one justified line. */
  const stat = (label: string, value: ReactNode, align: "left" | "center" | "right") => (
    <div className={align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}>
      <div className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">{label}</div>
      <div className="text-xs font-medium tabular-nums text-foreground">{value}</div>
    </div>
  );
  const sectionTitle = (text: string, right?: ReactNode) => (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="m-0 text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{text}</h2>
      {right}
    </div>
  );

  /*
   * THE RAIL FITS ONE SCREEN (screenshot 3361, 2026-10-07): the first cut was
   * ~750px tall in a ~500px pane, so "sticky" only pinned its BOTTOM half —
   * the breakdown's heading had scrolled away. Now, top to bottom, in the
   * order the merchandiser reads it: the PRICE (the answer), the four inputs
   * that move it, then the breakdown (the working). A short window still gets
   * every line: the rail scrolls inside itself (`max-h` + `overflow-y-auto`)
   * rather than off the screen.
   *
   * THE FOUR INPUTS ARE ONE 2 × 2 GRID OF EQUAL `code` (144) BOXES —
   * 144 + 12 + 144 = 300 inside the rail's 312px — so Margin sits over
   * Currency and Overhead over Exchange Rate. They were 112 over 144, and the
   * columns did not line up.
   */
  const rail = (
    <div className="space-y-3">
      {/* 1 — THE PRICE (spec §4.5 "Hero Price Display") */}
      <section className="rounded-lg border border-primary/25 bg-primary-soft p-3 shadow-sm">
        {sectionTitle(
          t?.quoted != null ? "Final quoted FOB price" : "Calculated FOB price",
          health ? <StatusPill tone={HEALTH[health].tone}>{HEALTH[health].label}</StatusPill> : null,
        )}
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold leading-none tracking-tight text-primary">
            <Flash value={heroValue == null ? "—" : `${ccy ?? ""} ${heroValue.toFixed(2)}`.trim()} />
          </span>
          <span className="text-sm font-medium text-primary">/ {unitWord}</span>
        </div>
        {heroValue == null ? (
          <p className="mt-2 text-xs text-muted-foreground">Enter the rates, the margin and the exchange rate to price it.</p>
        ) : (
          <div className="mt-3 flex items-start border-t border-primary/20 pt-2 [&>*]:flex-1">
            {stat("Calc", t?.calc == null ? "—" : t.calc.toFixed(4), "left")}
            {stat("Δ vs calc", <DeltaBadge delta={t?.delta ?? null} pctValue={t?.deltaPct ?? null} />, "center")}
            {stat(
              "Margin",
              <span className={health ? HEALTH[health].text : ""}>{pct(t?.effectiveMarginPct)}</span>,
              "right",
            )}
          </div>
        )}
        {isSet && railData ? (
          <ul className="m-0 mt-2 list-none space-y-0.5 border-t border-primary/20 p-0 pt-2 text-xs">
            {railData.pieces.map((p) => (
              <li key={p.pieceKey} className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">{pieceName(p.pieceKey)}</span>
                <span className="text-foreground">{(p.quoted ?? p.calc)?.toFixed(2) ?? "—"}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {single ? (
          <div className="mt-3">
            <Field label={`Quoted Price ${ccy ?? ""} / ${unitWord}`.trim()} w="code" htmlFor="sc-quoted">
              <NumInput id="sc-quoted" className="font-semibold" value={quotes[single.key] ?? ""} onChange={(e) => setQuote(single.key, e.target.value)} />
            </Field>
          </div>
        ) : (
          <button type="button" onClick={() => scrollToCard("quotation", true)} className="mt-2 text-xs font-medium text-primary hover:underline">
            Price each piece in the Quote Matrix →
          </button>
        )}
        {floorSentence(summary.lowestMarginPct) ? (
          <p className={`mt-2 text-xs ${summary.belowFloor ? "font-medium text-danger" : "text-muted-foreground"}`}>
            {floorSentence(summary.lowestMarginPct)}
          </p>
        ) : null}
      </section>

      {/* 2 — WHAT MOVES IT (spec §4.5 margin controls + currency box) */}
      <section className="rounded-lg border border-border bg-background p-3 shadow-sm">
        {sectionTitle("Commercial quotation")}
        {/* Two FieldRows of equal `code` boxes and one gap: the columns line up
            without the screen drawing a grid (raagam-screen-layout). */}
        <FieldRow gap="row" align="start" nowrap>
          <Field label="Profit Margin %" required w="code" htmlFor={costingFieldId.margin}>
            <NumInput id={costingFieldId.margin} value={header.margin_pct} onChange={(e) => setH({ margin_pct: e.target.value })} />
          </Field>
          <Field label="Overhead %" w="code" htmlFor="sc-ovh">
            <NumInput id="sc-ovh" value={header.overhead_pct} onChange={(e) => setH({ overhead_pct: e.target.value })} />
          </Field>
        </FieldRow>
        <FieldRow gap="row" align="start" nowrap className="mt-2">
          <Field label="Currency" required w="code">
            <CurrencyPicker
              label="Currency"
              compact
              currencies={data.currencies}
              value={header.currency_code}
              canCreate={false}
              canEdit={false}
              onChange={(code) =>
                // Order Entry's rule: picking INR fills a BLANK rate with 1.
                setH({ currency_code: code, ...(code === "INR" && !header.exchange_rate ? { exchange_rate: "1" } : {}) })
              }
            />
          </Field>
          <Field label="Exchange Rate ₹" required w="code" htmlFor={costingFieldId.rate}>
            {/* The fetch button sits INSIDE the box's right edge, so the box
                keeps the column's full 144px and lines up with Overhead %. */}
            <div className="relative">
              <NumInput id={costingFieldId.rate} className="pr-8" value={header.exchange_rate} onChange={(e) => setH({ exchange_rate: e.target.value })} />
              <span className="absolute inset-y-0 right-1 flex items-center">
                <Tooltip label="Fetch from Exchange rate (Quotes / Orders)">
                  {/* button-shape: exempt -- a 24px icon square inside the rate box */}
                  <button
                    type="button"
                    aria-label="Fetch the exchange rate from the master"
                    onClick={fetchRate}
                    disabled={!header.currency_code || isPending}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-control text-muted-foreground hover:bg-primary-soft hover:text-primary disabled:opacity-40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </Tooltip>
              </span>
            </div>
          </Field>
        </FieldRow>
      </section>

      {/* 3 — THE WORKING (spec §4.5 "Top Sub-Total Breakdown") */}
      <section className="rounded-lg border border-border bg-background p-3 shadow-sm">
        {sectionTitle(`Cost breakdown · per ${isSet ? "set" : "piece"}`)}
        {summary.groups.length > 1 ? (
          <div className="mb-2">
            <ToggleGroup<string>
              label="Size group shown"
              value={railData ? (railData.groupId ?? "all") : "all"}
              onChange={setRailGroup}
              options={summary.groups.map((g) => ({ value: g.groupId ?? "all", label: groupName(g.groupId) }))}
            />
          </div>
        ) : null}
        <dl className="m-0">
          {line("Fabric", money(t?.fabric))}
          {line("CMT & processing", money(t ? t.cmt + t.process + pieces.reduce((x, p) => x + (num(p.testing_cost) ?? 0), 0) : null))}
          {line("Trims & accessories", money(t?.trims))}
          {line("Bank charges", money(t ? pieces.reduce((x, p) => x + (num(p.bank_cost) ?? 0), 0) : null))}
          {line("Net base cost ₹", money(t?.net), { total: true, formula: "Fabric + CMT & processing + Trims + Bank" })}
          {line(`Wastage ${header.garment_waste_pct || 0}%`, money(t?.wastage))}
          {line(`Overhead ${header.overhead_pct || 0}%`, money(t?.overhead))}
          {line("Gross cost ₹", money(t?.grossCost), { total: true, formula: "Net + Wastage + Overhead" })}
          {line(`Margin ${header.margin_pct || 0}%`, money(t?.margin))}
          {line(`Discount ${header.discount_pct || 0}%`, t?.discount ? `−${money(t.discount)}` : money(0))}
          {line("Price ₹", money(t?.gross), { total: true, formula: "Gross cost + Margin − Discount" })}
        </dl>
      </section>
    </div>
  );

  // ==========================================================================
  // THE WORKSPACE — anchor nav · canvas · rail
  // ==========================================================================
  const nav = (
    <nav aria-label="Costing sections" className="lg:sticky lg:top-2 lg:w-[10rem] lg:shrink-0">
      {/* `lg:flex-nowrap` IS THE FIX FOR SCREENSHOT 3360: a WRAPPING column
          flex box sizes each column to its longest item, so every row
          stretched to "Overheads & Commercial" (~214px) inside a 160px nav
          and the rows' counters landed on top of the cards. */}
      <ol className="m-0 flex list-none flex-wrap gap-1 p-0 lg:flex-col lg:flex-nowrap">
        {CARD_ORDER.map((c, i) => {
          const n = countFor(c.key);
          const active = activeCard === c.key;
          return (
            <li key={c.key}>
              <a
                href={`#${cardAnchor(c.key)}`}
                aria-current={active ? "true" : undefined}
                // OFF THE TAB PATH: Tab lands on fields only (keyboard
                // contract), and a focusable first link is where the editor's
                // first-field landing put the cursor — the outline round
                // "Costing Details" in screenshot 3360. A click scrolls to the
                // card AND puts the cursor in its first field.
                tabIndex={-1}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToCard(c.key, true);
                }}
                className={`flex min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-xs font-medium outline-none transition-colors ${
                  active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                    active ? "bg-primary text-primary-foreground" : "border border-border"
                  }`}
                >
                  {i + 1}
                </span>
                <Truncated className="min-w-0 flex-1">{c.nav}</Truncated>
                {n ? (
                  <span className="shrink-0 rounded-full bg-danger-soft px-1.5 text-[10px] font-semibold tabular-nums text-danger">{n}</span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );

  const workspace = (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {nav}
      <div className="w-full min-w-0 flex-1 space-y-5">
        {CARD_ORDER.map((c, i) => {
          const b = cardBody[c.key];
          return (
            <section
              key={c.key}
              id={cardAnchor(c.key)}
              data-card={c.key}
              className="scroll-mt-4 rounded-lg border border-border bg-background shadow-sm"
            >
              <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <h2 className="m-0 flex-1 text-sm font-semibold text-foreground">{c.label}</h2>
                {b.right ? <span className="text-sm font-semibold tabular-nums text-foreground">{b.right}</span> : null}
              </header>
              <div className="p-4">{b.content}</div>
            </section>
          );
        })}
      </div>
      <aside
        aria-label="Commercial summary"
        className="w-full lg:sticky lg:top-2 lg:max-h-[calc(100dvh-15rem)] lg:w-[21rem] lg:shrink-0 lg:overflow-y-auto lg:pr-1 2xl:w-[30%] 2xl:max-w-[36rem]"
      >
        {rail}
      </aside>
    </div>
  );

  const sections: FullScreenSection[] = [
    {
      key: "costing",
      label: "Sample Costing",
      icon: Calculator,
      done: !!header.opportunity_id && !!header.style_id,
      problems: validity.blocking.length,
      content: workspace,
    },
  ];

  const lockMessage = !editable
    ? meta.status === "submitted"
      ? `With the MD for approval — the lowest margin is under ${MARGIN_FLOOR_PCT}%. It can be changed once approved (Revise) or sent back for rework.`
      : meta.status === "approved"
        ? "Approved. Revise it to negotiate a new price — the next revision keeps every figure."
        : "This revision has been superseded by a later one. Open the latest from Revision."
    : null;

  // ---- the L × W × GSM sub-sheet -------------------------------------------------
  const dimsRow = weights.find((w) => w.key === dimsFor) ?? null;
  const dimsGrams = dimsRow ? dimensionalGrams(dimsRow) : null;

  if (mode === "edit") {
    const canSubmit = !!editId && !revisingFrom && isEditableStatus(meta.status) && !meta.isDraft && perms.canEdit;
    return (
      <div className="flex h-full flex-col gap-3">
        {/* TOP CONTEXT RIBBON (spec §4.1) */}
        <div
          data-focus-region="header"
          className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-background px-3 py-2 shadow-sm"
        >
          <Button variant="ghost" size="sm" onClick={closeEditor} aria-label="Back to list" className="h-10 w-10 shrink-0 px-0 text-lg md:hidden">
            ←
          </Button>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-foreground">{meta.code ?? preview ?? "New costing"}</span>
            <span className="rounded-control bg-surface-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {revisionShort(meta.version)}
            </span>
            {revisingFrom ? (
              <StatusPill tone="info">New revision</StatusPill>
            ) : editId ? (
              <StatusPill tone={meta.isDraft ? "neutral" : STATUS_TONE[meta.status]}>{meta.isDraft ? "Draft" : STATUS_LABEL[meta.status]}</StatusPill>
            ) : null}
          </div>
          {style ? (
            <div className="group relative flex min-w-0 items-center gap-2">
              {style.thumb_url ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; next/image would cache it past expiry */}
                  <img src={style.thumb_url} alt="" className="h-8 w-8 shrink-0 rounded border border-border object-cover" />
                  {/* Hover preview (spec §4.1 "hover-preview thumbnail"). */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
                  <img
                    src={style.thumb_url}
                    alt={`${style.name} — garment visual`}
                    className="pointer-events-none absolute left-0 top-10 z-20 hidden h-56 w-56 rounded-lg border border-border bg-background object-contain p-1 shadow-lg group-hover:block"
                  />
                </>
              ) : null}
              <div className="min-w-0">
                <Truncated className="block text-sm font-semibold text-foreground">{style.name}</Truncated>
                <div className="font-mono text-[11px] text-muted-foreground">{[enquiry?.code, style.sample_no].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Choose the Sample No and Style below</span>
          )}
          {enquiry?.customer_name ? (
            <span className="rounded-control border border-border px-2 py-0.5 text-xs text-foreground">
              {[enquiry.customer_name, [enquiry.season, enquiry.season_year].filter(Boolean).join(" ")].filter(Boolean).join(" | ")}
            </span>
          ) : null}
          {ccy ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{ccy}</span> : null}
          <div aria-hidden className="min-w-[1rem] flex-1" />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="md" onClick={downloadCostSheet}>
              <FileDown className="h-4 w-4" aria-hidden /> Cost Sheet PDF
            </Button>
            <Button variant="outline" size="md" onClick={downloadQuotation} disabled={!header.currency_code}>
              <FileText className="h-4 w-4" aria-hidden /> Quotation PDF
            </Button>
            {meta.status === "approved" && !revisingFrom && perms.canEdit ? (
              <Button variant="outline" size="md" onClick={revise}>
                Revise
              </Button>
            ) : null}
            {canSubmit ? (
              <Button size="md" onClick={sendForApproval} disabled={isPending}>
                Submit Quotation
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={closeEditor} className="max-md:hidden">
              ← Back to list
            </Button>
          </div>
        </div>

        {approval && approval.forId === editId && approval.run && approval.verdict ? (
          <ApprovalActionBar
            run={approval.run}
            verdict={approval.verdict}
            subjectPath="/sales/sample-costing"
            rework
            onDone={() => editId && openById(editId)}
          />
        ) : null}

        <MasterFullScreen
          ref={shellRef}
          mount="page"
          open
          dirty={dirty}
          onClose={closeEditor}
          modeLabel={null}
          sections={sections}
          // One section, its own anchor nav: the section rail would be a single
          // row, and its 191px is what lets the canvas hold its tables.
          railCollapsed
          locked={lockMessage ? { message: lockMessage } : false}
          footer={{
            status: dirty
              ? "Unsaved changes"
              : revisingFrom
                ? `New ${revisionShort(meta.version)}`
                : editId
                  ? "Editing sample costing"
                  : "New sample costing",
            onCancel: closeEditor,
            onSave: () => submit(false),
            saveLabel: revisingFrom ? `Save ${revisionShort(meta.version)}` : "Save costing",
            canSave: validity.canSave,
            onBlockedSave: revealFirstProblem,
            extra:
              validity.blocking.length > 0 ? (
                <button type="button" onClick={revealFirstProblem} className="text-xs font-medium text-danger hover:underline">
                  {validity.blocking.length} to fix
                </button>
              ) : undefined,
            onSaveDraft: (editId ? perms.canEdit : perms.canCreate) && !revisingFrom ? () => submit(true) : undefined,
            isPending,
          }}
        />

        <SubDetailSheet
          open={!!dimsRow}
          onClose={() => setDimsFor(null)}
          origin={dimsOrigin}
          parent="costing"
          title={`Weight from dimensions${dimsRow ? ` — ${componentName(dimsRow.component_id) || "component"}` : ""}`}
        >
          {dimsRow ? (
            <div className="space-y-4">
              <FieldRow gap="row" align="start">
                <Field label="Length (cm)" w="hug" htmlFor="sc-dim-l">
                  <NumInput id="sc-dim-l" value={dimsRow.length_cm} onChange={(e) => patchWeight(dimsRow.key, { length_cm: e.target.value })} />
                </Field>
                <Field label="Width (cm)" w="hug" htmlFor="sc-dim-w">
                  <NumInput id="sc-dim-w" value={dimsRow.width_cm} onChange={(e) => patchWeight(dimsRow.key, { width_cm: e.target.value })} />
                </Field>
                <Field label="GSM" w="hug" htmlFor="sc-dim-g">
                  <NumInput id="sc-dim-g" value={dimsRow.gsm} onChange={(e) => patchWeight(dimsRow.key, { gsm: e.target.value })} />
                </Field>
              </FieldRow>
              <p className="text-sm">
                <span className="text-muted-foreground">Weight = L × W × GSM ÷ 10 000 = </span>
                <span className="font-semibold tabular-nums text-info">{dimsGrams == null ? "—" : `${money(dimsGrams, 1)} g`}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                With all three filled the line uses this weight; clear any one to type the grams instead.
              </p>
            </div>
          ) : null}
        </SubDetailSheet>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sample Costing"
        description="Cost a sample style — fabric, consumption, CMT, trims — and quote the buyer, with MD approval under the margin floor."
        actions={perms.canCreate ? <Button onClick={openAdd}>New Sample Costing</Button> : undefined}
      />
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search Costing No, Sample No, customer or style…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        leading={quick.segment}
        right={
          quick.value
            ? `${filtered.length} of ${current.length} ${QUICK_LABEL[quick.value]}`
            : `${filtered.length} of ${current.length}`
        }
      />
      <DataTable
        columns={withCreatedColumns(listColumns, filtered)}
        rows={filtered}
        compact
        getKey={(r) => r.id}
        empty={
          !current.length
            ? "No sample costings yet. Use 'New Sample Costing' to cost the first sample."
            : quick.value && !searched.some(quick.matches)
              ? `No costings are ${QUICK_LABEL[quick.value]} — the counts above show which word they are in.`
              : "No costings match the search or filters."
        }
      />
    </div>
  );
}
