"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { resolveWriteLocation } from "@/lib/auth/location";
import { writeAudit } from "@/lib/audit";
import { listPackingOrders } from "./service";
import { blockingProblems, lineProblems, orderFactsFor, isBlankLine } from "./lines";
import { packingAdviceInput, type PackingAdviceInput } from "./types";

type Result = { ok: true } | { ok: false; error: string };

const fail = (error: string): Result => ({ ok: false, error });

function rev(): void {
  revalidatePath("/orders/packing-advice");
}

/** Postgres' refusals, in the operator's words. The screen names these first;
 *  this is for the write that raced it or did not come from the screen. */
function dbMessage(e: { code?: string; message: string }): string {
  if (e.code === "23P01") return "Two lines claim the same carton number. Each carton can be on one line only.";
  if (e.code === "23514") return `A line breaks a packing rule: ${e.message}`;
  return e.message;
}

/**
 * Create (`id` null) or update one advice, header and lines together.
 *
 * THE ORDER IS RE-READ HERE, not taken from the screen: the customer must be the
 * order's, the destination one of its countries, and every line's style and
 * colour one the order ships there — the same `lineProblems` the Save button
 * runs, fed from the database.
 */
export async function savePackingAdvice(id: string | null, data: PackingAdviceInput): Promise<Result> {
  if (!(await can("orders", id ? "edit" : "create"))) return fail("Forbidden");

  // Blank rows are dropped BEFORE parsing — the seeded row is not a line.
  const raw = { ...data, lines: (data.lines ?? []).filter((l) => !isBlankLine(l)) };
  const p = packingAdviceInput.safeParse(raw);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const input = p.data;

  const [order] = await listPackingOrders(input.sales_order_id);
  if (!order) return fail("That RE No could not be found.");
  if (order.customer_id && order.customer_id !== input.customer_id)
    return fail("The customer is not this order's customer. Pick the RE No again.");
  if (!order.destinations.some((d) => d.country_id === input.country_id))
    return fail("That destination is not on this order's Quantities tab.");

  const s = await createClient();

  // A draft / cancelled / closed order cannot START an advice, but an advice
  // already made against it stays editable (Disabled rows).
  if (order.inactive) {
    const held = id
      ? (await s.from("packing_advices").select("sales_order_id").eq("id", id).maybeSingle()).data
      : null;
    if (held?.sales_order_id !== input.sales_order_id)
      return fail("That order is a draft, cancelled or closed — it cannot be packed.");
  }

  // Advisories (a skipped carton number) are the screen's to say, never a refusal.
  const problems = blockingProblems(lineProblems(input.lines, orderFactsFor(order, input.country_id)));
  if (problems.length) return fail(problems[0].message);

  const header = {
    status: input.status,
    advice_date: input.advice_date,
    customer_id: input.customer_id,
    sales_order_id: input.sales_order_id,
    country_id: input.country_id,
    remarks: input.remarks || null,
  };

  let adviceId = id;
  if (!adviceId) {
    // The unit comes from the session, never the form.
    const loc = await resolveWriteLocation();
    if (!loc.ok) return fail(loc.error);
    const { data: created, error } = await s
      .from("packing_advices")
      .insert({ ...header, location_id: loc.locationId })
      .select("id")
      .single();
    if (error || !created) return fail(error ? dbMessage(error) : "Failed to create packing advice");
    adviceId = created.id as string;
  } else {
    const { error } = await s.from("packing_advices").update(header).eq("id", adviceId);
    if (error) return fail(dbMessage(error));
  }

  // Lines replaced wholesale. Nothing references a line's id, so a reinsert
  // orphans nothing.
  const { error: delErr } = await s.from("packing_advice_lines").delete().eq("advice_id", adviceId);
  if (delErr) return fail(dbMessage(delErr));

  const { error: insErr } = await s.from("packing_advice_lines").insert(
    input.lines.map((l, i) => ({ ...l, advice_id: adviceId, sort_order: i + 1 })),
  );
  if (insErr) {
    // A new advice with no lines is not an advice — take the header back out.
    if (!id) await s.from("packing_advices").delete().eq("id", adviceId);
    return fail(dbMessage(insErr));
  }

  await writeAudit({
    action: id ? "packing_advice.updated" : "packing_advice.created",
    entityType: "packing_advice",
    entityId: adviceId,
  });
  rev();
  return { ok: true };
}

export async function deletePackingAdvice(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("packing_advices").delete().eq("id", id); // lines cascade
  if (error) return fail(error.message);
  await writeAudit({ action: "packing_advice.deleted", entityType: "packing_advice", entityId: id });
  rev();
  return { ok: true };
}
