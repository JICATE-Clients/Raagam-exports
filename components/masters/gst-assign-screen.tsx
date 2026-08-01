"use client";

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
import { saveVendorGst, type VendorGstChange } from "@/lib/masters/vendor-gst-actions";
import type { VendorGstRow } from "@/lib/masters/vendor-gst-service";
import { GstinCell, gstinProblem } from "@/components/masters/gstin-cell";
import {
  GST_REG_STATUSES,
  VENDOR_STATUSES,
  VENDOR_TYPES,
  type GstRegStatus,
  type VendorType,
} from "@/lib/masters/vendor-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Edit = { gst_reg_status: GstRegStatus | null; gst_no: string | null };

/**
 * The supply type a vendor's own classification implies, for the cross-check in
 * GstinCell. "Foreign Vendor" implies nothing — a foreign vendor holding an
 * Indian GSTIN is a real (if unusual) arrangement, not a data error.
 */
function expectedSupply(t: VendorType | null): "intra" | "inter" | null {
  return t === "With in State" ? "intra" : t === "Other State" ? "inter" : null;
}

const CATEGORIES = [
  { key: "is_bought_items_vendor", label: "Bought Items", abbr: "Bought" },
  { key: "is_processor", label: "Processor", abbr: "Proc" },
  { key: "is_service_provider", label: "Service Provider", abbr: "Service" },
  { key: "is_sub_contractor", label: "Sub-contractor", abbr: "Sub-con" },
] as const;

function catList(r: VendorGstRow) {
  return CATEGORIES.filter((c) => r[c.key]);
}
function statusTone(s: VendorGstRow["status"]): "success" | "danger" | "warning" {
  return s === "Approved" ? "success" : s === "Terminated" ? "danger" : "warning";
}

/**
 * "GST Assign to Vendors" (Associates) — a single-screen bulk editor over the
 * `master_vendors` master, replacing the legacy 2-step "GST No Assign to Vendor"
 * wizard. Filter vendors (Status · Vendor Type · GST Type · Category + search),
 * then set GST Type + GSTIN per row inline or for a whole checkbox selection at
 * once. Edits accumulate locally (only changed rows); a single Save writes them
 * via saveVendorGst. Mirrors the TCS-assign pattern.
 */
export function GstAssignScreen({
  rows,
  companyGstin,
  perms,
}: {
  rows: VendorGstRow[];
  /** Our own GSTIN — turns each row's GSTIN into within-state / other-state. */
  companyGstin: string | null;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [fGst, setFGst] = useState(""); // "" | GstRegStatus | "__none"
  const [fCat, setFCat] = useState("");
  const [fNo, setFNo] = useState(""); // "" | "__missing" | "__invalid" | "__checkdigit" | "__supply"

  const [edits, setEdits] = useState<Map<string, Edit>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkType, setBulkType] = useState("");
  const [bulkNo, setBulkNo] = useState("");

  const cur = (r: VendorGstRow): Edit =>
    edits.get(r.id) ?? { gst_reg_status: r.gst_reg_status, gst_no: r.gst_no };
  const isDirty = (r: VendorGstRow) => {
    const e = edits.get(r.id);
    return !!e && (e.gst_reg_status !== r.gst_reg_status || (e.gst_no ?? "") !== (r.gst_no ?? ""));
  };
  const dirty = useMemo(() => rows.filter(isDirty).length, [rows, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hold off the silent PWA auto-reload while rows are edited or a save is in
  // flight — this grid has no overlay, so the declaration is the only signal.
  useUnsavedGuard(dirty > 0 || isPending);

  function setEdit(id: string, patch: Partial<Edit>) {
    setEdits((prev) => {
      const r = rows.find((x) => x.id === id);
      if (!r) return prev;
      const base = prev.get(id) ?? { gst_reg_status: r.gst_reg_status, gst_no: r.gst_no };
      const next: Edit = { ...base, ...patch };
      const m = new Map(prev);
      if (next.gst_reg_status === r.gst_reg_status && (next.gst_no ?? "") === (r.gst_no ?? "")) {
        m.delete(id); // back to original → not a change
      } else {
        m.set(id, next);
      }
      return m;
    });
  }

  /**
   * What the free offline decode says about each row's CURRENT GSTIN — wrong
   * shape, wrong check digit, or a state that contradicts the vendor's own
   * within-state / other-state classification. Computed once over every row so
   * the counter, the filter and the cell marker can never disagree.
   */
  const problems = useMemo(() => {
    const m = new Map<string, ReturnType<typeof gstinProblem>>();
    for (const r of rows) {
      const p = gstinProblem(cur(r).gst_no, companyGstin, expectedSupply(r.vendor_type));
      if (p) m.set(r.id, p);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, edits, companyGstin]);

  const dt = useCreatedDateFilter(rows);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(dt.matches).filter((r) => {
      const c = edits.get(r.id) ?? { gst_reg_status: r.gst_reg_status, gst_no: r.gst_no };
      if (q && !`${r.code ?? ""} ${r.name}`.toLowerCase().includes(q)) return false;
      if (fStatus && r.status !== fStatus) return false;
      if (fType && r.vendor_type !== fType) return false;
      if (fCat && !catList(r).some((x) => x.label === fCat)) return false;
      if (fGst === "__none" && c.gst_reg_status) return false;
      if (fGst && fGst !== "__none" && c.gst_reg_status !== fGst) return false;
      // The GSTIN filter is what makes the "to check" counter actionable: the
      // search box matches code and name only, so without this the operator is
      // told there are eight bad numbers among 340 rows and left to find them.
      if (fNo === "__missing" && (c.gst_no ?? "").trim()) return false;
      if (fNo && fNo !== "__missing" && problems.get(r.id) !== fNo.slice(2)) return false;
      return true;
    });
  }, [rows, dt.matches, edits, query, fStatus, fType, fGst, fCat, fNo, problems]);

  const noType = useMemo(() => rows.filter((r) => !cur(r).gst_reg_status).length, [rows, edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const noNumber = useMemo(() => rows.filter((r) => !(cur(r).gst_no ?? "").trim()).length, [rows, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Edited rows whose GSTIN is not even the right SHAPE. These block Save: the
   * server rejects the whole batch on the first one (the same rule the Vendor
   * master enforces), so letting the round trip happen would just lose the
   * operator's other edits' feedback behind a toast. A failed CHECK DIGIT is
   * deliberately not blocking — a number copied off an invoice has to be
   * savable while the vendor is chased.
   */
  const blocking = useMemo(
    () => [...edits.values()].filter((e) => gstinProblem(e.gst_no) === "invalid").length,
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

  function bulkApplyType() {
    if (!bulkType || selected.size === 0) return;
    selected.forEach((id) => setEdit(id, { gst_reg_status: bulkType as GstRegStatus }));
    success(`GST Type set to “${bulkType}” for ${selected.size} vendor${selected.size === 1 ? "" : "s"}.`);
  }
  /** A blank bulk box means "clear the GSTIN on these rows", which is allowed. */
  const bulkInvalid = gstinProblem(bulkNo) === "invalid";

  function bulkApplyNo() {
    if (selected.size === 0 || bulkInvalid) return;
    const val = bulkNo.trim() || null;
    selected.forEach((id) => setEdit(id, { gst_no: val }));
    success(`GSTIN applied to ${selected.size} vendor${selected.size === 1 ? "" : "s"}.`);
  }

  function resetFilters() {
    setQuery("");
    dt.reset();
    setFStatus("");
    setFType("");
    setFGst("");
    setFCat("");
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
      const changes: VendorGstChange[] = [...edits.entries()].map(([id, e]) => ({
        id,
        gst_reg_status: e.gst_reg_status,
        gst_no: e.gst_no?.trim() || null,
      }));
      if (changes.length === 0) return;
      const res = await saveVendorGst(changes);
      if (res.ok) {
        success(`Saved GST details for ${changes.length} vendor${changes.length === 1 ? "" : "s"}.`);
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

  const gstSelect = (r: VendorGstRow) => (
    <Select
      value={cur(r).gst_reg_status ?? ""}
      onChange={(e) => setEdit(r.id, { gst_reg_status: (e.target.value || null) as GstRegStatus | null })}
      disabled={!perms.canEdit}
      className="h-8 w-36 text-base md:text-sm"
      aria-label={`GST Type for ${r.name}`}
    >
      <option value="">— Not set —</option>
      {GST_REG_STATUSES.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </Select>
  );
  const gstInput = (r: VendorGstRow) => (
    <GstinCell
      value={cur(r).gst_no}
      onChange={(v) => setEdit(r.id, { gst_no: v })}
      disabled={!perms.canEdit}
      label={`GSTIN for ${r.name}`}
      companyGstin={companyGstin}
      expectSupply={expectedSupply(r.vendor_type)}
      expectLabel={r.vendor_type}
    />
  );

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search vendor code or name…"
        activeCount={[fStatus, fType, fGst, fCat, fNo].filter(Boolean).length + dt.active}
        onReset={resetFilters}
        dateFilter={dt.bind}
        right={
          <>
            {filtered.length} of {rows.length} · {noType} no GST type · {noNumber} no GSTIN
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
          {VENDOR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={fType} onChange={(e) => setFType(e.target.value)} aria-label="Filter vendor type" className="h-9 text-base md:text-sm">
          <option value="">All types</option>
          {VENDOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select value={fGst} onChange={(e) => setFGst(e.target.value)} aria-label="Filter GST type" className="h-9 text-base md:text-sm">
          <option value="">All GST types</option>
          {GST_REG_STATUSES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
          <option value="__none">— Not set —</option>
        </Select>
        <Select value={fCat} onChange={(e) => setFCat(e.target.value)} aria-label="Filter category" className="h-9 text-base md:text-sm">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.label}>
              {c.label}
            </option>
          ))}
        </Select>
        <Select value={fNo} onChange={(e) => setFNo(e.target.value)} aria-label="Filter GSTIN" className="h-9 text-base md:text-sm">
          <option value="">All GSTINs</option>
          <option value="__missing">— No GSTIN —</option>
          <option value="__invalid">Not a valid GSTIN</option>
          <option value="__checkdigit">Check digit wrong</option>
          <option value="__supply">State disagrees with type</option>
        </Select>
      </FilterBar>

      {/* bulk action bar */}
      {perms.canEdit && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
          <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Set GST Type</span>
            <Select value={bulkType} onChange={(e) => setBulkType(e.target.value)} aria-label="Bulk GST type" className="h-8 text-sm">
              <option value="">Choose…</option>
              {GST_REG_STATUSES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
            <Button variant="outline" size="sm" disabled={!bulkType} onClick={bulkApplyType}>
              Apply
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Set GSTIN</span>
            {/* One GSTIN going onto many vendors is the single most damaging
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
              Apply
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
        <table className="w-full min-w-[960px] border-collapse">
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
              {["Vendor", "Name", "Vendor Type", "Category", "Status", "GST Type", "GSTIN"].map((h) => (
                <th key={h} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  No vendors match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const d = isDirty(r);
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
                    <td className="px-3 py-2 text-sm text-muted-foreground">{r.vendor_type ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {catList(r).length ? (
                          catList(r).map((c) => (
                            <span
                              key={c.key}
                              title={c.label}
                              className="rounded border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                            >
                              {c.abbr}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>
                    </td>
                    <td className="px-3 py-2">{gstSelect(r)}</td>
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
            No vendors match these filters.
          </div>
        ) : (
          filtered.map((r) => {
            const d = isDirty(r);
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
                      {r.vendor_type ? ` · ${r.vendor_type}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {d && <span className="text-[10px] font-bold uppercase tracking-wide text-warning">Edited</span>}
                    <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {gstSelect(r)}
                  {gstInput(r)}
                </div>
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
              <b className="text-warning tabular-nums">{dirty}</b> vendor{dirty === 1 ? "" : "s"} with unsaved GST changes.
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
