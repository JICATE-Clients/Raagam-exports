"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { Truncated } from "@/components/ui/truncated";
import { ActiveField } from "@/components/ui/active-field";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { AvatarStack } from "@/components/resolve/admin/avatar-stack";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { activeTone } from "@/lib/ui/status-tone";
import { saveComplaintCategory, setComplaintCategoryInactive } from "@/lib/resolve/actions";
import type { ComplaintCategoryRow } from "@/lib/resolve/service";
import type { CategoryMemberRole } from "@/lib/resolve/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Person = { id: string; name: string };
type MemberRow = { key: string; profile_id: string; role: CategoryMemberRole };

let seq = 0;

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

/** "8 h", "1 day", "3 days", "1 day 6 h" — how long a reply may take. */
function hoursWords(h: number): string {
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  const day = `${d} ${d === 1 ? "day" : "days"}`;
  return r ? `${day} ${r} h` : day;
}

/** "HR HEAD + committee of 3" — who looks into it, as one phrase. */
function whoHandles(r: ComplaintCategoryRow): string {
  const committee = r.members.filter((m) => m.role === "committee").length;
  const head = r.handler_name ?? "No default handler";
  return committee ? `${head} + committee of ${committee}` : head;
}

/** Confidential / Anonymous ok — the two facts that change who sees a concern. */
function Badges({ r }: { r: ComplaintCategoryRow }) {
  if (!r.is_sensitive && !r.anonymous_allowed) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {r.is_sensitive && <StatusPill tone="danger">Confidential</StatusPill>}
      {r.anonymous_allowed && <StatusPill tone="neutral">Anonymous ok</StatusPill>}
    </span>
  );
}

/**
 * Resolve Hub ▸ Administration ▸ Concern Categories — what a concern can be
 * about, and WHO HANDLES IT. The operator's word is "concern" (mobile redesign,
 * 2026-10-26); the tables, actions and the route keep "complaint", so no link
 * or query moved. Concern handling is configured here, per category, not by a
 * permission: the default handler gets new concerns, the committee may work
 * them, oversight is told when one goes unanswered.
 *
 * SENSITIVE is a visibility boundary, not a label (plan §10.3): a sensitive
 * category's concerns are seen by the people listed here and nobody else —
 * not triage, not administrators. So the member list IS the access list. On
 * screen the flag reads "Confidential".
 *
 * Committee and oversight are two chip lists, each with its own "Add person"
 * picker: the role is the list a person sits in, so a member cannot be saved
 * without one, and neither list needs a seeded blank line to be typed into.
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
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(open && (dirty || isPending));

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const addMember = (profileId: string, role: CategoryMemberRole) => {
    if (!profileId) return;
    setMembers((ms) =>
      ms.some((m) => m.profile_id === profileId) ? ms : [...ms, { key: `cm${++seq}`, profile_id: profileId, role }],
    );
    setDirty(true);
  };
  const removeMember = (key: string) => {
    setMembers((ms) => ms.filter((m) => m.key !== key));
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
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const editing = editId ? rows.find((r) => r.id === editId) ?? null : null;

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setMembers([]);
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
    setMembers(r.members.map((m) => ({ key: m.id, profile_id: m.profile_id, role: m.role })));
    setDirty(false);
    setOpen(true);
  }

  const twice = members.length !== new Set(members.map((m) => m.profile_id)).size;
  const hours = Number(form.response_hours);
  const hoursOk = Number.isInteger(hours) && hours >= 1;
  const canSave = !!form.name.trim() && hoursOk && !dupError && !twice && !isPending;

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
        members: members.map((m) => ({ profile_id: m.profile_id, role: m.role })),
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
        success(`${r.name} switched off — it is no longer offered on the concern form.`);
        router.refresh();
      } else error(res.error);
    });
  }

  const freeOptions = personOptions.filter((o) => !members.some((m) => m.profile_id === o.value));
  function memberList(role: CategoryMemberRole) {
    const list = members.filter((m) => m.role === role);
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ROLE_LABEL[role]}</h3>
        {list.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {list.map((m) => {
              const name = nameOf.get(m.profile_id) ?? "Unknown person";
              return (
                <li key={m.key} className="flex h-9 items-center gap-2 rounded-full border border-border bg-surface px-1">
                  <AvatarStack names={[name]} max={1} />
                  <span className="text-sm font-medium">{name}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${name}`} onClick={() => removeMember(m.key)}>
                    <X aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <Field label="Add person" w="party" htmlFor={`rh-cc-add-${role}`}>
          <Combobox id={`rh-cc-add-${role}`} options={freeOptions} value="" onChange={(v) => addMember(v, role)} />
        </Field>
      </div>
    );
  }

  const committeeNames = (r: ComplaintCategoryRow) =>
    r.members.filter((m) => m.role === "committee").map((m) => m.name ?? "?");

  const categoryColumns: Column<ComplaintCategoryRow>[] = [
    {
      header: "Category",
      cell: (r) => (
        <span className="block min-w-0 space-y-1">
          <Truncated text={r.name} className="text-sm font-semibold" />
          <Badges r={r} />
        </span>
      ),
    },
    {
      header: "Looked Into By",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="text-sm">{whoHandles(r)}</span>
          <AvatarStack names={committeeNames(r)} />
        </span>
      ),
    },
    {
      header: "Reply Within",
      cell: (r) => <span className="whitespace-nowrap text-sm tabular-nums">{hoursWords(r.response_hours)}</span>,
    },
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
        empty="No concern categories in this unit yet."
        mobile={{
          title: (r) => r.name,
          subtitle: (r) => `${whoHandles(r)} · reply in ${hoursWords(r.response_hours)}`,
          meta: (r) => <Badges r={r} />,
          pill: (r) => (r.inactive ? <StatusPill tone={activeTone(false)}>Inactive</StatusPill> : null),
          onEdit: openEdit,
          onDelete: switchOff,
        }}
        isPending={isPending}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title={editId ? `Edit ${form.name || "Category"}` : "New Concern Category"}
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
            <Field label="Reply Within" required w="hug" htmlFor="rh-cc-hours" hint={hoursOk ? `Hours · ${hoursWords(hours)}` : "Hours"}>
              <Input id="rh-cc-hours" type="number" min="1" value={form.response_hours} onChange={(e) => set({ response_hours: e.target.value })} />
            </Field>
          </FieldRow>
          {/* 288 description + 200 + 200 toggles + 2 × 12px gap = 712px → 45rem. */}
          <FieldRow className="max-w-[45rem]" align="start">
            <Field label="Description" w="name" htmlFor="rh-cc-desc">
              <Textarea id="rh-cc-desc" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field
              label="Confidential"
              w="party"
              htmlFor="rh-cc-sensitive"
              hint="Only the handler, committee and oversight members listed here can see these — not triage, not administrators."
            >
              <span className="flex min-h-9 items-center">
                <Toggle id="rh-cc-sensitive" checked={form.is_sensitive} onChange={(on) => set({ is_sensitive: on })} />
              </span>
            </Field>
            <Field label="Anonymous OK" w="party" htmlFor="rh-cc-anon" hint="The reporter may hide their name; only a tracking link follows it.">
              <span className="flex min-h-9 items-center">
                <Toggle id="rh-cc-anon" checked={form.anonymous_allowed} onChange={(on) => set({ anonymous_allowed: on })} />
              </span>
            </Field>
          </FieldRow>
          {/* Committee and oversight side by side on a wide sheet, stacked on a phone. */}
          <div className="grid max-w-[45rem] gap-4 sm:grid-cols-2">
            {memberList("committee")}
            {memberList("oversight")}
          </div>
          {twice && <p className="text-xs text-danger">A person is listed twice.</p>}
          <p className="text-xs text-muted-foreground">
            {ROLE_LABEL.committee} members may work and resolve these concerns; {ROLE_LABEL.oversight.toLowerCase()} members
            see them and are told when one goes unanswered.
          </p>
        </div>
      </Sheet>
    </div>
  );
}
