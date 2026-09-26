"use client";

/**
 * The CAD version's PATTERN DETAILS (0632) and the embedded ORDER SHEET (0638).
 *
 * Pattern Details — the Order Entry ▸ CAD spec's "Compact CAD Entry Details":
 * Bit Wash (the spec's "Fit Wash Process", renamed by the user 2026-09-25 —
 * LABEL only, the column stays `fit_wash`; on Yes, the two shrinkage
 * percentages) and Cut Type.
 *
 * Order Sheet — see `OrderSheetSection` below.
 *
 * ITS OWN FILE so the Allocation form gains one element, not a hundred lines —
 * and the History card reads the same words through `patternFactLines`.
 */

import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { FIELD_WIDTH_CSS, Field, FieldRow, fieldWidthStep } from "@/components/ui/field";
import { Truncated } from "@/components/ui/truncated";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CUT_METHODS,
  CUT_TYPES,
  cutKey,
  cutMethodLabel,
  cutTypeLabel,
  type ComponentCut,
  type CutMethod,
  type CutType,
  type StyleComponent,
} from "@/lib/orders/cad-lifecycle/types";

export type PatternDetailsValue = {
  fit_wash: boolean;
  /** As typed — a percentage box is text until Save. */
  length_shrink_pct: string;
  width_shrink_pct: string;
  cut_type: CutType | "";
  component_cuts: ComponentCut[];
};

export function patternDetailsFrom(v: {
  fit_wash: boolean;
  length_shrink_pct: number | null;
  width_shrink_pct: number | null;
  cut_type: CutType | null;
  component_cuts: ComponentCut[];
} | null): PatternDetailsValue {
  return {
    fit_wash: v?.fit_wash ?? false,
    length_shrink_pct: v?.length_shrink_pct != null ? String(v.length_shrink_pct) : "",
    width_shrink_pct: v?.width_shrink_pct != null ? String(v.width_shrink_pct) : "",
    cut_type: v?.cut_type ?? "",
    component_cuts: v?.component_cuts ?? [],
  };
}

/** The payload half — NULL percentages on Bit Wash = No (0632's CHECK). */
export function patternDetailsPayload(v: PatternDetailsValue) {
  const pct = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    fit_wash: v.fit_wash,
    length_shrink_pct: v.fit_wash ? pct(v.length_shrink_pct) : null,
    width_shrink_pct: v.fit_wash ? pct(v.width_shrink_pct) : null,
    cut_type: v.cut_type || null,
    component_cuts: v.component_cuts,
  };
}

export function PatternDetailsFields({
  value,
  onChange,
  components,
  sizes,
  errors,
}: {
  value: PatternDetailsValue;
  onChange: (next: PatternDetailsValue) => void;
  components: StyleComponent[];
  sizes: string[];
  errors?: { length?: string; width?: string };
}) {
  const set = (patch: Partial<PatternDetailsValue>) => onChange({ ...value, ...patch });
  return (
    <>
      {/* CAPPED (user 2026-09-26, screenshot 3105: "compact the field size").
          Bit Wash is Yes / No — hug 88. The shrinkage boxes stay code 144 for
          their labels ("Length Shrinkage %" would wrap narrower and drop its box
          below the row). hug 88 + code 144 × 2 + term 176 + 3 gaps 36 = 588
          + ~22 padding = 610 ≤ 39rem. */}
      <DetailSection label="Pattern Details" className="max-w-[39rem]">
        <FieldRow align="start">
          <Field label="Bit Wash" w="hug" htmlFor="cad-fit-wash">
            <Select
              id="cad-fit-wash"
              value={value.fit_wash ? "yes" : "no"}
              onChange={(e) => {
                const yes = e.target.value === "yes";
                // Switching to No drops the figures — a sheet that says No must not
                // carry a shrinkage (0632 refuses it).
                set(yes ? { fit_wash: true } : { fit_wash: false, length_shrink_pct: "", width_shrink_pct: "" });
              }}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </Field>
          {value.fit_wash && (
            <>
              <Field label="Length Shrinkage %" required w="code" htmlFor="cad-len-shrink" error={errors?.length}>
                <Input
                  id="cad-len-shrink"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  max={99.99}
                  value={value.length_shrink_pct}
                  onChange={(e) => set({ length_shrink_pct: e.target.value })}
                />
              </Field>
              <Field label="Width Shrinkage %" required w="code" htmlFor="cad-wid-shrink" error={errors?.width}>
                <Input
                  id="cad-wid-shrink"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  max={99.99}
                  value={value.width_shrink_pct}
                  onChange={(e) => set({ width_shrink_pct: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label="Cut Type" w="term" htmlFor="cad-cut-type">
            <Select id="cad-cut-type" value={value.cut_type} onChange={(e) => set({ cut_type: e.target.value as CutType | "" })}>
              <option value="" />
              {CUT_TYPES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
      </DetailSection>
      <OrderSheetSection
        components={components}
        sizes={sizes}
        cuts={value.component_cuts}
        onChange={(component_cuts) => set({ component_cuts })}
      />
    </>
  );
}

/**
 * THE ORDER SHEET, EMBEDDED (record-1790318990226.wav, 2026-09-25): the style's
 * sizes and components as the order declares them — coordinate, component,
 * structure, GSM — fetched, never retyped; plus the two things the CAD master
 * adds per panel: the Cut Method and a NOTE (piece weight, an opening-dia
 * adjustment), so nothing lives in an outside spreadsheet.
 *
 * NO DIA COLUMN, DELIBERATELY. The order holds no dia: dia exists only on the
 * Fabric BOM, and the Fabric BOM cannot be created until this CAD is approved
 * (0628's guard). A dia column here would be empty on every order, every time.
 * A dia the pattern depends on goes in the row's Notes.
 *
 * THE ROWS ARE THE STYLE'S, TODAY, PLUS WHAT THE VERSION ALREADY HOLDS. An
 * entry on a component the style has since dropped is still listed — tagged —
 * so an edit cannot silently erase it (the "Disabled rows" rule). A row with
 * neither a method nor a note is simply not stored (0638's trigger agrees).
 *
 * Used by Assign and by the Pattern Master's own step (`PatternWorkForm`), so
 * the two can never list different rows or store notes differently.
 */
export function OrderSheetSection({
  components,
  sizes,
  cuts,
  onChange,
}: {
  components: StyleComponent[];
  sizes: string[];
  cuts: ComponentCut[];
  onChange: (next: ComponentCut[]) => void;
}) {
  // An entry saved before 0637 carries no coordinate: it still answers for its
  // component on every coordinate, until something is changed on that row.
  type Row = StyleComponent & { gone?: boolean };
  const heldFor = (c: StyleComponent) =>
    cuts.find((x) => cutKey(x) === cutKey(c)) ??
    cuts.find((x) => !x.coordinate_id && x.component_id === c.component_id);
  const rows: Row[] = [
    ...components,
    ...cuts
      .filter((x) => !components.some((c) => heldFor(c) === x))
      .map((x) => ({
        component_id: x.component_id,
        name: x.component_name,
        coordinate_id: x.coordinate_id ?? null,
        coordinate_name: x.coordinate_name ?? null,
        structure: null,
        gsm: null,
        gone: true,
      })),
  ];

  /** One row changed: stored while it holds a method OR a note (0638), dropped when both are blank. */
  function patch(comp: StyleComponent, next: { method?: CutMethod | null; notes?: string }) {
    const held = heldFor(comp);
    const rest = cuts.filter((x) => x !== held);
    const method = next.method !== undefined ? next.method : (held?.method ?? null);
    const notes = next.notes !== undefined ? next.notes : (held?.notes ?? "");
    if (!method && !notes?.trim()) {
      onChange(rest);
      return;
    }
    onChange([
      ...rest,
      {
        component_id: comp.component_id,
        component_name: comp.name,
        coordinate_id: comp.coordinate_id,
        coordinate_name: comp.coordinate_name,
        method,
        notes: notes || null,
      },
    ]);
  }

  const gridRows = rows.map((c) => ({ ...c, key: cutKey(c) }));
  type GridRow = (typeof gridRows)[number];
  /** The rail's rows — one per coordinate, its components in the style's order. */
  type CoordRow = { key: string; name: string; rows: GridRow[] };
  const coordRows: CoordRow[] = [];
  for (const r of gridRows) {
    const k = r.coordinate_id ?? "";
    const held = coordRows.find((g) => g.key === `co:${k}`);
    if (held) held.rows.push(r);
    else coordRows.push({ key: `co:${k}`, name: r.coordinate_name ?? "—", rows: [r] });
  }
  // COMPACTED (user 2026-09-26, screenshot 3105): each column sized to its
  // value — Component and Structure code 144 (long names truncate and reveal
  // on hover), GSM num 72, Cut Method term 176 ("Bit Form Cutting" + clear +
  // chevron), Notes name 288. NO COORDINATE COLUMN: the side rail names the
  // coordinate (screenshot 3106). 144 × 2 + 72 + 176 + 288 = 824 + 72 chrome
  // = 896 ≤ 1,155 (check:grid-budget). Three facts from the order, two fields.
  const orderSheetColumns: ChildGridColumn<GridRow>[] = [
    {
      header: "Component",
      width: FIELD_WIDTH_CSS.code,
      cell: (c) => (
        <span className="min-w-0 leading-tight">
          <Truncated className="text-sm">{c.name}</Truncated>
          {c.gone && <span className="block text-xs text-warning">No longer on the style</span>}
        </span>
      ),
    },
    {
      header: "Structure",
      width: FIELD_WIDTH_CSS.code,
      cell: (c) => <Truncated className="text-sm">{c.structure ?? "—"}</Truncated>,
    },
    {
      header: "GSM",
      width: FIELD_WIDTH_CSS.num,
      align: "right",
      cell: (c) => <span className="text-sm tabular-nums">{c.gsm ?? "—"}</span>,
    },
    {
      header: "Cut Method",
      width: FIELD_WIDTH_CSS.term,
      cell: (c) => (
        <Select
          aria-label={`Cut Method — ${c.coordinate_name ? `${c.coordinate_name} ` : ""}${c.name}`}
          value={heldFor(c)?.method ?? ""}
          onChange={(e) => patch(c, { method: (e.target.value || null) as CutMethod | null })}
        >
          <option value="" />
          {CUT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Notes",
      width: FIELD_WIDTH_CSS.name,
      cell: (c) => (
        <Input
          aria-label={`Notes — ${c.coordinate_name ? `${c.coordinate_name} ` : ""}${c.name}`}
          value={heldFor(c)?.notes ?? ""}
          onChange={(e) => patch(c, { notes: e.target.value })}
        />
      ),
    },
  ];

  return (
    // frameless: the grid draws the one frame (ONE FRAME PER GRID).
    <DetailSection
      label="Order Sheet"
      frameless
    >
      {/* SIZES UNDER THE LABEL, LEFT-ALIGNED (user 2026-09-26: "need better
          place to view, now look unaligned"). It sat in the header's right-hand
          slot — the pane's far edge — while the grid below stopped ~900px in,
          so it floated beside nothing. Here it starts on the rail's own left
          edge. */}
      {sizes.length > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="mr-1.5 font-semibold uppercase tracking-wide">Sizes</span>
          <span className="font-medium text-foreground">{sizes.join(" · ")}</span>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This style has no components yet — add them on Order Info ▸ Style Components.
        </p>
      ) : (
        /* THE COORDINATES IN A SIDE RAIL, EACH ONE'S COMPONENTS AS A TABLE
           (user 2026-09-26, screenshot 3106: "use our side rail and with table
           concept, like we use in every listing"). Manual's shape —
           `masterDetail` on the outer grid, a plain table inside the open row —
           so PIECES / TOP / BOTTOM read as a list and the parts under one read
           as a table, instead of a Coordinate cell repeated on every line.
           default-row: exempt -- both levels are DERIVED from the style's
           components; nothing here can grow, so no seed, no + Add, no ✕. */
        <ChildGrid<CoordRow>
          columns={[]}
          rows={coordRows}
          forceCards
          flatRows
          fill
          foldRows
          masterDetail
          railAlways
          railWidthPx={180}
          defaultOpenKey={coordRows[0]?.key ?? null}
          renderListItem={(g) => (
            <div className="flex min-h-7 items-center">
              <span className="min-w-0 flex-1">
                <Truncated className="block text-[12.5px] font-medium leading-tight text-foreground">
                  {g.name}
                </Truncated>
                <span className="block text-[10px] leading-tight text-muted-foreground">
                  {g.rows.length} {g.rows.length === 1 ? "part" : "parts"}
                </span>
              </span>
            </div>
          )}
          renderFoldedRow={(g) => <span className="text-sm font-medium">{g.name}</span>}
          hideAdd
          hideRemove
          keepOne={false}
          onAdd={() => false}
          onRemove={() => {}}
          renderMobileRow={(g) => (
            /* NO `tableFrom`, Manual's sizes-grid call: inside the rail's detail
               pane a 5xl (1,024px) threshold is never reached on a laptop, so
               the table would fall to cards. The primitive's default (@lg,
               512px) keeps it a table; its columns sum to 896px. */
            <ChildGrid<GridRow>
              /* grid-caption: exempt -- the rail item names this table. */
              columns={orderSheetColumns}
              rows={g.rows}
              hideAdd
              hideRemove
              keepOne={false}
              onAdd={() => false}
              onRemove={() => {}}
              renderMobileRow={(row, i) => (
                <FieldRow align="start" gap="tight">
                  {orderSheetColumns.map((c, ci) => (
                    <Field key={ci} label={c.header} w={fieldWidthStep(c.width) ?? "hug"}>
                      {c.cell(row, i)}
                    </Field>
                  ))}
                </FieldRow>
              )}
            />
          )}
        />
      )}
    </DetailSection>
  );
}

/**
 * The same details, read-only, as [label, text] lines — the History card
 * renders them with its own `Fact` so the layout stays that file's.
 */
export function patternFactLines(v: {
  fit_wash: boolean;
  length_shrink_pct: number | null;
  width_shrink_pct: number | null;
  cut_type: string | null;
  component_cuts: ComponentCut[];
}): [string, string][] {
  const lines: [string, string][] = [
    ["Bit Wash", v.fit_wash ? `Yes · length ${v.length_shrink_pct ?? "—"}% · width ${v.width_shrink_pct ?? "—"}%` : "No"],
  ];
  if (v.cut_type) lines.push(["Cut Type", cutTypeLabel(v.cut_type)]);
  if (v.component_cuts.length > 0) {
    lines.push([
      "Cut Method",
      v.component_cuts
        .map(
          (c) =>
            `${c.coordinate_name ? `${c.coordinate_name} ` : ""}${c.component_name}: ${cutMethodLabel(c.method)}` +
            (c.notes ? ` (${c.notes})` : ""),
        )
        .join(" · "),
    ]);
  }
  return lines;
}
