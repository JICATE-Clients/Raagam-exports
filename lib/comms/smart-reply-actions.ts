"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getAppUser } from "@/lib/auth/server";
import { allow } from "@/lib/rate-limit";
import { getMessages } from "./service";

/**
 * SMART REPLIES (user 2026-11-02, the Pulse mockup): up to three short replies
 * to the latest message of a chat, shown as chips above the box.
 *
 * - The messages are read through the caller's own session (`getMessages` is
 *   RLS-scoped), so a person can only ever get suggestions for a conversation
 *   they belong to.
 * - Only the last few text messages leave for the model — no attachments, no
 *   names beyond first names. A chip only FILLS the box; nothing sends itself.
 * - Never throws. No key / a failure / nothing worth answering → `[]`, and the
 *   caller falls back to its static chips.
 */

const MODEL = "claude-haiku-5-5";
const CONTEXT = 8;

export async function suggestReplies(conversationId: string): Promise<{ ok: true; replies: string[] }> {
  const none = { ok: true as const, replies: [] };
  try {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) return none;
    const me = await getAppUser();
    if (!me) return none;
    if (!allow(`comm-smart:${me.id}`, 20, 60_000)) return none;

    const page = await getMessages(conversationId, null, 20);
    const lines = page.messages
      .filter((m) => m.kind === "message" && !m.deleted_at && m.body?.trim())
      .slice(-CONTEXT);
    const last = lines[lines.length - 1];
    // Nothing to answer: empty chat, or the last word is the caller's own.
    if (!last || last.author_id === me.id) return none;

    const transcript = lines
      .map((m) => `${m.author_id === me.id ? "Me" : (m.author_name ?? "Someone").split(" ")[0]}: ${m.body!.slice(0, 400)}`)
      .join("\n");

    const client = new Anthropic({ apiKey: key, timeout: 8_000, maxRetries: 0 });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system:
        "You suggest replies for a garment exporter's internal team chat. Given a conversation, return ONLY a JSON array of 3 short replies (max 8 words each) that I could send to the last message, in the same language as the conversation. Make them relevant and different from each other; where it fits, include a plain acknowledgement such as 'Okay' or 'Done'. Never invent facts, numbers or commitments beyond a simple yes / no / will-check.",
      messages: [{ role: "user", content: transcript }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as unknown;
    if (!Array.isArray(arr)) return none;
    const replies = arr
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x && x.length <= 80)
      .slice(0, 3);
    return { ok: true, replies };
  } catch {
    return none;
  }
}
