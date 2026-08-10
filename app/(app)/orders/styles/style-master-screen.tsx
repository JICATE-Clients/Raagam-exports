"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shirt, SlidersHorizontal, Palette, Boxes, Ruler, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGrid } from "@/components/ui/field";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate } from "@/lib/format";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { CountryPicker } from "@/components/masters/country-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createGarmentStyle,
  updateGarmentStyle,
  deleteGarmentStyle,
  previewStyleCode,
} from "@/lib/orders/styles/actions";
import {
  SEASON_OPTIONS,
  COMPONENT_TYPE_OPTIONS,
  styleStatusTone,
  styleStatusText,
  type GarmentStyle,
} from "@/lib/orders/styles/types";
import {
  UNIT_KIND_OPTIONS,
  coordinateLimit,
  isUnitKind,
  styleCoordinateIds,
  styleProblems,
} from "@/lib/orders/styles/rules";
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
type CoordRow = { key: string; coordinate_id: string | null; mlist_no: string };
/** One process on a component — the nested grid's row. */
type CompProcRow = { key: string; process_id: string | null };
type CompRow = {
  key: string;
  coordinate_id: string | null;
  component_id: string | null;
  structure_id: string | null;
  comp_type: string;
  /** The fabric: an `items` row of class FABRIC. */
  item_id: string | null;
  processes: CompProcRow[];
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
  unit_id: string | null;
  /** "" until answered — Piece or Set. Drives the Coordinates count. */
  unit_kind: string;
  /** The group last used to fill the sizes. Provenance, not authority. */
  size_group_id: string | null;
  country_id: string | null;
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
  unit_id: null,
  unit_kind: "",
  size_group_id: null,
  country_id: null,
  description: "",
};

const today = () => new Date().toISOString().slice(0, 10);

export function StyleMasterScreen({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);

  /**
   * The record's serial (STL-2627-81), for the read-only field on General.
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
  /** Structure needed no FK change — 'fabric_structure' rows ARE config_lookups.
   *  Only the kind moved, which is why there is no third repoint in 0396. */
  const structureOpts = fabricStructureOpts;
  const sizeOpts = useMemo(() => lookups.filter((l) => l.kind === "size"), [lookups]);

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

  // ---- size group fill ------------------------------------------------------

  const sizeGroupItems = useMemo(
    () =>
      data.sizeGroups.map((g) => ({
        id: g.id,
        code: g.size_group_no,
        name: g.size_group_name ?? g.size_group_no ?? "(unnamed group)",
        inactive: g.inactive,
      })),
    [data.sizeGroups],
  );

  /** Size NAME → the `config_lookups` row that holds it. The group stores names
   *  as text; the style stores FK ids, so the fill has to bridge the two. */
  const sizeIdByName = useMemo(
    () => new Map(sizeOpts.map((o) => [o.name.trim().toUpperCase(), o.id])),
    [sizeOpts],
  );

  const groupSizeNames = useMemo(() => {
    const g = data.sizeGroups.find((x) => x.id === form.size_group_id);
    return [...(g?.sizes ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((s) => s.size_name)
      .filter((n) => !!n?.trim());
  }, [data.sizeGroups, form.size_group_id]);

  const fillableSizes = groupSizeNames;
  const unmatchedSizes = useMemo(
    () => groupSizeNames.filter((n) => !sizeIdByName.has(n.trim().toUpperCase())),
    [groupSizeNames, sizeIdByName],
  );

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
    sections: [
      { key: "style" },
      { key: "general" },
      { key: "coordinates" },
      { key: "components" },
      { key: "sizes" },
    ],
    values: form,
    fields: [
      { section: "style", id: "st-name", label: "Style", required: true, empty: (f) => !f.style_name.trim() },
      { section: "style", id: "st-date", label: "Date", required: true, empty: (f) => !f.style_date },
      { section: "general", id: "st-unitkind", label: "Unit Type", required: true, empty: (f) => !f.unit_kind },
    ],
    extra: styleProblems({
      style_name: form.style_name,
      style_date: form.style_date,
      unit_kind: form.unit_kind,
      coordinates: coords,
      // Without this the orphan rule is silent on the screen while STILL firing
      // in `garmentStyleInput`'s superRefine — Save would be enabled, the action
      // would refuse, and the rail would show nothing. A rule enforced in one
      // half of the pair is worse than one enforced in neither.
      components: comps,
    }).map<Problem>((p) => ({
      section: p.section,
      // Was hard-coded "Coordinates", which was true while coordinates were the
      // only cross-tab rule. The label names the section the problem belongs to,
      // so it has to be derived from it.
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

  const blankCoord = (): CoordRow => ({ key: newKey(), coordinate_id: null, mlist_no: "" });
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
    structure_id: null,
    comp_type: "",
    item_id: null,
    processes: [],
  });
  const blankSize = (): SizeRow => ({ key: newKey(), size_id: null });

  function openAdd() {
    setEditId(null);
    setForm({ ...BLANK, style_date: today() });
    setCoords([blankCoord()]);
    setComps([blankComp()]);
    setSizes([blankSize()]);
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
      season: r.season ?? "",
      style_year: r.style_year != null ? String(r.style_year) : "",
      article_no: r.article_no ?? "",
      style_category_id: r.style_category_id,
      style_description: r.style_description ?? "",
      unit_id: r.unit_id,
      // "" on every style created before 0392. The field is `required`, so the
      // operator answers it before this record can be saved again.
      unit_kind: r.unit_kind ?? "",
      size_group_id: r.size_group_id,
      country_id: r.country_id,
      description: r.description ?? "",
    });
    setCoords(
      r.coordinates.map((c) => ({
        key: newKey(),
        coordinate_id: c.coordinate_id,
        mlist_no: c.mlist_no ?? "",
      })),
    );
    setComps(
      r.components.map((c) => ({
        key: newKey(),
        coordinate_id: c.coordinate_id,
        component_id: c.component_id,
        structure_id: c.structure_id,
        comp_type: c.comp_type ?? "",
        item_id: c.item_id,
        processes: (c.processes ?? []).map((p) => ({
          key: newKey(),
          process_id: p.process_id,
        })),
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
      unit_id: form.unit_id,
      unit_kind: isUnitKind(form.unit_kind) ? form.unit_kind : null,
      size_group_id: form.size_group_id,
      country_id: form.country_id,
      description: form.description || null,
      is_draft: asDraft,
      coordinates: coords.map((c) => ({
        sno: 0,
        coordinate_id: c.coordinate_id,
        mlist_no: c.mlist_no || null,
      })),
      components: comps.map((c) => ({
        sno: 0,
        coordinate_id: c.coordinate_id,
        component_id: c.component_id,
        structure_id: c.structure_id,
        comp_type: c.comp_type || null,
        item_id: c.item_id,
        processes: c.processes.map((p) => ({ sno: 0, process_id: p.process_id })),
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
        cell: (r) => <span className="text-sm text-muted-foreground">{r.season ?? "—"}</span>,
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
    {
      header: "M.List No",
      width: "12rem",
      cell: (r) => (
        <Input
          value={r.mlist_no}
          onChange={(e) =>
            mutCoords((xs) => xs.map((x) => (x.key === r.key ? { ...x, mlist_no: e.target.value } : x)))
          }
          className="h-8"
        />
      ),
    },
  ];

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
          canCreate={false} canEdit={false} compact
        />
      ),
    },
    {
      header: "Component",
      cell: (r) => (
        <RecordPicker
          label="Component"
          // The `components` master (0228), not the empty 'style_component'
          // lookup kind this used to read (0396).
          items={componentOpts}
          value={r.component_id}
          onChange={(id) => mutComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, component_id: id } : x)))}
          compact
        />
      ),
    },
    {
      header: "Structure",
      cell: (r) => (
        <LookupDialogPicker
          kind="fabric_structure" label="Structure" options={structureOpts}
          value={r.structure_id}
          onChange={(id) => mutComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, structure_id: id } : x)))}
          canCreate={masterPerms.canCreate} canEdit={masterPerms.canEdit} compact
        />
      ),
    },
    {
      header: "Type",
      width: "9rem",
      cell: (r) => (
        <Select
          value={r.comp_type}
          onChange={(e) => mutComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, comp_type: e.target.value } : x)))}
          className="h-8"
        >
          <option value="">—</option>
          {COMPONENT_TYPE_OPTIONS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </Select>
      ),
    },
    {
      /**
       * THE FABRIC. There is no fabric master — a fabric is an `items` row of
       * item class FABRIC, so this is `ItemPicker` over a list the SERVICE has
       * already scoped (`getFabricRows`). The narrowing lives there rather than
       * here because `ItemPicker` has no class filter of its own and the
       * cascading-picker rule puts it at the layer that knows the class.
       *
       * `quickCreateClassId` is deliberately NOT passed: a fabric carries
       * structure, type, composition and UOM rules, so one born from a name-only
       * quick-create inside a grid cell would be incomplete. Fabrics are created
       * on the Material master.
       */
      header: "Fabric",
      cell: (r) => (
        <ItemPicker
          label="Fabric"
          items={data.fabrics}
          value={r.item_id ?? ""}
          onChange={(v) => mutComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, item_id: v || null } : x)))}
          compact
        />
      ),
    },
  ];

  /**
   * A component's processes — printing, embroidery, and anything else the
   * `processes` master flags `for_components`.
   *
   * A NESTED grid, because one part can need both printing and embroidery, so
   * this is a list per row rather than a column on it. `lib/focus.ts` already
   * treats a row's nested grid as part of the row: Tab walks into it
   * (`tabFieldsIn`), an empty one opens its first row (`enterNestedGrid`), and
   * ↑/↓ hand off across the boundary (`fromChildGrid`).
   */
  const procColumns: ChildGridColumn<CompProcRow>[] = [
    {
      header: "Process",
      cell: (p) => (
        <RecordPicker
          label="Process"
          compact
          items={data.processes}
          value={p.process_id}
          onChange={(id) =>
            mutComps((xs) =>
              xs.map((x) => ({
                ...x,
                processes: x.processes.map((q) => (q.key === p.key ? { ...q, process_id: id } : q)),
              })),
            )
          }
        />
      ),
    },
  ];

  const sizeColumns: ChildGridColumn<SizeRow>[] = [
    {
      header: "Size",
      cell: (r) => (
        <LookupDialogPicker
          kind="size" label="Size" options={sizeOpts}
          value={r.size_id}
          onChange={(id) => mutSizes((xs) => xs.map((x) => (x.key === r.key ? { ...x, size_id: id } : x)))}
          canCreate={masterPerms.canCreate} canEdit={masterPerms.canEdit} compact
        />
      ),
    },
  ];

  // ---- the cross-tab rule ---------------------------------------------------

  /** Piece → exactly 1 coordinate, Set → 2–6, null → no rule yet (legacy rows). */
  const coordCap = coordinateLimit(form.unit_kind);

  const coordHint = coordCap
    ? coordCap.min === coordCap.max
      ? `A Piece style has exactly ${coordCap.max} coordinate.`
      : `A Set style has ${coordCap.min} to ${coordCap.max} coordinates.`
    : "Pick a Unit Type on General to set how many coordinates this style may have.";

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

  const sections: FullScreenSection[] = [
    {
      key: "style",
      label: "Style",
      icon: Shirt,
      done: !!form.style_name.trim(),
      problems: validity.bySection.style,
      content: (
        <SectionBody title="Style" hint="What this style is, and who it is for.">
          <FieldGrid>
            {/**
              * THE SERIAL — STL-<fy><fy+1>-<n>, e.g. STL-2627-81.
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
            <Field label="Serial No" size="sm" htmlFor="st-code">
              <Input
                id="st-code"
                readOnly
                value={editingCode ?? previewCode ?? ""}
                placeholder="(auto)"
              />
            </Field>
            <Field label="Style" required size="sm" htmlFor="st-name">
              <Input
                id="st-name"
                value={form.style_name}
                onChange={(e) => set({ style_name: e.target.value })}
                placeholder="Style name"
              />
            </Field>
            <Field label="Date" required size="sm" htmlFor="st-date">
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
            <Field label="Customer" size="sm">
              <CustomerPicker
                customers={data.customers}
                value={form.customer_id}
                onChange={(id) => set({ customer_id: id })}
                label="Customer"
                compact
              />
            </Field>
            <Field label="Approved Sample No" size="sm">
              <RecordPicker
                label="Approved Sample No"
                compact
                items={data.samples}
                value={form.approved_sample_id}
                onChange={(id) => set({ approved_sample_id: id })}
              />
            </Field>
            {/* The tick's word moves up into the field label and the cell gets
                `min-h-9 items-center`, so it centres on the same 36px control
                height as the Select beside it. */}
            <Field label="Blocked" size="sm" htmlFor="st-blocked">
              <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
                <input
                  id="st-blocked"
                  type="checkbox"
                  checked={form.blocked}
                  onChange={(e) => set({ blocked: e.target.checked })}
                  className="h-4 w-4 cursor-pointer accent-primary"
                />
                <span className="text-sm text-foreground">Yes</span>
              </label>
            </Field>
          </FieldGrid>
        </SectionBody>
      ),
    },
    {
      key: "general",
      label: "General",
      icon: SlidersHorizontal,
      done:
        !!form.season ||
        !!form.style_category_id ||
        !!form.article_no.trim() ||
        !!form.unit_id ||
        !!form.unit_kind,
      problems: validity.bySection.general,
      content: (
        <SectionBody title="General" hint="Season, category and how this style is counted.">
          <FieldGrid>
            <Field label="Season" size="sm" htmlFor="st-season">
              <Select id="st-season" value={form.season} onChange={(e) => set({ season: e.target.value })}>
                <option value="">—</option>
                {SEASON_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </Field>
            <Field label="Year" size="sm" htmlFor="st-year">
              <Input
                id="st-year"
                type="number"
                value={form.style_year}
                onChange={(e) => set({ style_year: e.target.value })}
                placeholder="e.g. 2026"
              />
            </Field>
            <Field label="Article No." size="sm" htmlFor="st-article">
              <Input id="st-article" value={form.article_no} onChange={(e) => set({ article_no: e.target.value })} />
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
            <Field label="Style Category" size="sm">
              <CategoryPicker
                label="Style Category"
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
              * UNIT TYPE — its own field, and the one the Coordinates rule reads.
              *
              * Deliberately NOT inferred from the Unit picker beside it. That
              * picker is the Stock Unit master, which is seeded lowercase
              * (nos, mtr, kg, set…), has no PIECE row at all, and whose codes an
              * operator can rename from the Stock Unit screen — so a rule read
              * off it would break silently the day someone tidied that master.
              *
              * `required`, which means an existing style (all of which predate
              * this field) must answer before it can be saved again. That is
              * deliberate backfill, not an oversight.
              */}
            <Field label="Unit Type" required size="sm" htmlFor="st-unitkind">
              <Select
                id="st-unitkind"
                value={form.unit_kind}
                onChange={(e) => setUnitKind(e.target.value)}
              >
                <option value="">—</option>
                {UNIT_KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Unit" size="sm">
              <RecordPicker
                label="Unit"
                compact
                items={data.uoms}
                value={form.unit_id}
                onChange={(id) => set({ unit_id: id })}
              />
            </Field>
            <Field label="Style Description" size="lg" htmlFor="st-styledesc">
              <Input
                id="st-styledesc"
                value={form.style_description}
                onChange={(e) => set({ style_description: e.target.value })}
              />
            </Field>
            <Field label="Country" size="sm">
              <CountryPicker
                countries={data.countries}
                value={form.country_id}
                onChange={(id) => set({ country_id: id })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
                compact
              />
            </Field>
            {/* Department · Contact · Customer Reference · Received Date ·
                Receipt Mode · Tech pack all withdrawn 2026-08-10 (client). Their
                columns and stored values remain; they left the Zod input too,
                which is what stops an update writing NULL over them. */}
            {/* Free text, so CAPS-exempt by construction — a Textarea is listed
                among the CAPITALS exemptions. `full` because a 3-row box beside a
                one-line field leaves the row ragged. */}
            <Field label="Description" size="full" htmlFor="st-desc">
              <Textarea
                id="st-desc"
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                rows={3}
              />
            </Field>
          </FieldGrid>
        </SectionBody>
      ),
    },
    {
      key: "coordinates",
      label: "Coordinates",
      icon: Palette,
      done: coords.some((c) => c.coordinate_id || c.mlist_no.trim()),
      problems: validity.bySection.coordinates,
      content: (
        <SectionBody title="Coordinates" hint={coordHint}>
          {/* No `label` — the section heading above already names the grid, and a
              second caption costs it a band.

              `hideAdd` is `ChildGrid`'s existing cap ("Single Yarn fabric =
              exactly one component"), and it does two things at once: it removes
              the button AND makes Enter on the last row DECLINE rather than grow
              the grid, so the keyboard cannot get past the limit either. */}
          <ChildGrid<CoordRow>
            columns={coordColumns}
            rows={coords}
            hideAdd={!!coordCap && coords.length >= coordCap.max}
            onAdd={() => mutCoords((xs) => [...xs, blankCoord()])}
            onRemove={(r) => mutCoords((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add coordinate"
          />
        </SectionBody>
      ),
    },
    {
      key: "components",
      label: "Components",
      icon: Boxes,
      done: comps.some((c) => c.coordinate_id || c.component_id || c.structure_id),
      problems: validity.bySection.components,
      content: (
        <SectionBody
          title="Components"
          hint={
            coordinateIds.size === 0
              ? "Add coordinates first — a component is a part of one of them."
              : "What each coordinate is built from, its fabric, and any extra process it needs. Coordinate offers only the ones on the Coordinates tab."
          }
        >
          {/* CARDS, NOT A TABLE — because each component owns a LIST of
              processes, and a list cannot live in a table cell. This is the
              same shape Material Attributes uses for its values
              (`forceCards listRows frameless` + `renderMobileRow`), which is
              the one arrangement `lib/focus.ts` already understands as "a row
              with a nested grid": Tab walks into the panel (`tabFieldsIn`), an
              empty one opens its first row (`enterNestedGrid`), and ↑/↓ hand
              off across the boundary (`fromChildGrid`).

              `compColumns` is still declared and is not dead: it is the
              fallback if this grid is ever switched back to a table. */}
          <ChildGrid<CompRow>
            columns={compColumns}
            rows={comps}
            forceCards
            listRows
            frameless
            onAdd={() => mutComps((xs) => [...xs, blankComp()])}
            onRemove={(r) => mutComps((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add component"
            renderMobileRow={(c, i) => (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    #{i + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-row-remove
                    className="ml-auto shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => mutComps((xs) => xs.filter((x) => x.key !== c.key))}
                    aria-label="Remove component"
                  >
                    <X className="h-4 w-4 shrink-0" />
                  </Button>
                </div>
                <FieldGrid>
                  {compColumns.map((col) => (
                    <Field key={col.header} label={col.header} size="sm">
                      {col.cell(c, i)}
                    </Field>
                  ))}
                </FieldGrid>
                {/* The nested grid. `frameless` so it does not draw a second
                    border inside the component's own row. */}
                <ChildGrid<CompProcRow>
                  label="Processes"
                  columns={procColumns}
                  rows={c.processes}
                  frameless
                  onAdd={() =>
                    mutComps((xs) =>
                      xs.map((x) =>
                        x.key === c.key
                          ? { ...x, processes: [...x.processes, { key: newKey(), process_id: null }] }
                          : x,
                      ),
                    )
                  }
                  onRemove={(p) =>
                    mutComps((xs) =>
                      xs.map((x) =>
                        x.key === c.key
                          ? { ...x, processes: x.processes.filter((q) => q.key !== p.key) }
                          : x,
                      ),
                    )
                  }
                  addLabel="+ Add process"
                />
              </div>
            )}
          />
        </SectionBody>
      ),
    },
    {
      key: "sizes",
      label: "Sizes",
      icon: Ruler,
      done: sizes.some((s) => s.size_id),
      problems: validity.bySection.sizes,
      content: (
        <SectionBody title="Sizes" hint="The size set this style is made in.">
          {/* THE GROUP IS A SHORTCUT, NOT THE SOURCE OF TRUTH. Picking one
              REPLACES the rows below, which stay editable afterwards — add an
              XXL, drop the S. The style keeps its own size rows, so editing a
              group later cannot silently restate what a closed style was made
              in. `size_group_id` is stored only so reopening the record can say
              which group was used. */}
          <FieldGrid>
            <Field label="Size Group" size="sm">
              <RecordPicker
                label="Size Group"
                compact
                items={sizeGroupItems}
                value={form.size_group_id}
                onChange={(id) => set({ size_group_id: id })}
              />
            </Field>
            <Field label="" size="sm">
              <Button
                type="button"
                variant="outline"
                size="md"
                disabled={!fillableSizes.length}
                onClick={() =>
                  mutSizes(() =>
                    fillableSizes.map((name) => ({
                      key: newKey(),
                      size_id: sizeIdByName.get(name.trim().toUpperCase()) ?? null,
                    })),
                  )
                }
              >
                Fill sizes
              </Button>
            </Field>
          </FieldGrid>
          {unmatchedSizes.length > 0 && (
            /* Said plainly rather than filled with blanks: a group whose size
               names have no row in the Sizes list would otherwise produce empty
               picker cells with no explanation of why. */
            <p className="text-xs text-warning">
              {unmatchedSizes.length === 1
                ? `“${unmatchedSizes[0]}” is not in the Sizes list yet — add it with “+ Add” on a row.`
                : `${unmatchedSizes.length} of this group’s sizes are not in the Sizes list yet (${unmatchedSizes.join(", ")}) — add them with “+ Add” on a row.`}
            </p>
          )}
          <ChildGrid<SizeRow>
            columns={sizeColumns}
            rows={sizes}
            onAdd={() => mutSizes((xs) => [...xs, blankSize()])}
            onRemove={(r) => mutSizes((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add size"
          />
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
