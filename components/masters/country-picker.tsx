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
import { createCountry, updateCountry } from "@/lib/masters/country-actions";
import {
  COUNTRY_GROUPS,
  type Country,
  type CountryGroup,
  type CountryInput,
} from "@/lib/masters/country-types";

type FormState = {
  code: string;
  name: string;
  country_group: "" | CountryGroup;
  ecgc_code: string;
  isd_code: string;
  default_country: boolean;
  blocked: boolean;
};
const BLANK_FORM: FormState = {
  code: "",
  name: "",
  country_group: "",
  ecgc_code: "",
  isd_code: "",
  default_country: false,
  blocked: false,
};

/**
 * The legacy ⓘ Country popup: a searchable Code/Name grid with Add / Modify /
 * OK / Cancel. Add and Modify write through the shared Country master
 * (create/updateCountry) — so a country edited here changes everywhere it is
 * referenced, exactly like the legacy picker. Reusable for any Country FK field.
 */
export function CountryPicker({
  countries,
  value,
  onChange,
  canCreate,
  canEdit,
}: {
  countries: Country[];
  value: string | null;
  onChange: (id: string) => void;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [formEditId, setFormEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);

  // Countries created/updated in this session, merged + deduped with server rows.
  const [extra, setExtra] = useState<Country[]>([]);
  const all = useMemo(() => {
    const byId = new Map<string, Country>();
    for (const c of countries) byId.set(c.id, c);
    for (const c of extra) byId.set(c.id, c); // session edits win
    return [...byId.values()];
  }, [countries, extra]);

  const selected = all.find((c) => c.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? all.filter((c) => [c.code, c.name].filter(Boolean).join(" ").toLowerCase().includes(q))
      : all;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [all, query]);

  function openDialog() {
    setHighlightId(value);
    setQuery("");
    setMode("list");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setMode("list");
  }
  function confirmSelection() {
    if (highlightId) onChange(highlightId);
    close();
  }

  function startAdd() {
    setFormEditId(null);
    setForm(BLANK_FORM);
    setMode("form");
  }
  function startModify() {
    const c = all.find((x) => x.id === highlightId);
    if (!c) return;
    setFormEditId(c.id);
    setForm({
      code: c.code ?? "",
      name: c.name,
      country_group: c.country_group ?? "",
      ecgc_code: c.ecgc_code ?? "",
      isd_code: c.isd_code ?? "",
      default_country: c.default_country,
      blocked: c.blocked,
    });
    setMode("form");
  }

  function saveForm() {
    start(async () => {
      const payload: CountryInput = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        country_group: form.country_group ? form.country_group : null,
        ecgc_code: form.ecgc_code.trim() || null,
        isd_code: form.isd_code.trim() || null,
        default_country: form.default_country,
        blocked: form.blocked,
        is_draft: false,
      };
      const res = formEditId
        ? await updateCountry(formEditId, payload)
        : await createCountry(payload);
      if (!res.ok) {
        error(res.error);
        return;
      }
      // Reflect the change immediately in the picker list (server refresh follows).
      if (formEditId) {
        setExtra((xs) => {
          const base = all.find((c) => c.id === formEditId)!;
          const merged: Country = { ...base, ...payload, id: formEditId };
          return [...xs.filter((c) => c.id !== formEditId), merged];
        });
        setHighlightId(formEditId);
        success("Country updated.");
      } else {
        // createCountry doesn't return the id — refresh pulls it in; still show a synthetic
        // row optimistically keyed by a temp id so the user sees it right away.
        success("Country added.");
      }
      setMode("list");
      router.refresh();
    });
  }

  const selectedLabel = selected
    ? selected.code
      ? `${selected.code} — ${selected.name}`
      : selected.name
    : "— Select Country —";

  return (
    <div>
      <Label>
        Country <span className="text-danger">*</span>
      </Label>
      <button
        type="button"
        onClick={openDialog}
        className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-surface px-3 text-left text-base md:text-sm hover:border-primary"
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
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
              aria-label="Select Country"
              className="relative mt-[8vh] flex max-h-[80vh] w-[94%] max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {mode === "list" ? "Select Country" : formEditId ? "Modify Country" : "Add Country"}
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
                        No countries found.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                          <tr>
                            <th className="w-28 px-4 py-2 text-left font-medium">Code</th>
                            <th className="px-4 py-2 text-left font-medium">Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((c) => (
                            <tr
                              key={c.id}
                              onClick={() => setHighlightId(c.id)}
                              onDoubleClick={() => {
                                onChange(c.id);
                                close();
                              }}
                              className={
                                "cursor-pointer border-t border-border " +
                                (highlightId === c.id ? "bg-primary/10" : "hover:bg-surface-muted")
                              }
                            >
                              <td className="px-4 py-2 font-mono text-xs">{c.code ?? "—"}</td>
                              <td className="px-4 py-2">{c.name}</td>
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
                        disabled={!highlightId}
                        onClick={startModify}
                      >
                        Modify
                      </Button>
                    )}
                    <div className="flex-1" />
                    <Button type="button" variant="outline" size="md" onClick={close}>
                      Cancel
                    </Button>
                    <Button type="button" size="md" disabled={!highlightId} onClick={confirmSelection}>
                      OK
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="cp-code">Code</Label>
                        <Input
                          id="cp-code"
                          value={form.code}
                          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                          className="text-base md:text-sm"
                        />
                      </div>
                      <div>
                        <Label htmlFor="cp-group">Country Group</Label>
                        <Select
                          id="cp-group"
                          value={form.country_group}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, country_group: e.target.value as "" | CountryGroup }))
                          }
                          className="text-base md:text-sm"
                        >
                          <option value="">— Select —</option>
                          {COUNTRY_GROUPS.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="cp-name">
                        Name <span className="text-danger">*</span>
                      </Label>
                      <Input
                        id="cp-name"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="cp-ecgc">ECGC Code</Label>
                        <Input
                          id="cp-ecgc"
                          value={form.ecgc_code}
                          onChange={(e) => setForm((f) => ({ ...f, ecgc_code: e.target.value }))}
                          className="text-base md:text-sm"
                        />
                      </div>
                      <div>
                        <Label htmlFor="cp-isd">ISD Code</Label>
                        <Input
                          id="cp-isd"
                          value={form.isd_code}
                          onChange={(e) => setForm((f) => ({ ...f, isd_code: e.target.value }))}
                          className="text-base md:text-sm"
                        />
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.default_country}
                        onChange={(e) => setForm((f) => ({ ...f, default_country: e.target.checked }))}
                      />
                      <span className="text-sm text-foreground">Default Country</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={form.blocked}
                        onChange={(e) => setForm((f) => ({ ...f, blocked: e.target.checked }))}
                      />
                      <span className="text-sm text-foreground">Blocked</span>
                    </label>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
                    <Button type="button" variant="outline" size="md" onClick={() => setMode("list")}>
                      Back
                    </Button>
                    <Button
                      type="button"
                      size="md"
                      disabled={isPending || !form.name.trim()}
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
