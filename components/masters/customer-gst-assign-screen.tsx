"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FilterBar } from "@/components/masters/filter-bar";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { saveCustomerGst, type CustomerGstChange } from "@/lib/masters/customer-gst-actions";
import type { CustomerGstRow } from "@/lib/masters/customer-gst-service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type CityOption = { id: string; code: string | null; name: string | null };
const STATUSES = ["Active", "Inactive", "Draft"] as const;

function statusOf(r: CustomerGstRow): (typeof STATUSES)[number] {
  if (r.inactive) return "Inactive";
  if (r.is_draft) return "Draft";
  return "Active";
}
function statusTone(s: (typeof STATUSES)[number]): "success" | "danger" | "warning" {
  return s === "Active" ? "success" : s === "Inactive" ? "danger" : "warning";
}

/**
 * "GST Assign to Customers" (Associates) — a single-screen bulk editor over the
 * `customers` master, replacing the legacy 2-step "GST No Assign to Customer"
 * wizard. Filter customers (Status · City + search), then set GSTIN per row
 * inline or for a whole checkbox selection at once. Customers carry a GST number
 * only (no GST type), so there's one editable column. Edits accumulate locally
 * (only changed rows); a single Save writes them via saveCustomerGst.
 */
export function CustomerGstAssignScreen({
  rows,
  cities,
  perms,
}: {
  rows: CustomerGstRow[];
  cities: CityOption[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fCity, setFCity] = useState(""); // "" | cityId | "__none"

  const [edits, setEdits] = useState<Map<string, string | null>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNo, setBulkNo] = useState("");

  const cityName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cities) m.set(c.id, c.name ?? c.code ?? "—");
    return m;
  }, [cities]);

  const cur = (r: CustomerGstRow): string | null => (edits.has(r.id) ? edits.get(r.id)! : r.gst_no);
  const isDirty = (r: CustomerGstRow) => edits.has(r.id) && (edits.get(r.id) ?? "") !== (r.gst_no ?? "");
  const dirty = useMemo(() => rows.filter(isDirty).length, [rows, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  function setEdit(id: string, val: string | null) {
    setEdits((prev) => {
      const r = rows.find((x) => x.id === id);
      if (!r) return prev;
      const m = new Map(prev);
      if ((val ?? "") === (r.gst_no ?? "")) m.delete(id);
      else m.set(id, val);
      return m;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.code ?? ""} ${r.name}`.toLowerCase().includes(q)) return false;
      if (fStatus && statusOf(r) !== fStatus) return false;
      if (fCity === "__none" && r.city_id) return false;
      if (fCity && fCity !== "__none" && r.city_id !== fCity) return false;
      return true;
    });
  }, [rows, query, fStatus, fCity]);

  const missing = useMemo(() => rows.filter((r) => !cur(r)).length, [rows, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- selection (operates on the currently-filtered rows) ----
  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  function toggleRow(id: string, on: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });
  }
  function toggleAll(on: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      for (const id of filteredIds) {
        if (on) s.add(id);
        else s.delete(id);
      }
      return s;
    });
  }
  function clearSel() {
    setSelected(new Set());
  }
  function bulkApplyNo() {
    if (selected.size === 0) return;
    const val = bulkNo.trim() || null;
    selected.forEach((id) => setEdit(id, val));
    success(`GSTIN applied to ${selected.size} customer${selected.size === 1 ? "" : "s"}.`);
  }

  function resetFilters() {
    setQuery("");
    setFStatus("");
    setFCity("");
  }

  function save() {
    startTransition(async () => {
      const changes: CustomerGstChange[] = [...edits.entries()].map(([id, gst_no]) => ({
        id,
        gst_no: gst_no?.trim() || null,
      }));
      if (changes.length === 0) return;
      const res = await saveCustomerGst(changes);
      if (res.ok) {
        success(`Saved GSTIN for ${changes.length} customer${changes.length === 1 ? "" : "s"}.`);
        setEdits(new Map());
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }
  function discard() {
    setEdits(new Map());
  }

  const gstInput = (r: CustomerGstRow) => (
    <Input
      value={cur(r) ?? ""}
      onChange={(e) => setEdit(r.id, e.target.value)}
      disabled={!perms.canEdit}
      maxLength={15}
      placeholder="—"
      aria-label={`GSTIN for ${r.name}`}
      className="h-8 w-40 font-mono text-base md:text-sm"
    />
  );

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search customer code or name…"
        activeCount={[fStatus, fCity].filter(Boolean).length}
        onReset={resetFilters}
        right={
          <>
            {filtered.length} of {rows.length} · {missing} missing GSTIN
          </>
        }
      >
        <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter status" className="h-9 text-base md:text-sm">
          <option value="">All status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={fCity} onChange={(e) => setFCity(e.target.value)} aria-label="Filter city" className="h-9 text-base md:text-sm">
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? c.code ?? "—"}
            </option>
          ))}
          <option value="__none">— No city —</option>
        </Select>
      </FilterBar>

      {/* bulk action bar */}
      {perms.canEdit && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
          <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Set GSTIN</span>
            <Input
              value={bulkNo}
              onChange={(e) => setBulkNo(e.target.value)}
              maxLength={15}
              placeholder="15-digit GSTIN"
              aria-label="Bulk GSTIN"
              className="h-8 w-44 font-mono text-sm"
            />
            <Button variant="outline" size="sm" onClick={bulkApplyNo}>
              Apply to selection
            </Button>
          </div>
          <div className="flex-1" />
          <button type="button" onClick={clearSel} className="text-sm font-medium text-primary hover:underline">
            Clear selection
          </button>
        </div>
      )}

      {/* desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left">
              <th className="w-10 px-3 py-2.5 text-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={!perms.canEdit || filtered.length === 0}
                  aria-label="Select all"
                />
              </th>
              {["Customer", "Name", "City", "Status", "GSTIN"].map((h) => (
                <th key={h} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  No customers match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const d = isDirty(r);
                const st = statusOf(r);
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-border last:border-0 ${d ? "bg-warning-soft/40 shadow-[inset_3px_0_0_var(--color-warning)]" : ""}`}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={selected.has(r.id)}
                        onChange={(e) => toggleRow(r.id, e.target.checked)}
                        disabled={!perms.canEdit}
                        aria-label={`Select ${r.name}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.code ?? "—"}</td>
                    <td className="px-3 py-2 text-sm font-medium text-foreground">
                      {r.name}
                      {d && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-warning">Edited</span>}
                    </td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">
                      {r.city_id ? (cityName.get(r.city_id) ?? "—") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tone={statusTone(st)}>{st}</StatusPill>
                    </td>
                    <td className="px-3 py-2">{gstInput(r)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No customers match these filters.
          </div>
        ) : (
          filtered.map((r) => {
            const d = isDirty(r);
            const st = statusOf(r);
            return (
              <div
                key={r.id}
                className={`rounded-xl border bg-surface p-4 ${d ? "border-warning/50" : "border-border"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {r.code ?? "—"}
                      {r.city_id ? ` · ${cityName.get(r.city_id) ?? ""}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {d && <span className="text-[10px] font-bold uppercase tracking-wide text-warning">Edited</span>}
                    <StatusPill tone={statusTone(st)}>{st}</StatusPill>
                  </div>
                </div>
                <div className="mt-3">{gstInput(r)}</div>
              </div>
            );
          })
        )}
      </div>

      {/* sticky save footer */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
        <span className="text-sm text-muted-foreground">
          {dirty === 0 ? "No unsaved changes." : (
            <>
              <b className="text-warning tabular-nums">{dirty}</b> customer{dirty === 1 ? "" : "s"} with unsaved GSTIN changes.
            </>
          )}
        </span>
        {perms.canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" size="md" disabled={dirty === 0 || isPending} onClick={discard}>
              Discard
            </Button>
            <Button size="md" disabled={dirty === 0 || isPending} onClick={save}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
