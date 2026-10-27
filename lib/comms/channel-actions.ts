"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { commErrorText } from "./types";
import { discoverChannels, sidebarChannels } from "./channel-service";
import { isCommsMissing } from "./service";
import {
  discoverInput,
  prefsInput,
  transferInput,
  updateChannelInput,
  type DiscoverInput,
  type DiscoveredChannel,
  type PrefsInput,
  type SidebarChannel,
  type TransferInput,
  type UpdateChannelInput,
} from "./channels";

/**
 * Channel writes (0751). THE GUARD IS THE RPC: each calls `comm_channel_can()`
 * for the caller from `auth.uid()`, so a request built around this file is
 * refused by Postgres the same way. This file adds Zod at the door, a sentence
 * instead of a driver message, the audit row, and the revalidation.
 *
 * Every structural change also tells the sidebar to re-read (`changed` on the
 * result; the client fires `comms:channels-changed`), because the sidebar
 * lives in the app shell, outside the routes `revalidatePath` re-renders.
 */

type Fail = { ok: false; error: string };
type Ok = { ok: true; changed?: boolean };

function fail(error: string): Fail {
  return { ok: false, error };
}

function revHub(): void {
  revalidatePath("/comms", "layout");
}

export async function updateChannel(input: UpdateChannelInput): Promise<Ok | Fail> {
  const parsed = updateChannelInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the channel details.");
  const d = parsed.data;
  const s = await createClient();
  const { error } = await s.rpc("comm_update_channel", {
    p_conv: d.conversation_id,
    p_name: d.name,
    p_description: d.description,
    p_topic: d.topic,
  });
  if (error) return fail(commErrorText(error, "The channel could not be saved."));
  await writeAudit({
    action: "comm.channel_updated",
    entityType: "comm_conversation",
    entityId: d.conversation_id,
    metadata: { name: d.name },
  });
  revHub();
  return { ok: true, changed: true };
}

export async function setChannelArchived(conversationId: string, archived: boolean): Promise<Ok | Fail> {
  if (typeof archived !== "boolean") return fail("Choose archive or restore.");
  const s = await createClient();
  const { data, error } = await s.rpc("comm_set_channel_archived", { p_conv: conversationId, p_archived: archived });
  if (error) return fail(commErrorText(error, archived ? "The channel could not be archived." : "The channel could not be restored."));
  const changed = data === true;
  if (changed) {
    await writeAudit({
      action: archived ? "comm.archived" : "comm.unarchived",
      entityType: "comm_conversation",
      entityId: conversationId,
    });
    revHub();
  }
  return { ok: true, changed };
}

export async function transferChannelOwnership(input: TransferInput): Promise<Ok | Fail> {
  const parsed = transferInput.safeParse(input);
  if (!parsed.success) return fail("Pick the new owner.");
  const d = parsed.data;
  const s = await createClient();
  const { error } = await s.rpc("comm_transfer_channel_ownership", {
    p_conv: d.conversation_id,
    p_to: d.to_user_id,
    p_step_down_to: d.step_down_to,
  });
  if (error) return fail(commErrorText(error, "Ownership could not be transferred."));
  await writeAudit({
    action: "comm.ownership_transferred",
    entityType: "comm_conversation",
    entityId: d.conversation_id,
    metadata: { to: d.to_user_id, step_down_to: d.step_down_to },
  });
  revHub();
  return { ok: true, changed: true };
}

/** Pin / unpin and the notification level — the caller's own, nobody else's. */
export async function setConversationPrefs(input: PrefsInput): Promise<Ok | Fail> {
  const parsed = prefsInput.safeParse(input);
  if (!parsed.success) return fail("Unknown preference.");
  const d = parsed.data;
  const s = await createClient();
  const { error } = await s.rpc("comm_set_conversation_prefs", {
    p_conv: d.conversation_id,
    p_pinned: d.pinned,
    p_notify_level: d.notify_level,
  });
  if (error) return fail(commErrorText(error, "Your preference could not be saved."));
  revHub();
  return { ok: true, changed: true };
}

/** Discovery for the browser's debounced search and "Load more". */
export async function findChannels(
  input: DiscoverInput,
): Promise<{ ok: true; rows: DiscoveredChannel[]; total: number } | Fail> {
  const parsed = discoverInput.safeParse(input);
  if (!parsed.success) return fail("Check the search.");
  try {
    const r = await discoverChannels(parsed.data.q, parsed.data.scope, parsed.data.offset);
    return { ok: true, ...r };
  } catch {
    return fail("Channels could not be loaded.");
  }
}

/** The sidebar's list, re-read after a join / leave / pin / archive. */
export async function loadSidebarChannels(): Promise<{ ok: true; rows: SidebarChannel[] } | Fail> {
  try {
    return { ok: true, rows: await sidebarChannels() };
  } catch (e) {
    // Before 0751 is applied the list cannot exist; say what fixes it.
    if (isCommsMissing(e)) return fail("Channels need migration 0751.");
    return fail("Your channels could not be loaded.");
  }
}
