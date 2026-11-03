"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useToast } from "@/components/ui/toast";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import { createBinInCurrentUnit } from "@/lib/masters/bin-actions";
import { dupFieldProps, useDuplicateName } from "@/lib/masters/use-duplicate-check";

type BinRow = { id: string; code: string; description?: string | null; inactive?: boolean };

/**
 * Picker over the `bins` master — every bin box on the receiving screens (GRN entry, Edit
 * GRN, Pending QC). An adapter over the ONE picker (`components/ui/data-picker.tsx`,
 * doc/ui/LAYOUT.md §5a); do not add a second picker shell.
 *
 * "+ Add" OPENS THE "Add Bin" FORM — the app's own pattern (user 2026-11-02, screenshot
 * 3970: "we are using only Enter for adding new — see the existing module, fix it, and
 * globally never again"). The first cut used the picker's inline add, where the text typed
 * into the SEARCH became a bin on Enter: an operator who typed a qty into the bin box made a
 * bin called "34". Like `BankPicker`, `CountryPicker` and the quick-create sheets, the list's
 * "+ Add" now hands off (`onAddOverride`) to a small sheet with the master's own fields and
 * a Save button; nothing is created by a keystroke aimed at searching.
 *
 * The bin is made in the WORKING unit (`createBinInCurrentUnit`) through `createBin`'s
 * rules. Add only — renaming or removing a rack is Master Data's job, not a mid-receipt one.
 *
 * THE ROWS ARE THE FORM'S: a bin added on one line must be offered on the next line and in a
 * split straight away, so `onCreated` hands it to the form, which owns the list.
 */
export function BinPicker({
  label,
  bins,
  value,
  onChange,
  onCreated,
  canCreate = false,
  compact = true,
  className,
  usedIds,
  invalid = false,
  storeId = null,
}: {
  label: string;
  bins: BinRow[];
  value: string;
  onChange: (id: string) => void;
  /** `store_id` comes back too, so a list filtered by store (0800) shows the new bin at once. */
  onCreated?: (bin: { id: string; code: string; store_id: string | null }) => void;
  canCreate?: boolean;
  compact?: boolean;
  className?: string;
  /** PICK ONCE: the bins already on this line (this row's own included) — a bin is not
   *  offered twice in one split (user 2026-11-02, screenshot 3973). */
  usedIds?: string[];
  /** Red border + aria-invalid — holds Enter on the box (DataPicker's `invalid`). */
  invalid?: boolean;
  /** The store this box picks into (0800): "+ Add" makes the bin in it. */
  storeId?: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const commitRef = useRef<((id: string) => void) | null>(null);

  const rows: PickerRow[] = useMemo(
    // Disabled rows (AGENTS.md): DataPicker hides an inactive bin unless it is the value held.
    () => bins.map((b) => ({ id: b.id, label: b.code, sublabel: b.description ?? null, inactive: !!b.inactive })),
    [bins],
  );

  // "Already exists" WHILE typing — the bins on screen answer at once, the server after.
  const dupError = useDuplicateName<BinRow>({
    table: "bins",
    name: code,
    nameColumn: "bin_code",
    label: "bin code",
    enabled: formOpen,
    rows: bins,
    rowId: (r) => r.id,
    rowValue: (r) => r.code,
  });

  function openAdd(commit: (id: string) => void) {
    commitRef.current = commit;
    setCode("");
    setDescription("");
    setFormOpen(true);
  }

  function save() {
    const c = code.trim().toUpperCase();
    if (!c || dupError) return;
    start(async () => {
      const res = await createBinInCurrentUnit(c, description.trim() || null, storeId);
      if (!res.ok) return toastError(res.error);
      onCreated?.({ id: res.id, code: c, store_id: storeId });
      commitRef.current?.(res.id);
      success(`Bin ${c} added.`);
      setFormOpen(false);
      router.refresh();
    });
  }

  const manage: ManageConfig = {
    canCreate,
    canEdit: false,
    canDelete: false,
    // Unreachable — `onAddOverride` intercepts "+ Add" first. Present because ManageConfig
    // is also what decides which row icons render.
    onCreate: async () => ({ ok: false, error: "Use the Add Bin form." }),
    onUpdate: async () => ({ ok: false, error: "Rename a bin in Master Data." }),
    onDelete: async () => ({ ok: false, error: "Remove a bin in Master Data." }),
    onCreated: () => {},
    onUpdated: () => {},
    onDeleted: () => {},
    draftOf: (row) => ({ code: "", name: row.label }),
  };

  return (
    <div className={className}>
      <DataPicker
        label={label}
        // The panel's words ("+ Add bin", "No bin found.") stay SHORT — `label` carries the
        // row's item for the screen reader, and spelled out in the list it read "+ Add another
        // bin, poly bag / master / hp / 10cm …" (user 2026-11-02, screenshot 3972).
        title="Bin"
        rows={rows}
        usedIds={usedIds}
        value={value || null}
        onChange={(v) => onChange(v ?? "")}
        clearable
        invalid={invalid}
        compact={compact}
        manage={manage}
        onAddOverride={canCreate ? openAdd : undefined}
      />

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="sm"
        alignToPane
        title="Add Bin"
        footer={
          <div data-focus-region="footer" className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={isPending || !code.trim() || !!dupError} onClick={save}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Bin Code" required htmlFor="bp-bin-code">
            <Input
              id="bp-bin-code"
              autoFocus
              value={code}
              {...dupFieldProps(dupError, "bp-bin-code")}
              onChange={(e) => setCode(e.target.value)}
            />
            <DuplicateError error={dupError} id="bp-bin-code" />
          </Field>
          <Field label="Description" htmlFor="bp-bin-desc">
            <Input id="bp-bin-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <p className="text-xs text-muted-foreground">Made in the unit you are working in. Rename or block a bin on the Bin master.</p>
        </div>
      </Sheet>
    </div>
  );
}
