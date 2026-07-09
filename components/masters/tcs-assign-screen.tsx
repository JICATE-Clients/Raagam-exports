"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { saveCustomerTcs } from "@/lib/masters/tcs-actions";
import type { CustomerTcsRow } from "@/lib/masters/tcs-service";
import type { Country } from "@/lib/masters/country-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Legacy "TCS Assign to Customers" — a bulk-toggle grid over the customers
 * master. Every customer is listed read-only (Customer · Name · Customer ID ·
 * Country ID) with a per-row TCS Yes/No dropdown. Edits accumulate locally; a
 * single Save writes only the changed rows via saveCustomerTcs (grouped by
 * value). Edit-only — no Add/Delete (customers are created on their own master).
 */
export function TcsAssignScreen({
  rows,
  countries,
  perms,
}: {
  rows: CustomerTcsRow[];
  countries: Country[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  // Only changed rows live here (id → new value); everything else reads from `rows`.
  const [edits, setEdits] = useState<Map<string, boolean>>(new Map());

  const countryCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of countries) m.set(c.id, c.code ?? "—");
    return m;
  }, [countries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.doc_id].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const valueOf = (r: CustomerTcsRow) => edits.get(r.id) ?? r.tcs_applicable;
  const dirty = edits.size > 0;

  function setTcs(r: CustomerTcsRow, next: boolean) {
    setEdits((prev) => {
      const m = new Map(prev);
      if (next === r.tcs_applicable) m.delete(r.id); // back to original → not a change
      else m.set(r.id, next);
      return m;
    });
  }

  function save() {
    startTransition(async () => {
      const changes = [...edits.entries()].map(([id, tcs_applicable]) => ({ id, tcs_applicable }));
      const res = await saveCustomerTcs(changes);
      if (res.ok) {
        success(`TCS updated for ${changes.length} customer${changes.length === 1 ? "" : "s"}.`);
        setEdits(new Map());
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const tcsSelect = (r: CustomerTcsRow) => (
    <Select
      value={valueOf(r) ? "yes" : "no"}
      onChange={(e) => setTcs(r, e.target.value === "yes")}
      disabled={!perms.canEdit}
      className="h-8 w-24 text-base md:text-sm"
      aria-label={`TCS for ${r.name}`}
    >
      <option value="no">No</option>
      <option value="yes">Yes</option>
    </Select>
  );

  const columns: Column<CustomerTcsRow>[] = [
    { header: "Customer", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Customer Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Customer ID",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.doc_id ?? "—"}</span>,
    },
    {
      header: "Country ID",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.country_id ? (countryCode.get(r.country_id) ?? "—") : "—"}
        </span>
      ),
    },
    { header: "TCS", cell: (r) => tcsSelect(r) },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customer…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {dirty && (
          <span className="text-xs text-muted-foreground">
            {edits.size} unsaved change{edits.size === 1 ? "" : "s"}
          </span>
        )}
        {perms.canEdit && (
          <Button size="md" disabled={!dirty || isPending} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No customers yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No customers yet.
          </div>
        ) : (
          filtered.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4"
            >
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {r.code ?? "—"}
                  {r.country_id ? ` · ${countryCode.get(r.country_id) ?? ""}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {valueOf(r) && <StatusPill tone="success">TCS</StatusPill>}
                {tcsSelect(r)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
