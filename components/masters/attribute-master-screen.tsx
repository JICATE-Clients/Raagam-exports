"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createAttribute,
  updateAttribute,
  deleteAttribute,
} from "@/lib/masters/extras-actions";
import {
  ATTRIBUTE_TYPES,
  type Attribute,
  type AttributeInput,
  type AttributeType,
} from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type ValueRow = { key: string; value: string };

const BLANK = {
  code: "",
  type: "" as "" | AttributeType,
  description: "",
  blocked: false,
  has_attributes: false,
};

/**
 * Master-detail CRUD for the legacy "Attribute" master: a header (code, type,
 * description, blocked, has-attributes) plus a child grid of attribute values.
 * Dense table on desktop, record cards on mobile, shared <Sheet> editor.
 */
export function AttributeMasterScreen({
  rows,
  perms,
}: {
  rows: Attribute[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [values, setValues] = useState<ValueRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `v${keySeq.current++}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.type, r.description, ...r.values.map((v) => v.value)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setValues([]);
    setOpen(true);
  }
  function openEdit(r: Attribute) {
    setEditId(r.id);
    setForm({
      code: r.code,
      type: r.type ?? "",
      description: r.description ?? "",
      blocked: r.blocked,
      has_attributes: r.has_attributes,
    });
    setValues(r.values.map((v) => ({ key: newKey(), value: v.value })));
    setOpen(true);
  }

  function toggleHasAttributes(checked: boolean) {
    setForm((f) => ({ ...f, has_attributes: checked }));
    // Give the grid one empty row to start editing into.
    if (checked && values.length === 0) setValues([{ key: newKey(), value: "" }]);
  }
  function addValueRow() {
    setValues((vs) => [...vs, { key: newKey(), value: "" }]);
  }
  function setValueAt(key: string, value: string) {
    setValues((vs) => vs.map((v) => (v.key === key ? { ...v, value } : v)));
  }
  function removeValueRow(key: string) {
    setValues((vs) => vs.filter((v) => v.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const payload: AttributeInput = {
        code: form.code.trim(),
        type: form.type ? form.type : null,
        description: form.description.trim() || null,
        blocked: form.blocked,
        has_attributes: form.has_attributes,
        values: form.has_attributes
          ? values
              .filter((v) => v.value.trim())
              .map((v, i) => ({ sno: i + 1, value: v.value.trim() }))
          : [],
      };
      const res = editId
        ? await updateAttribute(editId, payload)
        : await createAttribute(payload);
      if (res.ok) {
        success(editId ? "Attribute updated." : "Attribute added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Attribute) {
    startTransition(async () => {
      const res = await deleteAttribute(r.id);
      if (res.ok) {
        success("Attribute deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Attribute>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Type", cell: (r) => <span className="text-sm">{r.type ?? "—"}</span> },
    {
      header: "Description",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span>
      ),
    },
    {
      header: "Values",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {r.has_attributes ? r.values.length : "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "danger" : "success"}>
          {r.blocked ? "Blocked" : "Active"}
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
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search attribute…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Attribute
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={filtered}
          getKey={(r) => r.id}
          empty="No attribute records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No attribute records yet.
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
                    {r.code}
                  </div>
                  {r.type && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{r.type}</div>
                  )}
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Blocked" : "Active"}
                </StatusPill>
              </div>
              {r.description && (
                <div className="mt-2 text-[13px] text-muted-foreground">{r.description}</div>
              )}
              {r.has_attributes && r.values.length > 0 && (
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {r.values.length} value{r.values.length === 1 ? "" : "s"}
                </div>
              )}
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Attribute" : "New Attribute"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.code.trim()}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="at-code">
              Code <span className="text-danger">*</span>
            </Label>
            <Input
              id="at-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="Unique code"
              required
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="at-type">Type</Label>
            <Select
              id="at-type"
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as "" | AttributeType })
              }
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {ATTRIBUTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="at-desc">Description</Label>
            <Textarea
              id="at-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.blocked}
              onChange={(e) => setForm({ ...form, blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Blocked</span>
          </label>

          {/* Has Attributes → child value grid */}
          <div className="rounded-lg border border-border">
            <label className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.has_attributes}
                onChange={(e) => toggleHasAttributes(e.target.checked)}
              />
              <span className="text-sm font-medium text-foreground">Has Attributes</span>
            </label>

            {form.has_attributes && (
              <div className="space-y-2 p-3">
                {values.length === 0 && (
                  <p className="text-xs text-muted-foreground">No values yet.</p>
                )}
                {values.map((v, i) => (
                  <div key={v.key} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <Input
                      value={v.value}
                      onChange={(e) => setValueAt(v.key, e.target.value)}
                      placeholder="Attribute value"
                      className="flex-1 text-base md:text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground hover:text-danger"
                      onClick={() => removeValueRow(v.key)}
                      aria-label="Remove value"
                    >
                      ✕
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addValueRow}>
                  + Add value
                </Button>
              </div>
            )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
