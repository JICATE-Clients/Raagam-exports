import { createLucideIcon } from "lucide-react";

/**
 * PULSE'S ICON — "Team chat" (user 2026-11-13, option F of the artifact "Pulse
 * Icon Options"): two people with a small speech bubble, i.e. people talking.
 * Drawn on lucide's 24px grid with its stroke rules, so it sits beside every
 * other lucide icon (size, strokeWidth, className all work as usual).
 */
export const TeamChat = createLucideIcon("team-chat", [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "body" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "head" }],
  ["path", { d: "M15 3h5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1l-2 2v-2", key: "bubble" }],
]);
