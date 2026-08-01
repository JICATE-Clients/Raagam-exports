"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { checkDuplicateName } from "./dup-guard";
import { deleteOrDeactivate } from "./delete-guard";
import { generateUniqueCode } from "./auto-code";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type DeleteResult = { ok: true; inactive: boolean; usedBy?: string } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
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
  let code = data.code.trim();
  const name = data.name.trim().toUpperCase();
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupName = await checkDuplicateName(s, "defect_groups", name, { nameColumn: "name" });
  if (!dupName.ok) return fail(dupName.error);
  if (!code) {
    code = await generateUniqueCode(s, "defect_groups", name);
  } else {
    const dupCode = await checkDuplicateName(s, "defect_groups", code, {
      nameColumn: "code",
      label: "code",
    });
    if (!dupCode.ok) return fail(dupCode.error);
  }
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
  const name = data.name.trim().toUpperCase();
  if (!name) return fail("Name is required.");
  const s = await createClient();
  const dupName = await checkDuplicateName(s, "defect_groups", name, {
    nameColumn: "name",
    excludeId: id,
  });
  if (!dupName.ok) return fail(dupName.error);
  // Blank code on update = keep the stored one (the form doesn't edit codes).
  if (code) {
    const dupCode = await checkDuplicateName(s, "defect_groups", code, {
      nameColumn: "code",
      label: "code",
      excludeId: id,
    });
    if (!dupCode.ok) return fail(dupCode.error);
  }
  const { error } = await s
    .from("defect_groups")
    .update(code ? { code, name, is_active: data.is_active } : { name, is_active: data.is_active })
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
  return { ok: true, inactive: res.inactive, usedBy: res.usedBy };
}

// ============================================================================
// style_stock_categories  (code-only, no name column)
// ============================================================================

// StyleStockCategory, SpecialInstruction, BeamType, Design,
// DomesticProductDesign, LabTestStandard and ProductType had their CRUD here.
// All seven masters were withdrawn on 2026-08-01 (client: not applicable) and
// their tables are dropped in 0382 — LabTestStandard being the one exception,
// where the TABLE survives because Purchase ▸ Lab owns its own CRUD for it
// (see 0382 §3); only this duplicate goes.
//
// YarnComposition's CRUD stood above `defect_groups` and went the same way
// (client 2026-08-01). Nothing else in the app read `yarn_compositions`, so
// unlike LabTestStandard there is no surviving reader — the table is simply
// unreachable now, and is left in place rather than dropped.
