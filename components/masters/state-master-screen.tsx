"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createState, updateState, deleteState } from "@/lib/masters/state-actions";
import type { State, StateInput } from "@/lib/masters/state-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({ code: "", name: "", is_default: false, inactive: false });

/**
 * Legacy "State" master (GST). Minimal code/name master: Code (GST state code) ·
 * Default · Inactive · State (name).
 */
export function StateMasterScreen({ rows, perms }: { rows: State[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.code, r.name].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: State) {
    setEditId(r.id);
    setForm({ code: r.code ?? "", name: r.name, is_default: r.is_default, inactive: r.inactive });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: StateInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        is_default: form.is_default,
        inactive: form.inactive,
      };
      const res = editId ? await updateState(editId, payload) : await createState(payload);
      if (res.ok) {
        success(editId ? "State updated." : "State added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: State) {
    startTransition(async () => {
      const res = await deleteState(r.id);
      if (res.ok) {
        success("State deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<State>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "State", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Default",
      cell: (r) =>
        r.is_default ? (
          <StatusPill tone="neutral">Default</StatusPill>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
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
          placeholder="Search state…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add State
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No states yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No states yet.
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.code ?? "—"}
                    {r.is_default ? " · Default" : ""}
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

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit State" : "New State"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="st-code">Code</Label>
              <ValidatedInput
                id="st-code"
                format="gst_state"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.is_default}
                  onChange={(e) => set({ is_default: e.target.checked })}
                />
                <span className="text-sm text-foreground">Default</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.inactive}
                  onChange={(e) => set({ inactive: e.target.checked })}
                />
                <span className="text-sm text-foreground">Inactive</span>
              </label>
            </div>
          </div>
          <div>
            <Label htmlFor="st-name">
              State <span className="text-danger">*</span>
            </Label>
            <Input
              id="st-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
