"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, User, Users } from "lucide-react";
import { ChildGrid } from "@/components/masters/child-grid";
import { MobileField, WhatsAppField, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Toggle } from "@/components/ui/toggle";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { StatePicker } from "@/components/masters/state-picker";
import { createNotify, updateNotify, deleteNotify } from "@/lib/masters/notify-actions";
import {
  partyOrigin,
  OriginBadge,
  originNameHint,
  originDeleteBlock,
  type PartyOrigin,
} from "@/components/masters/party-origin";
import { deletedToast } from "@/lib/masters/delete-message";
import type { Notify, NotifyInput } from "@/lib/masters/notify-types";
import type { Country } from "@/lib/masters/country-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { createdSection } from "@/components/ui/created-columns";

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
/**
 * Two masters can publish a notify party — Customer ▸ Also Notify and
 * Consignee ▸ Also Notify (0371). The DB CHECK guarantees at most one link is
 * set, so the first hit is the answer.
 */
const notifyOrigin = (r: Notify) =>
  partyOrigin([
    {
      id: r.source_customer_id,
      source: r.source_customer,
      from: "Customer",
      flag: "Also Notify",
    },
    {
      id: r.source_consignee_id,
      source: r.source_consignee,
      from: "Consignee",
      flag: "Also Notify",
    },
  ]);

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
 * THE HEADER FIELDS, SHRINK-WRAPPED (`erp-form-compact`) — the twelfths track
 * this screen has carried since the four-per-row work is gone.
 *
 * `sm` = 3 of 12, "one size, every field" (client 2026-07-29), was the right
 * answer while the track was fractional: it stopped Name and E-Mail taking half
 * a row each and it put four fields on a line. What it could not do is make any
 * of them COMPACT. Three twelfths of the 1180px pane is ~278px whatever sits in
 * it, so a six-digit Pin stood exactly as wide as the street address, and a
 * Country picked from a list stood as wide as the party's own name.
 *
 * A fraction cannot be narrowed from the inside — shrinking the control leaves
 * the CELL at 278px and floats the value in the surplus — so the fields leave
 * the track for `FieldRow` + `Field w=` and take the width of the KIND OF VALUE
 * they hold.
 *
 * NO HAND-TYPED PIXELS. Every one of these lands on a step of the five-width
 * vocabulary in `lib/ui/sizes.ts`, which is the rule this must not become "a
 * screen measured against its own longest value":
 *
 *   short options 90-120  ->  `range` 112   Pin, six digits with a hard maximum
 *   selects       140-170  ->  `code`  144   Name, Country, City, State, Land Line
 *   free text              ->  `name`  288   Street, E-Mail, Web site
 *
 * NAME IS `code`, NOT `name` (client 2026-09-09: "shrink-wrap the Name box to
 * 140px, remove the excess empty space"). It is the one field on this screen
 * asked for by a MEASUREMENT rather than by a kind of value, and 140px is not a
 * width this vocabulary can say — so it takes the step that answers it, `code`
 * at 144, and NOT a hand-typed `w-[140px]`, which is the rule the block above
 * states and the reason a 4px difference is not worth breaking it for.
 *
 * It is a narrowing the vocabulary tolerates rather than one it argues for: a
 * party's name has no hard maximum, so the `name` step was the correct default
 * and a longer name now scrolls inside the box. That is the trade the client
 * asked for. Street, E-Mail and Web site are untouched — they were never the
 * complaint, and moving them would be this screen measuring itself.
 *
 * COUNTRY, CITY AND STATE ARE `code` BECAUSE CUSTOMER ALREADY MEASURED THEM.
 * Its address row takes City and State at `code`, and its General row takes
 * Port of Loading, Port of Discharge and Final Destination at the same step. A
 * place name is a place name; a second opinion here is drift, not tailoring.
 *
 * MOBILE AND WHATSAPP ARE `term` (176), ONE STEP WIDER THAN LAND LINE, and the
 * step is paid for by the CONTROL rather than by the value: each of those two
 * cells holds its input AND a `ContactChip` in a flex beside it, so at `code`
 * the number would be squeezed by a fixed 28px button. Land Line has no chip
 * and stays at 144. Customer's own address row makes the same trade.
 *
 * DERIVED, so each row can be checked against the pane `MasterFullScreen` gives
 * a section (1180px, one section at a time). `FIELD_ROW` puts 12px between
 * cells:
 *
 *   Details        144 + 144 + ~100 (the switch)  =  388 + 2 x 12 =  412
 *   Address        288 + 144 + 144 + 112          =  688 + 3 x 12 =  724
 *   Communication  144 + 176 + 176 + 288 + 288    = 1072 + 4 x 12 = 1120
 *
 * ALL THREE NOW FIT ONE LINE, which is the thing the twelfths could not do at
 * any size: Communication was five fields at 3 of 12, so it spent 12 on four of
 * them and dropped Web site onto a line of its own with three quarters of that
 * line left empty. The spans-sum-to-12 arithmetic the old note carried is not
 * replaced by a tighter version of itself — there are no twelfths left to sum.
 *
 * Courier Delivery holds the same address-plus-contacts record and still has
 * the old map. It is not registered in `submodules.ts` (removed 2026-08-01,
 * screen kept), so "change one, change both" no longer binds: there is no
 * screen an operator can open that this would leave inconsistent with.
 */
const FIELD_W = {
  name: "code", //      140px asked for; 144 is the step that says it
  country: "code",
  street: "name", //    a postal line has no hard maximum — free text
  city: "code",
  state: "code",
  pin: "range", //      6 digits
  land_line: "code",
  mobile: "term", //    input + ContactChip
  whatsapp: "term", //  input + ContactChip, and a "Same as mobile" tick below
  email: "name",
  web_site: "name",
} satisfies Record<string, FieldWidth>;

/**
 * THE CONTACT ROW, on the same steps and read by `renderMobileRow` below.
 *
 * Seven fields that are a department, a person's name and a phone number were
 * seven `size="sm"` cells, i.e. seven times ~278px — the same complaint as the
 * header, one card deeper. The two lines they wrap into are the two the old
 * note already wanted (4 then 3), now reached by width rather than by counting
 * twelfths:
 *
 *   144 + 144 + 288 + 144  = 720 + 3 x 12 = 756   department..internal dept.
 *   144 + 144 + 288        = 576 + 2 x 12 = 600   land line, mobile, e-mail
 *
 * MOBILE IS `code` HERE AND `term` ABOVE, and that is not an inconsistency: the
 * header's Mobile is a `MobileField` carrying a `ContactChip`, this one is a
 * bare `Input`. The step pays for the button, so a cell with no button does not
 * take it.
 */
const CONTACT_W = {
  department: "code",
  designation: "code",
  contact_name: "name",
  internal_department: "code",
  land_line: "code",
  mobile: "code", //  a bare Input — no ContactChip to pay for
  email_id: "name",
} satisfies Record<string, FieldWidth>;

/**
 * AND THE CONTACTS GRID IS CAPPED TO ITS OWN ROW (`erp-form-compact` rule 4: a
 * sub-grid takes the FORM's width, not the screen's).
 *
 * Narrowing the seven fields does not narrow the card they sit in — `ChildGrid`
 * is a block box and went on filling the 1180px pane, so the tightened row
 * would have trailed ~400px of empty card to the right of it. Derived from the
 * wider of the two lines above:
 *
 *   756       the content row
 *   + 40      the ✕'s reserved gutter — see below
 *   + 2 x 10  GRID_FRAME's `p-2.5`, the NON-compact density
 *   + 2 x 1   its border
 *   = 818
 *
 * THE ✕'s 40px IS THE PART THAT IS EASY TO DROP, and dropping it turns two rows
 * into three. A `renderMobileRow` card keeps the CORNER remove (`removeBeside`
 * says so in writing: that callback owns the row's layout, so the chip stays out
 * of it), and the corner is an absolute chip standing in a `relative pr-10`
 * gutter the row reserves for it. So the fields never get the card's full inner
 * width — they get it less 40px, and a cap derived without that leaves the row
 * ~14px short of its own first line. Internal Dept. then folds, Land Line and
 * Mobile follow it, and E-Mail lands alone on a third line: the three-row
 * layout the client asked away on 2026-07-29, arriving from the arithmetic
 * rather than from the twelfths.
 *
 * 53rem (848px) leaves ~30px of slack, for the same reason `country-master-
 * screen.tsx` leaves 10px on `FORM_W`: a cap that fits at only one density
 * wraps the row at the other. Derived at `p-2.5` for that reason, though the
 * editor pane resolves `@2xl/editor:p-2` and pays 4px less.
 *
 * IT ALSO HAS TO HOLD FOR A ROW WITH NO ✕. `lockExisting` withholds the chip
 * from every stored row, and with it the `relative pr-10`, so a saved contact's
 * fields sit in 40px MORE than a new one's. The cap is set by the narrower of
 * the two (the new row, above); the wider one is checked against the next
 * field, not the last — 756 + 12 + 144 = 912 is past 830, so a stored row folds
 * after Internal Dept. exactly as a new one does. Both shapes give 4 then 3.
 *
 * SAFE TO NARROW ONLY BECAUSE THIS GRID IS `forceCards`. AGENTS.md's rule is
 * never to take a `ChildGrid` under 512px, since that is where its responsive
 * table falls back to stacked cards with no column headers — this grid is
 * declared as cards already, so there is no table to lose.
 */
const CONTACTS_W = "max-w-[53rem]";

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
  /**
   * Set while editing a row that a tick box published (0371). Its Name belongs
   * to the source and is read-only here — that removes the rename conflict
   * rather than resolving it: the name syncs one way and this side cannot fight
   * it. Everything else on the record is genuinely its own.
   */
  const [editOrigin, setEditOrigin] = useState<PartyOrigin | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  /**
   * SEEDED, NEVER `[]` (`erp-table-default-row`). The Contacts grid is a typing
   * surface, not a list of results: an operator opening the tab expects a caret,
   * not a "+ Add contact" button to find first.
   *
   * `openAdd` and `openEdit` below both re-seed before the overlay opens, so
   * this value only ever covers the mount — but it is stated rather than left
   * empty so the grid cannot render row-less by any path. That is the third of
   * the rule's three statements: a `useState` initialiser fires once per mount
   * and this editor does not remount between records, so seeding only here would
   * show the PREVIOUS notify's contacts the second time New is pressed.
   *
   * THE KEY IS A LITERAL, not `newKey()`: an initialiser runs during render and
   * `newKey` reads `keySeq.current`, which `react-hooks/refs` correctly rejects.
   * Keys only have to be unique within the array, and the sequence issues `c`
   * followed by digits, so `ct0` can never collide with one.
   *
   * NOT `ChildGrid`'s own `seedRow`. It seeds by CALLING `onAdd` from an effect,
   * and `dirty` here is a JSON comparison against `pristine` that INCLUDES
   * `contacts` — so every notify would open reading "Unsaved changes" and
   * `MasterFullScreen`'s unsaved guard would hold off the silent PWA auto-reload
   * on a record nobody had touched. Seeding the state instead happens inside the
   * open handlers, before they set the baseline, so a pristine record stays
   * pristine. `customer-master-screen.tsx` records the same choice at length.
   *
   * THE SEEDED ROW IS SAFE TO SAVE because every key `blankContact` stamps is
   * `""`, and `normalizeContacts` in `notify-actions.ts` drops a row by testing
   * all seven of them. No default may be added to that factory: a field the
   * factory always fills turns its clause in that OR-chain into the constant
   * `true`, and an untouched row is inserted as a phantom contact.
   */
  const [contacts, setContacts] = useState<ContactRow[]>(() => [blankContact("ct0")]);
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  // Server guard already exists in notify-actions.ts -- this surfaces it.
  const dupError = useDuplicateName({
    table: "notifies",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean?" — dupError above only fires on an EXACT collision, so a
   * one-character miss sails past it and becomes a second row meaning the same
   * thing as the first. Advisory only: the typed text saves as typed unless the
   * operator accepts a chip. Suppressed while the red error shows — one line
   * under the input, and the name it collided with is the one that is no use.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? "").filter(Boolean),
    // No curated vocabulary, and there can never be one: these are the names of
    // real trading parties. Rows only — which is exactly the useful check here,
    // catching "ABC TEXTILES" typed beside an existing "ABC TEXTILE".
    seed: [],
    // `editOrigin` means this row was PUBLISHED by another party master and its
    // Name is read-only here (see the field). Offering a correction for a value
    // that cannot be typed is noise pointing at the wrong screen.
    enabled: open && !editOrigin,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

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
    setEditOrigin(null);
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
    setEditOrigin(notifyOrigin(r));
    // One visible Country field now feeds both stored columns (see the
    // pickers below) — `country_id` is authoritative (it is what the list
    // column, header chip and read-only view all resolve), so it wins; a row
    // saved before this fix that only ever had `address_country_id` filled in
    // still opens with a country rather than a blank picker.
    const countryId = r.country_id ?? r.address_country_id ?? "";
    const nextForm: HeaderForm = {
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      country_id: countryId,
      street: r.street ?? "",
      city_id: r.city_id ?? "",
      state_id: r.state_id ?? "",
      pin: r.pin ?? "",
      address_country_id: countryId,
      land_line: r.land_line ?? "",
      mobile: r.mobile ?? "",
      // NOT `?? ""` — a stored NULL is the "same as mobile" state.
      whatsapp: r.whatsapp,
      email: r.email ?? "",
      web_site: r.web_site ?? "",
    };
    const stored: ContactRow[] = r.contacts.map((c) => ({
      key: newKey(),
      department_id: c.department_id ?? "",
      contact_name: c.contact_name ?? "",
      designation_id: c.designation_id ?? "",
      land_line: c.land_line ?? "",
      mobile: c.mobile ?? "",
      email_id: c.email_id ?? "",
      internal_department_id: c.internal_department_id ?? "",
    }));
    /**
     * AN EXISTING NOTIFY WITH NO CONTACTS OPENS READY TO TYPE TOO — the second
     * of `erp-table-default-row`'s three statements, and the one a screen
     * forgets, because seeding `openAdd` alone makes a NEW record look right and
     * leaves every stored record with an empty tab.
     *
     * `[]` is what "no lines yet" looks like coming back from a fetch, which is
     * the state the blank row exists for. The null half is already answered
     * upstream: `notify-service.ts` coerces a missing embed to `[]` before this
     * screen ever sees it.
     *
     * It goes into `pristine` below with everything else, so a record that opens
     * holding one scaffolded row still opens CLEAN — the row is the form's, not
     * something the operator typed, exactly as `openAdd` already says.
     */
    const nextContacts = stored.length ? stored : [blankContact(newKey())];
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
    // A published row is owned by its source. Deleting it here while the tick
    // box stayed on would simply republish it on that record's next save, so we
    // point at the box instead of pretending the delete worked.
    const origin = notifyOrigin(r);
    if (origin) {
      error(originDeleteBlock(origin));
      return;
    }
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
    const origin = notifyOrigin(r);
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
        pairs: [
          ["Country", r.country_id ? (countryLabel.get(r.country_id) ?? null) : null],
          // Only when it IS published — a null pair on an ordinary notify party
          // would invite the question "published by what?" for no reason.
          ...(origin ? [[`From ${origin.from}`, `${origin.name} (${origin.flag})`] as const] : []),
        ],
      },
      {
        label: "Address",
        // No "Country" pair here — it lived under Identity above until the
        // single-Country-field fix (2026-07-31); `address_country_id` is kept
        // in sync with `country_id` and would only repeat that line.
        pairs: [
          ["Street", r.street],
          ["City", r.city_id ? (cityLabel.get(r.city_id) ?? null) : null],
          ["State", nameOf(states, r.state_id)],
          ["Pin", r.pin],
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
    {
      header: "Name",
      cell: (r) => {
        const origin = notifyOrigin(r);
        return (
          <span className="flex flex-wrap items-center gap-1.5 text-sm">
            {r.name}
            <OriginBadge origin={origin} />
          </span>
        );
      },
    },
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
          meta: (r) => {
            const o = notifyOrigin(r);
            return (
              [
                r.country_id ? (countryLabel.get(r.country_id) ?? null) : null,
                o ? `from ${o.from} ${o.name}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || null
            );
          },
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
              <OriginBadge origin={editOrigin} />
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
          canSave: !!form.name.trim() && !dupError,
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
              <SectionBody title="Identity">
            <DetailSection label="Details" cols={1}>
              {/* `align="start"`, and Name is the hazard that choice is for: it
                  renders a `DuplicateError` and a `SpellSuggestHint` BELOW its
                  control, and `items-end` measures from the bottom, so the
                  moment either appears it would lift the Name box clear of the
                  Country box beside it. Nothing on this row has the opposite
                  hazard — every label sits in a cell wide enough for it, so none
                  of them wraps.

                  It used to render a third thing, the origin `hint`, and that
                  one is gone (below) — but the two that are left are why this
                  stays `start`. They appear WHILE TYPING, which is worse than a
                  hint that is simply there: the row would settle at one height
                  and then jump. */}
              <FieldRow align="start">
                <Field
                  label="Name"
                  w={FIELD_W.name}
                  required
                  htmlFor="nt-name"
                >
                  {/* `readOnly`, not `disabled`: the value still submits, still
                      copies, still reads normally — and Input's own readOnly sets
                      tabIndex={-1}, so it leaves the Tab order for free.

                      THE ORIGIN NOTE IS A `title`, NOT `Field`'s `hint` (client
                      2026-09-09: remove the "Name comes from …" line under the
                      box) — the same move the sibling Consignee screen already
                      made, and its own comment records the layout half of the
                      reason: `hint` renders a <p> inside this cell, so a
                      published row's Identity row stood taller than an ordinary
                      one's and taller than the same row on the New form.

                      The fact is NOT lost, which is what makes deleting the line
                      safe rather than merely quieter: `OriginBadge` states it in
                      the editor header above, permanently and in words. The note
                      here only has to be reachable, and `readOnly` on a box the
                      operator cannot type in is the question it answers. */}
                  <Input
                    id="nt-name"
                    uppercase
                    readOnly={!!editOrigin}
                    title={editOrigin ? originNameHint(editOrigin) : undefined}
                    value={form.name}
                    onChange={(e) => set({ name: e.target.value })}
                    required
                    // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                    onKeyDown={nameSuggest.onKeyDown}
                    {...dupFieldProps(dupError, "nt-name")}
                  />
                  <DuplicateError error={dupError} id="nt-name" />
                  <SpellSuggestHint
                    suggestions={nameSuggest.suggestions}
                    existing={nameSuggest.existing}
                    activeIndex={nameSuggest.activeIndex}
                    duplicate={!!dupError}
                    onApply={(v) => setForm((f) => ({ ...f, name: v }))}
                  />
                </Field>
                {/* Pickers render their own labels — never double-label them.
                    The ONLY Country field on this form now (client complaint
                    2026-07-31: two boxes both labelled "Country" read as a
                    duplicate). It writes BOTH `country_id` and
                    `address_country_id` — see the Address section below, which
                    used to carry its own picker for the second column. */}
                <Field w={FIELD_W.country}>
                  <CountryPicker
                    countries={countries}
                    value={form.country_id || null}
                    onChange={(id) => set({ country_id: id, address_country_id: id })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                    canDelete={perms.canDelete}
                  />
                </Field>
                {/* `Toggle`, NOT A TICK BOX (client 2026-09-08: the same switch
                    Order Entry uses) — the identical swap the sibling Country and
                    Destination masters made, and from the SAME component, so the
                    three masters and Garment Order's Pack / Multi Style switches
                    cannot drift apart. Size, track colour and the ON `--primary`
                    are `Toggle`'s, not this screen's, which is the whole point of
                    asking for "the same as Order Entry".

                    IT IS STILL A REAL CHECKBOX UNDERNEATH, and that is what makes
                    the swap safe rather than merely pretty. `Toggle` keeps an
                    `sr-only` `<input type="checkbox">` and draws the switch with
                    its siblings, because `isFieldLike()` (lib/focus.ts) counts an
                    `<input>` and NOT a `<button role="switch">` — the obvious
                    build would have dropped this flag off Tab, off Enter-advance
                    and off the arrows, leaving it mouse-only. Tab reaches it,
                    Enter and Space toggle it, and a screen reader still announces
                    a checkbox.

                    `label=""` RESERVES THE LABEL ROW, and it is the alignment fix
                    rather than decoration. It survived the move off the twelfths
                    track unchanged, and for the same reason one step along: the
                    row is now `align="start"` (see the note above the `FieldRow`),
                    so a cell with no label at all starts its control at the row's
                    TOP and stands ~16px above every labelled field beside it —
                    the documented 2026-08-11 fault, and what put this switch above
                    the centre line of the Name and Country boxes. Country needs no
                    such spacer: `CountryPicker` renders its own `Label`, so its
                    cell already opens with one. The spacer goes through the real
                    `Label`, so the reserved row keeps that component's own
                    `@2xl/editor` metrics instead of a second copy of them.

                    No `label="Inactive"` on the Field: the switch renders its own
                    words, and two labels would draw the name twice. */}
                {editId && (
                  /* No `w`: a switch is not one of the five widths, and an
                     unsized `Field` in a flex row is exactly as wide as what is
                     in it. */
                  <Field label="">
                    <Toggle
                      id="nt-inactive"
                      label="Inactive"
                      checked={form.inactive}
                      onChange={(inactive) => set({ inactive })}
                    />
                  </Field>
                )}
              </FieldRow>
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
              <SectionBody title="Address">
            <DetailSection label="Address" cols={1}>
              {/* The default `items-end` here, unlike the two rows either side:
                  nothing on this row renders anything below its control, and
                  bottom alignment is the house rule because it is what keeps a
                  label too long for its own cell from dropping its input a line.
                  City and State draw their own labels, so all four cells open
                  with one and the boxes line up either way. */}
              <FieldRow>
                {/* A single-line Input, not the 3-row Textarea this used to be:
                    every grid row is as tall as its tallest item, so a textarea
                    sharing the row would leave City / State / Pin above a band of
                    dead space. Stored newlines survive; an <input> just shows them
                    on one line. */}
                <Field label="Street" w={FIELD_W.street} htmlFor="nt-street">
                  <Input
                    uppercase
                    id="nt-street"
                    value={form.street}
                    onChange={(e) => set({ street: e.target.value })}
                  />
                </Field>
                <Field w={FIELD_W.city}>
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
                <Field w={FIELD_W.state}>
                  <StatePicker
                    label="State"
                    options={states}
                    value={form.state_id || null}
                    onChange={(id) => set({ state_id: id })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                    canDelete={perms.canDelete}
                  />
                </Field>
                <Field label="Pin" w={FIELD_W.pin} htmlFor="nt-pin">
                  <Input
                    id="nt-pin"
                    value={form.pin}
                    onChange={(e) => set({ pin: e.target.value })}
                  />
                </Field>
                {/* Country used to have its OWN field here, bound to
                    `address_country_id` — right beside Identity's `country_id`
                    one, the same country asked twice. The column still exists
                    in the DB (data-io round-trips it, and old rows may only
                    have this one filled in) but it is now written from the
                    single Identity Country picker above, not from a visible
                    field here. Do not add this field back without re-reading
                    that picker's comment first. */}
              </FieldRow>
            </DetailSection>

            <DetailSection label="Communication" cols={1}>
              {/* `align="start"` again, and this row has three reasons for it:
                  WhatsApp renders a "Same as mobile" tick under its control, and
                  both `ValidatedInput` cells can render a format message there.
                  All five cells open with a label — the two phone fields draw
                  their own — so nothing needs a `label=""` spacer. */}
              <FieldRow align="start">
                <Field label="Land Line" w={FIELD_W.land_line} htmlFor="nt-landline">
                  <Input
                    id="nt-landline"
                    value={form.land_line}
                    onChange={(e) => set({ land_line: e.target.value })}
                  />
                </Field>
                {/* The pair is taken apart here rather than using
                    MobileWhatsAppFields: that helper emits two bare sibling cells
                    and takes ONE `cellClassName` for both of them, so it can only
                    give the two the same width. That was already why this screen
                    split them on the twelfths track, and it still holds: each
                    half needs its own `Field` to carry its own `w`. Customer can
                    use the helper because its Mobile and WhatsApp are the same
                    step; do not "simplify" this back to it. Both halves render
                    their own labels. */}
                <Field w={FIELD_W.mobile}>
                  <MobileField
                    id="nt-mobile"
                    value={form.mobile}
                    onChange={(v) => set({ mobile: v })}
                  />
                </Field>
                <Field w={FIELD_W.whatsapp}>
                  <WhatsAppField
                    id="nt-whatsapp"
                    value={form.whatsapp}
                    mobile={form.mobile}
                    isdCode={isdOf.get(form.address_country_id) ?? null}
                    onChange={(v) => set({ whatsapp: v })}
                  />
                </Field>
                <Field label="E-Mail" w={FIELD_W.email} htmlFor="nt-email">
                  <ValidatedInput
                    format="email"
                    id="nt-email"
                    value={form.email}
                    onChange={(e) => set({ email: e.target.value })}
                  />
                </Field>
                <Field label="Web site" w={FIELD_W.web_site} htmlFor="nt-web">
                  <ValidatedInput
                    format="website"
                    id="nt-web"
                    value={form.web_site}
                    onChange={(e) => set({ web_site: e.target.value })}
                  />
                </Field>
              </FieldRow>
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
              <SectionBody title="Contacts">
            {/* Seven fields per row, so stacked cards (LAYOUT.md §6) with a
                `FieldRow` inside: the card body packs them by WIDTH the way the
                three sections beside it now do, instead of stacking seven
                controls one per line. It was a `FieldGrid` on the same 12-col
                track as those sections, and it left the track with them.
                Replaces a hand-rolled list with its own header band, `#` column,
                remove button and `max-h-56` scroller. */}
            <div className={CONTACTS_W}>
            <ChildGrid<ContactRow>
              lockExisting
              label="Contact"
              rows={contacts}
              onAdd={addContact}
              onRemove={(c) => removeContact(c.key)}
              addLabel="+ Add contact"
              forceCards
              flatRows
              pageSize={4}
              // `forceCards` + `renderMobileRow` mean these never render; they
              // are the fallback if this grid is ever switched back to a table.
              columns={[
                { header: "Department", cell: (c) => c.contact_name },
                { header: "Contact Name", cell: (c) => c.contact_name },
                { header: "Designation", cell: (c) => c.designation_id ?? "" },
              ]}
              /* Two rows, not three, and it is now the WIDTHS that make it two
                 rather than an arithmetic the reader has to trust — see
                 `CONTACT_W` above for the two lines and their sums. The client
                 asked for two rows on 2026-07-29 and got them out of 3+3+3+3 and
                 3+3+3 of twelve; the same two rows now fall out of the widths,
                 and the second one ends where its content ends instead of at
                 nine twelfths of the pane.

                 E-Mail is `name` (288), the widest step, because it is the one
                 value here that routinely runs past 30 characters. That is not
                 the "sized to its own data" exception the 07-29 decision removed:
                 288 is the step every free-text field on this screen takes, and
                 Contact Name takes it too. */
              renderMobileRow={(c) => (
                /* `align="start"`, the same choice and the same hazard as the
                   Communication row above: Email ID is a `ValidatedInput`, which
                   renders its format message BELOW the control, and `items-end`
                   measures from the bottom of that — so the first badly-typed
                   address would lift the E-Mail box clear of the six beside it,
                   while the operator is still in the row. Nothing here has the
                   opposite hazard: every label fits its cell on one line, the
                   longest being "Contact Name" in a 288px box and
                   "Internal Dept." in a 144px one. */
                <FieldRow align="start">
                    <Field label="Department" w={CONTACT_W.department}>
                      <LookupDialogPicker
                        kind="department"
                        label="Department"
                        options={departments}
                        value={c.department_id || null}
                        onChange={(id) => setContactAt(c.key, { department_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Designation" w={CONTACT_W.designation}>
                      <LookupDialogPicker
                        kind="designation"
                        label="Designation"
                        options={designations}
                        value={c.designation_id || null}
                        onChange={(id) => setContactAt(c.key, { designation_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Contact Name" w={CONTACT_W.contact_name}>
                      <Input
                        uppercase
                        value={c.contact_name}
                        onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })}
                      />
                    </Field>
                    <Field label="Internal Dept." w={CONTACT_W.internal_department}>
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
                    <Field label="Land Line" w={CONTACT_W.land_line}>
                      <Input
                        value={c.land_line}
                        onChange={(e) => setContactAt(c.key, { land_line: e.target.value })}
                      />
                    </Field>
                    <Field label="Mobile" w={CONTACT_W.mobile}>
                      <Input
                        value={c.mobile}
                        onChange={(e) => setContactAt(c.key, { mobile: e.target.value })}
                      />
                    </Field>
                    <Field label="Email ID" w={CONTACT_W.email_id}>
                      <ValidatedInput
                        format="email"
                        value={c.email_id}
                        onChange={(e) => setContactAt(c.key, { email_id: e.target.value })}
                      />
                    </Field>
                </FieldRow>
              )}
            />
            </div>
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
        sections={viewRow ? [...viewSections(viewRow), ...createdSection(viewRow)] : []}
      />
    </div>
  );
}
