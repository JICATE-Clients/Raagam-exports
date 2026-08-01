"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Package, SlidersHorizontal, Truck, User, Users, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { StatePicker } from "@/components/masters/state-picker";
import { ApplicantPicker } from "@/components/masters/applicant-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { ChildGrid } from "@/components/masters/child-grid";
import { MobileWhatsAppFields, useIsdLookup } from "@/components/masters/contact-fields";
import { PackingFormatColumnsDialog } from "@/components/masters/packing-format-columns-dialog";
import { GstinInsight, type GstinSuggestion } from "@/components/masters/gstin-insight";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { decodeGstin, matchGstinState } from "@/lib/validation/gstin";
import { defaultCountryId, defaultStateId } from "@/lib/masters/geo-defaults";
import type { PackingFormatColumn } from "@/lib/masters/packing-format-columns-service";
import { createCustomer, updateCustomer, deleteCustomer } from "@/lib/masters/customer-actions";
import {
  partyOrigin,
  OriginBadge,
  PublishesBadge,
  originNameHint,
  originDeleteBlock,
  type PartyOrigin,
} from "@/components/masters/party-origin";
import { PARTY_ROLE } from "@/lib/masters/party-origin-text";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  type Customer,
  type CustomerInput,
  SHIP_MODES,
  PAY_MODES,
  BUSINESS_ENTITIES,
  PAN_BUSINESS_ENTITY,
} from "@/lib/masters/customer-types";
import type { Applicant } from "@/lib/masters/applicant-types";
import type { Country } from "@/lib/masters/country-types";
import type { Currency } from "@/lib/masters/types";
import { lookupLabel, type ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type SectionKey = "identity" | "address" | "agents" | "supplied" | "vendors" | "general";

type HeaderForm = {
  code: string;
  name: string;
  inactive: boolean;
  doc_prefix: string;
  doc_id: string;
  also_consignee: boolean;
  also_notify: boolean;
  business_entity: string;
  inhouse_unit_id: string;
  country_id: string;
  // Address
  street: string;
  city_id: string;
  state_id: string;
  pin: string;
  address_country_id: string;
  land_line: string;
  mobile: string;
  /** null = "same as mobile" (tick on). "" = tick off, nothing typed yet. */
  whatsapp: string | null;
  email: string;
  web_site: string;
  // General
  currency_1: string;
  currency_2: string;
  currency_3: string;
  ship_mode: string;
  ship_type_id: string;
  pay_mode: string;
  receivable_term_id: string;
  port_of_loading_id: string;
  port_of_discharge_id: string;
  final_destination_id: string;
  pref_courier_id: string;
  packing_list_format_id: string;
  commercial_invoice_format_id: string;
  color_spec_applicable: boolean;
  tcs_applicable: boolean;
  gst_no: string;
};
/**
 * Only one master publishes customers — Applicant ▸ Also Customer (0371) — but
 * this goes through the same helper as Consignee and Notify so all three read
 * and behave identically.
 */
const customerOrigin = (r: Customer) =>
  partyOrigin([
    {
      id: r.source_applicant_id,
      source: r.source_applicant,
      from: "Applicant",
      flag: "Also Customer",
    },
  ]);

/** What this customer has published — the far end of the same link, and what a
 *  delete here would take with it (0378). */
const customerPublishes = (r: Customer): string[] => [
  ...(r.also_consignee ? [PARTY_ROLE.consignee] : []),
  ...(r.also_notify ? [PARTY_ROLE.notify] : []),
];

const BLANK: HeaderForm = {
  code: "",
  name: "",
  inactive: false,
  doc_prefix: "",
  doc_id: "",
  also_consignee: false,
  also_notify: false,
  business_entity: "",
  inhouse_unit_id: "",
  country_id: "",
  street: "",
  city_id: "",
  state_id: "",
  pin: "",
  address_country_id: "",
  land_line: "",
  mobile: "",
  whatsapp: null,
  email: "",
  web_site: "",
  currency_1: "",
  currency_2: "",
  currency_3: "",
  ship_mode: "",
  ship_type_id: "",
  pay_mode: "",
  receivable_term_id: "",
  port_of_loading_id: "",
  port_of_discharge_id: "",
  final_destination_id: "",
  pref_courier_id: "",
  packing_list_format_id: "",
  commercial_invoice_format_id: "",
  color_spec_applicable: false,
  tcs_applicable: false,
  gst_no: "",
};

/**
 * How wide each scalar field is, on the 12-column track (LAYOUT.md §3).
 *
 * Every section used to hand-roll `sm:grid-cols-2`, so a 3-letter currency code
 * got the same ~560px box as a customer name (client 2026-07-24 #3). Sizes here
 * follow the DATA — `xs`=2 · `sm`=3 · `md`=4 · `lg`=6 · `full`=12, out of 12.
 * Adjust here, not at the call sites.
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12 — at 13 the last field wraps onto a row of
 * its own with the rest of that row left empty under it. The rows, in DOM order:
 *
 *   Identity  Name 6 + Doc Prefix 3 + ID 3                                = 12
 *             Also Consignee 2 + Also Notify 2 + Country 4 + Entity 4     = 12
 *             In-house Unit ID 3                                          (tail)
 *             `inactive` is `full` above all of it: it renders only while
 *             editing, so anything sharing its row would reflow on Add.
 *
 *   Address   Street 12 (a 3-row textarea stands alone)                   = 12
 *             City 3 + State 3 + Pin 2 + Country 4                        = 12
 *             Land Line 3 + Mobile 3 + WhatsApp 3 + E-Mail 3              = 12
 *             Web site 6                                                  (tail)
 *             Mobile/WhatsApp are `MobileWhatsAppFields` — a fragment of two
 *             cells, so their 3 is passed as a literal `cellClassName` rather
 *             than from this map (Tailwind v4 scans source text).
 *
 *   General   Currency 1/2/3 2+2+2 + Ship Mode 2 + Ship Type 4            = 12
 *             Pay Mode 2 + Receivable Terms 6 + Pref. Courier 4           = 12
 *             Port of Loading 4 + Port of Discharge 4 + Destination 4     = 12
 *             Packing List Format 6 + Commercial Invoice Format 6         = 12
 *             Color Spec 3 + TCS 2 + GST No 3                             = 8
 *             GstinInsight 12 — the fact strip decoded from the GST number
 *             above it, which is why that row stops at 8 rather than filling.
 */
/**
 * ONE SIZE, EVERY FIELD: `sm` = 3 of 12 = four per row (client 2026-07-29). The
 * client picked the City / State / Pin / Country row out as the correct shape
 * and asked for the rest of the masters to match it, so nothing here is sized
 * to its own data any more. See applicant-master-screen for the full statement
 * of the rule and what it trades away.
 *
 * `gstin_insight` is the one exception and is not a field — it is a read-only
 * fact strip (decoded state, PAN, supply type) that stands alone on its row by
 * nature, the same way a child grid does.
 *
 * Packing List Format keeps its inline "Columns" button inside a 3-column cell.
 * That is ~285px on this screen — the editor is full width, so a 3-col span is
 * not the ~132px it would be in one column of a `SectionGrid` — which leaves
 * the picker ~185px beside a ~90px button. Split the editor into columns and
 * that pairing is the first thing that breaks.
 */
const FIELD_SIZE = {
  // ---- Identity ----
  inactive: "sm",
  name: "sm",
  doc_prefix: "sm",
  doc_id: "sm",
  also_consignee: "sm",
  also_notify: "sm",
  country_id: "sm",
  business_entity: "sm",
  inhouse_unit_id: "sm",
  // ---- Address ----
  street: "sm", // a single-line Input now — a Textarea sets the row's height
  city_id: "sm",
  state_id: "sm",
  pin: "sm",
  address_country_id: "sm",
  land_line: "sm",
  email: "sm",
  web_site: "sm",
  // ---- General ----
  currency_1: "sm",
  currency_2: "sm",
  currency_3: "sm",
  ship_mode: "sm",
  ship_type_id: "sm",
  pay_mode: "sm",
  receivable_term_id: "sm",
  pref_courier_id: "sm",
  port_of_loading_id: "sm",
  port_of_discharge_id: "sm",
  final_destination_id: "sm",
  packing_list_format_id: "sm", // holds the picker AND its "Columns" button
  commercial_invoice_format_id: "sm",
  color_spec_applicable: "sm",
  tcs_applicable: "sm",
  gst_no: "sm",
  gstin_insight: "full", // a fact strip, not a field — see above
} satisfies Record<string, FieldSize>;

type ContactRow = {
  key: string;
  department_id: string;
  contact_name: string;
  designation_id: string;
  land_line: string;
  mobile: string;
  email_id: string;
  internal_department_id: string;
};
const blankContact = (key: string): ContactRow => ({
  key,
  department_id: "",
  contact_name: "",
  designation_id: "",
  land_line: "",
  mobile: "",
  email_id: "",
  internal_department_id: "",
});
const contactHasData = (c: ContactRow) =>
  !!(
    c.department_id ||
    c.contact_name.trim() ||
    c.designation_id ||
    c.land_line.trim() ||
    c.mobile.trim() ||
    c.email_id.trim() ||
    c.internal_department_id
  );

type AgentRow = { key: string; agent_type_id: string; agent_id: string };
type CatRow = { key: string; category_id: string };
type VendorRow = { key: string; vendor_id: string };
type MarkRow = { key: string; marking: string };

/**
 * Master-detail CRUD for the legacy "Customer" master (Associates) — full 5-tab
 * form. Full-screen overlay with a sticky identity band + left section rail
 * (completion dots) + scrollable content + sticky save bar. Sections: Identity ·
 * Address · Agents · Customer Supplied Items · Customer Nominated Vendors ·
 * CustomerGeneral. Every legacy icon field is a picker (see
 * raagam-masters-picker-wiring).
 */
export function CustomerMasterScreen({
  rows,
  applicants,
  countries,
  cities,
  states,
  departments,
  designations,
  internalDepartments,
  currencies,
  shipTypes,
  sewingCategories,
  packingCategories,
  agentTypes,
  agentOptions,
  packingFormats,
  commercialFormats,
  vendors,
  receivableTerms,
  ports,
  destinations,
  couriers,
  packingColumns,
  companyGstin = null,
  perms,
}: {
  rows: Customer[];
  applicants: Applicant[];
  countries: Country[];
  cities: ConfigLookup[];
  states: ConfigLookup[];
  departments: ConfigLookup[];
  designations: ConfigLookup[];
  internalDepartments: ConfigLookup[];
  currencies: Currency[];
  shipTypes: ConfigLookup[];
  /** Categories of item class SEW — feeds the Sewing Accessories card. */
  sewingCategories: ConfigLookup[];
  /** Categories of item class PACK — feeds the Packaging Accessories card. */
  packingCategories: ConfigLookup[];
  agentTypes: ConfigLookup[];
  agentOptions: ConfigLookup[];
  packingFormats: ConfigLookup[];
  commercialFormats: ConfigLookup[];
  vendors: PickerItem[];
  receivableTerms: PickerItem[];
  ports: PickerItem[];
  destinations: PickerItem[];
  couriers: PickerItem[];
  packingColumns: PackingFormatColumn[];
  /**
   * Our own GSTIN — the reference point that turns a customer's GSTIN into
   * "Within State" / "Other State". Optional because the /masters page does not
   * fetch the company profile on the customer branch yet (only the vendor one
   * does); until it does, decodeGstin reports supply "unknown" and the strip
   * simply omits that fact.
   */
  companyGstin?: string | null;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  // list filtering/search is owned by MasterListShell
  const [open, setOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  /** The row being READ. Separate from `editId` — a view must never arm Save. */
  const [viewRow, setViewRow] = useState<Customer | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  /**
   * Set while editing a row Applicant ▸ Also Customer published (0371). Its
   * Name belongs to the applicant and is read-only here — that removes the
   * rename conflict instead of resolving it. Everything else on this record
   * (GST, TCS, terms, its child grids) is genuinely its own.
   */
  const [editOrigin, setEditOrigin] = useState<PartyOrigin | null>(null);
  const [dirty, setDirty] = useState(false);
  const isdOf = useIsdLookup(countries);

  // Hold off the silent PWA auto-reload while there's unsaved work or a save is
  // in flight. The overlay itself is a MasterFullScreen, which already guards.
  useUnsavedGuard(dirty || isPending);

  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [applicantIds, setApplicantIds] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [sewing, setSewing] = useState<CatRow[]>([]);
  const [packing, setPacking] = useState<CatRow[]>([]);
  const [nominated, setNominated] = useState<VendorRow[]>([]);
  const [recommended, setRecommended] = useState<VendorRow[]>([]);
  const [markings, setMarkings] = useState<MarkRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  // (body-scroll-lock + section state now live inside MasterFullScreen)

  const applicantById = useMemo(() => {
    const m = new Map<string, Applicant>();
    for (const a of applicants) m.set(a.id, a);
    return m;
  }, [applicants]);
  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);

  /**
   * id → name across every option list the editor's pickers already receive —
   * config lists, the two Category sets (`categories` rows since 0356, NOT
   * config_lookups) and the four RecordPicker masters. One map for all of them
   * because these ids are uuids and cannot collide, and the read-only view
   * resolves an FK the same way the picker does: out of props, never with a
   * query of its own.
   */
  const optionName = useMemo(() => {
    const m = new Map<string, string>();
    const lists: { id: string; name: string }[][] = [
      cities,
      states,
      departments,
      designations,
      internalDepartments,
      shipTypes,
      sewingCategories,
      packingCategories,
      agentTypes,
      agentOptions,
      packingFormats,
      commercialFormats,
      vendors,
      receivableTerms,
      ports,
      destinations,
      couriers,
    ];
    for (const list of lists) for (const o of list) m.set(o.id, o.name);
    // Ship Type overwrites its own plain-name entries: its code is an Incoterm,
    // so the view reads "FREE ON BOARD (FOB)" — the same label the field showed.
    for (const s of shipTypes) m.set(s.id, lookupLabel("ship_type", s));
    return m;
  }, [
    cities,
    states,
    departments,
    designations,
    internalDepartments,
    shipTypes,
    sewingCategories,
    packingCategories,
    agentTypes,
    agentOptions,
    packingFormats,
    commercialFormats,
    vendors,
    receivableTerms,
    ports,
    destinations,
    couriers,
  ]);
  /** Never renders a raw uuid: an id we cannot name reads as nothing at all. */
  const nameOf = (id: string | null | undefined) => (id ? (optionName.get(id) ?? "") : "");

  // ---------------------------------------------------------------- GSTIN ----
  // Everything below is decoded from the GST number itself — no lookup, no
  // network. See lib/validation/gstin.ts for what the 15 characters carry.
  //
  // Unlike the vendor screen this one writes NOTHING automatically: customers
  // have no PAN column, so there is no empty box the GSTIN can safely fill.
  // That also means no `loadedGstin` ref is needed here — merely opening a
  // record cannot mark the form dirty when nothing auto-fills.

  const gstin = useMemo(
    () => decodeGstin(form.gst_no, { companyGstin }),
    [form.gst_no, companyGstin],
  );
  // The State master row this customer's GSTIN points at — code first, spelling
  // as a fallback. Shared with vendor and consignee; see matchGstinState.
  const gstinState = useMemo(() => matchGstinState(gstin, states), [gstin, states]);

  // What a NEW customer's Address block opens on: India, and our own state (read
  // out of the company GSTIN). See lib/masters/geo-defaults.
  const blankForm = useMemo<HeaderForm>(
    () => ({
      ...BLANK,
      state_id: defaultStateId(states, companyGstin),
      // Both columns — the single Country field (Identity) drives them
      // together now (see that picker's comment).
      country_id: defaultCountryId(countries),
      address_country_id: defaultCountryId(countries),
    }),
    [states, countries, companyGstin],
  );

  // Two customers must not share a GSTIN — one registration belongs to exactly
  // one party. Note this is NOT done for PAN anywhere: one PAN legitimately
  // carries one GSTIN per state, so a PAN check would flag multi-state groups.
  const gstDupError = useDuplicateName({
    table: "customers",
    name: form.gst_no,
    nameColumn: "gst_no",
    excludeId: editId ?? undefined,
    label: "GST number",
    enabled: !!form.gst_no.trim(),
    // This one HOLDS the cursor, so it needs the synchronous half as much as
    // the name does — a GSTIN is pasted, and a pasted value is tabbed away from
    // immediately, well inside the 300ms debounce.
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.gst_no,
  });

  /**
   * Two customers must not share a NAME. Customer and Consignee were the only
   * party masters without this — Vendor, Applicant and Notify all guard it on
   * save — so a second "SRI LAKSHMI TEXTILES" saved silently here and nowhere
   * else. Backstopped by the matching guard in `customer-actions.ts`.
   *
   * Stood down while `editOrigin` holds the name read-only: the operator cannot
   * change that field, so an error on it would be a message about a problem
   * they have no way to fix from this screen.
   */
  const nameDupError = useDuplicateName({
    table: "customers",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !editOrigin && !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  // What the GSTIN implies but that we refuse to write silently. Empty while
  // the checksum fails — we never propagate a number we don't trust.
  const gstinSuggestions = useMemo<GstinSuggestion[]>(() => {
    if (!gstin?.checksumValid) return [];
    const out: GstinSuggestion[] = [];

    // PAN_BUSINESS_ENTITY only answers the PAN codes that map to ONE entity
    // (see customer-types.ts) — "Company" and "Firm / LLP" are ambiguous and
    // deliberately offer nothing rather than a guess.
    const entity = PAN_BUSINESS_ENTITY[gstin.panEntityChar];
    if (entity && form.business_entity !== entity) {
      out.push({
        key: "entity",
        label: `Set Entity = ${entity}`,
        onApply: () => {
          set({ business_entity: entity });
          // Toasted because Business Entity sits in Identity while the GST
          // number sits in General — the change lands off-screen.
          success(`Business Entity set to ${entity}`);
        },
      });
    }

    // Gated on "differs", not "is empty". The State box now OPENS on our own
    // state, so an empty-only test would hide this chip on exactly the customers
    // that need it: an out-of-state GSTIN sitting silently beside a defaulted
    // home state. Offered, never written — the same rule as Business Entity.
    if (gstinState && form.state_id !== gstinState.id) {
      out.push({
        key: "state",
        label: `Set State = ${gstinState.name}`,
        onApply: () => {
          set({ state_id: gstinState.id });
          // Toasted because State sits in Address while the GST number sits in
          // General — the change lands off-screen.
          success(`State set to ${gstinState.name} in the Address section`);
        },
      });
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin, gstinState, form.business_entity, form.state_id]);

  function openAdd() {
    setEditId(null);
    setEditOrigin(null);
    setForm(blankForm);
    setContacts([blankContact(newKey())]);
    setApplicantIds([]);
    setAgents([]);
    setSewing([]);
    setPacking([]);
    setNominated([]);
    setRecommended([]);
    setMarkings([]);
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: Customer) {
    setEditId(r.id);
    setEditOrigin(customerOrigin(r));
    // One visible Country field now feeds both stored columns (see the
    // pickers below) — `country_id` is authoritative (it is what the list
    // column, header chip and read-only view all resolve), so it wins; a row
    // saved before this fix that only ever had `address_country_id` filled in
    // still opens with a country rather than a blank picker.
    const countryId = r.country_id ?? r.address_country_id ?? "";
    setForm({
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      doc_prefix: r.doc_prefix ?? "",
      doc_id: r.doc_id ?? "",
      also_consignee: r.also_consignee,
      also_notify: r.also_notify,
      business_entity: r.business_entity ?? "",
      inhouse_unit_id: r.inhouse_unit_id ?? "",
      country_id: countryId,
      street: r.street ?? "",
      city_id: r.city_id ?? "",
      state_id: r.state_id ?? "",
      pin: r.pin ?? "",
      address_country_id: countryId,
      land_line: r.land_line ?? "",
      mobile: r.mobile ?? "",
      // NOT `?? ""` — a stored NULL is the "same as mobile" state.
      whatsapp: r.whatsapp,
      email: r.email ?? "",
      web_site: r.web_site ?? "",
      currency_1: r.currency_1 ?? "",
      currency_2: r.currency_2 ?? "",
      currency_3: r.currency_3 ?? "",
      ship_mode: r.ship_mode ?? "",
      ship_type_id: r.ship_type_id ?? "",
      pay_mode: r.pay_mode ?? "",
      receivable_term_id: r.receivable_term_id ?? "",
      port_of_loading_id: r.port_of_loading_id ?? "",
      port_of_discharge_id: r.port_of_discharge_id ?? "",
      final_destination_id: r.final_destination_id ?? "",
      pref_courier_id: r.pref_courier_id ?? "",
      packing_list_format_id: r.packing_list_format_id ?? "",
      commercial_invoice_format_id: r.commercial_invoice_format_id ?? "",
      color_spec_applicable: r.color_spec_applicable,
      tcs_applicable: r.tcs_applicable,
      gst_no: r.gst_no ?? "",
    });
    setContacts(
      r.contacts.map((c) => ({
        key: newKey(),
        department_id: c.department_id ?? "",
        contact_name: c.contact_name ?? "",
        designation_id: c.designation_id ?? "",
        land_line: c.land_line ?? "",
        mobile: c.mobile ?? "",
        email_id: c.email_id ?? "",
        internal_department_id: c.internal_department_id ?? "",
      })),
    );
    setApplicantIds(r.applicants.map((a) => a.applicant_id).filter((id): id is string => !!id));
    setAgents(
      r.agents.map((a) => ({
        key: newKey(),
        agent_type_id: a.agent_type_id ?? "",
        agent_id: a.agent_id ?? "",
      })),
    );
    setSewing(
      r.supplied_items
        .filter((s) => s.section === "sewing")
        .map((s) => ({ key: newKey(), category_id: s.category_id ?? "" })),
    );
    setPacking(
      r.supplied_items
        .filter((s) => s.section === "packing")
        .map((s) => ({ key: newKey(), category_id: s.category_id ?? "" })),
    );
    setNominated(
      r.nominated_vendors
        .filter((v) => v.list_kind === "nominated")
        .map((v) => ({ key: newKey(), vendor_id: v.vendor_id ?? "" })),
    );
    setRecommended(
      r.nominated_vendors
        .filter((v) => v.list_kind === "recommended")
        .map((v) => ({ key: newKey(), vendor_id: v.vendor_id ?? "" })),
    );
    setMarkings(r.markings.map((m) => ({ key: newKey(), marking: m.marking ?? "" })));
    setDirty(false);
    setOpen(true);
  }

  // ---- child grid helpers ----
  function addContact() {
    setContacts((cs) => [...cs, blankContact(newKey())]);
    setDirty(true);
  }
  function setContactAt(key: string, patch: Partial<ContactRow>) {
    setContacts((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
    setDirty(true);
  }
  function removeContact(key: string) {
    setContacts((cs) => cs.filter((c) => c.key !== key));
    setDirty(true);
  }
  function addApplicant(id: string | null) {
    if (!id) return;
    setApplicantIds((xs) => (xs.includes(id) ? xs : [...xs, id]));
    setDirty(true);
  }
  function removeApplicant(id: string) {
    setApplicantIds((xs) => xs.filter((x) => x !== id));
    setDirty(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: CustomerInput = {
        // Create derives the code from the display name; edit keeps the
        // record's original stored code (held in state, never rendered).
        code: editId ? form.code.trim() || null : form.name.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
        doc_prefix: form.doc_prefix.trim() || null,
        doc_id: form.doc_id.trim() || null,
        also_consignee: form.also_consignee,
        also_notify: form.also_notify,
        business_entity: form.business_entity || null,
        inhouse_unit_id: form.inhouse_unit_id.trim() || null,
        country_id: form.country_id || null,
        street: form.street.trim() || null,
        city_id: form.city_id || null,
        state_id: form.state_id || null,
        pin: form.pin.trim() || null,
        address_country_id: form.address_country_id || null,
        land_line: form.land_line.trim() || null,
        mobile: form.mobile.trim() || null,
        // "" collapses to null — an empty WhatsApp box means "same as mobile".
        whatsapp: form.whatsapp?.trim() || null,
        email: form.email.trim() || null,
        web_site: form.web_site.trim() || null,
        currency_1: form.currency_1 || null,
        currency_2: form.currency_2 || null,
        currency_3: form.currency_3 || null,
        ship_mode: (form.ship_mode || null) as CustomerInput["ship_mode"],
        ship_type_id: form.ship_type_id || null,
        pay_mode: (form.pay_mode || null) as CustomerInput["pay_mode"],
        receivable_term_id: form.receivable_term_id || null,
        port_of_loading_id: form.port_of_loading_id || null,
        port_of_discharge_id: form.port_of_discharge_id || null,
        final_destination_id: form.final_destination_id || null,
        pref_courier_id: form.pref_courier_id || null,
        packing_list_format_id: form.packing_list_format_id || null,
        commercial_invoice_format_id: form.commercial_invoice_format_id || null,
        color_spec_applicable: form.color_spec_applicable,
        tcs_applicable: form.tcs_applicable,
        gst_no: form.gst_no.trim() || null,
        is_draft: asDraft,
        contacts: contacts.map((c, i) => ({
          sno: i + 1,
          department_id: c.department_id || null,
          contact_name: c.contact_name || null,
          designation_id: c.designation_id || null,
          land_line: c.land_line || null,
          mobile: c.mobile || null,
          email_id: c.email_id || null,
          internal_department_id: c.internal_department_id || null,
        })),
        applicants: applicantIds.map((id, i) => ({ sno: i + 1, applicant_id: id })),
        agents: agents.map((a, i) => ({
          sno: i + 1,
          agent_type_id: a.agent_type_id || null,
          agent_id: a.agent_id || null,
        })),
        supplied_items: [
          ...sewing.map((r, i) => ({ section: "sewing" as const, sno: i + 1, category_id: r.category_id || null })),
          ...packing.map((r, i) => ({ section: "packing" as const, sno: i + 1, category_id: r.category_id || null })),
        ],
        nominated_vendors: [
          ...nominated.map((r, i) => ({ list_kind: "nominated" as const, sno: i + 1, vendor_id: r.vendor_id || null })),
          ...recommended.map((r, i) => ({ list_kind: "recommended" as const, sno: i + 1, vendor_id: r.vendor_id || null })),
        ],
        markings: markings.map((m, i) => ({ sno: i + 1, marking: m.marking || null })),
      };
      const res = editId ? await updateCustomer(editId, payload) : await createCustomer(payload);
      if (res.ok) {
        success(editId ? "Customer updated." : "Customer added.");
        setDirty(false);
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Customer) {
    // A published row is owned by its source: deleting it here while "Also
    // Customer" stayed ticked would just republish it on the applicant's next
    // save.
    const origin = customerOrigin(r);
    if (origin) {
      error(originDeleteBlock(origin));
      return;
    }
    startTransition(async () => {
      const res = await deleteCustomer(r.id);
      if (res.ok) {
        success(deletedToast("Customer", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  // ---- completion state (drives the rail dots) ----
  const hasIdentity = !!form.name.trim();
  const hasAddress =
    !!(
      form.street ||
      form.city_id ||
      form.state_id ||
      form.pin ||
      form.address_country_id ||
      form.land_line ||
      form.mobile ||
      form.whatsapp ||
      form.email ||
      form.web_site
    ) || contacts.some(contactHasData);
  const hasAgents = agents.some((a) => a.agent_type_id || a.agent_id);
  const hasSupplied = sewing.some((r) => r.category_id) || packing.some((r) => r.category_id);
  const hasVendors = nominated.some((r) => r.vendor_id) || recommended.some((r) => r.vendor_id);
  const hasGeneral =
    !!(
      form.currency_1 ||
      form.currency_2 ||
      form.currency_3 ||
      form.ship_mode ||
      form.ship_type_id ||
      form.pay_mode ||
      form.receivable_term_id ||
      form.port_of_loading_id ||
      form.port_of_discharge_id ||
      form.final_destination_id ||
      form.pref_courier_id ||
      form.packing_list_format_id ||
      form.commercial_invoice_format_id ||
      form.gst_no ||
      form.color_spec_applicable ||
      form.tcs_applicable
    ) || markings.some((m) => m.marking.trim());
  const done: Record<SectionKey, boolean> = {
    identity: hasIdentity,
    address: hasAddress,
    agents: hasAgents,
    supplied: hasSupplied,
    vendors: hasVendors,
    general: hasGeneral,
  };

  /**
   * The record as a READER sees it. Mirrors the editor's rail — Identity ·
   * Address · Agents · Supplied Items · Nominated Vendors · General — so the
   * view and the form tell the same story, and every FK is resolved to the name
   * the picker would have shown.
   *
   * Nothing here filters empties: `RecordViewSheet` drops an empty value and an
   * all-empty section on its own. The child cards are the exception — they are
   * `content`, which is never auto-hidden, so each is built as `undefined` when
   * the card holds nothing rather than as an empty list.
   */
  function viewSectionsFor(r: Customer): ViewSection[] {
    const viewOrigin = customerOrigin(r);
    const applicantRows = r.applicants
      .map((a) => ({
        key: a.id,
        main: (a.applicant_id ? applicantById.get(a.applicant_id)?.name : null) ?? "",
      }))
      .filter((a) => a.main);

    const contactRows = r.contacts
      .map((c) => {
        const who = [c.contact_name?.trim(), nameOf(c.designation_id), nameOf(c.department_id)]
          .filter(Boolean)
          .join(" · ");
        const reach = [
          c.mobile?.trim(),
          c.land_line?.trim(),
          c.email_id?.trim(),
          nameOf(c.internal_department_id),
        ]
          .filter(Boolean)
          .join(" · ");
        // A contact with no name at all still has to say something, so its
        // phone/email is promoted to the main line rather than sitting alone
        // in the muted column.
        return { key: c.id, main: who || reach, detail: who ? reach : "" };
      })
      .filter((c) => c.main);

    const agentRows = r.agents
      .map((a) => ({
        key: a.id,
        main: nameOf(a.agent_id) || nameOf(a.agent_type_id),
        detail: nameOf(a.agent_id) ? nameOf(a.agent_type_id) : "",
      }))
      .filter((a) => a.main);

    const categoryRows = (section: "sewing" | "packing") =>
      r.supplied_items
        .filter((s) => s.section === section)
        .map((s) => ({ key: s.id, main: nameOf(s.category_id) }))
        .filter((s) => s.main);
    const sewingRows = categoryRows("sewing");
    const packingRows = categoryRows("packing");

    const vendorRows = (kind: "nominated" | "recommended") =>
      r.nominated_vendors
        .filter((v) => v.list_kind === kind)
        .map((v) => ({ key: v.id, main: nameOf(v.vendor_id) }))
        .filter((v) => v.main);
    const nominatedRows = vendorRows("nominated");
    const recommendedRows = vendorRows("recommended");

    const markingRows = r.markings
      .map((m) => ({ key: m.id, main: m.marking?.trim() ?? "" }))
      .filter((m) => m.main);

    return [
      {
        label: "Identity",
        pairs: [
          ["Doc Prefix", r.doc_prefix],
          ["ID", r.doc_id],
          ["Also Consignee", r.also_consignee ? "Yes" : "No"],
          ["Also Notify", r.also_notify ? "Yes" : "No"],
          ["Country", r.country_id ? (countryLabel.get(r.country_id) ?? "") : ""],
          ["Business Entity", r.business_entity],
          ["In-house Unit ID", r.inhouse_unit_id],
          // Only when it IS published — an empty row on an ordinary customer
          // would invite "published by what?" for no reason.
          ...(viewOrigin
            ? [[`From ${viewOrigin.from}`, `${viewOrigin.name} (${viewOrigin.flag})`] as const]
            : []),
        ],
        content:
          applicantRows.length > 0 ? (
            <ChildList label="Applicant(s)" rows={applicantRows} />
          ) : undefined,
      },
      {
        label: "Address",
        // No "Country" pair here — it lived under Identity above until the
        // single-Country-field fix (2026-07-31); `address_country_id` is kept
        // in sync with `country_id` and would only repeat that line.
        pairs: [
          ["Street", r.street],
          ["City", nameOf(r.city_id)],
          ["State", nameOf(r.state_id)],
          ["Pin", r.pin],
          ["Land Line", r.land_line],
          ["Mobile", r.mobile],
          // A stored NULL means "same as mobile" — saying so beats printing the
          // same number twice, and beats an empty row that reads as "unknown".
          ["WhatsApp", r.whatsapp ?? (r.mobile ? "Same as mobile" : "")],
          ["E-Mail", r.email],
          ["Web site", r.web_site],
        ],
        content:
          contactRows.length > 0 ? <ChildList label="Contacts" rows={contactRows} /> : undefined,
      },
      {
        label: "Agents",
        content:
          agentRows.length > 0 ? <ChildList label="Customer Agents" rows={agentRows} /> : undefined,
      },
      {
        label: "Supplied Items",
        content:
          sewingRows.length > 0 || packingRows.length > 0 ? (
            <div className="space-y-3">
              {sewingRows.length > 0 && (
                <ChildList label="Sewing Accessories" rows={sewingRows} />
              )}
              {packingRows.length > 0 && (
                <ChildList label="Packaging Accessories" rows={packingRows} />
              )}
            </div>
          ) : undefined,
      },
      {
        label: "Nominated Vendors",
        content:
          nominatedRows.length > 0 || recommendedRows.length > 0 ? (
            <div className="space-y-3">
              {nominatedRows.length > 0 && (
                <ChildList label="Nominated Vendor" rows={nominatedRows} />
              )}
              {recommendedRows.length > 0 && (
                <ChildList label="Recommended Vendor" rows={recommendedRows} />
              )}
            </div>
          ) : undefined,
      },
      {
        label: "General",
        pairs: [
          // The three currency columns store the CODE, which is what identifies
          // a currency on a document — no lookup needed, and none wanted.
          ["Currency 1", r.currency_1],
          ["Currency 2", r.currency_2],
          ["Currency 3", r.currency_3],
          ["Ship Mode", r.ship_mode],
          ["Ship Type", nameOf(r.ship_type_id)],
          ["Pay Mode", r.pay_mode],
          ["Receivable Terms", nameOf(r.receivable_term_id)],
          ["Pref. Courier", nameOf(r.pref_courier_id)],
          ["Port of Loading", nameOf(r.port_of_loading_id)],
          ["Port of Discharge", nameOf(r.port_of_discharge_id)],
          ["Final Destination", nameOf(r.final_destination_id)],
          ["Packing List Format", nameOf(r.packing_list_format_id)],
          ["Commercial Invoice Format", nameOf(r.commercial_invoice_format_id)],
          ["Color Spec Applicable", r.color_spec_applicable ? "Yes" : "No"],
          ["TCS", r.tcs_applicable ? "Yes" : "No"],
          // The number itself, not the GstinInsight strip: that strip is an
          // input-time aid (decode, entity suggestion) and none of it is a fact
          // about the record.
          ["GST No", r.gst_no],
        ],
        content:
          markingRows.length > 0 ? <ChildList label="Marking" rows={markingRows} /> : undefined,
      },
    ];
  }

  const columns: Column<Customer>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {r.name}
          <OriginBadge origin={customerOrigin(r)} />
          <PublishesBadge roles={customerPublishes(r)} />
        </span>
      ),
    },
    {
      header: "Country",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.country_id ? (countryLabel.get(r.country_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Applicants",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.applicants.length || "—"}</span>,
    },
    {
      header: "Status",
      cell: (r) => {
        const tone = r.is_draft ? "warning" : r.inactive ? "danger" : "success";
        const text = r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active";
        return <StatusPill tone={tone}>{text}</StatusPill>;
      },
    },
  ];

  const initials = (form.code || form.name || "?").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-4">
      <MasterListShell<Customer>
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.code, r.name, r.email].filter(Boolean).join(" ")}
        searchPlaceholder="Search customer…"
        statusOf={(r) => (r.is_draft ? "draft" : r.inactive ? "inactive" : "active")}
        addLabel="+ Add Customer"
        onAdd={openAdd}
        columns={columns}
        actions={{ onView: setViewRow, onEdit: openEdit, onDelete: remove }}
        empty="No customers yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) =>
            [
              r.country_id ? (countryLabel.get(r.country_id) ?? "") : "",
              customerOrigin(r) ? `from ${customerOrigin(r)?.from}` : "",
            ]
              .filter(Boolean)
              .join(" · "),
          pill: (r) => (
            <StatusPill tone={r.is_draft ? "warning" : r.inactive ? "danger" : "success"}>
              {r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      {/* ================= full-screen editor ================= */}
      <MasterFullScreen
        open={open}
        onClose={() => setOpen(false)}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">{form.name.trim() || "customer"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled customer",
          badges: (
            <>
              {form.inactive && <StatusPill tone="danger">Inactive</StatusPill>}
              <OriginBadge origin={editOrigin} />
              {dirty && <span className="text-[11px] font-medium text-warning">● Unsaved</span>}
            </>
          ),
          meta: (
            <>
              <span>
                {form.code ? (
                  <span className="font-mono font-semibold text-foreground">{form.code}</span>
                ) : (
                  "No short name"
                )}
              </span>
              {form.country_id && countryLabel.get(form.country_id) && (
                <span>· {countryLabel.get(form.country_id)}</span>
              )}
              {form.also_consignee && <span>· Also consignee</span>}
              {form.also_notify && <span>· Also notify</span>}
            </>
          ),
          right: (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Applicant(s)
              </span>
              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                {applicantIds.length === 0 && (
                  <span className="text-xs text-muted-foreground">None linked</span>
                )}
                {applicantIds.map((id, i) => {
                  const a = applicantById.get(id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted py-1 pl-2.5 pr-1 text-xs"
                    >
                      <span className="text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                      <span className="max-w-[160px] truncate">{a?.name ?? "Unknown"}</span>
                      <button
                        type="button"
                        onClick={() => removeApplicant(id)}
                        className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:bg-danger-soft hover:text-danger"
                        aria-label="Remove applicant"
                      >
                        <X className="h-4 w-4 shrink-0" />
                      </button>
                    </span>
                  );
                })}
                <ApplicantPicker
                  variant="add"
                  applicants={applicants.filter((a) => !applicantIds.includes(a.id))}
                  value={null}
                  onChange={addApplicant}
                />
              </div>
            </>
          ),
        }}
        sections={[
          {
            key: "identity",
            label: "Identity",
            icon: User,
            done: done.identity,
            content: (
                  <SectionBody title="Identity" hint="Who this customer is and how their documents are numbered.">
                    {/* ONE FieldGrid for the whole section — `SectionBody` has no
                        grid of its own, and two stacked grids would agree on the
                        left edge but not on the row gap. */}
                    <FieldGrid>
                      {editId && (
                        <Field size={FIELD_SIZE.inactive}>
                          <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
                            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.inactive} onChange={(e) => set({ inactive: e.target.checked })} />
                            <span className="text-sm text-foreground">Inactive</span>
                          </label>
                        </Field>
                      )}
                      <Field label="Name" required size={FIELD_SIZE.name} htmlFor="cu-name"
                        hint={editOrigin ? originNameHint(editOrigin) : undefined}>
                        {/* `readOnly`, not `disabled`: the value still submits
                            and still copies, and Input's own readOnly sets
                            tabIndex={-1}, so it leaves the Tab order for free. */}
                        <Input id="cu-name" uppercase readOnly={!!editOrigin} value={form.name} onChange={(e) => set({ name: e.target.value })} required
                          {...dupFieldProps(nameDupError, "cu-name")} />
                        <DuplicateError error={nameDupError} id="cu-name" />
                      </Field>
                      <Field label="Doc Prefix" size={FIELD_SIZE.doc_prefix} htmlFor="cu-prefix">
                        <Input uppercase id="cu-prefix" value={form.doc_prefix} onChange={(e) => set({ doc_prefix: e.target.value })} />
                      </Field>
                      <Field label="ID" size={FIELD_SIZE.doc_id} htmlFor="cu-docid">
                        <Input uppercase id="cu-docid" value={form.doc_id} onChange={(e) => set({ doc_id: e.target.value })} />
                      </Field>
                      <Field label="Also Consignee" size={FIELD_SIZE.also_consignee} htmlFor="cu-alsocons">
                        <Select id="cu-alsocons" value={form.also_consignee ? "yes" : "no"} onChange={(e) => set({ also_consignee: e.target.value === "yes" })}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </Select>
                      </Field>
                      {/* The tick's text moves up into the field label, and the
                          cell gets `min-h-9 items-center` so it centres on the
                          same 36px control height as the Select beside it. That
                          replaces a `sm:pt-6` hack which faked the same offset
                          at one viewport width only. */}
                      <Field label="Also Notify" size={FIELD_SIZE.also_notify} htmlFor="cu-alsonotify">
                        <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
                          <input id="cu-alsonotify" type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.also_notify} onChange={(e) => set({ also_notify: e.target.checked })} />
                          <span className="text-sm text-foreground">Yes</span>
                        </label>
                      </Field>
                      {/* `compact` + the label on `Field`: the picker renders its
                          OWN <Label> otherwise, so the cell would show "Country"
                          twice. Its built-in label also carries a required
                          asterisk that this form does not honour — country_id is
                          nullable in customerInput — so `Field`'s label is the
                          more accurate of the two. Same for every picker below.
                          This is also now the ONLY Country field on this form
                          (client complaint 2026-07-31: two boxes both labelled
                          "Country" read as a duplicate). It writes BOTH
                          `country_id` and `address_country_id` — see the Address
                          section below, which used to carry its own picker for
                          the second column. */}
                      <Field label="Country" size={FIELD_SIZE.country_id}>
                        <CountryPicker countries={countries} value={form.country_id || null} onChange={(id) => set({ country_id: id, address_country_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                      </Field>
                      <Field label="Business Entity" size={FIELD_SIZE.business_entity} htmlFor="cu-bizentity">
                        <Select id="cu-bizentity" value={form.business_entity} onChange={(e) => set({ business_entity: e.target.value })}>
                          <option value="">—</option>
                          {BUSINESS_ENTITIES.map((b) => <option key={b} value={b}>{b}</option>)}
                        </Select>
                      </Field>
                      <Field label="In-house Unit ID" size={FIELD_SIZE.inhouse_unit_id} htmlFor="cu-inhouseunit">
                        <Input uppercase id="cu-inhouseunit" value={form.inhouse_unit_id} onChange={(e) => set({ inhouse_unit_id: e.target.value })} />
                      </Field>
                    </FieldGrid>
                  </SectionBody>
            ),
          },
          {
            key: "address",
            label: "Address",
            icon: MapPin,
            done: done.address,
            content: (
                  <SectionBody title="Address" hint="Primary correspondence address for this customer.">
                    <FieldGrid>
                      {/* A single-line Input, not the 3-row Textarea this used
                          to be: every grid row is as tall as its tallest item,
                          so a textarea sharing the row would leave City / State
                          / Pin above a band of dead space. Stored newlines
                          survive; an <input> just shows them on one line. */}
                      <Field label="Street" size={FIELD_SIZE.street} htmlFor="cu-street">
                        <Input uppercase id="cu-street" value={form.street} onChange={(e) => set({ street: e.target.value })} />
                      </Field>
                      {/* The pickers were the self-labelling idiom while the rest
                          of the screen used an external <Label> + `compact`. One
                          idiom now, or half the cells would carry two labels. */}
                      <Field label="City" size={FIELD_SIZE.city_id}>
                        <LookupDialogPicker kind="city" label="City" options={cities} value={form.city_id || null} onChange={(id) => set({ city_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="State" size={FIELD_SIZE.state_id}>
                        <StatePicker label="State" options={states} value={form.state_id || null} onChange={(id) => set({ state_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                      </Field>
                      <Field label="Pin" size={FIELD_SIZE.pin} htmlFor="cu-pin">
                        <Input id="cu-pin" value={form.pin} onChange={(e) => set({ pin: e.target.value })} />
                      </Field>
                      {/* Country used to have its OWN field here, bound to
                          `address_country_id` — right beside Identity's
                          `country_id` one, the same country asked twice. The
                          column still exists in the DB (data-io round-trips it,
                          and old rows may only have this one filled in) but it
                          is now written from the single Identity Country picker
                          above, not from a visible field here. Do not add this
                          field back without re-reading that picker's comment
                          first. */}
                      <Field label="Land Line" size={FIELD_SIZE.land_line} htmlFor="cu-landline">
                        <Input id="cu-landline" value={form.land_line} onChange={(e) => set({ land_line: e.target.value })} />
                      </Field>
                      {/* Two grid children, not one — so the span goes to EACH
                          cell via `cellClassName`. A literal string: Tailwind v4
                          scans source text, so an interpolated span emits no CSS.
                          It is FIELD_SIZE's `sm` (3) written the only way this
                          component can take it. */}
                      <MobileWhatsAppFields
                        idPrefix="cu"
                        mobile={form.mobile}
                        whatsapp={form.whatsapp}
                        isdCode={isdOf.get(form.address_country_id) ?? null}
                        onMobileChange={(v) => set({ mobile: v })}
                        onWhatsAppChange={(v) => set({ whatsapp: v })}
                        cellClassName="@lg/section:col-span-3"
                      />
                      <Field label="E-Mail" size={FIELD_SIZE.email} htmlFor="cu-email">
                        <ValidatedInput format="email" id="cu-email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
                      </Field>
                      <Field label="Web site" size={FIELD_SIZE.web_site} htmlFor="cu-web">
                        <ValidatedInput format="website" id="cu-web" value={form.web_site} onChange={(e) => set({ web_site: e.target.value })} />
                      </Field>
                    </FieldGrid>

                    {/* contacts */}
                    <div className="mt-6">
                      <ChildGrid<ContactRow>
                        label="Contacts"
                        pageSize={10}
                        rows={contacts}
                        onAdd={addContact}
                        onRemove={(c) => removeContact(c.key)}
                        addLabel="+ Add contact"
                        columns={[
                          {
                            header: "Department",
                            className: "min-w-[160px]",
                            cell: (c) => (
                              <LookupDialogPicker kind="department" label="Department" options={departments} value={c.department_id || null} onChange={(id) => setContactAt(c.key, { department_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                            ),
                          },
                          {
                            header: "Contact Name",
                            className: "min-w-[130px]",
                            cell: (c) => <Input uppercase value={c.contact_name} onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })} className="h-8 text-sm" />,
                          },
                          {
                            header: "Designation",
                            className: "min-w-[160px]",
                            cell: (c) => (
                              <LookupDialogPicker kind="designation" label="Designation" options={designations} value={c.designation_id || null} onChange={(id) => setContactAt(c.key, { designation_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                            ),
                          },
                          {
                            header: "Land Line",
                            className: "min-w-[110px]",
                            cell: (c) => <Input value={c.land_line} onChange={(e) => setContactAt(c.key, { land_line: e.target.value })} className="h-8 text-sm" />,
                          },
                          {
                            header: "Mobile",
                            className: "min-w-[110px]",
                            cell: (c) => <Input value={c.mobile} onChange={(e) => setContactAt(c.key, { mobile: e.target.value })} className="h-8 text-sm" />,
                          },
                          {
                            header: "Email ID",
                            className: "min-w-[170px]",
                            cell: (c) => <ValidatedInput format="email" value={c.email_id} onChange={(e) => setContactAt(c.key, { email_id: e.target.value })} className="h-8 text-sm" />,
                          },
                          {
                            header: "Internal Dept.",
                            className: "min-w-[170px]",
                            cell: (c) => (
                              <LookupDialogPicker kind="internal_department" label="Internal Department" options={internalDepartments} value={c.internal_department_id || null} onChange={(id) => setContactAt(c.key, { internal_department_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                            ),
                          },
                        ]}
                        renderMobileRow={(c) => (
                          <>
                            <div>
                              <Label>Department</Label>
                              <LookupDialogPicker kind="department" label="Department" options={departments} value={c.department_id || null} onChange={(id) => setContactAt(c.key, { department_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                            </div>
                            <Input uppercase placeholder="Contact Name" value={c.contact_name} onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })} className="text-base md:text-sm" />
                            <div>
                              <Label>Designation</Label>
                              <LookupDialogPicker kind="designation" label="Designation" options={designations} value={c.designation_id || null} onChange={(id) => setContactAt(c.key, { designation_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Input placeholder="Land Line" value={c.land_line} onChange={(e) => setContactAt(c.key, { land_line: e.target.value })} className="text-base md:text-sm" />
                              <Input placeholder="Mobile" value={c.mobile} onChange={(e) => setContactAt(c.key, { mobile: e.target.value })} className="text-base md:text-sm" />
                            </div>
                            <ValidatedInput format="email" placeholder="Email ID" value={c.email_id} onChange={(e) => setContactAt(c.key, { email_id: e.target.value })} className="text-base md:text-sm" />
                            <div>
                              <Label>Internal Department</Label>
                              <LookupDialogPicker kind="internal_department" label="Internal Department" options={internalDepartments} value={c.internal_department_id || null} onChange={(id) => setContactAt(c.key, { internal_department_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                            </div>
                          </>
                        )}
                      />
                    </div>
                  </SectionBody>
            ),
          },
          {
            key: "agents",
            label: "Agents",
            icon: Users,
            done: done.agents,
            content: (
                  <SectionBody title="Agents" hint="Brokers / agents who represent this customer.">
                    <ChildGrid<AgentRow>
                      label="Customer Agents"
                      pageSize={10}
                      rows={agents}
                      onAdd={() => {
                        setAgents((xs) => [...xs, { key: newKey(), agent_type_id: "", agent_id: "" }]);
                        setDirty(true);
                      }}
                      onRemove={(a) => {
                        setAgents((xs) => xs.filter((r) => r.key !== a.key));
                        setDirty(true);
                      }}
                      addLabel="+ Add agent"
                      columns={[
                        {
                          header: "Agent Type",
                          cell: (a) => (
                            <LookupDialogPicker kind="agent_type" label="Agent Type" options={agentTypes} value={a.agent_type_id || null} onChange={(id) => { setAgents((xs) => xs.map((r) => (r.key === a.key ? { ...r, agent_type_id: id } : r))); setDirty(true); }} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                          ),
                        },
                        {
                          header: "Agent",
                          cell: (a) => (
                            <LookupDialogPicker kind="agent" label="Agent" options={agentOptions} value={a.agent_id || null} onChange={(id) => { setAgents((xs) => xs.map((r) => (r.key === a.key ? { ...r, agent_id: id } : r))); setDirty(true); }} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                          ),
                        },
                      ]}
                    />
                  </SectionBody>
            ),
          },
          {
            key: "supplied",
            label: "Supplied Items",
            icon: Package,
            done: done.supplied,
            content: (
                  <SectionBody title="Supplied Items" hint="Categories the customer supplies (free-issue), by accessory group.">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <CategoryGrid title="Sewing Accessories" rows={sewing} setRows={setSewing} categories={sewingCategories} perms={perms} newKey={newKey} setDirty={setDirty} />
                      <CategoryGrid title="Packaging Accessories" rows={packing} setRows={setPacking} categories={packingCategories} perms={perms} newKey={newKey} setDirty={setDirty} />
                    </div>
                  </SectionBody>
            ),
          },
          {
            key: "vendors",
            label: "Nominated Vendors",
            icon: Truck,
            done: done.vendors,
            content: (
                  <SectionBody title="Nominated Vendors" hint="Vendors this customer nominates or recommends for sourcing.">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <VendorGrid title="Nominated Vendor" rows={nominated} setRows={setNominated} vendors={vendors} newKey={newKey} setDirty={setDirty} />
                      <VendorGrid title="Recommended Vendor" rows={recommended} setRows={setRecommended} vendors={vendors} newKey={newKey} setDirty={setDirty} />
                    </div>
                  </SectionBody>
            ),
          },
          {
            key: "general",
            label: "General",
            icon: SlidersHorizontal,
            done: done.general,
            content: (
                  <SectionBody title="General" hint="Trade defaults, shipping, formats and export marking for this customer.">
                    <FieldGrid>
                      {/* The three currencies were interleaved with Ship Mode /
                          Type / Pay Mode — the DOM order that drew the legacy
                          two-column form (currencies left, shipping right). On a
                          12-col track DOM order IS reading order, so they are
                          grouped: three codes and the two shipping fields now sit
                          on one row instead of consuming three half-rows. */}
                      <Field label="Currency 1" size={FIELD_SIZE.currency_1}>
                        <CurrencyPicker label="Currency 1" currencies={currencies} value={form.currency_1 || null} onChange={(code) => set({ currency_1: code })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Currency 2" size={FIELD_SIZE.currency_2}>
                        <CurrencyPicker label="Currency 2" currencies={currencies} value={form.currency_2 || null} onChange={(code) => set({ currency_2: code })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Currency 3" size={FIELD_SIZE.currency_3}>
                        <CurrencyPicker label="Currency 3" currencies={currencies} value={form.currency_3 || null} onChange={(code) => set({ currency_3: code })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Ship Mode" size={FIELD_SIZE.ship_mode} htmlFor="cu-shipmode">
                        <Select id="cu-shipmode" value={form.ship_mode} onChange={(e) => set({ ship_mode: e.target.value })}>
                          <option value="">—</option>
                          {SHIP_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      </Field>
                      {/* Ship Type is stored master data (`config_lookups` kind
                          'ship_type'), so it gets the shared picker — searchable,
                          with Add / Modify / Delete in place — exactly as
                          Applicant and Consignee already render it. As a plain
                          <Select> it could only pick, and it had to compose the
                          "DELIVERED DUTY PAID (DDP)" option text itself; the
                          picker's `lookupLabel` does that now. */}
                      <Field label="Ship Type" size={FIELD_SIZE.ship_type_id}>
                        <LookupDialogPicker kind="ship_type" label="Ship Type" options={shipTypes} value={form.ship_type_id || null} onChange={(id) => set({ ship_type_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Pay Mode" size={FIELD_SIZE.pay_mode} htmlFor="cu-paymode">
                        <Select id="cu-paymode" value={form.pay_mode} onChange={(e) => set({ pay_mode: e.target.value })}>
                          <option value="">—</option>
                          {PAY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      </Field>
                      <Field label="Receivable Terms" size={FIELD_SIZE.receivable_term_id}>
                        <RecordPicker label="Receivable Term" items={receivableTerms} value={form.receivable_term_id || null} onChange={(id) => set({ receivable_term_id: id ?? "" })} compact />
                      </Field>
                      <Field label="Pref. Courier" size={FIELD_SIZE.pref_courier_id}>
                        <RecordPicker label="Courier" items={couriers} value={form.pref_courier_id || null} onChange={(id) => set({ pref_courier_id: id ?? "" })} compact />
                      </Field>
                      <Field label="Port of Loading" size={FIELD_SIZE.port_of_loading_id}>
                        <RecordPicker label="Port" items={ports} value={form.port_of_loading_id || null} onChange={(id) => set({ port_of_loading_id: id ?? "" })} compact />
                      </Field>
                      <Field label="Port of Discharge" size={FIELD_SIZE.port_of_discharge_id}>
                        <RecordPicker label="Port" items={ports} value={form.port_of_discharge_id || null} onChange={(id) => set({ port_of_discharge_id: id ?? "" })} compact />
                      </Field>
                      <Field label="Final Destination" size={FIELD_SIZE.final_destination_id}>
                        <RecordPicker label="Destination" items={destinations} value={form.final_destination_id || null} onChange={(id) => set({ final_destination_id: id ?? "" })} compact />
                      </Field>
                      {/* ONE cell holding two controls: "Columns" edits the very
                          format picked beside it, so splitting them into two
                          spans would put a button under a label of its own.
                          `items-center` now that the picker's label sits above
                          the whole cell — it used to be `items-end` to clear the
                          label the picker drew for itself. */}
                      <Field label="Packing List Format" size={FIELD_SIZE.packing_list_format_id}>
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <LookupDialogPicker kind="packing_list_format" label="Packing List Format" options={packingFormats} value={form.packing_list_format_id || null} onChange={(id) => set({ packing_list_format_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                          </div>
                          <Button type="button" variant="outline" size="md" disabled={!form.packing_list_format_id} onClick={() => setColsOpen(true)}>Columns</Button>
                        </div>
                      </Field>
                      <Field label="Commercial Invoice Format" size={FIELD_SIZE.commercial_invoice_format_id}>
                        <LookupDialogPicker kind="commercial_invoice_format" label="Commercial Invoice Format" options={commercialFormats} value={form.commercial_invoice_format_id || null} onChange={(id) => set({ commercial_invoice_format_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Color Spec Applicable" size={FIELD_SIZE.color_spec_applicable} htmlFor="cu-colorspec">
                        <Select id="cu-colorspec" value={form.color_spec_applicable ? "yes" : "no"} onChange={(e) => set({ color_spec_applicable: e.target.value === "yes" })}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </Select>
                      </Field>
                      <Field label="TCS" size={FIELD_SIZE.tcs_applicable} htmlFor="cu-tcs">
                        <Select id="cu-tcs" value={form.tcs_applicable ? "yes" : "no"} onChange={(e) => set({ tcs_applicable: e.target.value === "yes" })}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </Select>
                      </Field>
                      <Field label="GST No" size={FIELD_SIZE.gst_no} htmlFor="cu-gst">
                        <>
                          <ValidatedInput
                            id="cu-gst"
                            // Shape-only on purpose. The check digit is verified
                            // by the strip below as a WARNING, not a block — a
                            // bad GSTIN copied off an invoice still has to be
                            // savable while the customer is chased. Switch this
                            // to "gstin_strict" to make it a hard block instead.
                            format="gstin"
                            value={form.gst_no}
                            onChange={(e) => set({ gst_no: e.target.value })}
                            {...dupFieldProps(gstDupError, "cu-gst")}
                          />
                          <DuplicateError error={gstDupError} id="cu-gst" />
                        </>
                      </Field>
                      {/* A wide fact strip, not a field — its own `full` cell
                          under the 3-wide GST box rather than crammed inside it. */}
                      {gstin && (
                        <Field size={FIELD_SIZE.gstin_insight}>
                          <GstinInsight
                            decoded={gstin}
                            // Customers have no PAN column, so the mismatch
                            // line stays dormant; the strip still shows the PAN
                            // the number carries, which is the useful half.
                            panValue=""
                            suggestions={gstinSuggestions}
                          />
                        </Field>
                      )}
                    </FieldGrid>

                    {/* Marking grid */}
                    <div className="mt-6">
                      <ChildGrid<MarkRow>
                        label="Marking"
                        pageSize={10}
                        rows={markings}
                        onAdd={() => { setMarkings((xs) => [...xs, { key: newKey(), marking: "" }]); setDirty(true); }}
                        onRemove={(m) => { setMarkings((xs) => xs.filter((r) => r.key !== m.key)); setDirty(true); }}
                        addLabel="+ Add marking"
                        columns={[
                          {
                            header: "Marking",
                            cell: (m) => (
                              <Input uppercase value={m.marking} onChange={(e) => { setMarkings((xs) => xs.map((r) => (r.key === m.key ? { ...r, marking: e.target.value } : r))); setDirty(true); }} className="text-base md:text-sm" placeholder="Marking text" />
                            ),
                          },
                        ]}
                      />
                    </div>
                  </SectionBody>
            ),
          },
        ]}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New customer",
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          saveLabel: "Save customer",
          // A duplicate GSTIN blocks the draft save too — a half-finished row
          // still lands in `customers`, where the collision is just as real.
          canSave: !!form.name.trim() && !gstDupError && !nameDupError,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />
      <PackingFormatColumnsDialog
        formatId={form.packing_list_format_id || null}
        savedColumns={packingColumns}
        open={colsOpen}
        onClose={() => setColsOpen(false)}
        canEdit={perms.canEdit}
      />

      {/* Read-only view — same record, nothing editable, Edit in the footer
          hands off to the editor above. */}
      <RecordViewSheet
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        title={viewRow?.name ?? ""}
        subtitle={
          viewRow
            ? [
                viewRow.country_id ? countryLabel.get(viewRow.country_id) : null,
                viewRow.business_entity,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        status={
          viewRow && (
            <StatusPill
              tone={viewRow.is_draft ? "warning" : viewRow.inactive ? "danger" : "success"}
            >
              {viewRow.is_draft ? "Draft" : viewRow.inactive ? "Inactive" : "Active"}
            </StatusPill>
          )
        }
        sections={viewRow ? viewSectionsFor(viewRow) : []}
      />
    </div>
  );
}

/**
 * A child card, read-only: one line per row, the muted half on the right the way
 * `material-view-sheet` renders its Mixing rows. Not a `ChildGrid` — there is
 * nothing to edit, add or paginate, and a grid of disabled pickers would read as
 * a form the user is not allowed to use.
 */
function ChildList({
  label,
  rows,
}: {
  label: string;
  rows: { key: string; main: string; detail?: string }[];
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="space-y-1 text-sm text-foreground">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words">{r.main}</span>
            {r.detail && (
              <span className="shrink-0 text-xs text-muted-foreground">{r.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Bordered card shell for an editable child grid. */
type CatRowT = { key: string; category_id: string };
/** A single-column "Category ⓘ" grid (Sewing / Packaging Accessories). */
function CategoryGrid({
  title,
  rows,
  setRows,
  categories,
  perms,
  newKey,
  setDirty,
}: {
  title: string;
  rows: CatRowT[];
  setRows: React.Dispatch<React.SetStateAction<CatRowT[]>>;
  categories: ConfigLookup[];
  perms: Perms;
  newKey: () => string;
  setDirty: (v: boolean) => void;
}) {
  /**
   * PICK ONCE. Every category this grid already holds — one row asks one
   * question, so the same category twice is duplication, not data, and the
   * second row is a silent contradiction nobody spots by eye.
   *
   * Passed WHOLE, this row's own value included: `DataPicker` exempts its own
   * `value`, so a row never refuses what it is already showing.
   *
   * Per GRID, not per screen. `CategoryGrid` is rendered twice — Sewing and
   * Packaging Accessories — each with its own `rows` and its own `categories`,
   * so a category used in Sewing stays freely pickable in Packaging.
   */
  const usedCategoryIds = useMemo(
    () => rows.map((r) => r.category_id).filter(Boolean),
    [rows],
  );
  return (
    <ChildGrid<CatRowT>
      label={title}
      pageSize={10}
      forceCards
      rows={rows}
      onAdd={() => { setRows((xs) => [...xs, { key: newKey(), category_id: "" }]); setDirty(true); }}
      onRemove={(r) => { setRows((xs) => xs.filter((x) => x.key !== r.key)); setDirty(true); }}
      addLabel="+ Add category"
      columns={[
        {
          header: "Category",
          // Add/Modify OFF: the options are `categories` rows (0356), but this
          // picker's inline create writes to `config_lookups` — it would file a
          // new category under the wrong table and the FK would reject it. New
          // categories are created in the Category master.
          cell: (r) => (
            <LookupDialogPicker kind="material_category" label="Category" options={categories} value={r.category_id || null} usedIds={usedCategoryIds} onChange={(id) => { setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, category_id: id } : x))); setDirty(true); }} canCreate={false} canEdit={false} compact />
          ),
        },
      ]}
    />
  );
}

type VendorRowT = { key: string; vendor_id: string };
/** A single-column "Vendor ⓘ" grid (Nominated / Recommended). */
function VendorGrid({
  title,
  rows,
  setRows,
  vendors,
  newKey,
  setDirty,
}: {
  title: string;
  rows: VendorRowT[];
  setRows: React.Dispatch<React.SetStateAction<VendorRowT[]>>;
  vendors: PickerItem[];
  newKey: () => string;
  setDirty: (v: boolean) => void;
}) {
  /**
   * PICK ONCE. Nominating the same vendor twice says nothing the single row did
   * not — and it matters downstream: MBA narrows its vendor picker to this list,
   * so a duplicate shows the same vendor twice there too.
   *
   * Per GRID: Nominated and Recommended are separate lists, and a vendor being
   * on both is a legitimate (if redundant) statement, not this rule's business.
   */
  const usedVendorIds = useMemo(
    () => rows.map((r) => r.vendor_id).filter(Boolean),
    [rows],
  );
  return (
    <ChildGrid<VendorRowT>
      label={title}
      pageSize={10}
      forceCards
      rows={rows}
      onAdd={() => { setRows((xs) => [...xs, { key: newKey(), vendor_id: "" }]); setDirty(true); }}
      onRemove={(r) => { setRows((xs) => xs.filter((x) => x.key !== r.key)); setDirty(true); }}
      addLabel="+ Add vendor"
      columns={[
        {
          header: "Vendor",
          cell: (r) => (
            <RecordPicker label="Vendor" items={vendors} value={r.vendor_id || null} usedIds={usedVendorIds} onChange={(id) => { setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, vendor_id: id ?? "" } : x))); setDirty(true); }} compact />
          ),
        },
      ]}
    />
  );
}
