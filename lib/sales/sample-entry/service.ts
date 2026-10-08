import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/masters/country-service";
import { listCurrencies } from "@/lib/masters/service";
import { listConfigLookups } from "@/lib/masters/extras-service";
import { listOrderPeople } from "@/lib/people/order-people";
import { withCreators } from "@/lib/created-by";
import type { Country } from "@/lib/masters/country-types";
import type { Currency } from "@/lib/masters/types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Deactivatable } from "@/lib/masters/inactive";
import { isUnitKind } from "@/lib/orders/styles/rules";
import { INHERITED, headerValueFor } from "./types";
import type {
  AssortLineDraft,
  ComboDraft,
  QuantityDraft,
  SampleEntryListRow,
  SampleEntryRecord,
  StyleDraft,
} from "./types";

/**
 * Sample Entry — the list, the option lists and one record (0683).
 *
 * Every option list selects its switched-off flag and filters NOTHING in SQL
 * (AGENTS.md "Disabled rows"): a value a saved entry already holds must still
 * resolve, or the field renders empty and the next save blanks the FK. The
 * pickers hide the switched-off rows themselves.
 *
 * A failed option query THROWS rather than handing back `[]` — an empty
 * Customer or Merchandiser list reads as "nobody has been set up yet", a real
 * and unremarkable answer that nobody reports (the reasoning on
 * `getCustomerRows` in lib/orders/amendments/service.ts).
 */

export type PickerRow = { id: string; code: string | null; name: string } & Deactivatable;
export type CustomerOption = PickerRow & { country_id: string | null };
export type MerchandiserOption = PickerRow & { is_merchandiser: boolean };
export type ConsigneeOption = PickerRow & { customer_id: string | null };
export type FabricOption = PickerRow & { category_id: string | null };

export type SampleEntryFormData = {
  customers: CustomerOption[];
  merchandisers: MerchandiserOption[];
  countries: Country[];
  currencies: Currency[];
  /** Every config_lookups kind — ship_type, size, assortment_type, fabric_color. */
  lookups: ConfigLookup[];
  /** Season master rows (0686) — the quarterly buying cycles Q1–Q4. */
  seasons: PickerRow[];
  /** Agent = a VENDOR classified Service Provider ▸ Buying Agent / Service
   *  Agent (client 2026-10-06), plus any vendor a saved entry already names. */
  agents: (PickerRow & { qualifies: boolean })[];
  consignees: ConsigneeOption[];
  ports: PickerRow[];
  /** A COORDINATE IS A GARMENT (0396) — `items` of class GAR. */
  coordinates: PickerRow[];
  /** Fabric Structure = a FABRIC-class category (Order Entry's Structure, 0405). */
  fabricStructures: PickerRow[];
  /** Fabric Code — FABRIC-class items, narrowed on the screen by the Structure. */
  fabrics: FabricOption[];
};

async function classIds(code: string): Promise<Set<string>> {
  const s = await createClient();
  const { data, error } = await s.from("config_lookups").select("id, code").eq("kind", "item_class");
  if (error) throw new Error(`Could not load item classes: ${error.message}`);
  return new Set(
    ((data ?? []) as { id: string; code: string | null }[])
      .filter((c) => (c.code ?? "").toUpperCase() === code)
      .map((c) => c.id),
  );
}

/* THE CUSTOMER-AGENT PREFILL IS GONE (0686). `customer_agents.agent_id` names
   the old `agent` config lookup, and Agent is a vendor now — an id from one
   list cannot fill a picker over the other. */
async function getCustomers(): Promise<CustomerOption[]> {
  const s = await createClient();
  const { data, error } = await s.from("customers").select("id, code, name, inactive, country_id").order("name");
  if (error) throw new Error(`Could not load customers: ${error.message}`);
  return (data ?? []) as CustomerOption[];
}

/** Season master (0308; Q1–Q4 seeded by 0686). The flag is SELECTED, never
 *  filtered: a season an entry already holds must still resolve. */
async function getSeasons(): Promise<PickerRow[]> {
  const s = await createClient();
  const { data, error } = await s.from("seasons").select("id, code:season, name:season_name, inactive").order("season_name");
  if (error) throw new Error(`Could not load seasons: ${error.message}`);
  return ((data ?? []) as (PickerRow & { name: string | null })[]).map((r) => ({ ...r, name: r.name ?? r.code ?? "" }));
}

/** The vendor service types that make a vendor an Agent (0686 seeds both). */
const AGENT_SERVICE_TYPES = ["BUYING AGENT", "SERVICE AGENT"];

/**
 * Agent — Vendor master, Service Provider ▸ Buying Agent / Service Agent
 * (client 2026-10-06). A vendor qualifies when it Is Service Provider AND one
 * of its Service rows names either type. Every vendor is fetched so a held
 * agent the vendor master has since re-classified still resolves; the screen
 * offers only the qualifying ones plus the one a record holds.
 */
async function getAgents(): Promise<(PickerRow & { qualifies: boolean })[]> {
  const s = await createClient();
  const [{ data: vendors, error }, { data: services, error: svcError }, { data: types, error: typeError }] =
    await Promise.all([
      s.from("master_vendors").select("id, code, name, inactive, is_service_provider").order("name"),
      s.from("master_vendor_services").select("vendor_id, service_type_id"),
      s.from("config_lookups").select("id, name").eq("kind", "vendor_service_type"),
    ]);
  if (error) throw new Error(`Could not load vendors: ${error.message}`);
  if (svcError) throw new Error(`Could not load vendor services: ${svcError.message}`);
  if (typeError) throw new Error(`Could not load vendor service types: ${typeError.message}`);
  const agentTypes = new Set(
    ((types ?? []) as { id: string; name: string }[])
      .filter((t) => AGENT_SERVICE_TYPES.includes(t.name.trim().toUpperCase()))
      .map((t) => t.id),
  );
  const agentVendors = new Set(
    ((services ?? []) as { vendor_id: string; service_type_id: string | null }[])
      .filter((r) => r.service_type_id && agentTypes.has(r.service_type_id))
      .map((r) => r.vendor_id),
  );
  return ((vendors ?? []) as (PickerRow & { is_service_provider: boolean | null })[]).map(
    ({ is_service_provider, ...v }) => ({ ...v, qualifies: !!is_service_provider && agentVendors.has(v.id) }),
  );
}

/** HR ▸ Staff (0674) — the same people and the same narrowing as Order Entry. */
async function getMerchandisers(): Promise<MerchandiserOption[]> {
  const people = await listOrderPeople();
  return people.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    inactive: r.inactive,
    is_merchandiser:
      (r.designation ?? "").toUpperCase().includes("MERCHANDISER") ||
      ["MERCHANDISING", "MERCHANDISER"].includes((r.department_name ?? "").trim().toUpperCase()),
  }));
}

async function getConsignees(): Promise<ConsigneeOption[]> {
  const s = await createClient();
  const { data, error } = await s.from("consignees").select("id, code, name, inactive, customer_id").order("name");
  if (error) throw new Error(`Could not load consignees: ${error.message}`);
  return (data ?? []) as ConsigneeOption[];
}

async function getPorts(): Promise<PickerRow[]> {
  const s = await createClient();
  // `code:short_name` — `ports` has no `code` column. And NO `inactive`: the
  // migration that adds it (supabase/migrations/0547_*) collided with two other
  // 0547s and was never applied to the live database (checked against the
  // catalog 2026-10-06). Selecting it rejects the whole query.
  const { data, error } = await s.from("ports").select("id, code:short_name, name").order("name");
  if (error) throw new Error(`Could not load ports: ${error.message}`);
  return (data ?? []) as PickerRow[];
}

async function getItemsOfClass(code: string): Promise<(PickerRow & { category_id: string | null })[]> {
  const ids = await classIds(code);
  if (ids.size === 0) return [];
  const s = await createClient();
  const { data, error } = await s
    .from("items")
    .select("id, code, name, is_active, item_class_id, category_id")
    .in("item_class_id", [...ids])
    .order("name");
  if (error) throw new Error(`Could not load ${code} items: ${error.message}`);
  return ((data ?? []) as (PickerRow & { category_id: string | null; is_active: boolean | null })[]).map(
    ({ id, code: c, name, is_active, category_id }) => ({ id, code: c, name, is_active, category_id }),
  );
}

async function getFabricStructures(): Promise<PickerRow[]> {
  const ids = await classIds("FABRIC");
  if (ids.size === 0) return [];
  const s = await createClient();
  const { data, error } = await s
    .from("categories")
    .select("id, code:short_name, name, inactive")
    .in("item_class_id", [...ids])
    .order("name");
  if (error) throw new Error(`Could not load fabric structures: ${error.message}`);
  return (data ?? []) as PickerRow[];
}

export async function getSampleEntryFormData(): Promise<SampleEntryFormData> {
  const [customers, merchandisers, countries, currencies, lookups, consignees, ports, coordinates, fabricStructures, fabrics, seasons, agents] =
    await Promise.all([
      getCustomers(),
      getMerchandisers(),
      listCountries(),
      listCurrencies(),
      listConfigLookups(),
      getConsignees(),
      getPorts(),
      getItemsOfClass("GAR"),
      getFabricStructures(),
      getItemsOfClass("FABRIC"),
      getSeasons(),
      getAgents(),
    ]);
  return {
    customers,
    merchandisers,
    countries,
    currencies,
    lookups,
    consignees,
    ports,
    coordinates: coordinates.map(({ id, code, name, is_active }) => ({ id, code, name, is_active })),
    fabricStructures,
    fabrics,
    seasons,
    agents,
  };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------
type ListDbRow = {
  id: string;
  code: string | null;
  received_date: string | null;
  customer_id: string | null;
  enquiry_against: string | null;
  enquiry_action: string | null;
  season: string | null;
  season_year: number | null;
  is_draft: boolean | null;
  created_at: string;
  created_by: string | null;
  title: string | null;
  customer: { name: string | null } | { name: string | null }[] | null;
  styles: { sample_qty: number | null; billable: boolean | null }[] | null;
};

/**
 * Every enquiry, newest last — "Listings in ENTRY order" (oldest first).
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
 */
export async function listSampleEntries(): Promise<SampleEntryListRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("opportunities")
    .select(
      "id, code, received_date, customer_id, enquiry_against, enquiry_action, season, season_year, is_draft, " +
        "created_at, created_by, title, customer:customers!customer_id(name), styles(sample_qty, billable)",
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load sample entries: ${error.message}`);
  const rows = ((data ?? []) as unknown as ListDbRow[]).map((r) => {
    const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    const styles = r.styles ?? [];
    return {
      id: r.id,
      code: r.code,
      received_date: r.received_date,
      customer_id: r.customer_id,
      // An enquiry raised on the old bulk screen names a `buyers` row, not a
      // customer; its title is that buyer's name, so it still reads correctly.
      customer_name: cust?.name ?? r.title,
      enquiry_against: r.enquiry_against,
      enquiry_action: r.enquiry_action,
      season: r.season,
      season_year: r.season_year,
      style_count: styles.length,
      sample_qty: styles.reduce((t, x) => t + (Number(x.sample_qty) || 0), 0),
      billable_count: styles.filter((x) => !!x.billable).length,
      is_draft: !!r.is_draft,
      created_at: r.created_at,
      created_by: r.created_by,
    } satisfies SampleEntryListRow;
  });
  return withCreators(rows);
}

// ---------------------------------------------------------------------------
// One record, as the editor's state
// ---------------------------------------------------------------------------
type Num = number | string | null;
const str = (v: Num | undefined) => (v == null ? "" : String(v));
type StyleDb = Record<string, unknown> & {
  id: string;
  sno: number | null;
  coordinates: { sno: number; coordinate_id: string | null }[] | null;
  sizes: { sno: number; garment_size: string | null }[] | null;
  combos:
    | {
        sno: number;
        combo: string | null;
        sizes: { sno: number; garment_size: string | null; order_qty: Num }[] | null;
      }[]
    | null;
  files:
    | {
        sno: number;
        doc_kind: string | null;
        file_name: string;
        storage_path: string;
        mime_type: string | null;
        size_bytes: number | null;
      }[]
    | null;
  quantities:
    | (Record<string, unknown> & {
        sno: number;
        lines:
          | {
              sno: number;
              combo: string | null;
              style_ref: string | null;
              no_of_cartons: Num;
              inners_per_carton: Num;
              sizes: { sno: number; garment_size: string | null; qty: Num }[] | null;
            }[]
          | null;
      })[]
    | null;
};

const bySno = <T extends { sno: number | null }>(xs: T[] | null | undefined) =>
  [...(xs ?? [])].sort((a, b) => (a.sno ?? 0) - (b.sno ?? 0));

export async function getSampleEntryRecord(id: string): Promise<SampleEntryRecord | null> {
  const s = await createClient();
  const { data, error } = await s
    .from("opportunities")
    .select(
      "id, code, received_date, enquiry_against, enquiry_action, customer_id, country_id, season_id, season_year, " +
        "customer_reference, agent_id, receipt_mode, receipt_date, delivery_to, delivery_mode, multi_order, " +
        "styles(*, coordinates:sample_style_coordinates(sno, coordinate_id), sizes:style_sizes(sno, garment_size), " +
        "combos:style_combos(sno, combo, sizes:style_combo_sizes(sno, garment_size, order_qty)), " +
        "files:sample_style_files(sno, doc_kind, file_name, storage_path, mime_type, size_bytes), " +
        "quantities:sample_style_quantities(*, lines:sample_quantity_assort_lines(sno, combo, style_ref, no_of_cartons, inners_per_carton, " +
        "sizes:sample_quantity_assort_sizes(sno, garment_size, qty))))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the sample entry: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as Record<string, unknown> & { id: string; code: string | null; styles: StyleDb[] | null };
  const g = (k: string) => (r[k] == null ? "" : String(r[k]));
  const gid = (k: string) => (r[k] == null ? null : String(r[k]));

  let seq = 0;
  const key = () => `r${seq++}`;

  const styles: StyleDraft[] = bySno(r.styles).map((st) => {
    const v = (k: string) => (st[k] == null ? "" : String(st[k]));
    const vid = (k: string) => (st[k] == null ? null : String(st[k]));
    const sizes = bySno(st.sizes)
      .map((z) => z.garment_size ?? "")
      .filter(Boolean);
    const combos: ComboDraft[] = bySno(st.combos).map((c) => ({
      key: key(),
      combo: c.combo ?? "",
      sizes: Object.fromEntries((c.sizes ?? []).map((z) => [z.garment_size ?? "", str(z.order_qty)])),
    }));
    const quantities: QuantityDraft[] = bySno(st.quantities).map((q) => {
      const qv = (k: string) => (q[k] == null ? "" : String(q[k]));
      const qid = (k: string) => (q[k] == null ? null : String(q[k]));
      const lines: AssortLineDraft[] = bySno(q.lines).map((l) => ({
        key: key(),
        combo: l.combo ?? "",
        style_ref: l.style_ref ?? "",
        no_of_cartons: str(l.no_of_cartons),
        inners_per_carton: str(l.inners_per_carton),
        sizes: Object.fromEntries((l.sizes ?? []).map((z) => [z.garment_size ?? "", str(z.qty)])),
      }));
      return {
        key: key(),
        country_id: qid("country_id"),
        ref_no: qv("ref_no"),
        consignee_id: qid("consignee_id"),
        assortment_type_id: qid("assortment_type_id"),
        po_qty: qv("po_qty"),
        delivery_date: qv("delivery_date"),
        earlier_shipment_date: qv("earlier_shipment_date"),
        discharge_port_id: qid("discharge_port_id"),
        final_destination_id: qid("final_destination_id"),
        pack: qv("pack"),
        no_of_cartons: qv("no_of_cartons"),
        master_carton_name: qv("master_carton_name"),
        po_no: qv("po_no"),
        ratio_for: qv("ratio_for") === "inner" || qv("ratio_for") === "master" ? (qv("ratio_for") as "inner" | "master") : "",
        // Defaulted TRUE in 0685, so a row from before then reads as Single.
        is_single_style_pack: q.is_single_style_pack !== false,
        lines,
      };
    });
    const unit = v("unit_kind");
    return {
      key: key(),
      id: st.id,
      sample_no: vid("sample_no"),
      name: v("name"),
      article_no: v("article_no"),
      description: v("description"),
      // Unanswered stays blank — never guessed as PCS (Order Entry, rules.ts).
      unit_kind: isUnitKind(unit) ? unit : "",
      sample_qty: v("sample_qty"),
      delivery_date: v("delivery_date"),
      merchandiser_id: vid("merchandiser_id"),
      order_date: v("order_date"),
      fabric_structure_id: vid("fabric_structure_id"),
      fabric_id: vid("fabric_id"),
      gsm: v("gsm"),
      tech_pack: v("tech_pack"),
      customer_reference: v("customer_reference"),
      receipt_mode: v("receipt_mode"),
      receipt_date: v("receipt_date"),
      delivery_to: v("delivery_to"),
      agent_id: vid("agent_id"),
      delivery_mode: v("delivery_mode"),
      delivery_through: v("delivery_through"),
      accessories_reqd: !!st.accessories_reqd,
      billable: !!st.billable,
      ship_type_id: vid("ship_type_id"),
      ship_mode: v("ship_mode"),
      currency_code: vid("currency_code"),
      price: v("price"),
      exchange_rate: v("exchange_rate"),
      files: bySno(st.files).map((f) => ({
        key: key(),
        // Stored `tech_pack` shows in the component's `order_sheet` slot (types.ts).
        doc_kind: f.doc_kind === "sketch" ? "sketch" : f.doc_kind === "tech_pack" ? "order_sheet" : "",
        file_name: f.file_name,
        storage_path: f.storage_path,
        mime_type: f.mime_type ?? "",
        size_bytes: Number(f.size_bytes) || 0,
        style_ref_no: null,
      })),
      coordinates: bySno(st.coordinates).map((c) => ({ key: key(), coordinate_id: c.coordinate_id })),
      sizes,
      combos,
      quantities,
    };
  });

  const header = {
    received_date: g("received_date"),
    enquiry_against: g("enquiry_against"),
    enquiry_action: g("enquiry_action"),
    customer_id: gid("customer_id"),
    country_id: gid("country_id"),
    season_id: gid("season_id"),
    season_year: g("season_year"),
    customer_reference: g("customer_reference"),
    agent_id: gid("agent_id"),
    receipt_mode: g("receipt_mode"),
    receipt_date: g("receipt_date"),
    delivery_to: g("delivery_to"),
    delivery_mode: g("delivery_mode"),
    multi_order: r.multi_order === true,
  };

  /* THE SAVE STORES THE RESOLVED VALUE, so on the way back a line value equal
     to the header's is read as "inherits" again — otherwise the first save
     would freeze every line at that day's header and a later header change
     would silently stop reaching them (spec §2.3, Data Inheritance). */
  for (const st of styles) {
    for (const f of INHERITED) {
      if ((st[f] ?? "") !== "" && (st[f] ?? "") === headerValueFor(header, f)) {
        if (f === "agent_id") st.agent_id = null;
        else st[f] = "";
      }
    }
  }

  return { id: r.id, code: r.code, header, styles };
}
