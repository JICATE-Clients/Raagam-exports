import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * NOOL — Raagam Assist's face (user 2026-10-28, from the mock-up
 * https://claude.ai/artifact/6E1UY6bVpjbFjWypvAbsHr: "okay do"). A thread
 * spool with a face on its paper label, replacing the sparkle disc. Nool
 * (நூல்) is "thread"; the agent's NAME is still `AGENT_NAME`, Nool is only the
 * picture.
 *
 * WHY A SPOOL. Every chat app has a round robot head; every worker here has
 * held a spool. It also survives being small — a wooden top, a blue body and a
 * cream label still read at 20px, where a face on a disc turns into a blob.
 *
 * THE MOOD IS THE MESSAGE. A worker who reads slowly, or reads Tamil better
 * than English, can still tell "sent" (happy), "careful" (worried) and "wait"
 * (thinking) from the face alone. The chat derives the mood from its own state
 * (`buddyMood` in assist-chat.tsx); nothing here decides it.
 *
 * Drawn in SVG and animated by `BUDDY_CSS` below, and
 * still under `prefers-reduced-motion` — the face changes, nothing moves. Only
 * the header's buddy is `live`; the one beside each reply stays still, so a
 * long conversation is not a column of bobbing spools.
 */
export type BuddyMood = "idle" | "listening" | "thinking" | "happy" | "worried";

const MOOD_WORD: Record<BuddyMood, string> = {
  idle: "ready",
  listening: "listening",
  thinking: "working on it",
  happy: "happy",
  worried: "worried",
};

/**
 * THE STYLES TRAVEL WITH THE COMPONENT, not in app/globals.css (2026-10-28):
 * they were there first, the dev server kept serving the old global sheet,
 * and the spool drew solid black. React 19 hoists a `<style href precedence>`
 * into <head> once however many buddies render, so a screen that shows Nool
 * always carries Nool's CSS. Colour on the CHARACTER only: brand blue thread,
 * brand green heart; the label and face are fixed art colours, readable on
 * either theme. `data-live` is what lets it move.
 */
const BUDDY_CSS = `
.assist-buddy .ab-shadow { fill: currentColor; opacity: 0.08; }
.assist-buddy .ab-body { fill: var(--brand-blue); }
.assist-buddy .ab-thread { stroke: var(--brand-blue); stroke-dasharray: 5 3; }
.assist-buddy .ab-wood { fill: #d9a467; }
.assist-buddy .ab-label { fill: #fff7e8; }
.assist-buddy .ab-needle { stroke: #9aa6b2; fill: var(--background); }
.assist-buddy .ab-pupils { fill: #1d2733; transition: transform 0.35s ease; }
.assist-buddy :is(.ab-eyes-happy, .ab-brows, .ab-smile, .ab-frown) { stroke: #1d2733; }
.assist-buddy .ab-cheek { fill: #f5a3a3; opacity: 0.8; }
.assist-buddy .ab-dots { fill: var(--brand-blue); }
.assist-buddy .ab-heart { stroke: var(--brand-green); }
.assist-buddy .ab-bang circle:first-child { fill: var(--warning); }
.assist-buddy :is(.ab-eyes-happy, .ab-brows, .ab-frown, .ab-heart, .ab-dots, .ab-bang) { opacity: 0; transition: opacity 0.2s; }
.assist-buddy .ab-smile, .assist-buddy .ab-eyes { transition: opacity 0.2s; }
.assist-buddy .ab-root { transform-box: view-box; transform-origin: 60px 132px; }
.assist-buddy .ab-needle { transform-box: view-box; transform-origin: 80px 30px; }
.assist-buddy :is(.ab-shadow, .ab-eyes, .ab-heart) { transform-box: fill-box; transform-origin: center; }

/* The faces — these hold with or without motion. */
.assist-buddy[data-mood="listening"] .ab-pupils { transform: translate(3px, 2px); }
.assist-buddy[data-mood="thinking"] .ab-pupils { transform: translate(1px, -3px); }
.assist-buddy[data-mood="thinking"] .ab-dots { opacity: 1; }
.assist-buddy[data-mood="happy"] .ab-eyes { opacity: 0; }
.assist-buddy[data-mood="happy"] .ab-eyes-happy { opacity: 1; }
.assist-buddy[data-mood="worried"] :is(.ab-brows, .ab-frown, .ab-bang) { opacity: 1; }
.assist-buddy[data-mood="worried"] .ab-smile { opacity: 0; }
.assist-buddy[data-mood="worried"] .ab-pupils { transform: translate(0, 1.5px); }

/* The motion — live buddies only. */
.assist-buddy[data-live] .ab-root { animation: ab-bob 3.2s ease-in-out infinite; }
.assist-buddy[data-live] .ab-shadow { animation: ab-shadow 3.2s ease-in-out infinite; }
.assist-buddy[data-live] .ab-needle { animation: ab-sway 4s ease-in-out infinite; }
.assist-buddy[data-live] .ab-thread { animation: ab-thread 6s linear infinite; }
.assist-buddy[data-live] .ab-eyes { animation: ab-blink 4.6s infinite; }
.assist-buddy[data-live][data-mood="listening"] .ab-root { animation: ab-lean 2.6s ease-in-out infinite; }
.assist-buddy[data-live][data-mood="thinking"] .ab-wind { animation: ab-wind 0.7s linear infinite; }
.assist-buddy[data-live][data-mood="thinking"] .ab-thread { animation-duration: 1.2s; }
.assist-buddy[data-live][data-mood="thinking"] .ab-dots circle { animation: ab-dot 1s ease-in-out infinite; }
.assist-buddy[data-live][data-mood="thinking"] .ab-dots circle:nth-child(2) { animation-delay: 0.15s; }
.assist-buddy[data-live][data-mood="thinking"] .ab-dots circle:nth-child(3) { animation-delay: 0.3s; }
.assist-buddy[data-live][data-mood="happy"] .ab-root { animation: ab-hop 0.9s cubic-bezier(0.3, 0.7, 0.4, 1) infinite; }
.assist-buddy[data-live][data-mood="happy"] .ab-shadow { animation: ab-shadow-hop 0.9s cubic-bezier(0.3, 0.7, 0.4, 1) infinite; }
.assist-buddy[data-live][data-mood="happy"] .ab-heart { animation: ab-heart 1.8s ease-out infinite; }
.assist-buddy[data-live][data-mood="worried"] .ab-root { animation: ab-worry 2.4s ease-in-out infinite; }
.assist-buddy[data-live][data-mood="worried"] .ab-needle { animation-duration: 1.4s; }
/* A still buddy that is happy shows the heart without it floating away. */
.assist-buddy:not([data-live])[data-mood="happy"] .ab-heart { opacity: 1; }

@keyframes ab-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes ab-shadow { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(0.9); } }
@keyframes ab-sway { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(5deg); } }
@keyframes ab-thread { to { stroke-dashoffset: -64; } }
@keyframes ab-wind { to { transform: translateY(-6px); } }
@keyframes ab-blink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.08); } }
@keyframes ab-lean { 0%, 100% { transform: rotate(3deg); } 50% { transform: rotate(4deg) translateY(-2px); } }
@keyframes ab-dot { 0%, 100% { transform: translateY(0); opacity: 0.45; } 40% { transform: translateY(-4px); opacity: 1; } }
@keyframes ab-hop {
  0%, 100% { transform: translateY(0) scale(1, 1); }
  15% { transform: translateY(0) scale(1.05, 0.94); }
  45% { transform: translateY(-12px) scale(0.97, 1.04); }
  75% { transform: translateY(0) scale(1.03, 0.97); }
}
@keyframes ab-shadow-hop { 0%, 75%, 100% { transform: scaleX(1); } 45% { transform: scaleX(0.7); } }
@keyframes ab-heart {
  0% { transform: translateY(6px) scale(0.4); opacity: 0; }
  25% { transform: translateY(0) scale(1); opacity: 1; }
  80% { transform: translateY(-8px) scale(1); opacity: 1; }
  100% { transform: translateY(-12px) scale(0.9); opacity: 0; }
}
@keyframes ab-worry { 0%, 100% { transform: rotate(-3deg) translateY(2px); } 50% { transform: rotate(-1deg) translateY(1px); } }
@media (prefers-reduced-motion: reduce) {
  .assist-buddy * { animation: none !important; transition: none !important; }
  .assist-buddy[data-mood="happy"] .ab-heart { opacity: 1; }
}
`;

/** Thread windings, drawn twice the body's height so the "thinking" scroll loops. */
const WINDINGS = Array.from({ length: 16 }, (_, i) => 32 + i * 6);

export function AssistBuddy({
  mood = "idle",
  size = 28,
  live = false,
  label,
  className,
}: {
  mood?: BuddyMood;
  /** Rendered width in px; the height follows the 120 × 150 drawing. */
  size?: number;
  /** Animate. Off, the buddy keeps its mood's face but holds still. */
  live?: boolean;
  /** Spoken name; omit for a decorative buddy (aria-hidden). */
  label?: string;
  className?: string;
}) {
  // useId's colons / guillemets are not safe inside url(#…); keep the letters.
  const clip = `ab-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <>
      <style href="assist-buddy" precedence="medium">
        {BUDDY_CSS}
      </style>
      <svg
        viewBox="0 0 120 150"
        width={size}
        height={size * 1.25}
        data-mood={mood}
        data-live={live || undefined}
        className={cn("assist-buddy flex-none overflow-visible", className)}
        {...(label ? { role: "img", "aria-label": `${label}, ${MOOD_WORD[mood]}` } : { "aria-hidden": true })}
      >
        <ellipse className="ab-shadow" cx="60" cy="138" rx="34" ry="5" />
        <g className="ab-root">
          <g className="ab-dots">
            <circle cx="16" cy="18" r="3" />
            <circle cx="26" cy="12" r="3" />
            <circle cx="36" cy="8" r="3" />
          </g>
          <path
            className="ab-heart"
            d="M60 20 C 54 12, 44 16, 48 24 L60 34 L72 24 C 76 16, 66 12, 60 20 Z"
            fill="none"
            strokeWidth="2.4"
            strokeDasharray="3 2"
            strokeLinejoin="round"
          />
          <g className="ab-bang">
            <circle cx="18" cy="22" r="9" />
            <path d="M18 16 v7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="18" cy="27" r="1.5" fill="#fff" />
          </g>
          <g className="ab-needle">
            <path d="M80 30 L94 3" strokeWidth="3" strokeLinecap="round" />
            <ellipse cx="92.2" cy="7" rx="1.4" ry="2.6" transform="rotate(28 92.2 7)" />
          </g>
          <path className="ab-thread" d="M92 7 C 116 14, 114 44, 98 60" fill="none" strokeWidth="2.2" strokeLinecap="round" />
          <clipPath id={clip}>
            <rect x="22" y="38" width="76" height="74" rx="3" />
          </clipPath>
          <g clipPath={`url(#${clip})`}>
            <rect className="ab-body" x="22" y="38" width="76" height="74" />
            <g className="ab-wind" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth="2">
              {WINDINGS.map((y) => (
                <path key={y} d={`M22 ${y} Q60 ${y + 3} 98 ${y}`} />
              ))}
            </g>
            <rect x="22" y="38" width="10" height="74" fill="#000" opacity=".08" />
          </g>
          <rect className="ab-wood" x="14" y="27" width="92" height="14" rx="7" />
          <rect x="20" y="30" width="40" height="3" rx="1.5" fill="#fff" opacity=".35" />
          <rect className="ab-wood" x="14" y="109" width="92" height="14" rx="7" />
          <rect className="ab-label" x="32" y="50" width="56" height="48" rx="9" />
          <g className="ab-brows" strokeWidth="2" strokeLinecap="round">
            <path d="M43 59 L52 61" />
            <path d="M77 59 L68 61" />
          </g>
          <g className="ab-eyes">
            <g className="ab-pupils">
              <ellipse cx="49" cy="70" rx="4.4" ry="5.8" />
              <ellipse cx="71" cy="70" rx="4.4" ry="5.8" />
              <circle cx="50.6" cy="67.6" r="1.6" fill="#fff" />
              <circle cx="72.6" cy="67.6" r="1.6" fill="#fff" />
            </g>
          </g>
          <g className="ab-eyes-happy" fill="none" strokeWidth="2.6" strokeLinecap="round">
            <path d="M44 72 Q49 64 54 72" />
            <path d="M66 72 Q71 64 76 72" />
          </g>
          <circle className="ab-cheek" cx="41" cy="80" r="3.6" />
          <circle className="ab-cheek" cx="79" cy="80" r="3.6" />
          <path className="ab-smile" d="M54 82 Q60 88 66 82" fill="none" strokeWidth="2.2" strokeLinecap="round" />
          <path className="ab-frown" d="M54 86 Q60 81 66 86" fill="none" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </svg>
    </>
  );
}
