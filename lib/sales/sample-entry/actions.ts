"use server";

/**
 * Sample Entry — server actions (0683).
 *
 * NO TYPE RE-EXPORTS from this file: a `"use server"` module that re-exports a
 * type crashes at runtime with "X is not defined" while tsc passes it (memory:
 * "use server" type re-export crashes). Types live in ./types.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { sampleEntryInput, type SampleEntryInput, type SampleEntryRecord } from "./types";
import { getSampleEntryRecord } from "./service";

type SaveResult = { ok: true; id: string; code: string | null } | { ok: false; error: string };
type ActionResult = { ok: true } | { ok: false; error: string };

const LIST_PATH = "/sales/sample-entry";

export async function saveSampleEntry(id: string | null, payload: SampleEntryInput): Promise<SaveResult> {
  if (!(await can("sales", id ? "edit" : "create"))) return { ok: false, error: "Forbidden" };
  const parsed = sampleEntryInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_sample_entry", { p_id: id, p: parsed.data });
  if (error) return { ok: false, error: error.message };
  const out = data as { id: string; code: string | null } | null;
  if (!out?.id) return { ok: false, error: "The sample entry was not saved." };

  await writeAudit({
    action: id ? "sample_entry.updated" : "sample_entry.created",
    entityType: "opportunity",
    entityId: out.id,
  });
  revalidatePath(LIST_PATH);
  return { ok: true, id: out.id, code: out.code };
}

/** The editor opens a saved entry through this — one nested select. */
export async function loadSampleEntry(
  id: string,
): Promise<{ ok: true; record: SampleEntryRecord } | { ok: false; error: string }> {
  if (!(await can("sales", "view"))) return { ok: false, error: "Forbidden" };
  try {
    const record = await getSampleEntryRecord(id);
    if (!record) return { ok: false, error: "This sample entry no longer exists." };
    return { ok: true, record };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load the sample entry." };
  }
}

/**
 * What a new Enquiry No / Sample No would be — a PREDICTION for the read-only
 * box, not a reservation (the IWO box's rule, 0580).
 */
export async function previewSampleNumbers(
  on: string | null,
  sampleCount: number,
): Promise<{ enquiryNo: string | null; sampleNos: string[] }> {
  if (!(await can("sales", "create"))) return { enquiryNo: null, sampleNos: [] };
  const supabase = await createClient();
  const p_on = on && on.trim() ? on : null;
  const [opp, prd] = await Promise.all([
    supabase.rpc("peek_sample_number", { p_series: "SMP", p_on }),
    supabase.rpc("peek_sample_number", { p_series: "PRD", p_on: null }),
  ]);
  const enquiryNo = typeof opp.data === "string" ? opp.data : null;
  const first = typeof prd.data === "string" ? prd.data : null;
  // The style lines of ONE save take consecutive numbers from the first free one.
  const m = first?.match(/^(.*\/)(\d+)$/);
  const sampleNos = m
    ? Array.from({ length: Math.max(0, sampleCount) }, (_, i) => `${m[1]}${String(Number(m[2]) + i).padStart(4, "0")}`)
    : [];
  return { enquiryNo, sampleNos };
}

export async function deleteSampleEntry(id: string): Promise<ActionResult> {
  if (!(await can("sales", "delete"))) return { ok: false, error: "Forbidden" };
  const supabase = await createClient();
  const { error, count } = await supabase.from("opportunities").delete({ count: "exact" }).eq("id", id);
  if (error?.code === "23503") {
    return {
      ok: false,
      error: "A sales order or quote costing has been raised against this enquiry, so it cannot be deleted.",
    };
  }
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "This sample entry was not deleted — it may already be gone." };
  await writeAudit({ action: "sample_entry.deleted", entityType: "opportunity", entityId: id });
  revalidatePath(LIST_PATH);
  return { ok: true };
}
