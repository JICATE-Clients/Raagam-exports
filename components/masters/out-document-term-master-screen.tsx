"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { LookupDialogPicker } from "@/components/masters/lookup-picker";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import {
  createOutDocumentTerm,
  updateOutDocumentTerm,
  deleteOutDocumentTerm,
} from "@/lib/masters/out-document-term-actions";
import {
  OUT_DOC_TERM_TYPES,
  type OutDocTermType,
  type OutDocumentTerm,
  type OutDocumentTermInput,
} from "@/lib/masters/out-document-term-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin?: boolean; canExport?: boolean };
type ProcessOption = { id: string; name: string };
type LineRow = { key: string; description: string };

const todayISO = () => new Date().toISOString().slice(0, 10);
const blankForm = () => ({ entry_date: todayISO(), type: "" as "" | OutDocTermType, process_id: "", item_class_id: "" });

/**
 * Master-detail CRUD for the legacy "Out Document Term" master: a header (auto
 * Entry No · Date · Type · Process · Item Class) plus a Description line grid.
 */
export function OutDocumentTermMasterScreen({
  rows,
  processes,
  itemClasses,
  perms,
}: {
  rows: OutDocumentTerm[];
  processes: ProcessOption[];
  itemClasses: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [form, setForm] = useState(blankForm());
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const processLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of processes) m.set(p.id, p.name);
    return m;
  }, [processes]);
  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of itemClasses) m.set(c.id, c.name);
    return m;
  }, [itemClasses]);

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter<
    OutDocumentTerm,
    { type: string; process: string; itemClass: string }
  >(rows, {
    search: (r, q) =>
      [
        String(r.entry_no),
        r.type,
        r.process_id ? processLabel.get(r.process_id) : "",
        r.item_class_id ? classLabel.get(r.item_class_id) : "",
        ...r.lines.map((l) => l.description),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      type: (r, v) => r.type === v,
      process: (r, v) => r.process_id === v,
      itemClass: (r, v) => r.item_class_id === v,
    },
    initialFilters: { type: "", process: "", itemClass: "" },
  });

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setForm(blankForm());
    setLines([{ key: newKey(), description: "" }]);
    setOpen(true);
  }
  function openEdit(r: OutDocumentTerm) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setForm({
      entry_date: r.entry_date,
      type: r.type ?? "",
      process_id: r.process_id ?? "",
      item_class_id: r.item_class_id ?? "",
    });
    setLines(r.lines.map((l) => ({ key: newKey(), description: l.description })));
    setOpen(true);
  }

  function addLine() {
    setLines((ls) => [...ls, { key: newKey(), description: "" }]);
  }
  function setLineAt(key: string, description: string) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, description } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: OutDocumentTermInput = {
        entry_date: form.entry_date,
        type: form.type ? form.type : null,
        process_id: form.process_id || null,
        item_class_id: form.item_class_id || null,
        lines: lines
          .filter((l) => l.description.trim())
          .map((l, i) => ({ sno: i + 1, description: l.description.trim() })),
      };
      const res = editId
        ? await updateOutDocumentTerm(editId, payload)
        : await createOutDocumentTerm(payload);
      if (res.ok) {
        success(editId ? "Out Document Term updated." : "Out Document Term added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: OutDocumentTerm) {
    startTransition(async () => {
      const res = await deleteOutDocumentTerm(r.id);
      if (res.ok) {
        success("Out Document Term deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<OutDocumentTerm>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{r.entry_date}</span> },
    { header: "Type", cell: (r) => <span className="text-sm">{r.type ?? "—"}</span> },
    {
      header: "Process",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.process_id ? processLabel.get(r.process_id) ?? "—" : "—"}
        </span>
      ),
    },
    {
      header: "Item Class",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.item_class_id ? classLabel.get(r.item_class_id) ?? "—" : "—"}
        </span>
      ),
    },
    {
      header: "Lines",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm text-muted-foreground">{r.lines.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder="Search out document term…"
          activeCount={activeCount}
          onReset={reset}
        >
          <Select
            value={filterValues.type ?? ""}
            onChange={(e) => {
              setFilter("type", e.target.value);
              pg.setPage(1);
            }}
            aria-label="Filter type"
            className="h-9 text-base md:text-sm"
          >
            <option value="">All types</option>
            {OUT_DOC_TERM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            value={filterValues.process ?? ""}
            onChange={(e) => {
              setFilter("process", e.target.value);
              pg.setPage(1);
            }}
            aria-label="Filter process"
            className="h-9 text-base md:text-sm"
          >
            <option value="">All processes</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            value={filterValues.itemClass ?? ""}
            onChange={(e) => {
              setFilter("itemClass", e.target.value);
              pg.setPage(1);
            }}
            aria-label="Filter item class"
            className="h-9 text-base md:text-sm"
          >
            <option value="">All item classes</option>
            {itemClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="out-document-terms" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Out Document Term
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No out document terms yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No out document terms yet.
          </div>
        ) : (
          pg.paged.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground">
                    Entry #{r.entry_no} · {r.type ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.entry_date}
                    {r.process_id ? ` · ${processLabel.get(r.process_id) ?? ""}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {r.lines.length} line{r.lines.length === 1 ? "" : "s"}
                </span>
              </div>
            </button>
          ))
        )}
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit Out Document Term #${editEntryNo}` : "New Out Document Term"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.entry_date} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="odt-entry">Entry No</Label>
              <Input
                id="odt-entry"
                value={editEntryNo ?? "(auto)"}
                disabled
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="odt-date">Date</Label>
              <Input
                id="odt-date"
                type="date"
                value={form.entry_date}
                onChange={(e) => set({ entry_date: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="odt-type">Type</Label>
            <Select
              id="odt-type"
              value={form.type}
              onChange={(e) => set({ type: e.target.value as "" | OutDocTermType })}
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {OUT_DOC_TERM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="odt-process">Process</Label>
            <Select
              id="odt-process"
              value={form.process_id}
              onChange={(e) => set({ process_id: e.target.value })}
              className="text-base md:text-sm"
            >
              <option value="">— None —</option>
              {processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <LookupDialogPicker
            kind="item_class"
            label="Item Class"
            options={itemClasses}
            value={form.item_class_id}
            onChange={(v) => set({ item_class_id: v })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
            isSuperAdmin={perms.isSuperAdmin}
          />

          {/* Description grid */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
              Description
            </div>
            <div className="space-y-2 p-3">
              {lines.length === 0 && <p className="text-xs text-muted-foreground">No lines yet.</p>}
              {lines.map((l, i) => (
                <div key={l.key} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <Input
                    value={l.description}
                    onChange={(e) => setLineAt(l.key, e.target.value)}
                    placeholder="Description"
                    className="flex-1 text-base md:text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => removeLine(l.key)}
                    aria-label="Remove line"
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                + Add line
              </Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
