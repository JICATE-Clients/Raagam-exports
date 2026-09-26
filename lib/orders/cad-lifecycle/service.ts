import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { styleKey } from "@/lib/orders/amendments/style-key";
import {
  cadStateOf,
  cutKey,
  type CadDecision,
  type CadDispatch,
  type CadStyleRow,
  type CadType,
  type CadVersion,
  type ComponentCut,
  type CutType,
  type LayoutType,
  type PatternStatus,
  type StyleComponent,
  type PatternMakerRow,
} from "./types";

/**
 * Orders ▸ CAD ▸ CAD Lifecycle — the reads (0628).
 *
 * ## ONE ROW PER (ORDER, STYLE), BUILT FROM TWO READS
 *
 * The orders with their styles, and every CAD version with its dispatch, files
 * and decision. Joined here on `styleKey` (trim + upper) — never on a style row
 * id, which is re-minted on every order save (0461, 0479).
 *
 * ## A FAILED READ THROWS
 *
 * "A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST" (AGENTS.md, the PGRST201
 * section). An empty CAD listing reads as "nothing to do", which is exactly the
 * answer a broken embed would give — so an error here reaches the route's
 * error boundary instead of an empty table.
 *
 * ## THE EMBEDS NAME THEIR COLUMN WHERE THEY MUST
 *
 * `employees` points at `config_lookups` FOUR times (category, department,
 * designation, team), so the designation embed is `!designation_id`. The rest
 * are single links today (checked against the catalog, 2026-09-24).
 */

const ORDER_SELECT =
  "id, code, po_no, delivery_date, created_at, created_by, " +
  "customer:customers(id, name, cad_review_days), " +
  "sales_order:sales_orders(id, order_number), " +
  "styles:garment_order_amendment_styles(sno, style_ref_no, style_description, layout_type), " +
  // 0632's Cut Method rows. One FK each way (checked against the catalog, 2026-09-25).
  // `components` has no `name` — the label every other screen shows is `short_name`.
  "components:garment_order_amendment_style_components(sno, style_ref_no, component_id, coordinate_id, fabric_category_id, " +
  "component:components(short_name), coordinate:items!coordinate_id(name), " +
  "structure:categories!fabric_category_id(name)), " +
  // 0638's Order Sheet view: the style's sizes, and GSM per structure from its combos.
  "sizes:garment_order_amendment_style_sizes(style_ref_no, sno, size_id, size:config_lookups!size_id(name)), " +
  "combos:garment_order_amendment_combos(style_ref_no, structures:garment_order_amendment_combo_structures(structure_id, gsm, " +
  "parts:garment_order_amendment_combo_components(color_name)))";

const VERSION_SELECT =
  "id, garment_order_id, style_ref_no, version_no, pattern_maker_id, cad_type, allocation_date, " +
  "target_date, remarks, fit_wash, length_shrink_pct, width_shrink_pct, cut_type, component_cuts, pattern_status, " +
  "pattern_date, is_submitted, created_at, created_by, " +
  // 0640 — the Pattern Maker's sheet. Every FK on the table is single (catalog, 2026-09-25).
  "lines:order_cad_pattern_lines(sno, coordinate_id, component_id, fabric_category_id, gsm, colour, size_id, " +
  "table_dia, width_form, avg_pcs_weight_g, remark, size_wise, coordinate:items!coordinate_id(name), " +
  "component:components!component_id(short_name), fabric:categories!fabric_category_id(name), " +
  "size:config_lookups!size_id(name), " +
  // 0643 — the line's parts. One FK each to items / components (catalog, 2026-09-25).
  "parts:order_cad_pattern_line_parts(sno, coordinate_id, component_id, " +
  "coordinate:items!coordinate_id(name), component:components!component_id(short_name)), " +
  // 0644 — the line's colours and sizes. One FK each (catalog, 2026-09-25).
  "colours:order_cad_pattern_line_colours(sno, colour), " +
  "sizes:order_cad_pattern_line_sizes(sno, size_id, table_dia, avg_pcs_weight_g, size:config_lookups!size_id(name))), " +
  "pattern_maker:employees!pattern_maker_id(name), " +
  "dispatch:order_cad_dispatches(id, dispatch_date, courier_tracking_no, email_sent_at, layout_type, " +
  "expected_approval_date, remarks, " +
  "files:order_cad_dispatch_files(id, kind, file_name, storage_path, extension, size_bytes), " +
  "approval:order_cad_approvals(status, decided_on, buyer_comments))";

type OrderLite = {
  id: string;
  code: string | null;
  po_no: string | null;
  delivery_date: string | null;
  created_at: string | null;
  created_by: string | null;
  customer: { id: string; name: string; cad_review_days: number | null } | null;
  sales_order: { id: string; order_number: string | null } | null;
  styles:
    | { sno: number | null; style_ref_no: string | null; style_description: string | null; layout_type: string | null }[]
    | null;
  components:
    | {
        sno: number | null;
        style_ref_no: string | null;
        component_id: string | null;
        coordinate_id: string | null;
        component: One<{ short_name: string | null }>;
        coordinate: One<{ name: string | null }>;
        structure: One<{ name: string | null }>;
        fabric_category_id?: string | null;
      }[]
    | null;
  sizes:
    | { style_ref_no: string | null; sno: number | null; size_id: string | null; size: One<{ name: string | null }> }[]
    | null;
  combos:
    | {
        style_ref_no: string | null;
        structures:
          | { structure_id: string | null; gsm: number | string | null; parts: { color_name: string | null }[] | null }[]
          | null;
      }[]
    | null;
};

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type VersionLite = {
  id: string;
  garment_order_id: string;
  style_ref_no: string;
  version_no: number;
  pattern_maker_id: string;
  cad_type: CadType;
  allocation_date: string;
  target_date: string;
  remarks: string | null;
  fit_wash: boolean | null;
  length_shrink_pct: number | string | null;
  width_shrink_pct: number | string | null;
  cut_type: CutType | null;
  component_cuts: ComponentCut[] | null;
  pattern_status: PatternStatus | null;
  pattern_date: string | null;
  lines:
    | {
        sno: number;
        coordinate_id: string | null;
        component_id: string;
        fabric_category_id: string | null;
        gsm: number | string | null;
        colour: string | null;
        size_id: string | null;
        table_dia: number | string | null;
        width_form: LayoutType | null;
        avg_pcs_weight_g: number | string | null;
        remark: string | null;
        size_wise: boolean | null;
        coordinate: One<{ name: string | null }>;
        component: One<{ short_name: string | null }>;
        fabric: One<{ name: string | null }>;
        size: One<{ name: string | null }>;
        parts:
          | {
              sno: number;
              coordinate_id: string | null;
              component_id: string;
              coordinate: One<{ name: string | null }>;
              component: One<{ short_name: string | null }>;
            }[]
          | null;
        colours: { sno: number; colour: string }[] | null;
        sizes:
          | {
              sno: number;
              size_id: string;
              table_dia: number | string | null;
              avg_pcs_weight_g: number | string | null;
              size: One<{ name: string | null }>;
            }[]
          | null;
      }[]
    | null;
  is_submitted: boolean;
  created_at: string | null;
  created_by: string | null;
  pattern_maker: One<{ name: string }>;
  dispatch: One<{
    id: string;
    dispatch_date: string;
    courier_tracking_no: string | null;
    email_sent_at: string | null;
    layout_type: LayoutType | null;
    expected_approval_date: string | null;
    remarks: string | null;
    files: CadDispatch["files"] | null;
    approval: One<CadDecision>;
  }>;
};

function toVersion(v: VersionLite): CadVersion {
  const d = one(v.dispatch);
  const dispatch: CadDispatch | null = d
    ? {
        id: d.id,
        dispatch_date: d.dispatch_date,
        courier_tracking_no: d.courier_tracking_no,
        email_sent_at: d.email_sent_at,
        layout_type: d.layout_type,
        expected_approval_date: d.expected_approval_date,
        remarks: d.remarks,
        files: [...(d.files ?? [])].sort((a, b) => a.file_name.localeCompare(b.file_name)),
      }
    : null;
  return {
    id: v.id,
    version_no: v.version_no,
    pattern_maker_id: v.pattern_maker_id,
    pattern_maker_name: one(v.pattern_maker)?.name ?? null,
    cad_type: v.cad_type,
    allocation_date: v.allocation_date,
    target_date: v.target_date,
    remarks: v.remarks,
    fit_wash: !!v.fit_wash,
    // numeric(5,2) arrives as a string from PostgREST.
    length_shrink_pct: v.length_shrink_pct == null ? null : Number(v.length_shrink_pct),
    width_shrink_pct: v.width_shrink_pct == null ? null : Number(v.width_shrink_pct),
    cut_type: v.cut_type,
    component_cuts: Array.isArray(v.component_cuts) ? v.component_cuts : [],
    pattern_status: v.pattern_status ?? "garment_not_received",
    pattern_date: v.pattern_date,
    pattern_lines: [...(v.lines ?? [])]
      .sort((a, b) => a.sno - b.sno)
      .map((l) => ({
        coordinate_id: l.coordinate_id,
        coordinate_name: one(l.coordinate)?.name ?? null,
        component_id: l.component_id,
        component_name: one(l.component)?.short_name ?? "",
        // 0643. A line read before its parts existed (none today — 0643
        // backfilled every one) still answers with its own first part.
        parts:
          l.parts && l.parts.length > 0
            ? [...l.parts]
                .sort((a, b) => a.sno - b.sno)
                .map((p) => ({
                  coordinate_id: p.coordinate_id,
                  coordinate_name: one(p.coordinate)?.name ?? null,
                  component_id: p.component_id,
                  component_name: one(p.component)?.short_name ?? "",
                }))
            : [
                {
                  coordinate_id: l.coordinate_id,
                  coordinate_name: one(l.coordinate)?.name ?? null,
                  component_id: l.component_id,
                  component_name: one(l.component)?.short_name ?? "",
                },
              ],
        fabric_category_id: l.fabric_category_id,
        fabric_name: one(l.fabric)?.name ?? null,
        // numeric columns arrive as strings from PostgREST.
        gsm: l.gsm == null ? null : Number(l.gsm),
        colour: l.colour,
        size_id: l.size_id,
        size_name: one(l.size)?.name ?? null,
        // 0644, with the line's own first value as the fallback (backfilled, so
        // only a line written between 0643 and 0644 could need it).
        colours:
          l.colours && l.colours.length > 0
            ? [...l.colours].sort((a, b) => a.sno - b.sno).map((c) => c.colour)
            : l.colour
              ? [l.colour]
              : [],
        sizes:
          l.sizes && l.sizes.length > 0
            ? [...l.sizes]
                .sort((a, b) => a.sno - b.sno)
                .map((z) => ({
                  size_id: z.size_id,
                  size_name: one(z.size)?.name ?? null,
                  table_dia: z.table_dia == null ? null : Number(z.table_dia),
                  avg_pcs_weight_g: z.avg_pcs_weight_g == null ? null : Number(z.avg_pcs_weight_g),
                }))
            : l.size_id
              ? [{ size_id: l.size_id, size_name: one(l.size)?.name ?? null, table_dia: null, avg_pcs_weight_g: null }]
              : [],
        size_wise: l.size_wise ?? false,
        table_dia: l.table_dia == null ? null : Number(l.table_dia),
        width_form: l.width_form,
        avg_pcs_weight_g: l.avg_pcs_weight_g == null ? null : Number(l.avg_pcs_weight_g),
        remark: l.remark,
      })),
    is_submitted: v.is_submitted,
    created_at: v.created_at,
    created_by: v.created_by,
    dispatch,
    decision: d ? (one(d.approval) ?? { status: "pending", decided_on: null, buyer_comments: null }) : null,
  };
}

/**
 * Every (order, style) the lifecycle covers. `orderIds` narrows the read — the
 * Garment Order Sheet and the Fabric BOM reports ask about ONE order.
 *
 * DRAFT ORDERS ARE LEFT OUT of the full listing, for the reason
 * `listCadTasks` gives: a draft's styles are still being typed. Asked for by
 * id, an order is read whatever its state.
 */
export async function listCadStyles(orderIds?: readonly string[]): Promise<CadStyleRow[]> {
  if (orderIds && orderIds.length === 0) return [];
  const s = await createClient();

  let orderQ = s.from("garment_order_amendments").select(ORDER_SELECT);
  orderQ = orderIds ? orderQ.in("id", [...orderIds]) : orderQ.eq("is_draft", false);
  let verQ = s.from("order_cad_allocations").select(VERSION_SELECT);
  if (orderIds) verQ = verQ.in("garment_order_id", [...orderIds]);

  const [ordersRes, versionsRes] = await Promise.all([
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22).
    orderQ.order("created_at", { ascending: true }),
    verQ.order("version_no", { ascending: true }),
  ]);
  if (ordersRes.error) throw new Error(`CAD lifecycle: reading orders failed — ${ordersRes.error.message}`);
  if (versionsRes.error) throw new Error(`CAD lifecycle: reading CAD versions failed — ${versionsRes.error.message}`);

  const versionsBy = new Map<string, CadVersion[]>();
  const refBy = new Map<string, string>();
  for (const v of (versionsRes.data ?? []) as unknown as VersionLite[]) {
    const k = `${v.garment_order_id}|${styleKey(v.style_ref_no)}`;
    const list = versionsBy.get(k) ?? [];
    list.push(toVersion(v));
    versionsBy.set(k, list);
    if (!refBy.has(k)) refBy.set(k, v.style_ref_no);
  }

  const rows: CadStyleRow[] = [];
  for (const o of (ordersRes.data ?? []) as unknown as OrderLite[]) {
    const base = {
      garment_order_id: o.id,
      order_code: o.code,
      re_no: o.sales_order?.order_number ?? null,
      sales_order_id: o.sales_order?.id ?? null,
      po_no: o.po_no,
      customer_id: o.customer?.id ?? null,
      customer_name: o.customer?.name ?? null,
      customer_review_days: o.customer?.cad_review_days ?? null,
      delivery_date: o.delivery_date,
    };
    // Each style's components, first-declared order, one per (coordinate,
    // component) — 0637's key: a TOP and a BOTTOM each have a FRONT BODY.
    // GSM per (style, structure) from the order's combos — a structure used in
    // two combos at two GSMs reads "160 / 180", never one of them silently.
    const gsmBy = new Map<string, Set<string>>();
    for (const cb of o.combos ?? []) {
      const csk = styleKey(cb.style_ref_no ?? "");
      for (const st of cb.structures ?? []) {
        if (!st.structure_id || st.gsm == null || `${st.gsm}` === "") continue;
        const k = `${csk}|${st.structure_id}`;
        const set = gsmBy.get(k) ?? new Set<string>();
        set.add(`${Number(st.gsm)}`);
        gsmBy.set(k, set);
      }
    }
    // Colours per style from its combos (0640's COLOUR picker), first-seen order.
    const coloursBy = new Map<string, string[]>();
    for (const cb of o.combos ?? []) {
      const csk = styleKey(cb.style_ref_no ?? "");
      const list = coloursBy.get(csk) ?? [];
      for (const st of cb.structures ?? [])
        for (const pt of st.parts ?? []) {
          const c = pt.color_name?.trim().toUpperCase();
          if (c && !list.includes(c)) list.push(c);
        }
      coloursBy.set(csk, list);
    }
    // Sizes per style, in the order's own sequence — names, and id + name pairs.
    const sizeOptsBy = new Map<string, { id: string; name: string }[]>();
    const sizesBy = new Map<string, string[]>();
    for (const sz of [...(o.sizes ?? [])].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0))) {
      const name = one(sz.size)?.name?.trim();
      if (!name || !sz.style_ref_no?.trim()) continue;
      const ssk = styleKey(sz.style_ref_no);
      const list = sizesBy.get(ssk) ?? [];
      if (!list.includes(name)) list.push(name);
      sizesBy.set(ssk, list);
      if (sz.size_id) {
        const opts = sizeOptsBy.get(ssk) ?? [];
        if (!opts.some((x) => x.id === sz.size_id)) opts.push({ id: sz.size_id, name });
        sizeOptsBy.set(ssk, opts);
      }
    }
    const componentsBy = new Map<string, StyleComponent[]>();
    const comps = [...(o.components ?? [])].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0));
    for (const c of comps) {
      const name = one(c.component)?.short_name?.trim();
      if (!c.component_id || !name || !c.style_ref_no?.trim()) continue;
      const sk = styleKey(c.style_ref_no);
      const list = componentsBy.get(sk) ?? [];
      const entry: StyleComponent = {
        component_id: c.component_id,
        name,
        coordinate_id: c.coordinate_id,
        coordinate_name: one(c.coordinate)?.name ?? null,
        structure: one(c.structure)?.name ?? null,
        fabric_category_id: c.fabric_category_id ?? null,
        gsm: c.fabric_category_id
          ? [...(gsmBy.get(`${sk}|${c.fabric_category_id}`) ?? [])].join(" / ") || null
          : null,
      };
      if (!list.some((x) => cutKey(x) === cutKey(entry))) list.push(entry);
      componentsBy.set(sk, list);
    }
    const seen = new Set<string>();
    const styles = [...(o.styles ?? [])].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0));
    for (const st of styles) {
      const ref = st.style_ref_no?.trim();
      if (!ref) continue;
      const k = `${o.id}|${styleKey(ref)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const versions = versionsBy.get(k) ?? [];
      rows.push({
        ...base,
        key: k,
        style_ref_no: ref,
        style_description: st.style_description,
        layout_type: (st.layout_type as LayoutType | null) ?? null,
        components: componentsBy.get(styleKey(ref)) ?? [],
        sizes: sizesBy.get(styleKey(ref)) ?? [],
        size_options: sizeOptsBy.get(styleKey(ref)) ?? [],
        colours: coloursBy.get(styleKey(ref)) ?? [],
        on_order: true,
        versions,
        state: cadStateOf(versions),
        created_at: versions[0]?.created_at ?? o.created_at,
        created_by: versions[0]?.created_by ?? o.created_by,
      });
    }
    // History for a style that has left the order — see `on_order`.
    for (const [k, versions] of versionsBy) {
      if (!k.startsWith(`${o.id}|`) || seen.has(k)) continue;
      rows.push({
        ...base,
        key: k,
        style_ref_no: refBy.get(k) ?? k.slice(o.id.length + 1),
        style_description: null,
        layout_type: null,
        components: [],
        sizes: [],
        size_options: [],
        colours: [],
        on_order: false,
        versions,
        state: cadStateOf(versions),
        created_at: versions[0]?.created_at ?? o.created_at,
        created_by: versions[0]?.created_by ?? o.created_by,
      });
    }
  }
  return withCreators(rows);
}

/** The form data: who may be a Pattern Maker (filtered on screen by `patternMakerOptions`). */
export async function getCadLifecycleFormData(): Promise<{ employees: PatternMakerRow[] }> {
  const s = await createClient();
  const { data, error } = await s
    .from("employees")
    .select("id, code, name, inactive, designation:config_lookups!designation_id(name)")
    .order("name");
  if (error) throw new Error(`CAD lifecycle: reading employees failed — ${error.message}`);
  const employees = ((data ?? []) as unknown as {
    id: string;
    code: string | null;
    name: string;
    inactive: boolean | null;
    designation: One<{ name: string }>;
  }[]).map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    inactive: !!e.inactive,
    designation: one(e.designation)?.name ?? null,
  }));
  return { employees };
}
