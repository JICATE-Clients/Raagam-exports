"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MapPin, Package, SlidersHorizontal, Truck, User, Users, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Field, FieldGrid, FieldRow, type FieldSize, type FieldWidth } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useBlockAction } from "@/components/masters/use-block-action";
import { MasterFullScreen, SectionBody } from "@/components/masters/master-full-screen";
import { CountryPicker } from "@/components/masters/country-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { StatePicker } from "@/components/masters/state-picker";
import { ApplicantPicker } from "@/components/masters/applicant-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { ChildGrid } from "@/components/masters/child-grid";
import { Toggle } from "@/components/ui/toggle";
import { MobileWhatsAppFields, useIsdLookup } from "@/components/masters/contact-fields";
import { PackingFormatColumnsDialog } from "@/components/masters/packing-format-columns-dialog";
import { GstinInsight, type GstinSuggestion } from "@/components/masters/gstin-insight";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { decodeGstin, matchGstinState } from "@/lib/validation/gstin";
import { defaultCountryId, defaultStateId } from "@/lib/masters/geo-defaults";
import type { PackingFormatColumn } from "@/lib/masters/packing-format-columns-service";
import { createCustomer, updateCustomer, deleteCustomer } from "@/lib/masters/customer-actions";
import {
  partyOrigin,
  OriginBadge,
  PublishesBadge,
  originDeleteBlock,
  type PartyOrigin,
} from "@/components/masters/party-origin";
import { PARTY_ROLE } from "@/lib/masters/party-origin-text";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  type Customer,
  type CustomerInput,
  SHIP_MODES,
  PAY_MODES,
  BUSINESS_ENTITIES,
  PAN_BUSINESS_ENTITY,
} from "@/lib/masters/customer-types";
import type { TaApproval } from "@/lib/masters/ta-approval-types";
import type { Applicant } from "@/lib/masters/applicant-types";
import type { Country } from "@/lib/masters/country-types";
import type { Currency } from "@/lib/masters/types";
import { lookupLabel, type ConfigLookup } from "@/lib/masters/extras-types";
import { createdSection } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type SectionKey = "identity" | "address" | "agents" | "supplied" | "vendors" | "approvals" | "general";

type HeaderForm = {
  code: string;
  name: string;
  inactive: boolean;
  doc_prefix: string;
  doc_id: string;
  also_consignee: boolean;
  also_notify: boolean;
  business_entity: string;
  inhouse_unit_id: string;
  country_id: string;
  // Address
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
/**
 * Only one master publishes customers — Applicant ▸ Also Customer (0371) — but
 * this goes through the same helper as Consignee and Notify so all three read
 * and behave identically.
 */
const customerOrigin = (r: Customer) =>
  partyOrigin([
    {
      id: r.source_applicant_id,
      source: r.source_applicant,
      from: "Applicant",
      flag: "Also Customer",
    },
  ]);

/** What this customer has published — the far end of the same link, and what a
 *  delete here would take with it (0378). */
const customerPublishes = (r: Customer): string[] => [
  ...(r.also_consignee ? [PARTY_ROLE.consignee] : []),
  ...(r.also_notify ? [PARTY_ROLE.notify] : []),
];

const BLANK: HeaderForm = {
  code: "",
  name: "",
  inactive: false,
  doc_prefix: "",
  doc_id: "",
  also_consignee: false,
  also_notify: false,
  business_entity: "",
  inhouse_unit_id: "",
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

/**
 * How wide each scalar field is, on the 12-column track (LAYOUT.md §3).
 *
 * Every section used to hand-roll `sm:grid-cols-2`, so a 3-letter currency code
 * got the same ~560px box as a customer name (client 2026-07-24 #3). Sizes here
 * follow the DATA — `xs`=2 · `sm`=3 · `md`=4 · `lg`=6 · `full`=12, out of 12.
 * Adjust here, not at the call sites.
 *
 * THE SPANS OF ONE ROW MUST SUM TO 12 — at 13 the last field wraps onto a row of
 * its own with the rest of that row left empty under it. The rows, in DOM order:
 *
 *   Identity  Name 6 + Doc Prefix 3 + ID 3                                = 12
 *             Also Consignee 2 + Also Notify 2 + Country 4 + Entity 4     = 12
 *             In-house Unit ID 3                                          (tail)
 *             `inactive` is `full` above all of it: it renders only while
 *             editing, so anything sharing its row would reflow on Add.
 *
 *   Address   Street 12 (a 3-row textarea stands alone)                   = 12
 *             City 3 + State 3 + Pin 2 + Country 4                        = 12
 *             Land Line 3 + Mobile 3 + WhatsApp 3 + E-Mail 3              = 12
 *             Web site 6                                                  (tail)
 *             Mobile/WhatsApp are `MobileWhatsAppFields` — a fragment of two
 *             cells, so their 3 is passed as a literal `cellClassName` rather
 *             than from this map (Tailwind v4 scans source text).
 *
 *   General   Currency 1/2/3 2+2+2 + Ship Mode 2 + Ship Type 4            = 12
 *             Pay Mode 2 + Receivable Terms 6 + Pref. Courier 4           = 12
 *             Port of Loading 4 + Port of Discharge 4 + Destination 4     = 12
 *             Packing List Format 6 + Commercial Invoice Format 6         = 12
 *             Color Spec 3 + TCS 2 + GST No 3                             = 8
 *             GstinInsight 12 — the fact strip decoded from the GST number
 *             above it, which is why that row stops at 8 rather than filling.
 */
/**
 * ONE SIZE, EVERY FIELD: `sm` = 3 of 12 = four per row (client 2026-07-29). The
 * client picked the City / State / Pin / Country row out as the correct shape
 * and asked for the rest of the masters to match it, so nothing here is sized
 * to its own data any more. See applicant-master-screen for the full statement
 * of the rule and what it trades away.
 *
 * `gstin_insight` is the one exception and is not a field — it is a read-only
 * fact strip (decoded state, PAN, supply type) that stands alone on its row by
 * nature, the same way a child grid does.
 *
 * Packing List Format keeps its inline "Columns" button inside a 3-column cell.
 * That is ~285px on this screen — the editor is full width, so a 3-col span is
 * not the ~132px it would be in one column of a `SectionGrid` — which leaves
 * the picker ~185px beside a ~90px button. Split the editor into columns and
 * that pairing is the first thing that breaks.
 */
/**
 * IDENTITY LEAVES THE TWELFTHS TRACK, AND THEN LEAVES THE WIDTH VOCABULARY TOO
 * (client 2026-09-09: eight fields "tightly on a single horizontal row",
 * `flex-nowrap`, `gap-2.5`, each width named).
 *
 * The first step was the ordinary one. Nine fields at `size="sm"` is 3 of 12
 * each, so on a 1440px pane a two-character Doc Prefix was as wide as the
 * customer's NAME and the section broke into three ragged rows. A fraction
 * cannot be made compact — shrinking the control inside a twelfth leaves the
 * CELL at its old width and the value floating in a hole — so `FieldRow` +
 * per-field widths is the move, exactly as Country, Destination and Port made on
 * 2026-09-08.
 *
 * ## THESE ARE HAND-MEASURED PIXELS, NOT `FieldWidth`, AND THAT IS THE TRADE
 *
 * `lib/ui/sizes.ts` states the rule these break, in its own words: "There are
 * FIVE widths for the whole application, not one per field — the failure this
 * must never become is a screen measured against its own longest value." That
 * rule is right and it is why the five-width vocabulary exists.
 *
 * It was tried here FIRST and the client rejected the result. The nearest
 * vocabulary fit is 288/112/112/144/112/176/176/144 = 1264px of controls, and
 * every one of those is a step wider than the value needs: `code` (144) for a
 * unit id that holds four characters, `name` (288) for a customer name the
 * client wants at 170. The row was compact by the vocabulary's standards and
 * still not compact, because the vocabulary's floor is coarser than this row.
 *
 * So the widths below are the client's, named per field, and they are scoped to
 * THIS ROW by living in this file rather than by widening `FieldWidth`. That
 * boundary is the whole mitigation: nothing else in the app can reach them, and
 * a screen that wants a compact row still meets the five widths first. **Do not
 * copy this map to another screen** — reach for `FieldWidth`, and come back here
 * only if the same rejection happens again, at which point the vocabulary needs
 * a sixth width rather than a second exception.
 *
 * DERIVED, so it can be checked against the pane:
 *
 *   170 + 85 + 85 + 110 + 95 + 95 + 150 + 130 = 920   the controls
 *   + 7 x 10                                  =  70   FIELD_ROW_NOWRAP's gap-x-2.5
 *   = 990                                             one line inside the 1440 cap
 *
 * `also_notify` is the one width the client did not name — a tick and the word
 * "Yes" needs almost nothing, so it takes its LABEL's width, the same 95px as
 * "Also Consignee" beside it. Two of the others are label-bound rather than
 * value-bound too: "In-house Unit ID" and "Business Entity" are longer than
 * anything typed into them. `items-end` covers the case where one of those still
 * wraps — the label goes to two lines and the control stays on the row's line.
 */
const IDENTITY_W = {
  name: "w-[170px]",
  doc_prefix: "w-[85px]",
  doc_id: "w-[85px]",
  inhouse_unit_id: "w-[110px]",
  also_consignee: "w-[95px]",
  also_notify: "w-[95px]", //     not named by the client; sized by its label
  country_id: "w-[150px]",
  business_entity: "w-[130px]",
} satisfies Record<string, string>;

/**
 * GENERAL, SHRINK-WRAPPED (client 2026-09-09: currencies ~100, selects ~150,
 * GST ~140, "so they don't stretch across the full screen").
 *
 * Seventeen fields at `size="sm"` is 3 of 12 each, so a three-letter currency
 * CODE was ~340px on a 1440px pane and the section ran to five rows of four with
 * a hole in the last one. `FieldRow` + `Field w=` is the fix, and unlike
 * Identity this one needs NO hand-typed pixels: the `erp-form-compact` bands map
 * straight onto the five-width vocabulary, which is where the skill says to look
 * first.
 *
 *   short options 90-120  ->  `range` 112   currencies, Ship Mode, TCS
 *   selects       140-170  ->  `code`  144   Pay Mode, Ship Type, ports, formats
 *   text / codes  130-160  ->  `code`  144   GST No
 *
 * THREE FIELDS SIT OUTSIDE THOSE BANDS, each for a reason that is about the
 * CONTROL rather than the value:
 *
 * - `packing_list_format_id` is `name` (288) because its cell holds TWO controls
 *   — the picker and the "Columns" button that edits the very format picked
 *   beside it. The picker is `flex-1` inside, so it lands at ~196px and the
 *   button keeps its own width. At `code` the button would have squeezed the
 *   picker to nothing.
 * - `commercial_invoice_format_id` is `term` (176) because its LABEL is 25
 *   characters. At 144 it wraps to two lines, and a wrapping label is the one
 *   thing `items-start` below cannot absorb.
 * - `color_spec_applicable` keeps `code` (144) for the same reason at the
 *   margin: the value is Yes/No, the label is 21 characters.
 *
 * Nothing here is sized to its own longest VALUE, which is the line the
 * vocabulary draws. Ship Type holds "DELIVERED DUTY PAID (DDP)" and still takes
 * 144 — the picker clips it with an ellipsis and reveals it on hover, which is
 * the `Truncated` contract doing its job.
 *
 *   5 x 112 + 10 x 144 + 288 + 176 = 2464   the controls
 *   + 15 x 12                      =  180   FIELD_ROW's gap-x-3
 *   = 2644                                  two wrapped lines inside the 1440 cap
 *
 * TWO LINES IS THE POINT, not a miss. Seventeen fields cannot sit on one, and the
 * comparison is against the FIVE rows the twelfths track drew.
 */
const GENERAL_W = {
  currency_1: "range",
  currency_2: "range",
  currency_3: "range",
  ship_mode: "range",
  ship_type_id: "code",
  pay_mode: "code",
  receivable_term_id: "code",
  pref_courier_id: "code",
  port_of_loading_id: "code",
  port_of_discharge_id: "code",
  final_destination_id: "code",
  packing_list_format_id: "name", //           holds the picker AND its "Columns" button
  commercial_invoice_format_id: "term", //     a 25-character LABEL, not a wide value
  color_spec_applicable: "code", //            a 21-character label over a Yes/No
  tcs_applicable: "range",
  gst_no: "code",
} satisfies Record<string, FieldWidth>;

/**
 * THE MARKING GRID IS CAPPED TO THE FORM, NOT THE SCREEN (`erp-form-compact`
 * rule 4). It is ONE column of text: uncapped, `ChildGrid` is a block box and
 * drew a single "Marking" column across the whole 1440px pane, with the ✕ a foot
 * away from the value it removes.
 *
 * Derived from what the grid actually contains — the `#` index, one `name`-width
 * value and the row's ✕ — rather than picked to look right:
 *
 *   288 (the value) + ~40 (#) + ~40 (remove) + the card's own padding ~= 400
 */
const MARKING_W = "max-w-[26rem]";

/**
 * THE APPROVALS GRID HUGS ITS COLUMNS (`erp-form-compact` rule 4, same rule as
 * `MARKING_W` above — a sub-grid is capped to the FORM's width, not the screen's).
 *
 * It reached that rule from the other side. Marking is capped by a wrapper
 * because it is ONE flexible column and there is nothing to hug; this grid has
 * four columns of BOUNDED content, so the answer is `ChildGrid`'s own
 * `hugsContent` — declare a `width` on EVERY column and the table becomes
 * `w-auto table-fixed` inside a `w-fit` card instead of `w-full` across the pane.
 * It is all-or-nothing: the toggle and Review Days already declared one, and two
 * of four is the same as none, which is why an 18-row tick list was drawing
 * MERCHANDISING in a ~400px cell.
 *
 * Derived from the content, not picked to look right. The values are the
 * `ta_approvals` seed (0542), the cells are `text-sm` in `px-2`:
 *
 *   toggle   48 — a Toggle, unchanged
 *   name    256 — "WHITE SEAL SAMPLE APPROVAL", the longest of the 18, is ~218px
 *                 of 14px capitals + 16px padding. A longer one WRAPS to a second
 *                 line; it does not overflow, so this stays a width and not a
 *                 measurement of the current data.
 *   dept    160 — "MERCHANDISING" (~118px + padding). The column is `text` and
 *                 0542's own comment says every row holds that one value today.
 *   days     72 — the `num` step from `lib/ui/sizes.ts`: a count, never more
 *                 than two digits (0542 seeds 5 · 7 · 10 · 14). It was `8rem`,
 *                 sized to nothing, and 112px on the way down.
 *
 *   40 (the `#` track) + 48 + 256 + 160 + 72 = 576, + GRID_FRAME's padding.
 *
 * THE HEADER IS WHAT WAS HOLDING THAT COLUMN OPEN, so it changed with it:
 * "REVIEW DAYS" is ~98px of 12.5px bold capitals at `tracking-[0.06em]` plus
 * 16px of `px-2`, so the widest thing in the column was its own title and no
 * width under ~114px could be honoured without wrapping it onto a second line —
 * which lifts the header band for all four columns and undoes the compaction it
 * was meant to buy. "Days" fits on one line at 72px. It reads unambiguously
 * beside Approval and Department, the input keeps the full "customer review
 * days" in its `aria-label`, and it matches how every other narrow numeric
 * column in this app is titled (Alt qty, Base qty, Loss %, Cons Qty).
 *
 * WELL CLEAR OF THE `@lg` SWITCH (512px), which is the coupling to leave alone:
 * the layout is a container query on the grid's own root, so a cap under that
 * breakpoint flips the table to stacked cards — and this grid passes no
 * `renderMobileRow`, so those cards would be 18 unlabelled boxes.
 */
const APPROVALS_W = {
  applies: "3rem",
  name: "16rem",
  department: "10rem",
  review_days: "4.5rem",
} satisfies Record<string, string>;

const FIELD_SIZE = {
  // ---- Address ----
  street: "sm", // a single-line Input now — a Textarea sets the row's height
  city_id: "sm",
  state_id: "sm",
  pin: "sm",
  address_country_id: "sm",
  land_line: "sm",
  email: "sm",
  web_site: "sm",
} satisfies Record<string, FieldSize>;

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
/**
 * THE AGENTS GRID OPENS WITH ONE BLANK ROW (`erp-table-default-row`), the last
 * of this editor's five child grids to get one.
 *
 * BOTH cells stay `""`. `normalizeAgents` in `customer-actions.ts` drops a row
 * on `agent_type_id || agent_id`, so a row is kept the moment EITHER is set —
 * which is right for a half-entered agent and is also why neither key may carry
 * a default. Pre-filling a type (there are few agent types and one is common)
 * would satisfy that OR on every seeded row and insert a `customer_agents` line
 * naming no agent.
 */
const blankAgent = (key: string): AgentRow => ({ key, agent_type_id: "", agent_id: "" });
type CatRow = { key: string; category_id: string };
/**
 * SEWING AND PACKAGING EACH OPEN WITH ONE BLANK ROW
 * (`erp-table-default-row`), the same as the two vendor lists below. Supplied
 * Items is two side-by-side single-column grids, so an empty tab showed two
 * headers and two "+ Add category" buttons and nothing to type in.
 *
 * `normalizeSupplied` in `customer-actions.ts` drops a row by testing
 * `category_id`, this grid's only field, so a seeded row writes no
 * `customer_supplied_items` line until a category is picked.
 */
const blankCat = (key: string): CatRow => ({ key, category_id: "" });
type VendorRow = { key: string; vendor_id: string };
/**
 * NOMINATED AND RECOMMENDED EACH OPEN WITH ONE BLANK ROW
 * (`erp-table-default-row`). Both lists on the Nominated Vendors tab are typing
 * surfaces, and the tab used to show two headers and two "+ Add vendor" buttons —
 * so naming a customer's first approved supplier cost a click in each column
 * before any typing.
 *
 * Blank means blank. `normalizeVendors` in `customer-actions.ts` drops a row by
 * testing `vendor_id`, which is the only field this grid has, so a seeded row
 * writes nothing until a vendor is picked. That matters more here than on most
 * grids: MBA narrows its own vendor picker to this list, so a phantom row would
 * reach a downstream document rather than just sitting in the master.
 */
const blankVendor = (key: string): VendorRow => ({ key, vendor_id: "" });
type MarkRow = { key: string; marking: string };
/**
 * THE MARKING GRID IS NEVER EMPTY — one blank row is always waiting
 * (`erp-table-default-row`). An operator opening General expects a caret, not a
 * "+ Add marking" button to find first, and this is the same shape
 * `blankContact` above already gives the Contacts grid.
 *
 * It is a FACTORY rather than an inline literal at each of the four call sites
 * (mount, New, Edit-with-no-rows, "+ Add") because the seeded row's blankness is
 * load-bearing: `normalizeMarkings` in `customer-actions.ts` drops a row by
 * testing `marking` for content, so any key stamped with a truthy default here
 * would turn that filter into a constant and insert a phantom marking. One
 * definition is what keeps the four call sites honest.
 */
const blankMarking = (key: string): MarkRow => ({ key, marking: "" });

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
  sewingCategories,
  packingCategories,
  agentTypes,
  agentOptions,
  packingFormats,
  commercialFormats,
  vendors,
  receivableTerms,
  ports,
  destinations,
  couriers,
  packingColumns,
  approvals,
  companyGstin = null,
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
  /** Categories of item class SEW — feeds the Sewing Accessories card. */
  sewingCategories: ConfigLookup[];
  /** Categories of item class PACK — feeds the Packaging Accessories card. */
  packingCategories: ConfigLookup[];
  agentTypes: ConfigLookup[];
  agentOptions: ConfigLookup[];
  packingFormats: ConfigLookup[];
  commercialFormats: ConfigLookup[];
  vendors: PickerItem[];
  receivableTerms: PickerItem[];
  ports: PickerItem[];
  destinations: PickerItem[];
  couriers: PickerItem[];
  packingColumns: PackingFormatColumn[];
  /** The 18-milestone Approvals Dictionary (doc/approval.md §2) — every ACTIVE
   *  `ta_approvals` row, for the Approvals policy checklist. */
  approvals: TaApproval[];
  /**
   * Our own GSTIN — the reference point that turns a customer's GSTIN into
   * "Within State" / "Other State". Optional because the /masters page does not
   * fetch the company profile on the customer branch yet (only the vendor one
   * does); until it does, decodeGstin reports supply "unknown" and the strip
   * simply omits that fact.
   */
  companyGstin?: string | null;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  // list filtering/search is owned by MasterListShell
  const [open, setOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  /** The row being READ. Separate from `editId` — a view must never arm Save. */
  const [viewRow, setViewRow] = useState<Customer | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  /**
   * Set while editing a row Applicant ▸ Also Customer published (0371). Its
   * Name belongs to the applicant and is read-only here — that removes the
   * rename conflict instead of resolving it. Everything else on this record
   * (GST, TCS, terms, its child grids) is genuinely its own.
   */
  const [editOrigin, setEditOrigin] = useState<PartyOrigin | null>(null);
  const [dirty, setDirty] = useState(false);
  const isdOf = useIsdLookup(countries);
  /** Block / Unblock in the listing's ⋮ menu — one implementation for every
   *  master listing, and the reason Identity carries no Inactive switch. */
  const { blockItem } = useBlockAction("customer");

  // Hold off the silent PWA auto-reload while there's unsaved work or a save is
  // in flight. The overlay itself is a MasterFullScreen, which already guards.
  useUnsavedGuard(dirty || isPending);

  const [form, setForm] = useState<HeaderForm>(BLANK);
  // Seeded, never `[]` — see the `markings` note below for the literal key and
  // for why this screen seeds state rather than passing `seedRow`.
  const [contacts, setContacts] = useState<ContactRow[]>(() => [blankContact("ct0")]);
  const [applicantIds, setApplicantIds] = useState<string[]>([]);
  // Seeded, never `[]` — see the `markings` note below for the literal key and
  // for why this screen seeds state rather than passing `seedRow`.
  const [agents, setAgents] = useState<AgentRow[]>(() => [blankAgent("ag0")]);
  // Seeded, never `[]` — see the `markings` note below for the literal key and
  // for why this screen seeds state rather than passing `seedRow`.
  const [sewing, setSewing] = useState<CatRow[]>(() => [blankCat("sw0")]);
  const [packing, setPacking] = useState<CatRow[]>(() => [blankCat("pk0")]);
  /**
   * Seeded, never `[]` — see the `markings` note below for why the key is a
   * literal here and why this screen seeds its STATE rather than passing
   * `ChildGrid`'s `seedRow` (its `onAdd` sets `dirty`, and `VendorGrid`'s does
   * too). `openAdd` / `openEdit` re-seed before the overlay opens; these values
   * only ever cover the mount.
   */
  const [nominated, setNominated] = useState<VendorRow[]>(() => [blankVendor("nv0")]);
  const [recommended, setRecommended] = useState<VendorRow[]>(() => [blankVendor("rv0")]);
  /**
   * Seeded, never `[]` (`erp-table-default-row`). `openAdd` / `openEdit` below
   * both re-seed before the overlay opens, so this initial value is only ever
   * the mount-time one — but it is stated rather than left empty so the grid
   * cannot render row-less by any path.
   *
   * The key is a LITERAL, not `newKey()`: an initialiser runs during render and
   * `newKey` reads `keySeq.current`, which `react-hooks/refs` correctly rejects.
   * Keys only have to be unique within the array, and the sequence issues `k…`,
   * so `m0` can never collide with one.
   *
   * NOT `ChildGrid`'s own `seedRow`, and that is deliberate — do not "simplify"
   * it into one. `seedRow` seeds by CALLING `onAdd` from an effect, and this
   * screen's `onAdd` sets `dirty`. Every customer would then open reading
   * "Unsaved changes", and `useUnsavedGuard(dirty || isPending)` would hold off
   * the silent PWA auto-reload on a record nobody had touched. Seeding the state
   * instead happens in `openAdd` / `openEdit` BEFORE their `setDirty(false)`, so
   * a pristine record stays pristine. `seedRow` is right for a grid whose add
   * handler does not touch a dirty flag (Department, Work Timing, the process
   * grids); it is wrong here.
   */
  const [markings, setMarkings] = useState<MarkRow[]>(() => [blankMarking("m0")]);
  /**
   * The Approvals policy checklist (doc/approval.md §3) — keyed by
   * `approval_id`, value is the lead-time-days TEXT the operator typed.
   * PRESENCE OF A KEY is "this approval applies to this customer"; there is
   * no separate boolean, so un-ticking a row deletes its key rather than
   * flipping a flag on it (mirrors `customer_approval_defaults` itself,
   * which has no `is_mandatory` column for the same reason).
   */
  const [approvalDays, setApprovalDays] = useState<Record<string, string>>({});
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const set = (patch: Partial<HeaderForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  // (body-scroll-lock + section state now live inside MasterFullScreen)

  const applicantById = useMemo(() => {
    const m = new Map<string, Applicant>();
    for (const a of applicants) m.set(a.id, a);
    return m;
  }, [applicants]);
  const countryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.name);
    return m;
  }, [countries]);

  /**
   * id → name across every option list the editor's pickers already receive —
   * config lists, the two Category sets (`categories` rows since 0356, NOT
   * config_lookups) and the four RecordPicker masters. One map for all of them
   * because these ids are uuids and cannot collide, and the read-only view
   * resolves an FK the same way the picker does: out of props, never with a
   * query of its own.
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
      sewingCategories,
      packingCategories,
      agentTypes,
      agentOptions,
      packingFormats,
      commercialFormats,
      vendors,
      receivableTerms,
      ports,
      destinations,
      couriers,
    ];
    for (const list of lists) for (const o of list) m.set(o.id, o.name);
    // Ship Type overwrites its own plain-name entries: its code is an Incoterm,
    // so the view reads "FREE ON BOARD (FOB)" — the same label the field showed.
    for (const s of shipTypes) m.set(s.id, lookupLabel("ship_type", s));
    return m;
  }, [
    cities,
    states,
    departments,
    designations,
    internalDepartments,
    shipTypes,
    sewingCategories,
    packingCategories,
    agentTypes,
    agentOptions,
    packingFormats,
    commercialFormats,
    vendors,
    receivableTerms,
    ports,
    destinations,
    couriers,
  ]);
  /** Never renders a raw uuid: an id we cannot name reads as nothing at all. */
  const nameOf = (id: string | null | undefined) => (id ? (optionName.get(id) ?? "") : "");

  // ---------------------------------------------------------------- GSTIN ----
  // Everything below is decoded from the GST number itself — no lookup, no
  // network. See lib/validation/gstin.ts for what the 15 characters carry.
  //
  // Unlike the vendor screen this one writes NOTHING automatically: customers
  // have no PAN column, so there is no empty box the GSTIN can safely fill.
  // That also means no `loadedGstin` ref is needed here — merely opening a
  // record cannot mark the form dirty when nothing auto-fills.

  const gstin = useMemo(
    () => decodeGstin(form.gst_no, { companyGstin }),
    [form.gst_no, companyGstin],
  );
  // The State master row this customer's GSTIN points at — code first, spelling
  // as a fallback. Shared with vendor and consignee; see matchGstinState.
  const gstinState = useMemo(() => matchGstinState(gstin, states), [gstin, states]);

  // What a NEW customer's Address block opens on: India, and our own state (read
  // out of the company GSTIN). See lib/masters/geo-defaults.
  const blankForm = useMemo<HeaderForm>(
    () => ({
      ...BLANK,
      state_id: defaultStateId(states, companyGstin),
      // Both columns — the single Country field (Identity) drives them
      // together now (see that picker's comment).
      country_id: defaultCountryId(countries),
      address_country_id: defaultCountryId(countries),
    }),
    [states, countries, companyGstin],
  );

  // Two customers must not share a GSTIN — one registration belongs to exactly
  // one party. Note this is NOT done for PAN anywhere: one PAN legitimately
  // carries one GSTIN per state, so a PAN check would flag multi-state groups.
  const gstDupError = useDuplicateName({
    table: "customers",
    name: form.gst_no,
    nameColumn: "gst_no",
    excludeId: editId ?? undefined,
    label: "GST number",
    enabled: !!form.gst_no.trim(),
    // This one HOLDS the cursor, so it needs the synchronous half as much as
    // the name does — a GSTIN is pasted, and a pasted value is tabbed away from
    // immediately, well inside the 300ms debounce.
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.gst_no,
  });

  /**
   * Two customers must not share a NAME. Customer and Consignee were the only
   * party masters without this — Vendor, Applicant and Notify all guard it on
   * save — so a second "SRI LAKSHMI TEXTILES" saved silently here and nowhere
   * else. Backstopped by the matching guard in `customer-actions.ts`.
   *
   * Stood down while `editOrigin` holds the name read-only: the operator cannot
   * change that field, so an error on it would be a message about a problem
   * they have no way to fix from this screen.
   */
  const nameDupError = useDuplicateName({
    table: "customers",
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

  // What the GSTIN implies but that we refuse to write silently. Empty while
  // the checksum fails — we never propagate a number we don't trust.
  const gstinSuggestions = useMemo<GstinSuggestion[]>(() => {
    if (!gstin?.checksumValid) return [];
    const out: GstinSuggestion[] = [];

    // PAN_BUSINESS_ENTITY only answers the PAN codes that map to ONE entity
    // (see customer-types.ts) — "Company" and "Firm / LLP" are ambiguous and
    // deliberately offer nothing rather than a guess.
    const entity = PAN_BUSINESS_ENTITY[gstin.panEntityChar];
    if (entity && form.business_entity !== entity) {
      out.push({
        key: "entity",
        label: `Set Entity = ${entity}`,
        onApply: () => {
          set({ business_entity: entity });
          // Toasted because Business Entity sits in Identity while the GST
          // number sits in General — the change lands off-screen.
          success(`Business Entity set to ${entity}`);
        },
      });
    }

    // Gated on "differs", not "is empty". The State box now OPENS on our own
    // state, so an empty-only test would hide this chip on exactly the customers
    // that need it: an out-of-state GSTIN sitting silently beside a defaulted
    // home state. Offered, never written — the same rule as Business Entity.
    if (gstinState && form.state_id !== gstinState.id) {
      out.push({
        key: "state",
        label: `Set State = ${gstinState.name}`,
        onApply: () => {
          set({ state_id: gstinState.id });
          // Toasted because State sits in Address while the GST number sits in
          // General — the change lands off-screen.
          success(`State set to ${gstinState.name} in the Address section`);
        },
      });
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin, gstinState, form.business_entity, form.state_id]);

  function openAdd() {
    setEditId(null);
    setEditOrigin(null);
    setForm(blankForm);
    setContacts([blankContact(newKey())]);
    setApplicantIds([]);
    setAgents([blankAgent(newKey())]);
    setSewing([blankCat(newKey())]);
    setPacking([blankCat(newKey())]);
    setNominated([blankVendor(newKey())]);
    setRecommended([blankVendor(newKey())]);
    setMarkings([blankMarking(newKey())]);
    setApprovalDays({});
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: Customer) {
    setEditId(r.id);
    setEditOrigin(customerOrigin(r));
    // One visible Country field now feeds both stored columns (see the
    // pickers below) — `country_id` is authoritative (it is what the list
    // column, header chip and read-only view all resolve), so it wins; a row
    // saved before this fix that only ever had `address_country_id` filled in
    // still opens with a country rather than a blank picker.
    const countryId = r.country_id ?? r.address_country_id ?? "";
    setForm({
      code: r.code ?? "",
      name: r.name,
      inactive: r.inactive,
      doc_prefix: r.doc_prefix ?? "",
      doc_id: r.doc_id ?? "",
      also_consignee: r.also_consignee,
      also_notify: r.also_notify,
      business_entity: r.business_entity ?? "",
      inhouse_unit_id: r.inhouse_unit_id ?? "",
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
    const contactsIn = (r.contacts ?? []).map((c) => ({
      key: newKey(),
      department_id: c.department_id ?? "",
      contact_name: c.contact_name ?? "",
      designation_id: c.designation_id ?? "",
      land_line: c.land_line ?? "",
      mobile: c.mobile ?? "",
      email_id: c.email_id ?? "",
      internal_department_id: c.internal_department_id ?? "",
    }));
    setContacts(contactsIn.length ? contactsIn : [blankContact(newKey())]);
    setApplicantIds(r.applicants.map((a) => a.applicant_id).filter((id): id is string => !!id));
    const agentsIn = (r.agents ?? []).map((a) => ({
      key: newKey(),
      agent_type_id: a.agent_type_id ?? "",
      agent_id: a.agent_id ?? "",
    }));
    setAgents(agentsIn.length ? agentsIn : [blankAgent(newKey())]);
    // One array split by section, so each side is independently empty — a
    // customer who supplies sewing trims but no packaging is ordinary, not a
    // half-loaded record. Each falls back on its own count, exactly as the two
    // vendor lists below do.
    const suppliedRowsIn = (section: "sewing" | "packing") =>
      (r.supplied_items ?? [])
        .filter((x) => x.section === section)
        .map((x) => ({ key: newKey(), category_id: x.category_id ?? "" }));
    const sewingIn = suppliedRowsIn("sewing");
    const packingIn = suppliedRowsIn("packing");
    setSewing(sewingIn.length ? sewingIn : [blankCat(newKey())]);
    setPacking(packingIn.length ? packingIn : [blankCat(newKey())]);
    // Both lists come out of ONE array, so each is independently empty on most
    // customers — a nomination list with no recommendations is the normal case,
    // not a missing record. Each falls back on its own count.
    const vendorRowsIn = (kind: "nominated" | "recommended") =>
      (r.nominated_vendors ?? [])
        .filter((v) => v.list_kind === kind)
        .map((v) => ({ key: newKey(), vendor_id: v.vendor_id ?? "" }));
    const nominatedIn = vendorRowsIn("nominated");
    const recommendedIn = vendorRowsIn("recommended");
    setNominated(nominatedIn.length ? nominatedIn : [blankVendor(newKey())]);
    setRecommended(recommendedIn.length ? recommendedIn : [blankVendor(newKey())]);
    // `[]`, null and a row-less record all mean "no markings yet", which is the
    // state the blank row exists for — so Row 1 is ready to type on an existing
    // customer too, not only a new one.
    const markingRowsIn = (r.markings ?? []).map((m) => ({ key: newKey(), marking: m.marking ?? "" }));
    setMarkings(markingRowsIn.length ? markingRowsIn : [blankMarking(newKey())]);
    setApprovalDays(
      Object.fromEntries(r.approval_policy.map((p) => [p.approval_id, String(p.lead_time_days)])),
    );
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
        // Create derives the code from the display name; edit keeps the
        // record's original stored code (held in state, never rendered).
        code: editId ? form.code.trim() || null : form.name.trim() || null,
        name: form.name.trim(),
        inactive: form.inactive,
        doc_prefix: form.doc_prefix.trim() || null,
        doc_id: form.doc_id.trim() || null,
        also_consignee: form.also_consignee,
        also_notify: form.also_notify,
        business_entity: form.business_entity || null,
        inhouse_unit_id: form.inhouse_unit_id.trim() || null,
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
        approval_policy: Object.entries(approvalDays).map(([approval_id, days]) => ({
          approval_id,
          lead_time_days: Number(days) || 0,
        })),
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
    // A published row is owned by its source: deleting it here while "Also
    // Customer" stayed ticked would just republish it on the applicant's next
    // save.
    const origin = customerOrigin(r);
    if (origin) {
      error(originDeleteBlock(origin));
      return;
    }
    startTransition(async () => {
      const res = await deleteCustomer(r.id);
      if (res.ok) {
        success(deletedToast("Customer", res));
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
      form.mobile ||
      form.whatsapp ||
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
  const hasApprovals = Object.keys(approvalDays).length > 0;
  const done: Record<SectionKey, boolean> = {
    identity: hasIdentity,
    address: hasAddress,
    agents: hasAgents,
    supplied: hasSupplied,
    vendors: hasVendors,
    approvals: hasApprovals,
    general: hasGeneral,
  };

  /**
   * The record as a READER sees it. Mirrors the editor's rail — Identity ·
   * Address · Agents · Supplied Items · Nominated Vendors · General — so the
   * view and the form tell the same story, and every FK is resolved to the name
   * the picker would have shown.
   *
   * Nothing here filters empties: `RecordViewSheet` drops an empty value and an
   * all-empty section on its own. The child cards are the exception — they are
   * `content`, which is never auto-hidden, so each is built as `undefined` when
   * the card holds nothing rather than as an empty list.
   */
  function viewSectionsFor(r: Customer): ViewSection[] {
    const viewOrigin = customerOrigin(r);
    const applicantRows = r.applicants
      .map((a) => ({
        key: a.id,
        main: (a.applicant_id ? applicantById.get(a.applicant_id)?.name : null) ?? "",
      }))
      .filter((a) => a.main);

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

    const agentRows = r.agents
      .map((a) => ({
        key: a.id,
        main: nameOf(a.agent_id) || nameOf(a.agent_type_id),
        detail: nameOf(a.agent_id) ? nameOf(a.agent_type_id) : "",
      }))
      .filter((a) => a.main);

    const categoryRows = (section: "sewing" | "packing") =>
      r.supplied_items
        .filter((s) => s.section === section)
        .map((s) => ({ key: s.id, main: nameOf(s.category_id) }))
        .filter((s) => s.main);
    const sewingRows = categoryRows("sewing");
    const packingRows = categoryRows("packing");

    const vendorRows = (kind: "nominated" | "recommended") =>
      r.nominated_vendors
        .filter((v) => v.list_kind === kind)
        .map((v) => ({ key: v.id, main: nameOf(v.vendor_id) }))
        .filter((v) => v.main);
    const nominatedRows = vendorRows("nominated");
    const recommendedRows = vendorRows("recommended");

    const markingRows = r.markings
      .map((m) => ({ key: m.id, main: m.marking?.trim() ?? "" }))
      .filter((m) => m.main);

    return [
      {
        label: "Identity",
        pairs: [
          ["Doc Prefix", r.doc_prefix],
          ["ID", r.doc_id],
          ["Also Consignee", r.also_consignee ? "Yes" : "No"],
          ["Also Notify", r.also_notify ? "Yes" : "No"],
          ["Country", r.country_id ? (countryLabel.get(r.country_id) ?? "") : ""],
          ["Business Entity", r.business_entity],
          ["In-house Unit ID", r.inhouse_unit_id],
          // Only when it IS published — an empty row on an ordinary customer
          // would invite "published by what?" for no reason.
          ...(viewOrigin
            ? [[`From ${viewOrigin.from}`, `${viewOrigin.name} (${viewOrigin.flag})`] as const]
            : []),
        ],
        content:
          applicantRows.length > 0 ? (
            <ChildList label="Applicant(s)" rows={applicantRows} />
          ) : undefined,
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
          contactRows.length > 0 ? <ChildList label="Contacts" rows={contactRows} /> : undefined,
      },
      {
        label: "Agents",
        content:
          agentRows.length > 0 ? <ChildList label="Customer Agents" rows={agentRows} /> : undefined,
      },
      {
        label: "Supplied Items",
        content:
          sewingRows.length > 0 || packingRows.length > 0 ? (
            <div className="space-y-3">
              {sewingRows.length > 0 && (
                <ChildList label="Sewing Accessories" rows={sewingRows} />
              )}
              {packingRows.length > 0 && (
                <ChildList label="Packaging Accessories" rows={packingRows} />
              )}
            </div>
          ) : undefined,
      },
      {
        label: "Nominated Vendors",
        content:
          nominatedRows.length > 0 || recommendedRows.length > 0 ? (
            <div className="space-y-3">
              {nominatedRows.length > 0 && (
                <ChildList label="Nominated Vendor" rows={nominatedRows} />
              )}
              {recommendedRows.length > 0 && (
                <ChildList label="Recommended Vendor" rows={recommendedRows} />
              )}
            </div>
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
          ["Receivable Terms", nameOf(r.receivable_term_id)],
          ["Pref. Courier", nameOf(r.pref_courier_id)],
          ["Port of Loading", nameOf(r.port_of_loading_id)],
          ["Port of Discharge", nameOf(r.port_of_discharge_id)],
          ["Final Destination", nameOf(r.final_destination_id)],
          ["Packing List Format", nameOf(r.packing_list_format_id)],
          ["Commercial Invoice Format", nameOf(r.commercial_invoice_format_id)],
          ["Color Spec Applicable", r.color_spec_applicable ? "Yes" : "No"],
          ["TCS", r.tcs_applicable ? "Yes" : "No"],
          // The number itself, not the GstinInsight strip: that strip is an
          // input-time aid (decode, entity suggestion) and none of it is a fact
          // about the record.
          ["GST No", r.gst_no],
        ],
        content:
          markingRows.length > 0 ? <ChildList label="Marking" rows={markingRows} /> : undefined,
      },
    ];
  }

  const columns: Column<Customer>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {r.name}
          <OriginBadge origin={customerOrigin(r)} />
          <PublishesBadge roles={customerPublishes(r)} />
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
  ];

  const initials = (form.code || form.name || "?").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-4">
      <MasterListShell<Customer>
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.code, r.name, r.email].filter(Boolean).join(" ")}
        searchPlaceholder="Search customer…"
        statusOf={(r) => (r.is_draft ? "draft" : r.inactive ? "inactive" : "active")}
        addLabel="+ Add Customer"
        onAdd={openAdd}
        columns={columns}
        actions={{
          onView: setViewRow,
          onEdit: openEdit,
          onDelete: remove,
          /**
           * BLOCK / UNBLOCK LIVES HERE, NOT ON THE FORM (client 2026-08-17:
           * "block option move to that table listing … no more in the creating
           * screen"). Identity's Inactive switch was removed in the same change,
           * so this is the only route to the flag and had to land first.
           *
           * `perms.canDelete` because blocking is the destructive direction and
           * `setMasterActive` gates it that way server-side. The label reads off
           * `isInactive`, so a blocked row offers "Unblock" without this screen
           * knowing which of the three spellings `customers` uses.
           */
          menu: (r) => blockItem(r, { label: r.name, canBlock: perms.canDelete }),
        }}
        empty="No customers yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) =>
            [
              r.country_id ? (countryLabel.get(r.country_id) ?? "") : "",
              customerOrigin(r) ? `from ${customerOrigin(r)?.from}` : "",
            ]
              .filter(Boolean)
              .join(" · "),
          pill: (r) => (
            <StatusPill tone={r.is_draft ? "warning" : r.inactive ? "danger" : "success"}>
              {r.is_draft ? "Draft" : r.inactive ? "Inactive" : "Active"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      {/* ================= full-screen editor ================= */}
      <MasterFullScreen
        open={open}
        onClose={() => setOpen(false)}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">{form.name.trim() || "customer"}</span>
          </>
        }
        header={{
          initials,
          title: form.name.trim() || "Untitled customer",
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
              {form.also_consignee && <span>· Also consignee</span>}
              {form.also_notify && <span>· Also notify</span>}
            </>
          ),
          right: (
            <>
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
                        <X className="h-4 w-4 shrink-0" />
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
            </>
          ),
        }}
        sections={[
          {
            key: "identity",
            label: "Identity",
            icon: User,
            done: done.identity,
            content: (
                  <SectionBody title="Identity">
                    {/* ONE `FieldRow`, laid out by WIDTHS — see `IDENTITY_W` at the
                        top of this file for the arithmetic and for which two widths
                        trade against `FieldWidth`'s own test.

                        NO INACTIVE SWITCH HERE ANY MORE (client 2026-08-17: "block
                        option move to that table listing … we are used to give that
                        block while CREATING the data but we need to move this in
                        ACTION only, no more in the creating screen"). It is the
                        listing's ⋮ ▸ Block / Unblock now — `useBlockAction` above,
                        with `customer` registered in `lib/masters/active-registry.ts`
                        in the same change. **The row action had to land first**: it
                        is the only route to the flag once the field is gone, and
                        deleting the field alone would have made blocking a customer
                        impossible rather than moved it. `form.inactive` is still in
                        the form state and still round-trips, so an edit cannot null
                        it — the value is simply no longer typed here, exactly as
                        `bank-master-screen.tsx` already has it.

                        It was also the field that made this row impossible to
                        tighten: unlabelled and edit-only, it left a hole on New and
                        a floating switch on Edit, so the row had two shapes. */}
                    {/* `align="start"` — TOP-ALIGNED, and the whole row rather than
                        a `self-start` on one field (client 2026-09-09: every input
                        box on the exact same horizontal line, labels top-aligned,
                        and Name's helper text not pushing the others down).

                        THE CHOICE IS ABOUT WHICH HAZARD THIS ROW HAS. `items-end`
                        is the house default and it is there for a LABEL that
                        outgrows its box — bottom-aligning keeps such a field's
                        control on the row's line. This row does not have that
                        problem: labels are `text-xs`, and the longest,
                        "In-house Unit ID", is ~96px inside its 110px box, so all
                        eight sit on one line. What it does have is content BELOW a
                        control — Name renders a `DuplicateError` and a
                        `SpellSuggestHint`, and bottom alignment measures from the
                        bottom of both, so the row visibly jumped as soon as a
                        colliding name was typed. (Name carried an `originNameHint`
                        under it as well until 2026-09-09, when the client had it
                        removed outright — the label and its box, nothing else. The
                        origin is still said twice on this screen: `OriginBadge` in
                        the editor header, and a "From <source>" pair in the record
                        sheet, so nothing about where the row came from is lost.)

                        `self-start` on Name alone fixed that field and left the
                        row's own axis wrong, which is why it is gone: with the row
                        top-aligned there is nothing left to override, and the
                        boxes line up whether or not the helper text is showing.
                        See `FIELD_ROW_NOWRAP_TOP` for how to choose. */}
                    <FieldRow nowrap align="start">
                      <Field label="Name" required className={IDENTITY_W.name} htmlFor="cu-name">
                        {/* `readOnly`, not `disabled`: the value still submits
                            and still copies, and Input's own readOnly sets
                            tabIndex={-1}, so it leaves the Tab order for free. */}
                        <Input id="cu-name" uppercase readOnly={!!editOrigin} value={form.name} onChange={(e) => set({ name: e.target.value })} required
                          // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                          onKeyDown={nameSuggest.onKeyDown}
                          {...dupFieldProps(nameDupError, "cu-name")} />
                        <DuplicateError error={nameDupError} id="cu-name" />
                        <SpellSuggestHint
                          suggestions={nameSuggest.suggestions}
                          existing={nameSuggest.existing}
                          activeIndex={nameSuggest.activeIndex}
                          duplicate={!!nameDupError}
                          onApply={(v) => setForm((f) => ({ ...f, name: v }))}
                        />
                      </Field>
                      {/* THE THREE IDENTIFIER CODES SIT TOGETHER (client 2026-09-09).
                          In-house Unit ID used to close the row, four fields away from the
                          Doc Prefix and ID it belongs with; the row reads as one band, so
                          the codes being adjacent is what makes it scannable. */}
                      <Field label="Doc Prefix" className={IDENTITY_W.doc_prefix} htmlFor="cu-prefix">
                        <Input uppercase id="cu-prefix" value={form.doc_prefix} onChange={(e) => set({ doc_prefix: e.target.value })} />
                      </Field>
                      <Field label="ID" className={IDENTITY_W.doc_id} htmlFor="cu-docid">
                        <Input uppercase id="cu-docid" value={form.doc_id} onChange={(e) => set({ doc_id: e.target.value })} />
                      </Field>
                      <Field label="In-house Unit ID" className={IDENTITY_W.inhouse_unit_id} htmlFor="cu-inhouseunit">
                        <Input uppercase id="cu-inhouseunit" value={form.inhouse_unit_id} onChange={(e) => set({ inhouse_unit_id: e.target.value })} />
                      </Field>
                      <Field label="Also Consignee" className={IDENTITY_W.also_consignee} htmlFor="cu-alsocons">
                        <Select id="cu-alsocons" value={form.also_consignee ? "yes" : "no"} onChange={(e) => set({ also_consignee: e.target.value === "yes" })}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </Select>
                      </Field>
                      {/* The tick's text moves up into the field label, and the
                          cell gets `min-h-9 items-center` so it centres on the
                          same 36px control height as the Select beside it. That
                          replaces a `sm:pt-6` hack which faked the same offset
                          at one viewport width only. */}
                      <Field label="Also Notify" className={IDENTITY_W.also_notify} htmlFor="cu-alsonotify">
                        <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
                          <input id="cu-alsonotify" type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.also_notify} onChange={(e) => set({ also_notify: e.target.checked })} />
                          <span className="text-sm text-foreground">Yes</span>
                        </label>
                      </Field>
                      {/* `compact` + the label on `Field`: the picker renders its
                          OWN <Label> otherwise, so the cell would show "Country"
                          twice. Its built-in label also carries a required
                          asterisk that this form does not honour — country_id is
                          nullable in customerInput — so `Field`'s label is the
                          more accurate of the two. Same for every picker below.
                          This is also now the ONLY Country field on this form
                          (client complaint 2026-07-31: two boxes both labelled
                          "Country" read as a duplicate). It writes BOTH
                          `country_id` and `address_country_id` — see the Address
                          section below, which used to carry its own picker for
                          the second column. */}
                      <Field label="Country" className={IDENTITY_W.country_id}>
                        <CountryPicker countries={countries} value={form.country_id || null} onChange={(id) => set({ country_id: id, address_country_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                      </Field>
                      <Field label="Business Entity" className={IDENTITY_W.business_entity} htmlFor="cu-bizentity">
                        <Select id="cu-bizentity" value={form.business_entity} onChange={(e) => set({ business_entity: e.target.value })}>
                          <option value=""></option>
                          {BUSINESS_ENTITIES.map((b) => <option key={b} value={b}>{b}</option>)}
                        </Select>
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
                    <FieldGrid>
                      {/* A single-line Input, not the 3-row Textarea this used
                          to be: every grid row is as tall as its tallest item,
                          so a textarea sharing the row would leave City / State
                          / Pin above a band of dead space. Stored newlines
                          survive; an <input> just shows them on one line. */}
                      <Field label="Street" size={FIELD_SIZE.street} htmlFor="cu-street">
                        <Input uppercase id="cu-street" value={form.street} onChange={(e) => set({ street: e.target.value })} />
                      </Field>
                      {/* The pickers were the self-labelling idiom while the rest
                          of the screen used an external <Label> + `compact`. One
                          idiom now, or half the cells would carry two labels. */}
                      <Field label="City" size={FIELD_SIZE.city_id}>
                        <LookupDialogPicker kind="city" label="City" options={cities} value={form.city_id || null} onChange={(id) => set({ city_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="State" size={FIELD_SIZE.state_id}>
                        <StatePicker label="State" options={states} value={form.state_id || null} onChange={(id) => set({ state_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                      </Field>
                      <Field label="Pin" size={FIELD_SIZE.pin} htmlFor="cu-pin">
                        <Input id="cu-pin" value={form.pin} onChange={(e) => set({ pin: e.target.value })} />
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
                      <Field label="Land Line" size={FIELD_SIZE.land_line} htmlFor="cu-landline">
                        <Input id="cu-landline" value={form.land_line} onChange={(e) => set({ land_line: e.target.value })} />
                      </Field>
                      {/* Two grid children, not one — so the span goes to EACH
                          cell via `cellClassName`. A literal string: Tailwind v4
                          scans source text, so an interpolated span emits no CSS.
                          It is FIELD_SIZE's `sm` (3) written the only way this
                          component can take it. */}
                      <MobileWhatsAppFields
                        idPrefix="cu"
                        mobile={form.mobile}
                        whatsapp={form.whatsapp}
                        isdCode={isdOf.get(form.address_country_id) ?? null}
                        onMobileChange={(v) => set({ mobile: v })}
                        onWhatsAppChange={(v) => set({ whatsapp: v })}
                        cellClassName="@lg/section:col-span-3"
                      />
                      <Field label="E-Mail" size={FIELD_SIZE.email} htmlFor="cu-email">
                        <ValidatedInput format="email" id="cu-email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
                      </Field>
                      <Field label="Web site" size={FIELD_SIZE.web_site} htmlFor="cu-web">
                        <ValidatedInput format="website" id="cu-web" value={form.web_site} onChange={(e) => set({ web_site: e.target.value })} />
                      </Field>
                    </FieldGrid>

                    {/* contacts */}
                    <div className="mt-6">
                      <ChildGrid<ContactRow>
                        lockExisting
                        label="Contacts"
                        pageSize={10}
                        rows={contacts}
                        onAdd={addContact}
                        onRemove={(c) => removeContact(c.key)}
                        addLabel="+ Add contact"
                        columns={[
                          {
                            header: "Department",
                            className: "min-w-[160px]",
                            cell: (c) => (
                              <LookupDialogPicker kind="department" label="Department" options={departments} value={c.department_id || null} onChange={(id) => setContactAt(c.key, { department_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                            ),
                          },
                          {
                            header: "Contact Name",
                            className: "min-w-[130px]",
                            cell: (c) => <Input uppercase value={c.contact_name} onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })} className="h-8 text-sm" />,
                          },
                          {
                            header: "Designation",
                            className: "min-w-[160px]",
                            cell: (c) => (
                              <LookupDialogPicker kind="designation" label="Designation" options={designations} value={c.designation_id || null} onChange={(id) => setContactAt(c.key, { designation_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
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
                              <LookupDialogPicker kind="department" label="Department" options={departments} value={c.department_id || null} onChange={(id) => setContactAt(c.key, { department_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
                            </div>
                            <Input uppercase placeholder="Contact Name" value={c.contact_name} onChange={(e) => setContactAt(c.key, { contact_name: e.target.value })} className="text-base md:text-sm" />
                            <div>
                              <Label>Designation</Label>
                              <LookupDialogPicker kind="designation" label="Designation" options={designations} value={c.designation_id || null} onChange={(id) => setContactAt(c.key, { designation_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} canDelete={perms.canDelete} compact />
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
            ),
          },
          {
            key: "agents",
            label: "Agents",
            icon: Users,
            done: done.agents,
            content: (
                  <SectionBody title="Agents">
                    <ChildGrid<AgentRow>
                      lockExisting
                      label="Customer Agents"
                      pageSize={10}
                      rows={agents}
                      onAdd={() => {
                        setAgents((xs) => [...xs, blankAgent(newKey())]);
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
            ),
          },
          {
            key: "supplied",
            label: "Supplied Items",
            icon: Package,
            done: done.supplied,
            content: (
                  <SectionBody title="Supplied Items">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <CategoryGrid title="Sewing Accessories" rows={sewing} setRows={setSewing} categories={sewingCategories} perms={perms} newKey={newKey} setDirty={setDirty} />
                      <CategoryGrid title="Packaging Accessories" rows={packing} setRows={setPacking} categories={packingCategories} perms={perms} newKey={newKey} setDirty={setDirty} />
                    </div>
                  </SectionBody>
            ),
          },
          {
            key: "vendors",
            label: "Nominated Vendors",
            icon: Truck,
            done: done.vendors,
            content: (
                  <SectionBody title="Nominated Vendors">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <VendorGrid title="Nominated Vendor" rows={nominated} setRows={setNominated} vendors={vendors} newKey={newKey} setDirty={setDirty} />
                      <VendorGrid title="Recommended Vendor" rows={recommended} setRows={setRecommended} vendors={vendors} newKey={newKey} setDirty={setDirty} />
                    </div>
                  </SectionBody>
            ),
          },
          {
            key: "approvals",
            label: "Approvals",
            icon: CheckCircle2,
            done: done.approvals,
            content: (
                  <SectionBody title="Approvals">
                    {/* `hideAdd` + `hideRemove` (doc/approval.md §3, and the
                        HR sweep's "no hand-rolled boxes" — client 2026-09-07:
                        "did you see" the primitives replacing bordered panels
                        elsewhere). The 18 rows are the `ta_approvals` master
                        itself: nothing here is added or deleted, only ticked.
                        `ChildGrid` still earns its place over a plain list —
                        the keyboard contract (Tab lands on fields, arrows move
                        cell to cell) comes for free instead of being rebuilt
                        for a table this screen would otherwise hand-roll.

                        Every column declares a `width` — see `APPROVALS_W` for
                        the arithmetic and for why two of four was the same as
                        none. */}
                    <ChildGrid<TaApproval & { key: string }>
                      rows={approvals.map((a) => ({ ...a, key: a.id }))}
                      hideAdd
                      hideRemove
                      onAdd={() => {}}
                      onRemove={() => {}}
                      columns={[
                        {
                          header: "",
                          width: APPROVALS_W.applies,
                          align: "center",
                          cell: (a) => (
                            <Toggle
                              checked={a.id in approvalDays}
                              ariaLabel={`${a.name} — applies to this customer`}
                              onChange={(checked) => {
                                setApprovalDays((m) => {
                                  const next = { ...m };
                                  if (checked) next[a.id] = String(a.standard_days || 0);
                                  else delete next[a.id];
                                  return next;
                                });
                                setDirty(true);
                              }}
                            />
                          ),
                        },
                        {
                          header: "Approval",
                          width: APPROVALS_W.name,
                          cell: (a) => <span className="text-foreground">{a.name}</span>,
                        },
                        {
                          header: "Department",
                          width: APPROVALS_W.department,
                          cell: (a) => <span className="text-muted-foreground">{a.department}</span>,
                        },
                        {
                          header: "Days",
                          width: APPROVALS_W.review_days,
                          cell: (a) => (
                            <Input
                              type="number"
                              min="0"
                              disabled={!(a.id in approvalDays)}
                              value={approvalDays[a.id] ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setApprovalDays((m) => ({ ...m, [a.id]: v }));
                                setDirty(true);
                              }}
                              aria-label={`${a.name} — customer review days`}
                            />
                          ),
                        },
                      ]}
                    />
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
                    {/* ONE wrapping `FieldRow`, laid out by WIDTHS — see `GENERAL_W`
                        at the top of this file for the bands, the three fields that
                        sit outside them and the arithmetic.

                        `align="start"`, because GST No renders a `DuplicateError`
                        BELOW its control and the row's default bottom alignment
                        measures from the bottom of that — so the GST box lifted out
                        of its line the moment a duplicate GSTIN was typed. Safe
                        here only because no label wraps at these widths, which is
                        what `commercial_invoice_format_id`'s `term` is buying. */}
                    <FieldRow align="start">
                      {/* The three currencies were interleaved with Ship Mode /
                          Type / Pay Mode — the DOM order that drew the legacy
                          two-column form (currencies left, shipping right). On a
                          12-col track DOM order IS reading order, so they are
                          grouped: three codes and the two shipping fields now sit
                          on one row instead of consuming three half-rows. */}
                      <Field label="Currency 1" w={GENERAL_W.currency_1}>
                        <CurrencyPicker label="Currency 1" currencies={currencies} value={form.currency_1 || null} onChange={(code) => set({ currency_1: code })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Currency 2" w={GENERAL_W.currency_2}>
                        <CurrencyPicker label="Currency 2" currencies={currencies} value={form.currency_2 || null} onChange={(code) => set({ currency_2: code })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Currency 3" w={GENERAL_W.currency_3}>
                        <CurrencyPicker label="Currency 3" currencies={currencies} value={form.currency_3 || null} onChange={(code) => set({ currency_3: code })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Ship Mode" w={GENERAL_W.ship_mode} htmlFor="cu-shipmode">
                        <Select id="cu-shipmode" value={form.ship_mode} onChange={(e) => set({ ship_mode: e.target.value })}>
                          <option value=""></option>
                          {SHIP_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      </Field>
                      {/* Ship Type is stored master data (`config_lookups` kind
                          'ship_type'), so it gets the shared picker — searchable,
                          with Add / Modify / Delete in place — exactly as
                          Applicant and Consignee already render it. As a plain
                          <Select> it could only pick, and it had to compose the
                          "DELIVERED DUTY PAID (DDP)" option text itself; the
                          picker's `lookupLabel` does that now. */}
                      <Field label="Ship Type" w={GENERAL_W.ship_type_id}>
                        <LookupDialogPicker kind="ship_type" label="Ship Type" options={shipTypes} value={form.ship_type_id || null} onChange={(id) => set({ ship_type_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Pay Mode" w={GENERAL_W.pay_mode} htmlFor="cu-paymode">
                        <Select id="cu-paymode" value={form.pay_mode} onChange={(e) => set({ pay_mode: e.target.value })}>
                          <option value=""></option>
                          {PAY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      </Field>
                      <Field label="Receivable Terms" w={GENERAL_W.receivable_term_id}>
                        <RecordPicker label="Receivable Term" items={receivableTerms} value={form.receivable_term_id || null} onChange={(id) => set({ receivable_term_id: id ?? "" })} compact />
                      </Field>
                      <Field label="Pref. Courier" w={GENERAL_W.pref_courier_id}>
                        <RecordPicker label="Courier" items={couriers} value={form.pref_courier_id || null} onChange={(id) => set({ pref_courier_id: id ?? "" })} compact />
                      </Field>
                      <Field label="Port of Loading" w={GENERAL_W.port_of_loading_id}>
                        <RecordPicker label="Port" items={ports} value={form.port_of_loading_id || null} onChange={(id) => set({ port_of_loading_id: id ?? "" })} compact />
                      </Field>
                      <Field label="Port of Discharge" w={GENERAL_W.port_of_discharge_id}>
                        <RecordPicker label="Port" items={ports} value={form.port_of_discharge_id || null} onChange={(id) => set({ port_of_discharge_id: id ?? "" })} compact />
                      </Field>
                      <Field label="Final Destination" w={GENERAL_W.final_destination_id}>
                        <RecordPicker label="Destination" items={destinations} value={form.final_destination_id || null} onChange={(id) => set({ final_destination_id: id ?? "" })} compact />
                      </Field>
                      {/* ONE cell holding two controls: "Columns" edits the very
                          format picked beside it, so splitting them into two
                          spans would put a button under a label of its own.
                          `items-center` now that the picker's label sits above
                          the whole cell — it used to be `items-end` to clear the
                          label the picker drew for itself. */}
                      <Field label="Packing List Format" w={GENERAL_W.packing_list_format_id}>
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <LookupDialogPicker kind="packing_list_format" label="Packing List Format" options={packingFormats} value={form.packing_list_format_id || null} onChange={(id) => set({ packing_list_format_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                          </div>
                          <Button type="button" variant="outline" size="md" disabled={!form.packing_list_format_id} onClick={() => setColsOpen(true)}>Columns</Button>
                        </div>
                      </Field>
                      <Field label="Commercial Invoice Format" w={GENERAL_W.commercial_invoice_format_id}>
                        <LookupDialogPicker kind="commercial_invoice_format" label="Commercial Invoice Format" options={commercialFormats} value={form.commercial_invoice_format_id || null} onChange={(id) => set({ commercial_invoice_format_id: id })} canCreate={perms.canCreate} canEdit={perms.canEdit} compact />
                      </Field>
                      <Field label="Color Spec Applicable" w={GENERAL_W.color_spec_applicable} htmlFor="cu-colorspec">
                        <Select id="cu-colorspec" value={form.color_spec_applicable ? "yes" : "no"} onChange={(e) => set({ color_spec_applicable: e.target.value === "yes" })}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </Select>
                      </Field>
                      <Field label="TCS" w={GENERAL_W.tcs_applicable} htmlFor="cu-tcs">
                        <Select id="cu-tcs" value={form.tcs_applicable ? "yes" : "no"} onChange={(e) => set({ tcs_applicable: e.target.value === "yes" })}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </Select>
                      </Field>
                      <Field label="GST No" w={GENERAL_W.gst_no} htmlFor="cu-gst">
                        <>
                          <ValidatedInput
                            id="cu-gst"
                            // Shape-only on purpose. The check digit is verified
                            // by the strip below as a WARNING, not a block — a
                            // bad GSTIN copied off an invoice still has to be
                            // savable while the customer is chased. Switch this
                            // to "gstin_strict" to make it a hard block instead.
                            format="gstin"
                            value={form.gst_no}
                            onChange={(e) => set({ gst_no: e.target.value })}
                            {...dupFieldProps(gstDupError, "cu-gst")}
                          />
                          <DuplicateError error={gstDupError} id="cu-gst" />
                        </>
                      </Field>
                    </FieldRow>

                    {/* A fact strip, not a field, and now a SIBLING of the row rather
                        than a cell in it. It used to take a `size="full"` cell, which
                        is a `col-span-12` — meaningless in a flex row, where it would
                        have queued up beside GST No at its natural width instead of
                        taking its own line. Outside the row it spans the section, and
                        `mt-2` keeps it tucked under the field it explains. */}
                    {gstin && (
                      <div className="mt-2">
                        <GstinInsight
                          decoded={gstin}
                          // Customers have no PAN column, so the mismatch
                          // line stays dormant; the strip still shows the PAN
                          // the number carries, which is the useful half.
                          panValue=""
                          suggestions={gstinSuggestions}
                        />
                      </div>
                    )}

                    {/* Marking grid, capped — see `MARKING_W` above for why a
                        one-column grid must not be given the whole pane. */}
                    <div className={`mt-6 ${MARKING_W}`}>
                      <ChildGrid<MarkRow>
                        lockExisting
                        /* THE ✕ BESIDE THE FIELD, NOT IN THE CARD'S CORNER
                           (client 2026-09-09: "move the delete X button out of
                           the input box and place it beside the input on the
                           right"). This grid is the shape the corner was never
                           derived for — ONE column, a bare `<Input>` with no
                           label band, inside `MARKING_W` (26rem, below `@lg`'s
                           512px, so it is always cards and never the table) —
                           and there the corner's derived `top` landed the chip
                           across the input's own box. `removeBeside` on
                           `ChildGrid` carries the reasoning. */
                        removeBeside
                        label="Marking"
                        pageSize={10}
                        rows={markings}
                        onAdd={() => { setMarkings((xs) => [...xs, blankMarking(newKey())]); setDirty(true); }}
                        onRemove={(m) => { setMarkings((xs) => xs.filter((r) => r.key !== m.key)); setDirty(true); }}
                        addLabel="+ Add marking"
                        columns={[
                          {
                            header: "Marking",
                            cell: (m) => (
                              <Input uppercase value={m.marking} onChange={(e) => { setMarkings((xs) => xs.map((r) => (r.key === m.key ? { ...r, marking: e.target.value } : r))); setDirty(true); }} className="text-base md:text-sm" />
                            ),
                          },
                        ]}
                      />
                    </div>
                  </SectionBody>
            ),
          },
        ]}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New customer",
          onCancel: () => setOpen(false),
          onSave: () => submit(false),
          saveLabel: "Save customer",
          // A duplicate GSTIN blocks the draft save too — a half-finished row
          // still lands in `customers`, where the collision is just as real.
          canSave: !!form.name.trim() && !gstDupError && !nameDupError,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />
      <PackingFormatColumnsDialog
        formatId={form.packing_list_format_id || null}
        savedColumns={packingColumns}
        open={colsOpen}
        onClose={() => setColsOpen(false)}
        canEdit={perms.canEdit}
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
                viewRow.business_entity,
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
  /**
   * PICK ONCE. Every category this grid already holds — one row asks one
   * question, so the same category twice is duplication, not data, and the
   * second row is a silent contradiction nobody spots by eye.
   *
   * Passed WHOLE, this row's own value included: `DataPicker` exempts its own
   * `value`, so a row never refuses what it is already showing.
   *
   * Per GRID, not per screen. `CategoryGrid` is rendered twice — Sewing and
   * Packaging Accessories — each with its own `rows` and its own `categories`,
   * so a category used in Sewing stays freely pickable in Packaging.
   */
  const usedCategoryIds = useMemo(
    () => rows.map((r) => r.category_id).filter(Boolean),
    [rows],
  );
  return (
    <ChildGrid<CatRowT>
      lockExisting
      label={title}
      pageSize={10}
      forceCards
      flatRows
      rows={rows}
      onAdd={() => { setRows((xs) => [...xs, blankCat(newKey())]); setDirty(true); }}
      onRemove={(r) => { setRows((xs) => xs.filter((x) => x.key !== r.key)); setDirty(true); }}
      addLabel="+ Add category"
      columns={[
        {
          header: "Category",
          // Add/Modify OFF: the options are `categories` rows (0356), but this
          // picker's inline create writes to `config_lookups` — it would file a
          // new category under the wrong table and the FK would reject it. New
          // categories are created in the Category master.
          cell: (r) => (
            <LookupDialogPicker kind="material_category" label="Category" options={categories} value={r.category_id || null} usedIds={usedCategoryIds} onChange={(id) => { setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, category_id: id } : x))); setDirty(true); }} canCreate={false} canEdit={false} compact />
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
  /**
   * PICK ONCE. Nominating the same vendor twice says nothing the single row did
   * not — and it matters downstream: MBA narrows its vendor picker to this list,
   * so a duplicate shows the same vendor twice there too.
   *
   * Per GRID: Nominated and Recommended are separate lists, and a vendor being
   * on both is a legitimate (if redundant) statement, not this rule's business.
   */
  const usedVendorIds = useMemo(
    () => rows.map((r) => r.vendor_id).filter(Boolean),
    [rows],
  );
  return (
    <ChildGrid<VendorRowT>
      lockExisting
      label={title}
      pageSize={10}
      forceCards
      flatRows
      rows={rows}
      onAdd={() => { setRows((xs) => [...xs, blankVendor(newKey())]); setDirty(true); }}
      onRemove={(r) => { setRows((xs) => xs.filter((x) => x.key !== r.key)); setDirty(true); }}
      addLabel="+ Add vendor"
      columns={[
        {
          header: "Vendor",
          cell: (r) => (
            <RecordPicker label="Vendor" items={vendors} value={r.vendor_id || null} usedIds={usedVendorIds} onChange={(id) => { setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, vendor_id: id ?? "" } : x))); setDirty(true); }} compact />
          ),
        },
      ]}
    />
  );
}
