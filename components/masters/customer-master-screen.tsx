"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { ApplicantPicker } from "@/components/masters/applicant-picker";
import { createCustomer, updateCustomer, deleteCustomer } from "@/lib/masters/customer-actions";
import type { Customer, CustomerInput } from "@/lib/masters/customer-types";
import type { Applicant } from "@/lib/masters/applicant-types";
import type { Country } from "@/lib/masters/country-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

// Five tabs on the legacy Customer form; the last four are stubbed until their
// screenshots arrive (see the plan's "Next" section).
type TabKey = "address" | "agents" | "supplied_items" | "nominated_vendors" | "general";
const TABS: { key: TabKey; label: string; built: boolean }[] = [
  { key: "address", label: "Address", built: true },
  { key: "agents", label: "Agents", built: false },
  { key: "supplied_items", label: "Customer Supplied Items", built: false },
  { key: "nominated_vendors", label: "Customer Nominated Vendors", built: false },
  { key: "general", label: "CustomerGeneral", built: false },
];

const APPLICANT_SLOTS = 5;

type HeaderForm = {
  code: string;
  name: string;
  blocked: boolean;
  doc_prefix: string;
  doc_id: string;
  also_consignee: boolean;
  country_id: string;
  // Address
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
  blocked: false,
  doc_prefix: "",
  doc_id: "",
  also_consignee: false,
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

type ApplicantSlot = { key: string; applicant_id: string };

/**
 * Master-detail CRUD for the legacy "Customer" master (Associates) — the richest
 * Associates form. A header (Short Name · Blocked · Name · Doc Prefix · ID · Also
 * Consignee · Country) + an Applicant(s) sub-list (5 picker slots) + five tabs.
 *
 * Unlike the Sheet-based masters, the editor is a full-screen overlay
 * (`fixed inset-0 z-[80]`) so the 5 tabs + grids have room; the picker dialogs
 * portal to z-[100] and layer above it. Phase 1 builds the header + Applicant
 * slots + Address tab + Contact grid; the other four tabs are stubs.
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
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("address");
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [slots, setSlots] = useState<ApplicantSlot[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  // Lock background scroll while the full-screen editor is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.code ? `${c.code} — ${c.name}` : c.name);
    return m;
  }, [countries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.email].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function freshSlots(existing: { applicant_id: string | null }[] = []): ApplicantSlot[] {
    const out: ApplicantSlot[] = existing.map((a) => ({
      key: newKey(),
      applicant_id: a.applicant_id ?? "",
    }));
    while (out.length < APPLICANT_SLOTS) out.push({ key: newKey(), applicant_id: "" });
    return out;
  }

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setContacts([blankContact(newKey())]);
    setSlots(freshSlots());
    setTab("address");
    setOpen(true);
  }
  function openEdit(r: Customer) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      blocked: r.blocked,
      doc_prefix: r.doc_prefix ?? "",
      doc_id: r.doc_id ?? "",
      also_consignee: r.also_consignee,
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
    setSlots(freshSlots(r.applicants));
    setTab("address");
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
  function setSlotAt(key: string, applicant_id: string) {
    setSlots((ss) => ss.map((s) => (s.key === key ? { ...s, applicant_id } : s)));
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: CustomerInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        blocked: form.blocked,
        doc_prefix: form.doc_prefix.trim() || null,
        doc_id: form.doc_id.trim() || null,
        also_consignee: form.also_consignee,
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
        applicants: slots
          .filter((s) => s.applicant_id)
          .map((s, i) => ({ sno: i + 1, applicant_id: s.applicant_id })),
      };
      const res = editId ? await updateCustomer(editId, payload) : await createCustomer(payload);
      if (res.ok) {
        success(editId ? "Customer updated." : "Customer added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Customer) {
    startTransition(async () => {
      const res = await deleteCustomer(r.id);
      if (res.ok) {
        success("Customer deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Customer>[] = [
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
      header: "Status",
      cell: (r) => {
        const tone = r.is_draft ? "warning" : r.blocked ? "danger" : "success";
        const text = r.is_draft ? "Draft" : r.blocked ? "Blocked" : "Active";
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

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customer…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Customer
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No customers yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No customers yet.
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
                <StatusPill tone={r.is_draft ? "warning" : r.blocked ? "danger" : "success"}>
                  {r.is_draft ? "Draft" : r.blocked ? "Blocked" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      {/* full-screen editor */}
      {open && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-background">
          {/* top bar */}
          <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
            <h2 className="text-base font-semibold text-foreground">
              {editId ? "Edit Customer" : "New Customer"}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* scrollable body */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-5 px-4 py-5">
              {/* ---- Header ---- */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cu-code">Short Name</Label>
                  <Input
                    id="cu-code"
                    value={form.code}
                    onChange={(e) => set({ code: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 sm:pt-6">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.blocked}
                    onChange={(e) => set({ blocked: e.target.checked })}
                  />
                  <span className="text-sm text-foreground">Blocked</span>
                </label>
              </div>
              <div>
                <Label htmlFor="cu-name">
                  Name <span className="text-danger">*</span>
                </Label>
                <Input
                  id="cu-name"
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  required
                  className="text-base md:text-sm"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cu-prefix">Doc Prefix</Label>
                  <Input
                    id="cu-prefix"
                    value={form.doc_prefix}
                    onChange={(e) => set({ doc_prefix: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="cu-docid">ID</Label>
                  <Input
                    id="cu-docid"
                    value={form.doc_id}
                    onChange={(e) => set({ doc_id: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cu-alsocons">Also Consignee</Label>
                  <Select
                    id="cu-alsocons"
                    value={form.also_consignee ? "yes" : "no"}
                    onChange={(e) => set({ also_consignee: e.target.value === "yes" })}
                    className="text-base md:text-sm"
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </Select>
                </div>
                <div>
                  <Label>Country</Label>
                  <CountryPicker
                    countries={countries}
                    value={form.country_id || null}
                    onChange={(id) => set({ country_id: id })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                  />
                </div>
              </div>

              {/* ---- Applicant(s) slots ---- */}
              <div className="rounded-lg border border-border">
                <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                  Applicant(s)
                </div>
                <div className="space-y-2 p-3">
                  {slots.map((s, i) => (
                    <div key={s.key} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <ApplicantPicker
                          applicants={applicants}
                          value={s.applicant_id || null}
                          onChange={(id) => setSlotAt(s.key, id ?? "")}
                          compact
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ---- Tabs ---- */}
              <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-muted p-1">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      tab === t.key
                        ? "bg-surface text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === "address" && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="cu-street">Street</Label>
                    <Textarea
                      id="cu-street"
                      rows={3}
                      value={form.street}
                      onChange={(e) => set({ street: e.target.value })}
                      className="text-base md:text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      canCreate={perms.canCreate}
                      canEdit={perms.canEdit}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="cu-pin">Pin</Label>
                      <Input
                        id="cu-pin"
                        value={form.pin}
                        onChange={(e) => set({ pin: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label>Country</Label>
                      <CountryPicker
                        countries={countries}
                        value={form.address_country_id || null}
                        onChange={(id) => set({ address_country_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="cu-landline">Land Line</Label>
                      <Input
                        id="cu-landline"
                        value={form.land_line}
                        onChange={(e) => set({ land_line: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="cu-fax">Fax</Label>
                      <Input
                        id="cu-fax"
                        value={form.fax}
                        onChange={(e) => set({ fax: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="cu-email">E-Mail</Label>
                      <Input
                        id="cu-email"
                        type="email"
                        value={form.email}
                        onChange={(e) => set({ email: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="cu-web">Web site</Label>
                      <Input
                        id="cu-web"
                        value={form.web_site}
                        onChange={(e) => set({ web_site: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
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
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                                compact
                              />
                            </div>
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
                                compact
                              />
                            </div>
                          </div>
                          <Input
                            placeholder="Contact Name"
                            value={c.contact_name}
                            onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })}
                            className="text-base md:text-sm"
                          />
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
                          <Input
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
                              onChange={(id) =>
                                setContactAt(c.key, { internal_department_id: id })
                              }
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

              {tab !== "address" && (
                <div className="rounded-lg border border-dashed border-border bg-surface-muted/40 px-4 py-14 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {TABS.find((t) => t.key === tab)?.label} tab — coming next
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                    Send the legacy screenshot for this tab and it will be built as an additive
                    child table + panel, wired into the same Save.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* sticky footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3">
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
          </div>
        </div>
      )}
    </div>
  );
}
