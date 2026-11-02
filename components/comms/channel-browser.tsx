"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Archive, ArrowLeft, Hash, Loader2, Lock, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createChannel, joinChannel } from "@/lib/comms/actions";
import { findChannels } from "@/lib/comms/channel-actions";
import {
  CHANNEL_DESC_MAX,
  CHANNEL_NAME_MAX,
  CHANNEL_ROLE_LABEL,
  CHANNEL_TOPIC_MAX,
  channelNameProblem,
  normalizeChannelName,
  type ChannelScope,
  type DiscoveredChannel,
} from "@/lib/comms/channels";
import type { DirectoryPerson, Visibility } from "@/lib/comms/types";
import { fmtDate } from "@/lib/format";
import { PeoplePicker } from "./people-picker";
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
  departments,
  canCreate,
  openCreate,
}: {
  initial: DiscoveredChannel[];
  initialTotal: number;
  departments: { id: string; name: string }[];
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

      {canCreate && <CreateChannelSheet open={creating} departments={departments} onClose={() => setCreating(false)} />}
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
  departments,
  onClose,
}: {
  open: boolean;
  departments: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [topic, setTopic] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [departmentId, setDepartmentId] = useState("");
  const [members, setMembers] = useState<DirectoryPerson[]>([]);
  const [createKey, setCreateKey] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const slug = normalizeChannelName(name);
  const problem = name.trim() ? channelNameProblem(slug) : null;

  function close() {
    setName("");
    setDescription("");
    setTopic("");
    setVisibility("public");
    setDepartmentId("");
    setMembers([]);
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
        topic: topic || null,
        department_id: departmentId || null,
        member_ids: members.map((m) => m.id),
        create_key: createKey,
      });
      if (!r.ok) {
        setError(r.error);
        return;
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
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !slug || !!problem}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Create channel
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field
          label="Name"
          required
          hint={problem ?? (slug ? `Will be created as #${slug}. You will be its owner.` : "Lowercase letters, numbers, - and _.")}
        >
          {/* caps-input: exempt -- a channel name is stored lowercase by rule (0751); capitals would be refused */}
          <Input
            uppercase={false}
            value={name}
            maxLength={CHANNEL_NAME_MAX + 20}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. cutting-room"
            aria-invalid={!!problem}
            autoFocus
          />
        </Field>
        <Field label="Who can see it" hint={visibility === "public" ? "Anyone with Messages can find, read and join it." : "Only the people you add can see it. This cannot be made public later."}>
          <Segmented
            name="channel-visibility"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: "public", label: "Public" },
              { value: "private", label: "Private" },
            ]}
          />
        </Field>
        <Field label="Description" hint="What the channel is for. Shown in discovery.">
          {/* caps-input: exempt -- display text read by people, like a chat message; nothing matches on it */}
          <Textarea uppercase={false} rows={2} value={description} maxLength={CHANNEL_DESC_MAX} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Topic" hint="What is being discussed now. Easy to change later.">
          {/* caps-input: exempt -- display text read by people (a conversation name or topic), like a chat message; nothing matches on it */}
          <Input uppercase={false} value={topic} maxLength={CHANNEL_TOPIC_MAX} onChange={(e) => setTopic(e.target.value)} />
        </Field>
        <Field label="Department" hint="Optional. A department channel can add that department's logins in one step.">
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Add people" hint="Optional. You can add more later.">
          <div className="h-56 rounded-md border border-border">
            <PeoplePicker selected={members} onChange={setMembers} />
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
