"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import {
  createCountGroup,
  updateCountGroup,
  deleteCountGroup,
} from "@/lib/masters/grid-master-actions";
import type { CountGroup, CountGroupInput } from "@/lib/masters/grid-master-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

type LineRow = { key: string; count_lookup_id: string | null };
const blankLine = (key: string): LineRow => ({ key, count_lookup_id: null });

type LookupOption = { id: string; code: string; name: string };

export function CountGroupMasterScreen({ rows, counts, perms }: { rows: CountGroup[]; counts: LookupOption[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", inactive: false });
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) => [r.code, r.name].join(" ").toLowerCase().includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !!r.is_active : v === "inactive" ? !r.is_active : true),
      },
      initialFilters: { status: "" },
    },
  );
  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm({ code: "", name: "", inactive: false });
    setLines([blankLine(newKey())]);
    setOpen(true);
  }
  function openEdit(r: CountGroup) {
    setEditId(r.id);
    setForm({ code: r.code, name: r.name, inactive: !r.is_active });
    setLines(r.details.slice().sort((a, b) => a.sno - b.sno).map((d) => ({ key: newKey(), count_lookup_id: d.count_lookup_id })));
    setOpen(true);
  }

  function addLine() { setLines((ls) => [...ls, blankLine(newKey())]); }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) { setLines((ls) => ls.filter((l) => l.key !== key)); }

  function submit() {
    startTransition(async () => {
      const payload: CountGroupInput = {
        code: form.code.trim(),
        name: form.name.trim() || form.code.trim(),
        is_active: !form.inactive,
        category_id: null,
        details: lines.map((l, i) => ({ sno: i + 1, count_lookup_id: l.count_lookup_id })),
      };
      const res = editId ? await updateCountGroup(editId, payload) : await createCountGroup(payload);
      if (res.ok) {
        success(editId ? "Count group updated." : "Count group added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: CountGroup) {
    startTransition(async () => {
      const res = await deleteCountGroup(r.id);
      if (res.ok) {
        success(res.inactive ? "Count group marked inactive." : "Count group deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<CountGroup>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Counts", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.details.length}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "danger"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>}
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => { setQuery(v); pg.setPage(1); }}
          searchPlaceholder="Search count group..."
          activeCount={activeCount}
          onReset={() => { reset(); pg.setPage(1); }}
        >
          <div>
            <Label htmlFor="cg-filter-status">Status</Label>
            <Select id="cg-filter-status" value={filterValues.status}
              onChange={(e) => { setFilter("status", e.target.value); pg.setPage(1); }}
              className="text-base md:text-sm">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="count-groups" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && <Button size="md" onClick={openAdd}>+ Add Count Group</Button>}
        </div>
      </div>

      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No count group records yet." />
      </div>
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">No count group records yet.</div>
        ) : pg.paged.map((r) => (
          <button key={r.id} type="button" onClick={() => perms.canEdit && openEdit(r)}
            className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.code} · {r.details.length} count{r.details.length === 1 ? "" : "s"}</div>
              </div>
              <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
            </div>
          </button>
        ))}
      </div>

      <PaginationBar page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />

      <Sheet open={open} onClose={() => setOpen(false)}
        title={editId ? "Edit Count Group" : "New Count Group"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !form.code.trim() || lines.length === 0} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="cg-code">Code <span className="text-danger">*</span></Label>
            <Input id="cg-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="text-base md:text-sm" />
          </div>
          <div>
            <Label htmlFor="cg-name">Name</Label>
            <Input id="cg-name" value={form.name} placeholder={form.code || undefined} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-base md:text-sm" />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.inactive} onChange={(e) => setForm({ ...form, inactive: e.target.checked })} />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
          {/* Counts grid */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">Counts</div>
            <div className="space-y-2 p-3">
              {lines.map((l, i) => (
                <div key={l.key} className="flex items-center gap-2">
                  <span className="w-6 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <Select value={l.count_lookup_id ?? ""}
                    onChange={(e) => setLineAt(l.key, { count_lookup_id: e.target.value || null })}
                    className="flex-1 text-base md:text-sm">
                    <option value="">— select count —</option>
                    {counts.map((c) => (
                      <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                    ))}
                  </Select>
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
                    onClick={() => removeLine(l.key)} aria-label="Remove">✕</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Add Count</Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
