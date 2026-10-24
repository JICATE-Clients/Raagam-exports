"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BellOff, Bell, Loader2, LogOut, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  addMembers,
  leaveConversation,
  removeMember,
  setMemberRole,
  setMuted,
  syncDepartmentMembers,
  updateConversation,
} from "@/lib/comms/actions";
import type { ConversationDetail, DirectoryPerson, MemberRole } from "@/lib/comms/types";
import { initials } from "./message-body";
import { PeoplePicker } from "./people-picker";

const ROLE_LABEL: Record<MemberRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/**
 * Who is in the conversation, and what the caller may change about it.
 *
 * Every control here is offered only when the SERVER said so
 * (`conversation.can_manage`, from `comm_can_manage()`), and every action is
 * re-checked by its RPC — hiding a button is a courtesy, never the guard
 * (spec §10: "Do not rely solely on hiding UI elements").
 */
export function DetailsSheet({
  open,
  conversation: c,
  meId,
  onClose,
}: {
  open: boolean;
  conversation: ConversationDetail;
  meId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<DirectoryPerson[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState(c.name ?? "");
  const [topic, setTopic] = useState(c.topic ?? "");
  const [confirmLeave, setConfirmLeave] = useState(false);

  const active = c.members.filter((m) => !m.removed_at);
  const myRole = c.me?.active ? c.me.role : null;
  const isOwner = myRole === "owner";
  const settingsDirty = (name.trim() || null) !== (c.name ?? null) || (topic.trim() || null) !== (c.topic ?? null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "That did not work. Try again.");
        return;
      }
      if (done) toast.success(done);
      after?.();
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="Details" size="sm" alignToPane>
      <div className="space-y-5">
        {c.me?.active && (
          <section className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => setMuted(c.id, !c.me!.muted), c.me!.muted ? "Notifications on." : "Muted.")}
            >
              {c.me.muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              {c.me.muted ? "Unmute" : "Mute"}
            </Button>
            {c.kind !== "direct" && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirmLeave(true)}>
                <LogOut className="h-4 w-4" /> Leave
              </Button>
            )}
          </section>
        )}

        {c.can_manage && c.kind !== "direct" && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Settings</h3>
            <Field label={c.kind === "channel" ? "Channel name" : "Group name"} required={c.kind === "channel"}>
              {/* caps-input: exempt -- display text read by people (a conversation name or topic), like a chat message; nothing matches on it */}
              <Input uppercase={false} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Topic">
              {/* caps-input: exempt -- display text read by people (a conversation name or topic), like a chat message; nothing matches on it */}
              <Input uppercase={false} value={topic} maxLength={250} onChange={(e) => setTopic(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending || !settingsDirty || (c.kind === "channel" && !name.trim())}
                onClick={() =>
                  run(
                    () => updateConversation({ conversation_id: c.id, name: name.trim() || null, topic: topic.trim() || null, archived: null }),
                    "Saved.",
                  )
                }
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => updateConversation({ conversation_id: c.id, name: c.name, topic: c.topic, archived: !c.is_archived }),
                    c.is_archived ? "Restored." : "Archived.",
                  )
                }
              >
                {c.is_archived ? "Restore" : "Archive"}
              </Button>
              {c.kind === "channel" && c.department_id && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => syncDepartmentMembers(c.id), `${c.department_name ?? "Department"} members added.`)}
                >
                  Add {c.department_name ?? "department"} members
                </Button>
              )}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Members ({active.length})
            </h3>
            {c.can_manage && c.kind !== "direct" && !c.is_archived && (
              <Button size="sm" variant="ghost" onClick={() => setShowAdd((v) => !v)}>
                <UserPlus className="h-4 w-4" /> Add people
              </Button>
            )}
          </div>

          {showAdd && (
            <div className="space-y-2 rounded-lg border border-border p-2">
              <div className="h-64">
                <PeoplePicker selected={adding} onChange={setAdding} exclude={active.map((m) => m.user_id)} autoFocus />
              </div>
              <Button
                size="sm"
                disabled={pending || adding.length === 0}
                onClick={() =>
                  run(
                    () => addMembers(c.id, adding.map((p) => p.id)),
                    `${adding.length} ${adding.length === 1 ? "person" : "people"} added.`,
                    () => {
                      setAdding([]);
                      setShowAdd(false);
                    },
                  )
                }
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Add {adding.length || ""}
              </Button>
            </div>
          )}

          <ul className="divide-y divide-border rounded-lg border border-border">
            {active.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-muted-foreground">
                  {initials(m.full_name)}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm text-foreground">
                  {m.full_name ?? "—"}
                  {m.user_id === meId && <span className="text-muted-foreground"> (you)</span>}
                </span>
                {c.kind !== "direct" &&
                  (isOwner && m.user_id !== meId ? (
                    <Select
                      aria-label={`Role for ${m.full_name ?? "member"}`}
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => run(() => setMemberRole(c.id, m.user_id, e.target.value), "Role changed.")}
                      className="w-28"
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </Select>
                  ) : (
                    <span className="text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</span>
                  ))}
                {c.can_manage && c.kind !== "direct" && m.user_id !== meId && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removeMember(c.id, m.user_id), `${m.full_name ?? "Member"} removed.`)}
                    aria-label={`Remove ${m.full_name ?? "member"}`}
                    title="Remove from conversation"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-danger"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title={`Leave ${c.title}?`}
        body="You keep what was said before you left, but you will not see anything new unless someone adds you back."
        confirmLabel="Leave"
        onConfirm={() => {
          setConfirmLeave(false);
          run(() => leaveConversation(c.id), "You left the conversation.", () => {
            onClose();
            router.push("/comms");
          });
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </Sheet>
  );
}
