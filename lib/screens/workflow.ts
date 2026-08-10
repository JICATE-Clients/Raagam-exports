/* =============================================================================
 * A DOCUMENT'S STATE MACHINE, DECLARED ONCE.
 *
 * BOUNDARY CONTRACT for everything under `lib/screens/**`, enforced by
 * `scripts/check-screens.mts`:
 *   no "use client" · no JSX · no React import · no component value imported ·
 *   no lucide · no `window` / `document` / `fetch` / `await` / `new Date()`.
 * Functions ARE allowed — a descriptor is imported by the client wrapper, never
 * passed across the RSC boundary, so closures survive. What must hold is that
 * plain Node can load this file: `lib/data-io`, every `"use server"` action and
 * the check script all import it.
 *
 * WHY THIS FILE EXISTS. There is no shared approval layer in this app today.
 * ~20 migrations each grew their own status columns in ~40 vocabularies, and
 * every screen that acts on them hand-rolls its buttons:
 * `app/(app)/purchase/orders/[poId]/po-detail.tsx` renders five ad-hoc `&&`
 * branches with NO dirty gate at all, so an operator can edit the Commercial
 * tab, not save it, switch tab and Approve. `lib/orders/approve-amendments/`
 * checks `orders:edit` rather than the `approve` action that exists in
 * `lib/auth/types.ts` and has never had a consumer.
 *
 * This is the client-side half and needs no migration. The persistence half
 * (`document_transitions`) is separate, and deliberately does NOT replace the
 * per-table status columns — 135 call sites write those and every list filters
 * on them. Nor does it compete with `doc/rbac-approvals-plan.md`'s
 * `approval_flows`: that engine decides WHO must approve next, this one decides
 * WHAT states are legal and who may move between them.
 * ========================================================================== */

import type { Action, Module } from "@/lib/auth/types";
import type { StatusTone } from "@/lib/ui/tone";

/** The app-wide server-action result shape. */
export type ActionResult = { ok: true } | { ok: false; error: string };

export type WorkflowStatus = {
  /**
   * The value STORED in the row's status column.
   *
   * Exempt from the CAPITALS rule by construction — AGENTS.md lists workflow
   * status keys among the exemptions, because these are compared in SQL and in
   * `from`/`to` below, not read by an operator. The `label` is what they read.
   *
   * Do NOT normalise these across the app. The 40 existing vocabularies differ
   * for real reasons and rewriting them is a data migration; the check script
   * asserts instead that a spec's keys are a SUBSET of that table's own check
   * constraint, which is what catches the `finalised` / `finalized` split that
   * exists in the migrations today.
   */
  key: string;
  /** What the operator reads. "Pending Approval", not "pending_approval". */
  label: string;
  tone: StatusTone;
  /**
   * The record is READ-ONLY in this state: the form disables its fields and
   * HIDES Save rather than disabling it. Hidden, because a disabled Save on an
   * approved document invites the operator to hunt for what is wrong with their
   * input when nothing is.
   */
  locked?: boolean;
  /** No transition leaves here. Used by `workflowIssues` to tell a dead end
   *  that was intended from one that was an oversight. */
  terminal?: boolean;
};

export type WorkflowTransition<Ctx = void> = {
  key: string;
  /** The button. "Submit for approval" · "Approve" · "Reject". */
  label: string;
  /** Legal source statuses. A transition is offered only from these. */
  from: readonly string[];
  to: string;
  variant?: "primary" | "outline" | "danger";
  /**
   * Permission gate. `{ module: "purchase", action: "approve" }`.
   *
   * Naming it here is what lets the whole app agree at once, instead of each of
   * ~20 hand-written decide-actions picking `edit` or `approve` for itself.
   */
  permission?: { module: Module; action: Action };
  /**
   * Business gate. Return a REASON to block, `null` to allow.
   *
   * Rendered as the tooltip on a DISABLED button — never as a button that
   * silently isn't there. A vanished button teaches the operator nothing and is
   * indistinguishable from a permission they lack; `po-detail.tsx` omits its
   * buttons today and that is the difference between "you can't" and "not yet".
   */
  guard?: (ctx: Ctx) => string | null;
  /** Capture a note before firing. `required` refuses an empty one client-side;
   *  the server action still guards, on the same "the screen check is a
   *  courtesy, this one is the guard" split as `checkDuplicateName`. */
  reason?: { label: string; required: boolean; placeholder?: string };
  /** Two-step confirm, the shape `RowActions`' delete strip already uses. */
  confirm?: boolean;
  /**
   * Fires the transition.
   *
   * Takes a context and a note — NEVER form values. That is the type-level
   * statement of "workflow buttons change status, not data": a transition
   * physically cannot smuggle an edit through.
   */
  run: (ctx: Ctx, input: { reason?: string }) => Promise<ActionResult>;
};

export type Workflow<Ctx = void> = {
  statuses: readonly WorkflowStatus[];
  transitions: readonly WorkflowTransition<Ctx>[];
};

/**
 * The declared status, or a readable stand-in for one that isn't declared.
 *
 * It does NOT throw and does NOT return null. A row can hold a status the spec
 * has not caught up with — a legacy value, a column whose check constraint grew
 * — and neither crashing the screen nor rendering an empty pill is an honest
 * answer. The raw key showing where a label should be (`partially_received`
 * rather than "Partially Received") is its own tell, without alarming an
 * operator about a gap that is not theirs to fix.
 *
 * `neutral` rather than `warning` for the same reason. The real guard is the
 * check script asserting a spec's keys against the table's check constraint, so
 * on a checked screen this branch should never be reached.
 */
export function statusOf(w: Workflow<never>, key: string | null | undefined): WorkflowStatus {
  const found = w.statuses.find((s) => s.key === key);
  if (found) return found;
  return { key: key ?? "", label: key ?? "—", tone: "neutral" };
}

/**
 * The transitions legal FROM this status.
 *
 * Status only — permission and `guard` are applied at render, where the perms
 * and the context exist. Keeping them out means this stays pure and testable,
 * and means a caller cannot accidentally offer a transition by forgetting to
 * pass perms.
 */
export function nextActions<Ctx>(w: Workflow<Ctx>, status: string | null | undefined): WorkflowTransition<Ctx>[] {
  return w.transitions.filter((t) => t.from.includes(status ?? ""));
}

/** The record is read-only in this state. Unknown statuses are NOT locked —
 *  locking on a value the spec does not know would strand the row. */
export function isLocked(w: Workflow<never>, status: string | null | undefined): boolean {
  return w.statuses.find((s) => s.key === status)?.locked === true;
}

/**
 * Structural problems in a spec, for `scripts/check-screens.mts`.
 *
 * Returns the empty array for a sound workflow. Every entry is a mistake that
 * is silent at runtime — a transition to a status nobody declared renders a
 * pill with a raw key, and a status nothing reaches is a state the document can
 * never be in, which usually means a `from` list is missing an entry.
 *
 * It deliberately does NOT check states against the DB constraint: that needs
 * the migrations parsed, which is the check script's job, not this module's —
 * this file may not read a file.
 */
export function workflowIssues(w: Workflow<never>): string[] {
  const issues: string[] = [];
  const keys = new Set(w.statuses.map((s) => s.key));

  const dupStatus = w.statuses.map((s) => s.key).filter((k, i, a) => a.indexOf(k) !== i);
  for (const k of new Set(dupStatus)) issues.push(`status "${k}" is declared twice`);

  const dupTransition = w.transitions.map((t) => t.key).filter((k, i, a) => a.indexOf(k) !== i);
  for (const k of new Set(dupTransition)) issues.push(`transition "${k}" is declared twice`);

  for (const t of w.transitions) {
    if (!keys.has(t.to)) issues.push(`transition "${t.key}" goes to undeclared status "${t.to}"`);
    if (t.from.length === 0) issues.push(`transition "${t.key}" has no "from" status, so it is unreachable`);
    for (const f of t.from) {
      if (!keys.has(f)) issues.push(`transition "${t.key}" comes from undeclared status "${f}"`);
    }
    if (t.reason?.required && !t.reason.label) {
      issues.push(`transition "${t.key}" requires a reason but does not label the box`);
    }
  }

  // A status nothing transitions INTO, and which is not the first one declared
  // (the initial state), is unreachable.
  const reached = new Set(w.transitions.map((t) => t.to));
  for (const [i, s] of w.statuses.entries()) {
    if (i > 0 && !reached.has(s.key)) issues.push(`status "${s.key}" is unreachable — no transition goes to it`);
    const leaves = w.transitions.some((t) => t.from.includes(s.key));
    if (!leaves && !s.terminal) {
      issues.push(`status "${s.key}" is a dead end — mark it \`terminal: true\` if that is intended`);
    }
    if (leaves && s.terminal) issues.push(`status "${s.key}" is marked terminal but has transitions leaving it`);
  }

  return issues;
}
