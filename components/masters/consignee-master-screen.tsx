"use client";

import { Bell, MapPin, SlidersHorizontal, TriangleAlert, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { gridKeyNav } from "@/components/masters/child-grid";
import { MobileWhatsAppFields, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { StatePicker } from "@/components/masters/state-picker";
import { PaymentTermPicker } from "@/components/masters/payment-term-picker";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { BankPicker } from "@/components/masters/bank-picker";
import { NotifyPicker } from "@/components/masters/notify-picker";
import { GstinInsight, type GstinSuggestion } from "@/components/masters/gstin-insight";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { createConsignee, updateConsignee, deleteConsignee } from "@/lib/masters/consignee-actions";
import {
  partyOrigin,
  OriginBadge,
  originNameHint,
  originDeleteBlock,
  type PartyOrigin,
} from "@/components/masters/party-origin";
import { deletedToast } from "@/lib/masters/delete-message";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import { decodeGstin, matchGstinState, normalizeGstin } from "@/lib/validation/gstin";
import { defaultCountryId, defaultStateId } from "@/lib/masters/geo-defaults";
import {
  SHIP_MODES,
  PAY_MODES,
  type Consignee,
  type ConsigneeInput,
} from "@/lib/masters/consignee-types";
import type { Country } from "@/lib/masters/country-types";
import { lookupLabel, type ConfigLookup } from "@/lib/masters/extras-types";
import type { Customer } from "@/lib/masters/customer-types";
import type { Currency } from "@/lib/masters/types";
import type { Bank } from "@/lib/masters/bank-types";
import type { Notify } from "@/lib/masters/notify-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type HeaderForm = {
  code: string;
  name: string;
  inactive: boolean;
  country_id: string;
  also_notify: boolean;
  customer_id: string;
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
  payment_term_id: string;
  bank_id: string;
  ac_no: string;
  tin_no: string;
  tin_no_2: string;
  tin_no_3: string;
  pan_no: string;
  gst_no: string;
};
/**
 * Two masters can publish a consignee — Applicant ▸ Also Consignee and
 * Customer ▸ Also Consignee (0371). The DB CHECK guarantees at most one link is
 * set, so the first hit is the answer.
 *
 * `source_customer_id` is the publish link and has nothing to do with
 * `customer_id`, the owning-customer picker on the form.
 */
const consigneeOrigin = (r: Consignee) =>
  partyOrigin([
    {
      id: r.source_applicant_id,
      source: r.source_applicant,
      from: "Applicant",
      flag: "Also Consignee",
    },
    {
      id: r.source_customer_id,
      source: r.source_customer,
      from: "Customer",
      flag: "Also Consignee",
    },
  ]);

const BLANK: HeaderForm = {
  code: "",
  name: "",
  inactive: false,
  country_id: "",
  also_notify: false,
  customer_id: "",
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
  payment_term_id: "",
  bank_id: "",
  ac_no: "",
  tin_no: "",
  tin_no_2: "",
  tin_no_3: "",
  pan_no: "",
  gst_no: "",
};

type MarkingRow = { key: string; marking: string };
type NotifyRefRow = { key: string; notify_id: string };

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

/**
 * The whole editor as one string, for the unsaved-work compare. Whole-object,
 * the same shape company-profile-screen uses: every `set`/`setXAt` spreads, so
 * key order is stable and two snapshots differ only when a value does. Cheaper
 * than threading a `setDirty(true)` through every handler on a 29-field form,
 * and it cannot be forgotten on a new one.
 *
 * The child rows carry their `key`, which is fine — a key is minted once when
 * the row appears and never changes, so it moves the string only when a row is
 * genuinely added or removed.
 */
const snapshot = (
  form: HeaderForm,
  contacts: ContactRow[],
  markings: MarkingRow[],
  notifyRefs: NotifyRefRow[],
) => JSON.stringify({ form, contacts, markings, notifyRefs });

/**
 * How wide each field of this form is, on the 12-column track (LAYOUT.md §3).
 * Sized to the DATA it holds, not to the cell it landed in: this form used to
 * hand-roll `sm:grid-cols-2` / `-3`, so three 3-letter currency codes ate a
 * whole row while a 6-digit PIN got the same box as a website URL
 * (client 2026-07-24 #3). Adjust here, not at the call sites.
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12. A row that totals 13+ does not shrink —
 * the last field wraps onto a line of its own with the rest of that line empty
 * beneath it. Widen one of these and something else on the same row has to give.
 *
 *   identity  name 4 + country 3 + customer 3 + also_notify 2                = 12
 *   address   street 12
 *             city 3 + state 3 + pin 2 + address_country 4                   = 12
 *             land_line 3 + mobile 3 + whatsapp 3                            =  9
 *             email 6 + web_site 6                                           = 12
 *   general   currency ×3 (2 each) + ship_mode 3 + ship_type 3               = 12
 *             pay_mode 3 + payment_term 3 + bank 3 + ac_no 3                 = 12
 *   registr.  tin_no 3 + tin_no_2 3 + pan_no 3 + gst_no 3                    = 12
 *
 * Two rows are deliberately short of 12 rather than padded:
 *  - `name` would prefer `lg` (a consignee is a company name), but 6+3+3+2 = 14
 *    wraps Also Notify onto its own line. At `md` it is ~384px — long enough for
 *    the names actually keyed, and the box scrolls past that.
 *  - the phone row stops at 9 because there are only three phone fields; pulling
 *    E-Mail up to fill it would push Web site onto an otherwise empty row.
 *
 * `currency_1/2/3` are `xs` on purpose even though the picker shows
 * "USD — US DOLLAR": the trigger truncates, the CODE is what identifies the
 * currency, and three of them are not worth a row of a form this long.
 */
/**
 * ONE SIZE, EVERY FIELD: `sm` = 3 of 12 = four per row (client 2026-07-29). The
 * client picked the City / State / Pin / Country row out as the correct shape
 * and asked for the rest of the masters to match it, so nothing is sized to its
 * own data any more — Name, E-Mail and Web site lost the width they had, and
 * Street lost the full row its Textarea stood on. See applicant-master-screen
 * for the full statement of the rule and what it trades away.
 */
const FIELD_SIZE = {
  // Identity section
  name: "sm",
  country_id: "sm",
  customer_id: "sm",
  also_notify: "sm",
  // Address section
  street: "sm", // a single-line Input now — a Textarea sets the row's height
  city_id: "sm",
  state_id: "sm",
  pin: "sm",
  address_country_id: "sm",
  land_line: "sm",
  email: "sm",
  web_site: "sm",
  // General section
  currency: "sm",
  ship_mode: "sm",
  ship_type_id: "sm",
  pay_mode: "sm",
  payment_term_id: "sm",
  bank_id: "sm",
  ac_no: "sm",
  // Registration card
  tin_no: "sm",
  tin_no_2: "sm",
  pan_no: "sm",
  gst_no: "sm",
} satisfies Record<string, FieldSize>;

/**
 * The Mobile / WhatsApp pair's span. `MobileWhatsAppFields` is a fragment of
 * TWO grid children with no wrapper to hang a size on, so the class goes to each
 * cell via `cellClassName` instead of through `<Field size>`. Keep it in step
 * with `FIELD_SIZE.land_line` — the three phone fields share one row.
 *
 * A literal string, never interpolated: Tailwind v4 scans source text, so a
 * computed span class produces no CSS at all.
 */
const CONTACT_CELL = "@lg/section:col-span-3";

/**
 * Master-detail CRUD for the legacy "Consignee" master (Associates). The editor
 * is a `MasterFullScreen` with a left section rail —
 * `Identity` (Name · Country · Customer · Also Notify · Inactive) ·
 * `Address` (address, phones, and the Contact card) ·
 * `General` (currencies, ship/pay, bank, the Marking card and the Registration
 * card) · `Notify` (the Notify Parties card).
 *
 * It used to be a `Sheet` that split itself with a hand-rolled mid-form
 * `Address | General | Notify` tab bar — the same pattern the client asked to be
 * taken off Applicant. The rail replaces it: one section at a time, named down
 * the left instead of across the middle, with a completion dot per section.
 *
 * City / State and the grid's Department / Designation / Internal Department are
 * config_lookups pickers (searchable dialog + Add/Modify); both Country fields
 * reuse CountryPicker; the Customer field lists the customers master.
 */
export function ConsigneeMasterScreen({
  rows,
  countries,
  cities,
  states,
  departments,
  designations,
  internalDepartments,
  customers,
  currencies,
  banks,
  shipTypes,
  paymentTerms,
  notifies,
  companyGstin = null,
  perms,
}: {
  rows: Consignee[];
  countries: Country[];
  cities: ConfigLookup[];
  states: ConfigLookup[];
  departments: ConfigLookup[];
  designations: ConfigLookup[];
  internalDepartments: ConfigLookup[];
  customers: Customer[];
  currencies: Currency[];
  banks: Bank[];
  shipTypes: ConfigLookup[];
  paymentTerms: ConfigLookup[];
  notifies: Notify[];
  /**
   * Our own GSTIN — the reference point for calling a consignee's GSTIN
   * within-state or other-state. Optional: the Consignee branch of the masters
   * page does not fetch the company profile yet, and the strip simply omits the
   * supply line while this is null.
   */
  companyGstin?: string | null;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const isdOf = useIsdLookup(countries);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** The row being READ. Separate from `editId` — a view must never arm Save. */
  const [viewRow, setViewRow] = useState<Consignee | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  /**
   * Set while editing a row a tick box published (0371). Its Name belongs to
   * the source and is read-only here — that removes the rename conflict instead
   * of resolving it. Everything else on the record is genuinely its own.
   */
  const [editOrigin, setEditOrigin] = useState<PartyOrigin | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [markings, setMarkings] = useState<MarkingRow[]>([]);
  const [notifyRefs, setNotifyRefs] = useState<NotifyRefRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  const notifyCountryLabel = useMemo(() => {
    const country = new Map<string, string>();
    for (const c of countries) country.set(c.id, c.name);
    const m = new Map<string, string>();
    for (const n of notifies) m.set(n.id, n.country_id ? (country.get(n.country_id) ?? "—") : "—");
    return m;
  }, [notifies, countries]);

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);
  const customerLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  /**
   * id → name across every option list the editor's pickers already receive.
   * One map for all of them because these ids are uuids, so they cannot
   * collide — and the read-only view resolves an FK the same way the picker
   * does, out of props, never with a query of its own.
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
      paymentTerms,
      banks,
      notifies,
    ];
    for (const list of lists) for (const o of list) m.set(o.id, o.name);
    // Ship Type overwrites its own plain-name entries: its code is an Incoterm,
    // so the view reads "FREE ON BOARD (FOB)" — the same label the picker showed.
    for (const s of shipTypes) m.set(s.id, lookupLabel("ship_type", s));
    return m;
  }, [
    cities,
    states,
    departments,
    designations,
    internalDepartments,
    shipTypes,
    paymentTerms,
    banks,
    notifies,
  ]);
  /** Never renders a raw uuid: an id we cannot name reads as nothing at all. */
  const nameOf = (id: string | null | undefined) => (id ? (optionName.get(id) ?? "") : "");

  // ---------------------------------------------------------------- GSTIN ----
  // Everything below is decoded from the GST number itself — no lookup, no
  // network. See lib/validation/gstin.ts for what the 15 characters carry.

  const gstin = useMemo(
    () => decodeGstin(form.gst_no, { companyGstin }),
    [form.gst_no, companyGstin],
  );

  /**
   * The GSTIN as loaded, so merely OPENING a record never auto-fills — that
   * would mark a freshly-opened form dirty and trip the unsaved-work guard.
   * Only a GSTIN the user actually changed feeds the auto-fill.
   */
  const loadedGstin = useRef("");

  // The State row this GSTIN points at — code first, spelling as a fallback.
  // Shared with the vendor screen; see matchGstinState.
  const gstinState = useMemo(() => matchGstinState(gstin, states), [gstin, states]);

  // A GSTIN can only belong to an Indian registration, so the country it implies
  // is never in doubt — but it is still offered, never written (see below).
  // Same two values a NEW consignee opens on; see geo-defaults.
  const indCountryId = useMemo(() => defaultCountryId(countries), [countries]);
  const homeStateId = useMemo(() => defaultStateId(states, companyGstin), [states, companyGstin]);

  /** The Address block of a brand-new consignee: India, and our own state. */
  const blankForm = useMemo<HeaderForm>(
    () => ({ ...BLANK, state_id: homeStateId, country_id: indCountryId, address_country_id: indCountryId }),
    [homeStateId, indCountryId],
  );

  // PAN is characters 3-12 of the GSTIN, so filling an EMPTY PAN box cannot
  // lose information. A PAN that is already typed is never overwritten — a
  // disagreement is real signal, surfaced as a mismatch line instead.
  useEffect(() => {
    if (!gstin?.checksumValid) return;
    if (gstin.gstin === loadedGstin.current) return;
    // The "is the PAN box empty?" test reads the CURRENT form through the
    // updater rather than through `form.pan_no`, which would have to be a
    // dependency: this effect must not re-run on every PAN keystroke and
    // silently re-fill a field the user had just cleared. It used to hold the
    // PAN in a ref written during render, which `react-hooks/refs` rejects —
    // a ref read at render time gives React nothing to re-render on.
    setForm((f) => (f.pan_no.trim() ? f : { ...f, pan_no: gstin.pan }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin?.gstin, gstin?.checksumValid]);

  // Everything the GSTIN implies but that we refuse to write silently. Empty
  // while the checksum fails — we never propagate a number we don't trust.
  const gstinSuggestions = useMemo<GstinSuggestion[]>(() => {
    if (!gstin?.checksumValid) return [];
    const out: GstinSuggestion[] = [];

    const typedPan = form.pan_no.trim().toUpperCase();
    if (typedPan && typedPan !== gstin.pan) {
      out.push({
        key: "pan",
        label: `Use ${gstin.pan}`,
        onApply: () => set({ pan_no: gstin.pan }),
      });
    }

    // "differs", not "is empty": the State box now OPENS on our own state, so an
    // empty-only test would hide this chip on precisely the consignees that need
    // it — an out-of-state GSTIN beside a defaulted home state.
    if (gstinState && form.state_id !== gstinState.id) {
      out.push({
        key: "state",
        label: `Set State = ${gstinState.name}`,
        onApply: () => {
          set({ state_id: gstinState.id });
          // Toasted because the State box lives in the Address section, which
          // the user is not looking at while typing the GST number in General.
          success(`State set to ${gstinState.name} in the Address section`);
        },
      });
    }

    if (indCountryId && !form.address_country_id) {
      out.push({
        key: "country",
        label: "Set Country = India",
        onApply: () => {
          // Both columns — the single Country field in Identity drives them
          // together now (see that picker's comment).
          set({ country_id: indCountryId, address_country_id: indCountryId });
          success("Country set to India");
        },
      });
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin, gstinState, indCountryId, form.pan_no, form.state_id, form.address_country_id]);

  // Real-time duplicate check on the GST number: one registration belongs to
  // exactly one party, so two consignees sharing a GSTIN is almost always the
  // same party keyed twice. Advisory only — it never disables Save, because a
  // legacy pair that already collides must stay editable. Deliberately NOT
  // extended to PAN: one PAN legitimately carries one GSTIN *per state*, so a
  // multi-state party would false-positive on every branch after the first.
  const gstDup = useDuplicateCheck({
    table: "consignees",
    name: form.gst_no,
    nameColumn: "gst_no",
    excludeId: editId ?? undefined,
    enabled: !!form.gst_no.trim(),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.email].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditOrigin(null);
    setForm(blankForm);
    loadedGstin.current = "";
    const blankContacts = [blankContact(newKey())];
    setContacts(blankContacts);
    setMarkings([]);
    setNotifyRefs([]);
    // Baseline for `dirty`. A brand-new consignee starts clean even though it
    // already holds one empty contact row and a defaulted Country/State — that is
    // scaffolding the form put there, not something the user typed. Snapshotting
    // `blankForm` (not BLANK) is what keeps the defaults out of `dirty`: baseline
    // BLANK would read the two defaults as unsaved edits and, via
    // useUnsavedGuard, block the PWA's silent auto-update on this route forever.
    setPristine(snapshot(blankForm, blankContacts, [], []));
    setOpen(true);
  }
  function openEdit(r: Consignee) {
    setEditId(r.id);
    setEditOrigin(consigneeOrigin(r));
    // One visible Country field now feeds both stored columns (see the
    // Identity section below) — `country_id` is authoritative (it is what the
    // list column, header chip and read-only view all resolve), so it wins; a
    // row saved before this fix that only ever had `address_country_id`
    // filled in still opens with a country rather than a blank picker.
    const countryId = r.country_id ?? r.address_country_id ?? "";
    const nextForm: HeaderForm = {
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      country_id: countryId,
      also_notify: r.also_notify,
      customer_id: r.customer_id ?? "",
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
      payment_term_id: r.payment_term_id ?? "",
      bank_id: r.bank_id ?? "",
      ac_no: r.ac_no ?? "",
      tin_no: r.tin_no ?? "",
      tin_no_2: r.tin_no_2 ?? "",
      tin_no_3: r.tin_no_3 ?? "",
      pan_no: r.pan_no ?? "",
      gst_no: r.gst_no ?? "",
    };
    // Baseline for the PAN auto-fill: opening a record must never write to it.
    loadedGstin.current = normalizeGstin(r.gst_no);
    const nextContacts: ContactRow[] = r.contacts.map((c) => ({
      key: newKey(),
      department_id: c.department_id ?? "",
      contact_name: c.contact_name ?? "",
      designation_id: c.designation_id ?? "",
      land_line: c.land_line ?? "",
      mobile: c.mobile ?? "",
      email_id: c.email_id ?? "",
      internal_department_id: c.internal_department_id ?? "",
    }));
    const nextMarkings: MarkingRow[] = r.markings.map((m) => ({
      key: newKey(),
      marking: m.marking ?? "",
    }));
    const nextNotifyRefs: NotifyRefRow[] = r.notify_refs.map((n) => ({
      key: newKey(),
      notify_id: n.notify_id ?? "",
    }));
    setForm(nextForm);
    setContacts(nextContacts);
    setMarkings(nextMarkings);
    setNotifyRefs(nextNotifyRefs);
    setPristine(snapshot(nextForm, nextContacts, nextMarkings, nextNotifyRefs));
    setOpen(true);
  }

  function addContact() {
    setContacts((cs) => [...cs, blankContact(newKey())]);
  }
  function setContactAt(key: string, patch: Partial<ContactRow>) {
    setContacts((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }
  function removeContact(key: string) {
    setContacts((cs) => cs.filter((c) => c.key !== key));
  }

  function addMarking() {
    setMarkings((ms) => [...ms, { key: newKey(), marking: "" }]);
  }
  function setMarkingAt(key: string, marking: string) {
    setMarkings((ms) => ms.map((m) => (m.key === key ? { ...m, marking } : m)));
  }
  function removeMarking(key: string) {
    setMarkings((ms) => ms.filter((m) => m.key !== key));
  }

  function addNotifyRef() {
    setNotifyRefs((ns) => [...ns, { key: newKey(), notify_id: "" }]);
  }
  function setNotifyRefAt(key: string, notify_id: string) {
    setNotifyRefs((ns) => ns.map((n) => (n.key === key ? { ...n, notify_id } : n)));
  }
  function removeNotifyRef(key: string) {
    setNotifyRefs((ns) => ns.filter((n) => n.key !== key));
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: ConsigneeInput = {
        // Create derives the code from the display name; edit keeps the
        // record's original stored code (held in state, never rendered).
        code: editId ? form.code.trim() || null : form.name.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
        country_id: form.country_id || null,
        also_notify: form.also_notify,
        customer_id: form.customer_id || null,
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
        ship_mode: form.ship_mode || null,
        ship_type_id: form.ship_type_id || null,
        pay_mode: form.pay_mode || null,
        payment_term_id: form.payment_term_id || null,
        bank_id: form.bank_id || null,
        ac_no: form.ac_no.trim() || null,
        tin_no: form.tin_no.trim() || null,
        tin_no_2: form.tin_no_2.trim() || null,
        tin_no_3: form.tin_no_3.trim() || null,
        pan_no: form.pan_no.trim() || null,
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
        markings: markings.map((m, i) => ({ sno: i + 1, marking: m.marking || null })),
        notify_refs: notifyRefs.map((n, i) => ({ sno: i + 1, notify_id: n.notify_id || null })),
      };
      const res = editId ? await updateConsignee(editId, payload) : await createConsignee(payload);
      if (res.ok) {
        success(editId ? "Consignee updated." : "Consignee added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Consignee) {
    // A published row is owned by its source: deleting it here while the tick
    // box stayed on would just republish it on that record's next save.
    const origin = consigneeOrigin(r);
    if (origin) {
      error(originDeleteBlock(origin));
      return;
    }
    startTransition(async () => {
      const res = await deleteConsignee(r.id);
      if (res.ok) {
        success(deletedToast("Consignee", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Consignee>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {r.name}
          <OriginBadge origin={consigneeOrigin(r)} />
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
      header: "Customer",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.customer_id ? (customerLabel.get(r.customer_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => {
        const tone = r.is_draft ? "warning" : r.inactive ? "danger" : "success";
        const text = r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active";
        return <StatusPill tone={tone}>{text}</StatusPill>;
      },
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.name}
        onView={() => setViewRow(r)}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
  ];

  /**
   * Unsaved-work tracking. The editor is a `MasterFullScreen`, which registers
   * itself with the reload guard as an open MODAL — but "a modal is open" is not
   * "there is work to lose", and this screen never declared the second
   * (AGENTS.md, STANDING). A deploy landing on a half-keyed consignee would take
   * it silently.
   *
   * `useState`, never a `useRef`: the baseline changes on an EVENT (opening a
   * record), and a ref read during render gives React nothing to re-render on,
   * so the `● Unsaved` badge would go stale.
   */
  const [pristine, setPristine] = useState("");
  // Gated on `open`: the baseline is only taken when an editor opens, so on a
  // closed list page `pristine` is still "" and the compare would report the
  // untouched BLANK form as dirty — arming the reload guard for a screen with
  // nothing to lose.
  const dirty = open && snapshot(form, contacts, markings, notifyRefs) !== pristine;
  useUnsavedGuard(dirty || isPending);

  const initials = (form.code || form.name || "?").slice(0, 2).toUpperCase();

  /**
   * The record as a READER sees it. Mirrors the editor's rail — Identity ·
   * Address · General · Notify — so the view and the form tell the same story,
   * and every FK is resolved to the name the picker would have shown.
   *
   * Nothing here filters empties: `RecordViewSheet` drops an empty value and an
   * all-empty section on its own. The three child cards are the exception —
   * they are `content`, which is never auto-hidden, so each is built as
   * `undefined` when the card holds nothing rather than as an empty list.
   */
  function viewSectionsFor(r: Consignee): ViewSection[] {
    const viewOrigin = consigneeOrigin(r);
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

    const markingRows = r.markings
      .map((m) => ({ key: m.id, main: m.marking?.trim() ?? "" }))
      .filter((m) => m.main);

    const notifyRows = r.notify_refs
      .map((n) => {
        const country = n.notify_id ? (notifyCountryLabel.get(n.notify_id) ?? "") : "";
        return {
          key: n.id,
          main: nameOf(n.notify_id),
          // notifyCountryLabel prints "—" for a notify with no country; that is
          // a placeholder for an input, not a fact worth repeating here.
          detail: country === "—" ? "" : country,
        };
      })
      .filter((n) => n.main);

    return [
      {
        label: "Identity",
        pairs: [
          ["Country", r.country_id ? (countryLabel.get(r.country_id) ?? "") : ""],
          ["Customer", r.customer_id ? (customerLabel.get(r.customer_id) ?? "") : ""],
          ["Also Notify", r.also_notify ? "Yes" : "No"],
          // Only when it IS published — an empty row on an ordinary consignee
          // would invite "published by what?" for no reason.
          ...(viewOrigin
            ? [[`From ${viewOrigin.from}`, `${viewOrigin.name} (${viewOrigin.flag})`] as const]
            : []),
        ],
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
          contactRows.length > 0 ? (
            <ChildList label="Contact" rows={contactRows} />
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
          ["Payment Terms", nameOf(r.payment_term_id)],
          ["Bank", nameOf(r.bank_id)],
          ["A/c No.", r.ac_no],
          ["TIN No.", r.tin_no],
          ["CST No.", r.tin_no_2],
          ["PAN No", r.pan_no],
          // The number itself, not the GstinInsight strip: that strip is an
          // input-time aid (decode, mismatch, "apply this") and none of it is a
          // fact about the record.
          ["GST No", r.gst_no],
        ],
        content:
          markingRows.length > 0 ? <ChildList label="Marking" rows={markingRows} /> : undefined,
      },
      {
        label: "Notify",
        content:
          notifyRows.length > 0 ? (
            <ChildList label="Notify Parties" rows={notifyRows} />
          ) : undefined,
      },
    ];
  }

  // Completion dots on the rail — "this section has data", not "this section is
  // valid". Name is the only required field on the whole form.
  const done = {
    identity: !!(form.name.trim() || form.country_id || form.customer_id || form.also_notify),
    address: !!(
      form.street.trim() ||
      form.city_id ||
      // Compared against the DEFAULT, not against empty. These two boxes arrive
      // pre-filled with our own State/Country now, and a rail dot that lights
      // before the operator has typed anything reads as "Address is done" on a
      // section holding no address at all.
      form.state_id !== blankForm.state_id ||
      form.pin.trim() ||
      form.address_country_id !== blankForm.address_country_id ||
      form.land_line.trim() ||
      form.mobile.trim() ||
      form.email.trim() ||
      form.web_site.trim() ||
      contacts.some(
        (c) => c.contact_name.trim() || c.department_id || c.designation_id || c.email_id.trim(),
      )
    ),
    general: !!(
      form.currency_1 ||
      form.currency_2 ||
      form.currency_3 ||
      form.ship_mode ||
      form.ship_type_id ||
      form.pay_mode ||
      form.payment_term_id ||
      form.bank_id ||
      form.ac_no.trim() ||
      form.tin_no.trim() ||
      form.tin_no_2.trim() ||
      form.pan_no.trim() ||
      form.gst_no.trim() ||
      markings.some((m) => m.marking.trim())
    ),
    notify: notifyRefs.some((n) => n.notify_id),
  };

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search consignee…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Consignee
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No consignees yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No consignees yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.code ?? "—"}
                    {r.country_id ? ` · ${countryLabel.get(r.country_id) ?? ""}` : ""}
                    {consigneeOrigin(r) ? ` · from ${consigneeOrigin(r)?.from}` : ""}
                  </div>
                </div>
                <StatusPill tone={r.is_draft ? "warning" : r.inactive ? "danger" : "success"}>
                  {r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <MasterFullScreen
        open={open}
        onClose={() => setOpen(false)}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">{form.name.trim() || "consignee"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled consignee",
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
              {form.also_notify && <span>· Also notify</span>}
              {form.customer_id && customerLabel.get(form.customer_id) && (
                <span>· {customerLabel.get(form.customer_id)}</span>
              )}
            </>
          ),
        }}
        footer={{
          status: dirty ? "Unsaved changes" : undefined,
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          saveLabel: "Save consignee",
          canSave: !!form.name.trim(),
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          draftLabel: "Save as Draft",
          isPending,
        }}
        sections={[
          {
            key: "identity",
            label: "Identity",
            icon: User,
            done: done.identity,
            content: (
              <SectionBody
                title="Identity"
                hint="Who this consignee is, and the customer they ship for."
              >
                <div className="space-y-4">
                  {/* Four controls, one flush row. Every label is `Field`'s, so
                      the pickers are all `compact`: CountryPicker and
                      CustomerPicker render their OWN <Label> otherwise, and this
                      screen used to mix the two idioms — Country self-labelled
                      while Customer was wrapped, so the two labels sat at
                      different offsets. */}
                  <FieldGrid>
                    <Field
                      label="Name"
                      required
                      size={FIELD_SIZE.name}
                      htmlFor="cn-name"
                      hint={editOrigin ? originNameHint(editOrigin) : undefined}
                    >
                      {/* `readOnly`, not `disabled`: the value still submits and
                          still copies, and Input's own readOnly sets
                          tabIndex={-1}, so it leaves the Tab order for free. */}
                      <Input
                        id="cn-name"
                        uppercase
                        readOnly={!!editOrigin}
                        value={form.name}
                        onChange={(e) => set({ name: e.target.value })}
                        required
                      />
                    </Field>
                    {/* No `required` marker, unlike the asterisk CountryPicker
                        prints for itself: `country_id` is nullable in
                        consigneeInput and Save is gated on the name alone, so
                        the marker was never true here.
                        The ONLY Country field on this form now (client
                        complaint 2026-07-31: two boxes both labelled "Country"
                        read as a duplicate). It writes BOTH `country_id` and
                        `address_country_id` — see the Address section below,
                        which used to carry its own picker for the second
                        column. */}
                    <Field label="Country" size={FIELD_SIZE.country_id}>
                      <CountryPicker
                        countries={countries}
                        value={form.country_id || null}
                        onChange={(id) => set({ country_id: id, address_country_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Customer" size={FIELD_SIZE.customer_id}>
                      <CustomerPicker
                        customers={customers}
                        value={form.customer_id || null}
                        onChange={(id) => set({ customer_id: id ?? "" })}
                        compact
                      />
                    </Field>
                    <Field label="Also Notify" size={FIELD_SIZE.also_notify} htmlFor="cn-alsonotify">
                      <Select
                        id="cn-alsonotify"
                        value={form.also_notify ? "yes" : "no"}
                        onChange={(e) => set({ also_notify: e.target.value === "yes" })}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </Select>
                    </Field>
                  </FieldGrid>
                  {/* Outside the track on purpose: a bare checkbox has no label
                      above it, so as a grid cell it would line up with its
                      neighbours' LABELS rather than their controls. */}
                  {editId && (
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.inactive}
                        onChange={(e) => set({ inactive: e.target.checked })}
                      />
                      <span className="text-sm text-foreground">Inactive</span>
                    </label>
                  )}
                </div>
              </SectionBody>
            ),
          },
          {
            key: "address",
            label: "Address",
            icon: MapPin,
            done: done.address,
            content: (
              <SectionBody title="Address" hint="Where the goods go, and who to deal with there.">
                <div className="space-y-4">
                  {/* Four rows of the 12-col track: the street block, then the
                      address line (City · State · Pin · Country) the way it is
                      printed, then the phones, then the online channels. Street is
                      `full` — it was `sm:col-span-2`, which on this track would mean
                      one SIXTH, not full width (LAYOUT.md §2). */}
                  <FieldGrid>
                    {/* A single-line Input, not the 3-row Textarea this used to be:
                        every grid row is as tall as its tallest item, so a textarea
                        sharing the row would leave City / State / Pin above a band
                        of dead space. Stored newlines survive. */}
                    <Field label="Street" size={FIELD_SIZE.street} htmlFor="cn-street">
                      <Input
                        uppercase
                        id="cn-street"
                        value={form.street}
                        onChange={(e) => set({ street: e.target.value })}
                      />
                    </Field>
                    <Field label="City" size={FIELD_SIZE.city_id}>
                      <LookupDialogPicker
                        kind="city"
                        label="City"
                        options={cities}
                        value={form.city_id || null}
                        onChange={(id) => set({ city_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        compact
                      />
                    </Field>
                    <Field label="State" size={FIELD_SIZE.state_id}>
                      <StatePicker
                        label="State"
                        options={states}
                        value={form.state_id || null}
                        onChange={(id) => set({ state_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Pin" size={FIELD_SIZE.pin} htmlFor="cn-pin">
                      <Input
                        id="cn-pin"
                        value={form.pin}
                        onChange={(e) => set({ pin: e.target.value })}
                      />
                    </Field>
                    {/* Country used to have its OWN field here, bound to
                        `address_country_id` — right beside Identity's
                        `country_id` one, the same country asked twice. The
                        column still exists in the DB (data-io round-trips it,
                        and old rows may only have this one filled in) but it
                        is now written from the single Identity Country picker
                        above, not from a visible field here. Do not add this
                        field back without re-reading that picker's comment
                        first. City + State + Pin end this row 3 short of 12 —
                        deliberate, same as any other tail row on this form. */}
                    <Field label="Land Line" size={FIELD_SIZE.land_line} htmlFor="cn-landline">
                      <Input
                        id="cn-landline"
                        value={form.land_line}
                        onChange={(e) => set({ land_line: e.target.value })}
                      />
                    </Field>
                    {/* Two cells, not one — hence `cellClassName` rather than a
                        `<Field size>` wrapper. The WhatsApp half is taller than its
                        neighbours by design: it carries the "Same as mobile" tick. */}
                    <MobileWhatsAppFields
                      idPrefix="cn"
                      mobile={form.mobile}
                      whatsapp={form.whatsapp}
                      isdCode={isdOf.get(form.address_country_id) ?? null}
                      onMobileChange={(v) => set({ mobile: v })}
                      onWhatsAppChange={(v) => set({ whatsapp: v })}
                      cellClassName={CONTACT_CELL}
                    />
                    <Field label="E-Mail" size={FIELD_SIZE.email} htmlFor="cn-email">
                      <ValidatedInput
                        format="email"
                        id="cn-email"
                        value={form.email}
                        onChange={(e) => set({ email: e.target.value })}
                      />
                    </Field>
                    <Field label="Web site" size={FIELD_SIZE.web_site} htmlFor="cn-web">
                      <ValidatedInput
                        format="website"
                        id="cn-web"
                        value={form.web_site}
                        onChange={(e) => set({ web_site: e.target.value })}
                      />
                    </Field>
                  </FieldGrid>

                  {/* Contact grid */}
                  <div className="rounded-lg border border-border">
                    <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                      Contact
                    </div>
                    <div className="space-y-3 p-3">
                      {contacts.length === 0 && (
                        <p className="text-xs text-muted-foreground">No contacts yet.</p>
                      )}
                      {/* No inner scroll — see ChildGrid's `pageSize` note: no
                          scroll-in-a-box. One contact card is already taller than
                          the old max-h-56, so even a single contact had to be
                          scrolled to be read (client 2026-07-30). */}
                      <div data-grid-body onKeyDown={(e) => gridKeyNav(e, addContact)} className="space-y-3">
                      {contacts.map((c, i) => (
                        <div data-grid-row key={c.key} className="space-y-2 rounded-md border border-border p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">
                              Contact #{i + 1}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-danger"
                              onClick={() => removeContact(c.key)}
                              aria-label="Remove contact"
                            >
                              <X className="h-4 w-4 shrink-0" />
                            </Button>
                          </div>
                          <div>
                            <Label>Department</Label>
                            <LookupDialogPicker
                              kind="department"
                              label="Department"
                              options={departments}
                              value={c.department_id || null}
                              onChange={(id) => setContactAt(c.key, { department_id: id })}
                              canCreate={perms.canCreate}
                              canEdit={perms.canEdit}
                              canDelete={perms.canDelete}
                              compact
                            />
                          </div>
                          <Input
                            uppercase
                            placeholder="Contact Name"
                            value={c.contact_name}
                            onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })}
                            className="text-base md:text-sm"
                          />
                          <div>
                            <Label>Designation</Label>
                            <LookupDialogPicker
                              kind="designation"
                              label="Designation"
                              options={designations}
                              value={c.designation_id || null}
                              onChange={(id) => setContactAt(c.key, { designation_id: id })}
                              canCreate={perms.canCreate}
                              canEdit={perms.canEdit}
                              canDelete={perms.canDelete}
                              compact
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Input
                              placeholder="Land Line"
                              value={c.land_line}
                              onChange={(e) => setContactAt(c.key, { land_line: e.target.value })}
                              className="text-base md:text-sm"
                            />
                            <Input
                              placeholder="Mobile"
                              value={c.mobile}
                              onChange={(e) => setContactAt(c.key, { mobile: e.target.value })}
                              className="text-base md:text-sm"
                            />
                          </div>
                          <ValidatedInput
                            format="email"
                            placeholder="Email ID"
                            value={c.email_id}
                            onChange={(e) => setContactAt(c.key, { email_id: e.target.value })}
                            className="text-base md:text-sm"
                          />
                          <div>
                            <Label>Internal Department</Label>
                            <LookupDialogPicker
                              kind="internal_department"
                              label="Internal Department"
                              options={internalDepartments}
                              value={c.internal_department_id || null}
                              onChange={(id) => setContactAt(c.key, { internal_department_id: id })}
                              canCreate={perms.canCreate}
                              canEdit={perms.canEdit}
                              compact
                            />
                          </div>
                        </div>
                      ))}
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addContact}>
                        + Add contact
                      </Button>
                    </div>
                  </div>
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
              <SectionBody
                title="General"
                hint="Currencies, shipping and payment defaults, markings and tax registration."
              >
                <div className="space-y-4">
                  {/* ONE FieldGrid, not the four stacked grids this replaced. They
                      were rows of the same form, so they should share one track's
                      left edge AND its vertical rhythm — between two separate grids
                      the gap is the parent's `space-y-4`, inside one it is the
                      track's `gap-y`, so stacked grids lined up horizontally and
                      drifted vertically. Same reasoning as the attribute screen's
                      `specCell`.
                      Two rows of 12: the three currency codes now take 2 each and
                      share their row with Ship Mode and Ship Type, instead of three
                      `sm:grid-cols-3` cells eating a full row on their own. */}
                  <FieldGrid>
                    <Field label="Currency 1" size={FIELD_SIZE.currency}>
                      <CurrencyPicker
                        label="Currency"
                        compact
                        currencies={currencies}
                        value={form.currency_1 || null}
                        onChange={(code) => set({ currency_1: code })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                      />
                    </Field>
                    <Field label="Currency 2" size={FIELD_SIZE.currency}>
                      <CurrencyPicker
                        label="Currency"
                        compact
                        currencies={currencies}
                        value={form.currency_2 || null}
                        onChange={(code) => set({ currency_2: code })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                      />
                    </Field>
                    <Field label="Currency 3" size={FIELD_SIZE.currency}>
                      <CurrencyPicker
                        label="Currency"
                        compact
                        currencies={currencies}
                        value={form.currency_3 || null}
                        onChange={(code) => set({ currency_3: code })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                      />
                    </Field>
                    <Field label="Ship Mode" size={FIELD_SIZE.ship_mode} htmlFor="cn-shipmode">
                      <Select
                        id="cn-shipmode"
                        value={form.ship_mode}
                        onChange={(e) => set({ ship_mode: e.target.value })}
                      >
                        <option value="">— Select —</option>
                        {SHIP_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {/* `compact` — NOT `label=""` — on every picker below. Both hide
                        the picker's own <Label> so only <Field>'s remains (that is
                        the one carrying htmlFor and aligning the required marker),
                        but they are not interchangeable:
                          - `compact` suppresses the <Label> element entirely.
                          - `label=""` leaves the element rendering EMPTY, and an
                            empty <Label> still contributes its line-height, so the
                            control drops a row below its neighbours
                            (see lookup-picker.tsx:247).
                        And `label` is read for much more than the visible label —
                        the trigger placeholder ("— Select Ship Type —"), the
                        aria-label, the dialog title, the Add/Modify toasts and the
                        empty-state text. Blanking it degrades all five. Keep the
                        real text and pass `compact`. */}
                    <Field label="Ship Type" size={FIELD_SIZE.ship_type_id}>
                      <LookupDialogPicker
                        kind="ship_type"
                        label="Ship Type"
                        options={shipTypes}
                        value={form.ship_type_id || null}
                        onChange={(id) => set({ ship_type_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        compact
                      />
                    </Field>

                    <Field label="Pay Mode" size={FIELD_SIZE.pay_mode} htmlFor="cn-paymode">
                      <Select
                        id="cn-paymode"
                        value={form.pay_mode}
                        onChange={(e) => set({ pay_mode: e.target.value })}
                      >
                        <option value="">— Select —</option>
                        {PAY_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {/* Payment Terms was a bare full-width child of the old
                        `space-y-4` — the widest control on the tab for a value like
                        "60 Days DA". */}
                    <Field label="Payment Terms" size={FIELD_SIZE.payment_term_id}>
                      <PaymentTermPicker
                        label="Payment Term"
                        options={paymentTerms}
                        value={form.payment_term_id || null}
                        onChange={(id) => set({ payment_term_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Bank" size={FIELD_SIZE.bank_id}>
                      <BankPicker
                        banks={banks}
                        value={form.bank_id || null}
                        onChange={(id) => set({ bank_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        compact
                      />
                    </Field>
                    <Field label="A/c No." size={FIELD_SIZE.ac_no} htmlFor="cn-acno">
                      <Input
                        uppercase
                        id="cn-acno"
                        value={form.ac_no}
                        onChange={(e) => set({ ac_no: e.target.value })}
                      />
                    </Field>
                  </FieldGrid>

                  {/* Marking grid */}
                  <div className="rounded-lg border border-border">
                    <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                      Marking
                    </div>
                    <div className="space-y-2 p-3">
                      {markings.length === 0 && (
                        <p className="text-xs text-muted-foreground">No markings yet.</p>
                      )}
                      {/* No inner scroll — see ChildGrid's `pageSize` note. */}
                      <div className="space-y-2">
                      {markings.map((m, i) => (
                        <div key={m.key} className="flex items-center gap-2">
                          <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">
                            {i + 1}
                          </span>
                          <Input
                            uppercase
                            placeholder="Marking"
                            value={m.marking}
                            onChange={(e) => setMarkingAt(m.key, e.target.value)}
                            className="text-base md:text-sm"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-muted-foreground hover:text-danger"
                            onClick={() => removeMarking(m.key)}
                            aria-label="Remove marking"
                          >
                            <X className="h-4 w-4 shrink-0" />
                          </Button>
                        </div>
                      ))}
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addMarking}>
                        + Add marking
                      </Button>
                    </div>
                  </div>

                  {/* Registration */}
                  <div className="rounded-lg border border-border">
                    <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                      Registration
                    </div>
                    {/* The four registration numbers on ONE row: 3+3+3+3 = 12. They
                        were two stacked `sm:grid-cols-2` grids, so four fixed-width
                        identifiers — none longer than a 15-character GSTIN — each got
                        half the card.
                        The two strips below them are `full`. They were
                        `sm:col-span-2`, which meant "both columns" under the old
                        2-col grid but would mean ONE SIXTH on this track — the exact
                        collision documented in field.tsx's header. */}
                    <div className="p-3">
                      <FieldGrid>
                        <Field label="TIN No." size={FIELD_SIZE.tin_no}>
                          <Input uppercase value={form.tin_no} onChange={(e) => set({ tin_no: e.target.value })} />
                        </Field>
                        <Field label="CST No." size={FIELD_SIZE.tin_no_2}>
                          <Input uppercase value={form.tin_no_2} onChange={(e) => set({ tin_no_2: e.target.value })} />
                        </Field>
                        <Field label="PAN No" size={FIELD_SIZE.pan_no} htmlFor="cn-pan">
                          <ValidatedInput
                            id="cn-pan"
                            format="pan"
                            value={form.pan_no}
                            onChange={(e) => set({ pan_no: e.target.value })}
                          />
                        </Field>
                        <Field label="GST No" size={FIELD_SIZE.gst_no} htmlFor="cn-gst">
                          <ValidatedInput
                            id="cn-gst"
                            // Shape-only on purpose. The check digit is verified by
                            // the strip below as a WARNING, not a block — a bad
                            // GSTIN copied off a shipping document still has to be
                            // savable while the party is chased. Switch this to
                            // "gstin_strict" to make it a hard block instead.
                            format="gstin"
                            value={form.gst_no}
                            onChange={(e) => set({ gst_no: e.target.value })}
                          />
                        </Field>

                        {gstin && (
                          <Field size="full" className="-mt-1">
                            <GstinInsight
                              decoded={gstin}
                              panValue={form.pan_no}
                              suggestions={gstinSuggestions}
                            />
                          </Field>
                        )}

                        {gstDup && (
                          <Field size="full" className="-mt-1">
                            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                              <TriangleAlert className="h-4 w-4 shrink-0" />
                              Another consignee already carries this GST number — check you are not
                              keying the same party twice.
                            </p>
                          </Field>
                        )}
                      </FieldGrid>
                    </div>
                  </div>
                </div>
              </SectionBody>
            ),
          },
          {
            key: "notify",
            label: "Notify",
            icon: Bell,
            done: done.notify,
            content: (
              <SectionBody
                title="Notify"
                hint="The parties told when a shipment goes out to this consignee."
              >
                <div className="rounded-lg border border-border">
                  <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                    Notify Parties
                  </div>
                  <div className="space-y-3 p-3">
                    {notifyRefs.length === 0 && (
                      <p className="text-xs text-muted-foreground">No notify parties yet.</p>
                    )}
                    {/* No inner scroll — see ChildGrid's `pageSize` note. */}
                    <div data-grid-body onKeyDown={(e) => gridKeyNav(e, addNotifyRef)} className="space-y-3">
                    {notifyRefs.map((n, i) => (
                      <div data-grid-row key={n.key} className="space-y-2 rounded-md border border-border p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            Notify #{i + 1}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-danger"
                            onClick={() => removeNotifyRef(n.key)}
                            aria-label="Remove notify party"
                          >
                            <X className="h-4 w-4 shrink-0" />
                          </Button>
                        </div>
                        <div>
                          <Label>Notify Short Name</Label>
                          <NotifyPicker
                            notifies={notifies}
                            value={n.notify_id || null}
                            onChange={(id) => setNotifyRefAt(n.key, id ?? "")}
                            compact
                          />
                        </div>
                        <div>
                          <Label>Country</Label>
                          <Input
                            value={n.notify_id ? (notifyCountryLabel.get(n.notify_id) ?? "—") : ""}
                            readOnly
                            tabIndex={-1}
                            placeholder="— from Notify —"
                            className="text-base md:text-sm"
                          />
                        </div>
                      </div>
                    ))}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addNotifyRef}>
                      + Add notify party
                    </Button>
                  </div>
                </div>
              </SectionBody>
            ),
          },
        ]}
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
                viewRow.customer_id ? customerLabel.get(viewRow.customer_id) : null,
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
