"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { createCategory, updateCategory, deleteCategory } from "@/lib/masters/category-actions";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { DetailSection } from "@/components/masters/detail-section";
import { ChildGrid } from "@/components/masters/child-grid";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { focusField, focusFirstField } from "@/lib/focus";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { categoryNameSeed } from "@/lib/masters/name-vocabularies";
import {
  MADE_TYPES,
  showsSubCategories,
  type Category,
  type CategoryInput,
  type MadeType,
} from "@/lib/masters/category-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Levy } from "@/lib/masters/levy-types";
import type { SizeGroup } from "@/lib/masters/size-group-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = {
  item_class_id: "",
  short_name: "",
  name: "",
  short_spec: "",
  made: "" as "" | MadeType,
  levy_id: "",
  fabric_structure_id: "",
  wastage_per: 0,
  profit_per: 0,
  freight_per: 0,
  insurance_per: 0,
  interest_per: 0,
  size_group_id: "",
  status_monitoring_type: "",
  user_defined: false,
  inactive: false,
  has_sub_categories: false,
};

/** A Sub Category row being edited. `id` is null for a row the user just added;
 *  carrying the real id back lets updateCategory reconcile instead of
 *  re-creating rows that materials point at (0349). */
type SubRow = { key: string; id: string | null; name: string };

/**
 * Rich CRUD for the legacy "Category" master. Item Class is a dialog picker
 * over its stored master data; Fabric Structure and the Sub Categories grid
 * only render for the item classes the legacy form shows them on. (Levy
 * Description was one of these pickers until the client hid it on 2026-08-01 —
 * the column is still carried, see the note at its old position below.)
 *
 * Commodity was asked here until the client withdrew the whole Commodities
 * master (2026-08-01) — the column stays in the database, unread and unwritten.
 */
export function CategoryMasterScreen({
  rows,
  itemClasses,
  levies,
  fabricStructures,
  sizeGroups,
  perms,
}: {
  rows: Category[];
  itemClasses: ConfigLookup[];
  levies: Levy[];
  fabricStructures: ConfigLookup[];
  sizeGroups: SizeGroup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  // display maps — LookupDialogPicker owns merging in session-added classes and
  // filtering out inactive ones from the picker itself; this screen only
  // needs the raw list to resolve labels (including inactive, so an existing
  // category that references a inactive class still shows its name).
  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of itemClasses) m.set(c.id, c.name);
    return m;
  }, [itemClasses]);
  const levyLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of levies) m.set(l.id, l.description || `Entry #${l.entry_no}`);
    return m;
  }, [levies]);
  const fabricStructureLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fabricStructures) m.set(f.id, f.name);
    return m;
  }, [fabricStructures]);

  // The selected Item Class's code drives which extra fields the legacy form
  // shows — Fabric Structure (Fabric only) and the Sub Categories grid.
  const selectedClassCode = useMemo(
    () => itemClasses.find((c) => c.id === form.item_class_id)?.code?.toUpperCase() ?? null,
    [itemClasses, form.item_class_id],
  );
  const showFabricStructure = selectedClassCode === "FABRIC";
  /** Category Type (Natural / Manmade / Mixed) describes a FIBRE, so it is asked
   *  of Yarn and nothing else. Named here rather than repeated inline because
   *  the required check below must gate on exactly the same condition the render
   *  does — required-but-invisible is unsaveable, and that is how Capital Goods
   *  once became impossible to create (see ACCESSORY_CLASS_CODES in
   *  material-types.ts for that story). */
  const showCategoryType = selectedClassCode === "YARN";
  const showSubCategories = showsSubCategories(selectedClassCode);
  /** The Sub Categories question is about a category that exists — "does
   *  ELECTRICAL have types?" — so it waits for a Name (client 2026-08-01).
   *  Trimmed, so spaces alone do not count as an answer. Opening an existing
   *  category satisfies this immediately, which is what edit should do. */
  const nameEntered = !!form.name.trim();


  // Sub Categories child grid (General only, 0349).
  const [subs, setSubs] = useState<SubRow[]>([]);
  const subKeySeq = useRef(0);
  const newKey = () => `s${subKeySeq.current++}`;
  const addSub = () => setSubs((xs) => [...xs, { key: newKey(), id: null, name: "" }]);
  const setSubAt = (key: string, patch: Partial<SubRow>) =>
    setSubs((xs) => xs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /**
   * What still has to be filled before this category can be saved — every field
   * the form still asks for (client 2026-08-01; the two it used to exclude,
   * Levy Description and Commodity, are no longer on the form at all).
   *
   * ONE list, read by three things — the `*` on each label, the Save gate, and
   * the message under Save. Three separate conditions would be three places to
   * keep in step, and the message is the one that would silently go stale.
   *
   * IT NO LONGER STANDS ALONE. Until 2026-08-04 this list was the whole story
   * and this note said the cursor deliberately does not hold, because the
   * contract allowed exactly one refusal and keying a hold off "required but
   * empty" would cage the operator in the first blank box of every form — unable
   * to fill out of order, to go back, or to reach Save.
   *
   * Every one of those objections has since been answered, which is why the
   * fields now ALSO carry `required` and hold the cursor:
   *   - the hold keys off `data-required-empty`, an explicit marker a field only
   *     carries when a screen DECLARED it mandatory — never off `aria-invalid`,
   *     which is live for a half-typed value too;
   *   - backward movement is allowed out of it (Shift+Tab / ↑ / ←), so filling
   *     out of order and going back both work;
   *   - Escape and the mouse are always live.
   *
   * So this list and the hold are now two halves of one rule rather than a
   * substitute for it: this one blocks the RECORD (a save attempt names the
   * missing field and jumps the cursor there), the `required` props block the
   * CURSOR at the field itself. Keep them in step — a field named here that does
   * not declare `required` shows a `*` the keyboard walks straight past, which is
   * the disagreement the contract exists to prevent.
   *
   * It is read at SAVE TIME, not on every render (`triedSave`). Rendering it
   * eagerly meant a new record opened already complaining, and revealing a
   * conditional field announced it as missing before the operator could reach it.
   *
   * `fabric_structure_id` counts only while it is on screen — requiring a field
   * the operator cannot see is unsaveable-by-invisible-field, which is how
   * Capital Goods once became impossible to create.
   */
  const missingRequired = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    if (!form.item_class_id) out.push({ id: "cat-item-class", label: "Item Class" });
    // Each of these counts only while it is ON SCREEN. Category Type is asked of
    // Yarn only and Fabric Structure of Fabric only, so requiring either
    // unconditionally would make every other class unsaveable through a field
    // the operator cannot even see.
    if (showCategoryType && !form.made) out.push({ id: "cat-made", label: "Category Type" });
    if (showFabricStructure && !form.fabric_structure_id)
      out.push({ id: "cat-fabric-structure", label: "Fabric Structure" });
    if (!form.name.trim()) out.push({ id: "cat-name", label: "Name" });
    // Ticking the box is a promise of a second level; an empty grid does not
    // keep it, and the server drops blank rows anyway (normalizeSubCategories),
    // so this would otherwise save as "has sub categories" with none.
    if (showSubCategories && nameEntered && form.has_sub_categories && !subs.some((s) => s.name.trim()))
      out.push({ id: "cat-name", label: "at least one Sub Category" });
    return out;
  }, [
    form.item_class_id, form.made, form.fabric_structure_id, form.name,
    form.has_sub_categories, showCategoryType, showFabricStructure, showSubCategories,
    nameEntered, subs,
  ]);

  /** Take the operator to the first thing that is missing, rather than leaving
   *  a disabled button and no explanation. `focusField` (not a bare .focus())
   *  puts the caret at the END of the value — a bare focus leaves it at 0 and
   *  silently breaks the → key. */
  function focusFirstMissing() {
    const first = missingRequired[0];
    if (!first) return;
    const el = document.getElementById(first.id);
    if (!el) return;
    // Some targets ARE the control (a <Select>, the Name <Input>); Fabric
    // Structure is a wrapper around a picker, so fall through to its trigger.
    if (el.matches("input, select, textarea, button, [tabindex]")) focusField(el);
    else focusFirstField(el);
  }
  const removeSub = (key: string) => setSubs((xs) => xs.filter((r) => r.key !== key));
  /** Turning it ON seeds a first row so the revealed grid isn't an empty box;
   *  OFF clears them so nothing invisible is sent (the server mirrors this in
   *  normalizeSubCategories). Same shape as toggleHasSubs on the Process master. */
  const toggleSubCategories = (checked: boolean) => {
    setForm((f) => ({ ...f, has_sub_categories: checked }));
    if (checked) {
      if (subs.length === 0) addSub();
    } else {
      setSubs([]);
    }
  };

  // Real-time duplicate check on Name, scoped to the selected Item Class.
  const dupError = useDuplicateName({
    table: "categories",
    name: form.name ?? "",
    scope: { item_class_id: form.item_class_id || null },
    excludeId: editId ?? undefined,
    enabled: !!(form.name && form.item_class_id),
    // The synchronous half — `rowInScope` mirrors `scope` above, or a name
    // reused under a DIFFERENT item class would read as a collision.
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
    rowInScope: (r) => r.item_class_id === form.item_class_id,
  });

  /**
   * "Did you mean?" on Name — restored 2026-08-01 at the client's request,
   * having been removed on 2026-07-30. Worth knowing WHY it was removed, so it
   * does not get removed a third time.
   *
   * The original (2026-07-25) matched word by word against a hardcoded fibre
   * vocabulary — COTTON, VISCOSE, POLYESTER … — offered on every category
   * regardless of class. A Packing Accessories name duly got "corrected" to
   * COTTON (client 2026-07-28), and two days later the whole feature was pulled.
   *
   * THE FIX IS THE KEY, NOT THE ABSENCE OF A LIST. From 2026-08-01 to 08-04 this
   * passed `seed: []` and drew only on existing rows, which fixed 07-28 by having
   * no vocabulary to leak. It also made the strip useless: `names` here is scoped
   * exactly as `dupError` above is scoped, so every chip it could produce was a
   * row the guard was about to reject. Typing COT under YARN offered COTTON and
   * POLYCOTTON — both already there, both landing on "already exists" if picked
   * (client 2026-08-04). A hundred per cent of the chips were dead ends.
   *
   * So the vocabulary is back, KEYED BY ITEM CLASS. `categoryNameSeed()` answers
   * [] for any class it does not list, so a Packing category resolves to the
   * packing words and the fibre words are unreachable from it — 07-28 stays
   * unrepresentable rather than merely absent. And `useSpellSuggest` now drops
   * any candidate that is already a row, so what reaches the chips is only ever a
   * name that saves; the taken ones move to inert text, which is what still
   * catches a typo-twin (INTARLOCK beside INTERLOCK — both in FABRIC today).
   *
   * NOT disabled by the duplicate error any more. The old note said "the name it
   * collided with is the one name that is no use" — true, and it argues for
   * dropping that name, not the strip. Those were the same statement only while
   * the seed was empty. COTTON is no use; COTTON SLUB is the whole point, and a
   * duplicate is when the operator most needs it — the error even holds the
   * cursor in the field, so the chips under it are the way out.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    names: rows
      .filter((r) => r.id !== editId && r.item_class_id === form.item_class_id)
      .map((r) => r.name ?? "")
      .filter(Boolean),
    seed: categoryNameSeed(selectedClassCode),
    enabled: !!form.item_class_id,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [
          r.name,
          r.short_name,
          r.short_spec,
          r.made,
          classLabel.get(r.item_class_id),
          r.levy_id ? levyLabel.get(r.levy_id) : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
        itemClass: (r, v) => r.item_class_id === v,
        made: (r, v) => r.made === v,
      },
      initialFilters: { status: "", itemClass: "", made: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  /**
   * Has the operator ASKED to save yet? Until they have, the footer says nothing
   * about missing fields.
   *
   * The message used to render the moment a field was blank, which meant a brand
   * new Category opened already accusing the operator of not having filled it in,
   * and picking Item Class FABRIC — which REVEALS Fabric Structure — announced
   * that the field they had just been given was required before they could reach
   * it (client 2026-08-04). Telling someone off for not having done a thing they
   * have not had the chance to do reads as an error, not as help.
   *
   * Reset on every open, so a fresh editor is always quiet.
   */
  const [triedSave, setTriedSave] = useState(false);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setSubs([]);
    setTriedSave(false);
    setOpen(true);
  }
  function openEdit(r: Category) {
    setEditId(r.id);
    setForm({
      item_class_id: r.item_class_id,
      short_name: r.short_name ?? "",
      name: r.name ?? "",
      short_spec: r.short_spec ?? "",
      made: r.made ?? "",
      levy_id: r.levy_id ?? "",
      fabric_structure_id: r.fabric_structure_id ?? "",
      wastage_per: r.wastage_per ?? 0,
      profit_per: r.profit_per ?? 0,
      freight_per: r.freight_per ?? 0,
      insurance_per: r.insurance_per ?? 0,
      interest_per: r.interest_per ?? 0,
      size_group_id: r.size_group_id ?? "",
      status_monitoring_type: r.status_monitoring_type ?? "",
      user_defined: r.user_defined,
      inactive: r.inactive,
      has_sub_categories: r.has_sub_categories,
    });
    setSubs((r.sub_categories ?? []).map((c) => ({ key: newKey(), id: c.id, name: c.name })));
    setTriedSave(false);
    setOpen(true);
  }

  function submit() {
    /**
     * THE SAVE ATTEMPT IS WHAT ASKS THE QUESTION.
     *
     * Save is no longer disabled while a field is missing — it is clickable, and
     * clicking it is how the operator says "I think I am done". Only then does
     * the footer name what is missing, and the cursor jumps straight to it.
     *
     * Disabling it instead left `focusFirstMissing` reachable from ONE place: a
     * click on the message. So the message had to be permanently visible to be
     * useful, and Ctrl+S / Enter-off-the-last-field found a disabled button and
     * did nothing at all — a keyboard operator had no way to ask what was wrong.
     * Nothing is silently ignored now: every save attempt either saves or says
     * why it did not.
     */
    if (missingRequired.length > 0) {
      setTriedSave(true);
      focusFirstMissing();
      return;
    }
    startTransition(async () => {
      const payload: CategoryInput = {
        item_class_id: form.item_class_id,
        short_name: form.name.trim() || null, // merged: Short Name = Name (single field)
        // Not `|| null` any more: `categoryInput.name` is required, and Save
        // is already gated on a non-blank name. Passing null here would be a
        // value the schema now rejects — the typecheck said so.
        name: form.name.trim(),
        short_spec: form.short_spec.trim() || null,
        made: form.made ? form.made : null,
        levy_id: form.levy_id || null,
        fabric_structure_id: form.fabric_structure_id || null,
        wastage_per: form.wastage_per,
        profit_per: form.profit_per,
        freight_per: form.freight_per,
        insurance_per: form.insurance_per,
        interest_per: form.interest_per,
        size_group_id: form.size_group_id || null,
        status_monitoring_type: form.status_monitoring_type.trim() || null,
        user_defined: form.user_defined,
        inactive: form.inactive,
        has_sub_categories: showSubCategories && form.has_sub_categories,
        sub_categories: subs
          .filter((c) => c.name.trim())
          .map((c, i) => ({ id: c.id, sno: i + 1, name: c.name.trim() })),
      };
      const res = editId ? await updateCategory(editId, payload) : await createCategory(payload);
      if (res.ok) {
        success(editId ? "Category updated." : "Category added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Category) {
    startTransition(async () => {
      const res = await deleteCategory(r.id);
      if (res.ok) {
        success(res.inactive ? "Category is in use — deactivated instead of deleted (history kept)." : "Category deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Category>[] = [
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm">{classLabel.get(r.item_class_id) ?? "—"}</span>,
    },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? "—"}</span> },
    {
      header: "Type",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.made ?? (r.fabric_structure_id ? fabricStructureLabel.get(r.fabric_structure_id) : null) ?? "—"}
        </span>
      ),
    },
    {
      header: "Inactive",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>
          {r.inactive ? "Inactive" : "Active"}
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
          searchPlaceholder="Search category…"
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
            <Label htmlFor="category-filter-status">Status</Label>
            <Select
              id="category-filter-status"
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
            <Label htmlFor="category-filter-class">Item Class</Label>
            <Select
              id="category-filter-class"
              value={filterValues.itemClass}
              onChange={(e) => {
                setFilter("itemClass", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {itemClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="category-filter-made">Made</Label>
            <Select
              id="category-filter-made"
              value={filterValues.made}
              onChange={(e) => {
                setFilter("made", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {MADE_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="categories" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Category
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, rows)} rows={pg.paged} getKey={(r) => r.id} empty="No category records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No category records yet.
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
                    {r.name ?? classLabel.get(r.item_class_id) ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {classLabel.get(r.item_class_id) ?? "—"}
                    {r.made ? ` · ${r.made}` : ""}
                  </div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
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
        title={editId ? "Edit Category" : "New Category"}
        footer={
          <>
            {/* Says WHY Save is off, and clicking it takes the operator there.
                A greyed button with no reason is the thing that makes people
                hunt the form for the field they missed — which is the actual
                complaint behind "don't let the cursor leave an empty field".

                FIRST IN THE ROW, AND THAT MATTERS. The footer is `justify-end`,
                so `mr-auto` here absorbs the free space to its RIGHT and packs
                everything BEFORE it to the left. With Cancel sitting ahead of
                this message, Cancel was thrown to the far left the moment the
                message appeared and snapped back to Save when it cleared — the
                buttons moved as a side effect of a validation message (client
                2026-08-04). Message left, buttons right, and the pair never
                moves; the same shape `MasterFullScreen`'s footer already uses
                for its status line. */}
            {triedSave && missingRequired.length > 0 && !isPending && (
              <button
                type="button"
                onClick={focusFirstMissing}
                // Off the Tab path: it is a shortcut to a field, not a field.
                // The operator can always reach the same box by Tab or mouse.
                tabIndex={-1}
                className="mr-auto text-left text-xs text-danger hover:underline"
              >
                {missingRequired[0].label} is required
                {missingRequired.length > 1 ? ` (+${missingRequired.length - 1} more)` : ""}
              </button>
            )}
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              // NOT disabled on a missing field — `submit` catches that and points
              // at it. Still disabled on a live DUPLICATE, which is different: the
              // field is already red and already says so, and the standing rule
              // puts `|| !!dupError` on Save.
              disabled={isPending || !!dupError}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Classification" cols={2}>
            {/* Item Class stays a plain <Select>, unlike every other stored
                list on this form: the FORM ITSELF branches on the chosen class.
                `showFabricStructure` / `showSubCategories` / the Category Type
                field above are all read off `selectedClassCode`, so a class
                quick-created from here would open a form that does not exist.
                Item Classes are maintained on their own master, where the
                questions each class asks are decided. Same reasoning as the
                Materials form's own Item Class field. */}
            <div>
              <Label htmlFor="cat-item-class">
                Item Class <span className="text-danger">*</span>
              </Label>
              <Select
                id="cat-item-class"
                // Always on screen, always mandatory — `categoryInput.item_class_id`
                // is a bare `.uuid()`, and every question this form asks is
                // decided by it.
                required
                value={form.item_class_id}
                onChange={(e) => setForm({ ...form, item_class_id: e.target.value })}
                className="text-base md:text-sm"
              >
                <option value=""></option>
                {itemClasses
                  .filter((c) => c.is_active || c.id === form.item_class_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </div>

            {/* "User Defined" (Yes/No) used to sit here for Sewing/Packing/
                Garments. The client's answer to "what does it do?" was to remove
                it (2026-07-30), so the question is no longer asked. The
                categories.user_defined column is still written from `form` below
                so a stored value round-trips untouched — no row has ever held
                true. See doc/masters-open-questions.md #6. */}

            {/* Category Type (Natural/Manmade/Mixed) is a Yarn concept only;
                Fabric classifies via Fabric Structure below instead. */}
            {showCategoryType && (
              <div>
                <Label htmlFor="cat-made">
                  Category Type <span className="text-danger">*</span>
                </Label>
                <Select
                  id="cat-made"
                  // Bare, and that is the point: this control only EXISTS inside
                  // `showCategoryType`, so the render condition is the gate. A
                  // computed `required={showCategoryType}` would be a second copy
                  // of the same condition to keep in step, and the note above
                  // (`required-but-invisible is unsaveable`) is about exactly that
                  // drift.
                  required
                  value={form.made}
                  onChange={(e) => setForm({ ...form, made: e.target.value as "" | MadeType })}
                  className="text-base md:text-sm"
                >
                  <option value=""></option>
                  {MADE_TYPES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {/* Fabric Structure is a stored list, so it is a picker rather than a
                <Select> — but it is SELECT-ONLY, exactly as Category Type above
                cannot be extended (client 2026-08-11). Its three values are the
                keys the Fabric UOM rule reads, so a fourth is a value nothing can
                act on; `CLOSED_LOOKUP_KINDS` in extras-types.ts holds the whole
                reasoning and the picker drops Add / Modify / Delete itself. The
                permissions below are passed for the day the kind stops being
                closed — they are what the rule overrides, not a contradiction. */}
            {showFabricStructure && (
              // id is the focus target for "jump to the first missing field" —
              // LookupDialogPicker takes no id of its own, so the wrapper carries
              // it and `focusFirstField` finds the trigger inside.
              <div id="cat-fabric-structure">
                <LookupDialogPicker
                  kind="fabric_structure"
                  required
                  label="Fabric Structure"
                  options={fabricStructures}
                  value={form.fabric_structure_id}
                  onChange={(v) => setForm({ ...form, fabric_structure_id: v })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                />
              </div>
            )}
            {/* "Has Sub Categories" and its Sub Categories grid used to sit HERE.
                That was the bug (client 2026-08-01): they appeared the moment
                General was picked — above a Name field the operator had not
                reached yet, in an earlier section. They now live under the Name
                in Details. Left as a signpost rather than silence, because the
                option reads like Classification and the obvious instinct is to
                move it back. */}
          </DetailSection>

          <DetailSection label="Details" cols={2}>
            <div>
              <Label htmlFor="cat-name">
                Name <span className="text-danger">*</span>
              </Label>
              <Input
                id="cat-name"
                uppercase
                // The identity — a nameless category is unusable in every picker
                // that offers it.
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="text-base md:text-sm"
                {...dupFieldProps(dupError, "cat-name")}
                // ↓ into the suggestion chips, Enter applies, Esc dismisses —
                // the strip is a list on this field, so it answers the same keys
                // any other list does. No-ops while nothing is showing.
                onKeyDown={nameSuggest.onKeyDown}
              />
              <DuplicateError error={dupError} id="cat-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupError}
                onApply={(v) => setForm((f) => ({ ...f, name: v }))}
              />
            </div>
            {/* General stores buy by category-then-type — ELECTRICAL ▸ LIGHTS /
                FANS / SWITCHES — so annual spend can be read both per type and
                as a category total (0349). Off by default: a category with no
                second level hides the Material form's Sub Category field
                entirely, so nothing is forced on categories that don't need it.

                Asked AFTER the Name, and only once one has been typed (client
                2026-08-01). The question is "does ELECTRICAL have types?", which
                cannot be answered before there is an ELECTRICAL — so offering it
                the instant General was picked put the cart before the horse, and
                did it in a section above the Name field at that.

                Hiding on a blank name is presentation only: `has_sub_categories`
                and the typed rows stay in state, so clearing the Name and
                retyping it brings them back untouched. Discarding them here
                would make a stray Ctrl+A in the Name field destroy work, and a
                nameless category cannot be saved anyway (Save is gated on it). */}
            {showSubCategories && nameEntered && (
              <label className="flex h-9 cursor-pointer items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.has_sub_categories}
                  onChange={(e) => toggleSubCategories(e.target.checked)}
                />
                <span className="text-sm text-foreground">Has Sub Categories</span>
              </label>
            )}
            {showSubCategories && nameEntered && form.has_sub_categories && (
              <div className="sm:col-span-2">
                <ChildGrid<SubRow>
                  lockExisting
                  label="Sub Categories"
                  rows={subs}
                  onAdd={addSub}
                  onRemove={(r) => removeSub(r.key)}
                  addLabel="+ Add sub category"
                  inlineCards
                  frameless
                  columns={[
                    {
                      header: "Name",
                      cell: (r) => (
                        <Input
                          value={r.name}
                          uppercase
                          placeholder="e.g. LIGHTS"
                          onChange={(e) => setSubAt(r.key, { name: e.target.value })}
                        />
                      ),
                    },
                  ]}
                />
              </div>
            )}
            {/* Short Spec/Short Description dropped from the UI (client 2026-07-24 —
                "use Description only"). The short_spec column is still round-tripped
                (form state + save) so historical data isn't lost; it's just no longer
                edited here — descriptive data comes from structured attributes now. */}
            {/* Levy Description dropped from the UI (client 2026-08-01 — the GST
                structure is not chosen per category). Same treatment as
                short_spec above: `levy_id` is still in form state, still read on
                open and still written on save, so existing rows keep whatever
                they were given and nothing is blanked by editing a category.
                It is deliberately NOT removed from the type or the table — the
                brief was "hide it, we may call it from a child" — so re-showing
                it, here or on a child grid, is putting this picker back and
                nothing else. Levies are still pickable where they're actually
                decided: VAT / Duty / TDS on the Vendor master. */}
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
    </div>
  );
}
