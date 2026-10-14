import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** One Combos ▸ Embellishments row (0722), with its process's name. */
export type SampleStyleProcessRow = {
  sno: number;
  kind: "garment" | "component";
  process_id: string;
  component_id: string | null;
  details: string | null;
  name: string;
};

/**
 * Embellishment rows by style id — read by Sample Entry's loader and Sample
 * Costing's style options.
 *
 * A SEPARATE QUERY, NOT AN EMBED, so a database without 0722 yet (a missing
 * table, PGRST205 / 42P01) answers "no embellishments" instead of failing the
 * whole screen — an embed of a missing table takes the parent read down with
 * it, which is what blanked Sample Costing on 2026-10-14 before 0722 was
 * applied. Any OTHER error throws: an empty answer there would silently drop
 * rows the entry holds and the next save would delete them.
 */
export async function listSampleStyleProcesses(s: Client, styleIds?: string[]): Promise<Map<string, SampleStyleProcessRow[]>> {
  const out = new Map<string, SampleStyleProcessRow[]>();
  if (styleIds && styleIds.length === 0) return out;
  let q = s
    .from("sample_style_processes")
    .select("style_id, sno, kind, process_id, component_id, details, process:processes!process_id(name)")
    .order("sno");
  if (styleIds) q = q.in("style_id", styleIds);
  const { data, error } = await q;
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return out;
    throw new Error(`Could not load embellishments: ${error.message}`);
  }
  for (const r of (data ?? []) as unknown as {
    style_id: string;
    sno: number;
    kind: string;
    process_id: string;
    component_id: string | null;
    details: string | null;
    process: { name: string | null } | { name: string | null }[] | null;
  }[]) {
    const proc = Array.isArray(r.process) ? r.process[0] : r.process;
    const list = out.get(r.style_id) ?? [];
    list.push({
      sno: r.sno,
      kind: r.kind === "component" ? "component" : "garment",
      process_id: r.process_id,
      component_id: r.component_id,
      details: r.details,
      name: proc?.name ?? "",
    });
    out.set(r.style_id, list);
  }
  return out;
}
