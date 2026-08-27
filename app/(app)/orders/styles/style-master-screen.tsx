"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shirt, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/ui/multi-select";
import { isInactive } from "@/lib/masters/inactive";
import { sizeFamily, sortBySize } from "@/lib/masters/size-order";
import { createLookupValue } from "@/lib/masters/lookup-quick";
import { capsName } from "@/lib/validation/formats";
import { Field, FieldGrid } from "@/components/ui/field";
import { DetailSection } from "@/components/masters/detail-section";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { useBlockAction } from "@/components/masters/use-block-action";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate } from "@/lib/format";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import { ComponentPicker } from "@/components/masters/component-picker";
import {
  createGarmentStyle,
  updateGarmentStyle,
  deleteGarmentStyle,
  previewStyleCode,
} from "@/lib/orders/styles/actions";
import {
  SEASON_OPTIONS,
  styleStatusTone,
  styleStatusText,
  type GarmentStyle,
} from "@/lib/orders/styles/types";
import {
  UNIT_KIND_OPTIONS,
  coordinateLimit,
  isUnitKind,
  componentRowStarted,
  componentTypeForCategory,
  styleCoordinateIds,
  styleProblems,
} from "@/lib/orders/styles/rules";
import { componentsForCoordinate } from "@/lib/masters/component-coordinates";
import { CategoryPicker, ItemPicker } from "@/components/masters/lookup-picker";
import { sectionValidity, type Problem } from "@/lib/screens/validity";
import type { StyleFormData } from "@/lib/orders/styles/service";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  rows: GarmentStyle[];
  data: StyleFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

// ---- editable child-row shapes ----
type CoordRow = { key: string; coordinate_id: string | null };
type CompRow = {
  key: string;
  coordinate_id: string | null;
  component_id: string | null;
  fabric_category_id: string | null;
  comp_type: string;
  /** The fabric: an `items` row of class FABRIC. */
  item_id: string | null;
};
type SizeRow = { key: string; size_id: string | null };

/**
 * The form's own shape.
 *
 * Seven fields left it on 2026-08-10 at the client's request — `style_for`,
 * `tech_pack`, `received_date`, `receipt_mode`, `department_id`, `contact_id`,
 * `customer_reference`. Their DB columns and stored values remain; they are
 * simply no longer asked for, and no longer written (they left the Zod input
 * too, which is the half that stops an update nulling them).
 */
type HeaderForm = {
  blocked: boolean;
  style_date: string;
  customer_id: string | null;
  approved_sample_id: string | null;
  style_name: string;
  season: string;
  style_year: string;
  article_no: string;
  style_category_id: string | null;
  style_description: string;
  /** "" until answered — Piece or Set. Drives the Coordinates count. */
  unit_kind: string;
  /** The group last used to fill the sizes. Provenance, not authority. */
  size_group_id: string | null;
  description: string;
};

const BLANK: HeaderForm = {
  blocked: false,
  style_date: "",
  customer_id: null,
  approved_sample_id: null,
  style_name: "",
  season: "",
  style_year: "",
  article_no: "",
  style_category_id: null,
  style_description: "",
  /**
   * A NEW STYLE OPENS ON PIECE (client 2026-08-11) — PCS is what nearly every
   * style is, so the field should never sit blank waiting to be told so.
   *
   * DEFAULTED HERE, NOT IN THE ZOD SCHEMA, and the two are not
   * interchangeable. `garmentStyleInput.unit_kind` is
   * `.nullable().default(null)` because NULL is the truthful reading of every
   * style created before 0392 — none of them was ever asked Piece-or-Set, and
   * `coordinateLimit` returns no rule for them on purpose so old two-coordinate
   * records stay valid (see `rules.ts`). Moving the default into Zod would make
   * "piece" the answer for those legacy rows the moment anything re-parsed
   * them, inventing a fact about records nobody asked, and it would fire on
   * `lib/data-io` imports too. `BLANK` is only ever the starting point of a
   * record being typed now, which is exactly the scope of the client's request.
   *
   * `openEdit` still reads `r.unit_kind ?? ""`, so opening a legacy style shows
   * the blank it genuinely has and the `required` backfill still happens.
   */
  unit_kind: "piece",
  size_group_id: null,
  description: "",
};

const today = () => new Date().toISOString().slice(0, 10);

export function StyleMasterScreen({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  /** Block / Unblock in the ⋮ — the control that used to be a checkbox on the
   *  form. One implementation for every master listing (`useBlockAction`). */
  const { blockItem } = useBlockAction("style");

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);

  /**
   * The record's serial (STL/2627/0001), for the read-only field on General.
   *
   * READ OFF THE ROW, NOT HELD IN `HeaderForm`. The DB trigger owns `code` and
   * `garmentStyleInput` has no key for it, so a value that never enters `form`
   * can never be sent by accident — now or after a future refactor of the
   * payload, which is assembled field by field. Reading `rows` also means a
   * newly created style's number appears on its own: `router.refresh()` already
   * brings the saved row back.
   *
   * Null on a new record, because the trigger assigns on INSERT — there is no
   * serial yet, and `previewCode` below answers for that case instead.
   */
  const editingCode = rows.find((r) => r.id === editId)?.code ?? null;
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [coords, setCoords] = useState<CoordRow[]>([]);
  const [comps, setComps] = useState<CompRow[]>([]);
  const [sizes, setSizes] = useState<SizeRow[]>([]);

  /**
   * What the serial WILL be, shown while a new style is being entered.
   *
   * KEYED ON `style_date`, not on nothing: the fiscal year comes from that field
   * (`assign_garment_style_code`), so back-dating a style into last March moves
   * it into the previous year's numbering. A preview that ignored the date would
   * be wrong for exactly the entries most likely to be checked.
   *
   * Only for a NEW record — an existing style has a real code and must never be
   * shown a predicted one.
   *
   * A PREDICTION, NOT A RESERVATION. `peek_garment_style_code` (0393) does not
   * consume the counter, so opening this form and abandoning it burns no
   * numbers; the cost is that two operators entering at once see the same next
   * number and only the first to save gets it. The trigger stays the sole
   * authority, so what is STORED is always right. Reserving instead would issue
   * numbers to records that may never exist, and those gaps are what an audit
   * asks about.
   *
   * `cancelled` guards the response, not the request: an operator retyping the
   * date fires several of these and they can land out of order, which would
   * leave the field showing the answer to a date that is no longer in the box.
   *
   * The effect only FETCHES; clearing is done by `openAdd`/`openEdit`, which is
   * where this screen resets all its other state too. Clearing here instead
   * would be a synchronous setState in an effect body — the cascading-render
   * shape `react-hooks/set-state-in-effect` exists to catch, and an event
   * handler is the honest place for "the operator opened a different record".
   */
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "edit" || editId) return;
    let cancelled = false;
    previewStyleCode(form.style_date).then((c) => {
      if (!cancelled) setPreviewCode(c);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, editId, form.style_date]);
  /**
   * Has the operator actually changed anything since this record was opened.
   *
   * A real flag, not a proxy like "does the form hold values" — on an EXISTING
   * style every field is populated the moment it opens, so a content-derived
   * guess would announce "Unsaved changes" before a key was pressed. Set by
   * `set()` and by every child-grid mutation; cleared by `openAdd`/`openEdit`.
   * Same shape as `customer-master-screen.tsx`, which is the reference for this
   * footer.
   */
  const [dirty, setDirty] = useState(false);
  /** Lets a blocked Save switch section and land on the offending field —
   *  `MasterFullScreen` keeps `section` in its own state, so this handle is
   *  the only way in from here. */
  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // The reload guard is no longer registered here. `MasterFullScreen mount="page"`
  // calls `useUnsavedGuard(dirty || isPending)` itself, gated on the `dirty` flag
  // above. The old call was `useUnsavedGuard(mode === "edit" || isPending)`, which
  // is ALWAYS true while the editor is open and so pinned the silent PWA
  // auto-update off for the whole session on this route, not just while there was
  // work to lose.

  // config_lookups split by kind (one query, filtered per picker)
  const { lookups } = data;
  /**
   * STYLE CATEGORY COMES FROM THE GARMENT MASTER, NOT A LIST OF ITS OWN.
   *
   * This was `lookups.filter(kind === "style_category")` — a config_lookups kind
   * that has never held a single row, so the field was a dropdown over an empty
   * list and read as a bare text box (client 2026-08-10). 0394 repoints
   * `garment_styles.style_category_id` at `public.categories`, the same master
   * the Material child classifies against.
   *
   * The kind itself stays declared in the CHECK constraint: it holds nothing,
   * and removing it would mean re-listing every other kind for no gain. It is
   * simply unreferenced now, like `trims_category` after 0392.
   */
  const itemClassOpts = useMemo(() => lookups.filter((l) => l.kind === "item_class"), [lookups]);
  const fabricStructureOpts = useMemo(
    () => lookups.filter((l) => l.kind === "fabric_structure"),
    [lookups],
  );
  /** The GARMENTS class — a style is a garment, so its category comes from
   *  there. Resolved by CODE, not by a hardcoded id: the seven classes are
   *  seeded rows whose ids differ per environment. */
  const garmentClassId = useMemo(
    () => itemClassOpts.find((c) => (c.code ?? "").toUpperCase() === "GAR")?.id ?? null,
    [itemClassOpts],
  );

  /**
   * The Style Category list: GARMENTS categories, plus whatever this style
   * already holds.
   *
   * THE HELD VALUE ALWAYS SURVIVES THE FILTER — the standing "Disabled rows"
   * rule, and it earns its place here for a second reason. The quick-create
   * sheet lets the operator pick a different Item Class, so a category can be
   * created outside GARMENTS; without this it would be selectable at the moment
   * of creation and then vanish on the next refresh, blanking the FK on the
   * following save. Keeping it visible is what makes that merely unusual rather
   * than data loss.
   */
  const scopedCategories = useMemo(
    () =>
      data.categories.filter(
        (c) => c.item_class_id === garmentClassId || c.id === form.style_category_id,
      ),
    [data.categories, garmentClassId, form.style_category_id],
  );
  /**
   * COORDINATES, COMPONENTS AND STRUCTURE COME FROM THEIR REAL MASTERS (0396).
   *
   * All three used to read a `config_lookups` kind that shadowed a master
   * sitting right beside it, and every one of those kinds was empty or junk —
   * `coordinate` held two rows named "1" and "2", `style_component` and
   * `structure` held none at all. So the fields rendered dropdowns over
   * nothing, exactly as Style Category did before 0394. One pattern, four
   * fields.
   *
   * A COORDINATE IS A GARMENT: a Set style is two to six garments sold
   * together, so TOP / BOTTOM / INNER / OUTER / PIECES are `items` of class
   * GARMENTS. The data was always right; the FK pointed at the wrong list.
   */
  const coordinateOpts = data.garments;
  const componentOpts = data.componentRows;

  /**
   * The approved samples this style's customer may choose from (0422).
   *
   * The three rules are on the field itself; this is where they are enforced:
   * an unattributed sample stays offered, the held one always survives, and no
   * customer means no narrowing rather than an empty list.
   */
  const samplesForCustomer = useMemo(() => {
    const want = form.customer_id;
    if (!want) return data.samples;
    return data.samples.filter(
      (x) =>
        x.customer_id === want ||
        x.customer_id === null ||
        x.id === form.approved_sample_id,
    );
  }, [data.samples, form.customer_id, form.approved_sample_id]);
  /** Structure needed no FK change — 'fabric_structure' rows ARE config_lookups.
   *  Only the kind moved, which is why there is no third repoint in 0396. */
  /**
   * "STRUCTURE" ON THE COMPONENTS GRID IS A FABRIC CATEGORY (client 2026-08-11).
   *
   * It read the `fabric_structure` lookup, which holds three MACHINE classes —
   * Circular Knit / Flat Knit / Woven. What a component is actually made in is
   * the knit: SINGLE JERSEY, FLEECE, 1X1 LYCRA RIB, COLLAR, CUFF. Those are the
   * FABRIC categories of the Category master, and 0405 repointed the column at
   * them.
   *
   * Scoped PER ROW so the value a saved row already holds always survives — a
   * category since moved to another class, or switched off. Dropping it would
   * render a filled cell as empty and blank the FK on the next save (AGENTS.md,
   * "Disabled rows"). Same shape as `scopedCategories` above, which is the
   * cascading-picker rule applied at the caller that knows the class.
   */
  const fabricClassId = useMemo(
    () => itemClassOpts.find((c) => (c.code ?? "").toUpperCase() === "FABRIC")?.id ?? null,
    [itemClassOpts],
  );
  const fabricCategoryOpts = (currentValue: string | null) =>
    data.categories.filter(
      (c) => c.item_class_id === fabricClassId || c.id === currentValue,
    );
  /** The three machine classes. No longer a PICKER — it is what the Type cell
   *  DISPLAYS, resolved from the category the operator picked. */
  const structureOpts = fabricStructureOpts;
  /**
   * SIZES IN THE ORDER A GARMENT PERSON READS THEM (client screenshot 2392,
   * 2026-08-19: the list arrived as `L, M, S, TEST, XL, XS, XXL, XXS`).
   *
   * The master is a flat `config_lookups` kind with a name and no ordinal, so
   * `listConfigLookups` can only order it alphabetically — which is a correct
   * sort by the wrong key, and therefore the kind of wrong that reads as right.
   * `naturalSizeOrder` (`lib/masters/size-order.ts`) is the one place that
   * decides this, proved by `npm run check:size-order`.
   *
   * This is the FALLBACK order. Once a size carries a Size Group the group's
   * stored `sort_order` wins and this stops being consulted for grouped sizes —
   * see the header of `size-order.ts` for why an ordinal cannot live on the size
   * itself.
   */
  const sizeOpts = useMemo(
    () => sortBySize(lookups.filter((l) => l.kind === "size"), (l) => l.name),
    [lookups],
  );

  // ---- the Components tab reads the Coordinates tab --------------------------

  /**
   * THE COORDINATES THIS STYLE HAS — the only ones a component may be filed
   * under.
   *
   * Components used to be offered `coordinateOpts`, the entire `config_lookups`
   * kind: the same list the Coordinates tab picks FROM, with nothing scoping it
   * to what this style declared. So a Piece style capped at one coordinate still
   * offered every coordinate in the database, and a component could be filed
   * under a BOTTOM the style does not own.
   *
   * That is the client's "green arrow — data pulled from a previous tab", and
   * `raagam-masters-picker-wiring`'s cascading rule: a downstream picker is
   * filtered by its parent's value, never handed the global list.
   *
   * Membership comes from `styleCoordinateIds` in `lib/orders/styles/rules.ts`,
   * which is also what `orphanComponents` judges by — deliberately one function,
   * because two would drift into a picker offering a value the rule rejects.
   */
  const coordinateIds = useMemo(() => styleCoordinateIds(coords), [coords]);

  const styleCoordinateOpts = useMemo(
    () => coordinateOpts.filter((o) => coordinateIds.has(o.id)),
    [coordinateOpts, coordinateIds],
  );

  /**
   * The options for ONE component row: the style's coordinates, plus the value
   * this row already holds if that has fallen out of them.
   *
   * THE HELD VALUE ALWAYS SURVIVES THE FILTER. Dropping it would render a filled
   * field as empty and blank the FK on the next save — AGENTS.md's "Disabled
   * rows" rule, which exists for exactly this shape. It comes back marked
   * `is_active: false`, which is how the app already says "you may keep this,
   * you may not re-pick it": `DataPicker` greys it and excludes it from new
   * selections without any new mechanism. The name carries the reason, because
   * the default tag would read "(inactive)" — and the garment row is perfectly
   * active. It is this STYLE that no longer has it.
   */
  const compCoordinateOpts = (held: string | null) => {
    if (!held || coordinateIds.has(held)) return styleCoordinateOpts;
    const row = coordinateOpts.find((o) => o.id === held);
    return row
      ? [...styleCoordinateOpts, { ...row, name: `${row.name} (not in this style)`, is_active: false }]
      : styleCoordinateOpts;
  };

  /* SIZE GROUP WITHDRAWN 2026-08-18 (client: "can remove that size group
     option, just show the dropdown they will choose it, horizontal line").

     What went with it: the Size Group picker, its quick-create sheet, the "Fill
     sizes" button that copied a group's names into rows, the name->id bridge
     that fill needed, and the "not in the Sizes list yet" warning that existed
     only to explain a name the bridge could not resolve. All five were one
     mechanism — choose a group, copy its sizes in, then fix up what did not
     match — and the sizes are now chosen directly, so none of it has a job.

     `size_group_id` STAYS on the form and in the save payload, deliberately. It
     is a HEADER field, and a header field dropped from the payload is FROZEN at
     whatever is stored, where a CHILD field dropped from the payload is NULLED
     on the next save (`writeChildren` deletes and re-inserts wholesale). So
     leaving it in the payload is what preserves the group every existing style
     was made with; taking it out would quietly erase that history the first time
     anyone opened and saved an old style. Nothing writes it any more, so new
     styles simply carry null.

     `data.sizeGroups` is still fetched by the page. Left alone rather than
     chased out: it is one query, and the Size Group master itself is untouched
     by this — only this screen's use of it. */


  /**
   * WHAT IS STOPPING A SAVE, AND WHICH SECTION HOLDS IT.
   *
   * `canSave` is DERIVED, not hand-assembled. The hand-assembled form —
   * `!!name.trim() && !!date && …` — is a list a screen can forget to extend,
   * and `customer-master-screen.tsx:1649` is what that looks like once it has:
   * Save goes dead because of an error two sections away, with nothing on
   * screen to say so.
   *
   * Two sources, one list:
   *   - per-field `required`, declared once here and matching the `*` the form
   *     already draws (`collectProblems` finds them)
   *   - `styleProblems`, the cross-tab rules, which no single field can know
   *
   * The result feeds the rail's red counts AND the jump-to-problem on a blocked
   * Save. This is the first screen to use either.
   */
  const validity = sectionValidity({
    /**
     * THESE KEYS ARE THE RAIL'S KEYS, and they have to stay that way.
     *
     * `revealFirstProblem` hands `p.section` straight to
     * `shellRef.goToSection`, so a key here that no longer names a rail section
     * is a blocked Save that reports the right message and then jumps nowhere.
     * That is what the 2026-08-11 merge could have cost: `general` and
     * `coordinates` stopped being sections, so their fields and their cross-tab
     * problems moved onto `style` — here, in the `field.section` values below,
     * and in the `extra` mapping. Three places, one fact.
     */
    sections: [{ key: "style" }, { key: "components" }],
    values: form,
    fields: [
      { section: "style", id: "st-name", label: "Style", required: true, empty: (f) => !f.style_name.trim() },
      { section: "style", id: "st-date", label: "Date", required: true, empty: (f) => !f.style_date },
      // "Unit", not "Unit Type" (client 2026-08-11). The label is what a blocked
      // Save says out loud, so it has to be the word on the field — one of the
      // TWO places that must now agree, with the field itself. (`coordHint` was
      // the third until the hint line was withdrawn on 2026-08-11.)
      // `section: "style"`, not `"general"` — General is a sub-group of the
      // merged Style section now, not a rail row of its own (see `sections`).
      { section: "style", id: "st-unitkind", label: "Unit", required: true, empty: (f) => !f.unit_kind },
      /**
       * THE OTHER COMPULSORY FIELDS (client 2026-08-10, read off the legacy
       * screen's red ⓘ markers).
       *
       * Each of these needs BOTH halves. Marking the control alone gives a star
       * and a cursor hold with Save still enabled; adding only the entry here
       * gives a dead Save with nothing on screen to explain it.
       *
       * Country was the proof of BOTH failure modes and is worth keeping in
       * writing now that the field itself is gone (client 2026-08-11).
       * `CountryPicker` defaults `required = true`, so it held the cursor from
       * the day it was added while Save stayed live — the third-enforcer gap
       * `country-picker.tsx` warns about, where requiredness buried in a shared
       * picker is invisible to the audit. And when the field was withdrawn, an
       * entry left behind here would have been the mirror image: a Save nothing
       * on screen could unblock. A field and its entry arrive together and
       * leave together.
       */
      { section: "style", id: "st-customer", label: "Customer", required: true, empty: (f) => !f.customer_id },
      // APPROVED SAMPLE NO IS OPTIONAL AGAIN (client 2026-08-13), and its Save
      // gate left with its `*` — both halves together, as the note above
      // insists.
      //
      // It was compulsory from 2026-08-11 and that made the Style master
      // UNSAVEABLE: the picker lists `samples where status = 'approved'`, and
      // `samples` has zero rows in the live database — not zero approved, zero
      // samples. So the field could not be filled, Save could not be unblocked,
      // and Style is required by the Garment Order's Style(s) tab, which put a
      // hard stop in front of order entry.
      //
      // Nothing about the requirement was wrong except that nothing could
      // satisfy it. Recording a sample today needs a `buyers` row, then an
      // opportunity, then a sample, then an approval — four steps in Sales —
      // and it hangs the sample off `buyers` while the order's Customer is a
      // `customers` row (0404). Of 6 buyers, 0 are linked (`buyers.customer_id`,
      // 0380). That empty bridge is the same one `lib/orders/amendments/
      // style-options.ts` records as blocking this very field's customer filter.
      //
      // Make it compulsory again the day a sample can be RAISED from here — see
      // the quick-create shape in the picker rules. A `required` nothing can
      // answer is not a stricter rule, it is a stopped screen.
      { section: "style", id: "st-category", label: "Style Category", required: true, empty: (f) => !f.style_category_id },
      // Country's entry left with its field (2026-08-11). An entry outlasting
      // its control is the dead-Save trap the note above describes.
    ],
    extra: styleProblems({
      style_name: form.style_name,
      style_date: form.style_date,
      unit_kind: form.unit_kind,
      // The RAW string, not `Number(...)`: the rule counts digits, and coercing
      // first would turn a half-typed "202" into 202 and a stray "" into 0 —
      // the second of which would report a problem on a field the operator
      // never touched. Same argument as the `components` line below: a rule
      // enforced in the schema and silent on the screen is the worse half.
      style_year: form.style_year,
      coordinates: coords,
      // Without this the orphan rule is silent on the screen while STILL firing
      // in `garmentStyleInput`'s superRefine — Save would be enabled, the action
      // would refuse, and the rail would show nothing. A rule enforced in one
      // half of the pair is worse than one enforced in neither.
      components: comps,
    }).map<Problem>((p) => ({
      /**
       * `styleProblems` still speaks in TAB names — it is shared with the
       * server action, where "which rail row is this on" is not a question — so
       * its `coordinates` is translated to the rail row that now HOLDS the
       * coordinates grid. Left untranslated, a coordinate-count problem would
       * badge a section the rail no longer has: no red count anywhere, and a
       * blocked Save that jumps nowhere.
       *
       * Written as "components stays, everything else lands on style" rather
       * than a `coordinates → style` swap on purpose. A rule added to
       * `styleProblems` tomorrow gets a real rail row by default instead of
       * silently disappearing, which is the failure mode worth defaulting
       * against.
       */
      section: p.section === "components" ? "components" : "style",
      // The label names the group the problem belongs to, so it keeps saying
      // "Coordinates" — that is still the sub-group the operator must go to,
      // even though the rail row above it now reads "Style".
      label: p.section === "components" ? "Components" : "Coordinates",
      message: p.message,
      kind: "custom",
    })),
  });

  const canSave = validity.canSave;

  /** Save is blocked: say why, and take the operator to the section that holds
   *  it. `MasterFullScreen` keeps the button clickable so Ctrl+S and
   *  Enter-off-the-last-field land here too. */
  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };



  const set = (patch: Partial<HeaderForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  /**
   * The child-grid setters, wrapped so a cell edit marks the record dirty.
   *
   * Every grid mutation goes through these — `openAdd` / `openEdit` keep using
   * the raw setters on purpose, because seeding a record is not an edit and must
   * leave `dirty` false.
   */
  const mutCoords = (fn: (xs: CoordRow[]) => CoordRow[]) => {
    setCoords(fn);
    setDirty(true);
  };
  const mutComps = (fn: (xs: CompRow[]) => CompRow[]) => {
    setComps(fn);
    setDirty(true);
  };
  const mutSizes = (fn: (xs: SizeRow[]) => SizeRow[]) => {
    setSizes(fn);
    setDirty(true);
  };

  const blankCoord = (): CoordRow => ({ key: newKey(), coordinate_id: null });
  /** A new component starts on the style's coordinate when there is only ONE it
   *  could belong to — always the case for a Piece, and for a Set until the
   *  second coordinate is entered. Answering the question before it is asked;
   *  with two or more there is a real choice, so it stays blank. */
  const soleCoordinateId = (): string | null => {
    const ids = [...coordinateIds];
    return ids.length === 1 ? ids[0] : null;
  };

  const blankComp = (): CompRow => ({
    key: newKey(),
    coordinate_id: soleCoordinateId(),
    component_id: null,
    fabric_category_id: null,
    comp_type: "",
    item_id: null,
  });

  function openAdd() {
    setEditId(null);
    setForm({ ...BLANK, style_date: today() });
    setCoords([blankCoord()]);
    setComps([blankComp()]);
    /* No blank size row to seed: sizes are a SET chosen from a dropdown, so
       there is no empty slot for the operator to open. `normalizeSizes`
       already dropped a null-id row, so this changes nothing that was
       stored — only what the screen starts with. */
    setSizes([]);
    // Dropped, not kept: the previous form's predicted serial was for whatever
    // date was in that box. The effect refills it for today's.
    setPreviewCode(null);
    // Seeding a record is not an edit — the three blank rows above are the
    // screen's doing, not the operator's.
    setDirty(false);
    setMode("edit");
  }

  function openEdit(r: GarmentStyle) {
    // An existing style has a real code; it must never be shown a predicted one.
    setPreviewCode(null);
    setEditId(r.id);
    setForm({
      blocked: r.blocked,
      style_date: r.style_date ?? today(),
      customer_id: r.customer_id,
      approved_sample_id: r.approved_sample_id,
      style_name: r.style_name ?? "",
      /**
       * UPPER-CASED ON THE WAY IN, and this is load-bearing rather than tidy.
       * `SEASON_OPTIONS` is capital since 2026-08-17, so a stored "Winter"
       * matches no `<option>` — a `<select>` given a value it has no option for
       * renders its FIRST option, which here is the blank "—". The field would
       * read as unanswered and the next Save would write NULL over a season the
       * operator never touched. Every style in the live database is Title-case
       * today, so this is the whole difference between the CAPS change being a
       * display fix and it being silent data loss.
       *
       * A value that is not one of the four survives untouched — the Select
       * renders it as an extra option (see its note) rather than dropping it,
       * the same "the value a record already holds always survives" rule
       * AGENTS.md states for pickers.
       */
      season: (r.season ?? "").toUpperCase(),
      style_year: r.style_year != null ? String(r.style_year) : "",
      article_no: r.article_no ?? "",
      style_category_id: r.style_category_id,
      style_description: r.style_description ?? "",
      // "" on every style created before 0392. The field is `required`, so the
      // operator answers it before this record can be saved again.
      unit_kind: r.unit_kind ?? "",
      size_group_id: r.size_group_id,
      description: r.description ?? "",
    });
    setCoords(
      r.coordinates.map((c) => ({
        key: newKey(),
        coordinate_id: c.coordinate_id,
      })),
    );
    setComps(
      r.components.map((c) => ({
        key: newKey(),
        coordinate_id: c.coordinate_id,
        component_id: c.component_id,
        fabric_category_id: c.fabric_category_id,
        comp_type: c.comp_type ?? "",
        item_id: c.item_id,
      })),
    );
    setSizes(r.sizes.map((s) => ({ key: newKey(), size_id: s.size_id })));
    // Loading a stored record is not an edit either, or every existing style
    // would announce "Unsaved changes" the moment it opened.
    setDirty(false);
    setMode("edit");
  }

  function submit(asDraft: boolean) {
    const payload = {
      blocked: form.blocked,
      style_date: form.style_date,
      customer_id: form.customer_id,
      approved_sample_id: form.approved_sample_id,
      style_name: form.style_name,
      season: form.season || null,
      style_year: form.style_year ? Number(form.style_year) : null,
      article_no: form.article_no || null,
      style_category_id: form.style_category_id,
      /**
       * DERIVED, NOT ASKED. The Item Class question moved inside the
       * quick-create sheet (client 2026-08-10), so the form no longer holds an
       * answer — but the column is still worth writing: it records which class
       * the chosen category belongs to without the operator answering twice,
       * and a second field asking it is how the two would drift apart.
       */
      item_class_id:
        data.categories.find((c) => c.id === form.style_category_id)?.item_class_id ?? null,
      style_description: form.style_description || null,
      unit_kind: isUnitKind(form.unit_kind) ? form.unit_kind : null,
      size_group_id: form.size_group_id,
      description: form.description || null,
      is_draft: asDraft,
      coordinates: coords.map((c) => ({
        sno: 0,
        coordinate_id: c.coordinate_id,
      })),
      components: comps.map((c) => ({
        sno: 0,
        coordinate_id: c.coordinate_id,
        component_id: c.component_id,
        fabric_category_id: c.fabric_category_id,
        comp_type: c.comp_type || null,
        item_id: c.item_id,
      })),
      sizes: sizes.map((s) => ({ sno: 0, size_id: s.size_id })),
    };
    start(async () => {
      const res = editId
        ? await updateGarmentStyle(editId, payload)
        : await createGarmentStyle(payload);
      if (res.ok) {
        success(editId ? "Style updated" : "Style created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: GarmentStyle) {
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deleteGarmentStyle(r.id);
      if (res.ok) {
        success("Style deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST MODE ----------------
  if (mode === "list") {
    const columns: Column<GarmentStyle>[] = [
      {
        // "Serial No", matching the field on General. `Code` is the word this
        // app hides from operators everywhere else (codes are backend-only,
        // client 2026-07-23) — this column survived because the value here IS
        // the human identifier, so it should be named the way the form names it.
        header: "Serial No",
        cell: (r) => (
          <button
            type="button"
            onClick={() => perms.canEdit && openEdit(r)}
            className="font-mono text-xs font-medium text-primary hover:underline"
          >
            {r.code ?? "—"}
          </button>
        ),
      },
      { header: "Style", cell: (r) => <span className="text-sm">{r.style_name ?? "—"}</span> },
      {
        header: "Customer",
        cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span>,
      },
      {
        header: "Season",
        /* `uppercase` is the CSS half of AGENTS.md §CAPITALS, and on this field
           it is the ONLY half that can reach an existing row: Season is a
           `<Select>` over a fixed list, so there is no keystroke to intercept
           and a style saved as "Winter" is only re-written when someone opens
           and saves it. All 3 styles in the live database are in that state
           today (checked 2026-08-17), so without this the listing keeps showing
           Title case after the fix lands. */
        cell: (r) => (
          <span className="text-sm uppercase text-muted-foreground">{r.season ?? "—"}</span>
        ),
      },
      {
        header: "Status",
        cell: (r) => (
          <StatusPill tone={styleStatusTone(r)}>{styleStatusText(r)}</StatusPill>
        ),
      },
      {
        header: "Created",
        align: "right",
        cell: (r) => (
          <span className="tabular-nums text-xs text-muted-foreground">
            {fmtDate(r.created_at)}
          </span>
        ),
      },
      rowActionsColumn((r) => (
        <RowActions
          label={r.code}
          onEdit={() => openEdit(r)}
          canEdit={perms.canEdit}
          onDelete={() => del(r)}
          canDelete={perms.canDelete}
          menu={blockItem(r, { label: r.code, canBlock: perms.canDelete })}
          isPending={isPending}
        />
      )),
    ];

    return (
      <div className="space-y-4">
        <PageHeader
          title="Style"
          description="Garment style master — coordinates, components and sizes."
          actions={
            perms.canCreate ? <Button onClick={openAdd}>New Style</Button> : undefined
          }
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={rows}
          getKey={(r) => r.id}
          empty="No styles yet. Use 'New Style' to create the first."
        />
      </div>
    );
  }

  // ---------------- EDIT MODE ----------------

  // ---- child grids ----------------------------------------------------------
  // All three were hand-rolled: Coordinates and Components as raw <table>, and
  // Sizes as a bare flex list with NO `data-grid-body` at all, so arrow keys have
  // never worked in it. `ChildGrid` brings one implementation of ↑/↓/Enter, the
  // `data-row-remove` marker Ctrl+Del drives, `data-row-add` for Tab into an
  // empty nested grid, per-cell `RequiredScope`, pagination and mobile cards.

  const coordColumns: ChildGridColumn<CoordRow>[] = [
    {
      header: "Coordinate",
      /**
       * REQUIRED (client 2026-08-19: "Coordinate is required field, update it").
       *
       * ONE DECLARATION, and this is the only one needed here. `ChildGrid` wraps
       * every cell in `<RequiredScope required={c.required}>` in BOTH the table
       * and the stacked-cards layout — this grid renders no `renderMobileRow`,
       * so it is not the "declare it twice" case AGENTS.md warns about — and
       * `useRequiredHold` ORs the scope with a control's own prop. So this one
       * line draws the header `*` and stamps `data-required-empty` on the picker,
       * which is what holds the cursor on a blank row.
       *
       * THE SAVE HALF WAS ALREADY THERE, which is why this is not a second rule
       * competing with an existing one: `styleProblems` (lib/orders/styles/rules.ts)
       * already refuses a Piece style without exactly 1 coordinate and a Set
       * without at least 2, on the screen AND in `garmentStyleInput`'s
       * superRefine. A blank coordinate row was therefore always unsaveable —
       * it just did not say so at the field, which is the gap the `*` closes.
       *
       * Consistent with `seedRow`: the grid opens with one blank row, and that
       * row genuinely must be filled before the style can be saved. Ctrl+Del
       * still removes a row the operator did not want, which is the documented
       * way out of a held cell.
       */
      required: true,
      // Same reason as Sizes — one column, a short value. Wider because a
      // coordinate reads "NECK AND SHOULDER RIB", not "XXL".
      width: "20rem",
      cell: (r) => (
        <ItemPicker
          label="Coordinate"
          items={coordinateOpts}
          value={r.coordinate_id ?? ""}
          onChange={(id) =>
            mutCoords((xs) => xs.map((x) => (x.key === r.key ? { ...x, coordinate_id: id || null } : x)))
          }
          /**
           * PICK-ONCE. A style cannot have TOP twice, and a duplicate is not
           * merely untidy here — it makes the two rules below disagree with what
           * the operator sees. `filledCoordinates` would count two toward the
           * Piece/Set cap while the Components list offers one entry, so a
           * Piece style could hold two rows and still look correct.
           *
           * `usedIds` is `DataPicker`'s existing prop for exactly this and is
           * safe to hand the row's own value: it excludes the siblings, not the
           * current cell.
           */
          usedIds={coords
            .filter((x) => x.key !== r.key)
            .map((x) => x.coordinate_id)
            .filter((id): id is string => !!id)}
          /**
           * "+ Add" OPENS THE GARMENT MINI-FORM, not a name-only box (client
           * 2026-08-10). `quickCreateClassId` + `garmentQuickCreate` is the same
           * door `yarnQuickCreate` uses on the Materials screen — see
           * `GarmentQuickCreateSheet` for why form C makes a complete mini-form
           * possible in four fields.
           */
          quickCreateClassId={garmentClassId ?? undefined}
          garmentQuickCreate={
            garmentClassId
              ? {
                  categories: scopedCategories,
                  uoms: data.uoms,
                  levies: data.levies,
                  fabricStructures: fabricStructureOpts,
                  itemClasses: itemClassOpts,
                }
              : undefined
          }
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          compact
        />
      ),
    },
  ];

  /**
   * WHICH COMPONENT CELLS ARE COMPULSORY (client 2026-08-10: red = compulsory,
   * blue = optional).
   *
   * Declared on the PICKERS, not through `ChildGridColumn.required` — this grid
   * renders `renderMobileRow`, which those columns never reach (child-grid.tsx
   * says so where the prop is defined), so a star declared there would be
   * decoration with no hold behind it. `material-attribute-master-screen.tsx`
   * records the same finding.
   *
   * ONLY ON A ROW THE OPERATOR HAS STARTED. `ChildGrid` seeds a blank row, and
   * the save path drops any row holding nothing — so requiring a field on an
   * untouched row would cage them on a row that is about to be discarded. Both
   * ends read `componentRowStarted`, deliberately one function.
   */
  const compRequired = (r: CompRow) => componentRowStarted(r);

  /**
   * Coordinate is compulsory too — a Set style has to say whether a sleeve
   * belongs to the Top or the Bottom — BUT ONLY WHEN THERE IS ONE TO PICK.
   * With no coordinates entered yet the list is empty, and a hold on a field
   * that cannot be filled is a cage with no keyboard way out. The section hint
   * already says "Add coordinates first"; that is the honest answer there.
   */
  const coordRequired = (r: CompRow) => compRequired(r) && coordinateIds.size > 0;

  const compColumns: ChildGridColumn<CompRow>[] = [
    {
      header: "Coordinate",
      cell: (r) => (
        <ItemPicker
          label="Coordinate"
          // Scoped to the style's own coordinates — NOT the whole garment list.
          items={compCoordinateOpts(r.coordinate_id)}
          value={r.coordinate_id ?? ""}
          onChange={(id) => mutComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, coordinate_id: id || null } : x)))}
          /**
           * NO ADD, NO MODIFY, and this is the half that is easy to get wrong.
           *
           * Inline Add here would create a GARMENT, which does not give this
           * style that coordinate — so the value the operator just created would
           * still not appear in this list. A control whose success is
           * indistinguishable from failure is worse than no control. Coordinates
           * are added on the Coordinates tab, the only place that changes what
           * this list holds. Omitting `quickCreateClassId` is what withholds it.
           */
          canCreate={false} canEdit={false} required={coordRequired(r)} compact
        />
      ),
    },
    {
      header: "Component",
      cell: (r) => (
        <ComponentPicker
          label="Component"
          /**
           * NARROWED BY THE COORDINATE CELL BESIDE IT (client 2026-08-11) —
           * Front Body belongs to a Top and means nothing under a Bottom.
           *
           * The rule is `componentsForCoordinate`, NOT re-derived here, and it
           * owns three decisions this call site must not second-guess:
           * a blank coordinate offers EVERYTHING (deliberately the opposite of
           * the nominated-vendor rule — read the reasoning there before
           * "fixing" it); the row's own value always survives the filter, which
           * is why no `compCoordinateOpts`-style wrapper is needed here; and it
           * matches by NAME because a style's coordinate is an `items` row while
           * the Components master stores plain text.
           *
           * It narrows nothing today — every component in the live master has
           * `all_coordinates = true` — and that is the design, not a gap. It
           * starts working the moment an operator unticks the box on a
           * component and lists its sections.
           */
          components={componentsForCoordinate(componentOpts, {
            coordinateId: r.coordinate_id,
            coordinates: coordinateOpts,
            currentValue: r.component_id,
          })}
          // The `components` master (0228), not the empty 'style_component'
          // lookup kind this used to read (0396).
          //
          // `ComponentPicker`, not `RecordPicker`: this field carries inline
          // "+ Add" so a component can be created without leaving the style
          // (client 2026-08-11). See that file for why this master earns an
          // affordance `RecordPicker` withholds by design — the short version
          // is that the Components master asks for ONE field, so a name typed
          // here is a complete record, not a stub.
          value={r.component_id}
          onChange={(id) => mutComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, component_id: id } : x)))}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          canDelete={masterPerms.canEdit}
          required={compRequired(r)}
          compact
        />
      ),
    },
    {
      header: "Structure",
      /**
       * THE FABRIC CATEGORY — SINGLE JERSEY, FLEECE, 1X1 LYCRA RIB (client
       * 2026-08-11, "structure is fabric category data").
       *
       * `CategoryPicker`, not `LookupDialogPicker`: this is the Category master
       * (0223), and handing over `levies` + `fabricStructures` + `itemClasses`
       * is what upgrades its "+ Add" from a name-only box to the full
       * class-aware sheet — which for FABRIC asks for the Fabric Structure, the
       * very field the Type cell beside this one reads. Omitting any of the
       * three silently downgrades the control with no error anywhere.
       */
      cell: (r) => (
        <CategoryPicker
          label=""
          title="Structure"
          categories={fabricCategoryOpts(r.fabric_category_id)}
          value={r.fabric_category_id ?? ""}
          /**
           * PICKING THE STRUCTURE FILLS THE TYPE BESIDE IT.
           *
           * A FETCH, not a correlation: `categories.fabric_structure_id` is
           * declared on the Category master, so SINGLE JERSEY answers Circular
           * Knit exactly. `componentTypeForCategory` (rules.ts) owns the hop.
           *
           * NULL MEANS LEAVE THE CELL ALONE — a category whose master record has
           * no structure yet must not blank a Type the operator chose, which is
           * what `?? x.comp_type` guarantees. On the CHANGE, never in an effect:
           * an effect keyed on the category would also fire when an existing
           * style is OPENED and overwrite every stored Type on load.
           */
          onChange={(v) =>
            mutComps((xs) =>
              xs.map((x) =>
                x.key === r.key
                  ? {
                      ...x,
                      fabric_category_id: v || null,
                      comp_type:
                        componentTypeForCategory(v || null, data.categories, structureOpts) ??
                        x.comp_type,
                    }
                  : x,
              ),
            )
          }
          itemClassId={fabricClassId ?? ""}
          selectedClassCode="FABRIC"
          levies={data.levies}
          fabricStructures={fabricStructureOpts}
          itemClasses={itemClassOpts}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          canDelete={masterPerms.canEdit}
          compact
        />
      ),
    },
    /* TYPE WITHDRAWN 2026-08-18 (client: "Type no need show, that type field").
       The COLUMN `comp_type` and every stored value stay, and — exactly as with
       Fabric below — it MUST stay in the row shape, in `toRows` and in the save
       payload: `writeChildren` deletes and reinserts a child grid wholesale, so a
       field dropped from the payload is NULLED on the next save rather than
       frozen. `normalizeComponents` still writes it and the fill still runs on
       the Structure cell's `onChange`, so the stored value stays correct and
       `categories.fabric_structure_id` remains its single source of truth.

       THE 08-17 OBJECTION TO HIDING IS SPENT, and it is worth saying why rather
       than leaving the reversal to look careless. Hiding was refused that day
       because the cell was the only place the answer appeared while the value
       kept saving. That was an argument against hiding an EDITABLE column whose
       value the operator could still be held responsible for; since generation 4
       the cell is `readOnly` and fully derived, so removing it removes a printout,
       not an answer. The client's own 08-17 sentence offered both — "set to Read
       Only format or hidden if not required" — and this is them choosing the
       second half of it. Structure still shows "SINGLE JERSEY" rather than
       "Circular Knit", so the value is genuinely off screen now; that is accepted,
       not overlooked.

       READ THIS BEFORE PUTTING A TYPE CELL BACK. The column has been wrong four
       times and the history is the whole guard against a fifth — it is kept here
       deliberately and must not be tidied away with the cell:

         1. `COMPONENT_TYPE_OPTIONS` = ["Circular", "Flat"] — a RESTATEMENT OF
            STRUCTURE, and it could not express Woven at all, so CHAMBRAY and ROPE
            had no Type.
         2. The `fabric_type` lookup — Solid / Yarn Dyed / Melange. That is the
            fabric's COLOUR type, which only a FABRIC can answer: a Single Jersey
            may be any of the three, so no category can imply it. It became
            unanswerable here once the Fabric column left. Its `useMemo` outlived
            it as dead code still calling itself "THE TYPE COLUMN'S VOCABULARY",
            which is how a fourth wrong answer gets written; removed 2026-08-17.
         3. The `fabric_structure` NAMES, auto-filled but still EDITABLE — right
            about the source, wrong about the owner. It made this screen a second
            place to answer a question the Category master already answers.
         4. The same value, READ-ONLY (client 2026-08-17). Correct, and withdrawn
            above for display only.

       So if Solid / Yarn Dyed / Melange are ever asked for here, the FABRIC column
       has to come back with them — a category cannot imply them. */
    /* FABRIC WITHDRAWN 2026-08-11 (client: "remove that fabric field for now").
       The COLUMN `item_id` and every stored value stay, and — unlike a header
       field — it MUST stay in the row shape, in `toRows` and in the save
       payload: `writeChildren` deletes and reinserts a child grid wholesale, so
       a field dropped from the payload is NULLED on the next save rather than
       frozen. Same treatment `trims` / `trims_category_id` already have.

       Its requiredness went with it. A required field with no cell is a record
       that cannot be saved with nothing on screen to say why — the "requiring a
       hidden field" failure AGENTS.md names — and `compRequired` now reaches
       only Coordinate and Component.

       `data.fabrics` is still fetched. "For now" says this column returns, and
       the fetch is one query against a list the Color/Print work will want. */
  ];


  // ---- the cross-tab rule ---------------------------------------------------

  /** Piece → exactly 1 coordinate, Set → 2–6, null → no rule yet (legacy rows). */
  const coordCap = coordinateLimit(form.unit_kind);

  /**
   * THERE IS NO LONGER A HINT LINE. The client withdrew "A Piece style has
   * exactly 1 coordinate." on 2026-08-11.
   *
   * THE RULE ITSELF IS UNCHANGED — `coordCap` above still feeds `hideAdd` on the
   * grid, which removes the "+ Add" button AND makes Enter on the last row
   * decline, so neither mouse nor keyboard can exceed the cap. Only the
   * SENTENCE went; do not read its absence as the cap being dropped.
   *
   * The trade-off, stated: a Piece style now shows one row and no Add button
   * with nothing on screen explaining why. If that needs answering later, the
   * place for it is `<Field hint>` on the Unit field — where the Piece/Set
   * choice is actually made — not a line inside the Coordinates row, which is
   * what made this one a layout problem.
   */

  /**
   * Switching to Piece trims the grid to its first row.
   *
   * Done on the CHANGE rather than in an effect: an effect watching `unit_kind`
   * would also fire when an existing Set style is opened, silently deleting
   * coordinates the operator never touched. Here it only ever runs because
   * someone chose Piece just now.
   */
  const setUnitKind = (v: string) => {
    set({ unit_kind: v });
    const cap = coordinateLimit(v);
    if (cap && coords.length > cap.max) {
      mutCoords((xs) => xs.slice(0, cap.max));
    }
  };

  // ---- rail sections --------------------------------------------------------
  // Every field is `size="sm"` — the standing "ONE SIZE, EVERY FIELD" rule (3 of
  // 12, four per row, ~280px). Nothing is sized to its own data, so a Year box
  // and a Customer picker line up down the page. Previously these were 20
  // hand-rolled `<div><Label/>…</div>` triples inside two full-bleed
  // `lg:grid-cols-3` CardBodies, which stretched every control to ~370px and,
  // more importantly, meant `<Field>` never wrapped anything — so `required` had
  // nothing to bind to and both asterisks were literal text.

  /**
   * NO `problems` BADGE ON THE RAIL (operator, 2026-08-11) — see the
   * `raagam-screen-layout` skill, "The operator's five". Every section passes
   * `done` and none passes `problems`, so a section holding a blank mandatory
   * field shows the quiet empty dot rather than a red count.
   *
   * The operator's reasoning: the field already draws a red `*`, and a second
   * red thing counting the same fact is noise. What the count added that the
   * star cannot is WHICH SECTION — only one is mounted at a time, so the stars
   * in the other four are off screen.
   *
   * `footer.onBlockedSave` is what carries that now, and it is why removing the
   * badge is safe HERE and would not be on a screen without it: Save stays
   * clickable, names the missing field in a toast, and `goToSection` walks the
   * cursor to it. Take the badge off a screen that does not wire it and you get
   * a dead Save button with nothing on screen to explain it — the exact bug
   * `sectionValidity` was built to end.
   *
   * `validity` itself stays: `canSave` must remain DERIVED. Only `bySection`
   * goes unread.
   */
  const sections: FullScreenSection[] = [
    {
      key: "style",
      label: "Style",
      icon: Shirt,
      /**
       * THREE SECTIONS BECAME ONE (client 2026-08-11): Style Details, General
       * and Coordinates now share a view, because they are all answers about
       * the same thing and paging between them to enter one style read as three
       * screens.
       *
       * MERGED, NOT FLATTENED. LAYOUT.md §4 caps a group at 5-7 fields and this
       * section holds thirteen plus a grid, so the merge is three
       * `DetailSection` cards inside ONE `SectionBody` — the shape the shell
       * already expects ("a section often holds more than one DetailSection",
       * master-full-screen.tsx). One scroll, three named groups; a single
       * thirteen-field wall would have been the client's complaint with a
       * different cause.
       *
       * `done` is the OR of the three dots this replaces. Every signal in it is
       * still something only the OPERATOR can supply — that is the rule to
       * re-check after any change here, and it is why `unit_kind` is absent
       * (defaulted to Piece in `BLANK`, so it would light the dot on an empty
       * form) and why the withdrawn `unit_id` is not simply carried over.
       */
      done:
        !!form.style_name.trim() ||
        !!form.season ||
        !!form.style_category_id ||
        !!form.article_no.trim() ||
        !!form.style_description.trim() ||
        coords.some((c) => c.coordinate_id),
      content: (
        <SectionBody title="Style">
          {/* SEVEN FIELDS ON ONE ROW (client 2026-08-17). `cols={14}` rather
              than 12 because the smallest span is `xs` (2) and 7 x 2 = 14 — the
              fields keep the existing size, the TRACK is what widened. Twelve
              tops out at six.

              IT ONLY ADDS UP BECAUSE BLOCKED LEFT. This section held EIGHT
              fields in two rows of four; Blocked moved to the listing's row
              actions in the same request ("no more in the creating screen"), and
              eight would need 16. The two changes are one change.

              A field here is ~155px against LAYOUT.md §3's ~280px — narrower
              than anywhere else in the app. That is the trade the single row
              costs, and it is stated rather than hidden. */}
          <DetailSection label="Style Details" cols={14}>
            {/**
              * THE SERIAL — STL/<fy><fy+1>/<n>, e.g. STL/2627/0001. The format
              * is `public.garment_style_code_format()`; nothing composes it here.
              *
              * FIRST FIELD ON THE FIRST SECTION (client 2026-08-10): the number
              * the record is known by reads before anything that describes it.
              * It was previously rendered in exactly one place, the list's
              * "Code" column, so an operator who opened a style could not see it
              * at all.
              *
              * `readOnly` is doing three jobs at once, all of them house rules:
              * `Input` sets `tabIndex={-1}` on a readOnly field itself, so this
              * leaves the Tab path, the arrows and the focus trap without a
              * per-screen opt-out; `useRequiredHold` is gated on `!readOnly`, so
              * it can never become a cage with no keyboard way out; and a
              * read-only auto field is CAPS-exempt, hence no `uppercase`.
              *
              * On an EXISTING style this is the stored code. On a NEW one it is
              * `previewCode` — what the trigger WOULD assign — which is a
              * prediction and not a reservation: see `previewStyleCode`. The
              * "(auto)" placeholder survives only as the fallback for when the
              * database cannot answer.
              */}
            <Field label="Serial No" size="xs" htmlFor="st-code">
              <Input
                id="st-code"
                readOnly
                value={editingCode ?? previewCode ?? ""}
              />
            </Field>
            {/**
              * SERIAL, DATE, CUSTOMER, SAMPLE, STYLE (client 2026-08-11).
              *
              * The order is the operator's sequence, not an aesthetic. The two
              * facts the record is FILED by come first — its serial and the day
              * it was raised — and the Date earns second place for a reason
              * this screen already depends on: the serial is fiscal-year keyed
              * (`assign_garment_style_code`), so the Date is what the number
              * above it is computed FROM. Reading them the other way round
              * showed a predicted serial before the field that decides it.
              *
              * Then the party chain: a style starts life as a sample the
              * customer approved, so naming the customer first is what lets the
              * sample list narrow to theirs and makes sample→order conversion
              * followable. Style last, because what the garment is called is
              * decided last.
              *
              * The narrowing itself is NOT built — see the note on Approved
              * Sample No below. The order stands on its own regardless.
              */}
            <Field label="Date" required size="xs" htmlFor="st-date">
              <Input
                id="st-date"
                type="date"
                value={form.style_date}
                onChange={(e) => set({ style_date: e.target.value })}
              />
            </Field>
            {/* "For" withdrawn 2026-08-10 (client). `garment_styles.style_for`
                keeps its column and its stored values; it is simply no longer
                asked for, and no longer written — it left the Zod input too. */}
            {/* Customer no longer clears a Contact on change — the Contact
                field was withdrawn, so there is no dependent value to reset. */}
            {/* COMPULSORY — red ⓘ on the legacy header (client 2026-08-10).
                `CustomerPicker` has no `required` prop of its own, so the
                declaration goes on the wrapper: the inner `DataPicker` ORs
                `RequiredScope` context, which is the same route CurrencyPicker
                takes on the amendment screen. `htmlFor` so a blocked Save can
                land the cursor here via `goToSection(..., { fieldId })`. */}
            <Field label="Customer" required size="xs" htmlFor="st-customer">
              <CustomerPicker
                id="st-customer"
                customers={data.customers}
                value={form.customer_id}
                onChange={(id) => set({ customer_id: id })}
                label="Customer"
                compact
              />
            </Field>
            {/**
              * NARROWED TO THE CUSTOMER ABOVE (client 2026-08-13, 0422).
              *
              * This field carried a long note refusing to do exactly that, and
              * the refusal was right at the time: `samples` (0005) had NO
              * customer column, and its only party link was `opportunity_id` →
              * `opportunities.buyer_id` → `buyers`, which reaches `customers`
              * only through the NULLABLE `buyers.customer_id` bridge (0380) —
              * set for none of the six buyers. Filtering down that chain would
              * have dropped every sample silently. The note said narrowing was
              * a schema question and not a screen one; 0422 answered it with a
              * direct `samples.customer_id`.
              *
              * THREE RULES, and each is a way to turn this into a worse field
              * than the unfiltered one:
              *
              * - A sample with NO customer stays offered. Every row is NULL
              *   today (0422's backfill had nothing to resolve), so a strict
              *   filter would empty an already-empty list and read as broken.
              * - The sample this style already holds always survives, whatever
              *   its customer says now — "Disabled rows", and the same failure
              *   if skipped: a filled field renders empty and the next save
              *   writes that emptiness over a real FK.
              * - With NO customer chosen the list is NOT emptied and the field
              *   is NOT disabled. Customer sits directly above and is already
              *   `required`; a control greyed out with no explanation is worse
              *   than a full list. This is the opposite call from
              *   `processesForKind`'s blank Type, and deliberately: Type
              *   DECIDES WHICH LIST, while Customer merely narrows one that is
              *   already valid.
              */}
            {/* NO LONGER COMPULSORY (client 2026-08-13) — `samples` has zero
                rows, so a required field with an empty picker made the Style
                master unsaveable. See the Save-gate note above. */}
            <Field label="Approved Sample No" size="xs" htmlFor="st-sample">
              <RecordPicker
                id="st-sample"
                label="Approved Sample No"
                compact
                items={samplesForCustomer}
                value={form.approved_sample_id}
                onChange={(id) => set({ approved_sample_id: id })}
              />
            </Field>
            <Field label="Style" required size="xs" htmlFor="st-name">
              {/* `uppercase` is the SCREEN half of AGENTS.md §CAPITALS (client
                  2026-08-14). It does two things a `.toUpperCase()` in the
                  handler would not: it uppercases the keystroke, and it adds the
                  CSS transform that also shouts a name saved BEFORE this rule —
                  a value loaded from the DB and never re-typed is unreachable
                  from a keystroke handler. The write half is `capsName()` on
                  `style_name` in `lib/orders/styles/types.ts`; both are
                  required. */}
              <Input
                id="st-name"
                value={form.style_name}
                onChange={(e) => set({ style_name: e.target.value })}
                uppercase
              />
            </Field>
            {/* STYLE DESCRIPTION SITS BESIDE STYLE, AND UNIT MOVED UP HERE TOO
                (client 2026-08-11).

                THE ARITHMETIC IS THE WHOLE REASON UNIT IS HERE. Every field is
                `sm` (3 of 12), so a group only lands flush at a MULTIPLE OF
                FOUR fields. General briefly held five — Season, Year, Article
                No., Style Category, Unit — and five cannot work: 5 x 3 = 15, so
                the fifth field is orphaned on a row of its own with nine columns
                of white space beside it. No ordering fixes that, and widening a
                field to disguise it would break the one-width rule.

                Moving Unit here makes BOTH groups exact:
                  STYLE DETAILS  Serial + Date + Customer + Approved Sample = 12
                                 Style + Style Description + Unit + Blocked  = 12
                  GENERAL        Season + Year + Article No. + Style Category = 12

                Style Description went back to `sm` in the same move — it was only
                `lg` to pad the old three-field row to 12, and with four fields
                that padding is what would now overflow. Every field on this
                screen is one width again.

                Unit also reads better here: Piece/Set is what the Coordinates
                grid is capped by, and it is a property of the style itself
                rather than of the "general" descriptive block. */}
            <Field label="Style Description" size="xs" htmlFor="st-styledesc">
              <Input
                id="st-styledesc"
                value={form.style_description}
                onChange={(e) => set({ style_description: e.target.value })}
              />
            </Field>
            <Field label="Unit" required size="xs" htmlFor="st-unitkind">
              <Select
                id="st-unitkind"
                value={form.unit_kind}
                onChange={(e) => setUnitKind(e.target.value)}
              >
                <option value=""></option>
                {UNIT_KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            {/* BLOCKED IS A ROW ACTION NOW (client 2026-08-17): "we are used to
                give that block while CREATING the data but we need to move this
                in ACTION only, no more in the creating screen". The ⋮ on the
                listing carries Block / Unblock — see `useBlockAction`.

                `form.blocked` stays in the form state and in the save payload,
                so an edit round-trips it rather than nulling it; it is simply no
                longer typed here. Its departure is also what lets the seven
                fields above sit on one row. */}
          </DetailSection>
          {/**
            * GENERAL — was its own rail section until 2026-08-11. It kept every
            * field, its order and its comments; only its container changed, so
            * the diff is a re-indent and nothing in here should read as new.
            *
            * Its old `done` dot is folded into the merged section above. The
            * note it carried is worth keeping because it is the trap: the dot
            * means "the operator has put something here", so a DEFAULTED field
            * must never be a signal. `unit_kind` was in that list until `BLANK`
            * opened on Piece, at which point General showed complete the instant
            * New Style was clicked, with every box on it empty. Nothing was lost
            * on the Save side — `unit_kind` is still `required` in
            * `sectionValidity`, which is what actually gates Save.
            */}
          {/* SAME TRACK AS STYLE DETAILS ABOVE (client 2026-08-17: "reduce the
              general detail field size like above section").

              At `cols={12}` + `sm` these four fields took 3/12 each and stretched
              to ~370px, while the seven above sat at ~155px — so the two blocks
              read as different forms and nothing lined up down the page. On the
              SAME 14-col track at `xs` a General field is the same ~155px and
              lands in the same column as the field above it: Season under Serial
              No, Year under Date, and so on. That vertical alignment is the whole
              point of LAYOUT.md §3's one-width rule.

              Four fields leave 6 of 14 empty to the right. That is the honest
              cost of matching the row above, and it is the same trade Style
              Details makes — widening them to fill the row is what created the
              mismatch being fixed. */}
          <DetailSection label="General" cols={14}>
            {/* CAPS (client 2026-08-17). Season is a `<Select>` over a fixed
                vocabulary, so `<Input uppercase>` — the mechanism AGENTS.md
                §CAPITALS names — does not apply: there is no keystroke, and a
                CSS transform on the trigger would show capitals while storing
                Title case, which is the "merely displayed" half the rule
                refuses. The OPTION VALUES are capital instead
                (`SEASON_OPTIONS`), so what is picked is what is stored, and
                `capsTextNullable()` on the schema covers every writer that is
                not this dropdown. */}
            <Field label="Season" size="xs" htmlFor="st-season">
              <Select id="st-season" value={form.season} onChange={(e) => set({ season: e.target.value })}>
                <option value=""></option>
                {SEASON_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
                {/* A STORED SEASON THAT IS NOT ONE OF THE FOUR KEEPS ITS OPTION.
                    The column is plain `text` (0124) and has always taken
                    imported free text, so "SS26" is a value this list cannot
                    represent — and a `<select>` silently falls back to its first
                    option for a value it has no option for, which here is the
                    blank. The field would read as empty and the next Save would
                    blank the column. Same statement as "the one row that
                    survives is the one the record already holds" under
                    AGENTS.md §"Disabled rows", applied to a fixed list rather
                    than a master. Never rendered for the four normal words. */}
                {form.season &&
                  !(SEASON_OPTIONS as readonly string[]).includes(form.season) && (
                    <option value={form.season}>{form.season}</option>
                  )}
              </Select>
            </Field>
            {/**
              * FOUR DIGITS, AND `type="number"` COULD NOT SAY SO (client
              * 2026-08-21: "year ... accepting much [more] range digits").
              *
              * `maxLength` IS IGNORED ON A NUMBER INPUT — that is the whole
              * bug, not an oversight in the call site. The attribute applies
              * to text-entry types only, so the box took 202666 as happily as
              * 2026, and `style_year` is a plain `integer` column that stored
              * it. It also carried the two other things a number input brings:
              * spinner arrows on a field the arrow keys are supposed to
              * NAVIGATE (AGENTS.md §"Tab lands on fields"), and an accepted
              * "2e5".
              *
              * `ValidatedInput format="year"` is the shape the repo already
              * has for "this field has a form" — one declaration in
              * `FORMATS.year` carries the digits-only keystroke transform, the
              * real `maxLength={4}`, `inputMode="numeric"` for the phone
              * keypad, and the message shown on blur. Nothing about the count
              * is written here, so the HSN / PIN / Aadhaar fields and this one
              * cannot drift.
              *
              * The SAVE half is separate and lives in `styleProblems`
              * (`lib/orders/styles/rules.ts`), which the rail badge, `canSave`
              * and `garmentStyleInput`'s `superRefine` all read — this input
              * is the courtesy, that is the guard.
              */}
            <Field label="Year" size="xs" htmlFor="st-year">
              <ValidatedInput
                id="st-year"
                format="year"
                value={form.style_year}
                onChange={(e) => set({ style_year: e.target.value })}
              />
            </Field>
            <Field label="Article No." size="xs" htmlFor="st-article">
              {/* CAPS for the same reason as Style: an article number is a stored
                  VALUE, and the CAPITALS exemptions cover free prose, digits,
                  email and auto fields — not a code an operator types. Write half
                  is `capsTextNullable()` on `article_no`. */}
              <Input id="st-article" value={form.article_no} onChange={(e) => set({ article_no: e.target.value })} uppercase />
            </Field>
            {/**
              * STYLE CATEGORY — the Garment master, scoped to the class above.
              *
              * `CategoryPicker`, not `LookupDialogPicker`: passing `levies` and
              * `fabricStructures` is what makes its "+ Add" open the full
              * class-aware `CategoryQuickCreateSheet` instead of the name-only
              * inline form (`useFullQc`, lookup-picker.tsx). Omitting either one
              * silently downgrades the control to a Name box with no error
              * anywhere — which is the whole thing the client asked to fix.
              *
              * `scopedCategories` is empty until a class is chosen, so the field
              * offers nothing rather than the whole master.
              */}
            {/* COMPULSORY — red ⓘ on the legacy General tab. */}
            <Field label="Style Category" required size="xs" htmlFor="st-category">
              <CategoryPicker
                id="st-category"
                label="Style Category"
                required
                categories={scopedCategories}
                value={form.style_category_id ?? ""}
                onChange={(v) => set({ style_category_id: v || null })}
                itemClassId={garmentClassId ?? ""}
                selectedClassCode="GAR"
                levies={data.levies}
                fabricStructures={fabricStructureOpts}
                // Handing the class list over is what makes "+ Add" ASK for
                // the Item Class and render the form for it, rather than
                // silently creating under GARMENTS.
                itemClasses={itemClassOpts}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
                canDelete={masterPerms.canEdit}
                compact
              />
            </Field>
            {/**
              * UNIT — its own field, and the one the Coordinates rule reads.
              *
              * "Unit Type" until 2026-08-11; the client calls it Unit, so the
              * LABEL follows them. The column stays `unit_kind` — a rename that
              * reached the schema would touch 0392, `coordinateLimit`,
              * `styleProblems` and the Zod input for a word on a screen.
              *
              * THE ONLY UNIT FIELD ON THIS SCREEN, and it took two goes to get
              * there. There used to be a second field labelled "Unit" beside it,
              * backed by `unit_id` over the `uoms` master; on 2026-08-11 that
              * one was RE-LABELLED "Stock Unit" (which is what that master is
              * called everywhere else — `stock-unit-master-screen.tsx`,
              * `registry.ts`, Master Data ▸ Materials ▸ Stock Units) and later
              * the same day WITHDRAWN outright at the client's request. One
              * question, one field.
              *
              * WITHDRAWN, NOT MERGED, and the distinction is the whole reason
              * this note survives the field it describes. The two were never one
              * value read two ways: `uoms` is seeded lowercase (nos, mtr, kg,
              * set…), has no PIECE row at all, and its codes can be renamed from
              * the Stock Unit screen — so a Piece/Set rule inferred from it would
              * break silently the day someone tidied that master. Anyone tempted
              * to "restore" Stock Unit by pointing `unit_kind` at `uoms` is
              * re-proposing the thing that was rejected.
              *
              * `required`, which means an existing style (all of which predate
              * this field) must answer before it can be saved again. That is
              * deliberate backfill, not an oversight. A NEW style now opens on
              * Piece (`BLANK`), so the field is never blank on the way in.
              */}
            {/* STOCK UNIT WITHDRAWN 2026-08-11 (client): ONE Unit field, and it
                is the Piece/Set one, which now sits in STYLE DETAILS above
                (moved there so neither group is left with an orphaned row —
                see the note beside it). The two were never the same question
                — `unit_id` names a `uoms` row, `unit_kind` answers Piece-or-Set
                — but asking both put two fields labelled around "Unit" side by
                side, and only one of them means anything downstream: `unit_kind`
                caps the Coordinates grid and seeds the Garment Order's Order
                Unit, while `unit_id` fed nothing.

                It left in ONE PIECE, the way Country did: the control, its
                `HeaderForm` key, its place in the payload, its `done`-dot signal
                and its `garmentStyleInput` key all went together.
                `garment_styles.unit_id` keeps its column and its stored values —
                dropping the key from the Zod input is what stops an update
                writing NULL over them.

                `data.uoms` is still fetched and still read: the Coordinate
                picker's garment quick-create sheet asks for a UOM. */}
            {/* COUNTRY withdrawn 2026-08-11 (client). It left in ONE PIECE, and
                that is the point: the field, its `sectionValidity` entry, its
                `HeaderForm` key and its `garmentStyleInput` key all went
                together. Dropping only the control would have left a `required`
                validity entry no field can ever satisfy — a permanently dead
                Save with nothing on screen to explain it, which is exactly what
                the comment above that list warns about and names Country as the
                proof of. Leaving the Zod key would have been the other half of
                the same mistake: `headerOnly()` writes the parsed object, so
                every update would blank the stored country.
                `garment_styles.country_id` keeps its column and its values. */}
            {/* Department · Contact · Customer Reference · Received Date ·
                Receipt Mode · Tech pack all withdrawn 2026-08-10 (client). Their
                columns and stored values remain; they left the Zod input too,
                which is what stops an update writing NULL over them. */}
          </DetailSection>
          {/**
            * COORDINATES — the third of the three merged views, and the one that
            * gains most from the merge: the Piece/Set answer that CAPS this grid
            * is now four fields above it instead of a rail click away, so the
            * hint and the field it talks about are on screen together.
            *
            * `cols={12}` AND THE GRID SHARES ITS ROW WITH DESCRIPTION (client
            * 2026-08-11, asked twice). The grid is `narrow` and single-column
            * since M.List No was withdrawn, so it left a band of empty section
            * beside it while Description sat alone on a full-width row above.
            *
            * A `ChildGrid` is not a `<Field>` and has no span of its own — the
            * sanctioned way to give it one is an UNLABELLED `<Field size>`
            * around it, which is exactly what Material ▸ Fabric ▸ Composition
            * does for its mixing grid (`material-master-screen.tsx`, LAYOUT.md
            * §3 "a not-field that SHARES its row").
            *
            * 6 + 6, not 8 + 4: `xl` exists because `lg` squeezed Composition's
            * grid, which holds a Yarn picker. This one holds a single Coordinate
            * cell, so `lg` is ample and Description gets ~566px of prose rather
            * than ~280px.
            *
            * THE ROW MUST SUM TO 12, AND THIS IS NOT THEORETICAL — it broke here
            * once. A bare `<p>` hint sat in this section as a direct child; with
            * no span it took ONE column, so the text squashed into ~90px and
            * wrapped over three lines, and the row totalled 1 + 6 + 6 = 13,
            * which pushed Description onto a line of its own — exactly the
            * arrangement the change was meant to remove. At 13+ the last field
            * does not shrink, it wraps. ANY non-`<Field>` child added here costs
            * a column; wrap it in a sized `<Field>` or keep the row at two.
            */}
          {/* `frameless` — TWO FRAMES OTHERWISE (client 2026-08-19: the
              Coordinates table "have two frames"). The note below records
              `ChildGrid frameless` cutting a THREE-frame stack down on
              2026-08-17; it cut it to two, not to one, because the grid's TABLE
              wrapper draws a `rounded-lg border` that is not optional and never
              was reached by that prop.

              So the pair is deliberate and both halves are needed: the grid
              suppresses `GRID_FRAME`, this suppresses the section's card, and
              the table's own border is the single frame that survives. The
              label still renders, unboxed, above it.

              Which of the two borders survives was the operator's call —
              a bordered table under a plain label, rather than a bordered card
              around a borderless table. */}
          <DetailSection label="Coordinates" cols={12} frameless>
            {/* `hideAdd` is `ChildGrid`'s existing cap ("Single Yarn fabric =
                exactly one component"), and it does two things at once: it
                removes the button AND makes Enter on the last row DECLINE rather
                than grow the grid, so the keyboard cannot get past the limit
                either. */}
            {/* `narrow` because this became a one-column grid when M.List No was
                withdrawn, and a lone Coordinate picker has no business spanning
                the section. It USED TO SAY "for the same reason as Sizes"; Sizes
                dropped `narrow` on 2026-08-17 when it went `inlineCards`, so the
                two are no longer the same shape.

                THIS GRID IS STILL A TABLE, AND THAT IS THE SAME COUPLING SIZES
                FELL DOWN — `narrow` shows the table from `@md` (448px of the
                grid's own inline size), and an `lg` cell is ~690px at 1920 but
                ~520px on a 1366 laptop and less again in a narrow window. It has
                the headroom Sizes did not, so it is left alone rather than
                converted unasked; if this one ever reports as stacked cards, the
                fix is the one below, not more width. */}
            {/* `frameless` — THREE NESTED FRAMES OTHERWISE (client 2026-08-17,
                screenshot 2326: "three layered table lined layout"). This grid
                sits INSIDE a `DetailSection`, so the section drew a bordered
                card, `ChildGrid` drew a second one inside it, and the table drew
                its own border inside that. Its own note is exactly this case:
                "drop the outer bordered card so the grid can nest INSIDE a
                DetailSection without a double border".

                Sizes below already carries it; Components does not need it
                because it sits straight in the `SectionBody` with no section
                card around it. Coordinates was the one that never got it. */}
            <Field size="lg">
              <ChildGrid<CoordRow>
                narrow
                columns={coordColumns}
                rows={coords}
                hideAdd={!!coordCap && coords.length >= coordCap.max}
                seedRow
                onAdd={() => mutCoords((xs) => [...xs, blankCoord()])}
                onRemove={(r) => mutCoords((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add coordinate"
              />
            </Field>
            {/* DESCRIPTION LEFT THIS SECTION FOR SIZES (client 2026-08-14) — see
                the note at its new home at the end of the Sizes section.

                The grid keeps its `lg` span rather than growing to fill the row.
                It is `narrow` and single-column, so a wider span would reserve
                section width it does not draw in; what is left beside it is the
                same empty band this section had before Description arrived on
                2026-08-11, which is a cosmetic state and not the rule breach the
                textarea's presence was. */}
          </DetailSection>
        </SectionBody>
      ),
    },
    /**
     * COMPONENTS STAYED ITS OWN SECTION THROUGH THE 2026-08-11 MERGE, and that
     * is a decision rather than an omission.
     *
     * The client asked to merge General, Coordinates and Style Details, and the
     * section above IS those three. Components was not in the ask, and folding
     * it in anyway would have made the merge worse on its own terms: it is a
     * five-column grid that is paged through row by row, so sharing a scroll
     * with thirteen header fields would push its grid below a screen of form on
     * every single visit. It also reads FROM Coordinates, and a downstream grid
     * is easier to check against its source when the source is one rail click
     * away than when both are somewhere in a long scroll.
     *
     * That is LAYOUT.md §4's argument applied rather than merging for its own
     * sake — the cap on a group exists because a long section is hard to work
     * in, which is the same complaint the merge was answering.
     */
    /**
     * COMPONENTS AND SIZES ARE ONE SECTION (client 2026-08-18: "merge both
     * components and size section as single section... that merged section as
     * splited section left side components and right side").
     *
     * They are two answers about the same garment — what it is made of, and
     * what it is made in — and paging between them to finish one style read as
     * two screens, which is the same argument that merged Style Details /
     * General / Coordinates on 2026-08-11.
     *
     * SPLIT 6/6 — EVEN (client 2026-08-18: "that splitted panel size not equal,
     * the component section huge space, make it even spacing").
     *
     * IT SHIPPED AS 8/4 FIRST, and the reasoning was wrong in a way worth
     * recording, because it will look right again to the next reader. The
     * argument was that the Components grid had been made `narrow` on 2026-08-17
     * and reverted the SAME DAY ("restore the component section, it's too
     * narrow"), so an even split would hand that complaint straight back.
     *
     * THOSE ARE NOT THE SAME MEASUREMENT. `narrow` is a 32rem (~512px) CAP on the
     * whole table; a 6-column span is a FRACTION of the section, which on this
     * screen draws ~776px. So 6/6 is half again wider than the width that was
     * rejected, and citing 08-17 against it is comparing a cap to a fraction.
     *
     * What 8 columns actually produced was ~1035px of table holding three short
     * pickers and a ✕ — the trailing gap after Structure was the biggest empty
     * area in the section, which is the complaint above. Column COUNT is still
     * not what decides this (that part of the 08-17 note stands); what decides it
     * is that these three cells do not fill 1035px.
     *
     * The row still sums to 12, which is the standing rule — a non-`<Field>`
     * child dropped into this row costs a column and wraps the last one.
     */
    {
      key: "components",
      label: "Components & Sizes",
      icon: Boxes,
      done:
        comps.some((c) => c.coordinate_id || c.component_id || c.fabric_category_id) ||
        sizes.some((s) => s.size_id),
      content: (
        <SectionBody title="Components & Sizes">
          {/* A STATE MESSAGE, not a description — it says why the Coordinate
              picker in the grid below has nothing to offer, which is not
              derivable from looking at it. The only section line that survived
              the 2026-08-17 sweep, and it survived by being conditional. */}
          {coordinateIds.size === 0 && (
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              Add coordinates first — a component is a part of one of them.
            </p>
          )}
          <FieldGrid>
            {/* A `ChildGrid` is not a `<Field>` and has no span of its own, so an
                UNLABELLED `<Field size>` around it is the sanctioned way to give
                it one (LAYOUT.md §3, "a not-field that SHARES its row"). No
                `label`: the grid draws its own column header band at `Label`'s
                metrics, so reserving a second line would push it below the
                control beside it.

                NOT `narrow` — tried 2026-08-17 and reverted the same day. Column
                COUNT is not what `narrow` should be judged on; the length of what
                the columns carry is, and these carry master names. */}
            <Field label="" size="lg">
              <ChildGrid<CompRow>
                columns={compColumns}
                rows={comps}
                seedRow
                onAdd={() => mutComps((xs) => [...xs, blankComp()])}
                onRemove={(r) => mutComps((xs) => xs.filter((x) => x.key !== r.key))}
                addLabel="+ Add component"
              />
            </Field>

            {/* SIZES ARE CHOSEN, NOT ENTERED (client 2026-08-18: "just show the
                dropdown they will choose it, horizontal line").

                This replaces a one-column `ChildGrid` where each size was a row
                with its own picker and its own "+ Add size". Ticking the range in
                one opening is how a style's sizes are actually decided — all at
                once, not one at a time — and the chips beneath the control are
                the horizontal line that was asked for.

                PICK-ONCE COMES FREE NOW. The old grid allowed L, L, M, M until
                2026-08-17 (screenshot 2316) and needed `usedIds` to stop it; a
                set cannot hold a duplicate, so the shape rules it out rather than
                a prop. `normalizeSizes` still de-dupes server-side, which is the
                guard that matters for imports.

                ORDER IS THE ORDER THEY WERE TICKED, and that is worth knowing: it
                is not sorted S/M/L/XL, because the size master carries no ordinal
                and inventing one from the name fails on numeric ranges (28, 30,
                32) and on anything but English letters. The stored `sno` follows
                this order, which is what the read side sorts on. */}
            <Field label="" size="lg">
              <MultiSelect
                label="Sizes"
                /* THE CELL IS 6 COLUMNS, THE CONTROL IS NOT (client 2026-08-18:
                   "that size dropdown field size needs an update, it's too
                   length").

                   The even 6/6 split above is what the client asked for and is
                   about the two PANELS, not about this box. Left at the cell's
                   full width the dropdown drew ~776px to hold "S" and "XL",
                   which is the same not-filling-its-width complaint that took
                   the Components grid from 8 columns to 6 — one level further
                   in.

                   ~280px is LAYOUT.md §3's one field width, the same figure
                   every `<Field>` span resolves to. It is written here rather
                   than taken from a token because none exists: width is normally
                   a property of the SPAN, and this is the case where the cell and
                   the control genuinely want different numbers.

                   THE CHIPS ARE NOT CAPPED, deliberately — they are the value,
                   and a wrapping line of them is exactly what the extra width is
                   good for. */
                triggerClassName="max-w-[280px]"
                /* THE LIST IS NOT THE TRIGGER (client screenshot 2392,
                   2026-08-19: "we need a lot of sizes, it will take too much
                   scrolling").

                   The 280px above is the TRIGGER's width and the client asked
                   for it — but the panel was `w-full` of the same wrapper, so
                   one number was answering two questions and the list inherited
                   a cap chosen for a box that shows "8 selected". At 280px a
                   list can only ever be one column, which is ~250px of dropdown
                   spent rendering "XL" and eight rows visible at a time.

                   40rem, RAISED FROM 34 (client 2026-08-20, on being shown the
                   density figures). At 34rem the grid drew 7-10 sizes a line;
                   40rem takes it to 9-13, which is the whole size range of a
                   style visible without scrolling at all.

                   It is capped against the viewport by the primitive
                   (`max-w-[calc(100vw-2rem)]`), so this cannot push the page
                   sideways on a small screen — it overlays, the way a popup
                   should, rather than widening the layout under it. */
                panelClassName="w-[40rem]"
                /* Sizes are 2-5 characters, which is the whole case for the
                   wrapping tick grid: ~40 visible at once instead of 8, and
                   ↑/↓ move a row while ←/→ move a cell. */
                gridded
                /* BANDS, DERIVED FROM THE NAMES (client 2026-08-19: "minimum 50
                   size will user add like yr, m, xs").

                   At fifty-plus sizes one label stops meaning one thing — `M` is
                   Medium AND `3M` is three months — and a flat list has nothing
                   to tell them apart however well it is sorted.

                   Derived rather than read from Size Groups because there is ONE
                   size group in this database: shipping only the declared
                   version would ship a grouping feature that groups nothing
                   until someone spends a day on data entry. The family is
                   already in the name, so this works on day one. A declared
                   group, when there is one, overrides it — see the header of
                   `size-order.ts` for the case derivation genuinely cannot
                   cover. */
                groupBy={(o) => sizeFamily(o.label)}
                /* FRAMED, to match the Components table across the row (client
                   2026-08-18: "add one table frame for this size, because it
                   looks floating now").

                   NOT a new box for its own sake — the same frame the grid
                   beside it draws, imported from `GRID_FRAME` so the two cannot
                   drift. The fault it fixes is asymmetry: a bordered table on the
                   left and a bare label-and-input on the right reads as something
                   that failed to render, not as a deliberate difference.

                   This does NOT reopen the over-framing the client cut back on
                   2026-08-18 in Structure Details ("too much frames"). That was a
                   THIRD border nested inside an already-bordered card; this is
                   the first border on a panel that had none, and it leaves the
                   section at one frame per half. */
                options={sizeOpts.map((o) => ({
                  id: o.id,
                  label: o.name,
                  inactive: isInactive(o),
                }))}
                values={sizes.map((x) => x.size_id).filter(Boolean) as string[]}
                /* Rows are REUSED where the id survives, never rebuilt wholesale:
                   a fresh `key` on every tick would remount the row and throw
                   away anything the row is carrying. */
                onChange={(next) =>
                  mutSizes((xs) => {
                    const held = new Map(
                      xs.filter((x) => x.size_id).map((x) => [x.size_id as string, x]),
                    );
                    return next.map((sid) => held.get(sid) ?? { key: newKey(), size_id: sid });
                  })
                }
                /* No `placeholder` — "Choose sizes…" restated the label directly
                   above it. The primitive now defaults to blank, so this is the
                   rule being inherited rather than opted out of. */
                /* grid-caption: exempt -- placeholder-blank: exempt -- this one
                   names a CAUSE ELSEWHERE, which is the stated survivor of both
                   rules (the screen-layout skill quotes this very string). An
                   operator facing an empty list otherwise cannot tell a broken
                   dropdown from a Sizes master nobody has filled in yet, and the
                   fix is on a different screen. */
                emptyLabel="No sizes in the Sizes master yet"
                /**
                 * A SIZE TYPED HERE IS STORED IN THE SIZES MASTER (client
                 * 2026-08-18), not kept as loose text on this style.
                 *
                 * That is the standing icon-field rule rather than a convenience:
                 * a field over stored data offers create, so the operator never
                 * has to leave the style to add a size — but what they add is a
                 * real master row, reusable by the next style and resolvable by
                 * everything downstream that reads `size_id`. A free-text size
                 * would be a value no picker could ever offer again.
                 *
                 * `createLookupValue` is the shared door: it checks
                 * `masters:create` server-side (the gate below only hides the
                 * affordance) and parses through the Lookup master's own Zod
                 * schema, so `capsName()` applies and "xxl" is stored as "XXL".
                 * Hence the label comes back from the transform, not from what
                 * was typed.
                 *
                 * `size` is neither a CLOSED_LOOKUP_KIND nor a
                 * NO_INLINE_CREATE_KIND (`extras-types.ts`), so extending it on
                 * the fly is sanctioned — unlike Item Class or Fabric Structure,
                 * whose vocabularies are code-keyed and fixed.
                 */
                onCreate={
                  masterPerms.canCreate
                    ? async (name) => {
                        const res = await createLookupValue("size", name, null);
                        return res.ok
                          ? { id: res.id, label: capsName().parse(name) }
                          : { error: res.error };
                      }
                    : undefined
                }
              />
            </Field>

            {/* LAST IN THE SECTION. It is free prose about the whole style, so it
                has no business between the grid and the sizes.

                `lg` (6), NOT `full` (client 2026-08-18: "reduce that description
                box length, now it's too big"). At full width it drew a 12-column
                empty rectangle under a split section — the biggest thing on the
                screen was the box with nothing in it.

                IT TRACKS THE LEFT COLUMN rather than being sized on its own, which
                is why it moved 8 → 6 with the grid above it in the same change.
                The section reads as two columns — left is what the garment is made
                of and prose about it, right is what it is made in — and a
                Description that did not line up under the grid would break that
                reading the moment either width changed.

                `rows={2}`: a style description is a line or two, and the third
                row was most of what made it read as oversized. It still grows
                with the browser's own textarea handle. */}
            <Field label="Description" size="lg" htmlFor="st-desc">
              <Textarea
                id="st-desc"
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                rows={2}
              />
            </Field>
          </FieldGrid>
        </SectionBody>
      ),
    },
  ];

  return (
    // `flex h-full flex-col` is what a page-mounted MasterFullScreen requires:
    // it takes `flex-1 min-h-0` and needs a definite height to divide. `h-full`
    // resolves against `<main className="flex-1 overflow-y-auto">` in
    // app/(app)/layout.tsx, which is a flex item of a `h-screen` column. Leave
    // this as `space-y-4` and the editor sizes to its content instead, stranding
    // the footer above a strip of empty page.
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title={editId ? "Edit Style" : "New Style"}
        description="Wire each ⓘ field from stored data. Blank grid rows are ignored."
        /* THE EDITOR BRANCH ONLY. This screen swaps a list and an editor at one
           URL, and the editor already carries its own "← Back to list" in
           `actions` below — the derived link would be a second Back on the same
           row, aimed at the module hub rather than at the list the operator came
           from. The LIST branch above keeps the default, which is exactly the
           case `back` was added for (`page-header.tsx`). */
        back={false}
        actions={
          <Button variant="outline" size="md" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* The five sections replace a flat stack of Cards: two field grids, three
          grid cards and a lone Description card, all stretched full width with
          nothing naming where the operator was. `mount="page"` is what lets a
          route use this shell without the overlay swallowing the sidebar — and
          its content pane carries `data-focus-scope`, which is what takes this
          screen off the `--check tab-page-form` list ("page-level editor with no
          data-focus-scope; Tab keeps native order here, so it leaves the form"). */}
      <MasterFullScreen
        ref={shellRef}
        mount="page"
        open
        // No `header`: the PageHeader above already names the record, and two
        // title bands stacked is the same record announced twice.
        onClose={() => setMode("list")}
        modeLabel={null}
        dirty={dirty}
        sections={sections}
        /**
         * The footer follows the Associates / Materials masters exactly —
         * `customer-master-screen.tsx:1642` is the reference. Two things this
         * screen did not have:
         *
         *   `status`    — the left-hand line. Silent before, so a form with
         *                 unsaved edits looked identical to a saved one.
         *   `saveLabel` — names the entity ("Save style", as Customer says
         *                 "Save customer" and Applicant "Save applicant"),
         *                 rather than a bare "Save" that could be any record on
         *                 any screen.
         *
         * `draftLabel` is left off because "Save as Draft" is already the
         * component's default, which is the same string those masters pass.
         */
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New style",
          onCancel: () => setMode("list"),
          onSave: () => submit(false),
          onBlockedSave: revealFirstProblem,
          saveLabel: "Save style",
          canSave,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />

    </div>
  );
}
