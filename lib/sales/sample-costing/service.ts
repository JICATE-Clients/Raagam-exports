import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCurrencies } from "@/lib/masters/service";
import { withCreators } from "@/lib/created-by";
import type { Currency } from "@/lib/masters/types";
import type { Deactivatable } from "@/lib/masters/inactive";
import { quoteKey } from "./calc";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";
import type { DocLetterhead } from "@/lib/orders/gos/letterhead";
import { rateMemoryKey } from "./types";
import type { RevisionSource } from "./revision-history";
import type { ApprovalFacts } from "./approval-line";
import type { CostingListRow, CostingRecord, CostingStatus, ExtraChargeDraft, FabricDraft, PieceDraft, TrimDraft, WeightDraft } from "./types";

/**
 * Sample Costing — option lists, the list, one record (0688 / 0689).
 *
 * Option lists SELECT the switched-off flag and filter nothing in SQL
 * (AGENTS.md "Disabled rows"): a fabric or process a saved sheet already holds
 * must still resolve. A failed option query THROWS — an empty Fabric list
 * reads as "no fabrics set up yet", which nobody reports.
 */

export type PickerRow = { id: string; code: string | null; name: string } & Deactivatable;

/** A style line of a sample enquiry, as the header offers it. */
export type CostingStyleOption = {
  id: string;
  opportunity_id: string;
  sample_no: string | null;
  name: string;
  description: string | null;
  unit_kind: string | null;
  /** The coordinates, in order — a SET's pieces (Top, Pants …). */
  coordinates: { id: string | null; name: string }[];
  /** A signed URL to the style's first image (Sample Entry ▸ Image), or null. */
  thumb_url: string | null;
  /** The sizes the style was ticked with in Sample Entry (`style_sizes`), in
   *  entry order — the only sizes the weights table offers (0693). */
  sizes: string[];
};

export type CostingEnquiryOption = {
  id: string;
  code: string | null;
  name: string;
  customer_id: string | null;
  customer_name: string | null;
  season: string | null;
  season_year: number | null;
  is_draft: boolean;
};

export type SampleCostingFormData = {
  enquiries: CostingEnquiryOption[];
  styles: CostingStyleOption[];
  /** FABRIC STRUCTURES — the FABRIC-class categories (Single Jersey, Fleece,
   *  1X1 Lycra Rib …) the Fabric picker lists (0698, user 2026-10-09). A
   *  structure IS the construction the loss memory keys on, so `category_id`
   *  is the row's own id. */
  fabrics: (PickerRow & { category_id: string | null })[];
  /** YARN-class items — the Yarn Mix picker (0690). */
  yarns: PickerRow[];
  /** Processes flagged for fabric — the Special Processing picker. */
  processes: PickerRow[];
  /** Garment processes classified on the Process master (0691): CMT operations
   *  (Cutting, Stitching, Checking …) and Embellishments (Print, Embroidery, Wash …).
   *  A process with no kind is in neither picker. */
  garmentProcesses: (PickerRow & { garment_kind: "cmt" | "embellishment" })[];
  /** Garment components (Body, Rib, Pocketing …). */
  components: PickerRow[];
  /** SEW + PACK items — the trims picker. */
  trims: PickerRow[];
  currencies: Currency[];
  /** The last APPROVED derivation of each fabric quality (UX plan P2.3). */
  rateMemory: FabricRateMemory[];
  /** Each customer's last APPROVED commercial terms (v2 §3.2.3). */
  customerTerms: CustomerTermsMemory[];
  /** The last approved process loss per fabric construction (v2 §3.2.2). */
  constructionLoss: { category_id: string; loss_pct: string; costing_code: string | null }[];
  /** Latest Quotes / Orders exchange rate per currency, today (v2 §4.1 USD/EUR/GBP). */
  quoteRates: Record<string, number>;
};

/** A customer's terms as last approved — the v2 auto-fill for margin & co. */
export type CustomerTermsMemory = {
  customer_id: string;
  costing_code: string | null;
  currency_code: string | null;
  margin_pct: string;
  overhead_pct: string;
  garment_waste_pct: string;
  discount_pct: string;
};

/**
 * REMEMBERED FABRIC RATES (UX plan P2.3; decision: every approved costing,
 * newest first). One entry per fabric — keyed by the master fabric when the
 * line names one, else by its typed quality in capitals — carrying the whole
 * derivation so "apply" restores yarn mix, rates, processes and loss at once.
 * An OFFER: the screen never fills it in by itself.
 */
export type FabricRateMemory = {
  key: string;
  costing_code: string | null;
  customer_name: string | null;
  approved_at: string | null;
  fabric: Omit<FabricDraft, "key">;
};


async function classIds(codes: string[]): Promise<string[]> {
  const s = await createClient();
  const { data, error } = await s.from("config_lookups").select("id, code").eq("kind", "item_class");
  if (error) throw new Error(`Could not load item classes: ${error.message}`);
  return ((data ?? []) as { id: string; code: string | null }[])
    .filter((c) => codes.includes((c.code ?? "").toUpperCase()))
    .map((c) => c.id);
}

async function itemsOfClasses(codes: string[]): Promise<(PickerRow & { category_id: string | null })[]> {
  const ids = await classIds(codes);
  if (!ids.length) return [];
  const s = await createClient();
  const { data, error } = await s.from("items").select("id, code, name, is_active, category_id").in("item_class_id", ids).order("name");
  if (error) throw new Error(`Could not load ${codes.join("/")} items: ${error.message}`);
  return (data ?? []) as (PickerRow & { category_id: string | null })[];
}

type EnquiryDb = {
  id: string;
  code: string | null;
  customer_id: string | null;
  title: string | null;
  season: string | null;
  season_year: number | null;
  is_draft: boolean | null;
  customer: { name: string | null } | { name: string | null }[] | null;
  styles:
    | {
        id: string;
        sno: number | null;
        sample_no: string | null;
        name: string | null;
        description: string | null;
        unit_kind: string | null;
        coordinates: { sno: number; coordinate_id: string | null; item: { name: string | null } | { name: string | null }[] | null }[] | null;
        files: { sno: number; storage_path: string; mime_type: string | null; doc_kind: string | null }[] | null;
        sizes: { sno: number; garment_size: string | null }[] | null;
      }[]
    | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Every sample enquiry and its style lines, with each style's first image
 * signed in ONE storage call (the bucket is private, 0686).
 */
async function getEnquiries(): Promise<{ enquiries: CostingEnquiryOption[]; styles: CostingStyleOption[] }> {
  const s = await createClient();
  const { data, error } = await s
    .from("opportunities")
    .select(
      "id, code, customer_id, title, season, season_year, is_draft, customer:customers!customer_id(name), " +
        "styles(id, sno, sample_no, name, description, unit_kind, " +
        "coordinates:sample_style_coordinates(sno, coordinate_id, item:items!coordinate_id(name)), " +
        "files:sample_style_files(sno, storage_path, mime_type, doc_kind), " +
        "sizes:style_sizes(sno, garment_size))",
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load sample enquiries: ${error.message}`);
  const rows = (data ?? []) as unknown as EnquiryDb[];

  const imagePath = new Map<string, string>();
  for (const r of rows) {
    for (const st of r.styles ?? []) {
      const img = [...(st.files ?? [])]
        .sort((a, b) => a.sno - b.sno)
        .find((f) => (f.mime_type ?? "").startsWith("image/"));
      if (img) imagePath.set(st.id, img.storage_path);
    }
  }
  const signed = new Map<string, string>();
  if (imagePath.size) {
    const paths = [...imagePath.values()];
    // A thumbnail that will not sign is a missing picture, never a failed page.
    const { data: urls } = await s.storage.from("sample-docs").createSignedUrls(paths, 60 * 60);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  const enquiries: CostingEnquiryOption[] = rows.map((r) => {
    const cust = one(r.customer)?.name ?? r.title ?? null;
    return {
      id: r.id,
      code: r.code,
      // The picker shows the NAME; the enquiry's name is its number + customer.
      name: [r.code, cust].filter(Boolean).join(" · ") || r.id.slice(0, 8),
      customer_id: r.customer_id,
      customer_name: cust,
      season: r.season,
      season_year: r.season_year,
      is_draft: !!r.is_draft,
    };
  });
  const styles: CostingStyleOption[] = rows.flatMap((r) =>
    [...(r.styles ?? [])]
      .sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0))
      .map((st) => ({
        id: st.id,
        opportunity_id: r.id,
        sample_no: st.sample_no,
        name: st.name ?? "",
        description: st.description,
        unit_kind: st.unit_kind,
        coordinates: [...(st.coordinates ?? [])]
          .sort((a, b) => a.sno - b.sno)
          .map((c) => ({ id: c.coordinate_id, name: one(c.item)?.name ?? "" }))
          .filter((c) => c.name),
        thumb_url: imagePath.has(st.id) ? (signed.get(imagePath.get(st.id)!) ?? null) : null,
        sizes: [...(st.sizes ?? [])]
          .sort((a, b) => a.sno - b.sno)
          .map((z) => (z.garment_size ?? "").trim())
          .filter(Boolean),
      })),
  );
  return { enquiries, styles };
}

/**
 * The fabric STRUCTURES (0698): a costing prices a construction before the
 * cloth exists, so the Fabric field offers FABRIC-class categories, not the
 * finished fabric items of Materials. Same table Fabric BOM's Structure reads.
 */
async function getFabricStructures(): Promise<(PickerRow & { category_id: string | null })[]> {
  const ids = await classIds(["FABRIC"]);
  if (!ids.length) return [];
  const s = await createClient();
  const { data, error } = await s.from("categories").select("id, name, inactive").in("item_class_id", ids).order("name");
  if (error) throw new Error(`Could not load fabric structures: ${error.message}`);
  return ((data ?? []) as { id: string; name: string; inactive: boolean | null }[]).map((c) => ({
    id: c.id,
    code: null,
    name: c.name,
    inactive: c.inactive,
    category_id: c.id,
  }));
}

async function getProcesses(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data, error } = await s.from("processes").select("id, name, inactive, for_fabric").order("name");
  if (error) throw new Error(`Could not load processes: ${error.message}`);
  // Fabric processes only; a held non-fabric one still resolves via the screen.
  return ((data ?? []) as { id: string; name: string; inactive: boolean | null; for_fabric: boolean | null }[])
    .filter((p) => p.for_fabric !== false)
    .map((p) => ({ id: p.id, code: null, name: p.name, inactive: p.inactive }));
}

async function getGarmentProcesses(): Promise<(PickerRow & { garment_kind: "cmt" | "embellishment" })[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("processes")
    .select("id, name, inactive, garment_kind")
    .not("garment_kind", "is", null)
    .order("name");
  if (error) throw new Error(`Could not load garment processes: ${error.message}`);
  return ((data ?? []) as { id: string; name: string; inactive: boolean | null; garment_kind: "cmt" | "embellishment" }[]).map((p) => ({
    id: p.id,
    code: null,
    name: p.name,
    inactive: p.inactive,
    garment_kind: p.garment_kind,
  }));
}

async function getComponents(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data, error } = await s.from("components").select("id, code:short_name, name:description, inactive").order("description");
  if (error) throw new Error(`Could not load components: ${error.message}`);
  return ((data ?? []) as (PickerRow & { name: string | null })[]).map((r) => ({ ...r, name: r.name ?? r.code ?? "" }));
}

export async function getSampleCostingFormData(): Promise<SampleCostingFormData> {
  const [{ enquiries, styles }, fabrics, yarns, processes, garmentProcesses, components, trims, currencies, memory, quoteRates] = await Promise.all([
    getEnquiries(),
    getFabricStructures(),
    itemsOfClasses(["YARN"]),
    getProcesses(),
    getGarmentProcesses(),
    getComponents(),
    itemsOfClasses(["SEW", "PACK"]),
    listCurrencies(),
    getCostingMemory(),
    getQuoteRates(),
  ]);
  return {
    enquiries,
    styles,
    fabrics,
    yarns,
    processes,
    garmentProcesses,
    components,
    trims,
    currencies,
    rateMemory: memory.rateMemory,
    customerTerms: memory.customerTerms,
    constructionLoss: memory.constructionLoss,
    quoteRates,
  };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------
type ListDb = {
  id: string;
  code: string | null;
  version: number;
  status: CostingStatus;
  is_draft: boolean | null;
  costing_date: string | null;
  opportunity_id: string;
  style_id: string | null;
  currency_code: string | null;
  computed_fob: number | null;
  target_fob: number | null;
  profit_loss_pct: number | null;
  created_at: string;
  created_by: string | null;
  opp: { code: string | null; title: string | null; customer: { name: string | null } | { name: string | null }[] | null } | null;
  style: { sample_no: string | null; name: string | null } | null;
};

/**
 * Every sample costing, oldest first ("Listings in ENTRY order"). Superseded
 * revisions are included — the screen's Revision picker reaches them — and the
 * list itself hides them. A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
 */
export async function listSampleCostings(): Promise<CostingListRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("cost_sheets")
    .select(
      "id, code, version, status, is_draft, costing_date, opportunity_id, style_id, currency_code, computed_fob, target_fob, " +
        "profit_loss_pct, created_at, created_by, opp:opportunities!opportunity_id(code, title, customer:customers!customer_id(name)), " +
        "style:styles!style_id(sample_no, name)",
    )
    .eq("costing_type", "sample")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load sample costings: ${error.message}`);
  const rows = ((data ?? []) as unknown as ListDb[]).map(
    (r): CostingListRow => ({
      id: r.id,
      code: r.code,
      version: r.version,
      status: r.status,
      is_draft: !!r.is_draft,
      costing_date: r.costing_date,
      opportunity_id: r.opportunity_id,
      enquiry_no: r.opp?.code ?? null,
      customer_name: one(r.opp?.customer)?.name ?? r.opp?.title ?? null,
      style_id: r.style_id,
      sample_no: r.style?.sample_no ?? null,
      style_name: r.style?.name ?? null,
      currency_code: r.currency_code,
      computed_fob: r.computed_fob == null ? null : Number(r.computed_fob),
      target_fob: r.target_fob == null ? null : Number(r.target_fob),
      profit_loss_pct: r.profit_loss_pct == null ? null : Number(r.profit_loss_pct),
      created_at: r.created_at,
      created_by: r.created_by,
    }),
  );
  return withCreators(rows);
}

// ---------------------------------------------------------------------------
// One record
// ---------------------------------------------------------------------------
type Num = number | string | null;
const str = (v: Num | undefined) => (v == null ? "" : String(Number(v)));
type RecordDb = Record<string, unknown> & {
  id: string;
  code: string | null;
  version: number;
  status: CostingStatus;
  is_draft: boolean | null;
  parent_cost_sheet_id: string | null;
  decision_remark: string | null;
  pieces:
    | (Record<string, Num> & {
        id: string;
        sno: number;
        piece_name: string;
        coordinate_id: string | null;
        cmt_direct: boolean | null;
        lines: { sno: number; kind: "cmt" | "embellishment"; process_id: string | null; process_name: string | null; rate: Num }[] | null;
      })[]
    | null;
  fabrics:
    | (Record<string, Num> & {
        id: string;
        sno: number;
        fabric_id: string | null;
        quality: string | null;
        is_direct: boolean;
        processes: { sno: number; process_id: string | null; process_name: string | null; rate: Num }[] | null;
        yarns: { sno: number; item_id: string | null; yarn_name: string | null; mix_pct: Num; rate: Num }[] | null;
      })[]
    | null;
  weights:
    | (Record<string, Num> & {
        sno: number;
        piece_id: string;
        fabric_line_id: string | null;
        component_id: string | null;
        component_ids: string[] | null;
        size_name: string | null;
        /** Saved before 0693: the Size Group it was keyed by, read for its NAME only. */
        group: { size_group_name: string | null } | null;
      })[]
    | null;
  trims: (Record<string, Num> & { sno: number; piece_id: string; item_id: string | null; description: string | null; is_direct: boolean | null })[] | null;
  quotes: { piece_id: string; size_name: string | null; group: { size_group_name: string | null } | null; quoted_price: Num }[] | null;
};

const bySno = <T extends { sno: number }>(xs: T[] | null | undefined) => [...(xs ?? [])].sort((a, b) => a.sno - b.sno);

export async function getSampleCostingRecord(id: string): Promise<CostingRecord | null> {
  const s = await createClient();
  const { data, error } = await s
    .from("cost_sheets")
    .select(
      "id, code, version, status, is_draft, parent_cost_sheet_id, decision_remark, opportunity_id, style_id, costing_date, " +
        "currency_code, exchange_rate, margin_pct, garment_waste_pct, overhead_pct, discount_pct, ship_mode, freight_per_pc, insurance_per_pc, notes, extra_charges, " +
        "pieces:sample_costing_pieces(*, lines:sample_costing_piece_processes(sno, kind, process_id, process_name, rate)), " +
        "fabrics:sample_costing_fabrics(*, processes:sample_costing_fabric_processes(sno, process_id, process_name, rate), " +
        "yarns:sample_costing_fabric_yarns(sno, item_id, yarn_name, mix_pct, rate)), " +
        "weights:sample_costing_component_weights(*, group:size_groups!size_group_id(size_group_name)), trims:sample_costing_trims(*), " +
        "quotes:sample_costing_quotes(piece_id, size_name, quoted_price, group:size_groups!size_group_id(size_group_name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the costing: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as RecordDb;
  const g = (k: string) => (r[k] == null ? "" : String(r[k]));
  const gnum = (k: string) => (r[k] == null ? "" : String(Number(r[k])));

  // Keys are the stored ids, so a child's piece / fabric link survives the trip.
  const pieces: PieceDraft[] = bySno(r.pieces).map((p) => ({
    key: p.id,
    piece_name: p.piece_name,
    coordinate_id: p.coordinate_id,
    cmt: str(p.cmt),
    cmt_direct: p.cmt_direct !== false,
    lines: bySno(p.lines).map((l, i) => ({
      key: `${p.id}-l${i}`,
      kind: l.kind,
      process_id: l.process_id,
      process_name: l.process_name ?? "",
      rate: str(l.rate),
    })),
    testing_cost: str(p.testing_cost),
    bank_cost: str(p.bank_cost),
  }));
  const fabrics: FabricDraft[] = bySno(r.fabrics).map((f) => ({
    key: f.id,
    fabric_id: f.fabric_id,
    quality: f.quality ?? "",
    yarn_rate: str(f.yarn_rate),
    yarns: bySno(f.yarns).map((y, i) => ({
      key: `${f.id}-y${i}`,
      item_id: y.item_id,
      yarn_name: y.yarn_name ?? "",
      mix_pct: str(y.mix_pct),
      rate: str(y.rate),
    })),
    knitting_rate: str(f.knitting_rate),
    dyeing_rate: str(f.dyeing_rate),
    finishing_rate: str(f.finishing_rate),
    process_loss_pct: str(f.process_loss_pct),
    is_direct: !!f.is_direct,
    direct_rate: str(f.direct_rate),
    processes: bySno(f.processes).map((p, i) => ({
      key: `${f.id}-p${i}`,
      process_id: p.process_id,
      process_name: p.process_name ?? "",
      rate: str(p.rate),
    })),
  }));
  const weights: WeightDraft[] = bySno(r.weights).map((w, i) => ({
    key: `w${i}`,
    piece_key: w.piece_id,
    fabric_key: w.fabric_line_id,
    component_ids: w.component_ids?.length ? w.component_ids : w.component_id ? [w.component_id] : [],
    size_name: w.size_name ?? w.group?.size_group_name?.trim() ?? null,
    weight_g: str(w.weight_g),
    length_cm: str(w.length_cm),
    width_cm: str(w.width_cm),
    gsm: str(w.gsm),
    wastage_pct: str(w.wastage_pct),
  }));
  const trims: TrimDraft[] = bySno(r.trims).map((t, i) => ({
    key: `t${i}`,
    piece_key: t.piece_id,
    item_id: t.item_id,
    description: t.description ?? "",
    qty: str(t.qty),
    rate: str(t.rate),
    // 0694. A line saved before it is a Direct rate line.
    is_direct: t.is_direct ?? true,
    pack_price: str(t.pack_price),
    pack_size: str(t.pack_size),
  }));
  // 0695. Keys are positional; an unreadable row is dropped rather than failing the load.
  const extras: ExtraChargeDraft[] = (Array.isArray(r.extra_charges) ? (r.extra_charges as Record<string, unknown>[]) : []).map((x, i) => ({
    key: `x${i}`,
    section: x.section === "price" ? "price" : "overhead",
    name: typeof x.name === "string" ? x.name : "",
    kind: x.kind === "pct" ? "pct" : "flat",
    value: x.value == null ? "" : String(x.value),
    sign: x.sign === "deduct" ? "deduct" : "add",
  }));
  const quotes = Object.fromEntries(
    (r.quotes ?? []).map((q) => [quoteKey(q.piece_id, q.size_name ?? q.group?.size_group_name?.trim() ?? null), str(q.quoted_price)]),
  );

  return {
    id: r.id,
    code: r.code,
    version: r.version,
    status: r.status,
    is_draft: !!r.is_draft,
    parent_id: r.parent_cost_sheet_id,
    decision_remark: r.decision_remark,
    draft: {
      header: {
        opportunity_id: (r.opportunity_id as string | null) ?? null,
        style_id: (r.style_id as string | null) ?? null,
        costing_date: g("costing_date"),
        currency_code: (r.currency_code as string | null) ?? null,
        exchange_rate: gnum("exchange_rate"),
        margin_pct: gnum("margin_pct"),
        garment_waste_pct: gnum("garment_waste_pct"),
        overhead_pct: gnum("overhead_pct"),
        discount_pct: gnum("discount_pct"),
        ship_mode: g("ship_mode"),
        freight_per_pc: gnum("freight_per_pc"),
        insurance_per_pc: gnum("insurance_per_pc"),
        notes: g("notes"),
      },
      pieces,
      fabrics,
      weights,
      trims,
      quotes,
      extras,
    },
  };
}

// ---------------------------------------------------------------------------
// The quotation's letterhead (spec §5.1) — the order documents' frame, read the
// way `getDocLetterhead` reads it. A sample has no order and no unit, so the
// unit line is the operator's current unit, or nothing.
// ---------------------------------------------------------------------------
export async function getCostingLetterhead(): Promise<DocLetterhead> {
  const s = await createClient();
  const { data } = await s.from("company_profile").select("*").limit(1).maybeSingle();
  const co = (data ?? null) as Record<string, unknown> | null;
  const text = (k: string) => (typeof co?.[k] === "string" ? (co[k] as string) : null);
  return {
    name: text("name") ?? text("company_name"),
    address: registeredAddressOf(co),
    unit: null,
    gstin: text("gstin"),
    logo: letterheadLogoOf(co),
  };
}

// ---------------------------------------------------------------------------
// "Fetch rate" (UI/UX spec §4.5, the currency box's inline button). Not a
// market feed: the business's own QUOTES & ORDERS register on Master Data ▸
// Exchange Rate (0253) — the rate it has agreed to quote at — taking the
// latest entry in effect on the costing date. Null when the register holds no
// line for that currency; the screen says so rather than inventing one.
// ---------------------------------------------------------------------------
export async function getQuoteExchangeRate(
  currency: string,
  onDate: string | null,
): Promise<{ rate: number; entryDate: string | null; effectiveFrom: string | null } | null> {
  const s = await createClient();
  const { data, error } = await s
    .from("exchange_rate_lines")
    .select("ex_rate, entry:exchange_rate_entries!inner(register, entry_date, effective_from)")
    .eq("currency_code", currency)
    .eq("entry.register", "quotes_orders");
  if (error) throw new Error(`Could not read the exchange rate master: ${error.message}`);
  type Row = { ex_rate: number | string; entry: { entry_date: string | null; effective_from: string | null } | null };
  const day = onDate || new Date().toISOString().slice(0, 10);
  const candidates = ((data ?? []) as unknown as Row[])
    .map((r) => ({ rate: Number(r.ex_rate), from: r.entry?.effective_from ?? r.entry?.entry_date ?? null, entryDate: r.entry?.entry_date ?? null }))
    .filter((r) => r.rate > 0 && (!r.from || r.from <= day))
    .sort((a, b) => (b.from ?? "").localeCompare(a.from ?? ""));
  const best = candidates[0];
  return best ? { rate: best.rate, entryDate: best.entryDate, effectiveFrom: best.from } : null;
}

// ---------------------------------------------------------------------------
// Remembered fabric rates (P2.3) — read with the page; a failed read costs the
// offer, never the screen, because nothing on it depends on the memory.
// ---------------------------------------------------------------------------
type MemoryDb = Record<string, unknown> & {
  code: string | null;
  approved_at: string | null;
  opp: { title: string | null; customer_id: string | null; customer: { name: string | null } | { name: string | null }[] | null } | null;
  fabrics:
    | (Record<string, Num> & {
        id: string;
        fabric_id: string | null;
        quality: string | null;
        is_direct: boolean;
        yarns: { sno: number; item_id: string | null; yarn_name: string | null; mix_pct: Num; rate: Num }[] | null;
        processes: { sno: number; process_id: string | null; process_name: string | null; rate: Num }[] | null;
      })[]
    | null;
};

/**
 * ONE READ OF THE APPROVED SHEETS, THREE MEMORIES (newest first, first seen
 * wins): the fabric derivations (P2.3), each customer's terms (v2 §3.2.3) and
 * the process loss per construction (v2 §3.2.2). A failed read costs the
 * auto-fill, never the screen.
 */
async function getCostingMemory(): Promise<{
  rateMemory: FabricRateMemory[];
  customerTerms: CustomerTermsMemory[];
  constructionLoss: { category_id: string; loss_pct: string; costing_code: string | null }[];
}> {
  const empty = { rateMemory: [], customerTerms: [], constructionLoss: [] };
  const s = await createClient();
  const { data, error } = await s
    .from("cost_sheets")
    .select(
      "code, approved_at, currency_code, margin_pct, overhead_pct, garment_waste_pct, discount_pct, " +
        "opp:opportunities!opportunity_id(title, customer_id, customer:customers!customer_id(name)), " +
        "fabrics:sample_costing_fabrics(*, yarns:sample_costing_fabric_yarns(sno, item_id, yarn_name, mix_pct, rate), " +
        "processes:sample_costing_fabric_processes(sno, process_id, process_name, rate))",
    )
    .eq("costing_type", "sample")
    .eq("status", "approved")
    .order("approved_at", { ascending: false })
    .limit(200);
  if (error) return empty;
  const seen = new Map<string, FabricRateMemory>();
  const terms = new Map<string, CustomerTermsMemory>();
  const loss = new Map<string, { category_id: string; loss_pct: string; costing_code: string | null }>();
  for (const sheet of (data ?? []) as unknown as MemoryDb[]) {
    const custId = sheet.opp?.customer_id ?? null;
    if (custId && !terms.has(custId)) {
      const g = (k: string) => (sheet[k] == null ? "" : String(Number(sheet[k])));
      terms.set(custId, {
        customer_id: custId,
        costing_code: sheet.code,
        currency_code: (sheet.currency_code as string | null) ?? null,
        margin_pct: g("margin_pct"),
        overhead_pct: g("overhead_pct"),
        garment_waste_pct: g("garment_waste_pct"),
        discount_pct: g("discount_pct"),
      });
    }
    for (const f of sheet.fabrics ?? []) {
      // fabric_id IS the structure since 0698 — the construction the loss keys on.
      const cat = f.fabric_id;
      if (cat && f.process_loss_pct != null && !loss.has(cat)) {
        loss.set(cat, { category_id: cat, loss_pct: str(f.process_loss_pct), costing_code: sheet.code });
      }
      const key = rateMemoryKey(f.fabric_id, f.quality ?? "");
      if (!key || seen.has(key)) continue;
      seen.set(key, {
        key,
        costing_code: sheet.code,
        customer_name: one(sheet.opp?.customer)?.name ?? sheet.opp?.title ?? null,
        approved_at: sheet.approved_at,
        fabric: {
          fabric_id: f.fabric_id,
          quality: f.quality ?? "",
          yarn_rate: str(f.yarn_rate),
          yarns: bySno(f.yarns).map((y, i) => ({ key: `m${i}`, item_id: y.item_id, yarn_name: y.yarn_name ?? "", mix_pct: str(y.mix_pct), rate: str(y.rate) })),
          knitting_rate: str(f.knitting_rate),
          dyeing_rate: str(f.dyeing_rate),
          finishing_rate: str(f.finishing_rate),
          process_loss_pct: str(f.process_loss_pct),
          is_direct: !!f.is_direct,
          direct_rate: str(f.direct_rate),
          processes: bySno(f.processes).map((p, i) => ({ key: `m${i}`, process_id: p.process_id, process_name: p.process_name ?? "", rate: str(p.rate) })),
        },
      });
    }
  }
  return { rateMemory: [...seen.values()], customerTerms: [...terms.values()], constructionLoss: [...loss.values()] };
}

/** The latest Quotes / Orders rate per currency in effect today (v2 §4.1). */
async function getQuoteRates(): Promise<Record<string, number>> {
  const s = await createClient();
  const { data, error } = await s
    .from("exchange_rate_lines")
    .select("currency_code, ex_rate, entry:exchange_rate_entries!inner(register, entry_date, effective_from)")
    .eq("entry.register", "quotes_orders");
  if (error) return {};
  type Row = { currency_code: string; ex_rate: number | string; entry: { entry_date: string | null; effective_from: string | null } | null };
  const day = new Date().toISOString().slice(0, 10);
  const best = new Map<string, { from: string; rate: number }>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const from = r.entry?.effective_from ?? r.entry?.entry_date ?? "";
    const rate = Number(r.ex_rate);
    if (!(rate > 0) || (from && from > day)) continue;
    const held = best.get(r.currency_code);
    if (!held || from > held.from) best.set(r.currency_code, { from, rate });
  }
  return Object.fromEntries([...best].map(([k, v]) => [k, v.rate]));
}

/**
 * EVERY REVISION OF ONE COSTING NO, for the reports' revision history (client
 * 2026-10-09). One query, keyed on the code every revision shares; the superseded
 * ones are read too, since they are the point. A failed read THROWS: an empty
 * history would print as "never revised", which is a real and unremarkable answer.
 */
export async function getCostingRevisionSources(code: string | null): Promise<RevisionSource[]> {
  if (!code) return [];
  const s = await createClient();
  const { data, error } = await s
    .from("cost_sheets")
    .select("id, version, status, is_draft, costing_date, computed_fob, target_fob, profit_loss_pct, currency_code")
    .eq("code", code)
    .eq("costing_type", "sample")
    .order("version", { ascending: true });
  if (error) throw new Error(`Could not load this costing's revisions: ${error.message}`);
  const rows = ((data ?? []) as unknown as (Omit<RevisionSource, "computed_fob" | "target_fob" | "profit_loss_pct"> & {
    computed_fob: number | string | null;
    target_fob: number | string | null;
    profit_loss_pct: number | string | null;
  })[]).map((r) => ({
    ...r,
    computed_fob: r.computed_fob == null ? null : Number(r.computed_fob),
    target_fob: r.target_fob == null ? null : Number(r.target_fob),
    profit_loss_pct: r.profit_loss_pct == null ? null : Number(r.profit_loss_pct),
  }));
  return rows;
}

/**
 * THE APPROVAL FACTS OF ONE COSTING, for the reports' approval line (client
 * 2026-10-09). `decided_by` is a profile id; the name comes through
 * `creator_names()` (SECURITY DEFINER, id + name only) because `profiles` lets a
 * user read only their own row. A failed read THROWS — a silent null would print
 * "Approved automatically", which is a claim about the money.
 */
export async function getCostingApprovalFacts(id: string): Promise<ApprovalFacts | null> {
  const s = await createClient();
  const { data, error } = await s
    .from("cost_sheets")
    .select("status, is_draft, submitted_at, approved_at, decided_at, decided_by, decision_remark, profit_loss_pct")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load this costing's approval: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as {
    status: CostingStatus;
    is_draft: boolean | null;
    submitted_at: string | null;
    approved_at: string | null;
    decided_at: string | null;
    decided_by: string | null;
    decision_remark: string | null;
    profit_loss_pct: number | string | null;
  };
  let decidedByName: string | null = null;
  if (r.decided_by) {
    const { data: names } = await s.rpc("creator_names", { ids: [r.decided_by] });
    decidedByName = ((names ?? []) as { id: string; full_name: string | null }[])[0]?.full_name ?? null;
  }
  return {
    status: r.status,
    isDraft: !!r.is_draft,
    submittedAt: r.submitted_at,
    approvedAt: r.approved_at,
    decidedByName,
    decidedAt: r.decided_at,
    // The automatic clearance writes its own sentence into the remark; that is
    // the line's headline already, so it is not repeated as a "remark".
    remark: r.decision_remark && !/^cleared on submit/i.test(r.decision_remark) ? r.decision_remark : null,
    lowestMarginPct: r.profit_loss_pct == null ? null : Number(r.profit_loss_pct),
  };
}
