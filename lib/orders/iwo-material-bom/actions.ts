"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { today } from "@/lib/calendar";
import { isRefusal } from "@/lib/orders/material-bom/requirement";
import { iwoMaterialBomInput, type IwoMaterialBomInput, type IwoMaterialBomParsed } from "./types";
import { iwoMbProblems, iwoMbQuantity, keptIwoMbLines, keptIwoMbProcesses, type UomFacts } from "./rules";

type Result = { ok: true; bomId: string } | { ok: false; error: string };
type Db = Awaited<ReturnType<typeof createClient>>;

const PATHS = ["/orders/iwo-material-bom", "/orders/internal-work-orders"];

/** The payload's lines/processes in the rules' shape (the schema's defaults
 *  already applied, so every field is present). */
const lineFacts = (l: NonNullable<IwoMaterialBomParsed["items"]>[number]) => ({
  category_id: l.category_id,
  item_id: l.item_id,
  specification: l.specification ?? null,
  item_color_id: l.item_color_id,
  consumption_uom_id: l.consumption_uom_id,
  purchase_uom_id: l.purchase_uom_id,
  uom_conversion_id: l.uom_conversion_id,
  planned_qty: l.planned_qty,
  moq: l.moq,
  round_to: l.round_to,
  is_advised: l.is_advised,
  send_out: l.send_out,
  is_foc: l.is_foc,
});

/**
 * Write the items and processes the payload CARRIES (absent = untouched).
 *
 * THE QUANTITIES ARE COMPUTED HERE, never taken from the form — the order
 * BOM's rule. Each line's Planned Qty goes through `iwoMbQuantity` (rules.ts)
 * with the Loss % of every process row naming its material, against the unit
 * and pack masters READ HERE rather than trusted from the screen.
 *
 * Processes are written before items only in the sense that both are cleared
 * first; nothing is keyed to a line id (process rows name the MATERIAL), so a
 * delete-then-insert loses nothing.
 */
async function writeChildren(s: Db, bomId: string, p: IwoMaterialBomParsed): Promise<string | null> {
  if (!p.items && !p.processes) return null;
  if (!p.items || !p.processes) {
    // The quantity of a line depends on the process rows naming it; writing
    // one list against the other's stored copy is the preview/stored split.
    return "Items and Processes must be saved together — reopen the BOM and save again.";
  }
  // Into the rules’ shape first (every field present), then the blank filter.
  const lines = keptIwoMbLines(p.items.map(lineFacts));
  const procs = keptIwoMbProcesses(p.processes);

  const [uomRes, convRes] = await Promise.all([
    s.from("uoms").select("id, code, decimal_places_allowed"),
    s
      .from("material_uom_conversions")
      .select("id, item_id, alt_qty, alt_uom_id, base_qty, base_uom_id")
      .in("item_id", [...new Set(lines.map((l) => l.item_id))]),
  ]);
  if (uomRes.error) return `Could not read the unit master: ${uomRes.error.message}`;
  if (convRes.error) return `Could not read the pack conversions: ${convRes.error.message}`;
  const uoms = new Map(((uomRes.data ?? []) as UomFacts[]).map((u) => [u.id, u]));
  const conversions = (convRes.data ?? []) as {
    id: string;
    item_id: string;
    alt_qty: number | null;
    alt_uom_id: string | null;
    base_qty: number | null;
    base_uom_id: string | null;
  }[];

  for (const t of ["iwo_material_bom_processes", "iwo_material_bom_items"] as const) {
    const { error } = await s.from(t).delete().eq("bom_id", bomId);
    if (error) return error.message;
  }

  if (lines.length) {
    const rows = lines.map((l, i) => {
      const q = iwoMbQuantity(
        l,
        procs.filter((pr) => pr.item_id === l.item_id).map((pr) => ({ loss_pct: pr.loss_pct })),
        uoms,
        conversions,
      );
      return {
        bom_id: bomId,
        sno: i + 1,
        category_id: l.category_id,
        item_id: l.item_id,
        specification: l.specification || null,
        item_color_id: l.item_color_id,
        consumption_uom_id: l.consumption_uom_id,
        purchase_uom_id: l.purchase_uom_id,
        moq: l.moq,
        round_to: l.round_to,
        planned_qty: l.planned_qty,
        is_advised: l.is_advised,
        send_out: l.send_out,
        is_foc: l.is_foc,
        ...(isRefusal(q)
          ? { uom_conversion_id: l.uom_conversion_id, required_qty: null, purchase_qty: null, refusal_reason: q.refused }
          : {
              uom_conversion_id: q.uom_conversion_id ?? l.uom_conversion_id,
              required_qty: q.required,
              purchase_qty: q.purchase,
              refusal_reason: null,
            }),
      };
    });
    const { error } = await s.from("iwo_material_bom_items").insert(rows);
    if (error) return error.code === "23514" ? "A line names an item that is not a Sewing or Packing accessory." : error.message;
  }

  if (procs.length) {
    const { error } = await s.from("iwo_material_bom_processes").insert(
      procs.map((pr, i) => ({
        bom_id: bomId,
        sno: i + 1,
        item_id: pr.item_id,
        stage: pr.stage,
        process_id: pr.process_id,
        loss_pct: pr.loss_pct,
        vendor_id: pr.vendor_id,
      })),
    );
    if (error) return error.message;
  }
  return null;
}

/**
 * Create (`bomId` null) or update the Material BOM of one Accessories IWO.
 * The date ceiling is the order screens' (no future date); the unit is stamped
 * from the IWO by 0584's guard, which also refuses an IWO not For Accessories.
 */
export async function saveIwoMaterialBom(bomId: string | null, payload: IwoMaterialBomInput): Promise<Result> {
  if (!(await can("orders", bomId ? "edit" : "create"))) return { ok: false, error: "Forbidden" };
  const parsed = iwoMaterialBomInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const p = parsed.data;
  if (p.bom_date > today()) return { ok: false, error: "The BOM date cannot be in the future." };

  // THE SAME RULES THE SAVE BUTTON READ (rules.ts), run again here.
  if (p.items && p.processes) {
    const problem = iwoMbProblems(p.items.map(lineFacts), p.processes)[0];
    if (problem) return { ok: false, error: problem.message };
  }

  const s = await createClient();
  const header = { iwo_id: p.iwo_id, bom_date: p.bom_date, is_draft: p.is_draft, remark: p.remark || null };

  let id: string;
  if (!bomId) {
    const { data: iwo } = await s.from("internal_work_orders").select("location_id").eq("id", p.iwo_id).single();
    const { data, error } = await s
      .from("iwo_material_boms")
      // location_id is overwritten by the guard from the IWO; sent because the
      // column is NOT NULL and RLS checks it.
      .insert({ ...header, location_id: (iwo as { location_id: string | null } | null)?.location_id ?? null })
      .select("id")
      .single();
    if (error || !data) {
      return {
        ok: false,
        error:
          error?.code === "23505"
            ? "This work order already has a Material BOM — open it from the list."
            : error?.code === "23514"
              ? "A Material BOM is raised only for an Internal Work Order For Accessories."
              : (error?.message ?? "Failed to create the Material BOM"),
      };
    }
    id = data.id;
  } else {
    id = bomId;
    const { error } = await s.from("iwo_material_boms").update(header).eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  const childErr = await writeChildren(s, id, p);
  if (childErr) return { ok: false, error: childErr };

  await writeAudit({
    action: bomId ? "iwo_material_bom.updated" : "iwo_material_bom.created",
    entityType: "iwo_material_bom",
    entityId: id,
  });
  for (const path of PATHS) revalidatePath(path);
  return { ok: true, bomId: id };
}

export async function deleteIwoMaterialBom(bomId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await can("orders", "delete"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();
  // Items and processes cascade from the header.
  const { error } = await s.from("iwo_material_boms").delete().eq("id", bomId);
  if (error) return { ok: false, error: error.message };
  await writeAudit({ action: "iwo_material_bom.deleted", entityType: "iwo_material_bom", entityId: bomId });
  for (const path of PATHS) revalidatePath(path);
  return { ok: true };
}
