"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { createLookupValue } from "@/lib/masters/lookup-quick";
import { updateLookup } from "@/lib/masters/extras-actions";
import type { ConfigLookup, LookupKind } from "@/lib/masters/extras-types";

/**
 * A config_lookups picker with inline **Add** and **Modify** — mirrors the
 * legacy ⓘ lookup popup (grid + Add/Modify). Add is gated by `canCreate`,
 * Modify (edit the selected value) by `canEdit`. Manages its own session-added
 * rows and auto-selects a newly-added value.
 */
export function LookupPicker({
  kind,
  label,
  options,
  value,
  onChange,
  canCreate,
  canEdit = false,
}: {
  kind: LookupKind;
  label: string;
  options: ConfigLookup[];
  value: string;
  onChange: (v: string) => void;
  canCreate: boolean;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [extra, setExtra] = useState<ConfigLookup[]>([]);
  const [mode, setMode] = useState<"none" | "new" | "edit">("none");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...options, ...extra].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  }, [options, extra]);

  const selected = all.find((o) => o.id === value) ?? null;

  function reset() {
    setMode("none");
    setCode("");
    setName("");
  }
  function startNew() {
    setCode("");
    setName("");
    setMode("new");
  }
  function startEdit() {
    if (!selected) return;
    setCode(selected.code ?? "");
    setName(selected.name);
    setMode("edit");
  }

  function saveNew() {
    start(async () => {
      const res = await createLookupValue(kind, name, code || null);
      if (res.ok) {
        setExtra((xs) => [
          ...xs,
          { id: res.id, kind, code: code.trim() || null, name: name.trim(), notes: null, is_active: true, created_at: "", updated_at: "" },
        ]);
        onChange(res.id);
        reset();
        success(`${label} added.`);
        router.refresh();
      } else error(res.error);
    });
  }
  function saveEdit() {
    if (!selected) return;
    start(async () => {
      const res = await updateLookup(selected.id, {
        kind,
        code: code.trim() || null,
        name: name.trim(),
        notes: null,
        is_active: selected.is_active,
      });
      if (res.ok) {
        setExtra((xs) => xs.map((o) => (o.id === selected.id ? { ...o, code: code.trim() || null, name: name.trim() } : o)));
        reset();
        success(`${label} updated.`);
        router.refresh();
      } else error(res.error);
    });
  }

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Select value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 text-base md:text-sm">
          <option value="">— None —</option>
          {all.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code ? `${o.code} — ${o.name}` : o.name}
            </option>
          ))}
        </Select>
        {canEdit && value && (
          <Button type="button" variant="outline" size="md" onClick={() => (mode === "edit" ? reset() : startEdit())}>
            {mode === "edit" ? "Cancel" : "Edit"}
          </Button>
        )}
        {canCreate && (
          <Button type="button" variant="outline" size="md" onClick={() => (mode === "new" ? reset() : startNew())}>
            {mode === "new" ? "Cancel" : "+ New"}
          </Button>
        )}
      </div>
      {mode !== "none" && (
        <div className="mt-2 flex items-end gap-2 rounded-lg border border-border p-2.5">
          <div className="w-24">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="text-base md:text-sm" />
          </div>
          <div className="flex-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-base md:text-sm" />
          </div>
          <Button
            type="button"
            size="md"
            disabled={isPending || !name.trim()}
            onClick={mode === "edit" ? saveEdit : saveNew}
          >
            {mode === "edit" ? "Save" : "Add"}
          </Button>
        </div>
      )}
    </div>
  );
}
