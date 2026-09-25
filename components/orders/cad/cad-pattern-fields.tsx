"use client";

/**
 * The CAD version's PATTERN DETAILS (0632) — the Order Entry ▸ CAD spec's
 * "Compact CAD Entry Details": Bit Wash (the spec's "Fit Wash Process", renamed
 * by the user 2026-09-25 — LABEL only, the column stays `fit_wash`; on Yes, the two shrinkage
 * percentages), Cut Type, and a Cut Method per style component.
 *
 * ITS OWN FILE so the Allocation sheet gains one element, not forty lines —
 * and the History card reads the same words through `PatternDetailsView`.
 *
 * THE COMPONENT LIST IS THE STYLE'S, TODAY, PLUS WHAT THE VERSION ALREADY HOLDS.
 * Rows come from Order Info ▸ Style Components (`row.components`). A method
 * saved on a component the style has since dropped is still listed — tagged —
 * so an edit cannot silently erase it (the "Disabled rows" rule: a filled field
 * shown empty is lost on the next save). A blank method is simply not stored.
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
  errors,
}: {
  value: PatternDetailsValue;
  onChange: (next: PatternDetailsValue) => void;
  components: StyleComponent[];
  errors?: { length?: string; width?: string };
}) {
  const set = (patch: Partial<PatternDetailsValue>) => onChange({ ...value, ...patch });

  // Today's components, then any held method whose component left the style.
  // An entry saved before 0637 carries no coordinate: it still answers for its
  // component on every coordinate, until a method is picked for that row.
  type Row = StyleComponent & { gone?: boolean };
  const heldFor = (c: StyleComponent) =>
    value.component_cuts.find((x) => cutKey(x) === cutKey(c)) ??
    value.component_cuts.find((x) => !x.coordinate_id && x.component_id === c.component_id);
  const rows: Row[] = [
    ...components,
    ...value.component_cuts
      .filter((x) => !components.some((c) => heldFor(c) === x))
      .map((x) => ({
        component_id: x.component_id,
        name: x.component_name,
        coordinate_id: x.coordinate_id ?? null,
        coordinate_name: x.coordinate_name ?? null,
        structure: null,
        gone: true,
      })),
  ];
  function setMethod(comp: StyleComponent, method: CutMethod | "") {
    const held = heldFor(comp);
    const rest = value.component_cuts.filter((x) => x !== held);
    set({
      component_cuts: method
        ? [
            ...rest,
            {
              component_id: comp.component_id,
              component_name: comp.name,
              coordinate_id: comp.coordinate_id,
              coordinate_name: comp.coordinate_name,
              method,
            },
          ]
        : rest,
    });
  }

  const gridRows = rows.map((c) => ({ ...c, key: cutKey(c) }));
  type GridRow = (typeof gridRows)[number];
  // Four vocabulary widths: 176 × 4 = 704 + 72 chrome = 776 ≤ 1155
  // (check:grid-budget). Coordinate / Component / Structure are facts from
  // Order Info ▸ Style Components; the method is the one field per row.
  const componentCutColumns: ChildGridColumn<GridRow>[] = [
    { header: "Coordinate", width: FIELD_WIDTH_CSS.term, cell: (c) => <Truncated className="text-sm">{c.coordinate_name ?? "—"}</Truncated> },
    {
      header: "Component",
      width: FIELD_WIDTH_CSS.term,
      cell: (c) => (
        <span className="min-w-0 leading-tight">
          <Truncated className="text-sm">{c.name}</Truncated>
          {c.gone && <span className="block text-xs text-warning">No longer on the style</span>}
        </span>
      ),
    },
    { header: "Structure", width: FIELD_WIDTH_CSS.term, cell: (c) => <Truncated className="text-sm">{c.structure ?? "—"}</Truncated> },
    {
      header: "Cut Method",
      width: FIELD_WIDTH_CSS.term,
      cell: (c) => (
        <Select
          aria-label={`Cut Method — ${c.coordinate_name ? `${c.coordinate_name} ` : ""}${c.name}`}
          value={heldFor(c)?.method ?? ""}
          onChange={(e) => setMethod(c, e.target.value as CutMethod | "")}
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
  ];

  return (
    <>
      <DetailSection label="Pattern Details">
        {/* code 144 + term 176 + gap 12 = 332. */}
        <FieldRow align="start">
          <Field label="Bit Wash" w="code" htmlFor="cad-fit-wash">
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
      {/* frameless: the grid draws the one frame (ONE FRAME PER GRID). */}
      <DetailSection label="Component Cut Method" frameless>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This style has no components yet — add them on Order Info ▸ Style Components.
          </p>
        ) : (
          /* default-row: exempt -- rows are DERIVED from the style's components;
             it cannot grow, so no seed, no + Add, no ✕ (advised-lines precedent). */
          <ChildGrid<GridRow>
            columns={componentCutColumns}
            rows={gridRows}
            tableFrom="5xl"
            flatRows
            hideAdd
            hideRemove
            keepOne={false}
            onAdd={() => false}
            onRemove={() => {}}
            renderMobileRow={(row, i) => (
              <FieldRow align="start" gap="tight">
                {componentCutColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} w={fieldWidthStep(c.width) ?? "hug"}>
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldRow>
            )}
          />
        )}
      </DetailSection>
    </>
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
    lines.push(["Cut Method", v.component_cuts
          .map((c) => `${c.coordinate_name ? `${c.coordinate_name} ` : ""}${c.component_name}: ${cutMethodLabel(c.method)}`).join(" · ")]);
  }
  return lines;
}
