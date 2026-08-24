"use client";

/**
 * Orders ▸ Fabric Plan — step 6 of the client's order flow (0427).
 *
 * TWO SURFACES, one route, exactly as Fabric BOM has: a work queue of confirmed
 * garment ORDERS (so an order with no route is visible rather than absent), and
 * a full-screen editor.
 *
 * THE FABRICS ARE NOT EDITABLE HERE. They come from the Fabric BOM — one block
 * per fabric, with the operator's work being the ROUTE beneath each. That is why
 * there is no "+ Add fabric": a fabric this screen could invent would be one the
 * BOM does not require and nothing downstream would buy. Adding a fabric is the
 * BOM's job, and the empty state says so rather than offering a button that
 * writes an orphan.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Route, Layers, Copy } from "lucide-react";
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
import { RecordPicker } from "@/components/masters/record-picker";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { RowActions } from "@/components/ui/row-actions";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  isRefusal,
  routeInput,
  routeQuantities,
  stageProblem,
  type StageInput,
} from "@/lib/orders/fabric-plan/route";
import {
  STAGE_MODE_OPTIONS,
  fabricPlanStatusText,
  fabricPlanStatusTone,
  type FabricPlan,
  type FabricPlanTaskRow,
  type PlannableFabric,
} from "@/lib/orders/fabric-plan/types";
import type { FabricPlanFormData, UomRow } from "@/lib/orders/fabric-plan/service";
import {
  createFabricPlan,
  deleteFabricPlan,
  loadPlannableFabrics,
  updateFabricPlan,
} from "@/lib/orders/fabric-plan/actions";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type StageRow = {
  key: string;
  process_id: string | null;
  mode: string;
  vendor_id: string | null;
  loss_pct: string;
  planned_start: string;
  planned_end: string;
  notes: string;
};

/** One fabric from the BOM, with the route the operator is building for it. */
type RouteRow = {
  key: string;
  fabric: PlannableFabric;
  stages: StageRow[];
};

type Form = { garment_order_id: string | null; plan_date: string; remark: string };

const today = () => new Date().toISOString().slice(0, 10);
const BLANK = (): Form => ({ garment_order_id: null, plan_date: today(), remark: "" });

const blankStage = (key: string): StageRow => ({
  key,
  process_id: null,
  // `in_house` is the default because it is the one that needs no second answer;
  // `outsourced` immediately requires a processor, and defaulting to a state that
  // is instantly incomplete makes every new row start as a problem.
  mode: "in_house",
  vendor_id: null,
  loss_pct: "",
  planned_start: "",
  planned_end: "",
  notes: "",
});

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * The separator that joins a fabric's address keys.
 *
 * A CONTROL CHARACTER, so a combo or component name containing the separator
 * cannot forge another row's key — the same reasoning, and the same character,
 * as `SEP` in lib/orders/material-bom/requirement.ts.
 *
 * WRITTEN AS AN ESCAPE, NEVER AS A RAW BYTE. A literal NUL in a source file
 * makes git treat that file as BINARY: no diff, no three-way merge, and a
 * conflict it simply refuses to resolve. That is exactly what happened to both
 * of these screens on 2026-08-18 and it is invisible until the day two branches
 * touch the same file.
 */
const SEP = "\u0000";

/** The five keys that ADDRESS a fabric. Same tuple the schema uses (0427) and the
 *  only safe way to match a saved plan line back to a BOM fabric — the BOM's own
 *  line ids do not survive its next save. */
const addressOf = (f: {
  style_ref_no: string | null;
  combo: string | null;
  structure_id: string | null;
  component_id: string | null;
  item_id: string | null;
}) =>
  [f.style_ref_no, f.combo, f.structure_id, f.component_id, f.item_id]
    .map((v) => (v ?? "").trim().toUpperCase())
    .join(SEP);

export function FabricPlanScreen({
  tasks,
  plans,
  data,
  perms,
}: {
  tasks: FabricPlanTaskRow[];
  plans: FabricPlan[];
  data: FabricPlanFormData;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");

  /** See the Fabric BOM screen: the shell's `useModalGuard` is not this, and
   *  `confirmDiscard()` deliberately does not read it. Keyed on real dirtiness,
   *  never on `mode === "edit"`. */
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutRoutes = (fn: (xs: RouteRow[]) => RouteRow[]) => {
    setRoutes(fn);
    setDirty(true);
  };
  const setStage = (routeKey: string, stageKey: string, patch: Partial<StageRow>) =>
    mutRoutes((xs) =>
      xs.map((r) =>
        r.key !== routeKey
          ? r
          : { ...r, stages: r.stages.map((s) => (s.key === stageKey ? { ...s, ...patch } : s)) },
      ),
    );

  // ---- the BOM behind the picked order -------------------------------------

  const [loaded, setLoaded] = useState<{
    forOrder: string;
    bomId: string | null;
    bomComputedAt: string | null;
    fabrics: PlannableFabric[];
    error: string | null;
  } | null>(null);

  const current = loaded && loaded.forOrder === form.garment_order_id ? loaded : null;
  const bomError = current?.error ?? null;
  const bomLoading = !!form.garment_order_id && !current;

  /**
   * The saved plan's stages, keyed by fabric address, held until the BOM answers.
   *
   * OPENING AN EXISTING PLAN IS TWO SOURCES MEETING: the FABRICS come from the
   * BOM (live, because the BOM may have gained one since) and the ROUTES come
   * from the saved document. They arrive at different times, so the saved half
   * waits here and is grafted on when the BOM lands — which is also what makes a
   * fabric added to the BOM after the plan was saved show up with an empty route
   * rather than not at all.
   */
  const pendingStages = useRef<Map<string, StageRow[]> | null>(null);

  useEffect(() => {
    const id = form.garment_order_id;
    if (!id) return;
    let cancelled = false;
    loadPlannableFabrics(id).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setLoaded({ forOrder: id, bomId: null, bomComputedAt: null, fabrics: [], error: res.error });
        setRoutes([]);
        return;
      }
      setLoaded({
        forOrder: id,
        bomId: res.bomId,
        bomComputedAt: res.bomComputedAt,
        fabrics: res.fabrics,
        error: null,
      });
      const saved = pendingStages.current;
      pendingStages.current = null;
      setRoutes(
        res.fabrics.map((f) => ({
          key: newKey(),
          fabric: f,
          stages: saved?.get(addressOf(f)) ?? [blankStage(newKey())],
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [form.garment_order_id]);

  const pickedOrder = useMemo(
    () => data.orders.find((o) => o.id === form.garment_order_id) ?? null,
    [data.orders, form.garment_order_id],
  );

  // ---- opening -------------------------------------------------------------

  function openNew(garmentOrderId: string | null) {
    setEditId(null);
    pendingStages.current = null;
    setForm({ ...BLANK(), garment_order_id: garmentOrderId });
    setRoutes([]);
    setDirty(false);
    setMode("edit");
  }

  function openExisting(planId: string) {
    const p = plans.find((x) => x.id === planId);
    if (!p) return;
    setEditId(p.id);
    // Stashed for the effect above to graft on once the BOM answers.
    pendingStages.current = new Map(
      (p.lines ?? []).map((l) => [
        addressOf(l),
        (l.stages ?? []).map((st) => ({
          key: newKey(),
          process_id: st.process_id,
          mode: st.mode,
          vendor_id: st.vendor_id,
          loss_pct: st.loss_pct == null ? "" : String(st.loss_pct),
          planned_start: st.planned_start ?? "",
          planned_end: st.planned_end ?? "",
          notes: st.notes ?? "",
        })),
      ]),
    );
    setForm({
      garment_order_id: p.garment_order_id,
      plan_date: p.plan_date,
      remark: p.remark ?? "",
    });
    setRoutes([]);
    setDirty(false);
    setMode("edit");
  }

  function openTask(t: FabricPlanTaskRow) {
    if (t.plan_id) openExisting(t.plan_id);
    else openNew(t.id);
  }

  /**
   * Copy the first fabric's route onto every fabric that has none.
   *
   * ONLY ONTO EMPTY ONES. Most orders knit every fabric the same way, so building
   * one route and repeating it is the common case — but overwriting a route the
   * operator has already tailored (a rib collar that skips compacting) would
   * destroy the exact work this button exists to save them. "Fill the blanks" is
   * a claim it can make honestly; "make them all the same" is not.
   *
   * It invents nothing. There is deliberately no built-in default route: a seed
   * the operator did not ask for is how the spell-suggest feature was removed
   * once already (AGENTS.md, Near misses).
   */
  function copyRouteToRest() {
    const source = routes[0];
    if (!source || source.stages.every((s) => !s.process_id)) {
      toastError("Build the first fabric's route before copying it");
      return;
    }
    let filled = 0;
    mutRoutes((xs) =>
      xs.map((r, i) => {
        if (i === 0 || r.stages.some((s) => s.process_id)) return r;
        filled++;
        return { ...r, stages: source.stages.map((s) => ({ ...s, key: newKey() })) };
      }),
    );
    success(
      filled === 0
        ? "Every other fabric already has a route"
        : `Route copied to ${filled} fabric${filled === 1 ? "" : "s"}`,
    );
  }

  // ---- the stage grid ------------------------------------------------------

  const uomById = useMemo(
    () => new Map(data.uoms.map((u) => [u.id, u] as const)),
    [data.uoms],
  );

  function stageColumns(route: RouteRow, solved: ReturnType<typeof solveRoute>): ChildGridColumn<StageRow>[] {
    const uom: UomRow | undefined = route.fabric.required_uom_id
      ? uomById.get(route.fabric.required_uom_id)
      : undefined;
    const unit = uom?.code ?? uom?.name ?? "";

    return [
      {
        header: "Process",
        required: true,
        // NO WIDTH — the one flexible column, so the slack lands on the
        // longest value instead of on a percentage box.
        cell: (s) => (
          <RecordPicker
            label="Process"
            compact
            required
            items={data.processes}
            value={s.process_id}
            onChange={(id) => setStage(route.key, s.key, { process_id: id })}
          />
        ),
      },
      {
        header: "Done by",
        width: "7.5rem",
        required: true,
        cell: (s) => (
          <Select
            compact
            className="h-8"
            required
            value={s.mode}
            onChange={(e) =>
              setStage(route.key, s.key, {
                mode: e.target.value,
                // CLEARED WHEN THE STAGE COMES IN-HOUSE. A processor left behind
                // is a name the screen stops showing and the action would still
                // have to strip — better to have one answer than two that must
                // agree.
                ...(e.target.value === "in_house" ? { vendor_id: null } : {}),
              })
            }
          >
            {STAGE_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ),
      },
      {
        header: "Processor",
        width: "10rem",
        // REQUIRED FOR A STATE, not for the column — mandatory out-processed and
        // meaningless in-house. One declaration drives the star and the hold, so
        // it must be the same expression the rule uses (AGENTS.md, Mandatory
        // fields: `stateRequired`).
        required: route.stages.some((s) => s.mode === "outsourced"),
        cell: (s) => (
          <RecordPicker
            label="Processor"
            compact
            required={s.mode === "outsourced"}
            disabled={s.mode !== "outsourced"}
            items={data.vendors}
            value={s.vendor_id}
            placeholder={s.mode === "outsourced" ? undefined : "In-house"}
            onChange={(id) => setStage(route.key, s.key, { vendor_id: id })}
          />
        ),
      },
      {
        header: "Loss %",
        align: "right",
        width: "5rem",
        required: true,
        cell: (s) => (
          <Input
            className="h-8 text-right"
            required
            inputMode="decimal"
            value={s.loss_pct}
            onChange={(e) => setStage(route.key, s.key, { loss_pct: e.target.value })}
          />
        ),
      },
      {
        header: "Input",
        align: "right",
        width: "8rem",
        cell: (s, i) => <Qty value={solved.inputs[i]} unit={unit} />,
      },
      {
        header: "Output",
        align: "right",
        width: "8rem",
        cell: (s, i) => <Qty value={solved.outputs[i]} unit={unit} />,
      },
      {
        header: "Start",
        width: "8rem",
        cell: (s) => (
          <Input
            className="h-8"
            type="date"
            value={s.planned_start}
            onChange={(e) => setStage(route.key, s.key, { planned_start: e.target.value })}
          />
        ),
      },
      {
        header: "End",
        width: "8rem",
        cell: (s) => (
          <Input
            className="h-8"
            type="date"
            value={s.planned_end}
            onChange={(e) => setStage(route.key, s.key, { planned_end: e.target.value })}
          />
        ),
      },
    ];
  }

  /** Runs the SAME engine the server stores from — never a second formula. */
  function solveRoute(route: RouteRow) {
    const stages: StageInput[] = route.stages
      .filter((s) => s.process_id)
      .map((s, i) => ({
        sno: i + 1,
        process_id: s.process_id,
        mode: s.mode,
        vendor_id: s.vendor_id,
        loss_pct: numOrNull(s.loss_pct),
      }));

    const uom = route.fabric.required_uom_id ? uomById.get(route.fabric.required_uom_id) : undefined;
    const solved = routeQuantities(
      stages,
      Number(route.fabric.required_qty) || 0,
      uom?.decimal_places_allowed ?? null,
    );

    const inputs: (number | null)[] = [];
    const outputs: (number | null)[] = [];
    if (!isRefusal(solved)) {
      // Mapped back over the FULL row list: a row with no process is skipped by
      // the solve, so index i of the grid is not index i of the solution.
      let j = 0;
      for (const s of route.stages) {
        if (s.process_id) {
          inputs.push(solved[j].input);
          outputs.push(solved[j].output);
          j++;
        } else {
          inputs.push(null);
          outputs.push(null);
        }
      }
    } else {
      for (const _ of route.stages) {
        inputs.push(null);
        outputs.push(null);
      }
    }

    return {
      inputs,
      outputs,
      refusal: isRefusal(solved) ? solved.refused : null,
      toBuy: isRefusal(solved) ? null : (() => {
        const v = routeInput(solved);
        return isRefusal(v) ? null : v;
      })(),
    };
  }

  // ---- validity ------------------------------------------------------------

  const routedFabrics = routes.filter((r) => r.stages.some((s) => s.process_id));

  const stageIssues = useMemo(() => {
    const out: string[] = [];
    for (const r of routes) {
      for (const s of r.stages) {
        if (!s.process_id) continue;
        const problem = stageProblem({
          sno: 0,
          process_id: s.process_id,
          mode: s.mode,
          vendor_id: s.vendor_id,
          loss_pct: numOrNull(s.loss_pct),
        });
        // The ENGINE'S sentence, and the fabric it is on. Two spellings of one
        // refusal is how an operator comes to believe there are two problems.
        if (problem) out.push(`${r.fabric.item_name ?? "Fabric"}: ${problem}`);
      }
    }
    return out;
  }, [routes]);

  const validity = sectionValidity({
    sections: [{ key: "plan" }, { key: "routes" }],
    values: form,
    fields: [
      {
        section: "plan",
        id: "fp-order",
        label: "Garment order",
        required: true,
        empty: (f) => !f.garment_order_id,
      },
      { section: "plan", id: "fp-date", label: "Date", required: true, empty: (f) => !f.plan_date },
    ],
    extra: [
      ...(routes.length > 0 && routedFabrics.length === 0
        ? [
            {
              section: "routes",
              label: "Routes",
              message: "Give at least one fabric a process route.",
              kind: "custom" as const,
            },
          ]
        : []),
      ...stageIssues.slice(0, 1).map((message) => ({
        section: "routes",
        label: "Route",
        message,
        kind: "custom" as const,
      })),
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- sections ------------------------------------------------------------

  const sections: FullScreenSection[] = [
    {
      key: "plan",
      label: "Fabric Plan",
      icon: Layers,
      done: !!form.garment_order_id,
      content: (
        <SectionBody title="Fabric Plan">
          <FieldGrid>
            <Field label="Garment order" required size="sm" htmlFor="fp-order">
              <RecordPicker
                id="fp-order"
                label="Garment order"
                compact
                items={data.orders}
                value={form.garment_order_id}
                // LOCKED ONCE SAVED, for the Fabric BOM's reason: every stage
                // quantity was solved against this order's BOM.
                disabled={!!editId}
                onChange={(id) => set({ garment_order_id: id })}
              />
            </Field>
            <Field label="Date" required size="sm" htmlFor="fp-date">
              <Input
                id="fp-date"
                type="date"
                value={form.plan_date}
                onChange={(e) => set({ plan_date: e.target.value })}
              />
            </Field>
            <Field label="Customer" size="sm" htmlFor="fp-cust">
              <Input id="fp-cust" readOnly value={pickedOrder?.customer_name ?? ""} />
            </Field>
            <Field label="Delivery" size="sm" htmlFor="fp-del">
              <Input
                id="fp-del"
                readOnly
                value={pickedOrder?.delivery_date ? fmtDate(pickedOrder.delivery_date) : ""}
              />
            </Field>
            <Field label="Remark" size="full" htmlFor="fp-remark">
              <Textarea
                id="fp-remark"
                rows={2}
                value={form.remark}
                onChange={(e) => set({ remark: e.target.value })}
              />
            </Field>
          </FieldGrid>

          {form.garment_order_id && (
            <div className="mt-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
              <span className="mr-2 font-medium text-foreground">Planning against:</span>
              {bomLoading ? (
                <span className="text-muted-foreground">Reading the Fabric BOM…</span>
              ) : bomError ? (
                <span className="text-danger">{bomError}</span>
              ) : (
                <span className="text-muted-foreground">
                  {routes.length} {routes.length === 1 ? "fabric" : "fabrics"} on the Fabric BOM
                  {current?.bomComputedAt
                    ? ` · computed ${fmtDate(current.bomComputedAt)}`
                    : " · the BOM is a draft, so this route will need re-planning"}
                </span>
              )}
            </div>
          )}
        </SectionBody>
      ),
    },
    {
      key: "routes",
      label: "Routes",
      icon: Route,
      done: routedFabrics.length > 0,
      content: (
        <SectionBody title="Routes">
          {!form.garment_order_id ? (
            <p className="text-sm text-muted-foreground">Pick a garment order first.</p>
          ) : bomError ? (
            // EMPTY-AND-EXPLAIN, with the door named. "No fabrics" and "no BOM"
            // send the operator to different screens.
            <p className="text-sm text-danger">{bomError}</p>
          ) : bomLoading ? (
            <p className="text-sm text-muted-foreground">Reading the Fabric BOM…</p>
          ) : (
            <div className="space-y-6">
              {routes.length > 1 && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyRouteToRest}
                    disabled={isPending}
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    Copy first route to the rest
                  </Button>
                </div>
              )}

              {routes.map((r) => {
                const solved = solveRoute(r);
                const uom = r.fabric.required_uom_id ? uomById.get(r.fabric.required_uom_id) : undefined;
                const unit = uom?.code ?? uom?.name ?? "";
                return (
                  <div key={r.key} className="rounded-md border border-border p-3">
                    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold text-foreground">
                        <Truncated>{r.fabric.item_name ?? "(no fabric named)"}</Truncated>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[r.fabric.combo, r.fabric.structure_name, r.fabric.component_name]
                          .filter(Boolean)
                          .join(" · ") || "whole order"}
                      </span>
                      <span className="ml-auto text-xs">
                        {r.fabric.refusal ? (
                          // The BOM's refusal, carried through verbatim. Solving
                          // a route against a number the BOM would not produce
                          // is how a refused line becomes a purchase.
                          <span className="text-danger">{r.fabric.refusal}</span>
                        ) : (
                          <span className="text-muted-foreground">
                            needs{" "}
                            <span className="font-medium tabular-nums text-foreground">
                              {fmtNumber(r.fabric.required_qty ?? 0)} {unit}
                            </span>
                          </span>
                        )}
                      </span>
                    </div>

                    <ChildGrid<StageRow>
                      columns={stageColumns(r, solved)}
                      rows={r.stages}
                      seedRow
                      /* ONE ROW PER STAGE (client, 2026-08-17), for the reason
                         the Fabric BOM header sets out at length. The declared
                         widths sum to ~950px including the row chrome, so the
                         table may appear from 1024 (@5xl) — lower than Fabric
                         BOM's @7xl because eight columns fit a laptop and
                         fourteen do not. Below that it stacks; it never scrolls
                         sideways.

                         `renderMobileRow` stays: the DEFAULT stacked cell has no
                         visible label, so dropping it turns the fallback into a
                         column of unlabelled boxes.

                         THE PANE IS NOT WIDENED HERE. This section renders one
                         grid PER FABRIC inside its own bordered card, and the
                         only flexible column is the Process picker — at 1720px
                         that picker would be most of a foot wide with nothing
                         to put in it. `wide` earns its place on a fourteen-column
                         row and not on this one. */
                      tableFrom="5xl"
                      centerHeaders
                      renderMobileRow={(row, i) => {
                        const cols = stageColumns(r, solved);
                        return (
                          <FieldGrid>
                            {cols.map((c, ci) => (
                              <Field key={ci} label={c.header} required={c.required} size="sm">
                                {c.cell(row, i)}
                              </Field>
                            ))}
                          </FieldGrid>
                        );
                      }}
                      onAdd={() =>
                        mutRoutes((xs) =>
                          xs.map((x) =>
                            x.key === r.key ? { ...x, stages: [...x.stages, blankStage(newKey())] } : x,
                          ),
                        )
                      }
                      onRemove={(s) =>
                        mutRoutes((xs) =>
                          xs.map((x) =>
                            x.key === r.key
                              ? { ...x, stages: x.stages.filter((y) => y.key !== s.key) }
                              : x,
                          ),
                        )
                      }
                      addLabel="+ Add stage"
                    />

                    <div className="mt-2 text-xs">
                      {solved.refusal ? (
                        <span className="text-danger">{solved.refusal}</span>
                      ) : solved.toBuy != null ? (
                        <span className="text-muted-foreground">
                          To start this route:{" "}
                          <span className="font-medium tabular-nums text-foreground">
                            {fmtNumber(solved.toBuy)} {unit}
                          </span>
                          {" — "}
                          {fmtNumber(solved.toBuy - (r.fabric.required_qty ?? 0))} {unit} lost on the way
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {routes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  This order&rsquo;s Fabric BOM names no fabrics yet.
                </p>
              )}
            </div>
          )}
        </SectionBody>
      ),
    },
  ];

  // ---- saving --------------------------------------------------------------

  function submit(asDraft: boolean) {
    if (!form.garment_order_id) return;
    const payload = {
      garment_order_id: form.garment_order_id,
      plan_date: form.plan_date,
      is_draft: asDraft,
      remark: form.remark || null,
      bom_id: current?.bomId ?? null,
      bom_computed_at: current?.bomComputedAt ?? null,
      lines: routes.map((r, i) => ({
        sno: i + 1,
        style_ref_no: r.fabric.style_ref_no,
        combo: r.fabric.combo,
        structure_id: r.fabric.structure_id,
        component_id: r.fabric.component_id,
        item_id: r.fabric.item_id,
        // The SNAPSHOT. See 0427: a yarn purchase is raised off this, so it must
        // not follow the BOM after the fact.
        required_qty: r.fabric.required_qty,
        required_uom_id: r.fabric.required_uom_id,
        notes: null,
        stages: r.stages
          .filter((s) => s.process_id)
          .map((s, j) => ({
            sno: j + 1,
            process_id: s.process_id,
            mode: s.mode as "in_house" | "outsourced",
            vendor_id: s.vendor_id,
            loss_pct: numOrNull(s.loss_pct),
            uom_id: r.fabric.required_uom_id,
            planned_start: s.planned_start || null,
            planned_end: s.planned_end || null,
            notes: s.notes || null,
          })),
      })),
    };
    start(async () => {
      const res = editId
        ? await updateFabricPlan(editId, payload)
        : await createFabricPlan(payload);
      if (res.ok) {
        success(editId ? "Fabric plan updated" : "Fabric plan created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function remove(planId: string) {
    start(async () => {
      const res = await deleteFabricPlan(planId);
      if (res.ok) {
        success("Fabric plan deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the queue -----------------------------------------------------------

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) =>
      [t.sc_no, t.order_code, t.po_no, t.customer_name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [tasks, search]);

  const columns: Column<FabricPlanTaskRow>[] = [
    {
      header: "RE No",
      cell: (t) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
          // A route cannot be planned against a BOM that is not there. The row
          // still LISTS — the operator needs to see the order is waiting — but
          // the door it would open leads nowhere useful.
          disabled={t.status === "no_bom"}
          onClick={() => openTask(t)}
        >
          {t.sc_no ?? t.order_code ?? "—"}
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
      header: "Fabrics",
      align: "right",
      cell: (t) => <span className="tabular-nums text-sm">{t.fabric_count}</span>,
    },
    {
      header: "Stages",
      align: "right",
      cell: (t) => <span className="tabular-nums text-sm">{t.stage_count}</span>,
    },
    {
      header: "Status",
      cell: (t) => (
        <StatusPill tone={fabricPlanStatusTone(t.status)}>
          {fabricPlanStatusText(t.status)}
        </StatusPill>
      ),
    },
    rowActionsColumn<FabricPlanTaskRow>((t) => (
      <RowActions
        label={t.sc_no ?? t.order_code}
        onEdit={() => openTask(t)}
        canEdit={perms.canEdit && t.status !== "no_bom"}
        canDelete={perms.canDelete && !!t.plan_id}
        onDelete={t.plan_id ? () => remove(t.plan_id as string) : undefined}
        deleteLabel="Delete plan"
        isPending={isPending}
      />
    )),
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Fabric Plan"
          description="Step 6 — the route that makes the fabric: yarn purchase, knitting, dyeing and finishing, with each stage's loss."
        />

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
                + New Fabric Plan
              </Button>
            )}
          </div>
        </div>

        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(t) => t.id}
          empty="No confirmed garment orders yet. A fabric plan is built against an order's Fabric BOM."
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
            <span className="font-semibold text-foreground">fabric plan</span>
          </>
        }
        header={{
          initials: "FP",
          title: pickedOrder?.code ?? (editId ? "Fabric Plan" : "New fabric plan"),
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              {pickedOrder?.customer_name && <span>{pickedOrder.customer_name}</span>}
              {form.plan_date && <span>· {fmtDate(form.plan_date)}</span>}
              <span>
                · {routedFabrics.length} of {routes.length} routed
              </span>
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New fabric plan",
          onCancel: () => setMode("list"),
          onSave: () => submit(false),
          saveLabel: "Save fabric plan",
          canSave: validity.canSave,
          onBlockedSave: revealFirstProblem,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />
    </>
  );
}

/** A computed quantity, or a dash. Read-only text and NOT an input: the figure is
 *  solved, and a box invites a click that does nothing (the same call the Fabric
 *  BOM's Total makes). */
function Qty({ value, unit }: { value: number | null; unit: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums text-sm">
      {fmtNumber(value)} {unit}
    </span>
  );
}
