"use client";

/**
 * The open-tabs strip — the "Cardiology Nav" reference design ported to real
 * tokens: a bar rounded on the bottom edge only (flush with `Topbar` above
 * it), a close button ringed in brand green, the current tab's title on its
 * own small rounded chip sitting on the bar, and the OTHER open tabs in a
 * rounded pill track — active reads by the title chip itself, not by a
 * coloured pill, per the approved mockup
 * (claude.ai/code/artifact/82cd10a6-8edf-4b6c-8fe1-57e9cfbb741d).
 *
 * THE TITLE CHIP IS A PLAIN ROUNDED RECTANGLE, NOT THE MOCKUP'S SVG-CURVE
 * "FLAG". The mockup's mirrored-curve connector (an S-shaped taper drawn at
 * a much taller scale) does not scale down cleanly — at this bar's real
 * height it rendered as a chunky, disconnected-looking blob rather than a
 * smooth taper. A plain `rounded-xl` chip is the more robust shape at this
 * size and reads just as clearly as "the active tab, sitting on the bar".
 *
 * See lib/workspace-tabs.ts for what this does and does not do — in
 * particular, switching tabs navigates; it does not keep screens mounted.
 */

import { usePathname } from "next/navigation";
import { Plus, X } from "lucide-react";
import { useEnsureWorkspaceTab, useOpenWorkspaceTab, useWorkspaceTabs } from "@/lib/workspace-tabs";
import { NAV } from "@/components/shell/nav";
import { useAppUser } from "@/lib/auth/permission-context";
import { hasPermission } from "@/lib/auth/types";

/** Last-resort title for a route NAV doesn't know about (a dynamic `[id]`
 *  detail page, say) — never the first choice, because a slug reads nothing
 *  like the sidebar's actual label ("Order Management" vs "Setup"). */
function titleFromSlug(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean).pop() ?? "Home";
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The label Sidebar would show for this exact route, if NAV knows it —
 *  same registry, so the tab bar can never disagree with the sidebar about
 *  what a screen is called. */
function titleForPath(pathname: string): string {
  for (const item of NAV) {
    if (item.href === pathname) return item.label;
    for (const child of item.children ?? []) {
      if (child.href === pathname) return child.label;
    }
  }
  return titleFromSlug(pathname);
}

/** Same prefix-match `Sidebar` uses for "is this route inside this module". */
function isUnderModule(pathname: string, moduleHref: string): boolean {
  if (moduleHref === "/") return pathname === "/";
  return pathname === moduleHref || pathname.startsWith(moduleHref + "/");
}

export function WorkspaceTabsBar() {
  const pathname = usePathname();
  const user = useAppUser();
  const openTab = useOpenWorkspaceTab();

  // Always keep the CURRENT route present as a tab, so the bar has something
  // to show before any screen has wired itself in. `useEnsureWorkspaceTab`
  // never overwrites a title a caller already set (the sidebar's click, or a
  // screen's own useRegisterWorkspaceTab) — only fills one in when creating
  // the tab fresh.
  useEnsureWorkspaceTab({ href: pathname, title: titleForPath(pathname) });

  const { tabs, activeId, activate, close } = useWorkspaceTabs();

  if (tabs.length === 0) return null;

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const others = tabs.filter((t) => t.id !== active.id);

  // ONLY the active tab's own module's children — the same list Sidebar
  // expands under that module, not every sub-module in the app. Mirrors
  // clicking around in the sidebar without leaving the tab bar.
  const activeModule = NAV.find(
    (item) => hasPermission(user, item.module, "view") && isUnderModule(active.href, item.href),
  );
  const siblingLinks = (activeModule?.children ?? []).filter((c) => c.href !== active.href);

  return (
    <div className="relative mx-3 pb-1 md:mx-4">
      {/* Brand gradient replaces the neutral --shell-tabbar chrome, per
          request — green to blue, left to right. Nothing sits directly on
          the bar itself (the ring, flag and pill track are all separate
          light/neutral elements), so this reads as one coloured accent
          rather than the tinted CONTENT surfaces the client has rejected
          elsewhere (raagam-brand-colours). */}
      <div className="relative flex h-12 items-start gap-4 rounded-b-[20px] bg-gradient-to-r from-brand-green to-brand-blue pl-2 pr-4 pt-2 shadow-[0_4px_12px_-5px_rgb(0_0_0/0.35)]">
        {/* close (the active tab) — RINGED IN BRAND GREEN, matching this
            file's own header comment: the ring was `bg-surface` (a plain
            white halo) and never actually carried the brand colour the
            design called for. Green here is safe raw — nothing sits ON the
            ring itself, it is a decorative halo behind the inner button,
            so the 2.16:1 contrast that keeps green off `--primary` (see
            raagam-brand-colours) does not apply to it. The inner circle
            keeps its dark fill + white icon for the same reason every
            other icon button in the app does: that pairing is what stays
            legible, not the ring color. */}
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-green">
          <button
            type="button"
            onClick={() => close(active.id)}
            aria-label="Close current tab"
            title="Close current tab"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-surface hover:opacity-90"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* the active tab's own title chip */}
        <div className="ml-0.5 flex max-w-[44%] flex-none items-center self-center rounded-xl bg-surface px-4 py-2 shadow-sm">
          <span className="whitespace-nowrap text-[15px] font-bold leading-none tracking-tight text-foreground">
            {active.title}
          </span>
          {active.dirty && (
            <span
              aria-label="Unsaved changes"
              className="ml-2 inline-block h-1.5 w-1.5 flex-none rounded-full bg-warning"
            />
          )}
        </div>

        {/* the OTHER open tabs */}
        <div className="relative ml-auto min-w-0 flex-1">
          <div className="flex w-full items-center gap-1 overflow-x-auto rounded-2xl bg-surface-muted p-1">
            {siblingLinks.map((link) => (
              <button
                key={link.href}
                type="button"
                onClick={() => openTab({ href: link.href, title: link.label })}
                className="flex flex-none items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-surface hover:text-foreground"
              >
                {link.label}
              </button>
            ))}
            {siblingLinks.length > 0 && others.length > 0 && (
              <span aria-hidden="true" className="mx-1 h-5 w-px flex-none bg-border-strong" />
            )}
            {others.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => activate(tab.id)}
                className="group flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full py-1.5 pl-3 pr-1.5 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <span>{tab.title}</span>
                {tab.dirty && (
                  <span
                    aria-label="Unsaved changes"
                    className="h-1.5 w-1.5 flex-none rounded-full bg-warning"
                  />
                )}
                <span
                  role="button"
                  aria-label={`Close ${tab.title}`}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    close(tab.id);
                  }}
                  className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full opacity-60 group-hover:opacity-100 hover:bg-foreground/10"
                >
                  <X className="h-2 w-2" />
                </span>
              </button>
            ))}
            <button
              type="button"
              aria-label="Open another screen"
              title="Open another screen"
              className="ml-1 flex h-7 w-7 flex-none items-center justify-center rounded-full border border-dashed border-border-strong text-muted-foreground hover:border-primary hover:bg-surface hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
