"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import { createStateQuick, updateStateQuick, deleteState } from "@/lib/masters/state-actions";
import type { ConfigLookup } from "@/lib/masters/extras-types";

/** `StateLookup`, but with `country_id` optional so a plain `ConfigLookup[]`
 *  (what five of the six host screens still declare) remains assignable. */
type StateOption = ConfigLookup & { country_id?: string | null };

/**
 * Does this state belong under the country the address is in?
 *
 * `null` on the row means "unscoped", and unscoped means HOME — the master ships
 * as the Indian GST list and nothing wrote the column until now, so every legacy
 * row is an Indian state. Reading null as "matches anything" instead would put
 * all 36 Indian states under FRANCE, which is the bug this scoping exists to fix.
 */
function inCountry(o: StateOption, countryId: string | null, homeCountryId: string | null): boolean {
  if (!countryId) return true; // no country picked yet — don't hide anything
  const own = o.country_id ?? null;
  if (own) return own === countryId;
  return countryId === homeCountryId;
}

/**
 * The State field, everywhere one appears (6 screens).
 *
 * ## Why this exists rather than `LookupDialogPicker kind="state"`
 *
 * State is the one lookup whose READ and WRITE sides pointed at different
 * tables. The options are `statesAsLookups(stateRows)` — rows from
 * `public.states`, carrying their real `states.id` — but `LookupDialogPicker`
 * writes every kind to `config_lookups` (`lookup-dialog-picker.tsx:126,138`).
 * So on a State field:
 *
 * - **Add** wrote the state into `config_lookups`, and the field then re-read
 *   `public.states` on the next refresh, so the new state VANISHED. Worse, the
 *   id it optimistically selected was a `config_lookups` id, and `state_id` is
 *   an FK into `public.states` (0355) — so the save would have been rejected.
 * - **Modify** renamed a `config_lookups` row nothing reads: the rename looked
 *   like it did nothing.
 * - **Delete** removed or deactivated an entirely different record.
 *
 * That path was unreachable while these six fields passed no permissions; it
 * went live the moment they were given the full Add/Modify/Delete bar. This
 * component is the fix — same props, same look, CRUD routed to the State master
 * (`lib/masters/state-actions.ts`) so a state added from a field is the same
 * record the State master lists.
 *
 * ## Why the options stay `ConfigLookup[]`
 *
 * `statesAsLookups` already maps `states.id → ConfigLookup.id` and
 * `states.code → ConfigLookup.code`, and the host screens read that same array
 * for other things — `matchGstinState`, `defaultStateId`, the read-only "State"
 * row in their view sheets. Taking `State[]` here would fork those consumers for
 * no gain, so this stays a drop-in: callers change the component name and drop
 * `kind`, nothing else.
 */
export function StatePicker({
  label = "State",
  options,
  value,
  onChange,
  countryId = null,
  homeCountryId = null,
  canCreate,
  canEdit = false,
  canDelete,
  required = false,
  compact = false,
}: {
  label?: string;
  /** `statesAsLookups(stateRows)` — ids are `states.id`, codes are GST codes. */
  options: StateOption[];
  value: string | null;
  onChange: (id: string) => void;
  /**
   * The country this address is in. Scopes the list, and stamps `country_id` on
   * anything added inline. Leave it off (the default) and the field behaves
   * exactly as it did before: every state, unscoped.
   */
  countryId?: string | null;
  /**
   * Our own country — `defaultCountryId(countries)`. The state rows that predate
   * this scoping carry `country_id = null`, and they are the Indian GST list, so
   * they show under this country and no other. Without it, `null` rows would be
   * treated as belonging to whatever country happened to be selected.
   */
  homeCountryId?: string | null;
  canCreate?: boolean;
  canEdit?: boolean;
  /** Defaults to `canEdit` — same reasoning as `LookupDialogPicker`. Delete is
   *  guarded: a state any record references is deactivated, not removed. */
  canDelete?: boolean;
  required?: boolean;
  /** Trigger-only (no label) for dense grid rows. */
  compact?: boolean;
}) {
  const router = useRouter();

  // States created / edited in this session, merged over the server rows. The
  // options arrive as a prop from a server component, so without this a state
  // the operator just added is invisible until `router.refresh()` lands.
  const [extra, setExtra] = useState<StateOption[]>([]);

  const all = useMemo(() => {
    const byId = new Map<string, StateOption>();
    for (const o of options) byId.set(o.id, o);
    for (const o of extra) byId.set(o.id, o); // session edits win
    return [...byId.values()];
  }, [options, extra]);

  const byId = useMemo(() => new Map(all.map((o) => [o.id, o])), [all]);

  const rows: PickerRow[] = useMemo(
    () =>
      all
        // An inactive state stays resolvable for a record that already points at
        // it (and renders greyed), but drops out of new selections. Without that
        // rule an existing record just looks empty.
        .filter((o) => o.is_active || o.id === value)
        // Same escape hatch for the country scope: a record already pointing at
        // an out-of-country state still renders its name rather than going blank
        // — the operator sees what is stored and can correct it.
        .filter((o) => inCountry(o, countryId, homeCountryId) || o.id === value)
        // Name only — the GST state code is backend data, not something the
        // operator picks by. Sorted by the name they actually read.
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((o) => ({ id: o.id, label: o.name, disabled: !o.is_active })),
    [all, value, countryId, homeCountryId],
  );

  const manage: ManageConfig = {
    canCreate: Boolean(canCreate),
    canEdit: Boolean(canEdit),
    canDelete: canDelete ?? Boolean(canEdit),
    // Unscoped, matching the on-save guard in state-actions.ts and the
    // `uq_states_name` index (0373) — a DEACTIVATED state keeps its name
    // reserved, so the check must not filter on the active flag.
    dupCheck: { table: "states" },
    // Stamped with the country the address is in, so a state added under FRANCE
    // stays under FRANCE instead of joining the Indian GST list. Null when the
    // field is unscoped — which is what every existing row already carries.
    onCreate: (d) => createStateQuick(d.name, d.code || null, countryId),
    onUpdate: (id, d) => updateStateQuick(id, d.name, d.code || null),
    onDelete: (id) => deleteState(id),
    onCreated: (id, d) => {
      setExtra((xs) => [
        ...xs,
        {
          id,
          kind: "state" as const,
          code: d.code || null,
          name: d.name,
          type_code: null,
          notes: null,
          country_id: countryId,
          is_active: true,
          created_at: "",
          updated_at: "",
        },
      ]);
      router.refresh();
    },
    onUpdated: (id, d) => {
      setExtra((xs) => {
        const patch = { code: d.code || null, name: d.name };
        if (xs.some((o) => o.id === id)) {
          return xs.map((o) => (o.id === id ? { ...o, ...patch } : o));
        }
        const base = options.find((o) => o.id === id);
        return base ? [...xs, { ...base, ...patch }] : xs;
      });
      router.refresh();
    },
    onDeleted: (id, inactive) => {
      setExtra((xs) => {
        // A hard delete drops the row; a deactivate keeps it resolvable for
        // records that already reference it, but out of the selectable list.
        if (!inactive) return xs.filter((o) => o.id !== id);
        if (xs.some((o) => o.id === id)) {
          return xs.map((o) => (o.id === id ? { ...o, is_active: false } : o));
        }
        const base = options.find((o) => o.id === id);
        return base ? [...xs, { ...base, is_active: false }] : xs;
      });
      router.refresh();
    },
    draftOf: (row) => {
      const o = byId.get(row.id);
      return { code: o?.code ?? "", name: o?.name ?? "" };
    },
  };

  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      // The legacy contract is "a picked id", never null — these fields clear by
      // picking something else, and every call site types `onChange` that way.
      onChange={(id) => onChange(id ?? "")}
      clearable={false}
      required={required}
      compact={compact}
      manage={manage}
    />
  );
}
