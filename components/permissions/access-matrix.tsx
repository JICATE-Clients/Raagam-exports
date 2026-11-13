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
 * One cell per screen × action, four states:
 *   - from a role  — ticked, tinted blue. UNTICKING IT BLOCKS IT for this
 *                    person alone (0840, user 2026-11-13: "after giving an
 *                    access allow user to edit") — they keep the role, so
 *                    approvals and alerts routed to it still reach them;
 *   - blocked      — a role cell unticked here: red, refused for them;
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
  blocks,
  onBlocksChange,
  readOnly = false,
}: {
  catalog: CatalogModule[];
  /** The actions each permission module has at all — a cell outside it is drawn as "—". */
  offered: Partial<Record<Module, Action[]>>;
  /** Every role the person holds (or is about to), with its tree. */
  roleTrees: { name: string; tree: PermissionTree }[];
  extras: PermissionTree;
  onChange: (next: PermissionTree) => void;
  /** 0840: role cells taken away from this person. */
  blocks: { module: string; screen: string; action: Action }[];
  onBlocksChange: (next: { module: string; screen: string; action: Action }[]) => void;
  readOnly?: boolean;
}) {
  /* OPENS ON "ALL MODULES" (user 2026-11-13: "if I build any new page it
     should automatically be added under user access, but now it's not").
     It was added — the catalog is derived from the nav registries and
     `check:screen-catalog` (inside build:check) fails any page in none — but
     the table opened on "Has access", which hides every module no role grants
     yet. A new page is exactly such a module, so it looked missing. "Has
     access" stays one click away as the summary view. */
  const [show, setShow] = useState<"has" | "all">("all");
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

  const blocked = (sc: CatalogScreen, a: Action) => blocks.some((b) => b.screen === sc.key && b.action === a);
  const on = (sc: CatalogScreen, a: Action) => (!!roleOf(sc, a) || treeHas(extras, sc, a)) && !blocked(sc, a);
  // A module with a block stays listed under "Has access", so the block can be seen and lifted.
  const visible = rows.filter(
    (r) =>
      show === "all" ||
      fold.isOpen(r.cm.key) ||
      r.screens.some((sc) => acts(sc).some((a) => on(sc, a) || blocked(sc, a))),
  );
  function setBlocked(sc: CatalogScreen, a: Action, block: boolean) {
    const rest = blocks.filter((b) => !(b.screen === sc.key && b.action === a));
    onBlocksChange(block ? [...rest, { module: sc.module, screen: sc.key, action: a }] : rest);
  }

  /**
   * THE ROW TICK (user 2026-11-13, screenshot 4150: "grant all for the one row
   * … by row based"). One box at the head of a screen row sets all its actions;
   * the one on a module row sets every screen under it. Same rules as a single
   * cell, applied in one pass so it is ONE change, not six:
   *   on  — lift a block, or add an extra where nothing gives it;
   *   off — block a role cell, or drop an extra.
   */
  function setCells(cm: CatalogModule, screens: CatalogScreen[], wantOn: boolean) {
    let t = extras;
    let bl = blocks;
    for (const sc of screens) {
      for (const a of acts(sc)) {
        const role = roleOf(sc, a);
        const isB = bl.some((b) => b.screen === sc.key && b.action === a);
        if (wantOn) {
          if (isB) bl = bl.filter((b) => !(b.screen === sc.key && b.action === a));
          else if (!role && !treeHas(t, sc, a)) t = treeToggle(t, cm, sc, a, true);
        } else if (role) {
          if (!isB) bl = [...bl, { module: sc.module, screen: sc.key, action: a }];
        } else if (treeHas(t, sc, a)) {
          t = treeToggle(t, cm, sc, a, false);
        }
      }
    }
    if (t !== extras) onChange(t);
    if (bl !== blocks) onBlocksChange(bl);
  }
  /** How much of these screens is on: "all", "some" or "none". */
  const share = (screens: CatalogScreen[]) => {
    const cells = screens.flatMap((sc) => acts(sc).map((a) => on(sc, a)));
    const n = cells.filter(Boolean).length;
    return n === 0 ? "none" : n === cells.length ? "all" : "some";
  };

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
            <span className="inline-block size-3.5 rounded-sm bg-danger/15 ring-1 ring-danger" aria-hidden />
            Blocked for this person
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
            { value: "all", label: "All modules" },
            { value: "has", label: "Has access" },
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
                    <RowTick
                      state={share(screens)}
                      label={`Every screen in ${cm.label}`}
                      disabled={readOnly}
                      onChange={(v) => setCells(cm, screens, v)}
                    />
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
                    const anyBlocked = can.some((sc) => blocked(sc, a));
                    return (
                      <td key={a} className="px-2 py-2 text-center text-xs font-semibold">
                        {can.length === 0 || (n === 0 && !anyBlocked) ? (
                          <span className="text-muted-foreground/50">—</span>
                        ) : (
                          <span className={anyBlocked ? "text-danger" : extra ? "text-success" : "text-info"}>
                            {n === can.length ? "All" : `${n}/${can.length}`}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>,
                ...(open
                  ? screens.map((sc) => (
                      <tr key={`${cm.key}:${sc.key}`} className="border-t border-border/60">
                        <td className="py-1.5 pl-9 pr-3 text-muted-foreground">
                          <RowTick
                            state={share([sc])}
                            label={`Every action on ${sc.label}`}
                            disabled={readOnly}
                            onChange={(v) => setCells(cm, [sc], v)}
                          />
                          {sc.label}
                        </td>
                        {ACTIONS.map((a) => {
                          if (!acts(sc).includes(a))
                            return (
                              <td key={a} className="px-2 py-1.5 text-center text-muted-foreground/50">—</td>
                            );
                          const role = roleOf(sc, a);
                          const extra = !role && treeHas(extras, sc, a);
                          const isBlocked = blocked(sc, a);
                          const title = isBlocked
                            ? `Blocked for this person — ${role ?? "a grant"} gives it. Tick to give it back.`
                            : role
                              ? `From ${role} — untick to block it for this person only`
                              : undefined;
                          return (
                            <td key={a} className="px-2 py-1.5 text-center">
                              <span
                                title={title}
                                className={`inline-grid size-7 place-items-center rounded-md ${
                                  isBlocked
                                    ? "bg-danger/15 ring-1 ring-danger"
                                    : role
                                      ? "bg-info/15"
                                      : extra
                                        ? "bg-success/15 ring-1 ring-success"
                                        : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className={`size-4 ${role ? "accent-[var(--info)]" : "accent-[var(--success)]"}`}
                                  checked={(!!role || extra) && !isBlocked}
                                  disabled={readOnly}
                                  aria-label={`${ACTION_WORD[a]} on ${sc.label}${
                                    isBlocked ? " — blocked for this person" : role ? ` — from ${role}` : extra ? " — extra" : ""
                                  }`}
                                  onChange={(e) => {
                                    // A role cell (or one already blocked) toggles the BLOCK; any other toggles an extra.
                                    if (role || isBlocked) setBlocked(sc, a, !e.target.checked);
                                    else onChange(treeToggle(extras, cm, sc, a, e.target.checked));
                                  }}
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

/** The box at the head of a row: ticked when all is on, a dash when some is. */
function RowTick({
  state,
  label,
  disabled,
  onChange,
}: {
  state: "all" | "some" | "none";
  label: string;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      className="mr-2 size-4 align-middle accent-[var(--primary)]"
      checked={state === "all"}
      ref={(el) => {
        if (el) el.indeterminate = state === "some";
      }}
      disabled={disabled}
      aria-label={label}
      title={state === "all" ? "Untick to take the whole row away" : "Tick to give the whole row"}
      // A dash (some on) ticks to ALL — the row is being filled, not cleared.
      onChange={() => onChange(state !== "all")}
    />
  );
}
