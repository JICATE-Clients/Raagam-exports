"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  MapPin,
  SlidersHorizontal,
  Boxes,
  Cog,
  Wrench,
  Handshake,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { MobileField, WhatsAppField, useIsdLookup } from "@/components/masters/contact-fields";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid, FieldRow, type FieldSize, type FieldWidth } from "@/components/ui/field";
import { ValidatedInput } from "@/components/ui/validated-input";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { Select } from "@/components/ui/select";
import { DetailSection } from "@/components/masters/detail-section";
import { SectionGrid } from "@/components/masters/section-grid";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { StatePicker } from "@/components/masters/state-picker";
import { PaymentTermPicker } from "@/components/masters/payment-term-picker";
import { GstinInsight, type GstinSuggestion } from "@/components/masters/gstin-insight";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { decodeGstin, matchGstinState, normalizeGstin } from "@/lib/validation/gstin";
import { defaultCountryId, defaultStateId } from "@/lib/masters/geo-defaults";
import { effectiveWhatsApp } from "@/lib/validation/contact";
import { createVendor, updateVendor, deleteVendor } from "@/lib/masters/vendor-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  VENDOR_TYPES,
  VENDOR_STATUSES,
  GST_REG_STATUSES,
  DUTY_DETAILS,
  isDomesticVendorType,
  type Vendor,
  type VendorInput,
  type VendorStatus,
  type VendorType,
  type GstRegStatus,
  type DutyDetail,
} from "@/lib/masters/vendor-types";
import { CategoryPicker, LevyPicker } from "@/components/masters/lookup-picker";
import { ProcessPicker } from "@/components/masters/process-picker";
import type { Country } from "@/lib/masters/country-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { StateLookup } from "@/lib/masters/lookup-compat";
import type { Category } from "@/lib/masters/category-types";
import type { Levy } from "@/lib/masters/levy-types";
import type { Process } from "@/lib/masters/process-types";
import { createdMeta, createdSection, withCreatedColumns } from "@/components/ui/created-columns";
import { Toggle } from "@/components/ui/toggle";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type SectionKey = "identity" | "address" | "itemcat" | "process" | "service" | "subcontract" | "other";
/**
 * `itemcat` mirrors the legacy form: the Item Category tab is only there while
 * **Is Bought Items Vendor** is ticked, because per-item VAT / duty / lead time /
 * payment terms only mean anything for a vendor we buy goods from. Hidden, not
 * disabled — and hiding it never discards rows already saved (see the note on
 * `item_categories` in vendor-types.ts).
 */
const SECTIONS: {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  built: boolean;
  /** Rendered only when this returns true; absent = always. */
  when?: (f: HeaderForm) => boolean;
}[] = [
  { key: "identity", label: "Identity", icon: User, built: true },
  { key: "address", label: "Address", icon: MapPin, built: true },
  {
    key: "itemcat",
    label: "Item Category",
    icon: Boxes,
    built: true,
    when: (f) => f.is_bought_items_vendor,
  },
  { key: "process", label: "Process", icon: Cog, built: true, when: (f) => f.is_processor },
  { key: "service", label: "Service", icon: Wrench, built: true, when: (f) => f.is_service_provider },
  {
    key: "subcontract",
    label: "SubContractor",
    icon: Handshake,
    built: true,
    when: (f) => f.is_sub_contractor,
  },
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
  // ---- Identity · Category · Registration ----
  //   NOT HERE ANY MORE. That whole section left the twelfths track on
  //   2026-09-10 — see `IDENTITY_W`, `REGISTRATION_W` and the two box caps
  //   below, which state widths instead of shares. The keys are deleted rather
  //   than left unread: a `FIELD_SIZE.name` still sitting here is a share this
  //   file no longer honours, and the next reader would copy it.
  // ---- Other Details ----
  //   NOT HERE ANY MORE. All three of its cards left the twelfths track on
  //   2026-09-10 — see `BANKING_W`, `GST_W`, `ADDITIONAL_W` and the one cap
  //   `OTHER_BOX_W` they share.
  // ---- Address child rows ----
  //   NOT HERE ANY MORE either. That grid's card left the twelfths track on
  //   2026-09-10 — see `ADDRESS_W` and `ADDRESS_BOX_W` below, which state
  //   widths instead of shares. Deleted rather than left unread, for the reason
  //   the Identity block above gives: a `FIELD_SIZE.street` still sitting here
  //   is a share this file no longer honours, and the next reader would copy it.
  // ---- Item Category ----
  // row 1  item_class 3 + category 3 + vat 3 + duty 3      = 12
  // row 2  lead_days 3 + form 3 + supply_type 3 + p.term 3 = 12
  item_class_id: "sm",
  category_id: "sm",
  vat_levy_id: "sm",
  duty_levy_id: "sm",
  lead_days: "sm", // 3 — a small integer, but ONE width every field (§3)
  form_id: "sm",
  supply_type_id: "sm",
  payment_term_id: "sm",
  // ---- Process / Service / SubContractor ----
  // process  process 3 + vat 3 + vat_portion 3 + payment_term 3 = 12
  // service  service_type 3 + payment_term 3                    =  6
  // subcon.  process 3 + payment_term 3                         =  6
  process_id: "sm",
  vat_portion_pct: "sm",
  // `service_type_id` and the three TDS / ESI keys are NOT here any more — the
  // Service row and the shared panel left the twelfths track on 2026-09-10; see
  // `SERVICE_W` and `TDS_ESI_W` below. `payment_term_id` above stays, because
  // Item Category, Process and SubContractor still read it.
} satisfies Record<string, FieldSize>;

/**
 * IDENTITY, SHRINK-WRAPPED (`erp-form-compact`) — the same conversion Notify,
 * Consignee and Our Bank took, on the row that holds the same kind of party.
 *
 * Six cells at `size="sm"` was 3 of 12 each, so a Yes/No-sized Type dropdown, a
 * picked country and the vendor's own NAME were all the same width — and that
 * width was ~285px on a 1366 laptop and ~352px at 1920, because a twelfth is a
 * share of the pane rather than a measurement of anything in the box. The
 * complaint is the surplus, not the control: a fraction cannot be narrowed from
 * the inside, since shrinking the input leaves the CELL at its share and floats
 * the value in the hole. So the row leaves the track for `FieldRow` + `Field w=`.
 *
 * NO HAND-TYPED PIXELS. Every width is a step of the vocabulary in
 * `lib/ui/sizes.ts`. `customer-master-screen.tsx`'s `IDENTITY_W` is the one map
 * in this app that hand-types them, and it says in writing not to be copied.
 *
 *   selects 140-170  ->  `code` 144   Name, Country, Group Name
 *   two-word enum    ->  `term` 176   Type, Status
 *
 * NAME IS `code` (144), NOT `name` (288), BECAUSE THE SIBLINGS ALREADY MEASURED
 * IT. The client asked Notify's name box for 140px on 2026-09-09, Consignee took
 * the same step for the same reason, and a vendor is the same kind of party on
 * the same kind of screen — so a second opinion here is drift rather than
 * tailoring. It costs what it costs, said plainly: "SREE LAKSHMI TEXTILE
 * PROCESSORS PVT LTD" is longer than ~110px of visible glyphs and scrolls inside
 * its own box while being typed. An `<input>` scrolls rather than truncating, so
 * nothing here promises a reveal it cannot give (AGENTS.md, "Truncated values").
 * Group Name is `code` for the same reason: it holds a name as well.
 *
 * TYPE AND STATUS TAKE THE STEP ABOVE IT, and that is arithmetic rather than
 * preference. "Foreign Vendor" and "Under Evaluation" are ~95-110px of glyphs
 * at 14px, plus the select's own `px-3` and its chevron — past 144 and inside
 * 176. `code` would clip the longest option of a list the operator must read.
 *
 * THE SWITCH TAKES NO `w` AT ALL, and that is rule 1 rather than an omission: a
 * switch is not one of the five widths, and an unsized `Field` in a flex row is
 * exactly as wide as what is in it (~100px of track, gap and its own word).
 *
 * DERIVED, so it can be checked against the pane. `FIELD_ROW` puts 12px between
 * cells:
 *
 *   New    144 + 176 + 176 + 144 + 144         =  784 + 4 x 12 =  832
 *   Edit   144 + 176 + 176 + 144 + 144 + ~100  =  884 + 5 x 12 =  944
 *
 * BOTH ON ONE LINE AT EVERY WINDOW THIS APP RUNS IN, which the twelfths could
 * not do: five fields at 3 spilled the sixth cell onto a second row that was
 * three quarters empty. The yardstick is `MasterFullScreen`'s own — content =
 * min(viewport - 192 rail, 1440 cap) - 32 padding, i.e. 1142 on a 1366 laptop
 * and 1408 at 1920 — so Edit clears the narrowest of those by 198px.
 *
 * AND IT WOULD WRAP RATHER THAN SCROLL IF IT EVER DID. This is a plain
 * `FieldRow`, not `nowrap`: nobody asked Identity for one unbroken line, and
 * `nowrap`'s `overflow-x-auto` would clip an in-flow picker panel. A field added
 * here folds onto a second line, visibly, instead of hiding off the right edge.
 */
const IDENTITY_W = {
  name: "code", //         140px asked for on the sibling; 144 is the step
  vendor_type: "term", //  "Foreign Vendor" — past `code`, inside `term`
  status: "term", //       "Under Evaluation" — the same
  country_id: "code", //   as Notify's and Consignee's own Country
  group_id: "code", //     a group's name, same as `name` above
} satisfies Record<string, FieldWidth>;

/**
 * THE REGISTRATION NUMBERS, on the same steps.
 *
 * Four bounded identifiers — an 11-digit TIN, a 10-character PAN, a short
 * caption and a registration number — that each took 3 of 12, i.e. ~285px for a
 * value that cannot reach fifteen characters. They are codes, so they are all
 * `code`, and the row that used to fill the card now ends where the fourth
 * number ends. Consignee's `REGISTRATION_W` reached the same answer for four of
 * the same kind, including the argument against giving PAN a narrower step of
 * its own: a row of identifiers reads as one band, and one of them sitting 32px
 * shy of its neighbours is a ragged edge bought for nothing.
 *
 * WEB SITE IS THE ONE FIELD WITH NO MAXIMUM, so it takes `name` (288) — the
 * same step Notify's own Web site takes, and the test `FieldWidth` states: does
 * the schema guarantee a maximum? A URL does not.
 *
 *   144 + 144 + 144 + 144 + 288 = 864 + 4 x 12 = 912
 */
const REGISTRATION_W = {
  tin_no: "code", //       11 digits
  pan_no: "code", //       exactly 10 characters
  reg_caption: "code", //  a short caption, not a sentence
  reg_no_dt: "code", //    a number and a date
  web_site: "name", //     a URL — free text, no hard maximum
} satisfies Record<string, FieldWidth>;

/**
 * THE REGISTRATION CARD'S CAP (`erp-form-compact` rule 4) — a block box held to
 * its own content instead of to the pane.
 *
 * Narrowing the five fields does not narrow the CARD: `DetailSection` is a block
 * box and goes on filling its 1142px row whatever is inside it, so the tightened
 * row would trail ~230px of empty card to the right of Web site — the same
 * defect one card out. Derived from the row above:
 *
 *   912       the five fields and their gaps
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 934  ->  59rem (944)
 *
 * The 10px of slack is the same trade Country's and Our Bank's caps make: the
 * card must not be the thing that decides where the row breaks.
 */
const REGISTRATION_BOX_W = "max-w-[59rem]";

/**
 * THE CATEGORY CARD'S CAP — A DEFINITE REM, AND IT WAS `max-w-fit` UNTIL
 * 2026-09-10, WHICH IS WHY THE SECTION RENDERED AS A LABEL OVER AN EMPTY BOX
 * (client: "restore the CATEGORY section … display all 4 options in a VISIBLE
 * horizontal row").
 *
 * ## The same cycle as before, one element further out
 *
 * `DetailSection`'s single root carries `@container/section` AND the caller's
 * `className` — read `detail-section.tsx`, they are not two elements. So
 * `max-w-fit` put a CONTENT-SIZED CAP ON A CONTAINER-QUERY ROOT: `container-type:
 * inline-size` applies `contain: inline-size`, an inline-size-contained box has a
 * max-content of ZERO, and `fit-content` resolves through max-content. The cap
 * computed to 0 and the card was its padding and border with the caption
 * spilling out.
 *
 * THE NOTE THAT USED TO SIT HERE DIAGNOSED THIS EXACTLY AND FIXED THE WRONG
 * ELEMENT. It described the collapse, cited `child-grid.tsx`'s two earlier
 * sightings, wrote down the rule — "never put a content-sized cap around a
 * container-query root" — and then removed the container from the INNER row
 * (`FieldRow` → a plain div) while leaving `max-w-fit` on the outer one, which
 * was a container-query root all along. A rule stated correctly and applied one
 * element off is the shape of this whole family of bugs.
 *
 * `IDENTITY_BOX_W` in `employee-master-screen.tsx` and `REGISTRATION_BOX_W`
 * below both say it in one line: **a definite length, never `max-w-fit`.** This
 * constant is now one.
 *
 * ## And a definite length here has to be estimated
 *
 * That is what the old note was avoiding, and the objection was real: the four
 * cells are `Toggle`s — a 36px track, an 8px gap, then a caption of 12 to 22
 * characters — and there is no schema maximum to derive a number from. But the
 * choice was never "estimate or hug"; it was "estimate or render nothing".
 *
 *   4 x (36 track + 8 gap)                        =  176
 *   captions at ~6.6px per character, `text-xs`:
 *     Is Bought Items Vendor  22  ~145
 *     Is Service Provider     19  ~125
 *     Is Sub Contractor       17  ~112
 *     Is Processor            12  ~ 79            =  461
 *   + 3 x 16  the row's `gap-4`                   =   48
 *   = 685
 *   + 2 x 10  `DetailSection`'s `p-2.5`
 *   + 2 x 1   its border                          =  707  ->  46rem (736)
 *
 * THE GENEROUS END, deliberately, and the row's own `overflow-x-auto` is what
 * makes the trade safe in BOTH directions: an estimate that reads low costs a
 * scrollbar the operator can see, and one that reads high costs a sliver of
 * grey. Neither can drop a flag onto a line of its own, which is the one thing
 * this section must not do — four flags read as a set or they are read one at a
 * time. `PHOTO_BOX_W` on the Employee master takes the same side of the same
 * trade and says so.
 */
const CATEGORY_BOX_W = "max-w-[46rem]";

/**
 * THE SERVICE ROW, SHRINK-WRAPPED (`erp-form-compact`) — the two pickers inside
 * the Service child grid's card, packed by width instead of by twelfths.
 *
 * A `forceCards` grid renders `renderMobileRow` for every row, and that callback
 * returned a `FieldGrid` — the same 12-column track the sections beside it were
 * on, so a picked service type and a payment term each took a quarter of the
 * card and the card took the pane. Two fields at 3 of 12 left SIX TWELFTHS of
 * every service line empty, once per row, on a grid that pages four at a time.
 *
 * NEITHER WIDTH IS A NEW MEASUREMENT:
 *
 *   code 144  Service Type — a picked name from a managed list, the step
 *             Notify's Department and Designation pickers already take in the
 *             same shape of grid card.
 *   term 176  Payment Terms — Consignee's `GENERAL_W` measured this one and
 *             says why in writing: "60 DAYS FROM BL DATE" clips at `code`. It
 *             is the same master behind the same picker, so a second opinion
 *             here would be drift.
 *
 *   144 + 176 = 320 + 1 x 12 = 332
 */
const SERVICE_W = {
  service_type_id: "code", //  a picked name from a managed list
  payment_term_id: "term", //  "60 DAYS FROM BL DATE" clipped at `code`
} satisfies Record<string, FieldWidth>;

/**
 * THE SERVICE GRID'S CAP (`erp-form-compact` rule 4: a sub-grid takes the FORM's
 * width, not the screen's), derived the way Notify's Contacts grid is derived:
 *
 *   332       the content row above
 *   + 40      the ✕'s reserved gutter — a `renderMobileRow` card keeps the
 *             CORNER remove, an absolute chip standing in the `relative pr-10`
 *             the row reserves, so the fields never get the card's full width
 *   + 2 x 10  `GRID_FRAME`'s `p-2.5`, the NON-compact density (the editor pane
 *             resolves `@2xl/editor:p-2` and pays 4px less)
 *   + 2 x 1   its border
 *   = 394  ->  26rem (416), 22px of slack
 *
 * The slack is the same trade every cap on this screen makes: a cap that fits at
 * only one density wraps the row at the other, and here a wrap costs a whole
 * line per service. `lockExisting` withholds the ✕ from a STORED row, which
 * gives its two fields 40px MORE than a new one's — with only two fields there
 * is no third to fold, so the wider shape cannot break the narrower one's cap.
 *
 * A WRAPPING `<div>`, NOT `ChildGrid`'s OWN `hugsContent`, AND THAT IS NOT A
 * PREFERENCE. `hugsContent` turns on when every column declares a `width`, and
 * `child-grid.tsx` records at length what it then does to a `renderMobileRow`
 * card: the card's `width: fit-content` is computed from its children, the row
 * callback returns a `FieldRow` whose root is `@container/section` and therefore
 * `contain: inline-size`, so it contributes ZERO — the card shrinks past every
 * field in it and settles on the widest thing that is not itself contained,
 * about 38px. Fabric BOM ▸ Manual shipped exactly that (client 2026-09-03).
 * A cap on the outside has no such cycle to fall into.
 *
 * SAFE TO NARROW ONLY BECAUSE THIS GRID IS `forceCards`: AGENTS.md's rule is
 * never to take a `ChildGrid` under 512px, which is where its responsive table
 * falls back to stacked cards with no column headers. This grid is declared as
 * cards already, so there is no table to lose.
 */
const SERVICE_BOX_W = "max-w-[26rem]";

/**
 * THE ADDRESS CARD, SHRINK-WRAPPED (`erp-form-compact`) — the ten fields inside
 * the Address child grid's card, packed by width instead of by twelfths.
 *
 * Same shape as the Service row above and the same cause: a `forceCards` grid
 * renders `renderMobileRow` for every row, that callback returned a `FieldGrid`,
 * and ten fields at 3 of 12 came out as three rows of four with a hole in the
 * last — a six-digit PIN as wide as the street it sits under, once per address,
 * on a grid that pages three at a time. A fraction cannot be made compact:
 * narrowing the control inside a twelfth leaves the CELL at its share and floats
 * the value in the hole.
 *
 * NOT ONE NEW MEASUREMENT. Customer ▸ Address and Consignee ▸ Address hold this
 * same postal address and were converted on 2026-09-09 with an `ADDRESS_W` that
 * is deliberately identical between the two files; eight of these ten keys are
 * that map, copied rather than re-derived, because measuring one address three
 * times is the drift `lib/ui/sizes.ts` exists to stop:
 *
 *   name  288  Street, Email ID — a postal line and an address have no hard
 *              maximum, which is the test `FieldWidth` states.
 *   code  144  City, State, Land Line — and Country, which takes the step
 *              `IDENTITY_W.country_id` already takes in this same file.
 *   range 112  Pin — six digits, a maximum the schema guarantees.
 *   term  176  Mobile and WhatsApp, both. THE STEP IS PAID FOR BY THE CONTROL,
 *              not the value: each holds its input AND a `ContactChip` in a flex
 *              beside it (`contact-fields.tsx`), so at `code` the number would be
 *              squeezed by a fixed 28px button. Land Line carries no chip and
 *              stays at 144.
 *
 * ADDRESS TYPE IS THE ONE KEY WITH NO SIBLING, and it is `code` because it holds
 * a word from a fixed set the legacy form printed as column headers — OFFICE,
 * WORKS, BILLING. It is an `<Input>` rather than a `<Select>`, so nothing in the
 * schema bounds it; what bounds it is that a longer value would not be one of the
 * three things this column means.
 *
 * DERIVED, and this row WRAPS — these are the two lines, and the cap below is
 * what makes them a fact rather than a coincidence of the window:
 *
 *   144 + 288 + 144 + 144 + 144 + 112 = 976 + 5 x 12 = 1036   type..pin: WHERE
 *   144 + 176 + 176 + 288             = 784 + 3 x 12 =  820   land line..email:
 *                                                             HOW TO REACH IT
 *
 * That break is the one an operator would make by hand, and it is the reason the
 * cap is not simply "the widest line": at any width past 1254 the Land Line
 * climbs onto line 1 and the split stops meaning anything.
 */
const ADDRESS_W = {
  address_type: "code", //  OFFICE · WORKS · BILLING
  street: "name", //        a postal line has no hard maximum — free text
  city_id: "code",
  state_id: "code",
  country_id: "code", //    as IDENTITY_W.country_id above
  pin: "range", //          6 digits
  land_line: "code", //     no chip beside it, unlike the two below
  mobile: "term", //        input + ContactChip
  whatsapp: "term", //      input + ContactChip + its "Same as mobile" tick
  email_id: "name", //      an e-mail address — free text
} satisfies Record<string, FieldWidth>;

/**
 * THE ADDRESS GRID'S CAP (`erp-form-compact` rule 4), derived exactly as
 * `SERVICE_BOX_W` above is derived — read its note for the two things that make
 * a cap on the OUTSIDE the only shape that works here, both of which apply
 * unchanged: `ChildGrid`'s own `hugsContent` collapses a `renderMobileRow` card
 * to ~38px, and narrowing a grid under 512px is safe only because this one is
 * `forceCards` and has no responsive table to lose.
 *
 *   1036      line 1 of the content row above
 *   + 40      the ✕'s reserved gutter — a `renderMobileRow` card keeps the CORNER
 *             remove, an absolute chip standing in the `relative pr-10` the row
 *             reserves, so the fields never get the card's full width
 *   + 2 x 10  `GRID_FRAME`'s `p-2.5`, the NON-compact density (the editor pane
 *             resolves `@2xl/editor:p-2` and pays 4px less)
 *   + 2 x 1   its border
 *   = 1098  ->  70rem (1120), 22px of slack
 *
 * THE CAP HAS A CEILING AS WELL AS A FLOOR, and that is what this one is for.
 * Under 1098 the row folds Pin onto line 2 and the address is split mid-thought;
 * at 1254 or more the Land Line joins line 1 and the two lines stop being "where
 * it is" and "how to reach it". 1120 sits between them, so EVERY window this app
 * runs in draws the same two lines — the yardstick is `MasterFullScreen`'s own,
 * content = min(viewport - 192 rail, 1440 cap) - 32 padding, i.e. 1142 on a 1366
 * laptop and 1408 at 1920, and the cap binds at both.
 *
 * IT HOLDS FOR A STORED ROW TOO, which is the check `lockExisting` makes
 * necessary: withholding the ✕ hands that row its 40px back, so its fields have
 * 1098 rather than 1058 — still 94px short of the 1192 a fourth field on line 1
 * would need. A locked row and a new one wrap identically, at both densities.
 */
const ADDRESS_BOX_W = "max-w-[70rem]";

/**
 * THE SHARED TDS & ESI PANEL, on the same steps.
 *
 * ONE DECLARATION, THREE READERS — `tdsEsiPanel` is a single JSX value rendered
 * by Process, Service and SubContractor (see its own note: three tabs, one piece
 * of state, deliberately not three copies). So converting it for Service
 * converts it for the other two, which is the point rather than a side effect: a
 * per-section width here would be the same panel at three widths.
 *
 *   term  176  TDS ID No — a levy is displayed by its DESCRIPTION, a phrase
 *              rather than a code, so it takes the step Payment Terms takes
 *              above and for the same measured reason.
 *   code  144  ESI No — a registration number, unvalidated on purpose
 *   range 112  ESI Retention % — `num` (72) is the step the VALUE argues for (a
 *              percent with two decimals is ~6 glyphs), and the LABEL sets the
 *              floor instead: "ESI Retention %" is ~88px at 12px, so at `num`
 *              it would wrap to two lines and stand the row's tallest cell on
 *              its own. Consignee's `also_notify` records the same trade.
 *
 *   176 + 144 + 112 = 432 + 2 x 12 = 456
 *
 * `FieldRow`'s default `items-end`, not `align="start"`: nothing in this row
 * renders a hint or an error BELOW its control, and bottom alignment is what
 * keeps a label that does wrap from dropping its box below its neighbours.
 */
const TDS_ESI_W = {
  tds_levy_id: "term", //         a levy's description, not its code
  esi_no: "code", //              whatever the ESIC office issued
  esi_retention_pct: "range", //  the label's floor, not the value's width
} satisfies Record<string, FieldWidth>;

/**
 * AND THE PANEL'S CARD IS CAPPED TO THAT ROW (rule 4 again — `DetailSection` is
 * a block box and goes on filling the pane whatever is inside it):
 *
 *   456       the row above
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 478  ->  31rem (496), 18px of slack
 */
const TDS_ESI_BOX_W = "max-w-[31rem]";

/**
 * BANKING, SHRINK-WRAPPED (`erp-form-compact`) — and NOT measured again here,
 * because `our-bank-master-screen.tsx` holds the same five values and the client
 * measured them there on 2026-09-10 ("compact", tight to the text).
 *
 * `OUR_BANK_W` is the map to read: Account No takes `term` (176) because
 * `lib/validation/formats.ts` caps an account at 18 digits, ~151px of them;
 * IFSC takes `code` (144) because it is exactly 11 characters and `range` would
 * clip the eleventh; and the fields with no schema maximum — a bank's name, a
 * branch's — take `range` (112) together. A second opinion on this screen would
 * be drift, and drift between two screens holding one bank account is exactly
 * what the shared vocabulary exists to stop.
 *
 * A/c TYPE IS THE ONE FIELD OUR BANK DOES NOT HAVE, and it takes `hug` (88), the
 * floor: SB / CA / CC is three characters, so the LABEL is what stops the cell
 * going narrower. That step is defined for precisely this case.
 *
 * WHAT THE NARROW BOXES COST, said plainly: "STATE BANK OF INDIA" is longer than
 * ~86px of visible glyphs and scrolls inside its own input while being typed.
 * An `<input>` scrolls rather than truncating, so nothing promises a reveal it
 * cannot give (AGENTS.md, "Truncated values"). That is the trade the client
 * asked for on the screen that owns these fields.
 *
 *   112 + 112 + 176 + 144 + 88  =  632 + 4 x 12 = 680
 */
const BANKING_W = {
  bank_name: "range", //   no schema maximum — as `OUR_BANK_W.bank_name`
  branch: "range", //      as `OUR_BANK_W.branch_name`
  ac_no: "term", //        18 digits, the schema's own maximum
  ifsc_code: "code", //    exactly 11 characters
  ac_type: "hug", //       SB / CA / CC — the label is the floor, not the value
} satisfies Record<string, FieldWidth>;

/**
 * GST — two fields and the fact strip that decodes the second of them.
 *
 * "Unregistered" is the longest option of the status select at ~84px of glyphs,
 * plus the select's own `px-3` and its chevron: past `range`, inside `code`. The
 * GSTIN itself is exactly 15 characters, which is the value Consignee's
 * `REGISTRATION_W` already puts at `code` and calls "the widest of the four, and
 * it fits".
 *
 *   144 + 144 = 288 + 1 x 12 = 300
 *
 * THE STRIP IS NOT ONE OF THE CELLS. `GstinInsight` is a fact strip, so it takes
 * the whole line under the number it decodes — but it does that with `w-full` on
 * the `Field`, never with `size="full"`. That prop is a col-span, and a col-span
 * in a flex row is INERT: the strip would have packed inline as a third cell
 * beside the GST number instead of standing under it. Consignee's Registration
 * card records the same trap in the same words, one screen along.
 */
const GST_W = {
  gst_reg_status: "code", //  "Unregistered" plus a chevron
  gst_no: "code", //          exactly 15 characters
} satisfies Record<string, FieldWidth>;

/**
 * ADDITIONAL DETAILS — four short identifiers, so one step for all four.
 *
 * Every value here is short (MSME, a memorandum number, a unit code, a duty
 * code) and every LABEL is long: "Enterprise Status" is ~108px of Inter 600 at
 * 12px and "Inhouse Unit ID" ~96px. So this row is label-bound rather than
 * value-bound, and `code` (144) is the first step that clears the widest label
 * with room to spare. `hug` (88) is the floor for a label of TWO SHORT WORDS and
 * would wrap "Enterprise Status" onto two lines.
 *
 *   144 x 4  =  576 + 3 x 12 = 612
 */
const ADDITIONAL_W = {
  enterprise_status: "code", //  MSME / Small / Medium — the label is 108px
  memorandum_no: "code", //      a reference number
  inhouse_unit_id: "code", //    a unit code
  duty_against: "code", //       a short code
} satisfies Record<string, FieldWidth>;

/**
 * ONE CAP FOR ALL THREE CARDS (`erp-form-compact` rule 4), and one is what
 * matters here: they are stacked full-width sections under a single rail entry,
 * so capping each to its own longest line would leave three bordered boxes of
 * three different widths one above the other — which reads as a mistake rather
 * than as three sections. `employee-master-screen.tsx` states the same rule for
 * its own stacked pair.
 *
 * Derived from the widest of the three rows, which is Banking:
 *
 *   680       Banking, the longest line of the three (GST is 300, Additional 612)
 *   + 2 x 10  `DetailSection`'s `p-2.5` (its `@2xl/editor:p-2` is narrower still)
 *   + 2 x 1   its border
 *   = 702  ->  45rem (720), 18px of slack
 *
 * THE GSTIN STRIP IS THE ONE CHILD THAT WANTS MORE, and it gets 698px inside
 * this cap — more than the ~630 the same strip has on Consignee, and it wraps
 * (`flex flex-wrap`) rather than clipping in any case. So the cap is set by the
 * fields, and the strip is checked against it rather than the other way round.
 *
 * A definite length, never `max-w-fit`: `DetailSection`'s root declares
 * `@container/section`, so a content-sized cap on it resolves to zero and the
 * card collapses — see `CATEGORY_BOX_W` above for the full note.
 */
const OTHER_BOX_W = "max-w-[45rem]";

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
  enterprise_status: string;
  memorandum_no: string;
  inhouse_unit_id: string;
  duty_against: string;
  // Item Category tab
  duty_details: DutyDetail;
  // The TDS / ESI panel — ONE set of values, shown on the Process, Service and
  // SubContractor tabs alike, so it lives on the header and not per section.
  tds_levy_id: string;
  esi_no: string;
  esi_retention_pct: string;
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
  enterprise_status: "",
  memorandum_no: "",
  inhouse_unit_id: "",
  duty_against: "",
  duty_details: "None",
  tds_levy_id: "",
  esi_no: "",
  esi_retention_pct: "",
};

/** One row of the Process grid (Is Processor). */
type ProcessRow = {
  key: string;
  process_id: string;
  vat_levy_id: string;
  vat_portion_pct: string;
  payment_term_id: string;
};
const blankProcess = (key: string): ProcessRow => ({
  key,
  process_id: "",
  vat_levy_id: "",
  vat_portion_pct: "",
  payment_term_id: "",
});

/** One row of the Service grid (Is Service Provider). */
type ServiceRow = { key: string; service_type_id: string; payment_term_id: string };
const blankService = (key: string): ServiceRow => ({
  key,
  service_type_id: "",
  payment_term_id: "",
});

/** One row of the SubContractor grid — the Process grid without VAT. */
type SubcontractRow = { key: string; process_id: string; payment_term_id: string };
const blankSubcontract = (key: string): SubcontractRow => ({
  key,
  process_id: "",
  payment_term_id: "",
});

/** One row of the Item Category grid, keyed for React the same way addresses are. */
type ItemCatRow = {
  key: string;
  item_class_id: string;
  category_id: string;
  vat_levy_id: string;
  duty_levy_id: string;
  lead_days: string;
  form_id: string;
  supply_type_id: string;
  payment_term_id: string;
};
const blankItemCat = (key: string): ItemCatRow => ({
  key,
  item_class_id: "",
  category_id: "",
  vat_levy_id: "",
  duty_levy_id: "",
  lead_days: "",
  form_id: "",
  supply_type_id: "",
  payment_term_id: "",
});

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
const blankAddress = (key: string, country_id = "", state_id = ""): AddressRow => ({
  key,
  address_type: "",
  street: "",
  city_id: "",
  state_id,
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
  companyGstin,
  itemClasses,
  categories,
  levies,
  paymentTerms,
  itemForms,
  supplyTypes,
  processes,
  serviceTypes,
  perms,
}: {
  rows: Vendor[];
  countries: Country[];
  cities: ConfigLookup[];
  /** `statesAsLookups(...)` — `StateLookup`, not bare `ConfigLookup`, because the
   *  address State field scopes its list by `country_id`. */
  states: StateLookup[];
  groups: ConfigLookup[];
  /** Our own GSTIN, for within-state vs other-state classification. */
  companyGstin: string | null;
  // ---- Item Category tab ----
  itemClasses: ConfigLookup[];
  /** The whole master; each grid row scopes it to its own Item Class. */
  categories: Category[];
  /** The whole master; split by `type` into the VAT and Duty pickers. */
  levies: Levy[];
  paymentTerms: ConfigLookup[];
  itemForms: ConfigLookup[];
  supplyTypes: ConfigLookup[];
  // ---- Process / SubContractor tabs ----
  /** The Process master — the same list both grids pick from. */
  processes: Process[];
  // ---- Service tab ----
  serviceTypes: ConfigLookup[];
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
  const [itemCats, setItemCats] = useState<ItemCatRow[]>([]);
  const [procRows, setProcRows] = useState<ProcessRow[]>([]);
  const [svcRows, setSvcRows] = useState<ServiceRow[]>([]);
  const [subRows, setSubRows] = useState<SubcontractRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // The two levy pickers are one master told apart by `type`: VAT/CST against
  // duty. Filtering here rather than in the picker keeps the cascade rule's
  // "the caller scopes the rows" shape.
  const vatLevies = useMemo(
    () => levies.filter((l) => l.type === "VAT" || l.type === "CST"),
    [levies],
  );
  const dutyLevies = useMemo(
    () => levies.filter((l) => l.type === "DUTY" || l.type === "EXCISE DUTY"),
    [levies],
  );
  // The TDS panel's ⓘ — the Levy master carries a TDS structure (0283), so this
  // is a stored levy, not a typed-in number.
  const tdsLevies = useMemo(() => levies.filter((l) => l.type === "TDS"), [levies]);
  const itemClassLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of itemClasses) m.set(c.id, c.name);
    return m;
  }, [itemClasses]);
  const categoryLabel = useMemo(() => {
    const m = new Map<string, string>();
    // `categories.name` is nullable in the master; the grid's fallback column
    // must still render something rather than "undefined".
    for (const c of categories) m.set(c.id, c.name ?? "—");
    return m;
  }, [categories]);
  const processLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of processes) m.set(p.id, p.name);
    return m;
  }, [processes]);
  const serviceTypeLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of serviceTypes) m.set(s.id, s.name);
    return m;
  }, [serviceTypes]);

  /* ------------------------------------------------------ pick-once sets
   *
   * A value already used by a sibling row is offered greyed and tagged
   * "(already added)" rather than picked twice — one row answers one question,
   * so a repeat is two competing answers with no tie-break. See the `usedIds`
   * prop on components/ui/data-picker.tsx.
   *
   * NOT applied to the Address grid below: two addresses in the same city is
   * ordinary, and so is the same state twice.
   */

  /**
   * Item Category is unique on the PAIR (Item Class + Category), not on Category
   * alone — COTTON under YARN and COTTON under FABRIC are different statements
   * about this vendor. Keyed by class so a row only refuses what its OWN class
   * has already taken; the picker's option list is class-scoped the same way.
   */
  const usedCategoriesByClass = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of itemCats) {
      if (!r.item_class_id || !r.category_id) continue;
      const list = m.get(r.item_class_id);
      if (list) list.push(r.category_id);
      else m.set(r.item_class_id, [r.category_id]);
    }
    return m;
  }, [itemCats]);

  // One set of terms per process. Process and SubContractor are deliberately
  // SEPARATE sets: a process this vendor both runs and sublets is two facts.
  const usedProcessIds = useMemo(
    () => procRows.map((r) => r.process_id).filter(Boolean),
    [procRows],
  );
  const usedSubProcessIds = useMemo(
    () => subRows.map((r) => r.process_id).filter(Boolean),
    [subRows],
  );
  const usedServiceTypeIds = useMemo(
    () => svcRows.map((r) => r.service_type_id).filter(Boolean),
    [svcRows],
  );

  // What a NEW vendor starts on: India, and our own state. See geo-defaults.
  const indCountryId = useMemo(() => defaultCountryId(countries), [countries]);
  const homeStateId = useMemo(() => defaultStateId(states, companyGstin), [states, companyGstin]);

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
    setAddresses([blankAddress(newKey(), indCountryId, homeStateId)]);
    setItemCats([blankItemCat(newKey())]);
    setProcRows([blankProcess(newKey())]);
    setSvcRows([blankService(newKey())]);
    setSubRows([blankSubcontract(newKey())]);
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
      enterprise_status: r.enterprise_status ?? "",
      memorandum_no: r.memorandum_no ?? "",
      inhouse_unit_id: r.inhouse_unit_id ?? "",
      duty_against: r.duty_against ?? "",
      duty_details: r.duty_details ?? "None",
      tds_levy_id: r.tds_levy_id ?? "",
      esi_no: r.esi_no ?? "",
      // "" not "0": an untouched retention box should read empty, not 0.00.
      esi_retention_pct: r.esi_retention_pct ? String(r.esi_retention_pct) : "",
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
    setItemCats(
      (r.item_categories ?? []).map((c) => ({
        key: newKey(),
        item_class_id: c.item_class_id ?? "",
        category_id: c.category_id ?? "",
        vat_levy_id: c.vat_levy_id ?? "",
        duty_levy_id: c.duty_levy_id ?? "",
        lead_days: c.lead_days == null ? "" : String(c.lead_days),
        form_id: c.form_id ?? "",
        supply_type_id: c.supply_type_id ?? "",
        payment_term_id: c.payment_term_id ?? "",
      })),
    );
    setProcRows(
      (r.processes ?? []).map((p) => ({
        key: newKey(),
        process_id: p.process_id ?? "",
        vat_levy_id: p.vat_levy_id ?? "",
        vat_portion_pct: p.vat_portion_pct ? String(p.vat_portion_pct) : "",
        payment_term_id: p.payment_term_id ?? "",
      })),
    );
    setSvcRows(
      (r.services ?? []).map((sv) => ({
        key: newKey(),
        service_type_id: sv.service_type_id ?? "",
        payment_term_id: sv.payment_term_id ?? "",
      })),
    );
    setSubRows(
      (r.subcontracts ?? []).map((sc) => ({
        key: newKey(),
        process_id: sc.process_id ?? "",
        payment_term_id: sc.payment_term_id ?? "",
      })),
    );
    setDirty(false);
    setOpen(true);
  }

  // The three simple grids share one shape, so they share three helpers rather
  // than nine: add a blank row, patch a row by key, drop a row by key.
  function addRowTo<T extends { key: string }>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    make: (key: string) => T,
  ) {
    setter((xs) => [...xs, make(newKey())]);
    setDirty(true);
  }
  function patchRow<T extends { key: string }>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    key: string,
    patch: Partial<T>,
  ) {
    setter((xs) => xs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  }
  function dropRow<T extends { key: string }>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    key: string,
  ) {
    setter((xs) => xs.filter((r) => r.key !== key));
    setDirty(true);
  }

  function addItemCat() {
    setItemCats((xs) => [...xs, blankItemCat(newKey())]);
    setDirty(true);
  }
  function setItemCatAt(key: string, patch: Partial<ItemCatRow>) {
    setItemCats((xs) =>
      xs.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // Cascade: a Category belongs to ONE Item Class, so changing the class
        // must drop a category scoped to the old one. A stale child value is
        // worse than an empty one.
        if (patch.item_class_id !== undefined && patch.item_class_id !== r.item_class_id) {
          next.category_id = "";
        }
        return next;
      }),
    );
    setDirty(true);
  }
  function removeItemCat(key: string) {
    setItemCats((xs) => xs.filter((r) => r.key !== key));
    setDirty(true);
  }

  /**
   * Type answers the Country question, so answer it.
   *
   * "With in State" and "Other State" are the two GST supply directions inside
   * India (see `isDomesticVendorType`) — picking either one has ALREADY said the
   * country, and leaving the box on the operator to fill is asking twice. Picking
   * "Foreign Vendor" says the opposite: the India this form opened on is now
   * wrong, and only the operator knows what replaces it.
   *
   * Two rules, and the asymmetry between them is the point:
   *
   * - **To a domestic type → assert India.** Unconditional, because a domestic
   *   type has exactly ONE valid country. If the box still said GERMANY from a
   *   moment ago as a Foreign Vendor, that value is not data being destroyed, it
   *   is a value the operator just contradicted.
   * - **To Foreign Vendor → clear India, but only India.** There are ~200 valid
   *   answers and we know none of them, so we remove the wrong one and leave the
   *   picker open. A country the operator already chose by hand is never touched
   *   — clearing GERMANY here would delete a real answer to ask for it again.
   *
   * Address rows follow the header only while they are still sitting on their
   * untouched create-time default (India + our own state, from `blankAddress`).
   * The moment someone types a real address into a row, that row is data and this
   * function leaves it alone — a foreign company's Indian branch office is a
   * legitimate thing to have keyed, and the reverse rule restores the default if
   * the type is switched back.
   */
  function setVendorType(next: "" | VendorType) {
    const patch: Partial<HeaderForm> = { vendor_type: next };
    const toDomestic = isDomesticVendorType(next);

    if (toDomestic) {
      patch.country_id = indCountryId;
    } else if (next === "Foreign Vendor" && form.country_id === indCountryId) {
      patch.country_id = "";
    }
    set(patch);

    // Keyed on the COUNTRY actually moving, not on the type changing category.
    // "— Select —" → "Foreign Vendor" is a move (India → blank) even though
    // neither type is domestic, and "With in State" → "Other State" is not a
    // move even though the type changed — an address grid churning on that
    // second one would be pure noise.
    const nextCountry = patch.country_id ?? form.country_id;
    if (nextCountry === form.country_id) return;
    setAddresses((xs) =>
      xs.map((a) => {
        if (nextCountry === indCountryId) {
          // Back to India: refill only a row we ourselves blanked below.
          return !a.country_id && !a.state_id
            ? { ...a, country_id: indCountryId, state_id: homeStateId }
            : a;
        }
        // Off to a foreign country: an Indian state under it would be nonsense,
        // so the pair clears together or not at all.
        return a.country_id === indCountryId && a.state_id === homeStateId
          ? { ...a, country_id: "", state_id: "" }
          : a;
      }),
    );
  }

  function addAddress() {
    setAddresses((xs) => [...xs, blankAddress(newKey(), indCountryId, homeStateId)]);
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

  // Two vendors must not share a GSTIN — one registration belongs to exactly one
  // party. Matches the guard Customer and Consignee already had; Vendor was the
  // only party master missing it, so the same number was blocked on those two
  // and accepted here. Backstopped server-side by `checkGstinUnique` in
  // vendor-actions.ts. NOT done for PAN anywhere: one PAN legitimately carries
  // one GSTIN per state, so a PAN check would flag real multi-state groups.
  const gstDupError = useDuplicateName({
    table: "master_vendors",
    name: form.gst_no,
    nameColumn: "gst_no",
    excludeId: editId ?? undefined,
    label: "GST number",
    enabled: !!form.gst_no.trim(),
    // Same synchronous half the name check has. A GSTIN is pasted and tabbed
    // away from in one motion, well inside the 300ms debounce — this field was
    // the reported case (client 2026-08-01).
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.gst_no,
  });

  /**
   * The NAME check was already enforced on save (`vendor-actions.ts`) — it just
   * never said so while typing, so the operator learned about it from a toast
   * after filling the whole record. This surfaces the guard that was always
   * there; it does not add a new rule.
   *
   * `rows` gives the synchronous half, so Enter inside the 300ms debounce is
   * refused too rather than round-tripping to the same rejection.
   */
  const nameDupError = useDuplicateName({
    table: "master_vendors",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
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
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

  /**
   * The GSTIN as loaded, so merely OPENING a record never auto-fills — that
   * would mark a freshly-opened form dirty and trip the unsaved-work guard.
   * Only a GSTIN the user actually changed feeds the auto-fill.
   */
  const loadedGstin = useRef("");

  // The State-master row this GSTIN points at — code first, spelling as a
  // fallback. Shared with the consignee screen; see matchGstinState.
  const gstinState = useMemo(() => matchGstinState(gstin, states), [gstin, states]);

  // PAN is characters 3-12 of the GSTIN, so filling an EMPTY PAN box cannot
  // lose information. A PAN that is already typed is never overwritten — a
  // disagreement is real signal, surfaced as a mismatch line instead.
  useEffect(() => {
    if (!gstin?.checksumValid) return;
    if (gstin.gstin === loadedGstin.current) return;
    if (form.pan_no.trim()) return;
    set({ pan_no: gstin.pan });
    // Deliberately NOT depending on form.pan_no: that would re-run on every PAN
    // keystroke and silently re-fill a field the user had just cleared. Reading
    // it straight from the closure is safe and needs no ref — this effect only
    // re-runs when the GSTIN changes, and on that render the closure already
    // holds the current PAN. (It previously used a ref written during render,
    // which is what `react-hooks/refs` was flagging.)
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
    // "differs", not "is empty". Address #1 now OPENS on our own state (the
    // create-time default), so an empty-only test would have hidden this chip on
    // exactly the vendors that need it — an out-of-state GSTIN sitting silently
    // beside a defaulted home state. The PAN chip above already reads this way.
    if (gstinState && first && first.state_id !== gstinState.id) {
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
    // Belt as well as braces: `canSave` already disables the button, but Enter
    // and the draft path reach here directly.
    if (gstDupError) return;
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
        enterprise_status: form.enterprise_status.trim() || null,
        memorandum_no: form.memorandum_no.trim() || null,
        inhouse_unit_id: form.inhouse_unit_id.trim() || null,
        duty_against: form.duty_against.trim() || null,
        duty_details: form.duty_details,
        tds_levy_id: form.tds_levy_id || null,
        esi_no: form.esi_no.trim() || null,
        esi_retention_pct: form.esi_retention_pct.trim() === "" ? 0 : Number(form.esi_retention_pct),
        is_draft: asDraft,
        processes: procRows.map((p, i) => ({
          sno: i + 1,
          process_id: p.process_id || null,
          vat_levy_id: p.vat_levy_id || null,
          vat_portion_pct: p.vat_portion_pct.trim() === "" ? 0 : Number(p.vat_portion_pct),
          payment_term_id: p.payment_term_id || null,
        })),
        services: svcRows.map((sv, i) => ({
          sno: i + 1,
          service_type_id: sv.service_type_id || null,
          payment_term_id: sv.payment_term_id || null,
        })),
        subcontracts: subRows.map((sc, i) => ({
          sno: i + 1,
          process_id: sc.process_id || null,
          payment_term_id: sc.payment_term_id || null,
        })),
        // Sent whether or not the Item Category tab is showing: un-ticking Is
        // Bought Items Vendor hides the tab, it does not throw away terms the
        // buyer already agreed. Blank rows are dropped server-side.
        item_categories: itemCats.map((c, i) => ({
          sno: i + 1,
          item_class_id: c.item_class_id || null,
          category_id: c.category_id || null,
          vat_levy_id: c.vat_levy_id || null,
          duty_levy_id: c.duty_levy_id || null,
          lead_days: c.lead_days.trim() === "" ? null : Number(c.lead_days),
          form_id: c.form_id || null,
          supply_type_id: c.supply_type_id || null,
          payment_term_id: c.payment_term_id || null,
        })),
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
    form.enterprise_status ||
    form.memorandum_no ||
    form.inhouse_unit_id ||
    form.duty_against
  );
  // The Duty Details radio does not count: it defaults to None on every vendor,
  // so a dot driven by it would be lit on a section nobody has filled in.
  const hasItemCat = itemCats.some(
    (c) =>
      c.item_class_id ||
      c.category_id ||
      c.vat_levy_id ||
      c.duty_levy_id ||
      c.lead_days.trim() ||
      c.form_id ||
      c.supply_type_id ||
      c.payment_term_id,
  );
  // The TDS / ESI panel is shared, so it lights all three dots it appears under —
  // which is honest: the section does hold data, just not only its own.
  const hasTdsEsi = !!(form.tds_levy_id || form.esi_no.trim() || form.esi_retention_pct.trim());
  const hasProcess =
    hasTdsEsi ||
    procRows.some((p) => p.process_id || p.vat_levy_id || p.vat_portion_pct.trim() || p.payment_term_id);
  const hasService = hasTdsEsi || svcRows.some((s) => s.service_type_id || s.payment_term_id);
  const hasSubcontract = hasTdsEsi || subRows.some((s) => s.process_id || s.payment_term_id);
  const done: Record<SectionKey, boolean> = {
    identity: hasIdentity,
    address: hasAddress,
    itemcat: hasItemCat,
    process: hasProcess,
    service: hasService,
    subcontract: hasSubcontract,
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
        label: "GST",
        pairs: [
          ["GST Status", r.gst_reg_status],
          ["GST Number", r.gst_no],
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

  const initials = (form.code || form.name || "?").slice(0, 2).toUpperCase();

  /**
   * The TDS / ESI block the legacy form puts to the right of the Process,
   * Service AND SubContractor grids.
   *
   * ONE block over THREE header fields, rendered in all three sections — not
   * three copies of the panel and not per-section state. That is the whole
   * point: a retention % typed on the Process tab is already there when the
   * operator switches to Service, because there is only one of it.
   *
   * A JSX VALUE, deliberately not a `function TdsEsiPanel()` declared in here.
   * A component defined inside another gets a new function identity on every
   * parent render, so React treats it as a different type, unmounts the old
   * tree and mounts a fresh one. Because this form's state lives in `form`,
   * every keystroke re-rendered the parent and remounted the panel — so these
   * three inputs LOST FOCUS after each character typed. As a plain element the
   * fields stay mounted and keep focus. (`react-hooks/static-components`.)
   */
  const tdsEsiPanel = (
      /* Three fields, ONE row, laid out by WIDTH — `TDS_ESI_W` and
         `TDS_ESI_BOX_W` above carry the arithmetic and the reason the card is
         capped. `cols={1}` because the `FieldRow` below is the only row the card
         has to stack; on the twelfths track these three took 3 of 12 each and
         the card ran on to the pane's edge past them.

         A BARE BLOCK COMMENT, not a braced JSX one: this is the parenthesised
         expression `tdsEsiPanel` is assigned, not JSX children, so wrapping it
         in braces here is a syntax error rather than a comment.

         `compact` on the picker with the label on the `Field`, the same idiom
         the Identity row uses: `LevyPicker` draws its own caption otherwise, and
         a self-labelled cell beside two `Field`-labelled ones puts the three
         labels at two different offsets. */
      <DetailSection label="TDS & ESI" cols={1} className={TDS_ESI_BOX_W}>
        <FieldRow>
          <Field label="TDS ID No" w={TDS_ESI_W.tds_levy_id}>
            <LevyPicker
              label="TDS ID No"
              levies={tdsLevies}
              value={form.tds_levy_id}
              onChange={(id) => set({ tds_levy_id: id })}
              compact
            />
          </Field>
          {/* Unvalidated on purpose, like TIN No: an ESI registration is whatever
              the ESIC office issued, and a format guess would strand rows. */}
          <Field label="ESI No" w={TDS_ESI_W.esi_no} htmlFor="ve-esino">
            <Input
              uppercase
              id="ve-esino"
              value={form.esi_no}
              onChange={(e) => set({ esi_no: e.target.value })}
            />
          </Field>
          <Field label="ESI Retention %" w={TDS_ESI_W.esi_retention_pct} htmlFor="ve-esiret">
            <Input
              id="ve-esiret"
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              value={form.esi_retention_pct}
              onChange={(e) => set({ esi_retention_pct: e.target.value })}
            />
          </Field>
        </FieldRow>
      </DetailSection>
  );

  // Section bodies, keyed the same as SECTIONS. Declared here rather than
  // inline in the `sections` prop so the prop stays legible.
  const SECTION_CONTENT: Record<SectionKey, ReactNode> = {
    identity: (
      <SectionBody title="Identity">
        {/* The identity band — no card chrome, and no twelfths either: ONE
            `FieldRow`, laid out by WIDTHS. `IDENTITY_W` at the top of this file
            carries the row's arithmetic and the reason each field takes the step
            it does. It replaced a hand-rolled `sm:grid-cols-2` with a 12-column
            track (name 6 + type 3 + status 3, then country 3 + group 3 + the
            switch), and the track is what left a picked country and the vendor's
            own name in boxes of the same ~285px.

            Inactive still sits LAST, not first, so row 1 looks the same in New as
            in Edit (same reasoning as bank-master-screen) — but it is no longer a
            second row: at 944px the six cells share one line inside the narrowest
            pane this app gets (1142), so New and Edit differ by one cell rather
            than by a row.

            `align="start"`, not `FieldRow`'s default `items-end`: Name renders a
            `DuplicateError` and a `SpellSuggestHint` BELOW its control, and
            bottom alignment measures from the bottom — so the moment either
            appears it would lift the Name box clear of the boxes beside it, WHILE
            THE OPERATOR IS TYPING. Nothing here has the opposite hazard: every
            label sits in a cell wide enough for it, so none wraps. */}
        <FieldRow align="start" className="mb-3">
          <Field label="Name" w={IDENTITY_W.name} required htmlFor="ve-name">
            <Input
              id="ve-name"
              uppercase
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              // ↓ into the suggestion strip, Enter applies, Esc dismisses.
              onKeyDown={nameSuggest.onKeyDown}
              {...dupFieldProps(nameDupError, "ve-name")}
            />
            <DuplicateError error={nameDupError} id="ve-name" />
            <SpellSuggestHint
              suggestions={nameSuggest.suggestions}
              existing={nameSuggest.existing}
              activeIndex={nameSuggest.activeIndex}
              duplicate={!!nameDupError}
              onApply={(v) => setForm((f) => ({ ...f, name: v }))}
            />
          </Field>
          <Field label="Type" w={IDENTITY_W.vendor_type} htmlFor="ve-type">
            <Select
              id="ve-type"
              value={form.vendor_type}
              onChange={(e) => setVendorType(e.target.value as "" | VendorType)}
            >
              <option value=""></option>
              {VENDOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" w={IDENTITY_W.status} htmlFor="ve-status">
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
          <Field label="Country" w={IDENTITY_W.country_id}>
            <CountryPicker
              countries={countries}
              value={form.country_id || null}
              onChange={(id) => set({ country_id: id })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              compact
            />
          </Field>
          {/* `compact` and a `Field label`, the same idiom as Country beside
              it — this cell used to let the picker draw its own caption while
              Country's came from the `Field`, so the two labels sat at different
              offsets. That was invisible on a stretched grid cell and is not on
              a row that packs by width. `label` still reaches the picker: it is
              the dialog's title and the toast's noun, `compact` only stops it
              being drawn a second time. */}
          <Field label="Group Name" w={IDENTITY_W.group_id}>
            <LookupDialogPicker
              kind="vendor_group"
              label="Group Name"
              options={groups}
              value={form.group_id || null}
              onChange={(id) => set({ group_id: id })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              compact
            />
          </Field>
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
              so a `label="Inactive"` here would draw the name twice. */}
          {editId && (
            /* NO `w`: a switch is not one of the five widths, and an unsized
               `Field` in a flex row is exactly as wide as what is in it. */
            <Field label="">
              <Toggle
                id="ve-inactive"
                label="Inactive"
                checked={form.inactive}
                onChange={(inactive) => set({ inactive })}
              />
            </Field>
          )}
        </FieldRow>

        {/* Both blocks were hand-rolled cards (a bare `<Label>` over a
            `sm:grid-cols-2`, and a bordered div with an `<h3>`); they are
            real groups, so they become real `DetailSection`s and stop
            inventing their own borders and gaps. `span={2}` keeps each on a
            row of its own — the four Category captions do not fit in a
            half-width column, and neither card is a half of a pair now that
            each is capped to its own content rather than to the pane. */}
        <SectionGrid>
          {/* FOUR SWITCHES ON ONE LINE, AND A HAND-ROLLED FLEX ROW IS WHAT
              PUTS THEM THERE — `FieldRow` COLLAPSES THIS CARD TO NOTHING.

              ## The blank card, and why it was blank

              `FieldRow`'s root is `@container/section`, which is
              `container-type: inline-size`, which applies `contain: inline-size`
              — so the element's inline size may not be computed from its own
              contents, and it contributes ZERO to an ancestor sized from its
              children. `CATEGORY_BOX_W` is exactly such an ancestor
              (`max-w-fit`), so the card shrank past all four switches and
              settled on the widest thing in it that is not itself contained:
              its own "CATEGORY" caption.

              It was INVISIBLY wrong first and visibly wrong second. A wrapping
              `FieldRow` leaves `overflow: visible`, so the switches spilled out
              of the collapsed box and still read as a row; adding `nowrap` added
              `overflow-x-auto` to that same zero-width box and clipped every one
              of them, and the section rendered as a label over an empty card.

              This is the third recorded sighting of one cycle. `child-grid.tsx`
              carries the other two at length — `w-fit` belongs on the scroll
              wrapper and never on the `@container` root, and a `renderMobileRow`
              returning a `FieldGrid` collapses a hugging card to a 38px input
              (client 2026-09-03). Same containment, same shrink-to-fit ancestor,
              same answer: **never put a content-sized cap around a container-query
              root.** The two fixes available are to drop the cap or to drop the
              container, and here the cap is the rule (rule 4, the card hugs its
              content) while the container buys nothing — `Field`'s spans and
              widths are what `@container/section` exists to resolve, and there is
              not a `Field` in this row.

              ## So it is four `Toggle`s in a plain flex row

              `flex-row items-center gap-4 whitespace-nowrap text-xs` (client
              2026-09-10), and a plain div is also what survives the cap: it
              contributes its real max-content, where a `FieldRow` would
              contribute zero and be capped to nothing.

              `gap-4` (16px) is honoured literally here and could not have been
              through `FieldRow`, whose `gap` prop takes named steps on purpose so
              a new number cannot enter the app through one call site. That rule
              governs rows of FIELDS on the width vocabulary; this is a row of
              booleans with no widths at all, and it is not on that track. It was
              `gap-5` for a day.

              `text-xs` GOES ON THE SWITCHES AS WELL AS THE ROW, and both are
              needed. `Toggle`'s root sets `text-sm` on itself, so inheriting from
              the row cannot reach it — the row's `text-xs` is overridden by the
              child's own class. Passing it in the Toggle's `className` is what
              lands it, since `cn` is tailwind-merge and `className` is last.

              `whitespace-nowrap` keeps a caption on one line ("Is Bought Items
              Vendor" is 22 characters) and `shrink-0` on each switch stops flex
              squeezing that line into an ellipsis instead. `overflow-x-auto` is
              the honest answer on a window too narrow for all four — a scroll the
              operator can see, rather than a flag silently dropped onto a line of
              its own. It is safe on this div for the reason the whole note above
              turns on: overflow is not containment.

              `min-h-8` overrides `Toggle`'s own `min-h-9`, which exists to centre
              a switch against the 36px controls beside it. There are no controls
              beside these — the row holds nothing but switches — so it takes the
              32px compact height every other control in an editor already uses at
              `@2xl/editor`, rather than a new number.

              `Toggle`, not the tick box this replaced: every boolean in this app
              is a switch. It is still a real `<input type="checkbox">` underneath
              (`components/ui/toggle.tsx` says why at length), so `isFieldLike()`
              counts it and Tab, Enter-advance and the arrows all reach it. The
              bordered tile goes with the tick — a box drawn round each of four
              adjacent flags reads as four cards rather than one question asked
              four ways. */}
          <DetailSection label="Category" cols={1} span={2} className={CATEGORY_BOX_W}>
            <div className="flex flex-row flex-nowrap items-center gap-4 overflow-x-auto whitespace-nowrap text-xs">
              {CATEGORY_FLAGS.map((f) => (
                <Toggle
                  key={f.key}
                  id={`ve-${f.key}`}
                  label={f.label}
                  checked={form[f.key as CategoryKey]}
                  onChange={(next) => set({ [f.key]: next } as Partial<HeaderForm>)}
                  className="min-h-8 shrink-0 text-xs"
                />
              ))}
            </div>
          </DetailSection>

          {/* Five fields, ONE row — `REGISTRATION_W` carries the widths and
              `REGISTRATION_BOX_W` the card's cap. It used to be two rows on the
              twelfths track (four identifiers at 3, then Web site alone at 6 with
              half its line empty), and the four identifiers were ~285px apiece
              for values that cannot reach fifteen characters.

              `align="start"`: PAN and Web site are `ValidatedInput`s, which
              render their format message BELOW the control, and `items-end`
              measures from the bottom of that — so the first mistyped PAN would
              lift its box clear of the four beside it while the operator is
              still in the row. */}
          <DetailSection label="Registration" cols={1} span={2} className={REGISTRATION_BOX_W}>
            <FieldRow align="start">
              <Field label="TIN No." w={REGISTRATION_W.tin_no} htmlFor="ve-tin">
                <Input
                  uppercase
                  id="ve-tin"
                  value={form.tin_no}
                  onChange={(e) => set({ tin_no: e.target.value })}
                />
              </Field>
              <Field label="PAN No" w={REGISTRATION_W.pan_no} htmlFor="ve-pan">
                <ValidatedInput
                  id="ve-pan"
                  format="pan"
                  value={form.pan_no}
                  onChange={(e) => set({ pan_no: e.target.value })}
                />
              </Field>
              <Field label="Reg. Caption" w={REGISTRATION_W.reg_caption} htmlFor="ve-regcap">
                <Input
                  uppercase
                  id="ve-regcap"
                  value={form.reg_caption}
                  onChange={(e) => set({ reg_caption: e.target.value })}
                />
              </Field>
              <Field label="Reg. No / Dt" w={REGISTRATION_W.reg_no_dt} htmlFor="ve-regno">
                <Input
                  uppercase
                  id="ve-regno"
                  value={form.reg_no_dt}
                  onChange={(e) => set({ reg_no_dt: e.target.value })}
                />
              </Field>
              <Field label="Web site" w={REGISTRATION_W.web_site} htmlFor="ve-web">
                <ValidatedInput
                  id="ve-web"
                  format="website"
                  value={form.web_site}
                  onChange={(e) => set({ web_site: e.target.value })}
                />
              </Field>
            </FieldRow>
          </DetailSection>
        </SectionGrid>
      </SectionBody>
    ),
    address: (
      <SectionBody title="Address">
        {/* Ten fields per address — past the ~5 a row can hold and past the 8 at
            which LAYOUT.md §6 says stop inlining, so a card per address with a
            FieldGrid inside. This replaces a hand-rolled `min-w-[1120px]` table
            AND a separate `md:hidden` card branch that duplicated all ten
            fields: two renderings to keep in step, which is exactly what
            ChildGrid exists to prevent. The fields were labelled by column
            header on desktop and by nothing at all on mobile; they carry real
            labels now. */}
        {/* Capped to its own row, not to the pane (`erp-form-compact` rule 4) —
            `ADDRESS_BOX_W` above derives the number, and says why the cap is a
            wrapper here rather than `ChildGrid`'s own `hugsContent`. */}
        <div className={ADDRESS_BOX_W}>
        <ChildGrid<AddressRow>
          lockExisting
          label="Address Detail"
          rows={addresses}
          onAdd={addAddress}
          onRemove={(a) => removeAddress(a.key)}
          addLabel="+ Add address"
          forceCards
          flatRows
          pageSize={3}
          // `forceCards` + `renderMobileRow` mean these never render; they are
          // the fallback if this grid is ever switched back to a table.
          columns={[
            { header: "Address Type", cell: (a) => a.address_type },
            { header: "Street", cell: (a) => a.street },
          ]}
          renderMobileRow={(a) => (
            /* ONE wrapping `FieldRow`, laid out by WIDTHS — `ADDRESS_W` above
               carries the bands, the two lines this wraps into and why the cap
               makes them stable. It replaces three rows of the 12-col track, on
               which a six-digit PIN and the street itself took the same quarter
               of the card.

               `align="start"`, and this row has the hazard that choice is for:
               WhatsApp renders a "Same as mobile" tick BELOW its control, and
               both `ValidatedInput` cells can render a format message there.
               `items-end` measures from the bottom of that, so those cells would
               sit their LABEL a line above every other label on the row. Nothing
               here has the opposite hazard — the longest label is "Address Type",
               81.3px of Inter 600 at 12px inside a 144px cell, so none of the
               ten wraps to a second line. */
            <FieldRow align="start">
              <Field label="Address Type" w={ADDRESS_W.address_type}>
                <Input
                  uppercase
                  value={a.address_type}
                  onChange={(e) => setAddressAt(a.key, { address_type: e.target.value })}
                />
              </Field>
              <Field label="Street" w={ADDRESS_W.street}>
                <Input
                  uppercase
                  value={a.street}
                  onChange={(e) => setAddressAt(a.key, { street: e.target.value })}
                />
              </Field>
              {/* `compact` on all three, with the label on the `Field` — the same
                  idiom Identity and Service use, and for the reason Identity
                  states: a picker drawing its own caption beside a `Field` that
                  draws one puts the two labels at different offsets. Invisible on
                  a stretched twelfth, and not on a row that packs by width.
                  `label` still reaches each picker as the dialog's title and the
                  toast's noun; `compact` only stops it being drawn twice. */}
              <Field label="City" w={ADDRESS_W.city_id}>
                <LookupDialogPicker
                  kind="city"
                  label="City"
                  options={cities}
                  value={a.city_id || null}
                  onChange={(id) => setAddressAt(a.key, { city_id: id })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  compact
                />
              </Field>
              <Field label="State" w={ADDRESS_W.state_id}>
                <StatePicker
                  label="State"
                  options={states}
                  value={a.state_id || null}
                  onChange={(id) => setAddressAt(a.key, { state_id: id })}
                  // Scoped to THIS address's country: the 36 Indian GST states
                  // are not answers for a French address, and a state added
                  // under one is stamped with it. See state-picker.tsx.
                  countryId={a.country_id || null}
                  homeCountryId={indCountryId || null}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                  compact
                />
              </Field>
              <Field label="Country" w={ADDRESS_W.country_id}>
                <CountryPicker
                  countries={countries}
                  value={a.country_id || null}
                  onChange={(id) => setAddressAt(a.key, { country_id: id })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  compact
                />
              </Field>
              <Field label="Pin" w={ADDRESS_W.pin}>
                <ValidatedInput
                  format="pincode"
                  value={a.pin}
                  onChange={(e) => setAddressAt(a.key, { pin: e.target.value })}
                />
              </Field>
              <Field label="Land Line" w={ADDRESS_W.land_line}>
                <Input
                  value={a.land_line}
                  onChange={(e) => setAddressAt(a.key, { land_line: e.target.value })}
                />
              </Field>
              <Field w={ADDRESS_W.mobile}>
                <MobileField
                  id={`ve-${a.key}-mobile`}
                  value={a.mobile}
                  onChange={(v) => setAddressAt(a.key, { mobile: v })}
                />
              </Field>
              {/* The "Same as mobile" tick makes this cell ~18px taller than
                  the one beside it and the row grows to match — that is the
                  grid stretching, not a reason to give it a whole line. */}
              <Field w={ADDRESS_W.whatsapp}>
                <WhatsAppField
                  id={`ve-${a.key}-whatsapp`}
                  value={a.whatsapp}
                  mobile={a.mobile}
                  isdCode={isdOf.get(a.country_id) ?? null}
                  onChange={(v) => setAddressAt(a.key, { whatsapp: v })}
                />
              </Field>
              <Field label="Email ID" w={ADDRESS_W.email_id}>
                <ValidatedInput
                  format="email"
                  value={a.email_id}
                  onChange={(e) => setAddressAt(a.key, { email_id: e.target.value })}
                />
              </Field>
            </FieldRow>
          )}
        />
        </div>
      </SectionBody>
    ),
    itemcat: (
      <SectionBody title="Item Category">
        {/* The vendor-level radio the legacy form puts above the grid. Four
            mutually exclusive values, so radios rather than a Select: they are
            all visible at once and each is one click, which is what the legacy
            operator's muscle memory expects. */}
        <DetailSection label="Duty Details" cols={12}>
          <Field size="full">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {DUTY_DETAILS.map((d) => (
                <label key={d} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="ve-duty-details"
                    className="h-4 w-4 accent-primary"
                    checked={form.duty_details === d}
                    onChange={() => set({ duty_details: d as DutyDetail })}
                  />
                  {d}
                </label>
              ))}
            </div>
          </Field>
        </DetailSection>

        {/* Eight fields a row — past the ~5 a row holds and at the 8 where
            LAYOUT.md §6 says stop inlining — so a card per row. Every one of the
            six pickers is a real master: nothing here is free text. */}
        <ChildGrid<ItemCatRow>
          lockExisting
          label="Item Category Detail"
          rows={itemCats}
          onAdd={addItemCat}
          onRemove={(r) => removeItemCat(r.key)}
          addLabel="+ Add item category"
          forceCards
          flatRows
          pageSize={3}
          // Never rendered under `forceCards`; the fallback if this is ever
          // switched back to a table.
          columns={[
            { header: "Item Class", cell: (r) => itemClassLabel.get(r.item_class_id) ?? "—" },
            { header: "Category", cell: (r) => categoryLabel.get(r.category_id) ?? "—" },
          ]}
          renderMobileRow={(r) => (
            <FieldGrid>
              <Field size={FIELD_SIZE.item_class_id}>
                <LookupDialogPicker
                  kind="item_class"
                  label="Item Class"
                  options={itemClasses}
                  value={r.item_class_id || null}
                  onChange={(id) => setItemCatAt(r.key, { item_class_id: id ?? "" })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </Field>
              {/* Scoped by the class beside it — the whole point of the cascade
                  rule. An unscoped list would offer Yarn categories against a
                  Fabric class, and the row would save happily. */}
              <Field size={FIELD_SIZE.category_id}>
                <CategoryPicker
                  label="Item Category"
                  categories={categories.filter((c) => c.item_class_id === r.item_class_id)}
                  value={r.category_id}
                  // Scoped to THIS row's class, matching the option list above:
                  // a category taken under Yarn must stay free under Fabric.
                  usedIds={usedCategoriesByClass.get(r.item_class_id) ?? []}
                  onChange={(id) => setItemCatAt(r.key, { category_id: id })}
                  itemClassId={r.item_class_id || undefined}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                />
              </Field>
              <Field size={FIELD_SIZE.vat_levy_id}>
                <LevyPicker
                  label="VAT"
                  levies={vatLevies}
                  value={r.vat_levy_id}
                  onChange={(id) => setItemCatAt(r.key, { vat_levy_id: id })}
                />
              </Field>
              <Field size={FIELD_SIZE.duty_levy_id}>
                <LevyPicker
                  label="Duty"
                  levies={dutyLevies}
                  value={r.duty_levy_id}
                  onChange={(id) => setItemCatAt(r.key, { duty_levy_id: id })}
                />
              </Field>
              <Field label="Lead Days" size={FIELD_SIZE.lead_days}>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={r.lead_days}
                  onChange={(e) => setItemCatAt(r.key, { lead_days: e.target.value })}
                />
              </Field>
              {/* Form and Type are ▾ dropdowns on the legacy screen whose
                  contents the screenshot does not show, so they are managed
                  lists the operator fills through + Add rather than invented
                  `as const` values. Seed them in a migration once the legacy
                  lists are known — see doc/masters-open-questions.md. */}
              <Field size={FIELD_SIZE.form_id}>
                <LookupDialogPicker
                  kind="vendor_item_form"
                  label="Form"
                  options={itemForms}
                  value={r.form_id || null}
                  onChange={(id) => setItemCatAt(r.key, { form_id: id ?? "" })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </Field>
              <Field size={FIELD_SIZE.supply_type_id}>
                <LookupDialogPicker
                  kind="vendor_supply_type"
                  label="Type"
                  options={supplyTypes}
                  value={r.supply_type_id || null}
                  onChange={(id) => setItemCatAt(r.key, { supply_type_id: id ?? "" })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                />
              </Field>
              <Field size={FIELD_SIZE.payment_term_id}>
                <PaymentTermPicker
                  label="Payment Terms"
                  options={paymentTerms}
                  value={r.payment_term_id || null}
                  onChange={(id) => setItemCatAt(r.key, { payment_term_id: id ?? "" })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                />
              </Field>
            </FieldGrid>
          )}
        />
      </SectionBody>
    ),
    process: (
      <SectionBody title="Process">
        <ChildGrid<ProcessRow>
          lockExisting
          label="Vendor Process Detail"
          rows={procRows}
          onAdd={() => addRowTo(setProcRows, blankProcess)}
          onRemove={(r) => dropRow(setProcRows, r.key)}
          addLabel="+ Add process"
          forceCards
          flatRows
          pageSize={3}
          columns={[
            { header: "Process", cell: (r) => processLabel.get(r.process_id) ?? "—" },
            { header: "Vat Portion %", cell: (r) => r.vat_portion_pct || "—", align: "right" },
          ]}
          renderMobileRow={(r) => (
            <FieldGrid>
              <Field size={FIELD_SIZE.process_id}>
                <ProcessPicker
                  label="Process Name"
                  processes={processes}
                  value={r.process_id}
                  usedIds={usedProcessIds}
                  onChange={(id) => patchRow(setProcRows, r.key, { process_id: id })}
                />
              </Field>
              {/* Legacy calls this "Vat Description" because a levy is displayed
                  by its description — it is the same VAT master as everywhere. */}
              <Field size={FIELD_SIZE.vat_levy_id}>
                <LevyPicker
                  label="Vat Description"
                  levies={vatLevies}
                  value={r.vat_levy_id}
                  onChange={(id) => patchRow(setProcRows, r.key, { vat_levy_id: id })}
                />
              </Field>
              <Field label="Vat Portion %" size={FIELD_SIZE.vat_portion_pct}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  inputMode="decimal"
                  value={r.vat_portion_pct}
                  onChange={(e) => patchRow(setProcRows, r.key, { vat_portion_pct: e.target.value })}
                />
              </Field>
              <Field size={FIELD_SIZE.payment_term_id}>
                <PaymentTermPicker
                  label="Payment Terms"
                  options={paymentTerms}
                  value={r.payment_term_id || null}
                  onChange={(id) => patchRow(setProcRows, r.key, { payment_term_id: id ?? "" })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                />
              </Field>
            </FieldGrid>
          )}
        />
        {tdsEsiPanel}
      </SectionBody>
    ),
    service: (
      <SectionBody title="Service">
        {/* Capped to its own row, not to the pane (`erp-form-compact` rule 4) —
            `SERVICE_BOX_W` above derives the number and says why the cap is a
            wrapper here rather than `ChildGrid`'s own `hugsContent`. */}
        <div className={SERVICE_BOX_W}>
          <ChildGrid<ServiceRow>
            lockExisting
            label="Service Detail"
            rows={svcRows}
            onAdd={() => addRowTo(setSvcRows, blankService)}
            onRemove={(r) => dropRow(setSvcRows, r.key)}
            addLabel="+ Add service"
            forceCards
            flatRows
            pageSize={4}
            columns={[
              { header: "Service Type", cell: (r) => serviceTypeLabel.get(r.service_type_id) ?? "—" },
            ]}
            /* Two fields on ONE line, by width — `SERVICE_W` above. It was a
               `FieldGrid`, so each picker took 3 of the card's 12 columns and the
               other six were empty on every service line. `FieldRow`'s default
               `items-end`: neither picker renders a hint or an error below its
               control, and both labels fit their cells on one line.

               `compact` on both, with the label on the `Field` — each picker draws
               its own caption otherwise, and the two idioms mixed in one row put
               the labels at different offsets. `label` still reaches each picker as
               its dialog title and toast noun. */
            renderMobileRow={(r) => (
              <FieldRow>
                {/* A ⓘ list in legacy whose contents no screenshot shows, so it is
                    a managed list the operator fills — never invented values. */}
                <Field label="Service Type" w={SERVICE_W.service_type_id}>
                  <LookupDialogPicker
                    kind="vendor_service_type"
                    label="Service Type"
                    options={serviceTypes}
                    value={r.service_type_id || null}
                    usedIds={usedServiceTypeIds}
                    onChange={(id) => patchRow(setSvcRows, r.key, { service_type_id: id ?? "" })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                    compact
                  />
                </Field>
                <Field label="Payment Terms" w={SERVICE_W.payment_term_id}>
                  <PaymentTermPicker
                    label="Payment Terms"
                    options={paymentTerms}
                    value={r.payment_term_id || null}
                    onChange={(id) => patchRow(setSvcRows, r.key, { payment_term_id: id ?? "" })}
                    canCreate={perms.canCreate}
                    canEdit={perms.canEdit}
                    canDelete={perms.canDelete}
                    compact
                  />
                </Field>
              </FieldRow>
            )}
          />
        </div>
        {tdsEsiPanel}
      </SectionBody>
    ),
    subcontract: (
      <SectionBody title="SubContractor">
        {/* The Process grid without VAT — legacy asks a sub-contractor only which
            process and on what terms, over the same Process master. */}
        <ChildGrid<SubcontractRow>
          lockExisting
          label="Vendor SubContractor Detail"
          rows={subRows}
          onAdd={() => addRowTo(setSubRows, blankSubcontract)}
          onRemove={(r) => dropRow(setSubRows, r.key)}
          addLabel="+ Add sub-contract"
          forceCards
          flatRows
          pageSize={4}
          columns={[{ header: "Process", cell: (r) => processLabel.get(r.process_id) ?? "—" }]}
          renderMobileRow={(r) => (
            <FieldGrid>
              <Field size={FIELD_SIZE.process_id}>
                <ProcessPicker
                  label="Process Name"
                  processes={processes}
                  value={r.process_id}
                  usedIds={usedSubProcessIds}
                  onChange={(id) => patchRow(setSubRows, r.key, { process_id: id })}
                />
              </Field>
              <Field size={FIELD_SIZE.payment_term_id}>
                <PaymentTermPicker
                  label="Payment Terms"
                  options={paymentTerms}
                  value={r.payment_term_id || null}
                  onChange={(id) => patchRow(setSubRows, r.key, { payment_term_id: id ?? "" })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                />
              </Field>
            </FieldGrid>
          )}
        />
        {tdsEsiPanel}
      </SectionBody>
    ),
    other: (
      <SectionBody title="Other Details">
        {/* Thirteen fields, so titled sections rather than one flat list
            (LAYOUT.md §4) — the two headings this used to draw by hand (a
            bare `<h3>` over a `border-t`) were saying the same thing without
            the structure. Each takes the full row (`span={2}`): a bank name
            beside a GSTIN in a half-width column is back to three fields a
            row, which is what this pass exists to fix. */}
        <SectionGrid>
          {/* FIVE FIELDS, ONE LINE — `BANKING_W` above carries the widths and
              says why none of them is a new measurement. On the twelfths track
              this was 3+3+3+3 and then A/c Type alone on a second row with
              three quarters of it empty; the fifth field now simply follows the
              fourth.

              `align="start"`: A/c No and IFSC Code are `ValidatedInput`s, which
              render their format message BELOW the control, and `items-end`
              measures from the bottom of that — so the first mistyped IFSC would
              lift its box clear of the four beside it while the operator is
              still in the row.

              `cols={1}` because the `FieldRow` is the only row this card has to
              stack, and `OTHER_BOX_W` is the cap all three cards share. */}
          <DetailSection label="Banking" cols={1} span={2} className={OTHER_BOX_W}>
            <FieldRow align="start">
              <Field label="Bank Name" w={BANKING_W.bank_name} htmlFor="ve-bank">
                <Input
                  uppercase
                  id="ve-bank"
                  value={form.bank_name}
                  onChange={(e) => set({ bank_name: e.target.value })}
                />
              </Field>
              <Field label="Branch" w={BANKING_W.branch} htmlFor="ve-branch">
                <Input
                  uppercase
                  id="ve-branch"
                  value={form.branch}
                  onChange={(e) => set({ branch: e.target.value })}
                />
              </Field>
              <Field label="A/c No" w={BANKING_W.ac_no} htmlFor="ve-acno">
                <ValidatedInput
                  id="ve-acno"
                  format="account"
                  value={form.ac_no}
                  onChange={(e) => set({ ac_no: e.target.value })}
                />
              </Field>
              <Field label="IFSC Code" w={BANKING_W.ifsc_code} htmlFor="ve-ifsc">
                <ValidatedInput
                  id="ve-ifsc"
                  format="ifsc"
                  value={form.ifsc_code}
                  onChange={(e) => set({ ifsc_code: e.target.value })}
                />
              </Field>
              <Field label="A/c Type" w={BANKING_W.ac_type} htmlFor="ve-actype">
                <Input
                  uppercase
                  id="ve-actype"
                  value={form.ac_type}
                  onChange={(e) => set({ ac_type: e.target.value })}
                />
              </Field>
            </FieldRow>
          </DetailSection>

          {/* Two fields and the strip that decodes the second of them — see
              `GST_W` above, and note the strip takes `w-full` rather than
              `size="full"`, which is a col-span and inert in a flex row. (The
              Debit / Credit Group pickers that used to fill the other six
              twelfths went with the Account Group master, 2026-08-01.)

              `align="start"`: the GST number is a `ValidatedInput` AND carries a
              `DuplicateError` under it, either of which would lift its box clear
              of the status select beside it under `items-end`. */}
          <DetailSection label="GST" cols={1} span={2} className={OTHER_BOX_W}>
            <FieldRow align="start">
              <Field label="GST No" w={GST_W.gst_reg_status} htmlFor="ve-gststatus">
                <Select
                  id="ve-gststatus"
                  value={form.gst_reg_status}
                  onChange={(e) => set({ gst_reg_status: e.target.value as "" | GstRegStatus })}
                >
                  <option value=""></option>
                  {GST_REG_STATUSES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="GST Number" w={GST_W.gst_no} htmlFor="ve-gstno">
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
                  {...dupFieldProps(gstDupError, "ve-gstno")}
                />
                <DuplicateError error={gstDupError} id="ve-gstno" />
              </Field>
              {gstin && (
                /* `w-full`, NOT `size="full"` — see `GST_W`. The `-mt-1` pulls the
                   strip up under the number now that the row is top-aligned. */
                <Field className="w-full -mt-1">
                  <GstinInsight
                    decoded={gstin}
                    panValue={form.pan_no}
                    suggestions={gstinSuggestions}
                  />
                </Field>
              )}
            </FieldRow>
          </DetailSection>

          {/* Four short identifiers under four long labels, so one step for all
              four — `ADDITIONAL_W` above. `FieldRow`'s default `items-end` here:
              nothing in this row renders a message below its control, and bottom
              alignment is what keeps a label that ever does wrap from dropping
              its box below the row. */}
          <DetailSection label="Additional Details" cols={1} span={2} className={OTHER_BOX_W}>
            <FieldRow>
              <Field
                label="Enterprise Status"
                w={ADDITIONAL_W.enterprise_status}
                htmlFor="ve-enterprise-status"
              >
                <Input
                  uppercase
                  id="ve-enterprise-status"
                  value={form.enterprise_status}
                  onChange={(e) => set({ enterprise_status: e.target.value })}
                />
              </Field>
              <Field label="Memorandum No" w={ADDITIONAL_W.memorandum_no} htmlFor="ve-memorandum-no">
                <Input
                  uppercase
                  id="ve-memorandum-no"
                  value={form.memorandum_no}
                  onChange={(e) => set({ memorandum_no: e.target.value })}
                />
              </Field>
              <Field label="Inhouse Unit ID" w={ADDITIONAL_W.inhouse_unit_id} htmlFor="ve-inhouse-unit">
                <Input
                  uppercase
                  id="ve-inhouse-unit"
                  value={form.inhouse_unit_id}
                  onChange={(e) => set({ inhouse_unit_id: e.target.value })}
                />
              </Field>
              <Field label="Duty Against" w={ADDITIONAL_W.duty_against} htmlFor="ve-duty-against">
                <Input
                  uppercase
                  id="ve-duty-against"
                  value={form.duty_against}
                  onChange={(e) => set({ duty_against: e.target.value })}
                />
              </Field>
            </FieldRow>
          </DetailSection>
        </SectionGrid>
      </SectionBody>
    ),
  };


  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* caps-input: exempt -- a search QUERY is not a stored value. */}
        <Input uppercase={false}
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
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No vendors yet." />
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
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
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
        sections={SECTIONS.filter((s) => !s.when || s.when(form)).map((s) => ({
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
          // A duplicate GSTIN blocks Save AND Save-as-Draft — a draft is still a
          // row in `master_vendors`, so letting it through the draft path would
          // leave exactly the duplicate the guard exists to prevent.
          canSave: !!form.name.trim() && !gstDupError && !nameDupError,
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
        sections={viewRow ? [...viewSections(viewRow), ...createdSection(viewRow)] : []}
      />
    </div>
  );
}

/** A titled content block inside the editor's content pane. */
