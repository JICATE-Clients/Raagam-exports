import {
  Armchair,
  CircleDot,
  Cog,
  Droplets,
  Factory,
  Fan,
  Flame,
  HardHat,
  LayoutGrid,
  Mail,
  MessageCircle,
  Monitor,
  Mouse,
  PackagePlus,
  PenLine,
  Printer,
  Scale,
  Scissors,
  ShieldAlert,
  SprayCan,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AssistItem } from "@/lib/resolve/assist-types";

/**
 * The catalog stores an icon NAME (rh_catalog_areas.icon, 0751) so an admin
 * can change it without a deploy; the chat draws it from this map. An unknown
 * name draws a plain dot rather than nothing.
 */
const ICONS: Record<string, LucideIcon> = {
  armchair: Armchair,
  cog: Cog,
  droplets: Droplets,
  factory: Factory,
  fan: Fan,
  flame: Flame,
  "hard-hat": HardHat,
  "layout-grid": LayoutGrid,
  mail: Mail,
  "message-circle": MessageCircle,
  monitor: Monitor,
  mouse: Mouse,
  "package-plus": PackagePlus,
  "pen-line": PenLine,
  printer: Printer,
  scale: Scale,
  scissors: Scissors,
  "shield-alert": ShieldAlert,
  "spray-can": SprayCan,
  wallet: Wallet,
  wifi: Wifi,
  wrench: Wrench,
  zap: Zap,
};

export const ASSIST_ICON_NAMES = Object.keys(ICONS);

export function assistIcon(name: string): LucideIcon {
  return ICONS[name] ?? CircleDot;
}

/**
 * The search box under the first three beats: every word typed must appear in
 * the item's label, a synonym, or its area's label. Plain substring, no
 * fuzzy guess — a wrong hit is a wrong routing, and "Something else" is one
 * tap away.
 */
export function searchCatalog<T extends { label: string; items: AssistItem[] }>(
  areas: readonly T[],
  q: string,
  limit = 8,
): { area: T; item: AssistItem }[] {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  const out: { area: T; item: AssistItem }[] = [];
  for (const area of areas) {
    for (const item of area.items) {
      const hay = `${item.label} ${item.synonyms.join(" ")} ${area.label}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push({ area, item });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
