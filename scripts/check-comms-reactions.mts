// Verification for Communication Hub EMOJI REACTIONS (0737's comm_reactions,
// finished by 0760; lib/comms/emoji.ts, reactions.ts; the picker, the chips,
// the conversation and the thread).
//
//     npm run check:comms-reactions
//
// The signed-in, live half (who may react, duplicates, private messages,
// Realtime) is the reactions end-to-end run against the database. This file
// asserts what that cannot see:
//
//   1. ONE CATALOG — the picker's ALLOWED_EMOJI and 0760's comm_allowed_emoji()
//      hold the same values in the same spelling; the ten common reactions are
//      in it; nothing is duplicated; "lol" and markup are not emoji.
//   2. THE CHIPS ARE COUNTED, NEVER STORED — fold and optimistic-apply on
//      vectors: one chip per emoji, a user counted once, a double click a
//      no-op, a chip at zero gone, the server's answer replaces the guess.
//   3. THE RULES STAYED WHERE THEY ARE — active member only, own reaction only,
//      no reacting to a deleted or archived message, no-op sends no Realtime
//      event, (message, user, emoji) the key.
//   4. THE SCREENS — set (not flip) from chips and picker, a refusal restored,
//      Realtime UPDATEs re-read the named messages, threads can react.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALLOWED_EMOJI, COMMON_REACTIONS, EMOJI_CATEGORIES, emojiName, isAllowedEmoji, searchEmoji } from "../lib/comms/emoji.ts";
import { applyReaction, foldReactions, reactorNames } from "../lib/comms/reactions.ts";
import { setReactionInput } from "../lib/comms/types.ts";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`ok    ${msg}`);
  else {
    failures++;
    console.error(`FAIL  ${msg}`);
  }
}

const root = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const m0760 = read("supabase/migrations/0760_comms_reactions.sql");
const sql = m0760.replace(/--[^\n]*/g, "");

// ---------- 1. one catalog ----------

const arr = sql.match(/function public\.comm_allowed_emoji[\s\S]*?any \(array\[([\s\S]*?)\]\)/)?.[1] ?? "";
const sqlEmoji = Array.from(arr.matchAll(/'([^']+)'/g), (m) => m[1]);
const same = sqlEmoji.length === ALLOWED_EMOJI.length && sqlEmoji.every((e, i) => e === ALLOWED_EMOJI[i]);
check(same, `comm_allowed_emoji() = ALLOWED_EMOJI, value for value (${sqlEmoji.length} / ${ALLOWED_EMOJI.length})`);
check(COMMON_REACTIONS.length === 10 && ["👍", "❤️", "😂", "🎉", "👀", "🙏", "🚀", "✅", "😮", "👎"].every((e) => isAllowedEmoji(e)), "the ten common reactions are offered and allowed");
check(isAllowedEmoji("❤️") && !isAllowedEmoji("❤"), "❤️ is stored with its variation selector; the bare U+2764 is a different string and not offered");
const cells = EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((x) => x.e));
check(new Set(cells).size === cells.length, `no emoji appears twice in the picker (${cells.length} cells)`);
check(["lol", "<b>", "", " ", "👍👍", "javascript:"].every((e) => !isAllowedEmoji(e)), "text, markup, blanks and doubled emoji are not reactions");
check(EMOJI_CATEGORIES.every((c) => c.emojis.every((x) => x.k.length > 0 && x.k.every((k) => k === k.toLowerCase()))), "every emoji has a lower-case name for search and screen readers");
check(searchEmoji("thumb").some((x) => x.e === "👍") && searchEmoji("thu up").some((x) => x.e === "👍"), "search finds 👍 by 'thumb' and by 'thu up'");
check(searchEmoji("zzzz").length === 0 && searchEmoji("   ").length === 0, "search with nothing matching, or nothing typed, offers nothing");
check(emojiName("🚀") === "rocket" && emojiName("x") === "reaction", "every chip has a spoken name");

// ---------- 2. counted, never stored ----------

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const rows = [
  { emoji: "❤️", user_id: B, created_at: "2026-10-27T10:00:02Z" },
  { emoji: "👍", user_id: A, created_at: "2026-10-27T10:00:01Z" },
  { emoji: "👍", user_id: B, created_at: "2026-10-27T10:00:03Z" },
  { emoji: "👍", user_id: B, created_at: "2026-10-27T10:00:04Z" },
];
const f = foldReactions(rows, A);
check(f.length === 2 && f[0].emoji === "👍" && f[1].emoji === "❤️", "one chip per emoji, in order of first use (rows sorted by time, not arrival)");
check(f[0].count === 2 && f[0].mine && f[0].users.join() === `${A},${B}`, "a person is counted once per emoji, and 'mine' marks the caller");
check(f[1].count === 1 && !f[1].mine, "someone else's reaction is not marked mine");
check(foldReactions([], A).length === 0, "no rows, no chips");
const on1 = applyReaction(f, "🎉", true, A);
check(on1.length === 3 && on1[2].count === 1 && on1[2].mine, "adding a new emoji adds a chip of 1, marked mine");
check(applyReaction(on1, "🎉", true, A) === on1, "adding what you already have changes nothing (a double click is safe)");
const off = applyReaction(on1, "🎉", false, A);
check(off.length === 2 && !off.some((r) => r.emoji === "🎉"), "removing the last one removes the chip");
const offThumb = applyReaction(f, "👍", false, A);
check(offThumb[0].count === 1 && !offThumb[0].mine && offThumb[0].users.join() === B, "removing yours leaves the others' count and names");
check(applyReaction(f, "❤️", false, A) === f, "you cannot remove a reaction that is not yours");
const plusOne = applyReaction(f, "❤️", true, A);
check(plusOne[1].count === 2 && plusOne[1].mine, "joining someone's emoji raises its count");
const names = new Map([[B, "BALA"], [C, "PRIYA"]]);
check(reactorNames([A, B], names, A) === "You and BALA" && reactorNames([B, C, A, "x"], names, A) === "BALA, PRIYA and 2 others", "the chip names who reacted, from the member list");

check(setReactionInput.safeParse({ message_id: A, emoji: "👍", on: true }).success, "adding a catalog emoji is accepted at the door");
check(!setReactionInput.safeParse({ message_id: A, emoji: "lol", on: true }).success, "adding a non-emoji is refused at the door");
check(setReactionInput.safeParse({ message_id: A, emoji: "lol", on: false }).success, "REMOVING any stored value is allowed (older reactions can be taken back)");
check(!setReactionInput.safeParse({ message_id: "x", emoji: "👍", on: true }).success, "a malformed message id is refused");

// ---------- 3. the rules ----------

const setFn = sql.match(/function public\.comm_set_reaction[\s\S]*?\$\$;/)?.[0] ?? "";
check(/v_me\s+uuid := public\.comm_actor\(\)/.test(setFn), "the reacting person is the session (comm_actor), never an argument");
check(/where g\.id = p_message and g\.deleted_at is null/.test(setFn) && /not public\.comm_is_member\(v_conv\)/.test(setFn), "only an active member may react, and never to a deleted message");
check(/c\.is_archived/.test(setFn), "no reacting in an archived conversation");
check(/where message_id = p_message and user_id = v_me and emoji = v_emoji/.test(setFn), "removal touches only the caller's own row");
check(/on conflict \(message_id, user_id, emoji\) do nothing/.test(setFn), "a concurrent duplicate lands on the key and changes nothing");
check(/if v_n > 0 then\s+update public\.comm_messages set updated_at/.test(setFn), "only a REAL change bumps updated_at (no Realtime event for a no-op)");
check(/not public\.comm_allowed_emoji\(v_emoji\)/.test(setFn) && setFn.indexOf("comm_allowed_emoji") < setFn.indexOf("else"), "the allowlist is checked when ADDING only");
check(/comm_message_visible\(p_message\)/.test(sql.match(/function public\.comm_message_reactions[\s\S]*?\$\$;/)?.[0] ?? ""), "a message's reactions are read only by someone who may read the message");
check(/revoke all on function public\.comm_set_reaction\(uuid, text, boolean\) from public, anon;/.test(sql) && /revoke all on function public\.comm_message_reactions\(uuid\) from public, anon;/.test(sql), "neither reaction function is callable by anon");
check(/delete from public\.comm_reactions\s+where message_id = p_message;/.test(read("supabase/migrations/0737_communication_hub_core.sql")), "deleting a message deletes its reactions (0737, unchanged)");

// ---------- 4. the screens ----------

const item = read("components/comms/message-item.tsx");
check(/actions\.onReact\?\.\(m, r\.emoji, !r\.mine\)/.test(item), "a chip sets the OPPOSITE of what you hold — toggling your own, adding to someone else's");
check(/actions\.onReact!\(m, e, true\)/.test(item), "the picker only ever ADDS");
check(/<EmojiPicker/.test(item) && !/QUICK_REACTIONS/.test(item), "the full picker replaced the six-emoji menu");
check(/aria-pressed=\{r\.mine\}/.test(item) && /aria-label=\{`\$\{emojiName\(r\.emoji\)\}/.test(item), "chips say their emoji, count, who, and whether one is yours");
const view = read("components/comms/conversation-view.tsx");
check(/applyReaction\(x\.reactions, emoji, on, meId\)/.test(view) && /reactions: before/.test(view) && /reactions: truth/.test(view), "optimistic, restored on refusal, replaced by the server's answer");
check(/loadMessagesById\(id, ids\)/.test(view) && /"UPDATE"[\s\S]{0,120}onUpdate/.test(view), "a Realtime UPDATE re-reads the message it names (reactions on older messages update too)");
check(/onReact: \(m: CommMessage, e: string, on: boolean\) => void react\(m, e, on\)/.test(read("components/comms/thread-sheet.tsx")), "thread replies can be reacted to");
const picker = read("components/comms/emoji-picker.tsx");
check(/role="dialog"/.test(picker) && /e\.key === "Escape"/.test(picker) && /ArrowDown: COLS/.test(picker), "the picker is a labelled dialog: Escape closes, the arrows walk the grid");

if (failures > 0) {
  console.error(`\ncheck:comms-reactions — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:comms-reactions — all assertions passed");
