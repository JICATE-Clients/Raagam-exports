"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import { createBank, updateBank, deleteBank } from "@/lib/masters/bank-actions";
import { BANK_TYPES, type Bank, type BankInput, type BankType } from "@/lib/masters/bank-types";

/**
 * The Bank field (Applicant, Consignee, Customer …).
 *
 * A `DataPicker` plus a quick-create sheet for Add / Modify: a Bank owns a type
 * and a branch list, so the picker's inline name-only form would create one no
 * payment could actually use. Config lists take the inline path; anything with
 * real fields takes this one (client 2026-07-29).
 */
export function BankPicker({
  label = "Bank",
  banks,
  value,
  onChange,
  canCreate,
  canEdit,
  canDelete,
  compact = false,
}: {
  label?: string;
  banks: Bank[];
  value: string | null;
  onChange: (id: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  /** Defaults to `canEdit` — see the note in `lookup-dialog-picker.tsx`. */
  canDelete?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, start] = useTransition();

  const [extra, setExtra] = useState<Bank[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);

  const all = useMemo(() => {
    const byId = new Map<string, Bank>();
    for (const b of banks) byId.set(b.id, b);
    for (const b of extra) byId.set(b.id, b);
    for (const id of removed) byId.delete(id);
    return [...byId.values()];
  }, [banks, extra, removed]);

  const rows: PickerRow[] = useMemo(
    () =>
      [...all]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({ id: b.id, label: b.name, sublabel: b.bank_type })),
    [all],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [formEditId, setFormEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [bankType, setBankType] = useState<"" | BankType>("");
  const [inactive, setInactive] = useState(false);
  // The picker hands us its `commit` so a save selects the row and closes the
  // list in one step. A ref because the sheet outlives the callback.
  const commitRef = useRef<((id: string) => void) | null>(null);

  function openAdd(commit: (id: string) => void) {
    commitRef.current = commit;
    setFormEditId(null);
    setCode("");
    setName("");
    setBankType("");
    setInactive(false);
    setFormOpen(true);
  }
  function openEdit(row: PickerRow, commit: (id: string) => void) {
    const b = all.find((x) => x.id === row.id);
    if (!b) return;
    commitRef.current = commit;
    setFormEditId(b.id);
    setCode(b.code ?? "");
    setName(b.name);
    setBankType(b.bank_type ?? "");
    setInactive(b.inactive);
    setFormOpen(true);
  }

  function saveForm() {
    start(async () => {
      // Branches are carried over by hand because `updateBank` replaces them
      // wholesale — this sheet edits the header only, and passing an empty list
      // would silently delete every IFSC on the bank.
      const base = formEditId ? all.find((b) => b.id === formEditId) : null;
      const branches: BankInput["branches"] = (base?.branches ?? []).map((br) => ({
        sno: br.sno,
        country_id: br.country_id,
        state: br.state,
        city: br.city,
        pin: br.pin,
        street: br.street,
        land_line: br.land_line,
        mobile: br.mobile,
        whatsapp: br.whatsapp,
        email: br.email,
        swift_rtgs_code: br.swift_rtgs_code,
        current_acc_no: br.current_acc_no,
        ifs_code: br.ifs_code,
      }));
      const payload: BankInput = {
        code: code.trim() || null,
        bank_type: bankType ? bankType : null,
        name: name.trim(),
        inactive,
        branches,
      };
      if (formEditId) {
        const res = await updateBank(formEditId, payload);
        if (!res.ok) return error(res.error);
        if (base) {
          setExtra((xs) => [
            ...xs.filter((b) => b.id !== formEditId),
            { ...base, ...payload, id: formEditId, branches: base.branches },
          ]);
        }
        success(`${label} updated.`);
      } else {
        const res = await createBank(payload);
        if (!res.ok) return error(res.error);
        const newId = res.id;
        if (newId) {
          setExtra((xs) => [
            ...xs,
            { ...payload, id: newId, branches: [], created_at: "", updated_at: "" } as unknown as Bank,
          ]);
          commitRef.current?.(newId);
        }
        success(`${label} added.`);
      }
      setFormOpen(false);
      router.refresh();
    });
  }

  const manage: ManageConfig = {
    canCreate,
    canEdit,
    canDelete: canDelete ?? canEdit,
    // Unreachable — both overrides below intercept first. Present because
    // ManageConfig is also what decides which row icons render.
    onCreate: async () => ({ ok: false, error: "Use the Bank form." }),
    onUpdate: async () => ({ ok: false, error: "Use the Bank form." }),
    onDelete: (id) => deleteBank(id),
    onCreated: () => {},
    onUpdated: () => {},
    onDeleted: (id, wasDeactivated) => {
      setRemoved((xs) => [...xs, id]);
      if (!wasDeactivated) setExtra((xs) => xs.filter((b) => b.id !== id));
      router.refresh();
    },
    draftOf: (r) => ({ code: all.find((b) => b.id === r.id)?.code ?? "", name: r.label }),
  };

  return (
    <>
      <DataPicker
        label={label}
        rows={rows}
        value={value}
        onChange={(id) => onChange(id ?? "")}
        clearable={false}
        compact={compact}
        manage={manage}
        onAddOverride={openAdd}
        onEditOverride={openEdit}
      />

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="sm"
        title={formEditId ? `Modify ${label}` : `Add ${label}`}
        footer={
          <>
            <Button type="button" variant="outline" size="md" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="md" disabled={isPending || !name.trim()} onClick={saveForm}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="bp-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="bp-name"
              autoFocus
              uppercase
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bp-code">Code</Label>
              <Input id="bp-code" uppercase value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="bp-type">Type</Label>
              <Select
                id="bp-type"
                value={bankType}
                onChange={(e) => setBankType(e.target.value as "" | BankType)}
              >
                <option value="">— Select —</option>
                {BANK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={inactive}
              onChange={(e) => setInactive(e.target.checked)}
            />
            <span className="text-sm text-foreground">Inactive</span>
          </label>
          {/* Saying where the branch fields are beats an operator hunting this
              sheet for the IFSC box. */}
          <p className="text-xs text-muted-foreground">
            Branches and IFSC codes are maintained on the Bank master.
          </p>
        </div>
      </Sheet>
    </>
  );
}
