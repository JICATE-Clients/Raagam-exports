"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createComponent,
  updateComponent,
  deleteComponent,
} from "@/lib/masters/component-actions";
import type { Component, ComponentInput } from "@/lib/masters/component-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type CoordinateRow = { key: string; coordinate: string };

const BLANK = { short_name: "", description: "", all_coordinates: true, blocked: false };

/**
 * Master-detail CRUD for the legacy "Component" master: a header (Short Name
 * req · Description · All Coordinates · Blocked) plus a "Coordinates" grid of
 * free-text coordinate labels. Dense table on desktop, cards on mobile, shared
 * <Sheet> editor.
 */
export function ComponentMasterScreen({
  rows,
  perms,
}: {
  rows: Component[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [coordinates, setCoordinates] = useState<CoordinateRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `c${keySeq.current++}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.short_name, r.description, ...r.coordinates.map((c) => c.coordinate)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setCoordinates([{ key: newKey(), coordinate: "" }]);
    setOpen(true);
  }
  function openEdit(r: Component) {
    setEditId(r.id);
    setForm({
      short_name: r.short_name,
      description: r.description ?? "",
      all_coordinates: r.all_coordinates,
      blocked: r.blocked,
    });
    setCoordinates(r.coordinates.map((c) => ({ key: newKey(), coordinate: c.coordinate })));
    setOpen(true);
  }

  function addCoordinate() {
    setCoordinates((cs) => [...cs, { key: newKey(), coordinate: "" }]);
  }
  function setCoordinateAt(key: string, coordinate: string) {
    setCoordinates((cs) => cs.map((c) => (c.key === key ? { ...c, coordinate } : c)));
  }
  function removeCoordinate(key: string) {
    setCoordinates((cs) => cs.filter((c) => c.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const typed = coordinates
        .filter((c) => c.coordinate.trim())
        .map((c, i) => ({ sno: i + 1, coordinate: c.coordinate.trim() }));

      // TODO(you): decide how "All Coordinates" interacts with the grid.
      // The legacy checkbox means "this component applies to *every* coordinate,"
      // which makes a specific list redundant. Return the coordinate rows to
      // persist given `form.all_coordinates`. Trade-off:
      //   (a) `return typed;`   → keep whatever the user typed (nothing is lost)
      //   (b) `return form.all_coordinates ? [] : typed;` → clean data, but a
      //        later un-tick loses the previously-typed list.
      // Default below keeps typed rows; change it to match how the ERP should behave.
      function resolveCoordinates(): { sno: number; coordinate: string }[] {
        return typed;
      }

      const payload: ComponentInput = {
        short_name: form.short_name.trim(),
        description: form.description.trim() || null,
        all_coordinates: form.all_coordinates,
        blocked: form.blocked,
        coordinates: resolveCoordinates(),
      };
      const res = editId ? await updateComponent(editId, payload) : await createComponent(payload);
      if (res.ok) {
        success(editId ? "Component updated." : "Component added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Component) {
    startTransition(async () => {
      const res = await deleteComponent(r.id);
      if (res.ok) {
        success("Component deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Component>[] = [
    { header: "Short Name", cell: (r) => <span className="text-sm font-medium">{r.short_name}</span> },
    {
      header: "Description",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.description ?? "—"}</span>,
    },
    {
      header: "Coordinates",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.all_coordinates
            ? "All"
            : r.coordinates.length
              ? r.coordinates.map((c) => c.coordinate).join(", ")
              : "—"}
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
          placeholder="Search component…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Component
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No component records yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No component records yet.
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
                    {r.short_name}
                  </div>
                  {r.description && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{r.description}</div>
                  )}
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Blocked" : "Active"}
                </StatusPill>
              </div>
              <div className="mt-2 text-[13px] text-muted-foreground">
                {r.all_coordinates
                  ? "All coordinates"
                  : r.coordinates.length
                    ? r.coordinates.map((c) => c.coordinate).join(", ")
                    : "No coordinates"}
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Component" : "New Component"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.short_name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="cmp-short">
              Short Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="cmp-short"
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>
          <div>
            <Label htmlFor="cmp-desc">Description</Label>
            <Input
              id="cmp-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.all_coordinates}
              onChange={(e) => setForm({ ...form, all_coordinates: e.target.checked })}
            />
            <span className="text-sm text-foreground">All Coordinates</span>
          </label>

          {/* Coordinates grid — hidden while "All Coordinates" is ticked */}
          {!form.all_coordinates && (
            <div className="rounded-lg border border-border">
              <div className="border-b border-border px-3 py-2.5">
                <span className="text-sm font-medium text-foreground">Coordinates</span>
              </div>
              <div className="space-y-2 p-3">
                {coordinates.length === 0 && (
                  <p className="text-xs text-muted-foreground">No coordinates yet.</p>
                )}
                {coordinates.map((c, i) => (
                  <div key={c.key} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <Input
                      value={c.coordinate}
                      onChange={(e) => setCoordinateAt(c.key, e.target.value)}
                      placeholder="Coordinate"
                      className="flex-1 text-base md:text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground hover:text-danger"
                      onClick={() => removeCoordinate(c.key)}
                      aria-label="Remove coordinate"
                    >
                      ✕
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addCoordinate}>
                  + Add line
                </Button>
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.blocked}
              onChange={(e) => setForm({ ...form, blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Blocked</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
