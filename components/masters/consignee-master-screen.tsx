"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { BankPicker } from "@/components/masters/bank-picker";
import { NotifyPicker } from "@/components/masters/notify-picker";
import { createConsignee, updateConsignee, deleteConsignee } from "@/lib/masters/consignee-actions";
import {
  SHIP_MODES,
  PAY_MODES,
  type Consignee,
  type ConsigneeInput,
} from "@/lib/masters/consignee-types";
import type { Country } from "@/lib/masters/country-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Customer } from "@/lib/masters/customer-types";
import type { Currency } from "@/lib/masters/types";
import type { Bank } from "@/lib/masters/bank-types";
import type { Notify } from "@/lib/masters/notify-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Section = "address" | "general" | "notify";

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
  fax: string;
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
  fax: "",
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
 * Master-detail CRUD for the legacy "Consignee" master (Associates): a header
 * (Short Name · Name · Inactive · Country · Also Notify · Customer) + three tabs
 * (Address | General | Notify) + a Contact child grid on the Address tab. Only
 * the header + Address tab + Contact grid are built here; the General and Notify
 * tabs are deferred (need legacy screenshots).
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
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("address");
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [markings, setMarkings] = useState<MarkingRow[]>([]);
  const [notifyRefs, setNotifyRefs] = useState<NotifyRefRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  const notifyCountryLabel = useMemo(() => {
    const country = new Map<string, string>();
    for (const c of countries) country.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
    const m = new Map<string, string>();
    for (const n of notifies) m.set(n.id, n.country_id ? (country.get(n.country_id) ?? "—") : "—");
    return m;
  }, [notifies, countries]);

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
    return m;
  }, [countries]);
  const customerLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
    return m;
  }, [customers]);

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
    setMarkings([]);
    setNotifyRefs([]);
    setSection("address");
    setOpen(true);
  }
  function openEdit(r: Consignee) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      country_id: r.country_id ?? "",
      also_notify: r.also_notify,
      customer_id: r.customer_id ?? "",
      street: r.street ?? "",
      city_id: r.city_id ?? "",
      state_id: r.state_id ?? "",
      pin: r.pin ?? "",
      address_country_id: r.address_country_id ?? "",
      land_line: r.land_line ?? "",
      fax: r.fax ?? "",
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
    setMarkings(r.markings.map((m) => ({ key: newKey(), marking: m.marking ?? "" })));
    setNotifyRefs(r.notify_refs.map((n) => ({ key: newKey(), notify_id: n.notify_id ?? "" })));
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
        fax: form.fax.trim() || null,
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
    startTransition(async () => {
      const res = await deleteConsignee(r.id);
      if (res.ok) {
        success("Consignee deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Consignee>[] = [
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

  const tabBtn = (id: Section, label: string) => (
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
        title={editId ? "Edit Consignee" : "New Consignee"}
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
        <div className="space-y-4">
          {/* ---- Header (shown across all tabs) ---- */}
          <div>
            <Label htmlFor="cn-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="cn-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CountryPicker
              countries={countries}
              value={form.country_id || null}
              onChange={(id) => set({ country_id: id })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
            />
            <div>
              <Label htmlFor="cn-alsonotify">Also Notify</Label>
              <Select
                id="cn-alsonotify"
                value={form.also_notify ? "yes" : "no"}
                onChange={(e) => set({ also_notify: e.target.value === "yes" })}
                className="text-base md:text-sm"
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>Customer</Label>
            <CustomerPicker
              customers={customers}
              value={form.customer_id || null}
              onChange={(id) => set({ customer_id: id ?? "" })}
              compact
            />
          </div>
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

          {/* ---- Address | General | Notify tabs ---- */}
          <div className="flex gap-1 rounded-lg border border-border bg-surface-muted p-1">
            {tabBtn("address", "Address")}
            {tabBtn("general", "General")}
            {tabBtn("notify", "Notify")}
          </div>

          {section === "address" && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="cn-street">Street</Label>
                <Textarea
                  id="cn-street"
                  rows={3}
                  value={form.street}
                  onChange={(e) => set({ street: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <LookupDialogPicker
                kind="city"
                label="City"
                options={cities}
                value={form.city_id || null}
                onChange={(id) => set({ city_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
              />
              <LookupDialogPicker
                kind="state"
                label="State"
                options={states}
                value={form.state_id || null}
                onChange={(id) => set({ state_id: id })}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cn-pin">Pin</Label>
                  <Input
                    id="cn-pin"
                    value={form.pin}
                    onChange={(e) => set({ pin: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
                <div>
                  <CountryPicker
                    countries={countries}
                    value={form.address_country_id || null}
                    onChange={(id) => set({ address_country_id: id })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cn-landline">Land Line</Label>
                  <Input
                    id="cn-landline"
                    value={form.land_line}
                    onChange={(e) => set({ land_line: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="cn-fax">Fax</Label>
                  <Input
                    id="cn-fax"
                    value={form.fax}
                    onChange={(e) => set({ fax: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="cn-email">E-Mail</Label>
                <ValidatedInput
                  format="email"
                  id="cn-email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="cn-web">Web site</Label>
                <ValidatedInput
                  format="website"
                  id="cn-web"
                  value={form.web_site}
                  onChange={(e) => set({ web_site: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>

              {/* Contact grid */}
              <div className="rounded-lg border border-border">
                <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                  Contact
                </div>
                <div className="space-y-3 p-3">
                  {contacts.length === 0 && (
                    <p className="text-xs text-muted-foreground">No contacts yet.</p>
                  )}
                  {contacts.map((c, i) => (
                    <div key={c.key} className="space-y-2 rounded-md border border-border p-2.5">
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
                          ✕
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
                          compact
                        />
                      </div>
                      <Input
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
                          compact
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
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
                  <Button type="button" variant="outline" size="sm" onClick={addContact}>
                    + Add contact
                  </Button>
                </div>
              </div>
            </div>
          )}

          {section === "general" && (
            <div className="space-y-4">
              {/* Currencies (up to 3) */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <CurrencyPicker
                  label="Currency 1"
                  currencies={currencies}
                  value={form.currency_1 || null}
                  onChange={(code) => set({ currency_1: code })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
                <CurrencyPicker
                  label="Currency 2"
                  currencies={currencies}
                  value={form.currency_2 || null}
                  onChange={(code) => set({ currency_2: code })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
                <CurrencyPicker
                  label="Currency 3"
                  currencies={currencies}
                  value={form.currency_3 || null}
                  onChange={(code) => set({ currency_3: code })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </div>

              {/* Ship + pay mode dropdowns */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="cn-shipmode">Ship Mode</Label>
                  <Select
                    id="cn-shipmode"
                    value={form.ship_mode}
                    onChange={(e) => set({ ship_mode: e.target.value })}
                    className="text-base md:text-sm"
                  >
                    <option value="">— Select —</option>
                    {SHIP_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Ship Type</Label>
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
                </div>
                <div>
                  <Label htmlFor="cn-paymode">Pay Mode</Label>
                  <Select
                    id="cn-paymode"
                    value={form.pay_mode}
                    onChange={(e) => set({ pay_mode: e.target.value })}
                    className="text-base md:text-sm"
                  >
                    <option value="">— Select —</option>
                    {PAY_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <LookupDialogPicker
                kind="payment_term"
                label="Payment Terms"
                options={paymentTerms}
                value={form.payment_term_id || null}
                onChange={(id) => set({ payment_term_id: id })}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Bank</Label>
                  <BankPicker
                    banks={banks}
                    value={form.bank_id || null}
                    onChange={(id) => set({ bank_id: id })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                    compact
                  />
                </div>
                <div>
                  <Label htmlFor="cn-acno">A/c No.</Label>
                  <Input
                    id="cn-acno"
                    value={form.ac_no}
                    onChange={(e) => set({ ac_no: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
              </div>

              {/* Marking grid */}
              <div className="rounded-lg border border-border">
                <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                  Marking
                </div>
                <div className="space-y-2 p-3">
                  {markings.length === 0 && (
                    <p className="text-xs text-muted-foreground">No markings yet.</p>
                  )}
                  {markings.map((m, i) => (
                    <div key={m.key} className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">
                        {i + 1}
                      </span>
                      <Input
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
                        ✕
                      </Button>
                    </div>
                  ))}
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
                <div className="space-y-3 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>TIN No.</Label>
                      <Input
                        value={form.tin_no}
                        onChange={(e) => set({ tin_no: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label>CST No.</Label>
                      <Input
                        value={form.tin_no_2}
                        onChange={(e) => set({ tin_no_2: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="cn-pan">PAN No</Label>
                    <Input
                      id="cn-pan"
                      value={form.pan_no}
                      onChange={(e) => set({ pan_no: e.target.value })}
                      className="text-base md:text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cn-gst">GST No</Label>
                    <Input
                      id="cn-gst"
                      value={form.gst_no}
                      onChange={(e) => set({ gst_no: e.target.value })}
                      className="text-base md:text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "notify" && (
            <div className="rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                Notify Parties
              </div>
              <div className="space-y-3 p-3">
                {notifyRefs.length === 0 && (
                  <p className="text-xs text-muted-foreground">No notify parties yet.</p>
                )}
                {notifyRefs.map((n, i) => (
                  <div key={n.key} className="space-y-2 rounded-md border border-border p-2.5">
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
                        ✕
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
                        placeholder="— from Notify —"
                        className="text-base md:text-sm"
                      />
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addNotifyRef}>
                  + Add notify party
                </Button>
              </div>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
