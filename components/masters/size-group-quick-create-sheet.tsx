"use client";

// Quick-create a COMPLETE Size Group from inside another form's Size Group
// picker — the name AND its sizes, not just the name.
//
// WHY IT CANNOT BE NAME-ONLY, which is the whole reason this file exists rather
// than a `manage` config on the picker. `sizeGroupInput` requires nothing at all
// (`size_group_name` is optional and `size_group_no` is generated), so an inline
// row would parse and save — and produce a group with no `size_group_sizes`
// children, which fills nothing. On the Style master that leaves "Fill sizes"
// disabled with a valid group selected: a create that appears to succeed and
// changes nothing on screen, which is worse than no create at all.
//
// That is exactly the case `RecordPicker`'s no-CRUD rule points at ("a name-only
// row for a Vendor would be born unusable"), so this is the rule being followed
// rather than waived — `onAddOverride` is the escape hatch it contemplates.
// Precedent: YarnQuickCreateSheet, GarmentQuickCreateSheet, CategoryQuickCreateSheet.

import { useEffect, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createSizeGroup, type ChildSize } from "@/lib/masters/size-group-actions";
import { useDuplicateCheck, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";

type SizeDraft = { key: string; name: string };

export function SizeGroupQuickCreateSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Fires with the new group's id and name so the caller can list + select it. */
  onCreated: (row: { id: string; name: string; sizes: ChildSize[] }) => void;
}) {
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [sizes, setSizes] = useState<SizeDraft[]>([]);
  const seq = useRefCounter();

  // Fresh form every time the sheet opens — a stale draft from a cancelled
  // create would be saved under whatever the operator typed next.
  useEffect(() => {
    if (open) {
      setName("");
      setSizes([{ key: seq(), name: "" }]);
    }
  }, [open, seq]);

  /* dup-check: server-only -- this sheet is opened FROM a Size Group picker and
     is never handed the group list, so there are no on-screen rows to scan. A
     late answer still catches the cursor (keyboard-nav-provider.tsx), and
     `createSizeGroup`'s own guard is what actually refuses the save. */
  const dupError = useDuplicateCheck({
    table: "size_groups",
    nameColumn: "size_group_name",
    label: "size group name",
    name,
    enabled: open && !!name.trim(),
  });

  const filled = sizes.map((s) => s.name.trim()).filter(Boolean);
  const canSave = !!name.trim() && filled.length > 0 && !dupError && !isPending;

  function save() {
    startTransition(async () => {
      const trimmed = name.trim();
      // `sort_order` from POSITION, not from the operator: the row order in this
      // list IS the size order (S before M before L), and asking for a number
      // beside each one invites a set that disagrees with what is on screen.
      const children: ChildSize[] = sizes
        .map((s) => s.name.trim())
        .filter(Boolean)
        .map((size_name, i) => ({ size_name, sort_order: i + 1 }));

      const res = await createSizeGroup(
        { size_group_no: null, size_group_name: trimmed, inactive: false },
        children,
      );
      if (!res.ok) {
        error(res.error);
        return;
      }
      success(`Size group "${trimmed}" created.`);
      onCreated({ id: res.id, name: trimmed, sizes: children });
      onClose();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New Size Group"
      size="sm"
      // Above MasterFullScreen (80) and level with the picker panel that opened
      // us — `DataPicker.startAdd` closes its list before handing over, which is
      // what keeps the two off screen together.
      zIndexBase={120}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={!canSave} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" required size="lg" htmlFor="sgq-name">
          <Input
            id="sgq-name"
            uppercase
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...dupFieldProps(dupError, "sgq-name")}
          />
        </Field>
        <DuplicateError error={dupError} id="sgq-name" />

        <div className="space-y-2">
          {/* required-star: exempt -- the requirement is on the LIST ("at least
              one size"), not on any one box, and `<Field required>` is a
              per-field marker: putting it on the first input would hold the
              cursor there even after the operator filled the second and cleared
              the first. Unlike the decoration this check exists to catch, this
              star HAS something behind it — `canSave` is gated on
              `filled.length > 0`, so Save genuinely refuses an empty list. */}
          <p className="text-sm font-medium text-foreground">Sizes <span className="text-danger">*</span></p>
          {/* A GROUP WITH NO SIZES IS THE FAILURE THIS SHEET EXISTS TO PREVENT,
              so Save is gated on at least one — and the list opens with a blank
              row, because entering the first size must cost no click (the same
              `seedRow` rule ChildGrid follows). */}
          {sizes.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <Input
                uppercase
                aria-label={`Size ${i + 1}`}
                value={s.name}
                onChange={(e) =>
                  setSizes((xs) =>
                    xs.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Remove size ${i + 1}`}
                data-row-remove
                disabled={sizes.length === 1}
                onClick={() => setSizes((xs) => xs.filter((x) => x.key !== s.key))}
                className="rounded p-1 text-muted-foreground hover:text-danger disabled:opacity-30"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            tabIndex={-1}
            data-row-add
            onClick={() => setSizes((xs) => [...xs, { key: seq(), name: "" }])}
            className="flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-primary hover:bg-surface-muted"
          >
            <Plus className="h-4 w-4 shrink-0" />
            Add size
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Keys for the size rows. A counter rather than the index, so removing a row
 *  above does not re-key the ones below and blur the box being typed in. */
function useRefCounter() {
  const [n] = useState(() => ({ v: 0 }));
  return () => `sg${n.v++}`;
}
