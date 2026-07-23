"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createBank, updateBank } from "@/lib/masters/bank-actions";
import { BANK_TYPES, type Bank, type BankInput, type BankType } from "@/lib/masters/bank-types";

/**
 * The legacy blue ⓘ Bank popup, over the `banks` master (master-detail): a
 * searchable grid with Add / Modify / OK / Cancel. `value` is the bank **id**.
 *
 * Add/Modify here only edit the bank *header* (Code · Foreign/Local · Name ·
 * Inactive) — the branch grid is edited on the full Bank master screen. On
 * Modify the bank's existing branches are passed back unchanged so the
 * wholesale branch-replace in updateBank does not wipe them.
 */
export function BankPicker({
  label = "Bank",
  banks,
  value,
  onChange,
  canCreate,
  canEdit,
  compact = false,
}: {
  label?: string;
  banks: Bank[];
  value: string | null;
  onChange: (id: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [formEditId, setFormEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [bankType, setBankType] = useState<"" | BankType>("");
  const [name, setName] = useState("");
  const [inactive, setBlocked] = useState(false);

  const selected = banks.find((b) => b.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? banks.filter((b) => [b.code, b.name].filter(Boolean).join(" ").toLowerCase().includes(q))
      : banks;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [banks, query]);

  function openDialog() {
    setHighlight(value);
    setQuery("");
    setMode("list");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setMode("list");
  }
  function confirmSelection() {
    if (highlight) onChange(highlight);
    close();
  }

  function startAdd() {
    setFormEditId(null);
    setCode("");
    setBankType("");
    setName("");
    setBlocked(false);
    setMode("form");
  }
  function startModify() {
    const b = banks.find((x) => x.id === highlight);
    if (!b) return;
    setFormEditId(b.id);
    setCode(b.code ?? "");
    setBankType(b.bank_type ?? "");
    setName(b.name);
    setBlocked(b.inactive);
    setMode("form");
  }

  function saveForm() {
    start(async () => {
      // Preserve existing branches on Modify (updateBank replaces them wholesale).
      const base = formEditId ? banks.find((b) => b.id === formEditId) : null;
      const branches: BankInput["branches"] = (base?.branches ?? []).map((br) => ({
        sno: br.sno,
        country_id: br.country_id,
        state: br.state,
        city: br.city,
        pin: br.pin,
        street: br.street,
        land_line: br.land_line,
        fax: br.fax,
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
      const res = formEditId ? await updateBank(formEditId, payload) : await createBank(payload);
      if (!res.ok) return error(res.error);
      if (formEditId) setHighlight(formEditId);
      success(formEditId ? `${label} updated.` : `${label} added.`);
      setMode("list");
      router.refresh(); // new/edited bank flows back in via the refreshed `banks` prop
    });
  }

  const selectedLabel = selected
    ? selected.code
      ? `${selected.code} — ${selected.name}`
      : selected.name
    : `— Select ${label} —`;

  return (
    <div>
      {!compact && <Label>{label}</Label>}
      <button
        type="button"
        onClick={openDialog}
        className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-surface px-3 text-left text-base md:text-sm hover:border-primary"
      >
        <span className={"truncate " + (selected ? "text-foreground" : "text-muted-foreground")}>
          {selectedLabel}
        </span>
        <span className="ml-2 shrink-0 rounded border border-border px-1.5 text-xs text-muted-foreground">
          ⓘ
        </span>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-start justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Select ${label}`}
              className="relative mt-[8vh] flex max-h-[80vh] w-[94%] max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {mode === "list"
                    ? `Select ${label}`
                    : formEditId
                      ? `Modify ${label}`
                      : `Add ${label}`}
                </h2>
                <button
                  type="button"
                  onClick={close}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {mode === "list" ? (
                <>
                  <div className="border-b border-border p-3">
                    <Input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search code or name…"
                      className="text-base md:text-sm"
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No banks found.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                          <tr>
                            <th className="w-24 px-4 py-2 text-left font-medium">Code</th>
                            <th className="px-4 py-2 text-left font-medium">Name</th>
                            <th className="w-20 px-4 py-2 text-left font-medium">Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((b) => (
                            <tr
                              key={b.id}
                              onClick={() => setHighlight(b.id)}
                              onDoubleClick={() => {
                                onChange(b.id);
                                close();
                              }}
                              className={
                                "cursor-pointer border-t border-border " +
                                (highlight === b.id ? "bg-primary/10" : "hover:bg-surface-muted")
                              }
                            >
                              <td className="px-4 py-2 font-mono text-xs">{b.code ?? "—"}</td>
                              <td className="px-4 py-2">{b.name}</td>
                              <td className="px-4 py-2 text-muted-foreground">{b.bank_type ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="flex items-center gap-2 border-t border-border px-4 py-3">
                    {canCreate && (
                      <Button type="button" variant="outline" size="md" onClick={startAdd}>
                        Add
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        disabled={!highlight}
                        onClick={startModify}
                      >
                        Modify
                      </Button>
                    )}
                    <div className="flex-1" />
                    <Button type="button" variant="outline" size="md" onClick={close}>
                      Cancel
                    </Button>
                    <Button type="button" size="md" disabled={!highlight} onClick={confirmSelection}>
                      OK
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    {formEditId && (
                      <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
                        Editing the bank header only. Branch details are edited on the Bank master.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="bp-code">Code</Label>
                        <Input
                          id="bp-code"
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          className="text-base md:text-sm"
                        />
                      </div>
                      <div>
                        <Label htmlFor="bp-type">Type</Label>
                        <Select
                          id="bp-type"
                          value={bankType}
                          onChange={(e) => setBankType(e.target.value as "" | BankType)}
                          className="text-base md:text-sm"
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
                    <div>
                      <Label htmlFor="bp-name">
                        Name <span className="text-danger">*</span>
                      </Label>
                      <Input
                        id="bp-name"
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="text-base md:text-sm"
                      />
                    </div>
                    {formEditId && (
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          checked={inactive}
                          onChange={(e) => setBlocked(e.target.checked)}
                        />
                        <span className="text-sm text-foreground">Inactive</span>
                      </label>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
                    <Button type="button" variant="outline" size="md" onClick={() => setMode("list")}>
                      Back
                    </Button>
                    <Button
                      type="button"
                      size="md"
                      disabled={isPending || !name.trim()}
                      onClick={saveForm}
                    >
                      {isPending ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
