import "server-only";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { botAlertInput, type BotAlertInput } from "./types";

/**
 * The system bot for an order's RE-Community channel (doc/file.md §4):
 *
 *     "the moment CAD weights are submitted, an automated notification is pushed
 *      to the stream, alerting the Merchandiser that the Fabric BOM is ready for
 *      approval."
 *
 * ## THIS FILE IS NOT `"use server"`, ON PURPOSE
 *
 * It is meant to be CALLED BY other server actions — the CAD submit action, the
 * Fabric BOM approve action — and a `"use server"` module may only export async
 * functions, which would make every one of these an HTTP-callable endpoint that
 * anyone could POST a forged alert to. `actions.ts` beside this file is the
 * "use server" boundary; this is a library.
 *
 * ## TWO SEPARATE FAN-OUTS, AND NEITHER IS A NEW NOTIFICATION SYSTEM
 *
 *  1. The MESSAGE goes into the stream, via `post_order_channel_bot_message()`
 *     — SECURITY DEFINER, and the only door a `kind = 'bot'` row comes through.
 *     The RLS insert policy refuses one from a session (0458 §8), so a person
 *     cannot type an alert the cutting room will read as automatic.
 *  2. The NOTIFICATION goes to each member through `lib/notifications/notify.ts`,
 *     which already pairs an in-app `notifications` row (live over Realtime)
 *     with web push. Inserting notification rows inside the SQL function would
 *     have been shorter and would have produced in-app rows with NO push — a
 *     second, quieter notification system beside the working one.
 *
 * ## IT NEVER THROWS
 *
 * Same call `writeAudit` and `notify` both make. A bot alert is a side effect of
 * real work — CAD weights were saved, a BOM was approved — and an alert that
 * fails must not roll back the work that earned it. It returns what happened so
 * a caller that cares can say so; most callers will not.
 */

export type BotAlertResult =
  | { ok: true; messageId: string; notified: number }
  /** Carries the sentence a screen could print. Never thrown, never swallowed. */
  | { ok: false; refused: string };

type BotRow = { message_id: string; channel_id: string; recipient_id: string };

export async function postBotAlert(input: BotAlertInput): Promise<BotAlertResult> {
  const parsed = botAlertInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, refused: "The alert was not in a shape the stream accepts." };
  }
  const { sales_order_id, event_key, body, href, title } = parsed.data;

  try {
    const s = await createClient();
    const { data, error } = await s.rpc("post_order_channel_bot_message", {
      p_sales_order_id: sales_order_id,
      p_event_key: event_key,
      p_body: body,
      p_href: href,
    });

    if (error) return { ok: false, refused: "The alert could not be posted to the channel." };

    const rows = (data ?? []) as BotRow[];
    // The function returns nothing when the order has no channel it could make —
    // i.e. no such order. Reporting that plainly beats claiming success on an
    // alert that reached nobody.
    if (rows.length === 0) {
      return { ok: false, refused: "This order has no community channel to post into." };
    }

    const recipients = Array.from(new Set(rows.map((r) => r.recipient_id))).filter(Boolean);

    await notify(
      { userIds: recipients },
      {
        title: title ?? "Order update",
        body,
        // Defaults to the channel itself, so the notification lands on the
        // conversation the alert is part of rather than on a screen the reader
        // then has to navigate away from to see what was said.
        href: href ?? `/orders/${sales_order_id}/community`,
        type: "info",
      },
    );

    return { ok: true, messageId: rows[0].message_id, notified: recipients.length };
  } catch {
    return { ok: false, refused: "The alert could not be posted to the channel." };
  }
}

/**
 * §4's worked example, as one call the CAD lane can make without knowing any of
 * the above. Kept here rather than in the CAD module so the WORDING of a
 * system alert lives with the stream that prints it — the same reason
 * `created-columns.tsx` owns the Created User wording for 74 services.
 */
export async function alertCadWeightsSubmitted(
  salesOrderId: string,
  reNumber: string | null,
): Promise<BotAlertResult> {
  return postBotAlert({
    sales_order_id: salesOrderId,
    event_key: "cad_weights_submitted",
    body: "CAD marker and component gram weights have been submitted. The Fabric BOM is ready for approval.",
    href: `/orders/${salesOrderId}/fabric-bom`,
    title: reNumber ? `${reNumber} · Fabric BOM ready` : "Fabric BOM ready",
  });
}
