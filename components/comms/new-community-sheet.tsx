"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { createCommunity, myLinkableGroups } from "@/lib/comms/community-actions";

type Linkable = { id: string; title: string; member_count: number };

/**
 * New community (0775, WhatsApp's "New community"): a name, a description, and
 * any of the person's own groups to bring in — groups they own or admin that
 * are not in a community yet. Creating it makes the person its owner and gives
 * it an Announcements chat; everyone in the chosen groups joins the community.
 *
 * "Already exists" shows while typing against the communities the person can
 * see; the RPC refuses any duplicate in the workspace, including ones they
 * cannot see (dup-check: server-only -- other people's communities are not
 * readable here, so the local check covers only the person's own).
 */
export function NewCommunitySheet({ open, onClose, taken = [] }: { open: boolean; onClose: () => void; taken?: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groups, setGroups] = useState<Linkable[] | null>(null);
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

  const trimmed = name.trim();
  const dup = trimmed && taken.some((t) => t.trim().toLowerCase() === trimmed.toLowerCase())
    ? `${trimmed.toUpperCase()} already exists. Use a different name.`
    : null;

  function close() {
    setName("");
    setDescription("");
    setPicked(new Set());
    setGroups(null);
    setError(null);
    onClose();
  }

  function create() {
    if (!trimmed || dup) return;
    start(async () => {
      const r = await createCommunity({ name: trimmed, description: description.trim() || null, group_ids: [...picked] });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      close();
      if (r.id) router.push(`/comms/community/${r.id}`);
    });
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="New community"
      size="sm"
      alignToPane
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={create} disabled={pending || !trimmed || !!dup}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create community
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted-foreground">
          A community brings related groups together. Members get one Announcements chat that only community admins can post in.
        </p>
        <Field label="Community name" required error={dup ?? undefined}>
          {/* spell-suggest: exempt -- a community is named by the people in it; there is no vocabulary to offer */}
          <Input value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} aria-invalid={!!dup} />
        </Field>
        <Field label="Description" hint="Who is this community for?">
          {/* spell-suggest: exempt -- free text */}
          <Textarea value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-muted-foreground">Add your groups</p>
          {groups === null ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading your groups…
            </p>
          ) : groups.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              None to add. Only groups you own or admin, and not already in a community, can be added. You can add groups later.
            </p>
          ) : (
            <ul className="flex flex-col">
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
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
