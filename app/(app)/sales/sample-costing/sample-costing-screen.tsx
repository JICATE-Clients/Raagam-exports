"use client";

/**
 * Sample ▸ Sample Costing — the list, and the cost sheet editor as a PAGE mode
 * of it. Data: doc/sample/sample-costing-specification.md (0688 · 0689 · 0690).
 * Layout: doc/sample/sample-costing-uiux-design-spec.md (2026-10-07).
 *
 * THE LAYOUT — THE STEP PAGE (user 2026-10-08, mockup "Sample Costing Modern")
 *
 *   (price bar + step chips removed 2026-10-08, user: the summary rail and step headers carry it)
 *   ┌────────────────────────────────────────────────────┬──────────────────────┤
 *   │ ONE STEP OPEN AT A TIME (useAccordion). A closed    │ QUOTATION SUMMARY    │
 *   │ step is one line: its name, what is inside, its     │ (sticky): breakdown, │
 *   │ ₹ per piece. Seven steps, in the order the sum runs. │ FOB, where the price │
 *   │                                                     │ goes, work back from │
 *   │                                                     │ a target             │
 *   └────────────────────────────────────────────────────┴──────────────────────┘
 *
 * - SEVEN STEPS: Trims and Overheads were one card until the client asked for
 *   them apart, and CMT, Embellishment and Testing sit together in one step, apart
 *   from the Garment weight table (user 2026-10-08).
 *   Trims is the trim lines; Overheads is bank charges, wastage % and overhead %;
 *   CMT & charges holds CMT as ONE ROW per piece (Direct rate, or one box per CMT
 *   operation), then Embellishment and Testing, then the piece's closing sum.
 * - A FABRIC IS ONE ROW (Fabric · Uses · Price · Cost · icons), and the rate
 *   is built INLINE under the row — no popup sheet. "Uses" is READ from the
 *   Component weights (the kilos of this fabric one piece takes, allowance
 *   included); it is not a second place to type a weight.
 * - THE CHIPS AND THE ICONS ARE OFF THE TAB PATH (Tab lands on fields). Each
 *   step's HEADER is a Tab stop (`data-row-open`), so tabbing off the last
 *   field of a step lands on the next header, which claims it open and folds
 *   the one behind.
 * - COLOURS ARE THE APP'S TOKENS, NOT THE MOCKUP'S HEX: primary for actions
 *   and the price, success / warning / danger for margin health.
 * - KEYBOARD IS THE APP CONTRACT (raagam-keyboard-contract): Tab / Enter /
 *   arrows / Ctrl+S / Ctrl+Del come from lib/focus.ts. The spec's "Esc
 *   restores the cell" is NOT built — Esc is the app-wide close-one-layer
 *   ladder, and a per-screen key handler would replace the contract here.
 * - NO "Recalculate" BUTTON and NO DEBOUNCE: every figure is a pure function
 *   of the inputs (lib/sales/sample-costing/calc.ts) and recomputes on the
 *   keystroke. NO SLIDERS: a number box is typed and tabbed.
 * - Pricing is calc.ts's and nothing here recomputes it: the price bar, the
 *   step amounts, the summary and the "where the price goes" bar all read the
 *   same `summary`.
 *
 * HOOKS ABOVE EVERY EARLY RETURN (AGENTS.md): the editor returns at
 * `if (mode === "edit")`, so every hook here is declared above it.
 */

import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Calculator,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GitCompare,
  ClipboardList,
  FileText,
  Pencil,
  RefreshCw,
  Ruler,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ToggleGroup } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { Field, FieldError, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { Tooltip } from "@/components/ui/tooltip";
import { ChildGrid, gridKeyNav, type ChildGridColumn } from "@/components/masters/child-grid";
import { MATRIX_HEAD, MATRIX_SIZE_TOKEN, matrixCell } from "@/components/orders/matrix-grid";
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
import { useAccordion } from "@/lib/ui/use-accordion";
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
  extraChargeAmount,
  fabricKgFor,
  solveTarget,
  fabricPricePerKg,
  fabricSubtotal,
  gramsOf,
  hasYarnMix,
  marginHealth,
  num,
  pieceCmt,
  pieceEmbellishment,
  trimCostPerPiece,
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
  isBlankPieceLine,
  isBlankExtra,
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
  type ExtraChargeDraft,
  type FabricDraft,
  type FabricProcessDraft,
  type PieceDraft,
  type PieceLineDraft,
  type PieceLineKind,
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
import { exportQuotationPdf } from "@/lib/sales/sample-costing/quotation-export";
import { offeredSizes, sizesNotInStyle } from "@/lib/sales/sample-costing/style-sizes";
import {
  ALL_SIZES,
  cellGrams,
  columnsOf,
  isBlankLine,
  linesToWeights,
  lossFor,
  weightsToLines,
  type ConsumptionLine,
  type LossBySize,
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
 * Overheads ▸ the COST adds only: Wastage / Overhead hug 88 ×2 · Bank
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
 * THE STEPS, in calculation order. The rules (`costingProblems`) name six
 * sections; the page has seven steps (Trims, Overheads and CMT apart), and `cardOf`
 * says which step holds each section's fields. A rule about wastage or
 * overhead has no field id of its own and lands on Price & quote, as before.
 */
type CardKey = "info" | "fabrics" | "weights" | "cmt" | "trims" | "overheads" | "price";
const CARDS: { key: CardKey; label: string }[] = [
  { key: "info", label: "Costing details" },
  { key: "fabrics", label: "Fabric" },
  { key: "weights", label: "Garment weight" },
  { key: "cmt", label: "CMT & charges" },
  { key: "trims", label: "Trims" },
  { key: "overheads", label: "Overheads" },
  { key: "price", label: "Price & quote" },
];
const cardOf = (k: CostingSection): CardKey => (k === "consumption" ? "weights" : k === "quotation" ? "price" : k);
/** The DOM id a card is scrolled to. */
const cardAnchor = (k: CardKey) => `sc-card-${k}`;

/** A blank CMT operation / Embellishment row — every key it stamps is blank
 *  except its kind, which `isBlankPieceLine` deliberately does not read. */
const blankPieceLine = (kind: PieceLineKind): PieceLineDraft => ({
  key: `l${crypto.randomUUID()}`,
  kind,
  process_id: null,
  process_name: "",
  rate: "",
});

/**
 * A PIECE OPENS READY, NOT WITH A BLANK LINE. CMT is one ROW of boxes, one per
 * CMT operation in the Process master (user 2026-10-08), so there is no list to
 * seed: a box with a number IS a line and an emptied box removes it, which keeps
 * a blank row from ever being saved. `[]` — a record saved with no operations, or
 * a draft restored from before 0692 that has no `lines` at all — is simply "no
 * rates yet". EMBELLISHMENT IS THE OPTIONAL LIST: most pieces have none, so it
 * opens with a calm "none" line and "+ Add embellishment" adds the first row.
 * Normalised in STATE by the open handlers, never by a grid's `seedRow`, which
 * would mark an untouched sheet "Unsaved".
 */
function seedPiece(p: PieceDraft): PieceDraft {
  const lines = (p.lines as PieceLineDraft[] | undefined) ?? [];
  return {
    ...p,
    cmt_direct: (p.cmt_direct as boolean | undefined) ?? true,
    // A blank CMT line (a draft from before CMT became a row) names no operation: drop it.
    lines: lines.filter((l) => l.kind !== "cmt" || l.process_id),
  };
}
const copyPieceLines = (lines: readonly PieceLineDraft[]): PieceLineDraft[] =>
  lines.map((l) => ({ ...l, key: `l${crypto.randomUUID()}` }));

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
  /** Garment weight as a matrix (0693): lines × the style sizes the operator
   *  chose, plus a Loss % per size. The stored `WeightDraft` rows are DERIVED
   *  from these (matrix.ts). `sizeCols` holds size NAMES, in the order added. */
  const [lines, setLines] = useState<ConsumptionLine[]>([]);
  const [sizeCols, setSizeCols] = useState<string[]>([]);
  const [loss, setLoss] = useState<LossBySize>({});
  const [trims, setTrims] = useState<TrimDraft[]>([]);
  /** The Overheads and Price & quote "+ Add" rows (0695), both sections in one list. */
  const [extras, setExtras] = useState<ExtraChargeDraft[]>([]);
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(nextCostingNo);
  const [approval, setApproval] = useState<{ forId: string; run: ApprovalRun | null; verdict: CanActVerdict | null } | null>(null);
  /** A Save was attempted — a row's messages show from then on. */
  const [tried, setTried] = useState(false);
  /** Which size the rail shows when the sheet costs more than one. */
  const [railGroup, setRailGroup] = useState<string>("all");
  /** Which view of the Quotation summary is open under the waterfall. */
  const [railTab, setRailTab] = useState<"breakdown" | "whatif" | "target">("breakdown");
  /** Breakdown shows Net · Gross · Price; this opens the other lines. */
  const [railAll, setRailAll] = useState(false);
  /** CMT & charges ▸ "Hide operations": pieces whose per-operation strip is folded away. Display only — a folded strip keeps every value. */
  const [opsHidden, setOpsHidden] = useState<Record<string, boolean>>({});
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

  // ---- a fabric's rate build-up — a POPUP off its row (user 2026-10-08: "card aa
  // popup mari kondu va"). It was inline under the row; the sheet grows out of the
  // chevron that opened it. One open at a time by construction.
  const [buildKey, setBuildKey] = useState<string | null>(null);
  const [buildOrigin, captureBuildOrigin] = useSubSheetOrigin();
  const [buildTab, setBuildTab] = useState<"mix" | "process">("mix");

  // ---- the steps: ONE open at a time (AGENTS.md "Folds are accordions") ----------
  // Tab or a click into a step opens it and folds the one behind.
  const fold = useAccordion("info");
  const scrollToCard = (k: CostingSection, land = false) => {
    const key = cardOf(k);
    fold.setOpenKey(key);
    // The body mounts on the next commit; scroll and land after it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById(cardAnchor(key));
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (land && el) focusFirstField(el);
      }),
    );
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
  const weights = linesToWeights(lines, sizeCols, loss);
  const draft: CostingDraft = { header, pieces, fabrics, weights, trims, quotes, extras };
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
  /** A size's label: its name, or "All sizes" for a legacy row that names none. */
  const sizeLabel = (size: string | null) => size ?? "All sizes";
  const fabricLabel = (f: FabricDraft, i: number) =>
    f.quality.trim() || data.fabrics.find((x) => x.id === f.fabric_id)?.name || `Fabric ${i + 1}`;
  const componentName = (id: string | null) => data.components.find((c) => c.id === id)?.name ?? "";

  /** A piece's labour: CMT (Direct rate or operations) + embellishment + testing. */
  const labourOf = (p: PieceDraft) => pieceCmt(p) + pieceEmbellishment(p) + (num(p.testing_cost) ?? 0);

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
  const mutExtras = mut<ExtraChargeDraft>(setExtras);
  const patchPiece = (key: string, patch: Partial<PieceDraft>) =>
    mutPieces((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const patchFabric = (key: string, patch: Partial<FabricDraft>) =>
    mutFabrics((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const patchLine = (key: string, patch: Partial<ConsumptionLine>) =>
    mutLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setCell = (key: string, col: string, v: string) =>
    mutLines((xs) => xs.map((x) => (x.key === key ? { ...x, cells: { ...x.cells, [col]: v } } : x)));
  const patchExtra = (key: string, patch: Partial<ExtraChargeDraft>) =>
    mutExtras((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const patchTrim = (key: string, patch: Partial<TrimDraft>) =>
    mutTrims((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  // ---- factories — every key a factory stamps is blank, except a row's piece
  // and the spec's 3 % allowance, neither of which `isBlank*` reads (AGENTS.md
  // "THE SEEDED ROW IS SAVED UNLESS THE SAVE SIDE DROPS IT"). ---------------
  const blankPiece = (name: string, coordinateId: string | null): PieceDraft =>
    seedPiece({
      key: newKey(),
      piece_name: name,
      coordinate_id: coordinateId,
      cmt: "",
      cmt_direct: true,
      lines: [],
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
    cells: {},
  });
  // `kind: "flat"` and `sign: "add"` are read by no `isBlankExtra` clause, so a row added and left untouched saves nothing.
  const blankExtra = (section: ExtraChargeDraft["section"]): ExtraChargeDraft => ({
    key: newKey(),
    section,
    name: "",
    kind: "flat",
    value: "",
    sign: "add",
  });
  const blankTrim = (pieceKey: string): TrimDraft => ({
    key: newKey(),
    piece_key: pieceKey,
    item_id: null,
    description: "",
    qty: "",
    rate: "",
    // 0694. Direct rate is the default; `isBlankTrim` never tests it, so an untouched
    // seeded row is still blank and the save drops it.
    is_direct: true,
    pack_price: "",
    pack_size: "",
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
    setPieces(d.pieces.map(seedPiece));
    // Seeded in STATE before `setDirty(false)`, never by a grid's `seedRow`,
    // which would mark an untouched sheet "Unsaved".
    setFabrics(seededFabrics);
    const m = weightsToLines(d.weights, newKey, (w) => dimensionalGrams(w));
    setLines(m.lines.length ? m.lines : [blankLine(firstPiece)]);
    setSizeCols(m.sizes);
    setLoss(m.loss);
    setTrims(d.trims.length ? d.trims : [blankTrim(firstPiece)]);
    setExtras(d.extras);
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
        ? seedPiece({ ...p, cmt: from.cmt, cmt_direct: from.cmt_direct, lines: copyPieceLines(from.lines), testing_cost: from.testing_cost, bank_cost: from.bank_cost })
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
    setSizeCols(m.sizes);
    setLoss(m.loss);
    setTrims(
      d.trims.length ? d.trims.map((t) => ({ ...t, key: newKey(), piece_key: pieceMap.get(t.piece_key) ?? firstPiece })) : [blankTrim(firstPiece)],
    );
    setExtras(d.extras.map((x) => ({ ...x, key: newKey() })));
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
    seedAndOpen({ header: blankHeader(), pieces: [blankPiece("GARMENT", null)], fabrics: [], weights: [], trims: [], quotes: {}, extras: [] });
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
    // "-2": the shape changed in 0693 (sizes are names, Loss % is per size) — an older saved draft is not offered back.
    storageKey: `sample-costing-3:${revisingFrom ? `rev-${revisingFrom}` : (editId ?? "new")}`,
    enabled: mode === "edit" && (isEditableStatus(meta.status) || !!revisingFrom),
    value: { header, pieces, fabrics, lines, sizeCols, loss, trims, quotes, extras },
    onRestore: (v) => {
      setHeader(v.header);
      setPieces(v.pieces.map(seedPiece));
      setFabrics(v.fabrics);
      setLines(v.lines);
      setSizeCols(v.sizeCols);
      setLoss(v.loss);
      setTrims(v.trims);
      setExtras(v.extras ?? []);
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
      // A breakdown field lives in its fabric's build-up: open the step and the build-up first.
      const inBuild = /^sc-fab-(?:yarn|mix)-(.+)$/.exec(id);
      if (inBuild) {
        setBuildKey(inBuild[1]);
        setBuildTab("mix");
      }
      fold.setOpenKey(cardOf(p.section));
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
      sizeName: sizeLabel,
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
  /** The Cost sheet is a page of the SAVED costing (one answer for screen, PDF and Excel). */
  function openCostSheet() {
    if (!editId || revisingFrom) {
      toastError("Save the costing first, then open its cost sheet.");
      return;
    }
    if (dirty) {
      toastError("Save your changes first — the cost sheet shows the saved costing.");
      return;
    }
    router.push(`/sales/sample-costing/${editId}/cost-sheet`);
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
          <>
          <RowIconAction label="Cost sheet" name={r.code} icon={ClipboardList} className="text-primary" onClick={() => router.push(`/sales/sample-costing/${r.id}/cost-sheet`)} />
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
          </>
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
  // FABRIC — ONE ROW PER FABRIC, THE RATE BUILT INLINE UNDER IT (user 2026-10-08)
  // ==========================================================================
  /*
   * THE SHOWN GROUP'S FIGURES, declared here because the fabric rows read them
   * (the kilos a fabric takes depend on which size the summary shows) and
   * `cardBody` below builds those rows while it is being declared. They were
   * further down; a closure over a const that has not run yet is a TDZ error.
   */
  const railData =
    summary.groups.find((g) => (g.size ?? "all") === railGroup) ?? summary.groups[0] ?? null;
  const t = railData?.total ?? null;
  const health = marginHealth(t?.effectiveMarginPct ?? null);
  const unitWord = isSet ? "SET" : "PCS";
  const heroValue = t ? (t.quoted ?? t.calc) : null;

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

  /** Processes (costing spec §3.1 — Knitting, Dyeing, Stentering, Brushing …), each picked from the process master:
   *  Process term 176 · Rate / KG hug 88 = 264 + 72 = 336. */
  const setProc = (f: FabricDraft, fn: (xs: FabricProcessDraft[]) => FabricProcessDraft[]) =>
    patchFabric(f.key, { processes: fn(f.processes) });
  const costingProcessColumns = (f: FabricDraft): ChildGridColumn<FabricProcessDraft>[] => [
    {
      header: "Process",
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
   * The kilos of THIS fabric one piece (or set) takes in the shown size,
   * wastage allowance included — read off the Component weights, the same sum
   * `fabricKgFor` makes over every fabric. Null until a component names it.
   * "Uses" is therefore display only: the weight is typed once, in Making.
   */
  const fabricKg = (f: FabricDraft): number | null => {
    const g = railData?.size ?? null;
    const ws = live.weights.filter((w) => w.fabric_key === f.key && (w.size_name == null || w.size_name === g));
    if (!ws.length) return null;
    return ws.reduce((x, w) => x + ((gramsOf(w) ?? 0) * (1 + (num(w.wastage_pct) ?? 0) / 100)) / 1000, 0);
  };
  const fabricRate = (f: FabricDraft): number | null => (f.is_direct ? num(f.direct_rate) : fabricPricePerKg(f));

  /**
   * THE BUILD-UP, inline under the row: Yarn mixing | Processes, then the loss
   * and the price per KG. The ToggleGroup only SHOWS one part at a time; both
   * always count in the price.
   *
   * PROCESSES ARE ONE LIST, EACH ROW PICKED FROM THE PROCESS MASTER (user
   * 2026-10-08, "the way Order Entry lists processes"): KNITTING, DYEING,
   * STENTERING … with a rate per KG, add and remove. They are the existing
   * `sample_costing_fabric_processes` rows, which already carry process_id, and
   * `processTotal` already sums them, so there is NO schema or calc change.
   * The three old columns (knitting_rate / dyeing_rate / finishing_rate) stay
   * in the model and in calc.ts, read as 0 and no longer offered here: the
   * table holds no rows, so nothing is hidden, and the master has no FINISHING
   * process to map the third one onto.
   */
  const fabricBuildUp = (f: FabricDraft) => {
    const mix = hasYarnMix(f);
    const mixTotal = yarnMixTotal(f);
    const yarnSub = yarnRateOf(f);
    // Everything in the rate that is not yarn — the processes list, plus the legacy columns (0 today).
    const procSub = fabricSubtotal(f) - yarnSub;
    const mixOk = Math.abs(mixTotal - 100) <= 0.001;
    return (
      <div id={`sc-build-${f.key}`} className="space-y-2">
        <ToggleGroup<"mix" | "process">
          label="Parts of the fabric rate"
          value={buildTab}
          onChange={setBuildTab}
          options={[
            { value: "mix", label: "Yarn mixing", after: <span className="tabular-nums opacity-80">{`₹ ${money(yarnSub)}`}</span> },
            { value: "process", label: "Processes", after: <span className="tabular-nums opacity-80">{`₹ ${money(procSub)}`}</span> },
          ]}
        />
        {/* THE TABLE LEFT, ITS THREE NUMBERS ON ITS RIGHT (user 2026-10-08, screenshot
            3385: "near to the table right side"): Yarn / KG ₹ · Lost while making % ·
            Price per KG sit beside whichever grid is showing, top-aligned with it.
            Plain flex with fixed-width cells: a FieldRow here collapsed to a
            few characters wide (screenshot 3385). Wraps under the table when narrow. */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
        {buildTab === "mix" ? (
          <div className="space-y-2">
            <p className="m-0 text-xs text-muted-foreground">What the cloth is made of. The shares must total 100%.</p>
            <div id={costingFieldId.yarnMix(f.key)} className="w-[31rem] max-w-full">
              {/* default-row: exempt -- a fabric with no blend needs no mix line; the seeded one is dropped as blank */}
              <div data-grid-style="sheet" className="[&_table]:table-fixed">
                <ChildGrid<YarnMixDraft>
                  // grid-caption: exempt -- the build-up's tab names it
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
              {mix ? (
                <p className={`m-0 mt-2 text-xs ${mixOk ? "text-success" : "text-danger"}`}>
                  {mixOk
                    ? "Mix adds up to 100%."
                    : mixTotal < 100
                      ? `Mix is ${mixTotal}%. ${+(100 - mixTotal).toFixed(2)}% still to place.`
                      : `Mix is ${mixTotal}%. ${+(mixTotal - 100).toFixed(2)}% too much.`}
                </p>
              ) : null}
              <FieldError>{msgFor(costingFieldId.yarnMix(f.key))}</FieldError>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="m-0 text-xs text-muted-foreground">Pick each process and give its price per KG.</p>
            <div className="w-[21rem] max-w-full">
              <div data-grid-style="sheet" className="[&_table]:table-fixed">
                <ChildGrid<FabricProcessDraft>
                  // grid-caption: exempt -- the build-up's tab names it
                  label="Processes"
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
        )}
        </div>
        <div className="flex shrink-0 flex-wrap items-end gap-3">
          <div className="w-[8.5rem]">
            <Field label="Yarn / KG ₹" w="hug" htmlFor={costingFieldId.fabricRate(f.key)}>
              {mix ? (
                // With a mix, the yarn rate IS the weighted sum — shown, not typed.
                <span className="flex h-9 items-center justify-end rounded-md bg-background px-2 text-sm font-medium">
                  <Flash value={money(yarnSub)} formula="Σ Mix % × Rate ÷ 100" />
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
          </div>
          <div className="w-[9.5rem]">
            <Field label="Lost while making %" w="range">
              <NumInput aria-label="Process loss percent" value={f.process_loss_pct} onChange={(e) => patchFabric(f.key, { process_loss_pct: e.target.value })} />
            </Field>
          </div>
          <div className="min-w-[7rem] text-right">
            <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Price per KG</div>
            <div className="flex h-9 items-center justify-end text-lg font-bold tabular-nums text-primary">
              <Flash
                value={`₹ ${money(fabricPricePerKg(f))}`}
                formula={`(Yarn ${money(yarnSub)} + Processes ${money(procSub)}) × (1 + ${f.process_loss_pct || 0}% loss)`}
              />
            </div>
          </div>
        </div>
        </div>
        <FieldError>{msgFor(costingFieldId.fabricRate(f.key))}</FieldError>
      </div>
    );
  };

  /**
   * THE FABRIC LIST — each fabric ONE row: Fabric · Uses × Price = Cost · the
   * icons. Hand-rolled (not ChildGrid) because ChildGrid cannot carry a panel
   * under a row; it therefore answers to the global keyboard contract (Tab,
   * Enter, Ctrl+S) and not to the row-arrow nav a grid adds. "+ Add fabric"
   * carries `data-row-add` so Tab reaches it and `landOnAddedRow` puts the
   * cursor in the new row.
   */
  const buildFabric = buildKey ? fabrics.find((x) => x.key === buildKey && !x.is_direct) ?? null : null;
  /**
   * THE FABRIC LIST AS A SHEET GRID (user 2026-10-08, erp-sheet-grid): one row
   * per fabric — Fabric · Uses × Price = Cost, then the two icons that choose
   * how the price is known. It was a hand-rolled FieldRow per fabric with a
   * card round each; the `×` and `=` glyphs go with the card, and the column
   * headers say the same thing. Widths (FIELD_WIDTH_CSS): term 176 + range 112 +
   * code 144 + range 112 + hug 88 = 632, + 72 chrome = 704.
   */
  const fabricColumns: ChildGridColumn<FabricDraft>[] = [
    {
      header: "Fabric",
      required: true,
      width: FIELD_WIDTH_CSS.term,
      cell: (f) => (
        <TypeOrPick
          label="Fabric"
          id={costingFieldId.fabric(f.key)}
          options={data.fabrics.filter((x) => !isInactive(x) || x.id === f.fabric_id).map((x) => ({ id: x.id, name: x.name }))}
          valueId={f.fabric_id}
          text={f.quality || (data.fabrics.find((x) => x.id === f.fabric_id)?.name ?? "")}
          onChange={(v) => onFabricPick(f, v)}
          placeholder=""
          uppercase
        />
      ),
    },
    {
      header: `Uses kg / ${isSet ? "set" : "pc"}`,
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      cell: (f) => {
        const kg = fabricKg(f);
        return (
          <span className="block text-sm font-semibold text-foreground">
            <Flash value={kg == null ? "—" : money(kg, 3)} formula="Component weights of this fabric, allowance included" />
          </span>
        );
      },
    },
    {
      header: "Price / KG ₹",
      required: true,
      align: "right",
      width: FIELD_WIDTH_CSS.code,
      cell: (f) =>
        f.is_direct ? (
          <div>
            <NumInput
              id={costingFieldId.fabricDirect(f.key)}
              aria-label="Fabric price per KG"
              required
              className="font-semibold"
              value={f.direct_rate}
              onChange={(e) => patchFabric(f.key, { direct_rate: e.target.value })}
            />
            <FieldError>{msgFor(costingFieldId.fabricDirect(f.key))}</FieldError>
          </div>
        ) : (
          <span className="block text-sm font-semibold text-foreground">
            <Flash
              value={money(fabricPricePerKg(f))}
              formula={`(Yarn ${money(yarnRateOf(f))} + Knit + Dye + Finishing + Special ${money(processTotal(f))} = ${money(fabricSubtotal(f))}) × (1 + ${f.process_loss_pct || 0}% loss)`}
            />
          </span>
        ),
    },
    {
      header: `Fabric cost / ${isSet ? "set" : "pc"}`,
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      cell: (f) => {
        const kg = fabricKg(f);
        const rate = fabricRate(f);
        const cost = kg != null && rate != null ? kg * rate : null;
        return (
          <span className="block text-sm font-semibold text-foreground">
            <Flash value={cost == null ? "—" : money(cost)} formula="Uses × Price" />
          </span>
        );
      },
    },
    {
      header: "Price by",
      width: FIELD_WIDTH_CSS.hug,
      // THE ROW'S TWO ICONS — no words, each named by a tooltip and an aria-label.
      // Buttons are not fields, so none of them is a Tab stop.
      cell: (f) => {
        const building = !f.is_direct && buildKey === f.key;
        return (
          <div className="flex items-center justify-center gap-1">
            {f.is_direct ? (
              <Tooltip label="Work the price out from yarn and processes">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Work the price out from yarn and processes"
                  onClick={() => {
                    patchFabric(f.key, { is_direct: false });
                    setBuildKey(f.key);
                    setBuildTab("mix");
                  }}
                >
                  <Calculator aria-hidden />
                </Button>
              </Tooltip>
            ) : (
              <>
                <Tooltip label="See how the price is worked out">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="See how the price is worked out"
                    aria-haspopup="dialog"
                    aria-expanded={building}
                    onClick={captureBuildOrigin(() => setBuildKey(f.key))}
                  >
                    <ChevronDown aria-hidden />
                  </Button>
                </Tooltip>
                <Tooltip label="Type the price instead">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Type the price instead"
                    onClick={() => {
                      // The worked-out price becomes the typed one, so the figure on screen does not jump.
                      const keep = fabricPricePerKg(f);
                      patchFabric(f.key, { is_direct: true, ...(keep != null && !num(f.direct_rate) ? { direct_rate: String(keep) } : {}) });
                      if (buildKey === f.key) setBuildKey(null);
                    }}
                  >
                    <Pencil aria-hidden />
                  </Button>
                </Tooltip>
              </>
            )}
          </div>
        );
      },
    },
  ];
  const fabricList = (
    <div data-grid-style="sheet" data-grid-cells="flat" className="[&_table]:table-fixed">
      <ChildGrid<FabricDraft>
        // grid-caption: exempt -- the card's own title names it
        label="Fabrics"
        columns={fabricColumns}
        rows={fabrics}
        tableAlways
        narrow
        keepOne
        removeHeader="Actions"
        addLabel="+ Add fabric"
        onAdd={() => mutFabrics((xs) => [...xs, blankFabric()])}
        onRemove={(f) => mutFabrics((xs) => xs.filter((x) => x.key !== f.key))}
      />
    </div>
  );

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
   * THE SIZE MATRIX (0693, user 2026-10-08; orders-precedent §5 — a size-across
   * matrix is `matrix-grid.ts`, never ChildGrid columns and never cards). The style's
   * sizes across the top, components down the left with the fabric under each
   * name, grams in the cells, and under the components a Loss % row — one box per
   * size. The sizes are the OPERATOR'S CHOICE from the style's own list: nothing
   * is pre-selected, and a size the style does not carry cannot be added. A
   * blank grams or Loss % box takes the first size's (the placeholder shows what
   * it takes). The identity column stays put while a long run of sizes scrolls
   * inside the frame — the one sanctioned sideways scroll.
   */
  const styleSizes = style?.sizes ?? [];
  const offered = offeredSizes(styleSizes, sizeCols);
  const heldNotInStyle = styleSizes.length ? sizesNotInStyle(styleSizes, sizeCols) : [];
  /* A legacy sheet that holds grams under NO size shows them in one "All sizes"
     column, so nothing typed is ever hidden; choosing its first size moves them. */
  const holdsAllSizes = !sizeCols.length && lines.some((l) => (l.cells[ALL_SIZES] ?? "").trim() !== "");
  const matrixCols = sizeCols.length ? sizeCols : holdsAllSizes ? [ALL_SIZES] : [];
  const colLabel = (c: string) => (c === ALL_SIZES ? "All sizes" : c);
  const colSize = (c: string) => (c === ALL_SIZES ? null : c);
  const lineCost = (l: ConsumptionLine, col: string) => {
    const g = cellGrams(l, col, sizeCols);
    if (!g) return null;
    return componentCost(
      { piece_key: l.piece_key, fabric_key: l.fabric_key, size_name: null, weight_g: g, length_cm: "", width_cm: "", gsm: "", wastage_pct: lossFor(loss, col, sizeCols) },
      live.fabrics,
    );
  };
  const colCost = (col: string) => lines.reduce((t, l) => t + (lineCost(l, col) ?? 0), 0);
  const colGrams = (col: string) => lines.reduce((t, l) => t + (num(cellGrams(l, col, sizeCols)) ?? 0), 0);
  /** Total grams of fabric one piece takes in this size, loss included — the engine's own figure (calc.ts). */
  const colGramsWithLoss = (col: string) => fabricKgFor(live.weights, colSize(col)) * 1000;
  const setLossAt = (col: string, v: string) => {
    setLoss((m) => ({ ...m, [col]: v }));
    setDirty(true);
  };
  /**
   * Adding a size appends a column. The FIRST size added stamps the spec's 3 %
   * Loss (what the old per-line allowance defaulted to) and takes over any
   * grams a legacy sheet held under no size, so nothing typed is lost.
   */
  const addSize = (name: string) => {
    if (!name || sizeCols.some((x) => x.trim().toUpperCase() === name.trim().toUpperCase())) return;
    if (!sizeCols.length) {
      mutLines((xs) =>
        xs.map((l) => {
          const { [ALL_SIZES]: carried, ...rest } = l.cells;
          return carried !== undefined && carried.trim() ? { ...l, cells: { ...rest, [name]: carried } } : { ...l, cells: rest };
        }),
      );
      setLoss((m) => ({ [name]: (m[ALL_SIZES] ?? "").trim() || DEFAULT_ALLOWANCE }));
    }
    setSizeCols((xs) => [...xs, name]);
    setDirty(true);
  };
  /** Removing a size drops its column. When it was the FIRST, the next size
   *  takes over its numbers where it has none, so inheritance still points at real grams. */
  const removeSize = (name: string) => {
    const rest = sizeCols.filter((x) => x !== name);
    if (sizeCols[0] === name && rest.length) {
      const nextFirst = rest[0];
      mutLines((xs) =>
        xs.map((l) => {
          const { [name]: gone, ...cells } = l.cells;
          return { ...l, cells: { ...cells, [nextFirst]: (cells[nextFirst] ?? "").trim() ? cells[nextFirst] : (gone ?? "") } };
        }),
      );
      setLoss((m) => {
        const { [name]: gone, ...others } = m;
        return { ...others, [nextFirst]: (others[nextFirst] ?? "").trim() ? others[nextFirst] : (gone ?? "") };
      });
    } else {
      mutLines((xs) =>
        xs.map((l) => {
          const { [name]: gone, ...cells } = l.cells;
          void gone;
          return { ...l, cells };
        }),
      );
      setLoss((m) => {
        const { [name]: gone, ...others } = m;
        void gone;
        return others;
      });
    }
    setSizeCols(rest);
    setDirty(true);
  };
  const CELL = matrixCell("min-h-10");
  type SetRow = { key: string; n: string; piece: string; fabric: string; grams: number; cmt: number; cost: number | null };
  const setBreakdownRows: SetRow[] = (() => {
    const g0 = summary.groups.find((g) => (g.size ?? "all") === railGroup) ?? summary.groups[0];
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
  const ID_COLS = multiPiece ? 2 : 1;

  /*
   * SIZE IS THE FIRST COLUMN (user 2026-10-08: "move this size as first field … add
   * it front of the component"). One BAND of rows per size, Size · Component ·
   * Fabric · Grams · Cost ₹, then a tinted subtotal row that holds the size's
   * Loss % and what it adds up to. The data is still the matrix underneath
   * (lines × sizes, one Loss % per size — matrix.ts), so nothing stored moves.
   *
   * The components are DEFINED in the first band only: Piece, Component and
   * Fabric are boxes there and plain text in every later band, so a line is one
   * set of controls however many sizes are on the sheet (one id, one ✕, one
   * error). Every band has its own grams box, and a blank one takes the first
   * size's number (the placeholder shows what it takes). The ✕ on a component
   * removes it from every size. With no size yet there is one band whose grams
   * cell asks for a size, and "Add a size" leads the step instead of trailing it.
   */
  const fabricNameOf = (key: string | null) => {
    const fi = fabrics.findIndex((f) => f.key === key);
    return fi >= 0 ? fabricLabel(fabrics[fi], fi) : "";
  };
  const consumptionMatrix = () => {
    // SIZE IS THE FIRST COLUMN, EACH SIZE A BAND OF ROWS (user 2026-10-08, the
    // "Garment weight step" mock-up): Size · [Piece] · Component · Fabric · Grams ·
    // Cost ₹ · ✕. It was sizes across the top; the data is the same
    // (`line.cells[size]`, `loss[size]`), only the axis is turned.
    const track = [
      "92px",
      ...(multiPiece ? ["112px"] : []),
      "168px",
      "200px",
      "156px",
      "100px",
      "minmax(12px,1fr)",
      "44px",
    ].join(" ");
    const firstCol = matrixCols[0];
    const bands: (string | null)[] = matrixCols.length ? matrixCols : [null];
    const bandCell = "flex min-h-11 items-center border-b border-border bg-primary-soft px-2 text-xs";
    const addSizeRow = (
      <FieldRow gap="row" align="end">
        {offered.length ? (
          <Field label="Add a size" w="term" htmlFor="sc-add-size">
            <Select id="sc-add-size" value="" onChange={(e) => addSize(e.target.value)}>
              <option value="">+ Add size…</option>
              {offered.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <p className="m-0 pb-2 text-xs text-muted-foreground">
          {!style
            ? "Choose the style first; its sizes appear here."
            : !styleSizes.length
              ? "This style has no sizes ticked in Sample Entry, so no size can be added."
              : !offered.length
                ? "Every size of the style is on the sheet."
                : sizeCols.length > 1
                  ? "A blank box takes the first size's number."
                  : "Add the sizes you are costing, then type the grams."}
        </p>
      </FieldRow>
    );
    return (
      <div className="space-y-3">
        {/* NO SIZE YET: the size is the first thing to choose, so it leads. */}
        {!matrixCols.length ? addSizeRow : null}
        {/* A held size the style no longer carries — a notice, never an edit. */}
        {heldNotInStyle.length ? (
          <p className="m-0 text-xs text-warning">
            {`The style no longer has ${heldNotInStyle.join(", ")}. The band stays until you remove it.`}
          </p>
        ) : null}
        {/* HUGS ITS COLUMNS, like every Orders table: `w-max` lets the 1fr spacer
            settle at its 12px floor; `max-w-full` keeps the scroll. */}
        <div className="w-fit max-w-full overflow-x-auto rounded-control border border-border">
          <div data-grid-body className="grid w-max" style={{ gridTemplateColumns: track }} onKeyDown={(e) => gridKeyNav(e)}>
            <div className={`${MATRIX_HEAD} justify-start pl-2`}>Size</div>
            {multiPiece ? <div className={`${MATRIX_HEAD} justify-start pl-2`}>Piece</div> : null}
            <div className={`${MATRIX_HEAD} justify-start pl-2`}>Component</div>
            <div className={`${MATRIX_HEAD} justify-start pl-2`}>Fabric</div>
            <div className={`${MATRIX_HEAD} justify-end pr-2`}>Grams</div>
            <div className={`${MATRIX_HEAD} justify-end pr-2`}>Cost ₹</div>
            <div className={MATRIX_HEAD} />
            <div className={MATRIX_HEAD} />

            {bands.map((c, bi) => (
              <Fragment key={c ?? "no-size"}>
                {lines.map((l, li) => {
                  const cost = c ? lineCost(l, c) : null;
                  return (
                    <div key={l.key} data-grid-row className="contents">
                      {/* THE SIZE, on the first row of its band. */}
                      <div className={`${CELL} items-start justify-between gap-1 border-r border-border bg-surface-muted px-2 pt-2`}>
                        {li === 0 ? (
                          c ? (
                            <>
                              <span className={MATRIX_SIZE_TOKEN}>{colLabel(c)}</span>
                              {sizeCols.length > 1 && c !== ALL_SIZES ? (
                                // button-shape: exempt -- a 20px ✕ chip beside the size
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  aria-label={`Remove size ${c}`}
                                  onClick={() => removeSize(c)}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-control text-[11px] text-muted-foreground hover:bg-danger-soft hover:text-danger"
                                >
                                  ✕
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )
                        ) : null}
                      </div>
                      {multiPiece ? (
                        <div className={`${CELL} justify-start px-1`}>
                          {bi === 0 ? (
                            <Select aria-label="Piece" value={l.piece_key} onChange={(e) => patchLine(l.key, { piece_key: e.target.value })}>
                              {pieces.map((pc) => (
                                <option key={pc.key} value={pc.key}>
                                  {pc.piece_name}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <span className="truncate px-1 text-xs text-muted-foreground">{pieces.find((pc) => pc.key === l.piece_key)?.piece_name ?? ""}</span>
                          )}
                        </div>
                      ) : null}
                      <div className={`${CELL} flex-col !items-stretch justify-center px-1`}>
                        {bi === 0 ? (
                          <Select aria-label="Component" value={l.component_id ?? ""} onChange={(e) => patchLine(l.key, { component_id: e.target.value || null })}>
                            <option value=""></option>
                            {data.components
                              .filter((x) => !isInactive(x) || x.id === l.component_id)
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                          </Select>
                        ) : (
                          <span className="truncate px-1 text-xs text-muted-foreground">{componentName(l.component_id) || "—"}</span>
                        )}
                      </div>
                      <div className={`${CELL} flex-col !items-stretch justify-center px-1`}>
                        {bi === 0 ? (
                          <>
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
                          </>
                        ) : (
                          <span className="truncate px-1 text-xs text-muted-foreground">{fabricNameOf(l.fabric_key) || "—"}</span>
                        )}
                      </div>
                      <div className={`${CELL} gap-1 px-1`}>
                        {c ? (
                          <>
                            <div className="min-w-0 flex-1">
                              <NumInput
                                id={bi === 0 ? costingFieldId.weightGrams(l.key) : undefined}
                                aria-label={`${componentName(l.component_id) || "Component"} grams — ${colLabel(c)}`}
                                required={bi === 0}
                                className="h-8"
                                // The INHERITED grams, as a state of the record (LAYOUT.md §3's survivor rule).
                                placeholder={bi > 0 ? (l.cells[firstCol] ?? "") : undefined}
                                value={l.cells[c] ?? ""}
                                onChange={(e) => setCell(l.key, c, e.target.value)}
                              />
                              {bi === 0 ? <FieldError>{msgFor(costingFieldId.weightGrams(l.key))}</FieldError> : null}
                            </div>
                            <Tooltip label="Weight from length × width × GSM">
                              {/* button-shape: exempt -- a 28px icon square in a matrix cell */}
                              <button
                                type="button"
                                data-row-open
                                aria-label={`Calculate ${colLabel(c)} grams from length, width and GSM`}
                                onClick={captureDimsOrigin(() => {
                                  setDims({ l: "", w: "", g: "" });
                                  setDimsFor({ line: l.key, col: c });
                                })}
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-primary-soft hover:text-primary"
                              >
                                <Ruler className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </Tooltip>
                          </>
                        ) : (
                          <span className="px-1 text-xs text-muted-foreground">Add a size first</span>
                        )}
                      </div>
                      <div className={`${CELL} justify-end pr-2 text-xs font-semibold tabular-nums ${cost == null ? "text-muted-foreground" : "text-foreground"}`}>
                        {cost == null ? "—" : money(cost)}
                      </div>
                      <div className={CELL} />
                      <div className={`${CELL} justify-end pr-1`}>
                        {bi === 0 && lines.length > 1 ? (
                          <Tooltip label="Remove this component from every size">
                            {/* button-shape: exempt -- the row's ✕, a 28px icon square (data-row-remove for Ctrl+Del) */}
                            <button
                              type="button"
                              data-row-remove
                              aria-label="Remove component"
                              onClick={() => mutLines((xs) => xs.filter((x) => x.key !== l.key))}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-control text-muted-foreground hover:bg-danger-soft hover:text-danger"
                            >
                              ✕
                            </button>
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {/* THE SIZE'S SUBTOTAL ROW: its Loss %, and what the band adds up to. */}
                {c ? (
                  <>
                    <div className={`${bandCell} border-r`} />
                    <div data-loss-row className={`${bandCell} gap-2 font-semibold text-muted-foreground`} style={{ gridColumn: `span ${ID_COLS}` }}>
                      <span className="whitespace-nowrap">Loss %</span>
                      <div className="w-16">
                        <NumInput
                          aria-label={`Loss percent — ${colLabel(c)}`}
                          className="h-8"
                          placeholder={bi > 0 ? (loss[firstCol] ?? "") : undefined}
                          value={loss[c] ?? ""}
                          onChange={(e) => setLossAt(c, e.target.value)}
                        />
                      </div>
                      <span className="text-[10px] font-normal">cloth lost in making</span>
                    </div>
                    <div className={`${bandCell} gap-1.5 text-muted-foreground`}>
                      Fabric used
                      <b className="text-foreground">
                        <Flash value={`${money(colGrams(c), 0)} g`} formula="Σ grams of the components" />
                      </b>
                    </div>
                    <div className={`${bandCell} justify-end font-semibold text-foreground`}>
                      <Flash value={`${money(colGramsWithLoss(c), 1)} g with loss`} formula="Σ grams × (1 + Loss %)" />
                    </div>
                    <div className={`${bandCell} justify-end text-sm font-bold text-primary`}>
                      <Flash value={money(colCost(c))} formula={`Fabric ₹ / ${isSet ? "set" : "pc"} = Σ Price / KG ÷ 1000 × grams × (1 + Loss %)`} />
                    </div>
                    <div className={bandCell} />
                    <div className={bandCell} />
                  </>
                ) : null}
              </Fragment>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Button type="button" variant="outline" size="sm" data-row-add onClick={addLine}>
            + Add component
          </Button>
          {matrixCols.length ? <div className="min-w-0 flex-1">{addSizeRow}</div> : null}
        </div>
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
  /*
   * CMT OPERATIONS AND EMBELLISHMENTS ARE PICKED FROM THE PROCESS MASTER BY KIND
   * (0691 · 0692, user 2026-10-08) — no hardcoded Cutting / Print / Embroidery /
   * Wash columns. A piece's CMT is its DIRECT RATE (the flat box) OR the sum of
   * its CMT operation lines; its Embellishment cost is the sum of its
   * embellishment lines. What counts as an operation and what as an embellishment
   * is \`processes.garment_kind\`, set on the Process master — a process with no
   * kind is in neither list.
   */
  const lineItems = (kind: PieceLineKind) =>
    data.garmentProcesses
      .filter((x) => x.garment_kind === kind)
      .map(({ id, code, name, inactive }) => ({ id, code, name, inactive }));
  const setPieceLines = (pieceKey: string, fn: (xs: PieceLineDraft[]) => PieceLineDraft[]) =>
    mutPieces((xs) => xs.map((x) => (x.key === pieceKey ? { ...x, lines: fn(x.lines) } : x)));
  /* WHICH CMT OPERATIONS A PIECE SHOWS. They are whatever the Process master marks
     garment_kind = 'cmt' — no names live here. A process the sheet already holds a
     rate for stays on the strip even when it was switched off or re-kinded since,
     never dropped. A box with a number is a sample_costing_piece_processes line
     (kind 'cmt'); an emptied box removes it, so a blank box saves nothing. */
  const cmtOpsOf = (pc: PieceDraft) => {
    const held = pc.lines.filter((l) => l.kind === "cmt" && l.process_id);
    const items = lineItems("cmt").filter((x) => !isInactive(x) || held.some((l) => l.process_id === x.id));
    const orphans = held
      .filter((l) => !items.some((x) => x.id === l.process_id))
      .map((l) => ({ id: l.process_id as string, code: "", name: l.process_name || "Operation", inactive: true }));
    return [...items, ...orphans];
  };
  const setCmtRate = (pc: PieceDraft, op: { id: string; name: string }, value: string) =>
    setPieceLines(pc.key, (xs) => {
      const has = xs.some((x) => x.kind === "cmt" && x.process_id === op.id);
      if (value.trim() === "") return xs.filter((x) => !(x.kind === "cmt" && x.process_id === op.id));
      if (has) return xs.map((x) => (x.kind === "cmt" && x.process_id === op.id ? { ...x, rate: value } : x));
      return [...xs, { ...blankPieceLine("cmt"), process_id: op.id, process_name: op.name, rate: value }];
    });

  /*
   * CMT & CHARGES IS A TABLE (user 2026-10-08, screenshot 3383: "I said update it
   * as table, not like one next one"): the flowing FieldRow wrapped and dropped
   * Testing onto a second line. Now one real <table>, headings once, a ROW GROUP
   * per piece:
   *
   *   Piece | Direct rate | CMT ₹ / pc | Embellishment | ₹ / pc | (✕) | Testing ₹ / pc | Per piece
   *
   * The first row of a group carries Piece, Direct rate, CMT, Testing and Per piece
   * with rowSpan = its embellishment rows + 1 (the "+ Add embellishment" row); each
   * further row is one embellishment [process · ₹ / pc · ✕]. Direct rate OFF adds a
   * full-width strip under the group with one labelled ₹ box per CMT operation.
   *
   * WIDTHS (frame scrolls inside itself when narrower): Piece 96 · Direct 112 ·
   * CMT 120 · Embellishment term 176 · ₹ / pc hug 88 · ✕ 40 · Testing 112 ·
   * Per piece 112 = 856, + 8 × 12 cell padding = ~950, inside the step's ~1100 at
   * 1366. check:grid-budget reads <ChildGrid> only, so this table is not listed there.
   *
   * KEYS: Tab / Enter walk the fields in DOM order (the global contract — this is not a
   * gridKeyNav grid, because rowSpan rows have no common column index for ↑/↓ to
   * use). Ctrl+Del on an embellishment cell clicks that row's own ✕
   * (data-row-remove), the same key the other grids answer. "+ Add embellishment" is a
   * Tab stop (data-row-add), a second Enter adds, and \`data-grid-body\` on the tbody is
   * what lets landOnAddedRow diff the fields and put the cursor in the new pair.
   */
  const TH = "whitespace-nowrap border-b border-border bg-surface-muted px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground";
  const TD = "border-b border-border px-3 py-2 align-middle";
  const ctrlDelEmbellishment = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Delete" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest("[data-emb-cell]")?.querySelector<HTMLElement>("[data-row-remove]");
    if (!btn) return;
    e.preventDefault();
    btn.click();
  };
  const embellishmentPair = (pc: PieceDraft, r: PieceLineDraft, rows: PieceLineDraft[]) => (
    <>
      <td className={TD} data-emb-cell>
        <div style={{ width: FIELD_WIDTH_CSS.term }}>
          <RecordPicker
            compact
            label="Embellishment"
            items={lineItems("embellishment")}
            emptyHint="No embellishments yet. Add them in the Process master and switch on Embellishment as the process kind."
            value={r.process_id}
            usedIds={rows.filter((x) => x.key !== r.key).flatMap((x) => (x.process_id ? [x.process_id] : []))}
            onChange={(id) =>
              setPieceLines(pc.key, (xs) =>
                xs.map((x) =>
                  x.key === r.key
                    ? { ...x, process_id: id, process_name: id ? (lineItems("embellishment").find((i) => i.id === id)?.name ?? "") : "" }
                    : x,
                ),
              )
            }
          />
        </div>
      </td>
      <td className={TD} data-emb-cell>
        <div style={{ width: FIELD_WIDTH_CSS.hug }}>
          <NumInput
            aria-label="Embellishment rate per piece"
            placeholder="₹ / pc"
            value={r.rate}
            onChange={(e) => setPieceLines(pc.key, (xs) => xs.map((x) => (x.key === r.key ? { ...x, rate: e.target.value } : x)))}
          />
        </div>
      </td>
      <td className={TD} data-emb-cell>
        <Tooltip label="Remove this embellishment">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-row-remove
            aria-label="Remove this embellishment"
            onClick={() => setPieceLines(pc.key, (xs) => xs.filter((x) => x.key !== r.key))}
          >
            <Trash2 aria-hidden />
          </Button>
        </Tooltip>
      </td>
    </>
  );
  const pieceRows = (pc: PieceDraft) => {
    const emb = pc.lines.filter((l) => l.kind === "embellishment");
    const addEmb = () => setPieceLines(pc.key, (xs) => [...xs, blankPieceLine("embellishment")]);
    const span = emb.length > 0 ? emb.length + 1 : 1;
    const ops = cmtOpsOf(pc);
    const stripOpen = !pc.cmt_direct && !opsHidden[pc.key];
    const addCell = (
      <td className={TD} colSpan={3}>
        <div className="flex items-center gap-3">
          {emb.length === 0 ? <span className="text-sm text-muted-foreground">None</span> : null}
          <Button type="button" variant="outline" size="sm" data-row-add onClick={addEmb}>
            + Add embellishment
          </Button>
        </div>
      </td>
    );
    const groupCells = (
      <>
        <td className={TD + " align-top"} rowSpan={span}>
          <div className="font-semibold text-foreground">{pc.piece_name}</div>
          {multiPiece && pc.key !== pieces[0]?.key ? (
            <Button type="button" variant="ghost" size="sm" tabIndex={-1} onClick={() => sameAsFirst(pc.key, "all")}>
              {"Copy " + (pieces[0]?.piece_name ?? "first") + " →"}
            </Button>
          ) : null}
        </td>
        <td className={TD + " align-top"} rowSpan={span}>
          <Toggle
            id={"sc-direct-" + pc.key}
            label={pc.cmt_direct ? "On" : "Off"}
            checked={pc.cmt_direct}
            onChange={(v) => patchPiece(pc.key, { cmt: pc.cmt, cmt_direct: v })}
          />
        </td>
        <td className={TD + " align-top"} rowSpan={span}>
          {pc.cmt_direct ? (
            <div style={{ width: FIELD_WIDTH_CSS.hug }}>
              <NumInput
                id={"sc-cmt-" + pc.key}
                aria-label={"CMT ₹ / pc" + (multiPiece ? " — " + pc.piece_name : "")}
                value={pc.cmt}
                onChange={(e) => patchPiece(pc.key, { cmt: e.target.value })}
              />
            </div>
          ) : (
            <div className="space-y-1">
              <div className="font-semibold tabular-nums text-foreground">{"₹ " + money(pieceCmt(pc))}</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                tabIndex={-1}
                onClick={() => setOpsHidden((m) => ({ ...m, [pc.key]: !m[pc.key] }))}
              >
                {opsHidden[pc.key] ? "Show operations" : "Hide operations"}
              </Button>
            </div>
          )}
        </td>
      </>
    );
    const tailCells = (
      <>
        <td className={TD + " align-top"} rowSpan={span}>
          <div style={{ width: FIELD_WIDTH_CSS.hug }}>
            <NumInput
              id={"sc-test-" + pc.key}
              aria-label={"Testing ₹ / pc" + (multiPiece ? " — " + pc.piece_name : "")}
              value={pc.testing_cost}
              onChange={(e) => patchPiece(pc.key, { testing_cost: e.target.value })}
            />
          </div>
        </td>
        <td className={TD + " text-right align-top font-semibold tabular-nums text-primary"} rowSpan={span}>
          {"₹ " + money(labourOf(pc))}
        </td>
      </>
    );
    const rows: React.ReactNode[] = [];
    if (emb.length === 0) {
      rows.push(
        <tr key={pc.key + "-0"}>
          {groupCells}
          {addCell}
          {tailCells}
        </tr>,
      );
    } else {
      emb.forEach((r, i) =>
        rows.push(
          <tr key={r.key}>
            {i === 0 ? groupCells : null}
            {embellishmentPair(pc, r, emb)}
            {i === 0 ? tailCells : null}
          </tr>,
        ),
      );
      rows.push(<tr key={pc.key + "-add"}>{addCell}</tr>);
    }
    if (stripOpen) {
      rows.push(
        <tr key={pc.key + "-ops"} className="bg-surface-muted">
          <td className={TD} colSpan={8}>
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <span className="self-center text-xs font-semibold text-muted-foreground">
                {(multiPiece ? pc.piece_name + " · " : "") + "CMT by operation"}
              </span>
              {ops.map((op) => (
                <Field key={op.id} label={op.name} w="range" htmlFor={"sc-cmt-" + pc.key + "-" + op.id}>
                  <NumInput
                    id={"sc-cmt-" + pc.key + "-" + op.id}
                    value={pc.lines.find((l) => l.kind === "cmt" && l.process_id === op.id)?.rate ?? ""}
                    onChange={(e) => setCmtRate(pc, op, e.target.value)}
                  />
                </Field>
              ))}
              {ops.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  No CMT operations yet. Add them in the Process master and switch on CMT operation as the process kind, or turn Direct rate on.
                </span>
              ) : null}
            </div>
          </td>
        </tr>,
      );
    }
    return rows;
  };
  const cmtTable = () => (
    <div className="w-fit max-w-full overflow-x-auto rounded-control border border-border">
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={TH}>Piece</th>
            <th className={TH}>Direct rate</th>
            <th className={TH}>CMT ₹ / pc</th>
            <th className={TH}>Embellishment</th>
            <th className={TH}>₹ / pc</th>
            <th className={TH}>
              <span className="sr-only">Remove</span>
            </th>
            <th className={TH}>Testing ₹ / pc</th>
            <th className={TH + " text-right"}>Per piece</th>
          </tr>
        </thead>
        <tbody data-grid-body onKeyDown={ctrlDelEmbellishment}>
          {pieces.map((pc) => pieceRows(pc))}
        </tbody>
      </table>
    </div>
  );
  /** "Copy TOP → …": the CMT & charges step copies the whole block (CMT, embellishment
   *  lines, testing) and, when the piece has none of its own, its trims. */
  function sameAsFirst(pieceKey: string, part: "cmt" | "charges" | "all") {
    const first = pieces[0];
    const target = pieces.find((x) => x.key === pieceKey);
    if (!first || !target) return;
    if (part === "cmt") {
      patchPiece(pieceKey, {
        cmt: first.cmt,
        cmt_direct: first.cmt_direct,
        lines: [...target.lines.filter((l) => l.kind !== "cmt"), ...copyPieceLines(first.lines.filter((l) => l.kind === "cmt"))],
      });
      return;
    }
    if (part === "all") {
      patchPiece(pieceKey, { cmt: first.cmt, cmt_direct: first.cmt_direct, lines: copyPieceLines(first.lines), testing_cost: first.testing_cost });
    } else {
      patchPiece(pieceKey, {
        lines: [...target.lines.filter((l) => l.kind === "cmt"), ...copyPieceLines(first.lines.filter((l) => l.kind !== "cmt"))],
        testing_cost: first.testing_cost,
      });
    }
    // Its trims too, when this piece has none of its own yet.
    if (!live.trims.some((t) => t.piece_key === pieceKey)) {
      const copies = live.trims.filter((t) => t.piece_key === first.key).map((t) => ({ ...t, key: newKey(), piece_key: pieceKey }));
      if (copies.length) mutTrims((xs) => [...xs.filter((t) => !isBlankTrim(t)), ...copies]);
    }
  }

  /** TRIMS BY CONSUMPTION (user 2026-10-08, the Trims Consumption spec; "based on Direct
   *  enable/disable, dynamically show the fields").
   *  [Piece range 112] · Trim party 200 · Direct num 72 · Package ₹ hug 88 · Pack size num 72 ·
   *  Consumption hug 88 · Rate ₹ hug 88 · Cost ₹ / pc hug 88 = 696 (808 with Piece)
   *  + 72 = 768 (880 with Piece) ≤ 1155 (the check's pane).
   *
   *  THE SWITCH DECIDES WHICH CONTROLS EXIST. Direct ON renders only the flat Rate box; the
   *  Package ₹ / Pack size / Consumption cells render NOTHING (no box, no tab stop). Direct OFF
   *  renders those three, and the Rate cell becomes the computed cost as plain text (no tab
   *  stop). Cost ₹ / pc always shows the resulting figure. Both sets stay in the draft when the
   *  switch is flipped, so nothing typed is lost; only the active set is counted
   *  (`trimCostPerPiece`). A hidden control is never required and carries no error. Pack size
   *  blank = 1, so a length trim is Rate per metre × metres with Pack size empty. */
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
      header: "Direct rate",
      align: "center",
      // hug, not num: the header was cut to "Direct r…" at 72px (user 2026-10-08).
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => <Toggle ariaLabel="Direct rate" checked={r.is_direct} onChange={(v) => patchTrim(r.key, { is_direct: v })} />,
    },
    {
      header: "Package ₹",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) =>
        r.is_direct ? null : (
          <div>
            <NumInput
              id={costingFieldId.trimPackPrice(r.key)}
              aria-label="Package price"
              value={r.pack_price}
              onChange={(e) => patchTrim(r.key, { pack_price: e.target.value })}
            />
            <FieldError>{msgFor(costingFieldId.trimPackPrice(r.key))}</FieldError>
          </div>
        ),
    },
    {
      header: "Pack size",
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) =>
        r.is_direct ? null : (
          <div>
            <NumInput
              id={costingFieldId.trimPackSize(r.key)}
              aria-label="Pack size"
              value={r.pack_size}
              onChange={(e) => patchTrim(r.key, { pack_size: e.target.value })}
            />
            <FieldError>{msgFor(costingFieldId.trimPackSize(r.key))}</FieldError>
          </div>
        ),
    },
    {
      header: "Consumption",
      align: "right",
      // range, not hug: the header was cut to "Consumpti…" at 88px.
      width: FIELD_WIDTH_CSS.range,
      cell: (r) =>
        r.is_direct ? null : (
          <div>
            <NumInput
              id={costingFieldId.trimQty(r.key)}
              aria-label="Consumption per piece"
              value={r.qty}
              onChange={(e) => patchTrim(r.key, { qty: e.target.value })}
            />
            <FieldError>{msgFor(costingFieldId.trimQty(r.key))}</FieldError>
          </div>
        ),
    },
    {
      header: "Rate ₹",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) =>
        r.is_direct ? (
          <div>
            <NumInput
              id={costingFieldId.trimRate(r.key)}
              aria-label="Rate"
              value={r.rate}
              onChange={(e) => patchTrim(r.key, { rate: e.target.value })}
            />
            <FieldError>{msgFor(costingFieldId.trimRate(r.key))}</FieldError>
          </div>
        ) : (
          // Package mode: the flat-rate cell shows the computed cost as plain text, not a field.
          <Figure value={isBlankTrim(r) ? null : trimCostPerPiece(r).cost} formula="Package ₹ ÷ Pack size × Consumption" />
        ),
    },
    {
      header: "Cost ₹ / pc",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      total: { kind: "sum", of: (r) => (isBlankTrim(r) ? 0 : trimCostPerPiece(r).cost), format: (n) => money(n) },
      cell: (r) => (
        <Figure
          value={isBlankTrim(r) ? null : trimCostPerPiece(r).cost}
          formula={r.is_direct ? "Consumption × Rate" : "Package ₹ ÷ Pack size × Consumption"}
        />
      ),
    },
  ];

  // ==========================================================================
  // CARD 6 — OVERHEADS & COMMERCIAL: the quote matrix (a SET or > 1 size)
  // ==========================================================================
  type QuoteRow = { key: string; pieceKey: string; size: string | null; fig: CostingSummary["groups"][number]["pieces"][number] };
  const quoteRows: QuoteRow[] = summary.groups.flatMap((g) =>
    g.pieces.map((p) => ({ key: quoteKey(p.pieceKey, g.size), pieceKey: p.pieceKey, size: g.size, fig: p })),
  );
  const setQuote = (key: string, v: string) => {
    setQuotes((q) => ({ ...q, [key]: v }));
    setDirty(true);
  };
  /** Piece range 112 · Size range 112 · Gross Cost / Calc / Quoted hug
   *  88 ×3 · Δ range 112 · Margin hug 88 = 688 + 72 = 760 ≤ 818. */
  const costingQuoteColumns: ChildGridColumn<QuoteRow>[] = [
    { header: "Piece", width: FIELD_WIDTH_CSS.range, cell: (r) => <Truncated className="text-sm font-medium">{pieceName(r.pieceKey)}</Truncated> },
    { header: "Size", width: FIELD_WIDTH_CSS.range, cell: (r) => <span className="text-sm">{sizeLabel(r.size)}</span> },
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
          aria-label={`Quoted price — ${pieceName(r.pieceKey)}, ${sizeLabel(r.size)}`}
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

  /**
   * THE "+ ADD" CHARGE ROWS of Overheads and Price & quote (user 2026-10-08): a name, FLAT ₹ per
   * piece or PERCENT of net, a value, and — on a price row — Add (surcharge) or Deduct. Impact is
   * read-only and comes from the same `extraChargeAmount` the summary uses.
   * Charge party 200 · Type code 120 · Value hug 88 · [Effect code 120] · Impact hug 88, well inside the pane.
   */
  const extraImpact = (r: ExtraChargeDraft) => {
    if (!t) return null;
    const amt = extraChargeAmount(r, t.net);
    return r.kind === "flat" ? amt * pieces.length : amt;
  };
  const extraGrid = (section: ExtraChargeDraft["section"]) => {
    const own = extras.filter((x) => x.section === section);
    const columns: ChildGridColumn<ExtraChargeDraft>[] = [
      {
        header: "Charge",
        width: FIELD_WIDTH_CSS.party,
        cell: (r) => (
          <Input id={costingFieldId.extraName(r.key)} aria-label="Charge name" value={r.name} onChange={(e) => patchExtra(r.key, { name: e.target.value })} />
        ),
      },
      {
        header: "Type",
        width: FIELD_WIDTH_CSS.code,
        cell: (r) => (
          <Select aria-label="Charge type" value={r.kind} onChange={(e) => patchExtra(r.key, { kind: e.target.value === "pct" ? "pct" : "flat" })}>
            <option value="flat">Flat ₹</option>
            <option value="pct">Percent %</option>
          </Select>
        ),
      },
      {
        header: "Value",
        align: "right",
        width: FIELD_WIDTH_CSS.hug,
        cell: (r) => <NumInput id={costingFieldId.extraValue(r.key)} aria-label="Charge value" value={r.value} onChange={(e) => patchExtra(r.key, { value: e.target.value })} />,
      },
      ...(section === "price"
        ? [
            {
              header: "Effect",
              width: FIELD_WIDTH_CSS.code,
              cell: (r: ExtraChargeDraft) => (
                <Select aria-label="Add to or deduct from the price" value={r.sign} onChange={(e) => patchExtra(r.key, { sign: e.target.value === "deduct" ? "deduct" : "add" })}>
                  <option value="add">+ Add</option>
                  <option value="deduct">− Deduct</option>
                </Select>
              ),
            } satisfies ChildGridColumn<ExtraChargeDraft>,
          ]
        : []),
      {
        header: "Impact ₹",
        align: "right",
        width: FIELD_WIDTH_CSS.hug,
        cell: (r) => {
          const v = extraImpact(r);
          return <span className="text-sm tabular-nums text-muted-foreground">{isBlankExtra(r) || v == null ? "—" : money(v)}</span>;
        },
      },
    ];
    return (
      // Both sections share this wrapper, so the two grids stand at the same width and
      // their first four columns line up.
      <div className="max-w-[52rem] space-y-2">
        <h3 className="m-0 text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Extra charges</h3>
        {own.length === 0 ? (
          // Nothing added yet: the button alone, no empty table header above it.
          <div>
            <Button type="button" variant="outline" size="sm" data-row-add onClick={() => mutExtras((xs) => [...xs, blankExtra(section)])}>
              + Add charge
            </Button>
          </div>
        ) : (
        <div data-grid-style="sheet" data-grid-cells="flat" className="[&_table]:table-fixed">
        {/* default-row: exempt -- optional extras: none is a real answer, and a row appears only when "+ Add charge" is used */}
        <ChildGrid<ExtraChargeDraft>
          columns={columns}
          rows={own}
          tableAlways
          keepOne={false}
          removeHeader="Actions"
          addLabel="+ Add charge"
          onAdd={() => mutExtras((xs) => [...xs, blankExtra(section)])}
          onRemove={(r) => mutExtras((xs) => xs.filter((x) => x.key !== r.key))}
        />
        </div>
        )}
      </div>
    );
  };

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
              <Field label="Sample No" required w="party" htmlFor={costingFieldId.sample}>
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
      content: fabricList,
    },
    weights: {
      // The Garment weight table alone, full width (user 2026-10-08): CMT, Embellishment and
      // Testing moved to the CMT & charges step. Many sizes scroll inside the table's own
      // frame, never the page. No step total: the cost of a size is the table's own last row.
      right: null,
      content: consumptionMatrix(),
    },
    cmt: {
      right: head ? <Flash value={`₹${money(head.cmt + head.process + testingPc)}`} formula="CMT + Embellishment + Testing" /> : null,
      content: (
        // default-row: exempt -- one block per garment piece, DERIVED from the style line's coordinates; its CMT boxes are blank until a rate is typed, Embellishment is optional and opens with a calm empty line, and a blank box saves nothing
        cmtTable()
      ),
    },
    trims: {
      right: head ? <Flash value={`₹${money(head.trims)}`} formula="Trims" /> : null,
      content: (
        <div data-grid-style="sheet" data-grid-cells="flat" className="[&_table]:table-fixed">
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
    overheads: {
      right: head ? (
        <Flash value={`₹${money(bankPc + head.wastage + head.overhead + head.extraOverhead)}`} formula="Bank charges + Wastage + Overhead + extra charges" />
      ) : null,
      content: (
        <div className="space-y-4">
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
          {extraGrid("overhead")}
          {head ? (
            <p className="m-0 text-sm tabular-nums text-muted-foreground">
              {"Bank "}
              <b className="text-foreground">{`₹ ${money(bankPc)}`}</b>
              {" + Wastage "}
              <b className="text-foreground">{`₹ ${money(head.wastage)}`}</b>
              {" + Overhead "}
              <b className="text-foreground">{`₹ ${money(head.overhead)}`}</b>
              {head.extraOverhead ? (
                <>
                  {" + Charges "}
                  <b className="text-foreground">{`₹ ${money(head.extraOverhead)}`}</b>
                </>
              ) : null}
              {" = "}
              <b className="text-foreground">{`₹ ${money(bankPc + head.wastage + head.overhead + head.extraOverhead)}`}</b>
              {` per ${isSet ? "set" : "piece"}`}
            </p>
          ) : null}
        </div>
      ),
    },
  };

  // ==========================================================================
  // THE SUMMARY CARD (clean spec §3 right column) — one sticky card: net cost,
  // margin, currency and rate, the FINAL FOB price, the quoted price. The
  // breakdown and the target calculator are there but folded away.
  // ==========================================================================
  const single = quoteRows.length === 1 ? quoteRows[0] : null;
  const line = (label: string, value: string, opts: { total?: boolean; formula?: string } = {}) => (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        opts.total ? "my-1 rounded-md bg-surface-muted px-2 py-1.5 leading-6" : "px-2 py-1 leading-6"
      }`}
    >
      <dt className={`${opts.total ? "text-sm font-semibold text-foreground" : "text-[13px] font-medium text-muted-foreground"}`}>{label}</dt>
      <dd className={`m-0 text-right tabular-nums ${opts.total ? "text-[15px] font-bold text-foreground" : "text-sm font-semibold text-foreground"}`}>
        <Flash value={value} formula={opts.formula} />
      </dd>
    </div>
  );
  /** Rupee value of the quoted price (or, with none typed, of the calculated one) and its
   *  difference against the calculated price — null when the currency is INR or no rate yet. */
  const inrImpact = (() => {
    const fx = num(header.exchange_rate);
    if (!single || fx == null || fx === 1) return null;
    const quoted = num(quotes[single.key] ?? "");
    const calc = t?.calc ?? null;
    const price = quoted ?? calc;
    if (price == null) return null;
    return { value: price * fx, diff: quoted != null && calc != null ? (quoted - calc) * fx : null };
  })();
  const targetNum = num(targetPrice);
  const solve =
    t && targetNum != null
      ? solveTarget(t, header, targetNum, isSet ? pieces.length : 1, fabricKgFor(liveRows(draft).weights, railData?.size ?? null), live.extras)
      : null;

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
            {/* LIVE INR IMPACT, right beside the Quoted Price (client): rounding $7.2386
                to $7.25 looks like 1 cent but is ₹1+ a piece after the exchange rate, so the
                rupee value and the rupee difference against the calculated price stay in
                front of the merchandiser while they type. Shown only for a foreign currency
                (a rate of 1 would just repeat the box). Reads the same calc / rate the
                summary uses; nothing is stored. */}
            {single && inrImpact ? (
              <Field label={`In ₹ / ${unitWord}`.trim()} w="range">
                <div className="flex h-9 flex-col justify-center text-xs tabular-nums leading-tight" aria-live="polite">
                  <span className="text-sm font-semibold text-foreground">{`₹ ${money(inrImpact.value)}`}</span>
                  {inrImpact.diff != null && Math.abs(inrImpact.diff) >= 0.005 ? (
                    <span className={inrImpact.diff > 0 ? "text-success" : "text-danger"}>
                      {`${inrImpact.diff > 0 ? "+" : "−"}₹ ${money(Math.abs(inrImpact.diff))} vs calculated`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{inrImpact.diff == null ? "calculated price" : "same as calculated"}</span>
                  )}
                </div>
              </Field>
            ) : null}
          </FieldRow>
        </div>
        {extraGrid("price")}
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
          // default-row: exempt -- rows are DERIVED: one per piece × size the weights table names
          <div id="sc-quote-matrix" data-grid-style="sheet" className="[&_table]:table-fixed">
            <ChildGrid<QuoteRow>
              // grid-caption: exempt -- the card holds the charges above this grid
              label="Quote matrix — a price per piece and size"
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
  };

  /* WHY IT IS WITH THE MD (UX plan P3.2): the lowest-margin piece, how far it
     sits under the floor in rupees, and quoted against calculated price. */
  const lowest = (() => {
    let best: { piece: string; group: string | null; fig: CostingSummary["groups"][number]["pieces"][number] } | null = null;
    for (const g of summary.groups)
      for (const pc of g.pieces)
        if (pc.effectiveMarginPct != null && (best == null || pc.effectiveMarginPct < (best.fig.effectiveMarginPct ?? Infinity)))
          best = { piece: pc.pieceKey, group: g.size, fig: pc };
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
          {`Lowest: ${pieceName(lowest.piece)}, ${sizeLabel(lowest.group)} — quoted ${ccy ?? ""} ${(lowest.fig.quoted ?? lowest.fig.calc)?.toFixed(2) ?? "—"} against a calculated ${lowest.fig.calc?.toFixed(2) ?? "—"}.`}
          {lowestGap && !lowestGap.clearsFloor ? ` ₹${money(lowestGap.costCut)} / pc under the ${MARGIN_FLOOR_PCT}% floor.` : ""}
        </p>
      </section>
    ) : null;


  /*
   * ONE STEP, an accordion fold (AGENTS.md "Folds are accordions"): a header that
   * says what is inside and what it costs, and a body that mounts only while the
   * step is open. `focusProps` on the section claims it when Tab arrives on any
   * field — or on the header, which is a Tab stop (`data-row-open`) so tabbing off
   * the last field of one step lands on the next header and folds the one behind.
   *
   * A step is HELD OPEN after a failed Save while it still has something to fix
   * (`held`), so the blank mandatory field Save just named is never hidden behind
   * a fold. Before a Save is tried a new sheet is blank everywhere and holding
   * every step open would defeat the fold, so the hold waits for the attempt.
   */
  const stepProblem = (k: CardKey) => problems.some((p) => cardOf(p.section) === k);
  const held = (k: CardKey) => tried && stepProblem(k);
  const stepDone: Record<CardKey, boolean> = {
    info: !!header.opportunity_id && !!header.style_id,
    fabrics: live.fabrics.length > 0 && !stepProblem("fabrics"),
    weights: live.weights.length > 0 && !stepProblem("weights"),
    cmt: pieces.length > 0 && pieces.every((pc) => pieceCmt(pc) > 0),
    trims: live.trims.length > 0 && !stepProblem("trims"),
    overheads: !!(num(header.garment_waste_pct) || num(header.overhead_pct) || bankPc > 0),
    price: !!(num(header.margin_pct) != null && header.currency_code && num(header.exchange_rate) != null) && !stepProblem("price"),
  };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const blurbs: Record<CardKey, string> = {
    info: style?.name || enquiry?.name || "Choose the sample and the style",
    fabrics: plural(live.fabrics.length, "fabric", "fabrics"),
    weights: plural(lines.filter((l) => !isBlankLine(l)).length, "component", "components"),
    cmt: pieces
      .map((pc) => (pc.cmt_direct ? "Direct rate" : plural(pc.lines.filter((l) => l.kind === "cmt" && l.process_id).length, "operation", "operations")))
      .join(" · "),
    trims: plural(live.trims.length, "trim", "trims"),
    overheads: `Wastage ${header.garment_waste_pct || 0}% · Overhead ${header.overhead_pct || 0}%`,
    price: `Margin ${header.margin_pct || "—"}%${ccy ? ` · ${ccy}` : ""}`,
  };
  const amounts: Partial<Record<CardKey, number | null>> = {
    fabrics: head ? head.fabric : null,
    weights: null,
    cmt: head ? head.cmt + head.process + testingPc : null,
    trims: head ? head.trims : null,
    overheads: head ? bankPc + head.wastage + head.overhead : null,
  };
  /* Garment weight and Price & quote are not rupees, so they name their own unit. */
  const gramsShown = live.weights
    .filter((w) => w.size_name == null || w.size_name === (railData?.size ?? null))
    .reduce((x, w) => x + (gramsOf(w) ?? 0), 0);
  const amountTexts: Partial<Record<CardKey, string>> = {
    weights: gramsShown > 0 ? `${Math.round(gramsShown)} g` : "0 g",
    price: heroValue == null ? "—" : `${ccy ?? ""} ${heroValue.toFixed(2)}`.trim(),
  };
  const cardSection = (c: (typeof CARDS)[number], i: number) => {
    const b = c.key === "price" ? priceBody : cardBody[c.key];
    const open = fold.isOpen(c.key) || held(c.key);
    const amount = amounts[c.key];
    const amountText = amountTexts[c.key] ?? (amount != null ? `₹ ${money(amount)}` : null);
    return (
      <section
        key={c.key}
        id={cardAnchor(c.key)}
        {...fold.focusProps(c.key)}
        className={`scroll-mt-16 rounded-lg border ${open ? "border-primary/40" : "border-border"}`}
      >
        <h2 className="m-0">
          {/* button-shape: exempt -- a fold header, not an action button */}
          <button
            type="button"
            data-row-open
            aria-expanded={open}
            aria-controls={`${cardAnchor(c.key)}-body`}
            onClick={() => fold.toggle(c.key)}
            className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                open ? "bg-primary text-primary-foreground" : stepDone[c.key] ? "bg-success text-white" : "bg-surface-muted text-muted-foreground"
              }`}
            >
              {stepDone[c.key] && !open ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className="w-44 shrink-0 text-[15px] font-semibold text-foreground">{c.label}</span>
            {open ? null : <span className="min-w-0 max-w-[40%] flex-1 truncate text-sm font-normal text-muted-foreground lg:w-72 lg:flex-none">{blurbs[c.key]}</span>}
            {open ? (b.right ? <span className="text-sm font-semibold tabular-nums text-foreground">{b.right}</span> : null) : amountText != null ? (
              <span className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">{amountText}</span>
            ) : null}
            <span className="flex-1" />
            <ChevronRight aria-hidden className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        </h2>
        {open ? (
          <div id={`${cardAnchor(c.key)}-body`} className="px-4 pb-5 pt-1">
            {b.content}
          </div>
        ) : null}
      </section>
    );
  };

  /* WORK BACK FROM A TARGET (lives at the foot of the Quotation summary, user 2026-10-08). */
  const workBack = (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Work back from the buyer&apos;s target</div>
      <div className="space-y-2">
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
    </div>
  );

  /* THE COST WATERFALL — read off the shown group's figures; calc.ts stays the
     only place a price is worked out. The steps add up to the price: Fabric + CMT
     + Process (with testing) + Trims + Overheads (bank, wastage, overhead, extra
     charges) + Margin, then any discount / price charge as one Adj. step. */
  const waterfall = (() => {
    if (!t) return null;
    const adj = t.priceAdj - t.discount;
    const steps = [
      { label: "Fabric", v: t.fabric, bar: "bg-primary" },
      { label: "CMT", v: t.cmt, bar: "bg-accent" },
      { label: "Proc.", v: t.process + testingPc, bar: "bg-info" },
      { label: "Trims", v: t.trims, bar: "bg-warning" },
      { label: "Ovhd", v: bankPc + t.wastage + t.overhead + t.extraOverhead, bar: "bg-danger" },
      { label: "Margin", v: t.margin, bar: "bg-success" },
      ...(Math.abs(adj) > 0.005 ? [{ label: "Adj.", v: adj, bar: "bg-foreground/40" }] : []),
    ];
    let cum = 0;
    const cols = steps.map((s) => {
      const from = cum;
      cum += s.v;
      return { ...s, lo: Math.min(from, cum), hi: Math.max(from, cum) };
    });
    cols.push({ label: "Price", v: t.gross, bar: "bg-primary", lo: 0, hi: t.gross });
    const top = Math.max(...cols.map((c) => c.hi), 1) * 1.15;
    return { cols, top };
  })();

  /* WHAT-IF — the same garment at other margins. Margin is % of NET, so moving it
     from m0 to m shifts the calc price by net × (m − m0) ÷ 100 ÷ rate; everything
     else (freight, insurance, discount, price charges) is untouched. Read-only. */
  const marginNow = num(header.margin_pct) ?? 0;
  const rateNow = num(header.exchange_rate);
  const whatIf = [15, 20, 25, 30].map((m) => {
    const calc = t && t.calc != null && rateNow != null && rateNow > 0 ? t.calc + (t.net * (m - marginNow)) / 100 / rateNow : null;
    return { m, calc, delta: calc != null && t?.calc != null ? calc - t.calc : null, current: m === marginNow };
  });

  /* THE QUOTATION SUMMARY — the 60/40 split's right side: read-only, sticky, live.
     The selling terms stay in Price & quote, so no field lives here and Tab never
     lands in the aside. A price card (margin ring against the floor), the cost
     waterfall, then Breakdown · What-if · Target in one tab row so the rail stays
     short. */
  const marginFrac = Math.min(Math.max((t?.effectiveMarginPct ?? 0) / 35, 0), 1);
  const marginBarColour = health === "good" ? "bg-success" : health === "tight" ? "bg-warning" : "bg-danger";
  const hasPrice = !!t && t.gross > 0;
  const rail = (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3 shadow-sm">
      <div className="space-y-3 rounded-lg border border-border bg-primary-soft p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="m-0 text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Quotation summary</h2>
          {summary.groups.length > 1 ? (
            <ToggleGroup<string>
              label="Size shown"
              value={railData ? (railData.size ?? "all") : "all"}
              onChange={setRailGroup}
              options={summary.groups.map((g) => ({ value: g.size ?? "all", label: sizeLabel(g.size) }))}
            />
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">{t?.quoted != null ? "Final quoted FOB price" : "Calculated FOB price"}</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold leading-tight tracking-tight text-foreground">
              <Flash value={heroValue == null ? "—" : `${ccy ?? ""} ${heroValue.toFixed(2)}`.trim()} />
            </span>
            <span className="text-xs font-medium text-muted-foreground">/ {unitWord}</span>
          </div>
          {t ? <div className="text-[11px] tabular-nums text-muted-foreground">{`₹ ${money(t.gross)} before freight & insurance`}</div> : null}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            {health && hasPrice ? <StatusPill tone={HEALTH[health].tone}>{HEALTH[health].label}</StatusPill> : <StatusPill tone="neutral">No price yet</StatusPill>}
            <span className={`text-[15px] font-bold tabular-nums ${health && hasPrice ? HEALTH[health].text : "text-muted-foreground"}`}>
              {hasPrice ? `${pct(t?.effectiveMarginPct)} margin` : "—"}
            </span>
          </div>
          <div className="relative h-2 rounded-full border border-border bg-background" role="img" aria-label={`Margin ${pct(t?.effectiveMarginPct)}, floor ${MARGIN_FLOOR_PCT}%`}>
            <div className={`absolute inset-y-0 left-0 rounded-full transition-[width] ${hasPrice ? marginBarColour : ""}`} style={{ width: hasPrice ? `${marginFrac * 100}%` : "0%" }} />
            <i className="absolute -bottom-1 -top-1 w-0.5 rounded-sm bg-foreground" style={{ left: `${(MARGIN_FLOOR_PCT / 35) * 100}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0%</span>
            <span>{`Floor ${MARGIN_FLOOR_PCT}%`}</span>
            <span>35%</span>
          </div>
        </div>
        {summary.belowFloor ? <p className="m-0 text-xs text-danger">{floorSentence(summary.lowestMarginPct)}</p> : null}
      </div>

      {waterfall && t && t.gross > 0 ? (
        <div className="[@media(max-height:760px)]:hidden">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">How the price builds up</div>
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${waterfall.cols.length}, minmax(0, 1fr))` }}
            role="img"
            aria-label="Cost build-up: fabric, CMT, process, trims, overheads and margin stacking to the price"
          >
            {waterfall.cols.map((c) => (
              <div key={c.label} className="flex flex-col items-stretch gap-1">
                <div className="relative h-14 border-b border-border">
                  <i
                    className={`absolute inset-x-0 block rounded-sm ${c.bar}`}
                    style={{ bottom: `${(c.lo / waterfall.top) * 100}%`, height: `${Math.max(((c.hi - c.lo) / waterfall.top) * 100, 1.5)}%` }}
                  />
                  <span
                    className="absolute inset-x-0 text-center text-[9px] font-semibold tabular-nums text-foreground"
                    style={{ bottom: `calc(${(c.hi / waterfall.top) * 100}% + 2px)` }}
                  >
                    {Math.round(c.v)}
                  </span>
                </div>
                <span className="whitespace-nowrap text-center text-[8.5px] font-medium leading-none tracking-tight text-muted-foreground">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ToggleGroup<"breakdown" | "whatif" | "target">
        label="Summary view"
        role="tablist"
        value={railTab}
        onChange={setRailTab}
        options={[
          { value: "breakdown", label: "Breakdown" },
          { value: "whatif", label: "What-if" },
          { value: "target", label: "Target" },
        ]}
      />

      {railTab === "breakdown" ? (
        hasPrice ? (
          <div>
            <dl className="m-0">
              {railAll ? line("Fabric", money(t?.fabric)) : null}
              {railAll ? line("CMT & processing", money(t ? t.cmt + t.process + testingPc : null)) : null}
              {railAll ? line("Trims & accessories", money(t?.trims)) : null}
              {railAll ? line("Bank charges", money(t ? bankPc : null)) : null}
              {line("Net cost ₹", money(t?.net), { total: true, formula: "Fabric + CMT & processing + Trims + Bank" })}
              {railAll ? line(`Wastage ${header.garment_waste_pct || 0}%`, money(t?.wastage)) : null}
              {railAll ? line(`Overhead ${header.overhead_pct || 0}%`, money(t?.overhead)) : null}
              {railAll && t?.extraOverhead ? line("Other charges", money(t.extraOverhead)) : null}
              {line("Gross cost ₹", money(t?.grossCost), { total: true, formula: "Net + Wastage + Overhead" })}
              {railAll ? line(`Margin ${header.margin_pct || 0}%`, money(t?.margin)) : null}
              {railAll ? line(`Discount ${header.discount_pct || 0}%`, t?.discount ? `−${money(t.discount)}` : money(0)) : null}
              {railAll && t?.priceAdj ? line("Price charges", `${t.priceAdj < 0 ? "−" : ""}${money(Math.abs(t.priceAdj))}`) : null}
              {line("Price ₹", money(t?.gross), { total: true, formula: "Gross cost + Margin − Discount ± price charges" })}
            </dl>
            {/* button-shape: exempt -- a text link that folds the list, not an action button */}
            <button type="button" onClick={() => setRailAll((v) => !v)} className="mt-1 px-2 text-xs font-semibold text-primary hover:underline">
              {railAll ? "Show fewer lines" : "Show all lines"}
            </button>
          </div>
        ) : (
          <p className="m-0 px-2 text-xs text-muted-foreground">Add a fabric and a garment weight to see the price build up here.</p>
        )
      ) : null}

      {railTab === "whatif" ? (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Same garment, other margins</div>
          <div className="grid grid-cols-4 gap-1.5">
            {whatIf.map((w) => (
              <div
                key={w.m}
                className={`rounded-md border px-1 py-1.5 text-center ${w.current ? "border-primary bg-primary-soft" : "border-border bg-surface-muted"}`}
              >
                <div className="text-[10px] font-semibold text-muted-foreground">{`${w.m}%`}</div>
                <div className="text-[13px] font-bold tabular-nums text-foreground">{w.calc == null ? "—" : w.calc.toFixed(2)}</div>
                <div className={`text-[10px] font-semibold tabular-nums ${w.delta == null || Math.abs(w.delta) < 0.005 ? "text-muted-foreground" : w.delta > 0 ? "text-success" : "text-danger"}`}>
                  {w.delta == null ? "" : Math.abs(w.delta) < 0.005 ? "now" : `${w.delta > 0 ? "+" : "−"}${Math.abs(w.delta).toFixed(2)}`}
                </div>
              </div>
            ))}
          </div>
          <p className="m-0 text-[11px] text-muted-foreground">
            {`${ccy ?? ""} per ${isSet ? "set" : "piece"}, against the current ${marginNow}%. Under ${MARGIN_FLOOR_PCT}% goes to the MD. Change the margin in Price & quote.`.trim()}
          </p>
        </div>
      ) : null}

      {railTab === "target" ? workBack : null}
    </div>
  );

  const workspace = (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="w-full min-w-0 flex-1 space-y-3">
          {copiedFrom ? (
            <p className="m-0 rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-foreground">
              {`Copied from ${copiedFrom}. Check the figures, then save.`}
            </p>
          ) : null}
          {CARDS.map((c, i) => cardSection(c, i))}
        </div>
        <aside
          aria-label="Quotation summary"
          className="w-full lg:sticky lg:top-2 lg:max-h-[calc(100dvh-14rem)] lg:w-[20rem] lg:shrink-0 lg:overflow-y-auto"
        >
          {rail}
        </aside>
      </div>
    </div>
  );

  /* THE FOOTER'S STATUS is just the state of the sheet: the price bar at the top
     carries Net → Margin → FOB, so the dock that repeated them is gone. */
  const footerWord = dirty
    ? "Unsaved changes"
    : revisingFrom
      ? `New ${revisionShort(meta.version)}`
      : editId
        ? "Editing sample costing"
        : "New sample costing";
  const dock = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
      <span>{footerWord}</span>
      {heroValue != null ? (
        <>
          <span aria-hidden className="h-4 w-px bg-border" />
          <span className="font-semibold text-foreground">{`${t?.quoted != null ? "Quoted" : "FOB"} ${ccy ?? ""} ${heroValue.toFixed(2)} / ${unitWord}`.replace("  ", " ")}</span>
          <span className={`font-semibold ${health ? HEALTH[health].text : "text-foreground"}`}>{`${pct(t?.effectiveMarginPct)} margin`}</span>
          <span className="text-muted-foreground">{`Net ₹ ${money(t?.net)}`}</span>
        </>
      ) : null}
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
    const pieceFields: [string, (p: PieceDraft) => string][] = [
      ["CMT", (p) => money(pieceCmt(p))],
      ["Embellishment", (p) => money(pieceEmbellishment(p))],
      ["Testing", (p) => p.testing_cost],
      ["Bank", (p) => p.bank_cost],
    ];
    for (const pb of pieces) {
      const pa = a.pieces.find((x) => x.piece_name === pb.piece_name);
      for (const [label, get] of pieceFields) push(`${pb.piece_name} · ${label}`, pa ? get(pa) : "", get(pb));
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
            <Button variant="outline" size="sm" onClick={openCostSheet}>
              <ClipboardList className="h-4 w-4" aria-hidden /> Cost sheet
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

        <SubDetailSheet
          open={!!buildFabric}
          onClose={() => setBuildKey(null)}
          origin={buildOrigin}
          parent="costing"
          grid
          maxWidthClass="max-w-xl"
          title="How the fabric price is worked out"
        >
          {buildFabric ? fabricBuildUp(buildFabric) : null}
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
                <Field label="Size" w="term" htmlFor="sc-dim-col">
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
