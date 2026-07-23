"use client";

import { useRef, useState, useTransition } from "react";
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
  createProcessSequenceGroup,
  updateProcessSequenceGroup,
  deleteProcessSequenceGroup,
} from "@/lib/masters/grid-master-actions";
import type { ProcessSequenceGroup, ProcessSequenceGroupInput } from "@/lib/masters/grid-master-types";
import type { ProcessSequence } from "@/lib/masters/grid-master-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

type LineRow = { key: string; sequence_id: string; sequence_name: string };
const blankLine = (key: string): LineRow => ({ key, sequence_id: "", sequence_name: "" });

export function ProcessSequenceGroupMasterScreen({
  rows,
  sequences,
  perms,
}: {
  rows: ProcessSequenceGroup[];
  sequences: ProcessSequence[];
  perms: Perms;
}) {
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
  function openEdit(r: ProcessSequenceGroup) {
    setEditId(r.id);
    setForm({ code: r.code, name: r.name, inactive: !r.is_active });
    setLines(r.details.slice().sort((a, b) => a.sno - b.sno).map((d) => ({
      key: newKey(),
      sequence_id: d.sequence_id ?? "",
      sequence_name: sequences.find((s) => s.id === d.sequence_id)?.name ?? "",
    })));
    setOpen(true);
  }

  function addLine() { setLines((ls) => [...ls, blankLine(newKey())]); }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) { setLines((ls) => ls.filter((l) => l.key !== key)); }

  function pickSequence(key: string, seqId: string) {
    const seq = sequences.find((s) => s.id === seqId);
    setLineAt(key, { sequence_id: seqId, sequence_name: seq?.name ?? "" });
  }

  function submit() {
    startTransition(async () => {
      const payload: ProcessSequenceGroupInput = {
        code: form.code.trim(),
        name: form.name.trim(),
        is_active: !form.inactive,
        details: lines.map((l, i) => ({
          sno: i + 1,
          sequence_id: l.sequence_id || null,
        })),
      };
      const res = editId ? await updateProcessSequenceGroup(editId, payload) : await createProcessSequenceGroup(payload);
      if (res.ok) {
        success(editId ? "Process sequence group updated." : "Process sequence group added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: ProcessSequenceGroup) {
    startTransition(async () => {
      const res = await deleteProcessSequenceGroup(r.id);
      if (res.ok) {
        success(res.inactive ? "Process sequence group marked inactive." : "Process sequence group deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<ProcessSequenceGroup>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Sequences", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.details.length}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
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
          searchPlaceholder="Search process sequence group..."
          activeCount={activeCount}
          onReset={() => { reset(); pg.setPage(1); }}
        >
          <div>
            <Label htmlFor="psg-filter-status">Status</Label>
            <Select id="psg-filter-status" value={filterValues.status}
              onChange={(e) => { setFilter("status", e.target.value); pg.setPage(1); }}
              className="text-base md:text-sm">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="process-sequence-groups" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && <Button size="md" onClick={openAdd}>+ Add Group</Button>}
        </div>
      </div>

      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No process sequence group records yet." />
      </div>
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">No process sequence group records yet.</div>
        ) : pg.paged.map((r) => (
          <button key={r.id} type="button" onClick={() => perms.canEdit && openEdit(r)}
            className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.code} · {r.details.length} sequence{r.details.length === 1 ? "" : "s"}</div>
              </div>
              <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
            </div>
          </button>
        ))}
      </div>

      <PaginationBar page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />

      <Sheet open={open} onClose={() => setOpen(false)}
        title={editId ? "Edit Process Sequence Group" : "New Process Sequence Group"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !form.name.trim() || lines.length === 0} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="psg-name">Name <span className="text-danger">*</span></Label>
            <Input id="psg-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-base md:text-sm" />
            {!editId && (
              <p className="mt-1 text-xs text-muted-foreground">
                The code is generated automatically from the name.
              </p>
            )}
          </div>
          {editId && (
            <label className="sm:col-span-2 flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={form.inactive} onChange={(e) => setForm({ ...form, inactive: e.target.checked })} />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}

          <div className="sm:col-span-2 rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">Sequences</div>
            <div className="space-y-2 p-3">
              {lines.map((l, i) => (
                <div key={l.key} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                  {sequences.length > 0 ? (
                    <Select value={l.sequence_id}
                      onChange={(e) => pickSequence(l.key, e.target.value)}
                      className="flex-1 text-base md:text-sm">
                      <option value="">— select sequence —</option>
                      {sequences.map((s) => (
                        <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input placeholder="Sequence name" value={l.sequence_name}
                      onChange={(e) => setLineAt(l.key, { sequence_name: e.target.value })}
                      className="flex-1 text-base md:text-sm" />
                  )}
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
                    onClick={() => removeLine(l.key)} aria-label="Remove">✕</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Add Sequence</Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
