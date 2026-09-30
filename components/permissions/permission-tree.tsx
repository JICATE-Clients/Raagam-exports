"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Truncated } from "@/components/ui/truncated";
import type { Action, Module } from "@/lib/auth/types";
import type { CatalogModule, CatalogScreen } from "@/lib/permissions/screen-catalog";
import { treeHas, treeSetMany, treeToggle, type PermissionTree } from "@/lib/permissions/effective";
import { useAccordion } from "@/lib/ui/use-accordion";

/**
 * THE PERMISSION EDITOR — modules down a side rail, the selected module's
 * screens × actions on the right (user 2026-09-30, approved mockup "Access
 * Control — permission editor redesign", v3: "better clean").
 *
 * The shape is Material BOM's item list / item details: pick a module on the
 * left, and every screen of it is on the right with one checkbox per action.
 * It replaced a single scrolling page of collapsible module blocks, where each
 * module had to be opened before anything in it could be changed.
 *
 * ONE COMPONENT FOR BOTH SOURCES OF ACCESS: a role (By Role) and a person's
 * email access (By User) edit the same `PermissionTree`, so the two can never
 * show different modules or mean different things by the same box.
 *
 * The modules, sub-modules and screens come from the screen catalog, which is
 * DERIVED from the app's registries — a module added next month is here
 * without this file changing. Each screen offers only the actions its module
 * has in the permission catalog (`offered`); an action the module lacks is a
 * blank cell, so no box here is one nothing enforces.
 *
 * Three ways to set many boxes at once, and each is the grid's own axis:
 *   - the box before a screen's name  → every action on that screen;
 *   - the boxes on a sub-module's row → one action for every screen in it;
 *   - Grant all / Clear all           → the whole module.
 *
 * EDITS ARE SCOPED TO THE PERMISSION MODULE, NOT THE MENU MODULE. Reports and
 * Analytics are two menu modules over one permission module (`reports`), and
 * `treeToggle` expands a module-wide grant into per-screen grants over the
 * screens it is given — so it is always given EVERY screen of the permission
 * module (`scopeOf`). Handing it one menu module's screens silently dropped
 * the other's grants the first time a single box was touched.
 */

const ACTIONS: readonly Action[] = ["view", "create", "edit", "delete", "approve", "export"];

const ACTION_LABEL: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  export: "Export",
};

/** Screen column + one fixed column per action, shared by every row so the
 *  boxes line up down the whole pane. */
const GRID = { gridTemplateColumns: `minmax(0, 1fr) repeat(${ACTIONS.length}, 5.5rem)` } as const;

type Props = {
  catalog: CatalogModule[];
  /** The actions each module offers — from the permission catalog. */
  offered: Partial<Record<Module, Action[]>>;
  value: PermissionTree;
  onChange: (next: PermissionTree) => void;
  readOnly?: boolean;
};

export function PermissionTree({ catalog, offered, value, onChange, readOnly = false }: Props) {
  const [query, setQuery] = useState("");
  const [selKey, setSelKey] = useState(catalog[0]?.key ?? "");

  const q = query.trim().toLowerCase();
  const actionsOf = (m: Module): readonly Action[] => offered[m] ?? [];
  const has = (sc: CatalogScreen, a: Action) => treeHas(value, sc, a);
  const screenOn = (sc: CatalogScreen) => actionsOf(sc.module).some((a) => has(sc, a));

  /** Every screen of one PERMISSION module, across menu modules — see the note above. */
  const scopeOf = useMemo(() => {
    const byModule = new Map<Module, Pick<CatalogModule, "submodules">>();
    for (const cm of catalog) {
      const cur = byModule.get(cm.module);
      byModule.set(cm.module, { submodules: [...(cur?.submodules ?? []), ...cm.submodules] });
    }
    return (m: Module) => byModule.get(m) ?? { submodules: [] };
  }, [catalog]);

  const matches = (t: string) => t.toLowerCase().includes(q);
  const railModules = q
    ? catalog.filter(
        (cm) => matches(cm.label) || cm.submodules.some((s) => matches(s.label) || s.screens.some((sc) => matches(sc.label))),
      )
    : catalog;
  const selected = railModules.find((cm) => cm.key === selKey) ?? railModules[0] ?? null;

  function set(screens: CatalogScreen[], actions: (sc: Pick<CatalogScreen, "key" | "module">) => readonly Action[], on: boolean) {
    if (readOnly || screens.length === 0) return;
    onChange(treeSetMany(value, scopeOf(screens[0].module), screens, actions, on));
  }

  /** Grant all / Clear all. When the module is the WHOLE permission module the
   *  answer is said directly in module mode — the same thing `payloadFromTree`
   *  would normalise to, and it keeps covering screens added later. */
  function setModule(cm: CatalogModule, on: boolean) {
    if (readOnly) return;
    const screens = cm.submodules.flatMap((s) => s.screens);
    const whole = scopeOf(cm.module).submodules.reduce((n, s) => n + s.screens.length, 0) === screens.length;
    if (whole) {
      const next = { ...value };
      if (on) next[cm.module] = { mode: "module", actions: [...actionsOf(cm.module)] };
      else delete next[cm.module];
      onChange(next);
      return;
    }
    set(screens, (sc) => actionsOf(sc.module), on);
  }

  const totals = useMemo(() => {
    let n = 0;
    let on = 0;
    for (const cm of catalog) for (const s of cm.submodules) for (const sc of s.screens) {
      n++;
      if (actionsOf(sc.module).some((a) => treeHas(value, sc, a))) on++;
    }
    return { n, on };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actionsOf reads `offered`, listed
  }, [catalog, value, offered]);

  return (
    <div className="flex h-[min(72vh,46rem)] min-h-[26rem] overflow-hidden rounded-lg border border-border bg-surface">
      {/* ── Rail: modules ─────────────────────────────────────────────── */}
      <nav aria-label="Modules" className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-muted">
        <div className="relative p-3">
          <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          {/* caps-input: exempt -- a search query is not a stored value (AGENTS.md CAPITALS) */}
          <Input
            type="search"
            uppercase={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search modules and screens"
            className="pl-9"
          />
        </div>
        <ul className="flex-1 space-y-px overflow-y-auto px-2 pb-3">
          {railModules.map((cm) => {
            const screens = cm.submodules.flatMap((s) => s.screens);
            const on = screens.filter(screenOn).length;
            const active = cm.key === selected?.key;
            return (
              <li key={cm.key}>
                <button
                  type="button"
                  onClick={() => setSelKey(cm.key)}
                  aria-current={active ? "true" : undefined}
                  className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${
                    active ? "bg-surface font-semibold text-foreground shadow-sm ring-1 ring-border" : "text-foreground hover:bg-surface/60"
                  }`}
                >
                  <Truncated text={cm.label} className="min-w-0 flex-1" />
                  <span className={`shrink-0 text-xs tabular-nums ${on === screens.length && on > 0 ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                    {on === 0 ? "" : on === screens.length ? "All" : `${on}/${screens.length}`}
                  </span>
                </button>
              </li>
            );
          })}
          {railModules.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No module or screen matches.</li>}
        </ul>
        <p className="border-t border-border px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
          {totals.on} of {totals.n} screens granted
        </p>
      </nav>

      {/* ── Detail: the selected module's screens × actions ───────────── */}
      {selected && (
        <ModuleDetail
          key={selected.key}
          cm={selected}
          query={q}
          acts={actionsOf(selected.module)}
          has={has}
          screenOn={screenOn}
          readOnly={readOnly}
          onSetModule={(on) => setModule(selected, on)}
          onSet={set}
          onCell={(sc, a, on) => !readOnly && onChange(treeToggle(value, scopeOf(sc.module), sc, a, on))}
        />
      )}
    </div>
  );
}

function ModuleDetail({
  cm,
  query,
  acts,
  has,
  screenOn,
  readOnly,
  onSetModule,
  onSet,
  onCell,
}: {
  cm: CatalogModule;
  query: string;
  acts: readonly Action[];
  has: (sc: CatalogScreen, a: Action) => boolean;
  screenOn: (sc: CatalogScreen) => boolean;
  readOnly: boolean;
  onSetModule: (on: boolean) => void;
  onSet: (screens: CatalogScreen[], actions: (sc: Pick<CatalogScreen, "key" | "module">) => readonly Action[], on: boolean) => void;
  onCell: (sc: CatalogScreen, a: Action, on: boolean) => void;
}) {
  /* ONE SUB-MODULE OPEN AT A TIME (user 2026-09-30: "if user work on the
     section open it and then move to the next submodule close the previous").
     The first on-menu sub-module opens with the module (this component is
     keyed by module, so picking another module starts fresh); tabbing or
     clicking into another one claims it — `useAccordion`, the app-wide rule.
     A search opens everything, so every match is on screen. */
  const fold = useAccordion(cm.submodules.find((s) => s.note !== "hidden")?.key ?? null);
  const all = cm.submodules.flatMap((s) => s.screens);
  const granted = all.filter(screenOn).length;
  const everything = all.length > 0 && acts.length > 0 && all.every((sc) => acts.every((a) => has(sc, a)));
  // A search that matched a SCREEN narrows the rows; one that matched the
  // module or sub-module name keeps them all.
  const hit = (t: string) => !query || t.toLowerCase().includes(query);
  const subs = hit(cm.label)
    ? cm.submodules
    : cm.submodules
        .map((s) => (hit(s.label) ? s : { ...s, screens: s.screens.filter((sc) => hit(sc.label)) }))
        .filter((s) => s.screens.length > 0);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="flex items-end gap-4 px-8 pt-6">
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-semibold text-foreground">{cm.label}</h3>
          <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
            {granted} of {all.length} screens granted
          </p>
        </div>
        {!readOnly && acts.length > 0 && (
          <button
            type="button"
            onClick={() => onSetModule(!everything)}
            className="h-8 shrink-0 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-muted"
          >
            {everything ? "Clear all" : "Grant all"}
          </button>
        )}
      </div>

      {/* Column header — once, pinned while the rows scroll under it. */}
      <div className="sticky top-0 z-[1] mt-4 bg-surface px-8">
        <div style={GRID} className="grid h-10 items-center border-b border-border text-xs font-medium text-muted-foreground">
          <span>Screen</span>
          {ACTIONS.map((a) => (
            <span key={a} className={`text-center ${acts.includes(a) ? "" : "opacity-40"}`}>
              {ACTION_LABEL[a]}
            </span>
          ))}
        </div>
      </div>

      <div className="px-8 pb-10">
        {subs.map((sub) => {
          const hidden = sub.note === "hidden";
          const open = fold.isOpen(sub.key) || !!query;
          const on = sub.screens.filter(screenOn).length;
          return (
            <section key={sub.key} aria-label={sub.label} {...fold.focusProps(sub.key)}>
              <div style={GRID} className="mt-3 grid h-11 items-center border-b border-border">
                <button
                  type="button"
                  onClick={() => fold.toggle(sub.key)}
                  aria-expanded={open}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <Truncated text={sub.label.toUpperCase()} className="min-w-0 text-xs font-semibold tracking-wide text-foreground" />
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {on}/{sub.screens.length}
                  </span>
                  {hidden && <span className="shrink-0 text-xs text-muted-foreground">· not on the menu</span>}
                </button>
                {ACTIONS.map((a) => {
                  if (!acts.includes(a)) return <span key={a} />;
                  const colOn = sub.screens.every((sc) => has(sc, a));
                  return (
                    <span key={a} className="flex justify-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-default"
                        checked={colOn}
                        disabled={readOnly}
                        onChange={() => onSet(sub.screens, () => [a], !colOn)}
                        aria-label={`${ACTION_LABEL[a]} for every screen in ${sub.label}`}
                      />
                    </span>
                  );
                })}
              </div>

              {open &&
                sub.screens.map((sc) => {
                  const rowAll = acts.length > 0 && acts.every((a) => has(sc, a));
                  const any = screenOn(sc);
                  return (
                    <div key={sc.key} style={GRID} className="grid h-11 items-center border-b border-border/60">
                      <label className="flex min-w-0 cursor-pointer items-center gap-3 pl-5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:cursor-default"
                          checked={rowAll}
                          disabled={readOnly || acts.length === 0}
                          onChange={() => onSet([sc], () => acts, !rowAll)}
                          aria-label={`Every action on ${sc.label}`}
                        />
                        <Truncated text={sc.label} className={`min-w-0 text-sm ${any ? "text-foreground" : "text-muted-foreground"}`} />
                        {sc.note && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            ({sc.note === "hidden" ? "off the menu" : "unavailable"})
                          </span>
                        )}
                      </label>
                      {ACTIONS.map((a) =>
                        acts.includes(a) ? (
                          <span key={a} className="flex justify-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-default"
                              checked={has(sc, a)}
                              disabled={readOnly}
                              onChange={(e) => onCell(sc, a, e.target.checked)}
                              aria-label={`${ACTION_LABEL[a]}: ${sc.label}`}
                            />
                          </span>
                        ) : (
                          <span key={a} />
                        ),
                      )}
                    </div>
                  );
                })}
            </section>
          );
        })}
        {subs.length === 0 && <p className="py-6 text-sm text-muted-foreground">Nothing in {cm.label} matches.</p>}
      </div>
    </div>
  );
}
