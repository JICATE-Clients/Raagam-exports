"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Bookmark,
  Building2,
  Check,
  Crown,
  Hash,
  Images,
  Layers,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  Pencil,
  Pin,
  Search,
  ShieldCheck,
  User,
  UserMinus,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PulseConfirm } from "./pulse-confirm";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { addMembers, leaveConversation, openDirect, removeMember, setMemberRole, syncDepartmentMembers } from "@/lib/comms/actions";
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
import { loadPulseFiles } from "@/lib/comms/pulse-actions";
import type { PulseFile } from "@/lib/comms/files-service";
import { Face } from "./person-photo";
import { PeoplePicker } from "./people-picker";
import { announceChannelsChanged } from "./sidebar-channels";
import { WithPresence } from "./presence";

type Confirm =
  | { kind: "archive" }
  | { kind: "restore" }
  | { kind: "leave" }
  | { kind: "remove"; member: CommMember }
  | { kind: "transfer"; member: CommMember };

/** Members shown before "View all" (artifact "Compact Channel Info"). */
const MEMBER_PEEK = 5;

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
  onSearch,
  onPinned,
}: {
  open: boolean;
  conversation: ConversationDetail;
  abilities: ChannelAbilities;
  meId: string;
  onClose: () => void;
  /** Opens the chat's own search (the header ⋮ ▸ Search). */
  onSearch?: () => void;
  /** Opens the chat's pinned messages. */
  onPinned?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(c.name ?? "");
  const [description, setDescription] = useState(c.description ?? "");
  const [topic, setTopic] = useState(c.topic ?? "");
  const [adding, setAdding] = useState<DirectoryPerson[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  // The member whose actions sheet is open (artifact "Channel Members List": tap a row).
  const [acting, setActing] = useState<CommMember | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [stepDown, setStepDown] = useState<"admin" | "member">("admin");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // Which small sheet a row opened (artifact "Compact Channel Info"), and whether every member shows.
  const [panel, setPanel] = useState<"notify" | "edit" | "owner" | null>(null);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [findingMember, setFindingMember] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  // This channel's files for "Media, links and docs" — read when the sheet opens, through
  // the same RLS-scoped reader Pulse's Files filter uses. null = not read yet.
  const [files, setFiles] = useState<PulseFile[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadPulseFiles()
      .then((r) => live && setFiles(r.ok ? r.files.filter((f) => f.conversation_id === c.id) : []))
      .catch(() => live && setFiles([]));
    return () => {
      live = false;
    };
  }, [open, c.id]);

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
  // You first, then owners, moderators and members — each group in the order they joined.
  const ROLE_ORDER: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 };
  const sortedMembers = [...active].sort(
    (a, b) => Number(b.user_id === meId) - Number(a.user_id === meId) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
  );
  const q = memberQuery.trim().toLowerCase();
  const foundMembers = q ? sortedMembers.filter((m) => (m.full_name ?? "").toLowerCase().includes(q)) : sortedMembers;

  // WHATSAPP'S GROUP INFO (user 2026-11-10, five screenshots and the artifact "Channel
  // Info Full Page"): a big round picture, the name with a pencil, "Public channel · N
  // members", three round buttons, the description, the chat's files, then plain rows
  // divided by hairlines — no cards. Forms open in their own small sheets.
  const canTransfer = can.transfer && transferCandidates.length > 0;
  const creator = c.members.find((m) => m.added_by === m.user_id) ?? owners[0];
  const muted = c.me?.notify_level === "none";

  return (
    <Sheet open={open} onClose={onClose} title="Channel info" size="sm" alignToPane>
      <div className="-mx-4 -mt-2 divide-y divide-border">
        <section className="flex flex-col items-center px-5 pb-4 pt-2 text-center">
          <span className="flex h-28 w-28 items-center justify-center rounded-full bg-primary text-primary-foreground">
            {c.visibility === "private" ? <Lock className="h-12 w-12" aria-hidden /> : <Hash className="h-12 w-12" aria-hidden />}
          </span>
          <div className="mt-4 flex max-w-full items-center gap-2">
            <h2 className="min-w-0 break-words text-2xl text-heading">{c.name ?? "channel"}</h2>
            {can.edit_info && (
              <IconButton label="Edit channel name" onClick={() => setPanel("edit")}>
                <Pencil className="h-[18px] w-[18px]" />
              </IconButton>
            )}
          </div>
          <p className="mt-0.5 text-[15px] text-muted-foreground">
            {c.visibility === "private" ? "Private channel" : "Public channel"} ·{" "}
            <a href="#channel-members" className="font-semibold text-success hover:underline">
              {active.length} {active.length === 1 ? "member" : "members"}
            </a>
          </p>
          {c.is_archived && (
            <p className="mt-1 text-xs font-semibold text-warning">Archived{c.archived_at ? ` ${fmtDateTime(c.archived_at)}` : ""}. It can be read but not added to.</p>
          )}
          {can.governs && can.role === null && <p className="mt-1 text-xs text-muted-foreground">You manage this public channel as a workspace admin.</p>}
          <div className="mt-4 flex gap-3">
            {can.add_members && (
              <RoundAction icon={UserPlus} label="Add" onClick={() => document.getElementById("channel-members")?.scrollIntoView({ behavior: "smooth" })} />
            )}
            {onSearch && (
              <RoundAction
                icon={Search}
                label="Search"
                onClick={() => {
                  onClose();
                  onSearch();
                }}
              />
            )}
            {can.preferences && c.me && (
              <RoundAction
                icon={muted ? BellOff : Bell}
                label={muted ? "Unmute" : "Mute"}
                disabled={pending}
                onClick={() =>
                  run(
                    () => setConversationPrefs({ conversation_id: c.id, notify_level: muted ? "all" : "none" }),
                    muted ? "Notifications on." : "Muted.",
                  )
                }
              />
            )}
          </div>
        </section>

        {(c.description || c.topic || can.edit_info) && (
          <section className="flex items-start gap-3 px-5 py-4">
            <div className="min-w-0 flex-1 space-y-1">
              {c.description ? (
                <p className="whitespace-pre-wrap break-words text-[15px] text-heading">{c.description}</p>
              ) : (
                can.edit_info && (
                  // button-shape: exempt -- an inline text link ("Add channel description")
                  <button type="button" onClick={() => setPanel("edit")} className="text-[15px] text-success hover:underline">
                    Add channel description
                  </button>
                )
              )}
              {c.topic && <p className="break-words text-[13px] text-muted-foreground">Topic · {c.topic}</p>}
            </div>
            {can.edit_info && c.description && (
              <IconButton label="Edit description" onClick={() => setPanel("edit")}>
                <Pencil className="h-[18px] w-[18px]" />
              </IconButton>
            )}
          </section>
        )}

        <section className="pb-3 pt-1">
          <InfoRow icon={Images} label="Media, links and docs" value={files === null ? undefined : String(files.length)} onClick={() => router.push("/comms?filter=files")} />
          {files && files.length > 0 && (
            <div className="flex gap-2.5 px-5">
              {files.slice(0, 3).map((f) => (
                <Link
                  key={f.id}
                  href={`/comms/files/${f.id}`}
                  title={f.file_name}
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-[11px] font-bold uppercase text-muted-foreground hover:bg-primary-soft hover:text-primary"
                >
                  {fileBadge(f.file_name)}
                </Link>
              ))}
              {files.length > 3 && (
                <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-sm font-semibold text-muted-foreground">
                  +{files.length - 3}
                </span>
              )}
            </div>
          )}
        </section>

        <section className="py-1.5">
          <InfoRow icon={Bookmark} label="Saved messages" onClick={() => router.push("/comms/saved")} />
          {onPinned && (
            <InfoRow
              icon={Pin}
              label="Pinned messages"
              onClick={() => {
                onClose();
                onPinned();
              }}
            />
          )}
          {can.preferences && c.me && (
            <>
              <InfoRow icon={Bell} label="Notification settings" hint={NOTIFY_LABEL[c.me.notify_level]} onClick={() => setPanel("notify")} />
              <div className="flex min-h-[52px] items-center gap-5 px-5">
                <Layers className="h-[22px] w-[22px] shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Toggle
                    label="Pin to top of sidebar"
                    checked={!!c.me.pinned_at}
                    disabled={pending}
                    onChange={(v) => run(() => setConversationPrefs({ conversation_id: c.id, pinned: v }), v ? "Pinned." : "Unpinned.")}
                  />
                </div>
              </div>
            </>
          )}
        </section>

        {(canTransfer || can.archive) && (
          <section className="py-1.5">
            {canTransfer && (
              <InfoRow
                icon={Crown}
                label="Hand over ownership"
                hint={owners.length ? `Owner: ${owners.map((o) => o.full_name ?? "—").join(", ")}` : undefined}
                onClick={() => setPanel("owner")}
              />
            )}
            {can.archive && (
              <InfoRow
                icon={c.is_archived ? ArchiveRestore : Archive}
                label={c.is_archived ? "Restore channel" : "Archive channel"}
                disabled={pending}
                onClick={() => setConfirm({ kind: c.is_archived ? "restore" : "archive" })}
              />
            )}
          </section>
        )}

        <Sheet open={panel === "notify"} onClose={() => setPanel(null)} title="Notifications" size="sm" alignToPane>
          {c.me && (
            <div className="-mx-2 flex flex-col" role="radiogroup" aria-label="Notify me about">
              {NOTIFY_LEVELS.map((l) => (
                // button-shape: exempt -- a whole option row in a list of choices
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={c.me?.notify_level === l}
                  disabled={pending}
                  onClick={() => {
                    setPanel(null);
                    run(() => setConversationPrefs({ conversation_id: c.id, notify_level: l as NotifyLevel }), "Saved.");
                  }}
                  className="flex min-h-[48px] items-center gap-3 rounded-lg px-3 text-left text-[15px] text-heading hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex-1">{NOTIFY_LABEL[l]}</span>
                  {c.me?.notify_level === l && <Check className="h-4 w-4 text-primary" aria-hidden />}
                </button>
              ))}
            </div>
          )}
        </Sheet>

        <Sheet
          open={panel === "edit"}
          onClose={() => setPanel(null)}
          title="Edit channel"
          size="sm"
          alignToPane
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPanel(null)} disabled={pending}>
                Cancel
              </Button>
              <Button
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
                    () => setPanel(null),
                  )
                }
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Field
              label="Channel name"
              required={can.rename}
              hint={can.rename ? (nameProblem ?? (slug !== c.name ? `Will be renamed to #${slug}.` : undefined)) : "Only owners can rename the channel."}
            >
              {/* caps-input: exempt -- a channel name is stored lowercase by rule (0751); capitals would be refused */}
              <Input uppercase={false} value={name} maxLength={CHANNEL_NAME_MAX + 20} onChange={(e) => setName(e.target.value)} readOnly={!can.rename} aria-invalid={!!nameProblem} />
            </Field>
            <Field label="Topic">
              {/* caps-input: exempt -- display text read by people (a conversation name or topic), like a chat message; nothing matches on it */}
              <Input uppercase={false} value={topic} maxLength={CHANNEL_TOPIC_MAX} onChange={(e) => setTopic(e.target.value)} />
            </Field>
            <Field label="Description">
              {/* caps-input: exempt -- display text read by people, like a chat message; nothing matches on it */}
              <Textarea uppercase={false} rows={3} value={description} maxLength={CHANNEL_DESC_MAX} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </Sheet>

        <Sheet
          open={panel === "owner"}
          onClose={() => setPanel(null)}
          title="Hand over ownership"
          size="sm"
          alignToPane
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPanel(null)} disabled={pending}>
                Cancel
              </Button>
              <Button
                disabled={pending || !transferTo}
                onClick={() => {
                  const m = active.find((x) => x.user_id === transferTo);
                  if (!m) return;
                  setPanel(null);
                  setConfirm({ kind: "transfer", member: m });
                }}
              >
                <Crown className="h-4 w-4" /> Transfer
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
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
          </div>
        </Sheet>

        {/* ---- members ----
            A PEOPLE LIST, NOT A FORM (user 2026-11-10, artifact "Channel Members List",
            from a WhatsApp group-info screenshot): green round action rows on top, then one
            row per person — a 44px face, the name, the role underneath, and a tag only for
            Owner / Moderator. The per-row role <Select> and ✕ are gone: a manager TAPS a row
            and the person's actions open in a sheet (Message · roles · Remove). */}
        <section id="channel-members" aria-label={`Members, ${active.length}`} className="scroll-mt-4 py-1">
          <div className="flex min-h-[44px] items-center justify-between gap-2 px-5 pt-2">
            {findingMember ? (
              // caps-input: exempt -- a search box; the query is not a stored value
              <Input uppercase={false} type="search" autoFocus value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search members" aria-label="Search members" />
            ) : (
              <p className="text-sm text-muted-foreground">
                {active.length} {active.length === 1 ? "member" : "members"}
              </p>
            )}
            <IconButton
              label={findingMember ? "Close member search" : "Search members"}
              onClick={() => {
                setFindingMember((v) => !v);
                setMemberQuery("");
              }}
            >
              {findingMember ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
            </IconButton>
          </div>
          {can.add_members && (
            <MemberActionRow icon={UserPlus} label="Add people" onClick={() => setShowAdd((v) => !v)} expanded={showAdd} />
          )}
          {showAdd && (
            <div className="mx-5 mb-2 space-y-2 rounded-lg border border-border p-2">
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
          {can.add_members && c.department_id && (
            <MemberActionRow
              icon={Building2}
              label={`Add ${c.department_name ?? "department"} members`}
              disabled={pending}
              onClick={() => run(() => syncDepartmentMembers(c.id), `${c.department_name ?? "Department"} members added.`)}
            />
          )}

          <ul className="py-1">
            {(memberQuery.trim() ? foundMembers : showAllMembers ? sortedMembers : sortedMembers.slice(0, MEMBER_PEEK)).map((m) => {
              const me = m.user_id === meId;
              const manageable = !me && (can.set_roles || mayRemove(m));
              const body = (
                <>
                  <WithPresence userId={m.user_id} size="md">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-sm font-bold text-primary">
                    <Face userId={m.user_id} name={m.full_name} />
                  </span>
                  </WithPresence>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-base text-heading">{me ? "You" : (m.full_name ?? "—")}</span>
                    <span className="block text-[13px] text-muted-foreground">{me ? (m.full_name ?? "") : CHANNEL_ROLE_LABEL[m.role]}</span>
                  </span>
                  {m.role !== "member" && (
                    <span className="shrink-0 rounded-md bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">{CHANNEL_ROLE_LABEL[m.role]}</span>
                  )}
                </>
              );
              return (
                <li key={m.user_id}>
                  {manageable ? (
                    // button-shape: exempt -- a whole list row that opens the person's actions, drawn like the rows around it
                    <button
                      type="button"
                      onClick={() => setActing(m)}
                      aria-label={`${m.full_name ?? "Member"}, ${CHANNEL_ROLE_LABEL[m.role]}. Open actions`}
                      className="flex w-full items-center gap-4 px-5 py-2.5 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-center gap-4 px-5 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {!memberQuery.trim() && sortedMembers.length > MEMBER_PEEK && (
            // button-shape: exempt -- a list row ("View all"), drawn like the member rows above it
            <button
              type="button"
              aria-expanded={showAllMembers}
              onClick={() => setShowAllMembers((v) => !v)}
              className="block w-full px-5 pb-3 pl-[5.25rem] pt-1 text-left text-[15px] font-semibold text-success hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {showAllMembers ? "Show fewer" : `View all (${sortedMembers.length - MEMBER_PEEK} more)`}
            </button>
          )}

        </section>

        <section className="pb-4 pt-1.5">
          {can.leave && <InfoRow icon={LogOut} label="Leave channel" danger disabled={pending} onClick={() => setConfirm({ kind: "leave" })} />}
          <p className="px-5 pt-2 text-[13px] text-muted-foreground">
            Channel created{creator?.full_name ? ` by ${creator.full_name}` : ""}, on {fmtDate(c.created_at)}
          </p>
        </section>

        {/* The tapped person's actions — only what this operator may do to them. */}
        <Sheet open={!!acting} onClose={() => setActing(null)} title={acting?.full_name ?? "Member"} size="sm" alignToPane>
          {acting && (
            <div className="-mx-2 flex flex-col">
              <p className="px-2 pb-2 text-sm text-muted-foreground">{CHANNEL_ROLE_LABEL[acting.role]}</p>
              <MemberActionRow
                icon={MessageCircle}
                label={`Message ${(acting.full_name ?? "them").split(" ")[0]}`}
                plain
                disabled={pending}
                onClick={() => {
                  const who = acting;
                  setActing(null);
                  start(async () => {
                    const r = await openDirect(who.user_id);
                    if (!r.ok || !r.id) return toast.error(r.ok ? "That chat could not be opened." : r.error);
                    onClose();
                    router.push(`/comms/c/${r.id}`);
                  });
                }}
              />
              {can.set_roles &&
                (["admin", "member", "owner"] as const)
                  .filter((r) => r !== acting.role)
                  .map((r) => (
                    <MemberActionRow
                      key={r}
                      icon={r === "owner" ? Crown : r === "admin" ? ShieldCheck : User}
                      label={`Make ${CHANNEL_ROLE_LABEL[r].toLowerCase()}`}
                      plain
                      disabled={pending}
                      onClick={() => {
                        const who = acting;
                        setActing(null);
                        run(() => setMemberRole(c.id, who.user_id, r), "Role changed.");
                      }}
                    />
                  ))}
              {mayRemove(acting) && (
                <MemberActionRow
                  icon={UserMinus}
                  label="Remove from channel"
                  plain
                  danger
                  disabled={pending}
                  onClick={() => {
                    const who = acting;
                    setActing(null);
                    setConfirm({ kind: "remove", member: who });
                  }}
                />
              )}
            </div>
          )}
        </Sheet>
      </div>

      <PulseConfirm
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

/**
 * One action row in the members list or a member's sheet: WhatsApp's "Add member" shape —
 * a 44px green circle with a white icon (or a plain icon, `plain`), then the words.
 */
function MemberActionRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  expanded,
  plain,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  expanded?: boolean;
  plain?: boolean;
  danger?: boolean;
}) {
  return (
    // button-shape: exempt -- a whole list row (WhatsApp's "Add member"), not an action button
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      className={`flex w-full items-center gap-4 px-4 py-2.5 text-left text-[15px] hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60 ${danger ? "text-danger" : "text-heading"}`}
    >
      {plain ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          <Icon className={`h-5 w-5 ${danger ? "text-danger" : "text-muted-foreground"}`} aria-hidden />
        </span>
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success text-white">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1 break-words">{label}</span>
    </button>
  );
}

/** One 52px row of the info list: an icon, the words, and optionally a value and a chevron. */
function InfoRow({
  icon: Icon,
  label,
  value,
  hint,
  onClick,
  disabled,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  /** A grey second line ("All messages", "Owner: Roja"). */
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    // button-shape: exempt -- a whole list row of the info sheet, not an action button
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[52px] w-full items-center gap-5 px-5 py-2 text-left text-base hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60 ${danger ? "text-danger" : "text-heading"}`}
    >
      <Icon className={`h-[22px] w-[22px] shrink-0 ${danger ? "text-danger" : "text-muted-foreground"}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block break-words">{label}</span>
        {hint && <span className="block text-[13px] text-muted-foreground">{hint}</span>}
      </span>
      {value && <span className="shrink-0 text-[15px] text-muted-foreground">{value}</span>}
    </button>
  );
}

/** WhatsApp's round header buttons (Add · Search · Mute): a pale rounded square, a word under it. */
function RoundAction({ icon: Icon, label, onClick, disabled }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    // button-shape: exempt -- an icon tile with its word underneath, the info page's header actions
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-[4.5rem] flex-col items-center gap-1.5 rounded-xl py-1 text-xs text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <span className="flex h-11 w-14 items-center justify-center rounded-2xl bg-surface-muted hover:bg-border">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      {label}
    </button>
  );
}

/** A small round icon-only button (the pencils, the member search). */
function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    // button-shape: exempt -- a round icon-only control beside a heading
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/** The tile word for a file: its extension, or FILE. */
function fileBadge(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return ext && ext.length <= 4 ? ext : "file";
}
