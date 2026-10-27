import type { CommReaction } from "./types";

// ============================================================================
// Communication Hub — reactions as the screen holds them (0737 / 0760).
//
// Pure, so the message loader, the optimistic update and
// scripts/check-comms-reactions.mts share one definition of "the chips".
// COUNTS ARE NEVER STORED: they are folded from the (message, user, emoji)
// rows every time, here and in comm_message_reactions().
// ============================================================================

/** Rows → chips, one per emoji, in order of first use. An embed returns rows
 *  in no promised order, so they are sorted by `created_at` here first. */
export function foldReactions(
  rows: { emoji: string; user_id: string; created_at?: string }[],
  me: string | null,
): CommReaction[] {
  const byEmoji = new Map<string, CommReaction>();
  const ordered = [...rows].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  for (const x of ordered) {
    const r = byEmoji.get(x.emoji) ?? { emoji: x.emoji, count: 0, mine: false, users: [] };
    if (r.users.includes(x.user_id)) continue; // a row can only exist once; never count it twice
    r.users.push(x.user_id);
    r.count += 1;
    if (x.user_id === me) r.mine = true;
    byEmoji.set(x.emoji, r);
  }
  return Array.from(byEmoji.values());
}

/**
 * The chips after `me` sets `emoji` to `on` — the optimistic picture shown
 * while the request is in flight. Idempotent: setting a state the chips are
 * already in returns them unchanged, which is what makes a double click safe.
 * A chip whose count reaches zero disappears.
 */
export function applyReaction(reactions: CommReaction[], emoji: string, on: boolean, me: string): CommReaction[] {
  const at = reactions.findIndex((r) => r.emoji === emoji);
  if (on) {
    if (at >= 0 && reactions[at].mine) return reactions;
    if (at < 0) return [...reactions, { emoji, count: 1, mine: true, users: [me] }];
    return reactions.map((r, i) => (i === at ? { ...r, count: r.count + 1, mine: true, users: [...r.users, me] } : r));
  }
  if (at < 0 || !reactions[at].mine) return reactions;
  const r = reactions[at];
  if (r.count <= 1) return reactions.filter((_, i) => i !== at);
  return reactions.map((x, i) => (i === at ? { ...x, count: x.count - 1, mine: false, users: x.users.filter((u) => u !== me) } : x));
}

/** "Bala, Priya and 3 others" — who reacted, for the chip's tooltip and label. */
export function reactorNames(users: string[], names: Map<string, string | null>, me: string): string {
  const shown = users.map((u) => (u === me ? "You" : names.get(u) ?? "someone"));
  if (shown.length <= 3) return shown.length === 2 ? shown.join(" and ") : shown.join(", ").replace(/, ([^,]*)$/, " and $1");
  return `${shown.slice(0, 2).join(", ")} and ${shown.length - 2} others`;
}
