import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { blendOf, styleFabricKg, type StoredWeight } from "./calc";
import {
  candidateKey,
  GROUP_STATUSES,
  type GroupingCandidate,
  type GroupingData,
  type GroupItemRow,
  type GroupRow,
  type GroupStatus,
} from "./types";

/**
 * Sample ▸ Grouping — what the screen and the actions read.
 *
 * NOTHING ABOUT A STYLE'S KILOS IS TYPED HERE. A candidate is one fabric of a
 * style's CURRENT costing (the newest saved revision, not superseded, not a
 * draft): its structure and yarn blend from the costing's Fabric step, its
 * kilos from the costing's Garment weight table × the pieces Sample Entry
 * asks for. Change the costing and the candidate follows; a Draft group's
 * styles follow with it, and stop following once the group is approved.
 *
 * A FAILED READ THROWS. An empty candidate list reads as "nothing to batch",
 * which nobody would report (the "failed query is not an empty list" rule).
 */

type Num = number | string | null;
const n = (v: Num | undefined): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type StyleDb = {
  id: string;
  opportunity_id: string;
  sample_no: string | null;
  name: string | null;
  sample_qty: Num;
  gsm: Num;
  opp: {
    id: string;
    code: string | null;
    season: string | null;
    season_id: string | null;
    season_year: number | null;
    is_draft: boolean | null;
    season_row: { season_name: string | null } | { season_name: string | null }[] | null;
    customer: { name: string | null } | { name: string | null }[] | null;
    agent: { name: string | null } | { name: string | null }[] | null;
  } | null;
  combos: { sizes: { garment_size: string | null; order_qty: Num }[] | null }[] | null;
  files: { sno: number; storage_path: string; mime_type: string | null }[] | null;
};

type CostDb = {
  id: string;
  code: string | null;
  version: number;
  style_id: string | null;
  fabrics:
    | {
        id: string;
        sno: number;
        fabric_id: string | null;
        quality: string | null;
        structure: { name: string | null } | { name: string | null }[] | null;
        yarns: { sno: number; yarn_name: string | null; mix_pct: Num; item: { name: string | null } | { name: string | null }[] | null }[] | null;
      }[]
    | null;
  weights: (StoredWeight & { component_id: string | null; component_ids: string[] | null })[] | null;
};

type GroupDb = {
  id: string;
  group_code: string;
  season: string;
  season_year: number;
  fabric_structure_id: string | null;
  fabric_structure: string | null;
  yarn_blend: string;
  blend_key: string;
  moq_kg: Num;
  batch_kg: Num;
  cutting_waste_pct: Num;
  net_required_weight_kg: Num;
  moq_purchased_weight_kg: Num;
  status: string;
  iwo_id: string | null;
  remarks: string | null;
  created_at: string;
  created_by: string | null;
  iwo: { code: string | null } | { code: string | null }[] | null;
  items:
    | {
        id: string;
        style_id: string;
        sample_entry_id: string;
        fabric_structure_id: string | null;
        blend_key: string;
        component_name: string;
        sample_qty_pcs: number;
        calculated_weight_kg: Num;
        allocated_fabric_kg: Num;
        created_at: string;
      }[]
    | null;
};

async function readStyles(): Promise<StyleDb[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("styles")
    .select(
      "id, opportunity_id, sample_no, name, sample_qty, gsm, " +
        "opp:opportunities!opportunity_id(id, code, season, season_id, season_year, is_draft, " +
        "season_row:seasons!season_id(season_name), customer:customers!customer_id(name), agent:master_vendors!agent_id(name)), " +
        "combos:style_combos(sizes:style_combo_sizes(garment_size, order_qty)), " +
        "files:sample_style_files(sno, storage_path, mime_type)",
    )
    .not("opportunity_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load sample styles: ${error.message}`);
  return (data ?? []) as unknown as StyleDb[];
}

async function readCostings(): Promise<CostDb[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("cost_sheets")
    .select(
      "id, code, version, style_id, " +
        "fabrics:sample_costing_fabrics(id, sno, fabric_id, quality, structure:categories!fabric_id(name), " +
        "yarns:sample_costing_fabric_yarns(sno, yarn_name, mix_pct, item:items!item_id(name))), " +
        "weights:sample_costing_component_weights(fabric_line_id, component_id, component_ids, size_name, weight_g, length_cm, width_cm, gsm, wastage_pct)",
    )
    .eq("costing_type", "sample")
    .neq("status", "superseded")
    .not("is_draft", "is", true)
    .not("style_id", "is", null);
  if (error) throw new Error(`Could not load sample costings: ${error.message}`);
  return (data ?? []) as unknown as CostDb[];
}

async function readComponents(): Promise<Map<string, string>> {
  const s = await createClient();
  const { data, error } = await s.from("components").select("id, short_name, description");
  if (error) throw new Error(`Could not load components: ${error.message}`);
  return new Map(
    ((data ?? []) as { id: string; short_name: string | null; description: string | null }[]).map((c) => [c.id, c.description ?? c.short_name ?? ""]),
  );
}

async function readGroups(): Promise<GroupDb[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("sample_product_groups")
    .select(
      "id, group_code, season, season_year, fabric_structure_id, fabric_structure, yarn_blend, blend_key, moq_kg, batch_kg, " +
        "cutting_waste_pct, net_required_weight_kg, moq_purchased_weight_kg, status, iwo_id, remarks, created_at, created_by, " +
        "iwo:internal_work_orders!iwo_id(code), " +
        "items:sample_group_items(id, style_id, sample_entry_id, fabric_structure_id, blend_key, component_name, sample_qty_pcs, calculated_weight_kg, allocated_fabric_kg, created_at)",
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load sample groups: ${error.message}`);
  return (data ?? []) as unknown as GroupDb[];
}

/** First garment image per style, signed in ONE storage call (the bucket is private, 0686). */
async function signThumbs(styles: StyleDb[]): Promise<Map<string, string>> {
  const path = new Map<string, string>();
  for (const st of styles) {
    const img = [...(st.files ?? [])].sort((a, b) => a.sno - b.sno).find((f) => (f.mime_type ?? "").startsWith("image/"));
    if (img) path.set(st.id, img.storage_path);
  }
  const out = new Map<string, string>();
  if (!path.size) return out;
  const s = await createClient();
  // A thumbnail that will not sign is a missing picture, never a failed page.
  const { data } = await s.storage.from("sample-docs").createSignedUrls([...path.values()], 60 * 60);
  const byPath = new Map((data ?? []).filter((u) => u.path && u.signedUrl).map((u) => [u.path as string, u.signedUrl as string]));
  for (const [styleId, p] of path) {
    const url = byPath.get(p);
    if (url) out.set(styleId, url);
  }
  return out;
}

const seasonOf = (o: StyleDb["opp"]) => (o?.season ?? one(o?.season_row)?.season_name ?? "").trim();

/** The pieces Sample Entry asks for: its Combos' size split, else the Sample Qty. */
function piecesOf(st: StyleDb): { bySize: Record<string, number>; total: number } {
  const bySize: Record<string, number> = {};
  for (const c of st.combos ?? []) {
    for (const z of c.sizes ?? []) {
      const size = (z.garment_size ?? "").trim();
      const q = n(z.order_qty) ?? 0;
      if (size && q > 0) bySize[size] = (bySize[size] ?? 0) + q;
    }
  }
  const split = Object.values(bySize).reduce((t, q) => t + q, 0);
  return { bySize, total: split > 0 ? split : Math.max(0, n(st.sample_qty) ?? 0) };
}

/** Every candidate, every group and the styles not yet costed — one read. */
export async function getGroupingData(): Promise<GroupingData> {
  const [styles, costings, components, groupsDb] = await Promise.all([readStyles(), readCostings(), readComponents(), readGroups()]);
  const thumbs = await signThumbs(styles);

  // The current costing per style: its highest saved revision.
  const current = new Map<string, CostDb>();
  for (const c of costings) {
    if (!c.style_id) continue;
    const held = current.get(c.style_id);
    if (!held || c.version > held.version) current.set(c.style_id, c);
  }

  // Which group holds which candidate.
  const heldBy = new Map<string, { id: string; code: string }>();
  for (const g of groupsDb) {
    for (const it of g.items ?? []) heldBy.set(candidateKey(it.style_id, it.fabric_structure_id, it.blend_key), { id: g.id, code: g.group_code });
  }

  const candidates: GroupingCandidate[] = [];
  const uncosted: GroupingData["uncosted"] = [];
  const styleById = new Map(styles.map((st) => [st.id, st]));

  for (const st of styles) {
    const o = st.opp;
    if (!o || o.is_draft) continue;
    const costing = current.get(st.id);
    if (!costing) {
      uncosted.push({ style_id: st.id, sample_no: st.sample_no, style_name: st.name ?? "", season: seasonOf(o), season_year: o.season_year });
      continue;
    }
    const pieces = piecesOf(st);
    const weights = costing.weights ?? [];
    const byKey = new Map<string, GroupingCandidate & { compSet: Set<string> }>();
    for (const f of [...(costing.fabrics ?? [])].sort((a, b) => a.sno - b.sno)) {
      const structure = one(f.structure)?.name ?? null;
      const blend = blendOf(
        [...(f.yarns ?? [])].sort((a, b) => a.sno - b.sno).map((y) => ({ name: one(y.item)?.name ?? y.yarn_name, mix_pct: y.mix_pct })),
        f.quality,
        structure,
      );
      if (!blend.key) continue;
      const kg = styleFabricKg(weights, f.id, pieces);
      const comps = new Set<string>();
      for (const w of weights) {
        if (w.fabric_line_id !== f.id) continue;
        const ids = w.component_ids?.length ? w.component_ids : w.component_id ? [w.component_id] : [];
        for (const id of ids) {
          const name = components.get(id);
          if (name) comps.add(name);
        }
      }
      const key = candidateKey(st.id, f.fabric_id, blend.key);
      const held = byKey.get(key);
      if (held) {
        // Two lines of one structure + blend on one costing are one purchase.
        held.kg = held.kg == null ? kg : kg == null ? held.kg : Math.round((held.kg + kg) * 1000) / 1000;
        for (const c of comps) held.compSet.add(c);
        continue;
      }
      const group = heldBy.get(key) ?? null;
      byKey.set(key, {
        key,
        style_id: st.id,
        sample_entry_id: o.id,
        enquiry_no: o.code,
        sample_no: st.sample_no,
        style_name: st.name ?? "",
        thumb_url: thumbs.get(st.id) ?? null,
        customer: one(o.customer)?.name ?? null,
        agent: one(o.agent)?.name ?? null,
        season: seasonOf(o),
        season_id: o.season_id,
        season_year: o.season_year,
        fabric_structure_id: f.fabric_id,
        fabric_structure: structure,
        gsm: n(st.gsm),
        yarn_blend: blend.label,
        blend_key: blend.key,
        components: "",
        compSet: comps,
        sample_qty_pcs: pieces.total,
        kg,
        cost_sheet_id: costing.id,
        costing_code: costing.code,
        group_id: group?.id ?? null,
        group_code: group?.code ?? null,
      });
    }
    for (const { compSet, ...c } of byKey.values()) candidates.push({ ...c, components: [...compSet].join(", ") });
  }

  const candByKey = new Map(candidates.map((c) => [c.key, c]));
  const groups: GroupRow[] = groupsDb.map((g) => {
    const status = (GROUP_STATUSES as readonly string[]).includes(g.status) ? (g.status as GroupStatus) : "draft";
    const items: GroupItemRow[] = (g.items ?? [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((it) => {
        const st = styleById.get(it.style_id);
        const live = candByKey.get(candidateKey(it.style_id, it.fabric_structure_id, it.blend_key)) ?? null;
        return {
          id: it.id,
          style_id: it.style_id,
          sample_entry_id: it.sample_entry_id,
          enquiry_no: st?.opp?.code ?? null,
          sample_no: st?.sample_no ?? null,
          style_name: st?.name ?? "",
          customer: one(st?.opp?.customer)?.name ?? null,
          components: status === "draft" && live ? live.components : it.component_name,
          sample_qty_pcs: status === "draft" && live ? live.sample_qty_pcs : it.sample_qty_pcs,
          calculated_weight_kg: n(it.calculated_weight_kg) ?? 0,
          allocated_fabric_kg: n(it.allocated_fabric_kg),
          live_kg: live?.kg ?? null,
          live_missing: !live || live.kg == null,
        };
      });
    return {
      id: g.id,
      group_code: g.group_code,
      season: g.season,
      season_year: g.season_year,
      fabric_structure_id: g.fabric_structure_id,
      fabric_structure: g.fabric_structure,
      yarn_blend: g.yarn_blend,
      blend_key: g.blend_key,
      moq_kg: n(g.moq_kg) ?? 0,
      batch_kg: n(g.batch_kg) ?? 0,
      cutting_waste_pct: n(g.cutting_waste_pct) ?? 0,
      net_required_weight_kg: n(g.net_required_weight_kg) ?? 0,
      moq_purchased_weight_kg: n(g.moq_purchased_weight_kg) ?? 0,
      status,
      iwo_id: g.iwo_id,
      iwo_code: one(g.iwo)?.code ?? null,
      remarks: g.remarks,
      created_at: g.created_at,
      created_by: g.created_by,
      items,
    };
  });

  return { candidates, groups: await withCreators(groups), uncosted };
}
