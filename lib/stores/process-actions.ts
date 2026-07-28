"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  processOrderInput,
  processIssueInput,
  processReceiptInput,
} from "./process-types";
import type {
  ProcessOrderInput,
  ProcessIssueInput,
  ProcessReceiptInput,
} from "./process-types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;

function revalidateProcess(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/stores");
  revalidatePath("/stores/process-orders");
}

// ---------- Process Order CRUD ----------

export async function createProcessOrder(
  data: ProcessOrderInput,
): Promise<{ ok: true; orderId: string } | ErrResult> {
  if (!(await can("stores", "create"))) throw new Error("Forbidden");

  const parsed = processOrderInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { lines, ...orderFields } = parsed.data;

  const { data: order, error } = await supabase
    .from("process_orders")
    .insert({
      ...orderFields,
      status: "draft",
      total_amount: 0,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !order) return { ok: false, error: error?.message ?? "Failed" };

  if (lines.length > 0) {
    const { error: lineErr } = await supabase
      .from("process_order_lines")
      .insert(
        lines.map((l, i) => ({
          ...l,
          process_order_id: order.id,
          amount: l.sent_qty * l.rate,
          received_qty: 0,
          sort_order: l.sort_order ?? i,
        })),
      );
    if (lineErr) return { ok: false, error: lineErr.message };

    // recalc total
    const total = lines.reduce((sum, l) => sum + l.sent_qty * l.rate, 0);
    await supabase
      .from("process_orders")
      .update({ total_amount: total })
      .eq("id", order.id);
  }

  revalidateProcess();
  return { ok: true, orderId: order.id };
}

export async function issueProcessOrder(id: string): Promise<ActionResult> {
  if (!(await can("stores", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("process_orders")
    .update({ status: "issued" })
    .eq("id", id)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "process_order.issued",
    entityType: "process_order",
    entityId: id,
  });

  revalidateProcess(`/stores/process-orders/${id}`);
  return { ok: true };
}

export async function cancelProcessOrder(id: string): Promise<ActionResult> {
  if (!(await can("stores", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { error } = await supabase
    .from("process_orders")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateProcess(`/stores/process-orders/${id}`);
  return { ok: true };
}

// ---------- Material Issue for Processing ----------

export async function createProcessIssue(
  data: ProcessIssueInput,
): Promise<{ ok: true; issueId: string } | ErrResult> {
  if (!(await can("stores", "create"))) throw new Error("Forbidden");

  const parsed = processIssueInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { lines, ...issueFields } = parsed.data;

  const { data: issue, error } = await supabase
    .from("process_material_issues")
    .insert({ ...issueFields, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !issue) return { ok: false, error: error?.message ?? "Failed" };

  if (lines.length > 0) {
    const { error: lineErr } = await supabase
      .from("process_material_issue_lines")
      .insert(lines.map((l, i) => ({ ...l, issue_id: issue.id, sort_order: l.sort_order ?? i })));
    if (lineErr) return { ok: false, error: lineErr.message };
  }

  revalidateProcess(`/stores/process-issues`);
  return { ok: true, issueId: issue.id };
}

export async function postProcessIssue(issueId: string): Promise<ActionResult> {
  if (!(await can("stores", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  // fetch issue + lines
  const { data: issue } = await supabase
    .from("process_material_issues")
    .select("id, status, store_id, process_order_id")
    .eq("id", issueId)
    .maybeSingle();

  const issueRow = issue as { id: string; status: string; store_id: string; process_order_id: string } | null;
  if (!issueRow || issueRow.status !== "draft")
    return { ok: false, error: "Issue is not in draft status" };

  const { data: lines } = await supabase
    .from("process_material_issue_lines")
    .select("*")
    .eq("issue_id", issueId);

  // mark as issued
  const { error: upErr } = await supabase
    .from("process_material_issues")
    .update({ status: "issued" })
    .eq("id", issueId);
  if (upErr) return { ok: false, error: upErr.message };

  // post stock movements (best-effort)
  try {
    const admin = createAdminClient();
    for (const line of (lines ?? []) as { item_id: string; quantity: number }[]) {
      if (line.quantity > 0 && line.item_id) {
        await admin.from("stock_ledger").insert({
          store_id: issueRow.store_id,
          item_id: line.item_id,
          movement_type: "issue",
          quantity: line.quantity,
          reference_type: "process_order",
          reference_id: issueRow.process_order_id,
          note: `Process issue ${issueId}`,
          created_by: (await getAppUser())?.id ?? null,
        });
      }
    }
  } catch (e) {
    console.error("[process/issue] stock posting failed:", e);
  }

  // update process order status to in_process
  await supabase
    .from("process_orders")
    .update({ status: "in_process" })
    .eq("id", issueRow.process_order_id)
    .in("status", ["issued", "draft"]);

  await writeAudit({
    action: "process_issue.posted",
    entityType: "process_material_issue",
    entityId: issueId,
  });

  revalidateProcess(`/stores/process-issues`);
  return { ok: true };
}

// ---------- Receipt from Processing ----------

export async function createProcessReceipt(
  data: ProcessReceiptInput,
): Promise<{ ok: true; receiptId: string } | ErrResult> {
  if (!(await can("stores", "create"))) throw new Error("Forbidden");

  const parsed = processReceiptInput.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };

  const user = await getAppUser();
  const supabase = await createClient();
  const { lines, ...receiptFields } = parsed.data;

  const { data: receipt, error } = await supabase
    .from("process_material_receipts")
    .insert({ ...receiptFields, status: "draft", created_by: user?.id ?? null })
    .select("id")
    .single();

  if (error || !receipt) return { ok: false, error: error?.message ?? "Failed" };

  if (lines.length > 0) {
    const { error: lineErr } = await supabase
      .from("process_material_receipt_lines")
      .insert(lines.map((l, i) => ({ ...l, receipt_id: receipt.id, sort_order: l.sort_order ?? i })));
    if (lineErr) return { ok: false, error: lineErr.message };
  }

  revalidateProcess(`/stores/process-receipts`);
  return { ok: true, receiptId: receipt.id };
}

export async function postProcessReceipt(receiptId: string): Promise<ActionResult> {
  if (!(await can("stores", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();

  const { data: receipt } = await supabase
    .from("process_material_receipts")
    .select("id, status, store_id, process_order_id")
    .eq("id", receiptId)
    .maybeSingle();

  const receiptRow = receipt as { id: string; status: string; store_id: string; process_order_id: string } | null;
  if (!receiptRow || receiptRow.status !== "draft")
    return { ok: false, error: "Receipt is not in draft status" };

  const { data: lines } = await supabase
    .from("process_material_receipt_lines")
    .select("*")
    .eq("receipt_id", receiptId);

  // validate: rejected lines need reasons
  for (const line of (lines ?? []) as { rejected_qty: number; rejection_reason: string | null }[]) {
    if (line.rejected_qty > 0 && !line.rejection_reason?.trim()) {
      return { ok: false, error: "All rejected items must have a rejection reason" };
    }
  }

  // mark as posted
  const { error: upErr } = await supabase
    .from("process_material_receipts")
    .update({ status: "posted" })
    .eq("id", receiptId);
  if (upErr) return { ok: false, error: upErr.message };

  // update process order line received_qty + derive status
  const procOrderId = receiptRow.process_order_id;
  for (const line of (lines ?? []) as { item_id: string; accepted_qty: number }[]) {
    if (line.item_id && line.accepted_qty > 0) {
      // increment received_qty on matching process order line
      const { data: procLines } = await supabase
        .from("process_order_lines")
        .select("id, received_qty")
        .eq("process_order_id", procOrderId)
        .eq("item_id", line.item_id)
        .limit(1);

      if (procLines && procLines.length > 0) {
        const pl = procLines[0] as { id: string; received_qty: number };
        await supabase
          .from("process_order_lines")
          .update({ received_qty: pl.received_qty + line.accepted_qty })
          .eq("id", pl.id);
      }
    }
  }

  // derive process order status
  const { data: allLines } = await supabase
    .from("process_order_lines")
    .select("sent_qty, received_qty")
    .eq("process_order_id", procOrderId);

  if (allLines && allLines.length > 0) {
    const typedLines = allLines as { sent_qty: number; received_qty: number }[];
    const allReceived = typedLines.every((l) => l.received_qty >= l.sent_qty);
    const anyReceived = typedLines.some((l) => l.received_qty > 0);
    const newStatus = allReceived ? "received" : anyReceived ? "partially_received" : "in_process";
    await supabase
      .from("process_orders")
      .update({ status: newStatus })
      .eq("id", procOrderId);
  }

  // post stock receipts (best-effort)
  try {
    const admin = createAdminClient();
    for (const line of (lines ?? []) as { item_id: string; accepted_qty: number }[]) {
      if (line.accepted_qty > 0 && line.item_id) {
        await admin.from("stock_ledger").insert({
          store_id: receiptRow.store_id,
          item_id: line.item_id,
          movement_type: "receipt",
          quantity: line.accepted_qty,
          reference_type: "process_order",
          reference_id: procOrderId,
          note: `Process receipt ${receiptId}`,
          created_by: (await getAppUser())?.id ?? null,
        });
      }
    }
  } catch (e) {
    console.error("[process/receipt] stock posting failed:", e);
  }

  await writeAudit({
    action: "process_receipt.posted",
    entityType: "process_material_receipt",
    entityId: receiptId,
  });

  revalidateProcess(`/stores/process-receipts`, `/stores/process-orders/${procOrderId}`);
  return { ok: true };
}
