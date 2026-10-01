import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { today } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { loadOrderProgress, type ProgressRow } from "./service";
import { isAlertLevel, type AlertLevel } from "./engine";

/**
 * The delivery-risk alert sweep (doc/order/digitalisation-plan.md §1) — run
 * daily by `/api/cron/order-risk`.
 *
 * It judges every order with the SAME loader and rule as the tracker screen
 * (`loadOrderProgress` → `orderRisk`), through the service-role client.
 *
 * ## ONE ALERT PER SLIP, NOT ONE PER DAY
 *
 * `order_risk_alerts` (0666) remembers the level each RE was alerted at:
 *   - entering at_risk or late → alert, row written;
 *   - at_risk → late is worse → alert again, row updated;
 *   - the same level tomorrow → nothing;
 *   - back on track / shipped / closed → row deleted, so a later slip alerts.
 *
 * Claim, then send — the Work Flow sweep's pattern: the insert / update that
 * claims a row is conditional, and only a claim that RETURNED a row is
 * notified, so two overlapping ticks cannot both send.
 *
 * Who is told: the order document's merchandiser (a `staff` id since 0674, resolved to a
 * login by `notify`'s `employeeIds`) and the Managing Director role. Anything
 * that reaches nobody falls back to admins inside `notify` itself.
 */

export type OrderRiskSweepResult = {
  checked: number;
  alerted: number;
  cleared: number;
  error?: string;
};

const RANK: Record<AlertLevel, number> = { at_risk: 1, late: 2 };

function message(row: ProgressRow): { title: string; body: string } {
  const re = row.orderNumber ?? "An order";
  const r = row.progress.risk;
  const who = row.customer ? ` (${row.customer})` : "";
  if (r.level === "late") {
    return {
      title: `${re} is past its delivery date`,
      body: `${re}${who} was due on ${fmtDate(row.deliveryDate)} and has not shipped — ${r.daysLate} day${r.daysLate === 1 ? "" : "s"} late.`,
    };
  }
  return {
    title: `${re} is at risk of missing delivery`,
    body: `${r.cause ?? "A stage is late"}${who}. Delivery ${fmtDate(row.deliveryDate)} may slip to ${fmtDate(r.projected)}.`,
  };
}

export async function sweepOrderRisk(): Promise<OrderRiskSweepResult> {
  const out: OrderRiskSweepResult = { checked: 0, alerted: 0, cleared: 0 };
  try {
    const admin = createAdminClient();
    const rows = await loadOrderProgress(admin, today());
    out.checked = rows.length;

    for (const row of rows) {
      const level = row.progress.risk.level;
      const standing = row.alert;

      if (!isAlertLevel(level)) {
        if (standing) {
          const { error } = await admin.from("order_risk_alerts").delete().eq("sales_order_id", row.salesOrderId);
          if (!error) out.cleared += 1;
        }
        continue;
      }

      const patch = {
        level,
        projected_date: row.progress.risk.projected,
        delivery_date: row.deliveryDate,
        updated_at: new Date().toISOString(),
      };

      let claimed = false;
      if (!standing) {
        // Insert-or-nothing: a row another tick wrote first is not ours to send.
        const { data, error } = await admin
          .from("order_risk_alerts")
          .upsert({ sales_order_id: row.salesOrderId, ...patch, notified_at: new Date().toISOString() }, {
            onConflict: "sales_order_id",
            ignoreDuplicates: true,
          })
          .select("sales_order_id");
        claimed = !error && (data ?? []).length > 0;
      } else if (RANK[level] > RANK[standing.level]) {
        const { data, error } = await admin
          .from("order_risk_alerts")
          .update({ ...patch, notified_at: new Date().toISOString() })
          .eq("sales_order_id", row.salesOrderId)
          .eq("level", standing.level)
          .select("sales_order_id");
        claimed = !error && (data ?? []).length > 0;
      } else {
        // Same level (or a better one, after a delivery date moved): keep the
        // row current without telling anyone again.
        await admin.from("order_risk_alerts").update(patch).eq("sales_order_id", row.salesOrderId);
      }

      if (!claimed) continue;
      const { title, body } = message(row);
      const payload = { title, body, href: `/orders/progress?open=${row.salesOrderId}`, type: "danger" as const };
      if (row.merchandiserId) await notify("order.risk", { employeeIds: [row.merchandiserId] }, payload, { source: "cron" });
      // Admins are the fallback only when nobody at all would hear it — the
      // merchandiser's own call already falls back if they have no login.
      await notify("order.risk", { role: "Managing Director" }, payload, {
        fallbackToAdmins: !row.merchandiserId,
        source: "cron",
      });
      out.alerted += 1;
    }
    return out;
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : String(e) };
  }
}
