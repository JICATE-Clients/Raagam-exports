"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronRight, Loader2, Megaphone, MoreVertical, Pencil, Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { Truncated } from "@/components/ui/truncated";
import {
  addCommunityGroups,
  addCommunityMembers,
  decideCommunityRequest,
  joinCommunityGroup,
  leaveCommunity,
  myLinkableGroups,
  removeCommunityGroup,
  setCommunityRole,
  setGroupJoinPolicy,
  updateCommunity,
} from "@/lib/comms/community-actions";
import type { CommunityDetail, CommunityGroup, DirectoryPerson } from "@/lib/comms/types";
import { cn } from "@/lib/utils";
import { CommunityAvatar } from "./community-avatar";
import { avatarStyle, AVATAR_TINT } from "./conversation-list";
import { initials } from "./message-body";
import { PeoplePicker } from "./people-picker";

const GREEN_TINT = "bg-[color-mix(in_srgb,#1f9d6b_14%,var(--surface))] text-[#137a52] dark:text-[#6fdcaa]";

/**
 * A community's page (0775), WhatsApp's community home: its mark, name and
 * description; Announcements; the groups the person is in; the other groups
 * of the community, each with Join (open) or Ask to join (an admin approves);
 * join requests waiting on the person; and the member list.
 *
 * Every button here is a request — the RPC decides (community owner / admin,
 * or the group's own admin for its join policy and its requests). An action
 * the person may not take is not drawn, and if it were, Postgres would refuse
 * it with the sentence shown in the toast.
 */
export function CommunityView({ community }: { community: CommunityDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "edit" | "invite" | "groups">(null);
  const [leaving, setLeaving] = useState(false);
  const admin = community.my_role === "owner" || community.my_role === "admin";
  const mine = community.groups.filter((g) => g.is_member);
  const others = community.groups.filter((g) => !g.is_member);

  function run(id: string, task: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) {
    setBusyId(id);
    start(async () => {
      const r = await task();
      setBusyId(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (done) toast.success(done);
      router.refresh();
    });
  }

  function join(g: CommunityGroup) {
    setBusyId(g.id);
    start(async () => {
      const r = await joinCommunityGroup(g.id);
      setBusyId(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.outcome === "joined") {
        router.push(`/comms/c/${g.id}`);
      } else {
        toast.success(`Request sent. An admin of ${g.name ?? "the group"} will approve it.`);
      }
      router.refresh();
    });
  }

  const groupMenu = (g: CommunityGroup) =>
    admin || g.can_manage ? (
      <DropdownMenu
        label={`Options for ${g.name ?? "group"}`}
        items={[
          {
            label: "Anyone in the community can join",
            checked: g.join_policy === "open",
            onClick: () => run(g.id, () => setGroupJoinPolicy(g.id, "open")),
          },
          {
            label: "Admins approve requests",
            checked: g.join_policy === "request",
            onClick: () => run(g.id, () => setGroupJoinPolicy(g.id, "request")),
          },
          ...(admin
            ? [
                {
                  label: "Remove from community",
                  icon: X,
                  danger: true,
                  separatorBefore: true,
                  onClick: () => run(g.id, () => removeCommunityGroup(community.id, g.id), `${g.name ?? "The group"} was removed from the community.`),
                },
              ]
            : []),
        ]}
      />
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Link
          href="/comms"
          className="rounded-md p-2.5 text-muted-foreground hover:bg-surface-muted group-data-[pulse]/pulse:@3xl/comms:hidden [@media(hover:hover)]:p-1.5"
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <CommunityAvatar name={community.name} />
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-base font-semibold text-heading">{community.name}</h1>
          <p className="text-xs text-muted-foreground">
            Community · {community.group_count} {community.group_count === 1 ? "group" : "groups"} · {community.member_count} members
          </p>
        </div>
        <DropdownMenu
          label="Community options"
          trigger={<MoreVertical className="h-4 w-4" />}
          items={[
            ...(admin ? [{ label: "Edit community", icon: Pencil, onClick: () => setSheet("edit") }] : []),
            { label: "Leave community", icon: X, danger: true, separatorBefore: admin, onClick: () => setLeaving(true) },
          ]}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex flex-col items-center gap-1.5 border-b-8 border-surface-muted px-4 pb-4 pt-5 text-center">
          <CommunityAvatar name={community.name} size="xl" />
          <h2 className="mt-2 text-balance text-xl font-extrabold text-heading">{community.name}</h2>
          <p className="text-[13px] text-muted-foreground">
            Community · {community.member_count} {community.member_count === 1 ? "member" : "members"}
          </p>
          {community.description && <p className="max-w-prose whitespace-pre-line text-sm text-foreground">{community.description}</p>}
          {admin && (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <ActionTile icon={<UserPlus className="h-5 w-5" />} label="Invite" onClick={() => setSheet("invite")} />
              <ActionTile icon={<Plus className="h-5 w-5" />} label="Add groups" onClick={() => setSheet("groups")} />
              <ActionTile icon={<Pencil className="h-5 w-5" />} label="Edit" onClick={() => setSheet("edit")} />
            </div>
          )}
        </section>

        {community.announcement_id && (
          <Section title="Announcements">
            <Link
              href={`/comms/c/${community.announcement_id}`}
              className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", GREEN_TINT)}>
                <Megaphone className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-heading">Announcements</span>
                <span className="block text-[13px] text-muted-foreground">
                  {admin ? "You can post here as a community admin." : "Only community admins can send messages."}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </Section>
        )}

        {community.requests.length > 0 && (
          <Section title="Requests to join" count={community.requests.length}>
            <ul>
              {community.requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                  <PersonAvatar name={r.full_name ?? "?"} />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-bold text-heading">{r.full_name ?? "Someone"}</span>
                    <span className="text-muted-foreground"> wants to join {r.group_name ?? "a group"}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending && busyId === r.id}
                    onClick={() => run(r.id, () => decideCommunityRequest(r.id, false), "Request declined.")}
                  >
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    disabled={pending && busyId === r.id}
                    onClick={() => run(r.id, () => decideCommunityRequest(r.id, true), `${r.full_name ?? "They"} joined ${r.group_name ?? "the group"}.`)}
                  >
                    {pending && busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Groups you're in" count={mine.length}>
          {mine.length === 0 ? (
            <p className="px-2 pb-2 text-[13px] text-muted-foreground">You are not in any group of this community yet.</p>
          ) : (
            <ul>
              {mine.map((g) => (
                <li key={g.id} className="flex items-center gap-1">
                  <Link
                    href={`/comms/c/${g.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <GroupAvatar name={g.name ?? "Group"} />
                    <GroupText g={g} />
                  </Link>
                  {groupMenu(g)}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Other groups in this community" count={others.length}>
          {others.length === 0 ? (
            <p className="px-2 pb-2 text-[13px] text-muted-foreground">You are in every group of this community.</p>
          ) : (
            <ul>
              {others.map((g) => (
                <li key={g.id} className="flex items-center gap-2 px-2 py-1.5">
                  <GroupAvatar name={g.name ?? "Group"} />
                  <GroupText g={g} />
                  {g.requested ? (
                    <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">Requested</span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={pending && busyId === g.id} onClick={() => join(g)}>
                      {pending && busyId === g.id && <Loader2 className="h-4 w-4 animate-spin" />}
                      {g.join_policy === "open" || admin ? "Join" : "Ask to join"}
                    </Button>
                  )}
                  {groupMenu(g)}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Members" count={community.members.length}>
          <ul>
            {community.members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-2.5 px-2 py-1.5">
                <PersonAvatar name={m.full_name ?? "?"} />
                <Truncated text={m.full_name ?? "Unknown"} className="min-w-0 flex-1 text-sm font-semibold text-foreground" />
                {m.role !== "member" && (
                  <span className={cn("shrink-0 rounded-md px-1.5 text-[11px] font-extrabold", GREEN_TINT)}>
                    {m.role === "owner" ? "Owner" : "Admin"}
                  </span>
                )}
                {admin && m.role !== "owner" && (
                  <DropdownMenu
                    label={`Options for ${m.full_name ?? "member"}`}
                    items={[
                      m.role === "admin"
                        ? { label: "Dismiss as admin", onClick: () => run(m.user_id, () => setCommunityRole(community.id, m.user_id, "member")) }
                        : { label: "Make community admin", onClick: () => run(m.user_id, () => setCommunityRole(community.id, m.user_id, "admin")) },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <EditSheet open={sheet === "edit"} community={community} onClose={() => setSheet(null)} />
      <InviteSheet open={sheet === "invite"} community={community} onClose={() => setSheet(null)} />
      <AddGroupsSheet open={sheet === "groups"} community={community} onClose={() => setSheet(null)} />
      <ConfirmDialog
        open={leaving}
        title={`Leave ${community.name}?`}
        body="You will leave its Announcements and every group of this community you are in. You can be added back later."
        confirmLabel="Leave community"
        isPending={pending}
        onCancel={() => setLeaving(false)}
        onConfirm={() =>
          start(async () => {
            const r = await leaveCommunity(community.id);
            setLeaving(false);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success(`You left ${community.name}.`);
            router.push("/comms");
            router.refresh();
          })
        }
      />
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="border-b-8 border-surface-muted px-2 pb-1.5 pt-3 last:border-b-0">
      <h3 className="flex justify-between px-2 pb-1.5 text-xs font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
        <span>{title}</span>
        {count !== undefined && <span className="tabular-nums">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function ActionTile({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    // button-shape: exempt -- WhatsApp's community action tiles (user 2026-10-31, the Pulse Communities mockup): an icon over a word, not an action button
    <button
      type="button"
      onClick={onClick}
      className="flex w-24 flex-col items-center gap-1 rounded-xl border border-border bg-surface px-2 py-2.5 text-xs font-bold text-[#137a52] hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-[#6fdcaa]"
    >
      {icon}
      {label}
    </button>
  );
}

function GroupAvatar({ name }: { name: string }) {
  return (
    <span aria-hidden style={avatarStyle(name)} className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold", AVATAR_TINT)}>
      {initials(name)}
    </span>
  );
}

function PersonAvatar({ name }: { name: string }) {
  return (
    <span aria-hidden style={avatarStyle(name)} className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold", AVATAR_TINT)}>
      {initials(name)}
    </span>
  );
}

function GroupText({ g }: { g: CommunityGroup }) {
  return (
    <span className="min-w-0 flex-1">
      <Truncated text={g.name ?? "Unnamed group"} className="block text-sm font-bold text-heading" />
      <span className="block text-[13px] text-muted-foreground">
        {g.member_count} {g.member_count === 1 ? "member" : "members"}
        {g.join_policy === "request" ? " · admins approve" : ""}
      </span>
    </span>
  );
}

function EditSheet({ open, community, onClose }: { open: boolean; community: CommunityDetail; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function save() {
    start(async () => {
      const r = await updateCommunity(community.id, { name, description: description.trim() || null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setError(null);
      onClose();
      router.refresh();
    });
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit community"
      size="sm"
      alignToPane
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim()}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Community name" required>
          {/* spell-suggest: exempt -- a community is named by the people in it; there is no vocabulary to offer */}
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          {/* spell-suggest: exempt -- free text */}
          <Textarea value={description} maxLength={500} rows={4} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function InviteSheet({ open, community, onClose }: { open: boolean; community: CommunityDetail; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function close() {
    setPeople([]);
    setError(null);
    onClose();
  }
  function add() {
    start(async () => {
      const r = await addCommunityMembers(community.id, people.map((p) => p.id));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(`${r.added ?? people.length} added to ${community.name}.`);
      close();
      router.refresh();
    });
  }
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Add people to the community"
      size="sm"
      alignToPane
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={add} disabled={pending || people.length === 0}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Add {people.length > 0 ? people.length : ""}
          </Button>
        </div>
      }
    >
      <div className="flex h-[24rem] flex-col gap-3">
        <p className="text-[13px] text-muted-foreground">They join the community and its Announcements, and can then join its groups.</p>
        <PeoplePicker selected={people} onChange={setPeople} exclude={community.members.map((m) => m.user_id)} autoFocus />
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function AddGroupsSheet({ open, community, onClose }: { open: boolean; community: CommunityDetail; onClose: () => void }) {
  const router = useRouter();
  const [groups, setGroups] = useState<{ id: string; title: string; member_count: number }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    let live = true;
    void myLinkableGroups().then((r) => {
      if (!live) return;
      if (r.ok) setGroups(r.groups);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open]);
  function close() {
    setPicked(new Set());
    setGroups(null);
    setError(null);
    onClose();
  }
  function add() {
    start(async () => {
      const r = await addCommunityGroups(community.id, [...picked]);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      close();
      router.refresh();
    });
  }
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Add groups"
      size="sm"
      alignToPane
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={add} disabled={pending || picked.size === 0}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Add groups
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-muted-foreground">
          Groups you own or admin that are not in a community yet. Everyone in them joins {community.name}.
        </p>
        {groups === null ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading your groups…
          </p>
        ) : groups.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">None to add.</p>
        ) : (
          <ul>
            {groups.map((g) => (
              <li key={g.id} className="flex items-center gap-2 border-b border-border py-0.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-foreground">{g.title}</span>
                  <span className="text-xs text-muted-foreground">{g.member_count} members</span>
                </span>
                <Toggle
                  checked={picked.has(g.id)}
                  ariaLabel={`Add ${g.title}`}
                  onChange={(on) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(g.id);
                      else next.delete(g.id);
                      return next;
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
