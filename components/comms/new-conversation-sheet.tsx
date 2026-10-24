"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { createGroup, openDirect } from "@/lib/comms/actions";
import type { DirectoryPerson } from "@/lib/comms/types";
import { PeoplePicker } from "./people-picker";

/**
 * New message: one person opens (or finds) the DM with them — the database
 * keeps exactly one per pair, so this never makes a second; two or more make
 * a group.
 */
export function NewConversationSheet({ open, meId, onClose }: { open: boolean; meId: string; onClose: () => void }) {
  const router = useRouter();
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close() {
    setPeople([]);
    setName("");
    setError(null);
    onClose();
  }

  function submit() {
    if (people.length === 0) return;
    start(async () => {
      const r =
        people.length === 1
          ? await openDirect(people[0].id)
          : await createGroup({ name: name.trim() || null, member_ids: people.map((p) => p.id) });
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
      title="New message"
      size="sm"
      alignToPane
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || people.length === 0}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {people.length > 1 ? "Create group" : "Open conversation"}
          </Button>
        </div>
      }
    >
      <div className="flex h-[26rem] flex-col gap-3">
        <PeoplePicker selected={people} onChange={setPeople} exclude={[meId]} autoFocus />
        {people.length > 1 && (
          <Field label="Group name" hint="Optional — without one the group is named after its members.">
            {/* caps-input: exempt -- display text read by people (a conversation name or topic), like a chat message; nothing matches on it */}
            <Input uppercase={false} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
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
