/**
 * Orders ▸ CAD ▸ CAD Lifecycle — the pure half (doc/order/cad.md; schema and
 * the spec-to-repo mapping in 0628 and doc/order/cad-plan.md).
 *
 * Client-safe and side-effect free, so the screen, the server actions, the
 * Garment Order Sheet, the Fabric BOM reports, the CAD Completion report and
 * `scripts/check-cad-lifecycle.mts` all read ONE definition of:
 *
 *   - a style's CAD STATE (`cadStateOf`) — the TS twin of 0628's
 *     `cad_style_states()`, which the database guard reads;
 *   - the three form rules (`allocationProblem`, `dispatchProblem`,
 *     `decisionProblem`) — the database refuses the same things (0628's
 *     trigger and RPCs); these say it BEFORE the round trip, in the same words;
 *   - the file rules (.DXF / .PDS / .PLT by EXTENSION — a browser reports no
 *     MIME type for these, which is why the generic uploaders cannot take them)
 *     and the revision path the spec prescribes;
 *   - who may be a Pattern Maker (`patternMakerOptions`), empty-and-explain;
 *   - the report arithmetic (`cadCompletionOf`) and the order-sheet word
 *     (`cadSheetLabel`).
 */

import { z } from "zod";
import type { StatusTone } from "@/lib/ui/tone";
import { styleKey } from "@/lib/orders/amendments/style-key";
import { daysBetween } from "@/lib/calendar";

// ============================================================================
// VOCABULARY
// ============================================================================

/**
 * The stored values are 0628's; the LABELS are the 2026-09-25 Order Entry ▸ CAD
 * spec's words. `shrinkage_wash` is 0632's, and needs Fit Wash = Yes (a
 * shrinkage pattern with no shrinkage to build in is refused by both sides).
 */
export const CAD_TYPES = [
  { value: "first_pattern", label: "Initial Fit Pattern", hint: "Initial creation from the tech pack / sketch" },
  { value: "grading", label: "Grading & Size Set Pattern", hint: "Sizing expansion from the approved base size" },
  { value: "marker_planning", label: "Marker / Consumption Pattern", hint: "Nesting the patterns for consumption" },
  { value: "shrinkage_wash", label: "Shrinkage / Wash Pattern", hint: "Built-in allowance for the bit wash" },
] as const;
export type CadType = (typeof CAD_TYPES)[number]["value"];
export const cadTypeLabel = (t: string | null | undefined) =>
  CAD_TYPES.find((c) => c.value === t)?.label ?? "—";

/** The same two words Fabric BOM ▸ Manual already uses (0495 `width_form`). */
export const LAYOUT_TYPES = [
  { value: "open_width", label: "Open Width" },
  { value: "tubular", label: "Tubular" },
] as const;
export type LayoutType = (typeof LAYOUT_TYPES)[number]["value"];
export const layoutLabel = (t: string | null | undefined) =>
  LAYOUT_TYPES.find((l) => l.value === t)?.label ?? "—";

/**
 * The designations a Pattern Maker may hold (spec §2.1). Seeded as words by
 * 0628 into `config_lookups` kind 'designation'; a person tags the people on
 * Master Data ▸ Associates ▸ Employee. The database trigger checks the same
 * two names.
 */
export const PATTERN_MAKER_DESIGNATIONS = ["PATTERN MAKER", "CAD TECHNICIAN", "CAD DESIGNER"] as const;

// ============================================================================
// PATTERN DETAILS (0632) — the spec's "Compact CAD Entry Details", on the version
// ============================================================================

export const CUT_TYPES = [
  { value: "one_way", label: "One-Way Cutting" },
  { value: "two_way", label: "Two-Way Cutting" },
] as const;
export type CutType = (typeof CUT_TYPES)[number]["value"];
export const cutTypeLabel = (t: string | null | undefined) => CUT_TYPES.find((c) => c.value === t)?.label ?? "—";

export const CUT_METHODS = [
  { value: "direct_shape", label: "Direct Shape" },
  { value: "fit_form", label: "Fit Form Cutting" },
] as const;
export type CutMethod = (typeof CUT_METHODS)[number]["value"];
export const cutMethodLabel = (m: string | null | undefined) =>
  CUT_METHODS.find((c) => c.value === m)?.label ?? "—";

/**
 * One style component's cut method. Names are SNAPSHOTTED: a sent version is
 * history. Keyed by (coordinate, component) since 0637 — a TOP and a BOTTOM
 * each have a FRONT BODY. Entries saved under 0632 carry no coordinate.
 */
export type ComponentCut = {
  component_id: string;
  component_name: string;
  coordinate_id?: string | null;
  coordinate_name?: string | null;
  /** Null when the row carries only notes (0638). */
  method: CutMethod | null;
  /** The CAD master's note for this panel — piece weight, an opening-dia adjustment (0638). */
  notes?: string | null;
};

// ============================================================================
// PATTERN STATUS (0638) — the Pattern Master's three words, between Assign and
// Send. cad_dispatch refuses a pattern that is not Ready (user 2026-09-25).
// ============================================================================

export const PATTERN_STATUSES = [
  { value: "garment_not_received", label: "Garment Not Received", tone: "warning" },
  { value: "acknowledged", label: "Acknowledged", tone: "info" },
  { value: "ready", label: "Ready", tone: "success" },
] as const;
export type PatternStatus = (typeof PATTERN_STATUSES)[number]["value"];
export const patternStatusMeta = (s: string | null | undefined) =>
  PATTERN_STATUSES.find((p) => p.value === s) ?? PATTERN_STATUSES[0];

/**
 * One line of the Pattern Maker's sheet (0640) — FABRIC · GSM · TYPE of PARTS ·
 * COLOUR · SIZE · TABLE DIA · TUBULAR & OPEN WIDTH · AVG CAD PCS WEIGHT · REMARK.
 * Names ride along for display; the ids are what is stored.
 */
export type PatternLine = {
  coordinate_id: string | null;
  coordinate_name: string | null;
  component_id: string;
  component_name: string;
  fabric_category_id: string | null;
  fabric_name: string | null;
  gsm: number | null;
  colour: string | null;
  size_id: string | null;
  size_name: string | null;
  table_dia: number | null;
  width_form: LayoutType | null;
  avg_pcs_weight_g: number | null;
  remark: string | null;
};

/** A component of the style, as the order declares it today (Order Info ▸ Style Components). */
export type StyleComponent = {
  component_id: string;
  name: string;
  /** The structure id — seeds a Pattern line's FABRIC (0640). */
  fabric_category_id?: string | null;
  coordinate_id: string | null;
  coordinate_name: string | null;
  /** The fabric structure the panel is cut from (SINGLE JERSEY …). */
  structure: string | null;
  /** GSM from the order's combos for that structure ("160" or "160 / 180"). */
  gsm: string | null;
};

/** The one identity of a cut row — the same test 0637's trigger makes. */
export const cutKey = (c: { coordinate_id?: string | null; component_id: string }) =>
  `${c.coordinate_id || "-"}|${c.component_id}`;

/** "Bit wash 3.5% L × 2% W · Two-Way Cutting" — the one-line summary the tab and history print. */
export function patternSummary(v: {
  fit_wash: boolean;
  length_shrink_pct: number | null;
  width_shrink_pct: number | null;
  cut_type: string | null;
}): string {
  const parts: string[] = [];
  if (v.fit_wash) parts.push(`Bit wash ${v.length_shrink_pct ?? "?"}% L × ${v.width_shrink_pct ?? "?"}% W`);
  if (v.cut_type) parts.push(cutTypeLabel(v.cut_type));
  return parts.join(" · ");
}

// ============================================================================
// STATE
// ============================================================================

/**
 * A style's CAD state = its LATEST version's:
 *   not_allocated  no version yet
 *   allocated      assigned, not yet sent to the buyer
 *   pending        dispatched, awaiting the buyer (the spec's default post-dispatch)
 *   approved       buyer approved — the version's `is_submitted` is TRUE
 *   rework         buyer asked for changes — waiting for version n + 1
 */
export const CAD_STATES = ["not_allocated", "allocated", "pending", "approved", "rework"] as const;
export type CadState = (typeof CAD_STATES)[number];
export type CadDecisionStatus = "pending" | "approved" | "rework";

export const CAD_STATE_META: Record<CadState, { label: string; tone: StatusTone; next: string }> = {
  not_allocated: { label: "Not assigned", tone: "neutral", next: "Assign CAD" },
  allocated: { label: "Assigned", tone: "info", next: "Send CAD" },
  pending: { label: "Awaiting buyer", tone: "warning", next: "CAD Approval" },
  approved: { label: "Approved", tone: "success", next: "—" },
  rework: { label: "Rework required", tone: "danger", next: "Re-assign CAD" },
};

export type CadFileKind = "pattern" | "proof";

export type CadFile = {
  id: string;
  /** 0632: the pattern (+ PDF marker) or the transmission proof. */
  kind: CadFileKind;
  file_name: string;
  storage_path: string;
  extension: string;
  size_bytes: number | null;
};

export type CadDispatch = {
  id: string;
  dispatch_date: string;
  courier_tracking_no: string | null;
  email_sent_at: string | null;
  layout_type: LayoutType | null;
  expected_approval_date: string | null;
  remarks: string | null;
  files: CadFile[];
};

export type CadDecision = {
  status: CadDecisionStatus;
  decided_on: string | null;
  buyer_comments: string | null;
};

export type CadVersion = {
  id: string;
  version_no: number;
  pattern_maker_id: string;
  pattern_maker_name: string | null;
  cad_type: CadType;
  allocation_date: string;
  target_date: string;
  remarks: string | null;
  fit_wash: boolean;
  length_shrink_pct: number | null;
  width_shrink_pct: number | null;
  cut_type: CutType | null;
  component_cuts: ComponentCut[];
  pattern_status: PatternStatus;
  /** 0640 — the DATE on the Pattern Maker's sheet. */
  pattern_date: string | null;
  /** 0640 — the Pattern Maker's sheet, in display order. */
  pattern_lines: PatternLine[];
  is_submitted: boolean;
  created_at: string | null;
  created_by: string | null;
  dispatch: CadDispatch | null;
  decision: CadDecision | null;
};

/** The state a style is in, from its versions (any order). */
export function cadStateOf(versions: readonly Pick<CadVersion, "version_no" | "dispatch" | "decision">[]): CadState {
  const latest = latestVersion(versions);
  if (!latest) return "not_allocated";
  if (!latest.dispatch) return "allocated";
  return latest.decision?.status ?? "pending";
}

export function latestVersion<T extends Pick<CadVersion, "version_no">>(versions: readonly T[]): T | null {
  let best: T | null = null;
  for (const v of versions) if (!best || v.version_no > best.version_no) best = v;
  return best;
}

/**
 * Is the LATEST version late? An allocated version past its Internal Target
 * Date; a dispatched one past its Expected Approval Date with no answer.
 * Derived on read, never stored — the 0607 rule (a stored "overdue" goes stale
 * the moment the date changes with nobody writing the row).
 */
export function cadLateness(
  latest: Pick<CadVersion, "target_date" | "dispatch" | "decision"> | null,
  today: string,
): { late: boolean; days: number; what: string } {
  if (!latest) return { late: false, days: 0, what: "" };
  if (!latest.dispatch) {
    const d = daysBetween(latest.target_date, today);
    return d > 0 ? { late: true, days: d, what: "past target" } : { late: false, days: 0, what: "" };
  }
  if ((latest.decision?.status ?? "pending") === "pending" && latest.dispatch.expected_approval_date) {
    const d = daysBetween(latest.dispatch.expected_approval_date, today);
    return d > 0 ? { late: true, days: d, what: "buyer reply overdue" } : { late: false, days: 0, what: "" };
  }
  return { late: false, days: 0, what: "" };
}

/** What the next permitted step is — the row action the screen offers. */
export function cadNextStep(state: CadState): "allocate" | "dispatch" | "decide" | "reallocate" | null {
  switch (state) {
    case "not_allocated":
      return "allocate";
    case "allocated":
      return "dispatch";
    case "pending":
      return "decide";
    case "rework":
      return "reallocate";
    case "approved":
      return null;
  }
}

// ============================================================================
// THE ORDER-SHEET WORD (spec §6.2) and the report arithmetic (spec §6.1)
// ============================================================================

/** "Approved (V2)" when the latest version is approved, else "Pending". */
export function cadSheetLabel(state: CadState, versionNo: number | null): { text: string; pending: boolean } {
  return state === "approved" && versionNo
    ? { text: `Approved (V${versionNo})`, pending: false }
    : { text: "Pending", pending: true };
}

export type CadCompletion = {
  totalVersions: number;
  state: CadState;
  /** Final Approval Lead Time = approval date − V1's allocation date; null until approved. */
  leadTimeDays: number | null;
};

export function cadCompletionOf(
  versions: readonly Pick<CadVersion, "version_no" | "allocation_date" | "dispatch" | "decision">[],
): CadCompletion {
  const state = cadStateOf(versions);
  const v1 = versions.find((v) => v.version_no === 1) ?? null;
  const latest = latestVersion(versions);
  const approvedOn = state === "approved" ? (latest?.decision?.decided_on ?? null) : null;
  return {
    totalVersions: versions.length,
    state,
    leadTimeDays: v1 && approvedOn ? daysBetween(v1.allocation_date, approvedOn) : null,
  };
}

// ============================================================================
// FILES (spec §3.1 and "File Revision Architecture")
// ============================================================================

/** The real pattern formats — at least one is mandatory on a dispatch. */
export const CAD_FILE_EXTENSIONS = ["dxf", "pds", "plt"] as const;
/**
 * What a PATTERN file may be (0632): the formats above plus a .PDF marker print,
 * which rides ALONG with a real CAD file and never replaces it — a PDF is a
 * picture of a marker, not a pattern a cutting room can load.
 */
export const PATTERN_FILE_EXTENSIONS = ["dxf", "pds", "plt", "pdf"] as const;
/** The transmission proof — an email slip or a courier docket (0632). */
export const PROOF_FILE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "eml", "msg"] as const;
const acceptOf = (exts: readonly string[]) =>
  exts.flatMap((e) => [`.${e}`, `.${e.toUpperCase()}`]).join(",");
export const CAD_FILE_ACCEPT = acceptOf(PATTERN_FILE_EXTENSIONS);
export const PROOF_FILE_ACCEPT = acceptOf(PROOF_FILE_EXTENSIONS);
export const CAD_FILE_MAX_MB = 50;
export const CAD_BUCKET = "garment-order-docs";

/** The lower-case extension, or null. By NAME — see the header. */
export function cadFileExtension(fileName: string): string | null {
  const m = /\.([^.]+)$/.exec(fileName.trim());
  return m ? m[1].toLowerCase() : null;
}
export const isCadFile = (fileName: string) =>
  (CAD_FILE_EXTENSIONS as readonly string[]).includes(cadFileExtension(fileName) ?? "");
export const isPatternFile = (fileName: string) =>
  (PATTERN_FILE_EXTENSIONS as readonly string[]).includes(cadFileExtension(fileName) ?? "");
export const isProofFile = (fileName: string) =>
  (PROOF_FILE_EXTENSIONS as readonly string[]).includes(cadFileExtension(fileName) ?? "");

/** A style ref as one path segment — style codes carry SLASHES (0402). */
export function cadPathSegment(styleRef: string): string {
  return styleKey(styleRef).replace(/[^A-Z0-9_-]+/g, "_") || "STYLE";
}

/**
 * The storage key, per the spec:
 *   folder  cad/{order}/{style}/v{n}/        (the spec's /uploads/cad/styles/{style_id}/v{n}/,
 *                                            scoped by order because a style ref is
 *                                            only unique within its order here)
 *   name    {style}_{version}_{timestamp}.{ext}
 * A second file in the same version gets a `-2`, `-3` suffix on the timestamp
 * so nothing is ever overwritten (the upload is `upsert: false` as well).
 * 0628's `cad_dispatch` refuses a path outside this version's folder.
 */
export function cadStoragePath(
  orderId: string,
  styleRef: string,
  versionNo: number,
  fileName: string,
  stamp: number,
  index = 0,
  kind: CadFileKind = "pattern",
): string {
  const seg = cadPathSegment(styleRef);
  const ext = cadFileExtension(fileName) ?? "bin";
  const suffix = index > 0 ? `-${index + 1}` : "";
  // A proof sits in its own sub-folder of the SAME version folder, so
  // cad_dispatch's "stored under this version" test holds for both kinds.
  const sub = kind === "proof" ? "proof/" : "";
  return `cad/${orderId}/${seg}/v${versionNo}/${sub}${seg}_${versionNo}_${stamp}${suffix}.${ext}`;
}

// ============================================================================
// WHO MAY BE A PATTERN MAKER — merchandiserOptions' rule
// ============================================================================

export type PatternMakerRow = {
  id: string;
  code: string | null;
  name: string;
  inactive: boolean;
  designation: string | null;
};

/**
 * Employees whose Designation is PATTERN MAKER or CAD TECHNICIAN, active only —
 * plus the one a version already holds (AGENTS.md "Disabled rows": dropping it
 * would show a filled field as empty). EMPTY-AND-EXPLAIN when nobody qualifies,
 * never a fallback to every employee: a silent fallback lets a packer be named
 * and nobody learns the master needs tagging (the nominated-vendor lesson).
 */
export function patternMakerOptions(
  rows: readonly PatternMakerRow[],
  currentValue: string | null,
): { items: PatternMakerRow[]; hint: string | null } {
  const qualifies = (r: PatternMakerRow) =>
    (PATTERN_MAKER_DESIGNATIONS as readonly string[]).includes((r.designation ?? "").trim().toUpperCase());
  const items = rows.filter((r) => qualifies(r) && !r.inactive);
  let hint: string | null = null;
  if (items.length === 0) {
    hint =
      rows.length === 0
        ? "No employees have been entered yet. Add the pattern makers on Master Data ▸ Associates ▸ Employee first."
        : "No employee has the Designation PATTERN MAKER, CAD TECHNICIAN or CAD DESIGNER, so there is nobody to assign it to. Set it on Master Data ▸ Associates ▸ Employee.";
  }
  if (currentValue && !items.some((r) => r.id === currentValue)) {
    const held = rows.find((r) => r.id === currentValue);
    if (held) return { items: [...items, held], hint: null };
  }
  return { items, hint };
}

// ============================================================================
// INPUTS — Zod for the actions, and the three rules the screen shows first
// ============================================================================

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const text = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.toUpperCase() : null));
/* Free text that is NOT upper-cased: a courier's tracking number is a value a
   website matches case-sensitively on some carriers. */
const rawText = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

export const allocationInput = z.object({
  garment_order_id: z.string().uuid(),
  style_ref_no: z.string().trim().min(1, "Style is required"),
  pattern_maker_id: z.string().uuid({ message: "Pattern Maker is required" }),
  cad_type: z.enum(["first_pattern", "grading", "marker_planning", "shrinkage_wash"], {
    message: "CAD Type is required",
  }),
  target_date: isoDate,
  remarks: text,
  fit_wash: z.boolean().default(false),
  length_shrink_pct: z.coerce.number().nullish().transform((v) => v ?? null),
  width_shrink_pct: z.coerce.number().nullish().transform((v) => v ?? null),
  cut_type: z
    .enum(["one_way", "two_way"])
    .nullish()
    .transform((v) => v ?? null),
  component_cuts: z
    .array(
      z.object({
        component_id: z.string().uuid(),
        component_name: z.string(),
        coordinate_id: z.string().uuid().nullish(),
        coordinate_name: z.string().nullish(),
        method: z
          .enum(["direct_shape", "fit_form"])
          .nullish()
          .transform((v) => v ?? null),
        notes: z
          .string()
          .trim()
          .nullish()
          .transform((v) => (v ? v.toUpperCase() : null)),
      }),
    )
    .default([]),
});

const numOrNull = z.coerce.number().positive().nullish().transform((v) => v ?? null);
const uuidOrNull = z.string().uuid().nullish().transform((v) => v ?? null);

/** The Pattern Maker's sheet (0640) — status, date and the lines, saved together. */
export const patternSheetInput = z.object({
  pattern_status: z.enum(["garment_not_received", "acknowledged", "ready"]),
  pattern_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? null),
  lines: z
    .array(
      z.object({
        coordinate_id: uuidOrNull,
        component_id: z.string().uuid({ message: "Choose the Type of Part on every line" }),
        fabric_category_id: uuidOrNull,
        gsm: numOrNull,
        colour: z.string().trim().nullish().transform((v) => (v ? v.toUpperCase() : null)),
        size_id: uuidOrNull,
        table_dia: numOrNull,
        width_form: z.enum(["open_width", "tubular"]).nullish().transform((v) => v ?? null),
        avg_pcs_weight_g: numOrNull,
        remark: z.string().trim().nullish().transform((v) => (v ? v.toUpperCase() : null)),
      }),
    )
    .default([]),
});
export type PatternSheetInput = z.input<typeof patternSheetInput>;

/** The Pattern Master's step (0638): status + the Order Sheet grid's methods and notes. */
export const patternWorkInput = z.object({
  pattern_status: z.enum(["garment_not_received", "acknowledged", "ready"]),
  component_cuts: allocationInput.shape.component_cuts,
});
export type PatternWorkInput = z.input<typeof patternWorkInput>;
export type AllocationInput = z.input<typeof allocationInput>;

export const cadFileInput = z.object({
  kind: z.enum(["pattern", "proof"]).default("pattern"),
  file_name: z.string().min(1),
  storage_path: z.string().min(1),
  mime_type: z.string().nullish(),
  size_bytes: z.number().nullish(),
});
export type CadFileInput = z.input<typeof cadFileInput>;

export const dispatchInput = z.object({
  allocation_id: z.string().uuid(),
  dispatch_date: isoDate,
  courier_tracking_no: rawText,
  /** `YYYY-MM-DDTHH:mm` from a datetime-local box, read as IST. */
  email_sent_at: rawText,
  layout_type: z
    .enum(["open_width", "tubular"])
    .nullish()
    .transform((v) => v ?? null),
  remarks: text,
  files: z.array(cadFileInput),
  /** The email slip / courier docket (0632) — proof of dispatch on its own. */
  proof_files: z.array(cadFileInput).default([]),
});
export type DispatchInput = z.input<typeof dispatchInput>;

export const decisionInput = z.object({
  dispatch_id: z.string().uuid(),
  status: z.enum(["approved", "rework"], { message: "Choose Approved or Rework Required" }),
  decided_on: isoDate,
  buyer_comments: text,
});
export type DecisionInput = z.input<typeof decisionInput>;

/** A datetime-local value (IST wall time) as an ISO instant for timestamptz. */
export function istLocalToIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(v);
  return m ? `${m[1]}T${m[2]}:${m[3]}:00+05:30` : null;
}

/**
 * A refusal AND THE FIELD IT IS ABOUT, so the sheet prints the sentence under
 * that field (raagam-screen-layout: "a warning sits UNDER THE FIELD it is
 * about"). `field: null` is a refusal no single field owns — the layout
 * mismatch — and the sheet shows those above its footer. The `…Problem`
 * functions below return the bare sentence, unchanged, for the callers and the
 * vectors in `scripts/check-cad-lifecycle.mts` that assert the words.
 */
export type CadProblem<F extends string> = { field: F | null; message: string };

export type AllocationField = "maker" | "type" | "target" | "length" | "width";
export type DispatchField = "date" | "proof" | "layout" | "files";
export type DecisionField = "status" | "date" | "comments";

/** Spec §2.3 / §7: target on or after the allocation date (= today). */
export function allocationProblemAt(
  a: {
    pattern_maker_id: string | null;
    cad_type: string | null;
    target_date: string | null;
    /** 0632 — optional so a caller that predates the pattern details still type-checks. */
    fit_wash?: boolean;
    length_shrink_pct?: number | null;
    width_shrink_pct?: number | null;
  },
  today: string,
): CadProblem<AllocationField> | null {
  if (!a.pattern_maker_id) return { field: "maker", message: "Choose the Pattern Maker." };
  if (!a.cad_type) return { field: "type", message: "Choose the CAD Type." };
  if (!a.target_date) return { field: "target", message: "Enter the Internal Target Date." };
  if (a.target_date < today) {
    return { field: "target", message: "The Internal Target Date cannot be before today's Allocation Date." };
  }
  // 0632's chk_oca_shrinkage_wash_needs_fit_wash / chk_oca_fit_wash_shrinkage.
  if (a.cad_type === "shrinkage_wash" && !a.fit_wash) {
    return { field: "type", message: "A Shrinkage / Wash Pattern needs Bit Wash = Yes." };
  }
  if (a.fit_wash) {
    const bad = (v: number | null | undefined) => v == null || !(v > 0 && v < 100);
    if (bad(a.length_shrink_pct)) {
      return { field: "length", message: "Enter the Length Shrinkage % (more than 0, less than 100)." };
    }
    if (bad(a.width_shrink_pct)) {
      return { field: "width", message: "Enter the Width Shrinkage % (more than 0, less than 100)." };
    }
  }
  return null;
}

export function allocationProblem(
  ...args: Parameters<typeof allocationProblemAt>
): string | null {
  return allocationProblemAt(...args)?.message ?? null;
}

/** Spec §3.1, §3.2, §7 — the same refusals `cad_dispatch` raises. */
export function dispatchProblemAt(
  d: {
    dispatch_date: string | null;
    courier_tracking_no: string | null;
    email_sent_at: string | null;
    layout_type: string | null;
    files: readonly { file_name: string }[];
    /** 0632 — the email slip / courier docket; proof of dispatch on its own. */
    proof_files?: readonly { file_name: string }[];
  },
  version: { allocation_date: string; cad_type: string; pattern_status?: string },
  today: string,
): CadProblem<DispatchField> | null {
  const proofFiles = d.proof_files ?? [];
  // 0638 — the same refusal cad_dispatch raises first.
  if (version.pattern_status !== undefined && version.pattern_status !== "ready") {
    return { field: null, message: "The pattern is not Ready yet — mark it Ready before sending." };
  }
  if (!d.dispatch_date) return { field: "date", message: "Enter the Dispatch Date." };
  if (d.dispatch_date > today) return { field: "date", message: "The Dispatch Date cannot be in the future." };
  if (d.dispatch_date < version.allocation_date) {
    return { field: "date", message: "The Dispatch Date cannot be before the Allocation Date." };
  }
  // Every file is judged before the "is there enough" questions — cad_dispatch's order.
  const bad = d.files.find((f) => !isPatternFile(f.file_name));
  if (bad) {
    return {
      field: "files",
      message: `${bad.file_name} is not a CAD file — only .DXF, .PDS, .PLT and a .PDF marker are accepted.`,
    };
  }
  const badProof = proofFiles.find((f) => !isProofFile(f.file_name));
  if (badProof) {
    return {
      field: "proof",
      message: `${badProof.file_name} cannot be a transmission proof — attach a .PDF, .JPG, .PNG, .EML or .MSG.`,
    };
  }
  if (!d.courier_tracking_no?.trim() && !d.email_sent_at && proofFiles.length === 0) {
    return {
      field: "proof",
      message:
        "Enter a Courier Tracking Number or an Email Timestamp, or attach the email slip / courier docket — a dispatch needs proof it was sent.",
    };
  }
  if (version.cad_type === "marker_planning" && !d.layout_type) {
    return { field: "layout", message: "A Marker Planning CAD needs its Layout Type (Open Width / Tubular)." };
  }
  if (!d.files.some((f) => isCadFile(f.file_name))) {
    return {
      field: "files",
      message:
        "Attach the CAD file (.DXF, .PDS or .PLT) — a dispatch cannot be recorded without it. A .PDF marker goes with it, not instead of it.",
    };
  }
  return null;
}

export function dispatchProblem(...args: Parameters<typeof dispatchProblemAt>): string | null {
  return dispatchProblemAt(...args)?.message ?? null;
}

/** Spec §4.2 and §7's layout check — the same refusals `cad_decide` raises. */
export function decisionProblemAt(
  d: { status: string | null; decided_on: string | null; buyer_comments: string | null },
  dispatch: { dispatch_date: string; layout_type: string | null },
  styleLayout: string | null,
  styleRef: string,
  today: string,
): CadProblem<DecisionField> | null {
  if (d.status !== "approved" && d.status !== "rework") {
    return { field: "status", message: "Choose Approved or Rework Required." };
  }
  if (!d.decided_on) return { field: "date", message: "Enter the Decision Date." };
  if (d.decided_on > today) return { field: "date", message: "The Decision Date cannot be in the future." };
  if (d.decided_on < dispatch.dispatch_date) {
    return { field: "date", message: "The Decision Date cannot be before the Dispatch Date." };
  }
  if (d.status === "rework" && !d.buyer_comments?.trim()) {
    return {
      field: "comments",
      message: "Enter the Buyer Alteration Comments — a Rework cannot be recorded without them.",
    };
  }
  if (d.status === "approved" && styleLayout && dispatch.layout_type && styleLayout !== dispatch.layout_type) {
    return {
      // Two records disagree — the order's and the dispatch's. Neither is a
      // field on this sheet, so the sentence stands above the footer.
      field: null,
      message: `Layout mismatch: the CAD marker is ${layoutLabel(dispatch.layout_type)} but style ${styleRef} is declared ${layoutLabel(styleLayout)} on the order. Correct the order's Layout Type or send the CAD back for rework.`,
    };
  }
  return null;
}

export function decisionProblem(...args: Parameters<typeof decisionProblemAt>): string | null {
  return decisionProblemAt(...args)?.message ?? null;
}

// ============================================================================
// THE LISTING ROW — one per (order, style)
// ============================================================================

export type CadStyleRow = {
  /** `${garment_order_id}|${styleKey}` — stable across order saves. */
  key: string;
  garment_order_id: string;
  order_code: string | null;
  re_no: string | null;
  /** The RE's `sales_orders.id` — what the Garment Order Sheet page is keyed by. */
  sales_order_id: string | null;
  po_no: string | null;
  customer_id: string | null;
  customer_name: string | null;
  /** customers.cad_review_days — null = not set on the Customer master. */
  customer_review_days: number | null;
  delivery_date: string | null;
  style_ref_no: string;
  style_description: string | null;
  layout_type: LayoutType | null;
  /** The style's components as the order declares it today (0632's Cut Method rows). */
  components: StyleComponent[];
  /** The style's sizes in the order's own sequence (Order Info ▸ Style ▸ Sizes). */
  sizes: string[];
  /** The same sizes with their ids — the Pattern sheet's SIZE picker (0640). */
  size_options: { id: string; name: string }[];
  /** The style's colours from its combos — the Pattern sheet's COLOUR picker (0640). */
  colours: string[];
  /**
   * FALSE for a style that has CAD history but is no longer on the order (a
   * renamed or removed style — styles are keyed by their ref TEXT). Kept on
   * the listing so the history is not silently lost; it neither blocks nor
   * satisfies the Fabric BOM guard, which reads the order's CURRENT styles.
   */
  on_order: boolean;
  /** Ascending by version. */
  versions: CadVersion[];
  state: CadState;
  /** The listing's Created Date / Created User: the FIRST allocation's, else the order's. */
  created_at: string | null;
  created_by: string | null;
};

/** The order-level answer — every style's latest version approved (0628 `cad_order_ready`). */
export function cadOrderReady(rows: readonly Pick<CadStyleRow, "state" | "on_order">[]): boolean {
  const current = rows.filter((r) => r.on_order);
  return current.length > 0 && current.every((r) => r.state === "approved");
}
