"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { saveUserAccess } from "@/lib/permissions/actions";
import type { AccessUser } from "@/lib/permissions/service";

const ALL_UNITS = "__all_units__";
/** How long the Units cell waits after the last tick before it saves. */
const UNITS_SAVE_DELAY_MS = 900;

/**
 * ONE PERSON'S UNITS, EDITED IN THEIR ROW (0665; user 2026-10-01). Which units
 * they may switch to in the top bar — still ONE unit at a time (the client's
 * decision). Since 0680 this is the ONLY thing that grants a normal user a
 * unit (client 2026-10-03): a role's location no longer opens one, and a super
 * admin reaches every unit regardless. Nothing ticked = no unit = no data.
 *
 * Lives on Administration ▸ Users & Access ▸ Users since 2026-11-13, beside the
 * person's roles — it was on the separate User Permissions list, so the one
 * setting nothing works without sat on a different screen from the rest.
 *
 * "All units" is the first option rather than a separate switch, so the row
 * stays one control. Ticks save on their own a moment after the last one, so
 * picking three units is one save, not three; the same `saveUserAccess` the
 * editor uses, carrying the person's tree, note and status through unchanged.
 * A unit switched off since it was given stays listed, tagged, so a save never
 * silently drops it.
 */
export function UnitsCell({
  user,
  locations,
  readOnly,
}: {
  user: AccessUser;
  locations: { id: string; name: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [saving, start] = useTransition();
  const stored = user.access?.all_locations ? [ALL_UNITS] : (user.access?.location_ids ?? []);
  const [values, setValues] = useState<string[]>(stored);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useUnsavedGuard(dirty || saving);
  // The ticks waiting for the debounce, so leaving the page flushes them
  // instead of dropping them (a tick in the last 900 ms was silently lost).
  const pending = useRef<string[] | null>(null);
  const latest = useRef({ user, saveUnits: null as null | ((next: string[]) => Promise<unknown>) });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) void latest.current.saveUnits?.(pending.current);
  }, []);

  function saveUnits(next: string[]) {
    const all = next.includes(ALL_UNITS);
    return saveUserAccess({
      email: user.email,
      active: user.access?.is_active ?? true,
      note: user.access?.note ?? null,
      tree: user.tree,
      locations: { all, ids: all ? [] : next },
    });
  }
  // Kept current after each render (never during it) for the unmount flush.
  useEffect(() => {
    latest.current = { user, saveUnits };
  });

  if (user.is_super_admin) return <span className="text-sm text-muted-foreground">Every unit</span>;

  const unitIds = values.filter((v) => v !== ALL_UNITS);
  const options = [
    { id: ALL_UNITS, label: "All units" },
    ...locations.map((l) => ({ id: l.id, label: l.name })),
    ...unitIds
      .filter((id) => !locations.some((l) => l.id === id))
      .map((id) => ({ id, label: "(inactive unit)", inactive: true })),
  ];


  function save(next: string[]) {
    pending.current = null;
    start(async () => {
      const res = await saveUnits(next);
      setDirty(false);
      if (res.ok) {
        success(`Units saved for ${user.full_name ?? user.email}`);
        router.refresh();
      } else {
        // The ticks on screen must be what is stored: put them back.
        setValues(stored);
        toastError(res.error);
      }
    });
  }

  function change(next: string[]) {
    // Ticking "All units" replaces the list; ticking a unit while "All" is on
    // narrows to that unit.
    const tickedAll = next.includes(ALL_UNITS) && !values.includes(ALL_UNITS);
    const resolved = tickedAll ? [ALL_UNITS] : next.filter((v) => v !== ALL_UNITS);
    // UNIT IS MANDATORY (user 2026-10-09): un-ticking the last unit is refused,
    // the tick stays. The server refuses it too (`saveUserAccess`).
    if (resolved.length === 0 && (user.access?.is_active ?? true)) {
      toastError("Unit is required — keep at least one unit.");
      return;
    }
    setValues(resolved);
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    pending.current = resolved;
    timer.current = setTimeout(() => save(resolved), UNITS_SAVE_DELAY_MS);
  }

  return (
    // COMPACT (user 2026-10-01: "compact the unit field, now look larger"):
    // a dense-row trigger — the top bar's h-8 / text-xs rhythm — sized to
    // "2 units selected"; the open list keeps its own wider panel.
    <div className="w-36" onClick={(e) => e.stopPropagation()}>
      <MultiSelect
        id={`ac-units-${user.id}`}
        label={`Units for ${user.full_name ?? user.email}`}
        compact
        // A COUNT ("2 units selected"), NEVER `summarizeLabels` here: inside a
        // table row that option froze the page (2026-10-01, reproduced and
        // isolated in Chrome — the trigger's overflow measurement never
        // settles in an auto-width cell). The open list names every unit.
        hideChips
        summaryNoun="units"
        inputClassName="h-8 text-xs"
        panelClassName="w-48"
        options={options}
        values={values}
        disabled={readOnly || saving}
        onChange={change}
      />
    </div>
  );
}
