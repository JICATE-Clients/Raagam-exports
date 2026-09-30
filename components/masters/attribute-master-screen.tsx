"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { saveAttributeValues } from "@/lib/masters/extras-actions";
import { type Attribute } from "@/lib/masters/extras-types";
import { dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin: boolean; canExport?: boolean };
// An attribute value is just a NAME now — its numeric/option behaviour and value
// list are configured per-category in the Material Attribute screen (0346), not
// here. Type/Options columns were removed (client 2026-07-25).
/* `id` IS THE STORED ROW THIS ONE IS, null on a row the operator just added.
   It is carried so `saveAttributeValues` can recognise a value across a save and
   UPDATE it in place: matching on text alone makes a RENAME look like a delete
   plus an insert, and a deleted value nulls `material_attribute_lines.attribute_id`
   on every Material Attribute line pointing at it. See that action's header. */
type ValueRow = { key: string; id: string | null; value: string };

/**
 * THE VALUES ARE CHIPS (client 2026-09-29, option B of the Attribute editor
 * mock-ups: "B chips apply"). It was a one-column ChildGrid, ten boxes to a
 * page — a class with fourteen values needed Prev / Next to be seen whole, and
 * each value took a full row for a word like PLY. As chips every value is on
 * screen at once, wrapping inside one box.
 *
 * One box, three gestures: type in the end box and press Enter to add; click a
 * chip to rename it in place (Enter or leaving keeps it, Escape puts it back);
 * ✕ removes. A value typed but not yet Entered is still saved by Save, so
 * nothing half-typed is lost.
 *
 * 40rem (640px): seven or eight typical values to a line, and the footer's
 * buttons end where the box ends.
 */
const FORM_W = "max-w-[40rem]";

/**
 * Attribute master (doc/update.md #2-3) — the second half of the Item Class /
 * Attribute split. Lists every Item Class; for a class flagged Has Attribute =
 * Yes it shows the value-adding grid (e.g. GSM 180/200), for No it shows the
 * class with no value section. Item Class lifecycle (create / rename / block)
 * lives on the Item Class screen — here you only edit the per-class value list.
 *
 * required-hold: exempt -- `name` is mandatory in the shared `extras-types`
 * schema, but this screen never captures it: the class already exists, its name
 * is set on the Item Class screen, and the editor's own title reads it back
 * ("Attributes — {name}"). There is no field to declare `required` on and no
 * cursor to hold. The value is not `required` either: the end box is blank by
 * design between entries, and a blank one simply adds nothing.
 */
export function AttributeMasterScreen({ rows, perms }: { rows: Attribute[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editRow, setEditRow] = useState<Attribute | null>(null);
  const [values, setValues] = useState<ValueRow[]>([]);
  /** The end box — the value being typed, not yet a chip. */
  const [draft, setDraft] = useState("");
  /** The chip being renamed in place, and its text so far. */
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);
  const keySeq = useRef(0);
  const newKey = () => `v${keySeq.current++}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(
    rows,
    {
      searchKey: (r) => [r.code, r.name, ...r.values.map((v) => v.value)].filter(Boolean).join(" "),
      filters: {
        status: (r, v) => (v === "active" ? !!r.is_active : v === "inactive" ? !r.is_active : true),
        attr: (r, v) => (v === "yes" ? !!r.has_attribute : v === "no" ? !r.has_attribute : true),
      },
      initialFilters: { status: "", attr: "" },
    },
  );

  const pg = usePagination(filtered);

  function openEdit(r: Attribute) {
    setEditRow(r);
    setValues(r.values.map((v) => ({ key: newKey(), id: v.id, value: v.value })));
    setDraft("");
    setRenaming(null);
    setOpen(true);
  }

  const norm = (v: string) => v.trim().toUpperCase();
  /** Is `text` already a chip — other than the chip `exceptKey`? */
  const taken = (text: string, exceptKey?: string) =>
    !!norm(text) && values.some((v) => v.key !== exceptKey && norm(v.value) === norm(text));

  /*
   * dup-check: the duplicate here is a REPEATED VALUE IN THIS LIST, not a
   * repeated record. There is no name field and nothing to ask the server —
   * every candidate is already on screen as a chip — so it is answered in the
   * same render as the keystroke, and the marker comes from `dupFieldProps`, so
   * the cursor hold behaves as every other duplicate in the app. A chip that
   * would repeat is never created, which is why Save only has to check the two
   * boxes still being typed in.
   *
   * spell-suggest: exempt -- a class holds a handful of values and every one
   * is on screen as a chip directly above the box being typed into; a strip of
   * suggestion chips under a box of value chips would be two rows of look-alike
   * pills.
   */
  const draftDup = taken(draft) ? `"${norm(draft)}" is already in this list. Use a different value.` : null;
  const renameDup =
    renaming && taken(renaming.value, renaming.key)
      ? `"${norm(renaming.value)}" is already in this list. Use a different value.`
      : null;

  function addDraft() {
    if (!norm(draft) || draftDup) return;
    setValues((vs) => [...vs, { key: newKey(), id: null, value: norm(draft) }]);
    setDraft("");
  }
  function commitRename() {
    if (!renaming || renameDup) return;
    // Blank keeps the old value — ✕ is how a chip is removed, never an empty box.
    if (norm(renaming.value))
      setValues((vs) => vs.map((v) => (v.key === renaming.key ? { ...v, value: norm(renaming.value) } : v)));
    setRenaming(null);
  }
  function removeValue(key: string) {
    setValues((vs) => vs.filter((v) => v.key !== key));
    if (renaming?.key === key) setRenaming(null);
  }

  function onDraftKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addDraft();
    }
  }
  function onRenameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      // One layer: put the chip back, keep the sheet open.
      e.preventDefault();
      e.stopPropagation();
      setRenaming(null);
    }
  }

  // Unsaved work: a chip added, renamed or removed, or a value still typed.
  const dirty =
    open &&
    !!editRow &&
    (!!norm(draft) ||
      !!renaming ||
      values.length !== editRow.values.length ||
      values.some((v, i) => v.id !== editRow.values[i]?.id || v.value !== editRow.values[i]?.value));
  useUnsavedGuard(dirty || isPending);

  function submit() {
    if (!editRow) return;
    startTransition(async () => {
      // Names only, stored in CAPS (masters convention) — input_type/options
      // default server-side (unused by the flow).
      // The end box's text counts as a value even if Enter was never pressed.
      const all = norm(draft) && !draftDup ? [...values, { id: null, value: draft }] : values;
      const payload = all
        .filter((v) => norm(v.value))
        .map((v) => ({ id: v.id, value: norm(v.value) }));
      const res = await saveAttributeValues(editRow.id, payload);
      if (res.ok) {
        success("Attributes saved.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Attribute>[] = [
    { header: "Item Class", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    {
      header: "Has Attribute",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.has_attribute ? "Yes" : "No"}</span>,
    },
    {
      header: "Attributes",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">{r.values.length || "—"}</span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "danger"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    /*
     * Edit only — this screen has no delete (an attribute set belongs to its
     * class) and no separate view: the editor IS the only surface, and the
     * "Attributes" column above already says whether there is anything in it.
     * The old button relabelled itself "View" when the count was zero, which
     * read as a second, read-only destination it never was.
     */
    rowActionsColumn((r) => (
      <RowActions label={r.name} onEdit={() => openEdit(r)} canEdit={perms.canEdit} />
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
          searchPlaceholder="Search item class / attribute…"
          activeCount={activeCount}
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
          onReset={() => {
            reset();
            pg.setPage(1);
          }}
        >
          <div>
            <Label htmlFor="at-filter-status">Status</Label>
            <Select
              id="at-filter-status"
              value={filterValues.status}
              onChange={(e) => {
                setFilter("status", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="at-filter-attr">Has Attribute</Label>
            <Select
              id="at-filter-attr"
              value={filterValues.attr}
              onChange={(e) => {
                setFilter("attr", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="attributes" rows={filtered} canExport={perms.canExport} />
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, pg.paged)} rows={pg.paged}
        paginate={false} getKey={(r) => r.id} empty="No item classes yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No item classes yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Has Attribute: {r.has_attribute ? "Yes" : "No"}
                    {r.has_attribute && r.values.length > 0 ? ` · ${r.values.length} value${r.values.length === 1 ? "" : "s"}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
                </div>
                <StatusPill tone={r.is_active ? "success" : "danger"}>
                  {r.is_active ? "Active" : "Inactive"}
                </StatusPill>
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
        title={editRow ? `Attributes — ${editRow.name}` : "Attributes"}
        footer={
          /* `mr-auto` parks this box at the footer's left, so the buttons end
             where the grid ends. Same `FORM_W`. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              {editRow?.has_attribute ? "Cancel" : "Close"}
            </Button>
            {editRow?.has_attribute && (
              <Button size="md" disabled={isPending || !!draftDup || !!renameDup} onClick={submit}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        }
      >
        <div>
          {editRow && !editRow.has_attribute ? (
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-4 text-sm text-muted-foreground">
              Attributes are not enabled for{" "}
              <span className="font-medium text-foreground">{editRow.name}</span>. Turn on “Has
              Attribute” for this class on the Item Class screen to add values.
            </div>
          ) : (
            <div className={`space-y-2 ${FORM_W}`}>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Attributes</span>
                <span className="text-xs text-muted-foreground">
                  {values.length} value{values.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex flex-wrap items-start gap-2 rounded-lg border border-border bg-surface p-3">
                {values.map((v) =>
                  renaming?.key === v.key ? (
                    <div key={v.key} className="w-44">
                      <Input
                        autoFocus
                        uppercase
                        aria-label={`Rename ${v.value}`}
                        value={renaming.value}
                        onChange={(e) => setRenaming({ key: v.key, value: e.target.value })}
                        onKeyDown={onRenameKeyDown}
                        onBlur={commitRename}
                        className="h-8 rounded-full text-base md:text-sm"
                        {...dupFieldProps(renameDup, `attr-ren-${v.key}`)}
                      />
                      <DuplicateError error={renameDup} id={`attr-ren-${v.key}`} />
                    </div>
                  ) : (
                    <span
                      key={v.key}
                      className="inline-flex h-8 items-center gap-0.5 rounded-full border border-primary bg-primary-soft pl-3 pr-1 text-sm font-medium text-foreground"
                    >
                      <button
                        type="button"
                        title="Click to rename"
                        className="cursor-text"
                        onClick={() => setRenaming({ key: v.key, value: v.value })}
                      >
                        {v.value}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${v.value}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-danger-soft hover:text-danger"
                        onClick={() => removeValue(v.key)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ),
                )}
                <div className="min-w-[11rem] flex-1">
                  <Input
                    id="attr-new"
                    uppercase
                    aria-label="New attribute"
                    placeholder="Type and press Enter"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onDraftKeyDown}
                    className="h-8 rounded-full border-dashed text-base md:text-sm"
                    {...dupFieldProps(draftDup, "attr-new")}
                  />
                  <DuplicateError error={draftDup} id="attr-new" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter adds a value · click a chip to rename it · ✕ removes it
              </p>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
