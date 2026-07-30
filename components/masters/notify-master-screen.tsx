"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, User, Users } from "lucide-react";
import { ChildGrid } from "@/components/masters/child-grid";
import { MobileField, WhatsAppField, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Field, FieldGrid, type FieldSize } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
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
 * ONE SIZE, EVERY FIELD: `sm` = 3 of 12 = four per row (client 2026-07-29). The
 * client picked the City / State / Pin / Country row out as the correct shape
 * and asked for the rest of the masters to match it, so nothing is sized to its
 * own data any more — Name, E-Mail and Web site gave up the 6 they had, and
 * Street gave up the full row its Textarea stood on. See applicant-master-screen
 * for the full statement of the rule and what it trades away.
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12 OR LESS. A row totalling 13+ does not
 * shrink: its last field wraps onto a line of its own and the rest of that line
 * is left empty, and nothing in the build catches it. The arithmetic:
 *
 *   Details        name 3 + country 3 + inactive 3           =  9
 *   Address        street 3 + city 3 + state 3 + pin 3       = 12
 *                  addr country 3                           =  3
 *   Communication  land line 3 + mobile 3 + whatsapp 3 + e-mail 3 = 12
 *                  web site 3                               =  3
 *
 * The editor gives each field its full width for this to mean anything. It now
 * does so by construction: the editor is a `MasterFullScreen`, which renders ONE
 * section at a time across a 1180px content pane, so `sm` is the ~278px of the
 * row the client pointed at. The earlier caveat here — that a section sharing a
 * `SectionGrid` gets a ~566px track where the same `sm` is only ~132px, half the
 * reference row — no longer applies to this screen: there is no `SectionGrid`
 * left in it, and the rail cannot put two sections side by side. The two phone
 * cells still give ~32px of their width to a call/chat chip.
 *
 * Identical to Courier Delivery's map by design, not by copy-paste drift: the
 * two masters hold the same address-plus-contacts record. Change one, change
 * both.
 */
const FIELD_SIZE = {
  name: "sm",
  country: "sm",
  inactive: "sm", // a tick; it sits last in the row, so it takes the remainder
  street: "sm", // a single-line Input now — a Textarea sets the row's height
  city: "sm",
  state: "sm",
  pin: "sm",
  address_country: "sm",
  land_line: "sm",
  mobile: "sm",
  whatsapp: "sm", // the "Same as mobile" tick under it still fits at ~132px
  email: "sm",
  web_site: "sm",
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
  /** The record being LOOKED at — read-only, never the editor's record. */
  const [viewRow, setViewRow] = useState<Notify | null>(null);
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
    const blankContacts = [blankContact(newKey())];
    setForm(BLANK);
    setContacts(blankContacts);
    // Baseline for `dirty`. A brand-new notify starts clean even though it
    // already holds one empty contact row — that row is scaffolding the form
    // put there, not something the user typed.
    setPristine(JSON.stringify({ form: BLANK, contacts: blankContacts }));
    setOpen(true);
  }
  function openEdit(r: Notify) {
    setEditId(r.id);
    const nextForm: HeaderForm = {
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

  /** A config_lookups id → its name. The lists are small and the view renders
      ONE record, so this resolves on demand rather than building four maps. */
  const nameOf = (options: ConfigLookup[], id: string | null) =>
    (id ? options.find((o) => o.id === id)?.name : null) ?? null;

  /**
   * The record as a reader wants it, laid out the way the editor's rail reads:
   * Identity · Address · Communication · Contacts. Every FK is resolved to a
   * NAME here — a uuid on screen tells the reader nothing — using the same
   * lists the editor's pickers are handed, so nothing is fetched.
   *
   * Identical to courier-delivery-master-screen's by design, not by copy-paste
   * drift: the two masters hold the same record. Change one, change both.
   */
  function viewSections(r: Notify): ViewSection[] {
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
        pairs: [["Country", r.country_id ? (countryLabel.get(r.country_id) ?? null) : null]],
      },
      {
        label: "Address",
        pairs: [
          ["Street", r.street],
          ["City", r.city_id ? (cityLabel.get(r.city_id) ?? null) : null],
          ["State", nameOf(states, r.state_id)],
          ["Pin", r.pin],
          [
            "Country",
            r.address_country_id ? (countryLabel.get(r.address_country_id) ?? null) : null,
          ],
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
    // because seven label→value rows apiece would bury the address above it.
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
    return sections;
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
  ];

  /**
   * Unsaved-work tracking. The editor is a `MasterFullScreen`, which registers
   * itself with the reload guard as an open MODAL — but "a modal is open" is not
   * "there is work to lose", and this screen never declared the second
   * (AGENTS.md, STANDING). A deploy landing on a half-keyed notify party would
   * take it silently.
   *
   * Whole-object compare against the record as loaded, the same shape Applicant
   * uses: `set` spreads, so key order is stable and the two strings differ only
   * when a value does. `useState`, NOT a ref — the baseline moves on an event,
   * and a ref read during render gives React nothing to re-render on, so the
   * `● Unsaved` badge would go stale.
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
  };

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
        actions={{ onView: setViewRow, onEdit: openEdit, onDelete: remove }}
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
      <MasterFullScreen
        open={open}
        onClose={() => setOpen(false)}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">{form.name.trim() || "notify party"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled notify party",
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
            </>
          ),
        }}
        footer={{
          status: dirty ? "Unsaved changes" : undefined,
          onCancel: () => setOpen(false),
          onSave: submit,
          saveLabel: "Save notify party",
          canSave: !!form.name.trim(),
          // No `onSaveDraft`: unlike Applicant, `notify` has no is_draft column,
          // so there is nothing a draft could be saved as.
          isPending,
        }}
        /* Three rail entries, the same split as Applicant, whose editor this
           screen now shares. The section rail replaces one long scroll through
           twenty fields: `MasterFullScreen` renders ONE section at a time across
           the full 1180px pane and owns the active section, the modal guard, the
           body-scroll lock, Escape and the per-section autofocus.

           No field inside changed in the swap — every `DetailSection cols={12}`
           and `<Field size>` is exactly as the four-per-row work left it.

           The address block still splits into "Address" (where it is) and
           "Communication" (how to reach it) INSIDE one rail entry: as one card
           it held 10 fields, well past the 5-7 a section should carry
           (LAYOUT.md §4), but as two rail entries it would split an address from
           its own phone number. */
        sections={[
          {
            key: "identity",
            label: "Identity",
            icon: User,
            done: done.identity,
            content: (
              <SectionBody title="Identity" hint="Who this notify party is, and the country it sits in.">
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
              </SectionBody>
            ),
          },
          {
            key: "address",
            label: "Address",
            icon: MapPin,
            done: done.address,
            content: (
              <SectionBody title="Address" hint="Where the notify party is, and how to reach them.">
            <DetailSection label="Address" cols={12}>
              {/* A single-line Input, not the 3-row Textarea this used to be:
                  every grid row is as tall as its tallest item, so a textarea
                  sharing the row would leave City / State / Pin above a band of
                  dead space. Stored newlines survive; an <input> just shows them
                  on one line. */}
              <Field label="Street" size={FIELD_SIZE.street} htmlFor="nt-street">
                <Input
                  uppercase
                  id="nt-street"
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
              </SectionBody>
            ),
          },
          {
            key: "contacts",
            label: "Contacts",
            icon: Users,
            done: done.contacts,
            content: (
              <SectionBody title="Contacts" hint="People to deal with at this notify party.">
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
                   land line 3 + mobile 3 + e-mail 3                          =  9
                 The second row stops at 9. E-Mail was `lg` here when fields were
                 sized to their own data — it is the one value that routinely runs
                 past 30 characters — but the screen since moved to one size for
                 every field (client 2026-07-29), and an exception for a single
                 cell is the ragged edge that decision exists to remove. */
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
                      uppercase
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
                  <Field label="Email ID" size="sm">
                    <ValidatedInput
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
            <StatusPill tone={viewRow.inactive ? "danger" : "success"}>
              {viewRow.inactive ? "Inactive" : "Active"}
            </StatusPill>
          )
        }
        sections={viewRow ? viewSections(viewRow) : []}
      />
    </div>
  );
}
