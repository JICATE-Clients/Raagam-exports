"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ArrowLeft, Loader2, MessageSquare, Search, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { ToggleGroup } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { openDirect } from "@/lib/comms/actions";
import { loadWorkspacePerson, setWorkspaceActive, setWorkspaceRole } from "@/lib/comms/workspace-actions";
import {
  DEACTIVATE_REASON_MAX,
  FILTER_LABEL,
  MEMBER_FILTERS,
  ROLE_LABEL,
  STATUS_HINT,
  STATUS_LABEL,
  assignableRoles,
  canManage,
  isAdminRole,
  memberStatusTone,
  type MemberFilter,
  type Workspace,
  type WorkspacePerson,
  type WorkspaceRole,
} from "@/lib/comms/workspace";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { initials } from "./message-body";

/**
 * The workspace's people (0750). Everyone active sees the active directory and
 * can open a profile or message someone from it; owners and admins also get the
 * status filter and the role / access controls.
 *
 * Every control is drawn from `canManage()`, which mirrors
 * `comm_workspace_check_target()` — and every action is re-checked by its RPC,
 * so a hidden button is a courtesy, never the guard (spec §10).
 *
 * The query and the filter live in the URL (?q=, ?status=), like Search, so the
 * list is read on the server and a refresh keeps the view.
 */
export function PeopleDirectory({
  workspace,
  meId,
  people,
  total,
  q,
  status,
}: {
  workspace: Workspace;
  meId: string;
  people: WorkspacePerson[];
  total: number;
  q: string;
  status: MemberFilter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const admin = isAdminRole(workspace.my_role);
  const [query, setQuery] = useState(q);
  const [openId, setOpenId] = useState<string | null>(null);
  const [navigating, startNav] = useTransition();

  function go(next: { q?: string; status?: MemberFilter }) {
    const params = new URLSearchParams();
    const nq = (next.q ?? query).trim();
    const ns = next.status ?? status;
    if (nq) params.set("q", nq);
    if (ns !== "active") params.set("status", ns);
    const qs = params.toString();
    startNav(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    go({ q: query });
  }

  const opened = people.find((p) => p.id === openId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link href="/comms" className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted @3xl/comms:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-heading">People</h1>
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? "person" : "people"}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <form onSubmit={submit} className="flex min-w-[14rem] flex-1 gap-2" role="search">
          {/* caps-input: exempt -- a search box; the query is not a stored value */}
          <Input
            type="search"
            uppercase={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, code, department or designation"
            aria-label="Find a person"
            className="flex-1"
          />
          <Button type="submit" variant="outline" disabled={navigating}>
            {navigating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find
          </Button>
        </form>
        {admin && (
          <ToggleGroup
            label="Show members"
            value={status}
            onChange={(v) => go({ status: v })}
            options={MEMBER_FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f] }))}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={navigating}>
        {people.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {q ? `Nobody matches “${q}”.` : status === "active" ? "No one is active in this workspace yet." : `No ${FILTER_LABEL[status].toLowerCase()} members.`}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {people.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-muted-foreground">
                    {initials(p.full_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold text-foreground">
                      {p.full_name ?? "Unnamed login"}
                      {p.id === meId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                    </span>
                    <span className="block break-words text-xs text-muted-foreground">
                      {[p.designation, p.department, p.employee_code].filter(Boolean).join(" · ") || "No staff record linked"}
                    </span>
                  </span>
                  {p.role !== "member" && <span className="shrink-0 text-xs font-medium text-primary">{ROLE_LABEL[p.role]}</span>}
                  {p.status !== "active" && <StatusPill tone={memberStatusTone(p.status)}>{STATUS_LABEL[p.status]}</StatusPill>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {people.length < total && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            Showing the first {people.length} of {total}. Search to narrow the list.
          </p>
        )}
      </div>

      <ProfileSheet
        key={openId ?? "none"}
        open={!!openId}
        initial={opened}
        personId={openId}
        workspace={workspace}
        meId={meId}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

/**
 * One person. Opens on the row the list already holds, and re-reads it from the
 * server after any change (the list is refreshed behind it too). The admin
 * section appears only where `canManage` says this caller may act on this person.
 */
function ProfileSheet({
  open,
  initial,
  personId,
  workspace,
  meId,
  onClose,
}: {
  open: boolean;
  initial: WorkspacePerson | null;
  personId: string | null;
  workspace: Workspace;
  meId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [person, setPerson] = useState<WorkspacePerson | null>(initial);
  const [role, setRole] = useState<WorkspaceRole>(initial?.role ?? "member");
  const [reason, setReason] = useState("");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const actor = { id: meId, role: workspace.my_role, status: workspace.my_status };
  const manageable = !!person && canManage(actor, person);
  const roles = assignableRoles(workspace.my_role);

  function refresh(id: string) {
    void loadWorkspacePerson(id).then((r) => {
      if (r.ok) {
        setPerson(r.person);
        if (r.person) setRole(r.person.role);
      }
    });
    router.refresh();
  }

  function saveRole() {
    if (!person) return;
    setError(null);
    start(async () => {
      const r = await setWorkspaceRole({ user_id: person.id, role });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(r.changed ? `${person.full_name ?? "Member"} is now ${ROLE_LABEL[role].toLowerCase()}.` : "No change — that is already their role.");
      refresh(person.id);
    });
  }

  function setActive(active: boolean) {
    if (!person) return;
    setError(null);
    start(async () => {
      const r = await setWorkspaceActive({ user_id: person.id, active, reason: active ? null : reason });
      setConfirmDeactivate(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setReason("");
      toast.success(active ? "Reactivated. They can use Messages again." : "Deactivated. Their messages stay under their name.");
      refresh(person.id);
    });
  }

  function message() {
    if (!person) return;
    start(async () => {
      const r = await openDirect(person.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/comms/c/${r.id}`);
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={person?.full_name ?? "Profile"}
      size="sm"
      alignToPane
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Close
          </Button>
          {person && person.id !== meId && person.status === "active" && (
            <Button onClick={message} disabled={pending}>
              <MessageSquare className="h-4 w-4" /> Message
            </Button>
          )}
        </div>
      }
    >
      {!person ? (
        <p className="text-sm text-muted-foreground" role="status">
          {personId ? "This person is not in the workspace, or you cannot see them." : ""}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
              {initials(person.full_name)}
            </span>
            <div className="min-w-0">
              <p className="break-words text-base font-semibold text-heading">{person.full_name ?? "Unnamed login"}</p>
              <p className="break-words text-sm text-muted-foreground">{person.designation ?? "No designation"}</p>
            </div>
          </div>

          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Department</dt>
            <dd className="text-foreground">{person.department ?? "—"}</dd>
            <dt className="text-muted-foreground">Employee code</dt>
            <dd className="text-foreground">{person.employee_code ?? "—"}</dd>
            <dt className="text-muted-foreground">Workspace role</dt>
            <dd className="text-foreground">
              {ROLE_LABEL[person.role]}
              {person.erp_owner && <span className="ml-1 text-xs text-muted-foreground">(ERP super admin)</span>}
            </dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusPill tone={memberStatusTone(person.status)}>{STATUS_LABEL[person.status]}</StatusPill>
              {person.status !== "active" && <p className="mt-1 text-xs text-muted-foreground">{STATUS_HINT[person.status]}</p>}
            </dd>
            <dt className="text-muted-foreground">Login since</dt>
            <dd className="text-foreground">{fmtDate(person.member_since)}</dd>
            {person.deactivated_at && (
              <>
                <dt className="text-muted-foreground">Deactivated</dt>
                <dd className="text-foreground">
                  {fmtDateTime(person.deactivated_at)}
                  {person.deactivated_by_name && ` by ${person.deactivated_by_name}`}
                  {person.deactivated_reason && <span className="block text-xs text-muted-foreground">{person.deactivated_reason}</span>}
                </dd>
              </>
            )}
          </dl>

          {manageable && (
            <section className="space-y-3 rounded-md border border-border p-3" aria-label="Administer this member">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-heading">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Administer
              </h2>
              {person.status !== "account_inactive" && (
                <div className="flex items-end gap-2">
                  <Field label="Role">
                    <Select value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)} disabled={pending}>
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button variant="outline" onClick={saveRole} disabled={pending || role === person.role}>
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />} Change role
                  </Button>
                </div>
              )}
              {person.status === "deactivated" ? (
                <Button variant="outline" onClick={() => setActive(true)} disabled={pending}>
                  <UserCheck className="h-4 w-4" /> Reactivate
                </Button>
              ) : person.status !== "account_inactive" ? (
                <div className="space-y-2">
                  <Field label="Reason" hint="Optional. Kept with the deactivation for other admins.">
                    {/* caps-input: exempt -- a note read by people, like a chat message; nothing matches on it */}
                    <Input uppercase={false} value={reason} maxLength={DEACTIVATE_REASON_MAX} onChange={(e) => setReason(e.target.value)} disabled={pending} />
                  </Field>
                  <Button variant="outline" onClick={() => setConfirmDeactivate(true)} disabled={pending}>
                    <UserX className="h-4 w-4" /> Deactivate
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{STATUS_HINT.account_inactive}</p>
              )}
            </section>
          )}

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        title={`Deactivate ${person?.full_name ?? "this member"}?`}
        body="They will no longer be able to read or send messages. Everything they wrote stays, under their name, and reactivating them returns them to their conversations."
        confirmLabel="Deactivate"
        isPending={pending}
        onConfirm={() => setActive(false)}
        onCancel={() => setConfirmDeactivate(false)}
      />
    </Sheet>
  );
}
