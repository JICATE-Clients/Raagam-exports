"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { useToast } from "@/components/ui/toast";
import {
  saveBankDetails,
  saveSalaryRegistry,
} from "@/lib/hr/completeness-actions";
import {
  PAY_MODES,
  STATUTORY_STATUSES,
  type StatutoryStatus,
} from "@/lib/hr/types";
import type {
  AccountValues,
  PersonCompleteness,
  SalaryValues,
} from "@/lib/hr/completeness-types";
import type { CompletenessKind } from "./completeness-client";

/**
 * FILLING IN A SALARY REGISTRY / BANK ACCOUNT WITHOUT LEAVING THE LIST
 * (client 2026-09-12: "from here itself i wanna fill up the details").
 *
 * A `Sheet` rather than a route: the operator is working THROUGH a list, and a
 * sheet returns them to their place in it. `MasterFullScreen` is the shape for a
 * record with sections; this is one pane of one, opened per row.
 *
 * ## IT WRITES THE SAME COLUMNS THE RECORD DOES
 *
 * Not a copy of the record's fields — the same ones, through server actions
 * whose schemas are `pick`ed from `personInput` and `staffBankAccountInput`. So
 * the money coercion, the IFSC regex and the Yes/No/Exempted vocabulary are one
 * definition with one place to change them.
 */
export default function CompletenessSheet({
  kind,
  row,
  banks,
  onClose,
}: {
  kind: CompletenessKind;
  row: PersonCompleteness;
  banks: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [salary, setSalary] = useState<SalaryValues>(row.salary);
  const [account, setAccount] = useState<AccountValues>(row.account);
  const [payMode, setPayMode] = useState<string>(row.payMode ?? "Cash");

  const isSalary = kind === "salary";
  const setS = (patch: Partial<SalaryValues>) =>
    setSalary((v) => ({ ...v, ...patch }));
  const setA = (patch: Partial<AccountValues>) =>
    setAccount((v) => ({ ...v, ...patch }));

  function save() {
    startTransition(async () => {
      const r = isSalary
        ? await saveSalaryRegistry(row.kind, row.id, salary)
        : await saveBankDetails(
            row.kind,
            row.id,
            { pay_mode: payMode as (typeof PAY_MODES)[number] },
            account,
          );
      if (r.ok) {
        success(isSalary ? "Salary registry saved." : "Bank details saved.");
        onClose();
        // The list is server-rendered, so the new value and the recomputed
        // pending count come from the same query that drew the row.
        router.refresh();
      } else {
        toastError(r.error);
      }
    });
  }

  /**
   * A money box shows BLANK at zero, not "0".
   *
   * The same call the record editor's `MoneyField` makes, and for the reason
   * recorded there: a column default rendered as a figure reads as one somebody
   * entered (client 2026-09-09, "why evrwhere this 0 is showing").
   */
  const money = (label: string, key: keyof SalaryValues, id: string) => (
    <Field label={label} size="sm" htmlFor={id}>
      <Input
        id={id}
        type="number"
        min={0}
        step="0.01"
        value={(salary[key] as number) === 0 ? "" : String(salary[key])}
        onChange={(e) =>
          setS({ [key]: Number(e.target.value || 0) } as Partial<SalaryValues>)
        }
      />
    </Field>
  );

  const text = (
    label: string,
    key: keyof SalaryValues,
    id: string,
    size: "sm" | "md" = "sm",
  ) => (
    <Field label={label} size={size} htmlFor={id}>
      <Input
        id={id}
        value={(salary[key] as string | null) ?? ""}
        onChange={(e) =>
          setS({ [key]: e.target.value } as Partial<SalaryValues>)
        }
      />
    </Field>
  );

  const date = (label: string, key: keyof SalaryValues, id: string) => (
    <Field label={label} size="sm" htmlFor={id}>
      <Input
        id={id}
        type="date"
        value={(salary[key] as string | null) ?? ""}
        onChange={(e) =>
          setS({ [key]: e.target.value || null } as Partial<SalaryValues>)
        }
      />
    </Field>
  );

  const status = (
    label: string,
    key: "esi_status" | "pf_status",
    id: string,
  ) => (
    <Field label={label} size="sm" htmlFor={id}>
      <Select
        id={id}
        value={salary[key]}
        onChange={(e) => setS({ [key]: e.target.value as StatutoryStatus })}
      >
        {STATUTORY_STATUSES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${isSalary ? "Salary Registry" : "Bank Details"} — ${row.name}`}
      // `Sheet`'s own default (`lg`). AGENTS.md's `size="sm"` rule is for a
      // `[Click]`-opened SUB-detail inside an already-open editor; this is a
      // record editor opened from a list row, which is the shape `lg` is the
      // default for. At `sm` (448px) the 12-column field track renders ~112px
      // boxes — the "starved field" bug LAYOUT.md §3 records.
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {isSalary ? (
        <div className="space-y-4">
          {/* Both panels hold the same four names, so the section labels are
              the only thing saying which set a figure belongs to — the reason
              the record editor keeps them too. */}
          <DetailSection label="Pay — Statutory" cols={12}>
            {money("Gross Salary", "stat_gross", "sr-stat-gross")}
            {money("Basic", "stat_basic", "sr-stat-basic")}
            {money("DA", "stat_da", "sr-stat-da")}
            {money("HRA", "stat_hra", "sr-stat-hra")}
          </DetailSection>
          <DetailSection label="Pay — Actual" cols={12}>
            {money("Gross Salary", "act_gross", "sr-act-gross")}
            {money("Basic", "act_basic", "sr-act-basic")}
            {money("DA", "act_da", "sr-act-da")}
            {money("HRA", "act_hra", "sr-act-hra")}
          </DetailSection>
          <DetailSection label="ESI Details" cols={12}>
            {status("ESI", "esi_status", "sr-esi")}
            {text("ESI No.", "esi_no", "sr-esi-no")}
            {date("Date of Joining", "esi_date_of_joining", "sr-esi-doj")}
            {date("Date of Leaving", "esi_date_of_leaving", "sr-esi-dol")}
            {text("Dispensary", "esi_dispensary", "sr-esi-disp")}
          </DetailSection>
          <DetailSection label="PF Details" cols={12}>
            {status("PF", "pf_status", "sr-pf")}
            {text("PF No.", "pf_no", "sr-pf-no")}
            {date("Date of Joining", "pf_date_of_joining", "sr-pf-doj")}
            {date("Date of Leaving", "pf_date_of_leaving", "sr-pf-dol")}
          </DetailSection>
        </div>
      ) : (
        /* One DetailSection, per the surface table: 7 fields, no child grid.
           Rows: 3+6+3 = 12, then 3+3+3+3 = 12 — every row closes, which is what
           keeps mixed widths from reading as ragged whitespace. */
        <DetailSection label="Bank Account" cols={12}>
          <Field label="Pay Mode" size="sm" htmlFor="bd-pay-mode">
            <Select
              id="bd-pay-mode"
              value={payMode}
              onChange={(e) => setPayMode(e.target.value)}
            >
              {PAY_MODES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bank" size="lg" htmlFor="bd-bank">
            <Select
              id="bd-bank"
              value={account.bank_id ?? ""}
              onChange={(e) => setA({ bank_id: e.target.value || null })}
            >
              <option value=""></option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Branch" size="sm" htmlFor="bd-branch">
            <Input
              id="bd-branch"
              value={account.branch ?? ""}
              onChange={(e) => setA({ branch: e.target.value })}
            />
          </Field>
          <Field label="Bank Type" size="sm" htmlFor="bd-bank-type">
            <Input
              id="bd-bank-type"
              value={account.bank_type ?? ""}
              onChange={(e) => setA({ bank_type: e.target.value })}
            />
          </Field>
          <Field label="A/c Type" size="sm" htmlFor="bd-ac-type">
            <Input
              id="bd-ac-type"
              value={account.ac_type ?? ""}
              onChange={(e) => setA({ ac_type: e.target.value })}
            />
          </Field>
          <Field label="A/c No" size="sm" htmlFor="bd-ac-no">
            <Input
              id="bd-ac-no"
              value={account.ac_no ?? ""}
              onChange={(e) => setA({ ac_no: e.target.value })}
            />
          </Field>
          <Field label="IFSC Code" size="sm" htmlFor="bd-ifsc">
            <Input
              id="bd-ifsc"
              value={account.ifsc_code ?? ""}
              onChange={(e) => setA({ ifsc_code: e.target.value })}
            />
          </Field>
        </DetailSection>
      )}
    </Sheet>
  );
}
