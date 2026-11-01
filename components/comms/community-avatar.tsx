import type { CSSProperties } from "react";
import { UsersRound } from "lucide-react";
import { glowVars } from "@/lib/ui/buyer-glow";
import { cn } from "@/lib/utils";

/**
 * A community's mark (0775): the community's own hue (`glowVars`, the same
 * per-name colour a chat avatar wears) in a rounded square with a soft ring
 * around it — WhatsApp draws a community as a stacked square, so it never
 * reads as one person or one group.
 */
export function CommunityAvatar({ name, size = "md" }: { name: string; size?: "md" | "xl" }) {
  return (
    <span
      aria-hidden
      style={glowVars(name) as CSSProperties}
      className={cn(
        "relative flex shrink-0 items-center justify-center",
        "bg-[color-mix(in_srgb,var(--glow)_20%,var(--surface))] text-[var(--ink)] dark:text-[color-mix(in_srgb,var(--ink)_55%,white)]",
        "outline outline-2 outline-offset-2 outline-[color-mix(in_srgb,var(--glow)_45%,transparent)]",
        size === "xl" ? "h-20 w-20 rounded-3xl" : "h-10 w-10 rounded-xl",
      )}
    >
      <UsersRound className={size === "xl" ? "h-9 w-9" : "h-5 w-5"} />
    </span>
  );
}
