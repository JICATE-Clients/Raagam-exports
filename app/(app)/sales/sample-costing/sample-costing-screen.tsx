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

import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Calculator,
  CalendarRange,
  ChevronRight,
  Copy,
  GitCompare,
  FileDown,
  FileText,
  RefreshCw,
  Ruler,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { Tooltip } from "@/components/ui/tooltip";
import { ChildGrid, gridKeyNav, type ChildGridColumn } from "@/components/masters/child-grid";
import { MultiSelect } from "@/components/ui/multi-select";
import { MATRIX_FOOT, MATRIX_HEAD, matrixCell, textColPx } from "@/components/orders/matrix-grid";
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
import { RowActions, RowIconAction } from "@/components/ui/row-actions";
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
import { useFormDraft } from "@/lib/use-form-draft";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { focusFirstField } from "@/lib/focus";
import { sectionValidity, type Problem } from "@/lib/screens/validity";
import { isInactive } from "@/lib/masters/inactive";
import type { StatusTone } from "@/lib/ui/tone";
import type { ApprovalRun, CanActVerdict } from "@/lib/approvals/types";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import type { SampleCostingFormData, CostingStyleOption } from "@/lib/sales/sample-costing/service";
import {
  MARGIN_FLOOR_PCT,
  MARGIN_RED_BELOW_PCT,
  componentCost,
  dimensionalGrams,
  fabricKgFor,
  solveTarget,
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
  rateMemoryKey,
  revisionLabel,
  revisionShort,
  summaryOf,
  type CostingDraft,
  type CostingHeaderDraft,
  type CostingRecord,
  type CostingListRow,
  type CostingProblem,
  type CostingSection,
  type CostingStatus,
  type FabricDraft,
  type FabricProcessDraft,
  type PieceDraft,
  type RevisionRow,
  type TrimDraft,
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
import {
  ALL_SIZES,
  cellGrams,
  columnsOf,
  isBlankLine,
  linesToWeights,
  weightsToLines,
  type ConsumptionLine,
} from "@/lib/sales/sample-costing/matrix";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Costing Details is ONE ROW (user 2026-10-07, "make in single row"):
 *   Sample No name 288 · Style name 288 · Costing No ~128 (content-sized) ·
 *   Date code 144 · Revision term 176 = 1024 + 4 × 12 = 1072 → 67rem.
 * It was two rows only while the 40 % side panel left an 818px canvas, where
 * the five wrapped Revision alone (screenshot 3360); the one-column sheet
 * gives ~1100px at 1366, so the row fits, and a narrower window wraps it.
 */
const DETAILS_W = "max-w-[67rem]";
/**
 * Trims & overheads ▸ the COST adds only: Wastage / Overhead hug 88 ×2 · Bank
 * range 112 per piece (a 3-piece set: ×3) = 512 + 4 × 12 = 560 → 36rem.
 */
const TERMS_W = "max-w-[36rem]";
/**
 * Price & quote ▸ the SELLING terms, one row: Margin / Discount hug 88 ×2 ·
 * Currency / Exchange Rate code 144 ×2 · Ship Mode code 144 · Freight /
 * Insurance range 112 ×2 · Quoted Price code 144 = 1112 + 7 × 12 = 1196 →
 * 75rem. The pane is ~1100px inside at 1366, so Quoted Price wraps there and
 * the row is one line on a wider screen.
 */
const PRICE_W = "max-w-[75rem]";

/** The spec's default Wastage Allowance on a new component line (§4.3). */
const DEFAULT_ALLOWANCE = "3";

/**
 * THE LEFT COLUMN'S CARDS (clean UI spec §3), in calculation order. The rules
 * (`costingProblems`) name six sections; the page has four cards, and
 * `cardOf` says which card holds each section's fields.
 */
type CardKey = "info" | "fabrics" | "weights" | "trims" | "price";
const CARDS: { key: CardKey; label: string }[] = [
  { key: "info", label: "Costing details" },
  { key: "fabrics", label: "Fabric rates" },
  { key: "weights", label: "Component weights & CMT" },
  { key: "trims", label: "Trims & overheads" },
  { key: "price", label: "Price & quote" },
];
const cardOf = (k: CostingSection): CardKey => (k === "consumption" || k === "cmt" ? "weights" : k === "quotation" ? "price" : k);
/** The DOM id a card is scrolled to. */
const cardAnchor = (k: CardKey) => `sc-card-${k}`;

const STATUS_TONE: Record<CostingStatus, StatusTone> = {
  draft: "neutral",
  submitted: "warning",
  approved: "success",
  rejected: "danger",
  superseded: "neutral",
};

/** Margin health → the app's own status tones (spec §4.5). */
/** v2 §4.1 margin badges: ≥ 22 % on target · 15–21.9 % review · < 15 % low. */
const HEALTH: Record<MarginHealth, { tone: StatusTone; text: string; label: string }> = {
  good: { tone: "success", text: "text-success", label: "On target" },
  tight: { tone: "warning", text: "text-warning", label: "Management review" },
  poor: { tone: "danger", text: "text-danger", label: "Low margin — needs approval" },
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
  /** Consumption as a matrix (UX plan P2.1): lines × the chosen size groups.
   *  The stored `WeightDraft` rows are DERIVED from these (matrix.ts). */
  const [lines, setLines] = useState<ConsumptionLine[]>([]);
  const [sizeCols, setSizeCols] = useState<string[]>([]);
  const [trims, setTrims] = useState<TrimDraft[]>([]);
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(nextCostingNo);
  const [approval, setApproval] = useState<{ forId: string; run: ApprovalRun | null; verdict: CanActVerdict | null } | null>(null);
  /** A Save was attempted — a row's messages show from then on. */
  const [tried, setTried] = useState(false);
  /** Which size group the rail shows when the sheet costs more than one. */
  const [railGroup, setRailGroup] = useState<string>("all");
  /** The buyer's target, for "Work back from a target price" (not stored). */
  const [targetPrice, setTargetPrice] = useState("");
  /** "Copied from CST/…" until the first save (P2.2). */
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  /** Revision compare (P3.1): the other revision, loaded. */
  const [compare, setCompare] = useState<{ id: string; record: CostingRecord } | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  /**
   * Real edits, never "is the editor open" — what stands between Escape and a
   * silently discarded sheet, and what holds off the silent auto-reload.
   */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `n${keySeq.current++}`;

  // ---- the L × W × GSM calculator (one matrix cell) ------------------------------
  const [dimsFor, setDimsFor] = useState<{ line: string; col: string } | null>(null);
  const [dims, setDims] = useState({ l: "", w: "", g: "" });
  const [dimsOrigin, captureDimsOrigin] = useSubSheetOrigin();

  // ---- a fabric's rate breakdown — the Detail › sheet (Order Entry ▸ Combos) ------
  const [fabricDetailKey, setFabricDetailKey] = useState<string | null>(null);
  const [fabricOrigin, captureFabricOrigin] = useSubSheetOrigin();

  // ---- scrolling to a card ---------------------------------------------------------
  const scrollToCard = (k: CostingSection, land = false) => {
    const el = document.getElementById(cardAnchor(cardOf(k)));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (land && el) focusFirstField(el);
  };

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
  const weights = linesToWeights(lines, sizeCols);
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

  /** A piece's labour: CMT + print + embroidery + wash + testing. */
  const labourOf = (p: PieceDraft) =>
    ["cmt", "print_cost", "embroidery_cost", "wash_cost", "testing_cost"].reduce((t, k) => t + (num(p[k as keyof PieceDraft] as string) ?? 0), 0);

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
  const mutLines = mut<ConsumptionLine>(setLines);
  const mutTrims = mut<TrimDraft>(setTrims);
  const patchPiece = (key: string, patch: Partial<PieceDraft>) =>
    mutPieces((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const patchFabric = (key: string, patch: Partial<FabricDraft>) =>
    mutFabrics((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const patchLine = (key: string, patch: Partial<ConsumptionLine>) =>
    mutLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setCell = (key: string, col: string, v: string) =>
    mutLines((xs) => xs.map((x) => (x.key === key ? { ...x, cells: { ...x.cells, [col]: v } } : x)));
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
  // A random key, not `newKey()`: these two are called from the fabric Detail
  // sheet's "+ Add" buttons, which are built during render, and the React
  // Compiler refuses a ref read reachable from render (`react-hooks/refs`).
  const blankYarn = (): YarnMixDraft => ({ key: `y${crypto.randomUUID()}`, item_id: null, yarn_name: "", mix_pct: "", rate: "" });
  const blankProcess = (): FabricProcessDraft => ({ key: `p${crypto.randomUUID()}`, process_id: null, process_name: "", rate: "" });
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
    // Clean spec §3.1: a fabric starts as ONE typed rate; "Detailed breakdown"
    // opens the derivation.
    is_direct: true,
    direct_rate: "",
    processes: [blankProcess()],
  });
  const blankLine = (pieceKey: string): ConsumptionLine => ({
    key: newKey(),
    piece_key: pieceKey,
    component_id: null,
    fabric_key: null,
    wastage_pct: DEFAULT_ALLOWANCE,
    cells: {},
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
    setLines((xs) => xs.map((l) => (keep.has(l.piece_key) ? l : { ...l, piece_key: first })));
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
    const m = weightsToLines(d.weights, newKey, (w) => dimensionalGrams(w));
    setLines(m.lines.length ? m.lines : [blankLine(firstPiece)]);
    setSizeCols(m.sizeGroups);
    setTrims(d.trims.length ? d.trims : [blankTrim(firstPiece)]);
    setQuotes(d.quotes);
    setRailGroup("all");
    setTargetPrice("");
    setCopiedFrom(null);
    setCompare(null);
    setTried(false);
    setDirty(false);
    setMode("edit");
  }

  /**
   * COPY ANOTHER COSTING'S WORKING INTO THIS ONE (UX plan P2.2) — fabrics
   * (with their mixes and processes), weights, CMT, trims and the commercial
   * terms. This sheet keeps its own sample, style, date and quotes. Pieces are
   * matched by NAME (a SET's TOP to TOP), else by position, so a copy from a
   * PCS style lands on the one piece. New keys throughout: nothing in the
   * copy can point back into the source.
   */
  function applyCopy(src: CostingRecord, keepHeader: CostingHeaderDraft, keepPieces: PieceDraft[]) {
    const d = src.draft;
    const pieceMap = new Map<string, string>();
    const nextPieces = keepPieces.map((p, i) => {
      const from = d.pieces.find((x) => x.piece_name === p.piece_name) ?? d.pieces[i] ?? d.pieces[0];
      if (from) pieceMap.set(from.key, p.key);
      return from
        ? { ...p, cmt: from.cmt, print_cost: from.print_cost, embroidery_cost: from.embroidery_cost, wash_cost: from.wash_cost, testing_cost: from.testing_cost, bank_cost: from.bank_cost }
        : p;
    });
    const firstPiece = nextPieces[0]?.key ?? "";
    const fabricMap = new Map<string, string>();
    const nextFabrics = d.fabrics.map((f) => {
      const k = newKey();
      fabricMap.set(f.key, k);
      return {
        ...f,
        key: k,
        yarns: f.yarns.length ? f.yarns.map((y) => ({ ...y, key: newKey() })) : [blankYarn()],
        processes: f.processes.length ? f.processes.map((x) => ({ ...x, key: newKey() })) : [blankProcess()],
      };
    });
    const m = weightsToLines(d.weights, newKey, (w) => dimensionalGrams(w));
    setHeader({
      ...keepHeader,
      currency_code: d.header.currency_code,
      exchange_rate: d.header.exchange_rate,
      margin_pct: d.header.margin_pct,
      garment_waste_pct: d.header.garment_waste_pct,
      overhead_pct: d.header.overhead_pct,
      discount_pct: d.header.discount_pct,
      ship_mode: d.header.ship_mode,
      freight_per_pc: d.header.freight_per_pc,
      insurance_per_pc: d.header.insurance_per_pc,
    });
    setPieces(nextPieces);
    setFabrics(nextFabrics.length ? nextFabrics : [blankFabric()]);
    setLines(
      m.lines.length
        ? m.lines.map((l) => ({ ...l, piece_key: pieceMap.get(l.piece_key) ?? firstPiece, fabric_key: l.fabric_key ? (fabricMap.get(l.fabric_key) ?? null) : null }))
        : [blankLine(firstPiece)],
    );
    setSizeCols(m.sizeGroups);
    setTrims(
      d.trims.length ? d.trims.map((t) => ({ ...t, key: newKey(), piece_key: pieceMap.get(t.piece_key) ?? firstPiece })) : [blankTrim(firstPiece)],
    );
    setCopiedFrom(`${src.code ?? "a costing"} · ${revisionShort(src.version)}`);
    setDirty(true);
  }
  function copyFrom(id: string) {
    setCopyOpen(false);
    start(async () => {
      const res = await loadSampleCosting(id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      applyCopy(res.record, header, pieces);
      success(`Copied from ${res.record.code ?? "the costing"} — check the figures, then save.`);
    });
  }
  /** List ▸ Duplicate (P1.5): a NEW costing pre-filled from this one, its sample
   *  and style left to choose — the start search asks for them. */
  function duplicateFrom(id: string) {
    start(async () => {
      const res = await loadSampleCosting(id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      openAdd();
      const piece = blankPiece("GARMENT", null);
      applyCopy(res.record, blankHeader(), [piece]);
    });
  }

  /**
   * AUTO-FILL, QUIETLY (clean spec §4) — BLANK fields only, no badge: the
   * customer's last approved terms and today's Quotes / Orders rate when the
   * style is chosen; the rate when the currency is picked; a fabric's last
   * approved rate (or its construction's usual loss) when the fabric is picked.
   * A typed value is never overwritten.
   */
  function fillFromCustomer(oppId: string | null) {
    const custId = data.enquiries.find((e) => e.id === oppId)?.customer_id ?? null;
    const memo = data.customerTerms.find((m) => m.customer_id === custId) ?? null;
    const patch: Partial<CostingHeaderDraft> = {};
    if (memo) {
      for (const field of ["margin_pct", "overhead_pct", "garment_waste_pct", "discount_pct"] as const) {
        if (!header[field].trim() && memo[field]) patch[field] = memo[field];
      }
      if (!header.currency_code && memo.currency_code) patch.currency_code = memo.currency_code;
    }
    const cur = patch.currency_code ?? header.currency_code;
    if (cur && !header.exchange_rate.trim()) {
      const r = cur === "INR" ? 1 : data.quoteRates[cur];
      if (r) patch.exchange_rate = String(r);
    }
    if (Object.keys(patch).length) setH(patch);
  }
  function onCurrency(code: string) {
    const r = code === "INR" ? 1 : data.quoteRates[code];
    setH(r && !header.exchange_rate.trim() ? { currency_code: code, exchange_rate: String(r) } : { currency_code: code });
  }
  function onFabricPick(f: FabricDraft, v: { id: string | null; name: string }) {
    const typed =
      [f.yarn_rate, f.knitting_rate, f.dyeing_rate, f.finishing_rate, f.direct_rate].some((x) => x.trim()) ||
      f.yarns.some((y) => y.mix_pct.trim() || y.rate.trim()) ||
      f.processes.some((x) => x.rate.trim());
    const memo = data.rateMemory.find((m) => m.key === rateMemoryKey(v.id, v.name));
    if (memo && !typed) {
      patchFabric(f.key, {
        ...memo.fabric,
        fabric_id: v.id,
        quality: v.name,
        yarns: memo.fabric.yarns.length ? memo.fabric.yarns.map((y) => ({ ...y, key: newKey() })) : [blankYarn()],
        processes: memo.fabric.processes.length ? memo.fabric.processes.map((x) => ({ ...x, key: newKey() })) : [blankProcess()],
      });
      return;
    }
    const lossMemo =
      v.id && !f.process_loss_pct.trim()
        ? data.constructionLoss.find((c) => c.category_id === data.fabrics.find((x) => x.id === v.id)?.category_id)
        : undefined;
    patchFabric(f.key, { fabric_id: v.id, quality: v.name, ...(lossMemo ? { process_loss_pct: lossMemo.loss_pct } : {}) });
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

  /**
   * `?costFor=<enquiry>` — Sample Entry's "Cost this sample" (UX plan P1.3).
   * An enquiry that already has a costing opens its LATEST revision rather
   * than starting a second chain; otherwise a new sheet opens on that sample,
   * with the style chosen when the enquiry has only one.
   */
  const params = useSearchParams();
  const pathname = usePathname();
  const startFor = useEffectEvent((oppId: string) => {
    const existing = rows.filter((r) => r.opportunity_id === oppId && r.status !== "superseded");
    if (existing.length) {
      openById(existing[existing.length - 1].id);
      return;
    }
    if (!perms.canCreate) return;
    openAdd();
    const only = data.styles.filter((st) => st.opportunity_id === oppId);
    setHeader((h) => ({ ...h, opportunity_id: oppId, style_id: only.length === 1 ? only[0].id : null }));
    if (only.length === 1) applyStyle(only[0]);
    fillFromCustomer(oppId);
  });
  useEffect(() => {
    const id = params.get("costFor");
    if (!id) return;
    // After the effect, not inside it: opening sets a dozen pieces of state.
    queueMicrotask(() => startFor(id));
    const next = new URLSearchParams(params.toString());
    next.delete("costFor");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  /**
   * A DRAFT IS NEVER LOST (UX plan P1.4): the app's `useFormDraft` keeps the
   * sheet in this browser while it is edited, and offers it back when the same
   * sheet is opened again. One slot per sheet (a revision being written has
   * its own). Cleared on a successful save.
   */
  const formDraft = useFormDraft({
    storageKey: `sample-costing:${revisingFrom ? `rev-${revisingFrom}` : (editId ?? "new")}`,
    enabled: mode === "edit" && (isEditableStatus(meta.status) || !!revisingFrom),
    value: { header, pieces, fabrics, lines, sizeCols, trims, quotes },
    onRestore: (v) => {
      setHeader(v.header);
      setPieces(v.pieces);
      setFabrics(v.fabrics);
      setLines(v.lines);
      setSizeCols(v.sizeCols);
      setTrims(v.trims);
      setQuotes(v.quotes);
      setDirty(true);
    },
  });

  function closeEditor() {
    setMode("list");
    setDirty(false);
    setDimsFor(null);
    setCopyOpen(false);
    setCompareOpen(false);
  }

  /** Revision compare (P3.1): load the other revision once, then diff. */
  function openCompare(otherId: string) {
    setCompareOpen(true);
    if (compare?.id === otherId) return;
    start(async () => {
      const res = await loadSampleCosting(otherId);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setCompare({ id: otherId, record: res.record });
    });
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
  const reveal = (p: CostingProblem | undefined) => {
    if (!p) return;
    toastError(p.message);
    if (p.fieldId) {
      const id = p.fieldId;
      // A breakdown field lives in its fabric's Detail sheet: open it first.
      const inSheet = /^sc-fab-(?:yarn|mix)-(.+)$/.exec(id);
      if (inSheet) setFabricDetailKey(inSheet[1]);
      // Land on the field itself and ring it for 2 s.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        shellRef.current?.goToSection("costing", { fieldId: id });
        const el = document.getElementById(id);
        if (el) {
          el.setAttribute("data-glow", "");
          window.setTimeout(() => el.removeAttribute("data-glow"), 2000);
        }
      }));
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
      formDraft.clear();
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
  /** The PDFs' inputs for ANY sheet — the open one, or one loaded from the list. */
  const pdfBaseOf = (d: CostingDraft, m: { code: string | null; version: number; status: CostingStatus }) => {
    const enq = data.enquiries.find((e) => e.id === d.header.opportunity_id) ?? null;
    const st = data.styles.find((x) => x.id === d.header.style_id) ?? null;
    return {
      costingNo: m.code ?? preview,
      revision: revisionShort(m.version),
      date: d.header.costing_date || null,
      customer: enq?.customer_name ?? null,
      enquiryNo: enq?.code ?? null,
      sampleNo: st?.sample_no ?? null,
      style: st?.name ?? null,
      description: st?.description ?? null,
      season: [enq?.season, enq?.season_year].filter(Boolean).join(" ") || null,
      currency: d.header.currency_code,
      shipMode: SHIP_MODES.find((x) => x.value === d.header.ship_mode)?.label ?? null,
      isSet: st?.unit_kind === "set" || d.pieces.length > 1,
      pieceName: (k: string) => d.pieces.find((x) => x.key === k)?.piece_name || "GARMENT",
      groupName,
      summary: summaryOf(d),
      approved: m.status === "approved",
    };
  };
  const pdfBase = () => pdfBaseOf(draft, meta);
  /** List ▸ the Quotation icon in the row's view slot (Row actions STANDING). */
  function quotationFromList(id: string) {
    start(async () => {
      const res = await loadSampleCosting(id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      if (!res.record.draft.header.currency_code) {
        toastError("This costing has no currency yet, so there is no quotation to print.");
        return;
      }
      void exportQuotationPdf(pdfBaseOf(res.record.draft, res.record), letterhead).catch(pdfFailed);
    });
  }
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
        lead={
          <RowIconAction
            label="Quotation PDF"
            name={r.code}
            icon={FileText}
            className="text-primary"
            disabledReason={
              r.profit_loss_pct != null && r.profit_loss_pct < MARGIN_RED_BELOW_PCT && r.status !== "approved"
                ? `Margin under ${MARGIN_RED_BELOW_PCT}% — waits for approval.`
                : null
            }
            onClick={() => quotationFromList(r.id)}
          />
        }
        menu={perms.canCreate ? [{ label: "Duplicate as a new costing", icon: Copy, onClick: () => duplicateFrom(r.id) }] : undefined}
        menuAs="icons"
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
  // FABRIC RATES — ORDER ENTRY ▸ COMBOS' SHAPE (user 2026-10-07: "like order
  // entry … details button inside table, split"): a table of fabrics, and a
  // "Detail ›" cell opening the rate breakdown in a sheet.
  // ==========================================================================
  /*
   * Fabric party 200 · Rate / KG code 144 · Detail range 112 = 456 + 72 = 528.
   * The breakdown (yarn mix, knitting, dyeing, finishing, special processes,
   * loss) used to open INLINE under the row and pushed every card below it
   * down a screen; in the sheet it is one click away and the table stays a
   * table. Typed rate when the breakdown is off; derived and shown when on.
   */
  const costingFabricColumns: ChildGridColumn<FabricDraft>[] = [
    {
      header: "Fabric",
      required: true,
      width: FIELD_WIDTH_CSS.party,
      cell: (r) => (
        <TypeOrPick
          label="Fabric"
          id={costingFieldId.fabric(r.key)}
          options={data.fabrics.filter((f) => !isInactive(f) || f.id === r.fabric_id).map((f) => ({ id: f.id, name: f.name }))}
          valueId={r.fabric_id}
          text={r.quality || (data.fabrics.find((f) => f.id === r.fabric_id)?.name ?? "")}
          onChange={(v) => onFabricPick(r, v)}
          placeholder=""
          uppercase
        />
      ),
    },
    {
      header: "Rate / KG ₹",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      cell: (r) =>
        r.is_direct ? (
          <>
            <NumInput
              id={costingFieldId.fabricDirect(r.key)}
              aria-label="Fabric rate per KG"
              required
              className="font-semibold"
              value={r.direct_rate}
              onChange={(e) => patchFabric(r.key, { direct_rate: e.target.value })}
            />
            <FieldError>{msgFor(costingFieldId.fabricDirect(r.key))}</FieldError>
          </>
        ) : (
          <span className="flex h-9 items-center justify-end rounded-md bg-surface-muted px-2 text-sm font-semibold text-foreground">
            <Flash
              value={money(fabricPricePerKg(r))}
              formula={`(Yarn ${money(yarnRateOf(r))} + Knit + Dye + Finishing + Special ${money(processTotal(r))} = ${money(fabricSubtotal(r))}) × (1 + ${r.process_loss_pct || 0}% loss)`}
            />
          </span>
        ),
    },
    {
      header: "Detail",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          // A CELL OF THE ROW, so Tab / Enter reach it (Order Entry ▸ Combos).
          data-row-open
          aria-label={`Rate breakdown — ${r.quality || "fabric"}`}
          onClick={captureFabricOrigin(() => setFabricDetailKey(r.key))}
        >
          {r.is_direct ? "Detail" : "Breakdown"}
          <ChevronRight aria-hidden className="-mr-1 opacity-60" />
        </Button>
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


  /**
   * THE DETAIL SHEET'S BODY — one fabric's rate, built from its parts. The
   * switch decides whether the table's Rate / KG is typed or derived; with it
   * on, everything under it is what the rate is derived from.
   */
  const fabricDetail = (f: FabricDraft) => {
    const mix = hasYarnMix(f);
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Toggle
            label="Build the rate from yarn, knitting, dyeing and processes"
            checked={!f.is_direct}
            onChange={(v) => patchFabric(f.key, { is_direct: !v })}
          />
          <span className="text-sm tabular-nums text-muted-foreground">
            {"Rate / KG ₹ "}
            <b className="text-foreground">
              <Flash value={money(f.is_direct ? num(f.direct_rate) : fabricPricePerKg(f))} />
            </b>
          </span>
        </div>
        {f.is_direct ? (
          <p className="m-0 text-sm text-muted-foreground">The rate is typed in the table. Switch this on to work it out from the yarn and the processes instead.</p>
        ) : (
          <>
        <FieldRow gap="row" align="start">
          <Field label="Yarn / KG" w="hug" htmlFor={costingFieldId.fabricRate(f.key)}>
            {mix ? (
              // With a mix, the yarn rate IS the weighted sum — shown, not typed.
              <span className="flex h-9 items-center justify-end rounded-md bg-background px-2 text-sm font-medium">
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
                // grid-caption: exempt -- two nested grids share the breakdown
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
                // grid-caption: exempt -- two nested grids share the breakdown
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
          </>
        )}
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
  /*
   * THE SIZE-GROUP MATRIX (UX plan P2.1; orders-precedent §5 — a size-across
   * matrix is `matrix-grid.ts`, never ChildGrid columns and never cards).
   * Components down, the sheet's size groups across, grams in the cells; a
   * blank cell takes the first column (the placeholder shows what it takes).
   * The identity columns stay put while a long run of size groups scrolls
   * inside the frame — the one sanctioned sideways scroll.
   */
  const matrixCols = columnsOf(sizeCols);
  const colLabel = (c: string) => (c === ALL_SIZES ? "All sizes" : groupName(c));
  const lineCost = (l: ConsumptionLine, col: string) => {
    const g = cellGrams(l, col, sizeCols);
    if (!g) return null;
    return componentCost(
      { piece_key: l.piece_key, fabric_key: l.fabric_key, size_group_id: null, weight_g: g, length_cm: "", width_cm: "", gsm: "", wastage_pct: l.wastage_pct },
      live.fabrics,
    );
  };
  const colCost = (col: string) => lines.reduce((t, l) => t + (lineCost(l, col) ?? 0), 0);
  /** Changing the size groups keeps every typed gram: column 1's value moves
   *  with "first column" so inheritance still points at real grams. */
  const setColumns = (next: string[]) => {
    const prevFirst = columnsOf(sizeCols)[0];
    const nextFirst = columnsOf(next)[0];
    if (prevFirst !== nextFirst) {
      mutLines((xs) =>
        xs.map((l) => ({ ...l, cells: { ...l.cells, [nextFirst]: (l.cells[nextFirst] ?? "").trim() ? l.cells[nextFirst] : (l.cells[prevFirst] ?? "") } })),
      );
    }
    setSizeCols(next);
    setDirty(true);
  };
  const CELL = matrixCell("min-h-10");
  type SetRow = { key: string; n: string; piece: string; fabric: string; grams: number; cmt: number; cost: number | null };
  const setBreakdownRows: SetRow[] = (() => {
    const g0 = summary.groups.find((g) => (g.groupId ?? "all") === railGroup) ?? summary.groups[0];
    const firstCol = columnsOf(sizeCols)[0];
    const rowsOut = pieces.map((pc, i): SetRow => {
      const mine = lines.filter((l) => l.piece_key === pc.key && !isBlankLine(l));
      const fab = [...new Set(mine.map((l) => { const fi = fabrics.findIndex((f) => f.key === l.fabric_key); return fi >= 0 ? fabricLabel(fabrics[fi], fi) : ""; }).filter(Boolean))].join(" / ");
      return {
        key: pc.key,
        n: `# ${i + 1}`,
        piece: pc.piece_name,
        fabric: fab || "—",
        grams: mine.reduce((t, l) => t + (num(cellGrams(l, firstCol, sizeCols)) ?? 0), 0),
        cmt: labourOf(pc),
        cost: g0?.pieces.find((x) => x.pieceKey === pc.key)?.net ?? null,
      };
    });
    return [
      ...rowsOut,
      {
        key: "total",
        n: "",
        piece: `${pieces.length}-PIECE SET`,
        fabric: "Combined",
        grams: rowsOut.reduce((t, r) => t + r.grams, 0),
        cmt: rowsOut.reduce((t, r) => t + r.cmt, 0),
        cost: g0?.total.net ?? null,
      },
    ];
  })();
  const setBreakdownColumns: Column<SetRow>[] = [
    { header: "Line", cell: (r) => <span className="text-xs tabular-nums">{r.n}</span> },
    { header: "Coordinate", cell: (r) => <span className={`text-xs ${r.key === "total" ? "font-bold" : "font-medium"}`}>{r.piece}</span> },
    { header: "Fabric", cell: (r) => <span className="text-xs">{r.fabric}</span> },
    { header: "Weight (g)", align: "right", cell: (r) => <span className={`block text-right font-mono text-xs tabular-nums ${r.key === "total" ? "font-bold" : ""}`}>{money(r.grams, 0)}</span> },
    { header: "CMT ₹", align: "right", cell: (r) => <span className={`block text-right font-mono text-xs tabular-nums ${r.key === "total" ? "font-bold" : ""}`}>{money(r.cmt)}</span> },
    { header: "Cost ₹", align: "right", cell: (r) => <span className={`block text-right font-mono text-xs tabular-nums ${r.key === "total" ? "font-bold" : ""}`}>{money(r.cost)}</span> },
  ];
  function addLine() {
    const added = blankLine(lines[lines.length - 1]?.piece_key ?? pieces[0]?.key ?? "");
    mutLines((xs) => [...xs, added]);
  }
  const ID_COLS = multiPiece ? 4 : 3;

  const consumptionMatrix = () => {
    const track = [
      ...(multiPiece ? ["112px"] : []),
      "136px",
      "168px",
      "72px",
      ...matrixCols.map((c) => `${textColPx(colLabel(c).length, 24, 84, 132)}px`),
      "minmax(12px,1fr)",
      "72px",
    ].join(" ");
    return (
      <div className="space-y-3">
        <FieldRow gap="row" align="end">
          <Field label="Size groups" w="name">
            <MultiSelect
              id="sc-size-groups"
              compact
              label="Size groups"
              options={data.sizeGroups.filter((g) => !isInactive(g) || sizeCols.includes(g.id)).map((g) => ({ id: g.id, label: g.name }))}
              values={sizeCols}
              onChange={setColumns}
            />
          </Field>
          <p className="m-0 pb-2 text-xs text-muted-foreground">
            {sizeCols.length > 1 ? "A blank cell takes the first column's grams." : "Choose size groups to cost each size range."}
          </p>
        </FieldRow>
        {/* HUGS ITS COLUMNS, like every Orders table (browser check 2026-10-07):
            `w-full` stretched the frame across the pane and parked the ruler
            button ~900px from the grams it measures. `w-max` lets the 1fr
            spacer settle at its 12px floor; `max-w-full` keeps the scroll. */}
        <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-border">
          <div data-grid-body className="grid w-max" style={{ gridTemplateColumns: track }} onKeyDown={(e) => gridKeyNav(e)}>
            {multiPiece ? <div className={`${MATRIX_HEAD} sticky left-0 z-30 justify-start pl-2`}>Piece</div> : null}
            <div className={`${MATRIX_HEAD} justify-start pl-2`}>Component</div>
            <div className={`${MATRIX_HEAD} justify-start pl-2`}>Fabric</div>
            <div className={MATRIX_HEAD}>Allow %</div>
            {matrixCols.map((c) => (
              <div key={c} className={`${MATRIX_HEAD} whitespace-normal text-center leading-tight`}>
                {colLabel(c)} · g
              </div>
            ))}
            <div className={MATRIX_HEAD} />
            <div className={MATRIX_HEAD} />

            {lines.map((l) => (
              <div key={l.key} data-grid-row className="contents">
                {multiPiece ? (
                  <div className={`${CELL} sticky left-0 z-10 bg-surface px-1`}>
                    <Select aria-label="Piece" value={l.piece_key} onChange={(e) => patchLine(l.key, { piece_key: e.target.value })}>
                      {pieces.map((pc) => (
                        <option key={pc.key} value={pc.key}>
                          {pc.piece_name}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}
                <div className={`${CELL} px-1`}>
                  <Select aria-label="Component" value={l.component_id ?? ""} onChange={(e) => patchLine(l.key, { component_id: e.target.value || null })}>
                    <option value=""></option>
                    {data.components
                      .filter((c) => !isInactive(c) || c.id === l.component_id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <div className={`${CELL} flex-col !items-stretch px-1`}>
                  <Select
                    id={costingFieldId.weightFabric(l.key)}
                    aria-label="Fabric"
                    required
                    value={l.fabric_key ?? ""}
                    onChange={(e) => patchLine(l.key, { fabric_key: e.target.value || null })}
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
                  <FieldError>{msgFor(costingFieldId.weightFabric(l.key))}</FieldError>
                </div>
                <div className={`${CELL} px-1`}>
                  <NumInput aria-label="Wastage allowance percent" className="h-8" value={l.wastage_pct} onChange={(e) => patchLine(l.key, { wastage_pct: e.target.value })} />
                </div>
                {matrixCols.map((c, i) => (
                  <div key={c} className={`${CELL} flex-col !items-stretch px-1`}>
                    <NumInput
                      id={i === 0 ? costingFieldId.weightGrams(l.key) : undefined}
                      aria-label={`${componentName(l.component_id) || "Component"} grams — ${colLabel(c)}`}
                      required={i === 0}
                      className="h-8"
                      // The INHERITED grams, as a state of the record (LAYOUT.md §3's survivor rule).
                      placeholder={i > 0 ? (l.cells[matrixCols[0]] ?? "") : undefined}
                      value={l.cells[c] ?? ""}
                      onChange={(e) => setCell(l.key, c, e.target.value)}
                    />
                    {i === 0 ? <FieldError>{msgFor(costingFieldId.weightGrams(l.key))}</FieldError> : null}
                  </div>
                ))}
                <div className={CELL} />
                <div className={`${CELL} justify-end gap-0.5 pr-1`}>
                  <Tooltip label="Weight from length × width × GSM">
                    {/* button-shape: exempt -- a 28px icon square in a matrix cell */}
                    <button
                      type="button"
                      data-row-open
                      aria-label="Calculate grams from length, width and GSM"
                      onClick={captureDimsOrigin(() => {
                        setDims({ l: "", w: "", g: "" });
                        setDimsFor({ line: l.key, col: matrixCols[0] });
                      })}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-control text-muted-foreground hover:bg-primary-soft hover:text-primary"
                    >
                      <Ruler className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </Tooltip>
                  {lines.length > 1 ? (
                    // button-shape: exempt -- the row's ✕, a 28px icon square (data-row-remove for Ctrl+Del)
                    <button
                      type="button"
                      data-row-remove
                      aria-label="Remove component"
                      onClick={() => mutLines((xs) => xs.filter((x) => x.key !== l.key))}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-control text-muted-foreground hover:bg-danger-soft hover:text-danger"
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>
            ))}

            <div
              className={`${MATRIX_FOOT} sticky left-0 z-30 justify-start pl-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground`}
              style={{ gridColumn: `span ${ID_COLS}` }}
            >
              Fabric ₹ / {isSet ? "set" : "pc"}
            </div>
            {matrixCols.map((c) => (
              <div key={c} className={MATRIX_FOOT}>
                <Flash value={money(colCost(c))} formula="Σ Price / KG ÷ 1000 × grams × (1 + allowance %)" />
              </div>
            ))}
            <div className={MATRIX_FOOT} />
            <div className={MATRIX_FOOT} />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-row-add
          onClick={addLine}
        >
          + Add component
        </Button>
        {multiPiece ? (
          // SET BREAKDOWN (v2 §5.3) — one line per coordinate and the set total;
          // read-only, a document table (`paginate={false}`).
          <div className="pt-2">
            <DataTable
              columns={setBreakdownColumns}
              rows={setBreakdownRows}
              compact
              paginate={false}
              getKey={(r) => r.key}
              empty=""
            />
          </div>
        ) : null}
      </div>
    );
  };

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
  function sameAsFirst(pieceKey: string) {
    const first = pieces[0];
    if (!first) return;
    patchPiece(pieceKey, {
      cmt: first.cmt,
      print_cost: first.print_cost,
      embroidery_cost: first.embroidery_cost,
      wash_cost: first.wash_cost,
      testing_cost: first.testing_cost,
    });
    // Its trims too, when this piece has none of its own yet.
    if (!live.trims.some((t) => t.piece_key === pieceKey)) {
      const copies = live.trims.filter((t) => t.piece_key === first.key).map((t) => ({ ...t, key: newKey(), piece_key: pieceKey }));
      if (copies.length) mutTrims((xs) => [...xs.filter((t) => !isBlankTrim(t)), ...copies]);
    }
  }

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

  /* THE LEDGER COLUMN (layout plan B, user 2026-10-07): every card's header
     carries ITS OWN ₹ per piece at the right edge, so the three cost cards'
     figures stand in one column and add up to the Net cost in the footer —
     the right edge of a paper cost sheet. None of them repeats another's. */
  const testingPc = pieces.reduce((x, pc) => x + (num(pc.testing_cost) ?? 0), 0);
  const bankPc = pieces.reduce((x, pc) => x + (num(pc.bank_cost) ?? 0), 0);
  const cardBody: Record<Exclude<CardKey, "price">, { right?: ReactNode; content: ReactNode }> = {
    info: {
      content: (
        <div className="space-y-4">
          <div className={`${DETAILS_W} space-y-3`}>
            {/* WHAT IS BEING COSTED COMES FIRST (user 2026-10-07): the Sample No and
                Style row leads, so a new sheet's cursor lands on Sample No —
                the one question to answer before anything else. */}
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
                    fillFromCustomer(header.opportunity_id);
                  }}
                />
              </Field>
              <Field label="Costing No" htmlFor="sc-no">
                <Input
                  id="sc-no"
                  readOnly
                  value={meta.code ?? preview ?? ""}
                  className="w-auto min-w-[5.5rem] field-sizing-content max-sm:w-full"
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
      right: head ? <Flash value={`₹${money(head.fabric)}`} formula="Rate / KG × component weights" /> : null,
      content: (
        <div data-grid-style="sheet" className="[&_table]:table-fixed">
          <ChildGrid<FabricDraft>
            columns={costingFabricColumns}
            rows={fabrics}
            tableAlways
            keepOne
            removeHeader="Actions"
            addLabel="+ Add fabric"
            onAdd={() => {
              const f = blankFabric();
              mutFabrics((xs) => [...xs, f]);
            }}
            onRemove={(r) => mutFabrics((xs) => xs.filter((x) => x.key !== r.key))}
          />
        </div>
      ),
    },
    weights: {
      right: head ? <Flash value={`₹${money(head.cmt + head.process + testingPc)}`} formula="CMT + processing + testing" /> : null,
      content: (
        <div className="space-y-6">
          {consumptionMatrix()}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-xs font-semibold uppercase tracking-[.06em] text-muted-foreground">CMT & processing · ₹ per piece</h3>
              {multiPiece
                ? pieces.slice(1).map((pc) => (
                    <Button key={pc.key} type="button" variant="ghost" size="sm" onClick={() => sameAsFirst(pc.key)}>
                      {`Copy ${pieces[0]?.piece_name ?? "first"} → ${pc.piece_name}`}
                    </Button>
                  ))
                : null}
            </div>
            {/* default-row: exempt -- one row per garment piece, DERIVED from the style line's coordinates; it cannot grow */}
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
          </div>
        </div>
      ),
    },
    trims: {
      right: head ? <Flash value={`₹${money(head.trims + bankPc)}`} formula="Trims + bank charges" /> : null,
      content: (
        <div className="space-y-6">
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
          <div className="space-y-4">
            <h3 className="m-0 text-xs font-semibold uppercase tracking-[.06em] text-muted-foreground">Overheads</h3>
            <div className={TERMS_W}>
              <FieldRow gap="row" align="start">
                <Field label="Wastage %" w="hug" htmlFor="sc-waste">
                  <NumInput id="sc-waste" value={header.garment_waste_pct} onChange={(e) => setH({ garment_waste_pct: e.target.value })} />
                </Field>
                <Field label="Overhead %" w="hug" htmlFor="sc-ovh">
                  <NumInput id="sc-ovh" value={header.overhead_pct} onChange={(e) => setH({ overhead_pct: e.target.value })} />
                </Field>
                {/* Bank charges are per PIECE (costing spec §3.4). */}
                {pieces.map((p) => (
                  <Field key={p.key} label={multiPiece ? `Bank ₹ · ${p.piece_name}` : "Bank Charges ₹"} w="range">
                    <NumInput aria-label={`Bank charges — ${p.piece_name}`} value={p.bank_cost} onChange={(e) => patchPiece(p.key, { bank_cost: e.target.value })} />
                  </Field>
                ))}
              </FieldRow>
            </div>
          </div>
        </div>
      ),
    },
  };

  // ==========================================================================
  // THE SUMMARY CARD (clean spec §3 right column) — one sticky card: net cost,
  // margin, currency and rate, the FINAL FOB price, the quoted price. The
  // breakdown and the target calculator are there but folded away.
  // ==========================================================================
  const railData =
    summary.groups.find((g) => (g.groupId ?? "all") === railGroup) ?? summary.groups[0] ?? null;
  const t = railData?.total ?? null;
  const health = marginHealth(t?.effectiveMarginPct ?? null);
  const single = quoteRows.length === 1 ? quoteRows[0] : null;
  const unitWord = isSet ? "SET" : "PCS";
  const heroValue = t ? (t.quoted ?? t.calc) : null;
  const line = (label: string, value: string, opts: { total?: boolean; formula?: string } = {}) => (
    <div className={`flex items-baseline justify-between gap-3 leading-6 ${opts.total ? "mt-1 border-t border-border pt-1" : ""}`}>
      <dt className={`text-xs ${opts.total ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</dt>
      <dd className={`m-0 text-right text-xs ${opts.total ? "font-semibold text-foreground" : "text-foreground"}`}>
        <Flash value={value} formula={opts.formula} />
      </dd>
    </div>
  );
  const targetNum = num(targetPrice);
  const solve =
    t && targetNum != null
      ? solveTarget(t, header, targetNum, isSet ? pieces.length : 1, fabricKgFor(liveRows(draft).weights, railData?.groupId ?? null))
      : null;
  const disclosure = "cursor-pointer select-none text-xs font-semibold text-muted-foreground hover:text-foreground";

  /*
   * PRICE & QUOTE (layout plan B, user 2026-10-07) — the old right-hand
   * "Quotation summary" as the LAST card of the one column. The selling terms
   * sit together and come last in Tab order, which is also the order the
   * arithmetic runs; the price itself is repeated in the footer so it is in
   * view at every scroll position without a second column beside the cards.
   */
  const priceBody = {
    right:
      heroValue == null ? null : (
        <span className="flex items-baseline gap-2">
          <span className="text-primary">
            <Flash value={`${ccy ?? ""} ${heroValue.toFixed(2)}`.trim()} />
          </span>
          <span className="text-xs font-medium text-muted-foreground">/ {unitWord}</span>
          <span className={`text-xs ${health ? HEALTH[health].text : "text-muted-foreground"}`}>{pct(t?.effectiveMarginPct)}</span>
        </span>
      ),
    content: (
      <div className="space-y-5">
        <span className="sr-only" aria-live="polite">
          {heroValue == null ? "" : `Final FOB price ${ccy ?? ""} ${heroValue.toFixed(2)} per ${unitWord}, margin ${pct(t?.effectiveMarginPct)}`}
        </span>
        <div className={PRICE_W}>
          <FieldRow gap="row" align="start">
            <Field label="Margin %" required w="code" htmlFor={costingFieldId.margin}>
              <NumInput id={costingFieldId.margin} value={header.margin_pct} onChange={(e) => setH({ margin_pct: e.target.value })} />
            </Field>
            <Field label="Discount %" w="hug" htmlFor="sc-disc">
              <NumInput id="sc-disc" value={header.discount_pct} onChange={(e) => setH({ discount_pct: e.target.value })} />
            </Field>
            <Field label="Currency" required w="code">
              <CurrencyPicker label="Currency" compact currencies={data.currencies} value={header.currency_code} canCreate={false} canEdit={false} onChange={onCurrency} />
            </Field>
            <Field label="Exchange Rate ₹" required w="code" htmlFor={costingFieldId.rate}>
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
            {single ? (
              <Field label={`Quoted Price ${ccy ?? ""} / ${unitWord}`.trim()} w="code" htmlFor="sc-quoted">
                <NumInput id="sc-quoted" className="font-semibold" value={quotes[single.key] ?? ""} onChange={(e) => setQuote(single.key, e.target.value)} />
              </Field>
            ) : null}
          </FieldRow>
        </div>
        <div>
          {/* No figure yet → the sentence alone; a lone "— / PCS" read as a stray rule. */}
          <div className={heroValue == null ? "hidden" : "flex items-baseline gap-2"}>
            <span className="text-3xl font-bold leading-none tracking-tight text-primary">
              <Flash value={heroValue == null ? "—" : `${ccy ?? ""} ${heroValue.toFixed(2)}`.trim()} />
            </span>
            <span className="text-sm font-medium text-muted-foreground">/ {unitWord}</span>
          </div>
          {heroValue == null ? (
            <p className="m-0 text-xs text-muted-foreground">Add the fabric, weights, margin and exchange rate to see the price.</p>
          ) : (
            <p className="m-0 mt-2 text-xs tabular-nums text-muted-foreground">
              {`Calculated ${t?.calc == null ? "—" : t.calc.toFixed(4)}`}
              <span className="mx-1.5">·</span>
              <span className={`font-semibold ${health ? HEALTH[health].text : ""}`}>{`${pct(t?.effectiveMarginPct)} margin`}</span>
              {t?.delta != null && Math.abs(t.delta) > 0.00005 ? (
                <>
                  <span className="mx-1.5">·</span>
                  <DeltaBadge delta={t.delta} pctValue={t.deltaPct} />
                </>
              ) : null}
            </p>
          )}
          {isSet && railData ? (
            <ul className="m-0 mt-3 list-none space-y-0.5 p-0 text-xs">
              {railData.pieces.map((pc) => (
                <li key={pc.pieceKey} className="flex justify-between tabular-nums">
                  <span className="text-muted-foreground">{pieceName(pc.pieceKey)}</span>
                  <span className="text-foreground">{(pc.quoted ?? pc.calc)?.toFixed(2) ?? "—"}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {summary.belowFloor ? <p className="m-0 mt-2 text-xs text-danger">{floorSentence(summary.lowestMarginPct)}</p> : null}
        </div>
        {quoteRows.length > 1 ? (
          // default-row: exempt -- rows are DERIVED: one per piece × size group the Consumption names
          <div id="sc-quote-matrix" data-grid-style="sheet" className="[&_table]:table-fixed">
            <ChildGrid<QuoteRow>
              // grid-caption: exempt -- the card holds the charges above this grid
              label="Quote matrix — a price per piece and size group"
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
        <div className="flex flex-wrap items-start gap-x-10 gap-y-3 border-t border-border pt-3">
          <details className="w-full max-w-[24rem]">
            <summary className={disclosure}>Cost breakdown</summary>
            {summary.groups.length > 1 ? (
              <div className="mt-2">
                <Select aria-label="Size group shown" className="h-8 w-auto text-xs" value={railData ? (railData.groupId ?? "all") : "all"} onChange={(e) => setRailGroup(e.target.value)}>
                  {summary.groups.map((g) => (
                    <option key={g.groupId ?? "all"} value={g.groupId ?? "all"}>
                      {groupName(g.groupId)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <dl className="m-0 mt-2">
              {line("Fabric", money(t?.fabric))}
              {line("CMT & processing", money(t ? t.cmt + t.process + pieces.reduce((x, pc) => x + (num(pc.testing_cost) ?? 0), 0) : null))}
              {line("Trims & accessories", money(t?.trims))}
              {line("Bank charges", money(t ? pieces.reduce((x, pc) => x + (num(pc.bank_cost) ?? 0), 0) : null))}
              {line("Net cost ₹", money(t?.net), { total: true })}
              {line(`Wastage ${header.garment_waste_pct || 0}%`, money(t?.wastage))}
              {line(`Overhead ${header.overhead_pct || 0}%`, money(t?.overhead))}
              {line("Gross cost ₹", money(t?.grossCost), { total: true, formula: "Net + Wastage + Overhead" })}
              {line(`Margin ${header.margin_pct || 0}%`, money(t?.margin))}
              {line(`Discount ${header.discount_pct || 0}%`, t?.discount ? `−${money(t.discount)}` : money(0))}
              {line("Price ₹", money(t?.gross), { total: true, formula: "Gross cost + Margin − Discount" })}
            </dl>
          </details>
          <details className="w-full max-w-[24rem]">
            <summary className={disclosure}>Work back from a target price</summary>
            <div className="mt-3 space-y-2">
              <Field label={`Buyer's target ${ccy ?? ""} / ${unitWord}`.trim()} w="code" htmlFor="sc-target">
                <NumInput id="sc-target" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} />
              </Field>
              {solve ? (
                <div className="space-y-1.5 text-xs">
                  <p className="m-0 text-foreground">
                    {"It leaves "}
                    <span className={`font-semibold ${HEALTH[marginHealth(solve.marginPct) ?? "poor"].text}`}>{pct(solve.marginPct)}</span>
                    {" margin."}
                  </p>
                  {solve.clearsFloor ? (
                    <p className="m-0 text-muted-foreground">{`That clears the ${MARGIN_FLOOR_PCT}% floor.`}</p>
                  ) : (
                    <p className="m-0 text-muted-foreground">
                      {`To reach ${MARGIN_FLOOR_PCT}%: ₹${money(solve.costCut)} / ${isSet ? "set" : "pc"} less cost`}
                      {solve.perKgFabric != null ? ` — about ₹${money(solve.perKgFabric)} / kg on fabric, or ₹${money(solve.costCut)} on CMT.` : "."}
                    </p>
                  )}
                  {single ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setQuote(single.key, targetPrice.trim())}>
                      Quote at this price
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    ),
  };

  /* WHY IT IS WITH THE MD (UX plan P3.2): the lowest-margin piece, how far it
     sits under the floor in rupees, and quoted against calculated price. */
  const lowest = (() => {
    let best: { piece: string; group: string | null; fig: CostingSummary["groups"][number]["pieces"][number] } | null = null;
    for (const g of summary.groups)
      for (const pc of g.pieces)
        if (pc.effectiveMarginPct != null && (best == null || pc.effectiveMarginPct < (best.fig.effectiveMarginPct ?? Infinity)))
          best = { piece: pc.pieceKey, group: g.groupId, fig: pc };
    return best;
  })();
  const lowestGap =
    lowest && (lowest.fig.quoted ?? lowest.fig.calc) != null
      ? solveTarget({ net: lowest.fig.net }, header, (lowest.fig.quoted ?? lowest.fig.calc) as number, 1, 0)
      : null;
  const whyCard =
    meta.status === "submitted" && lowest ? (
      <section className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-foreground">Why this costing is with the MD</b>
          <StatusPill tone="warning">{pct(lowest.fig.effectiveMarginPct)} margin</StatusPill>
        </div>
        <p className="m-0 mt-1 text-foreground">
          {`Lowest: ${pieceName(lowest.piece)}, ${groupName(lowest.group)} — quoted ${ccy ?? ""} ${(lowest.fig.quoted ?? lowest.fig.calc)?.toFixed(2) ?? "—"} against a calculated ${lowest.fig.calc?.toFixed(2) ?? "—"}.`}
          {lowestGap && !lowestGap.clearsFloor ? ` ₹${money(lowestGap.costCut)} / pc under the ${MARGIN_FLOOR_PCT}% floor.` : ""}
        </p>
      </section>
    ) : null;


  /**
   * One section of the sheet — ORDER ENTRY'S SHAPE (browser compare 2026-10-07):
   * the pane is already the frame, so a section is a heading and its fields,
   * divided from the next by a hairline. A bordered card inside the bordered
   * pane drew two frames around every field; Order Entry draws one.
   */
  const cardSection = (c: (typeof CARDS)[number], i: number) => {
    const b = c.key === "price" ? priceBody : cardBody[c.key];
    return (
      <section key={c.key} id={cardAnchor(c.key)} className={`scroll-mt-4 ${i > 0 ? "border-t border-border pt-5" : ""}`}>
        <header className="mb-3 flex items-baseline gap-3">
          <h2 className="m-0 flex-1 text-[13px] font-semibold uppercase tracking-[.04em] text-foreground">{c.label}</h2>
          {b.right ? <span className="text-sm font-semibold tabular-nums text-foreground">{b.right}</span> : null}
        </header>
        {b.content}
      </section>
    );
  };

  /*
   * THE WORKSPACE (layout plan B, user 2026-10-07: "use page edge to edge") —
   * ONE column of cards across the whole pane, no grey canvas and no side
   * panel. The split it replaces never shared a top or bottom edge with the
   * cards, starved the CMT grid below its 776px at 1366 (trap #17) and left
   * an empty strip beside the cards once scrolled (trap #16). The price now
   * rides in the footer (`dock`), which is in view at every width, so the
   * tablet price bar went with the aside.
   */
  const workspace = (
    <div className="space-y-5">
      {copiedFrom ? (
        <p className="m-0 rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-foreground">
          {`Copied from ${copiedFrom}. Check the figures, then save.`}
        </p>
      ) : null}
      {CARDS.map((c, i) => cardSection(c, i))}
    </div>
  );

  /* THE PRICE DOCK — read-only, in the footer's status slot: Net → Margin →
     FOB. No field lives here, so Tab and the arrows never land in a pinned
     bar; the FOB figure scrolls to Price & quote for the mouse. */
  const footerWord = dirty
    ? "Unsaved changes"
    : revisingFrom
      ? `New ${revisionShort(meta.version)}`
      : editId
        ? "Editing sample costing"
        : "New sample costing";
  const dock = (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
      <span className="max-sm:hidden">
        {"Net "}
        <b className="text-sm text-foreground">{`₹ ${money(t?.net)}`}</b>
      </span>
      <span aria-hidden className="max-sm:hidden">
        →
      </span>
      <span>
        {"Margin "}
        <b className={`text-sm ${health ? HEALTH[health].text : "text-foreground"}`}>{pct(t?.effectiveMarginPct)}</b>
      </span>
      <span aria-hidden>→</span>
      <button type="button" tabIndex={-1} onClick={() => scrollToCard("quotation")} className="inline-flex items-baseline gap-1 hover:underline">
        {"FOB "}
        <b className="text-base text-primary">{heroValue == null ? "—" : `${ccy ?? ""} ${heroValue.toFixed(2)}`.trim()}</b>
        {` / ${unitWord}`}
      </button>
      <span className="max-md:hidden">{`· ${footerWord}`}</span>
    </span>
  );

  const sections: FullScreenSection[] = [
    {
      key: "costing",
      label: "Sample Costing",
      icon: Calculator,
      done: !!header.opportunity_id && !!header.style_id,
      problems: validity.blocking.length,
      // Edge to edge (user 2026-10-07): the 1720 cap, footer included.
      wide: true,
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

  /** Copy from… (P2.2): every other live costing, the same customer first, newest first. */
  const copyCandidates = current
    .filter((r) => r.id !== editId && r.id !== revisingFrom)
    .sort((a, b) => {
      const ca = a.customer_name && a.customer_name === enquiry?.customer_name ? 0 : 1;
      const cb = b.customer_name && b.customer_name === enquiry?.customer_name ? 0 : 1;
      return ca - cb || b.created_at.localeCompare(a.created_at);
    });

  /** Revision compare (P3.1): only the figures that differ, old → new. */
  const compareRows = (() => {
    if (!compare) return [] as { key: string; label: string; before: string; after: string }[];
    const a = compare.record.draft;
    const out: { key: string; label: string; before: string; after: string }[] = [];
    const push = (label: string, before: string, after: string) => {
      if (before !== after) out.push({ key: `${label}-${out.length}`, label, before: before || "—", after: after || "—" });
    };
    const terms: [string, keyof CostingHeaderDraft][] = [
      ["Margin %", "margin_pct"],
      ["Wastage %", "garment_waste_pct"],
      ["Overhead %", "overhead_pct"],
      ["Discount %", "discount_pct"],
      ["Freight / pc ₹", "freight_per_pc"],
      ["Insurance / pc ₹", "insurance_per_pc"],
      ["Exchange rate", "exchange_rate"],
      ["Currency", "currency_code"],
    ];
    for (const [label, k] of terms) push(label, String(a.header[k] ?? ""), String(header[k] ?? ""));
    const fabA = liveRows(a).fabrics;
    const names = new Set([...fabA.map((f, i) => fabricLabel(f, i)), ...live.fabrics.map((f, i) => fabricLabel(f, i))]);
    for (const n of names) {
      const fa = fabA.find((f, i) => fabricLabel(f, i) === n);
      const fb = live.fabrics.find((f, i) => fabricLabel(f, i) === n);
      push(`${n} · Price / KG`, fa ? money(fabricPricePerKg(fa)) : "", fb ? money(fabricPricePerKg(fb)) : "");
    }
    const pieceFields: [string, keyof PieceDraft][] = [
      ["CMT", "cmt"],
      ["Print", "print_cost"],
      ["Embroidery", "embroidery_cost"],
      ["Wash", "wash_cost"],
      ["Testing", "testing_cost"],
      ["Bank", "bank_cost"],
    ];
    for (const pb of pieces) {
      const pa = a.pieces.find((x) => x.piece_name === pb.piece_name);
      for (const [label, k] of pieceFields) push(`${pb.piece_name} · ${label}`, String(pa?.[k] ?? ""), String(pb[k] ?? ""));
    }
    const ta = summaryOf(a).groups[0]?.total;
    const tb = head;
    if (ta && tb) {
      push("Fabric cost ₹", money(ta.fabric), money(tb.fabric));
      push("Net cost ₹", money(ta.net), money(tb.net));
      push("Gross cost ₹", money(ta.grossCost), money(tb.grossCost));
      push("Price ₹", money(ta.gross), money(tb.gross));
      push(`Calc ${ccy ?? ""}`.trim(), ta.calc == null ? "" : ta.calc.toFixed(4), tb.calc == null ? "" : tb.calc.toFixed(4));
      push(`Quoted ${ccy ?? ""}`.trim(), ta.quoted == null ? "" : ta.quoted.toFixed(2), tb.quoted == null ? "" : tb.quoted.toFixed(2));
      push("Margin %", pct(ta.effectiveMarginPct), pct(tb.effectiveMarginPct));
    }
    return out;
  })();
  const compareColumns: Column<{ key: string; label: string; before: string; after: string }>[] = [
    { header: "Changed", cell: (r) => <span className="text-xs">{r.label}</span> },
    {
      header: compare ? revisionShort(compare.record.version) : "Other",
      align: "right",
      cell: (r) => <span className="block text-right font-mono text-xs tabular-nums text-muted-foreground">{r.before}</span>,
    },
    {
      header: revisingFrom ? `${revisionShort(meta.version)} (new)` : revisionShort(meta.version),
      align: "right",
      cell: (r) => <span className="block text-right font-mono text-xs font-semibold tabular-nums">{r.after}</span>,
    },
  ];

  // ---- the L × W × GSM calculator ----------------------------------------------
  const dimsLine = lines.find((l) => l.key === dimsFor?.line) ?? null;
  const dimsGrams = dimensionalGrams({ length_cm: dims.l, width_cm: dims.w, gsm: dims.g });
  const setDim = (patch: Partial<typeof dims>) => {
    const next = { ...dims, ...patch };
    setDims(next);
    const g = dimensionalGrams({ length_cm: next.l, width_cm: next.w, gsm: next.g });
    // All three in → the cell takes the grams; the figure is the record's.
    if (g != null && dimsFor) setCell(dimsFor.line, dimsFor.col, String(g));
  };

  /** v2 §4.1: red (< 15 %) waits for approval before a quotation goes out. */
  const quoteBlocked =
    health === "poor" && meta.status !== "approved"
      ? `Margin under ${MARGIN_RED_BELOW_PCT}% — the quotation waits until the costing is approved.`
      : null;

  const fabricDetailFabric = fabricDetailKey ? (fabrics.find((x) => x.key === fabricDetailKey) ?? null) : null;

  if (mode === "edit") {
    const canSubmit = !!editId && !revisingFrom && isEditableStatus(meta.status) && !meta.isDraft && perms.canEdit;
    const context = [enquiry?.code, style?.name, enquiry?.customer_name, [enquiry?.season, enquiry?.season_year].filter(Boolean).join(" ")].filter(Boolean);
    return (
      <div className="flex h-full flex-col gap-3">
        {/* HEADER — ORDER ENTRY'S BAND (browser compare 2026-10-07): what the
            screen is doing · the document number, a hairline to the actions.
            The mono "CST/… · Rev 0" line and the ghost / outline / filled mix
            of buttons were the two things that read as a different app. */}
        <div data-focus-region="header" className="flex w-full flex-wrap items-baseline gap-x-6 gap-y-2 max-md:gap-x-2">
          <Button variant="ghost" size="sm" onClick={closeEditor} aria-label="Back to list" className="h-10 w-10 shrink-0 px-0 text-lg md:hidden">
            ←
          </Button>
          <div className="flex min-w-0 shrink-0 items-baseline gap-2 max-md:shrink max-md:flex-wrap">
            <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
              {revisingFrom ? "Revise Sample Costing" : !editable ? "View Sample Costing" : editId ? "Edit Sample Costing" : "New Sample Costing"}
            </span>
            <span className="text-sm font-semibold text-foreground">{meta.code ?? preview ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{revisionShort(meta.version)}</span>
            {revisingFrom ? (
              <StatusPill tone="info">New revision</StatusPill>
            ) : editId ? (
              <StatusPill tone={meta.isDraft ? "neutral" : STATUS_TONE[meta.status]}>{meta.isDraft ? "Draft" : STATUS_LABEL[meta.status]}</StatusPill>
            ) : null}
          </div>
          {context.length ? (
            <span className="min-w-0 max-w-[28rem] text-xs text-muted-foreground max-lg:hidden">
              <Truncated>{context.join("  ·  ")}</Truncated>
            </span>
          ) : null}
          <div aria-hidden className="h-px min-w-[2rem] flex-1 self-center bg-border" />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {editable && copyCandidates.length ? (
              <Button variant="outline" size="sm" onClick={() => setCopyOpen(true)}>
                <Copy className="h-4 w-4" aria-hidden /> Copy from
              </Button>
            ) : null}
            {revisions.length > 1 && editId ? (
              <Button variant="outline" size="sm" onClick={() => openCompare(revisions.find((r) => r.id !== editId)!.id)}>
                <GitCompare className="h-4 w-4" aria-hidden /> Compare
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={downloadCostSheet}>
              <FileDown className="h-4 w-4" aria-hidden /> Cost sheet
            </Button>
            <Tooltip label={quoteBlocked ?? "Prices only, for the buyer"}>
              <Button variant="outline" size="sm" onClick={downloadQuotation} disabled={!header.currency_code || !!quoteBlocked}>
                <FileText className="h-4 w-4" aria-hidden /> Quotation
              </Button>
            </Tooltip>
            {meta.status === "approved" && !revisingFrom && perms.canEdit ? (
              <Button variant="outline" size="sm" onClick={revise}>
                Revise
              </Button>
            ) : null}
            {canSubmit ? (
              <Button size="sm" onClick={sendForApproval} disabled={isPending}>
                Submit
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={closeEditor} className="max-md:hidden">
              ← Back to list
            </Button>
          </div>
        </div>

        {whyCard}
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
          // One section: the canvas is the whole costing, so there is no rail.
          railCollapsed
          locked={lockMessage ? { message: lockMessage } : false}
          footer={{
            status: dock,
            onCancel: closeEditor,
            onSave: () => submit(false),
            saveLabel: revisingFrom ? `Save ${revisionShort(meta.version)}` : "Save costing",
            canSave: validity.canSave,
            // Save names the first missing field and steers to it with a brief
            // ring (clean spec §4) — no counts, no progress bar.
            onBlockedSave: revealFirstProblem,
            // THE DRAFT OFFER LIVES IN THE BOTTOM BAR (user 2026-10-07), beside
            // the buttons that act on the whole sheet — not as a banner taking
            // the top of the canvas.
            extra: formDraft.hasDraft ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-warning">Unsaved changes from an earlier visit</span>
                <Button type="button" size="sm" onClick={formDraft.restore}>
                  Restore
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={formDraft.discard}>
                  Discard
                </Button>
              </span>
            ) : undefined,
            onSaveDraft: (editId ? perms.canEdit : perms.canCreate) && !revisingFrom ? () => submit(true) : undefined,
            isPending,
          }}
        />

        {/* FABRIC ▸ DETAIL — the rate breakdown, Order Entry ▸ Combos' sheet. */}
        <SubDetailSheet
          open={!!fabricDetailFabric}
          onClose={() => setFabricDetailKey(null)}
          origin={fabricOrigin}
          grid
          parent="costing"
          title={`Fabric rate — ${fabricDetailFabric?.quality || "fabric"}`}
        >
          {fabricDetailFabric ? fabricDetail(fabricDetailFabric) : null}
        </SubDetailSheet>

        <SubDetailSheet
          open={!!dimsLine}
          onClose={() => setDimsFor(null)}
          origin={dimsOrigin}
          parent="costing"
          title={`Grams from dimensions${dimsLine ? ` — ${componentName(dimsLine.component_id) || "component"}` : ""}`}
        >
          {dimsLine && dimsFor ? (
            <div className="space-y-4">
              {matrixCols.length > 1 ? (
                <Field label="Size group" w="term" htmlFor="sc-dim-col">
                  <Select id="sc-dim-col" value={dimsFor.col} onChange={(e) => setDimsFor({ ...dimsFor, col: e.target.value })}>
                    {matrixCols.map((c) => (
                      <option key={c} value={c}>
                        {colLabel(c)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <FieldRow gap="row" align="start">
                <Field label="Length (cm)" w="hug" htmlFor="sc-dim-l">
                  <NumInput id="sc-dim-l" value={dims.l} onChange={(e) => setDim({ l: e.target.value })} />
                </Field>
                <Field label="Width (cm)" w="hug" htmlFor="sc-dim-w">
                  <NumInput id="sc-dim-w" value={dims.w} onChange={(e) => setDim({ w: e.target.value })} />
                </Field>
                <Field label="GSM" w="hug" htmlFor="sc-dim-g">
                  <NumInput id="sc-dim-g" value={dims.g} onChange={(e) => setDim({ g: e.target.value })} />
                </Field>
              </FieldRow>
              <p className="text-sm">
                <span className="text-muted-foreground">Grams = L × W × GSM ÷ 10 000 = </span>
                <span className="font-semibold tabular-nums text-info">{dimsGrams == null ? "—" : `${money(dimsGrams, 1)} g`}</span>
              </p>
              <p className="text-xs text-muted-foreground">Once all three are in, the {colLabel(dimsFor.col)} cell takes this weight.</p>
            </div>
          ) : null}
        </SubDetailSheet>

        <SubDetailSheet open={copyOpen} onClose={() => setCopyOpen(false)} parent="costing" title="Copy from an earlier costing" footer={null}>
          <p className="mb-3 text-xs text-muted-foreground">
            Brings over fabrics, weights, CMT, trims and terms. This sheet keeps its own sample, style, date and quotes.
          </p>
          <ul className="m-0 list-none space-y-2 p-0">
            {copyCandidates.slice(0, 30).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => copyFrom(r.id)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left hover:border-primary/50 hover:bg-primary-soft"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{`${r.code ?? "—"} · ${revisionShort(r.version)}`}</span>
                    <span className="font-mono text-xs tabular-nums">{r.target_fob != null ? `${r.currency_code ?? ""} ${money(r.target_fob)}` : "—"}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[r.customer_name, r.style_name, STATUS_LABEL[r.status], fmtDate(r.costing_date)].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </SubDetailSheet>

        <SubDetailSheet open={compareOpen} onClose={() => setCompareOpen(false)} parent="costing" grid title="Compare revisions">
          <div className="space-y-3">
            <Field label="Compare with" w="term" htmlFor="sc-cmp">
              <Select id="sc-cmp" value={compare?.id ?? ""} onChange={(e) => openCompare(e.target.value)}>
                {revisions
                  .filter((r) => r.id !== editId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {revisionLabel(r.version)}
                    </option>
                  ))}
              </Select>
            </Field>
            {compare ? (
              <DataTable
                columns={compareColumns}
                rows={compareRows}
                compact
                paginate={false}
                getKey={(r) => r.key}
                empty="No figure differs between these two revisions."
              />
            ) : (
              <p className="text-xs text-muted-foreground">Loading the other revision…</p>
            )}
          </div>
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
