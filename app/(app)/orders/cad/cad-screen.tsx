"use client";

/**
 * Orders ▸ CAD Markers — doc/file.md §2, "The Digital CAD Loop and Marker
 * Handoff Workflow" (0460).
 *
 * TWO SURFACES, one route, exactly as the Fabric BOM next door: `mode === "list"`
 * is the CAD room's work queue — one row per confirmed garment ORDER, not one per
 * sheet, so an order nobody has measured is visible as "Pending" rather than
 * absent — and `mode === "edit"` is the editor, a full-screen takeover because a
 * page mount would leave the module sidebar beside the section rail and two
 * navigation lists on screen.
 *
 * ## THE SHEET IS TWO GRIDS, NOT ONE NESTED GRID
 *
 * The schema is a tree: sheet -> marker -> panel weight. Rendered literally that
 * is a grid inside a grid row, which AGENTS.md's keyboard contract has a whole
 * section about and which no screen here does for a two-level document. So the
 * MARKERS grid lists the layouts and the PANEL WEIGHTS grid is FLAT, with the
 * marker chosen per row in a `<Select>`. One axis for the arrows, one Tab path,
 * and the association stays visible in a column instead of in an indentation.
 *
 * ## THE PANEL PICKER OFFERS THE ORDER'S OWN PANELS
 *
 * Not the `components` master. A marker is measured for a garment the order has
 * already described, so the list comes from `garment_order_amendment_combos ->
 * _combo_structures -> _combo_components` — the cascading-picker rule
 * (AGENTS.md) for this screen. Offering the master would let CAD weigh a POCKET
 * on a garment with no pocket, and the weight would go on to seed a Fabric BOM
 * line that matches nothing.
 *
 * A PANEL THE SHEET ALREADY HOLDS IS ALWAYS OFFERED, even when the order no
 * longer lists it — the same reason the Disabled-rows rule keeps a held row on
 * the field: dropping it shows a filled cell as empty and the next save writes
 * that emptiness over a real weight.
 *
 * ## THE ROLLUP REFUSAL DOES NOT BLOCK SAVE
 *
 * `componentWeightsForOrder` refuses a sheet with any unweighed panel — which is
 * correct for the HANDOFF and wrong for Save, because "SLEEVE, not measured yet"
 * is the state a sheet spends most of its life in. So it is shown in the handoff
 * section as the reason step 3 cannot be seeded, and Save is gated on the things
 * that are actually broken: a weight on no marker, a weight on no panel, a
 * negative weight, and one panel weighed twice on one marker (which the database
 * refuses outright, `uq_occw_panel`).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ruler, Scale, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { RowActions } from "@/components/ui/row-actions";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { atCaretEdge, focusField } from "@/lib/focus";
import { sectionValidity } from "@/lib/screens/validity";
import { fmtDate, fmtNumber } from "@/lib/format";
import { CadMarkerFile, type MarkerFile } from "@/components/orders/cad-marker-file";
import {
  cadQueueStatus,
  cadQueueStatusText,
  cadQueueStatusTone,
  type CadMarker,
} from "@/lib/orders/cad/types";
import {
  componentWeightsForOrder,
  consumptionFromGrams,
  isRefusal,
  type CadWeightRow,
} from "@/lib/orders/cad/weights";
import type { CadFormData, CadTaskRow, OrderPanelRow } from "@/lib/orders/cad/service";
import {
  createCadMarker,
  deleteCadMarker,
  loadOrderPanels,
  previewCadSeed,
  seedFabricBomFromCad,
  updateCadMarker,
  type SeedLineOutcome,
} from "@/lib/orders/cad/actions";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/** One marker. `key` is React's, never the database id — `ChildGrid` requires
 *  it and a new row has no id to offer. */
type LayoutRow = {
  key: string;
  style_ref_no: string;
  dia: string;
  file: MarkerFile | null;
  notes: string;
};

/** One panel weight. `layout_key` points at the marker row it sits on — the
 *  client-side key, because neither row has a database id until Save. */
type WeightRow = {
  key: string;
  layout_key: string;
  coordinate_id: string | null;
  coordinate_name: string | null;
  component_id: string | null;
  component_name: string | null;
  /** A `categories` row (0405 · 0457) — the fabric this panel is cut from, and
   *  the axis that keeps a contrast yoke from being weighed once and charged to
   *  two Fabric BOM lines. NULL when the panel came from the combo tree. */
  fabric_category_id: string | null;
  fabric_category_name: string | null;
  grams: string;
  notes: string;
};

type Form = { garment_order_id: string | null; marker_date: string; remark: string };

const today = () => new Date().toISOString().slice(0, 10);
const BLANK = (): Form => ({ garment_order_id: null, marker_date: today(), remark: "" });
const newKey = () => crypto.randomUUID();

const blankLayout = (key: string): LayoutRow => ({
  key,
  style_ref_no: "",
  dia: "",
  file: null,
  notes: "",
});

const blankWeight = (key: string, layoutKey: string): WeightRow => ({
  key,
  layout_key: layoutKey,
  coordinate_id: null,
  coordinate_name: null,
  component_id: null,
  component_name: null,
  fabric_category_id: null,
  fabric_category_name: null,
  grams: "",
  notes: "",
});

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * The synthetic id the panel picker works in.
 *
 * A panel is the TUPLE (coordinate, component, fabric) — the same three
 * `uq_occw_panel` (0460) keys on beneath the marker — and a picker takes one id,
 * so the tuple is encoded. Decoded in exactly one place, `applyPanel` below, so
 * the two spellings cannot drift.
 *
 * THE FABRIC IS IN IT because a FRONT BODY in single jersey and a FRONT BODY in
 * 1x1 rib are two panels of one garment (0457 calls the contrast yoke ordinary),
 * and with one id between them the picker could not offer both.
 */
const panelId = (
  coordinate: string | null,
  component: string | null,
  fabric: string | null,
) => `${coordinate ?? ""}|${component ?? ""}|${fabric ?? ""}`;

const panelLabel = (
  coordinateName: string | null,
  componentName: string | null,
  fabricName: string | null,
) =>
  [coordinateName, componentName, fabricName].filter(Boolean).join(" · ") ||
  "(unnamed panel)";

/** The marker's own label — what the duplicate refusal and the weight grid print. */
const layoutLabel = (l: LayoutRow, i: number) =>
  [l.style_ref_no, l.dia ? `${l.dia}"` : ""].filter(Boolean).join(" ") || `Marker ${i + 1}`;

/**
 * THE CAD SHEET'S FIELD ORDER, DECLARED ONCE (client 2026-09-02).
 *
 * Garment order → Date → Remark → the footer. Customer and Delivery are IN this
 * list and drop out of it at runtime: they are `readOnly` today, and rule 4 is
 * "skip them IF they are read-only", not "jump from Date to Remark". Written as
 * a filter, the day one of them becomes editable it rejoins the flow with no
 * edit here — written as a hard-coded jump, it would be silently skipped
 * forever. `tabIndex !== -1` is the same test `FOCUSABLE_SELECTOR` uses, so a
 * field `Input` has already taken off the path (`readOnly` sets it) cannot come
 * back through this door either.
 */
const CAD_FLOW = ["cad-order", "cad-date", "cad-cust", "cad-del", "cad-remark"];

function cadFlowFields(): HTMLElement[] {
  return CAD_FLOW.map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => {
      if (el.tabIndex === -1) return false;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return !el.readOnly && !el.disabled;
      }
      return !el.hasAttribute("disabled");
    });
}

/**
 * The footer's live buttons, in the order they are drawn: Cancel, Save as Draft,
 * Submit marker sheet.
 *
 * READ OFF THE REGION MARKER, not off a list of labels — `MasterFullScreen`
 * decides which buttons exist (Save as Draft only with `onSaveDraft`, and it
 * DISABLES itself while `canSave` is false), so a hard-coded three would land
 * the cursor on a dead control on a sheet that cannot be saved yet.
 * `:not([disabled])` is what keeps rule 6 honest about which of the three are
 * actually there.
 *
 * Scoped to the surface the field is in, so a second overlay could never be
 * reached from this one.
 */
/**
 * ON SCREEN, not merely in the document.
 *
 * `ChildGrid` in `responsive`/`tableFrom` mode renders BOTH layouts — the table
 * and the stacked cards — and hides one with a container query, so every cell of
 * the Markers grid exists TWICE in the DOM. "The last Notes box" picked without
 * this test is a coin toss between the two layouts, and half the time it is the
 * one nobody can see. Same test `ownAddControl` uses for the same reason.
 */
function cadVisible(els: NodeListOf<HTMLElement> | HTMLElement[]): HTMLElement[] {
  return Array.from(els).filter((el) => el.offsetParent !== null);
}

/**
 * `isFieldLike` (lib/focus.ts) written as a selector, the same way `ROW_FIELDS`
 * states it in child-grid.tsx — so "the last input of the table" means here
 * exactly what it means to every other key in the app.
 */
const CAD_GRID_FIELDS =
  'input:not([type="button"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),' +
  " select, textarea, [data-field-trigger]";

/**
 * The grid's own fields, in DOM order, minus the ones no key may land on.
 *
 * `tabIndex !== -1` and the readOnly / disabled test are the same exclusions
 * `FOCUSABLE_SELECTOR` and `cadFlowFields` apply. On Panel Weights that is not
 * theoretical: KG / gmt is a COMPUTED column, so without this the grid's "last
 * input" could resolve to a box the cursor is not allowed to sit in and ↓ would
 * appear to do nothing.
 */
function cadGridFields(wrap: HTMLElement): HTMLElement[] {
  return cadVisible(wrap.querySelectorAll<HTMLElement>(CAD_GRID_FIELDS)).filter((el) => {
    if (el.tabIndex === -1) return false;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return !el.readOnly && !el.disabled;
    }
    return !el.hasAttribute("disabled");
  });
}

function cadFooterButtons(from: HTMLElement): HTMLElement[] {
  const surface = from.closest<HTMLElement>('[role="dialog"]') ?? document.body;
  const bar = surface.querySelector<HTMLElement>('[data-focus-region="footer"]');
  return bar ? Array.from(bar.querySelectorAll<HTMLElement>("button:not([disabled])")) : [];
}

export function CadScreen({
  tasks,
  markers,
  data,
  perms,
}: {
  tasks: CadTaskRow[];
  markers: CadMarker[];
  data: CadFormData;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState<Form>(BLANK);
  const [layouts, setLayouts] = useState<LayoutRow[]>([]);
  const [weights, setWeights] = useState<WeightRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const [panels, setPanels] = useState<OrderPanelRow[]>([]);
  const [panelsErr, setPanelsErr] = useState<string | null>(null);
  const [seedOutcomes, setSeedOutcomes] = useState<SeedLineOutcome[] | null>(null);
  /** Whether the outcomes on screen describe a WRITE or a dry run. Two lists
   *  that look identical and mean different things is how an operator comes to
   *  believe a preview saved something. */
  const [seedWrote, setSeedWrote] = useState(false);

  /**
   * `dirty || isPending`, both halves. A deploy reloads the tab silently
   * (`components/pwa/silent-updater.tsx`), and a reload landing mid-action loses
   * the success toast and leaves the operator unsure whether the save committed.
   * `MasterFullScreen` registers the modal guard itself.
   */
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);

  /**
   * Set when Enter is pressed with the Garment order list OPEN, and read by that
   * picker's `onChange` — the two halves of rule 3, "Enter selects the option and
   * immediately moves focus to Date".
   *
   * IT CANNOT BE DONE IN THE KEYDOWN, which is why this ref exists rather than a
   * jump beside the other two. `DataPicker` owns Enter while its list is open and
   * calls `preventDefault` + `stopPropagation`, so a bubble handler never sees the
   * key and a capture handler sees it BEFORE anyone knows whether it committed
   * anything — Enter on a blocked row, or on an empty list, picks nothing, and a
   * jump fired there would leave the field blank and the cursor gone. So the key
   * only ARMS the move and the commit is what performs it: no value, no jump.
   *
   * Disarmed on the next tick so an Enter that picked nothing cannot be redeemed
   * later by a mouse click on a row.
   */
  const advanceAfterPick = useRef(false);

  /**
   * THE THREE PLACES THE CAD SHEET DIVERGES FROM THE APP-WIDE CONTRACT
   * (client 2026-09-02, an explicit per-field flow for this screen).
   *
   * READ THIS BEFORE ADDING A FOURTH. `lib/focus.ts` already delivers rules 1, 2,
   * 4 and 6 here — Enter advances, ↑↓←→ move spatially, a `readOnly` field is
   * skipped because `Input` gives it `tabIndex={-1}`, and ←→ walk the footer
   * because those buttons share a `data-focus-region`. None of that is re-stated
   * below, deliberately: the provider stands down on `defaultPrevented`, so a
   * local handler does not ADD to the contract, it REPLACES it on this surface
   * and goes on replacing it through every future change to it.
   *
   * What is left is the three controls that own these keys natively, which no
   * central rule can override without changing them everywhere:
   *
   *   • Date  — `<input type="date">` is in `ownsArrowKeys`, so ↑↓ step the
   *     focused segment's value. The flow asks for movement instead, and the
   *     cost is real and bounded: the keyboard can no longer INCREMENT the date
   *     in place. It can still be typed, and ←→ still walk day / month / year,
   *     which is deliberately left to the browser — see the branch that says so.
   *   • Remark — a `<textarea>` owns ↑↓ (caret lines) and Enter (a newline).
   *     Shift+Enter is kept as the newline, so a two-row box is still a two-row
   *     box; without that, rule 5 would silently remove the only way to type one.
   *   • Garment order — handled by `advanceAfterPick` above, not here.
   *
   * CAPTURE, not bubble: both controls above consume these keys themselves, and
   * the provider's own listener is a BUBBLE listener on `document`
   * (keyboard-nav-provider.tsx), so preventing here stands every layer down in
   * one move.
   */
  function onCadFlowKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    // The picker keeps every one of its keys — ↓ opens the list and walks the
    // options, Enter picks (rule 3). All this does is note that a pick is coming.
    if (t.id === "cad-order") {
      if (e.key === "Enter" && t.getAttribute("aria-expanded") === "true") {
        advanceAfterPick.current = true;
        window.setTimeout(() => {
          advanceAfterPick.current = false;
        }, 0);
      }
      return;
    }

    if (t.id !== "cad-date" && t.id !== "cad-remark") return;
    // Shift+Enter is the Remark box's newline; see the note above.
    if (e.key === "Enter" && e.shiftKey) return;

    /**
     * ← AND → BELONG TO THE DATE BOX'S SEGMENTS (client 2026-09-02).
     *
     * A `<input type="date">` is three fields in one — day, month, year — and
     * ←→ are how the operator walks between them. Taking those keys made the
     * middle two reachable only with the mouse.
     *
     * THE CARET GATE BELOW CANNOT CATCH THIS, which is why it needs its own line
     * rather than a tweak there. `atCaretEdge` asks the element where its caret
     * is; a date input has no addressable caret, so `selectionStart` THROWS and
     * the function returns true for safety (lib/focus.ts: "number/email — caret
     * not addressable, so treat as the edge"). That is the right default for a
     * box with no internal structure and exactly wrong for one with three parts:
     * every → reported "already at the edge" and left the field on the first
     * press.
     *
     * So forward off Date is Enter and ↓ only, which is what the operator has to
     * press deliberately. ↑ still goes back to Garment order — a date input uses
     * ↑↓ to increment the focused segment, and that increment is the one thing
     * this screen's flow does take from it (see the note above the handler).
     */
    if (t.id === "cad-date" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;

    const forward = e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowRight";
    const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
    if (!forward && !back) return;
    // ←→ still move the CARET while there is text to cross, which is the same
    // gate `arrowNavigate` applies to every other field in the app. Without it,
    // → in a half-typed Remark would leave the field mid-word.
    if (
      (e.key === "ArrowRight" || e.key === "ArrowLeft") &&
      !atCaretEdge(t, e.key === "ArrowRight" ? "next" : "prev")
    ) {
      return;
    }

    const fields = cadFlowFields();
    const i = fields.indexOf(t);
    if (i === -1) return;
    // Off the last field, forward means the footer (rule 5). Off the first,
    // BACK means nothing — declined rather than swallowed, so the key still
    // reaches the provider and the section rail behind it.
    const target = back ? fields[i - 1] : (fields[i + 1] ?? cadFooterButtons(t)[0]);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    focusField(target);
  }

  /**
   * ↑ OFF A FOOTER BUTTON GOES BACK TO THE LAST FIELD (client 2026-09-02) — the
   * return leg of rule 5, so the jump the Remark box makes into the footer is not
   * a one-way door.
   *
   * A DOCUMENT LISTENER, AND THAT IS FORCED. The three buttons are
   * `MasterFullScreen`'s — this screen passes `footer={{…}}` and never renders
   * them — so there is no JSX here to hang an `onKeyDown` on, and the shell is
   * not this file's to edit. Registered only while the sheet is OPEN and torn
   * down with it, so it cannot fire on the queue list behind it, on another
   * screen, or after this one closes.
   *
   * CAPTURE, for the same reason `onCadFlowKeyDown` captures: the provider's nav
   * listener is a BUBBLE listener on `document` (keyboard-nav-provider.tsx), so
   * preventing here stands it down in one move.
   *
   * THE SECTION GUARD COMES FREE, and it is the reason this reads the flow rather
   * than reaching for `getElementById("cad-remark")`. `MasterFullScreen` mounts
   * ONE section at a time, so while Markers is on screen the CAD Sheet's fields
   * are not in the document at all: `cadFlowFields()` returns nothing, the key is
   * declined rather than swallowed, and ↑ from the footer of a different section
   * cannot drag the operator into a pane they were not looking at.
   *
   * The LAST field of the flow, not Remark by name — same filter as rule 4, so if
   * Remark ever became read-only this would land on the field above it instead of
   * on a box the cursor cannot sit in.
   */
  const markersRef = useRef<HTMLDivElement>(null);

  const weightsRef = useRef<HTMLDivElement>(null);

  /**
   * A GRID'S BOTTOM EDGE: last field → its "+ Add" button → the footer, and back
   * up again (client 2026-09-02, asked for on Markers and then on Panel Weights).
   *
   * ONE HANDLER, BOTH GRIDS, and the second request is why it is parameterised
   * rather than copied. The two tables want the identical three moves; two copies
   * of them in one file is how the copies drift, and this file has now been told
   * twice running that the bottom edge of a grid is a place the keyboard has to
   * work. A third grid needs a ref and a wrapper, not another forty lines.
   *
   * THREE MOVES, AND ONLY THREE — the rest of the grid is `gridKeyNav`'s and is
   * deliberately not restated here:
   *
   *   • ENTER ON THE LAST FIELD ALREADY LANDS ON "+ Add". `gridKeyNav` has done
   *     that since 2026-08-19 (`ownAddControl`), on both grids alike, so there is
   *     no Enter branch below. Writing one would not add the behaviour, it would
   *     REPLACE a working one and inherit the job of keeping it in step forever.
   *   • ↓ ON THE LAST FIELD IS THE GAP. `gridKeyNav` moves down a ROW and, on
   *     the last row, handles only Enter — ↓ falls through, and `arrowNavigate`
   *     then declines it too because a cell inside `[data-grid-row]` is in
   *     `ownsArrowKeys`. So it is a dead key today, and only on the last row:
   *     from any row above ↓ must still step to the next row, which is why this
   *     declines unless the target really is the grid's last field.
   *   • OFF THE BUTTON, BOTH WAYS. ↓ crosses into the footer, which
   *     `arrowNavigate` will not do by design (movement is confined to a
   *     `data-focus-region`), and ↑ goes back to THE LAST FIELD — spatially the
   *     button sits under the grid's left edge, so the contract's geometry would
   *     land on the first column, several fields from where the operator came.
   *
   * SCOPED TO ONE WRAPPER, which is what tells the two grids apart. Both carry a
   * Notes column and an "+ Add" of their own, so any query written over the
   * SECTION — or over the surface — would answer for whichever grid comes first
   * in the document rather than for the one the operator is standing in.
   */
  function cadGridEdgeKeyDown(
    wrap: HTMLDivElement | null,
    e: React.KeyboardEvent<HTMLElement>,
  ) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const t = e.target;
    if (!(t instanceof HTMLElement) || !wrap) return;

    const addBtn = cadVisible(wrap.querySelectorAll<HTMLElement>("[data-row-add]"))[0];
    const fields = cadGridFields(wrap);
    const last = fields[fields.length - 1];

    if (addBtn && t === addBtn) {
      const target = e.key === "ArrowUp" ? last : cadFooterButtons(t)[0];
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      focusField(target);
      return;
    }

    // Only the grid's LAST field, and only downward — see the note above.
    if (e.key === "ArrowDown" && t === last && addBtn) {
      e.preventDefault();
      e.stopPropagation();
      focusField(addBtn);
    }
  }

  useEffect(() => {
    if (mode !== "edit") return;
    function onFooterArrowUp(e: KeyboardEvent) {
      if (e.key !== "ArrowUp" || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLButtonElement)) return;
      if (!active.closest('[data-focus-region="footer"]')) return;
      const fields = cadFlowFields();
      const back = fields[fields.length - 1];
      if (!back) return;
      e.preventDefault();
      e.stopPropagation();
      focusField(back);
    }
    document.addEventListener("keydown", onFooterArrowUp, true);
    return () => document.removeEventListener("keydown", onFooterArrowUp, true);
  }, [mode]);

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutLayouts = (fn: (xs: LayoutRow[]) => LayoutRow[]) => {
    setLayouts(fn);
    setDirty(true);
  };
  const mutWeights = (fn: (xs: WeightRow[]) => WeightRow[]) => {
    setWeights(fn);
    setDirty(true);
  };
  const setWeightCell = (key: string, patch: Partial<WeightRow>) =>
    mutWeights((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setLayoutCell = (key: string, patch: Partial<LayoutRow>) =>
    mutLayouts((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const pickedOrder = useMemo(
    () => data.orders.find((o) => o.id === form.garment_order_id) ?? null,
    [data.orders, form.garment_order_id],
  );

  /**
   * The upload folder, fixed for the life of the editor.
   *
   * A `useState` INITIALISER, not a ref: this is read DURING render to hand the
   * file control its folder, and reading a ref in render is what `react-hooks`
   * refuses. The same call `amendment-screen.tsx` records making.
   */
  const [uploadFolder] = useState(() => crypto.randomUUID());

  // ---- the order's own panels ----------------------------------------------

  const loadPanels = useCallback((orderId: string) => {
    start(async () => {
      const res = await loadOrderPanels(orderId);
      if (res.ok) {
        setPanels(res.panels);
        setPanelsErr(null);
      } else {
        setPanels([]);
        setPanelsErr(res.error);
      }
    });
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !form.garment_order_id) return;
    loadPanels(form.garment_order_id);
  }, [mode, form.garment_order_id, loadPanels]);

  /**
   * What the Panel picker offers: the order's panels, plus any panel the sheet
   * ALREADY HOLDS that the order no longer lists.
   *
   * The second half is the Disabled-rows rule read for a derived list — a held
   * value that resolves to nothing renders as an empty cell and the next save
   * writes that emptiness over a real weight.
   */
  const panelOptions: PickerItem[] = useMemo(() => {
    const byId = new Map<string, PickerItem>();
    for (const p of panels) {
      const id = panelId(p.coordinate_id, p.component_id, p.fabric_category_id);
      byId.set(id, {
        id,
        code: null,
        name: panelLabel(p.coordinate_name, p.component_name, p.fabric_category_name),
      });
    }
    for (const w of weights) {
      if (!w.component_id) continue;
      const id = panelId(w.coordinate_id, w.component_id, w.fabric_category_id);
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        code: null,
        name: panelLabel(
          w.coordinate_name,
          w.component_name ?? data.components.find((c) => c.id === w.component_id)?.name ?? null,
          w.fabric_category_name,
        ),
      });
    }
    return [...byId.values()];
  }, [panels, weights, data.components]);

  /** Decode the picker's synthetic id back into the pair, with the names the
   *  refusals print. ONE decoder, beside the encoder. */
  function applyPanel(rowKey: string, id: string | null) {
    if (!id) {
      setWeightCell(rowKey, {
        coordinate_id: null,
        coordinate_name: null,
        component_id: null,
        component_name: null,
        fabric_category_id: null,
        fabric_category_name: null,
      });
      return;
    }
    const [coordinate, component, fabric] = id.split("|");
    const fromOrder = panels.find(
      (p) => panelId(p.coordinate_id, p.component_id, p.fabric_category_id) === id,
    );
    setWeightCell(rowKey, {
      coordinate_id: coordinate || null,
      coordinate_name: fromOrder?.coordinate_name ?? null,
      component_id: component || null,
      component_name:
        fromOrder?.component_name ??
        data.components.find((c) => c.id === component)?.name ??
        null,
      fabric_category_id: fabric || null,
      fabric_category_name: fromOrder?.fabric_category_name ?? null,
    });
  }

  // ---- seeding the panels from the order -----------------------------------

  /**
   * Fill the weights grid from the order's own panel list.
   *
   * EVERY PANEL NEEDS A MARKER TO SIT ON, and which marker is not something this
   * can guess when several match. So: a layout whose style matches takes the
   * panel; failing that, a single layout takes everything (the ordinary
   * one-marker sheet); and anything left over is REPORTED rather than dropped on
   * the first row, which would silently attribute a bottom-weight panel to a
   * top-weight marker.
   */
  function seedPanels() {
    if (layouts.length === 0) {
      toastError("Add a marker first — a panel weight is measured on one.");
      return;
    }
    const key = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();
    const held = new Set(
      weights.map(
        (w) =>
          `${w.layout_key}|${panelId(w.coordinate_id, w.component_id, w.fabric_category_id)}`,
      ),
    );

    const added: WeightRow[] = [];
    let orphans = 0;
    for (const p of panels) {
      const match =
        layouts.find((l) => key(l.style_ref_no) === key(p.style_ref_no)) ??
        (layouts.length === 1 ? layouts[0] : null);
      if (!match) {
        orphans++;
        continue;
      }
      const dedupe = `${match.key}|${panelId(p.coordinate_id, p.component_id, p.fabric_category_id)}`;
      if (held.has(dedupe)) continue;
      held.add(dedupe);
      added.push({
        key: newKey(),
        layout_key: match.key,
        coordinate_id: p.coordinate_id,
        coordinate_name: p.coordinate_name,
        component_id: p.component_id,
        component_name: p.component_name,
        fabric_category_id: p.fabric_category_id,
        fabric_category_name: p.fabric_category_name,
        grams: "",
        notes: "",
      });
    }

    if (added.length) mutWeights((xs) => [...xs, ...added]);
    if (orphans > 0) {
      toastError(
        `${orphans} panel${orphans === 1 ? "" : "s"} had no marker for their style — add a marker for each style first.`,
      );
    } else if (added.length === 0) {
      toastError("Every panel on this order is already on the sheet.");
    } else {
      success(`${added.length} panel${added.length === 1 ? "" : "s"} added — enter the gram weights.`);
    }
  }

  // ---- the rollup, live ----------------------------------------------------

  /** The sheet as the engine reads it. ONE shape, computed here and on the
   *  server from `getCadWeightRows`, so the preview and the seed cannot differ. */
  const engineRows: CadWeightRow[] = useMemo(
    () =>
      weights
        .filter((w) => w.component_id)
        .map((w) => {
          const i = layouts.findIndex((l) => l.key === w.layout_key);
          const l = i >= 0 ? layouts[i] : null;
          return {
            style_ref_no: l?.style_ref_no || null,
            coordinate_id: w.coordinate_id,
            coordinate_name: w.coordinate_name,
            component_id: w.component_id,
            component_name: w.component_name,
            fabric_category_id: w.fabric_category_id,
            fabric_category_name: w.fabric_category_name,
            grams: numOrNull(w.grams),
            dia: l ? numOrNull(l.dia) : null,
            layout_label: l ? layoutLabel(l, i) : "(no marker)",
          };
        }),
    [weights, layouts],
  );

  const rollup = useMemo(() => componentWeightsForOrder(engineRows), [engineRows]);

  // ---- grids ---------------------------------------------------------------

  /** The styles this order declares, for the marker's Style select. */
  const styleOptions = useMemo(() => {
    const out = new Set<string>();
    for (const p of panels) if (p.style_ref_no) out.add(p.style_ref_no);
    for (const l of layouts) if (l.style_ref_no) out.add(l.style_ref_no);
    return [...out];
  }, [panels, layouts]);

  const layoutColumns: ChildGridColumn<LayoutRow>[] = [
    {
      header: "Style",
      width: "12rem",
      cell: (r) => (
        <Select
          aria-label="Style"
          className="h-8"
          value={r.style_ref_no}
          onChange={(e) => setLayoutCell(r.key, { style_ref_no: e.target.value })}
        >
          <option value="" />
          {styleOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Dia",
      align: "right",
      width: "7rem",
      cell: (r) => (
        <Input
          aria-label="Dia"
          className="h-8 text-right"
          inputMode="decimal"
          value={r.dia}
          onChange={(e) => setLayoutCell(r.key, { dia: e.target.value })}
        />
      ),
    },
    {
      header: "Marker PDF",
      width: "18rem",
      cell: (r) => (
        <CadMarkerFile
          value={r.file}
          folder={uploadFolder}
          onChange={(f) => setLayoutCell(r.key, { file: f })}
        />
      ),
    },
    {
      header: "Notes",
      cell: (r) => (
        <Input
          aria-label="Notes"
          className="h-8"
          value={r.notes}
          onChange={(e) => setLayoutCell(r.key, { notes: e.target.value })}
        />
      ),
    },
  ];

  const weightColumns: ChildGridColumn<WeightRow>[] = [
    {
      header: "Marker",
      width: "12rem",
      cell: (r) => (
        <Select
          aria-label="Marker"
          className="h-8"
          value={r.layout_key}
          onChange={(e) => setWeightCell(r.key, { layout_key: e.target.value })}
        >
          <option value="" />
          {layouts.map((l, i) => (
            <option key={l.key} value={l.key}>
              {layoutLabel(l, i)}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Panel",
      cell: (r) => (
        <RecordPicker
          label="Panel"
          compact
          items={panelOptions}
          value={
            r.component_id
              ? panelId(r.coordinate_id, r.component_id, r.fabric_category_id)
              : null
          }
          onChange={(id) => applyPanel(r.key, id)}
        />
      ),
    },
    {
      header: "Grams",
      align: "right",
      width: "8rem",
      cell: (r) => (
        <Input
          aria-label="Grams"
          className="h-8 text-right"
          inputMode="decimal"
          value={r.grams}
          onChange={(e) => setWeightCell(r.key, { grams: e.target.value })}
        />
      ),
    },
    {
      header: "KG / gmt",
      align: "right",
      width: "8rem",
      cell: (r) => {
        const kg = consumptionFromGrams(numOrNull(r.grams), "KGS");
        // A REFUSAL IS PRINTED, NEVER A ZERO — and here the ordinary refusal is
        // "not measured yet", so it renders as nothing rather than as red text:
        // an unfilled field shows NOTHING (the de-clutter rule), and a panel
        // nobody has weighed is not an error.
        return isRefusal(kg) ? (
          <span className="text-xs text-muted-foreground" />
        ) : (
          <span className="tabular-nums text-sm">{kg}</span>
        );
      },
    },
    {
      header: "Notes",
      width: "12rem",
      cell: (r) => (
        <Input
          aria-label="Notes"
          className="h-8"
          value={r.notes}
          onChange={(e) => setWeightCell(r.key, { notes: e.target.value })}
        />
      ),
    },
  ];

  // ---- validity ------------------------------------------------------------

  const filledLayouts = layouts.filter((l) => l.style_ref_no || l.dia || l.file);
  const typedWeights = weights.filter((w) => w.component_id || w.grams.trim());

  /** One panel weighed twice on ONE marker — what `uq_occw_panel` refuses at the
   *  database, surfaced here so Save explains itself instead of failing. */
  const duplicateOnMarker = useMemo(() => {
    const seen = new Set<string>();
    for (const w of typedWeights) {
      if (!w.component_id) continue;
      const k = `${w.layout_key}|${panelId(w.coordinate_id, w.component_id, w.fabric_category_id)}`;
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  }, [typedWeights]);

  const validity = sectionValidity({
    sections: [{ key: "sheet" }, { key: "markers" }, { key: "panels" }, { key: "handoff" }],
    values: form,
    fields: [
      {
        section: "sheet",
        id: "cad-order",
        label: "Garment order",
        required: true,
        empty: (f) => !f.garment_order_id,
      },
      {
        section: "sheet",
        id: "cad-date",
        label: "Date",
        required: true,
        empty: (f) => !f.marker_date,
      },
    ],
    // Per-ROW problems are `extra` rather than `fields`: `fields` addresses one
    // control by id and there is no single id for "the panel cell of whichever
    // weight row is blank".
    extra: [
      ...(filledLayouts.length === 0
        ? [
            {
              section: "markers",
              label: "Markers",
              message: "Add at least one marker.",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(typedWeights.some((w) => !w.component_id)
        ? [
            {
              section: "panels",
              label: "Panel",
              // The SCHEMA'S sentence, word for word (`cadWeightInput`).
              message: "Choose the panel this weight is for",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(typedWeights.some((w) => !w.layout_key)
        ? [
            {
              section: "panels",
              label: "Marker",
              message: "Every panel weight sits on a marker — choose one.",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(typedWeights.some((w) => {
        const g = numOrNull(w.grams);
        return g != null && g <= 0;
      })
        ? [
            {
              section: "panels",
              label: "Grams",
              message: "A panel weight must be more than 0 g",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(duplicateOnMarker
        ? [
            {
              section: "panels",
              label: "Panel",
              message: "The same panel is weighed twice on one marker — remove the duplicate row",
              kind: "custom" as const,
            },
          ]
        : []),
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- opening / saving ----------------------------------------------------

  function openNew(orderId: string | null) {
    setEditId(null);
    setForm({ ...BLANK(), garment_order_id: orderId });
    setLayouts([blankLayout(newKey())]);
    setWeights([]);
    setPanels([]);
    setPanelsErr(null);
    setSeedOutcomes(null);
    setSeedWrote(false);
    setDirty(false);
    setMode("edit");
  }

  function openMarker(m: CadMarker) {
    setEditId(m.id);
    setForm({
      garment_order_id: m.garment_order_id,
      marker_date: m.marker_date,
      remark: m.remark ?? "",
    });
    const rows: LayoutRow[] = (m.layouts ?? []).map((l) => ({
      key: newKey(),
      style_ref_no: l.style_ref_no ?? "",
      dia: l.dia == null ? "" : String(l.dia),
      file: l.storage_path
        ? {
            file_name: l.file_name ?? "Marker",
            storage_path: l.storage_path,
            mime_type: l.mime_type ?? "application/pdf",
            size_bytes: l.size_bytes ?? 0,
          }
        : null,
      notes: l.notes ?? "",
    }));
    setLayouts(rows.length ? rows : [blankLayout(newKey())]);
    setWeights(
      (m.layouts ?? []).flatMap((l, i) =>
        (l.weights ?? []).map((w) => ({
          key: newKey(),
          layout_key: rows[i]?.key ?? "",
          coordinate_id: w.coordinate_id,
          // The names are resolved from the order's panel list once it loads;
          // until then the picker shows the id-keyed option it already holds.
          coordinate_name: null,
          component_id: w.component_id,
          component_name:
            data.components.find((c) => c.id === w.component_id)?.name ?? null,
          fabric_category_id: w.fabric_category_id,
          // Resolved from the order's panel list once it loads — the components
          // master has no fabric on it to read one from.
          fabric_category_name: null,
          grams: w.grams == null ? "" : String(w.grams),
          notes: w.notes ?? "",
        })),
      ),
    );
    setPanels([]);
    setPanelsErr(null);
    setSeedOutcomes(null);
    setSeedWrote(false);
    setDirty(false);
    setMode("edit");
  }

  function openTask(t: CadTaskRow) {
    const existing = markers.find((m) => m.garment_order_id === t.id);
    if (existing) openMarker(existing);
    else openNew(t.id);
  }

  function submit(asDraft: boolean) {
    if (!form.garment_order_id) return;
    const payload = {
      garment_order_id: form.garment_order_id,
      marker_date: form.marker_date,
      is_submitted: !asDraft,
      remark: form.remark || null,
      layouts: layouts.map((l, i) => ({
        sno: i + 1,
        style_ref_no: l.style_ref_no || null,
        dia: numOrNull(l.dia),
        file_name: l.file?.file_name ?? null,
        storage_path: l.file?.storage_path ?? null,
        mime_type: l.file?.mime_type ?? null,
        size_bytes: l.file?.size_bytes ?? null,
        notes: l.notes || null,
        weights: weights
          .filter((w) => w.layout_key === l.key)
          .map((w, wi) => ({
            sno: wi + 1,
            coordinate_id: w.coordinate_id,
            component_id: w.component_id,
            fabric_category_id: w.fabric_category_id,
            grams: numOrNull(w.grams),
            notes: w.notes || null,
          })),
      })),
    };

    start(async () => {
      const res = editId
        ? await updateCadMarker(editId, payload)
        : await createCadMarker(payload);
      if (res.ok) {
        success(editId ? "CAD marker sheet updated" : "CAD marker sheet created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function remove(markerId: string) {
    start(async () => {
      const res = await deleteCadMarker(markerId);
      if (res.ok) {
        success("CAD marker sheet deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  /** §2's "Automated Workspace Sync". Only ever run against the SAVED sheet —
   *  a seed off unsaved form state would write figures nothing on the server has
   *  seen, and the operator could still press Cancel afterwards. */
  function pushToFabricBom(dryRun: boolean) {
    if (!form.garment_order_id) return;
    start(async () => {
      const res = dryRun
        ? await previewCadSeed(form.garment_order_id as string)
        : await seedFabricBomFromCad(form.garment_order_id as string);
      if (res.ok) {
        setSeedOutcomes(res.outcomes);
        setSeedWrote(res.wrote);
        if (dryRun) {
          success(
            `${res.seeded} fabric BOM line${res.seeded === 1 ? "" : "s"} would take a marker weight. Nothing written.`,
          );
          return;
        }
        success(
          `${res.seeded} fabric BOM line${res.seeded === 1 ? "" : "s"} took the marker weights — ` +
            "open the Fabric BOM and save it to recompute.",
        );
        router.refresh();
      } else {
        setSeedOutcomes(null);
        toastError(res.error);
      }
    });
  }

  // ---- sections ------------------------------------------------------------

  const sections: FullScreenSection[] = [
    {
      key: "sheet",
      label: "CAD Sheet",
      icon: Ruler,
      done: !!form.garment_order_id,
      content: (
        <SectionBody title="CAD Sheet">
          {/* `display: contents`, so this wrapper carries the listener and NO
              layout — `FieldGrid` stays the direct grid child of `SectionBody`
              and the spacing above the panels error is unchanged. Events still
              travel through it: the event tree does not care about `display`. */}
          <div className="contents" onKeyDownCapture={onCadFlowKeyDown}>
          <FieldGrid>
            <Field label="Garment order" required size="sm" htmlFor="cad-order">
              <RecordPicker
                id="cad-order"
                label="Garment order"
                compact
                required
                items={data.orders}
                value={form.garment_order_id}
                // LOCKED ONCE SAVED. Every panel on the sheet is a panel of THIS
                // order; re-pointing it would leave weights describing a garment
                // the sheet no longer names, with nothing on screen saying so.
                disabled={!!editId}
                onChange={(id) => {
                  set({ garment_order_id: id });
                  /* RULE 3's SECOND HALF. Armed by Enter on the open list
                     (`advanceAfterPick`), performed here, so a pick that never
                     happened cannot move the cursor. A MOUSE pick leaves the
                     flag false and the cursor where the operator put it.

                     Deferred because `DataPicker` closes its list and hands
                     focus back to this trigger as it commits; moving in the same
                     tick would be undone by that hand-off. 30ms is the delay the
                     app already uses for a post-re-render focus move (see
                     `enterNestedGrid` in child-grid.tsx). */
                  if (!advanceAfterPick.current) return;
                  advanceAfterPick.current = false;
                  window.setTimeout(() => {
                    const date = document.getElementById("cad-date");
                    if (date) focusField(date);
                  }, 30);
                }}
              />
            </Field>
            <Field label="Date" required size="sm" htmlFor="cad-date">
              <Input
                id="cad-date"
                type="date"
                value={form.marker_date}
                onChange={(e) => set({ marker_date: e.target.value })}
              />
            </Field>
            <Field label="Customer" size="sm" htmlFor="cad-cust">
              {/* READ-ONLY, from the order. A readOnly field never holds the
                  cursor (AGENTS.md, Mandatory fields) and leaves the Tab path. */}
              <Input id="cad-cust" readOnly value={pickedOrder?.customer_name ?? ""} />
            </Field>
            <Field label="Delivery" size="sm" htmlFor="cad-del">
              <Input
                id="cad-del"
                readOnly
                value={pickedOrder?.delivery_date ? fmtDate(pickedOrder.delivery_date) : ""}
              />
            </Field>
            <Field label="Remark" size="full" htmlFor="cad-remark">
              <Textarea
                id="cad-remark"
                rows={2}
                value={form.remark}
                onChange={(e) => set({ remark: e.target.value })}
              />
            </Field>
          </FieldGrid>
          </div>

          {panelsErr && (
            <div className="mt-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-danger">
              {panelsErr}
            </div>
          )}
        </SectionBody>
      ),
    },
    {
      key: "markers",
      label: "Markers",
      icon: Ruler,
      done: filledLayouts.length > 0,
      wide: true,
      content: (
        <SectionBody title="Markers">
          {/* `display: contents` — the wrapper carries the listener and the ref
              and contributes no layout, so the grid still sits directly in the
              section body. */}
          <div
            className="contents"
            ref={markersRef}
            onKeyDownCapture={(e) => cadGridEdgeKeyDown(markersRef.current, e)}
          >
          <ChildGrid<LayoutRow>
            columns={layoutColumns}
            rows={layouts}
            seedRow
            tableFrom="5xl"
            centerHeaders
            /* `renderMobileRow` supplies the label below the breakpoint: the
               default stacked cell is a bare div around a RequiredScope with NO
               visible label, so the fallback would be four unlabelled boxes. */
            renderMobileRow={(row) => (
              <FieldGrid>
                {layoutColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, ci)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            onAdd={() => mutLayouts((xs) => [...xs, blankLayout(newKey())])}
            onRemove={(r) => {
              mutLayouts((xs) => xs.filter((x) => x.key !== r.key));
              // A WEIGHT CANNOT OUTLIVE ITS MARKER. Left behind it would carry a
              // `layout_key` matching nothing, drop out of the payload on the
              // next save, and take the operator's gram figures with it silently.
              mutWeights((xs) => xs.filter((x) => x.layout_key !== r.key));
            }}
            addLabel="+ Add marker"
          />
          </div>
        </SectionBody>
      ),
    },
    {
      key: "panels",
      label: "Panel Weights",
      icon: Scale,
      done: weights.some((w) => numOrNull(w.grams) != null),
      wide: true,
      content: (
        <SectionBody title="Panel Weights">
          <div className="mb-3 flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={seedPanels}
              disabled={!form.garment_order_id || panels.length === 0 || isPending}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Seed panels from order
            </Button>
          </div>
          {/* Same wrapper, same handler, its own ref — see `cadGridEdgeKeyDown`. */}
          <div
            className="contents"
            ref={weightsRef}
            onKeyDownCapture={(e) => cadGridEdgeKeyDown(weightsRef.current, e)}
          >
          <ChildGrid<WeightRow>
            columns={weightColumns}
            rows={weights}
            seedRow
            tableFrom="5xl"
            centerHeaders
            renderMobileRow={(row) => (
              <FieldGrid>
                {weightColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, ci)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            onAdd={() =>
              mutWeights((xs) => [...xs, blankWeight(newKey(), layouts[0]?.key ?? "")])
            }
            onRemove={(r) => mutWeights((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add panel"
          />
          </div>
        </SectionBody>
      ),
    },
    {
      key: "handoff",
      label: "Fabric BOM Handoff",
      icon: Send,
      done: seedOutcomes != null,
      content: (
        <SectionBody title="Fabric BOM Handoff">
          {isRefusal(rollup) ? (
            /* THE HANDOFF'S OWN REFUSAL, shown where the handoff is — not on
               Save. "SLEEVE has no marker weight yet" is a normal state of a
               sheet being filled in and must not block saving it. */
            <p className="text-sm text-danger">{rollup.refused}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {rollup.length} panel{rollup.length === 1 ? "" : "s"} ready ·{" "}
                <span className="tabular-nums text-foreground">
                  {fmtNumber(rollup.reduce((a, r) => a + r.grams, 0))} g
                </span>{" "}
                per garment in total.
              </p>
              <ul className="space-y-1">
                {rollup.map((r) => (
                  <li
                    key={`${r.style_key}-${r.component_id}-${r.fabric_category_id ?? ""}`}
                    className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
                  >
                    <Truncated className="min-w-0 flex-1">
                      {[r.style_ref_no, r.component_name, r.fabric_category_name]
                        .filter(Boolean)
                        .join(" · ")}
                    </Truncated>
                    {r.coordinates > 1 && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {r.coordinates} coordinates
                      </span>
                    )}
                    <span className="shrink-0 tabular-nums">{fmtNumber(r.grams)} g</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => pushToFabricBom(true)}
              disabled={!editId || dirty || isPending}
            >
              Preview
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => pushToFabricBom(false)}
              // THE SAVED SHEET IS WHAT IS PUSHED. A new, unsaved one has
              // nothing on the server to read, and `seedFabricBomFromCad`
              // refuses a draft by name rather than being hidden here.
              disabled={!editId || dirty || isPending}
            >
              <Send className="h-4 w-4" aria-hidden />
              Push weights to Fabric BOM
            </Button>
            {dirty && (
              <span className="text-xs text-muted-foreground">Save the sheet first.</span>
            )}
          </div>

          {seedOutcomes && (
            <ul className="mt-3 space-y-1">
              <li className="text-xs text-muted-foreground">
                {seedWrote ? "Written to the fabric BOM:" : "Nothing written — this is what would happen:"}
              </li>
              {seedOutcomes.map((o) => (
                <li key={o.sno} className="text-xs">
                  <span className="font-medium">Line {o.sno}</span>{" "}
                  {o.refused ? (
                    <span className="text-danger">{o.refused}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {o.component_name} · {o.consumption} {o.uom_code}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionBody>
      ),
    },
  ];

  // ---- the queue -----------------------------------------------------------

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) =>
      [t.re_no, t.order_code, t.po_no, t.customer_name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [tasks, search]);

  const columns: Column<CadTaskRow>[] = [
    {
      header: "RE No",
      cell: (t) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline"
          onClick={() => openTask(t)}
        >
          {t.re_no ?? t.order_code ?? "—"}
        </button>
      ),
    },
    { header: "Buyer PO", cell: (t) => <Truncated>{t.po_no ?? "—"}</Truncated> },
    { header: "Customer", cell: (t) => <Truncated>{t.customer_name ?? "—"}</Truncated> },
    {
      header: "Delivery",
      cell: (t) => (
        <span className="tabular-nums text-sm">
          {t.delivery_date ? fmtDate(t.delivery_date) : "—"}
        </span>
      ),
    },
    {
      header: "Markers",
      align: "right",
      cell: (t) => <span className="tabular-nums text-sm">{t.layout_count}</span>,
    },
    {
      header: "Weighed",
      align: "right",
      cell: (t) => (
        <span className="tabular-nums text-sm">
          {t.weighed_count} / {t.weighed_count + t.unweighed_count}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (t) => {
        const s = cadQueueStatus(t.status, t.unweighed_count);
        return <StatusPill tone={cadQueueStatusTone(s)}>{cadQueueStatusText(s)}</StatusPill>;
      },
    },
    rowActionsColumn<CadTaskRow>((t) => (
      <RowActions
        label={t.re_no ?? t.order_code}
        onEdit={() => openTask(t)}
        canEdit={perms.canEdit}
        // A queue row with no sheet has no document to delete — that is the
        // "Pending" case, and it is the whole reason the queue lists ORDERS.
        canDelete={perms.canDelete && !!t.marker_id}
        onDelete={t.marker_id ? () => remove(t.marker_id as string) : undefined}
        deleteLabel="Delete CAD sheet"
        isPending={isPending}
      />
    )),
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="CAD Markers"
          description="Marker layouts by fabric dia, the gram weight of every panel, and the handoff to the Fabric BOM."
        />

        {/* EVERY CONTROL IN THIS BAND IS `md` (h-9) — the row's fixed element is
            the search <Input>, and an <Input> is h-9 (AGENTS.md, The header row). */}
        <div className="flex flex-wrap items-center gap-2">
          {/* caps-input: exempt -- a search QUERY is not a stored value. */}
          <Input
            uppercase={false}
            className="w-64"
            placeholder="Search RE No, PO or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-1 items-center justify-end gap-2">
            {perms.canCreate && (
              <Button size="md" onClick={() => openNew(null)}>
                + New CAD Sheet
              </Button>
            )}
          </div>
        </div>

        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(t) => t.id}
          empty="No confirmed garment orders yet. A marker is planned against an order."
        />
      </div>

      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">CAD marker sheet</span>
          </>
        }
        header={{
          initials: "CD",
          title: pickedOrder?.re_no ?? pickedOrder?.code ?? "New CAD sheet",
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              {pickedOrder?.customer_name && <span>{pickedOrder.customer_name}</span>}
              {form.marker_date && <span>· {fmtDate(form.marker_date)}</span>}
              <span>
                · {filledLayouts.length} marker{filledLayouts.length === 1 ? "" : "s"}
              </span>
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New CAD sheet",
          onCancel: () => setMode("list"),
          onSave: () => submit(false),
          // SAVE SUBMITS, and the wording says so: §2's handoff is the submit,
          // and a button reading "Save" that silently published the weights to
          // purchasing would be the surprise.
          saveLabel: "Submit marker sheet",
          canSave: validity.canSave,
          onBlockedSave: revealFirstProblem,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />
    </>
  );
}
