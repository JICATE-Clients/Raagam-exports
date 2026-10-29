"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { updateWorkspaceSettings } from "@/lib/comms/workspace-actions";
import {
  ROLE_LABEL,
  WORKSPACE_DESC_MAX,
  WORKSPACE_NAME_MAX,
  isAdminRole,
  memberStatusTone,
  type Workspace,
  type WorkspaceStatus,
} from "@/lib/comms/workspace";
import { fmtDateTime } from "@/lib/format";

/**
 * Workspace settings (0750). Owners and admins edit; an ordinary member sees
 * the same values read-only with a line saying who can change them — the
 * permission-denied state, drawn where the controls would be. The RPC refuses
 * a member's save regardless (comm_workspace_admin_actor), and refuses an
 * admin's pause / resume (owners only).
 */
export function WorkspaceSettings({ workspace: w }: { workspace: Workspace }) {
  const router = useRouter();
  const toast = useToast();
  const canEdit = isAdminRole(w.my_role);
  const isOwner = w.my_role === "owner";
  const [name, setName] = useState(w.name);
  const [description, setDescription] = useState(w.description ?? "");
  const [status, setStatus] = useState<WorkspaceStatus>(w.status);
  const [groups, setGroups] = useState(w.members_can_create_groups);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty =
    name.trim() !== w.name ||
    (description.trim() || null) !== (w.description ?? null) ||
    status !== w.status ||
    groups !== w.members_can_create_groups;
  useUnsavedGuard(dirty || pending);

  function reset() {
    setName(w.name);
    setDescription(w.description ?? "");
    setStatus(w.status);
    setGroups(w.members_can_create_groups);
    setError(null);
  }

  function save() {
    setError(null);
    start(async () => {
      const r = await updateWorkspaceSettings({ name, description: description || null, status, members_can_create_groups: groups });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success("Workspace settings saved.");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link href="/comms" className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted @3xl/comms:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-heading">Settings</h1>
        <span className="text-xs text-muted-foreground">You are {ROLE_LABEL[w.my_role].toLowerCase()}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-focus-scope="">
        {/* One column of short fields: 32rem holds the 80-character name and the description box. */}
        <div className="max-w-[32rem] space-y-4">
          {!canEdit && (
            <p className="rounded-md border border-border bg-surface-muted p-3 text-sm text-muted-foreground" role="note">
              Only workspace owners and admins can change these settings.
            </p>
          )}

          <Field label="Workspace name" required={canEdit}>
            {/* caps-input: exempt -- display text read by people (a workspace name, like a channel name); nothing matches on it */}
            <Input uppercase={false} value={name} maxLength={WORKSPACE_NAME_MAX} onChange={(e) => setName(e.target.value)} readOnly={!canEdit} />
          </Field>

          <Field label="Description" hint={canEdit ? "Shown under the name at the top of Messages." : undefined}>
            {/* caps-input: exempt -- display text read by people, like a channel topic */}
            <Textarea
              uppercase={false}
              value={description}
              maxLength={WORKSPACE_DESC_MAX}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              readOnly={!canEdit}
            />
          </Field>

          <Field label="Organisation">
            <p className="text-sm text-foreground">{w.company_name ?? "No company profile yet (Administration ▸ Company Profile)."}</p>
          </Field>

          <Field
            label="Messages"
            hint={
              status === "suspended"
                ? "Paused: only owners and admins can send or change anything. Everyone can still read."
                : isOwner
                  ? "Open to everyone with Messages access."
                  : "Only a workspace owner can pause messages."
            }
          >
            {canEdit && isOwner ? (
              <Segmented
                name="workspace-status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "active", label: "Open" },
                  { value: "suspended", label: "Paused" },
                ]}
              />
            ) : (
              <StatusPill tone={memberStatusTone(w.status)}>{w.status === "suspended" ? "Paused" : "Open"}</StatusPill>
            )}
          </Field>

          <Field
            label="Group conversations"
            hint="Off: only owners, admins and people allowed to create channels can start a group."
          >
            <Toggle label="Members can start groups" checked={groups} onChange={setGroups} disabled={!canEdit || pending} />
          </Field>

          <p className="text-xs text-muted-foreground">Last changed {fmtDateTime(w.updated_at)}</p>

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          {canEdit && (
            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={pending || !dirty || !name.trim()}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </Button>
              <Button variant="outline" onClick={reset} disabled={pending || !dirty}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
