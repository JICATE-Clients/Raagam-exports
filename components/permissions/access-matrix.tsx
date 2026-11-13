"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ToggleGroup } from "@/components/ui/segmented";
import { useAccordion } from "@/lib/ui/use-accordion";
import { treeHas, treeToggle, type PermissionTree } from "@/lib/permissions/effective";
import type { CatalogModule, CatalogScreen } from "@/lib/permissions/screen-catalog";
import { ACTIONS, type Action, type Module } from "@/lib/auth/types";

const ACTION_WORD: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  export: "Export",
};

/**
 * ONE PERSON'S ACCESS AS ONE TABLE (user 2026-11-13, plan
 * https://claude.ai/artifact/JGQev3raC2WCeMyVULxE9j — "built it").
 *
 * It replaced two parts that disagreed: a "Can open" text list, and the
 * permission tree for extra screens — which did not know what the roles
 * already gave, so a person whose role granted all of Dashboard was shown
 * "Dashboard · 0 of 1 granted" with every box empty (screenshot 4140).
 *
 * One cell per screen × action, three states:
 *   - from a role  — ticked, tinted blue, LOCKED. Taken away by removing the
 *                    role, or by changing the role on Roles & Permissions,
 *                    never per person;
 *   - extra        — ticked, green: this person's own grant (`extras`);
 *   - none         — empty; ticking it adds an extra.
 * A module row sums its screens per action ("All", "3/10", "—") and folds open
 * to them, one module at a time (the accordion rule). "Has access" (default)
 * lists only modules the person can open — the old "Can open" — and "All
 * modules" lists the rest to add from.
 *
 * Real checkboxes, not pressed buttons: each cell IS a yes/no a screen reader
 * should read as one, and a locked role cell is a checked, disabled box.
 */
export function AccessMatrix({
  catalog,
  offered,
  roleTrees,
  extras,
  onChange,
  readOnly = false,
}: {
  catalog: CatalogModule[];
  /** The actions each permission module has at all — a cell outside it is drawn as "—". */
  offered: Partial<Record<Module, Action[]>>;
  /** Every role the person holds (or is about to), with its tree. */
  roleTrees: { name: string; tree: PermissionTree }[];
  extras: PermissionTree;
  onChange: (next: PermissionTree) => void;
  readOnly?: boolean;
}) {
  const [show, setShow] = useState<"has" | "all">("has");
  const fold = useAccordion(null);

  /** The first role giving this cell, or null. */
  const roleOf = (sc: CatalogScreen, a: Action) => roleTrees.find((r) => treeHas(r.tree, sc, a))?.name ?? null;
  const acts = (sc: CatalogScreen) => offered[sc.module] ?? [];

  const rows = useMemo(
    () =>
      catalog
        .map((cm) => ({ cm, screens: cm.submodules.flatMap((s) => s.screens).filter((sc) => acts(sc).length > 0) }))
        .filter((r) => r.screens.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, offered],
  );

  const on = (sc: CatalogScreen, a: Action) => !!roleOf(sc, a) || treeHas(extras, sc, a);
  const visible = rows.filter(
    (r) => show === "all" || fold.isOpen(r.cm.key) || r.screens.some((sc) => acts(sc).some((a) => on(sc, a))),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3.5 rounded-sm bg-info/20 ring-1 ring-info/40" aria-hidden />
            From a role
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3.5 rounded-sm bg-success/20 ring-1 ring-success" aria-hidden />
            Extra for this person
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3.5 rounded-sm ring-1 ring-border" aria-hidden />
            No access — tick to add
          </span>
        </div>
        <ToggleGroup
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: "has", label: "Has access" },
            { value: "all", label: "All modules" },
          ]}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] border-collapse text-sm tabular-nums">
          <thead>
            <tr className="bg-[var(--table-head-bg)] text-[var(--table-head-fg)]">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Module / screen</th>
              {ACTIONS.map((a) => (
                <th key={a} className="w-20 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide">
                  {ACTION_WORD[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={ACTIONS.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing yet — add a role above, or switch to All modules and tick what they need.
                </td>
              </tr>
            )}
            {visible.map(({ cm, screens }) => {
              const open = fold.isOpen(cm.key);
              const sources = [...new Set(screens.flatMap((sc) => acts(sc).map((a) => roleOf(sc, a)).filter(Boolean)))];
              return [
                <tr key={cm.key} className="border-t border-border bg-surface">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => fold.toggle(cm.key)}
                      className="inline-flex items-center gap-1.5 text-left font-semibold text-foreground"
                    >
                      {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                      {cm.label}
                    </button>
                    {sources.length > 0 && <span className="ml-2 text-xs text-muted-foreground">· {sources.join(", ")}</span>}
                  </td>
                  {ACTIONS.map((a) => {
                    const can = screens.filter((sc) => acts(sc).includes(a));
                    const n = can.filter((sc) => on(sc, a)).length;
                    const extra = can.some((sc) => !roleOf(sc, a) && treeHas(extras, sc, a));
                    return (
                      <td key={a} className="px-2 py-2 text-center text-xs font-semibold">
                        {can.length === 0 || n === 0 ? (
                          <span className="text-muted-foreground/50">—</span>
                        ) : (
                          <span className={extra ? "text-success" : "text-info"}>{n === can.length ? "All" : `${n}/${can.length}`}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>,
                ...(open
                  ? screens.map((sc) => (
                      <tr key={`${cm.key}:${sc.key}`} className="border-t border-border/60">
                        <td className="py-1.5 pl-9 pr-3 text-muted-foreground">{sc.label}</td>
                        {ACTIONS.map((a) => {
                          if (!acts(sc).includes(a))
                            return (
                              <td key={a} className="px-2 py-1.5 text-center text-muted-foreground/50">—</td>
                            );
                          const role = roleOf(sc, a);
                          const extra = !role && treeHas(extras, sc, a);
                          return (
                            <td key={a} className="px-2 py-1.5 text-center">
                              <span
                                title={role ? `From ${role}` : undefined}
                                className={`inline-grid size-7 place-items-center rounded-md ${
                                  role ? "bg-info/15" : extra ? "bg-success/15 ring-1 ring-success" : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className={`size-4 ${role ? "accent-[var(--info)]" : "accent-[var(--success)]"}`}
                                  checked={!!role || extra}
                                  disabled={!!role || readOnly}
                                  aria-label={`${ACTION_WORD[a]} on ${sc.label}${role ? ` — from ${role}` : extra ? " — extra" : ""}`}
                                  onChange={(e) => onChange(treeToggle(extras, cm, sc, a, e.target.checked))}
                                />
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
