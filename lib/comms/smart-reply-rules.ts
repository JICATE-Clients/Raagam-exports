/**
 * INSTANT SMART REPLIES (user 2026-11-03: "all messages need a suggestion reply
 * … like okay, done"). A plain, offline classifier of the last message received,
 * so EVERY incoming message has chips at once — the Claude-written set
 * (smart-reply-actions.ts) replaces them when it arrives, or never does when
 * no key is configured. Pure and free of imports, so it runs in the browser.
 */

type Kind = { re: RegExp; replies: (text: string) => string[] };

const KINDS: Kind[] = [
  {
    re: /(approve|approval|sign off|ok to proceed|confirm)/i,
    replies: (t) => {
      const when = t.match(/\d{1,2}(:\d{2})?\s*(am|pm)/i)?.[0];
      return ["Approved ✅", `Okay, will confirm${when ? ` by ${when}` : " shortly"}`, "Need a few details first"];
    },
  },
  { re: /(thank|thanks|thx)/i, replies: () => ["You're welcome 🙂", "Okay 👍", "Happy to help"] },
  { re: /^(hi|hello|hey|good (morning|afternoon|evening))\b/i, replies: () => ["Hi! How can I help?", "Hello 👋", "Okay, tell me"] },
  { re: /(delay|late|postpone|reschedule)/i, replies: () => ["Okay, by when?", "Please confirm the new date", "Please try to expedite"] },
  { re: /(finished|completed|done|dispatched|shipped|left the port|ready)/i, replies: () => ["Okay, thanks 👍", "Done, noted", "What is the next step?"] },
  { re: /(attached|attachment|sent the file|pdf|photo|image|sheet|report)/i, replies: () => ["Received, checking now", "Okay, will review", "Please resend the file"] },
  { re: /(call|meeting|tomorrow|today|schedule|available)/i, replies: () => ["Yes, I'm available", "Okay, send the time", "Can we do it tomorrow?"] },
  { re: /\?|^(which|what|when|where|who|how|can you|could you|please)\b/i, replies: () => ["Yes", "Okay, will check", "Can you share the details?"] },
];

/** Three short replies that fit `text`; never empty for a non-empty message. */
export function ruleReplies(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const hit = KINDS.find((k) => k.re.test(t));
  return hit ? hit.replies(t) : ["Okay 👍", "Done", "Noted, will update"];
}
