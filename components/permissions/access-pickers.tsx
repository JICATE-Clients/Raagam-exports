"use client";

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";

/** The "every unit, including ones added later" choice in a units list. */
export const ALL_UNITS = "__all_units__";

/**
 * THE TWO PICKERS EVERY PERSON IS SET UP WITH — roles and units — shared by
 * Users ▸ ✏️ (the person editor) and Users ▸ ✉ (the Invite sheet), so the
 * invite asks the same question the editor answers, the same way (user
 * 2026-11-13: "if we invite user should with role and unit and after also
 * allow the role edit").
 */

/** Role chips: ✕ takes one off, "+ Add role" picks one on. */
export function RoleChips({
  id,
  roles,
  value,
  onChange,
  readOnly = false,
}: {
  /** The picker's id — unique per surface, so focus lands in the right one. */
  id: string;
  roles: { id: string; name: string; description: string | null }[];
  value: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
}) {
  /* "+ Add role" is a BUTTON that opens the picker: placeholders are off app-wide
     (`SHOW_PLACEHOLDERS`), so an empty picker could never say what it was for —
     it drew as a blank box (screenshot 4140). */
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");
  const nameOf = (rid: string) => roles.find((r) => r.id === rid)?.name ?? "Unknown role";
  const offered = roles.filter((r) => !value.includes(r.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.length === 0 && <span className="text-sm text-muted-foreground">No role yet</span>}
      {value.map((rid) => (
        <span key={rid} className="inline-flex h-8 items-center gap-1 rounded-control bg-info/10 pl-3 pr-1 text-sm font-medium text-info">
          {nameOf(rid)}
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove role ${nameOf(rid)}`}
              className="inline-flex size-6 items-center justify-center rounded-full hover:bg-info/20"
              onClick={() => onChange(value.filter((x) => x !== rid))}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </span>
      ))}
      {!readOnly && offered.length > 0 &&
        (adding ? (
          <div className="w-56">
            {/* Picking IS adding — no second "Assign" button (screenshot 4139). */}
            <Combobox
              id={id}
              options={offered.map((r) => ({ value: r.id, label: r.name, sublabel: r.description ?? undefined }))}
              value={pick}
              onChange={(v) => {
                if (v && !value.includes(v)) onChange([...value, v]);
                setPick("");
                setAdding(false);
              }}
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setAdding(true);
              // The picker mounts on this click; put the cursor in it.
              requestAnimationFrame(() => document.getElementById(id)?.focus());
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add role
          </Button>
        ))}
    </div>
  );
}

/** Units as named tick-chips — named, not counted: "1 units selected" never said WHICH. */
export function UnitChips({
  locations,
  value,
  onChange,
  readOnly = false,
}: {
  locations: { id: string; name: string }[];
  /** Unit ids, or `[ALL_UNITS]`. */
  value: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
}) {
  const all = value.includes(ALL_UNITS);
  const ids = value.filter((u) => u !== ALL_UNITS);
  const none = !all && ids.length === 0;

  function toggle(uid: string) {
    if (uid === ALL_UNITS) return onChange(all ? [] : [ALL_UNITS]);
    // Ticking one unit while "All units" is on narrows to that unit.
    const base = all ? [] : ids;
    onChange(base.includes(uid) ? base.filter((u) => u !== uid) : [...base, uid]);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Units">
        {[{ id: ALL_UNITS, name: "All units" }, ...locations].map((l) => {
          const on = l.id === ALL_UNITS ? all : all || ids.includes(l.id);
          return (
            <label
              key={l.id}
              className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm ${
                on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-foreground"
              } ${readOnly ? "pointer-events-none opacity-60" : ""}`}
            >
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={on} disabled={readOnly} onChange={() => toggle(l.id)} />
              {l.name}
            </label>
          );
        })}
        {/* A unit switched off since it was given stays listed, so a save never drops it silently. */}
        {ids
          .filter((uid) => !locations.some((l) => l.id === uid))
          .map((uid) => (
            <span key={uid} className="inline-flex h-8 items-center rounded-control border border-border px-3 text-sm text-muted-foreground">
              (inactive unit)
            </span>
          ))}
      </div>
      <p className={`text-xs ${none ? "text-danger" : "text-muted-foreground"}`}>
        {none ? "Tick at least one — with no unit they see no data." : "The units they may switch to in the top bar."}
      </p>
    </div>
  );
}

/** `[ALL_UNITS]` / ids → what `saveUserAccess` takes. */
export function unitsPayload(value: string[]): { all: boolean; ids: string[] } {
  const all = value.includes(ALL_UNITS);
  return { all, ids: all ? [] : value.filter((u) => u !== ALL_UNITS) };
}

/** One labelled line of an access form — label column left, content right. */
export function AccessRow({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[8rem_1fr] sm:items-start">
      <dt className="pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {required && <span className="text-danger"> *</span>}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
