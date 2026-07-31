"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Field, type FieldSize } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { MobileWhatsAppFields } from "@/components/masters/contact-fields";
import { GstinInsight, type GstinSuggestion } from "@/components/masters/gstin-insight";
import { saveCompanyProfile } from "@/lib/admin/company-actions";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { decodeGstin } from "@/lib/validation/gstin";
import type { CompanyProfile, CompanyProfileInput } from "@/lib/admin/company-types";

type Props = {
  profile: CompanyProfile | null;
  canEdit: boolean;
};

function toForm(p: CompanyProfile | null): CompanyProfileInput {
  return {
    company_short_name: p?.company_short_name ?? "",
    company_name: p?.company_name ?? "",
    document_prefix_id: p?.document_prefix_id ?? "",
    street1: p?.street1 ?? "",
    street2: p?.street2 ?? "",
    street3: p?.street3 ?? "",
    city: p?.city ?? "",
    pin_code: p?.pin_code ?? "",
    state: p?.state ?? "",
    country_code: p?.country_code ?? "",
    phone: p?.phone ?? "",
    mobile: p?.mobile ?? "",
    // NOT `?? ""` — a stored NULL is the "same as mobile" state.
    whatsapp: p?.whatsapp ?? null,
    email: p?.email ?? "",
    website: p?.website ?? "",
    reg_street1: p?.reg_street1 ?? "",
    reg_street2: p?.reg_street2 ?? "",
    reg_street3: p?.reg_street3 ?? "",
    reg_city: p?.reg_city ?? "",
    reg_pin_code: p?.reg_pin_code ?? "",
    reg_state: p?.reg_state ?? "",
    pan_no: p?.pan_no ?? "",
    gstin: p?.gstin ?? "",
    cin_no: p?.cin_no ?? "",
    ie_code: p?.ie_code ?? "",
    rbi_code: p?.rbi_code ?? "",
    reg_no: p?.reg_no ?? "",
    cu_licence_no: p?.cu_licence_no ?? "",
    service_tax_no: p?.service_tax_no ?? "",
    employer_code: p?.employer_code ?? "",
    ad_code: p?.ad_code ?? "",
    ediac_no: p?.ediac_no ?? "",
    aepc_no: p?.aepc_no ?? "",
    aepc_date: p?.aepc_date ?? "",
    rex_no: p?.rex_no ?? "",
    lut_no: p?.lut_no ?? "",
    lut_date: p?.lut_date ?? "",
    textile_committee_no: p?.textile_committee_no ?? "",
    textile_committee_date: p?.textile_committee_date ?? "",
    renewed_on: p?.renewed_on ?? "",
    valid_upto: p?.valid_upto ?? "",
    gots_no: p?.gots_no ?? "",
    bci_no: p?.bci_no ?? "",
    oekotex_no: p?.oekotex_no ?? "",
    ce_commissionerate: p?.ce_commissionerate ?? "",
    ce_division: p?.ce_division ?? "",
    ce_range: p?.ce_range ?? "",
    ce_range_address1: p?.ce_range_address1 ?? "",
    ce_range_address2: p?.ce_range_address2 ?? "",
    insurance_company: p?.insurance_company ?? "",
    insurance_policy_no: p?.insurance_policy_no ?? "",
    insurance_policy_date: p?.insurance_policy_date ?? "",
    export_insurance_pct: p?.export_insurance_pct ?? null,
    min_wages: p?.min_wages ?? null,
    bonus_from_date: p?.bonus_from_date ?? "",
    footer_text: p?.footer_text ?? "",
    with_logo: p?.with_logo ?? false,
  };
}

/**
 * How wide each field is, on the 12-column track (`DetailSection cols={12}` +
 * `<Field size>`, LAYOUT.md §3). Spans are of 12: xs=2 · sm=3 · md=4 · lg=6 ·
 * full=12.
 *
 * Sized to the DATA, not to the grid. Every field here used to get half a row —
 * a 6-digit PIN got the same ~440px box as a 60-character company name, and 53
 * fields two-per-row ran to ~27 rows of scrolling. Widths come from evidence:
 * identifier lengths are `FORMATS[kind].maxLength` in lib/validation/formats.ts
 * (PAN 10, IEC 10, GSTIN 15, CIN 21), and the two numerics from their column
 * types in 0318_company_profile.sql — `export_insurance_pct` is numeric(5,2),
 * i.e. at most "100.00", and `min_wages` numeric(12,2).
 *
 * ADJUST HERE, NOT AT THE CALL SITES, AND KEEP EACH ROW SUMMING TO 12. The
 * track auto-flows, so a field that no longer fits the row it was sized for
 * does not shrink — it WRAPS, leaving a hole in the middle of the row above.
 * Row by row, in DOM order (which is also tab order):
 *
 *   Identity          3+6+3                              = 12
 *   Business address  6+6 | 6+4+2 | 4+4+4 | 3+3+6 | 6     = 12 each, last row half
 *   Registered office 6+6 | 6+4+2 | 4                     = 12, 12, then State alone
 *   Statutory         3+3+4 | 3+3+3+3 | 3+3+3+3          = 10, 12, 12  (see below)
 *   Export certs      3+3+3+3 ×3                          = 12 each — 12 fields, 3 flush rows
 *   Central excise    4+4+4 | 6+6                         = 12 each
 *   Insurance         6+3+3 | 2                           = 12, then the % alone
 *   Payroll           3+3                                 = 6, the section only has two
 *
 * The one row that does NOT reach 12 is the first statutory row: PAN(3) +
 * GSTIN(3) + CIN(4) = 10, and IE Code needs 3, so it wraps. Closing that gap
 * would mean widening an identifier past the length it can hold — CIN is 21
 * characters and already the widest of the four — so the 2 columns are left
 * empty on purpose. Don't "fix" it by growing CIN.
 *
 * The GSTIN fact strip is absent from this map for the same reason `mobile` is:
 * it is not a field. It renders `size="full"` at the call site, on its own row
 * after CIN, so the row above stays exactly as documented.
 *
 * `mobile` / `whatsapp` are absent by design: they are rendered by the shared
 * `MobileWhatsAppFields`, which is a FRAGMENT of two grid children, so its span
 * has to travel as a literal class through `cellClassName` (see the call site).
 */
const FIELD_SIZE: Record<Exclude<keyof CompanyProfileInput, "mobile" | "whatsapp">, FieldSize> = {
  // Identity
  company_short_name: "sm", // 3 — an abbreviation, "RAAGAM"
  company_name: "lg", // 6 — the legal name, the longest text on the screen
  document_prefix_id: "sm", // 3 — a document-number prefix, a few characters

  // Business address
  street1: "lg", // 6 — free text, two per row
  street2: "lg",
  street3: "lg",
  city: "md", // 4
  pin_code: "xs", // 2 — 6 digits (PINCODE_IN_RE)
  state: "md", // 4
  country_code: "md", // 4
  phone: "md", // 4 — landline with STD code
  email: "lg", // 6 — free text, routinely long
  website: "lg", // 6

  // Registered office — same names, same widths as above, deliberately
  reg_street1: "lg",
  reg_street2: "lg",
  reg_street3: "lg",
  reg_city: "md",
  reg_pin_code: "xs",
  reg_state: "md",

  // Statutory & registration — the identifiers, at their maxLength
  pan_no: "sm", // 3 — 10 chars
  gstin: "sm", // 3 — 15 chars (the amber check-digit note sits inside this cell)
  cin_no: "md", // 4 — 21 chars, the longest identifier here
  ie_code: "sm", // 3 — 10 chars
  rbi_code: "sm",
  reg_no: "sm",
  cu_licence_no: "sm",
  service_tax_no: "sm",
  employer_code: "sm",
  ad_code: "sm",
  ediac_no: "sm",

  // Export certifications — a certificate number and a date are the same size,
  // and `sm` is the floor for a date input (the browser's picker needs it), so
  // all twelve are `sm` and the section lands as three flush rows of four.
  aepc_no: "sm",
  aepc_date: "sm",
  rex_no: "sm",
  lut_no: "sm",
  lut_date: "sm",
  textile_committee_no: "sm",
  textile_committee_date: "sm",
  renewed_on: "sm",
  valid_upto: "sm",
  gots_no: "sm",
  bci_no: "sm",
  oekotex_no: "sm",

  // Central excise (legacy)
  ce_commissionerate: "md",
  ce_division: "md",
  ce_range: "md",
  ce_range_address1: "lg", // 6 — an address line, same as the streets above
  ce_range_address2: "lg",

  // Insurance
  insurance_company: "lg", // 6 — an insurer's name is the long value here
  insurance_policy_no: "sm", // 3 — closes the row at 12; a policy no is ~20 chars
  insurance_policy_date: "sm",
  export_insurance_pct: "xs", // 2 — numeric(5,2), so at most "100.00"

  // Payroll
  min_wages: "sm", // 3 — numeric(12,2)
  bonus_from_date: "sm",

  // Footer — each stands alone on its row
  footer_text: "full",
  with_logo: "full",
};

export function CompanyProfileScreen({ profile, canEdit }: Props) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<CompanyProfileInput>(() => toForm(profile));

  const set = (key: keyof CompanyProfileInput, val: string | number | boolean | null) =>
    setForm((f) => ({ ...f, [key]: val }));

  // The record as loaded, in the shape the form holds it — the baseline the
  // dirty check compares against, exactly as the bulk-assign grids compare
  // their edits against the rows they were given. A whole-object compare is
  // right here: 53 flat primitives, and `set` spreads (which keeps each key in
  // its original position), so the two strings differ only when a value does.
  // It re-derives when the server sends a new profile, which `router.refresh()`
  // does right after a save — that is what clears the guard once the save has
  // round-tripped.
  const pristine = useMemo(() => JSON.stringify(toForm(profile)), [profile]);
  const dirty = JSON.stringify(form) !== pristine;

  // Hold off the silent PWA auto-reload while the form is edited or a save is
  // in flight — this is a plain page with no overlay, so the declaration is the
  // only signal the updater gets, and a background deploy landing on a
  // half-filled 53-field profile is precisely what the guard exists to stop.
  // `isPending` too: a reload landing mid-server-action loses the success toast
  // and leaves the user unsure whether the save committed.
  useUnsavedGuard(dirty || isPending);

  function submit() {
    startTransition(async () => {
      // Collapse an empty WhatsApp box back to NULL — that IS the "same as
      // mobile" state, and this screen submits `form` wholesale.
      const res = await saveCompanyProfile({
        ...form,
        whatsapp: (form.whatsapp as string | null)?.trim() || null,
      });
      if (res.ok) {
        success("Company profile saved.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const dis = !canEdit;

  // ---------------------------------------------------------------- GSTIN ----
  // Decoded from the 15 characters, no lookup and no network. This is the ONE
  // GSTIN in the system that is not just a record's own data: vendor, customer
  // and consignee all classify their GSTIN as within-state or other-state
  // against THIS number, so a wrong state code here silently mis-reads IGST vs
  // CGST+SGST on every one of them. Worth showing what it actually says.
  //
  // No `companyGstin` is passed: comparing our own number with itself would
  // always print "Within State", which is noise.
  const gstin = useMemo(() => decodeGstin((form.gstin as string) ?? ""), [form.gstin]);

  // The PAN box sits immediately to the left, and characters 3-12 of the GSTIN
  // ARE the PAN — so the two disagreeing means one of them is a typo. Offered,
  // never written: the profile is a wide form and silently rewriting a field the
  // user is not looking at is how the vendor screen's rule was set.
  const gstinSuggestions = useMemo<GstinSuggestion[]>(() => {
    if (!gstin?.checksumValid) return [];
    const typedPan = ((form.pan_no as string) ?? "").trim().toUpperCase();
    if (typedPan === gstin.pan) return [];
    return [
      {
        key: "pan",
        label: typedPan ? `Use ${gstin.pan}` : `Set PAN = ${gstin.pan}`,
        onApply: () => set("pan_no", gstin.pan),
      },
    ];
  }, [gstin, form.pan_no]);

  return (
    <div className="max-w-4xl space-y-6">
      {/* Identity */}
      <DetailSection label="Company Identity" cols={12}>
        <Field label="Short Name" size={FIELD_SIZE.company_short_name} htmlFor="cp-short">
          <Input
            id="cp-short"
            value={(form.company_short_name as string) ?? ""}
            onChange={(e) => set("company_short_name", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Company Name" required size={FIELD_SIZE.company_name} htmlFor="cp-name">
          <Input
            id="cp-name"
            value={(form.company_name as string) ?? ""}
            onChange={(e) => set("company_name", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Document Prefix" size={FIELD_SIZE.document_prefix_id} htmlFor="cp-prefix">
          <Input
            id="cp-prefix"
            value={(form.document_prefix_id as string) ?? ""}
            onChange={(e) => set("document_prefix_id", e.target.value)}
            disabled={dis}
          />
        </Field>
      </DetailSection>

      {/* Address */}
      <DetailSection label="Business Address" cols={12}>
        <Field label="Street 1" size={FIELD_SIZE.street1} htmlFor="cp-street1">
          <Input
            id="cp-street1"
            value={(form.street1 as string) ?? ""}
            onChange={(e) => set("street1", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Street 2" size={FIELD_SIZE.street2} htmlFor="cp-street2">
          <Input
            id="cp-street2"
            value={(form.street2 as string) ?? ""}
            onChange={(e) => set("street2", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Street 3" size={FIELD_SIZE.street3} htmlFor="cp-street3">
          <Input
            id="cp-street3"
            value={(form.street3 as string) ?? ""}
            onChange={(e) => set("street3", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="City" size={FIELD_SIZE.city} htmlFor="cp-city">
          <Input
            id="cp-city"
            value={(form.city as string) ?? ""}
            onChange={(e) => set("city", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="PIN Code" size={FIELD_SIZE.pin_code} htmlFor="cp-pin">
          <Input
            id="cp-pin"
            value={(form.pin_code as string) ?? ""}
            onChange={(e) => set("pin_code", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="State" size={FIELD_SIZE.state} htmlFor="cp-state">
          <Input
            id="cp-state"
            value={(form.state as string) ?? ""}
            onChange={(e) => set("state", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Country" size={FIELD_SIZE.country_code} htmlFor="cp-country">
          <Input
            id="cp-country"
            value={(form.country_code as string) ?? ""}
            onChange={(e) => set("country_code", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Phone" size={FIELD_SIZE.phone} htmlFor="cp-phone">
          <Input
            id="cp-phone"
            value={(form.phone as string) ?? ""}
            onChange={(e) => set("phone", e.target.value)}
            disabled={dis}
          />
        </Field>
        {/* Own company, so the strict India-only rule applies (format="mobile"),
            unlike the buyer-facing masters which are international-tolerant.
            `cellClassName` is a LITERAL `sm` span (3 of 12) applied to each of
            the two cells — this component returns a fragment, not a wrapper, so
            without it both halves would take 1 of 12 (~73px) on this track.
            Literal, because Tailwind v4 scans source text. */}
        <MobileWhatsAppFields
          idPrefix="cp"
          format="mobile"
          cellClassName="@lg/section:col-span-3"
          mobile={(form.mobile as string) ?? ""}
          whatsapp={(form.whatsapp as string | null) ?? null}
          onMobileChange={(v) => set("mobile", v)}
          onWhatsAppChange={(v) => set("whatsapp", v)}
          disabled={dis}
        />
        <Field label="Email" size={FIELD_SIZE.email} htmlFor="cp-email">
          <Input
            id="cp-email"
            value={(form.email as string) ?? ""}
            onChange={(e) => set("email", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Website" size={FIELD_SIZE.website} htmlFor="cp-website">
          <Input
            id="cp-website"
            value={(form.website as string) ?? ""}
            onChange={(e) => set("website", e.target.value)}
            disabled={dis}
          />
        </Field>
      </DetailSection>

      {/* Registered Office */}
      <DetailSection label="Registered Office (if different)" cols={12}>
        <Field label="Street 1" size={FIELD_SIZE.reg_street1} htmlFor="cp-reg-street1">
          <Input
            id="cp-reg-street1"
            value={(form.reg_street1 as string) ?? ""}
            onChange={(e) => set("reg_street1", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Street 2" size={FIELD_SIZE.reg_street2} htmlFor="cp-reg-street2">
          <Input
            id="cp-reg-street2"
            value={(form.reg_street2 as string) ?? ""}
            onChange={(e) => set("reg_street2", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Street 3" size={FIELD_SIZE.reg_street3} htmlFor="cp-reg-street3">
          <Input
            id="cp-reg-street3"
            value={(form.reg_street3 as string) ?? ""}
            onChange={(e) => set("reg_street3", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="City" size={FIELD_SIZE.reg_city} htmlFor="cp-reg-city">
          <Input
            id="cp-reg-city"
            value={(form.reg_city as string) ?? ""}
            onChange={(e) => set("reg_city", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="PIN Code" size={FIELD_SIZE.reg_pin_code} htmlFor="cp-reg-pin">
          <Input
            id="cp-reg-pin"
            value={(form.reg_pin_code as string) ?? ""}
            onChange={(e) => set("reg_pin_code", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="State" size={FIELD_SIZE.reg_state} htmlFor="cp-reg-state">
          <Input
            id="cp-reg-state"
            value={(form.reg_state as string) ?? ""}
            onChange={(e) => set("reg_state", e.target.value)}
            disabled={dis}
          />
        </Field>
      </DetailSection>

      {/* Statutory */}
      <DetailSection label="Statutory & Registration" cols={12}>
        <Field label="PAN No" size={FIELD_SIZE.pan_no} htmlFor="cp-pan">
          <ValidatedInput
            id="cp-pan"
            format="pan"
            value={(form.pan_no as string) ?? ""}
            onChange={(e) => set("pan_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        {/* Shape-only, like every other GSTIN box in the app: the check digit is
            a warning on the strip below, not a block — this is one wide form and
            a bad GSTIN must not freeze every other field on it (client
            2026-07-28). */}
        <Field label="GSTIN" size={FIELD_SIZE.gstin} htmlFor="cp-gstin">
          <ValidatedInput
            id="cp-gstin"
            format="gstin"
            value={(form.gstin as string) ?? ""}
            onChange={(e) => set("gstin", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="CIN No" size={FIELD_SIZE.cin_no} htmlFor="cp-cin">
          <ValidatedInput
            id="cp-cin"
            format="cin"
            value={(form.cin_no as string) ?? ""}
            onChange={(e) => set("cin_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        {/* The decoded facts, on their own 12-col row — a fact strip is not a
            field (LAYOUT.md §3), which is also why it has no FIELD_SIZE entry:
            that map is typed over the INPUT's keys. It sits after CIN so the
            documented PAN(3)+GSTIN(3)+CIN(4) row is untouched, and its chips are
            tabIndex={-1}, so tab order still runs PAN -> GSTIN -> CIN -> IE. */}
        {gstin && (
          <Field size="full">
            <GstinInsight
              decoded={gstin}
              panValue={(form.pan_no as string) ?? ""}
              suggestions={gstinSuggestions}
            />
          </Field>
        )}
        <Field label="IE Code" size={FIELD_SIZE.ie_code} htmlFor="cp-ie">
          <ValidatedInput
            id="cp-ie"
            format="iec"
            value={(form.ie_code as string) ?? ""}
            onChange={(e) => set("ie_code", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="RBI Code" size={FIELD_SIZE.rbi_code} htmlFor="cp-rbi">
          <Input
            id="cp-rbi"
            value={(form.rbi_code as string) ?? ""}
            onChange={(e) => set("rbi_code", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Reg No" size={FIELD_SIZE.reg_no} htmlFor="cp-reg">
          <Input
            id="cp-reg"
            value={(form.reg_no as string) ?? ""}
            onChange={(e) => set("reg_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="CU Licence No" size={FIELD_SIZE.cu_licence_no} htmlFor="cp-cu">
          <Input
            id="cp-cu"
            value={(form.cu_licence_no as string) ?? ""}
            onChange={(e) => set("cu_licence_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Service Tax No" size={FIELD_SIZE.service_tax_no} htmlFor="cp-svc">
          <Input
            id="cp-svc"
            value={(form.service_tax_no as string) ?? ""}
            onChange={(e) => set("service_tax_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Employer Code" size={FIELD_SIZE.employer_code} htmlFor="cp-employer">
          <Input
            id="cp-employer"
            value={(form.employer_code as string) ?? ""}
            onChange={(e) => set("employer_code", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="AD Code" size={FIELD_SIZE.ad_code} htmlFor="cp-ad">
          <Input
            id="cp-ad"
            value={(form.ad_code as string) ?? ""}
            onChange={(e) => set("ad_code", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="EDIAC No" size={FIELD_SIZE.ediac_no} htmlFor="cp-ediac">
          <Input
            id="cp-ediac"
            value={(form.ediac_no as string) ?? ""}
            onChange={(e) => set("ediac_no", e.target.value)}
            disabled={dis}
          />
        </Field>
      </DetailSection>

      {/* Export Certifications */}
      <DetailSection label="Export Certifications" cols={12}>
        <Field label="AEPC No" size={FIELD_SIZE.aepc_no} htmlFor="cp-aepc">
          <Input
            id="cp-aepc"
            value={(form.aepc_no as string) ?? ""}
            onChange={(e) => set("aepc_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="AEPC Date" size={FIELD_SIZE.aepc_date} htmlFor="cp-aepc-dt">
          <Input
            id="cp-aepc-dt"
            type="date"
            value={(form.aepc_date as string) ?? ""}
            onChange={(e) => set("aepc_date", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="REX No" size={FIELD_SIZE.rex_no} htmlFor="cp-rex">
          <Input
            id="cp-rex"
            value={(form.rex_no as string) ?? ""}
            onChange={(e) => set("rex_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="LUT No" size={FIELD_SIZE.lut_no} htmlFor="cp-lut">
          <Input
            id="cp-lut"
            value={(form.lut_no as string) ?? ""}
            onChange={(e) => set("lut_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="LUT Date" size={FIELD_SIZE.lut_date} htmlFor="cp-lut-dt">
          <Input
            id="cp-lut-dt"
            type="date"
            value={(form.lut_date as string) ?? ""}
            onChange={(e) => set("lut_date", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field
          label="Textile Committee No"
          size={FIELD_SIZE.textile_committee_no}
          htmlFor="cp-tc"
        >
          <Input
            id="cp-tc"
            value={(form.textile_committee_no as string) ?? ""}
            onChange={(e) => set("textile_committee_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field
          label="Textile Committee Date"
          size={FIELD_SIZE.textile_committee_date}
          htmlFor="cp-tc-dt"
        >
          <Input
            id="cp-tc-dt"
            type="date"
            value={(form.textile_committee_date as string) ?? ""}
            onChange={(e) => set("textile_committee_date", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Renewed On" size={FIELD_SIZE.renewed_on} htmlFor="cp-renewed">
          <Input
            id="cp-renewed"
            type="date"
            value={(form.renewed_on as string) ?? ""}
            onChange={(e) => set("renewed_on", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Valid Upto" size={FIELD_SIZE.valid_upto} htmlFor="cp-valid">
          <Input
            id="cp-valid"
            type="date"
            value={(form.valid_upto as string) ?? ""}
            onChange={(e) => set("valid_upto", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="GOTS No" size={FIELD_SIZE.gots_no} htmlFor="cp-gots">
          <Input
            id="cp-gots"
            value={(form.gots_no as string) ?? ""}
            onChange={(e) => set("gots_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="BCI No" size={FIELD_SIZE.bci_no} htmlFor="cp-bci">
          <Input
            id="cp-bci"
            value={(form.bci_no as string) ?? ""}
            onChange={(e) => set("bci_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="OEKO-TEX No" size={FIELD_SIZE.oekotex_no} htmlFor="cp-oekotex">
          <Input
            id="cp-oekotex"
            value={(form.oekotex_no as string) ?? ""}
            onChange={(e) => set("oekotex_no", e.target.value)}
            disabled={dis}
          />
        </Field>
      </DetailSection>

      {/* Central Excise */}
      <DetailSection label="Central Excise (Legacy)" cols={12}>
        <Field label="Commissionerate" size={FIELD_SIZE.ce_commissionerate} htmlFor="cp-ce-comm">
          <Input
            id="cp-ce-comm"
            value={(form.ce_commissionerate as string) ?? ""}
            onChange={(e) => set("ce_commissionerate", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Division" size={FIELD_SIZE.ce_division} htmlFor="cp-ce-div">
          <Input
            id="cp-ce-div"
            value={(form.ce_division as string) ?? ""}
            onChange={(e) => set("ce_division", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Range" size={FIELD_SIZE.ce_range} htmlFor="cp-ce-range">
          <Input
            id="cp-ce-range"
            value={(form.ce_range as string) ?? ""}
            onChange={(e) => set("ce_range", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Range Address 1" size={FIELD_SIZE.ce_range_address1} htmlFor="cp-ce-addr1">
          <Input
            id="cp-ce-addr1"
            value={(form.ce_range_address1 as string) ?? ""}
            onChange={(e) => set("ce_range_address1", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Range Address 2" size={FIELD_SIZE.ce_range_address2} htmlFor="cp-ce-addr2">
          <Input
            id="cp-ce-addr2"
            value={(form.ce_range_address2 as string) ?? ""}
            onChange={(e) => set("ce_range_address2", e.target.value)}
            disabled={dis}
          />
        </Field>
      </DetailSection>

      {/* Insurance */}
      <DetailSection label="Insurance" cols={12}>
        <Field label="Insurance Company" size={FIELD_SIZE.insurance_company} htmlFor="cp-ins-co">
          <Input
            id="cp-ins-co"
            value={(form.insurance_company as string) ?? ""}
            onChange={(e) => set("insurance_company", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Policy No" size={FIELD_SIZE.insurance_policy_no} htmlFor="cp-ins-pol">
          <Input
            id="cp-ins-pol"
            value={(form.insurance_policy_no as string) ?? ""}
            onChange={(e) => set("insurance_policy_no", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Policy Date" size={FIELD_SIZE.insurance_policy_date} htmlFor="cp-ins-dt">
          <Input
            id="cp-ins-dt"
            type="date"
            value={(form.insurance_policy_date as string) ?? ""}
            onChange={(e) => set("insurance_policy_date", e.target.value)}
            disabled={dis}
          />
        </Field>
        <Field label="Export Insurance %" size={FIELD_SIZE.export_insurance_pct} htmlFor="cp-ins-pct">
          <Input
            id="cp-ins-pct"
            value={String(form.export_insurance_pct ?? "")}
            onChange={(e) => set("export_insurance_pct", e.target.value ? Number(e.target.value) : null)}
            disabled={dis}
          />
        </Field>
      </DetailSection>

      {/* Payroll */}
      <DetailSection label="Payroll" cols={12}>
        <Field label="Minimum Wages" size={FIELD_SIZE.min_wages} htmlFor="cp-minwage">
          <Input
            id="cp-minwage"
            value={String(form.min_wages ?? "")}
            onChange={(e) => set("min_wages", e.target.value ? Number(e.target.value) : null)}
            disabled={dis}
          />
        </Field>
        <Field label="Bonus From Date" size={FIELD_SIZE.bonus_from_date} htmlFor="cp-bonus-dt">
          <Input
            id="cp-bonus-dt"
            type="date"
            value={(form.bonus_from_date as string) ?? ""}
            onChange={(e) => set("bonus_from_date", e.target.value)}
            disabled={dis}
          />
        </Field>
      </DetailSection>

      {/* Footer */}
      <DetailSection label="Document Footer" cols={12}>
        <Field label="Footer Text" size={FIELD_SIZE.footer_text} htmlFor="cp-footer">
          <Textarea
            id="cp-footer"
            value={(form.footer_text as string) ?? ""}
            onChange={(e) => set("footer_text", e.target.value)}
            disabled={dis}
            rows={3}
          />
        </Field>
        {/* No `label` prop — the <label> below carries its own text. `min-h-9
            items-center` puts the tick on the same 36px control baseline as an
            input beside it; the track's gap-y already spaces it from the row
            above, so the old `mt-2` would double that. */}
        <Field size={FIELD_SIZE.with_logo} className="flex min-h-9 items-center">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.with_logo ?? false}
              onChange={(e) => set("with_logo", e.target.checked)}
              disabled={dis}
            />
            <span className="text-sm text-foreground">Show logo on documents</span>
          </label>
        </Field>
      </DetailSection>

      {/* Save */}
      {canEdit && (
        <div className="flex justify-end pt-2">
          <Button size="md" disabled={isPending || !(form.company_name ?? "").trim()} onClick={submit}>
            {isPending ? "Saving..." : "Save Company Profile"}
          </Button>
        </div>
      )}
    </div>
  );
}
