"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { today } from "@/lib/calendar";
import { applyWarning, templateActivities, templateSummary } from "@/lib/ta/template";
import {
  addWorkingDays,
  backwardSchedule,
  isRefusal,
  subtractWorkingDays,
} from "@/lib/ta/schedule";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { fmtDate } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { RecordPicker } from "@/components/masters/record-picker";
import { createTaPlan, updateTaPlan, deleteTaPlan } from "@/lib/orders/ta-plan/actions";
import type { TaPlanDoc } from "@/lib/orders/ta-plan/types";
import type { TaPlanFormData } from "@/lib/orders/ta-plan/service";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
interface Props {
  rows: TaPlanDoc[];
  data: TaPlanFormData;
  perms: Perms;
}

type LineRow = {
  key: string;
  activity_id: string | null;
  from_activity_id: string | null;
  details: string;
  start_date: string;
  days_required: string;
  end_date: string;
};

/*
 * TWO LOCAL COPIES OF CALENDAR ARITHMETIC LIVED HERE AND BOTH ARE GONE (2026-08-21).
 *
 * `today()` was `new Date().toISOString().slice(0, 10)` - UTC, so for the first
 * 5.5 hours of every Tirupur day it dated a plan YESTERDAY. `lib/calendar.ts`
 * exists because that bug reached the dashboard and the Created Date filter; its
 * `today()` reads the factory's own zone.
 *
 * `addDays` was `new Date(iso + "T00:00:00").setDate(...)` - wall-clock
 * arithmetic on a value that is a plain `YYYY-MM-DD` string. It is the exact
 * technique `lib/calendar.ts`'s header warns about, and it was the app's third
 * implementation of adding days to a date.
 */

/**
 * End = Start + Days Required, COUNTED IN WORKING DAYS.
 *
 * It counted calendar days until the backward scheduler arrived, and the two
 * cannot disagree on one screen: a plan filled from the delivery date and then
 * nudged forward by a single edit would contradict itself by however many
 * Sundays the span contained, with both dates looking perfectly ordinary.
 *
 * `addWorkingDays` refuses a fractional or negative figure; a refusal here means
 * the operator is mid-keystroke, so the row is left exactly as it was rather
 * than blanked - the same call the grid already makes for an empty box.
 */
function withEnd(row: LineRow): LineRow {
  const days = Number(row.days_required);
  if (row.start_date && row.days_required !== "" && !Number.isNaN(days)) {
    const end = addWorkingDays(row.start_date, days);
    return isRefusal(end) ? row : { ...row, end_date: end };
  }
  return row;
}

export function TaPlanScreen({ rows, data, perms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);

  // header
  const [planDate, setPlanDate] = useState(() => today());
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState("");
  const [startDate, setStartDate] = useState("");
  const [styleId, setStyleId] = useState<string | null>(null);
  /* WHICH TEMPLATE THE LADDER CAME FROM (0453). Provenance, not a live link:
     applying COPIES, and a later template edit never reaches this plan. */
  const [taStyleId, setTaStyleId] = useState<string | null>(null);
  // footer
  const [deliveryDate, setDeliveryDate] = useState("");
  const [orderQty, setOrderQty] = useState("");
  const [proposedDeliveryDate, setProposedDeliveryDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [noOfDays, setNoOfDays] = useState("");
  // grid
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // Inline editor, not a Sheet / MasterFullScreen — see mba-master-screen.tsx.
  useUnsavedGuard(mode === "edit" || isPending);

  const activityName = useMemo(() => {
    const m = new Map<string, string>();
    data.activities.forEach((a) => m.set(a.id, a.name));
    return m;
  }, [data.activities]);

  function blankLine(): LineRow {
    return {
      key: newKey(),
      activity_id: null,
      from_activity_id: null,
      details: "",
      start_date: "",
      days_required: "",
      end_date: "",
    };
  }

  function openAdd() {
    setEditId(null);
    setPlanDate(today());
    setCustomerId(null);
    setOrderId(null);
    setShipmentId(null);
    setOrderNo("");
    setStartDate("");
    setStyleId(null);
    setTaStyleId(null);
    setDeliveryDate("");
    setOrderQty("");
    setProposedDeliveryDate("");
    setTargetDate("");
    setNoOfDays("");
    setLines([blankLine()]);
    setMode("edit");
  }

  useCreateIntent(() => openAdd());

  function openEdit(r: TaPlanDoc) {
    setEditId(r.id);
    setPlanDate(r.plan_date ?? today());
    setCustomerId(r.customer_id);
    setOrderId(r.sales_order_id);
    setShipmentId(r.shipment_plan_id);
    setOrderNo(r.order_no ?? "");
    setStartDate(r.start_date ?? "");
    setStyleId(r.style_id);
    setTaStyleId(r.ta_style_id);
    setDeliveryDate(r.delivery_date ?? "");
    setOrderQty(r.order_qty != null ? String(r.order_qty) : "");
    setProposedDeliveryDate(r.proposed_delivery_date ?? "");
    setTargetDate(r.target_date ?? "");
    setNoOfDays(r.no_of_days != null ? String(r.no_of_days) : "");
    setLines(
      r.activities.length
        ? r.activities.map((a) => ({
            key: newKey(),
            activity_id: a.activity_id,
            from_activity_id: a.from_activity_id,
            details: a.details ?? "",
            start_date: a.start_date ?? "",
            days_required: a.days_required != null ? String(a.days_required) : "",
            end_date: a.end_date ?? "",
          }))
        : [blankLine()],
    );
    setMode("edit");
  }

  function onPickOrder(id: string | null) {
    setOrderId(id);
    if (!id) return;
    const o = data.orders.find((x) => x.id === id);
    if (!o) return;
    if (o.buyer_id) setCustomerId(o.buyer_id);
    if (o.order_number) setOrderNo(o.order_number);
    if (o.order_qty != null) setOrderQty(String(o.order_qty));
    if (o.ship_date) setDeliveryDate(o.ship_date);
  }

  function patchLine(key: string, patch: Partial<LineRow>) {
    setLines((xs) => xs.map((x) => (x.key === key ? withEnd({ ...x, ...patch }) : x)));
  };

  /**
   * THE TEMPLATES THIS PLAN MAY PICK FROM.
   *
   * SCOPED TO THE CUSTOMER, THROUGH A BRIDGE THAT IS OFTEN NULL. A plan's party
   * is a `buyers` row and a template's is a `customers` row - different tables
   * (see `raagam-two-party-tables`), joined only by `buyers.customer_id` (0380),
   * which is nullable. Where the bridge resolves the list narrows; where it does
   * not, every template is offered rather than claiming this party has none. A
   * filter that silently returned nothing would read as "no templates exist".
   *
   * A BLOCKED OR DRAFT TEMPLATE IS NOT OFFERED, except the one this plan already
   * names - dropping that would show a filled field as empty and blank the FK on
   * the next save. The standing "Disabled rows" rule, and the service selects
   * `blocked` precisely so this half is possible.
   */
  const templateOptions = useMemo(() => {
    const wantCustomer = customerId ? (data.buyerCustomer?.[customerId] ?? null) : null;
    return data.taStyles.filter(
      (t) =>
        t.id === taStyleId ||
        ((!t.blocked && !t.is_draft) &&
          (wantCustomer == null || t.customer_id == null || t.customer_id === wantCustomer)),
    );
  }, [data.taStyles, data.buyerCustomer, customerId, taStyleId]);

  const pickedTemplate = templateOptions.find((t) => t.id === taStyleId) ?? null;

  /**
   * COPY THE TEMPLATE'S LADDER ONTO THIS PLAN.
   *
   * ## IT REPLACES, AND IT SAYS SO FIRST
   *
   * A template is a starting point, so replacing is the useful behaviour - but
   * the rows it replaces may carry dates the planner typed or scheduled. The
   * confirm names how many go and how many arrive (`applyWarning`); "are you
   * sure?" would tell them nothing they did not already know.
   *
   * ## IT DOES NOT DATE THE LADDER
   *
   * A template carries no dates and cannot: it is reusable precisely because it
   * is not tied to one delivery date. So this fills the SHAPE and "Schedule
   * back" fills the dates - two operations the planner can see and re-run
   * independently, rather than one button that does both and cannot be partly
   * undone.
   */
  const applyTemplate = () => {
    if (!pickedTemplate) return;

    const rows = templateActivities(pickedTemplate);
    // REFUSES BEFORE IT CLEARS ANYTHING. A template with a row carrying no
    // activity would otherwise wipe the grid and leave a hole the planner reads
    // as their own omission.
    if (isRefusal(rows)) {
      toastError(rows.refused);
      return;
    }

    const filled = lines.filter((l) => l.activity_id || l.days_required || l.start_date);
    const warn = applyWarning(pickedTemplate, filled.length);
    if (warn && !window.confirm(warn)) return;

    setLines(
      rows.map((r) => ({
        key: newKey(),
        activity_id: r.activity_id,
        from_activity_id: r.from_activity_id,
        details: r.details ?? "",
        start_date: "",
        days_required: String(r.days_required ?? 0),
        end_date: "",
      })),
    );
    // The footer's own figures follow the template, so the two agree the moment
    // it lands. `target_date` stays empty: it is a DATE, and nothing here has one
    // until the ladder is scheduled.
    const sum = templateSummary(pickedTemplate);
    setNoOfDays(String(sum.workDays));
    setTargetDate("");
    success(
      `${sum.activities} activities from ${pickedTemplate.code ?? "the template"}` +
        ` — ${sum.workDays} working days. Now set Deliv. Dt and schedule back.`,
    );
  };

  /**
   * FILL THE LADDER BACKWARD FROM THE DELIVERY DATE.
   *
   * The grid reads DOWNSTREAM-LAST - Material In-House at the top, Final
   * Inspection at the bottom - because that is the order the floor works in. The
   * scheduler takes the opposite order, so the rows are reversed on the way in
   * and the results mapped back by key. Reversing in the caller rather than
   * teaching the module both orders keeps one direction of arithmetic.
   *
   * ## IT IS A BUTTON, NOT AN EFFECT
   *
   * An effect on `deliveryDate` would overwrite dates the planner had typed the
   * moment they corrected the delivery date by a day - and the legacy screen
   * lets a planner override a computed date on purpose (see `End Dt` below).
   * Recomputing has to be something they ASK for, so what it overwrites is never
   * a surprise.
   *
   * ## A REFUSAL SAYS WHICH ROW, AND CHANGES NOTHING
   *
   * Partially filling the ladder would leave some rows scheduled and some as the
   * planner left them, with nothing on screen saying which is which - the
   * partial-explosion failure the BOM engines refuse for the same reason.
   */
  const scheduleBackward = () => {
    const ladder = [...lines].reverse();
    const plan = backwardSchedule({
      deliveryDate,
      steps: ladder.map((r) => ({
        key: r.key,
        // NAMED, so a refusal points at a row rather than at the ladder. An
        // unpicked activity still has to say something the planner can find.
        label: activityName.get(r.activity_id ?? "") ?? "This activity",
        days: r.days_required === "" ? null : Number(r.days_required),
      })),
    });
    if (isRefusal(plan)) {
      toastError(plan.refused);
      return;
    }

    const byKey = new Map(plan.steps.map((x) => [x.key, x]));
    setLines((xs) =>
      xs.map((x) => {
        const at = byKey.get(x.key);
        if (!at) return x;
        // Start is the same walk one step further back: the process needs its
        // own days BEFORE the date it must be complete on.
        const start = subtractWorkingDays(at.date, at.days);
        return {
          ...x,
          end_date: at.date,
          start_date: isRefusal(start) ? x.start_date : start,
        };
      }),
    );
    setTargetDate(plan.startDate);
    setNoOfDays(String(ladder.reduce((sum, r) => sum + (Number(r.days_required) || 0), 0)));
    // THE FLOAT IS SAID OUT LOUD when it is negative. A plan whose first task
    // was due before today is not a plan, and a grid full of past dates reads as
    // ordinary work until somebody adds them up.
    if (plan.float < 0) {
      toastError(
        `Scheduled, but work had to start ${Math.abs(plan.float)} days ago — this delivery date cannot be met`,
      );
    } else {
      success(`Scheduled back to ${plan.startDate}`);
    }
  }

  function onPickFromActivity(key: string, fromActivityId: string | null) {
    // suggest this row's Start Dt = the predecessor row's End Dt
    const predecessor = lines.find(
      (l) => l.key !== key && l.activity_id === fromActivityId && l.end_date,
    );
    patchLine(key, {
      from_activity_id: fromActivityId,
      ...(predecessor ? { start_date: predecessor.end_date } : {}),
    });
  }

  function submit() {
    const payload = {
      plan_date: planDate,
      customer_id: customerId,
      sales_order_id: orderId,
      shipment_plan_id: shipmentId,
      order_no: orderNo || null,
      start_date: startDate || null,
      style_id: styleId,
      delivery_date: deliveryDate || null,
      order_qty: orderQty ? Number(orderQty) : null,
      proposed_delivery_date: proposedDeliveryDate || null,
      target_date: targetDate || null,
      no_of_days: noOfDays ? Number(noOfDays) : null,
      ta_style_id: taStyleId,
      activities: lines.map((l) => ({
        sno: 0,
        activity_id: l.activity_id,
        from_activity_id: l.from_activity_id,
        details: l.details || null,
        start_date: l.start_date || null,
        days_required: l.days_required ? Number(l.days_required) : null,
        end_date: l.end_date || null,
      })),
    };
    start(async () => {
      const res = editId ? await updateTaPlan(editId, payload) : await createTaPlan(payload);
      if (res.ok) {
        success(editId ? "Plan updated" : "Plan created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: TaPlanDoc) {
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deleteTaPlan(r.id);
      if (res.ok) {
        success("Plan deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST ----------------
  if (mode === "list") {
    const columns: Column<TaPlanDoc>[] = [
      {
        header: "No",
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
      { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.plan_date)}</span> },
      { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
      {
        header: "SC No",
        cell: (r) => <span className="font-mono text-xs">{r.sales_order?.order_number ?? "—"}</span>,
      },
      { header: "Style", cell: (r) => <span className="text-sm">{r.style?.style_name ?? "—"}</span> },
      {
        header: "Activities",
        align: "right",
        cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{r.activities.length}</span>,
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
          title="TA Plan"
          description="Time & Action plan document — schedule activities against an order with target dates."
          actions={perms.canCreate ? <Button onClick={openAdd}>New TA Plan</Button> : undefined}
        />
        <DataTable columns={withCreatedColumns(columns, rows)} rows={rows} getKey={(r) => r.id} empty="No TA plans yet." />
      </div>
    );
  }

  // ---------------- EDIT ----------------
  // From-Activity options = other rows in this plan that have an activity picked.
  const fromActivityOptions = lines
    .filter((l) => l.activity_id)
    .map((l) => ({ id: l.activity_id as string, name: activityName.get(l.activity_id as string) ?? "—" }));

  const activityColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Activity",
      className: "min-w-[180px]",
      cell: (r) => (
        <RecordPicker
          label="Activity"
          items={data.activities}
          value={r.activity_id}
          onChange={(id) => patchLine(r.key, { activity_id: id })}
          compact
        />
      ),
    },
    {
      header: "From Activity",
      className: "min-w-[160px]",
      cell: (r) => (
        <Select
          className="h-8"
          value={r.from_activity_id ?? ""}
          onChange={(e) => onPickFromActivity(r.key, e.target.value || null)}
        >
          <option value=""></option>
          {fromActivityOptions
            .filter((o) => o.id !== r.activity_id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </Select>
      ),
    },
    {
      header: "Details",
      className: "min-w-[140px]",
      cell: (r) => (
        <Input
          className="h-8"
          value={r.details}
          onChange={(e) => patchLine(r.key, { details: e.target.value })}
        />
      ),
    },
    {
      header: "Start Dt",
      className: "min-w-[9rem]",
      cell: (r) => (
        <Input
          className="h-8"
          type="date"
          value={r.start_date}
          onChange={(e) => patchLine(r.key, { start_date: e.target.value })}
        />
      ),
    },
    {
      header: "Days Req.",
      align: "right",
      className: "min-w-[6rem]",
      cell: (r) => (
        <Input
          className="h-8 text-right"
          type="number"
          min="0"
          value={r.days_required}
          onChange={(e) => patchLine(r.key, { days_required: e.target.value })}
        />
      ),
    },
    {
      // Derived — `withEnd` recomputes it from Start Dt + Days Required on every
      // patch — but still editable, because the legacy screen lets a planner
      // override a computed date without changing the inputs behind it.
      header: "End Dt",
      className: "min-w-[9rem]",
      cell: (r) => (
        <Input
          className="h-8"
          type="date"
          value={r.end_date}
          onChange={(e) => patchLine(r.key, { end_date: e.target.value })}
        />
      ),
    },
  ];

  return (
    // ONE MARKER, NEVER A HANDLER. `isEditorScope()` is false without it, so Tab
    // keeps native order and walks out of the form. The PageHeader inside is
    // stamped `data-focus-region="header"` by the component itself, so its
    // actions sort as chrome rather than with the fields.
    <div data-focus-scope className="space-y-4">
      <PageHeader
        title={editId ? "Edit TA Plan" : "New TA Plan"}
        // back={false}: this screen swaps a list and an editor at ONE url, and
        // the editor already shows "← Back to list". The derived hub link is
        // right on the LIST branch above and a second, differently aimed Back here.
        back={false}
        description="Schedule activities against the order. End Dt = Start Dt + Days Required."
        actions={
          <Button variant="outline" size="md" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* Header band — `FieldGrid`, not a hand-rolled
          `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. A screen composes
          primitives, it does not draw (LAYOUT.md §3), and every field takes the
          one width the app fixes a field at. */}
      <Card>
        <CardBody>
          <FieldGrid>
            {/* `readOnly`, NOT `disabled` — the legacy TA Plan shows its number
                in a normal box, and `disabled` renders it at `opacity-50`
                (input.tsx), so an auto value read as switched off rather than as
                filled in (operator, 2026-08-11). `readOnly` also keeps the value
                in the accessibility tree, which `disabled` removes, and `Input`
                already sets `tabIndex={-1}` on a readOnly field so it stays off
                the typing path. */}
            <Field label="No" size="sm" htmlFor="tap-no">
              <Input
                id="tap-no"
                className="font-mono"
                value={editId ? (rows.find((r) => r.id === editId)?.code ?? "") : "(auto)"}
                readOnly
              />
            </Field>
            {/* `required` on the Field, not a `*` typed into the label — the same
                prop draws the star AND stamps `data-required-empty`, so the
                cursor actually holds on a blank box. Typed by hand it was
                decoration and Tab walked straight past it. */}
            <Field label="Dt" required size="sm" htmlFor="tap-date">
              <Input id="tap-date" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
            </Field>
            {/* The pickers draw their own labels; `Field` carries the span. */}
            <Field size="sm">
              <RecordPicker label="Customer" items={data.buyers} value={customerId} onChange={setCustomerId} />
            </Field>
            <Field size="sm">
              {/* `identity="code"` — on an SC No the CODE is the identity and the
                  name is the customer, so without it several orders for one buyer
                  are indistinguishable in the list. */}
              <RecordPicker
                label="SC No"
                identity="code"
                items={data.orders.map((o) => ({ id: o.id, code: o.order_number, name: o.order_number ?? "—" }))}
                value={orderId}
                onChange={onPickOrder}
              />
            </Field>
            <Field size="sm">
              <RecordPicker label="SH Ref No" items={data.shipmentPlans} value={shipmentId} onChange={setShipmentId} />
            </Field>
            <Field label="Order No" size="sm" htmlFor="tap-orderno">
              <Input id="tap-orderno" uppercase value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
            </Field>
            <Field label="Start Dt" size="sm" htmlFor="tap-start">
              <Input id="tap-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field size="sm">
              <RecordPicker label="Style" items={data.styles} value={styleId} onChange={setStyleId} />
            </Field>
            {/* THE TEMPLATE, BESIDE THE FIELDS IT FILLS FROM. Picking it changes
                nothing on its own - Apply is a separate, deliberate press,
                because it REPLACES the activity grid. The two controls share one
                field slot so the pair reads as one action rather than a picker
                whose effect is elsewhere on the screen. */}
            <Field size="sm">
              <div className="flex items-center gap-2">
                <RecordPicker
                  label="T&A Template"
                  items={templateOptions.map((t) => ({
                    id: t.id,
                    code: t.code,
                    // The description IS the template's name; its own screen has
                    // no other. A blank one still has to be pickable.
                    name: t.description || "(no description)",
                  }))}
                  value={taStyleId}
                  onChange={setTaStyleId}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={applyTemplate}
                  disabled={!pickedTemplate}
                  title={
                    !pickedTemplate
                      ? "Pick a template first"
                      : `Replace the activity grid with the ${pickedTemplate.activities.length} activities from ${pickedTemplate.code ?? "this template"}`
                  }
                >
                  Apply
                </Button>
              </div>
            </Field>
          </FieldGrid>
        </CardBody>
      </Card>

      {/* Activity grid — `ChildGrid`, not the hand-rolled <table> this carried.
          That one drew its own S No cell and its own Trash2 button, so it
          inherited neither Ctrl+Del nor `data-row-remove` — two of the ~22 grids
          AGENTS.md counts under "Tab lands on fields". Six columns fit the width,
          so it keeps the table layout rather than wrapping. */}
      <Card>
        <CardBody>
          <ChildGrid<LineRow>
            label="Activities"
            columns={activityColumns}
            rows={lines}
            seedRow
            onAdd={() => setLines((xs) => [...xs, blankLine()])}
            onRemove={(r) => setLines((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add activity"
          />
        </CardBody>
      </Card>

      {/* Footer band — the same one field track as the header, in place of its
          own `lg:grid-cols-5`. Five columns was a third width on one screen. */}
      <Card>
        <CardBody>
          <FieldGrid>
            <Field label="Deliv. Dt" size="sm" htmlFor="tap-deliv">
              <div className="flex items-center gap-2">
                <Input id="tap-deliv" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                {/* THE ONE CONTROL THAT SCHEDULES, beside the date it schedules
                    FROM. Disabled with a `title` rather than hidden: a button
                    that disappears when the ladder is empty teaches nothing,
                    and this is the screen's only route to a backward plan. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={scheduleBackward}
                  disabled={!deliveryDate || lines.length === 0}
                  title={
                    !deliveryDate
                      ? "Enter the delivery date first"
                      : lines.length === 0
                        ? "Add activities first"
                        : "Fill every activity's dates backward from the delivery date"
                  }
                >
                  Schedule back
                </Button>
              </div>
            </Field>
            <Field label="Order Qty" size="sm" htmlFor="tap-qty">
              <Input id="tap-qty" type="number" min="0" value={orderQty} onChange={(e) => setOrderQty(e.target.value)} />
            </Field>
            <Field label="Proposed Deliv. Dt" size="sm" htmlFor="tap-prop">
              <Input id="tap-prop" type="date" value={proposedDeliveryDate} onChange={(e) => setProposedDeliveryDate(e.target.value)} />
            </Field>
            <Field label="Target Dt" size="sm" htmlFor="tap-target">
              <Input id="tap-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </Field>
            <Field label="No of Days" size="sm" htmlFor="tap-nod">
              <Input id="tap-nod" type="number" min="0" value={noOfDays} onChange={(e) => setNoOfDays(e.target.value)} />
            </Field>
          </FieldGrid>
        </CardBody>
      </Card>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>Cancel</Button>
        <Button disabled={isPending || !planDate} onClick={submit}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
