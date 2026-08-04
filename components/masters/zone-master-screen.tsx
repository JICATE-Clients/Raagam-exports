"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/ui/field";
import { SectionGrid, SectionColumn } from "@/components/masters/section-grid";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { DetailSection } from "@/components/masters/detail-section";
import {
  createZone,
  updateZone,
  deactivateZone,
} from "@/lib/masters/zone-actions";
import type { Zone, ZoneInput } from "@/lib/masters/zone-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { ZONE_NAMES } from "@/lib/masters/name-vocabularies";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };
type ChildRow = { key: string; area_name: string };

const BLANK = {
  zone_short_name: "",
  zone_name: "",
  inactive: false,
};

export function ZoneMasterScreen({
  rows,
  perms,
}: {
  rows: Zone[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [childRows, setChildRows] = useState<ChildRow[]>([]);
  const keyRef = useRef(0);
  const nextKey = () => `zn-${++keyRef.current}`;

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(
    rows,
    {
      searchKey: (r) => [r.zone_short_name, r.zone_name].filter(Boolean).join(" "),
      filters: {
        status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
      },
      initialFilters: { status: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  // Real-time duplicate check on the zone name (mirrors the on-save guard).
  const dupError = useDuplicateName({
    table: "zones",
    name: form.zone_name,
    nameColumn: "zone_name",
    excludeId: editId ?? undefined,
    enabled: !!form.zone_name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.zone_name,
  });

  /**
   * "Did you mean?" — dupError above only fires on an EXACT collision, so a
   * one-character miss sails past it and becomes a second row meaning the same
   * thing as the first. Advisory only: the typed text saves as typed unless the
   * operator accepts a chip. Suppressed while the red error shows — one line
   * under the input, and the name it collided with is the one that is no use.
   */
  const nameSuggest = useSpellSuggest({
    name: form.zone_name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.zone_name ?? "").filter(Boolean),
    seed: ZONE_NAMES,
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, zone_name: v })),
  });

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setChildRows([]);
    setOpen(true);
  }
  function openEdit(r: Zone) {
    setEditId(r.id);
    setForm({
      zone_short_name: r.zone_short_name ?? "",
      zone_name: r.zone_name,
      inactive: r.inactive,
    });
    setChildRows(
      (r.areas ?? []).map((a) => ({
        key: nextKey(),
        area_name: a.area_name ?? "",
      })),
    );
    setOpen(true);
  }

  function addChildRow() {
    setChildRows((rs) => [...rs, { key: nextKey(), area_name: "" }]);
  }
  function updateChild(key: string, value: string) {
    setChildRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, area_name: value } : r)),
    );
  }
  function removeChildRow(key: string) {
    setChildRows((rs) => rs.filter((r) => r.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: ZoneInput = {
        // New records derive the short name from the display name; edits keep
        // the record's original stored short name (it can be a logic key).
        zone_short_name: (editId ? form.zone_short_name.trim() : form.zone_name.trim()) || null,
        zone_name: form.zone_name.trim(),
        inactive: form.inactive,
      };
      const children = childRows
        .filter((c) => c.area_name.trim())
        .map((c) => ({ area_name: c.area_name.trim() }));
      const res = editId
        ? await updateZone(editId, payload, children)
        : await createZone(payload, children);
      if (res.ok) {
        success(editId ? "Zone updated." : "Zone added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function deactivate(r: Zone) {
    startTransition(async () => {
      const res = await deactivateZone(r.id);
      if (res.ok) {
        success("Zone marked inactive.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Zone>[] = [
    { header: "Zone Name", cell: (r) => <span className="text-sm">{r.zone_name}</span> },
    {
      header: "Areas",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.areas?.length || "---"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>
          {r.inactive ? "Inactive" : "Active"}
        </StatusPill>
      ),
    },
    /* This master never hard-deletes — the row is deactivated, so the verb
       stays "Deactivate" rather than promising something else. Already-inactive
       rows have nothing left to do. */
    rowActionsColumn((r) => (
      <RowActions
        label={r.zone_name}
        onEdit={() => openEdit(r)}
        onDelete={() => deactivate(r)}
        deleteLabel="Deactivate"
        canEdit={perms.canEdit}
        canDelete={perms.canDelete && !r.inactive}
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
          searchPlaceholder="Search zone..."
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
            <Label htmlFor="zn-filter-status">Status</Label>
            <Select
              id="zn-filter-status"
              value={filterValues.status}
              onChange={(e) => {
                setFilter("status", e.target.value);
                pg.setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="zones" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Zone
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable
          columns={withCreatedColumns(columns, pg.paged)}
          rows={pg.paged}
          getKey={(r) => r.id}
          empty="No zone records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No zone records yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">
                    {r.zone_name}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
              {(r.areas?.length ?? 0) > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.areas!.length} area{r.areas!.length === 1 ? "" : "s"}
                </div>
              )}
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
        title={editId ? "Edit Zone" : "New Zone"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.zone_name.trim() || !!dupError}
              onClick={submit}
            >
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        {/* Fields LEFT, Areas grid RIGHT. The split is meaningful (identity vs
            its line items), so these are SectionColumns, not auto-placed
            sections — see LAYOUT.md §1. */}
        <SectionGrid>
          <SectionColumn>
            {/* TWO fields, in a section that is half a sheet wide (~560px, so
                one column is ~34px). Four per row is not a goal a two-field
                form can carry, and forcing both to `sm` would only make a short
                form look cramped — the name would get 126px. So: name 6 +
                inactive 3 = 9 on one row, each sized to its data, and the
                density on this screen comes from the Areas grid beside it
                (client 2026-07-29). */}
            <DetailSection label="Details" cols={12}>
              <Field label="Zone Name" size="lg" required htmlFor="zn-name">
                <Input
                  id="zn-name"
                  uppercase
                  value={form.zone_name}
                  onChange={(e) => setForm({ ...form, zone_name: e.target.value })}
                  required
                  // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                  onKeyDown={nameSuggest.onKeyDown}
                  {...dupFieldProps(dupError, "zn-name")}
                />
                <DuplicateError error={dupError} id="zn-name" />
                <SpellSuggestHint
                  suggestions={nameSuggest.suggestions}
                  existing={nameSuggest.existing}
                  activeIndex={nameSuggest.activeIndex}
                  duplicate={!!dupError}
                  onApply={(v) => setForm((f) => ({ ...f, zone_name: v }))}
                />
              </Field>
              {editId && (
                <Field size="sm">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-primary"
                      checked={form.inactive}
                      onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
                    />
                    <span className="text-sm text-foreground">Inactive</span>
                  </label>
                </Field>
              )}
            </DetailSection>
          </SectionColumn>
          <SectionColumn>
            {/* Was a hand-rolled row list: its own header band, its own `#`
                column, its own remove button and a `max-h-56` inner scroller —
                i.e. ChildGrid, reimplemented and 3px out of step with it. One
                field per row, so `inlineCards`; `pageSize` replaces the
                scroll-in-a-box (client 2026-07-25). Keyboard nav comes with the
                component, so the local gridKeyNav wiring goes too. */}
            <ChildGrid<{ key: string; area_name: string }>
              label="Areas"
              rows={childRows}
              onAdd={addChildRow}
              onRemove={(row) => removeChildRow(row.key)}
              addLabel="+ Add area"
              inlineCards
              pageSize={8}
              columns={[
                {
                  header: "Area",
                  cell: (row) => (
                    <Input
                      uppercase
                      value={row.area_name}
                      onChange={(e) => updateChild(row.key, e.target.value)}
                      placeholder="Area name"
                    />
                  ),
                },
              ]}
            />
          </SectionColumn>
        </SectionGrid>
      </Sheet>
    </div>
  );
}
