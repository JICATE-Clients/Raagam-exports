import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { unitKindLabel } from "@/lib/orders/styles/rules";
import { blendOf } from "@/lib/sales/sample-grouping/calc";
import { labelOf, SAMPLE_TYPE_OPTIONS, TECH_PACK, type PdRequestStatus } from "@/lib/sales/sample-entry/types";
import type { PdFile, PdRequestRow, PdSample, PdSmpOption, PdStyleLine } from "./types";

/**
 * Sample ▸ PD Request · PD Acknowledge — the reads (types.ts).
 *
 * A FAILED READ THROWS. An empty register reads as "nobody has asked the
 * Sample Department for anything", a real and unremarkable answer that nobody
 * reports (AGENTS.md, "A SECOND FK BREAKS EVERY EXISTING EMBED").
 *
 * Every embed below runs over a table with ONE foreign key to its target, so
 * the bare forms are unambiguous; the two that are not (`customers`, `seasons`)
 * name their column.
 */

type Num = number | string | null;
const n = (v: Num | undefined): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const sampleTypeLabel = (v: string | null | undefined) => (v ? labelOf(SAMPLE_TYPE_OPTIONS, v) : "");

type OppHead = {
  id: string;
  code: string | null;
  title: string | null;
  season: string | null;
  season_year: number | null;
  received_date: string | null;
  is_draft: boolean | null;
  customer: { name: string | null } | { name: string | null }[] | null;
  season_row: { season_name: string | null } | { season_name: string | null }[] | null;
};

const seasonOf = (o: OppHead) => {
  const name = (o.season ?? one(o.season_row)?.season_name ?? "").trim();
  return name ? [name, o.season_year].filter(Boolean).join(" ") : null;
};
const customerOf = (o: OppHead) => one(o.customer)?.name ?? o.title ?? null;
const HEAD = "id, code, title, season, season_year, received_date, is_draft, customer:customers!customer_id(name), season_row:seasons!season_id(season_name)";

// ---------------------------------------------------------------------------
// The register — every request; per SMP (0724), one SWO request from 0723
// ---------------------------------------------------------------------------
type StyleBrief = { name: string | null; sample_type: string | null; sample_qty: Num; delivery_date: string | null };
type OppBrief = OppHead & { styles: StyleBrief[] | null };
type GroupHead = {
  id: string;
  group_code: string | null;
  description: string | null;
  season: string | null;
  season_year: number | null;
  items: { style_id: string; style: (StyleBrief & { opp: OppHead | null }) | null }[] | null;
};
const GROUP_HEAD =
  "id, group_code, description, season, season_year, " +
  `items:sample_group_items(style_id, style:styles!style_id(name, sample_type, sample_qty, delivery_date, opp:opportunities!opportunity_id(${HEAD})))`;

const groupSeason = (g: GroupHead) => [(g.season ?? "").trim(), g.season_year].filter(Boolean).join(" ") || null;
const uniq = <T,>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => x != null && x !== ""))];

/** The distinct styles of an SWO — an item is one FABRIC of a style, so a
 *  two-fabric style appears twice in `items`. */
function groupStyles(g: GroupHead) {
  const seen = new Map<string, StyleBrief & { opp: OppHead | null }>();
  for (const it of g.items ?? []) if (it.style && !seen.has(it.style_id)) seen.set(it.style_id, it.style);
  return [...seen.values()];
}

type RequestDb = {
  id: string;
  opportunity_id: string | null;
  group_id: string | null;
  status: PdRequestStatus;
  note: string | null;
  decision_remark: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
  created_by: string | null;
  opp: OppBrief | null;
  grp: GroupHead | null;
};

export async function listPdRequests(): Promise<PdRequestRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("sample_pd_requests")
    .select(
      "id, opportunity_id, group_id, status, note, decision_remark, decided_at, decided_by, created_at, created_by, " +
        `opp:opportunities!opportunity_id(${HEAD}, styles(name, sample_type, sample_qty, delivery_date)), ` +
        `grp:sample_product_groups!group_id(${GROUP_HEAD})`,
    )
    // Listings in ENTRY order (STANDING 09-22).
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load the PD Requests: ${error.message}`);
  const raw = (data ?? []) as unknown as RequestDb[];

  // Who decided — `creator_names()`, never a profiles embed (lib/created-by.ts).
  const deciders = [...new Set(raw.map((r) => r.decided_by).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (deciders.length) {
    const { data: nm } = await s.rpc("creator_names", { ids: deciders });
    for (const p of (nm ?? []) as { id: string; full_name: string | null }[]) if (p.full_name) names.set(p.id, p.full_name);
  }

  const rows = raw.map((r): PdRequestRow => {
    // An SMP request reads its sample; the 0723 SWO request its group.
    const styles: (StyleBrief & { opp: OppHead | null })[] = r.grp
      ? groupStyles(r.grp)
      : (r.opp?.styles ?? []).map((x) => ({ ...x, opp: r.opp }));
    const opps = uniq(styles.map((x) => x.opp?.id)).map((id) => styles.find((x) => x.opp?.id === id)!.opp as OppHead);
    if (!r.grp && r.opp && !opps.length) opps.push(r.opp);
    const dates = styles.map((x) => x.delivery_date).filter((d): d is string => !!d).sort();
    return {
      id: r.id,
      opportunity_id: r.opportunity_id,
      group_id: r.group_id,
      swo_no: r.grp?.group_code ?? null,
      smp_nos: uniq(opps.map((o) => o.code)),
      customer: uniq(opps.map(customerOf)).join(", ") || null,
      season: r.grp ? groupSeason(r.grp) : r.opp ? seasonOf(r.opp) : null,
      style_names: styles.map((x) => (x.name ?? "").trim()).filter(Boolean),
      sample_types: uniq(styles.map((x) => sampleTypeLabel(x.sample_type))),
      pieces: styles.reduce((t, x) => t + (n(x.sample_qty) ?? 0), 0),
      target_date: dates[0] ?? null,
      status: r.status,
      note: r.note,
      decision_remark: r.decision_remark,
      decided_at: r.decided_at,
      decided_by_name: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
      created_at: r.created_at,
      created_by: r.created_by,
    };
  });
  return withCreators(rows);
}

// ---------------------------------------------------------------------------
// The SMPs — the Pending cards and the SMP No picker
// ---------------------------------------------------------------------------
/**
 * Every SAVED sample entry with at least one style (a draft has no SMP number
 * yet, and a request with nothing in it asks the department for nothing).
 * Its latest request is joined on the screen from `listPdRequests`, which
 * already reads every request — so this is one read, not a second embed.
 */
export async function listPdSmpOptions(): Promise<PdSmpOption[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("opportunities")
    .select(`${HEAD}, created_at, created_by, styles(name, sample_type, sample_qty, delivery_date)`)
    .not("is_draft", "is", true)
    .not("code", "is", null)
    // Listings in ENTRY order (STANDING 09-22).
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load the sample entries: ${error.message}`);
  type Row = OppBrief & { created_at: string; created_by: string | null };
  const rows = ((data ?? []) as unknown as Row[])
    .filter((o) => (o.styles ?? []).length > 0)
    .map((o): PdSmpOption => {
      const styles = o.styles ?? [];
      const dates = styles.map((x) => x.delivery_date).filter((d): d is string => !!d).sort();
      return {
        id: o.id,
        smp_no: o.code as string,
        customer: customerOf(o),
        season: seasonOf(o),
        style_names: styles.map((x) => (x.name ?? "").trim()).filter(Boolean),
        sample_types: uniq(styles.map((x) => sampleTypeLabel(x.sample_type))),
        pieces: styles.reduce((t, x) => t + (n(x.sample_qty) ?? 0), 0),
        target_date: dates[0] ?? null,
        created_at: o.created_at,
        created_by: o.created_by,
      };
    });
  return withCreators(rows);
}

// ---------------------------------------------------------------------------
// One SMP (or the 0723 request's SWO), as the request shows it
// ---------------------------------------------------------------------------
type StyleDb = {
  id: string;
  sno: number | null;
  sample_no: string | null;
  name: string | null;
  article_no: string | null;
  sample_type: string | null;
  sample_qty: Num;
  unit_kind: string | null;
  delivery_date: string | null;
  tech_pack: string | null;
  fabric_structure_id: string | null;
  gsm: Num;
  structures: { sno: number; structure_id: string | null; gsm: Num }[] | null;
  files: { sno: number; doc_kind: string | null; file_name: string; storage_path: string }[] | null;
  combos: { sno: number; combo: string | null; sizes: { sno: number; garment_size: string | null; order_qty: Num }[] | null }[] | null;
};

type CostDb = {
  version: number;
  style_id: string;
  fabrics:
    | {
        sno: number;
        quality: string | null;
        structure: { name: string | null } | { name: string | null }[] | null;
        yarns: { sno: number; yarn_name: string | null; mix_pct: Num; item: { name: string | null } | { name: string | null }[] | null }[] | null;
      }[]
    | null;
};

/**
 * THE SAMPLE, FETCHED — every style of the SMP (0724; the 0723 SWO request
 * reads every SMP in its SWO). The
 * spec's "auto-fills directly from the selected Sample Entry so the
 * merchandiser does not re-type anything". Read
 * live, not copied onto the request: the Sample Department works from the
 * sample as it stands, and a correction on Sample Entry reaches them without a
 * second request.
 *
 * Composition comes from the line's CURRENT costing (its yarn mix, as Grouping
 * reads it — `blendOf`). A style is grouped only once costed, so an SWO's
 * lines carry one; null survives for a 0719 request raised before costing.
 */
export async function readPdSample(subject: { groupId: string } | { opportunityId: string }): Promise<PdSample | null> {
  const s = await createClient();
  type Group = { id: string; group_code: string | null; description: string | null; season: string | null; season_year: number | null };
  let group = null as Group | null;
  let styleQuery = s
    .from("styles")
    .select(
      "id, sno, sample_no, name, article_no, sample_type, sample_qty, unit_kind, delivery_date, tech_pack, " +
        "fabric_structure_id, gsm, structures:sample_style_fabric_structures(sno, structure_id, gsm), " +
        "files:sample_style_files(sno, doc_kind, file_name, storage_path), " +
        "combos:style_combos(sno, combo, sizes:style_combo_sizes(sno, garment_size, order_qty)), " +
        `opp:opportunities!opportunity_id(${HEAD})`,
    );
  if ("groupId" in subject) {
    const { data: g, error: gErr } = await s
      .from("sample_product_groups")
      .select("id, group_code, description, season, season_year, items:sample_group_items(style_id)")
      .eq("id", subject.groupId)
      .maybeSingle();
    if (gErr) throw new Error(`Could not load the SWO: ${gErr.message}`);
    if (!g) return null;
    const row = g as unknown as Group & { items: { style_id: string }[] | null };
    group = row;
    styleQuery = styleQuery.in("id", uniq((row.items ?? []).map((x) => x.style_id)));
  } else {
    styleQuery = styleQuery.eq("opportunity_id", subject.opportunityId);
  }
  const { data, error } = await styleQuery;
  if (error) throw new Error(`Could not load the samples: ${error.message}`);
  const raw = (data ?? []) as unknown as (StyleDb & { opp: OppHead | null })[];
  if (!group && !raw.length) return null;
  // SMP order, then the line's own order inside it.
  const styles = [...raw].sort(
    (a, b) => (a.opp?.code ?? "").localeCompare(b.opp?.code ?? "") || (a.sno ?? 0) - (b.sno ?? 0),
  );
  const opps = uniq(styles.map((x) => x.opp?.id)).map((id) => styles.find((x) => x.opp?.id === id)!.opp as OppHead);
  const styleIds = styles.map((x) => x.id);

  // Structure names in one read — a line saved before 0715 names its one
  // structure on `styles.fabric_structure_id`.
  const structureIds = new Set<string>();
  for (const st of styles) {
    for (const f of st.structures ?? []) if (f.structure_id) structureIds.add(f.structure_id);
    if (st.fabric_structure_id) structureIds.add(st.fabric_structure_id);
  }

  const [cats, costs] = await Promise.all([
    structureIds.size
      ? s.from("categories").select("id, name").in("id", [...structureIds])
      : Promise.resolve({ data: [], error: null }),
    styleIds.length
      ? s
          .from("cost_sheets")
          .select(
            "version, style_id, fabrics:sample_costing_fabrics(sno, quality, structure:categories!fabric_id(name), " +
              "yarns:sample_costing_fabric_yarns(sno, yarn_name, mix_pct, item:items!item_id(name)))",
          )
          .eq("costing_type", "sample")
          .neq("status", "superseded")
          .not("is_draft", "is", true)
          .in("style_id", styleIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cats.error) throw new Error(`Could not load the fabric structures: ${cats.error.message}`);
  if (costs.error) throw new Error(`Could not load the costings: ${costs.error.message}`);
  const catName = new Map(((cats.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  // The current costing per line: its highest saved revision (Grouping's rule).
  const current = new Map<string, CostDb>();
  for (const c of (costs.data ?? []) as unknown as CostDb[]) {
    const held = current.get(c.style_id);
    if (!held || c.version > held.version) current.set(c.style_id, c);
  }
  const compositionOf = (styleId: string): string | null => {
    const c = current.get(styleId);
    if (!c) return null;
    const labels = [...(c.fabrics ?? [])]
      .sort((a, b) => a.sno - b.sno)
      .map(
        (f) =>
          blendOf(
            [...(f.yarns ?? [])].sort((a, b) => a.sno - b.sno).map((y) => ({ name: one(y.item)?.name ?? y.yarn_name, mix_pct: y.mix_pct })),
            f.quality,
            one(f.structure)?.name ?? null,
          ).label,
      )
      .filter(Boolean);
    return labels.length ? [...new Set(labels)].join(" · ") : null;
  };

  const lines: PdStyleLine[] = styles.map((st) => {
    const rows = [...(st.structures ?? [])].sort((a, b) => a.sno - b.sno).filter((f) => !!f.structure_id);
    const fabrics = rows.length
      ? rows.map((f) => ({ structure: catName.get(f.structure_id as string) ?? "—", gsm: n(f.gsm) }))
      : st.fabric_structure_id
        ? [{ structure: catName.get(st.fabric_structure_id) ?? "—", gsm: n(st.gsm) }]
        : [];
    return {
      id: st.id,
      smp_no: st.opp?.code ?? null,
      sample_no: st.sample_no,
      name: (st.name ?? "").trim(),
      article_no: (st.article_no ?? "").trim(),
      sample_type: sampleTypeLabel(st.sample_type),
      sample_qty: n(st.sample_qty) ?? 0,
      unit: unitKindLabel(st.unit_kind) ?? "",
      delivery_date: st.delivery_date,
      fabrics,
      composition: compositionOf(st.id),
      // A combo with no pieces typed asks the department for nothing, so it is left out.
      combos: [...(st.combos ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .map((c) => ({
          combo: (c.combo ?? "").trim(),
          sizes: [...(c.sizes ?? [])]
            .sort((a, b) => a.sno - b.sno)
            .map((z) => ({ size: (z.garment_size ?? "").trim(), qty: n(z.order_qty) ?? 0 }))
            .filter((z) => z.size && z.qty > 0),
        }))
        .filter((c) => c.sizes.length),
    };
  });

  // THE TECH PACK, CARRIED FORWARD — signed in ONE storage call (the bucket is
  // private, 0686). A file that will not sign is listed without a link, never
  // a failed request.
  const stored = styles.flatMap((st) =>
    [...(st.files ?? [])]
      .sort((a, b) => a.sno - b.sno)
      .map((f) => ({ style: [st.opp?.code, (st.name ?? "").trim() || st.sample_no].filter(Boolean).join(" · "), f })),
  );
  const signed = new Map<string, string>();
  if (stored.length) {
    const { data: urls } = await s.storage.from("sample-docs").createSignedUrls(
      stored.map((x) => x.f.storage_path),
      60 * 60,
    );
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }
  const files: PdFile[] = stored
    // Tech packs first: they are what the department builds from.
    .sort((a, b) => Number(a.f.doc_kind !== "tech_pack") - Number(b.f.doc_kind !== "tech_pack"))
    .map(({ style, f }) => ({
      style,
      kind: f.doc_kind === "tech_pack" ? "Tech Pack" : "Garment Image",
      file_name: f.file_name,
      url: signed.get(f.storage_path) ?? null,
    }));

  const techPack = styles.find((x) => !!x.tech_pack)?.tech_pack ?? null;
  return {
    group_id: group?.id ?? null,
    swo_no: group?.group_code ?? null,
    description: (group?.description ?? "").trim() || null,
    smp_nos: uniq(opps.map((o) => o.code)),
    customer: uniq(opps.map(customerOf)).join(", ") || null,
    season: group ? [(group.season ?? "").trim(), group.season_year].filter(Boolean).join(" ") || null : opps[0] ? seasonOf(opps[0]) : null,
    tech_pack: techPack ? labelOf(TECH_PACK, techPack) : null,
    styles: lines,
    files,
    total_pieces: lines.reduce((t, x) => t + x.sample_qty, 0),
  };
}
