"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import { MobileWhatsAppFields, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { BankPicker } from "@/components/masters/bank-picker";
import { createApplicant, updateApplicant, deleteApplicant } from "@/lib/masters/applicant-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  SHIP_MODES,
  PAY_MODES,
  type Applicant,
  type ApplicantInput,
} from "@/lib/masters/applicant-types";
import type { Country } from "@/lib/masters/country-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Currency } from "@/lib/masters/types";
import type { Bank } from "@/lib/masters/bank-types";

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
 * Sized to the DATA, not to the cell: a 6-digit PIN and a Yes/No dropdown must
 * not inherit the same ~490px box as a company name. `sm` (3 of 12 — four per
 * row) is the working default; every other value below is a deliberate call,
 * written here rather than at the call sites so a row's arithmetic can be read
 * in one place.
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12 OR LESS. A row totalling 13+ does not
 * shrink — it wraps its last field onto a line of its own and leaves the rest
 * of that line empty. Nothing in the build catches that, which is why the sum
 * is spelt out row by row:
 *
 *   Details         name 4 + country 3 + also_customer 2 + also_consignee 2 = 11
 *                   inactive 3                                     (edit only)
 *   Address         street 12
 *                   city 3 + state 3 + pin 2 + address_country 3 = 11
 *   Communication   land_line 3 + mobile 3 + whatsapp 3 = 9
 *                   email 6 + web_site 6 = 12
 *   Currencies      currency_1 3 + currency_2 3 + currency_3 3 = 9
 *   Ship & Payment  ship_mode 2 + ship_type 3 + pay_mode 2 + payment_term 3 = 10
 *                   bank 3 + ac_no 3 = 6
 *   Contact row     department 3 + contact_name 3 + designation 3 + internal 3 = 12
 *                   land_line 3 + mobile 3 + email_id 6 = 12
 *
 * Two calls worth stating, because both look like oversights:
 *
 * - Name is `md`, not the `lg` a company name would normally take. At `lg` the
 *   first row is 6+3+2+2 = 13 and Also Consignee wraps onto an empty line of
 *   its own. Four fields flush beats one wider name box (client 2026-07-29).
 * - The rows summing to 11 or 10 end in dead space, NOT in a wrap: there is no
 *   span of 1, and nothing left in those groups is small enough to fill the
 *   gap (Bank at `sm` would make Ship & Payment's first row 13).
 *
 * Mobile / WhatsApp are deliberately absent. `MobileWhatsAppFields` is a
 * fragment of TWO grid children with no wrapper, so it takes its span as a
 * literal `cellClassName` string instead — Tailwind v4 scans source text, and
 * an interpolated class produces no CSS at all. They still count as 3 + 3 in
 * the Communication row above.
 */
const FIELD_SIZE: Record<SizedField, FieldSize> = {
  name: "md", // 4 — see above; `lg` overflows the row
  country_id: "sm", // 3 — picker, holds "UNITED ARAB EMIRATES" without truncating
  also_customer: "xs", // 2 — Yes/No
  also_consignee: "xs", // 2 — Yes/No
  inactive: "sm", // 3 — a lone tick box on its own (edit-only) row
  street: "full", // 12 — a 3-row textarea stands alone
  city_id: "sm",
  state_id: "sm",
  pin: "xs", // 2 — 6 digits
  address_country_id: "sm",
  land_line: "sm",
  email: "lg", // 6 — long free text
  web_site: "lg", // 6 — long free text
  currency_1: "sm", // 3 — the trigger reads "USD — US DOLLAR"
  currency_2: "sm",
  currency_3: "sm",
  ship_mode: "xs", // 2 — AIR / ROAD / SEA / SEA-AIR
  ship_type_id: "sm",
  pay_mode: "xs", // 2 — CAD / CASH / CHEQUE / DA / DD / DP / LC / OTH
  payment_term_id: "sm",
  bank_id: "sm",
  ac_no: "sm",
  c_department_id: "sm",
  c_contact_name: "sm",
  c_designation_id: "sm",
  c_internal_department_id: "sm",
  c_land_line: "sm",
  c_mobile: "sm",
  c_email_id: "lg", // 6 — long free text
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
  const [editId, setEditId] = useState<string | null>(null);
  const [section, setSection] = useState<"address" | "general">("address");
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

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
    setForm(BLANK);
    setContacts([blankContact(newKey())]);
    setSection("address");
    setOpen(true);
  }
  function openEdit(r: Applicant) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      also_customer: r.also_customer,
      also_consignee: r.also_consignee,
      country_id: r.country_id ?? "",
      street: r.street ?? "",
      city_id: r.city_id ?? "",
      state_id: r.state_id ?? "",
      pin: r.pin ?? "",
      address_country_id: r.address_country_id ?? "",
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
    setSection("address");
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

  const columns: Column<Applicant>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
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
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const tabBtn = (id: "address" | "general", label: string) => (
    <button
      type="button"
      onClick={() => setSection(id)}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        section === id
          ? "bg-surface text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
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
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No applicants yet." />
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
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Applicant" : "New Applicant"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {perms.canCreate && (
              <Button
                variant="outline"
                size="md"
                disabled={isPending || !form.name.trim()}
                onClick={() => submit(true)}
              >
                Save as Draft
              </Button>
            )}
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={() => submit(false)}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/* Sections are STACKED, never side by side. A `SectionGrid` would hand
            each one ~570px, and once the card's own padding comes off that is
            under the 512px `@lg/section` threshold the field spans query — every
            span would silently stop applying and the fields would go one per
            row. Full width is what lets four share a row. Same call, and the
            same reason, as bank-master-screen. */}
        <div className="space-y-3">
          {/* ---- Header (shown across both tabs) ---- */}
          <DetailSection label="Details" cols={12}>
            <Field label="Name" size={FIELD_SIZE.name} required htmlFor="ap-name">
              <Input
                id="ap-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
              />
            </Field>
            {/* `compact` on every picker below: each one prints its own <Label>
                unless told not to, so without it the field is labelled twice. */}
            <Field label="Country" size={FIELD_SIZE.country_id} required>
              <CountryPicker
                countries={countries}
                value={form.country_id || null}
                onChange={(id) => set({ country_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
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

          {/* ---- Address | General tabs ---- */}
          <div className="flex gap-1 rounded-lg border border-border bg-surface-muted p-1">
            {tabBtn("address", "Address")}
            {tabBtn("general", "General")}
          </div>

          {section === "address" && (
            <div className="space-y-3">
              {/* Ten fields, so two titled groups rather than one long one
                  (LAYOUT.md §4: 5-7 per section) — where the applicant IS,
                  then how to reach them. */}
              <DetailSection label="Address" cols={12}>
                <Field label="Street" size={FIELD_SIZE.street} htmlFor="ap-street">
                  <Textarea
                    id="ap-street"
                    rows={3}
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
                  <LookupDialogPicker
                    kind="state"
                    label="State"
                    options={states}
                    value={form.state_id || null}
                    onChange={(id) => set({ state_id: id })}
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
                {/* No asterisk, unlike the header Country: the address country
                    saves as null and Save never checks it. The * this field used
                    to show came from the shared picker's own hard-coded label,
                    not from anything this form enforces. */}
                <Field label="Country" size={FIELD_SIZE.address_country_id}>
                  <CountryPicker
                    countries={countries}
                    value={form.address_country_id || null}
                    onChange={(id) => set({ address_country_id: id })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                    compact
                  />
                </Field>
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
                // 3+3+6 = 12. Tab follows this reading order, so reordering the
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
            </div>
          )}

          {section === "general" && (
            <div className="space-y-3">
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
                    <option value="">— Select —</option>
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
                    <option value="">— Select —</option>
                    {PAY_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Payment Terms" size={FIELD_SIZE.payment_term_id}>
                  <LookupDialogPicker
                    kind="payment_term"
                    label="Payment Terms"
                    options={paymentTerms}
                    value={form.payment_term_id || null}
                    onChange={(id) => set({ payment_term_id: id })}
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
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
