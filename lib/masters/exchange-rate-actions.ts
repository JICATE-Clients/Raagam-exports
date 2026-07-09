"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  exchangeRateInput,
  type ExchangeRateInput,
  type ExchangeRateRegister,
} from "./exchange-rate-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/currencies");
  revalidatePath("/masters/currencies/exchange-rate-quotes-orders");
  revalidatePath("/masters/currencies/exchange-rate-customs");
  revalidatePath("/masters/currencies/exchange-rate-imports");
}

/** Drop rows with no currency picked and renumber sno from 1. */
function normalizeLines(data: ExchangeRateInput) {
  return data.lines
    .filter((l) => l.currency_code && l.currency_code.trim())
    .map((l, i) => ({
      sno: i + 1,
      currency_code: l.currency_code,
      ex_rate: Number.isFinite(l.ex_rate) ? l.ex_rate : 0,
    }));
}

/** Next Entry No within a register (each register numbers from 1). */
async function nextEntryNo(
  s: Awaited<ReturnType<typeof createClient>>,
  register: ExchangeRateRegister,
): Promise<number> {
  const { data } = await s
    .from("exchange_rate_entries")
    .select("entry_no")
    .eq("register", register)
    .order("entry_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.entry_no ?? 0) + 1;
}

async function writeLines(
  s: Awaited<ReturnType<typeof createClient>>,
  entryId: string,
  data: ExchangeRateInput,
): Promise<string | null> {
  const lines = normalizeLines(data);
  if (!lines.length) return null;
  const { error } = await s
    .from("exchange_rate_lines")
    .insert(lines.map((l) => ({ ...l, entry_id: entryId })));
  return error ? error.message : null;
}

export async function createExchangeRateEntry(data: ExchangeRateInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = exchangeRateInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const entry_no = await nextEntryNo(s, p.data.register);
  const { lines: _l, ...header } = p.data;
  void _l;
  const { data: created, error } = await s
    .from("exchange_rate_entries")
    .insert({
      ...header,
      entry_no,
      rate_for: header.rate_for || null,
      effective_from: header.effective_from || null,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const lineErr = await writeLines(s, created.id, p.data);
  if (lineErr) return fail(lineErr);
  rev();
  return { ok: true };
}

export async function updateExchangeRateEntry(
  id: string,
  data: ExchangeRateInput,
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = exchangeRateInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _l, register: _r, ...header } = p.data;
  void _l;
  void _r; // register is fixed by the entry; never reassigned on edit
  const { error } = await s
    .from("exchange_rate_entries")
    .update({
      ...header,
      rate_for: header.rate_for || null,
      effective_from: header.effective_from || null,
    })
    .eq("id", id);
  if (error) return fail(error.message);
  // Replace the rate grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("exchange_rate_lines").delete().eq("entry_id", id);
  if (delErr) return fail(delErr.message);
  const lineErr = await writeLines(s, id, p.data);
  if (lineErr) return fail(lineErr);
  rev();
  return { ok: true };
}

export async function deleteExchangeRateEntry(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("exchange_rate_entries").delete().eq("id", id); // lines cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
