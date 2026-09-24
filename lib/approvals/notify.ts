import "server-only";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import type { NotificationInput } from "@/lib/notifications/types";
import { kpiNotificationBody, kpisFromJson } from "@/lib/orders/budget/amendment";
import { WORKFLOWS, workflowLabel, type WorkflowKey } from "./workflows";
import type { ApprovalRun } from "./types";

/**
 * TELL THE PEOPLE WHOSE TURN IT IS (Phase 5, doc/order/budget.md §4.2).
 *
 * Until this existed the engine sent nothing: a submitted document sat in the
 * inbox of whoever happened to open /approvals. Now every time a step becomes
 * active — a run starting, an approval advancing it, a return sending it back
 * — that step's approvers get an in-app notification and a web push
 * (`notify()`; push is skipped until VAPID keys are set).
 *
 * ## THE APPROVERS ARE THE ENGINE'S ANSWER, NEVER RE-DERIVED HERE
 *
 * `approval_step_approvers` is the same resolver `approval_can_act` and the
 * inbox read (0501; granted to `authenticated` by 0546). Resolving the role
 * here in TypeScript would be a second answer to "who may approve this", and
 * the day the two disagree somebody is paged for a request that then refuses
 * them. Self-approval is filtered inside the function, so the requester is
 * never told to approve their own document.
 *
 * ## IT NEVER FAILS THE APPROVAL
 *
 * The decision is already committed when this runs. Every failure — a run
 * that cannot be read, a resolver error, a push service down — is swallowed:
 * a missed notification is recoverable from the inbox, a decision reported as
 * failed after it committed is not.
 *
 * ## GENERIC, WITH ONE WORKFLOW THAT SAYS MORE
 *
 * Any workflow gets "<label> needs your approval" pointing at its screen.
 * `order_budget` adds the budget's code and the §4.2 KPI summary the MD
 * approves against, read from the run's frozen `context.kpis` — the figures
 * as they were submitted, not as the budget reads now.
 */

export type NotifyReason = "started" | "advanced" | "returned";

export async function notifyCurrentApprovers(
  runId: string,
  opts?: { reason?: NotifyReason; payload?: NotificationInput },
): Promise<void> {
  try {
    const s = await createClient();
    const { data: runRow, error } = await s
      .from("approval_runs")
      .select("id, workflow_key, subject_id, steps_snapshot, context, scope, current_step, status, requested_by")
      .eq("id", runId)
      .maybeSingle();
    if (error || !runRow) return;
    const run = runRow as Pick<
      ApprovalRun,
      | "id"
      | "workflow_key"
      | "subject_id"
      | "steps_snapshot"
      | "context"
      | "scope"
      | "current_step"
      | "status"
      | "requested_by"
    >;
    if (run.status !== "in_progress") return;

    // `current_step` is 1-based; the snapshot is a plain array.
    const step = Array.isArray(run.steps_snapshot)
      ? run.steps_snapshot[run.current_step - 1]
      : undefined;
    if (!step) return;

    const { data: users, error: uErr } = await s.rpc("approval_step_approvers", {
      p_step: step,
      p_requester: run.requested_by,
      p_scope: run.scope ?? {},
      p_context: run.context ?? {},
    });
    if (uErr) return;
    /* RETURNS SETOF uuid — PostgREST hands back bare strings, but a wrapped
       `{ approval_step_approvers }` row is normalised too rather than trusted. */
    const userIds = ((users ?? []) as unknown[])
      .map((u) =>
        typeof u === "string"
          ? u
          : ((u as Record<string, unknown> | null)?.approval_step_approvers as string | undefined),
      )
      .filter((u): u is string => !!u);
    if (userIds.length === 0) return;

    const payload = opts?.payload ?? (await noticeFor(s, run, opts?.reason ?? "started"));
    await notify({ userIds }, payload);
  } catch {
    // Never fail the approval action over a notification — see the header.
  }
}

async function noticeFor(
  s: Awaited<ReturnType<typeof createClient>>,
  run: Pick<ApprovalRun, "workflow_key" | "subject_id" | "context">,
  reason: NotifyReason,
): Promise<NotificationInput> {
  const decl = WORKFLOWS[run.workflow_key as WorkflowKey];
  const href = decl?.href.replace(":id", run.subject_id) ?? "/approvals";
  const sentBack = reason === "returned";

  if (run.workflow_key === "order_budget") {
    const { data } = await s
      .from("order_budgets")
      .select("code")
      .eq("id", run.subject_id)
      .maybeSingle();
    const code = ((data as { code: string | null } | null)?.code ?? "").trim();
    const name = code ? `Budget ${code}` : "A budget";
    const ctx = run.context as Record<string, unknown> | null;
    const kpis = kpisFromJson(ctx?.kpis);
    /* AN AMENDMENT SAYS SO (doc/order/amedment.md §5): the MD's push names the
       entry, the order, who asked, and the margin it moves — the spec's payload
       in a sentence. The KPI lines follow as they do for any budget. Read off
       the run's frozen context, never recomputed. */
    const am = amendmentOf(ctx?.amendment);
    if (am) {
      const pct = (v: number | null) => (v == null ? "unknown" : `${v.toFixed(2)}%`);
      const delta = am.margin_delta_pct == null ? "" : ` (${am.margin_delta_pct > 0 ? "+" : ""}${am.margin_delta_pct.toFixed(2)}%)`;
      const who = am.origin === "BY_CUSTOMER" ? "by the customer" : "by us";
      return {
        title: `Revision ${am.entry_no ?? ""} on ${am.order_ref ?? "an order"} needs your approval${am.margin_delta_pct != null && am.margin_delta_pct < 0 ? " — margin down" : ""}`.replace("  ", " "),
        body: [
          `${am.types_label} ${who}${am.customer_name ? ` · ${am.customer_name}` : ""}`,
          `Margin ${pct(am.original_margin_pct)} → ${pct(am.amended_margin_pct)}${delta}`,
          am.remarks ? `"${am.remarks}"` : null,
          kpis ? kpiNotificationBody(kpis) : null,
        ]
          .filter((l): l is string => !!l)
          .join("\n"),
        href,
        type: am.margin_delta_pct != null && am.margin_delta_pct < 0 ? "warning" : "info",
      };
    }
    return {
      title: sentBack ? `${name} was sent back for your approval` : `${name} needs your approval`,
      body: kpis ? kpiNotificationBody(kpis) : undefined,
      href,
      type: "info",
    };
  }

  const label = workflowLabel(run.workflow_key);
  return {
    title: sentBack ? `${label} was sent back for your approval` : `${label} needs your approval`,
    href,
    type: "info",
  };
}

/**
 * TELL THE REQUESTER WHAT WAS DECIDED (client 2026-09-24: "upon MD
 * approval/rework, dispatch push/in-app alert exclusively to the assigned
 * Merchandiser").
 *
 * Until this, a decision told only the NEXT step's approvers — so a final
 * approve, a reject, or a return on a one-step flow (which re-queues the run
 * at step 1, 0502) told the merchandiser nothing, and they learned the
 * revision's fate by opening the register. The requester is `requested_by`,
 * the person who pressed Send to MD — the merchandiser, and only them.
 *
 * Only a decision that CHANGES what the requester must do is sent: a final
 * approval, a rejection, a return for rework. An approve that merely advances
 * the run to a second step is still with approvers, and is theirs to be told.
 * Never throws — same contract as `notifyCurrentApprovers`.
 */
export async function notifyRequesterOfDecision(
  runId: string,
  v: { action: "approve" | "reject" | "return"; comment?: string },
): Promise<void> {
  try {
    const s = await createClient();
    const { data, error } = await s
      .from("approval_runs")
      .select("workflow_key, subject_id, context, status, requested_by")
      .eq("id", runId)
      .maybeSingle();
    if (error || !data) return;
    const run = data as Pick<ApprovalRun, "workflow_key" | "subject_id" | "context" | "status" | "requested_by">;
    if (!run.requested_by) return;
    if (v.action === "approve" && run.status !== "completed") return;

    const ctx = run.context as Record<string, unknown> | null;
    const am = run.workflow_key === "order_budget" ? amendmentOf(ctx?.amendment) : null;
    let what = workflowLabel(run.workflow_key);
    if (am) what = `Revision ${am.entry_no ?? ""} on ${am.order_ref ?? "the order"}`.replace("  ", " ");
    else if (run.workflow_key === "order_budget") {
      const { data: b } = await s.from("order_budgets").select("code").eq("id", run.subject_id).maybeSingle();
      const code = ((b as { code: string | null } | null)?.code ?? "").trim();
      what = code ? `Budget ${code}` : "Your budget";
    }
    const decl = WORKFLOWS[run.workflow_key as WorkflowKey];
    const href = decl?.href.replace(":id", run.subject_id) ?? "/approvals";
    const note = v.comment?.trim() ? `"${v.comment.trim()}"` : undefined;

    const payload: NotificationInput =
      v.action === "approve"
        ? { title: `${what} was approved`, body: note, href, type: "success" }
        : v.action === "return"
          ? { title: `${what} was returned for rework`, body: note, href, type: "warning" }
          : {
              title: `${what} was not approved`,
              body: [note, am ? "The order and its BOMs are back at the last approved version." : null]
                .filter((l): l is string => !!l)
                .join("\n") || undefined,
              href,
              type: "danger",
            };
    await notify({ userIds: [run.requested_by] }, payload);
  } catch {
    // Never fail the decision over a notification.
  }
}

/** The amendment block `submitBudget` puts on the run's context — read back
 *  field by field, so a context written by an older build reads as "none". */
function amendmentOf(v: unknown): {
  entry_no: string | null;
  order_ref: string | null;
  customer_name: string | null;
  origin: string;
  types_label: string;
  remarks: string | null;
  original_margin_pct: number | null;
  amended_margin_pct: number | null;
  margin_delta_pct: number | null;
} | null {
  if (typeof v !== "object" || v === null) return null;
  const a = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x : null);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    entry_no: str(a.entry_no),
    order_ref: str(a.order_ref),
    customer_name: str(a.customer_name),
    origin: str(a.origin) ?? "BY_US",
    types_label: str(a.types_label) ?? "a revision",
    remarks: str(a.remarks),
    original_margin_pct: num(a.original_margin_pct),
    amended_margin_pct: num(a.amended_margin_pct),
    margin_delta_pct: num(a.margin_delta_pct),
  };
}
