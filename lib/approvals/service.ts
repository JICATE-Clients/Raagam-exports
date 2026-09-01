// Thin wrappers over the engine's RPCs.
//
// THIS FILE CONTAINS NO BUSINESS LOGIC, BY CONSTRUCTION. Every decision about
// who may act, what a step means, and when a run advances lives in Postgres.
// If you find yourself adding an `if` here that changes an outcome, it belongs
// in 02_core_functions.sql instead — the reason the engine cannot be bypassed
// is that approval_runs has no UPDATE policy and these functions are the only
// write path.
//
// ADAPTED — and it is the only change in this file, exactly as the skill says
// it should be.
//
// THE SERVER CLIENT, NOT THE BROWSER ONE. Raagam has a `QueryClientProvider`
// mounted (`app/providers.tsx`) but not one screen in 232 uses it: every screen
// loads in a Server Component and mutates through a server action. Using the
// browser client here would make Approvals the only screen in the app fetching
// client-side, and it would put these calls outside the `can()` gate every
// other action passes through.
//
// Nothing about the ENGINE changes as a result. The RPCs are SECURITY DEFINER
// and authorise on `auth.uid()`, which the server client carries from the
// session cookie just as the browser client carries it from local storage — so
// who may act is decided in exactly the same place either way.
//
// `createClient()` is async here (it awaits `cookies()`), so every call site
// below gained an `await`.
import "server-only";
import { createClient } from '@/lib/supabase/server';

import type {
  ApprovalFlow,
  ApprovalFlowDraft,
  ApprovalRun,
  ApprovalContext,
  ApprovalScope,
  CanActVerdict,
  QueueItem,
  RunAction,
  StrandedRun,
  TimelineRow,
} from './types';

// ─── Error mapping ──────────────────────────────────────────────────────────
// The RPCs raise specific SQLSTATEs. Turning them into typed errors here means
// the UI can react without string-matching on messages.

export type ApprovalErrorCode =
  | 'stale'          // 40001 — someone else acted first
  | 'forbidden'      // 42501 — not an approver
  | 'already_closed' // 55000 — run is no longer in progress
  | 'would_strand'   // 23514 — next step has nobody
  | 'no_flow'        // 23503 — nothing matched
  | 'bad_input'      // 22023 — missing comment, unknown action
  | 'not_found'      // 42704
  | 'unknown';

export class ApprovalError extends Error {
  constructor(
    readonly code: ApprovalErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}

const SQLSTATE_MAP: Record<string, ApprovalErrorCode> = {
  '40001': 'stale',
  '42501': 'forbidden',
  '55000': 'already_closed',
  '23514': 'would_strand',
  '23503': 'no_flow',
  '22023': 'bad_input',
  '42704': 'not_found',
};

/** Friendly text for the codes a user can actually act on. */
export const APPROVAL_ERROR_TEXT: Record<ApprovalErrorCode, string> = {
  stale: 'Someone else acted on this request while you had it open. Reload to see the current state.',
  forbidden: 'You are not an approver for the current step.',
  already_closed: 'This request has already been decided.',
  would_strand: 'The next step has no eligible approver, so this would leave the request stuck. Fix the flow or the role assignment first.',
  no_flow: 'No approval flow matches this request. Ask an administrator to add a matching flow.',
  bad_input: 'Please provide the required comment.',
  not_found: 'This approval request no longer exists.',
  unknown: 'Something went wrong processing this approval.',
};

function toApprovalError(error: { code?: string; message?: string } | null, fallback: string): ApprovalError {
  if (!error) return new ApprovalError('unknown', fallback);
  const code = SQLSTATE_MAP[error.code ?? ''] ?? 'unknown';
  return new ApprovalError(code, error.message || fallback, error);
}

// ─── Runs ───────────────────────────────────────────────────────────────────

export interface StartRunArgs {
  workflowKey: string;
  subjectTable: string;
  subjectId: string;
  /** Matched against each flow's criteria. Pass every key any flow might test. */
  context?: ApprovalContext;
  /** Passed to the RBAC shim for role lookups on every step of this run. */
  scope?: ApprovalScope;
  tenantId?: string | null;
}

/**
 * Begin an approval run for a subject row that already exists.
 *
 * Throws `no_flow` if nothing matches — decide per workflow whether that means
 * "auto-approve" or "block". Do not swallow it.
 */
export async function startRun(args: StartRunArgs): Promise<ApprovalRun> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approval_start_run', {
    p_workflow_key: args.workflowKey,
    p_subject_table: args.subjectTable,
    p_subject_id: args.subjectId,
    p_context: args.context ?? {},
    p_scope: args.scope ?? {},
    p_tenant_id: args.tenantId ?? null,
  });
  if (error) throw toApprovalError(error, 'Could not start the approval');
  return data as ApprovalRun;
}

/**
 * Approve, reject or return.
 *
 * `lockVersion` is REQUIRED and has no default, here and in SQL. Optimistic
 * concurrency only works if the caller sends it; making it mandatory is what
 * stops two approvers double-advancing a run.
 *
 * A comment is mandatory for reject, return, and any super-admin override.
 */
export async function act(params: {
  runId: string;
  action: RunAction;
  lockVersion: number;
  comment?: string;
}): Promise<ApprovalRun> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approval_act', {
    p_run_id: params.runId,
    p_action: params.action,
    p_lock_version: params.lockVersion,
    p_comment: params.comment ?? null,
  });
  if (error) throw toApprovalError(error, 'Could not record your decision');
  return data as ApprovalRun;
}

export async function cancelRun(runId: string, reason: string): Promise<ApprovalRun> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approval_cancel', {
    p_run_id: runId,
    p_reason: reason,
  });
  if (error) throw toApprovalError(error, 'Could not cancel the request');
  return data as ApprovalRun;
}

/** Tier 2 (assets/sql/03_optional.sql section A). */
export async function delegate(params: {
  runId: string;
  toUserId: string;
  comment: string;
}): Promise<ApprovalRun> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approval_delegate', {
    p_run_id: params.runId,
    p_to_user_id: params.toUserId,
    p_comment: params.comment,
  });
  if (error) throw toApprovalError(error, 'Could not delegate this step');
  return data as ApprovalRun;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** Same predicate the gate uses — one implementation, two callers. */
export async function canAct(runId: string, userId?: string): Promise<CanActVerdict> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approval_can_act', {
    p_run_id: runId,
    ...(userId ? { p_user_id: userId } : {}),
  });
  if (error) throw toApprovalError(error, 'Could not check your permissions');
  return data as CanActVerdict;
}

export async function getRunForSubject(
  subjectTable: string,
  subjectId: string,
): Promise<ApprovalRun | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('approval_runs')
    .select('*')
    .eq('subject_table', subjectTable)
    .eq('subject_id', subjectId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toApprovalError(error, 'Could not load the approval');
  return (data as ApprovalRun) ?? null;
}

export async function getTimeline(runId: string): Promise<TimelineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approval_timeline', { p_run_id: runId });
  if (error) throw toApprovalError(error, 'Could not load the approval history');
  return (data ?? []) as TimelineRow[];
}

export interface QueueResult {
  items: QueueItem[];
  total: number;
}

export async function getMyQueue(params?: {
  workflowKey?: string | null;
  tenantId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<QueueResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approval_my_queue', {
    p_workflow_key: params?.workflowKey ?? null,
    p_tenant_id: params?.tenantId ?? null,
    p_limit: params?.limit ?? 50,
    p_offset: params?.offset ?? 0,
  });
  if (error) throw toApprovalError(error, 'Could not load your approvals');
  const items = (data ?? []) as QueueItem[];
  // total_count is identical on every row; zero rows means zero total.
  return { items, total: items[0]?.total_count ?? 0 };
}

/** Should always be empty. A non-empty result is an incident, not a report. */
export async function getStrandedRuns(): Promise<StrandedRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('approval_stranded_runs')
    .select('*')
    .order('started_at', { ascending: true });
  if (error) throw toApprovalError(error, 'Could not check for stranded approvals');
  return (data ?? []) as StrandedRun[];
}

// ─── Flow administration ────────────────────────────────────────────────────
// Plain RLS-gated table writes, gated on approvals.flow.manage. There is no
// save RPC in Tier 1 — one only earns its keep once versioning exists and
// saving has to close the previous version transactionally.

export async function listFlows(workflowKey?: string): Promise<ApprovalFlow[]> {
  const supabase = await createClient();
  let q = supabase.from('approval_flows').select('*').order('workflow_key').order('priority');
  if (workflowKey) q = q.eq('workflow_key', workflowKey);
  const { data, error } = await q;
  if (error) throw toApprovalError(error, 'Could not load approval flows');
  return (data ?? []) as ApprovalFlow[];
}

export async function saveFlow(draft: ApprovalFlowDraft): Promise<ApprovalFlow> {
  const supabase = await createClient();
  const payload = {
    workflow_key: draft.workflow_key,
    flow_name: draft.flow_name,
    description: draft.description,
    tenant_id: draft.tenant_id,
    // ONE SCOPE COLUMN, RENAMED WITH THE SCHEMA'S (0501). See the note on
    // `ApprovalFlow.location_id` — the three the skill ships do not exist in
    // this database, and PostgREST rejects an unknown column, so leaving them
    // here would fail every flow save rather than being harmlessly ignored.
    location_id: draft.location_id,
    criteria: draft.criteria,
    steps: draft.steps,
    priority: draft.priority,
    is_active: draft.is_active,
  };

  const q = draft.id
    ? supabase.from('approval_flows').update(payload).eq('id', draft.id)
    : supabase.from('approval_flows').insert(payload);

  const { data, error } = await q.select().single();
  // The step-shape trigger raises here with a readable message — surface it
  // rather than replacing it with something generic.
  if (error) throw toApprovalError(error, 'Could not save the flow');
  return data as ApprovalFlow;
}

export async function setFlowActive(flowId: string, isActive: boolean): Promise<void> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from('approval_flows')
    .update({ is_active: isActive }, { count: 'exact' })
    .eq('id', flowId);
  if (error) throw toApprovalError(error, 'Could not update the flow');
  // RLS returns success with zero rows when the write was silently filtered.
  // Surfacing that is the difference between "saved" and "looked like it saved".
  if (count === 0) {
    throw new ApprovalError('forbidden', 'You do not have permission to change this flow.');
  }
}
