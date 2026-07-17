"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  User,
  MapPin,
  Users,
  Package,
  Truck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { ApplicantPicker } from "@/components/masters/applicant-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { ChildGrid } from "@/components/masters/child-grid";
import { createCustomer, updateCustomer, deleteCustomer } from "@/lib/masters/customer-actions";
import {
  type Customer,
  type CustomerInput,
  SHIP_MODES,
  PAY_MODES,
} from "@/lib/masters/customer-types";
import type { Applicant } from "@/lib/masters/applicant-types";
import type { Country } from "@/lib/masters/country-types";
import type { Currency } from "@/lib/masters/types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type SectionKey = "identity" | "address" | "agents" | "supplied" | "vendors" | "general";
const SECTIONS: { key: SectionKey; label: string; icon: LucideIcon }[] = [
  { key: "identity", label: "Identity", icon: User },
  { key: "address", label: "Address", icon: MapPin },
  { key: "agents", label: "Agents", icon: Users },
  { key: "supplied", label: "Supplied Items", icon: Package },
  { key: "vendors", label: "Nominated Vendors", icon: Truck },
  { key: "general", label: "General", icon: SlidersHorizontal },
];

type HeaderForm = {
  code: string;
  name: string;
  inactive: boolean;
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
const BLANK: HeaderForm = {
  code: "",
  name: "",
  inactive: false,
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
  categories,
  agentTypes,
  agentOptions,
  packingFormats,
  commercialFormats,
  vendors,
  receivableTerms,
  ports,
  destinations,
  couriers,
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
  categories: ConfigLookup[];
  agentTypes: ConfigLookup[];
  agentOptions: ConfigLookup[];
  packingFormats: ConfigLookup[];
  commercialFormats: ConfigLookup[];
  vendors: PickerItem[];
  receivableTerms: PickerItem[];
  ports: PickerItem[];
  destinations: PickerItem[];
  couriers: PickerItem[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>("identity");
  const [dirty, setDirty] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const applicantById = useMemo(() => {
    const m = new Map<string, Applicant>();
    for (const a of applicants) m.set(a.id, a);
    return m;
  }, [applicants]);
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

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setContacts([blankContact(newKey())]);
    setApplicantIds([]);
    setAgents([]);
    setSewing([]);
    setPacking([]);
    setNominated([]);
    setRecommended([]);
    setMarkings([]);
    setSection("identity");
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: Customer) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
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
    setSection("identity");
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
        code: form.code.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
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
      form.fax ||
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

  const initials = (form.code || form.name || "?").slice(0, 2).toUpperCase();

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

      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No customers yet." />
      </div>

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
                <StatusPill tone={r.is_draft ? "warning" : r.inactive ? "danger" : "success"}>
                  {r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      {/* ================= full-screen editor ================= */}
      {open && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-background">
          {/* topbar */}
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5">
            <div className="text-xs text-muted-foreground">
              {editId ? "Editing" : "New"}{" "}
              <span className="font-semibold text-foreground">{form.name.trim() || "customer"}</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* record header (sticky identity band) */}
          <div className="grid gap-3 border-b border-border bg-surface px-4 py-3 md:grid-cols-[1fr_auto] md:items-center md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-base font-bold text-primary">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[15px] font-bold tracking-tight text-foreground">
                    {form.name.trim() || "Untitled customer"}
                  </span>
                  {form.inactive && <StatusPill tone="danger">Inactive</StatusPill>}
                  {dirty && <span className="text-[11px] font-medium text-warning">● Unsaved</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
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
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 md:items-end">
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
                        ✕
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
            </div>
          </div>

          {/* body: rail + content */}
          <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[228px_1fr]">
            <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface-muted p-2 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3">
              <span className="hidden px-2 pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground md:block">
                Sections
              </span>
              {SECTIONS.map((s) => {
                const active = section === s.key;
                const Icon = s.icon;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSection(s.key)}
                    aria-current={active}
                    className={cn(
                      "flex shrink-0 items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-[13.5px] transition-colors md:w-full",
                      active
                        ? "border-border bg-surface font-semibold text-foreground shadow-sm"
                        : "border-transparent text-muted-foreground hover:bg-surface hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="flex-1 truncate whitespace-nowrap">{s.label}</span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full border",
                        done[s.key] ? "border-accent bg-accent" : "border-border bg-transparent",
                      )}
                      aria-label={done[s.key] ? "has data" : "empty"}
                    />
                  </button>
                );
              })}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
                {/* ---------------- Identity ---------------- */}
                {section === "identity" && (
                  <SectionBody title="Identity" hint="Who this customer is and how their documents are numbered.">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="cu-code">Short Name</Label>
                        <Input id="cu-code" value={form.code} onChange={(e) => set({ code: e.target.value })} className="text-base md:text-sm" />
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 sm:pt-6">
                        <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.inactive} onChange={(e) => set({ inactive: e.target.checked })} />
                        <span className="text-sm text-foreground">Inactive</span>
                      </label>
                      <div className="sm:col-span-2">
                        <Label htmlFor="cu-name">Name <span className="text-danger">*</span></Label>
                        <Input id="cu-name" value={form.name} onChange={(e) => set({ name: e.target.value })} required className="text-base md:text-sm" />
                      </div>
                      <div>
                        <Label htmlFor="cu-prefix">Doc Prefix</Label>
                        <Input id="cu-prefix" value={form.doc_prefix} onChange={(e) => set({ doc_prefix: e.target.value })} className="text-base md:text-sm" />
                      </div>
                      <div>
                        <Label htmlFor="cu-docid">ID</Label>
                        <Input id="cu-docid" value={form.doc_id} onChange={(e) => set({ doc_id: e.target.value })} className="text-base md:text-sm" />
                      </div>
                      <div>
                        <Label htmlFor="cu-alsocons">Also Consignee</Label>
                        <Select id="cu-alsocons" value={form.also_consignee ? "yes" : "no"} onChange={(e) => set({ also_consignee: e.target.value === "yes" })} className="text-base md:text-sm">
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </Select>
                      </div>
                      <div>
                        <CountryPicker countries={countries} value={form.country_id || null} onChange={(id) => set({ country_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} />
                      </div>
                    </div>
                  </SectionBody>
                )}

                {/* ---------------- Address ---------------- */}
                {section === "address" && (
                  <SectionBody title="Address" hint="Primary correspondence address for this customer.">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label htmlFor="cu-street">Street</Label>
                        <Textarea id="cu-street" rows={3} value={form.street} onChange={(e) => set({ street: e.target.value })} className="text-base md:text-sm" />
                      </div>
                      <LookupDialogPicker kind="city" label="City" options={cities} value={form.city_id || null} onChange={(id) => set({ city_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} />
                      <LookupDialogPicker kind="state" label="State" options={states} value={form.state_id || null} onChange={(id) => set({ state_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} />
                      <div>
                        <Label htmlFor="cu-pin">Pin</Label>
                        <Input id="cu-pin" value={form.pin} onChange={(e) => set({ pin: e.target.value })} className="text-base md:text-sm" />
                      </div>
                      <div>
                        <CountryPicker countries={countries} value={form.address_country_id || null} onChange={(id) => set({ address_country_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} />
                      </div>
                      <div>
                        <Label htmlFor="cu-landline">Land Line</Label>
                        <Input id="cu-landline" value={form.land_line} onChange={(e) => set({ land_line: e.target.value })} className="text-base md:text-sm" />
                      </div>
                      <div>
                        <Label htmlFor="cu-fax">Fax</Label>
                        <Input id="cu-fax" value={form.fax} onChange={(e) => set({ fax: e.target.value })} className="text-base md:text-sm" />
                      </div>
                      <div>
                        <Label htmlFor="cu-email">E-Mail</Label>
                        <ValidatedInput format="email" id="cu-email" value={form.email} onChange={(e) => set({ email: e.target.value })} className="text-base md:text-sm" />
                      </div>
                      <div>
                        <Label htmlFor="cu-web">Web site</Label>
                        <ValidatedInput format="website" id="cu-web" value={form.web_site} onChange={(e) => set({ web_site: e.target.value })} className="text-base md:text-sm" />
                      </div>
                    </div>

                    {/* contacts */}
                    <div className="mt-6">
                      <ChildGrid<ContactRow>
                        label="Contacts"
                        rows={contacts}
                        onAdd={addContact}
                        onRemove={(c) => removeContact(c.key)}
                        addLabel="+ Add contact"
                        columns={[
                          {
                            header: "Department",
                            className: "min-w-[160px]",
                            cell: (c) => (
                              <LookupDialogPicker kind="department" label="Department" options={departments} value={c.department_id || null} onChange={(id) => setContactAt(c.key, { department_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                            ),
                          },
                          {
                            header: "Contact Name",
                            className: "min-w-[130px]",
                            cell: (c) => <Input value={c.contact_name} onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })} className="h-8 text-sm" />,
                          },
                          {
                            header: "Designation",
                            className: "min-w-[160px]",
                            cell: (c) => (
                              <LookupDialogPicker kind="designation" label="Designation" options={designations} value={c.designation_id || null} onChange={(id) => setContactAt(c.key, { designation_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
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
                              <LookupDialogPicker kind="department" label="Department" options={departments} value={c.department_id || null} onChange={(id) => setContactAt(c.key, { department_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                            </div>
                            <Input placeholder="Contact Name" value={c.contact_name} onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })} className="text-base md:text-sm" />
                            <div>
                              <Label>Designation</Label>
                              <LookupDialogPicker kind="designation" label="Designation" options={designations} value={c.designation_id || null} onChange={(id) => setContactAt(c.key, { designation_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
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
                )}

                {/* ---------------- Agents ---------------- */}
                {section === "agents" && (
                  <SectionBody title="Agents" hint="Brokers / agents who represent this customer.">
                    <ChildGrid<AgentRow>
                      label="Customer Agents"
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
                )}

                {/* ---------------- Supplied Items ---------------- */}
                {section === "supplied" && (
                  <SectionBody title="Supplied Items" hint="Categories the customer supplies (free-issue), by accessory group.">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <CategoryGrid title="Sewing Accessories" rows={sewing} setRows={setSewing} categories={categories} perms={perms} newKey={newKey} setDirty={setDirty} />
                      <CategoryGrid title="Packaging Accessories" rows={packing} setRows={setPacking} categories={categories} perms={perms} newKey={newKey} setDirty={setDirty} />
                    </div>
                  </SectionBody>
                )}

                {/* ---------------- Nominated Vendors ---------------- */}
                {section === "vendors" && (
                  <SectionBody title="Nominated Vendors" hint="Vendors this customer nominates or recommends for sourcing.">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <VendorGrid title="Nominated Vendor" rows={nominated} setRows={setNominated} vendors={vendors} newKey={newKey} setDirty={setDirty} />
                      <VendorGrid title="Recommended Vendor" rows={recommended} setRows={setRecommended} vendors={vendors} newKey={newKey} setDirty={setDirty} />
                    </div>
                  </SectionBody>
                )}

                {/* ---------------- General ---------------- */}
                {section === "general" && (
                  <SectionBody title="General" hint="Trade defaults, shipping, formats and export marking for this customer.">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <Label>Currency 1</Label>
                        <CurrencyPicker label="Currency 1" currencies={currencies} value={form.currency_1 || null} onChange={(code) => set({ currency_1: code })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </div>
                      <div>
                        <Label htmlFor="cu-shipmode">Ship Mode</Label>
                        <Select id="cu-shipmode" value={form.ship_mode} onChange={(e) => set({ ship_mode: e.target.value })} className="text-base md:text-sm">
                          <option value="">—</option>
                          {SHIP_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Currency 2</Label>
                        <CurrencyPicker label="Currency 2" currencies={currencies} value={form.currency_2 || null} onChange={(code) => set({ currency_2: code })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </div>
                      <div>
                        <Label htmlFor="cu-shiptype">Ship Type</Label>
                        <Select id="cu-shiptype" value={form.ship_type_id} onChange={(e) => set({ ship_type_id: e.target.value })} className="text-base md:text-sm">
                          <option value="">—</option>
                          {shipTypes.map((t) => <option key={t.id} value={t.id}>{t.code ? `${t.code} — ${t.name}` : t.name}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Currency 3</Label>
                        <CurrencyPicker label="Currency 3" currencies={currencies} value={form.currency_3 || null} onChange={(code) => set({ currency_3: code })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </div>
                      <div>
                        <Label htmlFor="cu-paymode">Pay Mode</Label>
                        <Select id="cu-paymode" value={form.pay_mode} onChange={(e) => set({ pay_mode: e.target.value })} className="text-base md:text-sm">
                          <option value="">—</option>
                          {PAY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Receivable Terms</Label>
                        <RecordPicker label="Receivable Term" items={receivableTerms} value={form.receivable_term_id || null} onChange={(id) => set({ receivable_term_id: id ?? "" })} compact />
                      </div>
                      <div>
                        <Label>Pref. Courier</Label>
                        <RecordPicker label="Courier" items={couriers} value={form.pref_courier_id || null} onChange={(id) => set({ pref_courier_id: id ?? "" })} compact />
                      </div>
                      <div>
                        <Label>Port of Loading</Label>
                        <RecordPicker label="Port" items={ports} value={form.port_of_loading_id || null} onChange={(id) => set({ port_of_loading_id: id ?? "" })} compact />
                      </div>
                      <div>
                        <Label>Port of Discharge</Label>
                        <RecordPicker label="Port" items={ports} value={form.port_of_discharge_id || null} onChange={(id) => set({ port_of_discharge_id: id ?? "" })} compact />
                      </div>
                      <div>
                        <Label>Final Destination</Label>
                        <RecordPicker label="Destination" items={destinations} value={form.final_destination_id || null} onChange={(id) => set({ final_destination_id: id ?? "" })} compact />
                      </div>
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <Label>Packing List Format</Label>
                          <LookupDialogPicker kind="packing_list_format" label="Packing List Format" options={packingFormats} value={form.packing_list_format_id || null} onChange={(id) => set({ packing_list_format_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                        </div>
                        <Button type="button" variant="outline" size="md" disabled title="Column configuration — coming soon">Columns</Button>
                      </div>
                      <div>
                        <Label>Commercial Invoice Format</Label>
                        <LookupDialogPicker kind="commercial_invoice_format" label="Commercial Invoice Format" options={commercialFormats} value={form.commercial_invoice_format_id || null} onChange={(id) => set({ commercial_invoice_format_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </div>
                      <div>
                        <Label htmlFor="cu-colorspec">Color Specification Applicable</Label>
                        <Select id="cu-colorspec" value={form.color_spec_applicable ? "yes" : "no"} onChange={(e) => set({ color_spec_applicable: e.target.value === "yes" })} className="text-base md:text-sm">
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="cu-tcs">TCS</Label>
                        <Select id="cu-tcs" value={form.tcs_applicable ? "yes" : "no"} onChange={(e) => set({ tcs_applicable: e.target.value === "yes" })} className="text-base md:text-sm">
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </Select>
                      </div>
                      <div className="sm:col-span-2">
                        <Label htmlFor="cu-gst">GST No</Label>
                        <Input id="cu-gst" value={form.gst_no} onChange={(e) => set({ gst_no: e.target.value })} className="text-base md:text-sm" />
                      </div>
                    </div>

                    {/* Marking grid */}
                    <div className="mt-6">
                      <ChildGrid<MarkRow>
                        label="Marking"
                        rows={markings}
                        onAdd={() => { setMarkings((xs) => [...xs, { key: newKey(), marking: "" }]); setDirty(true); }}
                        onRemove={(m) => { setMarkings((xs) => xs.filter((r) => r.key !== m.key)); setDirty(true); }}
                        addLabel="+ Add marking"
                        columns={[
                          {
                            header: "Marking",
                            cell: (m) => (
                              <Input value={m.marking} onChange={(e) => { setMarkings((xs) => xs.map((r) => (r.key === m.key ? { ...r, marking: e.target.value } : r))); setDirty(true); }} className="text-base md:text-sm" placeholder="Marking text" />
                            ),
                          },
                        ]}
                      />
                    </div>
                  </SectionBody>
                )}
              </div>
            </div>
          </div>

          {/* sticky footer */}
          <div className="flex items-center gap-2 border-t border-border bg-surface px-4 py-3 md:px-6">
            <span className="text-xs text-muted-foreground">
              {dirty ? "Unsaved changes" : editId ? "All changes saved" : "New customer"}
            </span>
            <div className="flex-1" />
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            {perms.canCreate && (
              <Button variant="outline" size="md" disabled={isPending || !form.name.trim()} onClick={() => submit(true)}>Save as Draft</Button>
            )}
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={() => submit(false)}>
              {isPending ? "Saving…" : "Save customer"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A titled content block inside the editor's content pane. */
function SectionBody({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[15px] font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mb-4 mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>
      {children}
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
  return (
    <ChildGrid<CatRowT>
      label={title}
      rows={rows}
      onAdd={() => { setRows((xs) => [...xs, { key: newKey(), category_id: "" }]); setDirty(true); }}
      onRemove={(r) => { setRows((xs) => xs.filter((x) => x.key !== r.key)); setDirty(true); }}
      addLabel="+ Add category"
      columns={[
        {
          header: "Category",
          cell: (r) => (
            <LookupDialogPicker kind="material_category" label="Category" options={categories} value={r.category_id || null} onChange={(id) => { setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, category_id: id } : x))); setDirty(true); }} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
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
  return (
    <ChildGrid<VendorRowT>
      label={title}
      rows={rows}
      onAdd={() => { setRows((xs) => [...xs, { key: newKey(), vendor_id: "" }]); setDirty(true); }}
      onRemove={(r) => { setRows((xs) => xs.filter((x) => x.key !== r.key)); setDirty(true); }}
      addLabel="+ Add vendor"
      columns={[
        {
          header: "Vendor",
          cell: (r) => (
            <RecordPicker label="Vendor" items={vendors} value={r.vendor_id || null} onChange={(id) => { setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, vendor_id: id ?? "" } : x))); setDirty(true); }} compact />
          ),
        },
      ]}
    />
  );
}
