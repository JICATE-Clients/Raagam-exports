/**
 * ONE ANSWER TO "WHAT COLOUR IS THIS STATUS?" (2026-10-16).
 *
 * `StatusPill` maps a TONE to a colour; nothing mapped a STATUS to a tone, so
 * 32 modules each wrote their own `xxxStatusTone()` and they drifted — a draft
 * was neutral on seven screens and amber on five, cancelled was red on five and
 * grey on three. This table is the vocabulary those functions now read, so a
 * word draws the same colour in every module.
 *
 * The tones follow `lib/ui/tone.ts`:
 *   success  — finished, accepted, in force (approved, paid, active)
 *   warning  — waiting on someone, or half done (pending, submitted, partial)
 *   danger   — the operator must act (rejected, cancelled, overdue, expired)
 *   info     — moving, out of our hands (issued, sent, in progress, amended)
 *   neutral  — no claim yet, or retired (draft, closed, superseded, inactive)
 *
 * LOOKUP IS EXACT, NEVER A SUBSTRING. `normalizeStatus` only folds case and
 * separators ("Pending MD Approval" → `pending_md_approval`). A substring
 * test is how "Not Approved" turns green because it contains "approved" — so
 * `not_approved` and `partially_approved` are their own keys, and an unknown
 * word is `neutral` (no claim), never a guess.
 *
 * A MODULE THAT GENUINELY MEANS SOMETHING ELSE passes `overrides`, declared
 * beside its status type with the reason in a comment. "Pending" on a T&A step
 * means "not started" and on an approval means "waiting on the approver" —
 * that is two meanings, not drift, and `TASK_PROGRESS` names the first.
 *
 * Pure TypeScript with no imports beyond `./tone`, so `lib/**` descriptors and
 * `scripts/check-status-tone.mts` can load it under plain Node.
 */
import type { StatusTone } from "./tone";

export type { StatusTone };

/** A module's documented exceptions, keyed by NORMALISED status. */
export type StatusToneOverrides = Readonly<Record<string, StatusTone>>;

export const STATUS_TONES = {
  // ── no claim yet ─────────────────────────────────────────────────────────
  draft: "neutral",
  new: "neutral",
  open: "neutral",
  requested: "neutral",
  not_started: "neutral",
  no_bom: "neutral",

  // ── waiting on someone / half done ───────────────────────────────────────
  pending: "warning",
  pending_approval: "warning",
  pending_md_approval: "warning",
  submitted: "warning",
  under_review: "warning",
  revision: "warning",
  returned: "warning",
  rework: "warning",
  partial: "warning",
  partially_approved: "warning",
  partially_received: "warning",
  partially_paid: "warning",
  partially_utilised: "warning",
  partially_returned: "warning",
  on_hold: "warning",
  locked: "warning",

  // ── moving, out of our hands ─────────────────────────────────────────────
  in_progress: "info",
  issued: "info",
  sent: "info",
  filed: "info",
  deposited: "info",
  booked: "info",
  assigned: "info",
  amended: "info",
  scheduled: "info",

  // ── done, accepted, in force ─────────────────────────────────────────────
  approved: "success",
  accepted: "success",
  confirmed: "success",
  finalised: "success",
  finalized: "success",
  completed: "success",
  complete: "success",
  done: "success",
  passed: "success",
  pass: "success",
  posted: "success",
  fixed: "success",
  resolved: "success",
  planned: "success",
  updated: "success",
  received: "success",
  delivered: "success",
  paid: "success",
  settled: "success",
  cleared: "success",
  utilised: "success",
  fulfilled: "success",
  won: "success",
  active: "success",
  yes: "success",

  // ── the operator must act ────────────────────────────────────────────────
  rejected: "danger",
  not_approved: "danger",
  not_acknowledged: "danger",
  cancelled: "danger",
  canceled: "danger",
  failed: "danger",
  fail: "danger",
  error: "danger",
  bounced: "danger",
  expired: "danger",
  overdue: "danger",
  escalated: "danger",
  delayed: "danger",
  recalculate: "danger",
  replan: "danger",
  unresolved: "danger",
  revoked: "danger",
  blocked: "danger",
  lost: "danger",

  // ── retired, or deliberately set aside ───────────────────────────────────
  closed: "neutral",
  superseded: "neutral",
  abandoned: "neutral",
  withdrawn: "neutral",
  bypassed: "neutral",
  disabled: "neutral",
  inactive: "neutral",
  ended: "neutral",
  no: "neutral",
} as const satisfies Record<string, StatusTone>;

export type KnownStatus = keyof typeof STATUS_TONES;

/**
 * "Pending" on a task (a T&A step, a QC check not yet run) means NOT STARTED,
 * which makes no claim — unlike "pending" on an approval, which is waiting on
 * a person. Every T&A / progress ladder passes this.
 */
export const TASK_PROGRESS: StatusToneOverrides = { pending: "neutral" };

/** Case and separators only: "Pending MD-Approval " → "pending_md_approval". */
export function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/[\s\-/]+/g, "_");
}

function own(map: Readonly<Record<string, StatusTone>>, key: string): StatusTone | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/**
 * The tone for a status word. Overrides first, then the shared table, then
 * `neutral` — an unknown word makes no claim. Null / blank is neutral too.
 */
export function statusTone(
  status: string | null | undefined,
  overrides?: StatusToneOverrides,
): StatusTone {
  if (!status) return "neutral";
  const key = normalizeStatus(status);
  return (overrides && own(overrides, key)) ?? own(STATUS_TONES, key) ?? "neutral";
}

/** True when the word is in the table (or the overrides) — for checks, not rendering. */
export function isKnownStatus(status: string, overrides?: StatusToneOverrides): boolean {
  const key = normalizeStatus(status);
  return (!!overrides && own(overrides, key) !== undefined) || own(STATUS_TONES, key) !== undefined;
}

/** An `is_active` / `active` flag: Active is success, Inactive makes no claim. */
export function activeTone(active: boolean | null | undefined): StatusTone {
  return active ? STATUS_TONES.active : STATUS_TONES.inactive;
}

/** An `is_draft` flag on a saved document: Draft makes no claim, saved is done. */
export function draftTone(isDraft: boolean | null | undefined): StatusTone {
  return isDraft ? STATUS_TONES.draft : STATUS_TONES.updated;
}
