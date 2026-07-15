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
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { createCategory, updateCategory, deleteCategory } from "@/lib/masters/category-actions";
import { LookupDialogPicker, LevyPicker } from "@/components/masters/lookup-picker";
import { CommodityPicker } from "@/components/masters/commodity-picker";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import {
  MADE_TYPES,
  showsUserDefined,
  type Category,
  type CategoryInput,
  type MadeType,
} from "@/lib/masters/category-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Levy } from "@/lib/masters/levy-types";
import type { Commodity } from "@/lib/masters/commodity-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const BLANK = {
  item_class_id: "",
  short_name: "",
  name: "",
  short_spec: "",
  made: "" as "" | MadeType,
  levy_id: "",
  commodity_id: "",
  fabric_structure_id: "",
  user_defined: false,
  inactive: false,
};

/**
 * Rich CRUD for the legacy "Category" master. Item Class/Levy/Commodity are
 * dialog pickers over their stored master data; User Defined and Fabric
 * Structure only render for the item classes the legacy form shows them on.
 */
export function CategoryMasterScreen({
  rows,
  itemClasses,
  levies,
  commodities,
  fabricStructures,
  perms,
}: {
  rows: Category[];
  itemClasses: ConfigLookup[];
  levies: Levy[];
  commodities: Commodity[];
  fabricStructures: ConfigLookup[];
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
  const commodityLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of commodities) m.set(c.id, c.name ?? c.short_name ?? "—");
    return m;
  }, [commodities]);
  const commodityShortLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of commodities) m.set(c.id, c.short_name ?? "—");
    return m;
  }, [commodities]);
  const fabricStructureLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fabricStructures) m.set(f.id, f.name);
    return m;
  }, [fabricStructures]);

  // The selected Item Class's code drives which extra fields the legacy form
  // shows — User Defined (Capital/General/Sewing/Packing/Garments) and Fabric
  // Structure (Fabric only).
  const selectedClassCode = useMemo(
    () => itemClasses.find((c) => c.id === form.item_class_id)?.code?.toUpperCase() ?? null,
    [itemClasses, form.item_class_id],
  );
  const showUserDefined = showsUserDefined(selectedClassCode);
  const showFabricStructure = selectedClassCode === "FABRIC";

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
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
          r.commodity_id ? commodityLabel.get(r.commodity_id) : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
        itemClass: (r, v) => r.item_class_id === v,
        made: (r, v) => r.made === v,
        levy: (r, v) => r.levy_id === v,
      },
      initialFilters: { status: "", itemClass: "", made: "", levy: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
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
      commodity_id: r.commodity_id ?? "",
      fabric_structure_id: r.fabric_structure_id ?? "",
      user_defined: r.user_defined,
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: CategoryInput = {
        item_class_id: form.item_class_id,
        short_name: form.short_name.trim() || null,
        name: form.name.trim() || null,
        short_spec: form.short_spec.trim() || null,
        made: form.made ? form.made : null,
        levy_id: form.levy_id || null,
        commodity_id: form.commodity_id || null,
        fabric_structure_id: form.fabric_structure_id || null,
        user_defined: form.user_defined,
        inactive: form.inactive,
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
        success(res.inactive ? "Category is in use — marked inactive instead of deleted." : "Category deleted.");
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
    { header: "Short Name", cell: (r) => <span className="text-sm">{r.short_name ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name ?? "—"}</span> },
    {
      header: "Short Description",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.short_spec ?? "—"}</span>,
    },
    {
      header: "Type",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.made ?? (r.fabric_structure_id ? fabricStructureLabel.get(r.fabric_structure_id) : null) ?? "—"}
        </span>
      ),
    },
    {
      header: "Levy Description",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.levy_id ? levyLabel.get(r.levy_id) ?? "—" : "—"}
        </span>
      ),
    },
    {
      header: "Commodity",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.commodity_id ? commodityShortLabel.get(r.commodity_id) ?? "—" : "—"}
        </span>
      ),
    },
    {
      header: "Commodity Description",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.commodity_id ? commodityLabel.get(r.commodity_id) ?? "—" : "—"}
        </span>
      ),
    },
    { header: "Created Dt", cell: (r) => <span className="text-sm">{r.created_at.slice(0, 10)}</span> },
    { header: "Created User", cell: (r) => <span className="text-sm">{r.created_by_name || "—"}</span> },
    {
      header: "Inactive",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>
          {r.inactive ? "Inactive" : "Active"}
        </StatusPill>
      ),
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
          searchPlaceholder="Search category…"
          activeCount={activeCount}
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
          <div>
            <Label htmlFor="category-filter-levy">Levy</Label>
            <Select
              id="category-filter-levy"
              value={filterValues.levy}
              onChange={(e) => {
                setFilter("levy", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {levies.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.description || `Entry #${l.entry_no}`}
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
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No category records yet." />
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
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.item_class_id} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <LookupDialogPicker
            kind="item_class"
            label="Item Class"
            required
            options={itemClasses}
            value={form.item_class_id}
            onChange={(v) => setForm({ ...form, item_class_id: v })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
            isSuperAdmin={perms.isSuperAdmin}
          />

          {showUserDefined && (
            <div>
              <Label htmlFor="cat-user-defined">User Defined</Label>
              <Select
                id="cat-user-defined"
                value={form.user_defined ? "yes" : "no"}
                onChange={(e) => setForm({ ...form, user_defined: e.target.value === "yes" })}
                className="text-base md:text-sm"
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="cat-short-name">Short Name</Label>
            <Input
              id="cat-short-name"
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          {/* Short Spec removed for new entries (functional spec, 0280) — descriptive
              data now comes from structured attributes instead. Still shown when
              editing an existing category so historical data isn't hidden/lost. */}
          {editId && (
            <div>
              <Label htmlFor="cat-spec">Short Spec</Label>
              <Input
                id="cat-spec"
                value={form.short_spec}
                onChange={(e) => setForm({ ...form, short_spec: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          )}
          <div>
            <Label htmlFor="cat-made">Made</Label>
            <Select
              id="cat-made"
              value={form.made}
              onChange={(e) => setForm({ ...form, made: e.target.value as "" | MadeType })}
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {MADE_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          {showFabricStructure && (
            <LookupDialogPicker
              kind="fabric_structure"
              label="Fabric Structure"
              options={fabricStructures}
              value={form.fabric_structure_id}
              onChange={(v) => setForm({ ...form, fabric_structure_id: v })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
              isSuperAdmin={perms.isSuperAdmin}
              adminOnly
            />
          )}
          <LevyPicker
            label="Levy Description"
            levies={levies}
            value={form.levy_id}
            onChange={(v) => setForm({ ...form, levy_id: v })}
          />
          <CommodityPicker
            commodities={commodities}
            itemClasses={itemClasses}
            value={form.commodity_id}
            onChange={(v) => setForm({ ...form, commodity_id: v })}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.inactive}
              onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
