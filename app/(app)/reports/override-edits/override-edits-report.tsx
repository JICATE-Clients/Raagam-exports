"use client";

import { useMemo, useState } from "react";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Stat } from "@/components/ui/stat";
import { ReportView } from "@/components/reports/report-view";
import { fmtDateTime } from "@/lib/format";
import type { ReportConfig } from "@/lib/reports/types";
import {
  OVERRIDE_KEYS,
  overrideFieldLabel,
  overrideKeyLabel,
  overrideTableLabel,
} from "@/lib/orders/overrides/override-modules";
import type { OverrideEditRow } from "@/lib/orders/overrides/types";

/**
 * The Override Edit Report's table (R-18). The server hands over every row the
 * viewer may read; the four filters the spec names — date range, order, user,
 * module — narrow them here. A display slice, not a query: override edits are
 * rare by design (a grant is time-limited and every save needs a reason), so
 * one fetch carries them. If this ever grows past that, the filters move into
 * `listOverrideEdits` as query parameters, not into this component.
 *
 * GROUPED BY SAVE. Rows are ordered newest save first and, within a save, by
 * area and field, so one commit's fields sit together under one timestamp,
 * one user and one reason — the "commit" the spec's §6.3 groups by. The Save
 * column carries its outcome: a save that failed halfway, or was abandoned and
 * expired, still shows what it wrote.
 *
 * Excel receives the raw values (ReportView's contract), so the full old / new
 * text of a "(row added)" / "(row removed)" line survives the export.
 */

const STATUS_WORD: Record<OverrideEditRow["commit_status"], string> = {
  committed: "Committed",
  failed: "Failed part-way",
  expired: "Abandoned (expired)",
  open: "In progress",
};

/** The viewer's local calendar day of an ISO timestamp — what a date filter means. */
function localDay(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function OverrideEditsReport({ rows }: { rows: OverrideEditRow[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [re, setRe] = useState("");
  const [user, setUser] = useState("");
  const [moduleKey, setModuleKey] = useState("");

  const reOptions = useMemo(
    () => [...new Set(rows.map((r) => r.re_no).filter((x): x is string => !!x))].sort(),
    [rows],
  );
  const userOptions = useMemo(() => [...new Set(rows.map((r) => r.user_email))].sort(), [rows]);

  const shown = rows
    .filter((r) => {
      const day = localDay(r.committed_at);
      return (
        (!from || day >= from) &&
        (!to || day <= to) &&
        (!re || r.re_no === re) &&
        (!user || r.user_email === user) &&
        (!moduleKey || r.module_key === moduleKey)
      );
    })
    .sort(
      (a, b) =>
        b.committed_at.localeCompare(a.committed_at) ||
        a.commit_id.localeCompare(b.commit_id) ||
        a.entity_table.localeCompare(b.entity_table) ||
        a.field_name.localeCompare(b.field_name),
    );

  const saves = new Set(shown.map((r) => r.commit_id)).size;
  const people = new Set(shown.map((r) => r.user_email)).size;

  const config: ReportConfig<OverrideEditRow> = {
    title: "Override Edit Report",
    subtitle: "Post-approval edits made under a permission override",
    rows: shown,
    columns: [
      { key: "saved", header: "Saved", value: (r) => fmtDateTime(r.committed_at) },
      { key: "re", header: "RE No", value: (r) => r.re_no ?? "—" },
      { key: "version", header: "Version", value: (r) => r.order_version ?? "—" },
      { key: "user", header: "User", value: (r) => r.user_email },
      { key: "module", header: "Module", value: (r) => (r.module_key ? overrideKeyLabel(r.module_key) : "—") },
      { key: "area", header: "Area", value: (r) => overrideTableLabel(r.entity_table) },
      { key: "field", header: "Field", value: (r) => overrideFieldLabel(r.field_name) },
      { key: "old", header: "Old", value: (r) => r.old_value ?? "—" },
      { key: "new", header: "New", value: (r) => r.new_value ?? "—" },
      { key: "reason", header: "Reason", value: (r) => r.reason },
      {
        key: "save",
        header: "Save",
        value: (r) =>
          `${STATUS_WORD[r.commit_status]} · ${r.commit_id.slice(0, 8)}` +
          (r.direction_breach ? " · quantity direction breached" : ""),
      },
    ],
  };

  return (
    <div className="space-y-4">
      {/* The spec's four filters (R-18). Width by the kind of value
          (lib/ui/sizes.ts): two dates, an RE No, an email, a module label. */}
      <FieldRow>
        <Field label="From" w="term" htmlFor="oe-from">
          <Input id="oe-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" w="term" htmlFor="oe-to">
          <Input id="oe-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="RE No" w="party" htmlFor="oe-re">
          <Select id="oe-re" value={re} onChange={(e) => setRe(e.target.value)}>
            <option value="">All</option>
            {reOptions.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </Select>
        </Field>
        <Field label="User" w="name" htmlFor="oe-user">
          <Select id="oe-user" value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">All</option>
            {userOptions.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </Select>
        </Field>
        <Field label="Module" w="party" htmlFor="oe-module">
          <Select id="oe-module" value={moduleKey} onChange={(e) => setModuleKey(e.target.value)}>
            <option value="">All</option>
            {OVERRIDE_KEYS.map((k) => (
              <option key={k} value={k}>{overrideKeyLabel(k)}</option>
            ))}
          </Select>
        </Field>
      </FieldRow>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Override saves" value={saves} tone="neutral" />
        <Stat label="Fields changed" value={shown.length} tone="neutral" />
        <Stat label="Users" value={people} tone="neutral" />
      </div>

      <ReportView
        config={config}
        getKey={(r) => r.id}
        empty="No override edits match these filters."
      />
    </div>
  );
}
