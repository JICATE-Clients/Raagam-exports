"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";

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

// ============================================================================
// yarn_compositions
// ============================================================================
export async function createYarnComposition(data: {
  code: string;
  name: string;
  is_active: boolean;
}): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "yarn_compositions", code, {
    nameColumn: "code",
    label: "code",
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { data: row, error } = await s
    .from("yarn_compositions")
    .insert({ code, name, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateYarnComposition(
  id: string,
  data: { code: string; name: string; is_active: boolean },
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "yarn_compositions", code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { error } = await s
    .from("yarn_compositions")
    .update({ code, name, is_active: data.is_active })
    .eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteYarnComposition(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "yarn_compositions", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// defect_groups
// ============================================================================
export async function createDefectGroup(data: {
  code: string;
  name: string;
  is_active: boolean;
}): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "defect_groups", code, {
    nameColumn: "code",
    label: "code",
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { data: row, error } = await s
    .from("defect_groups")
    .insert({ code, name, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateDefectGroup(
  id: string,
  data: { code: string; name: string; is_active: boolean },
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "defect_groups", code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { error } = await s
    .from("defect_groups")
    .update({ code, name, is_active: data.is_active })
    .eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteDefectGroup(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "defect_groups", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// style_stock_categories  (code-only, no name column)
// ============================================================================
export async function createStyleStockCategory(data: {
  code: string;
  is_active: boolean;
}): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const code = data.code.trim();
  if (!code) return fail("Code is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "style_stock_categories", code, {
    nameColumn: "code",
    label: "code",
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { data: row, error } = await s
    .from("style_stock_categories")
    .insert({ code, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateStyleStockCategory(
  id: string,
  data: { code: string; is_active: boolean },
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  if (!code) return fail("Code is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "style_stock_categories", code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { error } = await s
    .from("style_stock_categories")
    .update({ code, is_active: data.is_active })
    .eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteStyleStockCategory(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "style_stock_categories", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// special_instructions  (code + description)
// ============================================================================
export async function createSpecialInstruction(data: {
  code: string;
  description: string;
  is_active: boolean;
}): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const code = data.code.trim();
  const description = data.description.trim();
  if (!code) return fail("Code is required.");
  if (!description) return fail("Description is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "special_instructions", code, {
    nameColumn: "code",
    label: "code",
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { data: row, error } = await s
    .from("special_instructions")
    .insert({ code, description, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateSpecialInstruction(
  id: string,
  data: { code: string; description: string; is_active: boolean },
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const description = data.description.trim();
  if (!code) return fail("Code is required.");
  if (!description) return fail("Description is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "special_instructions", code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { error } = await s
    .from("special_instructions")
    .update({ code, description, is_active: data.is_active })
    .eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteSpecialInstruction(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "special_instructions", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// beam_types
// ============================================================================
export async function createBeamType(data: {
  code: string;
  name: string;
  is_active: boolean;
}): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "beam_types", code, {
    nameColumn: "code",
    label: "code",
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { data: row, error } = await s
    .from("beam_types")
    .insert({ code, name, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateBeamType(
  id: string,
  data: { code: string; name: string; is_active: boolean },
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "beam_types", code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { error } = await s
    .from("beam_types")
    .update({ code, name, is_active: data.is_active })
    .eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteBeamType(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "beam_types", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// designs  (name-only, no code column)
// ============================================================================
export async function createDesign(data: {
  name: string;
  is_active: boolean;
}): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupName = await checkDuplicateName(s, "designs", name, { nameColumn: "name" });
  if (!dupName.ok) return fail(dupName.error);
  const { data: row, error } = await s
    .from("designs")
    .insert({ name, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateDesign(
  id: string,
  data: { name: string; is_active: boolean },
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const name = data.name.trim();
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupName = await checkDuplicateName(s, "designs", name, {
    nameColumn: "name",
    excludeId: id,
  });
  if (!dupName.ok) return fail(dupName.error);
  const { error } = await s
    .from("designs")
    .update({ name, is_active: data.is_active })
    .eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteDesign(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "designs", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// domestic_product_designs  (design_no + description)
// ============================================================================
export async function createDomesticProductDesign(data: {
  design_no: string;
  description: string;
  is_active: boolean;
}): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const design_no = data.design_no.trim();
  const description = data.description.trim();
  if (!design_no) return fail("Design No is required.");
  if (!description) return fail("Description is required.");
  const s = await createClient();
  const dupNo = await checkDuplicateName(s, "domestic_product_designs", design_no, {
    nameColumn: "design_no",
    label: "design no",
  });
  if (!dupNo.ok) return fail(dupNo.error);
  const { data: row, error } = await s
    .from("domestic_product_designs")
    .insert({ design_no, description, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateDomesticProductDesign(
  id: string,
  data: { design_no: string; description: string; is_active: boolean },
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const design_no = data.design_no.trim();
  const description = data.description.trim();
  if (!design_no) return fail("Design No is required.");
  if (!description) return fail("Description is required.");
  const s = await createClient();
  const dupNo = await checkDuplicateName(s, "domestic_product_designs", design_no, {
    nameColumn: "design_no",
    label: "design no",
    excludeId: id,
  });
  if (!dupNo.ok) return fail(dupNo.error);
  const { error } = await s
    .from("domestic_product_designs")
    .update({ design_no, description, is_active: data.is_active })
    .eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteDomesticProductDesign(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "domestic_product_designs", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// lab_test_standards  (code + name + optional category)
// ============================================================================
export async function createLabTestStandard(data: {
  code: string;
  name: string;
  category: string | null;
  is_active: boolean;
}): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "lab_test_standards", code, {
    nameColumn: "code",
    label: "code",
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { data: row, error } = await s
    .from("lab_test_standards")
    .insert({ code, name, category: data.category?.trim() || null, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateLabTestStandard(
  id: string,
  data: { code: string; name: string; category: string | null; is_active: boolean },
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "lab_test_standards", code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { error } = await s
    .from("lab_test_standards")
    .update({ code, name, category: data.category?.trim() || null, is_active: data.is_active })
    .eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteLabTestStandard(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "lab_test_standards", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}

// ============================================================================
// product_types  (code + name)
// ============================================================================
export async function createProductType(data: {
  code: string;
  name: string;
  is_active: boolean;
}): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "product_types", code, {
    nameColumn: "code",
    label: "code",
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { data: row, error } = await s
    .from("product_types")
    .insert({ code, name, is_active: data.is_active })
    .select("id")
    .single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function updateProductType(
  id: string,
  data: { code: string; name: string; is_active: boolean },
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) return fail("Code is required.");
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupCode = await checkDuplicateName(s, "product_types", code, {
    nameColumn: "code",
    label: "code",
    excludeId: id,
  });
  if (!dupCode.ok) return fail(dupCode.error);
  const { error } = await s
    .from("product_types")
    .update({ code, name, is_active: data.is_active })
    .eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteProductType(id: string): Promise<DeleteResult> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const res = await deleteOrDeactivate(s, "product_types", id, "is_active");
  if (!res.ok) return fail(res.error);
  rev();
  return { ok: true, inactive: res.inactive };
}
