"use client";

/**
 * mount: exempt -- DELIBERATELY DARK. This screen is registered in no
 * sub-module and mounted by no route, and that is a client decision, not rot.
 *
 * The canonical statement is the removal note in `lib/masters/submodules.ts`,
 * where these entries used to sit: it names the whole list and the reason
 * ("not part of this business process", 2026-08-01), and it records that the
 * TABLES were deliberately kept so the rows survive and the master can be
 * restored from git if the decision reverses. Read it there rather than here --
 * one statement with nine pointers, because a reason copied nine times is nine
 * things to keep in step.
 *
 * THIS COMMENT EXISTS BECAUSE ITS ABSENCE COST AN HOUR. Employee was removed in
 * the same block and restored on 2026-08-31; on the way, three agents grepped
 * its screen for a reason, found none, and concluded it had been dropped by
 * accident -- and a restore was approved on that false premise before the note
 * in `submodules.ts` was found. A removal leaves a comment, not a symbol, so
 * the reason has to sit where the grep lands. If this screen is ever restored,
 * delete this block; `--check mount` will then hold it to being mounted.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ValidatedInput } from "@/components/ui/validated-input";
import { FilterBar } from "@/components/ui/filter-bar";
import { useCreatedDateFilter } from "@/lib/masters/use-created-date-filter";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useRegisterShortcut } from "@/lib/shortcuts";
import { saveCustomerGst, type CustomerGstChange } from "@/lib/masters/customer-gst-actions";
import type { CustomerGstRow } from "@/lib/masters/customer-gst-service";
import { GstinCell, gstinProblem } from "@/components/masters/gstin-cell";

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
  companyGstin,
  perms,
}: {
  rows: CustomerGstRow[];
  cities: CityOption[];
  /** Our own GSTIN — turns each row's GSTIN into within-state / other-state. */
  companyGstin: string | null;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fCity, setFCity] = useState(""); // "" | cityId | "__none"
  const [fNo, setFNo] = useState(""); // "" | "__missing" | "__invalid" | "__checkdigit"

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

  // Hold off the silent PWA auto-reload while rows are edited or a save is in
  // flight — this grid has no overlay, so the declaration is the only signal.
  useUnsavedGuard(dirty > 0 || isPending);

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

  /**
   * What the free offline decode says about each row's CURRENT GSTIN — wrong
   * shape or wrong check digit. (No supply cross-check here: unlike a vendor, a
   * customer record carries no within-state / other-state classification to
   * contradict.) Computed over every row so the counter, the filter and the
   * cell marker can never disagree.
   */
  const problems = useMemo(() => {
    const m = new Map<string, ReturnType<typeof gstinProblem>>();
    for (const r of rows) {
      const p = gstinProblem(cur(r));
      if (p) m.set(r.id, p);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, edits]);

  const dt = useCreatedDateFilter(rows);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(dt.matches).filter((r) => {
      if (q && !`${r.code ?? ""} ${r.name}`.toLowerCase().includes(q)) return false;
      if (fStatus && statusOf(r) !== fStatus) return false;
      if (fCity === "__none" && r.city_id) return false;
      if (fCity && fCity !== "__none" && r.city_id !== fCity) return false;
      // Without this the "to check" counter names a problem the operator has no
      // way to find — the search box matches code and name only.
      if (fNo === "__missing" && (cur(r) ?? "").trim()) return false;
      if (fNo && fNo !== "__missing" && problems.get(r.id) !== fNo.slice(2)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, dt.matches, query, fStatus, fCity, fNo, problems]);

  const missing = useMemo(() => rows.filter((r) => !cur(r)).length, [rows, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Edited rows whose GSTIN is not even the right SHAPE. They block Save: the
   * server rejects the whole batch on the first one. A failed CHECK DIGIT does
   * not block — a number copied off an invoice must stay savable while the
   * customer is chased.
   */
  const blocking = useMemo(
    () => [...edits.values()].filter((v) => gstinProblem(v) === "invalid").length,
    [edits],
  );

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
  /** A blank bulk box means "clear the GSTIN on these rows", which is allowed. */
  const bulkInvalid = gstinProblem(bulkNo) === "invalid";

  function bulkApplyNo() {
    if (selected.size === 0 || bulkInvalid) return;
    const val = bulkNo.trim() || null;
    selected.forEach((id) => setEdit(id, val));
    success(`GSTIN applied to ${selected.size} customer${selected.size === 1 ? "" : "s"}.`);
  }

  function resetFilters() {
    setQuery("");
    dt.reset();
    setFStatus("");
    setFCity("");
    setFNo("");
  }

  // Ctrl/⌘+S and Enter both save through here. This screen is neither a Sheet
  // nor a MasterFullScreen, so it inherits neither; and `submitSurface` cannot
  // reach its Save button by DOM, so registering is what makes Enter save.
  useRegisterShortcut("save", () => {
    if (dirty > 0 && !isPending && blocking === 0) save();
  });

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
    <GstinCell
      value={cur(r)}
      onChange={(v) => setEdit(r.id, v)}
      disabled={!perms.canEdit}
      label={`GSTIN for ${r.name}`}
      companyGstin={companyGstin}
    />
  );

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search customer code or name…"
        activeCount={[fStatus, fCity, fNo].filter(Boolean).length + dt.active}
        onReset={resetFilters}
        dateFilter={dt.bind}
        right={
          <>
            {filtered.length} of {rows.length} · {missing} missing GSTIN
            {problems.size > 0 && (
              <span className="ml-1 font-semibold text-amber-600 dark:text-amber-500">
                · {problems.size} to check
              </span>
            )}
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
        <Select value={fNo} onChange={(e) => setFNo(e.target.value)} aria-label="Filter GSTIN" className="h-9 text-base md:text-sm">
          <option value="">All GSTINs</option>
          <option value="__missing">— No GSTIN —</option>
          <option value="__invalid">Not a valid GSTIN</option>
          <option value="__checkdigit">Check digit wrong</option>
        </Select>
      </FilterBar>

      {/* bulk action bar */}
      {perms.canEdit && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
          <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Set GSTIN</span>
            {/* One GSTIN going onto many customers is the single most damaging
                thing this screen can do, so it gets the same rule as a row. */}
            <ValidatedInput
              format="gstin"
              value={bulkNo}
              onChange={(e) => setBulkNo(e.target.value)}
              placeholder="15-digit GSTIN"
              aria-label="Bulk GSTIN"
              className="h-8 w-44 font-mono text-sm"
            />
            <Button variant="outline" size="sm" disabled={bulkInvalid} onClick={bulkApplyNo}>
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
          {blocking > 0 ? (
            <span className="font-medium text-danger">
              {blocking} edited row{blocking === 1 ? " is" : "s are"} not a valid GSTIN — fix{" "}
              {blocking === 1 ? "it" : "them"} to save.
            </span>
          ) : dirty === 0 ? (
            "No unsaved changes."
          ) : (
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
            <Button size="md" disabled={dirty === 0 || isPending || blocking > 0} onClick={save}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
