"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { MobileField, WhatsAppField, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid, SectionColumn } from "@/components/masters/section-grid";
import { Textarea } from "@/components/ui/textarea";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { createNotify, updateNotify, deleteNotify } from "@/lib/masters/notify-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import type { Notify, NotifyInput } from "@/lib/masters/notify-types";
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
 * How wide each header field is on the 12-column track (LAYOUT.md §3).
 *
 * Sized to the data, and to FOUR per row. `md` was the size eight of these
 * fields had inherited by omission rather than by choice, which put three on a
 * row and spread a 13-field header down a laptop screen (client 2026-07-29). A
 * city, a state and a country are ordinary place names picked from a list —
 * none of them earns a third of the row.
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12. A row totalling 13+ does not shrink: its
 * last field wraps onto a line of its own and the rest of that line is left
 * empty, and nothing in the build catches it. Two rows here were doing exactly
 * that. The arithmetic, row by row:
 *
 *   Details        name 6 + country 3 + inactive 3           = 12   was 6+4+4 = 14 on Edit, Inactive wrapped
 *   Address        street 12                                 = 12
 *                  city 3 + state 3 + pin 3 + addr ctry 3    = 12   was 4+4+3+4 = 15, Country wrapped
 *   Communication  land line 3 + mobile 3 + whatsapp 3       =  9
 *                  e-mail 6 + web site 6                     = 12
 *
 * Seven field rows became four, and both silent wraps are gone.
 *
 * The Communication row stopping at 9 is deliberate. Five fields split 3 + 2
 * because the last two genuinely earn `lg` — an e-mail and a URL are the
 * longest values on the form after the party name. Widening the three phones
 * back to `md` just to close the row would be sizing to the cell, not to the
 * data, which is the habit this map exists to break.
 *
 * One caveat worth knowing before comparing this to `bank-master-screen.tsx`,
 * the reference for four-across: these sections sit in a half-width
 * `SectionColumn` (the contact grid is beside them), so the track is ~566px and
 * `sm` is ~132px — bank's card spans the full 1180px, where the same `sm` is
 * ~278px. The two phone cells also give ~32px of that to their call/chat chip.
 */
const FIELD_SIZE = {
  name: "lg", // 6 — the party name, the one genuinely long free text here
  country: "sm", // 3 — a country name, picked from a list rather than typed
  inactive: "sm", // 3 — a tick; it sits last in the row, so it takes the remainder
  street: "full", // 12 — a 3-row Textarea stands alone (§3)
  city: "sm", // 3
  state: "sm", // 3
  pin: "sm", // 3 — 6 digits would fit `xs`, but that leaves the row at 11
  address_country: "sm", // 3
  land_line: "sm", // 3
  mobile: "sm", // 3
  whatsapp: "sm", // 3 — the "Same as mobile" tick under it still fits at ~132px
  email: "lg", // 6 — free text, routinely past 30 characters
  web_site: "lg", // 6 — same, and it pairs with e-mail on one flush row
} satisfies Record<string, FieldSize>;

/**
 * Master-detail CRUD for the legacy "Notify" master (Associates): a header
 * (Short Name · Name · Inactive · Country) + Address fields + a Contact child
 * grid. City / State and the grid's Department / Designation / Internal
 * Department are config_lookups pickers (searchable dialog + Add/Modify); both
 * Country fields reuse the shared CountryPicker.
 */
export function NotifyMasterScreen({
  rows,
  countries,
  cities,
  states,
  departments,
  designations,
  internalDepartments,
  perms,
}: {
  rows: Notify[];
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
  function openEdit(r: Notify) {
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
      const payload: NotifyInput = {
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
      const res = editId ? await updateNotify(editId, payload) : await createNotify(payload);
      if (res.ok) {
        success(editId ? "Notify updated." : "Notify added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Notify) {
    startTransition(async () => {
      const res = await deleteNotify(r.id);
      if (res.ok) {
        success(deletedToast("Notify", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Notify>[] = [
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
        searchPlaceholder="Search notify…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Notify"
        onAdd={openAdd}
        columns={columns}
        empty="No notify parties yet."
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
        title={editId ? "Edit Notify" : "New Notify"}
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
              <Field label="Name" size={FIELD_SIZE.name} required htmlFor="nt-name">
                <Input
                  id="nt-name"
                  uppercase
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  required
                />
              </Field>
              {/* Pickers render their own labels — never double-label them. */}
              <Field size={FIELD_SIZE.country}>
                <CountryPicker
                  countries={countries}
                  value={form.country_id || null}
                  onChange={(id) => set({ country_id: id })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </Field>
              {editId && (
                <Field size={FIELD_SIZE.inactive}>
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
              <Field label="Street" size={FIELD_SIZE.street} htmlFor="nt-street">
                <Textarea
                  id="nt-street"
                  rows={3}
                  value={form.street}
                  onChange={(e) => set({ street: e.target.value })}
                />
              </Field>
              <Field size={FIELD_SIZE.city}>
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
              <Field size={FIELD_SIZE.state}>
                <LookupDialogPicker
                  kind="state"
                  label="State"
                  options={states}
                  value={form.state_id || null}
                  onChange={(id) => set({ state_id: id })}
                />
              </Field>
              <Field label="Pin" size={FIELD_SIZE.pin} htmlFor="nt-pin">
                <Input
                  id="nt-pin"
                  value={form.pin}
                  onChange={(e) => set({ pin: e.target.value })}
                />
              </Field>
              <Field size={FIELD_SIZE.address_country}>
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
              <Field label="Land Line" size={FIELD_SIZE.land_line} htmlFor="nt-landline">
                <Input
                  id="nt-landline"
                  value={form.land_line}
                  onChange={(e) => set({ land_line: e.target.value })}
                />
              </Field>
              {/* The pair is taken apart here rather than using
                  MobileWhatsAppFields: that helper emits two bare sibling cells
                  for a `sm:grid-cols-2` parent, and on the 12-col track a child
                  with no span takes ONE column of twelve. Each half needs its
                  own Field. Both render their own labels. */}
              <Field size={FIELD_SIZE.mobile}>
                <MobileField
                  id="nt-mobile"
                  value={form.mobile}
                  onChange={(v) => set({ mobile: v })}
                />
              </Field>
              <Field size={FIELD_SIZE.whatsapp}>
                <WhatsAppField
                  id="nt-whatsapp"
                  value={form.whatsapp}
                  mobile={form.mobile}
                  isdCode={isdOf.get(form.address_country_id) ?? null}
                  onChange={(v) => set({ whatsapp: v })}
                />
              </Field>
              <Field label="E-Mail" size={FIELD_SIZE.email} htmlFor="nt-email">
                <ValidatedInput
                  format="email"
                  id="nt-email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                />
              </Field>
              <Field label="Web site" size={FIELD_SIZE.web_site} htmlFor="nt-web">
                <ValidatedInput
                  format="website"
                  id="nt-web"
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
              /* Two rows, not three (client 2026-07-29). The four pickers were
                 `lg` and the three contact channels `md`, which spent 6+6 / 6+6
                 / 4+4+4 on seven fields that are a department name, a person's
                 name and a phone number:
                   department 3 + designation 3 + contact name 3 + internal 3 = 12
                   land line 3 + mobile 3 + e-mail 6                          = 12
                 E-Mail keeps `lg` — it is the one value here that routinely runs
                 past 30 characters, and it is what closes the second row. */
              renderMobileRow={(c) => (
                <FieldGrid>
                  <Field label="Department" size="sm">
                    <LookupDialogPicker
                      kind="department"
                      label="Department"
                      options={departments}
                      value={c.department_id || null}
                      onChange={(id) => setContactAt(c.key, { department_id: id })}
                      compact
                    />
                  </Field>
                  <Field label="Designation" size="sm">
                    <LookupDialogPicker
                      kind="designation"
                      label="Designation"
                      options={designations}
                      value={c.designation_id || null}
                      onChange={(id) => setContactAt(c.key, { designation_id: id })}
                      compact
                    />
                  </Field>
                  <Field label="Contact Name" size="sm">
                    <Input
                      value={c.contact_name}
                      onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })}
                    />
                  </Field>
                  <Field label="Internal Dept." size="sm">
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
                  <Field label="Land Line" size="sm">
                    <Input
                      value={c.land_line}
                      onChange={(e) => setContactAt(c.key, { land_line: e.target.value })}
                    />
                  </Field>
                  <Field label="Mobile" size="sm">
                    <Input
                      value={c.mobile}
                      onChange={(e) => setContactAt(c.key, { mobile: e.target.value })}
                    />
                  </Field>
                  <Field label="Email ID" size="lg">
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
