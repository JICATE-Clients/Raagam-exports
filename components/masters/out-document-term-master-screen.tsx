"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { Sheet } from "@/components/ui/sheet";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { ProcessPicker } from "@/components/masters/process-picker";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
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
import type { Process } from "@/lib/masters/process-types";
import { DetailSection } from "@/components/masters/detail-section";
import { ChildGrid } from "@/components/masters/child-grid";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { fmtDate } from "@/lib/format";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin?: boolean; canExport?: boolean };
type LineRow = { key: string; description: string };

/**
 * WIDTHS, NOT TWELFTHS (erp-form-compact):
 *
 *   entry 72 + date 144 + type 112 + process 200 + item class 200
 *   + 4 × 12 gaps = 776
 */
const FIELD_W = {
  entry: "num", //         72px — "(auto)" or a 1-4 digit number
  date: "code", //        144px — a native date control needs ~130px
  type: "range", //       112px — Purchase · Process
  process: "party", //    200px — picker trigger; a process name
  item_class: "party", // 200px — "PACKING ACCESSORIES" is the longest class
} satisfies Record<string, FieldWidth>;

/**
 * The header card, the Description grid AND the footer's buttons, from ONE string:
 *
 *   776 row + 2 × 8 card padding (compact) + 2 × 1 border = 794
 *
 * 51rem (816px) leaves room for the non-compact `p-2.5` density (+4px), so the
 * row does not fold at one density and not the other.
 */
const FORM_W = "max-w-[51rem]";

const todayISO = () => new Date().toISOString().slice(0, 10);
const blankForm = () => ({ entry_date: todayISO(), type: "" as "" | OutDocTermType, process_id: "", item_class_id: "" });

/**
 * Master-detail CRUD for the legacy "Out Document Term" master: a header (auto
 * Entry No · Date · Type · Process · Item Class) plus a Description line grid.
 */
// dup-check: exempt -- auto-numbered entry document (Entry No · Date · Type ·
// Process · Item Class). Its identity is the header combination, not a typed
// name, and the Description lines below it are free text that repeats across
// terms by design.
export function OutDocumentTermMasterScreen({
  rows,
  processes,
  itemClasses,
  perms,
}: {
  rows: OutDocumentTerm[];
  /** Full Process rows — `ProcessPicker` shows the short description beside the
   *  name, which is what tells two similar processes apart. */
  processes: Process[];
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

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter<
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

  const pg = usePagination(filtered);

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
    { header: "Date", cell: (r) => <span className="text-sm">{fmtDate(r.entry_date)}</span> },
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
    rowActionsColumn((r) => (
      <RowActions
        label={String(r.entry_no)}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
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
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
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
        <DataTable columns={withCreatedColumns(columns, pg.paged)} rows={pg.paged}
        paginate={false} getKey={(r) => r.id} empty="No out document terms yet." />
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
                    {fmtDate(r.entry_date)}
                    {r.process_id ? ` · ${processLabel.get(r.process_id) ?? ""}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
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
          /* `mr-auto` parks this box at the footer's left, so the buttons end
             where the header card and the grid end. Same `FORM_W`. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.entry_date} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        {/* STACKED AT CONTENT WIDTH (erp-form-compact). This was two columns —
            the header fields in the left half at `cols={2}` (~270px each, so
            Entry No and a Purchase/Process select got a name's width) and the
            Description grid in the right half. Now the header is one
            shrink-wrapped row and the grid sits under it, capped to the same
            FORM_W, so both end on one edge and the Save buttons end there too. */}
        <div className="space-y-4">
          <DetailSection label="Header" cols={1} className={FORM_W}>
            <FieldRow>
              <Field label="Entry No" w={FIELD_W.entry} htmlFor="odt-entry">
                <Input id="odt-entry" value={editEntryNo ?? "(auto)"} disabled />
              </Field>
              {/* `.min(1)` in `outDocumentTermInput`. */}
              <Field label="Date" w={FIELD_W.date} required htmlFor="odt-date">
                <Input
                  id="odt-date"
                  type="date"
                  required
                  value={form.entry_date}
                  onChange={(e) => set({ entry_date: e.target.value })}
                />
              </Field>
              <Field label="Type" w={FIELD_W.type} htmlFor="odt-type">
                <Select
                  id="odt-type"
                  value={form.type}
                  onChange={(e) => set({ type: e.target.value as "" | OutDocTermType })}
                >
                  <option value=""></option>
                  {OUT_DOC_TERM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* Select-only: a Process carries a billing basis, an HSN code and
                  five item-class flags, so it is created on its own master.
                  The picker renders its own label; the Field only sizes it. */}
              <Field w={FIELD_W.process}>
                <ProcessPicker
                  label="Process"
                  processes={processes}
                  value={form.process_id}
                  onChange={(v) => set({ process_id: v })}
                />
              </Field>
              {/* The picker owns the label, the "— Select —" row and the
                  inactive-value rule, so none of that is repeated here. */}
              <Field w={FIELD_W.item_class}>
                <LookupDialogPicker
                  kind="item_class"
                  label="Item Class"
                  options={itemClasses}
                  value={form.item_class_id || null}
                  onChange={(v) => set({ item_class_id: v })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                  isSuperAdmin={perms.isSuperAdmin}
                />
              </Field>
            </FieldRow>
          </DetailSection>

          {/* Description grid — capped to the header's width (rule 4: a
              sub-grid is as wide as the FORM, not the screen). A term line is a
              sentence, so it takes the whole of that width rather than a step. */}
          <div className={FORM_W}>
          <ChildGrid<LineRow>
            lockExisting
            label="Description"
            pageSize={10}
            forceCards
            flatRows
            rows={lines}
            onAdd={addLine}
            onRemove={(l) => removeLine(l.key)}
            addLabel="+ Add line"
            columns={[
              {
                header: "Description",
                cell: (l) => (
                  <Input uppercase value={l.description} onChange={(e) => setLineAt(l.key, e.target.value)} />
                ),
              },
            ]}
          />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
