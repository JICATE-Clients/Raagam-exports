import {
  CalendarDays,
  ClipboardCheck,
  Clock,
  MessageCircleMore,
  PackageOpen,
  Plus,
  Route,
  ShoppingCart,
  Star,
  Truck,
  ArrowLeftRight,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { hasPermission, type Action, type AppUser, type Module } from "@/lib/auth/types";
import { allScreens, screenOfPath } from "@/lib/permissions/screen-catalog";
import { NAV } from "@/components/shell/nav";
import { moduleHue, moduleWellStyle } from "@/components/navigation/module-hue";

/**
 * HOME FAVOURITES — EVERY TILE IS DECLARED HERE AND NOWHERE ELSE (0812, user 2026-11-05,
 * mock-up https://claude.ai/artifact/SMQnEeCU1GonRHYCHcVvLd).
 *
 * The database stores KEYS only (`favorite_defaults`, `user_favorites`); this file owns what a
 * key means — label, icon, link and the permission that decides whether the tile shows at all.
 * Same shape as `ORDER_REPORTS` and the notification-event registry: a screen that moves is a
 * one-line change here, and no stored row can point at a dead link.
 *
 * Two kinds of key:
 *
 * - `a:<name>` — an ACTION: a tile that opens the entry form itself. Its `href` carries
 *   `?new=1` wherever the target is a list that opens its form through `useCreateIntent`, or is
 *   a route that IS the form (`/purchase/grn/new`). `npm run check:favorites` refuses a
 *   `?new=1` link whose page never reads the intent, because that tile would quietly open a list.
 * - `screen:<path>` — a SCREEN someone pinned with ☆. Label and icon come from the screen
 *   catalog and the module's own menu icon, so a pin needs no declaration.
 *
 * Client-safe on purpose: the bar, the Edit sheet and the ☆ resolve labels and icons in the
 * browser, and the server resolves the same keys to decide what may be shown.
 */

/**
 * A TILE'S COLOUR IS ITS RAIL MODULE'S (user 2026-11-05: option C for Favourites, then "the rails
 * icons also update like same"). Each action names the rail module it belongs to (`home`), and
 * the colour comes from `MODULE_HUE` — the same map the rail reads — so a Leave Request tile is
 * exactly HR's green in the rail beside it. A pinned screen takes its owning module's colour.
 */
export const favoriteWellStyle = moduleWellStyle;

export type FavoriteAction = {
  /** Stored as `a:<key>`. Lower-case, digits and hyphens (0812's check constraint). */
  key: string;
  label: string;
  /** Under the label in the Edit sheet and the admin screen: where it lives. */
  where: string;
  href: string;
  icon: LucideIcon;
  /** The grant that must hold for the tile to show. `null` = every login (their own queue,
   *  their own complaint — pages gated by `requireUser` alone). */
  module: Module | null;
  action: Action;
  /** The rail module whose colour the tile wears — declared, not derived from `href`: GRN is
   *  a Purchase route but stores goods, so it wears Stores' indigo. */
  home: string;
  /** A tile colour of its own, over `home`'s — only where two tiles of one module must not
   *  look alike (Pulse vs My Approvals, both under /comms). */
  hue?: string;
};

export const FAVORITE_ACTIONS: readonly FavoriteAction[] = [
  // ── Everyone ── the three the client named first for General Staff, plus their own queue.
  { key: "leave-request", label: "Leave Request", where: "HR ▸ Time Off ▸ Leave Requests", href: "/hr/time-off/leave?new=1", icon: CalendarDays, module: "hr_payroll", action: "view", home: "/hr" },
  { key: "permission-request", label: "Permission", where: "HR ▸ Time Off ▸ Permissions", href: "/hr/time-off/permission?new=1", icon: Clock, module: "hr_payroll", action: "view", home: "/hr" },
  { key: "help-repair", label: "Help & Repair", where: "Resolve ▸ Raise a concern", href: "/resolve/report/complaint", icon: Wrench, module: null, action: "view", home: "/resolve" },
  { key: "trip-request", label: "Trip Request", where: "Logistics ▸ Transport ▸ Requests", href: "/logistics/transport/requests?new=1", icon: Truck, module: "logistics", action: "create", home: "/logistics/transport" },
  { key: "my-approvals", label: "My Approvals", where: "Pulse ▸ My Approvals", href: "/comms/approvals", icon: ClipboardCheck, module: null, action: "view", home: "/comms" },
  // Pulse itself (user 2026-11-13, artifact "Favourites With Pulse"): one tap to the chats,
  // with the unread count on the tile (service.ts addBadges).
  // Bubble-with-dots in SKY BLUE (user 2026-11-13, artifact "Pulse Icon Options", "sky blue c
  // apply"): it wore My Approvals' rose and a plain bubble, so the two tiles looked alike.
  { key: "pulse", label: "Pulse", where: "Pulse ▸ Chats", href: "/comms", icon: MessageCircleMore, module: "communication", action: "view", home: "/comms", hue: "#0284c7" },
  // ── Store / Purchase ──
  { key: "raise-po", label: "Raise PO", where: "Purchase ▸ Raise PO", href: "/purchase/requirement-po?new=1", icon: ShoppingCart, module: "materials_purchase", action: "create", home: "/purchase" },
  { key: "grn", label: "GRN", where: "Purchase ▸ GRN ▸ New", href: "/purchase/grn/new", icon: PackageOpen, module: "materials_purchase", action: "create", home: "/stores" },
  { key: "stock-transfer", label: "Stock Transfer", where: "Purchase ▸ Stock Transfer ▸ New", href: "/purchase/transfers/new", icon: ArrowLeftRight, module: "stores", action: "create", home: "/stores" },
  { key: "vehicle-dispatch", label: "Vehicle Dispatch", where: "Logistics ▸ Transport ▸ Dispatch", href: "/logistics/transport/dispatch", icon: Route, module: "logistics", action: "edit", home: "/logistics/transport" },
  // ── Orders ──
  { key: "order-entry", label: "Order Entry", where: "Orders ▸ Order Entry", href: "/orders/garment-orders", icon: Plus, module: "orders", action: "create", home: "/orders" },
];

const ACTION_BY_KEY = new Map(FAVORITE_ACTIONS.map((a) => [`a:${a.key}`, a]));

/** A key as the browser and the server both resolve it. */
export type FavoriteItem = {
  key: string;
  kind: "action" | "screen";
  label: string;
  where: string;
  href: string;
  icon: LucideIcon;
  module: Module | null;
  action: Action;
  /** The tile's colour (MODULE_HUE, components/navigation/module-hue.ts). */
  hue: string;
};

export const SCREEN_PREFIX = "screen:";

/** The stored key for pinning a screen. The query string is dropped: a pin is a SCREEN, and
 *  `?new=1` on a pin would re-open a form on every visit. */
export function screenKey(pathname: string): string {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return SCREEN_PREFIX + path.toLowerCase();
}

/** Pinnable = a catalogued screen, or a module root on the menu. The dashboard is Home itself,
 *  so pinning it would be a tile pointing at the page it sits on. */
export function isPinnablePath(pathname: string): boolean {
  const path = screenKey(pathname).slice(SCREEN_PREFIX.length);
  if (path === "/") return false;
  if (!/^\/[a-z0-9/_-]*$/.test(path)) return false; // 0812's check constraint
  return allScreens().some((s) => s.key === path) || NAV.some((n) => n.href === path);
}

/** Resolve a stored key, or null when it no longer means anything (skipped, never shown). */
export function resolveFavorite(key: string): FavoriteItem | null {
  const a = ACTION_BY_KEY.get(key);
  if (a) return { key, kind: "action", label: a.label, where: a.where, href: a.href, icon: a.icon, module: a.module, action: a.action, hue: a.hue ?? moduleHue(a.home) };
  if (!key.startsWith(SCREEN_PREFIX)) return null;
  const path = key.slice(SCREEN_PREFIX.length);
  const screen = allScreens().find((s) => s.key === path);
  const nav = NAV.find((n) => n.href === path);
  // The module whose menu the screen sits under — the longest root that prefixes it.
  const owner = NAV.filter((n) => n.href !== "/" && (path === n.href || path.startsWith(n.href + "/"))).sort(
    (x, y) => y.href.length - x.href.length,
  )[0];
  const label = screen?.label ?? nav?.label;
  if (!label) return null;
  const mod = screen?.module ?? ((nav ?? owner)?.module as Module | undefined) ?? null;
  return {
    key,
    kind: "screen",
    label,
    where: owner && owner.href !== path ? `${owner.label} ▸ ${label}` : label,
    href: path,
    icon: (nav ?? owner)?.icon ?? Star,
    module: mod,
    action: "view",
    hue: moduleHue((nav ?? owner)?.href ?? ""),
  };
}

/** May this person open what the tile opens? A tile they cannot open is LEFT OUT, never
 *  greyed — the same rule the Quick start tiles followed. Screen-aware (0658). */
export function favoriteAllowed(
  user: Pick<AppUser, "isSuperAdmin" | "permissions" | "moduleMode" | "screenGrants">,
  item: FavoriteItem,
): boolean {
  if (!item.module) return true;
  return hasPermission(user, item.module, item.action, screenOfPath(item.href.split("?")[0]));
}

/** Every key the admin screen and the Edit sheet can offer (actions first, in declared order). */
export function actionKeys(): string[] {
  return FAVORITE_ACTIONS.map((a) => `a:${a.key}`);
}
