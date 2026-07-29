"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { MobileField, WhatsAppField, useIsdLookup } from "@/components/masters/contact-fields";
import { Field, FieldGrid } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid, SectionColumn } from "@/components/masters/section-grid";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Textarea } from "@/components/ui/textarea";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createCourierDeliveryAddress,
  updateCourierDeliveryAddress,
  deleteCourierDeliveryAddress,
} from "@/lib/masters/courier-delivery-actions";
import { deletedToast } from "@/lib/masters/delete-message";
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
  mobile: string;
  /** null = "same as mobile" (tick on). "" = tick off, nothing typed yet. */
  whatsapp: string | null;
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
  mobile: "",
  whatsapp: null,
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
  const isdOf = useIsdLookup(countries);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
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
      mobile: r.mobile ?? "",
      // NOT `?? ""` — a stored NULL is the "same as mobile" state.
      whatsapp: r.whatsapp,
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
        // Create derives the code from the display name; edit keeps the
        // record's original stored code (held in state, never rendered).
        code: editId ? form.code.trim() || null : form.name.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
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
        success(deletedToast("Courier address", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<CourierDeliveryAddress>[] = [
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
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.code, r.name, r.email].filter(Boolean).join(" ")}
        searchPlaceholder="Search courier address…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Courier Address"
        onAdd={openAdd}
        columns={columns}
        empty="No courier addresses yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) => (r.country_id ? countryLabel.get(r.country_id) ?? null : null),
          pill: (r) => (
            <StatusPill tone={r.inactive ? "danger" : "success"}>
              {r.inactive ? "Inactive" : "Active"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

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
        {/* Identity + address LEFT, contacts RIGHT. The address block splits
            into "Address" (where it is) and "Communication" (how to reach it):
            as one card it held 10 fields, well past the 5-7 a section should
            carry (LAYOUT.md §4). Both were hand-rolled bordered cards with their
            own header bands — they are DetailSections. */}
        <SectionGrid>
          <SectionColumn>
            <DetailSection label="Details" cols={12}>
              <Field label="Name" size="lg" required htmlFor="cda-name">
                <Input
                  id="cda-name"
                  uppercase
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  required
                />
              </Field>
              {/* Pickers render their own labels — never double-label them. */}
              <Field size="md">
                <CountryPicker
                  countries={countries}
                  value={form.country_id || null}
                  onChange={(id) => set({ country_id: id })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </Field>
              {editId && (
                <Field size="md">
                  <label className="flex h-8 cursor-pointer items-center gap-2">
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

            <DetailSection label="Address" cols={12}>
              <Field label="Street" size="full" htmlFor="cda-street">
                <Textarea
                  id="cda-street"
                  rows={3}
                  value={form.street}
                  onChange={(e) => set({ street: e.target.value })}
                />
              </Field>
              <Field size="md">
                <LookupDialogPicker
                  kind="city"
                  label="City"
                  options={cities}
                  value={form.city_id || null}
                  onChange={(id) => set({ city_id: id })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </Field>
              <Field size="md">
                <LookupDialogPicker
                  kind="state"
                  label="State"
                  options={states}
                  value={form.state_id || null}
                  onChange={(id) => set({ state_id: id })}
                />
              </Field>
              {/* A PIN is 6 digits — it must not inherit a picker's box. */}
              <Field label="Pin" size="sm" htmlFor="cda-pin">
                <Input
                  id="cda-pin"
                  value={form.pin}
                  onChange={(e) => set({ pin: e.target.value })}
                />
              </Field>
              <Field size="md">
                <CountryPicker
                  countries={countries}
                  value={form.address_country_id || null}
                  onChange={(id) => set({ address_country_id: id })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </Field>
            </DetailSection>

            <DetailSection label="Communication" cols={12}>
              <Field label="Land Line" size="md" htmlFor="cda-landline">
                <Input
                  id="cda-landline"
                  value={form.land_line}
                  onChange={(e) => set({ land_line: e.target.value })}
                />
              </Field>
              {/* The pair is taken apart here rather than using
                  MobileWhatsAppFields: that helper emits two bare sibling cells
                  for a `sm:grid-cols-2` parent, and on the 12-col track a child
                  with no span takes ONE column of twelve. Each half needs its
                  own Field. Both render their own labels. */}
              <Field size="md">
                <MobileField
                  id="cda-mobile"
                  value={form.mobile}
                  onChange={(v) => set({ mobile: v })}
                />
              </Field>
              <Field size="md">
                <WhatsAppField
                  id="cda-whatsapp"
                  value={form.whatsapp}
                  mobile={form.mobile}
                  isdCode={isdOf.get(form.address_country_id) ?? null}
                  onChange={(v) => set({ whatsapp: v })}
                />
              </Field>
              <Field label="E-Mail" size="lg" htmlFor="cda-email">
                <ValidatedInput
                  format="email"
                  id="cda-email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                />
              </Field>
              <Field label="Web site" size="lg" htmlFor="cda-web">
                <ValidatedInput
                  format="website"
                  id="cda-web"
                  value={form.web_site}
                  onChange={(e) => set({ web_site: e.target.value })}
                />
              </Field>
            </DetailSection>
          </SectionColumn>

          <SectionColumn>
            {/* Seven fields per row, so stacked cards (LAYOUT.md §6) with a
                FieldGrid inside: the card body gets the same 12-col track as the
                sections beside it, instead of seven controls stacked one per
                line. Replaces a hand-rolled list with its own header band, `#`
                column, remove button and `max-h-56` scroller. */}
            <ChildGrid<ContactRow>
              label="Contact"
              rows={contacts}
              onAdd={addContact}
              onRemove={(c) => removeContact(c.key)}
              addLabel="+ Add contact"
              forceCards
              pageSize={4}
              // `forceCards` + `renderMobileRow` mean these never render; they
              // are the fallback if this grid is ever switched back to a table.
              columns={[
                { header: "Department", cell: (c) => c.contact_name },
                { header: "Contact Name", cell: (c) => c.contact_name },
                { header: "Designation", cell: (c) => c.designation_id ?? "" },
              ]}
              renderMobileRow={(c) => (
                <FieldGrid>
                  <Field label="Department" size="lg">
                    <LookupDialogPicker
                      kind="department"
                      label="Department"
                      options={departments}
                      value={c.department_id || null}
                      onChange={(id) => setContactAt(c.key, { department_id: id })}
                      compact
                    />
                  </Field>
                  <Field label="Designation" size="lg">
                    <LookupDialogPicker
                      kind="designation"
                      label="Designation"
                      options={designations}
                      value={c.designation_id || null}
                      onChange={(id) => setContactAt(c.key, { designation_id: id })}
                      compact
                    />
                  </Field>
                  <Field label="Contact Name" size="lg">
                    <Input
                      value={c.contact_name}
                      onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })}
                    />
                  </Field>
                  <Field label="Internal Department" size="lg">
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
                  <Field label="Land Line" size="md">
                    <Input
                      value={c.land_line}
                      onChange={(e) => setContactAt(c.key, { land_line: e.target.value })}
                    />
                  </Field>
                  <Field label="Mobile" size="md">
                    <Input
                      value={c.mobile}
                      onChange={(e) => setContactAt(c.key, { mobile: e.target.value })}
                    />
                  </Field>
                  <Field label="Email ID" size="md">
                    <ValidatedInput
                      format="email"
                      value={c.email_id}
                      onChange={(e) => setContactAt(c.key, { email_id: e.target.value })}
                    />
                  </Field>
                </FieldGrid>
              )}
            />
          </SectionColumn>
        </SectionGrid>
      </Sheet>
    </div>
  );
}
