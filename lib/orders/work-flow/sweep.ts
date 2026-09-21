import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { addDays, daysBetween, today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import {
  WORK_FLOW_ESCALATE_AFTER_DAYS,
  WORK_FLOW_MILESTONES,
  workFlowDef,
} from "./types";

/**
 * The Work Flow alert sweep (0607) — run by `/api/cron/work-flow`.
 *
 * Two alerts per late milestone, each sent ONCE:
 *   1. overdue (target < today, not done) → the row's owner;
 *   2. still open WORK_FLOW_ESCALATE_AFTER_DAYS calendar days past target →
 *      holders of the "Managing Director" role (the spec's 48 hours).
 * Budget Approval is never swept (`alerts: false` — the approval engine's SLA
 * already chases that step, and nagging approvers is what the user ruled out).
 *
 * ## CLAIM, THEN SEND
 *
 * Each batch is claimed by an UPDATE … WHERE `<flag> IS NULL` RETURNING, and
 * only the rows that UPDATE returned are notified — so two overlapping ticks
 * cannot both send. A moved target (Days edited, Received Date changed) clears
 * both flags in 0607's BEFORE trigger, so a re-dated row can alert again.
 *
 * ## THE WEAK LINK IS WHO AN EMPLOYEE IS
 *
 * Owners are `employees`; notifications go to logins (`profiles`). The only
 * bridge is `profiles.employee_code = employees.code` — 0 of 2 logins were
 * linked on 2026-09-21. So an owner with no login falls back to the order's
 * merchandiser's login, and anything that still reaches nobody is COUNTED as
 * `unrouted` in the result rather than silently dropped: a sweep reporting
 * "0 sent" over 12 unroutable rows is the empty-report failure AGENTS.md names.
 */

export type WorkFlowSweepResult = {
  overdue: number;
  escalated: number;
  /** Overdue rows whose owner (and merchandiser) have no linked login. */
  unrouted: number;
  error?: string;
};

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

const ALERTING = WORK_FLOW_MILESTONES.filter((m) => m.alerts).map((m) => m.code);

export async function sweepWorkFlow(): Promise<WorkFlowSweepResult> {
  const out: WorkFlowSweepResult = { overdue: 0, escalated: 0, unrouted: 0 };
  try {
    const admin = createAdminClient();
    const now = today();

    // ---- 1. Overdue → owner -------------------------------------------------
    const { data: claimed, error: claimErr } = await admin
      .from("order_work_flow_milestones")
      .update({ overdue_notified_at: new Date().toISOString() })
      .neq("status", "done")
      .lt("target_date", now)
      .is("overdue_notified_at", null)
      .in("code", ALERTING)
      .select(
        "id, code, target_date, sales_order_id, " +
          "owner:employees!owner_id(code), so:sales_orders!sales_order_id(order_number)",
      );
    if (claimErr) return { ...out, error: claimErr.message };
    const overdue = (claimed ?? []) as unknown as Row[];

    if (overdue.length) {
      // The RE's original document's merchandiser — the fallback recipient.
      const soIds = [...new Set(overdue.map((r) => String(r.sales_order_id)))];
      const { data: docs, error: docErr } = await admin
        .from("garment_order_amendments")
        .select("sales_order_id, created_at, merch:employees!merchandiser_id(code)")
        .in("sales_order_id", soIds)
        .order("created_at", { ascending: true });
      if (docErr) return { ...out, error: docErr.message };
      const merchCodeBySo = new Map<string, string | null>();
      for (const d of (docs ?? []) as unknown as Row[]) {
        const so = String(d.sales_order_id);
        if (!merchCodeBySo.has(so)) merchCodeBySo.set(so, str((d.merch as Row | null)?.code));
      }

      const codes = new Set<string>();
      for (const r of overdue) {
        const c = str((r.owner as Row | null)?.code);
        if (c) codes.add(c);
      }
      for (const c of merchCodeBySo.values()) if (c) codes.add(c);
      const profileByCode = new Map<string, string>();
      if (codes.size) {
        const { data: profs, error: pErr } = await admin
          .from("profiles")
          .select("id, employee_code")
          .in("employee_code", [...codes])
          .eq("is_active", true);
        if (pErr) return { ...out, error: pErr.message };
        for (const p of (profs ?? []) as Row[]) {
          const c = str(p.employee_code);
          if (c) profileByCode.set(c, String(p.id));
        }
      }

      for (const r of overdue) {
        const def = workFlowDef(String(r.code));
        const target = str(r.target_date);
        const re = str((r.so as Row | null)?.order_number) ?? "an order";
        const ownerCode = str((r.owner as Row | null)?.code);
        const merchCode = merchCodeBySo.get(String(r.sales_order_id)) ?? null;
        const userId =
          (ownerCode && profileByCode.get(ownerCode)) || (merchCode && profileByCode.get(merchCode)) || null;
        if (!userId) {
          out.unrouted++;
          continue;
        }
        const late = target ? daysBetween(target, now) : 0;
        await notify(
          { userId },
          {
            title: `Action required: ${def?.label ?? r.code} overdue for ${re}`,
            body: `Target was ${fmtDate(target)} — ${late} day${late === 1 ? "" : "s"} late. ${def?.doneWhen ?? ""}`.trim(),
            href: def?.href,
            type: "danger",
          },
        );
        out.overdue++;
      }
    }

    // ---- 2. Escalation → Managing Director ----------------------------------
    // "N days late" = target <= today - N (calendar days, as the constant says).
    const escalateOnOrBefore = addDays(now, -WORK_FLOW_ESCALATE_AFTER_DAYS);
    const { data: esc, error: escErr } = await admin
      .from("order_work_flow_milestones")
      .update({ escalated_at: new Date().toISOString() })
      .neq("status", "done")
      .lte("target_date", escalateOnOrBefore)
      .is("escalated_at", null)
      .in("code", ALERTING)
      .select("id, code, target_date, so:sales_orders!sales_order_id(order_number)");
    if (escErr) return { ...out, error: escErr.message };
    const escalated = (esc ?? []) as unknown as Row[];
    if (escalated.length) {
      const lines = escalated
        .map((r) => {
          const def = workFlowDef(String(r.code));
          const re = str((r.so as Row | null)?.order_number) ?? "?";
          return `${re} · ${def?.label ?? r.code} (due ${fmtDate(str(r.target_date))})`;
        })
        .slice(0, 8);
      const more = escalated.length > lines.length ? ` +${escalated.length - lines.length} more` : "";
      await notify(
        { role: "Managing Director" },
        {
          title: `${escalated.length} pre-production milestone${escalated.length === 1 ? "" : "s"} over ${WORK_FLOW_ESCALATE_AFTER_DAYS} days late`,
          body: lines.join("; ") + more,
          href: "/",
          type: "danger",
        },
      );
      out.escalated = escalated.length;
    }
    return out;
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : String(e) };
  }
}
