"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FilterBar } from "@/components/masters/filter-bar";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { saveMaterialHsn, type MaterialHsnChange } from "@/lib/masters/material-hsn-actions";
import type { MaterialHsnRow } from "@/lib/masters/material-hsn-service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Opt = { id: string; code: string | null; name: string | null };
type CatOpt = { id: string; short_name: string | null; name: string | null };

const hsnLabel = (o: Opt) => (o.code ? `${o.code}${o.name ? ` — ${o.name}` : ""}` : (o.name ?? "—"));

/**
 * "HSN Assign to Materials" (Materials) — a single-screen bulk editor over the
 * `items` master, replacing the legacy 2-step "HSN Assign to Material — By Item"
 * wizard. Filter items (Status · Item Class · Category + search), then set the
 * HSN (items.hsn_id → config_lookups 'hsn_code') per row inline or for a whole
 * checkbox selection at once. Edits accumulate locally (only changed rows); a
 * single Save writes them via saveMaterialHsn.
 */
export function MaterialHsnAssignScreen({
  rows,
  hsnOptions,
  itemClasses,
  categories,
  perms,
}: {
  rows: MaterialHsnRow[];
  hsnOptions: Opt[];
  itemClasses: Opt[];
  categories: CatOpt[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fClass, setFClass] = useState(""); // "" | classId | "__none"
  const [fCat, setFCat] = useState(""); // "" | catId | "__none"

  const [edits, setEdits] = useState<Map<string, string | null>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkHsn, setBulkHsn] = useState("");

  const itemClassName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of itemClasses) m.set(c.id, c.name ?? c.code ?? "—");
    return m;
  }, [itemClasses]);
  const catName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name ?? c.short_name ?? "—");
    return m;
  }, [categories]);

  const cur = (r: MaterialHsnRow): string | null => (edits.has(r.id) ? edits.get(r.id)! : r.hsn_id);
  const isDirty = (r: MaterialHsnRow) => edits.has(r.id) && (edits.get(r.id) ?? "") !== (r.hsn_id ?? "");
  const dirty = useMemo(() => rows.filter(isDirty).length, [rows, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  function setEdit(id: string, val: string | null) {
    setEdits((prev) => {
      const r = rows.find((x) => x.id === id);
      if (!r) return prev;
      const m = new Map(prev);
      if ((val ?? "") === (r.hsn_id ?? "")) m.delete(id);
      else m.set(id, val);
      return m;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.code ?? ""} ${r.name}`.toLowerCase().includes(q)) return false;
      if (fStatus === "Active" && !r.is_active) return false;
      if (fStatus === "Blocked" && r.is_active) return false;
      if (fClass === "__none" && r.item_class_id) return false;
      if (fClass && fClass !== "__none" && r.item_class_id !== fClass) return false;
      if (fCat === "__none" && r.category_id) return false;
      if (fCat && fCat !== "__none" && r.category_id !== fCat) return false;
      return true;
    });
  }, [rows, query, fStatus, fClass, fCat]);

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
  function bulkApply() {
    if (selected.size === 0) return;
    const val = bulkHsn || null;
    selected.forEach((id) => setEdit(id, val));
    const label = val ? (hsnOptions.find((o) => o.id === val)?.code ?? "HSN") : "— cleared —";
    success(`HSN “${label}” applied to ${selected.size} item${selected.size === 1 ? "" : "s"}.`);
  }

  function resetFilters() {
    setQuery("");
    setFStatus("");
    setFClass("");
    setFCat("");
  }

  function save() {
    startTransition(async () => {
      const changes: MaterialHsnChange[] = [...edits.entries()].map(([id, hsn_id]) => ({
        id,
        hsn_id: hsn_id || null,
      }));
      if (changes.length === 0) return;
      const res = await saveMaterialHsn(changes);
      if (res.ok) {
        success(`Saved HSN for ${changes.length} item${changes.length === 1 ? "" : "s"}.`);
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

  const hsnSelect = (r: MaterialHsnRow) => (
    <Select
      value={cur(r) ?? ""}
      onChange={(e) => setEdit(r.id, e.target.value || null)}
      disabled={!perms.canEdit}
      className="h-8 w-52 text-base md:text-sm"
      aria-label={`HSN for ${r.name}`}
    >
      <option value="">— Not set —</option>
      {hsnOptions.map((o) => (
        <option key={o.id} value={o.id}>
          {hsnLabel(o)}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search item code or name…"
        activeCount={[fStatus, fClass, fCat].filter(Boolean).length}
        onReset={resetFilters}
        right={
          <>
            {filtered.length} of {rows.length} · {missing} missing HSN
          </>
        }
      >
        <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter status" className="h-9 text-base md:text-sm">
          <option value="">All status</option>
          <option value="Active">Active</option>
          <option value="Blocked">Blocked</option>
        </Select>
        <Select value={fClass} onChange={(e) => setFClass(e.target.value)} aria-label="Filter item class" className="h-9 text-base md:text-sm">
          <option value="">All item classes</option>
          {itemClasses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? c.code ?? "—"}
            </option>
          ))}
          <option value="__none">— No class —</option>
        </Select>
        <Select value={fCat} onChange={(e) => setFCat(e.target.value)} aria-label="Filter category" className="h-9 text-base md:text-sm">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? c.short_name ?? "—"}
            </option>
          ))}
          <option value="__none">— No category —</option>
        </Select>
      </FilterBar>

      {/* bulk action bar */}
      {perms.canEdit && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
          <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Set HSN</span>
            <Select value={bulkHsn} onChange={(e) => setBulkHsn(e.target.value)} aria-label="Bulk HSN" className="h-8 w-52 text-sm">
              <option value="">— Not set —</option>
              {hsnOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {hsnLabel(o)}
                </option>
              ))}
            </Select>
            <Button variant="outline" size="sm" onClick={bulkApply}>
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
        <table className="w-full min-w-[1000px] border-collapse">
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
              {["Item", "Name", "Item Class", "Category", "Status", "HSN"].map((h) => (
                <th key={h} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  No items match these filters.
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
                    <td className="px-3 py-2 text-sm text-muted-foreground">
                      {r.item_class_id ? (itemClassName.get(r.item_class_id) ?? "—") : "—"}
                    </td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">
                      {r.category_id ? (catName.get(r.category_id) ?? "—") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tone={r.is_active ? "success" : "danger"}>
                        {r.is_active ? "Active" : "Blocked"}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2">{hsnSelect(r)}</td>
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
            No items match these filters.
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
                      {r.item_class_id ? ` · ${itemClassName.get(r.item_class_id) ?? ""}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {d && <span className="text-[10px] font-bold uppercase tracking-wide text-warning">Edited</span>}
                    <StatusPill tone={r.is_active ? "success" : "danger"}>
                      {r.is_active ? "Active" : "Blocked"}
                    </StatusPill>
                  </div>
                </div>
                <div className="mt-3">{hsnSelect(r)}</div>
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
              <b className="text-warning tabular-nums">{dirty}</b> item{dirty === 1 ? "" : "s"} with unsaved HSN changes.
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
