"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { DetailSection } from "@/components/masters/detail-section";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import type { Column } from "@/components/ui/data-table";
import {
  createSizeGroup,
  updateSizeGroup,
  deactivateSizeGroup,
} from "@/lib/masters/size-group-actions";
import type { SizeGroup } from "@/lib/masters/size-group-types";

/**
 * Size Groups — a named, ordered set of sizes (S · M · L · XL).
 *
 * RESTORED 2026-08-10, deleted in `129c59f`. Rewritten rather than recovered:
 * the deleted screen predated the current conventions (a hand-rolled grid driven
 * by `gridKeyNav`, bare `Label`/`Input` pairs, no `Field`), so restoring it would
 * have reintroduced exactly what `audit_layout.py` exists to catch.
 *
 * The consumer is the Style master, which fills a style's sizes from a group.
 * The group is a SHORTCUT: a style keeps its own size rows, so editing a group
 * here cannot silently restate what a closed style was made in.
 */

type Perms = {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport?: boolean;
  canImport?: boolean;
};

type ChildRow = { key: string; size_name: string };

const BLANK = { size_group_no: "", size_group_name: "", inactive: false };

export function SizeGroupMasterScreen({ rows, perms }: { rows: SizeGroup[]; perms: Perms }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [childRows, setChildRows] = useState<ChildRow[]>([]);
  const keyRef = useRef(0);
  const nextKey = () => `sg-${++keyRef.current}`;

  /**
   * "Already exists" WHILE the operator types.
   *
   * On the NAME, not the code: `generateUniqueCode` suffixes on collision, so a
   * `unique(size_group_no)` constraint can never fire and two groups called
   * "MENS TOP S-XXL" would both save. The server action guards the same column.
   *
   * `rows` is passed so the check answers in the SAME render as the keystroke —
   * the cursor hold is a keydown-time test, and an answer 300ms later has
   * already lost the cursor.
   */
  const dupError = useDuplicateName({
    table: "size_groups",
    name: form.size_group_name,
    nameColumn: "size_group_name",
    excludeId: editId ?? undefined,
    enabled: !!form.size_group_name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.size_group_name ?? "",
    label: "name",
  });

  const columns: Column<SizeGroup>[] = [
    {
      header: "Name",
      cell: (r) => <span className="text-sm">{r.size_group_name ?? "—"}</span>,
    },
    {
      header: "Sizes",
      cell: (r) => (
        // The whole point of a group, so it is the column worth showing: the set
        // itself, in order, rather than a count the operator has to open to read.
        <span className="text-sm text-muted-foreground">
          {[...(r.sizes ?? [])]
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((s) => s.size_name)
            .join(" · ") || "—"}
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
    // No Created column here — MasterListShell splices the Created Date / User
    // pair itself and strips a hand-rolled one. `listSizeGroups` already runs
    // through `withCreators()`.
  ];

  const childColumns: ChildGridColumn<ChildRow>[] = [
    {
      header: "Size",
      required: true,
      cell: (r) => (
        <Input
          uppercase
          value={r.size_name}
          onChange={(e) =>
            setChildRows((xs) =>
              xs.map((x) => (x.key === r.key ? { ...x, size_name: e.target.value } : x)),
            )
          }
          placeholder="S"
        />
      ),
    },
  ];

  function openAdd() {
    setEditId(null);
    setForm(BLANK);
    setChildRows([{ key: nextKey(), size_name: "" }]);
    setOpen(true);
  }

  function openEdit(r: SizeGroup) {
    setEditId(r.id);
    setForm({
      size_group_no: r.size_group_no ?? "",
      size_group_name: r.size_group_name ?? "",
      inactive: r.inactive,
    });
    // `sort_order` is what makes a size SET rather than a bag — S before M
    // before L. The service selects it but does not order by it, so order here.
    setChildRows(
      [...(r.sizes ?? [])]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((s) => ({ key: nextKey(), size_name: s.size_name })),
    );
    setOpen(true);
  }

  function submit() {
    start(async () => {
      // The grid's own order IS the sort order; the action renumbers 1..n.
      const children = childRows
        .filter((c) => c.size_name.trim())
        .map((c, i) => ({ size_name: c.size_name.trim(), sort_order: i + 1 }));
      const res = editId
        ? await updateSizeGroup(editId, form, children)
        : await createSizeGroup(form, children);
      if (res.ok) {
        success(editId ? "Size group updated" : "Size group created");
        setOpen(false);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function remove(r: SizeGroup) {
    start(async () => {
      const res = await deactivateSizeGroup(r.id);
      if (res.ok) {
        success("Size group deactivated");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const canSave = !!form.size_group_name.trim() && !dupError;

  return (
    <>
      <MasterListShell<SizeGroup>
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [r.size_group_no, r.size_group_name, ...(r.sizes ?? []).map((s) => s.size_name)]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder="Search size groups…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        columns={columns}
        addLabel="+ Add Size Group"
        onAdd={openAdd}
        actions={{ onEdit: openEdit, onDelete: remove }}
        rowLabel={(r) => r.size_group_name ?? "size group"}
        mobile={{
          title: (r) => r.size_group_name ?? "—",
          meta: (r) =>
            [...(r.sizes ?? [])]
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              .map((s) => s.size_name)
              .join(" · "),
        }}
        empty="No size groups yet. Use “+ Add Size Group” to create the first."
        isPending={isPending}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Size Group" : "New Size Group"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save size group"}
            </Button>
          </>
        }
      >
        <DetailSection label="Details" cols={12}>
          <FieldGrid>
            {/* No code field — codes are derived from the name and hidden from
                the UI (client 2026-07-23). */}
            <Field label="Name" required size="lg" htmlFor="sg-name">
              <Input
                id="sg-name"
                uppercase
                value={form.size_group_name}
                onChange={(e) => setForm({ ...form, size_group_name: e.target.value })}
                placeholder="MENS TOP S-XXL"
                {...dupFieldProps(dupError, "sg-name")}
              />
              <DuplicateError error={dupError} id="sg-name" />
            </Field>
            {/* Inactive is edit-only: a group being created is not one being
                switched off. */}
            {editId && (
              <Field label="Inactive" size="sm" htmlFor="sg-inactive">
                <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
                  <input
                    id="sg-inactive"
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.inactive}
                    onChange={(e) => setForm({ ...form, inactive: e.target.checked })}
                  />
                  <span className="text-sm text-foreground">Yes</span>
                </label>
              </Field>
            )}
          </FieldGrid>
        </DetailSection>

        <DetailSection label="Sizes">
          {/* `frameless` — the section already draws the border and names it.
              Row ORDER is the size order, so no sort column: the operator reads
              S · M · L down the grid and that is what a style gets filled with. */}
          <ChildGrid<ChildRow>
            columns={childColumns}
            rows={childRows}
            frameless
            inlineCards
            onAdd={() => setChildRows((xs) => [...xs, { key: nextKey(), size_name: "" }])}
            onRemove={(r) => setChildRows((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add size"
          />
        </DetailSection>
      </Sheet>
    </>
  );
}
