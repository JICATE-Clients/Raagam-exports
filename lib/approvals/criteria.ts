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

/** Resolvers implemented in `approval_rbac_resolve_dynamic`, in words. */
const RESOLVER_WORDS: Record<string, string> = {
  md_or_hr_manager: 'anyone with the "Managing Director" or "HR Manager" role',
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

/**
 * "45 minutes" · "2 hours" · "1 hour 30 minutes" (0601).
 *
 * The STORED unit is minutes and stays minutes — this is the sentence only.
 * A flow set to 120 reading "If untouched for 120 minutes" is arithmetic the
 * admin has to do to check their own policy, and the whole point of the
 * "What this means" panel is that they do not have to.
 */
function slaText(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const hours = `${h} hour${h === 1 ? '' : 's'}`;
  return rest === 0 ? hours : `${hours} ${rest} minute${rest === 1 ? '' : 's'}`;
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
  if (step.approver_resolver) {
    /* A resolver that is not about the requester says what it really resolves
       to — "the requester's md or hr manager" would misdescribe 0629's. */
    who.push(RESOLVER_WORDS[step.approver_resolver] ?? `the requester's ${humaniseKey(step.approver_resolver)}`);
  }

  let sentence = `Step ${step.step_order} — ${step.step_label}: ${who.join(', or ') || 'NOBODY'} approves.`;

  if (step.required_permission) {
    sentence += ` They must also hold "${step.required_permission}".`;
  }
  if (step.mode === 'parallel') {
    sentence += step.min_approvals
      ? ` Any ${step.min_approvals} of them must approve.`
      : ' All of them must approve.';
  }
  if (step.sla_minutes) {
    const onBreach = step.on_sla_breach ?? 'notify';
    const within = slaText(step.sla_minutes);
    sentence +=
      onBreach === 'escalate'
        ? ` If untouched for ${within} it moves to the next step automatically, and that step's approvers are told why.`
        : onBreach === 'none'
          ? ` A ${within} target is recorded but nothing happens if it passes.`
          : ` If untouched for ${within}, a reminder is raised.`;
    /* SAID EITHER WAY (0603). The quiet default is the client's decision, not
       an omission — so the sentence states it, rather than only mentioning the
       switch when it happens to be on. An admin reading "What this means"
       should be able to see which way it was left. */
    if (onBreach === 'escalate') {
      sentence += step.notify_missed_approver
        ? ' The approver who missed it is told that it has moved on.'
        : ' The approver who missed it is not notified.';
    }
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

    /* 0601's two SLA rules, mirrored from `approval_validate_steps`. The trigger
       is still the authority — these exist so the admin reads the problem in the
       builder instead of as a raised exception after pressing Save. */
    if (step.sla_minutes != null && !(Number(step.sla_minutes) > 0)) {
      errors.push(`Step ${n} has an SLA of "${step.sla_minutes}"; it must be a number of minutes above zero.`);
    }
    if (step.on_sla_breach && step.on_sla_breach !== 'none' && !step.sla_minutes) {
      errors.push(`Step ${n} says what to do on breach but sets no SLA, so nothing would ever trigger it.`);
    }
    if (step.notify_missed_approver && step.on_sla_breach !== 'escalate') {
      errors.push(
        `Step ${n} is set to tell the approver who missed it, but it does not escalate — on a reminder they are already the ones told. Set it to escalate, or untick it.`,
      );
    }
    if (step.on_sla_breach === 'escalate' && n === steps.length) {
      errors.push(
        `Step ${n} is the last step, so it cannot escalate — there is no step above it. Use "remind", or add the step it should escalate to.`,
      );
    }
  });

  return errors;
}
