"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { glAccountInput, journalEntryInput } from "./types";
import type { GlAccountInput, JournalEntryInput } from "./types";
import { isJournalBalanced, journalTotals } from "./calc";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;

function revalidateFinance(...paths: string[]): void {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/finance");
}

// ---------- account actions ----------

export async function createAccount(
  data: GlAccountInput,
): Promise<ActionResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");

  const parsed = glAccountInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("gl_accounts")
    .insert(parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateFinance("/finance/accounts");
  return { ok: true };
}

export async function updateAccount(
  id: string,
  data: GlAccountInput,
): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");

  const parsed = glAccountInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("gl_accounts")
    .update(parsed.data)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateFinance("/finance/accounts");
  return { ok: true };
}

// ---------- journal actions ----------

export async function createJournal(
  data: JournalEntryInput,
): Promise<{ ok: true; entryId: string } | ErrResult> {
  if (!(await can("finance", "create"))) throw new Error("Forbidden");

  const parsed = journalEntryInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  if (!isJournalBalanced(parsed.data.lines)) {
    return { ok: false, error: "Journal is not balanced — total debits must equal total credits." };
  }

  const { totalDebit, totalCredit } = journalTotals(parsed.data.lines);
  const user = await getAppUser();
  const supabase = await createClient();
  const { lines, ...entryFields } = parsed.data;

  const { data: entry, error } = await supabase
    .from("journal_entries")
    .insert({
      ...entryFields,
      status: "draft",
      is_auto: false,
      total_debit: totalDebit,
      total_credit: totalCredit,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !entry) {
    return { ok: false, error: error?.message ?? "Failed to create journal entry" };
  }

  const { error: lineErr } = await supabase.from("journal_lines").insert(
    lines.map((l, i) => ({
      journal_entry_id: entry.id,
      gl_account_id: l.gl_account_id,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      description: l.description ?? null,
      sort_order: l.sort_order ?? i,
    })),
  );
  if (lineErr) return { ok: false, error: lineErr.message };

  await writeAudit({
    action: "journal_entry.created",
    entityType: "journal_entry",
    entityId: entry.id,
    locationId: entryFields.location_id,
    metadata: { total_debit: totalDebit },
  });

  revalidateFinance("/finance/ledger");
  return { ok: true, entryId: entry.id };
}

export async function postJournal(id: string): Promise<ActionResult> {
  if (!(await can("finance", "edit"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: entry } = await supabase
    .from("journal_entries")
    .select("status, code")
    .eq("id", id)
    .maybeSingle();

  const row = entry as { status: string; code: string | null } | null;
  if (!row || row.status !== "draft") {
    return { ok: false, error: "Journal entry is not in draft status" };
  }

  const { error } = await supabase
    .from("journal_entries")
    .update({ status: "posted", posted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await writeAudit({
    action: "journal_entry.posted",
    entityType: "journal_entry",
    entityId: id,
    metadata: { code: row.code },
  });

  revalidateFinance(`/finance/ledger/${id}`, "/finance/ledger");
  return { ok: true };
}

export async function reverseJournal(id: string): Promise<ActionResult> {
  // Reversal is admin-only — gated by finance:delete per PRD
  if (!(await can("finance", "delete"))) throw new Error("Forbidden");

  const supabase = await createClient();
  const { data: entry } = await supabase
    .from("journal_entries")
    .select("*, journal_lines(*)")
    .eq("id", id)
    .maybeSingle();

  const row = entry as
    | (Record<string, unknown> & { status: string; code: string | null; narration: string | null; location_id: string | null; journal_lines: { gl_account_id: string; debit: number; credit: number; description: string | null; sort_order: number }[] })
    | null;

  if (!row || row.status !== "posted") {
    return { ok: false, error: "Journal entry is not posted" };
  }

  const user = await getAppUser();
  const lines = row.journal_lines ?? [];
  const reversalLines = lines.map((l, i) => ({
    gl_account_id: l.gl_account_id,
    debit: l.credit,   // swap
    credit: l.debit,   // swap
    description: l.description,
    sort_order: i,
  }));

  const { totalDebit, totalCredit } = journalTotals(reversalLines);

  // Create reversal journal
  const { data: reversal, error: revErr } = await supabase
    .from("journal_entries")
    .insert({
      entry_date: new Date().toISOString().slice(0, 10),
      narration: `Reversal of ${row.code ?? id}`,
      location_id: row.location_id,
      is_auto: false,
      reversal_of: id,
      status: "posted",
      posted_at: new Date().toISOString(),
      total_debit: totalDebit,
      total_credit: totalCredit,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (revErr || !reversal) {
    return { ok: false, error: revErr?.message ?? "Failed to create reversal" };
  }

  const { error: lineErr } = await supabase.from("journal_lines").insert(
    reversalLines.map((l) => ({ ...l, journal_entry_id: reversal.id })),
  );
  if (lineErr) return { ok: false, error: lineErr.message };

  // Mark original as reversed
  const { error: updateErr } = await supabase
    .from("journal_entries")
    .update({ status: "reversed" })
    .eq("id", id);
  if (updateErr) return { ok: false, error: updateErr.message };

  await writeAudit({
    action: "journal_entry.reversed",
    entityType: "journal_entry",
    entityId: id,
    metadata: { reversal_id: reversal.id, code: row.code },
  });

  revalidateFinance(`/finance/ledger/${id}`, `/finance/ledger/${reversal.id}`, "/finance/ledger");
  return { ok: true };
}
