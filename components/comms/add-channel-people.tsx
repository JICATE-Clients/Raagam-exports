"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { addMembers } from "@/lib/comms/actions";
import type { CommMember, DirectoryPerson } from "@/lib/comms/types";
import { Face } from "./person-photo";
import { PeoplePicker } from "./people-picker";
import { announceChannelsChanged } from "./sidebar-channels";

/**
 * ADD PEOPLE FROM THE CHANNEL HEADER (user 2026-11-05, option A of the "add
 * members to a channel" board). Adding used to live three steps in — ⋮ ›
 * Channel info › Members › Add people. Now the header carries the member
 * faces and a 👤+ Add button; the faces open Channel info, the button opens
 * this sheet with the same `PeoplePicker` and the same `addMembers` action
 * Channel info uses, so the permission (`abilities.add_members`, decided by
 * the caller) and the RPC's own check are unchanged. Present members are left
 * out of the search.
 */
export function ChannelHeaderPeople({
  conversationId,
  channelName,
  members,
  canAdd,
  onOpenInfo,
}: {
  conversationId: string;
  channelName: string;
  members: CommMember[];
  canAdd: boolean;
  onOpenInfo: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<SheetOrigin | null>(null);
  const [adding, setAdding] = useState<DirectoryPerson[]>([]);
  const [pending, start] = useTransition();

  const active = members.filter((m) => !m.removed_at);
  const faces = active.slice(0, 3);

  function close() {
    if (pending) return;
    setAdding([]);
    setOpen(false);
  }

  function add() {
    if (adding.length === 0 || pending) return;
    start(async () => {
      const r = await addMembers(conversationId, adding.map((p) => p.id));
      if (!r.ok) {
        toast.error(r.error ?? "Those people could not be added.");
        return;
      }
      toast.success(`${adding.length} ${adding.length === 1 ? "person" : "people"} added.`);
      announceChannelsChanged();
      setAdding([]);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onOpenInfo}
        title="Members"
        aria-label={`${active.length} ${active.length === 1 ? "member" : "members"}. Open channel info`}
        className="hidden items-center gap-1.5 rounded-control px-1.5 py-1 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
      >
        <span className="flex" aria-hidden>
          {faces.map((m, i) => (
            <span
              key={m.user_id}
              className={
                "flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-primary-soft text-[9.5px] font-bold text-primary" +
                (i > 0 ? " -ml-1.5" : "")
              }
            >
              <Face userId={m.user_id} name={m.full_name} />
            </span>
          ))}
        </span>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground" aria-hidden>
          {active.length}
        </span>
      </button>
      {canAdd && (
        <Button
          onClick={(e) => {
            setOrigin(e.currentTarget.getBoundingClientRect());
            setOpen(true);
          }}
          title="Add people"
          aria-label="Add people"
          className="max-sm:px-2"
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          <span className="max-sm:sr-only">Add</span>
        </Button>
      )}

      <Sheet
        open={open}
        onClose={close}
        title={`Add people to #${channelName}`}
        size="sm"
        alignToPane
        origin={origin}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={add} disabled={pending || adding.length === 0}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Add {adding.length || ""}
            </Button>
          </div>
        }
      >
        <div className="h-72">
          <PeoplePicker selected={adding} onChange={setAdding} exclude={active.map((m) => m.user_id)} autoFocus />
        </div>
      </Sheet>
    </>
  );
}
