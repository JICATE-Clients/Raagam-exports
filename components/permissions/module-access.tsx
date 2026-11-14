"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ToggleGroup } from "@/components/ui/segmented";
import { useAccordion } from "@/lib/ui/use-accordion";
import { ACTIONS, type Action } from "@/lib/auth/types";
import type { CatalogModule, CatalogScreen } from "@/lib/permissions/screen-catalog";
import {
  LEVEL_WORD,
  LEVELS,
  cellsOf,
  changesForLevel,
  levelOf,
  screensOf,
  type CellChange,
  type Level,
  type Offered,
} from "@/lib/permissions/levels";

const ACTION_WORD: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  export: "Export",
};

/**
 * ONE ROW PER SIDEBAR MODULE, ONE CONTROL: Full · View only · Custom · None
 * (plan D2, approved 2026-11-14). The same component draws a ROLE (Roles &
 * Permissions), and ONE PERSON (Users ▸ Edit access) — so the two read alike.
 *
 * Only "Custom" opens the screen boxes, one module at a time (Folds are
 * accordions). Picking Custom on a module changes nothing by itself; it opens
 * the boxes so the operator can choose. Full / View only / None write every
 * cell of the module at once, including its pages that are off the menu.
 *
 * The caller owns the data: `has` answers a cell, `onCells` receives changes.
 * `noteOf` adds the grey line under a module's name ("From role", "Removed").
 */
export function ModuleAccessList({
  catalog,
  offered,
  has,
  onCells,
  noteOf,
  cellTitle,
  readOnly = false,
  label = "Access by module",
}: {
  catalog: CatalogModule[];
  offered: Offered;
  has: (sc: Pick<CatalogScreen, "key" | "module">, a: Action) => boolean;
  onCells: (changes: CellChange[]) => void;
  noteOf?: (cm: CatalogModule, level: Level) => string | null;
  /** Hover text for one screen box — where it comes from. */
  cellTitle?: (sc: CatalogScreen, a: Action) => string | undefined;
  readOnly?: boolean;
  label?: string;
}) {
  const fold = useAccordion(null);
  /** Modules switched to Custom whose cells still read as another level. */
  const [customPicked, setCustomPicked] = useState<Record<string, boolean>>({});

  return (
    <div className="overflow-hidden rounded-lg border border-border" role="list" aria-label={label}>
      {catalog.map((cm, i) => {
        const screens = screensOf(cm).filter((sc) => (offered[sc.module] ?? []).length > 0);
        if (screens.length === 0) return null;
        const cells = cellsOf(screens, offered);
        const derived = levelOf(cells, has);
        const level: Level = customPicked[cm.key] ? "custom" : derived;
        const open = level === "custom" && fold.isOpen(cm.key);
        const onScreens = screens.filter((sc) => (offered[sc.module] ?? []).some((a) => has(sc, a))).length;
        const note =
          noteOf?.(cm, level) ??
          (level === "custom" ? `Custom · ${onScreens} of ${screens.length} screen${screens.length === 1 ? "" : "s"}` : null);

        function setLevel(next: Level) {
          if (next === "custom") {
            setCustomPicked((p) => ({ ...p, [cm.key]: true }));
            if (!fold.isOpen(cm.key)) fold.toggle(cm.key);
            return;
          }
          setCustomPicked((p) => {
            const rest = { ...p };
            delete rest[cm.key];
            return rest;
          });
          if (fold.isOpen(cm.key)) fold.close();
          onCells(changesForLevel(cm.key, next, offered, has));
        }

        return (
          <div key={cm.key} role="listitem" className={i > 0 ? "border-t border-border" : undefined}>
            <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 ${open ? "bg-surface" : ""}`}>
              <div className="min-w-0">
                {level === "custom" ? (
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => fold.toggle(cm.key)}
                    className="inline-flex items-center gap-1 text-left text-sm font-semibold text-foreground"
                  >
                    {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                    {cm.label}
                  </button>
                ) : (
                  <span className="pl-5 text-sm font-semibold text-foreground">{cm.label}</span>
                )}
                {note && <span className="block pl-5 text-xs text-muted-foreground">{note}</span>}
              </div>
              <ToggleGroup<Level>
                label={`${cm.label} access`}
                value={level}
                onChange={(v) => !readOnly && setLevel(v)}
                options={LEVELS.map((l) => ({ value: l, label: LEVEL_WORD[l], disabled: readOnly }))}
              />
            </div>
            {open && (
              <div className="overflow-x-auto border-t border-dashed border-border bg-surface px-3 pb-2">
                <table className="w-full min-w-[34rem] border-collapse text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 pl-5 text-left font-medium">Screen</th>
                      {ACTIONS.map((a) => (
                        <th key={a} className="w-16 py-1.5 text-center font-medium">{ACTION_WORD[a]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {screens.map((sc) => (
                      <tr key={sc.key} className="border-t border-border/60">
                        <td className="py-1 pl-5 text-foreground">{sc.label}</td>
                        {ACTIONS.map((a) => {
                          if (!(offered[sc.module] ?? []).includes(a))
                            return <td key={a} className="text-center text-muted-foreground/50">—</td>;
                          const on = has(sc, a);
                          return (
                            <td key={a} className="text-center">
                              <input
                                type="checkbox"
                                className="size-4 accent-[var(--primary)]"
                                checked={on}
                                disabled={readOnly}
                                title={cellTitle?.(sc, a)}
                                aria-label={`${ACTION_WORD[a]} on ${sc.label}`}
                                onChange={(e) => onCells([{ sc, a, on: e.target.checked }])}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
