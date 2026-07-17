"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { certificationInput, type CertificationInput } from "./certification-types";
import { checkDuplicateName } from "./dup-guard";

type Failure = { ok: false; error: string };
type Result = { ok: true } | Failure;
type CreateResult = { ok: true; id: string } | Failure;

function fail(msg: string): Failure {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/masters");
  revalidatePath("/masters/associates");
  revalidatePath("/masters/associates/certifications");
}

export async function createCertification(
  data: CertificationInput,
  children: { valid_from: string | null; valid_to: string | null }[],
): Promise<CreateResult> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = certificationInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "certifications", p.data.certification_name, {
    nameColumn: "certification_name",
  });
  if (!dup.ok) return fail(dup.error);
  const { data: row, error } = await s
    .from("certifications")
    .insert(p.data)
    .select("id")
    .single();
  if (error) return fail(error.message);
  if (children.length > 0) {
    const { error: childErr } = await s.from("certification_validities").insert(
      children.map((c) => ({ certification_id: row.id, ...c })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function updateCertification(
  id: string,
  data: CertificationInput,
  children: { valid_from: string | null; valid_to: string | null }[],
): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = certificationInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const dup = await checkDuplicateName(s, "certifications", p.data.certification_name, {
    nameColumn: "certification_name",
    excludeId: id,
  });
  if (!dup.ok) return fail(dup.error);
  const { error } = await s.from("certifications").update(p.data).eq("id", id);
  if (error) return fail(error.message);
  // Replace children wholesale
  await s.from("certification_validities").delete().eq("certification_id", id);
  if (children.length > 0) {
    const { error: childErr } = await s.from("certification_validities").insert(
      children.map((c) => ({ certification_id: id, ...c })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true };
}

export async function deactivateCertification(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("certifications").update({ inactive: true }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
