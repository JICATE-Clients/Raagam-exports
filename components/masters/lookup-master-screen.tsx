"use client";
import { deletedToast } from "@/lib/masters/delete-message";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { Input } from "@/components/ui/input";
import { Field, FieldRow, type FieldWidth } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createLookup, updateLookup, deleteLookup } from "@/lib/masters/extras-actions";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { lookupLabel, type ConfigLookup, type LookupKind } from "@/lib/masters/extras-types";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const BLANK = { code: "", name: "", notes: "", is_active: true };

/**
 * WIDTHS, NOT TWELFTHS (erp-form-compact). One screen for every
 * `config_lookups` kind — a city, a composition, a payment term — so the name
 * is free text of no fixed length: `name` (288px), and Notes matches it. This
 * was `sm:grid-cols-2`, which gave the name half the sheet and Notes all of it.
 */
const FIELD_W = {
  name: "name", //  288px — free-text name, any lookup kind
  notes: "name", // 288px — same edge as the name above it
} satisfies Record<string, FieldWidth>;

/** The fields AND the footer's buttons end on one edge: 288px → 18rem. */
const FORM_W = "max-w-[18rem]";

/**
 * Generic CRUD screen for one `config_lookups` kind. Search + a dense table on
 * desktop, stacked record cards on mobile, and a shared <Sheet> editor
 * (right drawer ≥md, bottom sheet on phones).
 */
export function LookupMasterScreen({
  kind,
  singular,
  rows,
  perms,
}: {
  kind: LookupKind;
  singular: string;
  rows: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  // Real-time duplicate check on Name, scoped to this kind (mirrors the
  // on-save guard in extras-actions createLookup/updateLookup).
  const dupError = useDuplicateName({
    table: "config_lookups",
    name: form.name ?? "",
    scope: { kind },
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
    // No `rowInScope`: this shell is rendered per `kind`, so its rows are
    // already exactly the scope above.
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  /**
   * "Did you mean?" — dupError above only fires on an EXACT collision, so a
   * one-character miss sails past it and becomes a second row meaning the same
   * thing as the first. Advisory only: the typed text saves as typed unless the
   * operator accepts a chip. Suppressed while the red error shows — one line
   * under the input, and the name it collided with is the one that is no use.
   */
  const nameSuggest = useSpellSuggest({
    name: form.name ?? "",
    // The row being edited must not suggest its own name back at you.
    names: rows.filter((r) => r.id !== editId).map((r) => r.name ?? "").filter(Boolean),
    // No curated vocabulary: this master has no real-world standard to draw
    // on, so the rows beside what is being typed are the only safe candidates.
    seed: [],
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.notes].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(r: ConfigLookup) {
    setEditId(r.id);
    setForm({ code: r.code ?? "", name: r.name, notes: r.notes ?? "", is_active: r.is_active });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload = {
        kind,
        code: form.code.trim() || null,
        name: form.name.trim(),
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      };
      const res = editId ? await updateLookup(editId, payload) : await createLookup(payload);
      if (res.ok) {
        success(editId ? `${singular} updated.` : `${singular} added.`);
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: ConfigLookup) {
    startTransition(async () => {
      const res = await deleteLookup(r.id);
      if (res.ok) {
        success(deletedToast(singular, res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<ConfigLookup>[] = [
    // Same label the pickers show, so the list you maintain the values in reads
    // exactly like the field that offers them — Ship Type carries its Incoterm,
    // every other kind is the bare name (lookupLabel). The editor below still
    // loads and saves the raw `name`.
    { header: "Name", cell: (r) => <span className="text-sm">{lookupLabel(kind, r)}</span> },
    {
      header: "Notes",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.notes ?? "—"}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "neutral"}>
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
        <Input
          uppercase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${singular.toLowerCase()}…`}
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add {singular}
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(r) => r.id}
          empty={`No ${singular.toLowerCase()} records yet.`}
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No {singular.toLowerCase()} records yet.
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
                  <Truncated className="text-[15px] font-semibold text-foreground">{lookupLabel(kind, r)}</Truncated>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
                </div>
                <StatusPill tone={r.is_active ? "success" : "neutral"}>
                  {r.is_active ? "Active" : "Inactive"}
                </StatusPill>
              </div>
              {r.notes && <div className="mt-2 text-[13px] text-muted-foreground">{r.notes}</div>}
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${singular}` : `New ${singular}`}
        footer={
          /* `mr-auto` parks this box at the footer's left, so the buttons end
             where the fields end. Same `FORM_W`. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !form.name.trim() || !!dupError} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        <div className={`space-y-3 ${FORM_W}`}>
          {/* No Code input — the code is set automatically (blank → name server-side
              on create; edits keep the stored code via form.code passing through). */}
          <FieldRow align="start">
          <Field label="Name" required w={FIELD_W.name} htmlFor="lk-name">
            <Input
              id="lk-name"
              uppercase
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="text-base md:text-sm"
              // ↓ into the suggestion strip, Enter applies, Esc dismisses.
              onKeyDown={nameSuggest.onKeyDown}
              {...dupFieldProps(dupError, "lk-name")}
            />
            <DuplicateError error={dupError} id="lk-name" />
            <SpellSuggestHint
              suggestions={nameSuggest.suggestions}
              existing={nameSuggest.existing}
              activeIndex={nameSuggest.activeIndex}
              duplicate={!!dupError}
              onApply={(v) => setForm((f) => ({ ...f, name: v }))}
            />
          </Field>
          </FieldRow>
          <FieldRow>
          <Field label="Notes" w={FIELD_W.notes} htmlFor="lk-notes">
            <Textarea
              id="lk-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="text-base md:text-sm"
            />
          </Field>
          </FieldRow>
          {editId && (
            <FieldRow>
              <Toggle
                id="lk-active"
                label="Active"
                checked={form.is_active}
                onChange={(is_active) => setForm({ ...form, is_active })}
              />
            </FieldRow>
          )}
        </div>
      </Sheet>
    </div>
  );
}
