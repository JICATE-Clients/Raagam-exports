import { Factory, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import type { TimingGroup } from "@/lib/masters/group-timing-types";
import type { PersonKind } from "@/lib/masters/category-timing-types";
import type { DashboardTone } from "@/lib/dashboard/types";

/**
 * One colour per timing group, the same on Work Timing and the HR dashboard,
 * so the operator learns it once. Complete literal classes: Tailwind scans
 * source text, so a computed `from-${x}` would compile to nothing.
 *
 * `grad` / `glow` / `emoji` are the HR dashboard's own look (client
 * 2026-10-28: "this hr module no need to look like other modules … more cool,
 * fun vibe"). The HR module deliberately breaks from the house rule of
 * untinted card grounds — a client decision for this module, not a precedent.
 */
export const GROUP_LOOK: Record<
  TimingGroup,
  {
    icon: LucideIcon;
    tone: DashboardTone;
    rule: string;
    well: string;
    grad: string;
    glow: string;
    dot: string;
    emoji: string;
  }
> = {
  staff: {
    icon: Users,
    tone: "primary",
    rule: "bg-primary",
    well: "bg-primary-soft text-primary",
    grad: "bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-600",
    glow: "shadow-blue-500/30",
    dot: "bg-sky-400",
    emoji: "💼",
  },
  security: {
    icon: ShieldCheck,
    tone: "warning",
    rule: "bg-warning",
    well: "bg-warning-soft text-warning",
    grad: "bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500",
    glow: "shadow-orange-500/30",
    dot: "bg-amber-400",
    emoji: "🛡️",
  },
  production_staff: {
    icon: Factory,
    tone: "success",
    rule: "bg-success",
    well: "bg-success-soft text-success",
    grad: "bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-600",
    glow: "shadow-emerald-500/30",
    dot: "bg-emerald-400",
    emoji: "🏭",
  },
};

/**
 * The same looks keyed by Staff / Worker (0774) — Work Timing and the HR
 * dashboard now split people by which master they live in. Staff keeps the
 * Staff look; Worker takes the old Production Staff one.
 */
export const KIND_LOOK: Record<PersonKind, (typeof GROUP_LOOK)[TimingGroup]> = {
  staff: GROUP_LOOK.staff,
  worker: { ...GROUP_LOOK.production_staff, emoji: "🧵" },
};
