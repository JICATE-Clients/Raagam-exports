"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Eye, User, MapPin, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { MobileField, WhatsAppField, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Select } from "@/components/ui/select";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid } from "@/components/masters/section-grid";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { AccountGroupPicker } from "@/components/masters/account-group-picker";
import { GstinInsight, type GstinSuggestion } from "@/components/masters/gstin-insight";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { decodeGstin, normalizeGstin } from "@/lib/validation/gstin";
import { effectiveWhatsApp } from "@/lib/validation/contact";
import { createVendor, updateVendor, deleteVendor } from "@/lib/masters/vendor-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  VENDOR_TYPES,
  VENDOR_STATUSES,
  GST_REG_STATUSES,
  type Vendor,
  type VendorInput,
  type VendorStatus,
  type VendorType,
  type GstRegStatus,
} from "@/lib/masters/vendor-types";
import type { Country } from "@/lib/masters/country-types";
import type { AccountGroup } from "@/lib/masters/account-group-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type SectionKey = "identity" | "address" | "other";
const SECTIONS: { key: SectionKey; label: string; icon: LucideIcon; built: boolean }[] = [
  { key: "identity", label: "Identity", icon: User, built: true },
  { key: "address", label: "Address", icon: MapPin, built: true },
  { key: "other", label: "Other Details", icon: SlidersHorizontal, built: true },
];

// The four legacy "Category" checkbox flags, in form order.
const CATEGORY_FLAGS = [
  { key: "is_bought_items_vendor", label: "Is Bought Items Vendor" },
  { key: "is_processor", label: "Is Processor" },
  { key: "is_service_provider", label: "Is Service Provider" },
  { key: "is_sub_contractor", label: "Is Sub Contractor" },
] as const;
type CategoryKey = (typeof CATEGORY_FLAGS)[number]["key"];

/**
 * How wide each field is on the 12-column track (LAYOUT.md §3).
 *
 * `sm` (3 of 12 — four per row) is the working default; a field leaves it only
 * when its DATA says so. Nearly everything this screen holds is a fixed-width
 * identifier — a 15-character GSTIN, a 10-character PAN, an 11-character IFSC,
 * a 6-digit PIN — and those sat two to a row in a hand-rolled `sm:grid-cols-2`
 * until now (client 2026-07-29: four fields per row).
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12 — a row past 12 does not shrink, its last
 * field wraps onto a line of its own with the rest of that line left empty, and
 * nothing in the build catches it. Per-row arithmetic is written above each
 * block below; this map is the single place the numbers live.
 *
 * A `<Field>` with no size takes `md` by default. That default is why this
 * screen was `md`-dominant, so every entry below is deliberate, including the
 * ones that agree with it.
 */
/**
 * ONE SIZE, EVERY FIELD: `sm` = 3 of 12 = four per row (client 2026-07-29). The
 * client picked the City / State / Pin / Country row out as the correct shape
 * and asked for the rest of the masters to match it, so Name, Web site and
 * Email ID gave up the 6 they were sized to. The only survivors at `full` are
 * the two things that are NOT fields — the GSTIN fact strip stands alone by
 * nature. See applicant-master-screen for the rule and what it trades away.
 */
const FIELD_SIZE = {
  // ---- Identity ----
  name: "sm", // 3 — "SREE LAKSHMI TEXTILE PROCESSORS PVT LTD" scrolls in the box
  vendor_type: "sm", // 3 — With in State · Other State · Foreign Vendor
  status: "sm", // 3 — longest is "Under Evaluation"
  country_id: "sm", // 3 — a picked country name
  group_id: "sm", // 3 — a picked vendor group
  inactive: "sm", // 3 — a tick box, room for its own caption
  category_flag: "sm", // 3 — ×4 = one flush row of the Category checkboxes
  // ---- Registration ----
  tin_no: "sm", // 3 — 11 digits
  pan_no: "sm", // 3 — exactly 10 characters
  reg_caption: "sm", // 3 — a short caption, not a sentence
  reg_no_dt: "sm", // 3 — a registration number and date
  web_site: "sm", // 3 — a URL; it scrolls inside the box (see the note above)
  // ---- Other Details · Banking ----
  bank_name: "sm", // 3 — "STATE BANK OF INDIA"
  branch: "sm", // 3 — "PEELAMEDU"
  ac_no: "sm", // 3 — a fixed-width identifier
  ifsc_code: "sm", // 3 — exactly 11 characters
  ac_type: "sm", // 3 — SB / CA / CC
  // ---- Other Details · GST + ledger groups ----
  gst_reg_status: "sm", // 3 — Registered · Unregistered · Composite
  gst_no: "sm", // 3 — exactly 15 characters
  debit_group_id: "sm", // 3 — a picked account group
  credit_group_id: "sm", // 3 — a picked account group
  gstin_strip: "full", // 12 — a fact strip stands alone (LAYOUT.md §3)
  // ---- Other Details · Additional ----
  enterprise_status: "sm", // 3 — MSME / Small / Medium
  memorandum_no: "sm", // 3 — a reference number
  inhouse_unit_id: "sm", // 3 — a unit code
  duty_against: "sm", // 3 — a short code
  // ---- Address child rows ----
  address_type: "sm", // 3 — Office · Works · Billing
  street: "sm", // 3 — a wider Street was declined (client 2026-07-29); the
  //                    box still scrolls past the ~34 characters it shows
  city_id: "sm", // 3 — a picked city
  state_id: "sm", // 3 — a picked state
  address_country_id: "sm", // 3 — a picked country
  pin: "sm", // 3 — 6 digits
  land_line: "sm", // 3 — a phone number
  mobile: "sm", // 3 — a phone number
  whatsapp: "sm", // 3 — beside its mobile, same as bank-master-screen
  email_id: "sm", // 3 — accounts@sreelakshmitextiles.co.in scrolls in the box
} satisfies Record<string, FieldSize>;

// Alternate spellings a hand-typed State master row might carry, keyed by GST
// state code. Only consulted when the row has no `code` to match on.
const STATE_ALIASES: Record<string, string[]> = {
  "05": ["Uttaranchal"],
  "07": ["NCT of Delhi", "New Delhi"],
  "21": ["Orissa"],
  "26": ["Dadra & Nagar Haveli", "Daman & Diu"],
  "33": ["Tamilnadu"],
  "34": ["Pondicherry"],
  "35": ["Andaman and Nicobar", "Andamans"],
};

type HeaderForm = {
  code: string;
  name: string;
  inactive: boolean;
  vendor_type: "" | VendorType;
  country_id: string;
  group_id: string;
  status: VendorStatus;
  is_bought_items_vendor: boolean;
  is_processor: boolean;
  is_service_provider: boolean;
  is_sub_contractor: boolean;
  tin_no: string;
  reg_caption: string;
  reg_no_dt: string;
  pan_no: string;
  web_site: string;
  // Other Details
  bank_name: string;
  branch: string;
  ac_no: string;
  ifsc_code: string;
  ac_type: string;
  gst_reg_status: "" | GstRegStatus;
  gst_no: string;
  debit_group_id: string;
  credit_group_id: string;
  enterprise_status: string;
  memorandum_no: string;
  inhouse_unit_id: string;
  duty_against: string;
};
const BLANK: HeaderForm = {
  code: "",
  name: "",
  inactive: false,
  vendor_type: "",
  country_id: "",
  group_id: "",
  status: "Approved",
  is_bought_items_vendor: false,
  is_processor: false,
  is_service_provider: false,
  is_sub_contractor: false,
  tin_no: "",
  reg_caption: "",
  reg_no_dt: "",
  pan_no: "",
  web_site: "",
  bank_name: "",
  branch: "",
  ac_no: "",
  ifsc_code: "",
  ac_type: "",
  gst_reg_status: "",
  gst_no: "",
  debit_group_id: "",
  credit_group_id: "",
  enterprise_status: "",
  memorandum_no: "",
  inhouse_unit_id: "",
  duty_against: "",
};

type AddressRow = {
  key: string;
  address_type: string;
  street: string;
  city_id: string;
  state_id: string;
  country_id: string;
  pin: string;
  land_line: string;
  mobile: string;
  /** null = "same as mobile" (tick on). "" = tick off, nothing typed yet. */
  whatsapp: string | null;
  email_id: string;
};
const blankAddress = (key: string, country_id = ""): AddressRow => ({
  key,
  address_type: "",
  street: "",
  city_id: "",
  state_id: "",
  country_id,
  pin: "",
  land_line: "",
  mobile: "",
  whatsapp: null,
  email_id: "",
});
/**
 * One stored address, written the way an address is written, for the read-only
 * view. Ten label→value rows per address — and a vendor routinely carries three
 * — is a database dump of the one block on this record every reader can already
 * parse at a glance, so the locality lines run together and the contact
 * channels sit under them.
 *
 * Takes resolved NAMES, not ids: city, state and country are uuids on the row
 * and the caller owns the lookup maps.
 */
function AddressCard({
  title,
  street,
  city,
  state,
  country,
  pin,
  landLine,
  mobile,
  whatsapp,
  email,
}: {
  title: string;
  street: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pin: string | null;
  landLine: string | null;
  mobile: string | null;
  whatsapp: string | null;
  email: string | null;
}) {
  const locality = [city, state, country, pin].map((v) => v?.trim()).filter(Boolean);
  const contact = [
    landLine?.trim() ? `Phone ${landLine.trim()}` : null,
    mobile?.trim() ? `Mobile ${mobile.trim()}` : null,
    // Only when it differs — effectiveWhatsApp() falls back to the mobile, and
    // printing the same number twice reads as two numbers.
    whatsapp?.trim() && whatsapp.trim() !== mobile?.trim() ? `WhatsApp ${whatsapp.trim()}` : null,
    email?.trim(),
  ].filter(Boolean);
  return (
    <div className="text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <address className="mt-1 not-italic text-foreground">
        {street?.trim() && <div>{street.trim()}</div>}
        {locality.length > 0 && <div>{locality.join(", ")}</div>}
      </address>
      {contact.length > 0 && <p className="mt-1 text-muted-foreground">{contact.join(" · ")}</p>}
    </div>
  );
}

const addressHasData = (a: AddressRow) =>
  !!(
    a.address_type.trim() ||
    a.street.trim() ||
    a.city_id ||
    a.state_id ||
    a.country_id ||
    a.pin.trim() ||
    a.land_line.trim() ||
    a.mobile.trim() ||
    a.whatsapp?.trim() ||
    a.email_id.trim()
  );

/**
 * Master-detail CRUD for the legacy "Vendor" master (Associates). Same workspace
 * editor as Customer: full-screen overlay with a sticky identity band + a left
 * section rail (Identity · Address · Other Details) + a scrollable pane + a
 * sticky save bar. Phase 1 builds Identity (+ registration footer) and the
 * Address grid; "Other Details" is a stub until its legacy screenshot arrives.
 */
export function VendorMasterScreen({
  rows,
  countries,
  cities,
  states,
  groups,
  accountGroups,
  companyGstin,
  perms,
}: {
  rows: Vendor[];
  countries: Country[];
  cities: ConfigLookup[];
  states: ConfigLookup[];
  groups: ConfigLookup[];
  accountGroups: AccountGroup[];
  /** Our own GSTIN, for within-state vs other-state classification. */
  companyGstin: string | null;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  /** The row being READ. Null = the view sheet is closed. */
  const [viewRow, setViewRow] = useState<Vendor | null>(null);
  const [dirty, setDirty] = useState(false);
  const isdOf = useIsdLookup(countries);

  // MasterFullScreen calls useModalGuard itself, so only the screen's own
  // unsaved state is declared here — it also feeds Escape's dirty confirm.
  useUnsavedGuard(dirty || isPending);

  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // Legacy defaults the header Country to IND.
  const indCountryId = useMemo(
    () => countries.find((c) => (c.code ?? "").toUpperCase() === "IND")?.id ?? "",
    [countries],
  );

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

  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);
  // The four the list columns never needed, built for the read-only view out of
  // the props this screen is already given — a uuid must never reach the page.
  const cityLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cities) m.set(c.id, c.name);
    return m;
  }, [cities]);
  const stateLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of states) m.set(s.id, s.name);
    return m;
  }, [states]);
  const groupLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) m.set(g.id, g.name);
    return m;
  }, [groups]);
  const acctGroupLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of accountGroups) m.set(g.id, g.name);
    return m;
  }, [accountGroups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.pan_no].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm({ ...BLANK, country_id: indCountryId });
    loadedGstin.current = "";
    setAddresses([blankAddress(newKey(), indCountryId)]);
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: Vendor) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      vendor_type: r.vendor_type ?? "",
      country_id: r.country_id ?? "",
      group_id: r.group_id ?? "",
      status: r.status,
      is_bought_items_vendor: r.is_bought_items_vendor,
      is_processor: r.is_processor,
      is_service_provider: r.is_service_provider,
      is_sub_contractor: r.is_sub_contractor,
      tin_no: r.tin_no ?? "",
      reg_caption: r.reg_caption ?? "",
      reg_no_dt: r.reg_no_dt ?? "",
      pan_no: r.pan_no ?? "",
      web_site: r.web_site ?? "",
      bank_name: r.bank_name ?? "",
      branch: r.branch ?? "",
      ac_no: r.ac_no ?? "",
      ifsc_code: r.ifsc_code ?? "",
      ac_type: r.ac_type ?? "",
      gst_reg_status: r.gst_reg_status ?? "",
      gst_no: r.gst_no ?? "",
      debit_group_id: r.debit_group_id ?? "",
      credit_group_id: r.credit_group_id ?? "",
      enterprise_status: r.enterprise_status ?? "",
      memorandum_no: r.memorandum_no ?? "",
      inhouse_unit_id: r.inhouse_unit_id ?? "",
      duty_against: r.duty_against ?? "",
    });
    loadedGstin.current = normalizeGstin(r.gst_no);
    setAddresses(
      r.addresses.map((a) => ({
        key: newKey(),
        address_type: a.address_type ?? "",
        street: a.street ?? "",
        city_id: a.city_id ?? "",
        state_id: a.state_id ?? "",
        country_id: a.country_id ?? "",
        pin: a.pin ?? "",
        land_line: a.land_line ?? "",
        mobile: a.mobile ?? "",
        // NOT `?? ""` — a stored NULL is the "same as mobile" state.
        whatsapp: a.whatsapp,
        email_id: a.email_id ?? "",
      })),
    );
    setDirty(false);
    setOpen(true);
  }

  function addAddress() {
    setAddresses((xs) => [...xs, blankAddress(newKey(), indCountryId)]);
    setDirty(true);
  }
  function setAddressAt(key: string, patch: Partial<AddressRow>) {
    setAddresses((xs) => xs.map((a) => (a.key === key ? { ...a, ...patch } : a)));
    setDirty(true);
  }
  function removeAddress(key: string) {
    setAddresses((xs) => xs.filter((a) => a.key !== key));
    setDirty(true);
  }

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

  // The State-master row this GSTIN points at. `public.states.code` IS the GST
  // state code, so that is the primary match; the name/alias ladder is a
  // fallback because the table ships unseeded and rows get hand-typed.
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

    if (gstin.supply !== "unknown") {
      const want: VendorType = gstin.supply === "intra" ? "With in State" : "Other State";
      if (form.vendor_type !== want) {
        // Never auto-written: vendor_type drives the server-side PIN rule
        // (Foreign Vendor skips it), so a silent flip would fail the save on a
        // child row the user never touched.
        out.push({ key: "type", label: `Set Type = ${want}`, onApply: () => set({ vendor_type: want }) });
      }
    }

    if (!form.gst_reg_status) {
      out.push({
        key: "reg",
        label: "Set GST Status = Registered",
        onApply: () => set({ gst_reg_status: "Registered" }),
      });
    }

    const first = addresses[0];
    if (gstinState && first && !first.state_id) {
      out.push({
        key: "state",
        label: `Set State = ${gstinState.name} on Address #1`,
        onApply: () => {
          setAddressAt(first.key, { state_id: gstinState.id });
          // Toasted because the change lands in a section the user isn't looking at.
          success(`State set to ${gstinState.name} on Address #1`);
        },
      });
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin, gstinState, form.pan_no, form.vendor_type, form.gst_reg_status, addresses]);

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: VendorInput = {
        // Create derives the code from the display name; edit keeps the
        // record's original stored code (held in state, never rendered).
        code: editId ? form.code.trim() || null : form.name.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
        vendor_type: form.vendor_type ? form.vendor_type : null,
        country_id: form.country_id || null,
        group_id: form.group_id || null,
        status: form.status,
        is_bought_items_vendor: form.is_bought_items_vendor,
        is_processor: form.is_processor,
        is_service_provider: form.is_service_provider,
        is_sub_contractor: form.is_sub_contractor,
        tin_no: form.tin_no.trim() || null,
        reg_caption: form.reg_caption.trim() || null,
        reg_no_dt: form.reg_no_dt.trim() || null,
        pan_no: form.pan_no.trim() || null,
        web_site: form.web_site.trim() || null,
        bank_name: form.bank_name.trim() || null,
        branch: form.branch.trim() || null,
        ac_no: form.ac_no.trim() || null,
        ifsc_code: form.ifsc_code.trim() || null,
        ac_type: form.ac_type.trim() || null,
        gst_reg_status: form.gst_reg_status ? form.gst_reg_status : null,
        gst_no: form.gst_no.trim() || null,
        debit_group_id: form.debit_group_id || null,
        credit_group_id: form.credit_group_id || null,
        enterprise_status: form.enterprise_status.trim() || null,
        memorandum_no: form.memorandum_no.trim() || null,
        inhouse_unit_id: form.inhouse_unit_id.trim() || null,
        duty_against: form.duty_against.trim() || null,
        is_draft: asDraft,
        addresses: addresses.map((a, i) => ({
          sno: i + 1,
          address_type: a.address_type || null,
          street: a.street || null,
          city_id: a.city_id || null,
          state_id: a.state_id || null,
          country_id: a.country_id || null,
          pin: a.pin || null,
          land_line: a.land_line || null,
          mobile: a.mobile || null,
          // "" collapses to null — an empty WhatsApp box means "same as mobile".
          whatsapp: a.whatsapp?.trim() || null,
          email_id: a.email_id || null,
        })),
      };
      const res = editId ? await updateVendor(editId, payload) : await createVendor(payload);
      if (res.ok) {
        success(editId ? "Vendor updated." : "Vendor added.");
        setDirty(false);
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Vendor) {
    startTransition(async () => {
      const res = await deleteVendor(r.id);
      if (res.ok) {
        success(deletedToast("Vendor", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const activeCategories = CATEGORY_FLAGS.filter((f) => form[f.key as CategoryKey]);

  // ---- completion state (drives the rail dots) ----
  const hasIdentity = !!form.name.trim();
  const hasAddress = addresses.some(addressHasData);
  const hasOther = !!(
    form.bank_name ||
    form.branch ||
    form.ac_no ||
    form.ifsc_code ||
    form.ac_type ||
    form.gst_reg_status ||
    form.gst_no ||
    form.debit_group_id ||
    form.credit_group_id ||
    form.enterprise_status ||
    form.memorandum_no ||
    form.inhouse_unit_id ||
    form.duty_against
  );
  const done: Record<SectionKey, boolean> = {
    identity: hasIdentity,
    address: hasAddress,
    other: hasOther,
  };

  const statusTone = (s: VendorStatus): "success" | "warning" | "danger" | "neutral" =>
    s === "Approved" ? "success" : s === "Hold" ? "warning" : s === "Terminated" ? "danger" : "neutral";

  /**
   * The record as a reader wants it, for `RecordViewSheet`. The sections follow
   * the editor's own cards, in its order — Identity · Registration · Address ·
   * Banking · GST & Ledger Groups · Additional Details — so the view and the
   * form tell the same story about where a field lives.
   *
   * Nothing is fetched: `rows` already carries all 28 header columns AND the
   * address children (the list only ever showed 4 of them). Empty values and
   * all-empty sections are dropped by the sheet, so a Foreign Vendor is not a
   * page of "—" where a domestic one has GST and IFSC.
   */
  function viewSections(r: Vendor): ViewSection[] {
    const categories = CATEGORY_FLAGS.filter((f) => r[f.key]).map((f) => f.label);
    const addresses = r.addresses;

    return [
      {
        label: "Identity",
        pairs: [
          ["Type", r.vendor_type],
          // The pill beside the title already says Draft / Inactive; on those
          // two it replaces the approval status rather than showing both, so
          // the status is spelled out here instead of being lost.
          ["Approval Status", r.is_draft || r.inactive ? r.status : null],
          ["Country", r.country_id ? countryLabel.get(r.country_id) : null],
          ["Group Name", r.group_id ? groupLabel.get(r.group_id) : null],
          // One line, not four Yes/No rows — the editor shows these as a strip
          // of chips for the same reason.
          ["Category", categories.join(" · ")],
        ],
      },
      {
        label: "Registration",
        pairs: [
          ["TIN No.", r.tin_no],
          ["PAN No", r.pan_no],
          ["Reg. Caption", r.reg_caption],
          ["Reg. No / Dt", r.reg_no_dt],
          ["Web site", r.web_site],
        ],
      },
      {
        label: "Address",
        content:
          addresses.length > 0 ? (
            <div className="space-y-3">
              {addresses.map((a, i) => (
                <AddressCard
                  key={a.id}
                  title={a.address_type?.trim() || `Address ${i + 1}`}
                  street={a.street}
                  city={a.city_id ? (cityLabel.get(a.city_id) ?? null) : null}
                  state={a.state_id ? (stateLabel.get(a.state_id) ?? null) : null}
                  country={a.country_id ? (countryLabel.get(a.country_id) ?? null) : null}
                  pin={a.pin}
                  landLine={a.land_line}
                  mobile={a.mobile}
                  // NEVER `a.whatsapp` — a stored NULL means "same as mobile",
                  // which is how ~90% of these rows are saved.
                  whatsapp={effectiveWhatsApp(a)}
                  email={a.email_id}
                />
              ))}
            </div>
          ) : undefined,
      },
      {
        label: "Banking",
        pairs: [
          ["Bank Name", r.bank_name],
          ["Branch", r.branch],
          ["A/c No", r.ac_no],
          ["IFSC Code", r.ifsc_code],
          ["A/c Type", r.ac_type],
        ],
      },
      {
        label: "GST & Ledger Groups",
        pairs: [
          ["GST Status", r.gst_reg_status],
          ["GST Number", r.gst_no],
          ["Debit Group", r.debit_group_id ? acctGroupLabel.get(r.debit_group_id) : null],
          ["Credit Group", r.credit_group_id ? acctGroupLabel.get(r.credit_group_id) : null],
        ],
      },
      {
        label: "Additional Details",
        pairs: [
          ["Enterprise Status", r.enterprise_status],
          ["Memorandum No", r.memorandum_no],
          ["Inhouse Unit ID", r.inhouse_unit_id],
          ["Duty Against", r.duty_against],
        ],
      },
    ];
  }

  const columns: Column<Vendor>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Type", cell: (r) => <span className="text-sm text-muted-foreground">{r.vendor_type ?? "—"}</span> },
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
      cell: (r) =>
        r.is_draft ? (
          <StatusPill tone="warning">Draft</StatusPill>
        ) : r.inactive ? (
          <StatusPill tone="danger">Inactive</StatusPill>
        ) : (
          <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {/* Look without editing — reading a vendor used to mean opening the
              editor and remembering not to touch anything. */}
          <Button variant="ghost" size="sm" aria-label={`View ${r.name}`} title="View" onClick={() => setViewRow(r)}>
            <Eye className="h-4 w-4" />
          </Button>
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

  // Section bodies, keyed the same as SECTIONS. Declared here rather than
  // inline in the `sections` prop so the prop stays legible.
  const SECTION_CONTENT: Record<SectionKey, ReactNode> = {
    identity: (
      <SectionBody title="Identity" hint="Who this vendor is, their category and registration details.">
        {/* The identity band — no card chrome, so `FieldGrid` rather than a
            `DetailSection`. It replaces a hand-rolled `sm:grid-cols-2`, which
            gave a three-word Type dropdown the same half-row box as the
            vendor's name and held every row to two fields.
              row 1  name 6 + vendor_type 3 + status 3            = 12
              row 2  country 3 + group 3 [+ inactive 3, edit only]
            Inactive sits LAST, not first, so row 1 looks the same in New as in
            Edit (same reasoning as bank-master-screen). */}
        <FieldGrid className="mb-3">
          <Field label="Name" size={FIELD_SIZE.name} required htmlFor="ve-name">
            <Input
              id="ve-name"
              uppercase
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
            />
          </Field>
          <Field label="Type" size={FIELD_SIZE.vendor_type} htmlFor="ve-type">
            <Select
              id="ve-type"
              value={form.vendor_type}
              onChange={(e) => set({ vendor_type: e.target.value as "" | VendorType })}
            >
              <option value="">— Select —</option>
              {VENDOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" size={FIELD_SIZE.status} htmlFor="ve-status">
            <Select
              id="ve-status"
              value={form.status}
              onChange={(e) => set({ status: e.target.value as VendorStatus })}
            >
              {VENDOR_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          {/* `compact` on the picker, label on the Field — without it the
              picker draws its own caption and the field reads "Country"
              twice. */}
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
          {/* This one labels itself, so the Field is an unlabelled cell that
              exists only to carry the span. */}
          <Field size={FIELD_SIZE.group_id}>
            <LookupDialogPicker
              kind="vendor_group"
              label="Group Name"
              options={groups}
              value={form.group_id || null}
              onChange={(id) => set({ group_id: id })}
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
        </FieldGrid>

        {/* Both blocks were hand-rolled cards (a bare `<Label>` over a
            `sm:grid-cols-2`, and a bordered div with an `<h3>`); they are
            real groups, so they become real `DetailSection`s and stop
            inventing their own borders and gaps. `span={2}` keeps each on a
            row of its own — the four Category captions do not fit in a
            half-width column. */}
        <SectionGrid>
          {/* Four flags, one row: 3+3+3+3 = 12. */}
          <DetailSection label="Category" cols={12} span={2}>
            {CATEGORY_FLAGS.map((f) => (
              <Field key={f.key} size={FIELD_SIZE.category_flag}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form[f.key as CategoryKey]}
                    onChange={(e) => set({ [f.key]: e.target.checked } as Partial<HeaderForm>)}
                  />
                  <span className="text-sm text-foreground">{f.label}</span>
                </label>
              </Field>
            ))}
          </DetailSection>

          {/* row 1  tin_no 3 + pan_no 3 + reg_caption 3 + reg_no_dt 3 = 12
              row 2  web_site 6 */}
          <DetailSection label="Registration" cols={12} span={2}>
            <Field label="TIN No." size={FIELD_SIZE.tin_no} htmlFor="ve-tin">
              <Input
                uppercase
                id="ve-tin"
                value={form.tin_no}
                onChange={(e) => set({ tin_no: e.target.value })}
              />
            </Field>
            <Field label="PAN No" size={FIELD_SIZE.pan_no} htmlFor="ve-pan">
              <ValidatedInput
                id="ve-pan"
                format="pan"
                value={form.pan_no}
                onChange={(e) => set({ pan_no: e.target.value })}
              />
            </Field>
            <Field label="Reg. Caption" size={FIELD_SIZE.reg_caption} htmlFor="ve-regcap">
              <Input
                uppercase
                id="ve-regcap"
                value={form.reg_caption}
                onChange={(e) => set({ reg_caption: e.target.value })}
              />
            </Field>
            <Field label="Reg. No / Dt" size={FIELD_SIZE.reg_no_dt} htmlFor="ve-regno">
              <Input
                uppercase
                id="ve-regno"
                value={form.reg_no_dt}
                onChange={(e) => set({ reg_no_dt: e.target.value })}
              />
            </Field>
            <Field label="Web site" size={FIELD_SIZE.web_site} htmlFor="ve-web">
              <ValidatedInput
                id="ve-web"
                format="website"
                value={form.web_site}
                onChange={(e) => set({ web_site: e.target.value })}
              />
            </Field>
          </DetailSection>
        </SectionGrid>
      </SectionBody>
    ),
    address: (
      <SectionBody title="Address" hint="One or more addresses for this vendor.">
        {/* Ten fields per address — past the ~5 a row can hold and past the 8 at
            which LAYOUT.md §6 says stop inlining, so a card per address with a
            FieldGrid inside. This replaces a hand-rolled `min-w-[1120px]` table
            AND a separate `md:hidden` card branch that duplicated all ten
            fields: two renderings to keep in step, which is exactly what
            ChildGrid exists to prevent. The fields were labelled by column
            header on desktop and by nothing at all on mobile; they carry real
            labels now. */}
        <ChildGrid<AddressRow>
          label="Address Detail"
          rows={addresses}
          onAdd={addAddress}
          onRemove={(a) => removeAddress(a.key)}
          addLabel="+ Add address"
          forceCards
          pageSize={3}
          // `forceCards` + `renderMobileRow` mean these never render; they are
          // the fallback if this grid is ever switched back to a table.
          columns={[
            { header: "Address Type", cell: (a) => a.address_type },
            { header: "Street", cell: (a) => a.street },
          ]}
          renderMobileRow={(a) => (
            /* row 1  address_type 3 + street 3 + city 3 + state 3   = 12
               row 2  country 3 + pin 3 + land_line 3 + mobile 3     = 12
               row 3  whatsapp 3 + email_id 6                        =  9 */
            <FieldGrid>
              <Field label="Address Type" size={FIELD_SIZE.address_type}>
                <Input
                  uppercase
                  value={a.address_type}
                  onChange={(e) => setAddressAt(a.key, { address_type: e.target.value })}
                />
              </Field>
              <Field label="Street" size={FIELD_SIZE.street}>
                <Input
                  uppercase
                  value={a.street}
                  onChange={(e) => setAddressAt(a.key, { street: e.target.value })}
                />
              </Field>
              {/* The three pickers render their own labels. */}
              <Field size={FIELD_SIZE.city_id}>
                <LookupDialogPicker
                  kind="city"
                  label="City"
                  options={cities}
                  value={a.city_id || null}
                  onChange={(id) => setAddressAt(a.key, { city_id: id })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </Field>
              <Field size={FIELD_SIZE.state_id}>
                <LookupDialogPicker
                  kind="state"
                  label="State"
                  options={states}
                  value={a.state_id || null}
                  onChange={(id) => setAddressAt(a.key, { state_id: id })}
                />
              </Field>
              <Field size={FIELD_SIZE.address_country_id}>
                <CountryPicker
                  countries={countries}
                  value={a.country_id || null}
                  onChange={(id) => setAddressAt(a.key, { country_id: id })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </Field>
              <Field label="Pin" size={FIELD_SIZE.pin}>
                <ValidatedInput
                  format="pincode"
                  value={a.pin}
                  onChange={(e) => setAddressAt(a.key, { pin: e.target.value })}
                />
              </Field>
              <Field label="Land Line" size={FIELD_SIZE.land_line}>
                <Input
                  value={a.land_line}
                  onChange={(e) => setAddressAt(a.key, { land_line: e.target.value })}
                />
              </Field>
              <Field size={FIELD_SIZE.mobile}>
                <MobileField
                  id={`ve-${a.key}-mobile`}
                  value={a.mobile}
                  onChange={(v) => setAddressAt(a.key, { mobile: v })}
                />
              </Field>
              {/* The "Same as mobile" tick makes this cell ~18px taller than
                  the one beside it and the row grows to match — that is the
                  grid stretching, not a reason to give it a whole line. */}
              <Field size={FIELD_SIZE.whatsapp}>
                <WhatsAppField
                  id={`ve-${a.key}-whatsapp`}
                  value={a.whatsapp}
                  mobile={a.mobile}
                  isdCode={isdOf.get(a.country_id) ?? null}
                  onChange={(v) => setAddressAt(a.key, { whatsapp: v })}
                />
              </Field>
              <Field label="Email ID" size={FIELD_SIZE.email_id}>
                <ValidatedInput
                  format="email"
                  value={a.email_id}
                  onChange={(e) => setAddressAt(a.key, { email_id: e.target.value })}
                />
              </Field>
            </FieldGrid>
          )}
        />
      </SectionBody>
    ),
    other: (
      <SectionBody title="Other Details" hint="Banking, GST and ledger-group defaults for this vendor.">
        {/* Thirteen fields, so titled sections rather than one flat list
            (LAYOUT.md §4) — the two headings this used to draw by hand (a
            bare `<h3>` over a `border-t`) were saying the same thing without
            the structure. Each takes the full row (`span={2}`): a bank name
            beside a GSTIN in a half-width column is back to three fields a
            row, which is what this pass exists to fix. */}
        <SectionGrid>
          {/* row 1  bank_name 3 + branch 3 + ac_no 3 + ifsc_code 3 = 12
              row 2  ac_type 3 — the fifth of five, nothing to pair it with. */}
          <DetailSection label="Banking" cols={12} span={2}>
            <Field label="Bank Name" size={FIELD_SIZE.bank_name} htmlFor="ve-bank">
              <Input
                uppercase
                id="ve-bank"
                value={form.bank_name}
                onChange={(e) => set({ bank_name: e.target.value })}
              />
            </Field>
            <Field label="Branch" size={FIELD_SIZE.branch} htmlFor="ve-branch">
              <Input
                uppercase
                id="ve-branch"
                value={form.branch}
                onChange={(e) => set({ branch: e.target.value })}
              />
            </Field>
            <Field label="A/c No" size={FIELD_SIZE.ac_no} htmlFor="ve-acno">
              <ValidatedInput
                id="ve-acno"
                format="account"
                value={form.ac_no}
                onChange={(e) => set({ ac_no: e.target.value })}
              />
            </Field>
            <Field label="IFSC Code" size={FIELD_SIZE.ifsc_code} htmlFor="ve-ifsc">
              <ValidatedInput
                id="ve-ifsc"
                format="ifsc"
                value={form.ifsc_code}
                onChange={(e) => set({ ifsc_code: e.target.value })}
              />
            </Field>
            <Field label="A/c Type" size={FIELD_SIZE.ac_type} htmlFor="ve-actype">
              <Input
                uppercase
                id="ve-actype"
                value={form.ac_type}
                onChange={(e) => set({ ac_type: e.target.value })}
              />
            </Field>
          </DetailSection>

          {/* row 1  gst_reg_status 3 + gst_no 3 + debit_group 3 + credit_group 3 = 12
              row 2  the GSTIN strip, 12
              The strip is a fact strip, so it is `full` (LAYOUT.md §3) and
              lands on the line directly under the GST number it decodes —
              the two ledger pickers sit beside that number rather than
              between it and its own explanation. */}
          <DetailSection label="GST & Ledger Groups" cols={12} span={2}>
            <Field label="GST No" size={FIELD_SIZE.gst_reg_status} htmlFor="ve-gststatus">
              <Select
                id="ve-gststatus"
                value={form.gst_reg_status}
                onChange={(e) => set({ gst_reg_status: e.target.value as "" | GstRegStatus })}
              >
                <option value="">— Select —</option>
                {GST_REG_STATUSES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="GST Number" size={FIELD_SIZE.gst_no} htmlFor="ve-gstno">
              <ValidatedInput
                id="ve-gstno"
                // Shape-only on purpose. The check digit is verified by the
                // strip below as a WARNING, not a block — a bad GSTIN copied
                // off an invoice still has to be savable while the vendor is
                // chased. Switch this to "gstin_strict" to make it a hard
                // block instead.
                format="gstin"
                value={form.gst_no}
                onChange={(e) => set({ gst_no: e.target.value })}
              />
            </Field>
            {/* Both pickers label themselves — unlabelled cells, span only. */}
            <Field size={FIELD_SIZE.debit_group_id}>
              <AccountGroupPicker
                groups={accountGroups}
                value={form.debit_group_id || null}
                onChange={(id) => set({ debit_group_id: id ?? "" })}
                label="Debit Group"
              />
            </Field>
            <Field size={FIELD_SIZE.credit_group_id}>
              <AccountGroupPicker
                groups={accountGroups}
                value={form.credit_group_id || null}
                onChange={(id) => set({ credit_group_id: id ?? "" })}
                label="Credit Group"
              />
            </Field>
            {gstin && (
              <Field size={FIELD_SIZE.gstin_strip}>
                <GstinInsight
                  decoded={gstin}
                  panValue={form.pan_no}
                  suggestions={gstinSuggestions}
                />
              </Field>
            )}
          </DetailSection>

          {/* row 1  enterprise_status 3 + memorandum_no 3 + inhouse_unit_id 3
                     + duty_against 3 = 12 */}
          <DetailSection label="Additional Details" cols={12} span={2}>
            <Field
              label="Enterprise Status"
              size={FIELD_SIZE.enterprise_status}
              htmlFor="ve-enterprise-status"
            >
              <Input
                uppercase
                id="ve-enterprise-status"
                value={form.enterprise_status}
                onChange={(e) => set({ enterprise_status: e.target.value })}
              />
            </Field>
            <Field label="Memorandum No" size={FIELD_SIZE.memorandum_no} htmlFor="ve-memorandum-no">
              <Input
                uppercase
                id="ve-memorandum-no"
                value={form.memorandum_no}
                onChange={(e) => set({ memorandum_no: e.target.value })}
              />
            </Field>
            <Field label="Inhouse Unit ID" size={FIELD_SIZE.inhouse_unit_id} htmlFor="ve-inhouse-unit">
              <Input
                uppercase
                id="ve-inhouse-unit"
                value={form.inhouse_unit_id}
                onChange={(e) => set({ inhouse_unit_id: e.target.value })}
              />
            </Field>
            <Field label="Duty Against" size={FIELD_SIZE.duty_against} htmlFor="ve-duty-against">
              <Input
                uppercase
                id="ve-duty-against"
                value={form.duty_against}
                onChange={(e) => set({ duty_against: e.target.value })}
              />
            </Field>
          </DetailSection>
        </SectionGrid>
      </SectionBody>
    ),
  };


  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vendor…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Vendor
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No vendors yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No vendors yet.
          </div>
        ) : (
          filtered.map((r) => (
            // Tapping a card OPENS THE VIEW, not the editor. A phone has no room
            // for a row of actions beside the name, and a nested <button> inside
            // this one is invalid markup — so the card carries the read, and Edit
            // is one tap further on in the view's footer (gated on `canEdit`
            // there). It also un-breaks the card for a read-only user, for whom
            // this handler previously did nothing at all.
            <button
              key={r.id}
              type="button"
              onClick={() => setViewRow(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.code ?? "—"}
                    {r.vendor_type ? ` · ${r.vendor_type}` : ""}
                  </div>
                </div>
                {r.is_draft ? (
                  <StatusPill tone="warning">Draft</StatusPill>
                ) : r.inactive ? (
                  <StatusPill tone="danger">Inactive</StatusPill>
                ) : (
                  <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      <MasterFullScreen
        open={open}
        onClose={() => setOpen(false)}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">{form.name.trim() || "vendor"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled vendor",
          badges: (
            <>
              {form.inactive && <StatusPill tone="danger">Inactive</StatusPill>}
              {!form.inactive && <StatusPill tone={statusTone(form.status)}>{form.status}</StatusPill>}
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
              {form.vendor_type && <span>· {form.vendor_type}</span>}
              {form.country_id && countryLabel.get(form.country_id) && (
                <span>· {countryLabel.get(form.country_id)}</span>
              )}
            </>
          ),
          right: (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Category
              </span>
              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                {activeCategories.length === 0 ? (
                  <span className="text-xs text-muted-foreground">None set</span>
                ) : (
                  activeCategories.map((f) => (
                    <span
                      key={f.key}
                      className="inline-flex items-center rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs"
                    >
                      {f.label}
                    </span>
                  ))
                )}
              </div>
            </>
          ),
        }}
        sections={SECTIONS.map((s) => ({
          key: s.key,
          label: s.label,
          icon: s.icon,
          done: done[s.key],
          content: SECTION_CONTENT[s.key],
        }))}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New vendor",
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          saveLabel: "Save vendor",
          canSave: !!form.name.trim(),
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          draftLabel: "Save as Draft",
          isPending,
        }}
      />

      {/* Read-only view — the same record, nothing editable, and Edit in the
          footer hands off to the editor above. */}
      <RecordViewSheet
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        canEdit={perms.canEdit}
        onEdit={() => {
          const r = viewRow;
          setViewRow(null);
          if (r) openEdit(r);
        }}
        title={viewRow?.name ?? ""}
        subtitle={
          viewRow
            ? [
                viewRow.vendor_type,
                viewRow.country_id ? countryLabel.get(viewRow.country_id) : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            : undefined
        }
        status={
          viewRow &&
          (viewRow.is_draft ? (
            <StatusPill tone="warning">Draft</StatusPill>
          ) : viewRow.inactive ? (
            <StatusPill tone="danger">Inactive</StatusPill>
          ) : (
            <StatusPill tone={statusTone(viewRow.status)}>{viewRow.status}</StatusPill>
          ))
        }
        sections={viewRow ? viewSections(viewRow) : []}
      />
    </div>
  );
}

/** A titled content block inside the editor's content pane. */
