"use server";

import { listMyFiles, type PulseFile } from "./files-service";
import { listChannels } from "./service";
import type { ChannelListing } from "./types";

/**
 * Reads Pulse's list pane makes only when the person picks the filter from
 * ▾ (Channels, Files), so the ordinary chat list never pays for them. Both run
 * as the caller through RLS.
 */

export async function loadPulseFiles(): Promise<{ ok: true; files: PulseFile[] } | { ok: false; error: string }> {
  try {
    return { ok: true, files: await listMyFiles() };
  } catch {
    return { ok: false, error: "Files could not be read. Try again." };
  }
}

/** Public channels the person is not in yet — Channels ▸ Find channels. */
export async function loadChannelsToFind(): Promise<{ ok: true; channels: ChannelListing[] } | { ok: false; error: string }> {
  try {
    const all = await listChannels();
    return { ok: true, channels: all.filter((c) => !c.is_member && !c.is_archived && c.visibility === "public") };
  } catch {
    return { ok: false, error: "Channels could not be read. Try again." };
  }
}
