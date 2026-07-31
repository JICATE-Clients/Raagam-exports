"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useModalGuard } from "@/lib/reload-guard";
import { deletedToast } from "@/lib/masters/delete-message";
// Upward import (ui → masters) on purpose, and safe: `picker-keys` and
// `delete-message` are leaf helpers that import `lib/*` only, so there is no
// cycle. The alternative was a second copy of the Escape/Tab block, which is
// the exact mistake picker-keys.ts was created to undo.
import { pickerKeyDown, usePickerFocusReturn } from "@/components/masters/picker-keys";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import { cn } from "@/lib/utils";

/** One selectable record. `sublabel` renders muted beside the label. */
export type PickerRow = {
  id: string;
  label: string;
  sublabel?: string | null;
  disabled?: boolean;
};

/** What the inline Add/Modify form collects. `typeCode` is item-class only. */
export type PickerDraft = { code: string; name: string; typeCode?: string };

type ActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Everything a picker needs to CREATE, EDIT and DELETE its own rows.
 *
 * Lifted verbatim from `lookup-picker.tsx`, where it already backed the Category
 * / Item / Attribute pickers — this file did not invent a CRUD contract, it gave
 * the existing one a dropdown instead of a nested Sheet.
 *
 * The `onCreated` / `onUpdated` / `onDeleted` callbacks exist because the rows
 * come from a server component as a prop: the host screen patches its own copy
 * so the new value is visible immediately, and `router.refresh()` reconciles.
 * Without them a freshly added value vanishes from the list until the round trip
 * lands.
 */
export type ManageConfig = {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onCreate: (draft: PickerDraft) => Promise<ActionResult<{ id: string }>>;
  onUpdate: (id: string, draft: PickerDraft) => Promise<ActionResult>;
  /**
   * MUST route through the shared delete-or-deactivate guard, never a raw
   * delete: a value any transaction references comes back `inactive: true` with
   * the referencing table in `usedBy`, and the toast says so. That guard is what
   * makes Delete safe to expose on a dropdown at all.
   */
  onDelete: (id: string) => Promise<ActionResult<{ inactive: boolean; usedBy?: string }>>;
  onCreated: (id: string, draft: PickerDraft) => void;
  onUpdated: (id: string, draft: PickerDraft) => void;
  onDeleted: (id: string, inactive: boolean) => void;
  draftOf: (row: PickerRow) => PickerDraft;
  /** Show a "Type" field in the Add/Modify form — `kind='item_class'` only. */
  showTypeField?: boolean;
  /**
   * Live "already exists" check for the inline Add / Modify form.
   *
   * Without it the only feedback is whatever the server returns on Save, and for
   * a `config_lookups` value that is the raw Postgres unique-violation string
   * from `uq_config_lookups_kind_name` — a stack trace where a sentence belongs.
   * Wired once here, so every adapter that passes it gets the check
   * (`LookupDialogPicker` alone is ~78 fields).
   *
   * `scope` must match how the DB scopes uniqueness — `{ kind }` for config
   * lookups, `{ item_class_id }` for categories — or the check disagrees with
   * the constraint that actually rejects the row.
   */
  dupCheck?: { table: string; nameColumn?: string; scope?: Record<string, string | null> };
};

const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/**
 * True on a real mouse/desktop — the same signal `select.tsx` uses to stay
 * native on touch.
 *
 * `useSyncExternalStore` rather than the `useState` + `useEffect` pair that
 * `useEnhance` uses next door: a media query IS an external store, the server
 * snapshot (`false`) makes SSR unambiguous, and it re-renders if the answer
 * changes mid-session — a tablet with a keyboard folio attached flips this while
 * the app is open, and the effect version would have kept the touch layout until
 * a reload.
 */
function useFinePointer(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(FINE_POINTER);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(FINE_POINTER).matches,
    () => false,
  );
}

const ROW_ICON =
  "shrink-0 rounded p-0.5 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100";

/**
 * THE picker. One shape for every field that references stored data, anywhere in
 * the app (client 2026-07-29).
 *
 * ## Why this exists
 *
 * Stored data used to be offered three different ways depending on when the
 * field was built: a modal dialog (`lookup-dialog-picker.tsx`, 17 screens), a
 * select-only modal (`record-picker.tsx`, 17 screens), a nested Sheet with CRUD
 * (`lookup-picker.tsx`, 8 screens), plus a dozen bespoke clones — while plain
 * enums dropped a list down under the field. Three interaction models could
 * appear on ONE form: City opened a modal, Ship Mode dropped down, Category
 * opened a second Sheet. The client asked for one: a dropdown that lists the
 * data, searches as you type, and can add / edit / delete in place.
 *
 * This is a merge of two components that already existed — `Combobox`'s
 * anchored, portaled, keyboard-driven panel and `DialogListPicker`'s
 * `ManageConfig` — not a new invention. Every legacy picker is now a ~30-line
 * adapter over it.
 *
 * ## Two modes, and the mode decides the rules
 *
 * **List mode is a dropdown**, so it is NOT modal: Tab leaves without choosing,
 * clicks outside dismiss, nothing is trapped. The trigger is an
 * `<input role="combobox">` rather than a button, which is what lets
 * `ownsArrowKeys` (lib/focus.ts) and `gridKeyNav` (child-grid.tsx) recognise it
 * with no changes to either — a Combobox cell already behaves this way, so a
 * picker cell beside it finally behaves identically.
 *
 * **Form mode (Add / Modify / Delete) is modal.** The panel takes
 * `role="dialog" aria-modal`, Tab is trapped inside it, a scrim covers the page,
 * and `useModalGuard` holds off the silent PWA reload — the panel now holds text
 * the operator typed, and AGENTS.md requires any hand-rolled overlay to say so.
 * Escape unwinds exactly one layer: form → list → closed.
 *
 * ## Keyboard (.claude/skills/raagam-keyboard-contract)
 *
 *   ↓        open; then move the highlight (clamped, never wraps)
 *   ↑        move up when open; when CLOSED it bubbles, so the provider moves to
 *            the field above — ↑ must never be a second way to open a list
 *   Enter    pick the highlight, close, and STAY on the field; when closed it
 *            bubbles and saves the record
 *   Tab      close WITHOUT committing and let focus move on — never
 *            preventDefault in list mode, or focus would stick
 *   Esc      close the list only; preventDefault or the page-level Escape
 *            navigates away from the screen entirely
 *   F2       modify the highlighted row
 *   Insert   add
 *   Ctrl+Del delete the highlighted row
 *
 * The last three are how a keyboard-only operator reaches the row icons without
 * Tab entering a non-modal panel. They are legacy-RP muscle memory. `Ctrl+Delete`
 * rather than plain Delete because the trigger is a text box the operator is
 * typing a filter into.
 */
export function DataPicker({
  label,
  title,
  rows,
  value,
  onChange,
  placeholder,
  clearable = true,
  required = false,
  invalid = false,
  compact = false,
  disabled = false,
  id,
  manage,
  onAddOverride,
  onEditOverride,
  triggerVariant = "field",
  addLabel,
  className,
}: {
  /** Field label. Rendered unless `compact`; also the dialog title and toast noun. */
  label: string;
  /** Overrides `label` for the panel title / toasts — for grid cells whose column
   *  header already names the field, so `label` is blank. */
  title?: string;
  rows: PickerRow[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  required?: boolean;
  /** Rejected by the host form (e.g. the same attribute picked on two lines) —
   *  red border plus `aria-invalid`, which also holds Enter on the field. */
  invalid?: boolean;
  /** Trigger only, no <Label> — for dense grid rows. */
  compact?: boolean;
  disabled?: boolean;
  id?: string;
  /** Omit for a select-only picker (no Add / Modify / Delete). */
  manage?: ManageConfig;
  /**
   * Hand "+ Add" to a richer creation flow instead of the inline name-only form
   * — a Country needs its ISD and ECGC codes, a Bank its IFSC, and a row created
   * name-only would be born incomplete. Receives `commit` so the flow can select
   * what it created and close this panel. Precedent: the Yarn and Category
   * quick-create sheets.
   */
  onAddOverride?: (commit: (id: string) => void) => void;
  /**
   * The pencil's counterpart to `onAddOverride`. Without it the pencil opens the
   * inline name-only form, which is right for a config list and wrong for a
   * Country — renaming is only one of the six things that record holds.
   */
  onEditOverride?: (row: PickerRow, commit: (id: string) => void) => void;
  /**
   * `"add"` swaps the field box for a dashed "+ Add …" pill that appends on
   * pick — the shape the Applicant picker uses at the foot of a child grid,
   * where there is no field to fill, only a row to append. Same list, same keys;
   * only the closed state differs.
   */
  triggerVariant?: "field" | "add";
  /** Caption for the `"add"` pill. */
  addLabel?: string;
  className?: string;
}) {
  const noun = title || label;
  const { success, error } = useToast();
  const [isPending, start] = useTransition();
  const fine = useFinePointer();
  // Ties the trigger to its list for `aria-controls`; `role="combobox"` is
  // incomplete without it.
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "add" | "edit" | "delete">("list");
  const [draftCode, setDraftCode] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  // The element the panel measures from — the field input, or the "add" pill.
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Unmounting a portal strands the cursor on <body> — Chrome moves it there
  // without firing blur, so nothing downstream can notice. See picker-keys.ts.
  usePickerFocusReturn(open);
  // Only while a form holds unsaved text. List mode is a dropdown, not a modal,
  // and must not block the PWA's silent update.
  useModalGuard(open && mode !== "list");

  // Told as you type, not on Save. `excludeId` on edit or renaming a row would
  // report it colliding with itself; `enabled` keeps the round trip off every
  // keystroke in list mode, where there is no draft to check.
  const dupError = useDuplicateCheck({
    table: manage?.dupCheck?.table ?? "",
    name: draftName,
    nameColumn: manage?.dupCheck?.nameColumn,
    excludeId: mode === "edit" ? (highlight ?? undefined) : undefined,
    scope: manage?.dupCheck?.scope,
    enabled: !!manage?.dupCheck && (mode === "add" || mode === "edit"),
  });

  const selected = useMemo(() => rows.find((r) => r.id === value) ?? null, [rows, value]);

  // Shared with the trigger's onChange below, which has to know what the list
  // WILL be: `filtered` is still the previous render's when the keystroke fires.
  const matching = useCallback(
    (q: string) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return rows;
      return rows.filter((r) => `${r.label} ${r.sublabel ?? ""}`.toLowerCase().includes(needle));
    },
    [rows],
  );

  const filtered = useMemo(() => matching(query), [matching, query]);

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  // Track the field while open — an editor Sheet scrolls its own body, so a
  // panel measured once detaches the moment anything moves. Same fix, and the
  // same reason, as combobox.tsx.
  useEffect(() => {
    if (!open || !fine) return;
    measure();
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, fine, measure]);

  // Dismiss on an outside click — list mode only. In form mode the scrim owns
  // the outside, and a stray click must not silently discard a typed draft.
  useEffect(() => {
    if (!open || mode !== "list") return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, mode]);

  function openList() {
    if (disabled) return;
    setQuery("");
    // Seed from the CURRENT value so editing a record shows the operator where
    // they are before they change it (keyboard contract, "adding a new field").
    setHighlight(value);
    setMode("list");
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setMode("list");
    setQuery("");
  }
  function commit(idOrNull: string | null) {
    onChange(idOrNull);
    close();
  }

  function startAdd() {
    if (onAddOverride) return onAddOverride((newId) => commit(newId));
    setDraftCode("");
    setDraftName("");
    setDraftType("");
    setMode("add");
  }
  function startEdit(rowId?: string | null) {
    const targetId = rowId ?? highlight;
    const row = rows.find((r) => r.id === targetId);
    if (!row || !manage?.canEdit) return;
    if (onEditOverride) return onEditOverride(row, (editedId) => commit(editedId));
    setHighlight(row.id);
    const d = manage.draftOf(row);
    setDraftCode(d.code);
    setDraftName(d.name);
    setDraftType(d.typeCode ?? "");
    setMode("edit");
  }
  function startDelete(rowId?: string | null) {
    const targetId = rowId ?? highlight;
    if (!targetId || !manage?.canDelete) return;
    setHighlight(targetId);
    setMode("delete");
  }

  function saveDraft() {
    if (!manage || dupError) return;
    start(async () => {
      const draft: PickerDraft = {
        // Create derives the code from the name (there is no Code input any
        // more); edit keeps the record's original stored code, read in
        // `startEdit` and never rendered — an existing code can be a logic key.
        code: mode === "add" ? draftName.trim() : draftCode.trim(),
        name: draftName.trim(),
        typeCode: draftType.trim(),
      };
      if (mode === "edit" && highlight) {
        const res = await manage.onUpdate(highlight, draft);
        if (!res.ok) return error(res.error);
        manage.onUpdated(highlight, draft);
        success(`${noun} updated.`);
        setMode("list");
        return;
      }
      const res = await manage.onCreate(draft);
      if (!res.ok) return error(res.error);
      manage.onCreated(res.id, draft);
      success(`${noun} added.`);
      commit(res.id);
    });
  }

  function confirmDelete() {
    if (!manage || !highlight) return;
    const id = highlight;
    start(async () => {
      const res = await manage.onDelete(id);
      if (!res.ok) return error(res.error);
      manage.onDeleted(id, res.inactive);
      // Only a REAL delete clears the field. A deactivated value still exists
      // and this record still points at it — blanking that would be silent data
      // loss dressed up as tidiness.
      if (!res.inactive && value === id) onChange(null);
      success(deletedToast(noun.replace(/s$/, ""), res));
      setHighlight(res.inactive ? id : null);
      setMode("list");
    });
  }

  /**
   * List-mode keys, owned here rather than in `pickerKeyDown`.
   *
   * That helper is for MODAL pickers: its Tab branch traps focus, which is
   * exactly wrong for a dropdown. `Combobox` sets the precedent — a non-modal
   * portal handles its own list keys — and form mode below still uses
   * `pickerKeyDown`, so the modal half is not duplicated.
   */
  function onTriggerKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        // ↑ bubbles: it means "the field above", never "open this list". A list
        // you can enter with either arrow is a one-way door.
        if (e.key === "ArrowUp") return;
        e.preventDefault();
        e.stopPropagation();
        return openList();
      }
      e.preventDefault();
      // Without this a picker in a grid cell would move the highlight AND jump
      // the grid a row.
      e.stopPropagation();
      if (!filtered.length) return;
      const idx = filtered.findIndex((r) => r.id === highlight);
      // Clamped, not wrapping: holding ↓ should stop at the end of the list
      // rather than silently cycle back to the top.
      const next =
        e.key === "ArrowDown"
          ? filtered[Math.min(idx + 1, filtered.length - 1)]
          : filtered[Math.max(idx <= 0 ? 0 : idx - 1, 0)];
      setHighlight(next.id);
      return;
    }

    if (e.key === "Enter") {
      // Closed, Enter belongs to the record: let it bubble to `enterSaves`.
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      const pick =
        highlight && filtered.some((r) => r.id === highlight) ? highlight : filtered[0]?.id;
      if (pick) commit(pick);
      return;
    }

    if (e.key === "Tab") {
      // Close without committing and DO NOT preventDefault — the move itself
      // belongs to native tab order or to Sheet's trap. "Tab never changes a
      // value, and never fails to move."
      if (open) {
        setOpen(false);
        setQuery("");
      }
      return;
    }

    if (e.key === "Escape") {
      if (!open) return;
      // preventDefault is the signal every outer layer reads to stand down.
      // stopPropagation alone would NOT do it: React delegates to `document`,
      // the same node the provider listens on.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }

    if (!open || !manage) return;

    if (e.key === "F2" && manage.canEdit) {
      e.preventDefault();
      e.stopPropagation();
      startEdit();
    } else if (e.key === "Insert" && manage.canCreate) {
      e.preventDefault();
      e.stopPropagation();
      startAdd();
    } else if (e.key === "Delete" && e.ctrlKey && manage.canDelete) {
      e.preventDefault();
      e.stopPropagation();
      startDelete();
    }
  }

  /** Escape + the Tab trap for form mode. One layer per Escape: form → list. */
  const onFormKeyDown = pickerKeyDown({
    items: [],
    keyOf: () => "",
    highlight: null,
    setHighlight: () => {},
    onPick: () => {},
    onClose: () => (mode === "list" ? close() : setMode("list")),
    // The list is not what is on screen — ↑/↓/Enter belong to the form's own
    // fields. Escape and the Tab trap stay live, because both are about the
    // panel itself.
    active: false,
  });

  const deleteTarget = rows.find((r) => r.id === highlight) ?? null;

  const list = (
    <>
      {!fine && (
        <div className="border-b border-border p-3">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${noun.toLowerCase()}…`}
          />
        </div>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label={`Select ${noun}`}
        className="max-h-72 overflow-auto py-1"
      >
        {filtered.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">
            No {noun.toLowerCase()} found.
          </li>
        )}
        {filtered.map((r) => (
          <li
            key={r.id}
            role="option"
            aria-selected={r.id === value}
            ref={r.id === highlight ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            // Focus stays in the trigger, so mousedown beats the blur.
            onMouseDown={(e) => {
              e.preventDefault();
              if (r.disabled) return;
              commit(r.id);
            }}
            onMouseEnter={() => setHighlight(r.id)}
            className={cn(
              "group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
              r.disabled && "cursor-not-allowed opacity-40",
              r.id === highlight ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-surface-muted",
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {r.label}
              {r.sublabel && <span className="ml-2 text-xs text-muted-foreground">{r.sublabel}</span>}
            </span>
            {manage?.canEdit && (
              <button
                type="button"
                aria-label={`Modify ${r.label}`}
                title="Modify (F2)"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startEdit(r.id);
                }}
                className={cn(ROW_ICON, "hover:text-foreground")}
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {manage?.canDelete && (
              <button
                type="button"
                aria-label={`Delete ${r.label}`}
                title="Delete (Ctrl+Del)"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startDelete(r.id);
                }}
                className={cn(ROW_ICON, "hover:text-danger")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {manage?.canCreate && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              startAdd();
            }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-surface-muted"
          >
            <Plus className="h-4 w-4 shrink-0" />
            Add {noun.toLowerCase()}
          </button>
          <div className="flex-1" />
          {/* The shortcuts are the keyboard path to the row icons, which Tab
              deliberately cannot reach in a non-modal panel. Undiscoverable
              unless printed. */}
          <span className="hidden text-[11px] text-muted-foreground @lg:inline">
            Ins add · F2 edit · Ctrl+Del delete
          </span>
        </div>
      )}
    </>
  );

  const form = (
    <div className="space-y-3 p-4">
      {mode === "delete" ? (
        <>
          <p className="text-sm text-foreground">
            Delete <span className="font-semibold">{deleteTarget?.label}</span>?
          </p>
          <p className="text-xs text-muted-foreground">
            If any record already uses it, it is marked inactive instead so history is
            preserved.
          </p>
        </>
      ) : (
        <>
          <div>
            <Label htmlFor="dp-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="dp-name"
              autoFocus
              uppercase
              aria-invalid={dupError ? true : undefined}
              aria-describedby={dupError ? "dp-name-dup" : undefined}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
            {dupError && (
              <p id="dp-name-dup" className="mt-1 text-xs text-danger">
                {dupError}
              </p>
            )}
          </div>
          {manage?.showTypeField && (
            <div className="w-40">
              <Label htmlFor="dp-type">Type</Label>
              <Input
                id="dp-type"
                uppercase
                value={draftType}
                onChange={(e) => setDraftType(e.target.value)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );

  const formFooter = (
    <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
      <Button type="button" variant="outline" size="md" onClick={() => setMode("list")}>
        Back
      </Button>
      {mode === "delete" ? (
        <Button type="button" size="md" disabled={isPending} onClick={confirmDelete}>
          {isPending ? "Deleting…" : "Delete"}
        </Button>
      ) : (
        <Button
          type="button"
          size="md"
          disabled={isPending || !draftName.trim() || !!dupError}
          onClick={saveDraft}
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );

  const body: ReactNode = mode === "list" ? list : <>{form}{formFooter}</>;

  const triggerText = open && fine ? query : selected?.label ?? "";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {!compact && triggerVariant === "field" && (
        <Label htmlFor={id}>
          {label} {required && <span className="text-danger">*</span>}
        </Label>
      )}
      {triggerVariant === "add" ? (
        <button
          type="button"
          ref={(el) => {
            triggerRef.current = el;
          }}
          disabled={disabled}
          // A pill, but still a field to the contract: ↓ opens it, Enter does
          // not activate it (lib/focus.ts routes both off this marker).
          data-field-trigger
          data-field-empty="true"
          onClick={() => (open ? close() : openList())}
          onKeyDown={onTriggerKeyDown}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-border px-3 text-sm font-medium text-primary hover:border-primary hover:bg-surface-muted"
        >
          {addLabel ?? `+ Add ${noun.toLowerCase()}`}
        </button>
      ) : (
      <div className="relative">
        <input
          id={id}
          ref={(el) => {
            triggerRef.current = el;
          }}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          readOnly={!fine}
          value={triggerText}
          placeholder={selected ? selected.label : (placeholder ?? `— Select ${noun} —`)}
          // A picker trigger IS a field to the operator. The marker is what
          // makes `gridKeyNav` gate Enter-adds-row on `data-field-empty` — a
          // grid whose first cell is an empty picker used to grow a blank row
          // per keypress. `readOnly` on touch would normally drop the field out
          // of the Tab order (see Field.skipTab); here it must stay in, hence no
          // tabIndex override.
          data-field-trigger
          data-field-empty={value ? "false" : "true"}
          onFocus={() => {
            /* Focus alone does NOT open. Enter must be able to save from a
               picker the operator merely tabbed through, and a list that opens
               on focus makes every Tab across a form flash a panel. ↓ / click /
               typing open it — combobox.tsx calls this `openOnFocus={false}`. */
          }}
          onClick={() => {
            if (!open) openList();
          }}
          onChange={(e) => {
            if (!fine) return; // touch types into the sheet's own search box
            const q = e.target.value;
            setQuery(q);
            // The TOP MATCH of the new query, not of the stale `filtered` — so
            // Enter straight after typing picks what the operator can see is
            // highlighted, rather than a row that no longer matches.
            setHighlight(matching(q)[0]?.id ?? null);
            if (!open) setOpen(true);
          }}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            // Height and rhythm must match Input/Combobox exactly — these sit in
            // a row with them. `@2xl/editor:h-8` is the compact density; it is a
            // CONTAINER query, so a picker inside a ~440px nested panel or on a
            // phone keeps the full 36px touch target.
            "h-9 @2xl/editor:h-8 w-full rounded-md border bg-surface px-3 pr-8 text-base md:text-sm",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            invalid ? "border-danger" : "border-border hover:border-primary",
            !selected && !open && "text-muted-foreground",
          )}
        />
        {clearable && selected && !open ? (
          <button
            type="button"
            aria-label={`Clear ${noun}`}
            tabIndex={-1}
            onClick={() => onChange(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-danger"
          >
            <X className="h-4 w-4 shrink-0" />
          </button>
        ) : (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <ChevronDown className="h-4 w-4 shrink-0" />
          </span>
        )}
      </div>
      )}

      {/* Touch: a centred sheet. A ~280px panel with 16px row icons is not
          hittable on a phone, and `Sheet size="sm"` already brings the focus
          trap, the modal guard and the Escape ladder. */}
      {!fine && (
        <Sheet
          open={open}
          onClose={close}
          size="sm"
          title={mode === "list" ? `Select ${noun}` : mode === "delete" ? `Delete ${noun}` : mode === "edit" ? `Modify ${noun}` : `Add ${noun}`}
        >
          {body}
        </Sheet>
      )}

      {/* No `mounted` gate: `open` starts false and can only be flipped by a
          user interaction, so `createPortal` is never evaluated during SSR and
          the server and first client render already agree. */}
      {fine &&
        open &&
        rect &&
        createPortal(
          <>
            {/* Form mode is modal — the scrim is what stops a stray click
                discarding a half-typed value. List mode has none: a dropdown
                that greys the page is a dialog wearing a disguise. */}
            {mode !== "list" && (
              <div className="fixed inset-0 z-[140] bg-black/20" aria-hidden />
            )}
            <div
              ref={panelRef}
              {...(mode === "list"
                ? {}
                : { role: "dialog" as const, "aria-modal": true, "aria-label": `${mode} ${noun}` })}
              onKeyDown={mode === "list" ? undefined : onFormKeyDown}
              style={{ position: "fixed", top: rect.top, left: rect.left, width: Math.max(rect.width, 260), zIndex: 150 }}
              className="overflow-hidden rounded-md border border-border bg-surface shadow-lg"
            >
              {body}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
