"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { saveCompanyProfile } from "@/lib/admin/company-actions";
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
    fax: p?.fax ?? "",
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

function Field({ id, label, value, onChange, disabled, type = "text" }: {
  id: string; label: string; value: string; onChange: (v: string) => void; disabled?: boolean; type?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="text-base md:text-sm" />
    </div>
  );
}

export function CompanyProfileScreen({ profile, canEdit }: Props) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<CompanyProfileInput>(() => toForm(profile));

  const set = (key: keyof CompanyProfileInput, val: string | number | boolean | null) =>
    setForm((f) => ({ ...f, [key]: val }));

  function submit() {
    startTransition(async () => {
      const res = await saveCompanyProfile(form);
      if (res.ok) {
        success("Company profile saved.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const dis = !canEdit;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Identity */}
      <DetailSection label="Company Identity">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cp-short" label="Short Name" value={(form.company_short_name as string) ?? ""} onChange={(v) => set("company_short_name", v)} disabled={dis} />
          <Field id="cp-name" label="Company Name *" value={(form.company_name as string) ?? ""} onChange={(v) => set("company_name", v)} disabled={dis} />
          <Field id="cp-prefix" label="Document Prefix" value={(form.document_prefix_id as string) ?? ""} onChange={(v) => set("document_prefix_id", v)} disabled={dis} />
        </div>
      </DetailSection>

      {/* Address */}
      <DetailSection label="Business Address">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cp-street1" label="Street 1" value={(form.street1 as string) ?? ""} onChange={(v) => set("street1", v)} disabled={dis} />
          <Field id="cp-street2" label="Street 2" value={(form.street2 as string) ?? ""} onChange={(v) => set("street2", v)} disabled={dis} />
          <Field id="cp-street3" label="Street 3" value={(form.street3 as string) ?? ""} onChange={(v) => set("street3", v)} disabled={dis} />
          <Field id="cp-city" label="City" value={(form.city as string) ?? ""} onChange={(v) => set("city", v)} disabled={dis} />
          <Field id="cp-pin" label="PIN Code" value={(form.pin_code as string) ?? ""} onChange={(v) => set("pin_code", v)} disabled={dis} />
          <Field id="cp-state" label="State" value={(form.state as string) ?? ""} onChange={(v) => set("state", v)} disabled={dis} />
          <Field id="cp-country" label="Country" value={(form.country_code as string) ?? ""} onChange={(v) => set("country_code", v)} disabled={dis} />
          <Field id="cp-phone" label="Phone" value={(form.phone as string) ?? ""} onChange={(v) => set("phone", v)} disabled={dis} />
          <Field id="cp-fax" label="Fax" value={(form.fax as string) ?? ""} onChange={(v) => set("fax", v)} disabled={dis} />
          <Field id="cp-email" label="Email" value={(form.email as string) ?? ""} onChange={(v) => set("email", v)} disabled={dis} />
          <Field id="cp-website" label="Website" value={(form.website as string) ?? ""} onChange={(v) => set("website", v)} disabled={dis} />
        </div>
      </DetailSection>

      {/* Registered Office */}
      <DetailSection label="Registered Office (if different)">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cp-reg-street1" label="Street 1" value={(form.reg_street1 as string) ?? ""} onChange={(v) => set("reg_street1", v)} disabled={dis} />
          <Field id="cp-reg-street2" label="Street 2" value={(form.reg_street2 as string) ?? ""} onChange={(v) => set("reg_street2", v)} disabled={dis} />
          <Field id="cp-reg-street3" label="Street 3" value={(form.reg_street3 as string) ?? ""} onChange={(v) => set("reg_street3", v)} disabled={dis} />
          <Field id="cp-reg-city" label="City" value={(form.reg_city as string) ?? ""} onChange={(v) => set("reg_city", v)} disabled={dis} />
          <Field id="cp-reg-pin" label="PIN Code" value={(form.reg_pin_code as string) ?? ""} onChange={(v) => set("reg_pin_code", v)} disabled={dis} />
          <Field id="cp-reg-state" label="State" value={(form.reg_state as string) ?? ""} onChange={(v) => set("reg_state", v)} disabled={dis} />
        </div>
      </DetailSection>

      {/* Statutory */}
      <DetailSection label="Statutory & Registration">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="cp-pan" label="PAN No" value={(form.pan_no as string) ?? ""} onChange={(v) => set("pan_no", v)} disabled={dis} />
          <Field id="cp-gstin" label="GSTIN" value={(form.gstin as string) ?? ""} onChange={(v) => set("gstin", v)} disabled={dis} />
          <Field id="cp-cin" label="CIN No" value={(form.cin_no as string) ?? ""} onChange={(v) => set("cin_no", v)} disabled={dis} />
          <Field id="cp-ie" label="IE Code" value={(form.ie_code as string) ?? ""} onChange={(v) => set("ie_code", v)} disabled={dis} />
          <Field id="cp-rbi" label="RBI Code" value={(form.rbi_code as string) ?? ""} onChange={(v) => set("rbi_code", v)} disabled={dis} />
          <Field id="cp-reg" label="Reg No" value={(form.reg_no as string) ?? ""} onChange={(v) => set("reg_no", v)} disabled={dis} />
          <Field id="cp-cu" label="CU Licence No" value={(form.cu_licence_no as string) ?? ""} onChange={(v) => set("cu_licence_no", v)} disabled={dis} />
          <Field id="cp-svc" label="Service Tax No" value={(form.service_tax_no as string) ?? ""} onChange={(v) => set("service_tax_no", v)} disabled={dis} />
          <Field id="cp-employer" label="Employer Code" value={(form.employer_code as string) ?? ""} onChange={(v) => set("employer_code", v)} disabled={dis} />
          <Field id="cp-ad" label="AD Code" value={(form.ad_code as string) ?? ""} onChange={(v) => set("ad_code", v)} disabled={dis} />
          <Field id="cp-ediac" label="EDIAC No" value={(form.ediac_no as string) ?? ""} onChange={(v) => set("ediac_no", v)} disabled={dis} />
        </div>
      </DetailSection>

      {/* Export Certifications */}
      <DetailSection label="Export Certifications">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="cp-aepc" label="AEPC No" value={(form.aepc_no as string) ?? ""} onChange={(v) => set("aepc_no", v)} disabled={dis} />
          <Field id="cp-aepc-dt" label="AEPC Date" value={(form.aepc_date as string) ?? ""} onChange={(v) => set("aepc_date", v)} disabled={dis} type="date" />
          <Field id="cp-rex" label="REX No" value={(form.rex_no as string) ?? ""} onChange={(v) => set("rex_no", v)} disabled={dis} />
          <Field id="cp-lut" label="LUT No" value={(form.lut_no as string) ?? ""} onChange={(v) => set("lut_no", v)} disabled={dis} />
          <Field id="cp-lut-dt" label="LUT Date" value={(form.lut_date as string) ?? ""} onChange={(v) => set("lut_date", v)} disabled={dis} type="date" />
          <Field id="cp-tc" label="Textile Committee No" value={(form.textile_committee_no as string) ?? ""} onChange={(v) => set("textile_committee_no", v)} disabled={dis} />
          <Field id="cp-tc-dt" label="Textile Committee Date" value={(form.textile_committee_date as string) ?? ""} onChange={(v) => set("textile_committee_date", v)} disabled={dis} type="date" />
          <Field id="cp-renewed" label="Renewed On" value={(form.renewed_on as string) ?? ""} onChange={(v) => set("renewed_on", v)} disabled={dis} type="date" />
          <Field id="cp-valid" label="Valid Upto" value={(form.valid_upto as string) ?? ""} onChange={(v) => set("valid_upto", v)} disabled={dis} type="date" />
          <Field id="cp-gots" label="GOTS No" value={(form.gots_no as string) ?? ""} onChange={(v) => set("gots_no", v)} disabled={dis} />
          <Field id="cp-bci" label="BCI No" value={(form.bci_no as string) ?? ""} onChange={(v) => set("bci_no", v)} disabled={dis} />
          <Field id="cp-oekotex" label="OEKO-TEX No" value={(form.oekotex_no as string) ?? ""} onChange={(v) => set("oekotex_no", v)} disabled={dis} />
        </div>
      </DetailSection>

      {/* Central Excise */}
      <DetailSection label="Central Excise (Legacy)">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cp-ce-comm" label="Commissionerate" value={(form.ce_commissionerate as string) ?? ""} onChange={(v) => set("ce_commissionerate", v)} disabled={dis} />
          <Field id="cp-ce-div" label="Division" value={(form.ce_division as string) ?? ""} onChange={(v) => set("ce_division", v)} disabled={dis} />
          <Field id="cp-ce-range" label="Range" value={(form.ce_range as string) ?? ""} onChange={(v) => set("ce_range", v)} disabled={dis} />
          <Field id="cp-ce-addr1" label="Range Address 1" value={(form.ce_range_address1 as string) ?? ""} onChange={(v) => set("ce_range_address1", v)} disabled={dis} />
          <Field id="cp-ce-addr2" label="Range Address 2" value={(form.ce_range_address2 as string) ?? ""} onChange={(v) => set("ce_range_address2", v)} disabled={dis} />
        </div>
      </DetailSection>

      {/* Insurance */}
      <DetailSection label="Insurance">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cp-ins-co" label="Insurance Company" value={(form.insurance_company as string) ?? ""} onChange={(v) => set("insurance_company", v)} disabled={dis} />
          <Field id="cp-ins-pol" label="Policy No" value={(form.insurance_policy_no as string) ?? ""} onChange={(v) => set("insurance_policy_no", v)} disabled={dis} />
          <Field id="cp-ins-dt" label="Policy Date" value={(form.insurance_policy_date as string) ?? ""} onChange={(v) => set("insurance_policy_date", v)} disabled={dis} type="date" />
          <Field id="cp-ins-pct" label="Export Insurance %" value={String(form.export_insurance_pct ?? "")} onChange={(v) => set("export_insurance_pct", v ? Number(v) : null)} disabled={dis} />
        </div>
      </DetailSection>

      {/* Payroll */}
      <DetailSection label="Payroll">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cp-minwage" label="Minimum Wages" value={String(form.min_wages ?? "")} onChange={(v) => set("min_wages", v ? Number(v) : null)} disabled={dis} />
          <Field id="cp-bonus-dt" label="Bonus From Date" value={(form.bonus_from_date as string) ?? ""} onChange={(v) => set("bonus_from_date", v)} disabled={dis} type="date" />
        </div>
      </DetailSection>

      {/* Footer */}
      <DetailSection label="Document Footer">
        <div>
          <Label htmlFor="cp-footer">Footer Text</Label>
          <Textarea
            id="cp-footer"
            value={(form.footer_text as string) ?? ""}
            onChange={(e) => set("footer_text", e.target.value)}
            disabled={dis}
            rows={3}
            className="text-base md:text-sm"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 mt-2">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-primary"
            checked={form.with_logo ?? false}
            onChange={(e) => set("with_logo", e.target.checked)}
            disabled={dis}
          />
          <span className="text-sm text-foreground">Show logo on documents</span>
        </label>
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
