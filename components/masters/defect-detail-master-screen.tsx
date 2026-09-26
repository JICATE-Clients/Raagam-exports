"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { DetailSection } from "@/components/masters/detail-section";
import { DefectGroupPicker } from "@/components/masters/defect-group-picker";
import {
  createDefectDetail,
  updateDefectDetail,
  deleteDefectDetail,
} from "@/lib/masters/defect-detail-actions";
import type { DefectDetail, DefectGroup, DefectDetailInput } from "@/lib/masters/defect-detail-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const BLANK = {
  defect_catg_id: "",
  defect_id: "",
  defect_det_id: "",
  name: "",
  defect_group_id: "",
  defect_type: "",
  is_active: true,
};

/**
 * WIDTHS, NOT TWELFTHS (erp-form-compact). The editor was `cols={3}` then
 * `cols={2}` on a `size="lg"` sheet, so a two-character Category ID got ~370px
 * and the Name ~560px, with the surplus reading as holes.
 *
 *   Code Components — catg 88 + id 88 + det 88 + generated 144, 3 × 12 gaps = 444
 *   Details         — name 200 + group 176 + type 144,        2 × 12 gaps = 544
 *
 * The three ID parts are short codes (min 2, typed as "01" / "ST") whose
 * two-word LABELS are wider than their values, so they take `hug` — the label
 * floor — rather than `num`, under which "Category ID" would wrap.
 * `name` is a defect phrase ("BROKEN STITCH"), free text: `party` rather than
 * the full `name` step, so the Details row stays one line inside the form cap.
 */
const FIELD_W = {
  catg: "hug", //        88px
  id: "hug", //          88px
  det: "hug", //         88px
  generated: "code", // 144px — "AB.CD.EF", read-only
  name: "party", //     200px — free text; scrolls past ~20 capitals
  group: "term", //     176px — picker trigger + its manage icon
  type: "code", //      144px
} satisfies Record<string, FieldWidth>;

/**
 * THE CARD AND THE FOOTER'S BUTTONS, FROM ONE STRING. The widest row is Details:
 *
 *   544 content + 2 × 8 card padding (compact) + 2 × 1 border = 562
 *
 * 36rem (576px) leaves 14px for the non-compact `p-2.5` density, so the row
 * does not fold at one density and not the other.
 */
const FORM_W = "max-w-[36rem]";

function autoCode(catg: string, id: string, det: string): string {
  const parts = [catg.trim(), id.trim(), det.trim()].filter(Boolean);
  return parts.join(".");
}

/**
 * Defect Detail master: three-part composite code (catg.id.det) plus name,
 * defect group FK picker, optional defect type, and active toggle.
 * Table on desktop, cards on mobile, Sheet editor.
 */
export function DefectDetailMasterScreen({
  rows,
  defectGroups,
  perms,
}: {
  rows: DefectDetail[];
  defectGroups: DefectGroup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  const groupLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of defectGroups) m.set(g.id, g.name);
    return m;
  }, [defectGroups]);

  const displayCode = autoCode(form.defect_catg_id, form.defect_id, form.defect_det_id);

  /**
   * Told as they type, not on Save. Unscoped, matching the on-save guard already
   * in defect-detail-actions.ts (`checkDuplicateName(s, "defect_details", name)`
   * in both create and update) — until now that guard could only answer with a
   * toast after a round trip.
   *
   * On NAME, not on the composite code. The code is auto-composed from three
   * typed parts and its own uniqueness is already checked server-side; the name
   * is what a second operator would independently re-enter for a defect that is
   * already on the list.
   */
  const dupError = useDuplicateName({
    table: "defect_details",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: open && !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean?" — the check above only fires on an EXACT collision, and a
   * defect name is a phrase ("BROKEN STITCH") that is easy to re-enter one word
   * differently. No curated vocabulary: the DETAIL under a group is site-specific
   * (the GROUP list is the standardised half, and that master carries the seed).
   */
  const nameSuggest = useSpellSuggest({
    name: form.name,
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? "").filter(Boolean),
    seed: [],
    enabled: open,
    onApply: (v) => set({ name: v }),
  });

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(rows, {
    search: (r, q) =>
      [
        r.defect_catg_id,
        r.defect_id,
        r.defect_det_id,
        r.name,
        r.defect_type,
        r.defect_group?.name ?? (r.defect_group_id ? groupLabel.get(r.defect_group_id) : null),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      status: (r, v) => (v === "active" ? r.is_active : v === "inactive" ? !r.is_active : true),
      group: (r, v) => r.defect_group_id === v,
    },
    initialFilters: { status: "", group: "" },
  });

  const pg = usePagination(filtered);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: DefectDetail) {
    setEditId(r.id);
    setForm({
      defect_catg_id: r.defect_catg_id,
      defect_id: r.defect_id,
      defect_det_id: r.defect_det_id,
      name: r.name,
      defect_group_id: r.defect_group_id ?? "",
      defect_type: r.defect_type ?? "",
      is_active: r.is_active,
    });
    setOpen(true);
  }

  const canSave =
    !dupError &&
    form.defect_catg_id.trim().length >= 2 &&
    form.defect_id.trim().length >= 2 &&
    form.defect_det_id.trim().length >= 2 &&
    form.name.trim().length > 0;

  function submit() {
    startTransition(async () => {
      const payload: DefectDetailInput = {
        defect_catg_id: form.defect_catg_id.trim(),
        defect_id: form.defect_id.trim(),
        defect_det_id: form.defect_det_id.trim(),
        name: form.name.trim(),
        defect_group_id: form.defect_group_id || null,
        defect_type: form.defect_type.trim() || null,
        is_active: form.is_active,
      };
      const res = editId
        ? await updateDefectDetail(editId, payload)
        : await createDefectDetail(payload);
      if (res.ok) {
        success(editId ? "Defect detail updated." : "Defect detail added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: DefectDetail) {
    startTransition(async () => {
      const res = await deleteDefectDetail(r.id);
      if (res.ok) {
        success("Defect detail deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function groupName(r: DefectDetail): string {
    return r.defect_group?.name ?? (r.defect_group_id ? groupLabel.get(r.defect_group_id) ?? "—" : "—");
  }

  /* NO `text-sm` ON THE CELLS: the table is `dense` (text-xs) below and the
     cells inherit it, the same rule `createdColumns` states for its own two.
     `whitespace-nowrap` so each column hugs its value rather than wrapping
     into a taller row. */
  const columns: Column<DefectDetail>[] = [
    {
      header: "Code",
      cell: (r) => (
        <span className="whitespace-nowrap font-mono">
          {autoCode(r.defect_catg_id, r.defect_id, r.defect_det_id)}
        </span>
      ),
    },
    { header: "Name", cell: (r) => <span className="whitespace-nowrap font-medium">{r.name}</span> },
    { header: "Defect Group", cell: (r) => <span className="whitespace-nowrap">{groupName(r)}</span> },
    {
      header: "Type",
      cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.defect_type ?? "—"}</span>,
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
          searchPlaceholder="Search defect detail…"
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
            <Label htmlFor="dd-filter-status">Status</Label>
            <Select
              id="dd-filter-status"
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
            <Label htmlFor="dd-filter-group">Defect Group</Label>
            <Select
              id="dd-filter-group"
              value={filterValues.group}
              onChange={(e) => {
                setFilter("group", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {defectGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="defect-details" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Defect Detail
            </Button>
          )}
        </div>
      </div>

      {/* desktop table — COMPACT (erp-form-compact rule 4, applied to the list):
          `dense` is the primitive's own tight-row prop (px-2 py-1, text-xs),
          and `md:w-fit` lets the table hug its seven columns instead of
          spreading them across a 1440px pane with gaps between. `max-w-full`
          keeps the table's own horizontal scroll if a long name ever outgrows
          the pane. */}
      <div className="hidden md:block md:w-fit md:max-w-full">
        <DataTable
          dense
          columns={withCreatedColumns(columns, pg.paged)}
          rows={pg.paged}
          paginate={false}
          getKey={(r) => r.id}
          empty="No defect detail records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No defect detail records yet.
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
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {autoCode(r.defect_catg_id, r.defect_id, r.defect_det_id)}
                    {r.defect_type ? ` · ${r.defect_type}` : ""}
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
        title={editId ? "Edit Defect Detail" : "New Defect Detail"}
        footer={
          /* `mr-auto` inside the footer's `justify-end` row parks this box at the
             left, so the buttons end where the cards above them end rather than
             at the far edge of the pane. Same `FORM_W` as the cards. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        {/* `cols={1}` on both cards: the rows inside are content-width
            `FieldRow`s, not a twelfths track. Widths from FIELD_W above. */}
        <div className="space-y-4">
          <DetailSection label="Code Components" cols={1} className={FORM_W}>
            {/* `<Field required>` draws the star from the same declaration the
                control's `required` holds the cursor with — never a hand `*`. */}
            <FieldRow>
              <Field label="Category ID" w={FIELD_W.catg} required htmlFor="dd-catg">
                <Input
                  uppercase
                  id="dd-catg"
                  required
                  value={form.defect_catg_id}
                  onChange={(e) => set({ defect_catg_id: e.target.value })}
                  minLength={2}
                />
              </Field>
              <Field label="Defect ID" w={FIELD_W.id} required htmlFor="dd-id">
                <Input
                  uppercase
                  id="dd-id"
                  required
                  value={form.defect_id}
                  onChange={(e) => set({ defect_id: e.target.value })}
                  minLength={2}
                />
              </Field>
              <Field label="Detail ID" w={FIELD_W.det} required htmlFor="dd-det">
                <Input
                  uppercase
                  id="dd-det"
                  required
                  value={form.defect_det_id}
                  onChange={(e) => set({ defect_det_id: e.target.value })}
                  minLength={2}
                />
              </Field>
              {/* Always rendered (a dash until a part is typed): appearing on
                  the first keystroke used to reflow the card under the cursor. */}
              <Field label="Generated Code" w={FIELD_W.generated}>
                <div className="flex h-9 items-center rounded-md border border-border bg-surface-muted px-3 font-mono text-sm text-muted-foreground @2xl/editor:h-8">
                  {displayCode || "—"}
                </div>
              </Field>
            </FieldRow>
          </DetailSection>

          <DetailSection label="Details" cols={1} className={FORM_W}>
            <FieldRow>
              <Field label="Name" w={FIELD_W.name} required htmlFor="dd-name">
                <Input
                  id="dd-name"
                  uppercase
                  required
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                  onKeyDown={nameSuggest.onKeyDown}
                  {...dupFieldProps(dupError, "dd-name")}
                />
                <DuplicateError error={dupError} id="dd-name" />
                <SpellSuggestHint
                  suggestions={nameSuggest.suggestions}
                  existing={nameSuggest.existing}
                  activeIndex={nameSuggest.activeIndex}
                  duplicate={!!dupError}
                  onApply={(v) => set({ name: v })}
                />
              </Field>
              {/* DefectGroupPicker renders its own label; the Field only sizes it. */}
              <Field w={FIELD_W.group}>
                <DefectGroupPicker
                  groups={defectGroups}
                  value={form.defect_group_id}
                  onChange={(v) => set({ defect_group_id: v })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                />
              </Field>
              <Field label="Defect Type" w={FIELD_W.type} htmlFor="dd-type">
                <Input
                  uppercase
                  id="dd-type"
                  value={form.defect_type}
                  onChange={(e) => set({ defect_type: e.target.value })}
                />
              </Field>
            </FieldRow>
            {/* Its own row: a switch has no label band, so inside the
                `items-end` row above it would sit level with the boxes' bottoms
                and float. `Toggle`, not a tick box — still a real checkbox
                underneath, so Tab / Enter / Space reach it. */}
            {editId && (
              <FieldRow>
                <Toggle
                  id="dd-inactive"
                  label="Inactive"
                  checked={!form.is_active}
                  onChange={(inactive) => set({ is_active: !inactive })}
                />
              </FieldRow>
            )}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
