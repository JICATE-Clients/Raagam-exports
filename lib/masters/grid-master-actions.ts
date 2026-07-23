"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";
import { generateUniqueCode } from "./auto-code";
import type {
  CountGroupInput,
  ConstructionInput,
  YarnPurchaseRateInput,
  YarnDebitRateInput,
  SizingRateInput,
  WarpLengthAllowanceInput,
  ProcessSequenceInput,
  ProcessSequenceGroupInput,
} from "./grid-master-types";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
}

// Helper: replace child rows (delete all, re-insert)
async function replaceDetails(
  s: Awaited<ReturnType<typeof createClient>>,
  detailTable: string,
  fkField: string,
  headerId: string,
  rows: Record<string, unknown>[],
): Promise<{ ok: boolean; error?: string }> {
  await s.from(detailTable).delete().eq(fkField, headerId);
  if (rows.length === 0) return { ok: true };
  const { error } = await s.from(detailTable).insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ============================================================================
// Count Groups — child table: count_group_counts, FK: count_group_id
// ============================================================================
export async function createCountGroup(data: CountGroupInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  let code = data.code.trim();
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  if (!data.details.length) return fail("At least one count row is required.");
  const s = await createClient();
  if (!code) {
    code = await generateUniqueCode(s, "count_groups", name);
  } else {
    const dup = await checkDuplicateName(s, "count_groups", code, { nameColumn: "code", label: "code" });
    if (!dup.ok) return fail(dup.error);
  }
  const { data: hdr, error } = await s
    .from("count_groups")
    .insert({ code, name, category_id: data.category_id, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "count_group_counts", "count_group_id", hdr.id,
    data.details.map((d, i) => ({ count_group_id: hdr.id, sno: i + 1, count_lookup_id: d.count_lookup_id })));
  if (!dRes.ok) { await s.from("count_groups").delete().eq("id", hdr.id); return fail(dRes.error!); }
  rev();
  return { ok: true, id: hdr.id };
}

export async function updateCountGroup(id: string, data: CountGroupInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  const s = await createClient();
  // Blank code on update = keep the stored one (the form doesn't edit codes).
  if (code) {
    const dup = await checkDuplicateName(s, "count_groups", code, { nameColumn: "code", label: "code", excludeId: id });
    if (!dup.ok) return fail(dup.error);
  }
  const { error } = await s.from("count_groups").update({ ...(code ? { code } : {}), name, category_id: data.category_id, is_active: data.is_active }).eq("id", id);
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "count_group_counts", "count_group_id", id,
    data.details.map((d, i) => ({ count_group_id: id, sno: i + 1, count_lookup_id: d.count_lookup_id })));
  if (!dRes.ok) return fail(dRes.error!);
  rev();
  return { ok: true };
}

export async function deleteCountGroup(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "count_groups", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// Constructions — child table: construction_counts, FK: construction_id
// ============================================================================
export async function createConstruction(data: ConstructionInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  let code = data.code.trim();
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  const s = await createClient();
  if (!code) {
    code = await generateUniqueCode(s, "constructions", name);
  } else {
    const dup = await checkDuplicateName(s, "constructions", code, { nameColumn: "code", label: "code" });
    if (!dup.ok) return fail(dup.error);
  }
  const { data: row, error } = await s
    .from("constructions")
    .insert({
      code,
      name,
      reed: data.reed,
      epi_on_loom: data.epi_on_loom,
      reed_count: data.reed_count,
      pick: data.pick,
      construct_for: data.construct_for,
      weave_tech_desc: data.weave_tech_desc,
      category_id: data.category_id,
      is_direct_purchase: data.is_direct_purchase,
      is_active: data.is_active,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);
  if (data.details.length > 0) {
    const dRes = await replaceDetails(s, "construction_counts", "construction_id", row.id,
      data.details.map((d, i) => ({
        construction_id: row.id,
        sno: i + 1,
        count_type: d.count_type,
        count_lookup_id: d.count_lookup_id,
        item_id: d.item_id,
      })));
    if (!dRes.ok) { await s.from("constructions").delete().eq("id", row.id); return fail(dRes.error!); }
  }
  rev();
  return { ok: true, id: row.id };
}

export async function updateConstruction(id: string, data: ConstructionInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  const s = await createClient();
  // Blank code on update = keep the stored one (the form doesn't edit codes).
  if (code) {
    const dup = await checkDuplicateName(s, "constructions", code, { nameColumn: "code", label: "code", excludeId: id });
    if (!dup.ok) return fail(dup.error);
  }
  const { error } = await s.from("constructions").update({
    ...(code ? { code } : {}),
    name,
    reed: data.reed,
    epi_on_loom: data.epi_on_loom,
    reed_count: data.reed_count,
    pick: data.pick,
    construct_for: data.construct_for,
    weave_tech_desc: data.weave_tech_desc,
    category_id: data.category_id,
    is_direct_purchase: data.is_direct_purchase,
    is_active: data.is_active,
  }).eq("id", id);
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "construction_counts", "construction_id", id,
    data.details.map((d, i) => ({
      construction_id: id,
      sno: i + 1,
      count_type: d.count_type,
      count_lookup_id: d.count_lookup_id,
      item_id: d.item_id,
    })));
  if (!dRes.ok) return fail(dRes.error!);
  rev();
  return { ok: true };
}

export async function deleteConstruction(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "constructions", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// Yarn Purchase Rates — child: yarn_purchase_rate_items, FK: rate_id
// Code auto-generated by DB trigger (assign_code).
// ============================================================================
export async function createYarnPurchaseRate(data: YarnPurchaseRateInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  if (!data.effective_from) return fail("Effective from is required.");
  if (!data.details.length) return fail("At least one rate row is required.");
  const s = await createClient();
  const { data: hdr, error } = await s
    .from("yarn_purchase_rates")
    .insert({ effective_from: data.effective_from })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "yarn_purchase_rate_items", "rate_id", hdr.id,
    data.details.map((d, i) => ({
      rate_id: hdr.id,
      sno: i + 1,
      category_id: d.category_id,
      item_id: d.item_id,
      purity_id: d.purity_id,
      uom: d.uom,
      rate: d.rate,
    })));
  if (!dRes.ok) { await s.from("yarn_purchase_rates").delete().eq("id", hdr.id); return fail(dRes.error!); }
  rev();
  return { ok: true, id: hdr.id };
}

export async function updateYarnPurchaseRate(id: string, data: YarnPurchaseRateInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  if (!data.effective_from) return fail("Effective from is required.");
  const s = await createClient();
  const { error } = await s.from("yarn_purchase_rates").update({ effective_from: data.effective_from }).eq("id", id);
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "yarn_purchase_rate_items", "rate_id", id,
    data.details.map((d, i) => ({
      rate_id: id,
      sno: i + 1,
      category_id: d.category_id,
      item_id: d.item_id,
      purity_id: d.purity_id,
      uom: d.uom,
      rate: d.rate,
    })));
  if (!dRes.ok) return fail(dRes.error!);
  rev();
  return { ok: true };
}

export async function deleteYarnPurchaseRate(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("yarn_purchase_rates").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ============================================================================
// Yarn Debit Rates — child: yarn_debit_rate_items, FK: rate_id
// Code auto-generated by DB trigger (assign_code).
// ============================================================================
export async function createYarnDebitRate(data: YarnDebitRateInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  if (!data.effective_from) return fail("Effective from is required.");
  if (!data.details.length) return fail("At least one rate row is required.");
  const s = await createClient();
  const { data: hdr, error } = await s
    .from("yarn_debit_rates")
    .insert({ effective_from: data.effective_from })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "yarn_debit_rate_items", "rate_id", hdr.id,
    data.details.map((d, i) => ({
      rate_id: hdr.id,
      sno: i + 1,
      item_id: d.item_id,
      rate_per_kg: d.rate_per_kg,
      rate_per_bundle: d.rate_per_bundle,
    })));
  if (!dRes.ok) { await s.from("yarn_debit_rates").delete().eq("id", hdr.id); return fail(dRes.error!); }
  rev();
  return { ok: true, id: hdr.id };
}

export async function updateYarnDebitRate(id: string, data: YarnDebitRateInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  if (!data.effective_from) return fail("Effective from is required.");
  const s = await createClient();
  const { error } = await s.from("yarn_debit_rates").update({ effective_from: data.effective_from }).eq("id", id);
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "yarn_debit_rate_items", "rate_id", id,
    data.details.map((d, i) => ({
      rate_id: id,
      sno: i + 1,
      item_id: d.item_id,
      rate_per_kg: d.rate_per_kg,
      rate_per_bundle: d.rate_per_bundle,
    })));
  if (!dRes.ok) return fail(dRes.error!);
  rev();
  return { ok: true };
}

export async function deleteYarnDebitRate(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("yarn_debit_rates").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ============================================================================
// Sizing Rates — child: sizing_rate_yarns, FK: sizing_rate_id
// Code auto-generated by DB trigger (assign_code).
// ============================================================================
export async function createSizingRate(data: SizingRateInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  if (!data.effective_from) return fail("Effective from is required.");
  if (!data.details.length) return fail("At least one yarn row is required.");
  const s = await createClient();
  const { data: hdr, error } = await s
    .from("sizing_rates")
    .insert({
      effective_from: data.effective_from,
      entry_type: data.entry_type,
      base_rate: data.base_rate,
      is_active: data.is_active,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "sizing_rate_yarns", "sizing_rate_id", hdr.id,
    data.details.map((d, i) => ({
      sizing_rate_id: hdr.id,
      sno: i + 1,
      category_id: d.category_id,
      item_id: d.item_id,
      rate_ends_upto: d.rate_ends_upto,
      rate_ends_more: d.rate_ends_more,
    })));
  if (!dRes.ok) { await s.from("sizing_rates").delete().eq("id", hdr.id); return fail(dRes.error!); }
  rev();
  return { ok: true, id: hdr.id };
}

export async function updateSizingRate(id: string, data: SizingRateInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  if (!data.effective_from) return fail("Effective from is required.");
  const s = await createClient();
  const { error } = await s.from("sizing_rates").update({
    effective_from: data.effective_from,
    entry_type: data.entry_type,
    base_rate: data.base_rate,
    is_active: data.is_active,
  }).eq("id", id);
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "sizing_rate_yarns", "sizing_rate_id", id,
    data.details.map((d, i) => ({
      sizing_rate_id: id,
      sno: i + 1,
      category_id: d.category_id,
      item_id: d.item_id,
      rate_ends_upto: d.rate_ends_upto,
      rate_ends_more: d.rate_ends_more,
    })));
  if (!dRes.ok) return fail(dRes.error!);
  rev();
  return { ok: true };
}

export async function deleteSizingRate(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("sizing_rates").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ============================================================================
// Warp Length Allowances — child: warp_length_allowance_details, FK: allowance_id
// Code auto-generated by DB trigger (assign_code).
// ============================================================================
export async function createWarpLengthAllowance(data: WarpLengthAllowanceInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  if (!data.effective_from) return fail("Effective from is required.");
  if (!data.details.length) return fail("At least one allowance row is required.");
  const s = await createClient();
  const { data: hdr, error } = await s
    .from("warp_length_allowances")
    .insert({ effective_from: data.effective_from })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "warp_length_allowance_details", "allowance_id", hdr.id,
    data.details.map((d, i) => ({
      allowance_id: hdr.id,
      sno: i + 1,
      range_type: d.range_type,
      from_warp_length: d.from_warp_length,
      to_warp_length: d.to_warp_length,
      warp_length: d.warp_length,
      fabric_length: d.fabric_length,
      weft_waste_pct: d.weft_waste_pct,
      shuttle_loom: d.shuttle_loom,
      shuttleless_loom: d.shuttleless_loom,
      hand_loom: d.hand_loom,
    })));
  if (!dRes.ok) { await s.from("warp_length_allowances").delete().eq("id", hdr.id); return fail(dRes.error!); }
  rev();
  return { ok: true, id: hdr.id };
}

export async function updateWarpLengthAllowance(id: string, data: WarpLengthAllowanceInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  if (!data.effective_from) return fail("Effective from is required.");
  const s = await createClient();
  const { error } = await s.from("warp_length_allowances").update({ effective_from: data.effective_from }).eq("id", id);
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "warp_length_allowance_details", "allowance_id", id,
    data.details.map((d, i) => ({
      allowance_id: id,
      sno: i + 1,
      range_type: d.range_type,
      from_warp_length: d.from_warp_length,
      to_warp_length: d.to_warp_length,
      warp_length: d.warp_length,
      fabric_length: d.fabric_length,
      weft_waste_pct: d.weft_waste_pct,
      shuttle_loom: d.shuttle_loom,
      shuttleless_loom: d.shuttleless_loom,
      hand_loom: d.hand_loom,
    })));
  if (!dRes.ok) return fail(dRes.error!);
  rev();
  return { ok: true };
}

export async function deleteWarpLengthAllowance(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("warp_length_allowances").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ============================================================================
// Process Sequences — child: process_sequence_steps, FK: sequence_id
// ============================================================================
export async function createProcessSequence(data: ProcessSequenceInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  let code = data.code.trim();
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  if (!data.details.length) return fail("At least one step is required.");
  const s = await createClient();
  if (!code) {
    code = await generateUniqueCode(s, "process_sequences", name);
  } else {
    const dup = await checkDuplicateName(s, "process_sequences", code, { nameColumn: "code", label: "code" });
    if (!dup.ok) return fail(dup.error);
  }
  const { data: hdr, error } = await s
    .from("process_sequences")
    .insert({ code, name, item_class_type: data.item_class_type, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "process_sequence_steps", "sequence_id", hdr.id,
    data.details.map((d, i) => ({
      sequence_id: hdr.id,
      sno: i + 1,
      stage: d.stage,
      process_id: d.process_id,
      process_group: d.process_group,
      loss_pct: d.loss_pct,
      loss_for: d.loss_for,
      rate: d.rate,
      expected_loss_pct: d.expected_loss_pct,
      vendor_id: d.vendor_id,
      description: d.description,
    })));
  if (!dRes.ok) { await s.from("process_sequences").delete().eq("id", hdr.id); return fail(dRes.error!); }
  rev();
  return { ok: true, id: hdr.id };
}

export async function updateProcessSequence(id: string, data: ProcessSequenceInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  const s = await createClient();
  // Blank code on update = keep the stored one (the form doesn't edit codes).
  if (code) {
    const dup = await checkDuplicateName(s, "process_sequences", code, { nameColumn: "code", label: "code", excludeId: id });
    if (!dup.ok) return fail(dup.error);
  }
  const { error } = await s.from("process_sequences").update({ ...(code ? { code } : {}), name, item_class_type: data.item_class_type, is_active: data.is_active }).eq("id", id);
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "process_sequence_steps", "sequence_id", id,
    data.details.map((d, i) => ({
      sequence_id: id,
      sno: i + 1,
      stage: d.stage,
      process_id: d.process_id,
      process_group: d.process_group,
      loss_pct: d.loss_pct,
      loss_for: d.loss_for,
      rate: d.rate,
      expected_loss_pct: d.expected_loss_pct,
      vendor_id: d.vendor_id,
      description: d.description,
    })));
  if (!dRes.ok) return fail(dRes.error!);
  rev();
  return { ok: true };
}

export async function deleteProcessSequence(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "process_sequences", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// Process Sequence Groups — child: process_sequence_group_members, FK: group_id
// ============================================================================
export async function createProcessSequenceGroup(data: ProcessSequenceGroupInput): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  let code = data.code.trim();
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  if (!data.details.length) return fail("At least one sequence row is required.");
  const s = await createClient();
  if (!code) {
    code = await generateUniqueCode(s, "process_sequence_groups", name);
  } else {
    const dup = await checkDuplicateName(s, "process_sequence_groups", code, { nameColumn: "code", label: "code" });
    if (!dup.ok) return fail(dup.error);
  }
  const { data: hdr, error } = await s
    .from("process_sequence_groups")
    .insert({ code, name, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "process_sequence_group_members", "group_id", hdr.id,
    data.details.map((d, i) => ({
      group_id: hdr.id,
      sno: i + 1,
      sequence_id: d.sequence_id,
    })));
  if (!dRes.ok) { await s.from("process_sequence_groups").delete().eq("id", hdr.id); return fail(dRes.error!); }
  rev();
  return { ok: true, id: hdr.id };
}

export async function updateProcessSequenceGroup(id: string, data: ProcessSequenceGroupInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  const s = await createClient();
  // Blank code on update = keep the stored one (the form doesn't edit codes).
  if (code) {
    const dup = await checkDuplicateName(s, "process_sequence_groups", code, { nameColumn: "code", label: "code", excludeId: id });
    if (!dup.ok) return fail(dup.error);
  }
  const { error } = await s.from("process_sequence_groups").update({ ...(code ? { code } : {}), name, is_active: data.is_active }).eq("id", id);
  if (error) return fail(error.message);
  const dRes = await replaceDetails(s, "process_sequence_group_members", "group_id", id,
    data.details.map((d, i) => ({
      group_id: id,
      sno: i + 1,
      sequence_id: d.sequence_id,
    })));
  if (!dRes.ok) return fail(dRes.error!);
  rev();
  return { ok: true };
}

export async function deleteProcessSequenceGroup(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "process_sequence_groups", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}
