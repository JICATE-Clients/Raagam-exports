import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { styleKey } from "@/lib/orders/amendments/style-key";
import {
  cadStateOf,
  type CadDecision,
  type CadDispatch,
  type CadStyleRow,
  type CadType,
  type CadVersion,
  type LayoutType,
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
  "styles:garment_order_amendment_styles(sno, style_ref_no, style_description, layout_type)";

const VERSION_SELECT =
  "id, garment_order_id, style_ref_no, version_no, pattern_maker_id, cad_type, allocation_date, " +
  "target_date, remarks, is_submitted, created_at, created_by, " +
  "pattern_maker:employees!pattern_maker_id(name), " +
  "dispatch:order_cad_dispatches(id, dispatch_date, courier_tracking_no, email_sent_at, layout_type, " +
  "expected_approval_date, remarks, " +
  "files:order_cad_dispatch_files(id, file_name, storage_path, extension, size_bytes), " +
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
      po_no: o.po_no,
      customer_id: o.customer?.id ?? null,
      customer_name: o.customer?.name ?? null,
      customer_review_days: o.customer?.cad_review_days ?? null,
      delivery_date: o.delivery_date,
    };
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
