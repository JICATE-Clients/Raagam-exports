import "server-only";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/calendar";
import { currentAmendmentsBySalesOrder } from "@/lib/orders/amendments/current";
import { SEASON_OPTIONS } from "@/lib/orders/amendments/types";
import { loadOrderProgress } from "@/lib/orders/progress/service";
import { RISK_LABELS } from "@/lib/orders/progress/engine";
import { kilogramUom } from "@/lib/uom/kilogram";
import { fabricBalance, fulfilmentOf, inSeason, normSeason, yearWindow } from "./derive";
import type { SeasonOrder, SeasonReport, SeasonStyle } from "./types";

/**
 * Orders ▸ Order Management ▸ Season Report — the loader.
 *
 * "Season" is the order's OWN pair, Season + Year on Order Info — never a date
 * range. An order keyed in early 2027 for Q4 2026 reports under Q4 2026, which
 * is why the year is a field the planner states and not a value the system
 * infers from a date.
 *
 * Rounds, because each is ~260 ms and the tables are tiny: every live RE →
 * current documents ‖ orders → their headers (all of them: they also decide
 * which seasons and years the filter can offer) → the matched orders' progress,
 * pictures, styles and fabric side by side.
 *
 * A failed read THROWS. Downstream tables are near-empty today, so a swallowed
 * error would print a believable "nothing shipped yet" (AGENTS.md, Cascading
 * filters: an empty report is the dangerous one).
 */

type Row = Record<string, unknown>;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what} could not be read: ${error.message}. This is an error, not an empty report.`);
}

const BUCKET = "garment-order-docs";
const SIGNED_TTL = 3600;

// created-by: exempt -- a derived season rollup over orders, not a listing of records someone created; Order Entry's own list carries the pair
export async function loadSeasonReport(season: string, year: number | null): Promise<SeasonReport> {
  const sb = await createClient();
  const now = today();

  // ---- Round 1: every RE that has an Order Entry document.
  const { data: docRefs, error: refErr } = await sb
    .from("garment_order_amendments")
    .select("sales_order_id")
    .not("sales_order_id", "is", null);
  fail("Order documents", refErr);
  const soIds = [...new Set(((docRefs ?? []) as { sales_order_id: string }[]).map((r) => r.sales_order_id))];

  const empty: SeasonReport = {
    season,
    year,
    options: { seasons: seasonList([]), years: yearWindow(Number(now.slice(0, 4)), []) },
    orders: [],
    withoutYear: 0,
    cancelled: 0,
    today: now,
  };
  if (!soIds.length) return empty;

  // ---- Round 2: the CURRENT document per RE ‖ the RE rows.
  const [current, soRes] = await Promise.all([
    currentAmendmentsBySalesOrder(sb, soIds),
    sb.from("sales_orders").select("id, order_number, status").in("id", soIds),
  ]);
  fail("Orders", soRes.error);
  const soById = new Map(((soRes.data ?? []) as Row[]).map((r) => [String(r.id), r]));
  // A draft is not an order yet — Order Progress and the worklist drop it the same way.
  const live = [...current.entries()].filter(([so, a]) => !a.isDraft && soById.has(so));
  if (!live.length) return empty;

  // ---- Round 3: every live document's header — they decide the filter's options too.
  const { data: heads, error: headErr } = await sb
    .from("garment_order_amendments")
    .select("id, po_no, season, amend_year, delivery_date, merchandiser_id, customer:customers!customer_id(name)")
    .in(
      "id",
      live.map(([, a]) => a.id),
    );
  fail("Order headers", headErr);
  const headById = new Map(((heads ?? []) as Row[]).map((r) => [String(r.id), r]));

  const allHeads = live.map(([so, a]) => {
    const h = headById.get(a.id) ?? {};
    return {
      so,
      doc: a.id,
      season: str(h.season),
      year: h.amend_year == null ? null : num(h.amend_year),
      cancelled: String(soById.get(so)?.status ?? "") === "cancelled",
    };
  });

  const options = {
    seasons: seasonList(allHeads.map((h) => h.season)),
    years: yearWindow(
      Number(now.slice(0, 4)),
      allHeads.map((h) => h.year).filter((y): y is number => y != null),
    ),
  };

  const inChosenSeason = allHeads.filter((h) => inSeason(h, season, null));
  const withoutYear = year != null ? inChosenSeason.filter((h) => h.year == null && !h.cancelled).length : 0;
  const cancelled = allHeads.filter((h) => h.cancelled && inSeason(h, season, year)).length;
  const matched = allHeads.filter((h) => !h.cancelled && inSeason(h, season, year));
  if (!matched.length) return { ...empty, options, withoutYear, cancelled };

  const matchedSo = matched.map((h) => h.so);
  const matchedDoc = matched.map((h) => h.doc);

  // ---- Round 4: everything else, side by side.
  const [progress, files, styles, boms, kg] = await Promise.all([
    loadOrderProgress(sb, now, { salesOrderIds: matchedSo }),
    sb
      .from("garment_order_amendment_files")
      .select("amendment_id, sno, mime_type, storage_path, is_primary")
      .in("amendment_id", matchedDoc)
      .order("sno", { ascending: true }),
    sb
      .from("garment_order_amendment_styles")
      .select("amendment_id, sno, style_ref_no, style_description, style_category, description, po_qty")
      .in("amendment_id", matchedDoc)
      .order("sno", { ascending: true }),
    sb
      .from("order_fabric_boms")
      .select("id, garment_order_id, bom_date, created_at")
      .in("garment_order_id", matchedDoc)
      .eq("is_draft", false),
    kilogramUom(sb),
  ]);
  fail("Style pictures", files.error);
  fail("Styles", styles.error);
  fail("Fabric BOMs", boms.error);

  // The latest non-draft Fabric BOM per document.
  const bomOfDoc = new Map<string, string>();
  const bomKey = new Map<string, string>();
  for (const b of (boms.data ?? []) as Row[]) {
    const doc = String(b.garment_order_id);
    const k = `${str(b.bom_date) ?? ""}|${str(b.created_at) ?? ""}`;
    if (!bomKey.has(doc) || k > (bomKey.get(doc) as string)) {
      bomKey.set(doc, k);
      bomOfDoc.set(doc, String(b.id));
    }
  }
  const bomIds = [...bomOfDoc.values()];

  // ---- Round 5: the pictures' signed links, the requirement and the fabric receipts.
  const picked = pickThumbnails((files.data ?? []) as Row[]);
  const [signed, reqs, poLines] = await Promise.all([
    picked.size
      ? sb.storage.from(BUCKET).createSignedUrls([...picked.values()], SIGNED_TTL)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string; error: string | null }[], error: null }),
    bomIds.length
      ? sb.from("order_fabric_bom_requirements").select("bom_id, required_qty").in("bom_id", bomIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    sb
      .from("po_line_items")
      .select("sales_order_id, received_qty, uom_id, item_class")
      .in("sales_order_id", matchedSo)
      .ilike("item_class", "fabric%"),
  ]);
  if (signed.error) throw new Error(`Style pictures could not be signed: ${signed.error.message}`);
  fail("Fabric requirement", reqs.error);
  fail("Fabric purchase lines", poLines.error);

  const urlOf = new Map<string, string>();
  for (const x of (signed.data ?? []) as { path: string | null; signedUrl: string; error: string | null }[]) {
    if (x.path && x.signedUrl && !x.error) urlOf.set(x.path, x.signedUrl);
  }

  const stylesByDoc = new Map<string, SeasonStyle[]>();
  for (const s of (styles.data ?? []) as Row[]) {
    const doc = String(s.amendment_id);
    const list = stylesByDoc.get(doc) ?? [];
    list.push({
      styleRef: str(s.style_ref_no) ?? "—",
      description: str(s.style_description) ?? str(s.description) ?? str(s.style_category),
      qty: num(s.po_qty),
    });
    stylesByDoc.set(doc, list);
  }

  const reqByBom = new Map<string, { kg: number; refused: number }>();
  for (const r of (reqs.data ?? []) as Row[]) {
    const k = String(r.bom_id);
    const t = reqByBom.get(k) ?? { kg: 0, refused: 0 };
    if (r.required_qty == null) t.refused++;
    else t.kg += num(r.required_qty);
    reqByBom.set(k, t);
  }

  const poBySo = new Map<string, Row[]>();
  for (const p of (poLines.data ?? []) as Row[]) {
    const k = String(p.sales_order_id);
    const list = poBySo.get(k) ?? [];
    list.push(p);
    poBySo.set(k, list);
  }

  const progressBySo = new Map(progress.map((p) => [p.salesOrderId, p]));
  const metaBySo = new Map(matched.map((m) => [m.so, m]));

  const orders: SeasonOrder[] = [];
  for (const so of matchedSo) {
    const p = progressBySo.get(so);
    if (!p) continue; // not a live order (progress drops what Order Progress drops)
    const meta = metaBySo.get(so)!;
    const doc = p.amendmentId;
    const docStyles = stylesByDoc.get(doc) ?? [];
    const qty = p.orderQty ?? docStyles.reduce((s, x) => s + x.qty, 0);
    const shippedQty = p.progress.shippedQty;
    const producing = p.progress.stages.some((s) => s.group === "production" && (s.qtyDone ?? 0) > 0);

    const req = bomOfDoc.has(doc) ? reqByBom.get(bomOfDoc.get(doc) as string) : undefined;
    const fabricLines = poBySo.get(so) ?? [];
    const kgLines = fabricLines.filter((l) => kg && l.uom_id === kg.id);
    const hasBom = bomOfDoc.has(doc);

    orders.push({
      salesOrderId: so,
      amendmentId: doc,
      reNo: p.orderNumber,
      customer: p.customer,
      poNo: str(headById.get(doc)?.po_no),
      merchandiser: p.merchandiser,
      season: meta.season,
      year: meta.year,
      deliveryDate: p.deliveryDate,
      qty,
      shippedQty,
      balanceQty: Math.max(0, qty - shippedQty),
      fulfilment: fulfilmentOf({ orderStatus: p.orderStatus, qty, shippedQty, producing }),
      riskLevel: p.progress.risk.level,
      riskLabel: RISK_LABELS[p.progress.risk.level],
      daysLate: p.progress.risk.daysLate,
      cause: p.progress.risk.cause,
      styles: docStyles,
      thumbnail: picked.has(doc) ? (urlOf.get(picked.get(doc) as string) ?? null) : null,
      fabric: fabricBalance({
        requiredKg: hasBom ? (req?.kg ?? 0) : null,
        receivedKg: kgLines.reduce((s, l) => s + num(l.received_qty), 0),
        otherUnitLines: fabricLines.length - kgLines.length,
        hasFabricLines: fabricLines.length > 0,
        refusedRows: req?.refused ?? 0,
      }),
    });
  }

  // Listings in ENTRY order (STANDING): oldest RE first.
  const createdAt = new Map(progress.map((p) => [p.salesOrderId, p.createdAt ?? ""]));
  orders.sort((a, b) => (createdAt.get(a.salesOrderId) ?? "").localeCompare(createdAt.get(b.salesOrderId) ?? ""));

  return { season, year, options, orders, withoutYear, cancelled, today: now };
}

/** One picture path per document: the primary image, else the first. */
function pickThumbnails(rows: Row[]): Map<string, string> {
  const best = new Map<string, { path: string; primary: boolean; sno: number }>();
  for (const f of rows) {
    const mime = str(f.mime_type) ?? "";
    const path = str(f.storage_path);
    if (!path || !mime.startsWith("image/")) continue;
    const doc = String(f.amendment_id);
    const primary = f.is_primary === true;
    const sno = num(f.sno);
    const held = best.get(doc);
    if (!held || (primary && !held.primary) || (primary === held.primary && sno < held.sno)) {
      best.set(doc, { path, primary, sno });
    }
  }
  return new Map([...best].map(([doc, b]) => [doc, b.path]));
}

/** The closed list Order Info offers, plus any season an order carries that it
 *  does not (so a legacy "Q3" still appears), de-duplicated case-insensitively. */
function seasonList(present: (string | null)[]): string[] {
  const out = new Map<string, string>();
  for (const s of [...SEASON_OPTIONS, ...present]) {
    const n = normSeason(s);
    if (n && !out.has(n)) out.set(n, (s as string).trim());
  }
  return [...out.values()];
}
