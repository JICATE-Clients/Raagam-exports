"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createCourierDeliveryAddress,
  updateCourierDeliveryAddress,
  deleteCourierDeliveryAddress,
} from "@/lib/masters/courier-delivery-actions";
import type {
  CourierDeliveryAddress,
  CourierDeliveryInput,
} from "@/lib/masters/courier-delivery-types";
import type { Country } from "@/lib/masters/country-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type HeaderForm = {
  code: string;
  name: string;
  inactive: boolean;
  country_id: string;
  street: string;
  city_id: string;
  state_id: string;
  pin: string;
  address_country_id: string;
  land_line: string;
  fax: string;
  email: string;
  web_site: string;
};
const BLANK: HeaderForm = {
  code: "",
  name: "",
  inactive: false,
  country_id: "",
  street: "",
  city_id: "",
  state_id: "",
  pin: "",
  address_country_id: "",
  land_line: "",
  fax: "",
  email: "",
  web_site: "",
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

/**
 * Master-detail CRUD for the legacy "Courier Delivery Address" master
 * (Associates) — structurally identical to Notify: a header (Short Name · Name ·
 * Inactive · Country) + Address fields + a Contact child grid. City / State and
 * the grid's Department / Designation / Internal Department are config_lookups
 * pickers (searchable dialog + Add/Modify); both Country fields reuse CountryPicker.
 */
export function CourierDeliveryAddressMasterScreen({
  rows,
  countries,
  cities,
  states,
  departments,
  designations,
  internalDepartments,
  perms,
}: {
  rows: CourierDeliveryAddress[];
  countries: Country[];
  cities: ConfigLookup[];
  states: ConfigLookup[];
  departments: ConfigLookup[];
  designations: ConfigLookup[];
  internalDepartments: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
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
    return rows.filter((r) => [r.code, r.name, r.email].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setContacts([blankContact(newKey())]);
    setOpen(true);
  }
  function openEdit(r: CourierDeliveryAddress) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      country_id: r.country_id ?? "",
      street: r.street ?? "",
      city_id: r.city_id ?? "",
      state_id: r.state_id ?? "",
      pin: r.pin ?? "",
      address_country_id: r.address_country_id ?? "",
      land_line: r.land_line ?? "",
      fax: r.fax ?? "",
      email: r.email ?? "",
      web_site: r.web_site ?? "",
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

  function submit() {
    startTransition(async () => {
      const payload: CourierDeliveryInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
        country_id: form.country_id || null,
        street: form.street.trim() || null,
        city_id: form.city_id || null,
        state_id: form.state_id || null,
        pin: form.pin.trim() || null,
        address_country_id: form.address_country_id || null,
        land_line: form.land_line.trim() || null,
        fax: form.fax.trim() || null,
        email: form.email.trim() || null,
        web_site: form.web_site.trim() || null,
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
      const res = editId
        ? await updateCourierDeliveryAddress(editId, payload)
        : await createCourierDeliveryAddress(payload);
      if (res.ok) {
        success(editId ? "Courier address updated." : "Courier address added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: CourierDeliveryAddress) {
    startTransition(async () => {
      const res = await deleteCourierDeliveryAddress(r.id);
      if (res.ok) {
        success("Courier address deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<CourierDeliveryAddress>[] = [
    { header: "Short Name", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
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
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
      ),
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

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search courier address…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Courier Address
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No courier addresses yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No courier addresses yet.
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
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
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
        title={editId ? "Edit Courier Address" : "New Courier Address"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Header */}
          <div>
            <Label htmlFor="cda-code">Short Name</Label>
            <Input
              id="cda-code"
              value={form.code}
              onChange={(e) => set({ code: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="cda-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="cda-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
          <CountryPicker
            countries={countries}
            value={form.country_id || null}
            onChange={(id) => set({ country_id: id })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
          />
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => set({ inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>

          {/* Address */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
              Address
            </div>
            <div className="space-y-4 p-3">
              <div>
                <Label htmlFor="cda-street">Street</Label>
                <Textarea
                  id="cda-street"
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
                  <Label htmlFor="cda-pin">Pin</Label>
                  <Input
                    id="cda-pin"
                    value={form.pin}
                    onChange={(e) => set({ pin: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
                <CountryPicker
                  countries={countries}
                  value={form.address_country_id || null}
                  onChange={(id) => set({ address_country_id: id })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cda-landline">Land Line</Label>
                  <Input
                    id="cda-landline"
                    value={form.land_line}
                    onChange={(e) => set({ land_line: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="cda-fax">Fax</Label>
                  <Input
                    id="cda-fax"
                    value={form.fax}
                    onChange={(e) => set({ fax: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="cda-email">E-Mail</Label>
                <ValidatedInput
                  format="email"
                  id="cda-email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div>
                <Label htmlFor="cda-web">Web site</Label>
                <ValidatedInput
                  format="website"
                  id="cda-web"
                  value={form.web_site}
                  onChange={(e) => set({ web_site: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
            </div>
          </div>

          {/* Contact grid */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
              Contact
            </div>
            <div className="space-y-3 p-3">
              {contacts.length === 0 && <p className="text-xs text-muted-foreground">No contacts yet.</p>}
              {contacts.map((c, i) => (
                <div key={c.key} className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Contact #{i + 1}</span>
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
      </Sheet>
    </div>
  );
}
