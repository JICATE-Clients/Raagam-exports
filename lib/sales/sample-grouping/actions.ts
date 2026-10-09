"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { today } from "@/lib/calendar";
import { saveInternalWorkOrder } from "@/lib/orders/internal-work-orders/actions";
import {
  DEFAULT_BATCH_KG,
  DEFAULT_MOQ_KG,
  distributeProblem,
  fmtKg,
  groupNetKg,
  groupingProblem,
  moqOrderWeight,
  releasedCuttingKg,
  sameGroupKey,
} from "./calc";
import { getGroupingData } from "./service";
import { candidateKey, GROUP_STATUS_LABEL, groupTermsInput, type GroupingCandidate, type GroupRow, type GroupStatus, type GroupTermsInput } from "./types";

/**
 * Sample ▸ Grouping — every write.
 *
 * THE SERVER WEIGHS EVERY STYLE ITSELF. The screen sends candidate KEYS, never
 * kilos: each action re-reads the costings (`getGroupingData`) and takes the
 * figures from there, so a stale tab cannot batch yesterday's weight.
 *
 * A GROUP MOVES FORWARD ONE STEP AT A TIME — Draft → Approved → IW raised →
 * Fabric received → Completed — and every status write is conditional on the
 * status it expects (`.eq("status", from)`), so two operators pressing the
 * same button cannot both move it. The database refuses the rest (0702): a
 * group past Draft keeps its styles and cannot be deleted.
 */

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string; code: string } | { ok: false; error: string };

const PATH = "/sales/sample-grouping";
const labelOf = (c: GroupingCandidate) => [c.sample_no, c.style_name].filter(Boolean).join(" · ") || "This style";

function pick(all: GroupingCandidate[], keys: readonly string[]): GroupingCandidate[] | string {
  const byKey = new Map(all.map((c) => [c.key, c]));
  const out: GroupingCandidate[] = [];
  for (const k of new Set(keys)) {
    const c = byKey.get(k);
    if (!c) return "A style picked is no longer costed in that fabric — refresh the page and pick again.";
    out.push(c);
  }
  return out;
}

const forProblem = (cs: GroupingCandidate[]) => groupingProblem(cs.map((c) => ({ ...c, label: labelOf(c) })));

async function groupById(id: string): Promise<{ data: Awaited<ReturnType<typeof getGroupingData>>; group: GroupRow } | string> {
  const data = await getGroupingData();
  const group = data.groups.find((g) => g.id === id);
  return group ? { data, group } : "This group no longer exists.";
}

/**
 * Bring a Draft group's styles and totals up to its costings: each style's
 * kilos, pieces and components from its candidate, then the group's net and
 * MOQ purchase. A style whose candidate has gone keeps its last figures —
 * Approve refuses it until it is removed or re-costed.
 */
async function refreshDraft(g: GroupRow, all: GroupingCandidate[]): Promise<string | null> {
  if (g.status !== "draft") return null;
  const s = await createClient();
  const byKey = new Map(all.map((c) => [c.key, c]));
  const kg: number[] = [];
  for (const it of g.items) {
    const c = byKey.get(candidateKey(it.style_id, g.fabric_structure_id, g.blend_key));
    if (!c || c.kg == null) {
      kg.push(it.calculated_weight_kg);
      continue;
    }
    kg.push(c.kg);
    if (c.kg !== it.calculated_weight_kg || c.sample_qty_pcs !== it.sample_qty_pcs || c.components !== it.components) {
      const { error } = await s
        .from("sample_group_items")
        .update({
          calculated_weight_kg: c.kg,
          sample_qty_pcs: Math.round(c.sample_qty_pcs),
          component_name: c.components,
          cost_sheet_id: c.cost_sheet_id,
        })
        .eq("id", it.id);
      if (error) return error.message;
    }
  }
  const net = groupNetKg(kg);
  const { error } = await s
    .from("sample_product_groups")
    .update({ net_required_weight_kg: net, moq_purchased_weight_kg: moqOrderWeight(net, g.moq_kg, g.batch_kg) })
    .eq("id", g.id)
    .eq("status", "draft");
  return error ? error.message : null;
}

async function moveStatus(id: string, from: GroupStatus, to: GroupStatus, patch: Record<string, unknown> = {}): Promise<Result> {
  const s = await createClient();
  const { data, error } = await s
    .from("sample_product_groups")
    .update({ status: to, ...patch })
    .eq("id", id)
    .eq("status", from)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: `This group is no longer ${GROUP_STATUS_LABEL[from]} — refresh to see where it is.` };
  await writeAudit({ action: `sample_group.${to}`, entityType: "sample_product_group", entityId: id });
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Create / add / remove — Draft only
// ---------------------------------------------------------------------------
export async function createSampleGroup(keys: string[]): Promise<CreateResult> {
  if (!(await can("sales", "create"))) return { ok: false, error: "You do not have permission to create a sample group." };
  const data = await getGroupingData();
  const picked = pick(data.candidates, keys);
  if (typeof picked === "string") return { ok: false, error: picked };
  const problem = forProblem(picked);
  if (problem) return { ok: false, error: problem };

  const first = picked[0];
  const net = groupNetKg(picked.map((c) => c.kg));
  const s = await createClient();
  const { data: res, error } = await s.rpc("create_sample_group", {
    p: {
      header: {
        season_id: first.season_id,
        season: first.season,
        season_year: first.season_year,
        fabric_structure_id: first.fabric_structure_id,
        fabric_structure: first.fabric_structure,
        yarn_blend: first.yarn_blend,
        blend_key: first.blend_key,
        moq_kg: DEFAULT_MOQ_KG,
        batch_kg: DEFAULT_BATCH_KG,
        net_required_weight_kg: net,
        moq_purchased_weight_kg: moqOrderWeight(net, DEFAULT_MOQ_KG, DEFAULT_BATCH_KG),
      },
      items: picked.map((c) => ({
        sample_entry_id: c.sample_entry_id,
        style_id: c.style_id,
        cost_sheet_id: c.cost_sheet_id,
        fabric_structure_id: c.fabric_structure_id,
        blend_key: c.blend_key,
        component_name: c.components,
        sample_qty_pcs: c.sample_qty_pcs,
        calculated_weight_kg: c.kg,
      })),
    },
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "One of these styles was grouped a moment ago — refresh and pick again." };
    return { ok: false, error: error.message };
  }
  const out = res as { id: string; code: string };
  await writeAudit({ action: "sample_group.created", entityType: "sample_product_group", entityId: out.id });
  revalidatePath(PATH);
  return { ok: true, id: out.id, code: out.code };
}

export async function addToSampleGroup(groupId: string, keys: string[]): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to change a sample group." };
  const found = await groupById(groupId);
  if (typeof found === "string") return { ok: false, error: found };
  const { data, group } = found;
  if (group.status !== "draft") return { ok: false, error: `${group.group_code} is ${GROUP_STATUS_LABEL[group.status]} — styles can be added only while it is Draft.` };
  const picked = pick(data.candidates, keys);
  if (typeof picked === "string") return { ok: false, error: picked };
  const problem = forProblem(picked);
  if (problem) return { ok: false, error: problem };
  if (!sameGroupKey(picked[0], group)) {
    return { ok: false, error: `${group.group_code} is ${group.fabric_structure ?? "another structure"} · ${group.yarn_blend} for ${group.season} ${group.season_year} — these styles do not match it.` };
  }
  const s = await createClient();
  const { error } = await s.from("sample_group_items").insert(
    picked.map((c) => ({
      group_id: group.id,
      sample_entry_id: c.sample_entry_id,
      style_id: c.style_id,
      cost_sheet_id: c.cost_sheet_id,
      fabric_structure_id: c.fabric_structure_id,
      blend_key: c.blend_key,
      component_name: c.components,
      sample_qty_pcs: Math.round(c.sample_qty_pcs),
      calculated_weight_kg: c.kg,
    })),
  );
  if (error) {
    if (error.code === "23505") return { ok: false, error: "One of these styles was grouped a moment ago — refresh and pick again." };
    return { ok: false, error: error.message };
  }
  const after = await groupById(groupId);
  if (typeof after !== "string") {
    const err = await refreshDraft(after.group, after.data.candidates);
    if (err) return { ok: false, error: err };
  }
  await writeAudit({ action: "sample_group.styles_added", entityType: "sample_product_group", entityId: groupId });
  revalidatePath(PATH);
  return { ok: true };
}

export async function removeFromSampleGroup(groupId: string, itemId: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to change a sample group." };
  const found = await groupById(groupId);
  if (typeof found === "string") return { ok: false, error: found };
  const { data, group } = found;
  if (group.status !== "draft") return { ok: false, error: `${group.group_code} is past Draft — its styles can no longer change.` };
  if (group.items.length <= 1) return { ok: false, error: "This is the group's only style — delete the group instead." };
  const s = await createClient();
  const { error } = await s.from("sample_group_items").delete().eq("id", itemId).eq("group_id", groupId);
  if (error) return { ok: false, error: error.message };
  const err = await refreshDraft({ ...group, items: group.items.filter((it) => it.id !== itemId) }, data.candidates);
  if (err) return { ok: false, error: err };
  await writeAudit({ action: "sample_group.style_removed", entityType: "sample_product_group", entityId: groupId });
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * The group's terms. MOQ and batch decide the PURCHASE, so they change only
 * while Draft; cutting waste and remarks decide the RELEASE, so they stay open
 * until the fabric has been distributed.
 */
export async function saveSampleGroupTerms(groupId: string, terms: GroupTermsInput): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to change a sample group." };
  const parsed = groupTermsInput.safeParse(terms);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the group's terms." };
  const t = parsed.data;
  const found = await groupById(groupId);
  if (typeof found === "string") return { ok: false, error: found };
  const { data, group } = found;
  if (group.status === "completed") return { ok: false, error: `${group.group_code} is Completed — its fabric has been distributed.` };
  const s = await createClient();
  const purchaseOpen = group.status === "draft";
  const patch = purchaseOpen
    ? { moq_kg: t.moq_kg, batch_kg: t.batch_kg, cutting_waste_pct: t.cutting_waste_pct, remarks: t.remarks }
    : { cutting_waste_pct: t.cutting_waste_pct, remarks: t.remarks };
  if (!purchaseOpen && (t.moq_kg !== group.moq_kg || t.batch_kg !== group.batch_kg)) {
    return { ok: false, error: "MOQ and batch fixed the purchase when the group was approved — they can no longer change." };
  }
  const { error } = await s.from("sample_product_groups").update(patch).eq("id", groupId).eq("status", group.status);
  if (error) return { ok: false, error: error.message };
  if (purchaseOpen) {
    const err = await refreshDraft({ ...group, moq_kg: t.moq_kg, batch_kg: t.batch_kg }, data.candidates);
    if (err) return { ok: false, error: err };
  }
  await writeAudit({ action: "sample_group.updated", entityType: "sample_product_group", entityId: groupId });
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteSampleGroup(groupId: string): Promise<Result> {
  if (!(await can("sales", "delete"))) return { ok: false, error: "You do not have permission to delete a sample group." };
  const s = await createClient();
  const { data, error } = await s.from("sample_product_groups").delete().eq("id", groupId).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "This group no longer exists." };
  await writeAudit({ action: "sample_group.deleted", entityType: "sample_product_group", entityId: groupId });
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The status steps
// ---------------------------------------------------------------------------
/** Freeze the batch: every style weighed from its costing one last time. */
export async function approveSampleGroup(groupId: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to approve a sample group." };
  const found = await groupById(groupId);
  if (typeof found === "string") return { ok: false, error: found };
  const { data, group } = found;
  if (group.status !== "draft") return { ok: false, error: `${group.group_code} is already ${GROUP_STATUS_LABEL[group.status]}.` };
  if (!group.items.length) return { ok: false, error: "A group needs at least one style." };
  const missing = group.items.find((it) => it.live_missing);
  if (missing) {
    return {
      ok: false,
      error: `${[missing.sample_no, missing.style_name].filter(Boolean).join(" · ")} is no longer costed in ${group.fabric_structure ?? "this fabric"} · ${group.yarn_blend} — remove it, or fix its costing.`,
    };
  }
  const err = await refreshDraft(group, data.candidates);
  if (err) return { ok: false, error: err };
  return moveStatus(groupId, "draft", "approved", { approved_at: new Date().toISOString() });
}

/** Approved → Draft, while no IW has been raised against it. */
export async function reopenSampleGroup(groupId: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to change a sample group." };
  return moveStatus(groupId, "approved", "draft", { approved_at: null });
}

/**
 * Raise the Internal Work Order the yarn and knitting are planned on (spec §6,
 * "trigger IW generation for Yarn & Knitting"): a FABRIC IW — the IW Fabric BOM
 * is where its yarn purchase and knitting are planned — referenced by the
 * group code, delivery by the earliest sample, the batch in its remarks.
 * Created through the IW screen's own action, so it takes the session's unit
 * and needs Orders ▸ Create like any IW.
 */
export async function raiseSampleGroupIw(groupId: string): Promise<{ ok: true; iwoId: string } | { ok: false; error: string }> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to change a sample group." };
  if (!(await can("orders", "create"))) return { ok: false, error: "Raising an IW needs Orders ▸ Create — ask someone who can raise work orders." };
  const found = await groupById(groupId);
  if (typeof found === "string") return { ok: false, error: found };
  const { group } = found;
  if (group.status !== "approved") return { ok: false, error: "Approve the group before raising its IW." };
  if (group.iwo_id) return { ok: false, error: `${group.group_code} already has IW ${group.iwo_code ?? ""}.` };

  const s = await createClient();
  const { data: dates } = await s
    .from("styles")
    .select("delivery_date")
    .in("id", group.items.map((it) => it.style_id))
    .not("delivery_date", "is", null)
    .order("delivery_date", { ascending: true })
    .limit(1);
  const deli = (dates?.[0] as { delivery_date: string } | undefined)?.delivery_date ?? null;
  const styles = group.items.map((it) => it.sample_no ?? it.style_name).filter(Boolean).join(", ");
  const remarks =
    `SAMPLE GROUP ${group.group_code}: ${group.fabric_structure ?? ""} · ${group.yarn_blend} — ` +
    `NET ${fmtKg(group.net_required_weight_kg)} KG, BUY ${fmtKg(group.moq_purchased_weight_kg)} KG. STYLES: ${styles}`;

  const iw = await saveInternalWorkOrder(null, {
    iwo_date: today(),
    iwo_for: "fabric",
    reference_no: group.group_code,
    deli_date: deli,
    remarks: remarks.slice(0, 1000),
  });
  if (!iw.ok) return iw;
  const moved = await moveStatus(groupId, "approved", "po_raised", { iwo_id: iw.iwoId });
  if (!moved.ok) return moved;
  return { ok: true, iwoId: iw.iwoId };
}

/**
 * APPROVE & RAISE IW — one click (user 2026-10-09: "combine it into a single
 * 'Approve & Raise IW' button"). The two steps stay two steps underneath, in
 * order, so the IW is still only ever raised for an APPROVED group.
 *
 * The IW permission is asked FIRST: without Orders ▸ Create the group would be
 * approved and then stop, frozen with no IW and nobody told why up front. If
 * the IW itself then fails, the group is left Approved — a real, consistent
 * state whose own "Raise IW" retries just that half — and the message says so.
 */
export async function approveAndRaiseSampleGroupIw(
  groupId: string,
): Promise<{ ok: true; iwoId: string } | { ok: false; error: string }> {
  if (!(await can("orders", "create"))) {
    return { ok: false, error: "Raising an IW needs Orders ▸ Create — approve the group on its own, and ask someone who can raise work orders." };
  }
  const approved = await approveSampleGroup(groupId);
  if (!approved.ok) return approved;
  const raised = await raiseSampleGroupIw(groupId);
  if (!raised.ok) return { ok: false, error: `The group is approved, but its IW was not raised: ${raised.error} Use Raise IW to try again.` };
  return raised;
}

export async function markSampleGroupFabricReceived(groupId: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to change a sample group." };
  return moveStatus(groupId, "po_raised", "fabric_received", { fabric_received_at: new Date().toISOString() });
}

/**
 * §5.3 — release each style's cutting weight (its kilos × (1 + cutting waste
 * %)); what is left stays in the sample fabric stock. Refused when the
 * purchase cannot cover the release, rather than allocating fabric that was
 * never bought.
 */
export async function distributeSampleGroup(groupId: string): Promise<Result> {
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to change a sample group." };
  const found = await groupById(groupId);
  if (typeof found === "string") return { ok: false, error: found };
  const { group } = found;
  if (group.status !== "fabric_received") return { ok: false, error: "Mark the fabric received before distributing it." };
  const kg = group.items.map((it) => it.calculated_weight_kg);
  const problem = distributeProblem(group.moq_purchased_weight_kg, kg, group.cutting_waste_pct);
  if (problem) return { ok: false, error: problem };
  const s = await createClient();
  for (const it of group.items) {
    const { error } = await s
      .from("sample_group_items")
      .update({ allocated_fabric_kg: releasedCuttingKg(it.calculated_weight_kg, group.cutting_waste_pct) })
      .eq("id", it.id);
    if (error) return { ok: false, error: error.message };
  }
  return moveStatus(groupId, "fabric_received", "completed", { distributed_at: new Date().toISOString() });
}
