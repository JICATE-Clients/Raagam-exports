"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { createGroup, openDirect } from "@/lib/comms/actions";
import type { DirectoryPerson } from "@/lib/comms/types";
import { PeoplePicker } from "./people-picker";

/**
 * New message, WhatsApp's way (user 2026-10-29: "select a person, it should
 * directly open the chat"). Tapping a person opens (or finds) the DM with them
 * AT ONCE — the database keeps exactly one per pair, so this never makes a
 * second — with no "Open conversation" step after it.
 *
 * A group is the one case that needs a pick-several-then-confirm step, so it
 * is its own mode behind "New group", and only that mode has a create button.
 */
export function NewConversationSheet({ open, meId, onClose }: { open: boolean; meId: string; onClose: () => void }) {
  const router = useRouter();
  const [group, setGroup] = useState(false);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close() {
    setGroup(false);
    setPeople([]);
    setName("");
    setError(null);
    onClose();
  }

  function go(run: () => Promise<{ ok: true; id?: string } | { ok: false; error: string }>) {
    start(async () => {
      const r = await run();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      close();
      if (r.id) router.push(`/comms/c/${r.id}`);
    });
  }

  // Direct mode: the tap IS the choice. A second tap while the first is still
  // opening is ignored rather than racing it.
  function pickDirect(next: DirectoryPerson[]) {
    const p = next[0];
    if (!p || pending) return;
    setPeople([p]);
    setError(null);
    go(() => openDirect(p.id));
  }

  function createTheGroup() {
    if (people.length === 0) return;
    go(() => createGroup({ name: name.trim() || null, member_ids: people.map((p) => p.id) }));
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={group ? "New group" : "New message"}
      size="sm"
      alignToPane
      footer={
        group ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setGroup(false);
                setPeople([]);
                setName("");
                setError(null);
              }}
              disabled={pending}
            >
              Back
            </Button>
            <Button onClick={createTheGroup} disabled={pending || people.length === 0}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create group
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setGroup(true);
                setPeople([]);
                setError(null);
              }}
              disabled={pending}
            >
              <Users className="h-4 w-4" aria-hidden /> New group
            </Button>
            <Button variant="outline" onClick={close} disabled={pending}>
              Cancel
            </Button>
          </div>
        )
      }
    >
      <div className="flex h-[26rem] flex-col gap-3">
        {group ? (
          <PeoplePicker key="group" selected={people} onChange={setPeople} exclude={[meId]} autoFocus />
        ) : (
          <PeoplePicker key="direct" selected={[]} onChange={pickDirect} exclude={[meId]} single autoFocus />
        )}
        {group && people.length > 1 && (
          <Field label="Group name" hint="Optional — without one the group is named after its members.">
            {/* caps-input: exempt -- display text read by people (a conversation name or topic), like a chat message; nothing matches on it */}
            <Input uppercase={false} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        {!group && pending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening chat with {people[0]?.full_name}…
          </p>
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
