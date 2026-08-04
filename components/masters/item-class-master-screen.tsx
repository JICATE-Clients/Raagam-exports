"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { createdSection, withCreatedColumns } from "@/components/ui/created-columns";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { createItemClass, updateItemClass, deleteItemClass } from "@/lib/masters/extras-actions";
import type { Attribute } from "@/lib/masters/extras-types";
import { FilterBar } from "@/components/ui/filter-bar";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { Select } from "@/components/ui/select";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { DetailSection } from "@/components/masters/detail-section";
import { MobileCardList } from "@/components/masters/mobile-card-list";
import { RecordViewSheet } from "@/components/masters/record-view-sheet";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { ITEM_CLASS_NAMES } from "@/lib/masters/name-vocabularies";
import { fmtDateTime } from "@/lib/format";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = { code: "", name: "", type_code: "", has_attribute: false, inactive: false };

/**
 * Item Class master (doc/update.md #1-3) — the simple half of the Item Class /
 * Attribute split. Fields: Name + Has Attribute (Yes/No). Backed by
 * config_lookups kind 'item_class'. The per-class value list is EDITED on the
 * Attribute screen (only when Has Attribute = Yes) but is READ here, in the
 * view sheet — "Has Attribute: Yes" is not an answer to "which attributes?",
 * and that question shouldn't require opening a second screen's editor. The
 * rows arrive with `values` already attached (one join, same table), so the
 * view fetches nothing.
 * The Inactive toggle appears only when editing (blocking after create, #8).
 */
export function ItemClassMasterScreen({ rows, perms }: { rows: Attribute[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [viewRow, setViewRow] = useState<Attribute | null>(null);

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(
    rows,
    {
      searchKey: (r) => [r.code, r.name].filter(Boolean).join(" "),
      filters: {
        status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
        attr: (r, v) => (v === "yes" ? !!r.has_attribute : v === "no" ? !r.has_attribute : true),
      },
      initialFilters: { status: "", attr: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  const dupError = useDuplicateName({
    table: "config_lookups",
    name: form.name,
    scope: { kind: "item_class" },
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    // No `rowInScope`: this screen only ever holds `kind: "item_class"` rows,
    // so every row on it is already inside the scope above.
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean SEWING ACCESSORIES?" — `dupError` above only fires on an EXACT
   * collision, so SEWING ACCESSORY sails past it and becomes an eighth class
   * meaning the same as one of the seven. Every downstream master scopes itself
   * by item class (categories, HSN details, material attributes),
   * so a split here fragments all of them at once.
   *
   * Seeded, unlike most masters: the seven classes are a CLOSED set the
   * application itself reasons about (`itemClassForm()` in material-types.ts
   * switches on them), and the table is small enough that a misspelling would
   * otherwise sit unnoticed forever. The seed is named here and imported
   * nowhere else — see the header of name-vocabularies.ts for why that matters.
   *
   * Suppressed while `dupError` shows: one line under the input, and the red
   * error is the more urgent of the two.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name,
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name),
    seed: ITEM_CLASS_NAMES,
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: Attribute) {
    setEditId(r.id);
    setForm({
      code: r.code ?? "",
      name: r.name,
      type_code: r.type_code ?? "",
      has_attribute: !!r.has_attribute,
      inactive: !r.is_active,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const name = form.name.trim();
      const payload = {
        code: form.code.trim() || name || null, // preserve legacy code; new → derive from name
        name,
        type_code: form.type_code.trim() || null,
        has_attribute: form.has_attribute,
        is_active: !form.inactive,
      };
      const res = editId ? await updateItemClass(editId, payload) : await createItemClass(payload);
      if (res.ok) {
        success(editId ? "Item Class updated." : "Item Class added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Attribute) {
    startTransition(async () => {
      const res = await deleteItemClass(r.id);
      if (res.ok) {
        success(
          res.inactive
            ? "Item Class is in use — deactivated instead of deleted (history kept)."
            : "Item Class deleted.",
        );
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Attribute>[] = [
    { header: "Name", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    {
      header: "Has Attribute",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.has_attribute ? "Yes" : "No"}</span>
      ),
    },
    {
      header: "Attributes",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {(r.values ?? []).length || "—"}
        </span>
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
    rowActionsColumn((r) => (
      <RowActions
        label={r.name}
        onView={() => setViewRow(r)}
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
          searchPlaceholder="Search item class…"
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
            <Label htmlFor="ic-filter-status">Status</Label>
            <Select
              id="ic-filter-status"
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
            <Label htmlFor="ic-filter-attr">Has Attribute</Label>
            <Select
              id="ic-filter-attr"
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
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Item Class
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, rows)} rows={pg.paged} getKey={(r) => r.id} empty="No item classes yet." />
      </div>

      {/* mobile cards — the shared list, so the phone gets the same eye icon the
          table has (tapping the card body is edit, which is no way to just look). */}
      <div className="md:hidden">
        <MobileCardList
          rows={pg.paged}
          getKey={(r) => r.id}
          title={(r) => r.name}
          meta={(r) =>
            `Has Attribute: ${r.has_attribute ? "Yes" : "No"}${
              (r.values ?? []).length ? ` · ${(r.values ?? []).length} attributes` : ""
            }`
          }
          pill={(r) => (
            <StatusPill tone={r.is_active ? "success" : "danger"}>
              {r.is_active ? "Active" : "Inactive"}
            </StatusPill>
          )}
          onEdit={perms.canEdit ? openEdit : undefined}
          onView={(r) => setViewRow(r)}
          canDelete={perms.canDelete}
          onDelete={remove}
          isPending={isPending}
          empty="No item classes yet."
        />
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
        title={editId ? "Edit Item Class" : "New Item Class"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details" cols={2}>
            <div>
              <Label htmlFor="ic-name">
                Item Class Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="ic-name"
                uppercase
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                onKeyDown={nameSuggest.onKeyDown}
                required
                className="text-base md:text-sm"
                {...dupFieldProps(dupError, "ic-name")}
              />
              <DuplicateError error={dupError} id="ic-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupError}
                onApply={(v) => setForm((f) => ({ ...f, name: v }))}
              />
            </div>
            <label className="flex h-9 cursor-pointer items-center gap-2 self-end">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.has_attribute}
                onChange={(e) => setForm({ ...form, has_attribute: e.target.checked })}
              />
              <span className="text-sm text-foreground">Has Attribute</span>
            </label>
          </DetailSection>
          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}
        </div>
      </Sheet>

      {/* read-only view — renders straight off the list row, nothing fetched */}
      {viewRow && (
        <RecordViewSheet
          open
          onClose={() => setViewRow(null)}
          title={viewRow.name}
          status={
            <StatusPill tone={viewRow.is_active ? "success" : "danger"}>
              {viewRow.is_active ? "Active" : "Inactive"}
            </StatusPill>
          }
          sections={[
            {
              label: "Details",
              pairs: [
                ["Has Attribute", viewRow.has_attribute ? "Yes" : "No"],
                ["Attributes", (viewRow.values ?? []).length],
                ["Notes", viewRow.notes],
                // Created Date / Created User come from `createdSection` below,
                // so they read the same here as in the table.
                ["Last Updated", fmtDateTime(viewRow.updated_at)],
              ],
            },
            {
              // `content`, not `pairs`: an attribute is a name plus how it is
              // answered (a list of options, or a number), which is two lines,
              // not a label→value row. Never auto-hidden — "none defined yet" on
              // a class flagged Has Attribute is the whole point of looking.
              label: "Attributes",
              content: !viewRow.has_attribute ? (
                <p className="text-sm text-muted-foreground">
                  This class does not use attributes.
                </p>
              ) : (viewRow.values ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No attributes defined yet — add them on Materials ▸ Attribute.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {(viewRow.values ?? []).map((v) => (
                    <li key={v.id} className="text-sm">
                      <span className="font-medium text-foreground">{v.value}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {v.input_type === "option_list"
                          ? (v.options ?? []).length > 0
                            ? (v.options ?? []).map((o) => o.value).join(", ")
                            : "Option list — no options yet"
                          : "Numeric range"}
                      </span>
                    </li>
                  ))}
                </ul>
              ),
            },
            ...createdSection(viewRow),
          ]}
        />
      )}
    </div>
  );
}
