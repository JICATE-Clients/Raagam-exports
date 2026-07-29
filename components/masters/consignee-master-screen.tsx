"use client";

import { TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { gridKeyNav } from "@/components/masters/child-grid";
import { MobileWhatsAppFields, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
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
import { GstinInsight, type GstinSuggestion } from "@/components/masters/gstin-insight";
import { createConsignee, updateConsignee, deleteConsignee } from "@/lib/masters/consignee-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import { decodeGstin, normalizeGstin } from "@/lib/validation/gstin";
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

// Alternate spellings a hand-typed State master row might carry, keyed by GST
// state code. Only consulted when the row has no `code` to match on. Twin of the
// map in vendor-master-screen.tsx — kept local rather than shared because it is
// a stop-gap for unseeded State rows, not a contract.
const STATE_ALIASES: Record<string, string[]> = {
  "05": ["Uttaranchal"],
  "07": ["NCT of Delhi", "New Delhi"],
  "21": ["Orissa"],
};

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
 *   header    name 4 + country 3 + customer 3 + also_notify 2                = 12
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
const FIELD_SIZE = {
  // header — always visible, above the tabs
  name: "md",
  country_id: "sm",
  customer_id: "sm",
  also_notify: "xs",
  // Address tab
  street: "full", // textarea
  city_id: "sm",
  state_id: "sm",
  pin: "xs", // 6 digits
  address_country_id: "md",
  land_line: "sm",
  email: "lg",
  web_site: "lg",
  // General tab
  currency: "xs", // 3-letter ISO code
  ship_mode: "sm",
  ship_type_id: "sm",
  pay_mode: "sm",
  payment_term_id: "sm",
  bank_id: "sm",
  ac_no: "sm",
  // Registration card
  tin_no: "sm",
  tin_no_2: "sm",
  pan_no: "sm", // 10 chars
  gst_no: "sm", // 15 chars
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

  // ---------------------------------------------------------------- GSTIN ----
  // Everything below is decoded from the GST number itself — no lookup, no
  // network. See lib/validation/gstin.ts for what the 15 characters carry.

  const gstin = useMemo(
    () => decodeGstin(form.gst_no, { companyGstin }),
    [form.gst_no, companyGstin],
  );

  // Read the current PAN without making it an effect dependency (see below).
  const panRef = useRef(form.pan_no);
  panRef.current = form.pan_no;

  /**
   * The GSTIN as loaded, so merely OPENING a record never auto-fills — that
   * would mark a freshly-opened form dirty and trip the unsaved-work guard.
   * Only a GSTIN the user actually changed feeds the auto-fill.
   */
  const loadedGstin = useRef("");

  // The State row this GSTIN points at. `states.code` IS the GST state code, so
  // that is the primary match; the name/alias ladder is a fallback because the
  // table ships unseeded and rows get hand-typed.
  const gstinState = useMemo(() => {
    if (!gstin) return null;
    const byCode = states.find(
      (s) => (s.code ?? "").trim().padStart(2, "0") === gstin.stateCode,
    );
    if (byCode) return byCode;
    if (!gstin.stateName) return null;
    const norm = (v: string) => v.toUpperCase().replace(/[^A-Z]/g, "");
    const wanted = new Set(
      [gstin.stateName, ...(STATE_ALIASES[gstin.stateCode] ?? [])].map(norm),
    );
    return states.find((s) => wanted.has(norm(s.name))) ?? null;
  }, [gstin, states]);

  // A GSTIN can only belong to an Indian registration, so the country it implies
  // is never in doubt — but it is still offered, never written (see below).
  const indCountryId = useMemo(
    () => countries.find((c) => (c.code ?? "").toUpperCase() === "IND")?.id ?? "",
    [countries],
  );

  // PAN is characters 3-12 of the GSTIN, so filling an EMPTY PAN box cannot
  // lose information. A PAN that is already typed is never overwritten — a
  // disagreement is real signal, surfaced as a mismatch line instead.
  useEffect(() => {
    if (!gstin?.checksumValid) return;
    if (gstin.gstin === loadedGstin.current) return;
    if (panRef.current.trim()) return;
    set({ pan_no: gstin.pan });
    // Deliberately NOT depending on form.pan_no: that would re-run on every PAN
    // keystroke and silently re-fill a field the user had just cleared.
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

    if (gstinState && !form.state_id) {
      out.push({
        key: "state",
        label: `Set State = ${gstinState.name}`,
        onApply: () => {
          set({ state_id: gstinState.id });
          // Toasted because the State box lives on the Address tab, which the
          // user is not looking at while typing the GST number on General.
          success(`State set to ${gstinState.name} on the Address tab`);
        },
      });
    }

    if (indCountryId && !form.address_country_id) {
      out.push({
        key: "country",
        label: "Set Country = India",
        onApply: () => {
          set({ address_country_id: indCountryId });
          success("Address country set to India");
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
    setForm(BLANK);
    loadedGstin.current = "";
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
    });
    // Baseline for the PAN auto-fill: opening a record must never write to it.
    loadedGstin.current = normalizeGstin(r.gst_no);
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
          {/* ---- Header (shown across all tabs) ----
              Four controls, one flush row. Every label is `Field`'s, so the
              pickers are all `compact`: CountryPicker and CustomerPicker render
              their OWN <Label> otherwise, and this screen used to mix the two
              idioms — Country self-labelled while Customer was wrapped, so the
              two labels sat at different offsets. */}
          <FieldGrid>
            <Field label="Name" required size={FIELD_SIZE.name} htmlFor="cn-name">
              <Input
                id="cn-name"
                uppercase
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                required
              />
            </Field>
            {/* No `required` marker, unlike the asterisk CountryPicker prints
                for itself: `country_id` is nullable in consigneeInput and Save
                is gated on the name alone, so the marker was never true here. */}
            <Field label="Country" size={FIELD_SIZE.country_id}>
              <CountryPicker
                countries={countries}
                value={form.country_id || null}
                onChange={(id) => set({ country_id: id })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
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
          {/* Outside the track on purpose: a bare checkbox has no label above it,
              so as a grid cell it would line up with its neighbours' LABELS
              rather than their controls. */}
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
              {/* Four rows of the 12-col track: the street block, then the
                  address line (City · State · Pin · Country) the way it is
                  printed, then the phones, then the online channels. Street is
                  `full` — it was `sm:col-span-2`, which on this track would mean
                  one SIXTH, not full width (LAYOUT.md §2). */}
              <FieldGrid>
                <Field label="Street" size={FIELD_SIZE.street} htmlFor="cn-street">
                  <Textarea
                    id="cn-street"
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
                <Field label="Pin" size={FIELD_SIZE.pin} htmlFor="cn-pin">
                  <Input
                    id="cn-pin"
                    value={form.pin}
                    onChange={(e) => set({ pin: e.target.value })}
                  />
                </Field>
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
                  {/* row area capped — a growing grid scrolls instead of pushing
                      the content below (Add button stays pinned) */}
                  <div data-grid-body onKeyDown={(e) => gridKeyNav(e, addContact)} className="max-h-56 space-y-3 overflow-y-auto">
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
          )}

          {section === "general" && (
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
                    label=""
                    currencies={currencies}
                    value={form.currency_1 || null}
                    onChange={(code) => set({ currency_1: code })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                  />
                </Field>
                <Field label="Currency 2" size={FIELD_SIZE.currency}>
                  <CurrencyPicker
                    label=""
                    currencies={currencies}
                    value={form.currency_2 || null}
                    onChange={(code) => set({ currency_2: code })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                  />
                </Field>
                <Field label="Currency 3" size={FIELD_SIZE.currency}>
                  <CurrencyPicker
                    label=""
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
                {/* `label=""` on every picker below: they print their own <Label>
                    otherwise, and the one from <Field> is the one that carries
                    htmlFor and lines its required marker up with the row. */}
                <Field label="Ship Type" size={FIELD_SIZE.ship_type_id}>
                  <LookupDialogPicker
                    kind="ship_type"
                    label=""
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
                  <LookupDialogPicker
                    kind="payment_term"
                    label=""
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
                <Field label="A/c No." size={FIELD_SIZE.ac_no} htmlFor="cn-acno">
                  <Input
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
                  {/* row area capped (Add stays pinned) */}
                  <div className="max-h-56 space-y-2 overflow-y-auto">
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
                      <Input value={form.tin_no} onChange={(e) => set({ tin_no: e.target.value })} />
                    </Field>
                    <Field label="CST No." size={FIELD_SIZE.tin_no_2}>
                      <Input value={form.tin_no_2} onChange={(e) => set({ tin_no_2: e.target.value })} />
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
                {/* row area capped (Add stays pinned) */}
                <div data-grid-body onKeyDown={(e) => gridKeyNav(e, addNotifyRef)} className="max-h-56 space-y-3 overflow-y-auto">
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
          )}
        </div>
      </Sheet>
    </div>
  );
}
