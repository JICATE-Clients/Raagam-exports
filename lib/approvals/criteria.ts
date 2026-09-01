// Client-side mirror of approval_criteria_matches() plus the plain-English
// renderer that powers the flow builder's "What this means" panel.
//
// SCOPE WARNING: this is for PREVIEW AND VALIDATION IN THE BUILDER ONLY.
// The database is the authority on which flow a run actually gets. Never route
// a real request using this file — that is how the source system ended up with
// an admin screen that disagreed with the engine.
//
// Kept in sync by hand with assets/sql/02_core_functions.sql section 1. If you
// add an operator, add it in both places and to CriteriaOperator in types.ts.

import type {
  ApprovalCriteria,
  ApprovalContext,
  ApprovalFlow,
  ApprovalStep,
  CriteriaCondition,
} from './types';

function isOperatorObject(v: CriteriaCondition): v is Exclude<CriteriaCondition, string | number | boolean> {
  return typeof v === 'object' && v !== null;
}

/** Mirrors the SQL matcher, including its fail-closed behaviour. */
export function criteriaMatches(
  criteria: ApprovalCriteria | null | undefined,
  context: ApprovalContext,
): boolean {
  if (!criteria || Object.keys(criteria).length === 0) return true;

  for (const [key, cond] of Object.entries(criteria)) {
    const ctx = context[key];

    // A criterion naming a key the context does not supply cannot match.
    // Failing closed matters: the alternative routes a ₹10L request through
    // the ₹10k flow because someone forgot to pass `amount`.
    if (ctx === undefined || ctx === null) return false;

    if (isOperatorObject(cond)) {
      for (const [op, operand] of Object.entries(cond)) {
        switch (op) {
          case 'in':
            if (!Array.isArray(operand) || !operand.some((o) => o === ctx)) return false;
            break;
          case 'ne':
            if (ctx === operand) return false;
            break;
          case 'gt':
          case 'gte':
          case 'lt':
          case 'lte': {
            if (typeof ctx !== 'number' || typeof operand !== 'number') return false;
            const ok =
              op === 'gt' ? ctx > operand
              : op === 'gte' ? ctx >= operand
              : op === 'lt' ? ctx < operand
              : ctx <= operand;
            if (!ok) return false;
            break;
          }
          default:
            throw new Error(`Unknown criteria operator "${op}" on key "${key}"`);
        }
      }
    } else if (ctx !== cond) {
      return false;
    }
  }
  return true;
}

/** Mirrors approval_resolve_flow: priority ASC, then first match wins. */
export function resolveFlowPreview(
  flows: ApprovalFlow[],
  context: ApprovalContext,
): ApprovalFlow | null {
  return (
    [...flows]
      .filter((f) => f.is_active)
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
      .find((f) => criteriaMatches(f.criteria, context)) ?? null
  );
}

// ─── Plain English ──────────────────────────────────────────────────────────
// The single best UX idea in the system this was extracted from: an admin who
// can read the sentence catches a mis-built flow before it reaches production.

const OPERATOR_WORDS: Record<string, string> = {
  in: 'is one of',
  ne: 'is not',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
};

function humaniseKey(key: string): string {
  return key.replace(/_id$/, '').replace(/[_.]/g, ' ');
}

export function describeCriteria(criteria: ApprovalCriteria | null | undefined): string {
  if (!criteria || Object.keys(criteria).length === 0) {
    return 'every request that has no better match';
  }
  const parts = Object.entries(criteria).map(([key, cond]) => {
    if (!isOperatorObject(cond)) return `${humaniseKey(key)} is ${JSON.stringify(cond)}`;
    return Object.entries(cond)
      .map(([op, operand]) => {
        const word = OPERATOR_WORDS[op] ?? op;
        const value = Array.isArray(operand)
          ? operand.map((o) => String(o)).join(', ')
          : String(operand);
        return `${humaniseKey(key)} ${word} ${value}`;
      })
      .join(' and ');
  });
  return parts.join(' and ');
}

export interface StepDescription {
  step_order: number;
  sentence: string;
  /** Populated by the builder from a live role-holder count. */
  holderCount?: number;
  warning?: string;
}

export function describeStep(
  step: ApprovalStep,
  holderCount?: number,
): StepDescription {
  const who: string[] = [];
  if (step.approver_user_ids?.length) {
    who.push(
      step.approver_user_ids.length === 1
        ? '1 named person'
        : `any 1 of ${step.approver_user_ids.length} named people`,
    );
  }
  if (step.approver_role_key) who.push(`anyone with the "${step.approver_role_key}" role`);
  if (step.approver_resolver) who.push(`the requester's ${humaniseKey(step.approver_resolver)}`);

  let sentence = `Step ${step.step_order} — ${step.step_label}: ${who.join(', or ') || 'NOBODY'} approves.`;

  if (step.required_permission) {
    sentence += ` They must also hold "${step.required_permission}".`;
  }
  if (step.mode === 'parallel') {
    sentence += step.min_approvals
      ? ` Any ${step.min_approvals} of them must approve.`
      : ' All of them must approve.';
  }
  if (step.sla_hours) {
    const onBreach = step.on_sla_breach ?? 'notify';
    sentence +=
      onBreach === 'escalate'
        ? ` If untouched for ${step.sla_hours}h it moves to the next step automatically.`
        : onBreach === 'none'
          ? ` A ${step.sla_hours}h target is recorded but nothing happens if it passes.`
          : ` If untouched for ${step.sla_hours}h, a reminder is raised.`;
  }
  if (step.on_return_restart_from_step) {
    sentence += ` Returning sends it back to step ${step.on_return_restart_from_step}.`;
  }
  if (step.allow_self_approve) {
    sentence += ' The requester CAN approve their own request at this step.';
  }

  let warning: string | undefined;
  if (!who.length) {
    warning = 'This step names no approver and will be rejected when you save.';
  } else if (holderCount === 0 && step.approver_role_key && !step.approver_user_ids?.length) {
    warning = `Nobody currently holds "${step.approver_role_key}". Any request reaching this step cannot be actioned.`;
  } else if (step.allow_self_approve) {
    warning = 'Self-approval is enabled — the requester can approve their own request here.';
  }

  return { step_order: step.step_order, sentence, holderCount, warning };
}

/** The full "What this means" body for one flow. */
export function describeFlow(
  flow: Pick<ApprovalFlow, 'flow_name' | 'criteria' | 'steps' | 'priority'>,
  holderCounts?: Record<string, number>,
): { headline: string; steps: StepDescription[] } {
  const headline =
    `"${flow.flow_name}" applies to ${describeCriteria(flow.criteria)}. ` +
    `If more than one flow matches, the one with the lowest priority number wins ` +
    `(this one is ${flow.priority}).`;

  const steps = [...flow.steps]
    .sort((a, b) => a.step_order - b.step_order)
    .map((s) =>
      describeStep(s, s.approver_role_key ? holderCounts?.[s.approver_role_key] : undefined),
    );

  return { headline, steps };
}

// ─── Save-time validation, mirroring approval_validate_steps() ──────────────
// Runs in the builder so the user sees the problem before the round-trip.
// The DB trigger is still the authority.

export function validateSteps(steps: ApprovalStep[]): string[] {
  const errors: string[] = [];
  if (!steps.length) errors.push('A flow needs at least one step.');

  steps.forEach((step, i) => {
    const n = i + 1;
    if (step.step_order !== n) {
      errors.push(`Step at position ${n} has step_order ${step.step_order}; it must be ${n}.`);
    }
    if (!step.step_label?.trim()) errors.push(`Step ${n} has no label.`);

    const sources =
      Number(Boolean(step.approver_role_key)) +
      Number(Boolean(step.approver_user_ids?.length)) +
      Number(Boolean(step.approver_resolver));
    if (sources === 0) errors.push(`Step ${n} names no approver.`);

    if (step.on_return_restart_from_step && step.on_return_restart_from_step >= n) {
      errors.push(`Step ${n} can only return to an earlier step.`);
    }
    if (step.mode === 'parallel' && step.min_approvals && step.min_approvals < 1) {
      errors.push(`Step ${n} has min_approvals below 1.`);
    }
  });

  return errors;
}
