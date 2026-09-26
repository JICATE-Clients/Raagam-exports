"use client";

/**
 * THE PATTERN MAKER'S SHEET (user 2026-09-25: "the pattern status form fields
 * … this for the pattern maker, he will update with this form"; 0638 + 0640).
 *
 *   header   PATTERN STATUS · DATE · BUYER · RE-NO / STYLE NAME · STYLE
 *   fabrics  FABRIC · GSM · TYPE of PARTS · COLOUR · TUBULAR & OPEN WIDTH ·
 *            SIZE WISE · REMARK, and under each, its SIZES —
 *            SIZE · TABLE DIA · AVG CAD PCS WEIGHT
 *
 * LAID OUT AS FABRIC BOM ▸ MANUAL IS (user 2026-09-26: rebuild the Pattern
 * Sheet as a copy of the Manual tab). Each line is a fabric CARD — a header
 * band over the line's own fields, and the sizes grid beneath — because the
 * two screens hold the same thing: which panels are cut from which cloth, and
 * what a piece weighs per size. The Manual tab fills itself from this sheet
 * ("Fill from Pattern Sheet"), so a pattern maker and a merchandiser reading
 * the same numbers in the same shape is the point.
 *
 * SIZE WISE (0647), Manual's toggle: off, one Table Dia and one weight answer
 * every size of the style; on, each size has its own row. A size left blank
 * under Size Wise was not measured and is not saved.
 *
 * TYPE OF PARTS PICKS SEVERAL (0643; client spec 2026-09-25, Task 2). FRONT
 * BODY, BACK and SLEEVE cut from the same jersey at the same weights are ONE
 * line. A line is one fabric, so once it holds a part only the parts cut from
 * that structure are offered. On Save, lines that match on every measured value
 * merge (`mergePatternLines`, in the action).
 *
 * TUBULAR / OPEN WIDTH FILLS ITSELF from the parts' Cut Method (Direct Shape →
 * Open Width, Bit Form Cutting → Tubular; a rib structure → Tubular) — client
 * spec 2026-09-25, Task 1. Still a choice: the pattern maker may correct it,
 * and parts that disagree fill nothing.
 *
 * The lines open SEEDED from the order — one per fabric the style's parts are
 * cut from (same structure, GSM and roll form), with the parts already ticked —
 * so the pattern maker types only what the pattern room measures. A line with
 * nothing typed is not saved (the seeded values are the order's, not the
 * operator's).
 *
 * One form, two frames (`CadFormFrame`): in place on Order Entry ▸ CAD, a sheet
 * wherever the CAD Queue opens it — the same rule as the other steps.
 */

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  ChildGrid,
  GRID_HEADER_TEXT,
  RowRemoveChip,
  type ChildGridColumn,
} from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { FIELD_WIDTH_CSS, Field, FieldRow, RequiredScope, fieldWidthStep } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import type { SheetOrigin } from "@/components/ui/sheet";
import { today as istToday } from "@/lib/calendar";
import { sortBySize } from "@/lib/masters/size-order";
import { savePatternSheet } from "@/lib/orders/cad-lifecycle/actions";
import {
  LAYOUT_TYPES,
  PATTERN_STATUSES,
  cutFor,
  cutKey,
  latestVersion,
  layoutForPart,
  mergePatternLines,
  type CadStyleRow,
  type ComponentCut,
  type LayoutType,
  type PatternPart,
  type PatternStatus,
  type StyleComponent,
} from "@/lib/orders/cad-lifecycle/types";
import { cn } from "@/lib/utils";
import { CadFormFrame } from "./cad-form-frame";

/** One size's figures, as typed text until Save. */
type SizeFigures = { table_dia: string; avg_pcs_weight_g: string };

/** A line as the form holds it — numbers as typed text until Save. */
type LineRow = {
  key: string;
  /** TYPE of PARTS — cutKeys of the parts, several since 0643; [] = none chosen. */
  parts: string[];
  fabric_category_id: string | null;
  fabric_name: string | null;
  gsm: string;
  /** COLOUR — several since 0644; [] = none chosen. */
  colours: string[];
  width_form: LayoutType | "";
  /** SIZE WISE (0647). Off: `table_dia` / `avg_pcs_weight_g` answer every
   *  size. On: `sizes` holds each size's own. */
  size_wise: boolean;
  table_dia: string;
  avg_pcs_weight_g: string;
  /** By size id — only the sizes something was typed for. */
  sizes: Record<string, SizeFigures>;
  remark: string;
};

/** A row of a card's sizes grid — DERIVED each render, never stored as such. */
type SizeRow = {
  key: string;
  /** null = the one "All sizes" row shown while Size Wise is off. */
  size_id: string | null;
  label: string;
  /** false = a size saved earlier that the style no longer states. */
  declared: boolean;
  figures: SizeFigures;
};

let seq = 0;
const newKey = () => `pl-${Date.now()}-${++seq}`;
const BLANK_FIGURES: SizeFigures = { table_dia: "", avg_pcs_weight_g: "" };

/** The first plain number in "160" / "160 / 180" — a single GSM seeds, two do not. */
const singleGsm = (g: string | null) => (g && !g.includes("/") ? g.trim() : "");

/**
 * THE ROLL FORM A PART IS CUT FROM, from its Cut Method on the Order Sheet
 * (client spec 2026-09-25, Task 1 — `layoutForPart`). "" when nothing says.
 */
const derivedForm = (cuts: readonly ComponentCut[], c: StyleComponent): LayoutType | "" =>
  layoutForPart(cutFor(cuts, c)?.method, c.structure) ?? "";

/** Several parts' form: the one they all say, or "" when they disagree or say nothing. */
const formOfParts = (cuts: readonly ComponentCut[], cs: readonly StyleComponent[]): LayoutType | "" => {
  const said = [...new Set(cs.map((c) => derivedForm(cuts, c)).filter(Boolean))];
  return said.length === 1 ? (said[0] as LayoutType) : "";
};

const blankLine = (): LineRow => ({
  key: newKey(),
  parts: [],
  fabric_category_id: null,
  fabric_name: null,
  gsm: "",
  colours: [],
  width_form: "",
  size_wise: false,
  table_dia: "",
  avg_pcs_weight_g: "",
  sizes: {},
  remark: "",
});

/**
 * A NEW SHEET'S LINES: the style's parts grouped by what they are cut from —
 * structure, GSM and roll form — one line per group with its parts ticked. The
 * body panels of one jersey arrive as one line and the rib neck as another,
 * which is the grouping the client's spec asks for, before anything is typed.
 */
function seedLines(components: readonly StyleComponent[], cuts: readonly ComponentCut[]): LineRow[] {
  const groups = new Map<string, LineRow>();
  const out: LineRow[] = [];
  for (const c of components) {
    const gsm = singleGsm(c.gsm);
    const form = derivedForm(cuts, c);
    const k = [c.fabric_category_id ?? c.structure ?? "", gsm, form].join("|");
    const held = groups.get(k);
    if (held) {
      held.parts.push(cutKey(c));
      continue;
    }
    const line: LineRow = {
      ...blankLine(),
      parts: [cutKey(c)],
      fabric_category_id: c.fabric_category_id ?? null,
      fabric_name: c.structure,
      gsm,
      width_form: form,
    };
    groups.set(k, line);
    out.push(line);
  }
  return out;
}

const hasFigures = (f: SizeFigures) => !!(f.table_dia.trim() || f.avg_pcs_weight_g.trim());

/** Something the pattern maker typed — the save side's blank-line test. */
const isTyped = (l: LineRow) =>
  !!(
    l.colours.length ||
    l.table_dia.trim() ||
    l.avg_pcs_weight_g.trim() ||
    Object.values(l.sizes).some(hasFigures) ||
    l.width_form ||
    l.remark.trim()
  );

const numText = (n: number | null) => (n != null ? String(n) : "");

/*
 * THE CARD'S BAND — one grid template for the header and the body, so a
 * heading can never slide off the control under it (Manual's `MANUAL_TRACK`
 * rule). Floors in rem, the Remark track takes what is left, and the ✕ is a
 * fixed 40px gutter. Floors sum to ~52rem (832px), inside the sheet's pane.
 */
const BAND_TRACKS = [
  "minmax(8rem,1fr)", // Fabric
  "5rem", // GSM
  "minmax(10rem,1.4fr)", // Type of Parts
  "minmax(8rem,1fr)", // Colour
  "8.5rem", // Tubular / Open Width
  "4.5rem", // Size Wise
  "minmax(8rem,1fr)", // Remark
];
const bandCols = (withRemove: boolean) => [...BAND_TRACKS, ...(withRemove ? ["40px"] : [])].join(" ");

export function PatternWorkForm({
  row,
  inline = false,
  origin,
  onClose,
}: {
  row: CadStyleRow;
  inline?: boolean;
  origin?: SheetOrigin | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [isPending, start] = useTransition();
  const version = latestVersion(row.versions)!;
  const today = istToday();
  const [status, setStatus] = useState<PatternStatus>(version.pattern_status);
  const [date, setDate] = useState<string>(version.pattern_date ?? today);
  // Saved lines when there are any; otherwise the order's parts, grouped by
  // fabric (AGENTS.md "Editable sub-tables open with a row").
  const [lines, setLines] = useState<LineRow[]>(() =>
    version.pattern_lines.length > 0
      ? // MERGED ON OPEN, by the rule Save applies (screenshot 3086: three
        // lines differing only in the part still showed as three), so the
        // sheet shows what will be stored rather than what was.
        mergePatternLines(
          version.pattern_lines.map((l) => ({
            ...l,
            sizes: l.size_wise
              ? l.sizes.map((z) => ({ size_id: z.size_id, table_dia: z.table_dia, avg_pcs_weight_g: z.avg_pcs_weight_g }))
              : [],
          })),
        ).map((l) => ({
          key: newKey(),
          parts: l.parts.map(cutKey),
          fabric_category_id: l.fabric_category_id,
          fabric_name: l.fabric_name,
          gsm: numText(l.gsm),
          colours: l.colours,
          // A line saved before the Cut Method was set takes it now; a form
          // already chosen is kept.
          width_form:
            l.width_form ??
            formOfParts(
              version.component_cuts,
              row.components.filter((c) => l.parts.some((p) => cutKey(p) === cutKey(c))),
            ),
          size_wise: l.size_wise,
          table_dia: numText(l.table_dia),
          avg_pcs_weight_g: numText(l.avg_pcs_weight_g),
          sizes: Object.fromEntries(
            l.sizes.map((z) => [z.size_id, { table_dia: numText(z.table_dia), avg_pcs_weight_g: numText(z.avg_pcs_weight_g) }]),
          ),
          remark: l.remark ?? "",
        }))
      : seedLines(row.components, version.component_cuts),
  );
  const [serverError, setServerError] = useState<string | null>(null);

  const setLine = (key: string, patch: Partial<LineRow>) =>
    setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  /** One size row's cell. The "All sizes" row (size_id null) writes the line's own pair. */
  const setSizeFigures = (key: string, sizeId: string | null, patch: Partial<SizeFigures>) =>
    setLines((xs) =>
      xs.map((x) => {
        if (x.key !== key) return x;
        if (sizeId == null) return { ...x, ...patch };
        return { ...x, sizes: { ...x.sizes, [sizeId]: { ...(x.sizes[sizeId] ?? BLANK_FIGURES), ...patch } } };
      }),
    );

  /**
   * EVERY PART THIS SHEET CAN NAME — the style's components today, plus any a
   * saved line still holds that the style has since dropped (the "Disabled
   * rows" rule: a held value stays on the field, never silently blanked).
   */
  type KnownPart = PatternPart & { fabric_category_id: string | null; structure: string | null };
  const knownParts = new Map<string, KnownPart>();
  for (const c of row.components) {
    knownParts.set(cutKey(c), {
      coordinate_id: c.coordinate_id,
      coordinate_name: c.coordinate_name,
      component_id: c.component_id,
      component_name: c.name,
      fabric_category_id: c.fabric_category_id ?? null,
      structure: c.structure,
    });
  }
  for (const l of version.pattern_lines) {
    for (const p of l.parts) {
      if (!knownParts.has(cutKey(p))) {
        knownParts.set(cutKey(p), { ...p, fabric_category_id: l.fabric_category_id, structure: l.fabric_name });
      }
    }
  }
  /* THE COORDINATE ONLY WHEN IT TELLS PARTS APART (screenshot 3086): a style
     with one coordinate printed "PIECES ▸" before every part and left the
     part's own name clipped. A Set item (TOP / BOTTOM) keeps it. */
  const manyCoordinates = new Set([...knownParts.values()].map((p) => p.coordinate_id ?? "")).size > 1;
  /** Each part's fabric, for the Type of Parts list's headings. */
  const partFabric = new Map([...knownParts.entries()].map(([k, p]) => [k, p.structure ?? "Other"] as const));

  /**
   * NAMES IN THE BOX FOR ONE PICK, THE COUNT FOR MORE (screenshot 3088), with
   * the names beneath as one wrapping line (`pickNames`, screenshot 3089).
   */
  const pickDisplay = (n: number) =>
    n <= 1 ? { summarizeLabels: true, hideChips: true } : { summarizeLabels: false, hideChips: true };
  const pickNames = (names: string[]) =>
    names.length > 1 ? <p className="mt-1 text-xs leading-snug text-muted-foreground">{names.join(" · ")}</p> : null;

  /** The style's sizes in size order, plus any a saved line still holds (tagged). */
  const styleSizes = sortBySize(row.size_options, (z) => z.name);
  const savedSizeName = new Map(
    version.pattern_lines.flatMap((l) => l.sizes.map((z) => [z.size_id, z.size_name ?? "—"] as const)),
  );
  const sizeRowsOf = (l: LineRow): SizeRow[] => {
    if (!l.size_wise) {
      return [
        {
          key: `${l.key}:all`,
          size_id: null,
          label: "All sizes",
          declared: true,
          figures: { table_dia: l.table_dia, avg_pcs_weight_g: l.avg_pcs_weight_g },
        },
      ];
    }
    const rows: SizeRow[] = styleSizes.map((z) => ({
      key: `${l.key}:${z.id}`,
      size_id: z.id,
      label: z.name,
      declared: true,
      figures: l.sizes[z.id] ?? BLANK_FIGURES,
    }));
    for (const [id, f] of Object.entries(l.sizes)) {
      if (!styleSizes.some((z) => z.id === id) && hasFigures(f)) {
        rows.push({ key: `${l.key}:${id}`, size_id: id, label: savedSizeName.get(id) ?? "—", declared: false, figures: f });
      }
    }
    return rows;
  };

  const partLabel = (p: KnownPart) =>
    manyCoordinates && p.coordinate_name
      ? `${p.coordinate_name} ▸ ${p.component_name ?? ""}`
      : (p.component_name ?? "");

  /**
   * THE PARTS OF ONE LINE CHANGED. The FIRST part decides the line's FABRIC —
   * and so which others may join it. GSM seeds when blank; the roll form
   * follows the parts when they agree, and is left alone when they say nothing.
   */
  function pickParts(l: LineRow, keys: string[]) {
    const first = keys.length > 0 ? knownParts.get(keys[0]) : undefined;
    const firstComp = row.components.find((c) => keys.length > 0 && cutKey(c) === keys[0]);
    const cs = row.components.filter((c) => keys.includes(cutKey(c)));
    setLine(l.key, {
      parts: keys,
      fabric_category_id: first ? first.fabric_category_id : null,
      fabric_name: first ? first.structure : null,
      gsm: l.gsm || (firstComp ? singleGsm(firstComp.gsm) : ""),
      width_form: formOfParts(version.component_cuts, cs) || l.width_form,
    });
  }

  /**
   * SIZE WISE SWITCHED. On: every size starts from the line's one answer, so
   * nothing typed is lost and only the sizes that differ need editing. Off:
   * the first size's figures become the one answer.
   */
  function setSizeWise(l: LineRow, on: boolean) {
    if (on) {
      const one = { table_dia: l.table_dia, avg_pcs_weight_g: l.avg_pcs_weight_g };
      const sizes = hasFigures(one)
        ? Object.fromEntries(styleSizes.map((z) => [z.id, l.sizes[z.id] ?? one]))
        : l.sizes;
      setLine(l.key, { size_wise: true, sizes });
      return;
    }
    const first = sizeRowsOf(l).find((r) => hasFigures(r.figures))?.figures ?? BLANK_FIGURES;
    setLine(l.key, {
      size_wise: false,
      table_dia: l.table_dia || first.table_dia,
      avg_pcs_weight_g: l.avg_pcs_weight_g || first.avg_pcs_weight_g,
    });
  }

  /** A line's options: the parts it holds, plus the style's parts on the same fabric. */
  const partOptionsFor = (l: LineRow) =>
    [...knownParts.entries()]
      .filter(
        ([k, p]) =>
          l.parts.includes(k) ||
          (row.components.some((c) => cutKey(c) === k) &&
            (l.parts.length === 0 || p.fabric_category_id === l.fabric_category_id)),
      )
      .map(([k, p]) => ({ id: k, label: partLabel(p) }));

  function save() {
    setServerError(null);
    const typed = lines.filter(isTyped);
    const unnamed = typed.findIndex((l) => l.parts.length === 0);
    if (unnamed >= 0) {
      setServerError(`Fabric ${lines.indexOf(typed[unnamed]) + 1}: choose the Type of Parts.`);
      return;
    }
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const payload = typed.map((l) => ({
      parts: l.parts.flatMap((k) => {
        const p = knownParts.get(k);
        return p ? [{ coordinate_id: p.coordinate_id, component_id: p.component_id }] : [];
      }),
      fabric_category_id: l.fabric_category_id,
      gsm: num(l.gsm),
      colours: l.colours.map((c) => c.toUpperCase()),
      size_wise: l.size_wise,
      sizes: l.size_wise
        ? Object.entries(l.sizes)
            .filter(([, f]) => hasFigures(f))
            .map(([size_id, f]) => ({
              size_id,
              table_dia: num(f.table_dia),
              avg_pcs_weight_g: num(f.avg_pcs_weight_g),
            }))
        : [],
      table_dia: l.size_wise ? null : num(l.table_dia),
      width_form: l.width_form || null,
      avg_pcs_weight_g: l.size_wise ? null : num(l.avg_pcs_weight_g),
      remark: l.remark.trim() ? l.remark.trim().toUpperCase() : null,
    }));
    // The ACTION merges (so every writer gets it); this only counts, for the toast.
    const merged = payload.length - mergePatternLines(payload).length;
    start(async () => {
      const r = await savePatternSheet(version.id, {
        pattern_status: status,
        pattern_date: date || null,
        lines: payload,
      });
      if (!r.ok) {
        setServerError(r.error);
        return;
      }
      const base = status === "ready" ? "Pattern marked Ready" : "Pattern sheet saved";
      toast.success(
        merged > 0
          ? `${base} · ${merged} line${merged === 1 ? "" : "s"} with the same measurements merged`
          : base,
      );
      onClose();
    });
  }

  /** The card's own fields — Manual's band, in the pattern room's words. */
  const bandColumns: { header: string; cell: (l: LineRow) => ReactNode }[] = [
    {
      header: "Fabric",
      cell: (l) => (
        <div className="flex h-8 min-w-0 items-center">
          <Truncated className="text-sm">{l.fabric_name ?? "—"}</Truncated>
        </div>
      ),
    },
    {
      header: "GSM",
      cell: (l) => (
        <Input
          aria-label="GSM"
          type="number"
          inputMode="decimal"
          min={0}
          value={l.gsm}
          onChange={(e) => setLine(l.key, { gsm: e.target.value })}
        />
      ),
    },
    {
      header: "Type of Parts",
      cell: (l) => (
        <div className="min-w-0">
          <MultiSelect
            label="Type of Parts"
            compact
            {...pickDisplay(l.parts.length)}
            summaryNoun="parts"
            inputClassName="h-8 max-h-8"
            triggerClassName="h-8 max-h-8"
            /* Under each FABRIC, so a new line starts from the cloth — a line is
               one fabric, and the list narrows to it after the first tick. */
            groupBy={(o) => {
              const f = partFabric.get(o.id) ?? "Other";
              return { key: f, label: f };
            }}
            options={partOptionsFor(l)}
            values={l.parts}
            onChange={(next) => pickParts(l, next)}
          />
          {pickNames(
            l.parts.map((k) => {
              const p = knownParts.get(k);
              return p ? partLabel(p) : "—";
            }),
          )}
        </div>
      ),
    },
    {
      /* SEVERAL (0644): a line measured the same for WHITE and NAVY is one
         line. A colour saved earlier that the combos no longer carry stays. */
      header: "Colour",
      cell: (l) => (
        <div className="min-w-0">
          <MultiSelect
            label="Colour"
            compact
            {...pickDisplay(l.colours.length)}
            summaryNoun="colours"
            inputClassName="h-8 max-h-8"
            triggerClassName="h-8 max-h-8"
            options={[...new Set([...row.colours, ...l.colours])].map((c) => ({ id: c, label: c }))}
            values={l.colours}
            onChange={(next) => setLine(l.key, { colours: next })}
          />
          {pickNames(l.colours)}
        </div>
      ),
    },
    {
      header: "Tubular / Open Width",
      cell: (l) => (
        <Select
          aria-label="Tubular / Open Width"
          value={l.width_form}
          onChange={(e) => setLine(l.key, { width_form: e.target.value as LayoutType | "" })}
        >
          <option value="" />
          {LAYOUT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Size Wise",
      cell: (l) => (
        <span className="flex h-8 items-center justify-center">
          <Toggle ariaLabel="Size Wise" checked={l.size_wise} onChange={(next) => setSizeWise(l, next)} />
        </span>
      ),
    },
    {
      header: "Remark",
      cell: (l) => (
        <Input aria-label="Remark" value={l.remark} onChange={(e) => setLine(l.key, { remark: e.target.value })} />
      ),
    },
  ];

  /** The sizes grid under each card: code 144 + hug 88 + range 112 = 344px. */
  const sizeColumnsFor = (l: LineRow): ChildGridColumn<SizeRow>[] => [
    {
      header: "Size",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <div className="flex h-8 min-w-0 items-center text-sm">
          <Truncated>{r.declared ? r.label : `${r.label} (not on the style)`}</Truncated>
        </div>
      ),
    },
    {
      header: "Table Dia",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <Input
          aria-label={`Table Dia · ${r.label}`}
          type="number"
          inputMode="decimal"
          min={0}
          value={r.figures.table_dia}
          onChange={(e) => setSizeFigures(l.key, r.size_id, { table_dia: e.target.value })}
        />
      ),
    },
    {
      header: "Avg CAD Pcs Wt (g)",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <Input
          aria-label={`Avg CAD Pcs Weight (g) · ${r.label}`}
          type="number"
          inputMode="decimal"
          min={0}
          value={r.figures.avg_pcs_weight_g}
          onChange={(e) => setSizeFigures(l.key, r.size_id, { avg_pcs_weight_g: e.target.value })}
        />
      ),
    },
  ];

  const removeLine = (l: LineRow) => setLines((xs) => xs.filter((x) => x.key !== l.key));
  const withRemove = lines.length > 1;

  return (
    <CadFormFrame
      inline={inline}
      open
      onClose={onClose}
      title={`Pattern · ${row.style_ref_no}`}
      // lg (full screen): this is the Pattern Maker's whole form — a header row
      // of five and a card per fabric — opened from the CAD Queue, not a small
      // sub-detail.
      size="lg"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Save pattern"}
          </Button>
        </>
      }
    >
      <DetailSection label="Pattern Status">
        {/* term 176 + code 144 + name 288 × 2 + term 176 + 4 gaps 48 = 1,120 —
            one row on the page; wraps in the sheet. Buyer / RE No / Style are
            the order's, read-only. */}
        <FieldRow align="start">
          <Field label="Pattern Status" required w="term" htmlFor="cad-pattern-status">
            <Select id="cad-pattern-status" value={status} onChange={(e) => setStatus(e.target.value as PatternStatus)}>
              {PATTERN_STATUSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" w="code" htmlFor="cad-pattern-date">
            <Input id="cad-pattern-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Buyer" w="name" htmlFor="cad-pattern-buyer">
            <Input id="cad-pattern-buyer" readOnly value={row.customer_name ?? ""} />
          </Field>
          <Field label="RE No / Style Name" w="name" htmlFor="cad-pattern-re">
            <Input
              id="cad-pattern-re"
              readOnly
              value={[row.re_no ?? row.order_code, row.style_description].filter(Boolean).join(" / ")}
            />
          </Field>
          <Field label="Style" w="term" htmlFor="cad-pattern-style">
            <Input id="cad-pattern-style" readOnly value={row.style_ref_no} />
          </Field>
        </FieldRow>
        {status !== "ready" && (
          <p className="text-xs text-muted-foreground">
            Ready dates Pattern Approval on the T&amp;A. The Fabric BOM ▸ Manual tab fills from this sheet.
          </p>
        )}
      </DetailSection>
      <DetailSection label="Pattern Details" frameless>
        {/* THE FABRICS AS A SIDE RAIL, AS FABRIC BOM ▸ MANUAL LISTS THEM (user
            2026-09-26, screenshot 3101: "this section of listing can follow
            same how we listing using the side rail"). The rail names each
            fabric and its parts; the open one's card and sizes stand beside it.
            Same props as Manual's rail — `railAlways` so the shape is there
            from the first fabric, the first one open, "+ Add fabric" at the
            foot of the rail. The cards are rows the grid does not lay out
            itself (`columns={[]}` + `renderMobileRow`), so Ctrl+Del, "+ Add
            fabric" and the landing in a new card all still work. */}
        <ChildGrid<LineRow>
          columns={[]}
          rows={lines}
          forceCards
          flatRows
          fill
          foldRows
          masterDetail
          railAlways
          railWidthPx={180}
          defaultOpenKey={lines[0]?.key ?? null}
          renderListItem={(l) => {
            const parts = l.parts
              .map((k) => {
                const p = knownParts.get(k);
                return p ? partLabel(p) : "";
              })
              .filter(Boolean)
              .join(" · ");
            return (
              <div className="flex min-h-7 items-center">
                <span className="min-w-0 flex-1">
                  <Truncated className="block text-[12.5px] font-medium leading-tight text-foreground">
                    {l.fabric_name || "New fabric"}
                  </Truncated>
                  {parts && (
                    <Truncated className="block text-[10px] leading-tight text-muted-foreground">{parts}</Truncated>
                  )}
                </span>
              </div>
            );
          }}
          renderFoldedRow={(l) => <span className="text-sm font-medium">{l.fabric_name || "New fabric"}</span>}
          hideRemove
          railAdd
          addClassName="w-full justify-start px-3"
          addLabel="+ Add fabric"
          onAdd={() => setLines((xs) => [...xs, blankLine()])}
          onRemove={removeLine}
          renderMobileRow={(l) => (
            <div className="space-y-2">
              <div className="max-w-full overflow-x-auto">
                <div className="w-full min-w-fit overflow-hidden rounded-lg border border-border-strong bg-surface max-sm:min-w-0">
                  <div className="grid bg-surface-muted max-sm:hidden" style={{ gridTemplateColumns: bandCols(withRemove) }}>
                    {bandColumns.map((c, ci) => (
                      <div
                        key={c.header}
                        className={cn(
                          "flex min-w-0 items-end break-words px-1.5 py-1.5 leading-tight",
                          GRID_HEADER_TEXT,
                          ci > 0 && "border-l border-border-strong",
                        )}
                      >
                        {c.header}
                      </div>
                    ))}
                    {withRemove && <div aria-hidden />}
                  </div>
                  <div
                    className="grid items-center border-t border-border-strong py-2 max-sm:grid-cols-1! max-sm:gap-y-2.5 max-sm:border-t-0 max-sm:px-1.5"
                    style={{ gridTemplateColumns: bandCols(withRemove) }}
                  >
                    {bandColumns.map((c, ci) => (
                      <div
                        key={c.header}
                        data-label={c.header}
                        className={cn(
                          "min-w-0 px-1.5",
                          ci > 0 && "border-l border-border-strong max-sm:border-l-0",
                          "max-sm:before:mb-1 max-sm:before:block max-sm:before:text-xs max-sm:before:font-semibold max-sm:before:uppercase max-sm:before:tracking-wide max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]",
                        )}
                      >
                        <RequiredScope required={false} label={c.header}>
                          {c.cell(l)}
                        </RequiredScope>
                      </div>
                    ))}
                    {withRemove && (
                      <div className="flex items-center justify-center px-1">
                        <div className="flex h-8 w-8 items-center justify-center">
                          <RowRemoveChip inFlow label="Remove fabric" onClick={() => removeLine(l)} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* THE SIZES — one "All sizes" row while Size Wise is off. The
                  rows are the style's sizes, so no "+ Add" and no ✕. */}
              <ChildGrid<SizeRow>
                /* grid-caption: exempt -- the fabric card above is the caption. */
                columns={sizeColumnsFor(l)}
                rows={sizeRowsOf(l)}
                hideAdd
                hideRemove
                onAdd={() => false}
                onRemove={() => {}}
                centerHeaders
                renderMobileRow={(r, i) => (
                  <FieldRow align="start" gap="tight">
                    {sizeColumnsFor(l).map((c, ci) => (
                      <Field key={ci} label={c.header} w={fieldWidthStep(c.width) ?? "hug"}>
                        {c.cell(r, i)}
                      </Field>
                    ))}
                  </FieldRow>
                )}
              />
              {l.size_wise && styleSizes.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  This style states no sizes yet — turn Size Wise off to give one weight for the style.
                </p>
              )}
            </div>
          )}
        />
      </DetailSection>
      {serverError && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {serverError}
        </p>
      )}
    </CadFormFrame>
  );
}
