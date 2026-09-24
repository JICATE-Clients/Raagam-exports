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

export const CAD_TYPES = [
  { value: "first_pattern", label: "First Pattern", hint: "Initial creation from the tech pack / sketch" },
  { value: "grading", label: "Grading", hint: "Sizing expansion from the approved base size" },
  { value: "marker_planning", label: "Marker Planning", hint: "Nesting the patterns for consumption" },
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
export const PATTERN_MAKER_DESIGNATIONS = ["PATTERN MAKER", "CAD TECHNICIAN"] as const;

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
  not_allocated: { label: "Not allocated", tone: "neutral", next: "Allocate" },
  allocated: { label: "Allocated", tone: "info", next: "Dispatch" },
  pending: { label: "Awaiting buyer", tone: "warning", next: "Record decision" },
  approved: { label: "Approved", tone: "success", next: "—" },
  rework: { label: "Rework required", tone: "danger", next: "Re-allocate" },
};

export type CadFile = {
  id: string;
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

export const CAD_FILE_EXTENSIONS = ["dxf", "pds", "plt"] as const;
export const CAD_FILE_ACCEPT = ".dxf,.pds,.plt,.DXF,.PDS,.PLT";
export const CAD_FILE_MAX_MB = 50;
export const CAD_BUCKET = "garment-order-docs";

/** The lower-case extension, or null. By NAME — see the header. */
export function cadFileExtension(fileName: string): string | null {
  const m = /\.([^.]+)$/.exec(fileName.trim());
  return m ? m[1].toLowerCase() : null;
}
export const isCadFile = (fileName: string) =>
  (CAD_FILE_EXTENSIONS as readonly string[]).includes(cadFileExtension(fileName) ?? "");

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
): string {
  const seg = cadPathSegment(styleRef);
  const ext = cadFileExtension(fileName) ?? "bin";
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `cad/${orderId}/${seg}/v${versionNo}/${seg}_${versionNo}_${stamp}${suffix}.${ext}`;
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
        : "No employee has the Designation PATTERN MAKER or CAD TECHNICIAN, so there is nobody to allocate to. Set it on Master Data ▸ Associates ▸ Employee.";
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
  cad_type: z.enum(["first_pattern", "grading", "marker_planning"], { message: "CAD Type is required" }),
  target_date: isoDate,
  remarks: text,
});
export type AllocationInput = z.input<typeof allocationInput>;

export const cadFileInput = z.object({
  file_name: z.string().min(1),
  storage_path: z.string().min(1),
  mime_type: z.string().nullish(),
  size_bytes: z.number().nullish(),
});
export type CadFileInput = z.infer<typeof cadFileInput>;

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

/** Spec §2.3 / §7: target on or after the allocation date (= today). */
export function allocationProblem(
  a: { pattern_maker_id: string | null; cad_type: string | null; target_date: string | null },
  today: string,
): string | null {
  if (!a.pattern_maker_id) return "Choose the Pattern Maker.";
  if (!a.cad_type) return "Choose the CAD Type.";
  if (!a.target_date) return "Enter the Internal Target Date.";
  if (a.target_date < today) return "The Internal Target Date cannot be before today's Allocation Date.";
  return null;
}

/** Spec §3.1, §3.2, §7 — the same refusals `cad_dispatch` raises. */
export function dispatchProblem(
  d: {
    dispatch_date: string | null;
    courier_tracking_no: string | null;
    email_sent_at: string | null;
    layout_type: string | null;
    files: readonly { file_name: string }[];
  },
  version: { allocation_date: string; cad_type: string },
  today: string,
): string | null {
  if (!d.dispatch_date) return "Enter the Dispatch Date.";
  if (d.dispatch_date > today) return "The Dispatch Date cannot be in the future.";
  if (d.dispatch_date < version.allocation_date) return "The Dispatch Date cannot be before the Allocation Date.";
  if (!d.courier_tracking_no?.trim() && !d.email_sent_at) {
    return "Enter a Courier Tracking Number or an Email Timestamp — a dispatch needs proof it was sent.";
  }
  if (version.cad_type === "marker_planning" && !d.layout_type) {
    return "A Marker Planning CAD needs its Layout Type (Open Width / Tubular).";
  }
  if (d.files.length === 0) return "Attach the CAD file (.DXF, .PDS or .PLT) — a dispatch cannot be recorded without it.";
  const bad = d.files.find((f) => !isCadFile(f.file_name));
  if (bad) return `${bad.file_name} is not a CAD file — only .DXF, .PDS and .PLT are accepted.`;
  return null;
}

/** Spec §4.2 and §7's layout check — the same refusals `cad_decide` raises. */
export function decisionProblem(
  d: { status: string | null; decided_on: string | null; buyer_comments: string | null },
  dispatch: { dispatch_date: string; layout_type: string | null },
  styleLayout: string | null,
  styleRef: string,
  today: string,
): string | null {
  if (d.status !== "approved" && d.status !== "rework") return "Choose Approved or Rework Required.";
  if (!d.decided_on) return "Enter the Decision Date.";
  if (d.decided_on > today) return "The Decision Date cannot be in the future.";
  if (d.decided_on < dispatch.dispatch_date) return "The Decision Date cannot be before the Dispatch Date.";
  if (d.status === "rework" && !d.buyer_comments?.trim()) {
    return "Enter the Buyer Alteration Comments — a Rework cannot be recorded without them.";
  }
  if (d.status === "approved" && styleLayout && dispatch.layout_type && styleLayout !== dispatch.layout_type) {
    return `Layout mismatch: the CAD marker is ${layoutLabel(dispatch.layout_type)} but style ${styleRef} is declared ${layoutLabel(styleLayout)} on the order. Correct the order's Layout Type or send the CAD back for rework.`;
  }
  return null;
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
  po_no: string | null;
  customer_id: string | null;
  customer_name: string | null;
  /** customers.cad_review_days — null = not set on the Customer master. */
  customer_review_days: number | null;
  delivery_date: string | null;
  style_ref_no: string;
  style_description: string | null;
  layout_type: LayoutType | null;
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
