"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, Hash, Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createChannel, joinChannel } from "@/lib/comms/actions";
import type { ChannelListing, Visibility } from "@/lib/comms/types";

/**
 * Every channel the caller may see — all public ones, plus private ones they
 * are in (RLS decides; this only draws). Public channels open as a read-only
 * preview until joined.
 */
export function ChannelBrowser({
  channels,
  departments,
  canCreate,
}: {
  channels: ChannelListing[];
  departments: { id: string; name: string }[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [, start] = useTransition();

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return channels.filter(
      (c) =>
        !s ||
        c.name.toLowerCase().includes(s) ||
        (c.topic ?? "").toLowerCase().includes(s) ||
        (c.department_name ?? "").toLowerCase().includes(s),
    );
  }, [channels, q]);

  function join(id: string) {
    setJoiningId(id);
    start(async () => {
      const r = await joinChannel(id);
      setJoiningId(null);
      if (!r.ok) toast.error(r.error);
      else router.push(`/comms/c/${id}`);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link href="/comms" className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted @3xl/comms:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="flex-1 text-sm font-semibold text-heading">Channels</h1>
        {canCreate && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New channel
          </Button>
        )}
      </header>
      <div className="border-b border-border p-2">
        {/* caps-input: exempt -- a filter box; the query is not a stored value */}
        <Input type="search" uppercase={false} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a channel" aria-label="Find a channel" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {q ? "No channels match." : canCreate ? "No channels yet. Create the first one." : "No channels yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                {c.visibility === "private" ? (
                  <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Private" />
                ) : (
                  <Hash className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <Link href={`/comms/c/${c.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block break-words text-sm font-semibold text-foreground">
                    {c.name}
                    {c.is_archived && <span className="ml-2 text-xs font-normal text-muted-foreground">(archived)</span>}
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {[c.department_name, c.topic].filter(Boolean).join(" · ") || (c.visibility === "private" ? "Private channel" : "Public channel")}
                  </span>
                </Link>
                {c.is_member ? (
                  <span className="shrink-0 text-xs font-medium text-success">Joined</span>
                ) : c.visibility === "public" && !c.is_archived ? (
                  <Button size="sm" variant="outline" onClick={() => join(c.id)} disabled={joiningId === c.id}>
                    {joiningId === c.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Join
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canCreate && <CreateChannelSheet open={creating} departments={departments} onClose={() => setCreating(false)} />}
    </div>
  );
}

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
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [departmentId, setDepartmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close() {
    setName("");
    setTopic("");
    setVisibility("public");
    setDepartmentId("");
    setError(null);
    onClose();
  }

  function submit() {
    start(async () => {
      const r = await createChannel({
        name,
        visibility,
        topic: topic.trim() || null,
        department_id: departmentId || null,
        member_ids: [],
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
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
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Create channel
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Name" required>
          {/* caps-input: exempt -- display text read by people (a conversation name or topic), like a chat message; nothing matches on it */}
          <Input uppercase={false} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. cutting-room" autoFocus />
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
        <Field label="Topic">
          {/* caps-input: exempt -- display text read by people (a conversation name or topic), like a chat message; nothing matches on it */}
          <Input uppercase={false} value={topic} maxLength={250} onChange={(e) => setTopic(e.target.value)} />
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
