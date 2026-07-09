"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  garmentRejectionRuleInput,
  type GarmentRejectionRuleInput,
} from "./garment-rejection-rule-types";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/system");
  revalidatePath("/masters/system/garment-rejection-rule");
}

type LineRow = Omit<GarmentRejectionRuleInput["lines"][number], "sno"> & { sno: number };

/** Drop fully-empty detail rows (no range + all numbers null) and renumber sno. */
function normalizeLines(data: GarmentRejectionRuleInput): LineRow[] {
  const cleanText = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return data.lines
    .map((l) => ({
      range_label: cleanText(l.range_label),
      from_value: l.from_value ?? null,
      to_value: l.to_value ?? null,
      rejection_allowance: l.rejection_allowance ?? null,
    }))
    .filter(
      (l) =>
        l.range_label !== null ||
        l.from_value !== null ||
        l.to_value !== null ||
        l.rejection_allowance !== null,
    )
    .map((l, i) => ({ ...l, sno: i + 1 }));
}

export async function createGarmentRejectionRule(data: GarmentRejectionRuleInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = garmentRejectionRuleInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const { data: created, error } = await s
    .from("garment_rejection_rules")
    .insert(header)
    .select("id")
    .single();
  if (error) return fail(error.message);
  const rows = normalizeLines(p.data);
  if (rows.length) {
    const { error: lErr } = await s
      .from("garment_rejection_rule_lines")
      .insert(rows.map((r) => ({ ...r, rule_id: created.id })));
    if (lErr) return fail(lErr.message);
  }
  rev();
  return { ok: true };
}

export async function updateGarmentRejectionRule(
  id: string,
  data: GarmentRejectionRuleInput,
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = garmentRejectionRuleInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines: _drop, ...header } = p.data;
  void _drop;
  const { error } = await s.from("garment_rejection_rules").update(header).eq("id", id);
  if (error) return fail(error.message);
  // Replace the detail grid wholesale (small, fully-loaded set).
  const { error: delErr } = await s
    .from("garment_rejection_rule_lines")
    .delete()
    .eq("rule_id", id);
  if (delErr) return fail(delErr.message);
  const rows = normalizeLines(p.data);
  if (rows.length) {
    const { error: lErr } = await s
      .from("garment_rejection_rule_lines")
      .insert(rows.map((r) => ({ ...r, rule_id: id })));
    if (lErr) return fail(lErr.message);
  }
  rev();
  return { ok: true };
}

export async function deleteGarmentRejectionRule(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("garment_rejection_rules").delete().eq("id", id); // lines cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
