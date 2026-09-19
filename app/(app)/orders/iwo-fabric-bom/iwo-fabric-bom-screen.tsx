"use client";

/**
 * Orders ▸ Order Execution ▸ IWO Fabric BOM — the order Fabric BOM screen,
 * DUPLICATED for an Internal Work Order For Yarn or Fabric (client 2026-09-18,
 * screenshots 2937 / 2938 / 2940; 0581).
 *
 * THE ORDER SCREEN IS NOT TOUCHED. `app/(app)/orders/fabric-bom/` is left
 * exactly as it is; this file copies its shape and its parts (the rail, the
 * header row, the four Color/Print panels — `PaletteTable` below is a copy)
 * and drops what only an order has: the garment-order picker, the production
 * strip, colourways, styles, garment components and the size-by-size Manual
 * grams. Req Wt (KGS) is typed instead (SRS §4).
 *
 * BUILT A TAB AT A TIME, and each tab's list is sent only once the tab exists:
 * the save leaves any child list the payload omits untouched (types.ts), so a
 * BOM saved from this step never wipes what a later step stored.
 *
 * Step 1: the list of IWOs, and the "Fabric BOM" section — header plus
 * Fabric Colour / Yarn Colour / Roll form prints / Dia panels.
 *
 * Step 2: Fabric Allocation (which cloth, in which colour) and Fabric
 * Consumption (form, GSM, finish dia, stage, and the typed Req Wt) — ONE list
 * of fabric lines shown on two sections, as the order screen shows its lines
 * on Fabric Allocation and Manual.
 *
 * Step 3: Yarn Process and Fabric Process — the order screen's two fold
 * lists and its two shared grids (`YarnProcessGrid`, `FabricProcessGrid`),
 * and the ORDER ENGINE for every weight (`yarnPurchase`, `comboUplift`). The
 * only link replaced is where a fabric's gross comes from: the typed Req Wt,
 * through `lib/orders/iwo-fabric-bom/yarn.ts` — the same helpers the save
 * uses, so the preview and the stored figure are one computation.
 *
 * Step 4: For = Yarn (screenshot 2937) — the fabric sections are BYPASSED. The
 * planner picks each yarn on a Yarn Lines grid with the stage it is bought in
 * and a Planned Weight; Yarn Process then lists those picked yarns, and each
 * purchase is the Planned Weight through the yarn's own stages
 * (`iwoYarnModePurchase`, the same helper the save calls).
 *
 * 0592 (client audio 2026-09-19): a Yarn line's Stage decides its shape. GREY
 * is one Planned Weight; DYED takes "Colour by" (Dyed Purchase / Yarn Dyeing)
 * and its SHADES in a [Shades] popup (`yarn-shades-sheet.tsx`), and its
 * Planned Weight becomes Σ shades. Each shade is its own bucket in the engine,
 * so Yarn Process offers the shades in its For column with no new code there.
 *
 * Phase 2 (same audio): a fabric line's Stage decides its shape too. GREIGE
 * has no colour (the colourways consolidate into one line) and its route stops
 * at Greige; a coloured stage owes its Colour; one Stage per fabric; one line
 * per (fabric, colour, dia). Finish Dia picks from the Dia panel.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, ListChecks, Scale, Shirt, Spool, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldGrid, FieldRow, FIELD_WIDTH_CSS, RequiredScope } from "@/components/ui/field";
import { ChildGrid, gridKeyNav, type ChildGridColumn } from "@/components/masters/child-grid";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useOpenIntent } from "@/lib/use-open-intent";
import { sectionValidity } from "@/lib/screens/validity";
import { IWO_FOR_LABELS } from "@/lib/orders/internal-work-orders/types";
import { KNIT_TYPE_OPTIONS, type PaletteSection } from "@/lib/orders/iwo-fabric-bom/types";
import { deleteIwoFabricBom, saveIwoFabricBom } from "@/lib/orders/iwo-fabric-bom/actions";
import type { IwoFabricBomFormData, IwoFabricBomTask } from "@/lib/orders/iwo-fabric-bom/service";
import {
  iwoFabricLineProblems,
  iwoFabricStages,
  iwoGreigeRouteProblems,
  keptIwoFabricLines,
  type IwoFabricLineFacts,
} from "@/lib/orders/iwo-fabric-bom/lines";
import { FABRIC_FORM_OPTIONS } from "@/lib/orders/fabric-bom/component-map";
import { isYarnDyed } from "@/lib/orders/fabric-bom/fabric-line-rules";
import { ProcessFoldList, type FoldListColumn } from "@/components/orders/process-fold-list";
import { FabricProcessGrid } from "@/components/orders/fabric-process-grid";
import { YarnProcessGrid } from "@/components/orders/yarn-process-grid";
// The order screen's composition loader — keyed by FABRIC only (material_mixings),
// so it serves an IWO unchanged. Reused, not copied.
import { loadBomYarnComposition } from "@/lib/orders/fabric-bom/actions";
import {
  comboUplift,
  deriveYarnRows,
  isRefusal,
  yarnPurchase,
  yarnRowAnswered,
  type FabricComposition,
  type YarnRow,
  type YarnStageRow,
} from "@/lib/orders/fabric-bom/yarn-process";
import { routeStepCount, type FabricProcessRow } from "@/lib/orders/fabric-bom/processes";
import { colouredStageIds, stageRank, stageRouteProblems } from "@/lib/orders/fabric-bom/stage-routes";
import { fabricFormLabel } from "@/lib/orders/fabric-bom/component-map";
import {
  IWO_COLOUR_BY_OPTIONS,
  iwoFabricGross,
  iwoRoutesByFabric,
  iwoYarnModePurchase,
  type IwoColourBy,
} from "@/lib/orders/iwo-fabric-bom/yarn";
import {
  iwoShadeTotal,
  iwoYarnLineProblems,
  keptIwoYarnLines,
  keptIwoYarnShades,
} from "@/lib/orders/iwo-fabric-bom/lines";
import type { SheetOrigin } from "@/components/ui/sheet";
import { YarnShadesSheet, type ShadeRow } from "./yarn-shades-sheet";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

// React keys from a module counter, as the order screen does — not a ref, which
// the React Compiler lint objects to reading during render.
let keySeq = 0;
const newKey = () => `k${keySeq++}`;

type PaletteRow = { key: string; value: string };
type DiaRow = { key: string; knit_type: string; dia: string };
type Palette = Record<PaletteSection, PaletteRow[]>;

// EVERY SEED IS BLANK — the save drops a blank row by testing what is typed.
const blankPaletteRow = (): PaletteRow => ({ key: newKey(), value: "" });
const blankDia = (): DiaRow => ({ key: newKey(), knit_type: "", dia: "" });
const blankPalette = (): Palette => ({
  fabric: [blankPaletteRow()],
  yarn: [blankPaletteRow()],
  print: [blankPaletteRow()],
});

type Form = { iwo_id: string | null; bom_date: string };

/**
 * One fabric line, as the two grids edit it. Numbers are held as the TEXT
 * typed, so a half-typed "12." is not rewritten under the caret; `lineFacts`
 * turns them into numbers (NaN for a non-number, refused by name).
 */
type LineRow = {
  key: string;
  structure_id: string | null;
  item_id: string | null;
  color_name: string;
  fabric_form: string;
  mixing_uom_id: string | null;
  no_of_colors: string;
  gsm: string;
  finish_dia: string;
  stage_id: string | null;
  req_kgs: string;
};

const blankLine = (): LineRow => ({
  key: newKey(),
  structure_id: null,
  item_id: null,
  color_name: "",
  fabric_form: "",
  mixing_uom_id: null,
  no_of_colors: "",
  gsm: "",
  finish_dia: "",
  stage_id: null,
  req_kgs: "",
});

/** A For = Yarn line (step 4): the yarn, its Stage, and either the Planned
 *  Weight typed (GREY) or Colour by + its shades (DYED, 0592). */
type YarnLineRow = {
  key: string;
  item_id: string | null;
  buy_stage_id: string | null;
  planned_kgs: string;
  colour_by: IwoColourBy | "";
  shades: ShadeRow[];
};
// EVERY SEED IS BLANK — the save drops an untouched yarn line (and an untouched
// shade) by testing what is typed. One blank shade stands ready, so the Shades
// popup never opens on a bare "+ Add" (AGENTS.md, default rows).
const blankShade = (): ShadeRow => ({ key: newKey(), color_name: "", planned_kgs: "" });
const blankYarnLine = (): YarnLineRow => ({
  key: newKey(),
  item_id: null,
  buy_stage_id: null,
  planned_kgs: "",
  colour_by: "",
  shades: [blankShade()],
});

/** "" → null; anything else → a number, or NaN for a non-number. */
const num = (v: string): number | null => {
  const t = v.trim().replace(/,/g, "");
  return t === "" ? null : Number(t);
};
const str = (n: number | null | undefined) => (n == null ? "" : String(n));
const kg = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const lineFacts = (l: LineRow): IwoFabricLineFacts => ({
  structure_id: l.structure_id,
  item_id: l.item_id,
  color_name: l.color_name.trim() || null,
  fabric_form: l.fabric_form || null,
  mixing_uom_id: l.mixing_uom_id,
  no_of_colors: num(l.no_of_colors),
  gsm: num(l.gsm),
  finish_dia: l.finish_dia.trim() || null,
  stage_id: l.stage_id,
  req_kgs: num(l.req_kgs),
});

/** "No fabrics" is DERIVED, never stored — the order screen's `EMPTY_COMPOSITION`,
 *  a module constant so its identity is stable across renders. */
const EMPTY_COMPOSITION: {
  compositions: FabricComposition[];
  yarns: { id: string; name: string; inactive: boolean }[];
} = { compositions: [], yarns: [] };

/** One distinct value, else "(mixed)" — how the order screen's fold rows roll up
 *  a fact several lines of one fabric state. */
const rollUp = (values: readonly string[]) => {
  const distinct = [...new Set(values.filter(Boolean))];
  return distinct.length <= 1 ? (distinct[0] ?? "") : "(mixed)";
};

/** Upper-cased and trimmed for COMPARISON only — the order palette's rule. */
const normName = (v: string) => v.trim().toUpperCase();

/**
 * A HAND-ROLLED TABLE THAT IS STILL A GRID TO THE KEYBOARD — copied from the
 * order Fabric BOM (`fabric-bom-screen.tsx`, `PaletteTable`), where the four
 * Color/Print panels left `ChildGrid` because its table mode only switches in
 * above ~512px and four panels do not fit that side by side. It carries the
 * markers the keyboard contract steers by, so none of it is per-screen code:
 *
 *   `data-grid-body` + `gridKeyNav` — the row axis, and Ctrl+Del
 *   `data-grid-row`                  — what ↑/↓ step between
 *   `data-row-remove` + aria-label   — Ctrl+Del drives this by `.click()`
 *   `data-row-add`                   — what Enter off the last field lands on
 */
function PaletteTable<T extends { key: string }>({
  label,
  columns,
  rows,
  onAdd,
  onRemove,
  addLabel,
  width,
}: {
  label: string;
  columns: ChildGridColumn<T>[];
  rows: readonly T[];
  onAdd: () => void;
  onRemove: (row: T) => void;
  addLabel: string;
  /** A STATIC literal per call site — Tailwind scans source text. */
  width: string;
}) {
  return (
    <div className={cn("min-w-0 flex-1", width)}>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-9" />
            {columns.map((c) => (
              <col key={c.header} />
            ))}
            <col className="w-8" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="px-1.5 py-1.5 text-center text-[12.5px] font-semibold text-foreground">#</th>
              {columns.map((c) => (
                // truncate-reveal: exempt -- a column header from this file's own fixed vocabulary ("Fabric Colour", "Dia / Size / Width"), never a stored value
                <th key={c.header} className="truncate border-l border-border px-1.5 py-1.5 text-left text-[12.5px] font-semibold text-foreground">
                  {c.header}
                </th>
              ))}
              <th className="border-l border-border" />
            </tr>
          </thead>
          <tbody data-grid-body onKeyDown={(e) => gridKeyNav(e)}>
            {rows.map((row, i) => (
              <tr key={row.key} data-grid-row className="border-b border-border last:border-0">
                <td className="px-1.5 py-1 text-center text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                {columns.map((c, ci) => (
                  <td key={c.header} className="border-l border-border/50 px-1.5 py-1">
                    {c.cell(row, ci)}
                  </td>
                ))}
                <td className="border-l border-border/50 px-0.5 py-1 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-row-remove
                    aria-label={`Remove ${label.toLowerCase()} row ${i + 1}`}
                    className="px-1 text-danger hover:text-danger"
                    onClick={() => onRemove(row)}
                  >
                    {"✕"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" data-row-add className="mt-2" onClick={onAdd}>
        {addLabel}
      </Button>
    </div>
  );
}

export function IwoFabricBomScreen({
  tasks,
  data,
  perms,
}: {
  tasks: IwoFabricBomTask[];
  data: IwoFabricBomFormData;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");


  /** Leaving the editor goes back to the WORK ORDER (2026-09-20): this

   *  screen has no entry of its own on Order Execution any more — it is

   *  opened from the work order, so that is where closing it returns. */

  function leaveEditor() {

    setMode("list");

    router.push("/orders/internal-work-orders");

  }
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ iwo_id: null, bom_date: today() });
  const [palette, setPalette] = useState<Palette>(blankPalette);
  const [dias, setDias] = useState<DiaRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  /** Fabric Process (step 3): every fabric's route in one list, keyed by
   *  `item_id` — the order screen's `procs`. */
  const [procs, setProcs] = useState<FabricProcessRow[]>([]);
  /** Yarn Process (step 3): each yarn's OWN stages, keyed by yarn id so
   *  re-deriving the yarn list can never move a stage to another yarn. */
  const [yarnAnswers, setYarnAnswers] = useState<Record<string, { stages: YarnStageRow[] }>>({});
  /** `undefined` = not touched yet, so the FIRST row opens by itself (the
   *  operator reported the process tabs as "blank, no fields" when every row
   *  started shut); `null` = closed by the operator; a key = that row open. */
  const [openYarnId, setOpenYarnId] = useState<string | null | undefined>(undefined);
  /** For = Yarn (step 4): the picked yarns and their Planned Weight. */
  const [yarnLines, setYarnLines] = useState<YarnLineRow[]>([]);
  /** The yarn line whose [Shades] popup is open, and the button it grew from. */
  const [shadesFor, setShadesFor] = useState<string | null>(null);
  const [shadesOrigin, setShadesOrigin] = useState<SheetOrigin | null>(null);
  const [openFabricId, setOpenFabricId] = useState<string | null | undefined>(undefined);
  /** The compositions behind the lines' fabrics, keyed with the question it
   *  answers so a late reply is never shown against changed fabrics. */
  const [compState, setCompState] = useState<{
    forFabrics: string;
    compositions: FabricComposition[];
    yarns: { id: string; name: string; inactive: boolean }[];
  } | null>(null);

  /** Real edits only — see the order screen's note; an overlay's own guard is
   *  not read by `confirmDiscard()`, so this is what protects the typing. */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const picked = form.iwo_id ? (taskById.get(form.iwo_id) ?? null) : null;

  /** The IWO picker offers work orders WITHOUT a BOM — one BOM per IWO (0581);
   *  the one this BOM already names always survives. */
  const iwoItems: PickerItem[] = tasks
    .filter((t) => !t.bom || t.id === form.iwo_id)
    .map((t) => ({ id: t.id, code: t.code, name: t.code ?? "(unnumbered)", inactive: false }));

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutPalette = (section: PaletteSection, fn: (xs: PaletteRow[]) => PaletteRow[]) => {
    setPalette((p) => ({ ...p, [section]: fn(p[section]) }));
    setDirty(true);
  };
  const mutDias = (fn: (xs: DiaRow[]) => DiaRow[]) => {
    setDias(fn);
    setDirty(true);
  };
  const patchLine = (key: string, patch: Partial<LineRow>) => {
    setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setDirty(true);
  };

  const fabricById = useMemo(() => new Map(data.fabrics.map((f) => [f.id, f])), [data.fabrics]);
  const fabricTypeOf = (itemId: string | null) => (itemId ? (fabricById.get(itemId)?.fabric_type ?? null) : null);

  // ---- open ------------------------------------------------------------------

  /** Seeds every grid BEFORE `setDirty(false)` — never through `onAdd`, which
   *  would open every record reading "Unsaved changes". */
  function openNew(iwoId: string | null) {
    setEditId(null);
    setForm({ iwo_id: iwoId, bom_date: today() });
    setPalette(blankPalette());
    setDias([blankDia()]);
    setLines([blankLine()]);
    setProcs([]);
    setYarnAnswers({});
    setYarnLines([blankYarnLine()]);
    setOpenYarnId(undefined);
    setOpenFabricId(undefined);
    setDirty(false);
    setMode("edit");
  }

  function openTask(t: IwoFabricBomTask) {
    const b = t.bom;
    if (!b) return openNew(t.id);
    setEditId(b.id);
    setForm({ iwo_id: t.id, bom_date: b.bom_date });
    const of = (section: PaletteSection) => {
      const rows = b.iwo_fabric_bom_palette
        .filter((r) => r.section === section)
        .map((r) => ({ key: newKey(), value: r.name }));
      return rows.length ? rows : [blankPaletteRow()];
    };
    setPalette({ fabric: of("fabric"), yarn: of("yarn"), print: of("print") });
    const d = b.iwo_fabric_bom_dias.map((r) => ({
      key: newKey(),
      knit_type: r.knit_type ?? "",
      dia: r.dia ?? "",
    }));
    setDias(d.length ? d : [blankDia()]);
    const ls = (b.iwo_fabric_bom_lines ?? []).map((r) => ({
      key: newKey(),
      structure_id: r.structure_id,
      item_id: r.item_id,
      color_name: r.color_name ?? "",
      fabric_form: r.fabric_form ?? "",
      mixing_uom_id: r.mixing_uom_id,
      no_of_colors: str(r.no_of_colors),
      gsm: str(r.gsm),
      finish_dia: r.finish_dia ?? "",
      stage_id: r.stage_id,
      req_kgs: str(r.req_kgs),
    }));
    setLines(ls.length ? ls : [blankLine()]);
    setProcs(
      (b.iwo_fabric_bom_processes ?? []).map((r) => ({
        key: newKey(),
        item_id: r.item_id,
        combo: null,
        component_id: null,
        stage_id: r.stage_id,
        process_id: r.process_id,
        loss_for_id: r.loss_for_id,
        loss_pct: str(r.loss_pct),
        type_id: r.type_id,
      })),
    );
    setYarnAnswers(
      Object.fromEntries(
        (b.iwo_fabric_bom_yarns ?? []).map((y) => [
          y.item_id,
          {
            stages: y.iwo_fabric_bom_yarn_stages.map((st) => ({
              key: newKey(),
              stage_id: st.stage_id,
              process_id: st.process_id,
              loss_for_id: st.loss_for_id,
              combo: st.combo ?? "",
              description: st.description ?? "",
              loss_pct: str(st.loss_pct),
            })),
          },
        ]),
      ),
    );
    // On a For = Yarn BOM the stored yarns ARE the typed lines; on a For =
    // Fabric one they are derived, and the Yarn Lines grid is not shown.
    const yl =
      t.iwo_for === "yarn"
        ? (b.iwo_fabric_bom_yarns ?? []).map((y) => {
            const shades = (y.iwo_fabric_bom_yarn_shades ?? []).map((sh) => ({
              key: newKey(),
              color_name: sh.color_name,
              planned_kgs: str(sh.planned_kgs),
            }));
            return {
              key: newKey(),
              item_id: y.item_id,
              buy_stage_id: y.buy_stage_id,
              planned_kgs: str(y.planned_kgs),
              colour_by: y.colour_by ?? ("" as const),
              shades: shades.length ? shades : [blankShade()],
            };
          })
        : [];
    setYarnLines(yl.length ? yl : [blankYarnLine()]);
    setOpenYarnId(undefined);
    setOpenFabricId(undefined);
    setDirty(false);
    setMode("edit");
  }

  /** `?open=<iwoId>` — the IWO screen's "Open Fabric BOM" lands here, IN that work
   *  order's BOM (a new one when it has none). Declared after `openTask`, above
   *  any branch; an id this unit cannot see opens nothing. */
  useOpenIntent((iwoId) => {
    const t = taskById.get(iwoId);
    if (t && (t.bom ? perms.canEdit : perms.canCreate)) openTask(t);
  });

  // ---- Yarn Process + Fabric Process (step 3) -------------------------------

  /** The fabrics the lines name, as one key — what the composition load answers. */
  const fabricIdKey = [...new Set(lines.map((l) => l.item_id).filter(Boolean))].sort().join(",");

  useEffect(() => {
    // No round trip for no fabrics — that case is DERIVED below (`comp`), never
    // stored from the effect body (react-hooks/set-state-in-effect).
    if (!fabricIdKey) return;
    let cancelled = false;
    loadBomYarnComposition(fabricIdKey.split(",")).then((res) => {
      if (cancelled || !res.ok) return;
      setCompState({ forFabrics: fabricIdKey, ...res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [fabricIdKey]);

  const comp = !fabricIdKey
    ? EMPTY_COMPOSITION
    : compState && compState.forFabrics === fabricIdKey
      ? compState
      : null;

  /** FOR = YARN (step 4) — read off the IWO, never a toggle on this screen. */
  const yarnMode = picked?.iwo_for === "yarn";
  const yarnById = new Map(data.yarns.map((y) => [y.id, y]));

  /** THE YARN ROWS. On a For = Fabric BOM, derived from what the cloths are
   *  made of (`deriveYarnRows`, the order screen's own call). On a For = Yarn
   *  BOM, the yarns the planner PICKED on Yarn Lines, once each. */
  const yarnRows: YarnRow[] = yarnMode
    ? [...new Set(yarnLines.map((l) => l.item_id).filter((x): x is string => !!x))].map((id) => ({
        key: id,
        item_id: id,
        name: yarnById.get(id)?.name ?? "",
        inactive: yarnById.get(id)?.inactive ?? false,
        fabrics: [],
        stages: yarnAnswers[id]?.stages ?? [],
      }))
    : comp
      ? deriveYarnRows(
          comp.compositions,
          new Map(comp.yarns.map((y) => [y.id, { name: y.name, inactive: y.inactive }])),
          new Map(Object.entries(yarnAnswers)),
        )
      : [];

  const compositionById = new Map((comp?.compositions ?? []).map((c) => [c.fabric_id, c]));

  /** The gross KGS per fabric — the typed Req Wt, through the SAME helper the
   *  save calls (`iwoFabricGross`). */
  const fabricGross = iwoFabricGross(
    lines.map((l) => ({ item_id: l.item_id, req_kgs: num(l.req_kgs) })),
    data.kgUom?.id ?? null,
    (id) => fabricById.get(id)?.name ?? "this fabric",
  );

  /** Each fabric's route with the process master's Knitting/Dyeing kinds — the
   *  same helper the save calls (`iwoRoutesByFabric`). */
  const processKinds = new Map(
    data.processes.map((o) => [o.id, { is_knitting: o.is_knitting ?? false, is_dyeing: o.is_dyeing ?? false }]),
  );
  const routesByFabric = iwoRoutesByFabric(
    procs.map((r) => ({ item_id: r.item_id, stage_id: r.stage_id, process_id: r.process_id, loss_pct: num(r.loss_pct) })),
    processKinds,
  );

  /** GREY or DYED (0592) — `stageRank` via `colouredStageIds`, the Fabric BOM's
   *  own test and the one the save runs; never the word DYED compared here. */
  const dyedStageIds = colouredStageIds(data.yarnStages);
  const isDyedLine = (l: YarnLineRow) => !!l.buy_stage_id && dyedStageIds.has(l.buy_stage_id);
  const shadeFacts = (l: YarnLineRow) =>
    l.shades.map((sh) => ({ color_name: normName(sh.color_name) || null, planned_kgs: num(sh.planned_kgs) }));
  /** The Yarn Colour panel's names — what a shade may be. */
  const yarnColourNames = [...new Set(palette.yarn.map((r) => normName(r.value)).filter(Boolean))];

  /** One yarn's purchase weight, or the refusal standing in for it — the order
   *  engine, with the arguments the save passes (no source; shades on a DYED
   *  Yarn IWO line, 0592). */
  const weightFor = (r: YarnRow) => {
    if (yarnMode) {
      const l = yarnLines.find((x) => x.item_id === r.item_id);
      const dyed = !!l && isDyedLine(l);
      return iwoYarnModePurchase(
        dyed ? null : num(l?.planned_kgs ?? ""),
        r.stages.map((st) => ({ combo: st.combo || null, loss_pct: num(st.loss_pct) })),
        data.kgUom?.id ?? null,
        data.kgUom?.decimals ?? null,
        r.name || "this yarn",
        dyed && l
          ? {
              colourBy: l.colour_by || null,
              shades: keptIwoYarnShades(shadeFacts(l)).map((sh) => ({
                color_name: sh.color_name ?? "",
                planned_kgs: sh.planned_kgs,
              })),
            }
          : null,
      );
    }
    return yarnPurchase(
      r.item_id,
      fabricGross,
      compositionById,
      routesByFabric,
      r.stages.map((st) => ({ combo: st.combo || null, loss_pct: num(st.loss_pct) })),
      data.kgUom?.decimals ?? null,
      new Map(),
      [],
    );
  };

  /** Gross Yarn for one line: its Req Wt through its fabric's route losses
   *  (`comboUplift`, divide by 1 — L, compounded). Blank while either is unknown. */
  const grossYarnFor = (l: LineRow): number | null => {
    const kgs = num(l.req_kgs);
    if (!l.item_id || kgs == null || !(kgs > 0)) return null;
    const factor = comboUplift(routesByFabric.get(l.item_id) ?? [], "", []);
    return isRefusal(factor) ? null : kgs * factor;
  };

  const setYarnStages = (yarnId: string, next: YarnStageRow[]) => {
    setYarnAnswers((prev) => ({ ...prev, [yarnId]: { stages: next } }));
    setDirty(true);
  };
  const setFabricProcs = (itemId: string, next: FabricProcessRow[]) => {
    setProcs((prev) => [...prev.filter((p) => p.item_id !== itemId), ...next]);
    setDirty(true);
  };
  /** A declared Roll form print is what lets a route name a Print step (0528) —
   *  on an IWO the prints are this BOM's own panel. */
  const printDeclared = palette.print.some((r) => r.value.trim());

  // ---- validity ----------------------------------------------------------------

  /** A name typed twice in one panel — the unique index would refuse it; say
   *  so here, naming the panel, before Save is pressed. */
  const PANEL_LABEL: Record<PaletteSection, string> = {
    fabric: "Fabric Colour",
    yarn: "Yarn Colour",
    print: "Roll form prints",
  };
  const duplicateNames = (["fabric", "yarn", "print"] as const).flatMap((section) => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of palette[section]) {
      const n = normName(r.value);
      if (!n) continue;
      if (seen.has(n)) dup.add(n);
      seen.add(n);
    }
    return [...dup].map((n) => `${PANEL_LABEL[section]}: ${n} is listed twice.`);
  });

  /** GREIGE (0) / coloured (≥1) per `fabric_stage` id — `stageRank`, the
   *  Fabric BOM's own test and the one the save runs (Phase 2). */
  const fabricStageById = new Map(
    [...data.processLookups.stages, ...data.fabricStages].map((st) => [st.id, st]),
  );
  const fabricStageRank = (id: string | null) => {
    const st = id ? fabricStageById.get(id) : undefined;
    return st ? stageRank(st) : null;
  };

  /** The line rules (`lines.ts`) — the same function the action runs. */
  const lineProblems = iwoFabricLineProblems(lines.map(lineFacts), (id) => fabricTypeOf(id), fabricStageRank);

  /** Each fabric's line Stage — what decides whether its route stops at Greige. */
  const fabricStageOf = iwoFabricStages(lines.map(lineFacts));
  const isGreigeFabric = (itemId: string) => fabricStageRank(fabricStageOf.get(itemId) ?? null) === 0;

  /** The Fabric Process stage rules (0570) — the order screen's `routeBlockers`,
   *  with this BOM's own prints as the Print gate. */
  const routeBlockers = [
    ...stageRouteProblems(procs, data.processes, data.processLookups.stages, {
      gatesFor: (itemId) => ({ printDeclared, fabricIsYarnDyed: isYarnDyed(fabricTypeOf(itemId)) }),
      fabricName: (itemId) => fabricById.get(itemId)?.name ?? "This fabric",
    }),
    // Phase 2 — a GREIGE fabric's route stops at Greige (the save's rule too).
    ...iwoGreigeRouteProblems(procs, fabricStageOf, (id) => fabricStageRank(id), {
      fabric: (itemId) => fabricById.get(itemId)?.name ?? "This fabric",
      stage: (id) => fabricStageById.get(id)?.name ?? "coloured",
    }),
  ];

  /** "Yarn compositions still loading" — the order screen's guard. Saving now
   *  would send an empty yarn list and the server would refuse it; saying so
   *  here is the kinder half. */
  const yarnsLoading = !yarnMode && !!fabricIdKey && !comp;

  /** For = Yarn: the Yarn Lines rules (`lines.ts`) — the same function the
   *  action runs. A yarn line with stages typed counts as started. */
  const yarnLineFacts = yarnLines.map((l) => {
    const stages = l.item_id ? (yarnAnswers[l.item_id]?.stages ?? []) : [];
    return {
      item_id: l.item_id,
      buy_stage_id: l.buy_stage_id,
      planned_kgs: num(l.planned_kgs),
      hasStages: stages.some((st) => !!(st.stage_id || st.process_id)),
      colour_by: l.colour_by || null,
      shades: shadeFacts(l),
      // "Is this a dyeing step" is the process master's `is_dyeing` — the
      // flag the save reads too (0592 set it on YARN DYEING).
      steps: stages
        .filter((st) => st.process_id)
        .map((st) => ({
          combo: st.combo || null,
          dyeing: !!processKinds.get(st.process_id as string)?.is_dyeing,
        })),
    };
  });
  const yarnLineIssues = yarnMode
    ? iwoYarnLineProblems(yarnLineFacts, {
        isDyedStage: (id) => dyedStageIds.has(id),
        yarnColours: yarnColourNames,
      })
    : [];

  const validity = sectionValidity({
    sections: [
      { key: "bom" },
      { key: "yarnLines", when: () => yarnMode },
      { key: "lines", when: () => !yarnMode },
      { key: "consumption", when: () => !yarnMode },
      { key: "yarns" },
      { key: "process", when: () => !yarnMode },
    ],
    values: form,
    fields: [
      { section: "bom", id: "ifb-iwo", label: "I.WO No", required: true, empty: (f) => !f.iwo_id },
      { section: "bom", id: "ifb-date", label: "Date", required: true, empty: (f) => !f.bom_date },
    ],
    extra: [
      ...(form.bom_date && form.bom_date > today()
        ? [{ section: "bom", label: "Date", message: "The BOM date cannot be in the future.", kind: "custom" as const }]
        : []),
      ...duplicateNames.map((message) => ({ section: "bom", label: "Color/Print", message, kind: "custom" as const })),
      ...lineProblems.map((p) => ({
        section: p.section,
        label: `Fabric line ${p.row}`,
        message: p.message,
        kind: "custom" as const,
      })),
      ...routeBlockers.map((b) => ({ section: "process", label: "Fabric Process", message: b.message, kind: "custom" as const })),
      ...yarnLineIssues.map((y) => ({
        section: y.section ?? "yarnLines",
        label: y.section === "yarns" ? "Yarn Process" : "Yarn Lines",
        message: y.message,
        kind: "custom" as const,
      })),
      ...(yarnsLoading
        ? [{ section: "yarns", label: "Yarn Process", message: "Yarn Process is still reading the fabrics' compositions " + "—" + " save again in a moment.", kind: "custom" as const }]
        : []),
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- save ------------------------------------------------------------------

  function submit(asDraft: boolean) {
    if (!form.iwo_id) return;
    const paletteRows = (["fabric", "yarn", "print"] as const).flatMap((section) =>
      palette[section]
        .filter((r) => r.value.trim())
        .map((r) => ({ section, name: r.value })),
    );
    const yarnLinePayload = keptIwoYarnLines(yarnLineFacts)
      .filter((l) => !!l.item_id)
      .map((l, i) => ({
        sno: i + 1,
        item_id: l.item_id as string,
        planned_kgs: l.planned_kgs,
        buy_stage_id: l.buy_stage_id,
        // Sent as typed; the SERVER decides GREY/DYED off the stage master and
        // drops both on a GREY line (0592).
        colour_by: l.colour_by,
        shades: keptIwoYarnShades(l.shades),
        stages: (yarnAnswers[l.item_id as string]?.stages ?? []).map((st, j) => ({
          sno: j + 1,
          stage_id: st.stage_id,
          process_id: st.process_id,
          loss_for_id: st.loss_for_id,
          combo: st.combo || null,
          description: st.description || null,
          loss_pct: num(st.loss_pct),
        })),
      }));
    const payload = {
      iwo_id: form.iwo_id,
      bom_date: form.bom_date,
      is_draft: asDraft,
      palette: paletteRows,
      dias: dias.map((d) => ({
        knit_type: (d.knit_type || null) as "circular" | "flat_knit" | "woven" | null,
        dia: d.dia.trim() || null,
      })),
      // Blank rows are dropped HERE as well as in the action: the schema
      // requires a fabric on every line it is sent.
      lines: yarnMode ? [] : keptIwoFabricLines(lines.map(lineFacts)).map((l) => ({
        ...l,
        item_id: l.item_id ?? "",
        fabric_form: l.fabric_form as "open" | "tubular" | null,
      })),
      // Step 3. Routes as typed (the action keeps only steps naming a process,
      // for fabrics still on a line); yarns as DERIVED, each with its own
      // stages. No weight is sent — the server computes every one.
      processes: yarnMode ? [] : procs.map((r) => ({
        item_id: r.item_id,
        combo: null,
        component_id: null,
        sno: 0,
        stage_id: r.stage_id,
        process_id: r.process_id,
        loss_for_id: r.loss_for_id,
        loss_pct: num(r.loss_pct),
        type_id: r.type_id,
      })),
      yarns: yarnMode ? yarnLinePayload : yarnRows.map((y, i) => ({
        sno: i + 1,
        item_id: y.item_id,
        stages: y.stages.map((st, j) => ({
          sno: j + 1,
          stage_id: st.stage_id,
          process_id: st.process_id,
          loss_for_id: st.loss_for_id,
          combo: st.combo || null,
          description: st.description || null,
          loss_pct: num(st.loss_pct),
        })),
      })),
    };
    start(async () => {
      const res = await saveIwoFabricBom(editId, payload);
      if (res.ok) {
        success(editId ? "Fabric BOM updated" : "Fabric BOM created");
        setDirty(false);
        leaveEditor();
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(t: IwoFabricBomTask) {
    if (!t.bom) return;
    const bomId = t.bom.id;
    start(async () => {
      const res = await deleteIwoFabricBom(bomId);
      if (res.ok) {
        success("Fabric BOM deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the list ----------------------------------------------------------------

  const columns: Column<IwoFabricBomTask>[] = [
    {
      header: "I.WO No",
      cell: (t) => (
        <button
          type="button"
          onClick={() => (t.bom ? perms.canEdit : perms.canCreate) && openTask(t)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {t.code ?? "—"}
        </button>
      ),
    },
    { header: "Date", cell: (t) => <span className="tabular-nums text-xs">{fmtDate(t.iwo_date)}</span> },
    { header: "For", cell: (t) => <span className="text-sm">{IWO_FOR_LABELS[t.iwo_for] ?? "—"}</span> },
    {
      header: "RE No",
      cell: (t) => <span className="font-mono text-xs">{t.reference_no ?? "—"}</span>,
    },
    { header: "Deli Dt", cell: (t) => <span className="tabular-nums text-xs">{fmtDate(t.deli_date)}</span> },
    {
      header: "Fabric BOM",
      cell: (t) =>
        !t.bom ? (
          <StatusPill tone="neutral">Not started</StatusPill>
        ) : t.bom.is_draft ? (
          <StatusPill tone="info">Draft</StatusPill>
        ) : (
          <StatusPill tone="success">Saved</StatusPill>
        ),
    },
    rowActionsColumn((t) => (
      <RowActions
        label={t.code}
        onEdit={() => openTask(t)}
        canEdit={t.bom ? perms.canEdit : perms.canCreate}
        onDelete={t.bom ? () => del(t) : undefined}
        canDelete={!!t.bom && perms.canDelete}
        deleteLabel="Delete BOM"
        isPending={isPending}
      />
    )),
  ];

  // ---- Color/Print Details panels ---------------------------------------------

  /** One text column, as on the order screen. CAPS from the primitive and again
   *  in the schema. No `required`: a blank row stores nothing. */
  const nameColumns = (header: string, section: PaletteSection): ChildGridColumn<PaletteRow>[] => [
    {
      header,
      width: "15rem",
      cell: (r) => (
        <Input
          className="max-w-[200px]"
          value={r.value}
          aria-label={header}
          onChange={(e) => mutPalette(section, (xs) => xs.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)))}
        />
      ),
    },
  ];

  const diaColumns: ChildGridColumn<DiaRow>[] = [
    {
      header: "Type",
      width: "8.125rem",
      cell: (r) => (
        <Select
          compact
          aria-label="Knit type"
          value={r.knit_type}
          onChange={(e) => mutDias((xs) => xs.map((x) => (x.key === r.key ? { ...x, knit_type: e.target.value } : x)))}
        >
          <option value="" />
          {KNIT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Dia / Size / Width",
      width: "6.875rem",
      cell: (r) => (
        <Input
          aria-label="Dia / size / width"
          value={r.dia}
          onChange={(e) => mutDias((xs) => xs.map((x) => (x.key === r.key ? { ...x, dia: e.target.value } : x)))}
        />
      ),
    },
  ];

  /** The last row comes back blank — a panel never shows as a bare button. */
  const removeName = (section: PaletteSection) => (r: PaletteRow) =>
    mutPalette(section, (xs) => {
      const left = xs.filter((x) => x.key !== r.key);
      return left.length ? left : [blankPaletteRow()];
    });

  // ---- Fabric Allocation + Fabric Consumption --------------------------------

  /** The Fabric Colour panel's names — what a line's Colour offers. */
  const fabricColourNames = [...new Set(palette.fabric.map((r) => normName(r.value)).filter(Boolean))];

  /** A Mixing Uom is owed only on a yarn-dyed CLOTH (the order screen's rule,
   *  `missingFabricLineFields`); the header star shows while any line owes it. */
  const owesMixing = (r: LineRow) => !!r.item_id && isYarnDyed(fabricTypeOf(r.item_id));

  /** A coloured Stage (DYED / WASH / PRINT) owes its Colour (Phase 2). */
  const owesColour = (r: LineRow) => !!r.item_id && (fabricStageRank(r.stage_id) ?? 0) >= 1;

  /** The Dia panel's values — what Finish Dia offers (Phase 2, the order
   *  screen's `declaredDiaOptions`). Capitals, like the stored value. */
  const declaredDias = [...new Set(dias.map((d) => d.dia.trim().toUpperCase()).filter(Boolean))];
  const diaOptionsFor = (held: string) => {
    const opts = declaredDias.map((d) => ({ value: d, label: d }));
    const v = held.trim();
    // A value the line already holds always survives, tagged.
    return !v || declaredDias.includes(v.toUpperCase()) ? opts : [...opts, { value: v, label: v, sublabel: "not on the Dia panel" }];
  };

  /**
   * FABRIC ALLOCATION — the order screen's legacy row minus what only an order
   * has (the style columns, and [Detail], which maps garment components). The
   * Colour cell stands where the order's Style Color stood, reading this BOM's
   * own Fabric Colour panel.
   *
   * WIDTHS (check:grid-budget): term 176 + name 288 + hug 88 + code 144 +
   * hug 88 + hug 88 = 872 + 72 chrome = 944 <= 1155.
   */
  const allocationColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Structure",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <RecordPicker
          label="Structure"
          compact
          items={data.structures}
          value={r.structure_id}
          onChange={(id) => {
            // The cascading-picker rule: a structure the held fabric is not
            // filed under clears it; one it is under keeps it.
            const held = r.item_id ? fabricById.get(r.item_id) : undefined;
            patchLine(r.key, {
              structure_id: id,
              item_id: held && id && held.category_id !== id ? null : r.item_id,
            });
          }}
        />
      ),
    },
    {
      header: "Fabric",
      required: true,
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => (
        <RecordPicker
          label="Fabric"
          compact
          required
          items={data.fabrics.filter(
            (f) => !r.structure_id || f.category_id === r.structure_id || f.id === r.item_id,
          )}
          emptyHint={r.structure_id ? "No fabric is filed under this structure yet." : null}
          value={r.item_id}
          onChange={(id) =>
            patchLine(r.key, {
              item_id: id,
              structure_id: (id ? fabricById.get(id)?.category_id : null) ?? r.structure_id,
              // ONE DIA DECLARED → PREFILLED, and still editable (the order
              // screen's rule: "automatically prepopulate … but remain editable").
              ...(id && !r.finish_dia.trim() && declaredDias.length === 1 ? { finish_dia: declaredDias[0] } : {}),
            })
          }
        />
      ),
    },
    {
      // Read off the fabric the planner picked — never typed, so it can never
      // contradict the cloth's own name. Blank until a fabric is chosen.
      header: "Type",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => <span className="text-sm">{fabricTypeOf(r.item_id) ?? ""}</span>,
    },
    {
      header: "Colour",
      width: FIELD_WIDTH_CSS.code,
      // OWED ON A COLOURED STAGE, REFUSED ON GREIGE (Phase 2) — so the hold is
      // per ROW under a column star that shows while any line owes it (the
      // Mixing Uom shape below).
      required: lines.some(owesColour),
      cell: (r) => {
        // A name the line already holds survives a panel edit that removed it.
        const held = r.color_name && !fabricColourNames.includes(normName(r.color_name)) ? [r.color_name] : [];
        // Disabled on a GREIGE line with nothing in it — but LIVE while it
        // still holds a colour, or the rule refusing that colour would have
        // no way out.
        const greigeEmpty = fabricStageRank(r.stage_id) === 0 && !r.color_name;
        return (
          <RequiredScope required={owesColour(r)} label="Colour">
            <Select
              compact
              className="h-8"
              aria-label="Colour"
              required={owesColour(r)}
              disabled={greigeEmpty}
              value={r.color_name}
              onChange={(e) => patchLine(r.key, { color_name: e.target.value })}
            >
              <option value="" />
              {[...fabricColourNames, ...held].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </RequiredScope>
        );
      },
    },
    {
      header: "Mixing Uom",
      width: FIELD_WIDTH_CSS.hug,
      required: lines.some(owesMixing),
      // A PER-ROW HOLD UNDER A PER-COLUMN STAR: the column's scope is an OR, so
      // this row re-declares its own (the order screen's Mixing Uom note).
      cell: (r) => (
        <RequiredScope required={owesMixing(r)} label="Mixing Uom">
          <RecordPicker
            label="Mixing Uom"
            compact
            required={owesMixing(r)}
            items={data.uoms}
            value={r.mixing_uom_id}
            onChange={(id) => patchLine(r.key, { mixing_uom_id: id })}
          />
        </RequiredScope>
      ),
    },
    {
      header: "No Of Colors",
      align: "right",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <Input
          className="h-8 text-right"
          type="number"
          min={1}
          max={99}
          aria-label="No Of Colors"
          value={r.no_of_colors}
          onChange={(e) => patchLine(r.key, { no_of_colors: e.target.value })}
        />
      ),
    },
  ];

  /** The lines Fabric Consumption shows: those that name a fabric. */
  const consumptionRows = lines;

  /** Fabrics planned on MORE THAN ONE line, with their total — derived. */
  const fabricTotals = [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))]
    .map((itemId) => {
      const ls = lines.filter((l) => l.item_id === itemId);
      return {
        item_id: itemId,
        name: fabricById.get(itemId)?.name ?? "",
        lines: ls.length,
        kgs: ls.reduce((a, l) => a + (num(l.req_kgs) || 0), 0),
        dias: new Set(ls.map((l) => l.finish_dia.trim().toUpperCase())).size,
        colours: new Set(ls.map((l) => normName(l.color_name))).size,
      };
    })
    .filter((t) => t.lines > 1);

  /**
   * FABRIC CONSUMPTION — screenshot 2940 / SRS §4: the garment breakdown is
   * bypassed, so the weight is TYPED. Rows are the Allocation lines that name
   * a fabric; a line is added or removed on Allocation, never here.
   *
   * WIDTHS (check:grid-budget): name 288 + code 144 + range 112 + num 72 +
   * hug 88 + code 144 + range 112 + range 112 (Gross Yarn) = 1072, and 1112
   * with the grid's chrome <= 1155.
   */
  const consumptionColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Fabric",
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => <Truncated className="text-sm">{fabricById.get(r.item_id ?? "")?.name ?? ""}</Truncated>,
    },
    {
      header: "Colour",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => <span className="text-sm">{r.color_name}</span>,
    },
    {
      header: "Form",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => (
        <Select
          compact
          className="h-8"
          aria-label="Form"
          value={r.fabric_form}
          onChange={(e) => patchLine(r.key, { fabric_form: e.target.value })}
        >
          <option value="" />
          {FABRIC_FORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "GSM",
      align: "right",
      width: FIELD_WIDTH_CSS.num,
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          aria-label="GSM"
          value={r.gsm}
          onChange={(e) => patchLine(r.key, { gsm: e.target.value })}
        />
      ),
    },
    {
      // PICKS FROM THE DIA PANEL (Phase 2, the order screen's Finish Dia): a
      // Combobox, so typed text is a SEARCH, never a stored value. Several
      // dias of one fabric are several lines — one per dia.
      header: "Finish Dia",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => (
        <Combobox
          compact
          inputClassName="h-8"
          options={diaOptionsFor(r.finish_dia)}
          value={r.finish_dia}
          onChange={(v) => patchLine(r.key, { finish_dia: v })}
          clearable
        />
      ),
    },
    {
      header: "Stage",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      // OWED ONLY ONCE THE LINE NAMES A FABRIC (`iwoFabricLineProblems` skips a
      // line without one). Every allocation line is shown here now, the seeded
      // blank one included, so the column's star stays and this row's own
      // scope decides the hold — a blank line never cages the cursor.
      cell: (r) => (
        <RequiredScope required={!!r.item_id} label="Stage">
          <LookupDialogPicker
            kind="fabric_stage"
            label="Stage"
            compact
            required={!!r.item_id}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            options={data.fabricStages}
            value={r.stage_id}
            onChange={(id) => patchLine(r.key, { stage_id: id })}
          />
        </RequiredScope>
      ),
    },
    {
      header: "Req Wt (KGS)",
      required: true,
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => num(r.req_kgs) || 0, format: kg },
      // Owed only on a line naming a fabric — see Stage above.
      cell: (r) => (
        <RequiredScope required={!!r.item_id} label="Req Wt (KGS)">
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            required={!!r.item_id}
            aria-label="Req Wt (KGS)"
            value={r.req_kgs}
            onChange={(e) => patchLine(r.key, { req_kgs: e.target.value })}
          />
        </RequiredScope>
      ),
    },
    {
      // SRS §4's "Gross Yarn Reqd" — Req Wt through this fabric's Fabric
      // Process losses (divide by 1 — L, compounded: the order engine's
      // `comboUplift`). Derived, never typed; `readOnly` keeps it off Tab.
      header: "Gross Yarn (KGS)",
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => grossYarnFor(r) ?? 0, format: kg },
      cell: (r) => {
        const g = grossYarnFor(r);
        return <Input className="h-8 text-right" readOnly aria-label="Gross Yarn (KGS)" value={g == null ? "" : kg(g)} />;
      },
    },
  ];

  // ---- Yarn Lines (For = Yarn, step 4) -----------------------------------------

  const patchYarnLine = (key: string, patch: Partial<YarnLineRow>) => {
    setYarnLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setDirty(true);
  };

  /** The purchase a yarn line leads to — its Planned Weight through its own
   *  Yarn Process stages. Blank while it cannot be stated; Yarn Process says why. */
  const purchaseFor = (l: YarnLineRow): number | null => {
    const w = answerFor(l);
    return w && !isRefusal(w) ? w.qty : null;
  };
  /** The engine's whole answer for a line — the Shades popup reads its
   *  per-shade purchases (Dyed Purchase) from the same call. */
  const answerFor = (l: YarnLineRow) => {
    if (!l.item_id) return null;
    const r = yarnRows.find((y) => y.item_id === l.item_id);
    return r ? weightFor(r) : null;
  };

  const openShades = (l: YarnLineRow, origin: SheetOrigin) => {
    setShadesOrigin(origin);
    setShadesFor(l.key);
  };
  const shadeLine = shadesFor ? (yarnLines.find((l) => l.key === shadesFor) ?? null) : null;
  const shadeAnswer = shadeLine ? answerFor(shadeLine) : null;
  const shadeQty = shadeAnswer && !isRefusal(shadeAnswer) && "shadeQty" in shadeAnswer ? shadeAnswer.shadeQty : undefined;

  /**
   * YARN LINES — screenshot 2937's main grid: Yarn Description, Stage, Planned
   * Weight (KGS). Purchase Wt is the answer, read-only: what Yarn Process's
   * stages make of the Planned Weight.
   *
   * 0592: Colour by and [Shades] belong to a DYED line only. On a GREY line
   * they stand empty and out of the way (the button is disabled, so Tab never
   * lands on a door that opens nothing), and a DYED line's Planned Weight is
   * Σ shades, read-only.
   *
   * WIDTHS (check:grid-budget): name 288 + code 144 + code 144 + hug 88 +
   * range 112 + range 112 = 888 + 72 chrome = 960 <= 1155.
   */
  const yarnLineColumns: ChildGridColumn<YarnLineRow>[] = [
    {
      header: "Yarn",
      required: true,
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => (
        <RecordPicker
          label="Yarn"
          compact
          required
          items={data.yarns}
          // Pick-once: a yarn is planned on one line, its stages on Yarn Process.
          usedIds={yarnLines.filter((x) => x.key !== r.key && x.item_id).map((x) => x.item_id as string)}
          value={r.item_id}
          onChange={(id) => patchYarnLine(r.key, { item_id: id })}
        />
      ),
    },
    {
      header: "Stage",
      required: true,
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => (
        <LookupDialogPicker
          kind="yarn_stage"
          label="Stage"
          compact
          required
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          options={data.yarnStages}
          value={r.buy_stage_id}
          onChange={(id) => patchYarnLine(r.key, { buy_stage_id: id })}
        />
      ),
    },
    {
      header: "Colour by",
      width: FIELD_WIDTH_CSS.code,
      // Owed on a DYED line only, so the hold is per ROW (the Mixing Uom
      // shape) — a column star would cage a GREY line on a field it never owes.
      cell: (r) =>
        isDyedLine(r) ? (
          <RequiredScope required label="Colour by">
            <Select
              compact
              required
              aria-label="Colour by"
              value={r.colour_by}
              onChange={(e) => patchYarnLine(r.key, { colour_by: e.target.value as IwoColourBy | "" })}
            >
              <option value="" />
              {IWO_COLOUR_BY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </RequiredScope>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      header: "Shades",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) => {
        const n = keptIwoYarnShades(shadeFacts(r)).length;
        return (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full"
            /* Disabled on a GREY line with no shades, which `ROW_FIELDS`
               excludes, so no Tab stop opens nothing. BUT LIVE ON A GREY LINE
               THAT STILL HOLDS SHADES: the rules refuse that line until they
               are cleared ("a GREY yarn has no shades"), and a disabled door to
               the only fix would make the refusal unsatisfiable. */
            disabled={!isDyedLine(r) && n === 0}
            /* A MARKER, NEVER A HANDLER — `data-row-open` puts the button on
               the row's axis for Tab, Enter and ← → at once (the order
               screen's [Detail] shape), since a DYED line's shades are
               otherwise reachable only with the mouse. */
            data-row-open
            aria-label={n ? `Shades — ${n} entered` : "Shades — none entered"}
            onClick={(ev) => openShades(r, ev.currentTarget.getBoundingClientRect())}
          >
            {n ? String(n) : "Shades"}
          </Button>
        );
      },
    },
    {
      header: "Planned Weight (KGS)",
      required: true,
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: {
        kind: "sum",
        of: (r) => (isDyedLine(r) ? (iwoShadeTotal(shadeFacts(r)) ?? 0) : num(r.planned_kgs) || 0),
        format: kg,
      },
      cell: (r) =>
        isDyedLine(r) ? (
          // Σ shades — the server writes the same sum (0592).
          <Input
            className="h-8 text-right"
            readOnly
            aria-label="Planned Weight (KGS), the sum of the shades"
            value={(() => {
              const t = iwoShadeTotal(shadeFacts(r));
              return t == null ? "" : kg(t);
            })()}
          />
        ) : (
          <Input
            className="h-8 text-right"
            inputMode="decimal"
            required
            aria-label="Planned Weight (KGS)"
            value={r.planned_kgs}
            onChange={(e) => patchYarnLine(r.key, { planned_kgs: e.target.value })}
          />
        ),
    },
    {
      // Derived, never typed — `readOnly` also takes it off the Tab path.
      header: "Purchase Wt (KGS)",
      align: "right",
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => purchaseFor(r) ?? 0, format: kg },
      cell: (r) => {
        const q = purchaseFor(r);
        return <Input className="h-8 text-right" readOnly aria-label="Purchase Wt (KGS)" value={q == null ? "" : kg(q)} />;
      },
    },
  ];

  // ---- Yarn Process list ------------------------------------------------------

  /** The order screen's one-column yarn list: the yarn, and the fabrics that
   *  declare it (one yarn is legitimately in several). Plain text, never a
   *  disabled picker — nothing here is editable. */
  const yarnColumns: FoldListColumn<YarnRow>[] = [
    {
      header: "Yarn",
      width: "22rem",
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-sm text-foreground">
            <Truncated>{r.name}</Truncated>
            {r.inactive && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            <Truncated>{r.fabrics.join(" · ") || "—"}</Truncated>
          </div>
        </div>
      ),
    },
  ];

  /** One yarn's panel: WHY it has no weight (only when refused — the engine's
   *  own sentence), then its stages in the order screen's shared grid. */
  const yarnPanel = (r: YarnRow) => {
    const w = weightFor(r);
    const combos = isRefusal(w) ? [] : w.byCombo.map((c) => c.combo).filter(Boolean);
    return (
      <>
        {isRefusal(w) && <p className="mb-1.5 text-xs text-danger">{w.refused}</p>}
        <YarnProcessGrid
          rows={r.stages}
          onChange={(next) => setYarnStages(r.item_id, next)}
          processes={data.yarnProcesses}
          stages={data.yarnStages}
          lossFor={data.processLookups.lossFor}
          combos={combos}
          newKey={newKey}
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          readOnly={!perms.canEdit && !perms.canCreate}
        />
      </>
    );
  };

  // ---- Fabric Process list ----------------------------------------------------

  /** One row per fabric named on the lines — the order screen's "Fabric Detail"
   *  row, minus its Assort Color and Components (an IWO has neither); the
   *  line's Colour stands where Assort Color stood. */
  const fabricRouteRows = [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))].map((itemId) => {
    const ls = lines.filter((l) => l.item_id === itemId);
    return {
      key: itemId,
      item_id: itemId,
      name: fabricById.get(itemId)?.name ?? "",
      structureType: rollUp(
        ls.map((l) => (l.structure_id ? (data.structures.find((x) => x.id === l.structure_id)?.knit ?? "") : "")),
      ),
      form: rollUp(ls.map((l) => fabricFormLabel(l.fabric_form))),
      colours: [...new Set(ls.map((l) => l.color_name.trim()).filter(Boolean))],
    };
  });
  type FabricRouteRow = (typeof fabricRouteRows)[number];

  const fabricRouteColumns: FoldListColumn<FabricRouteRow>[] = [
    {
      header: "Fabric Description",
      width: "22rem",
      cell: (r) => (
        <div className="min-w-0 text-sm text-foreground">
          <Truncated>{r.name || "(fabric not in the master)"}</Truncated>
        </div>
      ),
    },
    { header: "Type", cardLabel: "Knit type", width: "6rem", cell: (r) => <Truncated className="text-sm">{r.structureType}</Truncated> },
    { header: "Type", cardLabel: "Roll form", width: "5.5rem", cell: (r) => <Truncated className="text-sm">{r.form}</Truncated> },
    { header: "Colour", width: "9rem", cell: (r) => <Truncated className="text-sm">{r.colours.join(", ")}</Truncated> },
  ];

  /** Stacked cards below the table width — every label and `required` read
   *  off the column list, so the card and the header cannot disagree. */
  // grid-required-mobile: exempt -- both line grids render cards through lineCard(), which declares `required` on each Field from the column (and per row for Mixing Uom), so the star and the hold come from one declaration
  const lineCard = (columns: ChildGridColumn<LineRow>[], row: LineRow, i: number) => (
    <FieldGrid>
      {columns.map((c, ci) => (
        <Field
          key={ci}
          label={c.header}
          required={
            c.header === "Mixing Uom"
              ? owesMixing(row)
              : c.header === "Stage" || c.header === "Req Wt (KGS)"
                ? !!row.item_id
                : c.required
          }
          size="sm"
        >
          {c.cell(row, i)}
        </Field>
      ))}
    </FieldGrid>
  );

  // ---- sections ------------------------------------------------------------------

  const sections: FullScreenSection[] = [
    {
      key: "bom",
      label: "Fabric BOM",
      icon: Layers,
      done: !!form.iwo_id,
      content: (
        <SectionBody title="Fabric BOM">
          {/* The order screen's header row, with the IWO standing where the
              Garment order stood. Everything but the IWO and the Date is READ
              from the IWO — a readOnly field never holds the cursor. */}
          <FieldRow className="[&_input]:h-9">
            <Field label="I.WO No" required className="w-full max-w-[240px]" htmlFor="ifb-iwo">
              <RecordPicker
                id="ifb-iwo"
                label="I.WO No"
                compact
                items={iwoItems}
                value={form.iwo_id}
                // LOCKED ONCE NAMED, as the order picker is: lines typed against
                // one work order must never be re-pointed at another.
                disabled={!!form.iwo_id}
                onChange={(id) => set({ iwo_id: id })}
              />
            </Field>
            <Field label="Date" required className="w-[145px]" htmlFor="ifb-date">
              <Input
                id="ifb-date"
                type="date"
                max={today()}
                disabled={!!editId}
                value={form.bom_date}
                onChange={(e) => set({ bom_date: e.target.value })}
              />
            </Field>
            <Field label="For" className="w-[110px]" htmlFor="ifb-for">
              <Input id="ifb-for" readOnly value={picked ? IWO_FOR_LABELS[picked.iwo_for] : ""} />
            </Field>
            <Field label="RE No" className="w-[170px]" htmlFor="ifb-re">
              <Input id="ifb-re" readOnly value={picked?.reference_no ?? ""} />
            </Field>
            <Field label="Deli Dt" className="w-[130px]" htmlFor="ifb-deli">
              <Input id="ifb-deli" readOnly value={picked?.deli_date ? fmtDate(picked.deli_date) : ""} />
            </Field>
          </FieldRow>

          {/* NOTHING TO PICK — a state of the data, said with the way out. With
              no Internal Work Order For Yarn or Fabric waiting, the I.WO No list
              is empty and every section below has nothing to build on; the
              button opens a new work order on its own screen (`?new=1`). */}
          {!form.iwo_id && iwoItems.length === 0 && (
            <div className="mt-3">
              <p className="text-sm text-muted-foreground">
                No Internal Work Order For Yarn or Fabric is waiting for a BOM.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => router.push("/orders/internal-work-orders?new=1")}
              >
                New work order
              </Button>
            </div>
          )}

          {/* ONE ROW OF FOUR, as on the order screen. A flex row, not
              grid-cols-4, so this file declares no grid of its own. On the
              order screen three of these write the ORDER's palette; here there
              is no order, so all four belong to this BOM (0581). */}
          <div className="mt-4 flex w-full flex-row flex-nowrap items-start gap-3 [&_input]:text-xs [&_select]:text-xs">
            <PaletteTable<PaletteRow>
              label="Fabric Colour"
              columns={nameColumns("Fabric Colour", "fabric")}
              rows={palette.fabric}
              width="max-w-[210px]"
              onAdd={() => mutPalette("fabric", (xs) => [...xs, blankPaletteRow()])}
              onRemove={removeName("fabric")}
              addLabel="+ Add fabric colour"
            />
            <PaletteTable<PaletteRow>
              label="Yarn Colour"
              columns={nameColumns("Yarn colour", "yarn")}
              rows={palette.yarn}
              width="max-w-[210px]"
              onAdd={() => mutPalette("yarn", (xs) => [...xs, blankPaletteRow()])}
              onRemove={removeName("yarn")}
              addLabel="+ Add yarn colour"
            />
            <PaletteTable<PaletteRow>
              label="Roll form prints"
              columns={nameColumns("Roll form print", "print")}
              rows={palette.print}
              width="max-w-[210px]"
              onAdd={() => mutPalette("print", (xs) => [...xs, blankPaletteRow()])}
              onRemove={removeName("print")}
              addLabel="+ Add print"
            />
            <PaletteTable<DiaRow>
              label="Dia / Size Width Details"
              columns={diaColumns}
              rows={dias}
              width="max-w-[280px]"
              onAdd={() => mutDias((xs) => [...xs, blankDia()])}
              onRemove={(r) =>
                mutDias((xs) => {
                  const left = xs.filter((x) => x.key !== r.key);
                  return left.length ? left : [blankDia()];
                })
              }
              addLabel="+ Add dia"
            />
          </div>
        </SectionBody>
      ),
    },
    {
      key: "yarnLines",
      label: "Yarn Lines",
      icon: ListChecks,
      done: yarnLines.some((l) => !!l.item_id),
      content: (
        <SectionBody title="Yarn Lines">
          <ChildGrid<YarnLineRow>
            columns={yarnLineColumns}
            rows={yarnLines}
            tableFrom="5xl"
            flatRows
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {yarnLineColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            onAdd={() => {
              setYarnLines((xs) => [...xs, blankYarnLine()]);
              setDirty(true);
            }}
            onRemove={(r) => {
              setYarnLines((xs) => xs.filter((x) => x.key !== r.key));
              setDirty(true);
            }}
            addLabel="+ Add yarn"
          />
        </SectionBody>
      ),
    },
    {
      key: "lines",
      label: "Fabric Allocation",
      icon: Shirt,
      done: lines.some((l) => !!l.item_id),
      content: (
        <SectionBody title="Fabric Allocation">
          <ChildGrid<LineRow>
            columns={allocationColumns}
            rows={lines}
            tableFrom="5xl"
            flatRows
            renderMobileRow={(row, i) => lineCard(allocationColumns, row, i)}
            onAdd={() => {
              setLines((xs) => [...xs, blankLine()]);
              setDirty(true);
            }}
            onRemove={(r) => {
              setLines((xs) => xs.filter((x) => x.key !== r.key));
              setDirty(true);
            }}
            addLabel="+ Add fabric"
          />
        </SectionBody>
      ),
    },
    {
      key: "consumption",
      label: "Fabric Consumption",
      icon: Scale,
      done: consumptionRows.some((l) => (num(l.req_kgs) ?? 0) > 0),
      content: (
        <SectionBody title="Fabric Consumption">
          {/* EVERY ALLOCATION LINE, FILLED OR NOT, so the fields are on screen
              the moment the tab opens (the operator reported it "blank, no
              fields" when it drew only lines that already named a fabric).
              The Fabric cell stays empty until one is picked on Allocation. */}
          {/* default-row: exempt -- rows are DERIVED from Fabric Allocation's lines; one is added or removed there, never here */}
          <ChildGrid<LineRow>
            columns={consumptionColumns}
            rows={consumptionRows}
            tableFrom="5xl"
            flatRows
            renderMobileRow={(row, i) => lineCard(consumptionColumns, row, i)}
            hideAdd
            hideRemove
            onAdd={() => false}
            onRemove={() => {}}
          />
          {/* ONE FABRIC ACROSS SEVERAL DIAS / COLOURS (Phase 2) — the total the
              lines add up to, per fabric, so a split reads as one plan. */}
          {fabricTotals.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {fabricTotals.map((t) => (
                <li key={t.item_id}>
                  <span className="font-medium text-foreground">{t.name}</span> — {kg(t.kgs)} KGS across {t.lines} lines
                  {t.dias > 1 ? ` · ${t.dias} dias` : ""}
                  {t.colours > 1 ? ` · ${t.colours} colours` : ""}
                </li>
              ))}
            </ul>
          )}
        </SectionBody>
      ),
    },
    {
      key: "yarns",
      label: "Yarn Process",
      icon: Spool,
      done: yarnRows.some(yarnRowAnswered),
      content: (
        <SectionBody title="Yarn Process">
          {/* Three empty states, each fixed on a different screen — the order
              screen's own wording, with the door named. */}
          {yarnMode ? (
            yarnRows.length === 0 ? (
              <div>
                <p className="text-sm text-muted-foreground">Pick a yarn on Yarn Lines first.</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => shellRef.current?.goToSection("yarnLines")}>
                Go to Yarn Lines
              </Button>
              </div>
            ) : (
              <ProcessFoldList<YarnRow>
                columns={yarnColumns}
                rows={yarnRows}
                openKey={openYarnId === undefined ? (yarnRows[0]?.key ?? null) : openYarnId}
                onToggle={setOpenYarnId}
                renderPanel={yarnPanel}
              />
            )
          ) : !fabricIdKey ? (
            <div>
              <p className="text-sm text-muted-foreground">
                Name a fabric on Fabric Allocation first — the yarns come from what each fabric is made of.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => shellRef.current?.goToSection("lines")}>
                Go to Fabric Allocation
              </Button>
            </div>
          ) : !comp ? (
            <p className="text-sm text-muted-foreground">Reading the compositions…</p>
          ) : yarnRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None of these fabrics declares a composition, so there are no yarns to plan. Add the Mixing rows on
              Master Data ▸ Materials.
            </p>
          ) : (
            <ProcessFoldList<YarnRow>
              columns={yarnColumns}
              rows={yarnRows}
              openKey={openYarnId === undefined ? (yarnRows[0]?.key ?? null) : openYarnId}
              onToggle={setOpenYarnId}
              renderPanel={yarnPanel}
            />
          )}
        </SectionBody>
      ),
    },
    {
      key: "process",
      label: "Fabric Process",
      icon: Waypoints,
      done: procs.some((p) => !!p.process_id),
      content: (
        <SectionBody title="Fabric Process">
          {fabricRouteRows.length === 0 ? (
            <div>
              <p className="text-sm text-muted-foreground">
                Name a fabric on Fabric Allocation first — each one gets its own route here.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => shellRef.current?.goToSection("lines")}>
                Go to Fabric Allocation
              </Button>
            </div>
          ) : (
            <ProcessFoldList<FabricRouteRow>
              columns={fabricRouteColumns}
              rows={fabricRouteRows}
              openKey={openFabricId === undefined ? (fabricRouteRows[0]?.key ?? null) : openFabricId}
              onToggle={setOpenFabricId}
              foldHeader="Process"
              foldSummary={(r) => {
                const steps = routeStepCount(procs.filter((p) => p.item_id === r.item_id));
                return steps ? `${steps} step${steps === 1 ? "" : "s"}` : "No route yet";
              }}
              renderPanel={(r) => (
                // ONE GRID PER FABRIC, no Route-per toggle and no Source strip:
                // an IWO has no colourways or components to split by, and the
                // order screen's Source control is hidden (its default,
                // yarn_knit, is the only answer there too).
                <FabricProcessGrid
                  itemId={r.item_id}
                  colours={null}
                  components={null}
                  rows={procs.filter((p) => p.item_id === r.item_id)}
                  onChange={(next) => setFabricProcs(r.item_id, next)}
                  processes={data.processes}
                  // A GREIGE fabric is offered the Greige stage only (Phase 2),
                  // so its processes narrow to greige ones (Knitting) through
                  // the grid's own stage → process rule. A stage a step already
                  // holds survives ("Disabled rows"), and the rule above says
                  // why it has to go.
                  lookups={
                    isGreigeFabric(r.item_id)
                      ? {
                          ...data.processLookups,
                          stages: data.processLookups.stages.filter(
                            (st) =>
                              stageRank(st) === 0 ||
                              procs.some((p) => p.item_id === r.item_id && p.stage_id === st.id),
                          ),
                        }
                      : data.processLookups
                  }
                  printDeclared={printDeclared}
                  fabricIsYarnDyed={isYarnDyed(fabricTypeOf(r.item_id))}
                  source="yarn_knit"
                  newKey={newKey}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  readOnly={!perms.canEdit && !perms.canCreate}
                />
              )}
            />
          )}
        </SectionBody>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="IWO Fabric BOM"
          description="The Fabric BOM for an Internal Work Order For Yarn or Fabric — no garment breakdown; the weight is typed."
          actions={perms.canCreate ? <Button onClick={() => openNew(null)}>+ New Fabric BOM</Button> : undefined}
        />
        <DataTable
          columns={withCreatedColumns(columns, tasks)}
          rows={tasks}
          getKey={(t) => t.id}
          empty="No Internal Work Orders For Yarn or Fabric at this unit yet."
        />
      </div>

      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => leaveEditor()}
        modeLabel={
          <>
            {editId ? "Editing" : "New"} <span className="font-semibold text-foreground">IWO fabric BOM</span>
          </>
        }
        header={{
          initials: "FB",
          title: picked?.code ?? "New Fabric BOM",
          badges: dirty ? <span className="text-[11px] font-medium text-warning">● Unsaved</span> : null,
          meta: (
            <>
              <span>{picked ? `For ${IWO_FOR_LABELS[picked.iwo_for]}` : "No work order chosen"}</span>
              {form.bom_date && <span>· {fmtDate(form.bom_date)}</span>}
            </>
          ),
        }}
        // A Yarn IWO BYPASSES the fabric sections (screenshot 2937); a Fabric one
        // has no Yarn Lines grid — its yarns are derived from the cloths.
        sections={sections.filter((sec) =>
          yarnMode ? !["lines", "consumption", "process"].includes(sec.key) : sec.key !== "yarnLines",
        )}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New Fabric BOM",
          onCancel: () => leaveEditor(),
          onSave: () => submit(false),
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          saveLabel: "Save Fabric BOM",
          canSave: validity.canSave,
          onBlockedSave: revealFirstProblem,
          isPending,
        }}
      />

      <YarnShadesSheet
        open={!!shadeLine}
        onClose={() => setShadesFor(null)}
        origin={shadesOrigin}
        yarnName={shadeLine?.item_id ? (yarnById.get(shadeLine.item_id)?.name ?? "") : ""}
        colourBy={shadeLine?.colour_by || null}
        rows={shadeLine?.shades ?? []}
        onChange={(next) => shadeLine && patchYarnLine(shadeLine.key, { shades: next })}
        colours={yarnColourNames}
        purchaseOf={
          shadeLine?.colour_by === "dyed_purchase" ? (c) => shadeQty?.[normName(c)] ?? null : null
        }
        newKey={newKey}
        readOnly={!perms.canEdit && !perms.canCreate}
      />
    </>
  );
}
