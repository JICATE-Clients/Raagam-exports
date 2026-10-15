import "server-only";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { withCreators } from "@/lib/created-by";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import { sampleYarnFabricReport } from "./yarn-fabric";
import { sampleAccessoriesRequirement } from "./accessories-requirement";
import type {
  AccessoriesPlanReport,
  ApprovedLine,
  ShadeLine,
  FabricPlanReport,
  FabricPlanRouteStep,
  PlanApprovalStatus,
  PlanKind,
  PlanReportHeader,
  PlanSample,
} from "./types";

/**
 * THE SAMPLE PLAN REPORTS' LOADERS (user 2026-10-13) — see ./types.ts.
 *
 * Read as the operator (RLS), from the STORED plan: the report prints what was
 * saved, never a recompute, so the approver signs the figures the purchase
 * gate will hold buyers to.
 *
 * NAMES ARE RESOLVED IN ONE BATCHED PASS, NOT BY EMBEDS. These tables point at
 * `config_lookups` three ways (stage, loss-for, type) and at `uoms` two ways
 * (consumption, purchase), so a bare embed is PGRST201-ambiguous (AGENTS.md,
 * "A second FK breaks every existing embed") — and a future FK would break a
 * named one's neighbours. Ids are gathered and looked up per table instead.
 *
 * A failed read THROWS: a report that silently drops a table reads as "this
 * plan buys nothing", which is the one answer an approver must never be shown.
 */

type Db = Awaited<ReturnType<typeof createClient>>;
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`Sample plan report: could not read ${what}: ${r.error.message}`);
  return r.data as T;
};

/** id → name for each lookup table, one query per table that has ids. */
async function namesOf(
  s: Db,
  ids: { items?: Iterable<string | null>; categories?: Iterable<string | null>; lookups?: Iterable<string | null>; processes?: Iterable<string | null>; uoms?: Iterable<string | null>; vendors?: Iterable<string | null> },
) {
  const uniq = (it?: Iterable<string | null>) => [...new Set([...(it ?? [])].filter((x): x is string => !!x))];
  const read = async (table: string, col: "name" | "code", list: string[]) => {
    if (!list.length) return new Map<string, string>();
    const rows = must(await s.from(table).select(`id, ${col}`).in("id", list), table) as unknown as { id: string; name?: string; code?: string }[];
    return new Map(rows.map((r) => [r.id, String(r[col] ?? "")]));
  };
  const [items, categories, lookups, processes, uoms, vendors] = await Promise.all([
    read("items", "name", uniq(ids.items)),
    read("categories", "name", uniq(ids.categories)),
    read("config_lookups", "name", uniq(ids.lookups)),
    read("processes", "name", uniq(ids.processes)),
    read("uoms", "code", uniq(ids.uoms)),
    read("master_vendors", "name", uniq(ids.vendors)),
  ]);
  return { items, categories, lookups, processes, uoms, vendors };
}

/** "SMP/26-27/0001 · POLO" per sample style id. */
async function samplesOf(s: Db, styleIds: Iterable<string | null>): Promise<Map<string, PlanSample>> {
  const list = [...new Set([...styleIds].filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = must(
    await s
      .from("styles")
      .select("id, sample_no, name, sample_qty, delivery_date, opp:opportunities!opportunity_id(code, title, customer:customers!customer_id(name))")
      .in("id", list),
    "the samples",
  ) as unknown as {
    id: string;
    sample_no: string | null;
    name: string | null;
    sample_qty: number | string | null;
    delivery_date: string | null;
    opp: Opp | Opp[] | null;
  }[];
  type Opp = { code: string | null; title: string | null; customer: { name: string | null } | { name: string | null }[] | null };
  return new Map(
    rows.map((r) => {
      const opp = Array.isArray(r.opp) ? r.opp[0] : r.opp;
      const cust = Array.isArray(opp?.customer) ? opp?.customer[0] : opp?.customer;
      return [
        r.id,
        {
          styleId: r.id,
          smpNo: opp?.code ?? null,
          sampleNo: r.sample_no,
          styleName: r.name ?? "",
          qty: num(r.sample_qty) ?? 0,
          deliveryDate: r.delivery_date,
          customer: cust?.name ?? opp?.title ?? null,
        },
      ];
    }),
  );
}

export const sampleLabel = (x: PlanSample | undefined) =>
  x ? [x.smpNo, x.styleName].filter(Boolean).join(" · ") || "Sample" : "—";

type HeaderRow = {
  id: string;
  iwo_id: string;
  bom_date: string | null;
  is_draft: boolean;
  location_id: string | null;
  approval_status: PlanApprovalStatus;
  revision_no: number;
  submitted_at: string | null;
  decided_at: string | null;
  decision_remark: string | null;
  approved_at: string | null;
};

/** The masthead + facts both reports share. `sampleIds` are the styles the
 *  plan's own rows name, so a sample the SWO later dropped still prints. */
async function headerOf(s: Db, kind: PlanKind, plan: HeaderRow, sampleIds: Iterable<string | null>): Promise<PlanReportHeader> {
  const groupCol = kind === "fabric" ? "iwo_id" : "accessories_iwo_id";
  const revTable = kind === "fabric" ? "iwo_fabric_bom_revisions" : "iwo_material_bom_revisions";
  // 0727: `shades` = the V0 snapshot's colour facts (null before 0727).
  const revCols =
    kind === "fabric"
      ? "revision_no, reason, raised_at, approved:approved_yarns, shades:snapshot->shades"
      : "revision_no, reason, raised_at, approved:approved_items, shades:snapshot->shades";
  const [iwoRes, groupRes, coRes, locRes, revRes] = await Promise.all([
    s.from("internal_work_orders").select("code").eq("id", plan.iwo_id).maybeSingle(),
    s.from("sample_product_groups").select("id, group_code, season, season_year, description").eq(groupCol, plan.iwo_id).maybeSingle(),
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    plan.location_id ? s.from("locations").select("name").eq("id", plan.location_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    // THE REVISION THE PLAN IS IN, by number — not the newest row: an
    // abandoned revision (0730) is newer than the version it put back.
    s.from(revTable).select(revCols).eq("bom_id", plan.id).eq("revision_no", plan.revision_no).maybeSingle(),
  ]);
  const iwo = must(iwoRes, "the work order") as { code: string | null } | null;
  const group = must(groupRes, "the SWO") as {
    id: string;
    group_code: string;
    season: string | null;
    season_year: number | null;
    description: string | null;
  } | null;
  const co = must(coRes, "the company profile") as Record<string, unknown> | null;
  const loc = must(locRes as { data: unknown; error: { message: string } | null }, "the unit") as { name: string | null } | null;
  const rev = must(revRes as { data: unknown; error: { message: string } | null }, "the revision log") as {
    revision_no: number;
    reason: string;
    raised_at: string;
    approved: ApprovedLine[];
    shades: ShadeLine[] | null;
  } | null;
  // The revised plan's colour facts, read LIVE through the same definition the
  // snapshot used — only when there is a revision to compare against.
  const shadesNow: ShadeLine[] = rev
    ? ((must(await s.rpc("sample_plan_shade_lines", { p_kind: kind, p_bom: plan.id }), "the plan's shades") as ShadeLine[] | null) ?? [])
    : [];

  // The SWO's own samples first (its batching order), then any the rows name
  // that the SWO no longer holds.
  let swoStyleIds: string[] = [];
  if (group) {
    const items = must(
      await s.from("sample_group_items").select("style_id, created_at").eq("group_id", group.id).order("created_at"),
      "the SWO's samples",
    ) as { style_id: string }[];
    swoStyleIds = items.map((i) => i.style_id);
  }
  const samples = await samplesOf(s, [...swoStyleIds, ...sampleIds]);
  const str = (k: string) => (typeof co?.[k] === "string" ? (co[k] as string) : null);
  return {
    kind,
    bomId: plan.id,
    iwoId: plan.iwo_id,
    swoCode: group?.group_code ?? null,
    iwoCode: iwo?.code ?? null,
    planDate: plan.bom_date,
    season: [group?.season, group?.season_year].filter(Boolean).join(" ") || null,
    description: group?.description ?? null,
    samples: [...new Set([...swoStyleIds, ...[...sampleIds].filter((x): x is string => !!x)])]
      .map((id) => samples.get(id))
      .filter((x): x is PlanSample => !!x),
    isDraft: plan.is_draft,
    status: plan.approval_status,
    revisionNo: plan.revision_no,
    submittedAt: plan.submitted_at,
    decidedAt: plan.decided_at,
    decisionRemark: plan.decision_remark,
    approvedAt: plan.approved_at,
    company: {
      name: str("name") ?? str("company_name"),
      unit: loc?.name ?? null,
      logo: letterheadLogoOf(co),
      address: registeredAddressOf(co),
      gstin: str("gstin"),
    },
    revision: rev
      ? { revisionNo: rev.revision_no, reason: rev.reason, raisedAt: rev.raised_at, approved: rev.approved ?? [], shadesBefore: rev.shades ?? null, shadesNow }
      : null,
  };
}

const HEADER_COLS =
  "id, iwo_id, bom_date, is_draft, location_id, approval_status, revision_no, submitted_at, decided_at, decision_remark, approved_at";

/** The Sample Fabric Plan report, or null when the plan is gone / unreadable. */
export async function fabricPlanReport(bomId: string): Promise<FabricPlanReport | null> {
  if (!(await can("sales", "view"))) return null;
  const s = await createClient();
  const plan = must(await s.from("iwo_fabric_boms").select(HEADER_COLS).eq("id", bomId).maybeSingle(), "the plan") as HeaderRow | null;
  if (!plan) return null;

  const [linesRes, yarnsRes, procsRes] = await Promise.all([
    s.from("iwo_fabric_bom_lines")
      .select("sno, sample_style_id, item_id, structure_id, stage_id, fabric_form, gsm, color_name, finish_dia, print_name, part, req_kgs")
      .eq("bom_id", bomId)
      .order("sno"),
    s.from("iwo_fabric_bom_yarns")
      .select("sno, item_id, buy_stage_id, colour_by, planned_kgs, purchase_qty, uom_id, refusal_reason, shades:iwo_fabric_bom_yarn_shades(sno, color_name, planned_kgs, purchase_qty)")
      .eq("bom_id", bomId)
      .order("sno"),
    s.from("iwo_fabric_bom_processes").select("item_id, sno, stage_id, process_id, type_id, loss_pct, color_losses").eq("bom_id", bomId),
  ]);
  type Line = {
    sno: number;
    sample_style_id: string | null;
    item_id: string;
    structure_id: string | null;
    stage_id: string | null;
    fabric_form: string | null;
    gsm: number | null;
    color_name: string | null;
    finish_dia: string | null;
    print_name: string | null;
    part: string | null;
    req_kgs: number | string | null;
  };
  type Yarn = {
    sno: number;
    item_id: string;
    buy_stage_id: string | null;
    colour_by: string | null;
    planned_kgs: number | string | null;
    purchase_qty: number | string | null;
    uom_id: string | null;
    refusal_reason: string | null;
    shades: { sno: number; color_name: string | null; planned_kgs: number | string | null; purchase_qty: number | string | null }[] | null;
  };
  type Proc = {
    item_id: string;
    sno: number;
    stage_id: string | null;
    process_id: string | null;
    type_id: string | null;
    loss_pct: number | string | null;
    color_losses: Record<string, number> | null;
  };
  const lines = must(linesRes, "the fabric lines") as Line[];
  const yarns = must(yarnsRes, "the yarns") as unknown as Yarn[];
  const procs = must(procsRes, "the fabric route") as Proc[];

  const [n, header] = await Promise.all([
    namesOf(s, {
      items: [...lines.map((l) => l.item_id), ...yarns.map((y) => y.item_id), ...procs.map((p) => p.item_id)],
      categories: lines.map((l) => l.structure_id),
      lookups: [...lines.map((l) => l.stage_id), ...yarns.map((y) => y.buy_stage_id), ...procs.flatMap((p) => [p.stage_id, p.type_id])],
      processes: procs.map((p) => p.process_id),
      uoms: yarns.map((y) => y.uom_id),
    }),
    headerOf(s, "fabric", plan, lines.map((l) => l.sample_style_id)),
  ]);
  const bySampleId = new Map(header.samples.map((x) => [x.styleId, x]));
  const label = (id: string | null) => (id ? sampleLabel(bySampleId.get(id)) : "—");

  // Sample by sample, in the SWO's order, then each sample's rows as saved.
  const order = new Map(header.samples.map((x, i) => [x.styleId, i]));
  const sorted = [...lines].sort(
    (a, b) => (order.get(a.sample_style_id ?? "") ?? 1e6) - (order.get(b.sample_style_id ?? "") ?? 1e6) || a.sno - b.sno,
  );
  const fabrics = sorted.map((l) => ({
    sample: label(l.sample_style_id),
    fabric: n.items.get(l.item_id) ?? "—",
    structure: l.structure_id ? (n.categories.get(l.structure_id) ?? null) : null,
    stage: l.stage_id ? (n.lookups.get(l.stage_id) ?? null) : null,
    form: l.fabric_form ? l.fabric_form.charAt(0).toUpperCase() + l.fabric_form.slice(1) : null,
    gsm: num(l.gsm),
    colour: l.color_name,
    dia: l.finish_dia,
    print: l.print_name,
    part: l.part,
    reqKg: num(l.req_kgs) ?? 0,
  }));
  const kgBy = new Map<string, number>();
  for (const f of fabrics) kgBy.set(f.sample, Math.round(((kgBy.get(f.sample) ?? 0) + f.reqKg) * 1000) / 1000);
  const fabricTotalKg = Math.round(fabrics.reduce((t, f) => t + f.reqKg, 0) * 1000) / 1000;

  const yarnRows = yarns.map((y) => ({
    yarn: n.items.get(y.item_id) ?? "—",
    buyStage: y.buy_stage_id ? (n.lookups.get(y.buy_stage_id) ?? null) : null,
    colourBy: y.colour_by,
    plannedKg: num(y.planned_kgs),
    purchaseQty: num(y.purchase_qty),
    uom: y.uom_id ? (n.uoms.get(y.uom_id) ?? null) : null,
    refusal: y.refusal_reason,
    shades: [...(y.shades ?? [])]
      .sort((a, b) => a.sno - b.sno)
      .map((sh) => ({ colour: sh.color_name ?? "—", plannedKg: num(sh.planned_kgs), purchaseQty: num(sh.purchase_qty) })),
  }));
  const units = new Set(yarnRows.map((y) => y.uom ?? ""));
  const yarnTotal =
    yarnRows.length && yarnRows.every((y) => y.purchaseQty != null) && units.size === 1
      ? { qty: Math.round(yarnRows.reduce((t, y) => t + (y.purchaseQty ?? 0), 0) * 1000) / 1000, uom: yarnRows[0].uom }
      : null;

  const routeBy = new Map<string, FabricPlanRouteStep[]>();
  for (const p of [...procs].sort((a, b) => a.sno - b.sno)) {
    if (!p.process_id) continue;
    const name = n.items.get(p.item_id) ?? "—";
    const list = routeBy.get(name) ?? [];
    list.push({
      stage: p.stage_id ? (n.lookups.get(p.stage_id) ?? null) : null,
      process: n.processes.get(p.process_id) ?? "—",
      type: p.type_id ? (n.lookups.get(p.type_id) ?? null) : null,
      lossPct: num(p.loss_pct),
    });
    routeBy.set(name, list);
  }

  // ---- The Order Entry format (./yarn-fabric.ts) ---------------------------
  // Process kinds and stage codes — what the order report bands and colours by.
  const stageIds = [...new Set([...procs.map((p) => p.stage_id), ...yarns.map((y) => y.buy_stage_id)].filter((x): x is string => !!x))];
  const procIds = [...new Set(procs.map((p) => p.process_id).filter((x): x is string => !!x))];
  const [kindRes, stageRes] = await Promise.all([
    procIds.length
      ? s.from("processes").select("id, is_print, is_cloth_purchase, is_dyeing").in("id", procIds)
      : Promise.resolve({ data: [], error: null }),
    stageIds.length ? s.from("config_lookups").select("id, code, name").in("id", stageIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const kinds = new Map(
    (must(kindRes as { data: unknown; error: { message: string } | null }, "the process kinds") as {
      id: string;
      is_print: boolean | null;
      is_cloth_purchase: boolean | null;
      is_dyeing: boolean | null;
    }[]).map((k) => [k.id, k]),
  );
  const stageRow = new Map(
    (must(stageRes as { data: unknown; error: { message: string } | null }, "the stages") as { id: string; code: string | null; name: string }[]).map((x) => [x.id, x]),
  );
  const swoSamples = header.samples;
  const distinct = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))];
  const dates = swoSamples.map((x) => x.deliveryDate).filter((d): d is string => !!d).sort();
  const pieces = swoSamples.reduce((t, x) => t + (x.qty ?? 0), 0);
  const requirement = sampleYarnFabricReport({
    header: {
      bomId: plan.id,
      garmentOrderId: plan.iwo_id,
      bomCode: header.iwoCode,
      bomDate: plan.bom_date,
      computedAt: null,
      // The SWO stands where an order prints its RE No.
      scNo: header.swoCode ?? header.iwoCode,
      customer: distinct(swoSamples.map((x) => x.customer)).join(", ") || null,
      orderNo: distinct(swoSamples.map((x) => x.smpNo)).join(", ") || null,
      styleRefNo: distinct(swoSamples.map((x) => x.sampleNo)).join(", ") || null,
      styleName: distinct(swoSamples.map((x) => x.styleName)).join(", ") || null,
      styleNo: null,
      deliveryFromDate: dates[0] ?? null,
      deliveryToDate: dates[dates.length - 1] ?? null,
      earlierShipmentDate: dates[0] ?? null,
      excessPct: null,
      // A sample is cut to its pieces: no excess, approval or rejection allowance.
      qty: { orderQty: pieces, excessQty: 0, rejectionQty: 0, approvalQty: 0, cutQty: pieces, approvalPct: null, rejectionPct: null },
      company: {
        name: header.company.name,
        address: header.company.address ?? null,
        unit: header.company.unit,
        gstin: header.company.gstin ?? null,
        logo: header.company.logo,
      },
    },
    lines: sorted.map((l, i) => ({ ...fabrics[i], itemId: l.item_id, stageId: l.stage_id })),
    yarns: yarns.map((y, i) => ({
      itemId: y.item_id,
      yarn: yarnRows[i].yarn,
      buyStage: y.buy_stage_id ? (stageRow.get(y.buy_stage_id) ?? null) : null,
      colourBy: y.colour_by,
      purchaseQty: yarnRows[i].purchaseQty,
      uom: yarnRows[i].uom,
      refusal: y.refusal_reason,
      shades: yarnRows[i].shades,
    })),
    steps: procs
      .filter((p): p is Proc & { process_id: string } => !!p.process_id)
      .map((p) => {
        const k = kinds.get(p.process_id);
        return {
          itemId: p.item_id,
          sno: p.sno,
          processId: p.process_id,
          processName: n.processes.get(p.process_id) ?? "(process not found)",
          isPrint: !!k?.is_print,
          isClothPurchase: !!k?.is_cloth_purchase,
          isDyeing: !!k?.is_dyeing,
          stage: p.stage_id ? (stageRow.get(p.stage_id) ?? null) : null,
          lossPct: num(p.loss_pct),
          colorLosses: p.color_losses && Object.keys(p.color_losses).length ? p.color_losses : null,
        };
      }),
  });

  return {
    header,
    fabrics,
    bySample: [...kgBy].map(([sample, kg]) => ({ sample, kg })),
    fabricTotalKg,
    yarns: yarnRows,
    yarnTotal,
    routes: [...routeBy].map(([fabric, steps]) => ({ fabric, steps })),
    requirement,
  };
}

/** The Sample Accessories Plan report, or null when the plan is gone. */
export async function accessoriesPlanReport(bomId: string): Promise<AccessoriesPlanReport | null> {
  if (!(await can("sales", "view"))) return null;
  const s = await createClient();
  const plan = must(await s.from("iwo_material_boms").select(`${HEADER_COLS}, updated_at`).eq("id", bomId).maybeSingle(), "the plan") as
    | (HeaderRow & { updated_at: string | null })
    | null;
  if (!plan) return null;

  const [itemsRes, procsRes] = await Promise.all([
    s.from("iwo_material_bom_items")
      .select(
        "id, sno, sample_style_id, category_id, item_id, specification, item_color_id, consumption_uom_id, purchase_uom_id, planned_qty, moq, round_to, " +
          "required_qty, purchase_qty, is_advised, is_foc, send_out, refusal_reason, " +
          "slices:iwo_material_bom_item_slices(sno, sample_style_id, item_color_id, size, planned_qty)",
      )
      .eq("bom_id", bomId)
      .order("sno"),
    s.from("iwo_material_bom_processes").select("sno, item_id, stage, process_id, loss_pct, vendor_id").eq("bom_id", bomId).order("sno"),
  ]);
  type Item = {
    id: string;
    sno: number;
    sample_style_id: string | null;
    category_id: string | null;
    item_id: string | null;
    specification: string | null;
    item_color_id: string | null;
    consumption_uom_id: string | null;
    purchase_uom_id: string | null;
    planned_qty: number | string | null;
    moq: number | string | null;
    round_to: number | string | null;
    required_qty: number | string | null;
    purchase_qty: number | string | null;
    is_advised: boolean | null;
    is_foc: boolean | null;
    send_out: boolean | null;
    refusal_reason: string | null;
    slices: { sno: number; sample_style_id: string | null; item_color_id: string | null; size: string | null; planned_qty: number | string | null }[] | null;
  };
  type Proc = { sno: number; item_id: string | null; stage: string | null; process_id: string | null; loss_pct: number | string | null; vendor_id: string | null };
  const items = must(itemsRes, "the accessories") as unknown as Item[];
  const procs = must(procsRes, "the accessory processes") as Proc[];
  const sliceStyles = [...items.map((i) => i.sample_style_id), ...items.flatMap((i) => (i.slices ?? []).map((sl) => sl.sample_style_id))];

  const uomIds = [...new Set(items.map((i) => i.consumption_uom_id).filter((x): x is string => !!x))];
  const [n, header, uomRes] = await Promise.all([
    namesOf(s, {
      items: [...items.map((i) => i.item_id), ...procs.map((p) => p.item_id)],
      categories: items.map((i) => i.category_id),
      lookups: [...items.map((i) => i.item_color_id), ...items.flatMap((i) => (i.slices ?? []).map((sl) => sl.item_color_id))],
      processes: procs.map((p) => p.process_id),
      uoms: items.flatMap((i) => [i.consumption_uom_id, i.purchase_uom_id]),
      vendors: procs.map((p) => p.vendor_id),
    }),
    headerOf(s, "accessories", plan, sliceStyles),
    // The unit's own precision — the order sheet prints each quantity at it.
    uomIds.length
      ? s.from("uoms").select("id, code, decimal_places_allowed").in("id", uomIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const bySampleId = new Map(header.samples.map((x) => [x.styleId, x]));

  // ---- The Order Entry format (./accessories-requirement.ts) ----------------
  const uomRows = must(uomRes as { data: unknown; error: { message: string } | null }, "the units") as {
    id: string;
    code: string;
    decimal_places_allowed: number | null;
  }[];
  const colourIds = [...items.map((i) => i.item_color_id), ...items.flatMap((i) => (i.slices ?? []).map((sl) => sl.item_color_id))];
  const requirement = sampleAccessoriesRequirement({
    header,
    savedAt: plan.updated_at,
    uoms: Object.fromEntries(uomRows.map((u) => [u.id, { code: u.code, decimals: u.decimal_places_allowed }])),
    colours: Object.fromEntries(
      colourIds.filter((x): x is string => !!x).map((id) => [id, n.lookups.get(id) ?? ""]).filter(([, name]) => name),
    ),
    lines: items
      .filter((i): i is Item & { item_id: string } => !!i.item_id)
      .map((i) => ({
        id: i.id,
        sno: i.sno,
        itemId: i.item_id,
        itemName: n.items.get(i.item_id) ?? "(item not found)",
        category: i.category_id ? (n.categories.get(i.category_id) ?? null) : null,
        specification: i.specification,
        colourId: i.item_color_id,
        consumptionUomId: i.consumption_uom_id,
        plannedQty: num(i.planned_qty),
        requiredQty: num(i.required_qty),
        refusal: i.refusal_reason,
        sampleStyleId: i.sample_style_id,
        slices: [...(i.slices ?? [])]
          .sort((a, b) => a.sno - b.sno)
          .map((sl) => ({ sampleStyleId: sl.sample_style_id, colourId: sl.item_color_id, size: sl.size, plannedQty: num(sl.planned_qty) })),
      })),
  });

  return {
    header,
    requirement,
    items: items.map((i) => ({
      sno: i.sno,
      category: i.category_id ? (n.categories.get(i.category_id) ?? null) : null,
      item: i.item_id ? (n.items.get(i.item_id) ?? "—") : "—",
      specification: i.specification,
      colour: i.item_color_id ? (n.lookups.get(i.item_color_id) ?? null) : null,
      consumptionUom: i.consumption_uom_id ? (n.uoms.get(i.consumption_uom_id) ?? null) : null,
      plannedQty: num(i.planned_qty),
      moq: num(i.moq),
      roundTo: num(i.round_to),
      requiredQty: num(i.required_qty),
      purchaseQty: num(i.purchase_qty),
      // The unit a purchase quantity is in — purchase, else consumption (the gate's own rule).
      purchaseUom: (i.purchase_uom_id ? n.uoms.get(i.purchase_uom_id) : null) ?? (i.consumption_uom_id ? (n.uoms.get(i.consumption_uom_id) ?? null) : null),
      advised: !!i.is_advised,
      foc: !!i.is_foc,
      sendOut: !!i.send_out,
      refusal: i.refusal_reason,
      // A line with no breakup rows is for its own SMP (0710) — said as one row,
      // so "by sample" counts it rather than losing it.
      breakup: (i.slices?.length
        ? [...i.slices].sort((a, b) => a.sno - b.sno)
        : i.sample_style_id
          ? [{ sno: 0, sample_style_id: i.sample_style_id, item_color_id: i.item_color_id, size: null, planned_qty: i.planned_qty }]
          : []
      ).map((sl) => ({
        sample: sl.sample_style_id ? sampleLabel(bySampleId.get(sl.sample_style_id)) : "—",
        colour: sl.item_color_id ? (n.lookups.get(sl.item_color_id) ?? null) : null,
        size: sl.size,
        qty: num(sl.planned_qty),
      })),
    })),
    processes: procs
      .filter((p) => p.process_id)
      .map((p) => ({
        item: p.item_id ? (n.items.get(p.item_id) ?? "—") : "—",
        stage: p.stage,
        process: n.processes.get(p.process_id as string) ?? "—",
        lossPct: num(p.loss_pct),
        vendor: p.vendor_id ? (n.vendors.get(p.vendor_id) ?? null) : null,
      })),
  };
}

// ---------------------------------------------------------------------------
// Sample ▸ Plan Approval's list
// ---------------------------------------------------------------------------

export type PlanApprovalRow = {
  /** `<kind>:<plan id>` — one key across both plan tables. */
  key: string;
  kind: PlanKind;
  bomId: string;
  iwoId: string;
  swoCode: string | null;
  iwoCode: string | null;
  season: string | null;
  description: string | null;
  /** The SWO's SMP numbers, in batching order. */
  smpNos: string[];
  isDraft: boolean;
  status: PlanApprovalStatus;
  revisionNo: number;
  submitted_at: string | null;
  submitted_by_name: string | null;
  decided_at: string | null;
  decision_remark: string | null;
  /** The figure an approver weighs first, per kind: kilos for a Fabric Plan
   *  (fabric required, yarn to buy), lines for an Accessories Plan. */
  figures:
    | { kind: "fabric"; fabricKg: number; yarnQty: number | null; yarnUom: string | null }
    | { kind: "accessories"; lines: number; advised: number; unpriced: number };
  created_at: string;
  created_by: string | null;
};

/**
 * EVERY SAMPLE PLAN, BOTH KINDS, at the current unit (RLS) — Order Budget
 * Approval's register shape: the work (Pending) is what the screen opens on,
 * and the rest stays listed so an approver can answer "what did I approve last
 * week?" and a planner can see what is still a Draft.
 */
export async function listPlanApprovals(): Promise<PlanApprovalRow[]> {
  const s = await createClient();
  const head =
    "id, is_draft, approval_status, revision_no, submitted_at, submitted_by, decided_at, decision_remark, created_at, created_by, " +
    "iwo:internal_work_orders!inner(id, code, is_sample)";
  const [fab, acc] = await Promise.all([
    s.from("iwo_fabric_boms")
      .select(`${head}, lines:iwo_fabric_bom_lines(req_kgs), yarns:iwo_fabric_bom_yarns(purchase_qty, uom_id)`)
      .eq("iwo.is_sample", true),
    s.from("iwo_material_boms")
      .select(`${head}, items:iwo_material_bom_items(item_id, is_advised, purchase_qty)`)
      .eq("iwo.is_sample", true),
  ]);
  type Base = {
    id: string;
    is_draft: boolean;
    approval_status: PlanApprovalStatus;
    revision_no: number;
    submitted_at: string | null;
    submitted_by: string | null;
    decided_at: string | null;
    decision_remark: string | null;
    created_at: string;
    created_by: string | null;
    iwo: { id: string; code: string | null } | { id: string; code: string | null }[];
  };
  type Fab = Base & { lines: { req_kgs: number | string | null }[]; yarns: { purchase_qty: number | string | null; uom_id: string | null }[] };
  type Acc = Base & { items: { item_id: string | null; is_advised: boolean | null; purchase_qty: number | string | null }[] };
  const fabRows = must(fab, "the Fabric Plans") as unknown as Fab[];
  const accRows = must(acc, "the Accessories Plans") as unknown as Acc[];
  const iwoOf = (r: Base) => (Array.isArray(r.iwo) ? r.iwo[0] : r.iwo);
  const iwoIds = [...fabRows, ...accRows].map((r) => iwoOf(r).id);

  type Swo = { code: string; season: string | null; description: string | null; smpNos: string[] };
  const swo = new Map<string, Swo>();
  const submitters = [...new Set([...fabRows, ...accRows].map((r) => r.submitted_by).filter((x): x is string => !!x))];
  const [groupsRes, namesRes, uomNames] = await Promise.all([
    iwoIds.length
      ? s
          .from("sample_product_groups")
          .select(
            "group_code, season, season_year, description, iwo_id, accessories_iwo_id, " +
              "items:sample_group_items(created_at, opp:opportunities!sample_entry_id(code))",
          )
          .or(`iwo_id.in.(${iwoIds.join(",")}),accessories_iwo_id.in.(${iwoIds.join(",")})`)
      : Promise.resolve({ data: [], error: null }),
    // `creator_names()` — SECURITY DEFINER, the only way to read another
    // person's name (profiles_read_own); `withCreators` does the same for created_by.
    submitters.length ? s.rpc("creator_names", { ids: submitters }) : Promise.resolve({ data: [], error: null }),
    namesOf(s, { uoms: fabRows.flatMap((r) => r.yarns.map((y) => y.uom_id)) }).then((n) => n.uoms),
  ]);
  type Group = {
    group_code: string;
    season: string | null;
    season_year: number | null;
    description: string | null;
    iwo_id: string | null;
    accessories_iwo_id: string | null;
    items: { created_at: string; opp: { code: string | null } | { code: string | null }[] | null }[] | null;
  };
  for (const g of (must(groupsRes as { data: unknown; error: { message: string } | null }, "the SWOs") ?? []) as Group[]) {
    const smpNos = [
      ...new Set(
        [...(g.items ?? [])]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((i) => (Array.isArray(i.opp) ? i.opp[0] : i.opp)?.code)
          .filter((x): x is string => !!x),
      ),
    ];
    const row: Swo = {
      code: g.group_code,
      season: [g.season, g.season_year].filter(Boolean).join(" ") || null,
      description: g.description,
      smpNos,
    };
    if (g.iwo_id) swo.set(g.iwo_id, row);
    if (g.accessories_iwo_id) swo.set(g.accessories_iwo_id, row);
  }
  const nameOf = new Map(((namesRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));

  const base = (kind: PlanKind, r: Base) => {
    const g = swo.get(iwoOf(r).id);
    return {
      key: `${kind}:${r.id}`,
      kind,
      bomId: r.id,
      iwoId: iwoOf(r).id,
      swoCode: g?.code ?? null,
      iwoCode: iwoOf(r).code,
      season: g?.season ?? null,
      description: g?.description ?? null,
      smpNos: g?.smpNos ?? [],
      isDraft: r.is_draft,
      status: r.approval_status,
      revisionNo: r.revision_no,
      submitted_at: r.submitted_at,
      submitted_by_name: r.submitted_by ? (nameOf.get(r.submitted_by) ?? null) : null,
      decided_at: r.decided_at,
      decision_remark: r.decision_remark,
      created_at: r.created_at,
      created_by: r.created_by,
    };
  };
  const rows: PlanApprovalRow[] = [
    ...fabRows.map((r) => {
      const units = new Set(r.yarns.map((y) => y.uom_id ?? ""));
      const priced = r.yarns.length > 0 && r.yarns.every((y) => y.purchase_qty != null) && units.size === 1;
      return {
        ...base("fabric", r),
        figures: {
          kind: "fabric" as const,
          fabricKg: Math.round(r.lines.reduce((t, l) => t + (Number(l.req_kgs) || 0), 0) * 1000) / 1000,
          // A total only where there is one — a refused yarn or two units print "—", never a short 0.
          yarnQty: priced ? Math.round(r.yarns.reduce((t, y) => t + Number(y.purchase_qty), 0) * 1000) / 1000 : null,
          yarnUom: priced ? (uomNames.get(r.yarns[0].uom_id ?? "") ?? null) : null,
        },
      };
    }),
    ...accRows.map((r) => {
      const lines = r.items.filter((i) => i.item_id);
      return {
        ...base("accessories", r),
        figures: {
          kind: "accessories" as const,
          lines: lines.length,
          advised: lines.filter((i) => i.is_advised).length,
          unpriced: lines.filter((i) => i.purchase_qty == null).length,
        },
      };
    }),
  ]
    // LISTED IN ENTRY ORDER (AGENTS.md / user 2026-09-22) — oldest plan first.
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return withCreators(rows);
}
