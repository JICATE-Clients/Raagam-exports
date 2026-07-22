import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderBooking, DueDateConfirmation, ContractReview } from "./booking-types";

export type OrderBookingRow = Omit<OrderBooking, "certifications"> & { buyer_name: string | null; order_code: string | null };

export async function listOrderBookings(): Promise<OrderBookingRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("order_bookings")
    .select("*, buyers:customer_id(name), sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      buyer_name: (row.buyers as { name: string } | null)?.name ?? null,
      order_code: (row.sales_orders as { order_number: string } | null)?.order_number ?? null,
    } as unknown as OrderBookingRow;
  });
}

export async function getOrderBooking(id: string): Promise<OrderBooking | null> {
  const s = await createClient();
  const { data } = await s
    .from("order_bookings")
    .select("*, order_booking_certifications(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    ...row,
    certifications: [...((row.order_booking_certifications ?? []) as OrderBooking["certifications"])].sort((a, b) => a.sno - b.sno),
  } as unknown as OrderBooking;
}

export type DueDateConfirmationRow = Omit<DueDateConfirmation, "items"> & { order_code: string | null };

export async function listDueDateConfirmations(): Promise<DueDateConfirmationRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("due_date_confirmations")
    .select("*, sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      order_code: (row.sales_orders as { order_number: string } | null)?.order_number ?? null,
    } as unknown as DueDateConfirmationRow;
  });
}

export type ContractReviewRow = Omit<ContractReview, "styles"> & { buyer_name: string | null; order_code: string | null };

export async function listContractReviews(): Promise<ContractReviewRow[]> {
  const s = await createClient();
  const { data } = await s
    .from("contract_reviews")
    .select("*, buyers:customer_id(name), sales_orders(order_number)")
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      buyer_name: (row.buyers as { name: string } | null)?.name ?? null,
      order_code: (row.sales_orders as { order_number: string } | null)?.order_number ?? null,
    } as unknown as ContractReviewRow;
  });
}

export async function getContractReview(id: string): Promise<ContractReview | null> {
  const s = await createClient();
  const { data } = await s
    .from("contract_reviews")
    .select("*, contract_review_styles(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    ...row,
    styles: [...((row.contract_review_styles ?? []) as ContractReview["styles"])].sort((a, b) => a.sno - b.sno),
  } as unknown as ContractReview;
}
