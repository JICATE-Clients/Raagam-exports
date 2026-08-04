"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, type FieldSize } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { AccountGroupPicker } from "@/components/masters/account-group-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import {
  createAccountGroup,
  updateAccountGroup,
  deleteAccountGroup,
} from "@/lib/masters/account-group-actions";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  NATURE_OF_GROUP,
  type AccountGroup,
  type AccountGroupInput,
  type NatureOfGroup,
} from "@/lib/masters/account-group-types";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { ACCOUNT_GROUP_NAMES } from "@/lib/masters/name-vocabularies";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({
  parent_id: null as string | null,
  short_name: "",
  name: "",
  nature_of_group: "" as "" | NatureOfGroup,
  debit_schedule_id: null as string | null,
  credit_schedule_id: null as string | null,
  inactive: false,
});

/**
 * How wide each field is on the 12-col track, sized to the data it holds.
 *
 * THE SPANS OF A ROW MUST SUM TO 12 — nothing in the build catches a row that
 * goes past it, the last field just wraps onto an otherwise empty line. This
 * screen was doing exactly that: parent 4 + name 6 + nature 4 = 14, so Nature
 * of Group sat alone on row 2.
 *
 *   row 1 — parent 3 + name 4 + nature 2 + debit_schedule 3 = 12
 *   row 2 — credit_schedule 3 + inactive 2 = 5  (inactive is edit-only)
 *
 * Four per row is the target (client 2026-07-29). The two Schedule pickers do
 * end up split across the two rows; they stay adjacent in tab order, and the
 * alternative — keeping the pair together — costs a whole field off row 1,
 * because legacy field ORDER is fixed here (see the section comment below).
 */
/**
 * ONE SIZE, EVERY FIELD: `sm` = 3 of 12 = four per row (client 2026-07-29) —
 * the City / State / Pin / Country shape, applied across the masters instead of
 * sizing each field to its own data. Rows here are 3+3+3+3 = 12 then 3+3 = 6.
 * See applicant-master-screen for the rule and what it trades away.
 */
const FIELD_SIZE = {
  parent_id: "sm",
  name: "sm",
  nature_of_group: "sm",
  debit_schedule_id: "sm",
  credit_schedule_id: "sm",
  inactive: "sm",
} satisfies Record<string, FieldSize>;

export function AccountGroupMasterScreen({
  rows,
  schedules,
  perms,
}: {
  rows: AccountGroup[];
  schedules: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const dupError = useDuplicateName({
    table: "account_groups",
    name: form.name,
    excludeId: editId ?? undefined,
    enabled: !!form.name.trim(),
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
    seed: ACCOUNT_GROUP_NAMES,
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, name: v })),
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.id, r.name);
    return m;
  }, [rows]);

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: AccountGroup) {
    setEditId(r.id);
    setForm({
      parent_id: r.parent_id,
      short_name: r.short_name ?? "",
      name: r.name,
      nature_of_group: r.nature_of_group ?? "",
      debit_schedule_id: r.debit_schedule_id,
      credit_schedule_id: r.credit_schedule_id,
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: AccountGroupInput = {
        parent_id: form.parent_id,
        // Create derives the code from Name; edit keeps the record's original
        // stored short_name (it can be a logic key referenced elsewhere).
        short_name: editId ? form.short_name || null : form.name.trim() || null,
        name: form.name.trim(),
        nature_of_group: form.nature_of_group ? form.nature_of_group : null,
        debit_schedule_id: form.debit_schedule_id,
        credit_schedule_id: form.credit_schedule_id,
        inactive: form.inactive,
      };
      const res = editId ? await updateAccountGroup(editId, payload) : await createAccountGroup(payload);
      if (res.ok) {
        success(editId ? "Account group updated." : "Account group added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: AccountGroup) {
    startTransition(async () => {
      const res = await deleteAccountGroup(r.id);
      if (res.ok) {
        success(deletedToast("Account group", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<AccountGroup>[] = [
    { header: "Name", cell: (r) => <span className="text-sm font-medium text-foreground">{r.name}</span> },
    {
      header: "Under",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.parent_id ? nameById.get(r.parent_id) ?? "—" : "—"}
        </span>
      ),
    },
    { header: "Nature", cell: (r) => <span className="text-sm">{r.nature_of_group ?? "—"}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [r.short_name, r.name, r.nature_of_group, r.parent_id ? nameById.get(r.parent_id) : null]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder="Search account group…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Account Group"
        onAdd={openAdd}
        columns={columns}
        actions={{ onEdit: openEdit, onDelete: remove }}
        empty="No account groups yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) =>
            `${r.nature_of_group ?? "—"}${r.parent_id ? ` · under ${nameById.get(r.parent_id) ?? "—"}` : ""}`,
          pill: (r) => (
            <StatusPill tone={r.inactive ? "danger" : "success"}>
              {r.inactive ? "Inactive" : "Active"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Account Group" : "New Account Group"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !!dupError || !form.name.trim()} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/* Six fields — one flat section (LAYOUT.md §4). Legacy field ORDER is
            preserved (Under first): these operators are migrating from
            RP-Software and type by muscle memory, so tab order is not ours to
            improve. The Inactive tick used to need a hand-tuned `mt-7` to clear
            the picker's label — on the 12-col track it just takes its own cell.
            Widths come from FIELD_SIZE at the top of this file. */}
        <DetailSection label="Details" cols={12}>
          {/* The pickers render their own labels — never double-label them. */}
          <Field size={FIELD_SIZE.parent_id}>
            <AccountGroupPicker
              groups={rows}
              value={form.parent_id}
              onChange={(id) => set({ parent_id: id })}
              excludeId={editId}
              label="Under"
            />
          </Field>
          <Field label="Name" size={FIELD_SIZE.name} required htmlFor="ag-name">
            <Input
              id="ag-name"
              uppercase
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              // ↓ into the suggestion strip, Enter applies, Esc dismisses.
              onKeyDown={nameSuggest.onKeyDown}
              {...dupFieldProps(dupError, "ag-name")}
            />
            <DuplicateError error={dupError} id="ag-name" />
            <SpellSuggestHint
              suggestions={nameSuggest.suggestions}
              existing={nameSuggest.existing}
              activeIndex={nameSuggest.activeIndex}
              duplicate={!!dupError}
              onApply={(v) => setForm((f) => ({ ...f, name: v }))}
            />
          </Field>
          <Field label="Nature of Group" size={FIELD_SIZE.nature_of_group} htmlFor="ag-nature">
            <Select
              id="ag-nature"
              value={form.nature_of_group}
              onChange={(e) => set({ nature_of_group: e.target.value as "" | NatureOfGroup })}
            >
              <option value="">— Select —</option>
              {NATURE_OF_GROUP.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field size={FIELD_SIZE.debit_schedule_id}>
            <LookupDialogPicker
              kind="account_schedule"
              label="Debit Schedule"
              options={schedules}
              value={form.debit_schedule_id}
              onChange={(id) => set({ debit_schedule_id: id })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
            />
          </Field>
          <Field size={FIELD_SIZE.credit_schedule_id}>
            <LookupDialogPicker
              kind="account_schedule"
              label="Credit Schedule"
              options={schedules}
              value={form.credit_schedule_id}
              onChange={(id) => set({ credit_schedule_id: id })}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
            />
          </Field>
          {editId && (
            <Field size={FIELD_SIZE.inactive}>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={form.inactive}
                  onChange={(e) => set({ inactive: e.target.checked })}
                />
                <span className="text-sm text-foreground">Inactive</span>
              </label>
            </Field>
          )}
        </DetailSection>
      </Sheet>
    </div>
  );
}
