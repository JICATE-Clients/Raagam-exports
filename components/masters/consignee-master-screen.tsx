"use client";

import { Bell, DownloadCloud, MapPin, SlidersHorizontal, TriangleAlert, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { gridKeyNav } from "@/components/masters/child-grid";
import { MobileWhatsAppFields, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Field, FIELD_WIDTH, FieldRow, type FieldWidth } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useToast } from "@/components/ui/toast";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { StatePicker } from "@/components/masters/state-picker";
import { PaymentTermPicker } from "@/components/masters/payment-term-picker";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { BankPicker } from "@/components/masters/bank-picker";
import { NotifyPicker } from "@/components/masters/notify-picker";
import { GstinInsight, type GstinSuggestion } from "@/components/masters/gstin-insight";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { createConsignee, updateConsignee, deleteConsignee } from "@/lib/masters/consignee-actions";
import {
  partyOrigin,
  OriginBadge,
  PublishesBadge,
  originNameHint,
  originDeleteBlock,
  type PartyOrigin,
} from "@/components/masters/party-origin";
import { PARTY_ROLE } from "@/lib/masters/party-origin-text";
import {
  customerToConsigneeFields,
  diffFetch,
  describeFields,
  type ConsigneeFetchContact,
  type ConsigneeFetchFields,
  type FetchPlan,
} from "@/lib/masters/party-fetch";
import { deletedToast } from "@/lib/masters/delete-message";
import { useDuplicateCheck, useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { decodeGstin, matchGstinState, normalizeGstin } from "@/lib/validation/gstin";
import { defaultCountryId, defaultStateId } from "@/lib/masters/geo-defaults";
import {
  SHIP_MODES,
  PAY_MODES,
  type Consignee,
  type ConsigneeInput,
} from "@/lib/masters/consignee-types";
import type { Country } from "@/lib/masters/country-types";
import { lookupLabel, type ConfigLookup } from "@/lib/masters/extras-types";
import type { Customer } from "@/lib/masters/customer-types";
import type { Currency } from "@/lib/masters/types";
import type { Bank } from "@/lib/masters/bank-types";
import type { Notify } from "@/lib/masters/notify-types";
import { createdMeta, createdSection, withCreatedColumns } from "@/components/ui/created-columns";
import { Toggle } from "@/components/ui/toggle";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

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
/**
 * Two masters can publish a consignee — Applicant ▸ Also Consignee and
 * Customer ▸ Also Consignee (0371). The DB CHECK guarantees at most one link is
 * set, so the first hit is the answer.
 *
 * `source_customer_id` is the publish link and has nothing to do with
 * `customer_id`, the owning-customer picker on the form.
 */
const consigneeOrigin = (r: Consignee) =>
  partyOrigin([
    {
      id: r.source_applicant_id,
      source: r.source_applicant,
      from: "Applicant",
      flag: "Also Consignee",
    },
    {
      id: r.source_customer_id,
      source: r.source_customer,
      from: "Customer",
      flag: "Also Consignee",
    },
  ]);

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
/**
 * THE BLANK MARKING ROW, one definition read by four call sites
 * (`erp-table-default-row`): the mount seed, `openAdd`, an `openEdit` that came
 * back with no rows, and "+ Add marking".
 *
 * It is a FACTORY rather than an inline `{ key, marking: "" }` at each of them
 * because the row's BLANKNESS is load-bearing. `normalizeMarkings` in
 * `consignee-actions.ts` drops a row by testing `marking` for content, so a key
 * stamped here with any default would turn that filter into a constant and
 * insert a phantom marking on every record nobody typed one on. One definition
 * is what keeps the four call sites honest, and it is the shape
 * `customer-master-screen.tsx` already uses for the same grid.
 */
const blankMarking = (key: string): MarkingRow => ({ key, marking: "" });
type NotifyRefRow = { key: string; notify_id: string };
/**
 * THE BLANK NOTIFY-REF ROW, one definition read by four call sites
 * (`erp-table-default-row`), exactly as `blankMarking` above: the mount seed,
 * `openAdd`, an `openEdit` that came back with no rows, and "+ Add notify
 * party".
 *
 * `notify_id: ""` is the whole point, not a placeholder. `normalizeNotifyRefs`
 * in `consignee-actions.ts` drops a row by testing `notify_id` for content, so
 * the one key this factory stamps is the one the save filter reads — a default
 * here would turn that filter into a constant and write a phantom notify party
 * onto every consignee nobody named one on.
 */
const blankNotifyRef = (key: string): NotifyRefRow => ({ key, notify_id: "" });

/**
 * The form, seen through the narrow window "Fetch from Customer" works on.
 *
 * Spelled out field by field rather than spread, so that adding a column to
 * `HeaderForm` cannot silently enrol it in the fetch: what a Customer is
 * allowed to answer is a decision, taken once in lib/masters/party-fetch.ts,
 * and this is the only place the two shapes meet.
 */
const fetchableFields = (f: HeaderForm): ConsigneeFetchFields => ({
  country_id: f.country_id,
  street: f.street,
  city_id: f.city_id,
  state_id: f.state_id,
  pin: f.pin,
  address_country_id: f.address_country_id,
  land_line: f.land_line,
  mobile: f.mobile,
  whatsapp: f.whatsapp,
  email: f.email,
  web_site: f.web_site,
  currency_1: f.currency_1,
  currency_2: f.currency_2,
  currency_3: f.currency_3,
  ship_mode: f.ship_mode,
  ship_type_id: f.ship_type_id,
  pay_mode: f.pay_mode,
  gst_no: f.gst_no,
});

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

/** Contact rows without their render keys, for comparing against a Customer's. */
const fetchableContacts = (rows: readonly ContactRow[]): ConsigneeFetchContact[] =>
  rows.map((r) => ({
    department_id: r.department_id,
    contact_name: r.contact_name,
    designation_id: r.designation_id,
    land_line: r.land_line,
    mobile: r.mobile,
    email_id: r.email_id,
    internal_department_id: r.internal_department_id,
  }));

/**
 * The whole editor as one string, for the unsaved-work compare. Whole-object,
 * the same shape company-profile-screen uses: every `set`/`setXAt` spreads, so
 * key order is stable and two snapshots differ only when a value does. Cheaper
 * than threading a `setDirty(true)` through every handler on a 29-field form,
 * and it cannot be forgotten on a new one.
 *
 * The child rows carry their `key`, which is fine — a key is minted once when
 * the row appears and never changes, so it moves the string only when a row is
 * genuinely added or removed.
 */
const snapshot = (
  form: HeaderForm,
  contacts: ContactRow[],
  markings: MarkingRow[],
  notifyRefs: NotifyRefRow[],
) => JSON.stringify({ form, contacts, markings, notifyRefs });

/**
 * GENERAL, SHRINK-WRAPPED (`erp-form-compact`) — the last of this editor's four
 * sections to leave the twelfths track, after Identity, Address and Contacts
 * went on 2026-09-09.
 *
 * Nine fields at `size="sm"` is 3 of 12 each, so a three-letter currency CODE
 * stood between 285 and 352px wide depending on the window — a QUARTER of the
 * content width the formula below derives — and the bank it is paid into stood
 * at exactly the same width. The old note above this map spelt the rows out as `3 + 3 + 3 + 3 = 12`
 * and read as settled because it summed — but summing to 12 only says the row
 * does not overflow, never that any field in it is the right size. Three of the
 * four values on that first row were three characters long.
 *
 * ## ONE LINE, NOT TWO (client 2026-09-09: Currency 1 through A/c No. "into one
 * single horizontal row", `flex-nowrap`, and every width shrink-wrapped tighter
 * — currencies ~80, Ship Mode / Ship Type ~100, the payment group 110-140)
 *
 * THIS REVERSES THE TWO-LINE SHAPE THIS MAP SHIPPED WITH EARLIER TODAY, and it
 * does so deliberately, so do not "restore" it. That shape read the two lines as
 * meaning something — how the goods travel, then how they are paid for — which
 * is a real reading and is no longer the one being asked for. The nine fields
 * are one band now.
 *
 * STILL NO HAND-TYPED PIXELS. The client named pixels and every one of them is
 * met by a step of the five-width vocabulary, so this row stays inside it:
 *
 *   ~80  currencies        ->  `num`   72   a 3-letter ISO code; the trigger
 *                                           shows the CODE alone (`label: c.code`
 *                                           in `currency-picker.tsx`), and
 *                                           `compact` reserves 24px for the
 *                                           affordance, leaving ~36px for "USD"
 *   ~100 Ship Mode         ->  `range` 112  "SEA/AIR" is the longest of four,
 *                                           ~58px, and a native <select> draws
 *                                           its own arrow inside the box
 *   ~100 Ship Type         ->  `range` 112  the same step as the field beside it
 *   110-140 Pay Mode       ->  `range` 112  an 8-option enum, "CHEQUE" the
 *                                           longest — the narrow end of the
 *                                           band the client drew, which is what
 *                                           shrink-wrapping the value means
 *   110-140 A/c No.        ->  `code`  144  the band's top step; an account
 *                                           number is not bounded short
 *
 * ## TWO OF THEM CAME BACK OFF THAT STEP (client 2026-09-09: Payment Terms
 * 180px, Bank 200px, "so the selected values don't get truncated with ...")
 *
 * `code` 144 is the top of the band the client drew, and it was still not enough
 * for these two — both are PICKER TRIGGERS, and a trigger spends ~24px of its
 * box on the affordance before the value starts. So "60 DAYS FROM BL DATE" and a
 * bank's full name each clipped to an ellipsis. That is not broken behaviour —
 * `<Truncated>` makes the rest reachable on hover — but a value the operator has
 * to hover to READ BACK is not a value they can check at a glance, which is what
 * a General tab is for.
 *
 *   180 Payment Terms  ->  `term`  176   the EXISTING step, 4px under what was
 *                                        asked and indistinguishable from it —
 *                                        and "60 Days DA" is the two-word enum
 *                                        `term` is named for
 *   200 Bank           ->  `party` 200   the sixth vocabulary width, added for
 *                                        this field. NOT a local `w-[200px]`:
 *                                        `erp-form-compact` says a screen
 *                                        needing a width above the bands is the
 *                                        case for a vocabulary step, and a map
 *                                        of private pixels here is what
 *                                        `IDENTITY_W` tells the next reader not
 *                                        to copy.
 *
 * PAY MODE IS THE ONE FIELD NARROWER THAN ITS NEIGHBOURS, and that is the
 * standard rather than a ragged edge. `REGISTRATION_W` below argues the opposite
 * way for its four identifiers and both are right: those are four values of one
 * KIND read as a band, while Pay Mode is a short enum sitting beside free text.
 * Width follows the content type, which is rule 1.
 *
 * DERIVED, and now against the PANE rather than against a cap, because the row
 * no longer breaks — `nowrap` is what holds it on one line and there is nothing
 * left for a cap to decide:
 *
 *    72 +  72 +  72 + 112 + 112             = 440   currencies .. ship type
 *   112 + 176 + 200 + 144                   = 632   pay mode .. a/c no.
 *  1072 of controls + 8 x 10 (the nowrap row's `gap-x-2.5`)  = 1152
 *
 * ## WHAT 1152 IS MEASURED AGAINST, EXACTLY
 *
 * "The ~1180px pane" is what this comment said while the row was 1064 and any
 * reasonable number cleared it. At 1152 the yardstick has to be the real one,
 * because the answer now changes with the window. `MasterFullScreen` is a
 * `fixed inset-0` overlay on a `md:grid-cols-[192px_1fr]`, and its content
 * column is `mx-auto w-full px-4` under a `max-w-[1440px]`, so:
 *
 *   content = min(viewport - 192 rail, 1440 cap) - 32 padding
 *
 * which puts the break at a VIEWPORT of 1376 CSS px:
 *
 *   1920 -> 1408    1536 -> 1312    1440 -> 1216      the row stands whole
 *   1376 -> 1152    exactly the row, and the last width that holds
 *   1366 -> 1142    ten pixels short: a 1366 laptop SCROLLS this row
 *
 * THE 1366 LAPTOP IS THE ONE TO KNOW ABOUT. It does not fold and it does not
 * clip — `FieldRow`'s `overflow-x-auto` scrolls the row sideways, which is the
 * trade `nowrap` IS (`FIELD_ROW_NOWRAP` in `field.tsx`) and is why one unbroken
 * line was worth asking for. But it is a real edge and it was bought by the last
 * two widenings: at 1064 this row cleared every laptop down to 1288.
 *
 * SO THE ROW IS NOW THE CONSTRAINT ON THIS MAP. It is `nowrap`, so a tenth field
 * or a further widening does not fold — it moves that break UP the range of
 * viewports, one screen size at a time. Widen anything here again and redo this
 * arithmetic first, not after, and say which laptops it costs.
 *
 * Every picker on this row portals its panel (`createPortal` in
 * `data-picker.tsx`), so nothing that opens is clipped by that container.
 */
const GENERAL_W = {
  currency: "num", //         a 3-letter ISO code, all three of them
  ship_mode: "range",
  ship_type_id: "range",
  pay_mode: "range", //       an 8-option enum, "CHEQUE" the longest
  payment_term_id: "term", //  "60 DAYS FROM BL DATE" clipped at `code`
  bank_id: "party", //        a bank's full name clipped at `code`
  ac_no: "code",
} satisfies Record<string, FieldWidth>;

/**
 * THE REGISTRATION NUMBERS, on the same steps.
 *
 * Four bounded identifiers — a TIN, a CST, a 10-character PAN and a 15-character
 * GSTIN — that each took 3 of 12, i.e. ~278px for a value that cannot exceed 15
 * characters. They are codes, so they are all `code`, and the row that used to
 * fill the card now ends where the fourth number ends:
 *
 *   144 + 144 + 144 + 144 = 576 + 3 x 12 = 612
 *
 * `gst_no` is `code` here because it is `code` in Customer's `GENERAL_W`. PAN is
 * shorter still and could take a narrower step, but a row of four identifiers
 * reads as one band, and one of them being 32px shy of its neighbours is a
 * ragged edge bought for nothing.
 */
const REGISTRATION_W = {
  tin_no: "code",
  tin_no_2: "code",
  pan_no: "code", //  exactly 10 characters
  gst_no: "code", //  exactly 15 — the widest of the four, and it fits
} satisfies Record<string, FieldWidth>;

/**
 * THE REGISTRATION CARD'S CAP (`erp-form-compact` rule 4) — a block box held to
 * its own content instead of to the pane.
 *
 * IT USED TO CAP THE FIELD ROW TOO, under the name `GENERAL_FORM_W`, and that
 * is what decided where the row broke: at 656 the fifth field opened a second
 * line and the payment group stayed whole on it. The row is `nowrap` now (the
 * client asked for one unbroken line), so there is no break left to place and a
 * cap on it would only make it scroll inside 656px of the 1064 it needs. The
 * name went with the job: this string caps ONE box.
 *
 * 41rem is unchanged and still the same 656 `CONTACT_W` uses, so the Contacts
 * tab's card and this one keep a shared right edge. The card fits inside it by
 * construction — `REGISTRATION_W`'s four `code` fields are 612 of content, plus
 * 24 for its `p-3` and 2 for its border = 638.
 */
const REGISTRATION_BOX_W = "max-w-[41rem]";

/**
 * THE MARKING BOX HUGS ITS OWN ROW INSTEAD (`erp-form-compact` rule 4), and it
 * is the one box on this tab that does NOT take `REGISTRATION_BOX_W`.
 *
 * Rule 4 caps a sub-grid to the form's width, and 656 would satisfy it — but a
 * marking row is an index, one text box and a ✕, and at 656 it would trail
 * ~270px of empty card to the right of that ✕. That is the same defect the rule
 * is aimed at, arriving from underneath: the box would be narrower than the
 * screen and still much wider than its content. Customer's Marking grid reached
 * the same answer for the same three-part row.
 *
 * So the box is derived from the row, and the row from the `name` step:
 *
 *    24  the `#` index (`w-6`)
 *  + 288 the marking itself — free text with no hard maximum, so `name`, the
 *        same step Street and E-Mail take in `ADDRESS_W`
 *  +  32 the ✕
 *  +  16 two `gap-2`
 *  =  360
 *  +  24 the list's `p-3`  + 2 its border                         = 386
 *  -> 25rem (400px)
 *
 * The input needs the width stated on it: `Input` is `w-full`, so inside a flex
 * row it would grow to whatever the box allows and the cap alone would do
 * nothing. `cn` is tailwind-merge, so `w-72` at the call site replaces it.
 */
const MARKING_W = "max-w-[25rem]";

/**
 * IDENTITY, SHRINK-WRAPPED (`erp-form-compact`) — the same conversion the sibling
 * Notify master took on 2026-09-09, on the row that holds the same two fields.
 *
 * Four controls at `size="sm"` is 3 of 12 each, so a Yes/No "Also Notify" select
 * stood between 285 and 352px wide depending on the window — the same width as
 * the consignee's own NAME, and every one of the four boxes ran on past the value
 * inside it. (A twelfth of the content width `GENERAL_W` derives below: 1142 on a
 * 1366 laptop, 1408 at 1920.) A fraction cannot be narrowed from the inside:
 * shrinking the control leaves the CELL at its share and floats the value in the
 * hole. So the row leaves the track for `FieldRow` + `Field w=` and each field
 * takes the width of the KIND OF VALUE it holds.
 *
 * NO HAND-TYPED PIXELS. Every width here is a step of the five-width vocabulary
 * in `lib/ui/sizes.ts`. `customer-master-screen.tsx`'s `IDENTITY_W` is the one
 * map in this app that hand-types them, and it says in writing not to be copied.
 *
 *   short options 90-120  ->  `range` 112   Also Notify, a two-option select
 *   selects       140-170  ->  `code`  144   Name, Country, Customer
 *
 * NAME IS `code` (144), NOT `name` (288), BECAUSE THE SIBLING ALREADY MEASURED
 * IT. The client asked Notify's name box for 140px on 2026-09-09 and it took the
 * step that says so; a consignee is the same kind of party on the same kind of
 * screen, so a second opinion here is drift rather than tailoring — the same
 * argument that keeps Country at `code` beside `ADDRESS_W`'s City and State.
 * Customer is `code` for that reason too: it holds a party's name as well.
 *
 * TWO CELLS TAKE NO `w` AT ALL, and that is rule 1 rather than an omission: a
 * switch and a button are not among the five widths, and an unsized `Field` in a
 * flex row is exactly as wide as what is in it. `Toggle` is ~100px of switch plus
 * the word "Inactive"; the Fetch button is its own label, ~190px. Both are
 * measured below rather than named, and both must carry `label=""` — see the row.
 *
 * DERIVED, so it can be checked against the pane. `FIELD_ROW` puts 12px between
 * cells:
 *
 *   New    144 + 144 + 144 + 112 + ~190          =  734 + 4 x 12 =  782
 *   Edit   144 + 144 + 144 + 112 + ~100 + ~190   =  834 + 5 x 12 =  894
 *
 * BOTH ON ONE LINE AT EVERY WINDOW THIS APP RUNS IN, which is the thing the
 * twelfths could not do at any size: four fields at 3 filled row 1 exactly, so
 * Inactive and Fetch were pushed onto a second row that left half of itself empty
 * — and the old map's own comment called that "a short second row" rather than
 * the hole it was.
 *
 * "EVERY WINDOW" IS A CLAIM WITH ARITHMETIC BEHIND IT, and the yardstick is the
 * one `GENERAL_W` derives below: content = min(viewport - 192 rail, 1440 cap) -
 * 32 padding, i.e. 1142 on a 1366 laptop and 1408 at 1920. 894 clears the
 * narrowest of those by 248px, so unlike General this row has no break width to
 * know about.
 *
 * AND IT WOULD WRAP RATHER THAN SCROLL IF IT EVER DID. This is a plain
 * `FieldRow`, not `nowrap` — the client asked General for one unbroken line and
 * did not ask it of Identity, so the `overflow-x-auto` trade General makes is not
 * one this row makes. A field added here folds onto a second line, visibly,
 * instead of hiding off the right edge. Widening is therefore cheap here and is
 * not cheap there; check `GENERAL_W`'s table before assuming the reverse.
 */
const IDENTITY_W = {
  name: "code", //         140px asked for on the sibling; 144 is the step
  country_id: "code",
  customer_id: "code", //  a party's name, same as `name` above
  also_notify: "range", // a two-option select; the label sets the floor at ~68px
} satisfies Record<string, FieldWidth>;

/**
 * ADDRESS, SHRINK-WRAPPED (`erp-form-compact`) — the same conversion Customer's
 * own Address section took on 2026-09-09, on the same nine fields, and the map
 * is deliberately identical to `ADDRESS_W` there: the two screens hold the same
 * postal address, so measuring it twice is the drift `lib/ui/sizes.ts` exists to
 * stop.
 *
 * Nine fields at `size="sm"` is 3 of 12 each, so on a 1440px pane a six-digit
 * PIN was ~340px — as wide as the street — and the section broke into three rows
 * of four with a hole in the last. A fraction cannot be made compact: narrowing
 * the control inside a twelfth leaves the CELL at its old width and the value
 * floating in it. So `FieldRow` + `Field w=`.
 *
 * NO HAND-TYPED PIXELS — every value lands on a step of the five-width
 * vocabulary:
 *
 *   short options 90-120  ->  `range` 112   PIN, six digits with a hard maximum
 *   selects       140-170  ->  `code`  144   City, State, Land Line
 *   free text              ->  `name`  288   Street, E-Mail, Web site
 *
 * City and State are `code` because that is what the same kind of value takes
 * one section down — Port of Loading, Port of Discharge and Final Destination
 * are all place-name pickers in General.
 *
 * MOBILE AND WHATSAPP ARE `term` (176), ONE STEP WIDER THAN THE OTHER PHONE
 * FIELD, and the step is paid for by the CONTROL rather than the value: each of
 * those two cells holds its input AND a `ContactChip` in a flex beside it, so at
 * `code` the number would be squeezed by a fixed 28px button. Land Line has no
 * chip and stays at 144.
 *
 * DERIVED, so it can be checked against the pane — this row WRAPS, and these are
 * the two lines it wraps into:
 *
 *   288 + 144 + 144 + 112 + 144 + 176 + 176 = 1184 + 6 x 12 = 1256   street..whatsapp
 *   288 + 288                               =  576 + 1 x 12 =  588   e-mail, web site
 *
 * Both inside 1440, and the first line is the seven fields that say WHERE the
 * consignee is — the break an operator would make by hand.
 */
const ADDRESS_W = {
  street: "name", //      a postal line has no hard maximum — free text
  city_id: "code",
  state_id: "code",
  pin: "range", //        6 digits
  land_line: "code",
  contact: "term", //     Mobile and WhatsApp, both: input + ContactChip
  email: "name",
  web_site: "name",
} satisfies Record<string, FieldWidth>;

/**
 * THE CONTACT CARD'S OWN FIELDS (`erp-form-compact` rules 1-3, inside the child).
 *
 * This grid is hand-rolled — a stack of bordered cards, not a `ChildGrid` — so
 * every control was `w-full` inside a card that was itself the width of the
 * pane: a Land Line box ~1400px wide, seven of them stacked, one contact filling
 * a screen. Same defect as the section above it, one card in.
 *
 * The three pickers take `code` because that is what City and State take in
 * `ADDRESS_W` above — the same control, on the same screen, at the same width.
 *
 * CONTACT NAME IS `code` TOO, AND IT WAS `name` (288) FOR AN HOUR. A person's
 * name has no hard maximum, which is the test `FieldWidth` states and which
 * argues for the widest step — but `IDENTITY_W` measures the CONSIGNEE'S OWN
 * name at 144 on this same screen, so 288 here would have made the contact
 * inside the record twice the width of the party the record is about. One kind
 * of value, one width: that is the drift `lib/ui/sizes.ts` exists to stop, and
 * the narrower opinion is the one already agreed with the sibling Notify master.
 * E-Mail keeps `name` — an address genuinely is longer than a name, and it is
 * what the Address section above gives the same value.
 *
 *   department 144 + contact_name 144 + designation 144 = 432 + 2 x 12 = 456
 *   land_line  144 + mobile       144 + email_id    288 = 576 + 2 x 12 = 600
 *   internal_department 144
 *
 * The 600px line is what `CONTACT_W` below is derived from, so the fields and
 * the box that holds them cannot drift apart.
 */
const CONTACT_FIELD_W = {
  department: "code",
  contact_name: "code", // the party's own Name is 144 — see the note above
  designation: "code",
  land_line: "code",
  mobile: "code",
  email_id: "name",
  internal_department: "code",
} satisfies Record<string, FieldWidth>;

/**
 * THE CONTACT BOX IS CAPPED TO THE FORM'S WIDTH, NOT THE SCREEN'S
 * (`erp-form-compact` rule 4).
 *
 * A cap, not a width — the box is `max-w`, so on a narrow pane it still shrinks.
 * Derived from the 600px line `CONTACT_FIELD_W` above states, plus the chrome
 * between that line and the outer border:
 *
 *   600 + 2 (outer border) + 24 (the list's `p-3`) + 2 (card border)
 *       + 20 (the card's `p-2.5`)                                    = 648
 *   -> 41rem (656px), which leaves the row 608px of content
 *
 * BOTH BOUNDS MATTER, and they hold each of the three lines to the shape it is
 * meant to have. 608 is over the 600 the phone line needs, so Land Line · Mobile
 * · Email ID stay together; it is under 756 (600 + a gap + a `code` field), so
 * Internal Department cannot squeeze onto them. The first line is 456, and 608
 * is under 612 (456 + a gap + a `code` field), so Land Line cannot climb up to
 * join the pickers either. Without that upper bound the card would change shape
 * at some window width nobody tested.
 *
 * This is NOT a `ChildGrid`, so the 512px `@lg` switch that floors Customer's
 * Marking cap does not apply — there is no table to fall out of, and the cards
 * here are the layout rather than the fallback.
 *
 * TWO THINGS THAT WOULD MOVE THESE NUMBERS AND DO NOT MOVE HERE. Both are
 * hazards `notify-master-screen.tsx`'s `CONTACTS_W` had to answer, so check them
 * before copying this cap onto another card rather than assuming it travels:
 *
 * - **A density variant on the padding.** That note derives its cap at `p-2.5`
 *   while the editor pane resolves `@2xl/editor:p-2` and pays 4px less. Here the
 *   card is a plain `p-2.5` and the list a plain `p-3` with no editor variant on
 *   either, so 608 is the content width at every density — and 612 is exactly
 *   where Land Line would have climbed onto the picker line.
 * - **A row that withholds its ✕.** `lockExisting` there leaves a stored row 40px
 *   wider than a new one, so the cap has to hold for both. This grid has no such
 *   branch, and its ✕ sits in the card's own header row above the fields rather
 *   than beside them, so it costs the row no width at all.
 */
const CONTACT_W = "max-w-[41rem]";

/**
 * THE NOTIFY CARD'S OWN FIELDS (`erp-form-compact` rules 1-3, inside the child).
 *
 * The last hand-rolled grid on this screen, and the same defect as the Contact
 * card beside it one more time: two controls, each a bare `<div><Label>` with a
 * full-width box under it, stacked down a card that was itself the width of the
 * pane. A Notify Short Name picked from a list of short names came out ~1100px
 * wide, and the Country mirrored beside it the same again on the line below.
 *
 * BOTH ARE `code` (144), AND NEITHER IS A NEW MEASUREMENT. `IDENTITY_W` already
 * puts this screen's own Country at 144 and `ADDRESS_W` puts City and State
 * there; the Notify Short Name is a party's name, which is what `IDENTITY_W.name`
 * and `CONTACT_FIELD_W.contact_name` both take. A third opinion on either value
 * would be the drift `lib/ui/sizes.ts` exists to stop, so there is one line of
 * arithmetic and no bands to quote:
 *
 *   notify_id 144 + country 144 = 288 + 1 x 12 = 300
 *
 * THE COUNTRY BOX IS THE ONE THING THE NARROWING COSTS. It is a readOnly `<Input>`
 * mirroring the picked Notify's country, and a bare input has no `text-overflow`
 * of its own — so at 144px a long country name would stop mid-word and read as
 * the whole thing, which LAYOUT.md §14 names as the worst case of all. The two
 * halves it asks for are both here: `text-ellipsis` makes the clipping visible,
 * and a `title` makes the value readable. It cannot go through `<Truncated>`,
 * which writes its own `truncate` span and has no way to reach inside an input.
 */
const NOTIFY_FIELD_W = {
  notify_id: "code", // a party's short name — as IDENTITY_W.name
  country: "code", //   as IDENTITY_W.country_id and ADDRESS_W.city_id
} satisfies Record<string, FieldWidth>;

/**
 * AND THE NOTIFY CARD IS CAPPED TO THE FORM'S WIDTH, NOT THE SCREEN'S
 * (`erp-form-compact` rule 4) — same derivation as `CONTACT_W` above, on the
 * same chrome, because it is the same box one section along.
 *
 * Narrowing the two fields does not narrow the card holding them: it is a block
 * box and went on filling the pane, so a 300px row would have trailed ~800px of
 * empty card to the right of it. That is rule 4's defect exactly, and it is the
 * one the client reports as "leaving half of the right side completely empty".
 *
 *   300 + 2 (outer border) + 24 (the list's `p-3`) + 2 (card border)
 *       + 20 (the row's `p-2.5`)                                     = 348
 *   -> 23rem (368px), which leaves the row 320px of content
 *
 * 320 IS OVER THE 300 THE ROW NEEDS, by 20px rather than by the 4px `CONTACT_W`
 * runs on, and the slack is deliberate: a cap that fits at exactly one density
 * wraps the row at the other. Neither box here carries an `@2xl/editor:p-`
 * variant, so 320 holds at every width — but the margin means the next person to
 * add one does not silently fold this row.
 *
 * THE UPPER BOUND IS THE ONE WITH NOTHING BEHIND IT YET. A third `code` field
 * would need 456 (300 + a gap + 144), which is well clear of 320, so a field
 * added here drops to a second line rather than quietly reshaping the card. The
 * row's own chrome fits with room to spare: "Notify #1" and its ✕ come to ~104px
 * and the "+ Add notify party" button to ~150px.
 */
const NOTIFY_W = "max-w-[23rem]";

/**
 * Master-detail CRUD for the legacy "Consignee" master (Associates). The editor
 * is a `MasterFullScreen` with a left section rail —
 * `Identity` (Name · Country · Customer · Also Notify · Inactive) ·
 * `Address` (address, phones, and the Contact card) ·
 * `General` (currencies, ship/pay, bank, the Marking card and the Registration
 * card) · `Notify` (the Notify Parties card).
 *
 * It used to be a `Sheet` that split itself with a hand-rolled mid-form
 * `Address | General | Notify` tab bar — the same pattern the client asked to be
 * taken off Applicant. The rail replaces it: one section at a time, named down
 * the left instead of across the middle, with a completion dot per section.
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
  /** The row being READ. Separate from `editId` — a view must never arm Save. */
  const [viewRow, setViewRow] = useState<Consignee | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  /**
   * Set while editing a row a tick box published (0371). Its Name belongs to
   * the source and is read-only here — that removes the rename conflict instead
   * of resolving it. Everything else on the record is genuinely its own.
   */
  const [editOrigin, setEditOrigin] = useState<PartyOrigin | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  /**
   * SEEDED, NEVER `[]` (`erp-table-default-row`). The Marking grid on the
   * General tab is a typing surface, not a list of results: an operator opening
   * the tab expects a caret, not a "+ Add marking" button to find first, and the
   * legacy RP screen it is migrating from opens with a row standing ready.
   *
   * `openAdd` and `openEdit` below both re-seed before the overlay opens, so
   * this value only ever covers the mount — but it is stated rather than left
   * empty so the grid cannot render row-less by any path. That third statement
   * is the one a screen forgets: a `useState` initialiser fires once per mount
   * and this editor does not remount between records, so seeding only here would
   * show the PREVIOUS consignee's markings the second time New is pressed.
   *
   * THE KEY IS A LITERAL, not `newKey()`: an initialiser runs during render and
   * `newKey` reads `keySeq.current`, which `react-hooks/refs` correctly rejects.
   * Keys only have to be unique within the array, and the sequence issues `c`
   * followed by digits, so `mk0` can never collide with one.
   *
   * The Contacts grid beside it has followed this rule since it was built; this
   * is the grid on the same screen that did not.
   */
  const [markings, setMarkings] = useState<MarkingRow[]>(() => [blankMarking("mk0")]);
  /**
   * SEEDED, NEVER `[]` — the same three statements the Marking grid above
   * spells out, for the grid on this screen that was still opening on a bare
   * "+ Add notify party" button. The literal key is deliberate for the same
   * reason `mk0` is: an initialiser runs during render and cannot read
   * `keySeq.current`. `nf0` cannot collide with the `c`-prefixed sequence.
   */
  const [notifyRefs, setNotifyRefs] = useState<NotifyRefRow[]>(() => [blankNotifyRef("nf0")]);
  /**
   * A "Fetch from Customer" that would REPLACE values already on the form, held
   * while the operator answers for it. The button swaps itself for a confirm
   * strip — the same two-step `RowActions` uses for delete, and deliberately not
   * an overlay: a hand-rolled `fixed inset-0` div is invisible to the reload
   * guard's DOM scan (AGENTS.md), and this needs no such wiring.
   */
  const [pendingFetch, setPendingFetch] = useState<FetchPlan | null>(null);
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  const notifyCountryLabel = useMemo(() => {
    const country = new Map<string, string>();
    for (const c of countries) country.set(c.id, c.name);
    const m = new Map<string, string>();
    for (const n of notifies) m.set(n.id, n.country_id ? (country.get(n.country_id) ?? "—") : "—");
    return m;
  }, [notifies, countries]);

  /**
   * The Country the Notify card MIRRORS, as one expression.
   *
   * It is read twice per row — once as the box's value and once as the `title`
   * that reveals it when 144px clips it (`NOTIFY_FIELD_W`) — and the two must
   * never be able to say different things. A plain arrow, not a `useMemo`: it is
   * one Map lookup per row, and a hook here would be one more thing to keep above
   * the early returns for nothing (AGENTS.md, "Hooks above every early return").
   */
  const notifyCountry = (id: string) =>
    id ? (notifyCountryLabel.get(id) ?? "—") : "";

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

  /**
   * id → name across every option list the editor's pickers already receive.
   * One map for all of them because these ids are uuids, so they cannot
   * collide — and the read-only view resolves an FK the same way the picker
   * does, out of props, never with a query of its own.
   */
  const optionName = useMemo(() => {
    const m = new Map<string, string>();
    const lists: { id: string; name: string }[][] = [
      cities,
      states,
      departments,
      designations,
      internalDepartments,
      shipTypes,
      paymentTerms,
      banks,
      notifies,
    ];
    for (const list of lists) for (const o of list) m.set(o.id, o.name);
    // Ship Type overwrites its own plain-name entries: its code is an Incoterm,
    // so the view reads "FREE ON BOARD (FOB)" — the same label the picker showed.
    for (const s of shipTypes) m.set(s.id, lookupLabel("ship_type", s));
    return m;
  }, [
    cities,
    states,
    departments,
    designations,
    internalDepartments,
    shipTypes,
    paymentTerms,
    banks,
    notifies,
  ]);
  /** Never renders a raw uuid: an id we cannot name reads as nothing at all. */
  const nameOf = (id: string | null | undefined) => (id ? (optionName.get(id) ?? "") : "");

  // ---------------------------------------------------------------- GSTIN ----
  // Everything below is decoded from the GST number itself — no lookup, no
  // network. See lib/validation/gstin.ts for what the 15 characters carry.

  const gstin = useMemo(
    () => decodeGstin(form.gst_no, { companyGstin }),
    [form.gst_no, companyGstin],
  );

  /**
   * The GSTIN as loaded, so merely OPENING a record never auto-fills — that
   * would mark a freshly-opened form dirty and trip the unsaved-work guard.
   * Only a GSTIN the user actually changed feeds the auto-fill.
   */
  const loadedGstin = useRef("");

  // The State row this GSTIN points at — code first, spelling as a fallback.
  // Shared with the vendor screen; see matchGstinState.
  const gstinState = useMemo(() => matchGstinState(gstin, states), [gstin, states]);

  // A GSTIN can only belong to an Indian registration, so the country it implies
  // is never in doubt — but it is still offered, never written (see below).
  // Same two values a NEW consignee opens on; see geo-defaults.
  const indCountryId = useMemo(() => defaultCountryId(countries), [countries]);
  const homeStateId = useMemo(() => defaultStateId(states, companyGstin), [states, companyGstin]);

  /** The Address block of a brand-new consignee: India, and our own state. */
  const blankForm = useMemo<HeaderForm>(
    () => ({ ...BLANK, state_id: homeStateId, country_id: indCountryId, address_country_id: indCountryId }),
    [homeStateId, indCountryId],
  );

  // PAN is characters 3-12 of the GSTIN, so filling an EMPTY PAN box cannot
  // lose information. A PAN that is already typed is never overwritten — a
  // disagreement is real signal, surfaced as a mismatch line instead.
  useEffect(() => {
    if (!gstin?.checksumValid) return;
    if (gstin.gstin === loadedGstin.current) return;
    // The "is the PAN box empty?" test reads the CURRENT form through the
    // updater rather than through `form.pan_no`, which would have to be a
    // dependency: this effect must not re-run on every PAN keystroke and
    // silently re-fill a field the user had just cleared. It used to hold the
    // PAN in a ref written during render, which `react-hooks/refs` rejects —
    // a ref read at render time gives React nothing to re-render on.
    setForm((f) => (f.pan_no.trim() ? f : { ...f, pan_no: gstin.pan }));
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

    // "differs", not "is empty": the State box now OPENS on our own state, so an
    // empty-only test would hide this chip on precisely the consignees that need
    // it — an out-of-state GSTIN beside a defaulted home state.
    if (gstinState && form.state_id !== gstinState.id) {
      out.push({
        key: "state",
        label: `Set State = ${gstinState.name}`,
        onApply: () => {
          set({ state_id: gstinState.id });
          // Toasted because the State box lives in the Address section, which
          // the user is not looking at while typing the GST number in General.
          success(`State set to ${gstinState.name} in the Address section`);
        },
      });
    }

    if (indCountryId && !form.address_country_id) {
      out.push({
        key: "country",
        label: "Set Country = India",
        onApply: () => {
          // Both columns — the single Country field in Identity drives them
          // together now (see that picker's comment).
          set({ country_id: indCountryId, address_country_id: indCountryId });
          success("Country set to India");
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
  //
  // dup-check: server-only -- advisory, so it is deliberately NOT wired through
  // dupFieldProps and never holds the cursor. The synchronous half exists to win
  // a race against Tab; there is no race here, because nothing is refused.
  const gstDup = useDuplicateCheck({
    table: "consignees",
    name: form.gst_no,
    nameColumn: "gst_no",
    excludeId: editId ?? undefined,
    enabled: !!form.gst_no.trim(),
  });

  /**
   * The NAME, unlike the GSTIN above, DOES block. Two consignees at one GSTIN
   * are legitimate (branches of one party), which is why that check stays an
   * advisory amber note; two consignees with the identical name are the same
   * record keyed twice, and every other party master already refuses it on
   * save. Backstopped by the matching guard in `consignee-actions.ts`.
   *
   * Stood down while `editOrigin` holds the name read-only — an error on a
   * field the operator cannot edit is a dead end.
   */
  const nameDupError = useDuplicateName({
    table: "consignees",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !editOrigin && !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean?" — nameDupError above only fires on an EXACT collision, so a
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.email].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditOrigin(null);
    setForm(blankForm);
    loadedGstin.current = "";
    const blankContacts = [blankContact(newKey())];
    const blankMarkings = [blankMarking(newKey())];
    const blankNotifyRefs = [blankNotifyRef(newKey())];
    setContacts(blankContacts);
    setMarkings(blankMarkings);
    setNotifyRefs(blankNotifyRefs);
    // Baseline for `dirty`. A brand-new consignee starts clean even though it
    // already holds one empty contact row, one empty marking row and a defaulted
    // Country/State — that is scaffolding the form put there, not something the
    // user typed. The seeded rows go INTO the baseline for that reason; leaving
    // them out would read as an unsaved edit and, via useUnsavedGuard, hold off
    // the PWA's silent auto-update on a record nobody had touched. Snapshotting
    // `blankForm` (not BLANK) is what keeps the defaults out of `dirty`: baseline
    // BLANK would read the two defaults as unsaved edits and, via
    // useUnsavedGuard, block the PWA's silent auto-update on this route forever.
    setPristine(snapshot(blankForm, blankContacts, blankMarkings, blankNotifyRefs));
    setPendingFetch(null);
    setOpen(true);
  }
  function openEdit(r: Consignee) {
    setEditId(r.id);
    setEditOrigin(consigneeOrigin(r));
    // One visible Country field now feeds both stored columns (see the
    // Identity section below) — `country_id` is authoritative (it is what the
    // list column, header chip and read-only view all resolve), so it wins; a
    // row saved before this fix that only ever had `address_country_id`
    // filled in still opens with a country rather than a blank picker.
    const countryId = r.country_id ?? r.address_country_id ?? "";
    const nextForm: HeaderForm = {
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      country_id: countryId,
      also_notify: r.also_notify,
      customer_id: r.customer_id ?? "",
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
    };
    // Baseline for the PAN auto-fill: opening a record must never write to it.
    loadedGstin.current = normalizeGstin(r.gst_no);
    // A contactless record opens on ONE empty contact card, exactly as `openAdd`
    // does — otherwise New and Edit of the same consignee are different forms.
    // They almost always ARE the same consignee: `normalizeContacts`
    // (consignee-actions.ts) drops all-blank rows on save, so anything created
    // without touching Contacts comes back with none, and Edit showed a one-line
    // "No contacts yet." where New had shown a full card.
    //
    // Safe on both counts that matter. The row cannot dirty the form —
    // `setPristine` below snapshots AFTER this seed, the same reasoning `openAdd`
    // spells out, and an ungated `dirty` feeds useUnsavedGuard and would block
    // the PWA's silent auto-update on this route forever. And it cannot write a
    // phantom child row, because the same normalize drops it again on save.
    const nextContacts: ContactRow[] = r.contacts.length
      ? r.contacts.map((c) => ({
          key: newKey(),
          department_id: c.department_id ?? "",
          contact_name: c.contact_name ?? "",
          designation_id: c.designation_id ?? "",
          land_line: c.land_line ?? "",
          mobile: c.mobile ?? "",
          email_id: c.email_id ?? "",
          internal_department_id: c.internal_department_id ?? "",
        }))
      : [blankContact(newKey())];
    /**
     * AN EXISTING CONSIGNEE WITH NO MARKINGS OPENS READY TO TYPE TOO — the
     * second of `erp-table-default-row`'s three statements, and the one that
     * hides, because seeding `openAdd` alone makes a NEW record look right and
     * leaves every stored record with an empty grid.
     *
     * `[]` is what "no lines yet" looks like coming back from a fetch, which is
     * exactly the state the blank row exists for. Written as the same
     * `length ? … : factory` the Contacts grid above already uses.
     *
     * It goes into `pristine` below with everything else, so a record that opens
     * holding one scaffolded row still opens CLEAN.
     */
    const storedMarkings: MarkingRow[] = r.markings.map((m) => ({
      key: newKey(),
      marking: m.marking ?? "",
    }));
    const nextMarkings = storedMarkings.length
      ? storedMarkings
      : [blankMarking(newKey())];
    /**
     * AND AN EXISTING CONSIGNEE WITH NO NOTIFY PARTIES OPENS READY TO PICK ONE
     * — statement two again, written as the same `length ? … : factory` the two
     * grids above use. Seeding `openAdd` alone would make a NEW record right
     * and leave every stored record on an empty panel, which is the half that
     * hides.
     *
     * It cannot dirty the form (`setPristine` below snapshots after this seed)
     * and it cannot write a phantom row (`normalizeNotifyRefs` drops it again
     * on save).
     */
    const storedNotifyRefs: NotifyRefRow[] = r.notify_refs.map((n) => ({
      key: newKey(),
      notify_id: n.notify_id ?? "",
    }));
    const nextNotifyRefs = storedNotifyRefs.length
      ? storedNotifyRefs
      : [blankNotifyRef(newKey())];
    setForm(nextForm);
    setContacts(nextContacts);
    setMarkings(nextMarkings);
    setNotifyRefs(nextNotifyRefs);
    setPristine(snapshot(nextForm, nextContacts, nextMarkings, nextNotifyRefs));
    setPendingFetch(null);
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
    setMarkings((ms) => [...ms, blankMarking(newKey())]);
  }
  function setMarkingAt(key: string, marking: string) {
    setMarkings((ms) => ms.map((m) => (m.key === key ? { ...m, marking } : m)));
  }
  function removeMarking(key: string) {
    setMarkings((ms) => ms.filter((m) => m.key !== key));
  }

  function addNotifyRef() {
    setNotifyRefs((ns) => [...ns, blankNotifyRef(newKey())]);
  }
  function setNotifyRefAt(key: string, notify_id: string) {
    setNotifyRefs((ns) => ns.map((n) => (n.key === key ? { ...n, notify_id } : n)));
  }
  function removeNotifyRef(key: string) {
    setNotifyRefs((ns) => ns.filter((n) => n.key !== key));
  }

  // ------------------------------------------------ Fetch from Customer ----
  // Ticking Customer ▸ Also Consignee publishes this row (0371), but the seed
  // is twelve address scalars copied once at birth — the Customer's General tab
  // and its Contact and Marking grids never crossed, and neither does anything
  // typed on the Customer afterwards. This is the way to go and get them.
  //
  // Straight out of the `customers` prop, which the masters page already loads
  // in full — contacts and markings embedded (lib/masters/customer-service.ts).
  // No server action, no round trip, the same way every other pick-then-fill in
  // this app works (orders/process-amendments, orders/ta-plan).

  /**
   * The customer to fetch FROM: the ordinary `customer_id` picker, which a
   * published consignee already has filled in for it (customer-actions seeds it
   * at publish time) and an ordinary one gets the moment the operator picks.
   * One control therefore serves both, with no branch on `source_customer_id`.
   */
  const fetchSource = useMemo(
    () => customers.find((c) => c.id === form.customer_id) ?? null,
    [customers, form.customer_id],
  );

  /** "Street, Pin and 2 more, plus 3 contact rows" — what Confirm would undo. */
  function replaceSummary(plan: FetchPlan): string {
    const bits: string[] = [];
    if (plan.replaces.length) bits.push(describeFields(plan.replaces));
    if (plan.replacedContacts) bits.push(`${plan.replacedContacts} contact row(s)`);
    if (plan.replacedMarkings) bits.push(`${plan.replacedMarkings} marking row(s)`);
    return bits.join(", ");
  }

  /**
   * Write the plan into the OPEN FORM — never to the database. The operator
   * reviews it and presses Save, or walks away and loses nothing. Every write
   * goes through the ordinary setters, so the `snapshot` compare marks the form
   * dirty by itself and `useUnsavedGuard` covers the auto-reload with no extra
   * wiring.
   */
  function applyFetch(plan: FetchPlan, from: string) {
    set(plan.patch);
    // Fresh keys: these are new rows as far as React is concerned, and a key is
    // minted once per row and never reused.
    if (plan.contacts) {
      setContacts(plan.contacts.map((c) => ({ ...c, key: newKey() })));
    }
    if (plan.markings) {
      setMarkings(plan.markings.map((marking) => ({ key: newKey(), marking })));
    }
    setPendingFetch(null);
    const parts: string[] = [];
    // Counted in LABELS, not patch keys: Country writes two columns from one
    // picker, and reporting that as two changes would just read as a bug.
    const fields = plan.fills.length + plan.replaces.length;
    if (fields) parts.push(`${fields} field(s)`);
    if (plan.contacts) parts.push(`${plan.contacts.length} contact(s)`);
    if (plan.markings) parts.push(`${plan.markings.length} marking(s)`);
    success(`Fetched ${parts.join(", ")} from ${from} — review, then save.`);
  }

  function fetchFromCustomer() {
    if (!fetchSource) return;
    const plan = diffFetch(
      fetchableFields(form),
      fetchableContacts(contacts),
      markings.map((m) => m.marking),
      customerToConsigneeFields(fetchSource),
    );
    // Say so out loud. A button that silently does nothing reads as broken.
    if (plan.empty) {
      success(`Nothing to fetch — this already matches ${fetchSource.name}.`);
      return;
    }
    // Filling empty boxes needs no permission; overwriting an answer does.
    if (plan.replaces.length || plan.replacedContacts || plan.replacedMarkings) {
      setPendingFetch(plan);
      return;
    }
    applyFetch(plan, fetchSource.name);
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
    // A published row is owned by its source: deleting it here while the tick
    // box stayed on would just republish it on that record's next save.
    const origin = consigneeOrigin(r);
    if (origin) {
      error(originDeleteBlock(origin));
      return;
    }
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
    {
      header: "Name",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {r.name}
          <OriginBadge origin={consigneeOrigin(r)} />
          <PublishesBadge roles={r.also_notify ? [PARTY_ROLE.notify] : []} />
        </span>
      ),
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
    rowActionsColumn((r) => (
      <RowActions
        label={r.name}
        onView={() => setViewRow(r)}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
  ];

  /**
   * Unsaved-work tracking. The editor is a `MasterFullScreen`, which registers
   * itself with the reload guard as an open MODAL — but "a modal is open" is not
   * "there is work to lose", and this screen never declared the second
   * (AGENTS.md, STANDING). A deploy landing on a half-keyed consignee would take
   * it silently.
   *
   * `useState`, never a `useRef`: the baseline changes on an EVENT (opening a
   * record), and a ref read during render gives React nothing to re-render on,
   * so the `● Unsaved` badge would go stale.
   */
  const [pristine, setPristine] = useState("");
  // Gated on `open`: the baseline is only taken when an editor opens, so on a
  // closed list page `pristine` is still "" and the compare would report the
  // untouched BLANK form as dirty — arming the reload guard for a screen with
  // nothing to lose.
  const dirty = open && snapshot(form, contacts, markings, notifyRefs) !== pristine;
  useUnsavedGuard(dirty || isPending);

  const initials = (form.code || form.name || "?").slice(0, 2).toUpperCase();

  /**
   * The record as a READER sees it. Mirrors the editor's rail — Identity ·
   * Address · General · Notify — so the view and the form tell the same story,
   * and every FK is resolved to the name the picker would have shown.
   *
   * Nothing here filters empties: `RecordViewSheet` drops an empty value and an
   * all-empty section on its own. The three child cards are the exception —
   * they are `content`, which is never auto-hidden, so each is built as
   * `undefined` when the card holds nothing rather than as an empty list.
   */
  function viewSectionsFor(r: Consignee): ViewSection[] {
    const viewOrigin = consigneeOrigin(r);
    const contactRows = r.contacts
      .map((c) => {
        const who = [c.contact_name?.trim(), nameOf(c.designation_id), nameOf(c.department_id)]
          .filter(Boolean)
          .join(" · ");
        const reach = [
          c.mobile?.trim(),
          c.land_line?.trim(),
          c.email_id?.trim(),
          nameOf(c.internal_department_id),
        ]
          .filter(Boolean)
          .join(" · ");
        // A contact with no name at all still has to say something, so its
        // phone/email is promoted to the main line rather than sitting alone
        // in the muted column.
        return { key: c.id, main: who || reach, detail: who ? reach : "" };
      })
      .filter((c) => c.main);

    const markingRows = r.markings
      .map((m) => ({ key: m.id, main: m.marking?.trim() ?? "" }))
      .filter((m) => m.main);

    const notifyRows = r.notify_refs
      .map((n) => {
        const country = n.notify_id ? (notifyCountryLabel.get(n.notify_id) ?? "") : "";
        return {
          key: n.id,
          main: nameOf(n.notify_id),
          // notifyCountryLabel prints "—" for a notify with no country; that is
          // a placeholder for an input, not a fact worth repeating here.
          detail: country === "—" ? "" : country,
        };
      })
      .filter((n) => n.main);

    return [
      {
        label: "Identity",
        pairs: [
          ["Country", r.country_id ? (countryLabel.get(r.country_id) ?? "") : ""],
          ["Customer", r.customer_id ? (customerLabel.get(r.customer_id) ?? "") : ""],
          ["Also Notify", r.also_notify ? "Yes" : "No"],
          // Only when it IS published — an empty row on an ordinary consignee
          // would invite "published by what?" for no reason.
          ...(viewOrigin
            ? [[`From ${viewOrigin.from}`, `${viewOrigin.name} (${viewOrigin.flag})`] as const]
            : []),
        ],
      },
      {
        label: "Address",
        // No "Country" pair here — it lived under Identity above until the
        // single-Country-field fix (2026-07-31); `address_country_id` is kept
        // in sync with `country_id` and would only repeat that line.
        pairs: [
          ["Street", r.street],
          ["City", nameOf(r.city_id)],
          ["State", nameOf(r.state_id)],
          ["Pin", r.pin],
          ["Land Line", r.land_line],
          ["Mobile", r.mobile],
          // A stored NULL means "same as mobile" — saying so beats printing the
          // same number twice, and beats an empty row that reads as "unknown".
          ["WhatsApp", r.whatsapp ?? (r.mobile ? "Same as mobile" : "")],
          ["E-Mail", r.email],
          ["Web site", r.web_site],
        ],
        content:
          contactRows.length > 0 ? (
            <ChildList label="Contact" rows={contactRows} />
          ) : undefined,
      },
      {
        label: "General",
        pairs: [
          // The three currency columns store the CODE, which is what identifies
          // a currency on a document — no lookup needed, and none wanted.
          ["Currency 1", r.currency_1],
          ["Currency 2", r.currency_2],
          ["Currency 3", r.currency_3],
          ["Ship Mode", r.ship_mode],
          ["Ship Type", nameOf(r.ship_type_id)],
          ["Pay Mode", r.pay_mode],
          ["Payment Terms", nameOf(r.payment_term_id)],
          ["Bank", nameOf(r.bank_id)],
          ["A/c No.", r.ac_no],
          ["TIN No.", r.tin_no],
          ["CST No.", r.tin_no_2],
          ["PAN No", r.pan_no],
          // The number itself, not the GstinInsight strip: that strip is an
          // input-time aid (decode, mismatch, "apply this") and none of it is a
          // fact about the record.
          ["GST No", r.gst_no],
        ],
        content:
          markingRows.length > 0 ? <ChildList label="Marking" rows={markingRows} /> : undefined,
      },
      {
        label: "Notify",
        content:
          notifyRows.length > 0 ? (
            <ChildList label="Notify Parties" rows={notifyRows} />
          ) : undefined,
      },
    ];
  }

  // Completion dots on the rail — "this section has data", not "this section is
  // valid". Name is the only required field on the whole form.
  const done = {
    identity: !!(form.name.trim() || form.country_id || form.customer_id || form.also_notify),
    address: !!(
      form.street.trim() ||
      form.city_id ||
      // Compared against the DEFAULT, not against empty. These two boxes arrive
      // pre-filled with our own State/Country now, and a rail dot that lights
      // before the operator has typed anything reads as "Address is done" on a
      // section holding no address at all.
      form.state_id !== blankForm.state_id ||
      form.pin.trim() ||
      form.address_country_id !== blankForm.address_country_id ||
      form.land_line.trim() ||
      form.mobile.trim() ||
      form.email.trim() ||
      form.web_site.trim() ||
      contacts.some(
        (c) => c.contact_name.trim() || c.department_id || c.designation_id || c.email_id.trim(),
      )
    ),
    general: !!(
      form.currency_1 ||
      form.currency_2 ||
      form.currency_3 ||
      form.ship_mode ||
      form.ship_type_id ||
      form.pay_mode ||
      form.payment_term_id ||
      form.bank_id ||
      form.ac_no.trim() ||
      form.tin_no.trim() ||
      form.tin_no_2.trim() ||
      form.pan_no.trim() ||
      form.gst_no.trim() ||
      markings.some((m) => m.marking.trim())
    ),
    notify: notifyRefs.some((n) => n.notify_id),
  };

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* caps-input: exempt -- a search QUERY is not a stored value. */}
        <Input uppercase={false}
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
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No consignees yet." />
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
                    {consigneeOrigin(r) ? ` · from ${consigneeOrigin(r)?.from}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
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
      <MasterFullScreen
        open={open}
        onClose={() => setOpen(false)}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">{form.name.trim() || "consignee"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled consignee",
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
              {form.also_notify && <span>· Also notify</span>}
              {form.customer_id && customerLabel.get(form.customer_id) && (
                <span>· {customerLabel.get(form.customer_id)}</span>
              )}
            </>
          ),
        }}
        footer={{
          status: dirty ? "Unsaved changes" : undefined,
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          saveLabel: "Save consignee",
          canSave: !!form.name.trim() && !nameDupError,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          draftLabel: "Save as Draft",
          isPending,
        }}
        sections={[
          {
            key: "identity",
            label: "Identity",
            icon: User,
            done: done.identity,
            content: (
              <SectionBody title="Identity">
                {/* ONE `FieldRow`, laid out by WIDTHS — `IDENTITY_W` at the top
                    of this file carries the row's arithmetic. Every label is
                    `Field`'s, so the pickers are all `compact`: CountryPicker
                    and CustomerPicker render their OWN <Label> otherwise, and
                    this screen used to mix the two idioms — Country
                    self-labelled while Customer was wrapped, so the two labels
                    sat at different offsets.

                    `align="start"`, not `FieldRow`'s default `items-end`: Name
                    renders a `DuplicateError` and a `SpellSuggestHint` BELOW its
                    control, and bottom alignment measures from the bottom — so
                    the moment either appears it would lift the Name box clear of
                    the boxes beside it. They appear WHILE TYPING, which is worse
                    than a hint that is simply there: the row would settle at one
                    height and then jump. Nothing here has the opposite hazard —
                    every label sits in a cell wide enough for it, so none wraps.
                    Same choice, for the same reason, as the Address row below. */}
                <FieldRow align="start">
                    <Field
                      label="Name"
                      required
                      w={IDENTITY_W.name}
                      htmlFor="cn-name"
                    >
                      {/* `readOnly`, not `disabled`: the value still submits and
                          still copies, and Input's own readOnly sets
                          tabIndex={-1}, so it leaves the Tab order for free.

                          Why the origin note is a `title` and not `Field`'s
                          `hint`: `hint` renders a <p> INSIDE this cell, and a
                          grid row is as tall as its tallest item — so a
                          published consignee's Identity row stood ~18px taller
                          than an ordinary one's, and taller than the same row
                          on the New form. The fact is already on screen as the
                          "from Applicant" chip in the header (OriginBadge), so
                          the note only has to be reachable, not permanent. */}
                      <Input
                        id="cn-name"
                        uppercase
                        readOnly={!!editOrigin}
                        title={editOrigin ? originNameHint(editOrigin) : undefined}
                        value={form.name}
                        onChange={(e) => set({ name: e.target.value })}
                        required
                        // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                        onKeyDown={nameSuggest.onKeyDown}
                        {...dupFieldProps(nameDupError, "cn-name")}
                      />
                      <DuplicateError error={nameDupError} id="cn-name" />
                      <SpellSuggestHint
                        suggestions={nameSuggest.suggestions}
                        existing={nameSuggest.existing}
                        activeIndex={nameSuggest.activeIndex}
                        duplicate={!!nameDupError}
                        onApply={(v) => setForm((f) => ({ ...f, name: v }))}
                      />
                    </Field>
                    {/* No `required` marker, unlike the asterisk CountryPicker
                        prints for itself: `country_id` is nullable in
                        consigneeInput and Save is gated on the name alone, so
                        the marker was never true here.
                        The ONLY Country field on this form now (client
                        complaint 2026-07-31: two boxes both labelled "Country"
                        read as a duplicate). It writes BOTH `country_id` and
                        `address_country_id` — see the Address section below,
                        which used to carry its own picker for the second
                        column. */}
                    <Field label="Country" w={IDENTITY_W.country_id}>
                      <CountryPicker
                        countries={countries}
                        value={form.country_id || null}
                        onChange={(id) => set({ country_id: id, address_country_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Customer" w={IDENTITY_W.customer_id}>
                      <CustomerPicker
                        customers={customers}
                        value={form.customer_id || null}
                        // Drops any pending fetch confirm: it was computed
                        // against the customer being replaced, and confirming
                        // it afterwards would copy the wrong record's details.
                        onChange={(id) => {
                          set({ customer_id: id ?? "" });
                          setPendingFetch(null);
                        }}
                        compact
                      />
                    </Field>
                    <Field label="Also Notify" w={IDENTITY_W.also_notify} htmlFor="cn-alsonotify">
                      <Select
                        id="cn-alsonotify"
                        value={form.also_notify ? "yes" : "no"}
                        onChange={(e) => set({ also_notify: e.target.value === "yes" })}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </Select>
                    </Field>
                    {/* Edit only, so it takes a short SECOND row rather than a
                        share of the first — row 1 then looks identical in New
                        and in Edit. It used to sit outside the track entirely,
                        which cost Edit a `space-y-4` gap plus a loose row that
                        started at the grid's left edge and left 9 of 12 columns
                        empty: the "extra space in the edit form" the client
                        reported (2026-07-31).

                        IT IS NOT A SECOND ROW ANY MORE. That note describes the
                        twelfths, where four fields at 3 filled row 1 exactly and
                        left this switch nowhere to go but a line of its own with
                        three quarters of it empty — the same hole one step in.
                        Off the track (`IDENTITY_W`) the row is 894px of six
                        cells, which clears the narrowest content width this app
                        gets (1142, on a 1366 laptop — `GENERAL_W` derives it),
                        so the switch simply follows Also Notify on the SAME line
                        and New and Edit differ by one cell rather than by a row.

                        The objection to putting it in the track was real — a
                        bare switch has no <Label> above it, so it would align
                        to its neighbours' LABELS rather than their controls.
                        `Toggle`'s own `min-h-9` and the `label=""` below are
                        the two halves of the answer. */}
                    {/* `Toggle`, NOT A TICK BOX (client 2026-09-08: the same switch Order
                        Entry uses) — the identical swap Country, Destination and Notify
                        made, and from the SAME component, so no two masters can drift
                        apart. It is still a real `<input type="checkbox">` underneath
                        (`components/ui/toggle.tsx` says why at length), so `isFieldLike()`
                        still counts it and Tab, Enter-advance and the arrows all reach it.

                        `label=""` RESERVES the label row rather than drawing one: a cell
                        with no label at all collapses it and lifts the switch ~16px above
                        the labelled fields beside it — and `align="start"` on the row makes
                        that WORSE rather than moot, since a cell with no label now starts
                        its control at the row's very top. The switch renders its own word,
                        so a `label="Inactive"` here would draw the name twice.

                        NO `w`: a switch is not one of the five widths, and an unsized
                        `Field` in a flex row is exactly as wide as what is in it. */}
                    {editId && (
                      <Field label="">
                        <Toggle
                          id="cn-inactive"
                          label="Inactive"
                          checked={form.inactive}
                          onChange={(inactive) => set({ inactive })}
                        />
                      </Field>
                    )}
                    {/* The row's last cell. `label=""`, not an absent label: the
                        button says what it does and a word above it would only
                        repeat the words underneath, but the label ROW still has
                        to be reserved or `align="start"` stands the button ~16px
                        proud of the fields beside it — the same fix, for the same
                        reason, as the switch above.

                        NO `w`, IN EITHER STATE, and the two states want it for
                        opposite reasons. Idle it is a button, which is not one of
                        the five widths: unsized, it shrink-wraps to its own label
                        (~190px), which is rule 1 exactly — at `term` (176) the
                        label would wrap to two lines and the button would stand
                        taller than every input on the row. Confirming it is a
                        sentence and two buttons, and the sentence is as long as
                        the fetch plan is — there is no width the vocabulary can
                        name for it, so it takes the line it needs and wraps onto
                        its own when the plan is a long one. */}
                    <Field label="">
                      {pendingFetch ? (
                        <div className="flex min-h-9 flex-wrap items-center gap-1">
                          <span className="text-xs text-muted-foreground">
                            Replace {replaceSummary(pendingFetch)}?
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPendingFetch(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => applyFetch(pendingFetch, fetchSource?.name ?? "Customer")}
                          >
                            Confirm
                          </Button>
                        </div>
                      ) : (
                        // The `title` sits on a WRAPPER, and that span is the
                        // whole reason it exists: button.tsx pins
                        // `disabled:pointer-events-none`, so a tooltip on the
                        // disabled control — exactly when the operator needs to
                        // be told to pick a Customer first — would never open.
                        // Same trick as OriginBadge.
                        <span
                          // `inline-block` so this wrapper is exactly as wide as
                          // the button it holds. It used to be `block` with a
                          // `w-full` button inside, which is what a twelfths CELL
                          // wanted — off the track the button sets its own width
                          // and a `block` span would stretch the flex item to the
                          // row's leftover space instead.
                          className="inline-block"
                          title={
                            fetchSource
                              ? `Copy the address, the General fields, the Contacts and the Markings from ${fetchSource.name}. Nothing is saved until you press Save, and an empty field on the Customer never clears a filled one here.`
                              : "Pick a Customer first — that is the record the details come from."
                          }
                        >
                          {/* `type="button"`, explicitly: a default-type button
                              inside a form is a SUBMIT, so Enter reaching the
                              form would fire this instead of the save.

                              No `min-h-9`: the default `md` size already tracks
                              the inputs beside it, including the drop to 32px
                              inside the editor's compact-density container. A
                              hand-set height would put it 4px proud of them. */}
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!fetchSource}
                            onClick={fetchFromCustomer}
                          >
                            <DownloadCloud />
                            Fetch from Customer
                          </Button>
                        </span>
                      )}
                    </Field>
                </FieldRow>
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
                <div className="space-y-4">
                  {/* ONE wrapping `FieldRow`, laid out by WIDTHS — see `ADDRESS_W`
                      above for the bands and the arithmetic. It replaces four rows
                      of the 12-col track, on which every value from a six-digit PIN
                      to the street itself took the same ~340px twelfth.

                      `align="start"`, and this row has the hazard that choice is
                      for: WhatsApp renders a "Same as mobile" tick BELOW its
                      control, and both `ValidatedInput` cells can render a format
                      message there too. `items-end` measures from the bottom, so
                      those cells would sit their LABEL a line above every other
                      label on the row. Nothing here has the opposite hazard — the
                      longest label is "Land Line" at ~55px inside a 144px box, so
                      no label wraps. */}
                  <FieldRow align="start">
                    {/* A single-line Input, not the 3-row Textarea this used to be:
                        a 96px-tall cell sharing a line of 32px controls sets that
                        line's height and leaves City / State / Pin standing above a
                        band of dead space. Stored newlines survive. */}
                    <Field label="Street" w={ADDRESS_W.street} htmlFor="cn-street">
                      <Input
                        uppercase
                        id="cn-street"
                        value={form.street}
                        onChange={(e) => set({ street: e.target.value })}
                      />
                    </Field>
                    <Field label="City" w={ADDRESS_W.city_id}>
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
                    <Field label="State" w={ADDRESS_W.state_id}>
                      <StatePicker
                        label="State"
                        options={states}
                        value={form.state_id || null}
                        onChange={(id) => set({ state_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Pin" w={ADDRESS_W.pin} htmlFor="cn-pin">
                      <Input
                        id="cn-pin"
                        value={form.pin}
                        onChange={(e) => set({ pin: e.target.value })}
                      />
                    </Field>
                    {/* Country used to have its OWN field here, bound to
                        `address_country_id` — right beside Identity's
                        `country_id` one, the same country asked twice. The
                        column still exists in the DB (data-io round-trips it,
                        and old rows may only have this one filled in) but it
                        is now written from the single Identity Country picker
                        above, not from a visible field here. Do not add this
                        field back without re-reading that picker's comment
                        first. */}
                    <Field label="Land Line" w={ADDRESS_W.land_line} htmlFor="cn-landline">
                      <Input
                        id="cn-landline"
                        value={form.land_line}
                        onChange={(e) => set({ land_line: e.target.value })}
                      />
                    </Field>
                    {/* Two cells, not one — so the WIDTH goes to each of them via
                        `cellClassName`; there is no wrapper to put it on, and that
                        missing wrapper is the whole point of the component.

                        `FIELD_WIDTH[...]` is the same table `Field w=` reads, so the
                        pair cannot drift from the fields beside it — and it is
                        Tailwind-safe: v4 scans SOURCE TEXT, and `"w-44"` is a
                        literal in `field.tsx`. What that forbids is BUILDING a class,
                        not reading one out of a map of literals. */}
                    <MobileWhatsAppFields
                      idPrefix="cn"
                      mobile={form.mobile}
                      whatsapp={form.whatsapp}
                      isdCode={isdOf.get(form.address_country_id) ?? null}
                      onMobileChange={(v) => set({ mobile: v })}
                      onWhatsAppChange={(v) => set({ whatsapp: v })}
                      cellClassName={FIELD_WIDTH[ADDRESS_W.contact]}
                    />
                    <Field label="E-Mail" w={ADDRESS_W.email} htmlFor="cn-email">
                      <ValidatedInput
                        format="email"
                        id="cn-email"
                        value={form.email}
                        onChange={(e) => set({ email: e.target.value })}
                      />
                    </Field>
                    <Field label="Web site" w={ADDRESS_W.web_site} htmlFor="cn-web">
                      <ValidatedInput
                        format="website"
                        id="cn-web"
                        value={form.web_site}
                        onChange={(e) => set({ web_site: e.target.value })}
                      />
                    </Field>
                  </FieldRow>

                  {/* Contact grid — CAPPED, not stretched (`erp-form-compact`
                      rule 4: a sub-grid is capped to the FORM's width, not the
                      screen's). See `CONTACT_W` for the arithmetic. A `max-w`, so
                      the box still shrinks on a narrow pane. */}
                  <div className={`rounded-lg border border-border ${CONTACT_W}`}>
                    <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                      Contact
                    </div>
                    <div className="space-y-3 p-3">
                      {contacts.length === 0 && (
                        <p className="text-xs text-muted-foreground">No contacts yet.</p>
                      )}
                      {/* No inner scroll — see ChildGrid's `pageSize` note: no
                          scroll-in-a-box. One contact card is already taller than
                          the old max-h-56, so even a single contact had to be
                          scrolled to be read (client 2026-07-30). */}
                      <div data-grid-body onKeyDown={(e) => gridKeyNav(e)} className="space-y-3">
                      {contacts.map((c, i) => (
                        <div data-grid-row data-row-box key={c.key} className="space-y-2 rounded-md border border-border p-2.5">
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
                          {/* ONE wrapping `FieldRow` per contact, laid out by
                              WIDTH — see `CONTACT_FIELD_W` for the steps and the
                              two 600px lines it wraps into. Every control here was
                              `w-full` inside a card the width of the pane, so a
                              Land Line box came out ~1400px wide: rule 1 ("no
                              field fills the column it happens to sit in"), one
                              card in from the section above.

                              LABELS, NOT PLACEHOLDERS, on the four boxes that
                              carried one. Half these cells already labelled
                              themselves (the pickers) while the other half named
                              themselves in grey text a typed value erases —
                              readable while every field stood on its own line, and
                              unreadable the moment three of them share one. */}
                          <FieldRow align="start">
                            <Field label="Department" w={CONTACT_FIELD_W.department}>
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
                            <Field label="Contact Name" w={CONTACT_FIELD_W.contact_name}>
                              <Input
                                uppercase
                                value={c.contact_name}
                                onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })}
                              />
                            </Field>
                            <Field label="Designation" w={CONTACT_FIELD_W.designation}>
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
                            <Field label="Land Line" w={CONTACT_FIELD_W.land_line}>
                              <Input
                                value={c.land_line}
                                onChange={(e) => setContactAt(c.key, { land_line: e.target.value })}
                              />
                            </Field>
                            <Field label="Mobile" w={CONTACT_FIELD_W.mobile}>
                              <Input
                                value={c.mobile}
                                onChange={(e) => setContactAt(c.key, { mobile: e.target.value })}
                              />
                            </Field>
                            {/* `align="start"` above is for this cell: a
                                `ValidatedInput` renders its format message BELOW
                                the control, and bottom alignment measures from the
                                bottom of that — so a badly-typed address would
                                lift this label a line above every other label on
                                the row. */}
                            <Field label="Email ID" w={CONTACT_FIELD_W.email_id}>
                              <ValidatedInput
                                format="email"
                                value={c.email_id}
                                onChange={(e) => setContactAt(c.key, { email_id: e.target.value })}
                              />
                            </Field>
                            <Field label="Internal Department" w={CONTACT_FIELD_W.internal_department}>
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
                          </FieldRow>
                        </div>
                      ))}
                      </div>
                      <Button type="button" variant="outline" size="sm" data-row-add onClick={addContact}>
                        + Add contact
                      </Button>
                    </div>
                  </div>
                </div>
              </SectionBody>
            ),
          },
          {
            key: "general",
            label: "General",
            icon: SlidersHorizontal,
            done: done.general,
            content: (
              <SectionBody title="General">
                <div className="space-y-4">
                  {/* ONE ROW AND NOW ONE LINE — `nowrap`, all nine fields from
                      Currency 1 to A/c No. (client 2026-09-09). The widths, the
                      client's own pixel bands and the arithmetic are all above
                      `GENERAL_W`: 1072px of controls, 1152px with the gaps.

                      DO NOT RE-STATE THAT TOTAL ANYWHERE ELSE. It has already
                      been wrong once here — this comment said 984 and 1064 for
                      several hours after Payment Terms and Bank were widened,
                      because the number was copied to a second place and only
                      one of them was maintained. The map is the one that gets
                      updated; this points at it.

                      THE BREAK IS GONE RATHER THAN MOVED. It was counted first
                      (3+3+3+3 filled row 1 and A/c No. trailed alone on row 3),
                      then derived from the widths against a 656px cap (two lines,
                      goods then payment). There is no third line and no second
                      one: `nowrap` pins the row. Below the width it needs
                      `FieldRow` scrolls it sideways instead of folding it, and
                      that width is a VIEWPORT of 1376 — see the table above
                      `GENERAL_W`, and note a 1366 laptop is ten pixels short.

                      `nowrap` IS THE OPT-IN THE PRIMITIVE CALLS RARE, and the
                      two things it asks are both true here. Every field carries
                      an explicit width, so `[&>*]:shrink-0` has something to hold
                      them at; and every picker on the row portals its panel, so
                      the `overflow-x-auto` container cannot clip an open list.

                      The default `items-end`: nothing on this row renders
                      anything below its control, and every label fits its own
                      cell on one line — "Payment Terms", the longest, is ~88px
                      inside 144, and "Currency 1" is ~58px inside 72. */}
                  <FieldRow nowrap>
                    <Field label="Currency 1" w={GENERAL_W.currency}>
                      <CurrencyPicker
                        label="Currency"
                        compact
                        currencies={currencies}
                        value={form.currency_1 || null}
                        onChange={(code) => set({ currency_1: code })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                      />
                    </Field>
                    <Field label="Currency 2" w={GENERAL_W.currency}>
                      <CurrencyPicker
                        label="Currency"
                        compact
                        currencies={currencies}
                        value={form.currency_2 || null}
                        onChange={(code) => set({ currency_2: code })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                      />
                    </Field>
                    <Field label="Currency 3" w={GENERAL_W.currency}>
                      <CurrencyPicker
                        label="Currency"
                        compact
                        currencies={currencies}
                        value={form.currency_3 || null}
                        onChange={(code) => set({ currency_3: code })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                      />
                    </Field>
                    <Field label="Ship Mode" w={GENERAL_W.ship_mode} htmlFor="cn-shipmode">
                      <Select
                        id="cn-shipmode"
                        value={form.ship_mode}
                        onChange={(e) => set({ ship_mode: e.target.value })}
                      >
                        <option value=""></option>
                        {SHIP_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {/* `compact` — NOT `label=""` — on every picker below. Both hide
                        the picker's own <Label> so only <Field>'s remains (that is
                        the one carrying htmlFor and aligning the required marker),
                        but they are not interchangeable:
                          - `compact` suppresses the <Label> element entirely.
                          - `label=""` leaves the element rendering EMPTY, and an
                            empty <Label> still contributes its line-height, so the
                            control drops a row below its neighbours
                            (see lookup-picker.tsx:247).
                        And `label` is read for much more than the visible label —
                        the trigger placeholder ("— Select Ship Type —"), the
                        aria-label, the dialog title, the Add/Modify toasts and the
                        empty-state text. Blanking it degrades all five. Keep the
                        real text and pass `compact`. */}
                    <Field label="Ship Type" w={GENERAL_W.ship_type_id}>
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
                    </Field>

                    <Field label="Pay Mode" w={GENERAL_W.pay_mode} htmlFor="cn-paymode">
                      <Select
                        id="cn-paymode"
                        value={form.pay_mode}
                        onChange={(e) => set({ pay_mode: e.target.value })}
                      >
                        <option value=""></option>
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
                    <Field label="Payment Terms" w={GENERAL_W.payment_term_id}>
                      <PaymentTermPicker
                        label="Payment Term"
                        options={paymentTerms}
                        value={form.payment_term_id || null}
                        onChange={(id) => set({ payment_term_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        compact
                      />
                    </Field>
                    <Field label="Bank" w={GENERAL_W.bank_id}>
                      <BankPicker
                        banks={banks}
                        value={form.bank_id || null}
                        onChange={(id) => set({ bank_id: id })}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        compact
                      />
                    </Field>
                    <Field label="A/c No." w={GENERAL_W.ac_no} htmlFor="cn-acno">
                      <Input
                        uppercase
                        id="cn-acno"
                        value={form.ac_no}
                        onChange={(e) => set({ ac_no: e.target.value })}
                      />
                    </Field>
                  </FieldRow>

                  {/* Marking grid, capped to its own row — see `MARKING_W`. */}
                  <div className={`rounded-lg border border-border ${MARKING_W}`}>
                    <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                      Marking
                    </div>
                    <div className="space-y-2 p-3">
                      {/* NO "No markings yet." LINE. It used to render under
                          `markings.length === 0`, and that condition is now
                          unreachable by construction — the grid is seeded at the
                          mount, in `openAdd` and on an `openEdit` that came back
                          with nothing (`erp-table-default-row`). A prose empty
                          state kept beside a grid that cannot be empty is a
                          branch the next reader has to disprove. */}
                      {/* No inner scroll — see ChildGrid's `pageSize` note. */}
                      <div className="space-y-2">
                      {markings.map((m, i) => (
                        <div key={m.key} className="flex items-center gap-2">
                          <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">
                            {i + 1}
                          </span>
                          {/* `w-72` (288, the `name` step) and `shrink-0`, not
                              the `w-full` `Input` ships with: in this flex row a
                              full-width box grows to whatever the card allows, so
                              capping the card alone would have moved the ✕ and
                              left the value floating in the same surplus one
                              level down. See `MARKING_W` for the row it makes. */}
                          <Input
                            uppercase
                            placeholder="Marking"
                            value={m.marking}
                            onChange={(e) => setMarkingAt(m.key, e.target.value)}
                            className="w-72 shrink-0"
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

                  {/* Registration — `REGISTRATION_BOX_W`, the same cap the field
                      row above takes, so the two end on one edge. */}
                  <div className={`rounded-lg border border-border ${REGISTRATION_BOX_W}`}>
                    <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                      Registration
                    </div>
                    {/* The four registration numbers still share ONE row, and it
                        now ends after the fourth of them instead of filling the
                        card: four identifiers none longer than a 15-character
                        GSTIN were 3 of 12 each, ~278px apiece. See
                        `REGISTRATION_W`.

                        `align="start"`: PAN and GST are `ValidatedInput`s, which
                        render their format message BELOW the control, and
                        `items-end` measures from the bottom of that — so the
                        first mistyped GSTIN would lift its box clear of the three
                        beside it while the operator is still in the row.

                        THE TWO STRIPS BELOW TAKE `w-full`, NOT `size="full"`.
                        That prop is a `col-span`, and a col-span in a flex row is
                        inert — the strips would have packed inline as two more
                        cells. It is the same class of trap field.tsx's header
                        records for `sm:col-span-2`, one track along: a span that
                        means "the whole row" in the grid it was written for and
                        nothing at all in the one it was moved to. */}
                    <div className="p-3">
                      <FieldRow align="start">
                        <Field label="TIN No." w={REGISTRATION_W.tin_no}>
                          <Input uppercase value={form.tin_no} onChange={(e) => set({ tin_no: e.target.value })} />
                        </Field>
                        <Field label="CST No." w={REGISTRATION_W.tin_no_2}>
                          <Input uppercase value={form.tin_no_2} onChange={(e) => set({ tin_no_2: e.target.value })} />
                        </Field>
                        <Field label="PAN No" w={REGISTRATION_W.pan_no} htmlFor="cn-pan">
                          <ValidatedInput
                            id="cn-pan"
                            format="pan"
                            value={form.pan_no}
                            onChange={(e) => set({ pan_no: e.target.value })}
                          />
                        </Field>
                        <Field label="GST No" w={REGISTRATION_W.gst_no} htmlFor="cn-gst">
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
                          <Field className="w-full -mt-1">
                            <GstinInsight
                              decoded={gstin}
                              panValue={form.pan_no}
                              suggestions={gstinSuggestions}
                            />
                          </Field>
                        )}

                        {/* A WARNING, AND IT MUST STAY ONE. Deliberately not
                            `dupFieldProps` / `<DuplicateError>`: a second
                            consignee at one GSTIN is legitimate (branches, a
                            re-keyed party), which is why `canSave` is not gated
                            on `gstDup` either. Converting this would promote a
                            hint into a keyboard hold and cage the operator on a
                            field they have every right to leave. The hold is
                            only ever for an error that actually blocks Save. */}
                        {gstDup && (
                          <Field className="w-full -mt-1">
                            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                              <TriangleAlert className="h-4 w-4 shrink-0" />
                              Another consignee already carries this GST number — check you are not
                              keying the same party twice.
                            </p>
                          </Field>
                        )}
                      </FieldRow>
                    </div>
                  </div>
                </div>
              </SectionBody>
            ),
          },
          {
            key: "notify",
            label: "Notify",
            icon: Bell,
            done: done.notify,
            content: (
              <SectionBody title="Notify">
                {/* Capped to the FORM's width, not the screen's (`erp-form-compact`
                    rule 4). See `NOTIFY_W` for the arithmetic and both bounds. A
                    `max-w`, so a narrow pane still shrinks it. */}
                <div className={`rounded-lg border border-border ${NOTIFY_W}`}>
                  <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
                    Notify Parties
                  </div>
                  <div className="space-y-3 p-3">
                    {/* NO "No notify parties yet." LINE, for the same reason
                        the Marking grid dropped its own: the grid is seeded at
                        the mount, in `openAdd` and on an `openEdit` that came
                        back with nothing (`erp-table-default-row`), so an
                        operator never opens this panel on prose. The one way
                        left to empty it is removing the last row by hand, and
                        a bare "+ Add" button says that better than a sentence
                        claiming there is nothing to show. */}
                    {/* No inner scroll — see ChildGrid's `pageSize` note. */}
                    <div data-grid-body onKeyDown={(e) => gridKeyNav(e)} className="space-y-3">
                    {notifyRefs.map((n, i) => (
                      <div data-grid-row data-row-box key={n.key} className="space-y-2 rounded-md border border-border p-2.5">
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
                        {/* ONE `FieldRow`, laid out by WIDTH — see
                            `NOTIFY_FIELD_W` for the two steps and the 300px line
                            they make. Both controls were `w-full` inside a card
                            the width of the pane, stacked one above the other, so
                            a short name picked from a list stood ~1100px wide and
                            the Country repeated it on the line below: rule 1, on
                            the last hand-rolled grid on this screen.

                            LABELS, NOT PLACEHOLDERS, and the Country box is why
                            `align="start"` is not needed here — neither cell
                            renders anything below its control, so the row has
                            neither hazard and `FieldRow`'s own `items-end` is
                            right. The Contact card next door takes `start`
                            because a `ValidatedInput` there puts a format message
                            under the box. */}
                        <FieldRow>
                          <Field label="Notify Short Name" w={NOTIFY_FIELD_W.notify_id}>
                            <NotifyPicker
                              notifies={notifies}
                              value={n.notify_id || null}
                              onChange={(id) => setNotifyRefAt(n.key, id ?? "")}
                              compact
                            />
                          </Field>
                          {/* MIRRORED FROM THE NOTIFY, never typed: `readOnly` and
                              `tabIndex={-1}` keep it off Tab, off Enter-advance and
                              off the arrows, and `LAYOUT.md` §8 calls that the right
                              shape for a derived value.

                              The `placeholder` it used to carry is gone with the
                              rest of them, and the provenance it stated is not: the
                              `title` says it, the way Identity's Name states its own
                              origin there rather than in a line under the box. At
                              144px "— from Notify —" would have clipped anyway. */}
                          <Field label="Country" w={NOTIFY_FIELD_W.country}>
                            <Input
                              value={notifyCountry(n.notify_id)}
                              readOnly
                              tabIndex={-1}
                              title={
                                notifyCountry(n.notify_id) ||
                                "Comes from the Notify party picked beside it."
                              }
                              /* truncate-reveal: exempt -- the reveal is the
                                 `title` above, which carries the whole country
                                 name. This is a readOnly `<input>`, and
                                 `<Truncated>` writes its own `truncate` span
                                 around TEXT — it has no way to reach a value the
                                 browser paints inside an input. */
                              className="text-ellipsis"
                            />
                          </Field>
                        </FieldRow>
                      </div>
                    ))}
                    </div>
                    <Button type="button" variant="outline" size="sm" data-row-add onClick={addNotifyRef}>
                      + Add notify party
                    </Button>
                  </div>
                </div>
              </SectionBody>
            ),
          },
        ]}
      />

      {/* Read-only view — same record, nothing editable, Edit in the footer
          hands off to the editor above. */}
      <RecordViewSheet
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        title={viewRow?.name ?? ""}
        subtitle={
          viewRow
            ? [
                viewRow.country_id ? countryLabel.get(viewRow.country_id) : null,
                viewRow.customer_id ? customerLabel.get(viewRow.customer_id) : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        status={
          viewRow && (
            <StatusPill
              tone={viewRow.is_draft ? "warning" : viewRow.inactive ? "danger" : "success"}
            >
              {viewRow.is_draft ? "Draft" : viewRow.inactive ? "Inactive" : "Active"}
            </StatusPill>
          )
        }
        sections={viewRow ? [...viewSectionsFor(viewRow), ...createdSection(viewRow)] : []}
      />
    </div>
  );
}

/**
 * A child card, read-only: one line per row, the muted half on the right the way
 * `material-view-sheet` renders its Mixing rows. Not a `ChildGrid` — there is
 * nothing to edit, add or paginate, and a grid of disabled pickers would read as
 * a form the user is not allowed to use.
 */
function ChildList({
  label,
  rows,
}: {
  label: string;
  rows: { key: string; main: string; detail?: string }[];
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="space-y-1 text-sm text-foreground">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words">{r.main}</span>
            {r.detail && (
              <span className="shrink-0 text-xs text-muted-foreground">{r.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
