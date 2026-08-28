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
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, RequiredScope, useRequiredHold } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dropdownPanelStyle } from "@/components/ui/dropdown-panel";
import { Sheet } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { Truncated, useOverflow } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { useModalGuard } from "@/lib/reload-guard";
import { deletedToast } from "@/lib/masters/delete-message";
// Upward import (ui → masters) on purpose, and safe: `picker-keys` and
// `delete-message` are leaf helpers that import `lib/*` only, so there is no
// cycle. The alternative was a second copy of the Escape/Tab block, which is
// the exact mistake picker-keys.ts was created to undo.
import { pickerKeyDown, usePickerFocusReturn } from "@/components/masters/picker-keys";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { cn } from "@/lib/utils";
import {
  AFFORDANCE_PAD,
  AFFORDANCE_PAD_COMPACT,
  FieldAffordance,
} from "@/components/ui/field-affordance";

/** One selectable record. `sublabel` renders muted beside the label. */
export type PickerRow = {
  id: string;
  label: string;
  sublabel?: string | null;
  /**
   * What the TRIGGER shows once this row is chosen, where that is shorter than
   * the label — the list, the search and the hover bubble all keep the label.
   *
   * The one kind that has one today is Ship Type, whose label is an Incoterm
   * glossed for the list ("DELIVERED DUTY PAID (DDP)") and whose `short` is the
   * term the trade actually speaks ("DDP"). See `lookupShortLabel` in
   * lib/masters/extras-types.ts for when a row gets one and when it must not.
   *
   * NOT a general licence to abbreviate. A value the operator cannot read back
   * is worse than one that clips, so this is only ever for a code that IS the
   * name of the thing — never a truncation, and never a generated key.
   */
  short?: string | null;
  /**
   * Switched off at its master — read it with `isInactive()` (lib/masters/inactive.ts),
   * never by hand, because the schema spells the flag three ways.
   *
   * The panel HIDES it rather than greying it, so it cannot be reached by typing
   * its name either. The one exception is the value this record ALREADY holds:
   * that row stays, tagged `(inactive)` and unpickable, so reopening an old
   * document still reads correctly. See `selectable` below.
   */
  inactive?: boolean;
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
 * ## Disabled rows (AGENTS.md, STANDING)
 *
 * A row whose master says it is switched off is **not offered** — hidden from
 * the list and from search, not merely greyed. The single exception is the value
 * the record already holds, which stays visible, tagged `(inactive)` and
 * unpickable, so an old document still reads correctly. Adapters pass
 * `inactive` (from `isInactive()`); this component does the rest, and
 * `scripts/audit_layout.py --check picker-inactive` catches the adapter that
 * forgets.
 *
 * ## Keyboard (.claude/skills/raagam-keyboard-contract)
 *
 *   ↓        open; then move the highlight (clamped, never wraps)
 *   ↑        move up when open; when CLOSED it bubbles, so the provider moves to
 *            the field above — ↑ must never be a second way to open a list
 *   Enter    pick the highlight, close, and STAY on the field; when closed it
 *            bubbles, so the NEXT Enter moves to the next field. Staying put is
 *            deliberate — picking a value and moving on are two decisions, and
 *            one keypress doing both means a mis-pick is already three fields
 *            ago by the time it is noticed.
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
  usedIds,
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
  /**
   * PICK ONCE. Ids already taken by the SIBLING ROWS of the same child grid —
   * pass the whole grid's set, this row's own value included.
   *
   * A repeating grid over master data (Customer ▸ Supplied Items, Vendor ▸ Item
   * Category) asks one question per row, so the same value twice is duplication,
   * not data. Those rows stay in the list, greyed and tagged "(already added)",
   * because they are perfectly good master data that simply belongs to the row
   * above — see `blockedReason` for why they are shown rather than hidden.
   *
   * Only for grids where a repeat is genuinely wrong. Customer ▸ Contacts
   * (Department), Vendor ▸ Addresses (City) and Bank ▸ Branches (Country) are
   * master data too, and five contacts in Marketing is normal — those must never
   * pass this.
   */
  usedIds?: Iterable<string> | null;
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
  // Empty is "no id chosen". The trigger's TEXT is a search box while the list
  // is open, so it is never the test.
  const hold = useRequiredHold(!disabled && !value, { required, label });
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "add" | "edit" | "delete">("list");
  const [draftCode, setDraftCode] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState("");
  const [rect, setRect] = useState<
    { top: number; left: number; width: number; vw: number } | null
  >(null);

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
  const dupError = useDuplicateName({
    table: manage?.dupCheck?.table ?? "",
    name: draftName,
    nameColumn: manage?.dupCheck?.nameColumn,
    excludeId: mode === "edit" ? (highlight ?? undefined) : undefined,
    scope: manage?.dupCheck?.scope,
    enabled: !!manage?.dupCheck && (mode === "add" || mode === "edit"),
    /**
     * The synchronous half, for all 19 adapters at once. The rows in the list
     * ARE the table being checked — this panel is the master, in miniature — so
     * a collision with something already on screen is answered in the same
     * render as the keystroke, instead of 300ms after Tab has moved on.
     *
     * `label` is the right column to compare even where `nameColumn` names a
     * different one (`payment_terms.description`): the adapter maps that column
     * INTO the label, so the label is what the operator is retyping.
     *
     * The full list, not `selectable`: a switched-off row keeps its name
     * reserved, and re-adding it under a new id is exactly the mistake this
     * check exists to stop.
     */
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.label,
  });

  // Resolved against the FULL list, not `selectable` — the trigger must still
  // show the stored name when that value has since been switched off.
  const selected = useMemo(() => rows.find((r) => r.id === value) ?? null, [rows, value]);

  /**
   * What this field is allowed to offer (AGENTS.md, "Disabled rows").
   *
   * Enforced here rather than in the ~18 adapters because this is the only place
   * that knows the right `value`. A grid repeats one picker down many rows —
   * Customer ▸ Supplied Items has a Vendor cell per line — and a parent-level
   * `.filter()` has to pick a single `value` to make the exception for, so it
   * either hides a row's own stored vendor or leaks a retired one into every
   * other row. Each instance here sees its own.
   */
  const selectable = useMemo(
    () => rows.filter((r) => !r.inactive || r.id === value),
    [rows, value],
  );

  const used = useMemo(() => new Set(usedIds ?? []), [usedIds]);

  /**
   * WHY A ROW CANNOT BE CHOSEN — or null when it can. One predicate, so the
   * list rendering, the mouse and the keyboard cannot drift apart about it.
   *
   * A row's OWN value is never blocked. `usedIds` is the whole grid's set, so
   * without this exemption every row would refuse the value it is already
   * showing. Making each caller subtract itself was the alternative, and that is
   * the version that gets forgotten at the tenth call site.
   *
   * The two reasons look identical on screen and behave differently in the list,
   * which is deliberate:
   *
   *   `inactive` — the master row is switched off. HIDDEN (AGENTS.md "Disabled
   *     rows": gone from the list and from search). The only one that ever
   *     reaches here is the stored value itself, kept by `selectable` above so a
   *     filled field does not render empty.
   *   `used` — taken by a sibling row of the same grid. STAYS VISIBLE. It is
   *     valid, active master data; removing it silently would read as "that
   *     category is missing", and the operator would go looking for it in the
   *     Category master. Greyed with the reason in words is the honest version.
   */
  const blockedReason = useCallback(
    (r: PickerRow): "inactive" | "used" | null => {
      if (r.id === value) return null;
      if (r.inactive) return "inactive";
      return used.has(r.id) ? "used" : null;
    },
    [value, used],
  );

  // Shared with the trigger's onChange below, which has to know what the list
  // WILL be: `filtered` is still the previous render's when the keystroke fires.
  const matching = useCallback(
    (q: string) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return selectable;
      return selectable.filter((r) =>
        `${r.label} ${r.sublabel ?? ""}`.toLowerCase().includes(needle),
      );
    },
    [selectable],
  );

  const filtered = useMemo(() => matching(query), [matching, query]);

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // `vw` travels with the rest: the panel's ceiling is "how much room is there
    // to the right of this field", which is a fact about the same measurement
    // and would otherwise be read during render.
    setRect({ top: r.bottom + 4, left: r.left, width: r.width, vw: window.innerWidth });
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

  /**
   * DISMISS WHEN THE CURSOR LEAVES THE FIELD — list mode only.
   *
   * `onTriggerKeyDown` already closes on Tab, and that covered the one exit
   * anybody tested. It is not the only exit: **← and →** move between fields
   * through `arrowNavigate`, which this handler never sees, and every
   * PROGRAMMATIC move touches no keydown of ours at all — `cycleTab`'s
   * `focusField`, a rail section switch, `goToSection`'s reveal, the duplicate
   * catch-up yanking the cursor back. After any of those the panel hung over the
   * form while the operator typed somewhere else, and opening the next field's
   * list showed TWO lists at once (operator, 2026-08-10).
   *
   * So the rule is stated once, in terms of what actually decides it: a dropdown
   * belongs to the field that has the cursor. The keydown branch stays — it
   * closes on the same keystroke rather than one focus event later — but it is
   * no longer the only thing standing between the app and a stuck panel.
   *
   * `focusin` on the document, deliberately, rather than `onBlur` on the trigger:
   * blur's `relatedTarget` is null for a good half of these moves, and Chrome
   * does not fire blur at all when a portal unmounts under the cursor (the whole
   * reason `usePickerFocusReturn` exists). `focusin` names the element that
   * actually received focus, which is the only reliable way to ask whether it is
   * still ours.
   *
   * THE PANEL COUNTS AS OURS. On a coarse pointer the search box takes focus on
   * open (`autoFocus` in `list` below), so a handler that closed on any focus
   * outside the trigger would make the picker unopenable on a tablet.
   *
   * List mode only, matching the outside-click dismiss above: in form mode a
   * stray focus change must not silently discard a typed draft, and the scrim
   * owns the outside anyway.
   */
  useEffect(() => {
    if (!open || mode !== "list") return;
    function onFocusIn(e: FocusEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
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

  /**
   * A HAND-OFF CLOSES THIS PANEL FIRST, and that cannot be solved with z-index.
   *
   * `onAddOverride` / `onEditOverride` open a Sheet, and this panel outranks
   * every Sheet on purpose (zIndex 150 below, against a Sheet's 90/91) — because
   * a sheet holds pickers of ITS own, and `CategoryQuickCreateSheet` really does:
   * its Fabric Structure field is a `LookupDialogPicker`. Raise the sheet over
   * the list and that inner list disappears behind it instead. So the sheet can
   * never out-stack the list; the list has to go. Left open, it painted straight
   * over the "New Category" box it had just opened, hiding the title and both
   * labels (client 2026-08-06).
   *
   * Closing also unsubscribes the outside-mousedown dismiss above, so the first
   * click inside the sheet no longer half-closes a picker behind it — and it is
   * what puts the cursor back on the field when the sheet is cancelled: `Sheet`
   * restores focus to its opener, which is this trigger, still focused because
   * the "+ Add" row commits on `onMouseDown` + `preventDefault`.
   */
  function startAdd() {
    if (onAddOverride) {
      close();
      return onAddOverride((newId) => commit(newId));
    }
    setDraftCode("");
    /*
     * THE TYPED TEXT BECOMES THE NAME (client 2026-08-24: "allow manual free
     * entry in item color field").
     *
     * This used to clear the draft, so an operator who typed NAVY, found nothing,
     * and clicked "+ Add item color" met an EMPTY box and had to type NAVY a
     * second time. The list is a search field, so what they typed is already the
     * name they mean — carrying it across is what makes the field behave like
     * free entry without becoming free text.
     *
     * AND IT CANNOT BECOME FREE TEXT. `item_color_id` and its siblings are uuid
     * FKs into `config_lookups`; a typed string has nowhere to be stored. Two
     * vocabularies for one colour is also the failure AGENTS.md records under
     * Nominated vendors — matching a thread to a garment colour is only
     * expressible as equality while both come from ONE list. So the typed value
     * is turned INTO a row rather than stored beside one.
     *
     * Trimmed, because a trailing space is not part of a name and would make
     * "NAVY " and "NAVY" two rows that read identically in every list.
     */
    setDraftName(query.trim());
    setDraftType("");
    setMode("add");
  }
  function startEdit(rowId?: string | null) {
    const targetId = rowId ?? highlight;
    const row = rows.find((r) => r.id === targetId);
    if (!row || !manage?.canEdit) return;
    // Closes the list first, for the reason spelled out over `startAdd`.
    if (onEditOverride) {
      close();
      return onEditOverride(row, (editedId) => commit(editedId));
    }
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
      // A ROW YOU CANNOT PICK IS A ROW YOU CANNOT LAND ON — the same thing a
      // native <select> does with a disabled <option>. Enter declines on a
      // blocked row (below), so being able to highlight one would just make ↓
      // walk onto a dead key. Rare while the only blocked row was the stored
      // inactive value; routine now that "(already added)" rows stay in the list.
      const walkable = filtered.filter((r) => !blockedReason(r));
      if (!walkable.length) return;
      const idx = walkable.findIndex((r) => r.id === highlight);
      // Clamped, not wrapping: holding ↓ should stop at the end of the list
      // rather than silently cycle back to the top.
      const next =
        e.key === "ArrowDown"
          ? walkable[Math.min(idx + 1, walkable.length - 1)]
          : walkable[Math.max(idx <= 0 ? 0 : idx - 1, 0)];
      setHighlight(next.id);
      return;
    }

    if (e.key === "Enter") {
      // Closed, Enter belongs to the form: let it bubble to `enterAdvances`,
      // which moves to the next field (and saves off the last one).
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      // The mouse refuses a blocked row; so must Enter. And it must refuse it
      // by doing NOTHING — falling through to the first pickable row would
      // commit something other than what the operator can see highlighted, which
      // is worse than not moving. Arrow movement no longer lands on a blocked
      // row at all, so this is now the backstop for a mouse-set highlight.
      const hl = filtered.find((r) => r.id === highlight);
      if (hl && blockedReason(hl)) return;
      const pick = hl ? hl.id : filtered.find((r) => !blockedReason(r))?.id;
      if (pick) commit(pick);
      return;
    }

    if (e.key === "Tab") {
      // Close without committing and DO NOT preventDefault — the move itself
      // belongs to native tab order or to Sheet's trap. "Tab never changes a
      // value" still holds without exception. "Tab never fails to move" now has
      // exactly one: a field showing a live duplicate-name error holds the
      // cursor (components/shell/keyboard-nav-provider.tsx). That guard stops
      // the key at window-capture, so this branch never runs for a held field.
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

    // An override-only picker has no `manage`, and Insert must still reach it —
    // otherwise the mouse can open a quick-create the keyboard cannot, on a
    // screen whose whole contract is that it does not need one.
    if (!open || !(manage || onAddOverride)) return;

    if (e.key === "F2" && manage?.canEdit) {
      e.preventDefault();
      e.stopPropagation();
      startEdit();
    } else if (e.key === "Insert" && (manage?.canCreate || onAddOverride)) {
      e.preventDefault();
      e.stopPropagation();
      startAdd();
    } else if (e.key === "Delete" && e.ctrlKey && manage?.canDelete) {
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
          {/* caps-input: exempt -- a QUERY is not a stored value, and this one
              box sits behind ~160 pickers. It filters master rows, so leave the
              operator's typing alone. */}
          <Input
            uppercase={false}
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
        {filtered.map((r) => {
          const blocked = blockedReason(r);
          return (
          <li
            key={r.id}
            role="option"
            aria-selected={r.id === value}
            // Says out loud what the greying means, for anyone who cannot see it.
            aria-disabled={blocked ? true : undefined}
            ref={r.id === highlight ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            // Focus stays in the trigger, so mousedown beats the blur.
            onMouseDown={(e) => {
              e.preventDefault();
              if (blocked) return;
              commit(r.id);
            }}
            // Hover does not move the highlight onto a row that cannot be
            // picked, for the same reason ↓ skips it: the highlight is a promise
            // about what Enter will commit, and parking it on a refused row
            // turns Enter into a dead key by mouse instead of by arrow.
            onMouseEnter={() => { if (!blocked) setHighlight(r.id); }}
            className={cn(
              /* THE PANEL FOLLOWS THE FIELD'S DENSITY (client 2026-08-28,
                 screenshot 2533: "inside of the field the font size is good but
                 in the drop it looks a little bit bigger").

                 THE TYPE SIZE WAS ALREADY IDENTICAL — the trigger is
                 `text-base md:text-sm` and a row is `text-sm`, both 14px on any
                 desktop. What differed is the ROW: 8px of padding top and
                 bottom against a `compact` trigger that is 32px tall in total,
                 so the list read as looser and therefore larger. Matching the
                 leading is the honest fix; shrinking the text would have made
                 the dropdown disagree with the field it fills.

                 ONLY WHEN `compact`, which is the picker-in-a-grid-cell case.
                 A full-width picker on a form keeps the roomier row — it sits
                 beside 36px controls, and tightening it there would answer a
                 complaint nobody made by making a comfortable list cramped. */
              "group flex cursor-pointer items-center gap-2 px-3 text-sm",
              compact ? "py-1.5" : "py-2",
              blocked && "cursor-not-allowed opacity-40",
              r.id === highlight ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-surface-muted",
            )}
          >
            {/* On touch the list is a Sheet, which has the vertical room to
                just show the whole label — better than any reveal gesture, and
                it sidesteps the fact that these rows commit on `mousedown`, so
                a press-and-hold would pick the row it was only meant to read. */}
            {fine ? (
              <Truncated text={r.label} touch={false} className="min-w-0 flex-1">
                {r.label}
                {r.sublabel && <span className="ml-2 text-xs text-muted-foreground">{r.sublabel}</span>}
                {/* Always in WORDS. 40% opacity on its own reads as a rendering
                    glitch, not as a reason — and the two reasons are not
                    interchangeable to the operator: "(inactive)" means someone
                    retired this value, "(already added)" means it is fine and
                    the row above has it. Without the second one, a greyed row
                    sends them to the Category master looking for a fault that
                    isn't there. `inactive` here is only ever the stored value. */}
                {blocked && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {blocked === "used" ? "(already added)" : "(inactive)"}
                  </span>
                )}
              </Truncated>
            ) : (
              <span className="min-w-0 flex-1 break-words">
                {r.label}
                {r.sublabel && <span className="ml-2 text-xs text-muted-foreground">{r.sublabel}</span>}
                {blocked && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {blocked === "used" ? "(already added)" : "(inactive)"}
                  </span>
                )}
              </span>
            )}
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
          );
        })}
      </ul>
      {/* AN OVERRIDE STANDS ON ITS OWN, without a `manage` beside it.
          `manage` is the INLINE name-only form plus its Modify and Delete, and
          a field whose record needs more than a name is exactly the field that
          must not offer it — so requiring the one to enable the other made the
          richer flow reachable only by declaring the poorer one first. Every
          existing call site is unchanged: `manage?.canCreate` still opens the
          inline form, and a picker with neither shows no Add at all. */}
      {(manage?.canCreate || onAddOverride) && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              startAdd();
            }}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-surface-muted"
          >
            <Plus className="h-4 w-4 shrink-0" />
            {/* NAMES WHAT IT WILL CREATE. With a search typed, this row is the
                operator's "free entry": `startAdd` seeds the Add form's Name
                with it, so the label has to say so or the button still reads as
                "open an empty dialog". Falls back to the plain noun when nothing
                is typed, which is the ordinary browse-then-add case.

                `min-w-0` + truncate because the label is no longer a fixed
                phrase: it now carries whatever was typed, and a long one would
                otherwise push the keyboard-shortcut hint out of the row.
                truncate-reveal: exempt -- the untruncated text is the search box
                immediately above this row, still on screen and still focused. */}
            <span className="truncate">
              {query.trim() ? `Add "${query.trim()}"` : `Add ${noun.toLowerCase()}`}
            </span>
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
          {/**
            * `<Field required>`, NOT a hand-written `*`.
            *
            * This box used to be a bare `<Label>Name <span
            * className="text-danger">*</span></Label>` over a plain `<Input>`.
            * The star was decoration: `useRequiredHold` emits
            * `data-required-empty` from `ctx.required || own.required`, and
            * neither was set — so a blank Name let Tab, Enter and ↓ straight
            * past, on every picker in the app (client 2026-08-10, reported on
            * Material ▸ New Yarn ▸ Category ▸ "+ Add").
            *
            * `Field` draws the star AND provides the scope, so the two cannot
            * disagree. Its span classes are container-query based and simply do
            * not match outside a `@container/section`, which is the documented
            * fallback — in this narrow panel the field takes the full width.
            *
            * This is the PRIMITIVE behind every picker's inline "+ Add", so the
            * hold arrives at ~160 call sites from this one declaration.
            */}
          <Field label="Name" required htmlFor="dp-name">
            <Input
              id="dp-name"
              autoFocus
              uppercase
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              {...dupFieldProps(dupError, "dp-name")}
            />
            <DuplicateError error={dupError} id="dp-name" />
          </Field>
          {manage?.showTypeField && (
            <Field label="Type" htmlFor="dp-type" className="w-40">
              <Input
                id="dp-type"
                uppercase
                value={draftType}
                onChange={(e) => setDraftType(e.target.value)}
              />
            </Field>
          )}
        </>
      )}
    </div>
  );

  const formFooter = (
    <div
      className="flex items-center justify-end gap-2 border-t border-border px-3 py-2"
      // THIS MARKER IS LOAD-BEARING. Without it Enter in the Add/Modify form
      // saved the OUTER record — the vendor, not the city. `submitSurface`
      // resolves the scope's own footer FIRST and only then falls back to the
      // registered "save", and this panel is `role="dialog"`, so it IS the scope;
      // an unmarked footer meant step 1 found nothing and step 2 reached the
      // editor behind the scrim (client 2026-07-31). Note the primary must stay
      // LAST by position — Back, then Save/Delete.
      data-focus-region="footer"
    >
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

  // The chosen value's SHORT form where it has one (`FOB`, not
  // `FREE ON BOARD (FOB)`) — see `PickerRow.short`. The label is still what the
  // list shows, what the search matches and what the bubble below reveals, so
  // nothing is lost by the box being narrower than the term is long.
  const triggerText = open && fine ? query : selected?.short ?? selected?.label ?? "";

  // Measured on the input itself, not on a copy of the text: the field's width
  // is a container query away from changing (`@2xl/editor`), so "is this value
  // too long" is a question only the rendered box can answer.
  const { ref: valueRef, overflowing: valueClipped } = useOverflow<HTMLElement>(triggerText);

  // True when the box is showing less than the row says — the other half of
  // "there is more to read here", beside `valueClipped`.
  const shortened = !!selected?.short && selected.short !== selected.label;

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
      // A selected value longer than the field used to vanish with no ellipsis
      // and no way back — an `<input>` has no `text-overflow` of its own, so it
      // clipped mid-word and looked like the whole value. `text-ellipsis` below
      // makes the loss visible; this makes it recoverable. Suppressed while the
      // list is open, where the bubble would sit on top of the options.
      <Tooltip
        label={selected?.label ?? ""}
        touch
        // A shortened value is not a clipped one — it fits, so `useOverflow`
        // reports nothing — but the expansion it dropped is exactly what the
        // bubble exists to give back. Without this second reason the gloss on a
        // Ship Type would be reachable only by reopening the list.
        disabled={!selected || open || (!valueClipped && !shortened)}
        className="relative block w-full"
      >
        <input
          id={id}
          ref={(el) => {
            triggerRef.current = el;
            valueRef.current = el;
          }}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || undefined}
          // Mandatory and blank holds the cursor (client 2026-08-04). Declared
          // by this component's own `required` — the same prop that draws the
          // `*` beside the label — or by an enclosing `<Field required>`.
          //
          // A picker is the case that makes the hold survivable at all: the
          // provider refuses every movement key EXCEPT ↓ on a `role="combobox"`,
          // so the list still opens and the field can still be filled without a
          // mouse. On touch this input is `readOnly`, which the hold skips.
          {...hold}
          // `off` keeps Chrome's remembered-values list from stacking on top of
          // ours (and from eating ↓, which is how this list opens). The `data-*`
          // trio says the same to the password managers, which ignore
          // `autocomplete` — their injected icon lands on top of the chevron.
          // See components/ui/input.tsx for the full reasoning.
          autoComplete="off"
          data-1p-ignore=""
          data-lpignore="true"
          data-form-type="other"
          disabled={disabled}
          readOnly={!fine}
          value={triggerText}
          /**
           * AN UNFILLED PICKER SHOWS NOTHING (client 2026-08-17).
           *
           * It used to read "— Select {noun} —", which is the LABEL REPEATED
           * WITH A VERB: a picker is `compact` inside a `<Field label>` — which
           * is every picker on a form — so the word already stands directly
           * above the box, and inside a `ChildGrid` cell the column header says
           * it a third time. "Select Merchandiser" then had to fit a 202px
           * trigger, so it ellipsed itself: the screen showed
           * "— Select Merchand... —" under a label reading "Merchand."
           * (screenshot 2320).
           *
           * IT WENT TO "—" FIRST, AND THAT WAS WRONG THE SAME WAY. The em-dash
           * was defended here as the app's existing "nothing chosen" — and it
           * is, in a TABLE CELL, where a column of blanks would be ambiguous
           * with a column that failed to load (`created-columns.tsx` still
           * prints one, correctly). A FORM FIELD is not a table cell: it has a
           * box, a border and a chevron already saying "a value goes here", so
           * the dash adds a mark that means what the box already means. Sixty
           * fields each drawing a dash is a screen of dashes, which is what the
           * client saw and rejected within the hour.
           *
           * The general rule underneath both reversals: **an empty control says
           * nothing.** Emptiness is legible on its own; every attempt to
           * announce it costs width and adds a mark to scan past.
           *
           * The noun is not lost — it still names the panel, the search box
           * ("Search customers…"), the add button and every toast, all places
           * where nothing else on screen says it. And an explicit `placeholder`
           * still wins, which is where a MEANINGFUL empty state lives: Order
           * Entry's Rejection Rule reads "No projection", because blank there
           * is a state of the order rather than an unanswered field.
           */
          placeholder={selected ? selected.short ?? selected.label : (placeholder ?? "")}
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
            // highlighted, rather than a row that no longer matches. Skips a
            // BLOCKED top match — an inactive stored value, or one already taken
            // by another row of the grid: landing there would make Enter
            // decline, which reads as a dead keystroke. Typing "cotton" when
            // COTTON TAPE is already added highlights the next real match.
            setHighlight(matching(q).find((r) => !blockedReason(r))?.id ?? null);
            if (!open) setOpen(true);
          }}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            // Height and rhythm must match Input/Combobox exactly — these sit in
            // a row with them. `@2xl/editor:h-8` is the compact density; it is a
            // CONTAINER query, so a picker inside a ~440px nested panel or on a
            // phone keeps the full 36px touch target.
            "h-9 @2xl/editor:h-8 w-full rounded-md border bg-surface px-3 text-base md:text-sm",
            // Reserves the trailing slot; stated beside its width, not here.
            // A dense grid cell reserves less: see AFFORDANCE_PAD_COMPACT.
            compact ? AFFORDANCE_PAD_COMPACT : AFFORDANCE_PAD,
            // An unfocused input honours `text-overflow`, so a clipped value
            // now ends in an ellipsis instead of stopping mid-word as if that
            // were all of it.
            // truncate-reveal: exempt -- this is the ellipsis half of the rule;
            // the reveal half is the <Tooltip> wrapping this input.
            "text-ellipsis",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            invalid ? "border-danger" : "border-border hover:border-primary",
            !selected && !open && "text-muted-foreground",
          )}
        />
        {/* ▼, or ✕ once there is something to clear — one slot on the field's
            right edge, drawn by `field-affordance.tsx` for this and Combobox
            both. It used to be two hand-drawn branches here and two more there,
            which is how the pair drifted apart. */}
        <FieldAffordance
          compact={compact}
          onClear={clearable && selected && !open ? () => onChange(null) : undefined}
          clearLabel={`Clear ${noun}`}
          disabled={disabled}
        />
      </Tooltip>
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
          // Clean required scope, exactly as `Sheet` does and for the same
          // reason: this panel is a surface of its own, but React context
          // reaches it from wherever the picker was rendered. In a mandatory
          // ChildGrid cell the inline Add form's Name box inherited that cell's
          // `RequiredScope` and held the cursor quoting the CELL's label.
          <RequiredScope required={false} label={null}>
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
              style={dropdownPanelStyle(rect, mode === "list" ? "list" : "form")}
              /* `font-sans` EXPLICITLY, because this panel is `createPortal`ed to
             `document.body` and therefore sits outside the app's own subtree.
             It inherits body's family today, so this changes nothing now — it is
             a guard: any future wrapper that sets the typeface on a shell div
             rather than on `body` would silently drop the ~160 pickers back to
             the browser default, and a dropdown in a different face is exactly
             the kind of fault that gets reported as "the font is wrong" long
             after the change that caused it (client 2026-08-28). */
          className="font-sans overflow-hidden rounded-md border border-border bg-surface shadow-lg"
            >
              {body}
            </div>
          </RequiredScope>,
          document.body,
        )}
    </div>
  );
}
