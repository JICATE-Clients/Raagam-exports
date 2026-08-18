"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { DetailSection } from "@/components/masters/detail-section";
import {
  createHsnDetail,
  updateHsnDetail,
  deleteHsnDetail,
} from "@/lib/masters/hsn-detail-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  HSN_DETAIL_FOR,
  hsnDetailForLabel,
  type HsnDetail,
  type HsnDetailFor,
  type HsnDetailInput,
} from "@/lib/masters/hsn-detail-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = {
  item_class_id: "",
  for_type: "materials" as HsnDetailFor,
  description: "",
  hsn_code: "",
  inactive: false,
};

/**
 * Legacy GST "HSN detail" master. Flat form: Item Class (ⓘ →
 * config_lookups 'item_class') · For (Materials / Process) · Description ·
 * HSN Code · Inactive, with Save / Save-As-Drafts (draft = `is_draft`).
 */
export function HsnDetailMasterScreen({
  rows,
  itemClasses,
  perms,
}: {
  rows: HsnDetail[];
  itemClasses: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const set = (patch: Partial<typeof BLANK>) => setForm((f) => ({ ...f, ...patch }));

  /**
   * Told as they type, mirroring the on-save guard in hsn-detail-actions.ts.
   *
   * On HSN CODE, scoped to (Item Class, For) — and both halves of that matter.
   * The code is the record's identity: a class mapped to two different HSN codes
   * makes every invoice line drawn from it a coin toss. But the same code under
   * a DIFFERENT class is the normal shape of this master, so an unscoped check
   * would refuse correct rows. `label` says "HSN code" because the message
   * otherwise reads "use a different name" beside a field that is not a name.
   *
   * spell-suggest: exempt -- the guarded field is an HSN code, which is digits.
   * "Did you mean 6109?" offered beside 6110 is not a spelling correction, it is
   * a different tariff line, and accepting it would mis-rate every invoice drawn
   * from the class. The Description beside it is prose about the code, not a
   * second name the record could be found by.
   */
  const dupError = useDuplicateName({
    table: "hsn_details",
    name: form.hsn_code,
    nameColumn: "hsn_code",
    label: "HSN code",
    scope: { item_class_id: form.item_class_id || null, for_type: form.for_type },
    excludeId: editId ?? undefined,
    enabled: open && !!form.hsn_code.trim() && !!form.item_class_id,
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.hsn_code,
    rowInScope: (r) =>
      (r.item_class_id ?? "") === (form.item_class_id ?? "") && r.for_type === form.for_type,
  });

  const itemClassLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of itemClasses) m.set(c.id, c.name);
    return m;
  }, [itemClasses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.hsn_code, r.description, itemClassLabel.get(r.item_class_id), hsnDetailForLabel(r.for_type)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query, itemClassLabel]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: HsnDetail) {
    setEditId(r.id);
    setForm({
      item_class_id: r.item_class_id,
      for_type: r.for_type,
      description: r.description ?? "",
      hsn_code: r.hsn_code ?? "",
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit(asDraft: boolean) {
    startTransition(async () => {
      const payload: HsnDetailInput = {
        item_class_id: form.item_class_id,
        for_type: form.for_type,
        description: form.description.trim() || null,
        hsn_code: form.hsn_code.trim() || null,
        inactive: form.inactive,
        is_draft: asDraft,
      };
      const res = editId ? await updateHsnDetail(editId, payload) : await createHsnDetail(payload);
      if (res.ok) {
        success(editId ? "HSN detail updated." : asDraft ? "Saved as draft." : "HSN detail added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: HsnDetail) {
    startTransition(async () => {
      const res = await deleteHsnDetail(r.id);
      if (res.ok) {
        success(deletedToast("HSN detail", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function statusPill(r: HsnDetail) {
    if (r.is_draft) return <StatusPill tone="warning">Draft</StatusPill>;
    if (r.inactive) return <StatusPill tone="danger">Inactive</StatusPill>;
    return <StatusPill tone="success">Active</StatusPill>;
  }

  const columns: Column<HsnDetail>[] = [
    {
      header: "HSN Code",
      cell: (r) => <span className="font-mono text-xs">{r.hsn_code ?? "—"}</span>,
    },
    {
      header: "Item Class",
      cell: (r) => (
        <span className="text-sm">{itemClassLabel.get(r.item_class_id) ?? "—"}</span>
      ),
    },
    {
      header: "For",
      cell: (r) => <span className="text-sm text-muted-foreground">{hsnDetailForLabel(r.for_type)}</span>,
    },
    {
      header: "Description",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span>,
    },
    { header: "Status", cell: (r) => statusPill(r) },
    rowActionsColumn((r) => (
      <RowActions
        label={r.hsn_code}
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
        {/* caps-input: exempt -- a search QUERY is not a stored value. */}
        <Input uppercase={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search HSN code, item class…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add HSN Detail
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No HSN details yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No HSN details yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">
                    <span className="font-mono">{r.hsn_code ?? "—"}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {itemClassLabel.get(r.item_class_id) ?? "—"} · {hsnDetailForLabel(r.for_type)}
                    {r.description ? ` · ${r.description}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
                </div>
                {statusPill(r)}
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit HSN Detail" : "New HSN Detail"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="md"
              disabled={isPending || !!dupError || !form.item_class_id}
              onClick={() => submit(true)}
            >
              Save as Draft
            </Button>
            <Button size="md" disabled={isPending || !!dupError || !form.item_class_id} onClick={() => submit(false)}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Details" cols={2}>
            <div>
              {/* The picker owns the label, the "— Select —" row and the
                  inactive-value rule (an inactive class still resolves for a
                  record already pointing at it), so none of that is repeated
                  here. */}
              <LookupDialogPicker
                kind="item_class"
                label="Item Class"
                required
                options={itemClasses}
                value={form.item_class_id || null}
                onChange={(v) => set({ item_class_id: v })}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
            </div>
            <div>
              <Label htmlFor="hsn-for">For</Label>
              <Select
                id="hsn-for"
                value={form.for_type}
                onChange={(e) => set({ for_type: e.target.value as HsnDetailFor })}
                className="text-base md:text-sm"
              >
                {HSN_DETAIL_FOR.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="hsn-desc">Description</Label>
              <Input
                id="hsn-desc"
                uppercase
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="hsn-code">HSN Code</Label>
              <ValidatedInput
                id="hsn-code"
                format="hsn"
                value={form.hsn_code}
                onChange={(e) => set({ hsn_code: e.target.value })}
                className="text-base md:text-sm"
                {...dupFieldProps(dupError, "hsn-code")}
              />
              <DuplicateError error={dupError} id="hsn-code" />
            </div>
          </DetailSection>
          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => set({ inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}
        </div>
      </Sheet>
    </div>
  );
}
