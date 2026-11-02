"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Crown, Hash, Loader2, Lock, LogOut, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { addMembers, leaveConversation, removeMember, setMemberRole, syncDepartmentMembers } from "@/lib/comms/actions";
import { setChannelArchived, setConversationPrefs, transferChannelOwnership, updateChannel } from "@/lib/comms/channel-actions";
import {
  CHANNEL_DESC_MAX,
  CHANNEL_NAME_MAX,
  CHANNEL_ROLE_LABEL,
  CHANNEL_TOPIC_MAX,
  NOTIFY_LABEL,
  NOTIFY_LEVELS,
  channelNameProblem,
  normalizeChannelName,
  type ChannelAbilities,
  type NotifyLevel,
} from "@/lib/comms/channels";
import type { CommMember, ConversationDetail, DirectoryPerson, MemberRole } from "@/lib/comms/types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { initials } from "./message-body";
import { PeoplePicker } from "./people-picker";
import { announceChannelsChanged } from "./sidebar-channels";

type Confirm =
  | { kind: "archive" }
  | { kind: "restore" }
  | { kind: "leave" }
  | { kind: "remove"; member: CommMember }
  | { kind: "transfer"; member: CommMember };

/**
 * A channel's details and settings (0751).
 *
 * EVERY CONTROL IS DRAWN FROM `abilities` — `comm_channel_abilities()`, the
 * same `comm_channel_can()` each RPC enforces — so a button and its refusal
 * cannot disagree, and hiding one is a courtesy, never the guard (spec §10).
 * Archiving, restoring, leaving, removing someone and handing the channel over
 * each ask first.
 */
export function ChannelDetailsSheet({
  open,
  conversation: c,
  abilities: can,
  meId,
  onClose,
}: {
  open: boolean;
  conversation: ConversationDetail;
  abilities: ChannelAbilities;
  meId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(c.name ?? "");
  const [description, setDescription] = useState(c.description ?? "");
  const [topic, setTopic] = useState(c.topic ?? "");
  const [adding, setAdding] = useState<DirectoryPerson[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [stepDown, setStepDown] = useState<"admin" | "member">("admin");
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const active = c.members.filter((m) => !m.removed_at);
  const owners = active.filter((m) => m.role === "owner");
  const slug = normalizeChannelName(name);
  const nameProblem = can.rename ? channelNameProblem(slug) : null;
  const dirty =
    (can.rename && slug !== (c.name ?? "")) ||
    (description.trim() || null) !== (c.description ?? null) ||
    (topic.trim() || null) !== (c.topic ?? null);
  useUnsavedGuard(open && (dirty || pending));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "That did not work. Try again.");
        return;
      }
      if (done) toast.success(done);
      announceChannelsChanged();
      after?.();
      router.refresh();
    });
  }

  function confirmed() {
    const k = confirm;
    setConfirm(null);
    if (!k) return;
    if (k.kind === "archive") run(() => setChannelArchived(c.id, true), "Channel archived. Its history is kept.");
    if (k.kind === "restore") run(() => setChannelArchived(c.id, false), "Channel restored.");
    if (k.kind === "leave")
      run(() => leaveConversation(c.id), "You left the channel.", () => {
        onClose();
        router.push("/comms/channels");
      });
    if (k.kind === "remove") run(() => removeMember(c.id, k.member.user_id), `${k.member.full_name ?? "Member"} removed.`);
    if (k.kind === "transfer")
      run(
        () => transferChannelOwnership({ conversation_id: c.id, to_user_id: k.member.user_id, step_down_to: stepDown }),
        `${k.member.full_name ?? "They"} now own${k.member.full_name ? "s" : ""} the channel.`,
        () => setTransferTo(""),
      );
  }

  const mayRemove = (m: CommMember) =>
    m.user_id !== meId && can.remove_members && (m.role === "member" || can.remove_privileged);
  const transferCandidates = active.filter((m) => m.user_id !== meId && m.role !== "owner");

  return (
    <Sheet open={open} onClose={onClose} title={`#${c.name ?? "channel"}`} size="sm" alignToPane>
      <div className="space-y-5">
        {/* ---- about ---- */}
        <section className="space-y-1 text-sm">
          <p className="flex items-center gap-1.5 text-muted-foreground">
            {c.visibility === "private" ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <Hash className="h-3.5 w-3.5" aria-hidden />}
            {c.visibility === "private" ? "Private channel" : "Public channel"} · created {fmtDate(c.created_at)}
            {c.department_name && ` · ${c.department_name}`}
          </p>
          <p className="flex items-center gap-1.5 text-foreground">
            <Crown className="h-3.5 w-3.5 text-primary" aria-hidden />
            {owners.length ? owners.map((o) => o.full_name ?? "—").join(", ") : "No owner"}
          </p>
          {c.is_archived && (
            <p className="text-warning">Archived{c.archived_at ? ` ${fmtDateTime(c.archived_at)}` : ""}. It can be read but not added to.</p>
          )}
          {!can.edit_info && c.description && <p className="whitespace-pre-wrap text-foreground">{c.description}</p>}
          {can.governs && can.role === null && (
            <p className="text-xs text-muted-foreground">You manage this public channel as a workspace admin.</p>
          )}
        </section>

        {/* ---- my preferences ---- */}
        {can.preferences && c.me && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your preferences</h3>
            <Toggle
              label="Pin to the top of my sidebar"
              checked={!!c.me.pinned_at}
              disabled={pending}
              onChange={(v) => run(() => setConversationPrefs({ conversation_id: c.id, pinned: v }), v ? "Pinned." : "Unpinned.")}
            />
            <Field label="Notify me about" hint="Only you see this.">
              <Select
                value={c.me.notify_level}
                disabled={pending}
                onChange={(e) =>
                  run(() => setConversationPrefs({ conversation_id: c.id, notify_level: e.target.value as NotifyLevel }), "Saved.")
                }
              >
                {NOTIFY_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {NOTIFY_LABEL[l]}
                  </option>
                ))}
              </Select>
            </Field>
          </section>
        )}

        {/* ---- settings ---- */}
        {(can.edit_info || can.rename || can.archive) && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Settings</h3>
            {can.edit_info && (
              <>
                <Field
                  label="Channel name"
                  required={can.rename}
                  hint={can.rename ? (nameProblem ?? (slug !== c.name ? `Will be renamed to #${slug}.` : undefined)) : "Only owners can rename the channel."}
                >
                  {/* caps-input: exempt -- a channel name is stored lowercase by rule (0751); capitals would be refused */}
                  <Input uppercase={false} value={name} maxLength={CHANNEL_NAME_MAX + 20} onChange={(e) => setName(e.target.value)} readOnly={!can.rename} aria-invalid={!!nameProblem} />
                </Field>
                <Field label="Description">
                  {/* caps-input: exempt -- display text read by people, like a chat message; nothing matches on it */}
                  <Textarea uppercase={false} rows={2} value={description} maxLength={CHANNEL_DESC_MAX} onChange={(e) => setDescription(e.target.value)} />
                </Field>
                <Field label="Topic">
                  {/* caps-input: exempt -- display text read by people (a conversation name or topic), like a chat message; nothing matches on it */}
                  <Input uppercase={false} value={topic} maxLength={CHANNEL_TOPIC_MAX} onChange={(e) => setTopic(e.target.value)} />
                </Field>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {can.edit_info && (
                <Button
                  size="sm"
                  disabled={pending || !dirty || !!nameProblem}
                  onClick={() =>
                    run(
                      () =>
                        updateChannel({
                          conversation_id: c.id,
                          name: can.rename ? name : (c.name ?? ""),
                          description: description || null,
                          topic: topic || null,
                        }),
                      "Saved.",
                    )
                  }
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save
                </Button>
              )}
              {can.archive && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirm({ kind: c.is_archived ? "restore" : "archive" })}>
                  {c.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  {c.is_archived ? "Restore" : "Archive"}
                </Button>
              )}
              {can.add_members && c.department_id && (
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

        {/* ---- ownership ---- */}
        {can.transfer && transferCandidates.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hand over ownership</h3>
            <Field label="New owner" hint="Must already be in the channel.">
              <Select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} disabled={pending}>
                <option value="">Choose a member</option>
                {transferCandidates.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name ?? "—"}
                  </option>
                ))}
              </Select>
            </Field>
            {can.role === "owner" && (
              <Field label="You become">
                <Select value={stepDown} onChange={(e) => setStepDown(e.target.value as "admin" | "member")} disabled={pending}>
                  <option value="admin">Moderator</option>
                  <option value="member">Member</option>
                </Select>
              </Field>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !transferTo}
              onClick={() => {
                const m = active.find((x) => x.user_id === transferTo);
                if (m) setConfirm({ kind: "transfer", member: m });
              }}
            >
              <Crown className="h-4 w-4" /> Transfer
            </Button>
          </section>
        )}

        {/* ---- members ---- */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Members ({active.length})</h3>
            {can.add_members && (
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
                {can.set_roles && m.user_id !== meId ? (
                  <Select
                    aria-label={`Role for ${m.full_name ?? "member"}`}
                    value={m.role}
                    disabled={pending}
                    onChange={(e) => run(() => setMemberRole(c.id, m.user_id, e.target.value as MemberRole), "Role changed.")}
                    className="w-32"
                  >
                    {(["owner", "admin", "member"] as const).map((r) => (
                      <option key={r} value={r}>
                        {CHANNEL_ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">{CHANNEL_ROLE_LABEL[m.role]}</span>
                )}
                {mayRemove(m) && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirm({ kind: "remove", member: m })}
                    aria-label={`Remove ${m.full_name ?? "member"}`}
                    title="Remove from channel"
                    className="rounded-md p-2.5 text-muted-foreground hover:bg-surface-muted hover:text-danger [@media(hover:hover)]:p-1.5"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {can.leave && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirm({ kind: "leave" })}>
            <LogOut className="h-4 w-4" /> Leave channel
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.kind === "archive"
            ? `Archive #${c.name}?`
            : confirm?.kind === "restore"
              ? `Restore #${c.name}?`
              : confirm?.kind === "leave"
                ? `Leave #${c.name}?`
                : confirm?.kind === "remove"
                  ? `Remove ${confirm.member.full_name ?? "this member"}?`
                  : confirm?.kind === "transfer"
                    ? `Make ${confirm.member.full_name ?? "this member"} the owner?`
                    : ""
        }
        body={
          confirm?.kind === "archive"
            ? "Nobody can post, join or be added while it is archived. Every message, member and setting is kept, and an owner can restore it."
            : confirm?.kind === "restore"
              ? "It returns to discovery and everyone's sidebar exactly as it was."
              : confirm?.kind === "leave"
                ? "You keep what was said before you left. A public channel can be re-joined; a private one needs someone to add you back."
                : confirm?.kind === "remove"
                  ? "They keep what was said while they were here, but see nothing new."
                  : confirm?.kind === "transfer"
                    ? can.role === "owner"
                      ? `You will become ${stepDown === "admin" ? "a moderator" : "a member"}.`
                      : "They become an owner alongside any existing owners."
                    : null
        }
        confirmLabel={
          confirm?.kind === "archive" ? "Archive" : confirm?.kind === "restore" ? "Restore" : confirm?.kind === "leave" ? "Leave" : confirm?.kind === "remove" ? "Remove" : "Transfer"
        }
        tone={confirm?.kind === "restore" || confirm?.kind === "transfer" ? "primary" : "danger"}
        isPending={pending}
        onConfirm={confirmed}
        onCancel={() => setConfirm(null)}
      />
    </Sheet>
  );
}
