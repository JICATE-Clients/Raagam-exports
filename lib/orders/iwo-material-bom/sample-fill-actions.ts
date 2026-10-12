"use server";

import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import type { SwoTrimSample } from "./sample-fill";

/**
 * THE SWO's SAMPLES AND THEIR COSTING TRIMS — what "fill from costing" reads
 * (user 2026-10-12). Resolved from the ACCESSORIES work order
 * (`sample_product_groups.accessories_iwo_id`, 0709) — never `iwo_id`, which
 * is the SWO's FABRIC work order.
 *
 * Each sample's CURRENT costing is the Grouping rule: its highest saved,
 * non-superseded, non-draft sample costing. Its pieces are the ones the SWO
 * batched (`sample_group_items.sample_qty_pcs`). Read only — nothing here
 * writes; the screen fills the grid and Save stores it.
 *
 * A FAILED READ IS AN ERROR, NOT "NO TRIMS": an empty answer would read as
 * "these samples use no accessories".
 */
export type SwoSampleTrims = {
  swo_code: string;
  samples: (SwoTrimSample & { smp_no: string | null; style_name: string })[];
  /** Each trim material's category — the grid's Category cell. */
  category_of: Record<string, string | null>;
};

export async function loadSwoCostingTrims(
  iwoId: string,
): Promise<{ ok: true; data: SwoSampleTrims } | { ok: false; error: string }> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const s = await createClient();

  const { data: g, error: gErr } = await s
    .from("sample_product_groups")
    .select(
      "group_code, items:sample_group_items(style_id, sample_qty_pcs, created_at, " +
        "style:styles!style_id(name), opp:opportunities!sample_entry_id(code))",
    )
    .eq("accessories_iwo_id", iwoId)
    .maybeSingle();
  if (gErr) return { ok: false, error: `Could not read the SWO: ${gErr.message}` };
  if (!g) return { ok: false, error: "This work order was not raised for an SWO — there is no costing to fill from." };
  type One<T> = T | T[] | null;
  const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const group = g as unknown as {
    group_code: string;
    items: { style_id: string; sample_qty_pcs: number; created_at: string; style: One<{ name: string | null }>; opp: One<{ code: string | null }> }[] | null;
  };

  // One entry per sample style; a style batched in two fabrics is two items with the same pieces.
  const byStyle = new Map<string, { pieces: number; smp_no: string | null; style_name: string }>();
  for (const it of [...(group.items ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const held = byStyle.get(it.style_id);
    if (held) {
      held.pieces = Math.max(held.pieces, it.sample_qty_pcs ?? 0);
      continue;
    }
    byStyle.set(it.style_id, { pieces: it.sample_qty_pcs ?? 0, smp_no: one(it.opp)?.code ?? null, style_name: one(it.style)?.name ?? "" });
  }
  const styleIds = [...byStyle.keys()];
  if (!styleIds.length) return { ok: true, data: { swo_code: group.group_code, samples: [], category_of: {} } };

  const { data: sheets, error: cErr } = await s
    .from("cost_sheets")
    .select("id, version, style_id, trims:sample_costing_trims(sno, item_id, description, qty)")
    .eq("costing_type", "sample")
    .neq("status", "superseded")
    .not("is_draft", "is", true)
    .in("style_id", styleIds);
  if (cErr) return { ok: false, error: `Could not read the costings: ${cErr.message}` };
  type Sheet = { id: string; version: number; style_id: string; trims: { sno: number; item_id: string | null; description: string | null; qty: number | string | null }[] | null };
  const current = new Map<string, Sheet>();
  for (const c of (sheets ?? []) as unknown as Sheet[]) {
    const held = current.get(c.style_id);
    if (!held || c.version > held.version) current.set(c.style_id, c);
  }

  const samples: SwoSampleTrims["samples"] = styleIds.map((id) => {
    const st = byStyle.get(id)!;
    const sheet = current.get(id);
    return {
      style_id: id,
      smp_no: st.smp_no,
      style_name: st.style_name,
      label: [st.smp_no, st.style_name].filter(Boolean).join(" · ") || "Sample",
      pieces: st.pieces,
      trims: [...(sheet?.trims ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .map((t) => ({ item_id: t.item_id, description: t.description, qty: t.qty == null ? null : Number(t.qty) })),
    };
  });

  const itemIds = [...new Set(samples.flatMap((x) => x.trims.map((t) => t.item_id)).filter((x): x is string => !!x))];
  const category_of: Record<string, string | null> = {};
  if (itemIds.length) {
    const { data: items, error: iErr } = await s.from("items").select("id, category_id").in("id", itemIds);
    if (iErr) return { ok: false, error: `Could not read the trim materials: ${iErr.message}` };
    for (const it of (items ?? []) as { id: string; category_id: string | null }[]) category_of[it.id] = it.category_id;
  }
  return { ok: true, data: { swo_code: group.group_code, samples, category_of } };
}
