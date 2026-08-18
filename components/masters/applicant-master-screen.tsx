"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, SlidersHorizontal, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import { MobileWhatsAppFields, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { StatePicker } from "@/components/masters/state-picker";
import { PaymentTermPicker } from "@/components/masters/payment-term-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { BankPicker } from "@/components/masters/bank-picker";
import { createApplicant, updateApplicant, deleteApplicant } from "@/lib/masters/applicant-actions";
import { PublishesBadge } from "@/components/masters/party-origin";
import { PARTY_ROLE } from "@/lib/masters/party-origin-text";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  SHIP_MODES,
  PAY_MODES,
  type Applicant,
  type ApplicantInput,
} from "@/lib/masters/applicant-types";
import type { Country } from "@/lib/masters/country-types";
import { lookupLabel, type ConfigLookup } from "@/lib/masters/extras-types";
import type { Currency } from "@/lib/masters/types";
import type { Bank } from "@/lib/masters/bank-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { createdMeta, createdSection, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type HeaderForm = {
  code: string;
  name: string;
  inactive: boolean;
  also_customer: boolean;
  also_consignee: boolean;
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
  payment_term_id: string;
  bank_id: string;
  ac_no: string;
};
/** What this applicant has published, and so what a delete here takes with
 *  it (0378). An Applicant is only ever a source — nothing publishes one. */
const applicantPublishes = (r: Applicant): string[] => [
  ...(r.also_customer ? [PARTY_ROLE.customer] : []),
  ...(r.also_consignee ? [PARTY_ROLE.consignee] : []),
];

const BLANK: HeaderForm = {
  code: "",
  name: "",
  inactive: false,
  also_customer: false,
  also_consignee: false,
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
  payment_term_id: "",
  bank_id: "",
  ac_no: "",
};

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

/** Every field this screen sizes, header (`c_` = one Contact grid row). */
type SizedField =
  | "name"
  | "country_id"
  | "also_customer"
  | "also_consignee"
  | "inactive"
  | "street"
  | "city_id"
  | "state_id"
  | "pin"
  | "address_country_id"
  | "land_line"
  | "email"
  | "web_site"
  | "currency_1"
  | "currency_2"
  | "currency_3"
  | "ship_mode"
  | "ship_type_id"
  | "pay_mode"
  | "payment_term_id"
  | "bank_id"
  | "ac_no"
  | "c_department_id"
  | "c_contact_name"
  | "c_designation_id"
  | "c_internal_department_id"
  | "c_land_line"
  | "c_mobile"
  | "c_email_id";

/**
 * How wide each field sits on the 12-column track (LAYOUT.md §3).
 *
 * ONE SIZE, EVERY FIELD: `sm` = 3 of 12 = four per row, edge to edge. The City /
 * State / Pin / Country row is the shape the client picked out as correct, so
 * the rest of the screen was cut down to match rather than each field being
 * sized to its own data (client 2026-07-29). What that trades away is real —
 * E-Mail and Web site are long free text and now sit in the same ~3-column box
 * as Pin — but a screen of one repeated width reads as a grid, and the mixed
 * 2/3/4/6/12 spans it replaces read as ragged whitespace.
 *
 * The map stays, rather than collapsing to a bare `size="sm"` at each call site,
 * so the rows can still be read as arithmetic in one place and so a single field
 * can be widened later without hunting through the JSX:
 *
 *   Details         name 3 + country 3 + also_customer 3 + also_consignee 3 = 12
 *                   inactive 3                                     (edit only)
 *   Address         street 3 + city 3 + state 3 + pin 3 = 12
 *                   address_country 3
 *   Communication   land_line 3 + mobile 3 + whatsapp 3 + email 3 = 12
 *                   web_site 3
 *   Currencies      currency_1 3 + currency_2 3 + currency_3 3 = 9
 *   Ship & Payment  ship_mode 3 + ship_type 3 + pay_mode 3 + payment_term 3 = 12
 *                   bank 3 + ac_no 3 = 6
 *   Contact row     department 3 + contact_name 3 + designation 3 + internal 3 = 12
 *                   land_line 3 + mobile 3 + email_id 3 = 9
 *
 * THE SPANS OF ONE ROW MUST STILL SUM TO 12 OR LESS. A row totalling 13+ does
 * not shrink — it wraps its last field onto a line of its own and leaves the
 * rest of that line empty. Nothing in the build catches that, which is the
 * reason the sums above are spelt out.
 *
 * Street is `sm` like everything else, which is why its control is now a
 * single-line `Input`: a 3-row `Textarea` in a 3-column cell would set the
 * height of the whole row and leave City / State / Pin floating above a band of
 * empty space, since grid items in a row share the tallest one's height.
 *
 * Mobile / WhatsApp are deliberately absent from this map.
 * `MobileWhatsAppFields` is a fragment of TWO grid children with no wrapper, so
 * it takes its span as a literal `cellClassName` string instead — Tailwind v4
 * scans source text, and an interpolated class produces no CSS at all. They
 * still count as 3 + 3 in the Communication row above.
 */
const FIELD_SIZE: Record<SizedField, FieldSize> = {
  name: "sm",
  country_id: "sm",
  also_customer: "sm",
  also_consignee: "sm",
  inactive: "sm", // a lone tick box on its own (edit-only) row
  street: "sm", // single-line Input, not a textarea — see above
  city_id: "sm",
  state_id: "sm",
  pin: "sm",
  address_country_id: "sm",
  land_line: "sm",
  email: "sm",
  web_site: "sm",
  currency_1: "sm",
  currency_2: "sm",
  currency_3: "sm",
  ship_mode: "sm",
  ship_type_id: "sm",
  pay_mode: "sm",
  payment_term_id: "sm",
  bank_id: "sm",
  ac_no: "sm",
  c_department_id: "sm",
  c_contact_name: "sm",
  c_designation_id: "sm",
  c_internal_department_id: "sm",
  c_land_line: "sm",
  c_mobile: "sm",
  c_email_id: "sm",
};

/**
 * Master-detail CRUD for the legacy "Applicant" master (Associates): a header
 * (Name · Inactive · Also Customer · Also Consignee · Country) + two tabs
 * (Address | General) + a Contact child grid.
 *
 * City / State and the grid's Department / Designation / Internal Department are
 * config_lookups pickers (searchable dialog + Add/Modify); both Country fields
 * reuse the shared CountryPicker.
 */
export function ApplicantMasterScreen({
  rows,
  countries,
  cities,
  states,
  departments,
  designations,
  internalDepartments,
  currencies,
  banks,
  shipTypes,
  paymentTerms,
  perms,
}: {
  rows: Applicant[];
  countries: Country[];
  cities: ConfigLookup[];
  states: ConfigLookup[];
  departments: ConfigLookup[];
  designations: ConfigLookup[];
  internalDepartments: ConfigLookup[];
  currencies: Currency[];
  banks: Bank[];
  shipTypes: ConfigLookup[];
  paymentTerms: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const isdOf = useIsdLookup(countries);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** The record being LOOKED at — read-only, never the editor's record. */
  const [viewRow, setViewRow] = useState<Applicant | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  // The server has guarded this since the master was built (applicant-actions.ts);
  // the screen simply never said so until the operator pressed Save.
  const dupError = useDuplicateName({
    table: "applicants",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean?" — dupError above only fires on an EXACT collision, so a
   * one-character miss sails past it and becomes a second row meaning the same
   * thing as the first. Advisory only: the typed text saves as typed unless the
   * operator accepts a chip. Suppressed while the red error shows — one line
   * under the input, and the name it collided with is the one that is no use.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? "").filter(Boolean),
    // No curated vocabulary, and there can never be one: these are the names of
    // real trading parties. Rows only — which is exactly the useful check here,
    // catching "ABC TEXTILES" typed beside an existing "ABC TEXTILE".
    seed: [],
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);
  const cityLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cities) m.set(c.id, c.name);
    return m;
  }, [cities]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.email].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    const blankContacts = [blankContact(newKey())];
    setForm(BLANK);
    setContacts(blankContacts);
    // Baseline for `dirty`. A brand-new applicant starts clean even though it
    // already holds one empty contact row — that row is scaffolding the form
    // put there, not something the user typed.
    setPristine(JSON.stringify({ form: BLANK, contacts: blankContacts }));
    setOpen(true);
  }
  function openEdit(r: Applicant) {
    setEditId(r.id);
    // One visible Country field now feeds both stored columns (see the Address
    // section below) — `country_id` is authoritative (it is what the list
    // column, header chip and read-only view all resolve), so it wins; a row
    // saved before this fix that only ever had `address_country_id` filled in
    // still opens with a country rather than a blank picker.
    const countryId = r.country_id ?? r.address_country_id ?? "";
    const nextForm: HeaderForm = {
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      also_customer: r.also_customer,
      also_consignee: r.also_consignee,
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
      payment_term_id: r.payment_term_id ?? "",
      bank_id: r.bank_id ?? "",
      ac_no: r.ac_no ?? "",
    };
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
    setForm(nextForm);
    setContacts(nextContacts);
    setPristine(JSON.stringify({ form: nextForm, contacts: nextContacts }));
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

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: ApplicantInput = {
        // Create derives the code from the display name; edit keeps the
        // record's original stored code (held in state, never rendered).
        code: editId ? form.code.trim() || null : form.name.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
        also_customer: form.also_customer,
        also_consignee: form.also_consignee,
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
        ship_mode: form.ship_mode || null,
        ship_type_id: form.ship_type_id || null,
        pay_mode: form.pay_mode || null,
        payment_term_id: form.payment_term_id || null,
        bank_id: form.bank_id || null,
        ac_no: form.ac_no.trim() || null,
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
      };
      const res = editId ? await updateApplicant(editId, payload) : await createApplicant(payload);
      if (res.ok) {
        success(editId ? "Applicant updated." : "Applicant added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Applicant) {
    startTransition(async () => {
      const res = await deleteApplicant(r.id);
      if (res.ok) {
        success(deletedToast("Applicant", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  /** An id → its name, for any of the lists this screen is handed. Small lists
      and ONE record on screen, so it resolves on demand instead of building
      half a dozen maps. */
  const nameOf = (options: { id: string; name: string }[], id: string | null) =>
    (id ? options.find((o) => o.id === id)?.name : null) ?? null;
  /** Ship Type is the one list whose code is a term of the trade, so the view
      echoes exactly what the picker offered — "FREE ON BOARD (FOB)". */
  const shipTypeOf = (id: string | null) => {
    const o = id ? shipTypes.find((s) => s.id === id) : null;
    return o ? lookupLabel("ship_type", o) : null;
  };
  /** Currencies key off `code`, not id — the row stores the code itself. */
  const currencyName = (code: string | null) =>
    code ? (currencies.find((c) => c.code === code)?.name ?? code) : null;

  /**
   * The record as a reader wants it, laid out the way the editor's rail reads:
   * Identity · Address (Address + Communication) · Contacts · General
   * (Currencies + Shipping & Payment). Every FK is resolved to a NAME here — a
   * uuid on screen tells the reader nothing — from the same lists the editor's
   * pickers are handed, so nothing is fetched.
   */
  function viewSections(r: Applicant): ViewSection[] {
    const filled = r.contacts.filter(
      (c) =>
        c.contact_name ||
        c.department_id ||
        c.designation_id ||
        c.internal_department_id ||
        c.land_line ||
        c.mobile ||
        c.email_id,
    );
    const sections: ViewSection[] = [
      {
        label: "Identity",
        pairs: [
          ["Country", r.country_id ? (countryLabel.get(r.country_id) ?? null) : null],
          // Yes AND No both say something here — "this applicant is not also a
          // customer" is an answer, not a blank.
          ["Also Customer", r.also_customer ? "Yes" : "No"],
          ["Also Consignee", r.also_consignee ? "Yes" : "No"],
        ],
      },
      {
        label: "Address",
        // No "Country" pair here — it lived under Identity above until the
        // single-Country-field fix (2026-07-31); `address_country_id` is kept
        // in sync with `country_id` and would only repeat that line.
        pairs: [
          ["Street", r.street],
          ["City", r.city_id ? (cityLabel.get(r.city_id) ?? null) : null],
          ["State", nameOf(states, r.state_id)],
          ["Pin", r.pin],
        ],
      },
      {
        label: "Communication",
        pairs: [
          ["Land Line", r.land_line],
          ["Mobile", r.mobile],
          // A stored NULL means "the mobile IS the WhatsApp number" (0353).
          // Left blank it would read as "not provided" — the opposite.
          ["WhatsApp", r.whatsapp ?? (r.mobile ? "Same as mobile" : null)],
          ["E-Mail", r.email],
          ["Web site", r.web_site],
        ],
      },
    ];
    // A section with `content` is never auto-hidden, so a record with no
    // contacts drops the card here rather than showing an empty one. Each
    // contact is three short lines — who they are, then how to reach them —
    // because seven label→value rows apiece would bury everything around it.
    if (filled.length > 0) {
      sections.push({
        label: "Contacts",
        content: (
          <ul className="space-y-2.5 text-sm">
            {filled.map((c) => {
              const role = [
                nameOf(designations, c.designation_id),
                nameOf(departments, c.department_id),
                nameOf(internalDepartments, c.internal_department_id),
              ]
                .filter(Boolean)
                .join(" · ");
              const reach = [c.land_line, c.mobile, c.email_id].filter(Boolean).join(" · ");
              return (
                <li key={c.id} className="border-t border-border pt-2.5 first:border-0 first:pt-0">
                  <div className="font-medium text-foreground">
                    {c.contact_name || <span className="text-muted-foreground">Unnamed contact</span>}
                  </div>
                  {role && <div className="text-muted-foreground">{role}</div>}
                  {reach && <div className="text-muted-foreground">{reach}</div>}
                </li>
              );
            })}
          </ul>
        ),
      });
    }
    sections.push(
      {
        label: "Currencies",
        pairs: [
          ["Currency 1", currencyName(r.currency_1)],
          ["Currency 2", currencyName(r.currency_2)],
          ["Currency 3", currencyName(r.currency_3)],
        ],
      },
      {
        label: "Shipping & Payment",
        pairs: [
          // Ship / pay mode are fixed lists stored as their own label — nothing
          // to resolve, unlike the two config_lookups beside them.
          ["Ship Mode", r.ship_mode],
          ["Ship Type", shipTypeOf(r.ship_type_id)],
          ["Pay Mode", r.pay_mode],
          ["Payment Terms", nameOf(paymentTerms, r.payment_term_id)],
          ["Bank", nameOf(banks, r.bank_id)],
          ["A/c No.", r.ac_no],
        ],
      },
    );
    return sections;
  }

  const columns: Column<Applicant>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {r.name}
          <PublishesBadge roles={applicantPublishes(r)} />
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
      header: "City",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.city_id ? (cityLabel.get(r.city_id) ?? "—") : "—"}
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
   * (AGENTS.md, STANDING). A deploy landing on a half-keyed applicant would take
   * it silently.
   *
   * Whole-object compare against the record as loaded, the same shape
   * company-profile-screen uses: `set` spreads, so key order is stable and the
   * two strings differ only when a value does. Cheaper than threading a
   * `setDirty(true)` through every one of this form's handlers, and it cannot be
   * forgotten on a new one.
   */
  const [pristine, setPristine] = useState("");
  // Gated on `open`: with the editor CLOSED, `pristine` is still "" while the
  // blank form stringifies to a real object, so this would read dirty forever
  // and arm the reload guard on a list page with nothing to lose — permanently
  // blocking the silent PWA auto-update (found on consignee, 2026-07-29).
  const dirty = open && JSON.stringify({ form, contacts }) !== pristine;
  useUnsavedGuard(dirty || isPending);

  const initials = (form.code || form.name || "?").slice(0, 2).toUpperCase();

  // Completion dots on the rail — "this section has data", not "this section is
  // valid". Name is the only required field on the whole form.
  const done = {
    identity: !!(form.name.trim() || form.country_id),
    address: !!(
      form.street.trim() ||
      form.city_id ||
      form.state_id ||
      form.pin.trim() ||
      form.address_country_id ||
      form.land_line.trim() ||
      form.mobile.trim() ||
      form.email.trim() ||
      form.web_site.trim()
    ),
    contacts: contacts.some(
      (c) => c.contact_name.trim() || c.department_id || c.designation_id || c.email_id.trim(),
    ),
    general: !!(
      form.currency_1 ||
      form.currency_2 ||
      form.currency_3 ||
      form.ship_mode ||
      form.pay_mode ||
      form.bank_id ||
      form.ac_no.trim()
    ),
  };

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* caps-input: exempt -- a search QUERY is not a stored value. */}
        <Input uppercase={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search applicant…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Applicant
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No applicants yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No applicants yet.
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
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
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
            <span className="font-semibold text-foreground">{form.name.trim() || "applicant"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled applicant",
          badges: (
            <>
              {form.inactive && <StatusPill tone="danger">Inactive</StatusPill>}
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
              {form.also_customer && <span>· Also customer</span>}
              {form.also_consignee && <span>· Also consignee</span>}
            </>
          ),
        }}
        footer={{
          status: dirty ? "Unsaved changes" : undefined,
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          saveLabel: "Save applicant",
          canSave: !!form.name.trim() && !dupError,
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
              <SectionBody title="Identity">
                <DetailSection label="Details" cols={12}>
                <Field label="Name" size={FIELD_SIZE.name} required htmlFor="ap-name">
                <Input
                id="ap-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
                  // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                  onKeyDown={nameSuggest.onKeyDown}
                  {...dupFieldProps(dupError, "ap-name")}
                />
                <DuplicateError error={dupError} id="ap-name" />
                <SpellSuggestHint
                  suggestions={nameSuggest.suggestions}
                  existing={nameSuggest.existing}
                  activeIndex={nameSuggest.activeIndex}
                  duplicate={!!dupError}
                  onApply={(v) => setForm((f) => ({ ...f, name: v }))}
                />
                </Field>
                {/* `compact` on every picker below: each one prints its own <Label>
                unless told not to, so without it the field is labelled twice. */}
                {/* The ONLY Country field on this form now (client complaint
                    2026-07-31: two boxes both labelled "Country" read as a
                    duplicate). It writes BOTH `country_id` and
                    `address_country_id` — see the Address section below,
                    which used to carry its own picker for the second column. */}
                <Field label="Country" size={FIELD_SIZE.country_id} required>
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
                <Field label="Also Customer" size={FIELD_SIZE.also_customer} htmlFor="ap-alsocust">
                <Select
                id="ap-alsocust"
                value={form.also_customer ? "yes" : "no"}
                onChange={(e) => set({ also_customer: e.target.value === "yes" })}
                >
                <option value="no">No</option>
                <option value="yes">Yes</option>
                </Select>
                </Field>
                <Field label="Also Consignee" size={FIELD_SIZE.also_consignee} htmlFor="ap-alsocons">
                <Select
                id="ap-alsocons"
                value={form.also_consignee ? "yes" : "no"}
                onChange={(e) => set({ also_consignee: e.target.value === "yes" })}
                >
                <option value="no">No</option>
                <option value="yes">Yes</option>
                </Select>
                </Field>
                {/* Edit only, so it takes a short second row rather than a share of
                the first — row 1 then looks identical in New and in Edit.
                `min-h-9` puts the tick on the same baseline as the controls
                above it instead of half a line higher. */}
                {editId && (
                <Field size={FIELD_SIZE.inactive}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2">
                <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => set({ inactive: e.target.checked })}
                />
                <span className="text-sm text-foreground">Inactive</span>
                </label>
                </Field>
                )}
                </DetailSection>
              </SectionBody>
            ),
          },
          {
            key: "address",
            label: "Address",
            icon: MapPin,
            done: done.address,
            content: (
              <SectionBody title="Address">
                {/* Ten fields, so two titled groups rather than one long one
                (LAYOUT.md §4: 5-7 per section) — where the applicant IS,
                then how to reach them. */}
                <DetailSection label="Address" cols={12}>
                {/* A single-line Input, not the 3-row Textarea this used to be:
                at `sm` the textarea would be the tallest item in the row and
                every grid row is as tall as its tallest item, so City /
                State / Pin would sit above two lines of dead space. Stored
                values keep any newlines they already have — an <input> just
                renders them on one line. */}
                <Field label="Street" size={FIELD_SIZE.street} htmlFor="ap-street">
                <Input
                uppercase
                id="ap-street"
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
                <Field label="Pin" size={FIELD_SIZE.pin} htmlFor="ap-pin">
                <ValidatedInput
                id="ap-pin"
                format="pincode"
                value={form.pin}
                onChange={(e) => set({ pin: e.target.value })}
                />
                </Field>
                {/* The Address section used to carry its OWN Country field bound
                    to `address_country_id`, right beside Identity's `country_id`
                    one — the same country, asked twice. The column still exists
                    in the DB (data-io round-trips it, and old rows may only have
                    this one filled in) but it is now written from the single
                    Identity Country picker above, not from a visible field here.
                    Do not add this field back without re-reading that picker's
                    comment first. */}
                </DetailSection>

                <DetailSection label="Communication" cols={12}>
                <Field label="Land Line" size={FIELD_SIZE.land_line} htmlFor="ap-landline">
                <Input
                id="ap-landline"
                value={form.land_line}
                onChange={(e) => set({ land_line: e.target.value })}
                />
                </Field>
                {/* Two grid children, not one — the pair has no wrapper element
                to hang a span on, so each cell takes it through
                `cellClassName`. Without it both would take 1 of 12 (~73px)
                and render as slivers. A literal string: Tailwind v4 scans
                source text, so an interpolated class yields no CSS. Both
                label themselves, hence no <Field> around them. */}
                <MobileWhatsAppFields
                idPrefix="ap"
                mobile={form.mobile}
                whatsapp={form.whatsapp}
                isdCode={isdOf.get(form.address_country_id) ?? null}
                onMobileChange={(v) => set({ mobile: v })}
                onWhatsAppChange={(v) => set({ whatsapp: v })}
                cellClassName="@lg/section:col-span-3"
                />
                <Field label="E-Mail" size={FIELD_SIZE.email} htmlFor="ap-email">
                <ValidatedInput
                id="ap-email"
                format="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                />
                </Field>
                <Field label="Web site" size={FIELD_SIZE.web_site} htmlFor="ap-web">
                <ValidatedInput
                id="ap-web"
                format="website"
                value={form.web_site}
                onChange={(e) => set({ web_site: e.target.value })}
                />
                </Field>
                </DetailSection>
              </SectionBody>
            ),
          },
          {
            key: "contacts",
            label: "Contacts",
            icon: Users,
            done: done.contacts,
            content: (
              <SectionBody title="Contacts">
                {/* Seven fields per contact — past the ~5 a table row can hold,
                so stacked cards with a FieldGrid inside (LAYOUT.md §6).
                Replaces a hand-rolled card list with its own header band,
                remove button and `max-h-56` scroller; the pager is what
                replaces that scroller (client 2026-07-25 — no scroll-in-a-box)
                and `gridKeyNav` now comes with the grid rather than being
                wired by hand. Four of the fields were labelled by
                PLACEHOLDER, which disappears the moment anyone types; they
                carry real labels now (LAYOUT.md §7). */}
                <ChildGrid<ContactRow>
                  lockExisting
                label="Contact"
                rows={contacts}
                onAdd={addContact}
                onRemove={(c) => removeContact(c.key)}
                addLabel="+ Add contact"
                forceCards
                pageSize={3}
                // Paged cards all look alike; the name says which one this is.
                rowSummary={(c) =>
                c.contact_name || <span className="text-muted-foreground">New contact</span>
                }
                // `forceCards` + `renderMobileRow` mean these never render; they
                // are the fallback if this grid is ever switched to a table.
                columns={[
                { header: "Contact Name", cell: (c) => c.contact_name },
                { header: "Mobile", cell: (c) => c.mobile },
                ]}
                // Who the contact is, then how to reach them: 3+3+3+3 = 12 and
                // 3+3+3 = 9. Tab follows this reading order, so reordering the
                // JSX reorders the keyboard path.
                renderMobileRow={(c) => (
                <FieldGrid>
                <Field label="Department" size={FIELD_SIZE.c_department_id}>
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
                </Field>
                <Field
                label="Contact Name"
                size={FIELD_SIZE.c_contact_name}
                htmlFor={`ap-${c.key}-name`}
                >
                <Input
                id={`ap-${c.key}-name`}
                uppercase
                value={c.contact_name}
                onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })}
                />
                </Field>
                <Field label="Designation" size={FIELD_SIZE.c_designation_id}>
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
                </Field>
                <Field
                label="Internal Department"
                size={FIELD_SIZE.c_internal_department_id}
                >
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
                </Field>

                <Field
                label="Land Line"
                size={FIELD_SIZE.c_land_line}
                htmlFor={`ap-${c.key}-landline`}
                >
                <Input
                id={`ap-${c.key}-landline`}
                value={c.land_line}
                onChange={(e) => setContactAt(c.key, { land_line: e.target.value })}
                />
                </Field>
                <Field
                label="Mobile"
                size={FIELD_SIZE.c_mobile}
                htmlFor={`ap-${c.key}-mobile`}
                >
                <ValidatedInput
                id={`ap-${c.key}-mobile`}
                format="mobile"
                value={c.mobile}
                onChange={(e) => setContactAt(c.key, { mobile: e.target.value })}
                />
                </Field>
                <Field
                label="Email ID"
                size={FIELD_SIZE.c_email_id}
                htmlFor={`ap-${c.key}-email`}
                >
                <ValidatedInput
                id={`ap-${c.key}-email`}
                format="email"
                value={c.email_id}
                onChange={(e) => setContactAt(c.key, { email_id: e.target.value })}
                />
                </Field>
                </FieldGrid>
                )}
                />
              </SectionBody>
            ),
          },
          {
            key: "general",
            label: "General",
            icon: SlidersHorizontal,
            done: done.general,
            content: (
              <SectionBody title="General">
                {/* The three currency slots are one legacy concept and nothing
                else belongs beside them, so this row is three wide by nature
                — not by inheriting a default. */}
                <DetailSection label="Currencies" cols={12}>
                <Field label="Currency 1" size={FIELD_SIZE.currency_1}>
                <CurrencyPicker
                label="Currency 1"
                currencies={currencies}
                value={form.currency_1 || null}
                onChange={(code) => set({ currency_1: code })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
                />
                </Field>
                <Field label="Currency 2" size={FIELD_SIZE.currency_2}>
                <CurrencyPicker
                label="Currency 2"
                currencies={currencies}
                value={form.currency_2 || null}
                onChange={(code) => set({ currency_2: code })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
                />
                </Field>
                <Field label="Currency 3" size={FIELD_SIZE.currency_3}>
                <CurrencyPicker
                label="Currency 3"
                currencies={currencies}
                value={form.currency_3 || null}
                onChange={(code) => set({ currency_3: code })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                compact
                />
                </Field>
                </DetailSection>

                {/* How the goods move and how they are paid for — the four terms
                on one row, then the bank the money lands in. */}
                <DetailSection label="Shipping & Payment" cols={12}>
                <Field label="Ship Mode" size={FIELD_SIZE.ship_mode} htmlFor="ap-shipmode">
                <Select
                id="ap-shipmode"
                value={form.ship_mode}
                onChange={(e) => set({ ship_mode: e.target.value })}
                >
                <option value=""></option>
                {SHIP_MODES.map((m) => (
                <option key={m} value={m}>
                {m}
                </option>
                ))}
                </Select>
                </Field>
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
                <Field label="Pay Mode" size={FIELD_SIZE.pay_mode} htmlFor="ap-paymode">
                <Select
                id="ap-paymode"
                value={form.pay_mode}
                onChange={(e) => set({ pay_mode: e.target.value })}
                >
                <option value=""></option>
                {PAY_MODES.map((m) => (
                <option key={m} value={m}>
                {m}
                </option>
                ))}
                </Select>
                </Field>
                <Field label="Payment Terms" size={FIELD_SIZE.payment_term_id}>
                <PaymentTermPicker
                label="Payment Terms"
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
                <Field label="A/c No." size={FIELD_SIZE.ac_no} htmlFor="ap-acno">
                <ValidatedInput
                id="ap-acno"
                format="account"
                value={form.ac_no}
                onChange={(e) => set({ ac_no: e.target.value })}
                />
                </Field>
                </DetailSection>
              </SectionBody>
            ),
          },
        ]}
      />

      {/* Read-only view — the same record, nothing editable, and Edit in the
          footer hands off to the editor above. */}
      <RecordViewSheet
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        title={viewRow?.name ?? ""}
        status={
          viewRow && (
            <StatusPill
              tone={viewRow.is_draft ? "warning" : viewRow.inactive ? "danger" : "success"}
            >
              {viewRow.is_draft ? "Draft" : viewRow.inactive ? "Inactive" : "Active"}
            </StatusPill>
          )
        }
        sections={viewRow ? [...viewSections(viewRow), ...createdSection(viewRow)] : []}
      />
    </div>
  );
}
