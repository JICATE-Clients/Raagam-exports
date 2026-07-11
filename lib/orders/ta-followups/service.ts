import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TaFollowupRow, TaFollowupStatus } from "./types";

type RawRow = {
  id: string;
  sno: number;
  details: string | null;
  end_date: string | null;
  actual_date: string | null;
  status: TaFollowupStatus;
  description: string | null;
  notes: string | null;
  ta_activities: { name: string | null; department: string | null } | null;
  ta_plan_docs: {
    order_no: string | null;
    delivery_date: string | null;
    order_qty: number | null;
    proposed_delivery_date: string | null;
    sales_order_id: string | null;
    customer: { name: string | null } | null;
    styles: { code: string | null; style_name: string | null } | null;
  } | null;
};

/** All TA-plan activities as followup rows, with order/style context + SQ No. */
export async function listTaFollowups(): Promise<TaFollowupRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("ta_plan_activities")
    .select(
      "id, sno, details, end_date, actual_date, status, description, notes, " +
        "ta_activities(name, department), " +
        "ta_plan_docs(order_no, delivery_date, order_qty, proposed_delivery_date, sales_order_id, " +
        "customer:buyers(name), styles:garment_styles(code, style_name))",
    )
    .order("plan_id")
    .order("sno");

  const rows = (data ?? []) as unknown as RawRow[];

  // First SQ No per sales order (best-effort — one order can have several).
  const orderIds = Array.from(
    new Set(
      rows
        .map((r) => r.ta_plan_docs?.sales_order_id)
        .filter((x): x is string => !!x),
    ),
  );
  const sqByOrder = new Map<string, string>();
  if (orderIds.length) {
    const { data: sqs } = await supabase
      .from("sq_notes")
      .select("code, sales_order_id, created_at")
      .in("sales_order_id", orderIds)
      .order("created_at", { ascending: true });
    for (const s of (sqs ?? []) as { code: string | null; sales_order_id: string | null }[]) {
      if (s.sales_order_id && s.code && !sqByOrder.has(s.sales_order_id)) {
        sqByOrder.set(s.sales_order_id, s.code);
      }
    }
  }

  return rows.map((r) => {
    const doc = r.ta_plan_docs;
    return {
      id: r.id,
      sno: r.sno,
      order_no: doc?.order_no ?? null,
      delivery_date: doc?.delivery_date ?? null,
      proposed_delivery_date: doc?.proposed_delivery_date ?? null,
      order_qty: doc?.order_qty ?? null,
      customer: doc?.customer?.name ?? null,
      style_code: doc?.styles?.code ?? doc?.styles?.style_name ?? null,
      sq_no: doc?.sales_order_id ? sqByOrder.get(doc.sales_order_id) ?? null : null,
      activity_name: r.ta_activities?.name ?? null,
      department: r.ta_activities?.department ?? null,
      details: r.details,
      plan_date: r.end_date,
      actual_date: r.actual_date,
      status: r.status,
      description: r.description,
      notes: r.notes,
    };
  });
}
