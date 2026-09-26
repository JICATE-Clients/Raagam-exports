"use client";

/**
 * THE PATTERN MAKER'S SHEET (user 2026-09-25: "the pattern status form fields
 * … this for the pattern maker, he will update with this form"; 0638 + 0640).
 *
 *   header   PATTERN STATUS · DATE · BUYER · RE-NO / STYLE NAME · STYLE
 *   lines    FABRIC · GSM · TYPE of PARTS · COLOUR · SIZE · TABLE DIA ·
 *            TUBULAR & OPEN WIDTH · AVG CAD PCS WEIGHT · REMARK
 *
 * TYPE OF PARTS PICKS SEVERAL (0643; client spec 2026-09-25, Task 2; user,
 * screenshot 3085: "inside the pattern sheet"). FRONT BODY, BACK and SLEEVE cut
 * from the same jersey at the same dia and weight are ONE line, not three that
 * differ only in the part. A line is one fabric, so once it holds a part only
 * the parts cut from that structure are offered. On Save, lines that match on
 * every measured value merge (`mergePatternLines`, in the action).
 *
 * TUBULAR / OPEN WIDTH FILLS ITSELF from the parts' Cut Method (Direct Shape →
 * Open Width, Fit Form Cutting → Tubular; a rib structure → Tubular) — client
 * spec 2026-09-25, Task 1. Still a choice: the pattern maker may correct it,
 * and parts that disagree fill nothing.
 *
 * The lines open SEEDED from the order — one per fabric the style's parts are
 * cut from (same structure, GSM and roll form), with the parts already ticked —
 * so the pattern maker types only what the pattern room measures. "+ Add line"
 * repeats parts for another colour or size. A line with nothing typed is not
 * saved (the seeded values are the order's, not the operator's).
 *
 * READY IS THE END OF THE CAD (user 2026-09-25, "No Send step"): it opens the
 * Fabric BOM (0641) and dates the T&A's Pattern Approval (0642).
 *
 * One form, two frames (`CadFormFrame`): in place on Order Entry ▸ CAD, a sheet
 * wherever the CAD Queue opens it — the same rule as the other steps.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { FIELD_WIDTH_CSS, Field, FieldRow, fieldWidthStep } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import type { SheetOrigin } from "@/components/ui/sheet";
import { today as istToday } from "@/lib/calendar";
import { sizeFamily, sortBySize } from "@/lib/masters/size-order";
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
import { CadFormFrame } from "./cad-form-frame";

/** A line as the form holds it — numbers as typed text until Save. */
type LineRow = {
  key: string;
  /** TYPE of PARTS — cutKeys of the parts, several since 0643; [] = none chosen. */
  parts: string[];
  fabric_category_id: string | null;
  fabric_name: string | null;
  gsm: string;
  /** COLOUR and SIZE — several each since 0644; [] = none chosen. */
  colours: string[];
  size_ids: string[];
  table_dia: string;
  width_form: LayoutType | "";
  avg_pcs_weight_g: string;
  remark: string;
};

let seq = 0;
const newKey = () => `pl-${Date.now()}-${++seq}`;

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
  size_ids: [],
  table_dia: "",
  width_form: "",
  avg_pcs_weight_g: "",
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

/** Something the pattern maker typed — the save side's blank-line test. */
const isTyped = (l: LineRow) =>
  !!(l.colours.length || l.size_ids.length || l.table_dia.trim() || l.width_form || l.avg_pcs_weight_g.trim() || l.remark.trim());

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
        mergePatternLines(version.pattern_lines.map((l) => ({ ...l, size_ids: l.sizes.map((z) => z.size_id) }))).map((l) => ({
          key: newKey(),
          parts: l.parts.map(cutKey),
          fabric_category_id: l.fabric_category_id,
          fabric_name: l.fabric_name,
          gsm: l.gsm != null ? String(l.gsm) : "",
          colours: l.colours,
          size_ids: l.size_ids,
          table_dia: l.table_dia != null ? String(l.table_dia) : "",
          // A line saved before the Cut Method was set takes it now; a form
          // already chosen is kept.
          width_form:
            l.width_form ??
            formOfParts(
              version.component_cuts,
              row.components.filter((c) => l.parts.some((p) => cutKey(p) === cutKey(c))),
            ),
          avg_pcs_weight_g: l.avg_pcs_weight_g != null ? String(l.avg_pcs_weight_g) : "",
          remark: l.remark ?? "",
        }))
      : seedLines(row.components, version.component_cuts),
  );
  const [serverError, setServerError] = useState<string | null>(null);

  const setLine = (key: string, patch: Partial<LineRow>) =>
    setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

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
   * NAMES IN THE BOX FOR A SHORT PICK, CHIPS FOR A LONG ONE (screenshot 3088:
   * "1 colours sel…" over a WHITE chip said the same thing twice, clipped).
   * Up to `inBox` picks read as their names in the box and grow nothing; more
   * than that shows the count in the box and the names beneath (`pickNames`).
   * ONE RULE FOR ALL THREE COLUMNS, `inBox` = 1 (user 2026-09-25: "why the
   * colour and size is not listing the value like components") — Colour and
   * Size waited for a third pick while Type of Parts listed from the second.
   */
  const pickDisplay = (n: number, inBox: number) =>
    n <= inBox ? { summarizeLabels: true, hideChips: true } : { summarizeLabels: false, hideChips: true };

  /**
   * A LONG PICK'S NAMES, UNDER THE BOX, AS ONE WRAPPING LINE (screenshot 3089:
   * chips stacked one per line — FRONT BODY / BACK BODY / SLEEVE — made the
   * row four boxes tall with every other cell empty beside them). Small text
   * joined by " · " takes one or two lines in the column instead of three
   * chip rows. Untick in the list to remove one. Nothing when the box already
   * says the names.
   */
  const pickNames = (names: string[], inBox: number) =>
    names.length > inBox ? (
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{names.join(" · ")}</p>
    ) : null;

  /* CHIPS WERE TRIED FIRST (user 2026-09-25, screenshot 3087:
     "see our existing multi select size from style") — the Order Entry ▸
     Styles ▸ Sizes pattern: "3 parts selected" in the box, every pick named
     beneath it with its ✕. In a 176px column they stacked one per line and
     made the row four boxes tall (screenshot 3089, "un aligned") — hence
     `pickNames` above: the same information in one wrapping line. */

  /** Sizes a saved line holds, by id — the label for one the style has since dropped. */
  const savedSizeName = new Map(
    version.pattern_lines.flatMap((l) => l.sizes.map((z) => [z.size_id, z.size_name ?? "—"] as const)),
  );
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
      setServerError(`Line ${lines.indexOf(typed[unnamed]) + 1}: choose the Type of Parts.`);
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
      size_ids: l.size_ids,
      table_dia: num(l.table_dia),
      width_form: l.width_form || null,
      avg_pcs_weight_g: num(l.avg_pcs_weight_g),
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
      const base = status === "ready" ? "Pattern marked Ready — the Fabric BOM can be created" : "Pattern sheet saved";
      toast.success(
        merged > 0
          ? `${base} · ${merged} line${merged === 1 ? "" : "s"} with the same measurements merged`
          : base,
      );
      onClose();
    });
  }

  // code 144 + hug 88 + term 176 + code 144 + hug 88 + hug 88 + code 144
  // + hug 88 + range 112 = 1,072 + 72 chrome = 1,144 ≤ 1,155
  // (check:grid-budget). Type of Parts took `term` for its names (0643),
  // Remark gave the width back; Size is `hug` again now that one or two sizes
  // read in the box (`pickDisplay`), and Tubular / Open Width took `code` so
  // "Open Width" is not clipped to "Open …" (screenshot 3088).
  const patternLineColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Fabric",
      width: FIELD_WIDTH_CSS.code,
      // h-8, centred: level with the 32px boxes beside it (screenshot 3088).
      cell: (l) => (
        <div className="flex h-8 min-w-0 items-center">
          <Truncated className="text-sm">{l.fabric_name ?? "—"}</Truncated>
        </div>
      ),
    },
    {
      header: "GSM",
      width: FIELD_WIDTH_CSS.hug,
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
      width: FIELD_WIDTH_CSS.term,
      cell: (l) => (
        <div className="min-w-0">
        <MultiSelect
          label="Type of Parts"
          compact
          {...pickDisplay(l.parts.length, 1)}
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
          1,
        )}
        </div>
      ),
    },
    {
      /* SEVERAL (0644, user 2026-09-25: "Colour Size … missing multi select"):
         a line measured the same for WHITE and NAVY is one line. A colour saved
         earlier that the combos no longer carry stays listed. */
      header: "Colour",
      width: FIELD_WIDTH_CSS.code,
      cell: (l) => (
        <div className="min-w-0">
        <MultiSelect
          label="Colour"
          compact
          {...pickDisplay(l.colours.length, 1)}
          summaryNoun="colours"
          inputClassName="h-8 max-h-8"
          triggerClassName="h-8 max-h-8"
          options={[...new Set([...row.colours, ...l.colours])].map((c) => ({ id: c, label: c }))}
          values={l.colours}
          onChange={(next) => setLine(l.key, { colours: next })}
        />
        {pickNames(l.colours, 1)}
        </div>
      ),
    },
    {
      header: "Size",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <div className="min-w-0">
        <MultiSelect
          label="Size"
          compact
          {...pickDisplay(l.size_ids.length, 1)}
          summaryNoun="sizes"
          inputClassName="h-8 max-h-8"
          triggerClassName="h-8 max-h-8"
          /* THE STYLE MASTER'S SIZE PICKER, as Order Entry ▸ Styles draws it:
             a tick grid three to a line under its bands (Letter / Numeric …),
             in size order, the panel wider than this narrow column. */
          gridded
          gridColumns={3}
          groupBy={(o) => sizeFamily(o.label)}
          panelClassName="w-[16rem]"
          options={[
            ...sortBySize(row.size_options, (z) => z.name).map((z) => ({ id: z.id, label: z.name })),
            // A size saved earlier that the style no longer states stays listed.
            ...l.size_ids
              .filter((id) => !row.size_options.some((z) => z.id === id))
              .map((id) => ({ id, label: savedSizeName.get(id) ?? "—" })),
          ]}
          values={l.size_ids}
          onChange={(next) => setLine(l.key, { size_ids: next })}
        />
        {pickNames(
          l.size_ids.map((id) => row.size_options.find((z) => z.id === id)?.name ?? savedSizeName.get(id) ?? "—"),
          1,
        )}
        </div>
      ),
    },
    {
      header: "Table Dia",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <Input
          aria-label="Table Dia"
          type="number"
          inputMode="decimal"
          min={0}
          value={l.table_dia}
          onChange={(e) => setLine(l.key, { table_dia: e.target.value })}
        />
      ),
    },
    {
      header: "Tubular / Open Width",
      width: FIELD_WIDTH_CSS.code,
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
      header: "Avg CAD Pcs Wt (g)",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <Input
          aria-label="Avg CAD Pcs Weight (g)"
          type="number"
          inputMode="decimal"
          min={0}
          value={l.avg_pcs_weight_g}
          onChange={(e) => setLine(l.key, { avg_pcs_weight_g: e.target.value })}
        />
      ),
    },
    {
      header: "Remark",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Input aria-label="Remark" value={l.remark} onChange={(e) => setLine(l.key, { remark: e.target.value })} />
      ),
    },
  ];

  return (
    <CadFormFrame
      inline={inline}
      open
      onClose={onClose}
      title={`Pattern · ${row.style_ref_no}`}
      // lg (full screen): this is the Pattern Maker's whole form — a header row
      // of five and a nine-column grid — opened from the CAD Queue, not a small
      // sub-detail; md's ~1,100px would leave the grid 19px from falling to cards.
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
            Ready opens the Fabric BOM and dates Pattern Approval on the T&amp;A.
          </p>
        )}
      </DetailSection>
      {/* frameless: the grid draws the one frame (ONE FRAME PER GRID). */}
      <DetailSection label="Pattern Details" frameless>
        <ChildGrid<LineRow>
          columns={patternLineColumns}
          rows={lines}
          tableFrom="5xl"
          flatRows
          addLabel="+ Add line"
          onAdd={() => setLines((xs) => [...xs, blankLine()])}
          onRemove={(l) => setLines((xs) => xs.filter((x) => x.key !== l.key))}
          renderMobileRow={(l, i) => (
            <FieldRow align="start" gap="tight">
              {patternLineColumns.map((c, ci) => (
                <Field key={ci} label={c.header} w={fieldWidthStep(c.width) ?? "hug"}>
                  {c.cell(l, i)}
                </Field>
              ))}
            </FieldRow>
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
