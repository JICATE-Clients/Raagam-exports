"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Archive, ArrowLeft, Hash, Loader2, Lock, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createChannel, joinChannel } from "@/lib/comms/actions";
import { findChannels } from "@/lib/comms/channel-actions";
import {
  CHANNEL_DESC_MAX,
  CHANNEL_NAME_MAX,
  CHANNEL_ROLE_LABEL,
  channelNameProblem,
  normalizeChannelName,
  type ChannelScope,
  type DiscoveredChannel,
} from "@/lib/comms/channels";
import type { DirectoryPerson, Visibility } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";
import { PeoplePicker } from "./people-picker";
import { ChannelPhotoSlot, saveChannelPhoto } from "./channel-photo";
import { announceChannelsChanged } from "./sidebar-channels";

/**
 * Channel discovery (0751). Every public channel in the workspace, plus the
 * private ones the caller is in — `comm_discover_channels()` decides, so a
 * private channel the caller is not in is never named, counted or matched.
 * Archived channels sit behind their own filter, out of normal discovery.
 *
 * The search is debounced (300 ms) and paged (30 at a time, "Load more"); the
 * first page arrives with the route.
 */
export function ChannelBrowser({
  initial,
  initialTotal,
  canCreate,
  openCreate,
}: {
  initial: DiscoveredChannel[];
  initialTotal: number;
  canCreate: boolean;
  openCreate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<ChannelScope>("active");
  const [rows, setRows] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(openCreate && canCreate);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [, start] = useTransition();
  // The newest request wins: an answer to an older query is dropped.
  const seq = useRef(0);
  const first = useRef(true);

  function fetchPage(nextQ: string, nextScope: ChannelScope, offset: number) {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    void findChannels({ q: nextQ || null, scope: nextScope, offset }).then((r) => {
      if (mine !== seq.current) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setRows((prev) => (offset === 0 ? r.rows : [...prev, ...r.rows]));
      setTotal(r.total);
    });
  }

  useEffect(() => {
    // The route already carried the first page of the default view.
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => fetchPage(q.trim(), scope, 0), 300);
    return () => clearTimeout(t);
  }, [q, scope]);

  function join(id: string) {
    setJoiningId(id);
    start(async () => {
      const r = await joinChannel(id);
      setJoiningId(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      announceChannelsChanged();
      router.push(`/comms/c/${id}`);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link href="/comms" className="rounded-md p-2.5 text-muted-foreground hover:bg-surface-muted @3xl/comms:hidden [@media(hover:hover)]:p-1.5" aria-label="Back to conversations">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-heading">Channels</h1>
        {canCreate && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New channel
          </Button>
        )}
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        {/* caps-input: exempt -- a filter box; the query is not a stored value */}
        <Input
          type="search"
          uppercase={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, description or topic"
          aria-label="Search channels"
          className="min-w-[12rem] flex-1"
        />
        <ToggleGroup
          label="Which channels"
          value={scope}
          onChange={setScope}
          options={[
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
        {error ? (
          <p className="flex items-center justify-center gap-2 p-6 text-sm text-danger" role="alert">
            {error}
            <button type="button" className="font-semibold underline" onClick={() => fetchPage(q.trim(), scope, 0)}>
              Retry
            </button>
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {loading
              ? "Searching…"
              : q
                ? "No channels match."
                : scope === "archived"
                  ? "No archived channels."
                  : canCreate
                    ? "No channels yet. Create the first one."
                    : "No channels yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                {c.visibility === "private" ? (
                  <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Private" />
                ) : (
                  <Hash className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <Link href={`/comms/c/${c.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block break-words text-sm font-semibold text-foreground">
                    {c.name}
                    {c.is_archived && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <Archive className="h-3 w-3" aria-hidden /> archived{c.archived_at ? ` ${fmtDate(c.archived_at)}` : ""}
                      </span>
                    )}
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {[c.description, c.topic, c.department_name].filter(Boolean).join(" · ") ||
                      (c.visibility === "private" ? "Private channel" : "Public channel")}
                  </span>
                </Link>
                <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground @md/comms:inline-flex" aria-label={`${c.member_count} members`}>
                  <Users className="h-3.5 w-3.5" aria-hidden /> {c.member_count}
                </span>
                {c.is_member ? (
                  <span className="shrink-0 text-xs font-medium text-success">
                    {c.my_role && c.my_role !== "member" ? CHANNEL_ROLE_LABEL[c.my_role] : "Joined"}
                  </span>
                ) : c.visibility === "public" && !c.is_archived ? (
                  <Button size="sm" variant="outline" onClick={() => join(c.id)} disabled={joiningId === c.id}>
                    {joiningId === c.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Join
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {rows.length < total && !error && (
          <div className="flex justify-center p-3">
            <Button variant="outline" size="sm" disabled={loading} onClick={() => fetchPage(q.trim(), scope, rows.length)}>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load more ({total - rows.length})
            </Button>
          </div>
        )}
      </div>

      {canCreate && <CreateChannelSheet open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      );
}

/**
 * New channel. The name is shown as it WILL be stored (#cutting-room for
 * "Cutting Room") with the rule's sentence when it cannot be one. The creator
 * is the owner; initial members are optional. `createKey` is minted once per
 * open, so a double-click or a retried request returns the same channel.
 */
function CreateChannelSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [members, setMembers] = useState<DirectoryPerson[]>([]);
  // 0839: the cropped photo, uploaded once the channel exists.
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [createKey, setCreateKey] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const slug = normalizeChannelName(name);
  const problem = name.trim() ? channelNameProblem(slug) : null;

  function close() {
    setName("");
    setDescription("");
    setVisibility("public");
    setMembers([]);
    setPhoto(null);
    setError(null);
    setCreateKey(newKey());
    onClose();
  }

  function submit() {
    start(async () => {
      const r = await createChannel({
        name,
        visibility,
        description: description || null,
        // No Topic or Department on the New channel form (user 2026-11-12,
        // screenshot 144112: "remove topic and department"). Topic can still
        // be set later in the channel's details.
        topic: null,
        department_id: null,
        member_ids: members.map((m) => m.id),
        create_key: createKey,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // The photo needs the channel's id, so it goes up second. A failed photo
      // never undoes the channel: it is created, and the photo can be set again
      // from Channel info.
      if (photo && r.id) {
        const p = await saveChannelPhoto(r.id, photo);
        if (!p.ok) toast.error(`#${slug} was created, but its photo was not saved. ${p.error}`);
      }
      toast.success(`#${slug} created.`);
      announceChannelsChanged();
      close();
      router.push(`/comms/c/${r.id}`);
    });
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="New channel"
      size="sm"
      alignToPane
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {members.length === 0 ? "No one added" : `${members.length} ${members.length === 1 ? "person" : "people"} added`}
          </span>
          <span className="flex items-center gap-2">
            <Button variant="outline" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || !slug || !!problem}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Create channel
            </Button>
          </span>
        </div>
      }
    >
      {/* COMPACT (user 2026-11-12, artifact "Compact New Channel"): 32px
          fields, 10px between them; the Name carries a fixed # so the stored
          form shows while typing; Description starts one line and grows; the
          people search sits inside the people box (PeoplePicker `boxed`).
          Paired row: party 200 + 12 gap + term 176 = 388px of the ~408px body. */}
      <div className="space-y-2.5">
        {/* 0839: the photo slot leads the row. PUBLIC / PRIVATE STAYS BESIDE THE NAME
            (user 2026-11-12, artifact "New Channel Visibility"): the pair keeps its full
            width (shrink-0) and the Name takes whatever is left (flex-1), so "Private"
            is never clipped to "P" the way the fixed term 176 + hug pair was. */}
        <div className="flex items-start gap-2.5">
        <ChannelPhotoSlot blob={photo} onChange={setPhoto} disabled={pending} />
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="min-w-0 flex-1">
          <Field
            label="Name"
            required
            hint={
              problem ??
              (visibility === "private" ? "Only people you add · can't go public later" : slug ? "You own this channel." : undefined)
            }
          >
            {/* No "#" in front of the name (user 2026-11-12, WhatsApp style). */}
            <span className="relative block">
              {/* caps-input: exempt -- a channel name is stored lowercase by rule (0751); capitals would be refused */}
              <Input
                uppercase={false}
                value={name}
                maxLength={CHANNEL_NAME_MAX + 20}
                onChange={(e) => setName(e.target.value)}
                placeholder="cutting-room"
                aria-invalid={!!problem}
                autoFocus
                className="h-8"
              />
            </span>
          </Field>
          </div>
          <div className="shrink-0">
          <Field label="Who can see it">
            <Segmented
              name="channel-visibility"
              value={visibility}
              onChange={setVisibility}
              className="h-8"
              options={[
                { value: "public", label: "Public" },
                { value: "private", label: "Private" },
              ]}
            />
          </Field>
          </div>
        </div>
        </div>
        {/* No "0 / 500" counter (user 2026-11-12); maxLength still stops at the limit. */}
        <Field label="Description">
          {/* caps-input: exempt -- display text read by people, like a chat message; nothing matches on it */}
          <Textarea
            uppercase={false}
            rows={1}
            value={description}
            maxLength={CHANNEL_DESC_MAX}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What it's for, shown in discovery"
            className="max-h-24 min-h-8 resize-none py-1.5 [field-sizing:content]"
          />
        </Field>
        <Field label="Add people (optional)">
          <div className="h-56">
            <PeoplePicker selected={members} onChange={setMembers} boxed />
          </div>
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
