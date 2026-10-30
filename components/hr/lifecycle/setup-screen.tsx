"use client";

import { X } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { ActiveField } from "@/components/ui/active-field";
import { Toggle } from "@/components/ui/toggle";
import { Tabs } from "@/components/ui/tabs";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { activeTone } from "@/lib/ui/status-tone";
import { fmtMoney } from "@/lib/format";
import {
  deleteRequiredDoc,
  deleteTemplate,
  saveExitStep,
  saveLcSettings,
  saveRequiredDoc,
  saveTemplate,
} from "@/lib/hr/lifecycle-actions";
import {
  APPLIES_TO,
  APPLIES_TO_LABELS,
  DOC_CATEGORIES,
  type AppliesTo,
  type ChecklistTemplate,
  type DocCategory,
  type ExitStepCatalog,
  type LcSettings,
  type RequiredDocument,
  type TemplateStep,
} from "@/lib/hr/lifecycle-types";

/**
 * HR ▸ Team Lifecycle ▸ Lifecycle Setup (0766). Four tabs: joining checklist
 * templates (MyJKKN `admin/onboarding-checklists`), required documents
 * (`admin/required-documents`), exit steps (`admin/offboarding` — policy
 * `hr.offboarding.workflow_steps` there), and the numbers the exit and the
 * full & final read.
 */

type Props = {
  templates: ChecklistTemplate[];
  required: RequiredDocument[];
  exitSteps: ExitStepCatalog[];
  settings: LcSettings;
  canEdit: boolean;
  canDelete: boolean;
};

export function LifecycleSetupScreen(props: Props) {
  return (
    <Tabs
      items={[
        { key: "templates", label: "Joining Checklists", content: <TemplatesTab {...props} /> },
        { key: "documents", label: "Required Documents", content: <RequiredTab {...props} /> },
        { key: "exit", label: "Exit Steps", content: <ExitStepsTab {...props} /> },
        { key: "settings", label: "Settings", content: <SettingsTab {...props} /> },
      ]}
    />
  );
}

function useSaver() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toastError(r.error ?? "Could not save");
        return;
      }
      success(done);
      after?.();
      router.refresh();
    });
  }
  return { isPending, run };
}

// ─── Joining checklist templates ───────────────────────────────────────────

type TplDraft = { name: string; applies_to: AppliesTo; is_active: boolean; steps: { key: string; title: string; due_day: string; owner: string }[] };
const blankStep = () => ({ key: crypto.randomUUID(), title: "", due_day: "0", owner: "HR" });

function TemplatesTab({ templates, canEdit, canDelete }: Props) {
  const { isPending, run } = useSaver();
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<TplDraft>({ name: "", applies_to: "both", is_active: true, steps: [blankStep()] });
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<TplDraft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const putStep = (key: string, patch: Partial<TplDraft["steps"][number]>) => {
    setD((x) => ({ ...x, steps: x.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
    setDirty(true);
  };

  function openEdit(t?: ChecklistTemplate) {
    setEditId(t?.id ?? null);
    setD(
      t
        ? {
            name: t.name,
            applies_to: t.applies_to,
            is_active: t.is_active,
            steps: t.steps.length
              ? t.steps.map((s: TemplateStep) => ({ key: crypto.randomUUID(), title: s.title, due_day: String(s.due_day ?? 0), owner: s.owner ?? "" }))
              : [blankStep()],
          }
        : { name: "", applies_to: "both", is_active: true, steps: [blankStep()] },
    );
    setDirty(false);
    setOpen(true);
  }
  function save() {
    // A step with no title is the blank end row — never saved.
    const steps = d.steps.filter((s) => s.title.trim()).map((s) => ({ title: s.title, due_day: Number(s.due_day) || 0, owner: s.owner }));
    run(
      () => saveTemplate(editId, { name: d.name, applies_to: d.applies_to, is_active: d.is_active, steps }),
      "Checklist saved",
      () => {
        setDirty(false);
        setOpen(false);
      },
    );
  }

  const columns: Column<ChecklistTemplate>[] = [
    { header: "Name", cell: (t) => <span className="text-sm font-medium">{t.name}</span> },
    { header: "For", cell: (t) => <span className="text-sm">{APPLIES_TO_LABELS[t.applies_to]}</span> },
    { header: "Steps", align: "right", cell: (t) => <span className="text-sm tabular-nums">{t.steps.length}</span> },
  ];
  const statusColumn: Column<ChecklistTemplate> = {
    header: "Status",
    cell: (t) => <StatusPill tone={activeTone(t.is_active)}>{t.is_active ? "Active" : "Inactive"}</StatusPill>,
  };
  const actions = rowActionsColumn<ChecklistTemplate>((t) => (
    <RowActions
      label={t.name}
      onEdit={() => openEdit(t)}
      canEdit={canEdit}
      onDelete={() => run(() => deleteTemplate(t.id), "Deleted")}
      canDelete={canDelete}
      isPending={isPending}
    />
  ));

  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Starting a checklist copies these steps onto the joiner; changing a template later does not change one already running.
        </span>
        {canEdit && <Button onClick={() => openEdit()}>+ Add Checklist</Button>}
      </div>
      <DataTable
        columns={[...withCreatedColumns(columns, templates), statusColumn, actions]}
        rows={templates}
        getKey={(t) => t.id}
        empty="No checklists yet."
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.name}` : "New joining checklist"}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !d.name.trim() || !d.steps.some((s) => s.title.trim())} onClick={save}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        <div className="max-w-[48rem] space-y-5">
          <FieldRow>
            <ActiveField active={d.is_active} onChange={(v) => put({ is_active: v })} isNew={!editId} />
            <Field label="Name" w="name" required>
              <Input value={d.name} onChange={(e) => put({ name: e.target.value })} />
            </Field>
            <Field label="For" w="term">
              <Select value={d.applies_to} onChange={(e) => put({ applies_to: e.target.value as AppliesTo })}>
                {APPLIES_TO.map((a) => (
                  <option key={a} value={a}>
                    {APPLIES_TO_LABELS[a]}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>

          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)_6rem_10rem_2rem] gap-2 text-xs font-medium text-muted-foreground">
              <span>Step</span>
              <span>Due (day)</span>
              <span>Who</span>
              <span />
            </div>
            <div data-grid-body="">
              {d.steps.map((s, i) => (
                <div key={s.key} data-grid-row="" className="mb-2 grid grid-cols-[minmax(0,1fr)_6rem_10rem_2rem] items-center gap-2">
                  <Input aria-label={`Step ${i + 1}`} value={s.title} onChange={(e) => putStep(s.key, { title: e.target.value })} />
                  <Input
                    aria-label={`Step ${i + 1} due day`}
                    type="number"
                    min="0"
                    value={s.due_day}
                    onChange={(e) => putStep(s.key, { due_day: e.target.value })}
                  />
                  <Input aria-label={`Step ${i + 1} owner`} value={s.owner} onChange={(e) => putStep(s.key, { owner: e.target.value })} />
                  {/* button-shape: exempt -- a round ✕ that removes the row */}
                  <button
                    type="button"
                    data-row-remove=""
                    aria-label={`Remove step ${i + 1}`}
                    disabled={d.steps.length === 1}
                    className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                    onClick={() => {
                      setD((x) => ({ ...x, steps: x.steps.filter((y) => y.key !== s.key) }));
                      setDirty(true);
                    }}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              data-row-add=""
              onClick={() => {
                setD((x) => ({ ...x, steps: [...x.steps, blankStep()] }));
                setDirty(true);
              }}
            >
              + Add step
            </Button>
            <p className="text-xs text-muted-foreground">Due day counts from the joining date (0 = the day they join).</p>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

// ─── Required documents ────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<DocCategory, string> = {
  identity: "Identity",
  address: "Address",
  education: "Education",
  employment: "Employment",
  statutory: "Statutory",
  bank: "Bank",
  medical: "Medical",
  other: "Other",
};

function RequiredTab({ required, canEdit, canDelete }: Props) {
  const { isPending, run } = useSaver();
  const blank = { code: "", name: "", category: "identity" as DocCategory, applies_to: "both" as AppliesTo, is_mandatory: true, has_expiry: false, sort_order: "0", is_active: true };
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(blank);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  function openEdit(r?: RequiredDocument) {
    setEditId(r?.id ?? null);
    setD(r ? { ...r, sort_order: String(r.sort_order) } : blank);
    setDirty(false);
    setOpen(true);
  }
  function save() {
    run(
      () =>
        saveRequiredDoc(editId, {
          code: d.code,
          name: d.name,
          category: d.category,
          applies_to: d.applies_to,
          is_mandatory: d.is_mandatory,
          has_expiry: d.has_expiry,
          sort_order: Number(d.sort_order) || 0,
          is_active: d.is_active,
        }),
      "Saved",
      () => {
        setDirty(false);
        setOpen(false);
      },
    );
  }

  const columns: Column<RequiredDocument>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code}</span> },
    { header: "Document", cell: (r) => <span className="text-sm font-medium">{r.name}</span> },
    { header: "Category", cell: (r) => <span className="text-sm">{CATEGORY_LABEL[r.category]}</span> },
    { header: "For", cell: (r) => <span className="text-sm">{APPLIES_TO_LABELS[r.applies_to]}</span> },
    { header: "Mandatory", cell: (r) => <span className="text-sm">{r.is_mandatory ? "Yes" : "No"}</span> },
    { header: "Expires", cell: (r) => <span className="text-sm">{r.has_expiry ? "Yes" : "No"}</span> },
  ];
  const statusColumn: Column<RequiredDocument> = {
    header: "Status",
    cell: (r) => <StatusPill tone={activeTone(r.is_active)}>{r.is_active ? "Active" : "Inactive"}</StatusPill>,
  };
  const actions = rowActionsColumn<RequiredDocument>((r) => (
    <RowActions
      label={r.name}
      onEdit={() => openEdit(r)}
      canEdit={canEdit}
      onDelete={() => run(() => deleteRequiredDoc(r.id), "Deleted")}
      canDelete={canDelete}
      isPending={isPending}
    />
  ));

  return (
    <div className="space-y-4 pt-3">
      <div className="flex justify-end">{canEdit && <Button onClick={() => openEdit()}>+ Add Document</Button>}</div>
      <DataTable
        columns={[...withCreatedColumns(columns, required), statusColumn, actions]}
        rows={required}
        getKey={(r) => r.id}
        empty="No required documents yet."
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.name}` : "New required document"}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !d.code.trim() || !d.name.trim()} onClick={save}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <FieldRow>
            <ActiveField active={d.is_active} onChange={(v) => put({ is_active: v })} isNew={!editId} />
            <Field label="Code" w="code" required>
              <Input value={d.code} maxLength={12} onChange={(e) => put({ code: e.target.value })} />
            </Field>
          </FieldRow>
          <Field label="Name" required>
            <Input value={d.name} onChange={(e) => put({ name: e.target.value })} />
          </Field>
          <FieldRow>
            <Field label="Category" w="code">
              <Select value={d.category} onChange={(e) => put({ category: e.target.value as DocCategory })}>
                {DOC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="For" w="term">
              <Select value={d.applies_to} onChange={(e) => put({ applies_to: e.target.value as AppliesTo })}>
                {APPLIES_TO.map((a) => (
                  <option key={a} value={a}>
                    {APPLIES_TO_LABELS[a]}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Toggle checked={d.is_mandatory} onChange={(v) => put({ is_mandatory: v })} label="Mandatory" />
            <Toggle checked={d.has_expiry} onChange={(v) => put({ has_expiry: v })} label="Has an expiry date" />
          </div>
          <Field label="Order" w="num">
            <Input type="number" min="0" value={d.sort_order} onChange={(e) => put({ sort_order: e.target.value })} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}

// ─── Exit steps ────────────────────────────────────────────────────────────

const CHECKED_KEYS: Record<string, string> = {
  asset_return: "Refused while any asset is still issued",
  final_settlement: "Refused until the full & final is approved",
};

function ExitStepsTab({ exitSteps, canEdit }: Props) {
  const { isPending, run } = useSaver();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ label: "", sort_order: "0", is_active: true });
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  function openEdit(s?: ExitStepCatalog) {
    setEditKey(s?.key ?? null);
    setD(s ? { label: s.label, sort_order: String(s.sort_order), is_active: s.is_active } : { label: "", sort_order: String((exitSteps.at(-1)?.sort_order ?? 0) + 10), is_active: true });
    setDirty(false);
    setOpen(true);
  }

  const columns: Column<ExitStepCatalog>[] = [
    { header: "Order", align: "right", cell: (s) => <span className="text-sm tabular-nums">{s.sort_order}</span> },
    { header: "Step", cell: (s) => <span className="text-sm font-medium">{s.label}</span> },
    { header: "Checked by the system", cell: (s) => <span className="text-sm text-muted-foreground">{CHECKED_KEYS[s.key] ?? "—"}</span> },
  ];
  const statusColumn: Column<ExitStepCatalog> = {
    header: "Status",
    cell: (s) => <StatusPill tone={activeTone(s.is_active)}>{s.is_active ? "Active" : "Inactive"}</StatusPill>,
  };
  const actions = rowActionsColumn<ExitStepCatalog>((s) => (
    <RowActions label={s.label} onEdit={() => openEdit(s)} canEdit={canEdit} canDelete={false} isPending={isPending} />
  ));

  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Every new exit copies the active steps. Switch a step off rather than deleting it — exits already open keep theirs.
        </span>
        {canEdit && <Button onClick={() => openEdit()}>+ Add Step</Button>}
      </div>
      <DataTable
        columns={[...withCreatedColumns(columns, exitSteps), statusColumn, actions]}
        rows={exitSteps}
        getKey={(s) => s.key}
        empty="No exit steps."
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editKey ? "Edit exit step" : "New exit step"}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !d.label.trim()}
              onClick={() =>
                run(
                  () => saveExitStep(editKey, { key: "", label: d.label, sort_order: Number(d.sort_order) || 0, is_active: d.is_active }),
                  "Saved",
                  () => {
                    setDirty(false);
                    setOpen(false);
                  },
                )
              }
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <FieldRow>
            <ActiveField
              active={d.is_active}
              onChange={(v) => {
                setD((x) => ({ ...x, is_active: v }));
                setDirty(true);
              }}
              isNew={!editKey}
            />
            <Field label="Order" w="num">
              <Input
                type="number"
                min="0"
                value={d.sort_order}
                onChange={(e) => {
                  setD((x) => ({ ...x, sort_order: e.target.value }));
                  setDirty(true);
                }}
              />
            </Field>
          </FieldRow>
          <Field label="Step" required>
            <Input
              value={d.label}
              onChange={(e) => {
                setD((x) => ({ ...x, label: e.target.value }));
                setDirty(true);
              }}
            />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}

// ─── Settings ──────────────────────────────────────────────────────────────

function SettingsTab({ settings, canEdit }: Props) {
  const { isPending, run } = useSaver();
  const [d, setD] = useState(() => Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v)])) as Record<keyof LcSettings, string>);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);
  const put = (k: keyof LcSettings, v: string) => {
    setD((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const num = (k: keyof LcSettings, label: string, hint?: string) => (
    <Field label={label} w="hug" hint={hint}>
      <Input type="number" min="0" disabled={!canEdit} value={d[k]} onChange={(e) => put(k, e.target.value)} />
    </Field>
  );

  return (
    <div className="max-w-[48rem] space-y-6 pt-3">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Retirement</h3>
        <FieldRow>
          {num("retirement_age", "Retirement age")}
          {num("retirement_lookahead", "Show this many months ahead")}
        </FieldRow>
      </section>
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notice period (days)</h3>
        <FieldRow>
          {num("notice_days_staff", "Staff")}
          {num("notice_days_workers", "Workers")}
        </FieldRow>
      </section>
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gratuity</h3>
        <FieldRow>
          {num("gratuity_min_years", "Minimum service (years)", "Not applied on death")}
          {num("gratuity_cap", "Most payable (₹)", `Now ${fmtMoney(Number(d.gratuity_cap) || 0)}`)}
        </FieldRow>
      </section>
      {canEdit && (
        <div className="flex justify-end">
          <Button
            disabled={isPending || !dirty}
            onClick={() => run(() => saveLcSettings(d), "Settings saved", () => setDirty(false))}
          >
            {isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      )}
    </div>
  );
}
