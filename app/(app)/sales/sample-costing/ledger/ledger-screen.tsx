"use client";

/**
 * TEST DUPLICATE (user 2026-10-17): "build this into the real sample costing screen but
 * as a duplicated one — don't affect the current screen; if it is okay we can replace the
 * current screen". A copy of ../sample-costing-screen.tsx whose editor is the LEDGER
 * (components/sales/costing-ledger.tsx, artifact "Sample Costing — Single-Screen Entry"
 * Option 3) instead of the Cost Sheet tabs. Same data, same actions, same save — a
 * costing saved here is the same record the real screen opens. Only the workspace, the
 * list title and the draft slot differ; everything else is the original, kept in step by
 * hand until one replaces the other.
 *
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

import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTabResume } from "@/lib/workspace-tabs";
import {
  BadgeCheck,
  Calculator,
  CalendarRange,
  CircleX,
  Check,
  Clock,
  Copy,
  GitCompare,
  Hourglass,
  Pencil,
  RefreshCw,
  RotateCcw,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowIconAction } from "@/components/ui/row-actions";
import { MoreActions } from "@/components/ui/more-actions";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Field, FieldRow} from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import {
  MasterFullScreen,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { RecordPicker } from "@/components/masters/record-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { SubDetailSheet} from "@/components/orders/sub-detail-sheet";
import { CopySourceChooser, PreviewChip } from "@/components/orders/copy-source-chooser";
import { CustomerDecisionSheet, type CustomerDecision } from "@/components/sales/customer-decision-sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { SampleCards, type SampleCardState } from "@/components/sales/sample-queue";
import { FilterBar } from "@/components/ui/filter-bar";
import { createdByFacet, createdDateFacet, useFacetFilter, type FacetGroup } from "@/components/ui/filter-drawer";
import { fmtDate } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useFormDraft } from "@/lib/use-form-draft";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useOpenIntent } from "@/lib/use-open-intent";
import { costingRevisionOf } from "@/lib/sales/sample-revisions/actions";
import type { RevisionKind } from "@/lib/sales/sample-revisions/types";
import { sectionValidity, type Problem } from "@/lib/screens/validity";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";
import { statusTone } from "@/lib/ui/status-tone";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import type { SampleCostingFormData, CostingStyleOption } from "@/lib/sales/sample-costing/service";
import {
  fabricPricePerKg,
  num,
  pieceCmt,
  pieceEmbellishment,
  type CostingSummary,
} from "@/lib/sales/sample-costing/calc";
import {
  SHIP_MODES,
  STATUS_LABEL,
  costingFieldId,
  costingProblems,
  isBlankFabric,
  isBlankYarn,
  isEditableStatus,
  isDeletableStatus,
  isRevisableStatus,
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
  type CostingStatus,
  type ExtraChargeDraft,
  type FabricDraft,
  type FabricProcessDraft,
  type PieceDraft,
  type PieceLineDraft,
  type PieceLineKind,
  type RevisionRow,
  type TrimDraft,
  type WeightDraft,
  type YarnMixDraft,
} from "@/lib/sales/sample-costing/types";
import {
  deleteSampleCosting,
  fetchQuoteRate,
  loadSampleCosting,
  previewCostingNo,
  saveSampleCosting,
} from "@/lib/sales/sample-costing/actions";
import { offeredSizes } from "@/lib/sales/sample-costing/style-sizes";
import { newWeightRows, releaseCalculatedQuotes, weightsForFabrics } from "@/lib/sales/sample-costing/revision-draft";
import { buildCostSheetModel } from "@/lib/sales/sample-costing/cost-sheet";
import { CostSheetDocument } from "@/components/sales/cost-sheet-document";
import { CostingLedger } from "@/components/sales/costing-ledger";
import type { EditOptions } from "@/components/sales/cost-sheet-editors";

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


/**
 * COSTING'S OWN FIVE TABS (user 2026-10-14, screenshot 3475: "Pending is the
 * SMP; right after creating the costing, a new tab Under Progress … Updated
 * renamed Approved … Approved is the last tab: Pending, Under Progress,
 * Rejected, Draft, Approved"). The app-wide Pending / Updated / Draft box has
 * three fixed words, so Costing draws its own box in the same `ToggleGroup`:
 *
 *   Pending        — a saved sample with NO costing yet (the "Not costed" rows)
 *   Under Progress — every created CST (0728: a saved costing IS Under
 *                    Progress — with the buyer, negotiating, Revise as needed)
 *   Rejected       — the buyer declined (Customer Rejected, with the reason)
 *   Draft          — a costing saved as a draft, or a Sample Revision's proposal
 *   Approved       — the buyer accepted (Customer Approved; was "Updated")
 */
type CostingTab = "pending" | "progress" | "rejected" | "draft" | "approved";
/** Raise Revise (user 2026-10-14): the costing's report, opened already
 *  revising on the Cost Sheet — whose inner QUOTATION tab opens first (the
 *  buyer's Quotation document itself is read-only) — update, Save, and the next
 *  Rev is written with every earlier Rev kept as history. */
const raiseReviseHref = (id: string) => `/sales/sample-costing/${id}/reports?tab=cost-sheet&revise=1`;
/* FABRIC PLAN'S ICONS (user 2026-10-15, screenshot 3534: "costing status need
   to ui icon like fabric plan icons"). Same glyph per word as `StatusSegment`'s
   QUICK map (components/orders/bom-queue.tsx) — Clock · Hourglass · BadgeCheck
   · Pencil — and, like that box, untinted: only the lit tab carries colour.
   Rejected has no Fabric Plan twin, so it keeps CircleX. Supersedes the same
   morning's Design B (calculator / chat / pen-on-page, each status-tinted). */
const COSTING_TABS: { value: CostingTab; label: string; icon: typeof Clock }[] = [
  { value: "pending", label: "Pending", icon: Clock },
  { value: "progress", label: "Under Progress", icon: Hourglass },
  { value: "rejected", label: "Rejected", icon: CircleX },
  { value: "draft", label: "Draft", icon: Pencil },
  { value: "approved", label: "Approved", icon: BadgeCheck },
];
const TAB_LABEL = Object.fromEntries(COSTING_TABS.map((t) => [t.value, t.label])) as Record<CostingTab, string>;
const costingTabOf = (r: CostingListRow): CostingTab =>
  r.awaiting
    ? "pending"
    : r.is_draft || r.status === "draft"
      ? "draft"
      : r.status === "approved"
        ? "approved"
        : r.status === "rejected"
          ? "rejected"
          : "progress";
const isCostingTab = (v: string | null): v is CostingTab => !!v && COSTING_TABS.some((t) => t.value === v);

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
  buyer_target_price: "",
  commission_pct: "",
  notes: "",
});

/** Money in Indian grouping at a fixed precision (spec §2.2: rates 2 dp,
 *  foreign quotes 2 or 4 dp). A missing figure is a dash, never a zero. */
const money = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);






export function SampleCostingLedgerScreen({
  rows,
  awaiting = [],
  data,
  perms,
  nextCostingNo,
  letterhead,
}: {
  rows: CostingListRow[];
  /** Saved sample styles with no costing yet — listed as "Not costed". */
  awaiting?: CostingListRow[];
  data: SampleCostingFormData;
  perms: Perms;
  /** Fetched with the page so a new sheet's Costing No is filled on first paint. */
  nextCostingNo: string | null;
  letterhead: DocLetterhead;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  /* OPENING THE REVISE REPORT IS ITS OWN TRANSITION (user 2026-10-14,
     screenshot 3479: the footer read "Saving…" after Raise Revise). The report
     route can take seconds to load (a dev compile, a cold fetch), and while it
     did, the shared `isPending` drove the footer's Save into "Saving…" with
     nothing being saved. `opening` belongs to that navigation alone. */
  const [opening, startOpening] = useTransition();

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
  /** The open Sample Revision this sheet is the proposal of (0716), or null. */
  const [revOf, setRevOf] = useState<{ id: string; revision_code: string; status: "draft" | "pending"; kinds: RevisionKind[] } | null>(null);
  const [header, setHeader] = useState<CostingHeaderDraft>(blankHeader);
  const [pieces, setPieces] = useState<PieceDraft[]>([]);
  const [fabrics, setFabrics] = useState<FabricDraft[]>([]);
  /** Garment weight — the stored rows themselves, one per line × size, edited in
   *  the Fabric tab's Component consumption table exactly as Revise edits them. */
  const [weights, setWeights] = useState<WeightDraft[]>([]);
  const [trims, setTrims] = useState<TrimDraft[]>([]);
  /** The Overheads and Price & quote "+ Add" rows (0695), both sections in one list. */
  const [extras, setExtras] = useState<ExtraChargeDraft[]>([]);
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(nextCostingNo);
  /** Customer Approved / Customer Rejected sheet (0725) — the buyer's answer to an Under Progress quote. */
  const [decision, setDecision] = useState<CustomerDecision | null>(null);
  /** The same sheet, opened from an Under Progress CARD's ✓ / ✕ (user 2026-10-16,
   *  screenshot 3570) — the list has no open record, so it carries its own. */
  const [listDecision, setListDecision] = useState<{ id: string; label: string; decision: CustomerDecision } | null>(null);
  /** "Copied from CST/…" until the first save (P2.2). */
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  /** Size-Wise "Yes" picked while no size is added yet — once a size is on the sheet,
   *  the sizes themselves say Yes. Reset per record (the editor does not remount). */
  const [sizeWiseAsked, setSizeWiseAsked] = useState(false);
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

  // ---- the list's filters ----------------------------------------------------
  const [query, setQuery] = useState("");
  /** A superseded revision lives behind its successor's Revision picker. The
   *  samples with no costing yet stand in the same list, "Not costed" (user
   *  2026-10-12: "created sample entry, why not listing in sample costing?"). */
  const current = useMemo(() => [...rows.filter((r) => r.status !== "superseded"), ...awaiting], [rows, awaiting]);
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
  // The tab, seeded from `?status=` (so a shared link opens its pile) and then
  // owned here; written back with replaceState so a click never refetches.
  const tabParams = useSearchParams();
  const [tab, setTab] = useState<CostingTab>(() => {
    const v = tabParams.get("status");
    return isCostingTab(v) ? v : "pending";
  });
  /* CARD VIEW / LIST VIEW (user 2026-10-16) — the tab's own default until the
     operator picks; then this screen keeps the pick. Above every early return. */
  const viewMode = useViewMode("sample-costing", tab === "approved" || tab === "rejected" ? "list" : "cards");
  const pickTab = (v: CostingTab) => {
    setTab(v);
    const url = new URL(window.location.href);
    url.searchParams.set("status", v);
    window.history.replaceState(window.history.state, "", url);
  };
  const tabCounts = useMemo(() => {
    const c: Record<CostingTab, number> = { pending: 0, progress: 0, rejected: 0, draft: 0, approved: 0 };
    for (const r of searched) c[costingTabOf(r)]++;
    return c;
  }, [searched]);
  const filtered = searched.filter((r) => costingTabOf(r) === tab);

  // ---- derived state (cheap passes over the sheet's own rows) ---------------
  const draft: CostingDraft = { header, pieces, fabrics, weights, trims, quotes, extras };
  const summary: CostingSummary = summaryOf(draft);
  const live = liveRows(draft);
  const editable = isEditableStatus(meta.status) || !!revisingFrom;
  const enquiry = data.enquiries.find((e) => e.id === header.opportunity_id) ?? null;
  const style: CostingStyleOption | null = data.styles.find((s) => s.id === header.style_id) ?? null;
  const enquiryStyles = data.styles.filter((s) => s.opportunity_id === header.opportunity_id);
  const ccy = header.currency_code;
  const fabricLabel = (f: FabricDraft, i: number) =>
    f.quality.trim() || data.fabrics.find((x) => x.id === f.fabric_id)?.name || `Fabric ${i + 1}`;


  // ---- mutation helpers -------------------------------------------------------
  const setH = (patch: Partial<CostingHeaderDraft>) => {
    setHeader((h) => ({ ...h, ...patch }));
    setDirty(true);
  };

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
  /**
   * THE STYLE'S EMBELLISHMENTS BECOME EMBELLISHMENT LINES (client 2026-10-14:
   * Sample Entry ▸ Combos ▸ Embellishments "auto-feed … into the Embellishment
   * Cost"). The entry names the processes and carries no rate — the Process
   * master has none — so each arrives as a line with its process picked and the
   * ₹ / pc box empty for the costing to fill.
   *
   * WHICH PIECE: a Garment Process is done to the whole stitched garment, so on
   * a SET it lands on every piece (each piece is washed, each is charged). A
   * Component Process is on one cut panel, and the entry's panel does not name
   * a piece, so it lands on the first — the same home `applyStyle` gives the
   * lines of a piece that vanished.
   *
   * Only while NO piece has an embellishment picked, so re-picking the style
   * never doubles lines or overwrites rates already typed (the fabric seed's rule).
   */
  function seedEmbellishments(st: CostingStyleOption | null, next: PieceDraft[]): PieceDraft[] {
    if (!st?.processes.length) return next;
    if (next.some((p) => p.lines.some((l) => l.kind === "embellishment" && l.process_id))) return next;
    return next.map((p, i) => {
      const add = st.processes
        .filter((x) => x.kind === "garment" || i === 0)
        // One line per process on a piece — the picker refuses a second.
        .filter((x, xi, all) => all.findIndex((y) => y.id === x.id) === xi)
        .map((x) => ({ ...blankPieceLine("embellishment"), process_id: x.id, process_name: x.name }));
      return add.length ? { ...p, lines: [...p.lines.filter((l) => !(l.kind === "embellishment" && !l.process_id)), ...add] } : p;
    });
  }
  function applyStyle(st: CostingStyleOption | null, fresh = false) {
    const next = seedEmbellishments(st, piecesFor(st, fresh ? [] : pieces));
    const keep = new Set(next.map((p) => p.key));
    const first = next[0].key;
    setPieces(next);
    setWeights((xs) => xs.map((w) => (keep.has(w.piece_key) ? w : { ...w, piece_key: first })));
    setTrims((xs) => xs.map((t) => (keep.has(t.piece_key) ? t : { ...t, piece_key: first })));
    // The style's sizes are NOT pushed into Garment weight (client 2026-10-14:
    // "make it user control remove the auto fetch from style tab"). Size wise
    // Yes / No on that step decides, and the operator adds the sizes.
    // THE STYLE'S FABRIC STRUCTURES BECOME THE FABRIC LINES (client 2026-10-14:
    // Product Info → Costing fabric tab). Sample Entry already says which
    // structures the style is made in, so the costing opens with one line per
    // structure instead of asking for them again. Only while every fabric line is
    // blank, so a re-picked style never overwrites rates already typed.
    if (st?.structures.length && (fresh || fabrics.every(isBlankFabric))) {
      const seeded = st.structures.map((x) => {
        const f = blankFabric();
        const picked: FabricDraft = { ...f, ...pickedFabric(f, { id: x.id, name: x.name }) };
        // THE COMPOSITION SAMPLE ENTRY NAMED (spec v8 §7.1, 0726) becomes the
        // Yarn Mix — fibre and % — when nothing (rate memory) filled it first.
        // Rates stay blank: the composition says what, not what it costs.
        if (x.mix.length && picked.yarns.every(isBlankYarn)) {
          picked.yarns = x.mix.map((m) => ({ ...blankYarn(), yarn_name: m.name, mix_pct: m.pct }));
        }
        return picked;
      });
      setFabrics(seeded);
      // Each structure gets its own Component consumption line (`weightsForFabrics`).
      setWeights((xs) => weightsForFabrics(xs, seeded.map((x) => x.key), next[0].key));
    }
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
    // A new sheet opens with one blank "All sizes" line.
    setWeights(d.weights.length ? d.weights : newWeightRows(firstPiece, [], null, [null]));
    setTrims(d.trims.length ? d.trims : [blankTrim(firstPiece)]);
    setExtras(d.extras);
    // A stored quote equal to its Calculated price follows the costs again (2026-10-22).
    setQuotes(releaseCalculatedQuotes(d).quotes);
    setCopiedFrom(null);
    setSizeWiseAsked(false);
    setCompare(null);
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
      buyer_target_price: d.header.buyer_target_price,
      commission_pct: d.header.commission_pct,
    });
    setPieces(nextPieces);
    setFabrics(nextFabrics.length ? nextFabrics : [blankFabric()]);
    setWeights(
      d.weights.length
        ? d.weights.map((w) => ({ ...w, key: newKey(), piece_key: pieceMap.get(w.piece_key) ?? firstPiece, fabric_key: w.fabric_key ? (fabricMap.get(w.fabric_key) ?? null) : null }))
        : newWeightRows(firstPiece, [], null, [null]),
    );
    setTrims(
      d.trims.length ? d.trims.map((t) => ({ ...t, key: newKey(), piece_key: pieceMap.get(t.piece_key) ?? firstPiece })) : [blankTrim(firstPiece)],
    );
    setExtras(d.extras.map((x) => ({ ...x, key: newKey() })));
    setCopiedFrom(`${src.code ?? "a costing"} · ${revisionShort(src.version)}`);
    setDirty(true);
  }
  /** Copy from… — the chooser has already loaded `src` for its preview, so
   *  pressing Copy applies it with no second fetch. */
  function copyFrom(src: CostingRecord) {
    setCopyOpen(false);
    applyCopy(src, header, pieces);
    success(`Copied from ${src.code ?? "the costing"} — check the figures, then save.`);
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
    // A rate belongs to its currency: switching USD → GBP must not keep the USD
    // rate (the INR baseline would be divided by the wrong number). A new currency
    // takes the master's rate, or a blank box that the Price step then asks for.
    const r = code === "INR" ? 1 : data.quoteRates[code];
    if (code === header.currency_code) return;
    setH({ currency_code: code, exchange_rate: r ? String(r) : header.currency_code ? "" : header.exchange_rate });
    // FETCHED, NOT TYPED (user 2026-10-16): with no register rate, the new
    // currency's rate is fetched at once instead of leaving the box blank.
    if (!r && code) fetchRate(code);
  }
  /** What picking fabric `v` on line `f` writes: the remembered rates when none are typed, else the structure's usual loss. */
  function pickedFabric(f: FabricDraft, v: { id: string | null; name: string }): Partial<FabricDraft> {
    const typed =
      [f.yarn_rate, f.knitting_rate, f.dyeing_rate, f.finishing_rate, f.direct_rate].some((x) => x.trim()) ||
      f.yarns.some((y) => y.mix_pct.trim() || y.rate.trim()) ||
      f.processes.some((x) => x.rate.trim());
    const memo = data.rateMemory.find((m) => m.key === rateMemoryKey(v.id, v.name));
    if (memo && !typed) {
      return {
        ...memo.fabric,
        fabric_id: v.id,
        quality: v.name,
        yarns: memo.fabric.yarns.length ? memo.fabric.yarns.map((y) => ({ ...y, key: newKey() })) : [blankYarn()],
        processes: memo.fabric.processes.length ? memo.fabric.processes.map((x) => ({ ...x, key: newKey() })) : [blankProcess()],
      };
    }
    const lossMemo =
      v.id && !f.process_loss_pct.trim()
        ? data.constructionLoss.find((c) => c.category_id === data.fabrics.find((x) => x.id === v.id)?.category_id)
        : undefined;
    return { fabric_id: v.id, quality: v.name, ...(lossMemo ? { process_loss_pct: lossMemo.loss_pct } : {}) };
  }

  function openAdd() {
    setEditId(null);
    setRevisingFrom(null);
    setRevisions([]);
    setDecision(null);
    setMeta({ code: null, version: 1, status: "draft", isDraft: false, decisionRemark: null });
    setPreview(nextCostingNo);
    seedAndOpen({ header: blankHeader(), pieces: [blankPiece("GARMENT", null)], fabrics: [], weights: [], trims: [], quotes: {}, extras: [] });
  }
  /**
   * NEW SAMPLE COSTING STARTS ON A SAMPLE (user 2026-10-17, screenshot 3587: "already
   * we will fetch smp numbers why its again asking here so default fetch that"). The
   * button used to open with SMP Number blank; it now takes the NEWEST saved sample
   * that still has a style to cost — the one a merchandiser is about to cost — with
   * its style when it has only one, exactly as "Start costing" on a row does. The
   * picker stays live, so a different sample is one pick away.
   */
  function openNew() {
    openAdd();
    // `data.enquiries` is in entry order (oldest first), so the last eligible is the newest.
    const pick = [...data.enquiries].reverse().find((e) => !e.all_costed && !e.is_draft);
    if (!pick) return;
    const only = data.styles.filter((st) => st.opportunity_id === pick.id && !st.costed);
    setHeader((h) => ({ ...h, opportunity_id: pick.id, style_id: only.length === 1 ? only[0].id : null }));
    if (only.length === 1) applyStyle(only[0], true);
    fillFromCustomer(pick.id);
  }
  useCreateIntent(() => {
    if (perms.canCreate) openNew();
  });

  /* THE COSTING'S OWN REVISE (0725, spec v8 §1 / §8.1: "Revise" for the
     quotation, "Revision" only for Sample Info and the plans). The server copies
     the stored sheet into version + 1 and supersedes this one — Under Progress
     stays Under Progress (each counter-offer is a Rev), Approved re-opens the
     negotiation, Rejected comes back as a new Draft. Then the new Rev opens.
     DECLARED ABOVE `openById`, which calls it: the React Compiler refuses a
     function read before its declaration (react-hooks/immutability). */
  function reviseNow(id: string) {
    startOpening(() => router.push(raiseReviseHref(id)));
  }

  function openById(id: string, opts?: { revise?: boolean }) {
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
      setDecision(null);
      setRevOf(await costingRevisionOf(r.id));
      /* STARTED FROM THE REPORT'S "Revise" (`?reviseFrom=`). Since 0725 that is
         the costing's own Revise again — version + 1, made on the server from
         the stored sheet (0716–0724 sent it to a Sample Revision instead). */
      if (opts?.revise) {
        if (isRevisableStatus(r.status) && perms.canEdit) {
          reviseNow(r.id);
        } else {
          toastError("Only an Under Progress, Approved or Rejected costing is revised, and only by someone who can edit.");
        }
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
  // The top-navigation tab reopens THIS costing, not the list (user 2026-10-09).
  useTabResume(pathname, mode === "edit" && editId ? `?open=${editId}` : null);
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
    if (only.length === 1) applyStyle(only[0], true);
    fillFromCustomer(oppId);
  });
  /** "Start costing" on a Not costed row — a new sheet on that sample and
   *  style, the way Sample Entry's "Cost this sample" opens one. */
  function startCostingFor(r: CostingListRow) {
    if (!perms.canCreate) return;
    openAdd();
    const st = r.style_id ? data.styles.find((x) => x.id === r.style_id) : undefined;
    setHeader((h) => ({ ...h, opportunity_id: r.opportunity_id, style_id: st?.id ?? null }));
    if (st) applyStyle(st, true);
    fillFromCustomer(r.opportunity_id);
  }
  /**
   * `?reviseFrom=<id>` (the Reports page's "open the full editor" link) and
   * `?costFor=<enquiry>` (Sample Entry's "Cost this sample") are ONE-SHOT
   * SHORTCUTS: act once, then take the parameter out of the address.
   *
   * IT USED TO TAKE IT OUT WITH `router.replace`, AND THAT WAS THE BUG (client
   * 2026-10-09: "I click the report, it is not opening"). `router.replace`
   * re-runs the server component; the Status chips rewrite the address with
   * `replaceState` from `window.location`, parameter still in it. The two undid
   * each other, the effect re-fired on every change, and the churn of replaces
   * cancelled the click's own `router.push` to a report — so the Reports icon
   * did nothing while a stale `?reviseFrom=` sat in the URL.
   *
   * So: remember what was handled (a ref), and clear the parameter with
   * `history.replaceState` — no navigation, no refetch, nothing to race. Next
   * keeps `useSearchParams` in step with it.
   */
  const reviseFor = useEffectEvent((id: string) => openById(id, { revise: true }));
  const handledIntent = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const [name, act] of [
      ["reviseFrom", (id: string) => reviseFor(id)],
      ["costFor", (id: string) => startFor(id)],
    ] as const) {
      const id = params.get(name);
      if (!id) continue;
      // Strip it from the address whether or not it was already handled — a
      // stale copy re-added by another writer must not linger.
      const next = new URLSearchParams(window.location.search);
      next.delete(name);
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
      const once = `${name}:${id}`;
      if (handledIntent.current.has(once)) continue;
      handledIntent.current.add(once);
      // After the effect, not inside it: opening sets a dozen pieces of state.
      queueMicrotask(() => act(id));
    }
  }, [params, pathname]);

  /**
   * A DRAFT IS NEVER LOST (UX plan P1.4): the app's `useFormDraft` keeps the
   * sheet in this browser while it is edited, and offers it back when the same
   * sheet is opened again. One slot per sheet (a revision being written has
   * its own). Cleared on a successful save.
   */
  const formDraft = useFormDraft({
    // "-2": the shape changed in 0693 (sizes are names, Loss % is per size) — an older saved draft is not offered back.
    storageKey: `sample-costing-ledger-4:${revisingFrom ? `rev-${revisingFrom}` : (editId ?? "new")}`,
    enabled: mode === "edit" && (isEditableStatus(meta.status) || !!revisingFrom),
    value: { header, pieces, fabrics, weights, trims, quotes, extras },
    onRestore: (v) => {
      setHeader(v.header);
      setPieces(v.pieces.map(seedPiece));
      setFabrics(v.fabrics);
      setWeights(v.weights);
      setTrims(v.trims);
      setExtras(v.extras ?? []);
      setQuotes(v.quotes);
      setDirty(true);
    },
  });

  function closeEditor() {
    setMode("list");
    setDirty(false);
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
    if (editId) reviseNow(editId);
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
  /* The tab screen has no step to open or field to ring: the message names the
     field, and the tab it sits on is one click away. */
  const reveal = (p: CostingProblem | undefined) => {
    if (p) toastError(p.message);
  };
  const revealFirstProblem = () => {
    reveal(problems[0]);
  };


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
      // SAVE CLOSES THE EDITOR (user 2026-10-16: "after saving costing it needs to
      // automatically close"). It used to re-open the saved record; the list now
      // shows it, and the row's pencil opens it again.
      closeEditor();
    });
  }

  /* NO SEND STEP (0728, user 2026-10-14): a saved costing IS Under Progress —
     the quote is with the buyer. Their answer is Customer Approved / Rejected. */

  /** `forCode` lets a currency change fetch for the code it is switching TO,
   *  before that choice has reached `header`. */
  function fetchRate(forCode?: string) {
    const code = forCode ?? header.currency_code;
    if (!code) {
      toastError("Choose the currency first.");
      return;
    }
    start(async () => {
      const res = await fetchQuoteRate(code, header.costing_date || null);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setH({ exchange_rate: String(res.rate) });
      success(`${code} rate ${res.rate} from ${res.source}${res.effectiveFrom ? `, ${fmtDate(res.effectiveFrom)}` : ""}.`);
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


  // ---- the list -----------------------------------------------------------------
  const lockReason = (r: CostingListRow) =>
    isEditableStatus(r.status) ? null : `${STATUS_LABEL[r.status]} — open it to view or revise.`;
  // ==========================================================================
  // THE ENTRY IS THE REPORT'S TAB SCREEN (client 2026-10-16)
  // ==========================================================================
  /*
   * "For the costing screen, use the report's Revise screen." The seven
   * step-by-step cards and the Quotation summary rail are gone: a costing is
   * entered on the same Details · Fabric · Operations & trims · Cost & overheads
   * · Quotation · Revisions · Charts tabs that Costing ▸ Reports shows and Revise
   * edits — one screen, one set of editable tables (`CostSheetDocument`).
   *
   * The sheet draws from a model built here on every render, from this editor's
   * own state, by the same `buildCostSheetModel` the Reports page and its PDF
   * use — so what is typed here and what is printed cannot disagree. The few
   * things a revision copies but a NEW costing must choose (sample, style, date,
   * sizes, currency, ship mode) are this screen's own controls, handed into the
   * tabs they belong on. Everything the editor did before around them still
   * runs: the style's pieces, structures and embellishments seed on pick, the
   * customer's last terms fill blanks, a picked fabric brings its last rates.
   */
  const head = summary.groups[0]?.total ?? null;

  /* SMP NUMBER AND STYLE ARE ASKED ONLY ON A NEW SHEET (user 2026-10-17: "no need this
     two field, show the SMP number in the details section"). A saved costing or a
     revision cannot change either — the boxes were disabled pickers repeating a fact —
     so they become the first two facts of the line below. */
  const pickSample = !editId && !revisingFrom;
  const inherited: { label: string; value: string }[] = [
    { label: "SMP Number", value: pickSample ? "" : (enquiry?.code ?? "") },
    { label: "Style", value: pickSample ? "" : (style?.name ?? "") },
    { label: "Customer", value: enquiry?.customer_name ?? "" },
    { label: "Season", value: [enquiry?.season, enquiry?.season_year].filter(Boolean).join(" ") },
    { label: "Description", value: style?.description ?? "" },
    {
      label: "Unit",
      value: style ? (style.unit_kind === "set" ? `SET · ${pieces.map((p) => p.piece_name).join(" + ")}` : style.unit_kind === "piece" ? "PCS" : "") : "",
    },
  ].filter((x) => x.value);

  const detailsBlock = (
        <div className="space-y-4">
          <div className={`${DETAILS_W} space-y-3`}>
            {/* WHAT IS BEING COSTED COMES FIRST (user 2026-10-07): the Sample No and
                Style row leads, so a new sheet's cursor lands on Sample No —
                the one question to answer before anything else. */}
            <FieldRow gap="row" align="start">
              {pickSample ? (
              <>
              <Field label="SMP Number" required w="party" htmlFor={costingFieldId.sample}>
                <RecordPicker
                  id={costingFieldId.sample}
                  label="SMP Number"
                  compact
                  required
                  disabled={!!editId || !!revisingFrom}
                  /* AN ALREADY-COSTED SAMPLE IS NOT OFFERED AGAIN (client spec
                     2026-10-12 §3: "once a costing sheet is created for a Sample
                     Number, filter it out … to prevent duplicate costing"). A
                     new costing of one is a REVISION of its sheet (Revise), not
                     a second sheet. The value this sheet already holds always
                     survives ("Disabled rows"). */
                  items={data.enquiries
                    .filter((e) => !e.all_costed || e.id === header.opportunity_id)
                    .map((e) => ({ id: e.id, code: e.code, name: e.name, inactive: e.is_draft && e.id !== header.opportunity_id }))}
                  emptyHint="Every saved sample is costed already — open its sheet to revise it."
                  value={header.opportunity_id}
                  onChange={(id) => {
                    setH({ opportunity_id: id, style_id: null });
                    // A one-style enquiry answers the Style question itself.
                    const only = data.styles.filter((s) => s.opportunity_id === id && !s.costed);
                    if (only.length === 1) {
                      setH({ opportunity_id: id, style_id: only[0].id });
                      applyStyle(only[0]);
                    }
                  }}
                />
              </Field>
              {/* `term`, not `name` (user 2026-10-17, "compact the fields"): a style is a
                  short code — 8547656D01 — and 288px left a wide empty box. */}
              <Field label="Style" required w="term" htmlFor={costingFieldId.style}>
                <RecordPicker
                  id={costingFieldId.style}
                  label="Style"
                  compact
                  required
                  disabled={!header.opportunity_id || !!editId || !!revisingFrom}
                  // A costed style leaves the list too — the held one always stays.
                  items={enquiryStyles
                    .filter((s) => !s.costed || s.id === header.style_id)
                    // Named by the style alone — no PRD number in the Sample module (client 2026-10-14).
                    .map((s) => ({ id: s.id, code: s.name, name: s.name }))}
                  value={header.style_id}
                  onChange={(id) => {
                    setH({ style_id: id });
                    applyStyle(data.styles.find((s) => s.id === id) ?? null);
                    fillFromCustomer(header.opportunity_id);
                  }}
                />
              </Field>
              </>
              ) : null}
              {/* No Costing No box (user 2026-10-15, duplicates on the page): the
                  number is generated and read-only, and the header already shows it. */}
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
              {/* CURRENCY BESIDE THE DATE (user 2026-10-17, screenshot 3589: "move the
                  currency field also near to the costing date"). It was asked on the
                  Quotation tab and echoed here as a read-only box; it is one of the
                  questions a sheet answers before any rate is typed, so it joins the row
                  and the Quotation tab no longer asks it. */}
              <Field label="Currency" required w="range">
                <CurrencyPicker label="Currency" compact currencies={data.currencies} value={header.currency_code} canCreate={false} canEdit={false} onChange={onCurrency} />
              </Field>
              {/* ONLY WHEN THERE IS ANOTHER REVISION TO OPEN (user 2026-10-17: "rev no
                  need that blank field"). A new sheet showed an empty, dead box here; the
                  header already reads "Rev 0". */}
              {editId && revisions.length > 1 && !revisingFrom ? (
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
                  {/* Revision only, no status (user 2026-10-15): the header's pill
                      already says Under Progress / Approved for the one on screen. */}
                  {(revisions.length ? revisions : [{ id: editId ?? "", version: meta.version, status: meta.status }]).map((r) => (
                    <option key={r.id} value={r.id}>
                      {revisionLabel(r.version)}
                    </option>
                  ))}
                </Select>
              </Field>
              ) : null}
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
              Rejected by the buyer: {meta.decisionRemark}
            </p>
          ) : null}
        </div>
  );

  /* SIZES — the columns of Component consumption. None = one "All sizes" column.
     The first size added takes over the All-sizes rows; each later size starts
     as a copy of the first size's lines, grams included, to be adjusted. */
  const sheetSizes = [...new Set(weights.map((w) => w.size_name).filter((z): z is string => !!z))];
  const styleSizes = style?.sizes ?? [];
  const offered = offeredSizes([...styleSizes, ...data.sizeMaster], sheetSizes);
  const offeredFromStyle = offeredSizes(styleSizes, sheetSizes);
  const sizeOrder = [...offeredFromStyle, ...offered.filter((z) => !offeredFromStyle.includes(z))];
  const addSize = (name: string) => {
    if (!name || sheetSizes.some((x) => x.trim().toUpperCase() === name.trim().toUpperCase())) return;
    const first = sheetSizes[0];
    setWeights((ws) =>
      first
        ? [...ws, ...ws.filter((w) => w.size_name === first).map((w) => ({ ...w, key: newKey(), size_name: name }))]
        : ws.map((w) => ({ ...w, size_name: name })),
    );
    setDirty(true);
  };
  const removeSize = (name: string) => {
    setWeights((ws) =>
      sheetSizes.length === 1 ? ws.map((w) => (w.size_name === name ? { ...w, size_name: null } : w)) : ws.filter((w) => w.size_name !== name),
    );
    setDirty(true);
  };
  /* SIZE-WISE YES / NO (client 2026-10-17). No = one medium piece's weight costs every
     size (the "All sizes" column, headed Avg Pcs Wgt); Yes = a column per size added
     here, averaged in Component consumption. Turning it off keeps the MEDIUM size's
     weights — the middle of the sizes added, so S·M·L·XL keeps M — as that one column. */
  const sizeWise = sizeWiseAsked || sheetSizes.length > 0;
  const setSizeWise = (on: boolean) => {
    setSizeWiseAsked(on);
    /* YES SHOWS THE SIZES AT ONCE (user 2026-10-17, screenshot 3593): the style's own
       sizes become the columns, each starting from the Pcs Wgt already typed, and the
       Pcs Wgt column goes. A style with no sizes leaves the "+ Add size" pick. */
    if (on) {
      const names = offeredFromStyle;
      if (!sheetSizes.length && names.length) {
        setWeights((ws) => names.flatMap((name) => ws.map((w) => ({ ...w, key: w.size_name == null && name === names[0] ? w.key : newKey(), size_name: name }))));
        setDirty(true);
      }
      return;
    }
    if (!sheetSizes.length) return;
    const mid = sheetSizes[Math.floor((sheetSizes.length - 1) / 2)];
    setWeights((ws) => ws.filter((w) => w.size_name === mid || w.size_name == null).map((w) => ({ ...w, size_name: null })));
    setDirty(true);
  };
  const sizesBar = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Size-Wise</span>
      <Segmented<"yes" | "no">
        name="costing-size-wise"
        value={sizeWise ? "yes" : "no"}
        onChange={(v) => setSizeWise(v === "yes")}
        options={[
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
        ]}
      />
      {!sizeWise ? null : sheetSizes.length ? (
        sheetSizes.map((z) => (
          <span key={z} className="inline-flex items-center gap-1 rounded-control border border-border bg-surface px-2 py-1 text-sm font-medium">
            {z}
            {/* button-shape: exempt -- a 20px ✕ inside a size chip, not an action button */}
            <button
              type="button"
              aria-label={`Remove size ${z}`}
              onClick={() => removeSize(z)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-control text-muted-foreground hover:bg-danger-soft hover:text-danger"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))
      ) : (
        <span className="text-sm text-muted-foreground">Add the sizes to weigh</span>
      )}
      {sizeWise && sizeOrder.length ? (
        <Select aria-label="Add a size" className="w-40" value="" onChange={(e) => addSize(e.target.value)}>
          <option value="">+ Add size…</option>
          {sizeOrder.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );

  /* SHIP MODE and the rate fetch — Currency moved to the Details row (2026-10-17); the
     Quotation tab's terms table edits the margin, exchange rate, commission, discount,
     freight and insurance itself. */
  const termsBar = (
    <div className="mb-3">
      <FieldRow gap="row" align="end">
        <Field label="Ship Mode" w="range" htmlFor="sc-ship">
          <Select id="sc-ship" value={header.ship_mode} onChange={(e) => setH({ ship_mode: e.target.value })}>
            <option value=""></option>
            {SHIP_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="outline" onClick={() => fetchRate()} disabled={!header.currency_code || isPending}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Fetch exchange rate
        </Button>
      </FieldRow>
    </div>
  );

  const sheetModel = buildCostSheetModel(
    {
      id: editId ?? "new",
      code: meta.code ?? preview,
      version: meta.version,
      status: meta.status,
      is_draft: meta.isDraft,
      parent_id: null,
      decision_remark: meta.decisionRemark,
      draft,
    },
    { enquiries: data.enquiries, styles: data.styles, components: data.components, trims: data.trims, quoteRates: data.quoteRates },
    letterhead,
  );
  /** The masters the tables' row pickers list: live rows only (AGENTS.md "Disabled rows"). */
  const liveOpts = <T extends { id: string; name: string } & Deactivatable>(xs: readonly T[]) =>
    xs.filter((r) => !isInactive(r)).map((r) => ({ id: r.id, name: r.name }));
  const editOptions: EditOptions = {
    fabrics: liveOpts(data.fabrics),
    yarns: liveOpts(data.yarns),
    processes: liveOpts(data.processes),
    garmentProcesses: data.garmentProcesses
      .filter((r) => !isInactive(r))
      .map((r) => ({ id: r.id, name: r.name, garment_kind: r.garment_kind, cmt_stage: r.cmt_stage, standard_rate: r.standard_rate })),
    components: liveOpts(data.components),
    trims: liveOpts(data.trims),
    lockedFabrics: style?.structures.map((x) => x.id) ?? [],
  };
  /** One edit in a tab writes the whole draft back into this editor's state. */
  const applyDraft = (next: CostingDraft) => {
    setHeader(next.header);
    setPieces(next.pieces);
    setFabrics(next.fabrics);
    setWeights(next.weights);
    setTrims(next.trims);
    setQuotes(next.quotes);
    setExtras(next.extras);
    setDirty(true);
  };

  const workspace = (
    <div className="space-y-3">
      {copiedFrom ? (
        <p className="m-0 rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-foreground">
          {`Copied from ${copiedFrom}. Check the figures, then save.`}
        </p>
      ) : null}
      {/* THE LEDGER while the sheet can be edited; a locked revision (Approved, Rejected,
          Superseded) is read on the Cost Sheet tabs exactly as the real screen shows it. */}
      {editable ? (
        <CostingLedger
          model={sheetModel}
          problems={problems}
          edit={{ draft, onChange: applyDraft, options: editOptions, details: detailsBlock, sizes: sizesBar, sizeWise, terms: termsBar, pickFabric: pickedFabric }}
        />
      ) : (
        <CostSheetDocument model={sheetModel} entry locked={dirty || !editId} />
      )}
    </div>
  );

  /* THE FOOTER'S STATUS is just the state of the sheet: the price bar at the top
     carries Net → Margin → FOB, so the dock that repeated them is gone. */
  /* NOTHING THE PAGE ALREADY SAYS (user 2026-10-15): "Editing sample costing"
     is the header's own label, and the Quoted / margin / Net figures are the
     Quotation Summary's — so the footer keeps only a state the page shows
     nowhere else. */
  const footerWord = dirty
    ? "Unsaved changes"
    : revisingFrom
      ? `New ${revisionShort(meta.version)}`
      : editId
        ? null
        : "New sample costing";
  const dock = footerWord ? <span>{footerWord}</span> : null;

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

  /* 0725: Approved / Rejected are the BUYER'S answer, and Revise is the way on. */
  const lockMessage = !editable
    ? meta.status === "approved"
      ? "Approved by the buyer and locked. To change the price, Raise Revise — the next revision opens Under Progress."
      : meta.status === "rejected"
        ? "Rejected by the buyer. Raise Revise opens the next revision as a Draft; saving it sends it back to the buyer (Under Progress)."
        : "This revision has been superseded by a later one. Open the latest from Revision."
    : null;

  /** Copy from… (P2.2): every other live costing, the same customer first, newest first.
   *  A "Not costed" row (`awaiting`) has no sheet behind it, so nothing to copy. */
  const copyCandidates = current
    .filter((r) => !r.awaiting && r.id !== editId && r.id !== revisingFrom)
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
      ["Garment Rejection %", "garment_waste_pct"],
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

  if (mode === "edit") {
    // A Sample Revision's proposal is sent to the MD by the revision, not here.
    /** Under Progress, saved and untouched: the buyer's answer can be recorded (0725). */
    const decideNow = !!editId && !revisingFrom && !revOf && meta.status === "submitted" && !meta.isDraft && perms.canEdit && !dirty;
    const costingLabel = `${meta.code ?? "Costing"} · ${revisionShort(meta.version)}`;
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
          {/* No desktop "← Costing" (user 2026-10-15, reversing 2026-10-14's back
              link): the Costing tab and the footer's Cancel already leave. */}
          <div className="flex min-w-0 shrink-0 items-baseline gap-2 max-md:shrink max-md:flex-wrap">
            <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
              {revisingFrom ? "Revise Sample Costing" : !editable ? "View Sample Costing" : editId ? "Edit Sample Costing" : "New Sample Costing"}
            </span>
            <span className="text-sm font-semibold text-foreground">{meta.code ?? preview ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{revisionShort(meta.version)}</span>
            {/* No "New revision" pill (client spec 2026-10-12 §7: no extra
                status labels or revision flags) — the label above already
                says "Revise Sample Costing" and the Rev number. */}
            {!revisingFrom && editId ? (
              <StatusPill tone={statusTone(meta.isDraft ? "draft" : meta.status)}>{meta.isDraft ? "Draft" : STATUS_LABEL[meta.status]}</StatusPill>
            ) : null}
          </div>
          {/* The SMP · style · customer · season line stood here and was removed
              (user 2026-10-15) — the editor's own sections already name them. */}
          <div aria-hidden className="h-px min-w-[2rem] flex-1 self-center bg-border" />
          {/* THE BUTTON PLAN (user 2026-10-09): More and the ONE next step,
              filled — at 36px like every header. Copy from and Compare are
              now-and-then actions, folded under More. REPORTS AND SUBMIT ARE ON
              THE LIST (user 2026-10-14): the card's Reports and Send icons, so a
              saved costing is sent without opening it again. The way back is
              the ← text link at the start of this band. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <MoreActions
              items={[
                ...(editable && copyCandidates.length
                  ? [{ label: "Copy from…", icon: Copy, onClick: () => setCopyOpen(true) }]
                  : []),
                ...(revisions.length > 1 && editId
                  ? [{ label: "Compare revisions", icon: GitCompare, onClick: () => openCompare(revisions.find((r) => r.id !== editId)!.id) }]
                  : []),
                // 0725: a counter-offer is a new Rev; the buyer's "no" is an answer, not a step.
                ...(decideNow
                  ? [
                      { label: opening ? "Opening…" : "Raise Revise", icon: RotateCcw, onClick: revise },
                      { label: "Customer Rejected", icon: X, onClick: () => setDecision("rejected") },
                    ]
                  : []),
              ]}
            />
            {/* THE ONE FILLED NEXT STEP (button plan Rule 2). Under Progress: the
                buyer's yes. Approved / Rejected: Revise (0725 — the costing's own,
                no Sample Revision, no MD). */}
            {decideNow ? <Button onClick={() => setDecision("approved")}>Customer Approved</Button> : null}
            {(meta.status === "approved" || meta.status === "rejected") && !revisingFrom && !revOf && perms.canEdit ? (
              <Button onClick={revise} disabled={opening}>
                {opening ? "Opening…" : "Raise Revise"}
              </Button>
            ) : null}
          </div>
        </div>

        {/* NO "PROPOSED COSTING OF SAMPLE REVISION … SEND IT TO THE MD" BANNER
            (user 2026-10-14: "remove this, there is no approval, just the status
            updated as approved"). 0729 closed costing revisions; a costing's
            next Rev is its own Revise, decided by the buyer. */}
        {decision && editId ? (
          <CustomerDecisionSheet
            decision={decision}
            costingId={editId}
            costingLabel={costingLabel}
            onClose={() => setDecision(null)}
            onDone={() => {
              setDecision(null);
              router.refresh();
              openById(editId);
            }}
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
            // ONE PLAIN "Save" (client spec 2026-10-12 §7, Costing · Grouping ·
            // Fabric Plan) — no "Save costing" / "Save Rev N", no Save as Draft.
            saveLabel: "Save",
            canSave: validity.canSave,
            // Submit is the next step once saved, so Save steps down (Rule 2).
            // Save names the first missing field and steers to it with a brief
            // ring (clean spec §4) — no counts, no progress bar.
            onBlockedSave: revealFirstProblem,
            // Saved and untouched: Submit stands where Save stood (user 2026-10-14).
            // 0725: Draft → Under Progress. The quote goes to the BUYER; no MD step.
            submit: null,
            // THE DRAFT OFFER LIVES IN THE BOTTOM BAR (user 2026-10-07), beside
            // the buttons that act on the whole sheet — not as a banner taking
            // the top of the canvas. LINKS, NOT BUTTONS (user 2026-10-09,
            // button plan Rule 5): a one-time notice drawn as two more buttons
            // read as part of the bar, and Discard sat beside Cancel. The bar
            // keeps the same three buttons on every visit.
            extra: formDraft.hasDraft ? (
              <span className="flex items-center gap-3 text-xs">
                <span className="text-warning">Unsaved changes from an earlier visit —</span>
                <button type="button" className="font-semibold text-primary hover:underline" onClick={formDraft.restore}>
                  Restore
                </button>
                <button type="button" className="font-semibold text-muted-foreground hover:text-foreground hover:underline" onClick={formDraft.discard}>
                  Discard
                </button>
              </span>
            ) : undefined,
            isPending,
          }}
        />

        {/* COPY FROM (user 2026-10-16): search, This customer / Approved, a
            preview of what comes across and what it replaces, then Copy. A
            click only selects — it used to overwrite the sheet on the spot. */}
        <CopySourceChooser<CostingListRow, CostingRecord>
          open={copyOpen}
          onClose={() => setCopyOpen(false)}
          title="Copy from an earlier costing"
          intro="Brings over fabrics, weights, CMT, trims and terms. This sheet keeps its own sample, style, date and quotes."
          items={copyCandidates}
          getId={(r) => r.id}
          searchText={(r) => [r.code, r.sample_no, r.enquiry_no, r.customer_name, r.style_name]}
          searchPlaceholder="Search costing, sample, enquiry, customer or style…"
          filters={[
            ...(enquiry?.customer_name
              ? [{ key: "customer", label: "This customer", test: (r: CostingListRow) => r.customer_name === enquiry.customer_name }]
              : []),
            { key: "approved", label: "Approved", test: (r: CostingListRow) => r.status === "approved" },
          ]}
          groups={
            enquiry?.customer_name
              ? [{ label: `This customer · ${enquiry.customer_name}`, test: (r) => r.customer_name === enquiry.customer_name }]
              : undefined
          }
          renderRow={(r) => (
            <>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs font-semibold">{`${r.code ?? "—"} · ${revisionShort(r.version)}`}</span>
                <span className="font-mono text-xs tabular-nums">{r.target_fob != null ? `${r.currency_code ?? ""} ${money(r.target_fob)}` : "—"}</span>
              </span>
              {/* THE ROW SELECTS ON CLICK, so `touch={false}`: a press-and-hold
                  meant to read a long style would reveal it and pick the row. */}
              <Truncated
                touch={false}
                text={[r.customer_name, r.style_name].filter(Boolean).join(" · ") || "—"}
                className="mt-0.5 block text-sm font-medium text-foreground"
              />
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <StatusPill tone={statusTone(r.is_draft ? "draft" : r.status)}>{r.is_draft ? "Draft" : STATUS_LABEL[r.status]}</StatusPill>
                {r.sample_no ? <span className="font-mono">{r.sample_no}</span> : null}
                {r.costing_date ? <span>{fmtDate(r.costing_date)}</span> : null}
              </span>
            </>
          )}
          loadPreview={async (id) => {
            const res = await loadSampleCosting(id);
            return res.ok ? { ok: true, data: res.record } : { ok: false, error: res.error };
          }}
          renderPreview={(_, rec) => {
            if (!rec) return null;
            const src = liveRows(rec.draft);
            const cmt = rec.draft.pieces.reduce((t, p) => t + (num(p.cmt) ?? 0), 0);
            const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
            const replacing = [
              live.fabrics.length ? plural(live.fabrics.length, "fabric") : null,
              live.trims.length ? plural(live.trims.length, "trim") : null,
            ].filter(Boolean);
            return (
              <span className="block space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Will bring over</span>
                <span className="flex flex-wrap gap-1">
                  <PreviewChip>{plural(src.fabrics.length, "fabric")}</PreviewChip>
                  <PreviewChip>{plural(src.trims.length, "trim")}</PreviewChip>
                  {cmt > 0 ? <PreviewChip>CMT ₹ {money(cmt)}</PreviewChip> : null}
                  {rec.draft.header.margin_pct ? <PreviewChip>Margin {rec.draft.header.margin_pct}%</PreviewChip> : null}
                  {rec.draft.header.overhead_pct ? <PreviewChip>Overhead {rec.draft.header.overhead_pct}%</PreviewChip> : null}
                </span>
                {replacing.length ? (
                  <span className="block rounded-md bg-warning-soft px-2 py-1 text-xs text-warning">
                    Replaces the {replacing.join(" and ")} on this costing.
                  </span>
                ) : null}
              </span>
            );
          }}
          onCopy={(_, rec) => rec && copyFrom(rec)}
          copyLabel={(r) => `Copy from ${r.code ?? "this costing"}`}
          emptyHint="No other costing to copy from yet."
        />

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
        title="Costing — new entry screen (test)"
        description="The single-screen ledger entry, on the same costings as Sample ▸ Costing. Try it; the original screen is unchanged."
        actions={perms.canCreate ? <Button onClick={openNew}>New Sample Costing</Button> : undefined}
      />
      <FilterBar
        trailing={<ViewToggle value={viewMode.view} onChange={viewMode.setView} />}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search Costing No, SMP Number, customer or style…"
        activeCount={facets.activeCount}
        onReset={facets.activeCount ? facets.reset : undefined}
        panel={facets.panel}
        leading={
          <ToggleGroup<CostingTab>
            label={`Status: ${TAB_LABEL[tab]}`}
            value={tab}
            onChange={pickTab}
            options={COSTING_TABS.map((t) => ({ value: t.value, label: t.label, icon: t.icon, count: tabCounts[t.value] }))}
          />
        }
        right={`${filtered.length} of ${current.length} ${TAB_LABEL[tab]}`}
      />
      {/* CARDS, THE SAMPLE MODULE'S QUEUE (user 2026-10-13: "accessories la irukka
          card mari … costing la yum") — the Accessories Plan's card, through the
          same `SampleCards`. Same rows, search and Pending / Updated / Draft box
          as the table; Reports and Delete ride the card's footer. */}
      {listDecision ? (
        <CustomerDecisionSheet
          decision={listDecision.decision}
          costingId={listDecision.id}
          costingLabel={listDecision.label}
          onClose={() => setListDecision(null)}
          onDone={() => {
            setListDecision(null);
            router.refresh();
          }}
        />
      ) : null}
      <SampleCards<CostingListRow>
        rows={filtered}
        /* THE BUYER'S ANSWERED PILES ARE A TABLE (as PD Request's Updated): an
           Approved or Rejected costing is looked up, not worked, so the open
           piles keep their cards and these two read as a register. */
        table={{ title: "Costing No", subtitle: "SMP · Customer · Style" }}
        view={viewMode.view}
        getKey={(r) => r.id}
        title={(r) => <span className="font-mono">{r.awaiting ? (r.enquiry_no ?? "—") : (r.code ?? "—")}</span>}
        subtitle={(r) => (
          <span>{[r.awaiting ? null : r.enquiry_no, r.customer_name, r.style_name].filter(Boolean).join(" · ") || "—"}</span>
        )}
        state={(r): SampleCardState =>
          // status-tone: exempt -- maps a costing TAB to a queue CARD state, not to a tone
          ({ pending: "pending", progress: "pending", rejected: "neutral", draft: "draft", approved: "updated" } as const)[costingTabOf(r)]
        }
        /* THE PILL SAYS THE TAB THE CARD IS IN (user 2026-10-14: "draft na draft
           la … pending na pending … updated na updated"). It read the sheet's
           approval stage, so a saved-not-sent sheet said "Draft" under Pending
           and a sample with no sheet said "Not costed". One word, one answer. */
        pillText={(r) => TAB_LABEL[costingTabOf(r)]}
        stats={(r) => [
          {
            label: "Quoted",
            value: r.target_fob != null ? `${r.currency_code ?? ""} ${money(r.target_fob)}`.trim() : "—",
            lead: true,
          },
          { label: "Margin", value: r.profit_loss_pct != null ? `${r.profit_loss_pct.toFixed(1)}%` : "—" },
          { label: "Date", value: r.awaiting ? "—" : fmtDate(r.costing_date) },
        ]}
        onOpen={(r) => (r.awaiting ? perms.canCreate && startCostingFor(r) : openById(r.id))}
        /* NO "Created …" LINE, AND THE ACTIONS ARE ICONS (user 2026-10-15,
           screenshot 3542: "the date is in two times … no need, remove it;
           report, revise, delete icon in single row"). The card's Date figure
           already dates it, and with the words gone Reports · Raise Revise ·
           Delete fit one footer row instead of wrapping onto a second. */
        iconActions
        canDelete={perms.canDelete}
        /* A LOCKED COSTING KEEPS ITS PENCIL AND BIN, GREYED, SAYING WHY (AGENTS
           "Row actions"). Only a sample with no sheet yet has nothing to delete;
           the server deletes a Draft only (`isDeletableStatus`), so the bin says
           that rather than offering a click the action refuses. */
        canDeleteRow={(r) => !r.awaiting}
        deleteDisabledReason={(r) =>
          r.awaiting || isDeletableStatus(r.status) ? null : `${STATUS_LABEL[r.status]} — only a Draft can be deleted; revise it instead.`
        }
        editDisabledReason={(r) => (r.awaiting ? null : lockReason(r))}
        onDelete={del}
        /* THE BUYER'S ANSWER FROM THE CARD (user 2026-10-16, screenshot 3570:
           "approval, rejected icon option in under progress"). The same two
           decisions as the open costing's Customer Approved / Customer Rejected,
           through the same sheet (it asks for the buyer's remark), on the card
           the answer is about. Under Progress only — the server takes a
           decision on a `submitted` costing and nothing else. Greyed with the
           reason for someone who cannot edit (AGENTS "Row actions"). */
        actions={(r) => {
          if (r.awaiting || costingTabOf(r) !== "progress") return null;
          const label = `${r.code ?? "Costing"} · ${revisionShort(r.version)}`;
          const why = perms.canEdit ? null : "needs the edit permission";
          return (
            <>
              <RowIconAction
                label="Customer Approved"
                name={r.code}
                icon={Check}
                className="text-success"
                onClick={() => setListDecision({ id: r.id, label, decision: "approved" })}
                disabledReason={why && `Customer Approved — ${why}`}
              />
              <RowIconAction
                label="Customer Rejected"
                name={r.code}
                icon={X}
                className="text-danger"
                onClick={() => setListDecision({ id: r.id, label, decision: "rejected" })}
                disabledReason={why && `Customer Rejected — ${why}`}
              />
            </>
          );
        }}
        onReports={(r) => router.push(`/sales/sample-costing/${r.id}/reports`)}
        canReportsRow={(r) => !r.awaiting}
        /* RAISE REVISE ON AN UNDER PROGRESS CARD (user 2026-10-14) — the card's
           action slot, opening the Quotation report already revising. */
        onSend={(r) => startOpening(() => router.push(raiseReviseHref(r.id)))}
        canSendRow={(r) => perms.canEdit && !r.awaiting && costingTabOf(r) === "progress"}
        sendLabel={opening ? "Opening…" : "Raise Revise"}
        cardSendLabel={opening ? "Opening…" : "Raise Revise"}
        sendIcon={RotateCcw}
        isPending={isPending}
        empty={
          !current.length
            ? "No sample costings yet. Use 'New Sample Costing' to cost the first sample."
            : filtered.length === 0 && searched.length
              ? `Nothing is ${TAB_LABEL[tab]} — the counts above show which tab the costings are in.`
              : "No costings match the search or filters."
        }
      />
    </div>
  );
}
