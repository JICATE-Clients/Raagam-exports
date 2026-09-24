"use client";

/**
 * Client half of Reports ▸ CAD Completion — the split every report here uses
 * (`shipment-pnl-report.tsx`): the `ReportConfig` carries `value()` closures,
 * so it is built where React can hold functions.
 *
 * `ReportView` has no filter slot, so the four narrowing controls live here and
 * hand it rows already narrowed — the tiles, the table, the PDF and the Excel
 * all describe the same filtered set.
 *
 * EXCEL GETS NUMBERS. Total Versions and Lead Time return raw numbers from
 * `value()` (blank, not 0, for a style not yet approved — a 0-day lead time
 * would read as an instant approval); the "—" is `format`'s, screen and PDF
 * only (ReportColumn's own note on why).
 */

import { useMemo, useState } from "react";
import { ReportView } from "@/components/reports/report-view";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Stat } from "@/components/ui/stat";
import { fmtDate } from "@/lib/format";
import type { ReportConfig } from "@/lib/reports/types";
import {
  CAD_STATE_META,
  CAD_STATES,
  cadCompletionOf,
  cadTypeLabel,
  latestVersion,
  type CadCompletion,
  type CadState,
  type CadStyleRow,
} from "@/lib/orders/cad-lifecycle/types";

type Row = CadStyleRow & {
  completion: CadCompletion;
  maker: string | null;
  v1Allocated: string | null;
  approvedOn: string | null;
};

type DateBasis = "allocated" | "approved";

export function CadCompletionReport({ rows }: { rows: CadStyleRow[] }) {
  const all = useMemo<Row[]>(
    () =>
      rows.map((r) => {
        const completion = cadCompletionOf(r.versions);
        const latest = latestVersion(r.versions);
        return {
          ...r,
          completion,
          maker: latest?.pattern_maker_name ?? null,
          v1Allocated: r.versions.find((v) => v.version_no === 1)?.allocation_date ?? null,
          approvedOn: completion.state === "approved" ? (latest?.decision?.decided_on ?? null) : null,
        };
      }),
    [rows],
  );

  const [customer, setCustomer] = useState("");
  const [maker, setMaker] = useState("");
  const [status, setStatus] = useState<CadState | "">("");
  const [basis, setBasis] = useState<DateBasis>("allocated");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const customers = useMemo(
    () => [...new Set(all.map((r) => r.customer_name).filter((v): v is string => !!v))].sort(),
    [all],
  );
  const makers = useMemo(
    () => [...new Set(all.map((r) => r.maker).filter((v): v is string => !!v))].sort(),
    [all],
  );

  const shown = useMemo(
    () =>
      all.filter((r) => {
        if (customer && r.customer_name !== customer) return false;
        if (maker && r.maker !== maker) return false;
        if (status && r.completion.state !== status) return false;
        if (from || to) {
          const d = basis === "allocated" ? r.v1Allocated : r.approvedOn;
          if (!d) return false;
          if (from && d < from) return false;
          if (to && d > to) return false;
        }
        return true;
      }),
    [all, customer, maker, status, basis, from, to],
  );

  const approved = shown.filter((r) => r.completion.state === "approved");
  const leads = approved.map((r) => r.completion.leadTimeDays).filter((v): v is number => v != null);
  const avgLead = leads.length > 0 ? Math.round((leads.reduce((s, v) => s + v, 0) / leads.length) * 10) / 10 : null;
  const avgVersions =
    shown.length > 0
      ? Math.round((shown.reduce((s, r) => s + r.completion.totalVersions, 0) / shown.length) * 10) / 10
      : null;

  const config: ReportConfig<Row> = {
    title: "CAD Completion",
    subtitle:
      from || to
        ? `${basis === "allocated" ? "V1 allocated" : "Approved"} ${from ? fmtDate(from) : "…"} to ${to ? fmtDate(to) : "…"}`
        : "All allocated styles",
    rows: shown,
    columns: [
      { key: "re_no", header: "RE No", value: (r) => r.re_no ?? r.order_code ?? "—" },
      { key: "customer", header: "Customer", value: (r) => r.customer_name ?? "—" },
      { key: "style", header: "Style Ref", value: (r) => r.style_ref_no },
      { key: "maker", header: "Pattern Maker", value: (r) => r.maker ?? "—" },
      { key: "cad_type", header: "CAD Type", value: (r) => cadTypeLabel(latestVersion(r.versions)?.cad_type) },
      { key: "versions", header: "Total Versions", isNumeric: true, value: (r) => r.completion.totalVersions },
      { key: "status", header: "Status", value: (r) => CAD_STATE_META[r.completion.state].label },
      { key: "v1_allocated", header: "V1 Allocated", value: (r) => (r.v1Allocated ? fmtDate(r.v1Allocated) : "—") },
      { key: "approved_on", header: "Approved On", value: (r) => (r.approvedOn ? fmtDate(r.approvedOn) : "—") },
      {
        key: "lead_time",
        header: "Final Approval Lead Time (Days)",
        isNumeric: true,
        value: (r) => r.completion.leadTimeDays ?? "",
        format: (v) => (v === "" ? "—" : String(v)),
      },
    ],
    chart: {
      kind: "bar",
      category: (r) => `${r.re_no ?? r.order_code ?? ""} ${r.style_ref_no}`.trim(),
      series: [
        { key: "versions", label: "Versions", value: (r) => r.completion.totalVersions },
        { key: "lead", label: "Lead time (days)", value: (r) => r.completion.leadTimeDays ?? 0 },
      ],
    },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Styles" value={shown.length} tone="neutral" />
        <Stat label="Approved" value={approved.length} tone="success" />
        <Stat label="Pending" value={shown.length - approved.length} tone={shown.length - approved.length > 0 ? "warning" : "neutral"} />
        <Stat
          label="Avg lead time"
          value={avgLead != null ? `${avgLead} d` : "—"}
          hint="Approved styles only"
          tone="neutral"
        />
        <Stat label="Avg versions" value={avgVersions ?? "—"} tone="neutral" />
      </div>

      <FieldRow>
        <Field label="Customer" w="party" htmlFor="cc-customer">
          <Select id="cc-customer" value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pattern Maker" w="term" htmlFor="cc-maker">
          <Select id="cc-maker" value={maker} onChange={(e) => setMaker(e.target.value)}>
            <option value="">Anyone</option>
            {makers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" w="term" htmlFor="cc-status">
          <Select id="cc-status" value={status} onChange={(e) => setStatus(e.target.value as CadState | "")}>
            <option value="">All</option>
            {CAD_STATES.filter((s) => s !== "not_allocated").map((s) => (
              <option key={s} value={s}>
                {CAD_STATE_META[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date of" w="term" htmlFor="cc-basis">
          <Select id="cc-basis" value={basis} onChange={(e) => setBasis(e.target.value as DateBasis)}>
            <option value="allocated">V1 allocation</option>
            <option value="approved">Approval</option>
          </Select>
        </Field>
        <Field label="From" w="code" htmlFor="cc-from">
          <Input id="cc-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" w="code" htmlFor="cc-to">
          <Input id="cc-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </FieldRow>

      <ReportView
        config={config}
        getKey={(r) => r.key}
        empty={rows.length > 0 ? "No style matches these filters." : "No CAD has been allocated yet."}
      />
    </div>
  );
}
