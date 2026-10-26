"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ActiveField } from "@/components/ui/active-field";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { activeTone } from "@/lib/ui/status-tone";
import { saveComplaintCategory, setComplaintCategoryInactive } from "@/lib/resolve/actions";
import type { ComplaintCategoryRow } from "@/lib/resolve/service";
import type { CategoryMemberRole } from "@/lib/resolve/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Person = { id: string; name: string };
type MemberRow = { key: string; profile_id: string; role: CategoryMemberRole | "" };

let seq = 0;
/** Every key blank, so an untouched line is dropped on save rather than
 *  inserted as a phantom member (AGENTS "Editable sub-tables"). */
const blankMember = (): MemberRow => ({ key: `cm${++seq}`, profile_id: "", role: "" });

const ROLE_LABEL: Record<CategoryMemberRole, string> = { committee: "Committee", oversight: "Oversight" };

const blankForm = () => ({
  code: "",
  name: "",
  description: "",
  is_sensitive: false,
  anonymous_allowed: false,
  handler_id: "",
  response_hours: "72",
  inactive: false,
});
type Form = ReturnType<typeof blankForm>;

/** A code from the name — the operator is never asked for one (client
 *  2026-07-23); an existing category keeps its stored code. */
function codeFrom(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "CATEGORY";
}

/**
 * Resolve Hub ▸ Administration ▸ Complaint Categories — what a complaint can
 * be about, and WHO HANDLES IT. Complaint handling is configured here, per
 * category, not by a permission: the default handler gets new complaints, the
 * committee may work them, oversight is told when one goes unanswered.
 *
 * SENSITIVE is a visibility boundary, not a label (plan §10.3): a sensitive
 * category's complaints are seen by the people listed here and nobody else —
 * not triage, not administrators. So the member list IS the access list.
 */
export function ComplaintCategoriesScreen({
  rows,
  perms,
  people,
}: {
  rows: ComplaintCategoryRow[];
  perms: Perms;
  people: Person[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blankForm);
  const [members, setMembers] = useState<MemberRow[]>(() => [blankMember()]);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(open && (dirty || isPending));

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setMember = (key: string, patch: Partial<MemberRow>) => {
    setMembers((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
    setDirty(true);
  };

  const dupError = useDuplicateName({
    table: "rh_complaint_categories",
    name: form.name,
    label: "name",
    excludeId: editId ?? undefined,
    enabled: open && !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });

  const personOptions = useMemo(() => people.map((p) => ({ value: p.id, label: p.name })), [people]);
  const editing = editId ? rows.find((r) => r.id === editId) ?? null : null;

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setMembers([blankMember()]);
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: ComplaintCategoryRow) {
    setEditId(r.id);
    setForm({
      code: r.code,
      name: r.name,
      description: r.description ?? "",
      is_sensitive: r.is_sensitive,
      anonymous_allowed: r.anonymous_allowed,
      handler_id: r.handler_id ?? "",
      response_hours: String(r.response_hours),
      inactive: r.inactive,
    });
    const held = r.members.map((m) => ({ key: m.id, profile_id: m.profile_id, role: m.role }));
    setMembers(held.length ? held : [blankMember()]);
    setDirty(false);
    setOpen(true);
  }

  // A line counts once the person is picked; a picked person needs a role.
  const kept = members.filter((m) => m.profile_id);
  const roleMissing = kept.some((m) => !m.role);
  const twice = kept.length !== new Set(kept.map((m) => m.profile_id)).size;
  const hours = Number(form.response_hours);
  const hoursOk = Number.isInteger(hours) && hours >= 1;
  const canSave = !!form.name.trim() && hoursOk && !dupError && !roleMissing && !twice && !isPending;

  function submit() {
    startTransition(async () => {
      const res = await saveComplaintCategory({
        id: editId ?? undefined,
        code: editing?.code ?? codeFrom(form.name),
        name: form.name,
        description: form.description || null,
        is_sensitive: form.is_sensitive,
        anonymous_allowed: form.anonymous_allowed,
        handler_id: form.handler_id || null,
        response_hours: hours,
        inactive: form.inactive,
        members: kept.map((m) => ({ profile_id: m.profile_id, role: m.role as CategoryMemberRole })),
      });
      if (res.ok) {
        success(editId ? "Category updated." : "Category added.");
        setOpen(false);
        router.refresh();
      } else error(res.error);
    });
  }

  function switchOff(r: ComplaintCategoryRow) {
    startTransition(async () => {
      const res = await setComplaintCategoryInactive(r.id, true);
      if (res.ok) {
        success(`${r.name} switched off — it is no longer offered on the complaint form.`);
        router.refresh();
      } else error(res.error);
    });
  }

  // 288 person + 144 role + 72 chrome = 504px.
  const categoryMemberColumns: ChildGridColumn<MemberRow>[] = [
    {
      header: "Person",
      width: FIELD_WIDTH_CSS.name,
      cell: (m) => (
        <Combobox
          options={personOptions.filter(
            (o) => o.value === m.profile_id || !members.some((x) => x.key !== m.key && x.profile_id === o.value),
          )}
          value={m.profile_id}
          onChange={(v) => setMember(m.key, { profile_id: v })}
        />
      ),
    },
    {
      header: "Role",
      width: FIELD_WIDTH_CSS.code,
      cell: (m) => (
        <Select
          aria-label="Role"
          value={m.role}
          onChange={(e) => setMember(m.key, { role: e.target.value as CategoryMemberRole })}
        >
          <option value="" />
          <option value="committee">Committee</option>
          <option value="oversight">Oversight</option>
        </Select>
      ),
    },
  ];

  const categoryColumns: Column<ComplaintCategoryRow>[] = [
    {
      header: "Category",
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{r.name}</span>
          {r.is_sensitive && <StatusPill tone="warning">Sensitive</StatusPill>}
        </span>
      ),
    },
    { header: "Handler", cell: (r) => <span className="text-sm">{r.handler_name ?? "—"}</span> },
    {
      header: "Committee",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.members.filter((m) => m.role === "committee").length}</span>,
    },
    {
      header: "Oversight",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.members.filter((m) => m.role === "oversight").length}</span>,
    },
    { header: "Anonymous", cell: (r) => <span className="text-sm">{r.anonymous_allowed ? "Allowed" : "No"}</span> },
    { header: "Respond In", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.response_hours} h</span> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={activeTone(!r.inactive)}>{r.inactive ? "Inactive" : "Active"}</StatusPill>,
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.code, r.name, r.handler_name, ...r.members.map((m) => m.name)].filter(Boolean).join(" ")}
        searchPlaceholder="Search category, handler or member…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Category"
        onAdd={perms.canCreate ? openAdd : undefined}
        columns={categoryColumns}
        actions={{
          onEdit: openEdit,
          onDelete: switchOff,
          menuAs: "icons",
          deleteDisabledReason: (r) => (r.inactive ? "Already switched off" : null),
        }}
        rowLabel={(r) => r.name}
        empty="No complaint categories in this unit yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) => [r.is_sensitive ? "Sensitive" : null, r.handler_name ? `Handler ${r.handler_name}` : null].filter(Boolean).join(" · "),
          pill: (r) => <StatusPill tone={activeTone(!r.inactive)}>{r.inactive ? "Inactive" : "Active"}</StatusPill>,
          onEdit: openEdit,
          onDelete: switchOff,
        }}
        isPending={isPending}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title={editId ? `Edit ${form.name || "Category"}` : "New Complaint Category"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save category"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* 88 status + 288 name + 200 handler + 88 hours + 3 × 12px gap = 700px → 44rem. */}
          <FieldRow className="max-w-[44rem]">
            <ActiveField id="rh-cc-active" active={!form.inactive} onChange={(on) => set({ inactive: !on })} isNew={!editId} />
            <Field label="Name" required w="name" htmlFor="rh-cc-name">
              <Input
                id="rh-cc-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                {...dupFieldProps(dupError, "rh-cc-name")}
              />
              <DuplicateError error={dupError} id="rh-cc-name" />
            </Field>
            <Field label="Default Handler" w="party" htmlFor="rh-cc-handler">
              <Combobox id="rh-cc-handler" options={personOptions} value={form.handler_id} onChange={(v) => set({ handler_id: v })} clearable />
            </Field>
            <Field label="Respond In" required w="hug" htmlFor="rh-cc-hours" hint="Hours">
              <Input id="rh-cc-hours" type="number" min="1" value={form.response_hours} onChange={(e) => set({ response_hours: e.target.value })} />
            </Field>
          </FieldRow>
          {/* 288 description + 200 + 200 toggles + 2 × 12px gap = 712px → 45rem. */}
          <FieldRow className="max-w-[45rem]" align="start">
            <Field label="Description" w="name" htmlFor="rh-cc-desc">
              <Textarea id="rh-cc-desc" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field
              label="Sensitive"
              w="party"
              htmlFor="rh-cc-sensitive"
              hint="Only the handler, committee and oversight members listed here can see these — not triage, not administrators."
            >
              <span className="flex min-h-9 items-center">
                <Toggle id="rh-cc-sensitive" checked={form.is_sensitive} onChange={(on) => set({ is_sensitive: on })} />
              </span>
            </Field>
            <Field label="Anonymous Allowed" w="party" htmlFor="rh-cc-anon" hint="The reporter may hide their name; only a tracking link follows it.">
              <span className="flex min-h-9 items-center">
                <Toggle id="rh-cc-anon" checked={form.anonymous_allowed} onChange={(on) => set({ anonymous_allowed: on })} />
              </span>
            </Field>
          </FieldRow>
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Committee &amp; oversight</h3>
            <ChildGrid<MemberRow>
              rows={members}
              columns={categoryMemberColumns}
              tableFrom="5xl"
              addLabel="+ Add member"
              onAdd={() => {
                setMembers((ms) => [...ms, blankMember()]);
                setDirty(true);
              }}
              onRemove={(m) => {
                setMembers((ms) => ms.filter((x) => x.key !== m.key));
                setDirty(true);
              }}
            />
            {roleMissing && <p className="text-xs text-danger">Pick Committee or Oversight for every member.</p>}
            {twice && <p className="text-xs text-danger">A person is listed twice.</p>}
            <p className="text-xs text-muted-foreground">
              {ROLE_LABEL.committee} members may work and resolve these complaints; {ROLE_LABEL.oversight.toLowerCase()} members
              see them and are told when one goes unanswered.
            </p>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
