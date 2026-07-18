"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { orderBookingInput, dueDateConfirmationInput, contractReviewInput } from "./booking-types";
import type { OrderBookingInput, DueDateConfirmationInput, ContractReviewInput } from "./booking-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders");
  revalidatePath("/orders/order-booking");
  revalidatePath("/orders/due-date-confirmations");
  revalidatePath("/orders/contract-review");
}

// ---------------------------------------------------------------------------
// Order Booking
// ---------------------------------------------------------------------------

export async function createOrderBooking(data: OrderBookingInput): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = orderBookingInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { certifications, ...header } = p.data;
  const { data: row, error } = await s.from("order_bookings").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (certifications.length > 0) {
    const { error: childErr } = await s.from("order_booking_certifications").insert(
      certifications.map((c, i) => ({ order_booking_id: row.id, sno: i + 1, ...c })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function deleteOrderBooking(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("order_bookings").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Due Date Confirmation
// ---------------------------------------------------------------------------

export async function createDueDateConfirmation(data: DueDateConfirmationInput): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = dueDateConfirmationInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { items, ...header } = p.data;
  const { data: row, error } = await s.from("due_date_confirmations").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (items.length > 0) {
    const { error: childErr } = await s.from("due_date_confirmation_items").insert(
      items.map((item, i) => ({ confirmation_id: row.id, sno: i + 1, ...item })),
    );
    if (childErr) return fail(childErr.message);
  }
  // Update parent sales_order delivery_date if header date provided
  if (p.data.delivery_date) {
    await s.from("sales_orders").update({ delivery_date: p.data.delivery_date }).eq("id", p.data.sales_order_id);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function deleteDueDateConfirmation(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("due_date_confirmations").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Contract Review
// ---------------------------------------------------------------------------

export async function createContractReview(data: ContractReviewInput): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = contractReviewInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { styles, ...header } = p.data;
  // Calculate P/L
  const profit_loss_value = header.order_value - header.ioc_value;
  const profit_loss_pct = header.ioc_value > 0 ? (profit_loss_value / header.ioc_value) * 100 : 0;
  const { data: row, error } = await s.from("contract_reviews").insert({
    ...header,
    profit_loss_value: Math.round(profit_loss_value * 100) / 100,
    profit_loss_pct: Math.round(profit_loss_pct * 100) / 100,
  }).select("id").single();
  if (error) return fail(error.message);
  if (styles.length > 0) {
    const { error: childErr } = await s.from("contract_review_styles").insert(
      styles.map((st, i) => ({
        contract_review_id: row.id,
        sno: i + 1,
        style_no: st.style_no,
        ioc_value: st.ioc_value,
        order_value: st.order_value,
        profit_loss_value: Math.round((st.order_value - st.ioc_value) * 100) / 100,
        profit_loss_pct: st.ioc_value > 0 ? Math.round(((st.order_value - st.ioc_value) / st.ioc_value) * 10000) / 100 : 0,
      })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function approveContractReview(id: string, remarks?: string): Promise<Result> {
  if (!(await can("orders", "approve"))) return fail("Forbidden");
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  const { error } = await s.from("contract_reviews").update({
    approval_status: "approved",
    remarks: remarks || null,
    approved_by: user?.id,
    approved_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function rejectContractReview(id: string, remarks?: string): Promise<Result> {
  if (!(await can("orders", "approve"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("contract_reviews").update({
    approval_status: "rejected",
    remarks: remarks || null,
  }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function sendToRevision(id: string, remarks?: string): Promise<Result> {
  if (!(await can("orders", "approve"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("contract_reviews").update({
    approval_status: "revision",
    is_sent_to_revision: true,
    remarks: remarks || null,
  }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteContractReview(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("contract_reviews").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
