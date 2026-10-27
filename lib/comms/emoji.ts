// ============================================================================
// Communication Hub — the reaction emoji catalog (0760).
//
// ONE LIST, THREE READERS: the picker draws it, the server action checks
// against it, and `comm_allowed_emoji()` in 0760 holds the same values —
// scripts/check-comms-reactions.mts fails the build if the SQL and this file
// ever disagree (the same pattern ALLOWED_MIME follows for attachments).
//
// Native Unicode, no images and no dependency: every browser and phone this
// ERP runs on draws these with the system emoji font. Each value is written
// exactly as stored — ❤️ is U+2764 U+FE0F, and the plain U+2764 is a DIFFERENT
// string, so it is not in the list. Keywords are English words an operator
// types into the search box; they never leave the browser.
//
// Pure: no React, no server import.
// ============================================================================

export interface EmojiDef {
  e: string;
  /** Search words, lower case. The first one is the accessible name. */
  k: string[];
}

export interface EmojiCategory {
  key: string;
  label: string;
  emojis: EmojiDef[];
}

/** The ten the spec names first, shown as the picker's top row. */
export const COMMON_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🙏", "🚀", "✅", "😮", "👎"] as const;

const d = (e: string, ...k: string[]): EmojiDef => ({ e, k });

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    key: "smileys",
    label: "Smileys",
    emojis: [
      d("😀", "grinning", "smile", "happy"),
      d("😃", "smiley", "happy"),
      d("😄", "smile", "happy", "joy"),
      d("😁", "grin", "beaming"),
      d("😆", "laughing", "satisfied"),
      d("😅", "sweat smile", "relief", "phew"),
      d("😂", "laughing", "joy", "tears", "lol"),
      d("🤣", "rolling on the floor", "rofl", "lol"),
      d("🙂", "slight smile", "ok"),
      d("😉", "wink"),
      d("😊", "blush", "smile", "happy"),
      d("😇", "innocent", "halo", "angel"),
      d("🥰", "love", "hearts", "adore"),
      d("😍", "heart eyes", "love"),
      d("🤩", "star struck", "wow", "excited"),
      d("😘", "kiss"),
      d("😋", "yum", "tasty", "delicious"),
      d("😎", "cool", "sunglasses"),
      d("🤓", "nerd", "geek"),
      d("🤔", "thinking", "hmm", "consider"),
      d("🤨", "raised eyebrow", "doubt", "skeptical"),
      d("😐", "neutral", "meh"),
      d("😑", "expressionless", "blank"),
      d("😶", "speechless", "silent"),
      d("🙄", "eye roll", "whatever"),
      d("😏", "smirk"),
      d("😬", "grimace", "awkward", "yikes"),
      d("😌", "relieved", "calm"),
      d("😔", "pensive", "sad"),
      d("😴", "sleeping", "tired", "zzz"),
      d("😷", "mask", "sick", "ill"),
      d("🤒", "fever", "sick", "thermometer"),
      d("🤯", "mind blown", "shocked", "exploding head"),
      d("🥳", "party", "celebrate", "birthday"),
      d("😮", "surprised", "open mouth", "wow"),
      d("😲", "astonished", "shocked"),
      d("😳", "flushed", "embarrassed"),
      d("🥺", "pleading", "please", "puppy eyes"),
      d("😢", "cry", "sad", "tear"),
      d("😭", "sob", "crying", "sad"),
      d("😱", "scream", "fear", "shocked"),
      d("😤", "triumph", "huff", "frustrated"),
      d("😡", "angry", "rage", "mad"),
      d("🤐", "zipper mouth", "secret", "quiet"),
      d("🫡", "salute", "respect", "yes sir"),
      d("🤗", "hug", "hugging"),
      d("🤭", "hand over mouth", "oops", "giggle"),
    ],
  },
  {
    key: "gestures",
    label: "Hands",
    emojis: [
      d("👍", "thumbs up", "like", "yes", "approve", "ok"),
      d("👎", "thumbs down", "dislike", "no"),
      d("👌", "ok hand", "perfect"),
      d("✌️", "victory", "peace"),
      d("🤞", "fingers crossed", "luck", "hope"),
      d("🤝", "handshake", "deal", "agreement"),
      d("👏", "clap", "applause", "well done"),
      d("🙌", "raised hands", "hooray", "celebrate"),
      d("🙏", "thanks", "please", "pray", "namaste"),
      d("👋", "wave", "hello", "bye"),
      d("💪", "strong", "muscle", "flex"),
      d("✍️", "writing", "note"),
      d("👉", "point right"),
      d("👈", "point left"),
      d("👆", "point up"),
      d("👇", "point down"),
      d("☝️", "index up", "one", "attention"),
      d("✋", "raised hand", "stop", "wait"),
      d("🤙", "call me", "shaka"),
      d("🫶", "heart hands", "love"),
    ],
  },
  {
    key: "hearts",
    label: "Hearts",
    emojis: [
      d("❤️", "heart", "love", "red heart"),
      d("🧡", "orange heart"),
      d("💛", "yellow heart"),
      d("💚", "green heart"),
      d("💙", "blue heart"),
      d("💜", "purple heart"),
      d("🖤", "black heart"),
      d("🤍", "white heart"),
      d("💔", "broken heart", "sad"),
      d("💯", "hundred", "100", "perfect", "full marks"),
      d("✨", "sparkles", "shiny", "new"),
      d("⭐", "star", "favourite"),
      d("🌟", "glowing star", "excellent"),
      d("🔥", "fire", "hot", "lit", "urgent"),
    ],
  },
  {
    key: "celebration",
    label: "Celebrate",
    emojis: [
      d("🎉", "party popper", "celebration", "tada", "congrats"),
      d("🎊", "confetti", "celebration"),
      d("🎈", "balloon", "party"),
      d("🎁", "gift", "present"),
      d("🎂", "birthday cake", "birthday"),
      d("🏆", "trophy", "winner", "award"),
      d("🥇", "gold medal", "first"),
      d("🏅", "medal", "achievement"),
      d("🚀", "rocket", "launch", "ship it", "fast"),
      d("🍾", "champagne", "celebrate"),
      d("☕", "coffee", "tea", "break"),
      d("🍵", "tea", "chai"),
      d("🍕", "pizza", "food"),
      d("🍰", "cake", "sweet"),
    ],
  },
  {
    key: "work",
    label: "Work",
    emojis: [
      d("👀", "eyes", "looking", "watching", "see"),
      d("📌", "pin", "pushpin", "important"),
      d("📎", "paperclip", "attachment"),
      d("📝", "memo", "note", "write"),
      d("📋", "clipboard", "list"),
      d("📊", "bar chart", "report", "stats"),
      d("📈", "chart up", "growth", "increase"),
      d("📉", "chart down", "decrease", "drop"),
      d("📅", "calendar", "date", "schedule"),
      d("⏰", "alarm", "deadline", "time"),
      d("⏳", "hourglass", "waiting", "pending"),
      d("📦", "package", "box", "shipment", "carton"),
      d("🚚", "truck", "delivery", "dispatch"),
      d("🚢", "ship", "export", "vessel"),
      d("🧵", "thread", "yarn", "sewing"),
      d("🧶", "yarn", "knitting", "wool"),
      d("👕", "t-shirt", "garment", "shirt"),
      d("✂️", "scissors", "cutting"),
      d("🧾", "receipt", "invoice", "bill"),
      d("💰", "money", "payment"),
      d("💡", "idea", "bulb", "suggestion"),
      d("🔍", "search", "inspect", "check"),
      d("🔧", "wrench", "fix", "maintenance"),
      d("⚙️", "gear", "settings", "process"),
      d("🔒", "locked", "secure", "approved"),
      d("📞", "phone", "call"),
      d("📧", "email", "mail"),
      d("🗓️", "spiral calendar", "plan"),
    ],
  },
  {
    key: "symbols",
    label: "Symbols",
    emojis: [
      d("✅", "check mark", "done", "complete", "yes", "approved"),
      d("☑️", "ballot check", "done"),
      d("✔️", "check", "ok"),
      d("❌", "cross", "no", "wrong", "rejected"),
      d("❎", "cross button", "cancel"),
      d("⚠️", "warning", "caution", "alert"),
      d("❗", "exclamation", "important"),
      d("❓", "question", "doubt"),
      d("‼️", "double exclamation", "urgent"),
      d("🆗", "ok button", "okay"),
      d("🆕", "new"),
      d("🔴", "red circle", "stop", "blocked"),
      d("🟠", "orange circle", "in progress"),
      d("🟡", "yellow circle", "pending", "caution"),
      d("🟢", "green circle", "go", "ok", "done"),
      d("🔵", "blue circle", "info"),
      d("➕", "plus", "add", "agree"),
      d("➖", "minus", "remove"),
      d("🔁", "repeat", "again", "redo"),
      d("🔄", "refresh", "update", "sync"),
      d("⬆️", "up", "increase"),
      d("⬇️", "down", "decrease"),
      d("➡️", "right", "next", "forward"),
      d("🛑", "stop sign", "halt", "hold"),
      d("🚫", "prohibited", "not allowed", "blocked"),
    ],
  },
];

/** Every emoji the catalog offers, in picker order, de-duplicated. */
export const ALLOWED_EMOJI: string[] = Array.from(
  new Set([...COMMON_REACTIONS, ...EMOJI_CATEGORIES.flatMap((c) => c.emojis.map((x) => x.e))]),
);

const ALLOWED_SET = new Set(ALLOWED_EMOJI);
export function isAllowedEmoji(e: string): boolean {
  return ALLOWED_SET.has(e);
}

const BY_EMOJI = new Map<string, EmojiDef>();
for (const c of EMOJI_CATEGORIES) for (const x of c.emojis) if (!BY_EMOJI.has(x.e)) BY_EMOJI.set(x.e, x);

/** "thumbs up" for 👍 — the screen-reader name of a reaction chip or picker cell. */
export function emojiName(e: string): string {
  return BY_EMOJI.get(e)?.k[0] ?? "reaction";
}

/** Picker search: every word typed must start a keyword ("thu up" finds 👍). */
export function searchEmoji(q: string): EmojiDef[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const seen = new Set<string>();
  const out: EmojiDef[] = [];
  for (const c of EMOJI_CATEGORIES) {
    for (const x of c.emojis) {
      if (seen.has(x.e)) continue;
      const kw = x.k.flatMap((k) => k.split(/\s+/));
      if (words.every((w) => kw.some((k) => k.startsWith(w)))) {
        seen.add(x.e);
        out.push(x);
      }
    }
  }
  return out;
}
