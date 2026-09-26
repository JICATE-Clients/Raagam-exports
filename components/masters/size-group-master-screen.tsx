"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { normName } from "@/lib/masters/name-dictionary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldRow, FIELD_WIDTH_CSS, type FieldWidth } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import { Sheet } from "@/components/ui/sheet";
import { DetailSection } from "@/components/masters/detail-section";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
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

/**
 * WIDTHS, NOT TWELFTHS (erp-form-compact). Name was `size="lg"` — half an
 * ~1180px sheet for "MENS TOP S-XXL" — and the Sizes grid spread one column
 * holding "S" / "XXL" across the full sheet.
 */
const FIELD_W = {
  name: "party", // 200px — a group label, ~15 capitals ("MENS TOP S-XXL")
} satisfies Record<string, FieldWidth>;

/** One size per row: S, XL, 3-4Y — a short word, so `code` (144px). */
const SIZE_W = FIELD_WIDTH_CSS.code;

/**
 * NAME AND SIZES ON ONE LINE (client 2026-09-26: "i want same line name and
 * size filed"). The two cards sit side by side, each at ONE width:
 *
 *   Details — name 200 + 2 × 8 card padding + 2 × 1 border = 218
 *   Sizes   — `#` + size 144 + ✕ ≈ 216, same card chrome   ≈ 234
 *
 * 16rem (256px) holds the wider of the two, with room for the non-compact
 * `p-2.5` density. Equal widths, so the pair reads as one form rather than a
 * big card and a small one. `max-w-full` lets a phone take the whole width,
 * where the flex row wraps the Sizes card under the Details card.
 */
const CARD_W = "w-[16rem] max-w-full";

/**
 * THE FOOTER'S BUTTONS END WHERE THE PAIR ENDS: two cards + the 12px gap
 * between them = 256 + 12 + 256 = 524 → 33rem (528px).
 */
const FORM_W = "max-w-[33rem]";

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

  /**
   * The near miss the guard above cannot see.
   *
   * `useDuplicateName` fires on an EXACT match, so "MENS TOP S-XL" typed beside
   * an existing "MENS TOP S-XXL" saves silently and the two groups mean the
   * same thing forever after. Scoped exactly as the duplicate check is scoped —
   * same rows, same exclusion of the row being edited — which is what makes
   * "already a row" mean "the guard is about to reject this".
   *
   * `seed: []`, deliberately. There is no real-world vocabulary of size-group
   * names; they are this factory's own labels for its own size runs. So the
   * strip here is a pure warning — every candidate is a row, nothing reaches
   * the chips — and that is the honest behaviour of a screen with no
   * vocabulary, not a gap to fill by inventing one (LAYOUT.md §"Near misses").
   *
   * `enabled: open`, not `!dupError`: a duplicate is exactly when the operator
   * most needs to be told which existing name they are near.
   */
  const nameSuggest = useSpellSuggest({
    name: form.size_group_name,
    names: rows
      .filter((r) => r.id !== editId)
      .map((r) => r.size_group_name ?? "")
      .filter(Boolean),
    seed: [],
    enabled: open,
    onApply: (v) => setForm((f) => ({ ...f, size_group_name: v })),
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

  /**
   * THE SAME SIZE TWICE IN ONE GROUP, caught as it is typed.
   *
   * The parent NAME has had a duplicate check since this screen was written; the
   * sizes under it had none at any layer, so `MENS TOP -> S, M, S` saved
   * cleanly. It then failed silently rather than loudly: the Style master's
   * "Fill sizes" builds a name->id `Map`, so the third row just disappears when
   * the group is used, with nothing said to anyone.
   *
   * `normName` is the shared normaliser — trim, collapse inner whitespace,
   * uppercase — so this agrees exactly with the server guard and with 0425's
   * unique index. Comparing raw text here would let "S " and "S" both stand.
   */
  const duplicateSizeKeys = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of childRows) {
      const key = normName(r.size_name);
      if (!key) continue; // a blank row is not a duplicate; the action drops it
      if (seen.has(key)) dup.add(key);
      else seen.add(key);
    }
    return dup;
  }, [childRows]);

  const hasDuplicateSize = duplicateSizeKeys.size > 0;

  const childColumns: ChildGridColumn<ChildRow>[] = [
    {
      header: "Size",
      width: SIZE_W,
      required: true,
      cell: (r) => {
        const dup = duplicateSizeKeys.has(normName(r.size_name));
        return (
          <div>
            <Input
              uppercase
              value={r.size_name}
              onChange={(e) =>
                setChildRows((xs) =>
                  xs.map((x) => (x.key === r.key ? { ...x, size_name: e.target.value } : x)),
                )
              }
              placeholder="S"
              /**
               * `aria-invalid` + a red border, and deliberately NOT
               * `dupFieldProps`. That helper stamps `data-dup-error`, which is
               * the CURSOR HOLD — and holding here would trap the operator in
               * the second cell, because neither value is wrong on its own. It
               * is the pair that is wrong, and the pair is fixed by editing
               * EITHER box. Save is blocked instead, which refuses the record
               * without refusing movement. Same choice, same reason, as the
               * Material Attribute values grid.
               */
              aria-invalid={dup ? true : undefined}
              className={cn(dup && "border-danger")}
            />
            {/* Both copies are flagged, not only the later one — the operator is
                as likely to want to retype the first. */}
            {dup && (
              <p className="mt-1 text-xs text-danger">Already listed in this group</p>
            )}
          </div>
        );
      },
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

  const canSave = !!form.size_group_name.trim() && !dupError && !hasDuplicateSize;

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
          /* `mr-auto` parks this box at the footer's left, so the buttons end
             where the Sizes card ends — FORM_W is the pair's width. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending || !canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save size group"}
            </Button>
          </div>
        }
      >
        {/* Side by side, top-aligned: the Sizes card grows downward as rows are
            added, and the Details card stays put beside its first row. */}
        <div className="flex flex-wrap items-start gap-3">
        <DetailSection label="Details" cols={1} className={CARD_W}>
          <FieldRow>
            {/* No code field — codes are derived from the name and hidden from
                the UI (client 2026-07-23). */}
            <Field label="Name" required w={FIELD_W.name} htmlFor="sg-name">
              <Input
                id="sg-name"
                uppercase
                value={form.size_group_name}
                onChange={(e) => setForm({ ...form, size_group_name: e.target.value })}
                placeholder="MENS TOP S-XXL"
                // ↓ into the suggestion strip, Enter applies, Esc dismisses.
                onKeyDown={nameSuggest.onKeyDown}
                {...dupFieldProps(dupError, "sg-name")}
              />
              <DuplicateError error={dupError} id="sg-name" />
              <SpellSuggestHint
                suggestions={nameSuggest.suggestions}
                existing={nameSuggest.existing}
                activeIndex={nameSuggest.activeIndex}
                duplicate={!!dupError}
                onApply={(v) => setForm((f) => ({ ...f, size_group_name: v }))}
              />
            </Field>
          </FieldRow>
          {/* Inactive is edit-only: a group being created is not one being
              switched off. Its own row, and a `Toggle` rather than a tick box
              labelled "Yes" — the switch already says yes or no, so it is
              labelled with the THING. Still a real checkbox underneath, so
              Tab / Enter / Space reach it. */}
          {editId && (
            <FieldRow>
              <Toggle
                id="sg-inactive"
                label="Inactive"
                checked={form.inactive}
                onChange={(inactive) => setForm((f) => ({ ...f, inactive }))}
              />
            </FieldRow>
          )}
        </DetailSection>

        {/* Capped to the form (rule 4): a one-column grid of "S" / "XL" does not
            get the sheet's width. The column's own `width` is SIZE_W. */}
        <DetailSection label="Sizes" className={CARD_W}>
          {/* `frameless` — the section already draws the border and names it.
              Row ORDER is the size order, so no sort column: the operator reads
              S · M · L down the grid and that is what a style gets filled with. */}
          <ChildGrid<ChildRow>
            lockExisting
            columns={childColumns}
            rows={childRows}
            frameless
            inlineCards
            onAdd={() => setChildRows((xs) => [...xs, { key: nextKey(), size_name: "" }])}
            onRemove={(r) => setChildRows((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add size"
          />
        </DetailSection>
        </div>
      </Sheet>
    </>
  );
}
