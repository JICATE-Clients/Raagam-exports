import "server-only";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isOverrideKey, reasonProblem } from "./override-modules";

/**
 * ONE SAVE UNDER A PERMISSION OVERRIDE (0651 · 0653) — the wrapper every save
 * action in the four modules puts around its ordinary body.
 *
 *   1. open an override commit (`override_commit_open`): the reason (R-16), the
 *      keys still live, the RE approved and not amending / not with the MD, and
 *      no one else's commit open on it (C-5);
 *   2. run the save EXACTLY as it runs without an override — its own guard
 *      (`assertOrderWritable`) now finds the open commit and passes, and the
 *      lock trigger lets each row through and logs it in the same statement;
 *   3. close the commit — `committed` if the save said ok, `failed` if not or if
 *      it threw — which turns the raw row log into field-level audit rows.
 *
 * NOT ONE TRANSACTION, and it cannot be: no save in this app is (findings C-5).
 * What holds instead: every row that DID land is in the audit (R-7), a save
 * that stops halfway closes `failed` with its partial writes still audited,
 * and a commit left open by a crash stops letting anything through after
 * `override_commit_ttl()` and is closed `expired` by the next open on the RE.
 */

export type OverrideSave = {
  /** Mandatory (R-16) — at least `OVERRIDE_MIN_REASON` characters. */
  reason: string;
  /** The keys this save uses; each must be live for the caller. */
  keys: string[];
};

export type OverrideOutcome = {
  commitId: string;
  /** Field-level audit rows the close derived. */
  fields: number;
  status: "committed" | "failed";
};

type Failure = { ok: false; error: string };

/** Best-effort client address for the audit row (spec §3.2 client_ip). */
async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    return (fwd ? fwd.split(",")[0] : h.get("x-real-ip"))?.trim() || null;
  } catch {
    return null;
  }
}

export async function saveUnderOverride<R extends { ok: boolean }>(
  orderId: string,
  input: OverrideSave,
  save: () => Promise<R>,
  opts: { directionBreach?: boolean } = {},
): Promise<(R & { override?: OverrideOutcome }) | Failure> {
  const reasonErr = reasonProblem(input.reason);
  if (reasonErr) return { ok: false, error: reasonErr };
  const keys = [...new Set(input.keys.filter(isOverrideKey))];
  if (keys.length === 0) return { ok: false, error: "Name the modules this save changes." };

  const s = await createClient();
  const { data: commitId, error: openErr } = await s.rpc("override_commit_open", {
    p_order: orderId,
    p_keys: keys,
    p_reason: input.reason.trim(),
    p_client_ip: await clientIp(),
  });
  if (openErr || typeof commitId !== "string") {
    return { ok: false, error: openErr?.message ?? "Could not start the override edit." };
  }

  const close = async (status: "committed" | "failed"): Promise<OverrideOutcome> => {
    const { data } = await s.rpc("override_commit_close", {
      p_commit: commitId,
      p_status: status,
      p_direction_breach: opts.directionBreach ?? false,
    });
    const fields = typeof (data as { fields?: unknown } | null)?.fields === "number"
      ? (data as { fields: number }).fields
      : 0;
    return { commitId, fields, status };
  };

  let result: R;
  try {
    result = await save();
  } catch (e) {
    await close("failed");
    throw e;
  }
  const outcome = await close(result.ok ? "committed" : "failed");
  return { ...result, override: outcome };
}

/**
 * The budget's question: does the caller hold an open `order_budget` commit
 * over this APPROVED budget? `budget_override_commit()` — the function the
 * budget lock trigger reads. A failed read is "no".
 */
export async function budgetOverrideCommitOf(budgetId: string): Promise<string | null> {
  const s = await createClient();
  const { data, error } = await s.rpc("budget_override_commit", { p_budget: budgetId });
  if (error || typeof data !== "string") return null;
  return data;
}
