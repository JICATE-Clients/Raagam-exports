"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import {
  act as svcAct,
  canAct,
  getRunForSubject,
  getTimeline,
  cancelRun as svcCancel,
  startRun as svcStart,
  saveFlow as svcSaveFlow,
  setFlowActive as svcSetFlowActive,
  ApprovalError,
  APPROVAL_ERROR_TEXT,
  type StartRunArgs,
} from "./service";
import type { ApprovalFlowDraft, RunAction } from "./types";

/**
 * Raagam's server-action skin over the approval service.
 *
 * ## THIS FILE ADDS NO AUTHORITY, AND THAT IS THE POINT
 *
 * The engine's whole security thesis is that `approval_runs` has no UPDATE
 * policy and the SECURITY DEFINER RPCs are the only write path — so who may
 * approve what is decided in Postgres, by `approval_can_act`, against
 * `auth.uid()`. Nothing here can loosen that and nothing here should try.
 *
 * What the `can()` calls below add is a CHEAPER, EARLIER refusal in the app's
 * own vocabulary, the same one every other action in this app performs. They
 * are a courtesy, exactly like the on-screen duplicate check is a courtesy to
 * `checkDuplicateName`: remove them and the engine still refuses, just later and
 * in SQLSTATE rather than in a toast.
 *
 * ## WHY THE SERVICE IS NOT CALLED DIRECTLY FROM A SCREEN
 *
 * Two reasons, both structural. `service.ts` is `server-only` and throws
 * `ApprovalError`; a client component can neither import it nor catch across the
 * boundary. And every screen in this app expects `{ ok }` — a thrown error in a
 * `useTransition` is an unhandled rejection and a blank screen, where a returned
 * `{ ok: false, error }` is a toast.
 *
 * ## THE ERROR TEXT IS THE SERVICE'S, NOT THIS FILE'S
 *
 * `APPROVAL_ERROR_TEXT` is keyed by the eight codes the RPCs raise, and the skill
 * is explicit that a divergent error mapping is worse than none. So `explain()`
 * looks the code up rather than writing a sentence here — "Someone else acted on
 * this while you had it open" has to keep meaning SQLSTATE 40001 and nothing
 * else, or the operator is told to reload when the real problem was permission.
 */

type Result = { ok: true; id?: string } | { ok: false; error: string };

const okay = (id?: string): Result => (id ? { ok: true, id } : { ok: true });
const fail = (error: string): Result => ({ ok: false, error });

/**
 * Turn whatever came back into one sentence an operator can act on.
 *
 * An `ApprovalError` carries a code the engine chose, so it gets the settled
 * text. Anything else is a bug rather than a refusal, and gets its own message —
 * swallowing it into "something went wrong" is how a schema mistake looks
 * identical to a permission one for a week.
 */
function explain(e: unknown, fallback: string): string {
  if (e instanceof ApprovalError) return APPROVAL_ERROR_TEXT[e.code] ?? e.message;
  return e instanceof Error ? e.message : fallback;
}

/**
 * REVALIDATE THE INBOX AS WELL AS THE SUBJECT, ALWAYS.
 *
 * Every decision changes two screens: the document the operator is looking at,
 * and the queue of whoever is next (or the actor's own, now one shorter). The
 * skill's troubleshooting table lists "badge count ≠ list length" as a real
 * symptom and its cause as stale caching — this is that, on the server-component
 * side of the same problem.
 */
function revalidateApprovals(subjectPath?: string) {
  revalidatePath("/approvals");
  if (subjectPath) revalidatePath(subjectPath);
}

// ─── Runs ───────────────────────────────────────────────────────────────────

/**
 * Begin a run for a subject row THAT ALREADY EXISTS.
 *
 * Called from a document's own submit action, never from a screen directly —
 * the row has to be there before there is anything to approve, and the two
 * writes belong in one action so a submitted document cannot exist without a
 * run (or a run without its document).
 *
 * `no_flow` IS RETURNED, NOT SWALLOWED. The skill is emphatic: decide per
 * workflow whether "nothing matched" means auto-approve or block. 0503 seeds a
 * catch-all per workflow so it should not happen — and if it does, the caller
 * learns rather than the document silently sitting in no queue at all.
 */
export async function startApproval(args: StartRunArgs): Promise<Result> {
  try {
    const run = await svcStart(args);
    revalidateApprovals();
    return okay(run.id);
  } catch (e) {
    return fail(explain(e, "Could not start the approval"));
  }
}

/**
 * Approve, reject or return.
 *
 * `lockVersion` has NO DEFAULT, here or in SQL, and that is deliberate:
 * optimistic concurrency only works if the caller sends what it last read.
 * Making it mandatory is what stops two approvers double-advancing one run —
 * the second gets `stale` and is told to reload.
 *
 * A comment is mandatory for reject, for return, and for any super-admin
 * override. The database enforces it (an override with no explanation is an
 * audit gap); the action bar asks for it first so the operator is not refused
 * after committing to the decision.
 */
export async function actOnRun(params: {
  runId: string;
  action: RunAction;
  lockVersion: number;
  comment?: string;
  /** The document's route, so its page revalidates too. */
  subjectPath?: string;
}): Promise<Result> {
  if (!(await can("approvals", "approve"))) return fail("Forbidden");
  try {
    await svcAct({
      runId: params.runId,
      action: params.action,
      lockVersion: params.lockVersion,
      comment: params.comment,
    });
    revalidateApprovals(params.subjectPath);
    return okay();
  } catch (e) {
    return fail(explain(e, "Could not record the decision"));
  }
}

/**
 * Break-glass cancel.
 *
 * Gated on `approvals:edit` rather than `approve` — cancelling is not a decision
 * on the request, it is an intervention in the process, and the person who may
 * build a flow is the person who may abandon a run stuck in one. The database
 * additionally requires super-admin or the requester, and demands a reason.
 */
export async function cancelApproval(
  runId: string,
  reason: string,
  subjectPath?: string,
): Promise<Result> {
  if (!(await can("approvals", "edit"))) return fail("Forbidden");
  if (!reason.trim()) return fail("Say why this is being cancelled");
  try {
    await svcCancel(runId, reason);
    revalidateApprovals(subjectPath);
    return okay();
  } catch (e) {
    return fail(explain(e, "Could not cancel the approval"));
  }
}

// ─── Flows (the admin builder) ──────────────────────────────────────────────

/**
 * Create or update a flow definition.
 *
 * GATE 5 in the skill's integration guide: "the builder writes config that
 * changes who can approve." So this is gated twice over — `can()` here, and
 * `approval_flows`' own RLS write policy on `approvals.flow.manage`. The second
 * is the real one; without it a PostgREST call would bypass this file entirely.
 *
 * A malformed `steps` array is rejected by `approval_validate_steps` (0501) as a
 * raised exception rather than a saved row, so a step naming no approver cannot
 * reach a run. That surfaces here as a plain error message — read it, it names
 * the step and the reason.
 *
 * NOTE WHAT IS NOT CHECKED: whether the roles a step names have any holders. The
 * builder shows that as a warning (it is the highest-value thing on that screen)
 * but does not block, because a flow may legitimately be built the day before
 * the role is assigned. `approval_start_run` refuses at run time, and
 * `approval_stranded_runs` catches anything that slips past.
 */
export async function saveApprovalFlow(draft: ApprovalFlowDraft): Promise<Result> {
  if (!(await can("approvals", "edit"))) return fail("Forbidden");
  try {
    const flow = await svcSaveFlow(draft);
    revalidatePath("/approvals/flows");
    return okay(flow.id);
  } catch (e) {
    return fail(explain(e, "Could not save the flow"));
  }
}

/**
 * Switch a flow on or off.
 *
 * Deactivating is the safe way to retire one: runs already in flight carry a
 * FROZEN `steps_snapshot` and finish under the rules they started with, so
 * turning a flow off never strands work. Deleting would — `approval_runs.flow_id`
 * is `ON DELETE RESTRICT`, so the database refuses, which is the same lesson
 * stated as a constraint.
 */
export async function setApprovalFlowActive(
  flowId: string,
  isActive: boolean,
): Promise<Result> {
  if (!(await can("approvals", "edit"))) return fail("Forbidden");
  try {
    await svcSetFlowActive(flowId, isActive);
    revalidatePath("/approvals/flows");
    return okay();
  } catch (e) {
    return fail(explain(e, "Could not change the flow"));
  }
}

// ─── Reading a subject's approval, for a screen that shows one ──────────────

/**
 * Everything a document's detail pane needs to show its approval, in one call.
 *
 * ## WHY A SERVER ACTION FOR A READ
 *
 * `service.ts` is `server-only`, so a client component cannot import it — and
 * this panel opens on a click, against a budget the page did not know would be
 * opened. The alternatives were both worse: fetching the run for EVERY budget
 * on the page is N queries for one that gets read, and reaching for the browser
 * Supabase client would make this the only screen in the app fetching
 * client-side and would put the read outside the session the rest of the app
 * uses.
 *
 * ## `canAct` IS ASKED OF THE DATABASE, NEVER DERIVED HERE
 *
 * The verdict comes from `approval_can_act` — the SAME predicate that built the
 * inbox queue. That identity is the thing to protect: derive it locally from a
 * role check and the queue and the gate drift apart, which shows up as a request
 * appearing in someone's list and then refusing them when they open it.
 *
 * ## NAMES ARE RESOLVED HERE, NOT STORED ON THE EVENTS
 *
 * `approval_run_events` holds actor ids and nothing else, which is right — a
 * name copied onto an audit row goes stale. `creator_names()` is SECURITY
 * DEFINER and is the only way to resolve them: `profiles_read_own` lets a user
 * read only their OWN profile row, so a join or an embed would return null for
 * every decision made by anybody else.
 */
export async function getApprovalPanel(
  subjectTable: string,
  subjectId: string,
): Promise<{
  run: import("./types").ApprovalRun | null;
  verdict: import("./types").CanActVerdict | null;
  timeline: import("./types").TimelineRow[];
  names: Record<string, string>;
}> {
  const empty = { run: null, verdict: null, timeline: [], names: {} };
  try {
    const run = await getRunForSubject(subjectTable, subjectId);
    if (!run) return empty;

    const [verdict, timeline] = await Promise.all([
      canAct(run.id),
      getTimeline(run.id),
    ]);

    const ids = Array.from(
      new Set(timeline.map((t) => t.actor_id).filter((v): v is string => !!v)),
    );
    const names: Record<string, string> = {};
    if (ids.length > 0) {
      const s = await createClient();
      const { data } = await s.rpc("creator_names", { ids });
      for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
        if (p.full_name) names[p.id] = p.full_name;
      }
    }

    return { run, verdict, timeline, names };
  } catch {
    /* A PANEL THAT CANNOT LOAD SHOWS NOTHING RATHER THAN BREAKING THE DOCUMENT.
       The figures are why the approver opened this sheet; an engine that is not
       installed yet, or a run that has since been deleted, must not take the
       budget down with it. The legacy decision block stays visible in that case,
       which is the correct fallback. */
    return empty;
  }
}
