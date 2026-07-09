"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { bankInput, type BankInput } from "./bank-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/bank");
}

type BranchRow = Omit<BankInput["branches"][number], "sno"> & { sno: number };

/** Drop fully-empty branch rows (no country + all text blank) and renumber sno. */
function normalizeBranches(data: BankInput): BranchRow[] {
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return data.branches
    .map((b) => ({
      country_id: b.country_id ?? null,
      state: clean(b.state),
      city: clean(b.city),
      pin: clean(b.pin),
      street: clean(b.street),
      land_line: clean(b.land_line),
      fax: clean(b.fax),
      email: clean(b.email),
      swift_rtgs_code: clean(b.swift_rtgs_code),
      current_acc_no: clean(b.current_acc_no),
      ifs_code: clean(b.ifs_code),
    }))
    .filter(
      (b) =>
        b.country_id ||
        b.state ||
        b.city ||
        b.pin ||
        b.street ||
        b.land_line ||
        b.fax ||
        b.email ||
        b.swift_rtgs_code ||
        b.current_acc_no ||
        b.ifs_code,
    )
    .map((b, i) => ({ ...b, sno: i + 1 }));
}

export async function createBank(data: BankInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = bankInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { branches: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s.from("banks").insert(header).select("id").single();
  if (error) return fail(error.message);
  const rows = normalizeBranches(p.data);
  if (rows.length) {
    const { error: bErr } = await s
      .from("bank_branches")
      .insert(rows.map((r) => ({ ...r, bank_id: created.id })));
    if (bErr) return fail(bErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateBank(id: string, data: BankInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = bankInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { branches: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("banks").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the branch grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s.from("bank_branches").delete().eq("bank_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeBranches(p.data);
  if (rows.length) {
    const { error: bErr } = await s
      .from("bank_branches")
      .insert(rows.map((r) => ({ ...r, bank_id: id })));
    if (bErr) return fail(bErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteBank(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("banks").delete().eq("id", id); // branches cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
