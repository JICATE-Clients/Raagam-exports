"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { today } from "@/lib/calendar";
import { kgUomOf } from "./service";
import { dyeingWorkOrderLines, type DyeingRouteStep } from "./dyeing";

/**
 * RAISE THE DYEING WORK ORDER for a sample work order (client decision
 * 2026-10-12, the SWO workflow): one Stores process order of type DYEING,
 * linked to the IW (0708 `iwo_id`), one line per (fabric, colour) its plan
 * dyes — Issue Qty the GREIGE weight, Return Qty the finished (`dyeing.ts`).
 *
 * THE SERVER COMPUTES IT, FROM THE SAVED PLAN. The screen previews with the
 * same `dyeingWorkOrderLines`, but only the vendor and the date are sent: the
 * weights, the losses and which colours are dyed are re-read here, so an
 * unsaved edit or a stale tab cannot put a figure on a document the dye house
 * invoices against.
 *
 * It is a Stores document, so it needs Stores ▸ Create — the same gate the
 * Process Orders screen's own create answers to. One OPEN dyeing order per
 * work order: a second while the first is live would send the same cloth
 * twice. Cancel it on Stores ▸ Process Orders to raise again.
 */

type Result = { ok: true; orderId: string; code: string | null } | { ok: false; error: string };

export async function raiseIwoDyeingOrder(
  iwoId: string,
  input: { vendor_id: string; expected_date: string | null },
): Promise<Result> {
  if (!(await can("stores", "create"))) {
    return { ok: false, error: "Raising a dyeing work order needs Stores ▸ Create — ask someone who raises process orders." };
  }
  if (!input.vendor_id) return { ok: false, error: "Choose the dye house." };
  const s = await createClient();

  const { data: iwo, error: iwoErr } = await s
    .from("internal_work_orders")
    .select(
      "id, code, location_id, iwo_for, " +
        "bom:iwo_fabric_boms(is_draft, lines:iwo_fabric_bom_lines(item_id, color_name, req_kgs), " +
        "steps:iwo_fabric_bom_processes(item_id, process_id, loss_pct, color_losses))",
    )
    .eq("id", iwoId)
    .maybeSingle();
  if (iwoErr) return { ok: false, error: iwoErr.message };
  type Bom = {
    is_draft: boolean | null;
    lines: { item_id: string; color_name: string | null; req_kgs: number | string | null }[] | null;
    steps: { item_id: string; process_id: string | null; loss_pct: number | string | null; color_losses: Record<string, number> | null }[] | null;
  };
  const row = iwo as unknown as { id: string; code: string | null; location_id: string | null; bom: Bom | Bom[] | null } | null;
  if (!row) return { ok: false, error: "This work order no longer exists." };
  const bom = Array.isArray(row.bom) ? (row.bom[0] ?? null) : row.bom;
  if (!bom) return { ok: false, error: "Save this work order's Fabric Plan first — the dyeing order is computed from it." };
  if (bom.is_draft) return { ok: false, error: "The Fabric Plan is a draft — save it (not as a draft) before raising its dyeing order." };

  const steps: DyeingRouteStep[] = (bom.steps ?? []).map((st) => ({
    item_id: st.item_id,
    process_id: st.process_id,
    loss_pct: st.loss_pct == null ? null : Number(st.loss_pct),
    color_losses: st.color_losses,
  }));
  const processIds = [...new Set(steps.map((st) => st.process_id).filter((x): x is string => !!x))];
  const dyeing = new Set<string>();
  if (processIds.length) {
    const { data, error } = await s.from("processes").select("id, is_dyeing").in("id", processIds);
    // A failed read refuses: an empty set would read every route as "never dyes".
    if (error) return { ok: false, error: `Could not read the processes: ${error.message}` };
    for (const p of (data ?? []) as { id: string; is_dyeing: boolean | null }[]) if (p.is_dyeing) dyeing.add(p.id);
  }
  const lines = dyeingWorkOrderLines(
    (bom.lines ?? []).map((l) => ({ item_id: l.item_id, color_name: l.color_name, req_kgs: l.req_kgs == null ? null : Number(l.req_kgs) })),
    steps,
    (id) => dyeing.has(id),
  );
  if (!lines.length) {
    return {
      ok: false,
      error: "Nothing on this plan is dyed — a dyeing order needs a coloured line on a fabric whose Fabric Process route has a DYEING step.",
    };
  }

  const { data: open, error: openErr } = await s
    .from("process_orders")
    .select("code")
    .eq("iwo_id", iwoId)
    .eq("process_type", "dyeing")
    .neq("status", "cancelled")
    .limit(1);
  if (openErr) return { ok: false, error: openErr.message };
  const held = (open ?? [])[0] as { code: string | null } | undefined;
  if (held) {
    return { ok: false, error: `This work order already has dyeing order ${held.code ?? ""} — cancel it on Stores ▸ Process Orders to raise a new one.` };
  }

  const [{ data: names, error: nameErr }, kg, { data: swo }] = await Promise.all([
    s.from("items").select("id, name").in("id", [...new Set(lines.map((l) => l.item_id))]),
    kgUomOf(s),
    s.from("sample_product_groups").select("group_code").eq("iwo_id", iwoId).maybeSingle(),
  ]);
  if (nameErr) return { ok: false, error: nameErr.message };
  const nameOf = new Map(((names ?? []) as { id: string; name: string | null }[]).map((n) => [n.id, n.name ?? ""]));
  const swoCode = (swo as { group_code: string } | null)?.group_code ?? null;

  const { data: po, error } = await s
    .from("process_orders")
    .insert({
      vendor_id: input.vendor_id,
      location_id: row.location_id,
      process_type: "dyeing",
      iwo_id: iwoId,
      status: "draft",
      order_date: today(),
      expected_date: input.expected_date || null,
      total_amount: 0,
      notes: `DYEING FOR ${swoCode ? `${swoCode} / ` : ""}${row.code ?? "WORK ORDER"} — ISSUE QTY = GREIGE WEIGHT, RETURN QTY = FINISHED WEIGHT.`,
    })
    .select("id, code")
    .single();
  if (error || !po) return { ok: false, error: error?.message ?? "Could not raise the dyeing order." };
  const order = po as { id: string; code: string | null };

  const { error: lineErr } = await s.from("process_order_lines").insert(
    lines.map((l, i) => ({
      process_order_id: order.id,
      item_id: l.item_id,
      description: `${nameOf.get(l.item_id) || "FABRIC"} · ${l.color_name} (DYEING LOSS ${l.loss_pct}%)`,
      sent_qty: l.greige_kg,
      return_qty: l.finished_kg,
      received_qty: 0,
      uom_id: kg?.id ?? null,
      rate: 0,
      amount: 0,
      sort_order: i,
    })),
  );
  if (lineErr) {
    // A header with no lines is a dyeing order for nothing — take it back.
    await s.from("process_orders").delete().eq("id", order.id);
    return { ok: false, error: lineErr.message };
  }

  await writeAudit({ action: "process_order.created_from_iwo", entityType: "process_order", entityId: order.id });
  revalidatePath("/stores/process-orders");
  revalidatePath("/sales/sample-fabric-plan");
  revalidatePath("/orders/iwo-fabric-bom");
  return { ok: true, orderId: order.id, code: order.code };
}
