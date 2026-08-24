"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  postMessageInput,
  editMessageInput,
  messageContent,
  isRefusal,
  type PostMessageInput,
} from "./types";

/**
 * Writes for the RE-Community channel (0458, doc/file.md §4).
 *
 * ## THE GUARD HERE IS THIN BECAUSE THE REAL GUARD IS RLS
 *
 * Every other actions file in this module opens with `can("orders", "edit")`,
 * and that check is the guard. Here it is NOT, and treating it as one would be
 * the bug: `orders:edit` is held across the company, and a channel is private to
 * its members. The gate that matters is `is_order_channel_member()` inside the
 * policies — a non-member's insert is refused by Postgres whatever this file
 * believes. What the checks below add is a BETTER SENTENCE than PostgREST's,
 * and a refusal before the round trip.
 *
 * The one thing an action cannot skip is `author_id`: the insert policy demands
 * `author_id = auth.uid()` and `kind = 'message'`, so a user can neither post
 * under someone else's name nor forge a bot alert. Sending the id from the
 * client would not weaken that — it would just be refused.
 */

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

function rev(salesOrderId: string): void {
  revalidatePath(`/orders/${salesOrderId}/community`);
}

/** Post to the stream. Text, files, or both — `messageContent` refuses neither. */
export async function postMessage(input: PostMessageInput): Promise<Result> {
  const parsed = postMessageInput.safeParse(input);
  if (!parsed.success) return fail("That message could not be read.");
  const data = parsed.data;

  const content = messageContent(data);
  if (isRefusal(content)) return fail(content.refused);

  const s = await createClient();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) return fail("You are signed out.");

  // Get-or-create, and re-run the auto-join rule. A stakeholder whose role was
  // granted after this channel was spawned becomes a member HERE, which is what
  // stops "I can see the order but not its channel".
  const { data: channelId } = await s.rpc("ensure_order_channel", {
    p_sales_order_id: data.sales_order_id,
  });
  if (!channelId) return fail("This order has no community channel.");

  const { data: row, error } = await s
    .from("order_channel_messages")
    .insert({
      channel_id: channelId as string,
      author_id: user.id,
      kind: "message",
      body: content.body,
      parent_id: data.parent_id,
    })
    .select("id")
    .single();

  // A refusal here is almost always the membership gate, and saying so is worth
  // more than the driver's message: the operator is looking at an order they can
  // read and being told they cannot speak in its channel.
  if (error || !row) return fail("You are not a member of this order's channel.");

  if (content.files.length > 0) {
    const { error: fileErr } = await s.from("order_channel_files").insert(
      content.files.map((f) => ({
        message_id: row.id,
        file_name: f.file_name,
        storage_path: f.storage_path,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
      })),
    );
    // THE MESSAGE STAYS. Deleting it to "keep things consistent" would throw
    // away text the operator typed because an attachment row failed — and the
    // bytes are already in the bucket either way, so nothing is made cleaner.
    if (fileErr) {
      rev(data.sales_order_id);
      return fail("The message was posted but its attachment could not be linked.");
    }
  }

  rev(data.sales_order_id);
  return { ok: true, id: row.id };
}

/**
 * Edit your own words. The policy allows the author and nobody else — not
 * `orders:edit`, which is about ORDERS and would let a manager rewrite what
 * somebody else said in a stream the company treats as the record of the job.
 */
export async function editMessage(
  salesOrderId: string,
  input: { message_id: string; body: string },
): Promise<Result> {
  const parsed = editMessageInput.safeParse(input);
  if (!parsed.success) return fail("That message could not be read.");
  const body = parsed.data.body.trim();
  if (!body) return fail("A message cannot be emptied. Delete it instead.");

  const s = await createClient();
  const { error } = await s
    .from("order_channel_messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", parsed.data.message_id);
  if (error) return fail("Only the person who wrote a message can edit it.");

  rev(salesOrderId);
  return { ok: true };
}

export async function deleteMessage(
  salesOrderId: string,
  messageId: string,
): Promise<Result> {
  const s = await createClient();
  const { error } = await s.from("order_channel_messages").delete().eq("id", messageId);
  if (error) return fail("You cannot delete that message.");
  rev(salesOrderId);
  return { ok: true };
}

/**
 * Mark the channel read up to now.
 *
 * Own-row UPDATE is allowed unconditionally by the policy — without that a
 * member who only holds `orders:view` could never clear their own badge, and it
 * would sit there unread forever on exactly the stakeholders §4 auto-joins to
 * RECEIVE alerts (the cutting room reads; it does not edit orders).
 */
export async function markChannelRead(
  salesOrderId: string,
  channelId: string,
): Promise<Result> {
  const s = await createClient();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) return fail("You are signed out.");

  const { error } = await s
    .from("order_channel_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("user_id", user.id);
  if (error) return fail("The channel could not be marked read.");
  // Deliberately NOT revalidated: marking read changes a badge, and rebuilding
  // the page under the operator on every channel open is a visible flicker for
  // no gain.
  void salesOrderId;
  return { ok: true };
}

/**
 * Add somebody the rule did not reach — an outside merchandiser, a specific
 * knitter's coordinator. `orders:edit` is required ON TOP of membership: a
 * reader who merely observes a channel must not be able to widen it.
 */
export async function addChannelMember(
  salesOrderId: string,
  channelId: string,
  userId: string,
  channelRole: string | null,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You cannot change who is in this channel.");

  const s = await createClient();
  const { error } = await s.from("order_channel_members").upsert(
    {
      channel_id: channelId,
      user_id: userId,
      channel_role: channelRole,
      join_reason: "manual",
      // Re-adding somebody who was removed must CLEAR the removal, or the row
      // silently stays inert and the operator adds them again tomorrow.
      removed_at: null,
    },
    { onConflict: "channel_id,user_id" },
  );
  if (error) return fail("That person could not be added to the channel.");
  rev(salesOrderId);
  return { ok: true };
}

/**
 * Remove somebody. A SOFT removal, and the softness is the point: `removed_at`
 * is what survives `sync_order_channel_members()` re-running on the next page
 * load. A hard delete would be undone by the auto-join rule within seconds, and
 * the operator would be left believing the removal had failed silently.
 */
export async function removeChannelMember(
  salesOrderId: string,
  memberId: string,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("You cannot change who is in this channel.");

  const s = await createClient();
  const { error } = await s
    .from("order_channel_members")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", memberId);
  if (error) return fail("That member could not be removed.");
  rev(salesOrderId);
  return { ok: true };
}
