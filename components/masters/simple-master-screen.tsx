"use client";
import { deletedToast } from "@/lib/masters/delete-message";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { ValidatedInput } from "@/components/ui/validated-input";
import { PaginationBar } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { focusFirstField } from "@/lib/focus";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRegisterShortcut } from "@/lib/shortcuts";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  createdColumns,
  createdMeta,
  createdSection,
  hasCreatedInfo,
} from "@/components/ui/created-columns";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { RowActions } from "@/components/ui/row-actions";
import { ROW_ACTIONS_WIDTH } from "@/components/ui/row-actions-column";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { RecordViewSheet, type ViewSection } from "@/components/masters/record-view-sheet";
import { pairsFromRow } from "@/lib/record-pairs";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { useSpellSuggest } from "@/lib/masters/use-spell-suggest";
import { SpellSuggestHint } from "@/components/masters/spell-suggest-hint";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { validateFormat, type FormatKind } from "@/lib/validation/formats";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ types */

export type SimpleFieldKind = "text" | "select" | "checkbox";

export type SimpleField = {
  /** Key into the form-values record. */
  key: string;
  /** Column header + mobile input label. */
  label: string;
  kind?: SimpleFieldKind; // default "text"
  required?: boolean;
  /** ValidatedInput format for text fields. */
  format?: FormatKind;
  /** Options for kind:"select". */
  options?: { value: string; label: string }[];
  /** Read-cell label for a select value (defaults to matching option label). */
  optionLabel?: (value: string) => ReactNode;
  placeholder?: string;
  /** Render the read cell in mono (codes). */
  mono?: boolean;
  /** Extra width class on the edit input, e.g. "w-32". */
  widthClass?: string;
  /** Key of another field whose value fills this one when left blank (shown as hint). */
  defaultsTo?: string;
  /** Render read-only while editing an EXISTING row (e.g. immutable codes). */
  lockedOnEdit?: boolean;
  /** Auto-generated / derived value — omit from Tab order (tabIndex=-1) so Tab
   *  skips it. Field stays clickable/editable. Global rule for auto fields. */
  skipTab?: boolean;
};

export type SimpleValues = Record<string, string | boolean>;
export type SimpleStatus = { active: boolean; draft: boolean };
export type ActionResult = { ok: true } | { ok: false; error: string };

export type SimpleMasterDescriptor<Row> = {
  /** "Beam Type" — drives buttons, toasts, empty text. */
  entityLabel: string;
  /** DataIoToolbar entity key; omit to hide import/export. */
  ioEntityKey?: string;
  /** Fields WITHOUT status — status is handled by `status` below. */
  fields: SimpleField[];
  /** "active" = Active/Inactive select; "activeDraft" adds Draft; "none" = no status column. */
  status: "active" | "activeDraft" | "none";
  /** Read-only computed columns (e.g. Created Date/User), rendered after the fields. */
  extraColumns?: { header: string; cell: (r: Row) => ReactNode }[];
  /** Optional extra muted line on the mobile read card. */
  mobileMeta?: (r: Row) => ReactNode;
  /** Field key used as the mobile card title. Defaults to the second field
   *  (historically Name, after a leading Code column), then the first — set
   *  this when the code field is gone and fields[1] isn't the natural label.
   *  Also titles the read-only view sheet. */
  mobileTitleKey?: string;
  /**
   * OPTIONAL override for the read-only view behind the row's eye. The engine
   * owns the sheet, its open/close state and its title either way; the eye is
   * there whether or not this is declared, falling back to the record's own
   * fields (`lib/record-pairs.ts`).
   *
   * Declare it when the raw field names read badly, or to group the record into
   * sections. It renders what the row ALREADY holds — no fetching here, same
   * rule as `record-view-sheet.tsx`.
   */
  view?: (r: Row) => ViewSection[];
  /** Row → form values for editing. */
  fromRow: (r: Row) => SimpleValues;
  /** Free-text search haystack. */
  searchText: (r: Row) => string;
  /** Row → status; required unless status is "none". */
  statusOf?: (r: Row) => "active" | "inactive" | "draft";
  /** Row primary key; defaults to `r.id`. Override for masters keyed on code. */
  getId?: (r: Row) => string;
  /** Extra facet filters beyond Status (rendered in the FilterBar). */
  extraFilters?: {
    key: string;
    label: string;
    options: { value: string; label: string }[];
    predicate: (r: Row, v: string) => boolean;
  }[];
  /** Cross-field validation before save; return an error message to block. */
  validate?: (values: SimpleValues) => string | null;
  /** Live duplicate check while typing — mirror the on-save guard in the
   *  entity's create/update actions (same table + nameColumn + scope). The
   *  error renders under `fieldKey`'s input and blocks Save. */
  dupCheck?: {
    table: string;
    /** Form-value key the check watches (and whose input shows the error). */
    fieldKey: string;
    nameColumn?: string;
    scope?: Record<string, string | null>;
    /** Derive the checked value from all form values (defaults to values[fieldKey]). */
    value?: (values: SimpleValues) => string;
    /**
     * Word the message uses ("name", "code", "description", "ID"). Defaults to
     * "name" — so a descriptor watching anything else MUST set this, or a
     * repeated code reads "…already exists. Use a different name." while
     * pointing at a field that is not the name.
     */
    label?: string;
  };
  /**
   * Live "did you mean?" chips under the `dupCheck` field. Off by default.
   *
   *   spellSuggest: true                       — rows on this screen only
   *   spellSuggest: { seed: STOCK_UNIT_NAMES } — that vocabulary as well
   *
   * Requires `dupCheck` — it reuses that descriptor's field and its `value`
   * accessor, so the chip and the red error always read the SAME text. Declaring
   * it without `dupCheck` does nothing.
   *
   * `true` offers ONLY names already on this screen, which says nothing at all
   * on a thin or empty table — the operator sets the house spelling on the first
   * row typed, which is exactly the moment a dictionary would have helped. A
   * `seed` fixes that, and the ONE rule about seeds is that each list belongs to
   * a single master (see lib/masters/name-vocabularies.ts). The first version of
   * this feature DEFAULTED its seed to a fibre vocabulary, so a Packing
   * Accessories name got "corrected" to COTTON (client 2026-07-28) and the
   * client had the feature removed outright two days later. A seed named at the
   * call site cannot reach a screen that did not ask for it; a defaulted one
   * reaches all of them. There is deliberately no default here.
   *
   * Leave it `true` where no real-world standard exists (Bin, Count, Gauge,
   * Knitting Dia). Rows-only is a correct answer; an invented vocabulary is not.
   */
  spellSuggest?: boolean | { seed: string[] };
  /** Build the exact server-action payload (trimming already applied to text values). */
  toPayload: (values: SimpleValues, status: SimpleStatus) => unknown;
  actions: {
    create: (payload: never) => Promise<ActionResult & { id?: string }>;
    update: (id: string, payload: never) => Promise<ActionResult>;
    remove: (id: string) => Promise<ActionResult & { inactive?: boolean; usedBy?: string }>;
  };
};

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; canImport?: boolean };

type Editing = {
  /** null = the "+ Add" row. */
  id: string | null;
  values: SimpleValues;
  status: "active" | "inactive" | "draft";
};

/* ------------------------------------------------------------- component */

/**
 * Config-driven master screen for the TRIVIAL tier (code + name + a couple of
 * flat fields): no dialog at all — the row itself becomes editable ("inline
 * edit"), and "+ Add" prepends an editable row above the table. Each entity
 * screen collapses to a small descriptor + its imported server actions.
 *
 * Owns its own <table> markup (mirroring DataTable's classes) because the
 * presentational DataTable can't host per-row edit state or the add row; the
 * add row also deliberately lives OUTSIDE pagination slicing so it never
 * disappears onto another page.
 */
export function SimpleMasterScreen<Row>({
  rows,
  perms,
  descriptor,
}: {
  rows: Row[];
  perms: Perms;
  descriptor: SimpleMasterDescriptor<Row>;
}) {
  const d = descriptor;
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing | null>(null);
  // Read-only view (client 2026-07-30). Holds the row itself — everything the
  // sheet renders is already on it, so there is nothing to fetch.
  const [viewRow, setViewRow] = useState<Row | null>(null);

  // Hold off the silent PWA auto-reload while a row is being added/edited or a
  // save is in flight. This is inline editing with no overlay at all, so
  // reload-guard's DOM scan has nothing to see — the declaration is the only
  // signal. One line here covers every simple master.
  useUnsavedGuard(editing !== null || isPending);

  const getId = d.getId ?? ((r: Row) => (r as { id: string }).id);
  const hasStatus = d.status !== "none";
  const statusOf = useMemo(
    () =>
      d.statusOf ??
      // Reads all three spellings, not just `is_active`: a descriptor master on
      // an `inactive` / `blocked` table that omitted `statusOf` used to report
      // every row Active, so the Status facet quietly filtered nothing.
      ((r: Row) => (isInactive(r as Deactivatable) ? ("inactive" as const) : ("active" as const))),
    [d.statusOf],
  );

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, isStale, dateFilter } = useMasterFilter<
    Row,
    Record<string, string>
  >(rows, {
    searchKey: d.searchText,
    filters: {
      ...(hasStatus ? { status: (r: Row, v: string) => statusOf(r) === v } : {}),
      ...Object.fromEntries((d.extraFilters ?? []).map((f) => [f.key, f.predicate])),
    },
    initialFilters: {
      ...(hasStatus ? { status: "" } : {}),
      ...Object.fromEntries((d.extraFilters ?? []).map((f) => [f.key, ""])),
    },
  });

  const pg = usePagination(filtered, 10);

  const blankValues = useMemo(() => {
    const v: SimpleValues = {};
    for (const f of d.fields) v[f.key] = f.kind === "checkbox" ? false : "";
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same data-derived gate the Created Date facet uses, so the column and the
  // filter appear together or not at all.
  const showCreated = useMemo(() => hasCreatedInfo(rows), [rows]);

  /**
   * The descriptor's extras plus the Created pair. `extraColumns` is already
   * the contract position — this engine renders Status after it — so this is a
   * plain append, unlike `MasterListShell` which has to splice.
   *
   * A Created column declared by the descriptor is STRIPPED: Count's said
   * "Created Date" but read raw `created_by`, which is a uuid on most tables.
   * The engine's version is the one that survives.
   */
  const extraColumns = useMemo(() => {
    const own = (d.extraColumns ?? []).filter(
      (c) => !/^\s*created\s*(date|dt|user|by|on)?\s*$/i.test(c.header),
    );
    return showCreated ? [...own, ...createdColumns<Row>()] : own;
  }, [d.extraColumns, showCreated]);

  function startAdd() {
    if (!perms.canCreate) return;
    setEditing({ id: null, values: { ...blankValues }, status: "active" });
  }
  function startEdit(r: Row) {
    if (!perms.canEdit) return;
    setEditing({ id: getId(r), values: d.fromRow(r), status: hasStatus ? statusOf(r) : "active" });
  }
  function cancelEdit() {
    setEditing(null);
  }

  useCreateIntent(startAdd);

  /*
   * Global shortcuts — Ctrl+N adds, Ctrl+F focuses search. MasterListShell has
   * registered these since the shortcuts registry landed, but this screen (the
   * 31 highest-volume masters, and the only tier with inline row edit) never
   * did, so the two bindings the keyboard-first flow leans on hardest were dead
   * exactly where an operator keys all day.
   *
   * Ctrl+N is gated on `!editing` for the same reason the Add button carries
   * `disabled={editing?.id === null}`: starting a second add would silently
   * discard the row being typed.
   */
  const searchRef = useRef<HTMLInputElement>(null);
  useRegisterShortcut("new", startAdd, perms.canCreate && !editing);
  useRegisterShortcut("search", () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  });
  /**
   * An open inline row is a savable surface, and this is how it says so.
   *
   * These rows are plain page `<tr>`s — no Sheet, no footer region — so before
   * this the ONLY way to commit one from the keyboard was a local Enter handler
   * that saved from whichever cell the cursor happened to be in. Under
   * Enter-advance that was actively wrong: on a 4-field row it committed from
   * field one. Registering here instead puts the row on the same path every other
   * editor uses, so Enter walks the cells and saves off the last, `save()`'s own
   * canSave/isPending guard still applies, and Ctrl+S works on a row for free.
   *
   * NOT solved by marking `saveCancelButtons` as a footer region: it renders Save
   * THEN Cancel, and the footer rule takes the last button by POSITION — so the
   * marker alone would have made Enter click Cancel and discard the row.
   */
  useRegisterShortcut("save", save, !!editing);

  // Real-time duplicate check on the descriptor's unique field (mirrors the
  // on-save guard in the entity's actions; no-op when dupCheck is undeclared).
  const dupValue =
    editing && d.dupCheck
      ? d.dupCheck.value?.(editing.values) ?? String(editing.values[d.dupCheck.fieldKey] ?? "")
      : "";
  const dupError = useDuplicateName({
    table: d.dupCheck?.table ?? "",
    name: dupValue,
    nameColumn: d.dupCheck?.nameColumn,
    scope: d.dupCheck?.scope,
    label: d.dupCheck?.label,
    excludeId: editing?.id ?? undefined,
    enabled: !!d.dupCheck && !!dupValue.trim(),
    /**
     * The synchronous half, for all 31 descriptor masters at once — without it,
     * Enter pressed inside the 300ms debounce saves a duplicate this screen was
     * already holding in memory.
     *
     * `rows`, NOT `filtered`: the operator typing a new name has usually just
     * searched for it, and a search that found nothing is exactly when the
     * filtered list cannot contain the row about to be collided with.
     *
     * The row value comes back through `fromRow` + the descriptor's own `value`
     * derivation, so the local comparison reads the SAME field the server one
     * does. A separate row accessor here would be a second place to keep in
     * step, and the first thing to drift.
     */
    rows,
    rowId: getId,
    rowValue: (r) => {
      if (!d.dupCheck) return "";
      const v = d.fromRow(r);
      return d.dupCheck.value?.(v) ?? String(v[d.dupCheck.fieldKey] ?? "");
    },
  });

  /**
   * "Did you mean?" candidates for the dup field — the names already on this
   * screen, minus the row being edited (a record must not suggest its own name
   * back at you). The descriptor's `seed`, where it declares one, is added
   * alongside these by the hook.
   *
   * Read through the descriptor's own `value` accessor, the same one `dupCheck`
   * uses, so the chip and the red error can never disagree about which text they
   * are talking about.
   *
   * `enabled` is off while a duplicate error is showing: that field already has
   * a line under it, and the exact name it collided with is not a useful thing
   * to "suggest" — the operator needs a DIFFERENT name, not that one.
   */
  /**
   * Put the cursor in the row that just went into edit mode.
   *
   * Replaces a per-cell `autoFocus` that was passed only to `editCell(f, i===0)`
   * and then honoured by exactly ONE of its four branches — the plain text
   * input. The other three silently dropped it (client 2026-08-01):
   *
   *   - `lockedOnEdit` renders a <span>, so a master whose FIRST field is locked
   *     opened with no cursor at all. Currency is exactly that shape (`code` is
   *     fields[0] and lockedOnEdit), so editing a currency focused nothing.
   *   - the checkbox branch builds its own <input> and never spread it.
   *   - the select branch builds a <Select> and never passed it.
   *   - MobileEditCard calls `editCell(f)` with no autoFocus at all, so inline
   *     edit on a phone opened with no cursor on every one of these screens.
   *
   * `focusFirstField` already knows how to answer "the first thing worth typing
   * into", including skipping a locked first column, so one call on the row
   * covers all four. Keyed on WHICH row is being edited, not on `editing` — that
   * object is replaced on every keystroke, and re-focusing mid-typing would send
   * the caret back to column one after each character.
   */
  const editRowRef = useRef<HTMLElement | null>(null);
  const editKey = editing ? editing.id ?? "__new__" : null;
  useEffect(() => {
    if (!editKey) return;
    focusFirstField(editRowRef.current);
  }, [editKey]);

  /** Write one field of the row being edited. Hoisted because two callers need
   *  it: the input cell below, and the suggestion strip, which has to write the
   *  dup field from up here. */
  const setFieldValue = (key: string, nv: string | boolean) =>
    setEditing((e) => (e ? { ...e, values: { ...e.values, [key]: nv } } : e));

  const suggestNames = useMemo(() => {
    if (!d.spellSuggest || !d.dupCheck) return [];
    return rows
      .filter((r) => getId(r) !== editing?.id)
      .map((r) => {
        const v = d.fromRow(r);
        return d.dupCheck!.value?.(v) ?? String(v[d.dupCheck!.fieldKey] ?? "");
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, rows, editing?.id]);
  // A descriptor's seed, or none. `true` means "rows only" and is the default
  // for every master without a real-world standard to draw on.
  const suggestSeed = useMemo(
    () => (typeof d.spellSuggest === "object" ? d.spellSuggest.seed : []),
    [d.spellSuggest],
  );
  const nameSuggest = useSpellSuggest({
    name: dupValue,
    names: suggestNames,
    seed: suggestSeed,
    enabled: !!d.spellSuggest && !!d.dupCheck,
    // Applied through the same setter the input uses, so an accepted chip is
    // indistinguishable from having typed the name.
    onApply: (v) => d.dupCheck && setFieldValue(d.dupCheck.fieldKey, v),
  });

  const canSave =
    !!editing &&
    !dupError &&
    d.fields.every(
      (f) => !f.required || String(editing.values[f.key] ?? "").trim().length > 0,
    ) &&
    // Format-constrained fields must be valid (empty passes — required-ness handled above).
    d.fields.every((f) => !f.format || !validateFormat(f.format, String(editing.values[f.key] ?? "")));

  function save() {
    if (!editing || !canSave || isPending) return;
    const trimmed: SimpleValues = {};
    for (const f of d.fields) {
      const v = editing.values[f.key];
      trimmed[f.key] = typeof v === "string" ? v.trim() : (v ?? false);
    }
    const invalid = d.validate?.(trimmed);
    if (invalid) {
      error(invalid); // row stays editable
      return;
    }
    const payload = d.toPayload(trimmed, {
      active: editing.status === "active",
      draft: editing.status === "draft",
    }) as never;
    const isNew = editing.id === null;
    startTransition(async () => {
      const res = isNew ? await d.actions.create(payload) : await d.actions.update(editing.id!, payload);
      if (res.ok) {
        success(isNew ? `${d.entityLabel} added.` : `${d.entityLabel} updated.`);
        setEditing(null);
        router.refresh();
      } else {
        error(res.error); // row stays editable with values intact
      }
    });
  }

  function remove(r: Row) {
    startTransition(async () => {
      const res = await d.actions.remove(getId(r));
      if (res.ok) {
        success(deletedToast(d.entityLabel, { inactive: res.inactive ?? false, usedBy: res.usedBy }));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  /**
   * Inline-edit row: Escape cancels. That is all that is left here.
   *
   * Enter used to save from this handler, because a plain page `<tr>` has no
   * Sheet and no footer and there was nothing else to commit it. It is gone —
   * the row now registers "save" with the global registry (see above), so Enter
   * follows the same contract as every other surface: it walks the row's cells
   * and commits off the last one. A local Enter here would have kept saving from
   * cell one, i.e. exactly the premature save Enter-advance removes.
   *
   * Field navigation, including which controls keep their own Enter (a textarea,
   * a button, a tick box, an open dropdown), is decided once in lib/focus.ts —
   * this file no longer keeps a second copy of that list.
   */
  function onRowKeyDown(e: KeyboardEvent<HTMLElement>) {
    // Arrow navigation comes from keyboard-nav-provider.tsx. The editing row
    // carries `data-focus-scope`, so ↓/↑ and Enter stay within the row instead
    // of walking the whole page — only one row is editable at a time.
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  /* ------------------------------------------------------------ cells */

  /**
   * Takes the already-built values record, NOT the row: `fromRow` is a
   * descriptor callback that allocates a fresh object, and calling it per field
   * per row meant a 6-field × 100-row page rebuilt it 600 times on every render
   * — i.e. on every keystroke in the search box. The mobile branch below always
   * hoisted it; this is the desktop table catching up.
   */
  function readCell(f: SimpleField, values: SimpleValues) {
    const raw = values[f.key];
    if (f.kind === "checkbox") {
      return <span className="text-sm">{raw ? "Yes" : "—"}</span>;
    }
    const v = String(raw ?? "");
    if (!v) return <span className="text-sm text-muted-foreground">—</span>;
    if (f.kind === "select") {
      const label = f.optionLabel?.(v) ?? f.options?.find((o) => o.value === v)?.label ?? v;
      return <span className="text-sm">{label}</span>;
    }
    return <span className={cn(f.mono ? "font-mono text-xs" : "text-sm")}>{v}</span>;
  }

  function editCell(f: SimpleField) {
    if (!editing) return null;
    const v = editing.values[f.key];
    if (f.lockedOnEdit && editing.id !== null) {
      // Immutable on existing rows (e.g. a code that is the PK).
      return <span className={cn(f.mono ? "font-mono text-xs" : "text-sm")}>{String(v ?? "")}</span>;
    }
    const setV = (nv: string | boolean) => setFieldValue(f.key, nv);

    if (f.kind === "checkbox") {
      return (
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-primary"
          checked={!!v}
          onChange={(e) => setV(e.target.checked)}
          aria-label={f.label}
        />
      );
    }
    if (f.kind === "select") {
      return (
        <Select
          value={String(v ?? "")}
          onChange={(e) => setV(e.target.value)}
          className={cn("h-8 text-sm", f.widthClass)}
          aria-label={f.label}
        >
          <option value="">—</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    const placeholder =
      f.placeholder ??
      (f.defaultsTo ? String(editing.values[f.defaultsTo] ?? "") || undefined : undefined);
    const isDupField = d.dupCheck?.fieldKey === f.key;
    const common = {
      value: String(v ?? ""),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value),
      className: cn("h-8 text-sm", f.widthClass),
      placeholder,
      // Auto/derived fields drop out of Tab order but stay clickable/editable.
      tabIndex: f.skipTab ? -1 : undefined,
      "aria-label": f.label,
      /**
       * THE SAME `required` THAT DRAWS THE `*` MUST REACH THE CONTROL.
       *
       * `f.required` already drew the star in both headers and already gated
       * Save (`canSave` above) — but it stopped there, so `useRequiredHold`
       * never saw it and the cursor never held. The operator got a `*`, a dead
       * Save button, and a Tab key that walked straight past the blank field
       * with nothing to say why (client 2026-08-04).
       *
       * That is the star-without-hold disagreement the contract exists to
       * prevent, and it was here at scale: this engine backs ~31 masters, and 16
       * of them declare `required: true` on 20 fields between them. It is also
       * invisible to `audit_layout.py --check required-hold`, whose
       * `is_editor_screen()` gate never matches a descriptor screen — it renders
       * no Sheet, DetailSection or FieldGrid of its own.
       *
       * A `skipTab` field is auto-generated and never held: it has no keyboard
       * exit, which is the same reason `Input` refuses to hold a readOnly one.
       */
      required: f.required && !f.skipTab,
      // Spread inside `common`, which every branch below spreads LAST — so on a
      // ValidatedInput it wins over that component's own `aria-invalid`. It
      // emits no keys at all when there is no duplicate, which is what keeps
      // required-field invalidity intact (see dupFieldProps).
      ...(isDupField ? dupFieldProps(dupError) : null),
      // The suggestion strip's keys live on the input that owns it: ↓ into the
      // chips, Enter to apply, Esc to dismiss. Only attached on the dup field,
      // and the handler no-ops whenever there is nothing showing — so Enter
      // keeps its contract meaning (advance / save) the rest of the time.
      ...(isDupField && d.spellSuggest ? { onKeyDown: nameSuggest.onKeyDown } : null),
    };
    // Plain text fields type in CAPS (client 2026-07-23) — no-op for digits;
    // format-driven fields keep their own ValidatedInput transforms.
    const input = f.format ? <ValidatedInput format={f.format} {...common} /> : <Input uppercase {...common} />;
    if (isDupField) {
      return (
        <div>
          {input}
          {/* These now STACK on purpose, and only ever two deep. The red error
              says the typed name is taken; the chips under it are free names —
              which is exactly what the operator needs at that moment, and the
              way out of a field the error is holding the cursor in. The hint's
              own "already exists" half stands down while the error shows, so
              there is never a third line. */}
          <DuplicateError error={dupError} />
          <SpellSuggestHint
            suggestions={nameSuggest.suggestions}
            existing={nameSuggest.existing}
            activeIndex={nameSuggest.activeIndex}
            duplicate={!!dupError}
            onApply={(v) => setV(v)}
          />
        </div>
      );
    }
    return input;
  }

  function statusEditCell() {
    if (!editing) return null;
    // Inactive is an edit-time state — new records are always created Active.
    // Draft-capable masters keep the full select on add (Draft is a valid start).
    if (editing.id === null && d.status === "active") {
      return <StatusPill tone="success">Active</StatusPill>;
    }
    return (
      <Select
        value={editing.status}
        onChange={(e) =>
          setEditing((ed) => (ed ? { ...ed, status: e.target.value as Editing["status"] } : ed))
        }
        className="h-8 w-28 text-sm"
        aria-label="Status"
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        {d.status === "activeDraft" && <option value="draft">Draft</option>}
      </Select>
    );
  }

  /**
   * The row's human name — used for the mobile card title, the view sheet title
   * and the row-action aria-labels, so all three agree. Same fallback chain the
   * mobile card has always used: `mobileTitleKey`, else fields[1] (historically
   * Name, after a leading Code column), else fields[0].
   */
  function rowTitle(r: Row): string {
    const values = d.fromRow(r);
    const first = d.fields[0];
    const key = d.mobileTitleKey ?? d.fields[1]?.key ?? first.key;
    return String(values[key] ?? "") || String(values[first.key] ?? "");
  }

  function statusPill(r: Row) {
    const s = statusOf(r);
    return (
      <StatusPill tone={s === "active" ? "success" : s === "draft" ? "warning" : "danger"}>
        {s === "active" ? "Active" : s === "draft" ? "Draft" : "Inactive"}
      </StatusPill>
    );
  }

  function saveCancelButtons(compact = true) {
    return (
      <div className={cn("flex items-center gap-1", compact && "justify-end")}>
        <Button size="sm" disabled={isPending || !canSave} onClick={save} aria-label="Save">
          <Check className="h-4 w-4" />
          {isPending ? "…" : "Save"}
        </Button>
        <Button variant="ghost" size="sm" onClick={cancelEdit} aria-label="Cancel">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const empty = `No ${d.entityLabel.toLowerCase()} records yet.`;

  /* ------------------------------------------------------------ render */

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          searchRef={searchRef}
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder={`Search ${d.entityLabel.toLowerCase()}...`}
          activeCount={activeCount}
          onReset={
            hasStatus || (d.extraFilters?.length ?? 0) > 0 || dateFilter.enabled
              ? () => {
                  reset();
                  pg.setPage(1);
                }
              : undefined
          }
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
        >
          {hasStatus || (d.extraFilters?.length ?? 0) > 0 ? (
            <>
              {hasStatus && (
                <div>
                  <Label htmlFor="sms-filter-status">Status</Label>
                  <Select
                    id="sms-filter-status"
                    value={filterValues.status ?? ""}
                    onChange={(e) => {
                      setFilter("status", e.target.value);
                      pg.setPage(1);
                    }}
                    className="text-base md:text-sm"
                  >
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    {d.status === "activeDraft" && <option value="draft">Draft</option>}
                  </Select>
                </div>
              )}
              {(d.extraFilters ?? []).map((f) => (
                <div key={f.key}>
                  <Label htmlFor={`sms-filter-${f.key}`}>{f.label}</Label>
                  <Select
                    id={`sms-filter-${f.key}`}
                    value={filterValues[f.key] ?? ""}
                    onChange={(e) => {
                      setFilter(f.key, e.target.value);
                      pg.setPage(1);
                    }}
                    className="text-base md:text-sm"
                  >
                    <option value="">All</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </>
          ) : undefined}
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          {d.ioEntityKey && (
            <DataIoToolbar
              entityKey={d.ioEntityKey}
              rows={filtered}
              canExport={perms.canExport}
              canImport={perms.canImport}
            />
          )}
          {perms.canCreate && (
            <Button size="md" onClick={startAdd} disabled={editing?.id === null}>
              + Add {d.entityLabel}
            </Button>
          )}
        </div>
      </div>

      {/* ---------------- desktop table (own markup, DataTable classes) ---------------- */}
      {/* Dimmed while the deferred filter catches up, so the operator is never
          shown rows that don't match what they just typed without a cue. */}
      <div
        className={cn(
          "hidden overflow-x-auto rounded-lg border border-border bg-surface transition-opacity md:block",
          isStale && "opacity-60",
        )}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              {d.fields.map((f) => (
                <th key={f.key} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                  {f.label}
                  {f.required && <span className="ml-0.5 text-danger">*</span>}
                </th>
              ))}
              {extraColumns.map((c) => (
                <th key={c.header} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                  {c.header}
                </th>
              ))}
              {hasStatus && (
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Status</th>
              )}
              <th className={cn(ROW_ACTIONS_WIDTH, "px-3 py-2")} />
            </tr>
          </thead>
          <tbody>
            {/* add row — outside pagination, always on top */}
            {editing?.id === null && (
              <tr ref={editRowRef as React.Ref<HTMLTableRowElement>} className="border-b border-border bg-primary/5" data-focus-scope onKeyDown={onRowKeyDown}>
                {d.fields.map((f) => (
                  <td key={f.key} className="px-3 py-1.5 align-middle">
                    {editCell(f)}
                  </td>
                ))}
                {extraColumns.map((c) => (
                  <td key={c.header} className="px-3 py-1.5 align-middle text-sm text-muted-foreground">
                    —
                  </td>
                ))}
                {hasStatus && <td className="px-3 py-1.5 align-middle">{statusEditCell()}</td>}
                <td className="px-3 py-1.5 align-middle">{saveCancelButtons()}</td>
              </tr>
            )}
            {pg.paged.length === 0 && editing?.id !== null ? (
              <tr>
                <td
                  colSpan={d.fields.length + extraColumns.length + (hasStatus ? 1 : 0) + 1}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              pg.paged.map((r) => {
                const isEditing = editing?.id === getId(r);
                if (isEditing) {
                  return (
                    <tr key={getId(r)} ref={editRowRef as React.Ref<HTMLTableRowElement>} className="border-b border-border bg-primary/5 last:border-0" data-focus-scope onKeyDown={onRowKeyDown}>
                      {d.fields.map((f) => (
                        <td key={f.key} className="px-3 py-1.5 align-middle">
                          {editCell(f)}
                        </td>
                      ))}
                      {extraColumns.map((c) => (
                        <td key={c.header} className="px-3 py-1.5 align-middle text-sm text-muted-foreground">
                          {c.cell(r)}
                        </td>
                      ))}
                      {hasStatus && <td className="px-3 py-1.5 align-middle">{statusEditCell()}</td>}
                      <td className="px-3 py-1.5 align-middle">{saveCancelButtons()}</td>
                    </tr>
                  );
                }
                const values = d.fromRow(r);
                return (
                  <tr key={getId(r)} className="border-b border-border last:border-0 hover:bg-surface-muted/60">
                    {d.fields.map((f) => (
                      <td key={f.key} className="px-3 py-2 align-middle">
                        {readCell(f, values)}
                      </td>
                    ))}
                    {extraColumns.map((c) => (
                      <td key={c.header} className="px-3 py-2 align-middle text-sm text-muted-foreground">
                        {c.cell(r)}
                      </td>
                    ))}
                    {hasStatus && <td className="px-3 py-2 align-middle">{statusPill(r)}</td>}
                    <td className="px-3 py-2 align-middle">
                      <RowActions
                        label={rowTitle(r)}
                        onView={() => setViewRow(r)}
                        onEdit={() => startEdit(r)}
                        onDelete={() => remove(r)}
                        canEdit={perms.canEdit}
                        canDelete={perms.canDelete}
                        /* Another row is mid-edit: starting a second one would
                           silently discard what is being typed. */
                        editDisabled={!!editing}
                        isPending={isPending}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------- mobile cards with in-place edit ---------------- */}
      <div className={cn("space-y-2.5 transition-opacity md:hidden", isStale && "opacity-60")}>
        {editing?.id === null && (
          <MobileEditCard
                  cardRef={editRowRef as React.Ref<HTMLDivElement>}
            fields={d.fields}
            editCell={editCell}
            statusCell={hasStatus ? statusEditCell() : null}
            buttons={saveCancelButtons(false)}
            onKeyDown={onRowKeyDown}
          />
        )}
        {pg.paged.length === 0 && editing?.id !== null ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            {empty}
          </div>
        ) : (
          pg.paged.map((r) => {
            if (editing?.id === getId(r)) {
              return (
                <MobileEditCard
                  cardRef={editRowRef as React.Ref<HTMLDivElement>}
                  key={getId(r)}
                  fields={d.fields}
                  editCell={editCell}
                  statusCell={hasStatus ? statusEditCell() : null}
                  buttons={saveCancelButtons(false)}
                  onKeyDown={onRowKeyDown}
                />
              );
            }
            const title = rowTitle(r);
            return (
              <div key={getId(r)} className="rounded-xl border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => startEdit(r)}
                  disabled={!perms.canEdit || !!editing}
                  className="block w-full p-4 text-left enabled:active:bg-surface-muted disabled:cursor-default"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Truncated className="text-[15px] font-semibold text-foreground">{title || "—"}</Truncated>
                      {d.mobileMeta && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{d.mobileMeta(r)}</div>
                      )}
                      {/* Appended, not substituted — the card has room for both,
                          and the desktop table shows them both too. */}
                      {showCreated && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
                      )}
                    </div>
                    {hasStatus && statusPill(r)}
                  </div>
                </button>
                {/* Footer controls are SIBLINGS of the tap-to-edit button, never
                    nested inside it — button-in-button is invalid markup and the
                    two-step confirm breaks. Mirrors MobileCardList's footer;
                    this screen keeps its own card because the list interleaves
                    MobileEditCard for whichever row is being edited. */}
                <div className="flex items-center justify-end gap-1 border-t border-border px-3 py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`View ${title}`}
                    onClick={() => setViewRow(r)}
                  >
                    <Eye />
                    View
                  </Button>
                  {/* Text, not the desktop bin icon: same reason MobileCardList
                      uses text here — a 32px icon is not a touch target. */}
                  {perms.canDelete && (
                    <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* Read-only view, owned by the engine so all 31 simple masters get one
          from a single `view` function on their descriptor. No Edit in the
          footer — see record-view-sheet.tsx. */}
      {viewRow && (
        <RecordViewSheet
          open
          onClose={() => setViewRow(null)}
          title={rowTitle(viewRow) || d.entityLabel}
          status={hasStatus ? statusPill(viewRow) : undefined}
          sections={[
            ...(d.view ? d.view(viewRow) : [{ label: "Details", pairs: pairsFromRow(viewRow) }]),
            ...createdSection(viewRow),
          ]}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ mobile edit card */

function MobileEditCard({
  fields,
  editCell,
  statusCell,
  buttons,
  onKeyDown,
  cardRef,
}: {
  fields: SimpleField[];
  editCell: (f: SimpleField) => ReactNode;
  statusCell: ReactNode;
  buttons: ReactNode;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** Same ref the desktop <tr> takes, so the engine's one focus effect puts the
   *  cursor in the first field here too. Mobile inline edit previously opened
   *  with no cursor at all on every descriptor master. */
  cardRef?: React.Ref<HTMLDivElement>;
}) {
  /*
   * `data-focus-scope` is set HERE, not passed in. Both call sites used to pass
   * it as a prop, but a hyphenated JSX attribute skips TypeScript's excess-prop
   * check, so it type-checked and was then silently dropped — mobile inline edit
   * had no focus scope at all and ↓/↑ walked the whole page instead of the card.
   * The card is only ever rendered while editing, so the scope is unconditional.
   */
  return (
    <div
      ref={cardRef}
      data-focus-scope
      className="space-y-3 rounded-xl border border-primary/40 bg-surface p-4"
      onKeyDown={onKeyDown}
    >
      {fields.map((f) => (
        <div key={f.key}>
          <Label>
            {f.label}
            {f.required && <span className="ml-0.5 text-danger">*</span>}
          </Label>
          {editCell(f)}
        </div>
      ))}
      {statusCell && (
        <div>
          <Label>Status</Label>
          {statusCell}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-3">{buttons}</div>
    </div>
  );
}
