"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Bug,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Eye,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Type,
  UserRound,
} from "lucide-react";
import { signOut } from "@/lib/auth/actions";
import { setCurrentLocation } from "@/lib/auth/location-actions";
import { setRolePreview } from "@/lib/auth/role-simulation-actions";
import type { PreviewableRole } from "@/lib/auth/role-simulation";
import { useAppUser } from "@/lib/auth/permission-context";
import { useLocationState } from "@/lib/auth/location-context";
import { confirmDiscard, useModalGuard } from "@/lib/reload-guard";
import { InstallMenuItem } from "@/components/pwa/install-menu-item";
import { useTheme } from "@/components/shell/theme-provider";
import { useAppearanceItems } from "@/components/shell/appearance-menu";
import type { Theme } from "@/lib/theme";
import { bugPortalUrl, bugReporterConfigured } from "@/lib/bug-reporter";
import { cn } from "@/lib/utils";
import { SEG_IDLE, SEG_ITEM, SEG_LIT, SEG_TRACK } from "@/components/ui/segmented";

/**
 * THE SIDEBAR DOCK (user 2026-10-01, "can use sidebar bottom"; design round 3,
 * unit-first). Everything about WHO the operator is and WHERE they are working
 * — the unit, the account menu, the Super Admin role preview — lives in one
 * card at the foot of the sidebar, so the desktop has no top bar above the tab
 * strip: the Location row and the grey band beneath it were the "orphaned"
 * strip the user reported.
 *
 * UNIT FIRST, deliberately. The unit decides which GST entity's books a
 * document is written into; the operator knows who they are. So the unit's
 * badge and name lead and the person is the initial on the badge's corner.
 *
 * Behaviour is the Topbar's, moved — not re-derived: the unit comes from
 * `useLocationState()` (seeded server-side), a switch and a preview both ask
 * `confirmDiscard()` first because each one refreshes every Server Component,
 * and the role preview still ticks locally and applies once.
 *
 * The phone keeps `Topbar` (it is `md:hidden` now) — the sidebar does not
 * render below md, so neither does this.
 */

/** Badge fills, by the unit's position in the operator's list. A tint per unit
 *  is what lets HO and Unit 1 be told apart at a glance, before the name. */
const UNIT_TINTS = [
  "bg-gradient-to-br from-[#8cc63f] to-[#4f8f12]",
  "bg-gradient-to-br from-[#4aa3df] to-[#1c6ea5]",
  "bg-gradient-to-br from-[#f0a548] to-[#c26a10]",
  "bg-gradient-to-br from-[#a78bfa] to-[#6d4fd1]",
];

function unitTint(index: number): string {
  return index < 0 ? "bg-surface-muted text-muted-foreground" : UNIT_TINTS[index % UNIT_TINTS.length];
}

/** "HO", "U1" — the code, cut to what fits a 32px badge. */
function unitMark(code: string | undefined, name: string | undefined): string {
  const src = (code || name || "?").replace(/[^A-Za-z0-9]/g, "");
  return src.slice(0, 3).toUpperCase() || "?";
}

/** The dock's fixed heights in px. The rail's fixed panel ends this far above
 *  the window's bottom (`--dock-h`, set in `sidebar.tsx`), so they must match
 *  the wrapper's `h-[…]` below. */
export const DOCK_HEIGHT = { full: 68, compact: 60 } as const;

function sameRoleSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((id) => s.has(id));
}

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

const ROW =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none disabled:opacity-60";

export function SidebarDock({
  previewableRoles,
  photoUrl = null,
  compact = false,
}: {
  /** Every role a Super Admin may preview — empty for anyone else. */
  previewableRoles: PreviewableRole[];
  /** The operator's HR staff photo (`getMyStaffPhotoUrl`); the initial when null. */
  photoUrl?: string | null;
  /** Rail-only sidebar (no module menu): the badge alone. */
  compact?: boolean;
}) {
  const user = useAppUser();
  const router = useRouter();
  const { current, allowed, source } = useLocationState();
  const [open, setOpen] = useState(false);
  const [switching, startSwitch] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The role list starts FOLDED (user 2026-10-01: it opened expanded, a dozen
  // rows pushing the account items down). One row says what is in force.
  const [rolesOpen, setRolesOpen] = useState(false);
  // Units fold the same way (user 2026-10-01: "no need to list it, fold it").
  const [unitsOpen, setUnitsOpen] = useState(false);
  // THEME AND APPEARANCE LIVE HERE TOO (user 2026-10-01: "move the theme and
  // appearance to the bottom area"). Settings, not tools — the top row keeps
  // only what is reached for mid-task (search, the bell). Appearance folds
  // like Location: its four groups are ~20 rows.
  const { theme, setTheme } = useTheme();
  const appearance = useAppearanceItems();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // A photo URL that no longer resolves falls back to the initial rather than
  // a broken-image glyph.
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = !!photoUrl && !photoFailed;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // A hand-rolled overlay (scrim + panel), so it declares itself to the
  // auto-reload guard — AGENTS.md "Auto-reload guard".
  useModalGuard(open);

  // Same "tick locally, apply once" contract as the Topbar's MultiSelect —
  // re-synced during render when the server's answer changes.
  const [syncedIds, setSyncedIds] = useState(user.simulatedRoleIds);
  const [pendingPreview, setPendingPreview] = useState(user.simulatedRoleIds);
  if (!sameRoleSet(syncedIds, user.simulatedRoleIds)) {
    setSyncedIds(user.simulatedRoleIds);
    setPendingPreview(user.simulatedRoleIds);
  }
  const previewDirty = !sameRoleSet(pendingPreview, user.simulatedRoleIds);
  const isPreviewing = user.simulatedRoleIds.length > 0;
  const canPreview = user.realIsSuperAdmin && previewableRoles.length > 0;

  // First row takes focus on open, so the keyboard lands inside the menu.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[data-dock-item]")?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[data-dock-item]:not(:disabled)") ?? [],
    );
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  function onSwitchUnit(nextId: string) {
    if (!nextId || nextId === current?.id) return;
    if (!confirmDiscard()) return;
    setError(null);
    startSwitch(async () => {
      const result = await setCurrentLocation(nextId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function onApplyPreview(ids: string[]) {
    if (sameRoleSet(ids, user.simulatedRoleIds)) return;
    if (!confirmDiscard()) return;
    setError(null);
    startPreview(async () => {
      const result = await setRolePreview(ids);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const unitIndex = current ? allowed.findIndex((l) => l.id === current.id) : -1;
  const mark = current ? unitMark(current.code, current.name) : "?";
  const initial = (user.fullName ?? user.email ?? "?").charAt(0).toUpperCase();
  const roleLabel = isPreviewing
    ? user.roleNames.join(", ")
    : user.isSuperAdmin
      ? "Super Admin"
      : user.roleNames.join(", ") || "No roles assigned";
  // The operator did not choose this unit — said out loud, same sentences the
  // Topbar's amber "default" carried.
  const defaultNote =
    source === "fallback"
      ? "You have not chosen a unit, so you are working in the default one. Pick another here if that is not right."
      : source === "default"
        ? "Working in your home unit. Your previous unit was never set, or is no longer available to you."
        : null;

  // THE PERSON LEADS THE PICTURE, THE UNIT TAGS IT (user 2026-10-01: "HO in
  // small size, that photo is large size"). The staff photo is the avatar;
  // the unit is a small tinted tag on its corner — still coloured per unit, so
  // HO and Unit 2 are told apart at a glance. The unit's NAME still leads the
  // text beside it, so which books are open is never just a corner chip.
  const avatar = (size: "md" | "lg") => (
    <span
      className={cn(
        "flex flex-none items-center justify-center overflow-hidden rounded-full font-bold text-white",
        size === "md" ? "h-9 w-9 text-sm" : "h-10 w-10 text-base",
        isPreviewing ? "bg-warning" : "bg-primary",
      )}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL, as photo-upload.tsx draws it.
        <img
          src={photoUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        initial
      )}
    </span>
  );

  const badge = (
    <span className="relative flex-none">
      {avatar("md")}
      <span
        className={cn(
          "absolute -bottom-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-[5px] px-0.5 text-[7.5px] font-bold leading-none text-white ring-2 ring-surface",
          unitTint(unitIndex),
        )}
      >
        {mark}
      </span>
    </span>
  );

  return (
    <div
      className={cn(
        "relative z-40 flex shrink-0 items-center",
        compact ? "h-[60px] justify-center" : "h-[68px] px-2.5",
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${current?.name ?? "No unit"} — ${user.fullName ?? user.email ?? ""}. Unit, role preview and account menu.`}
        title={compact ? `${current?.name ?? "No unit"}${defaultNote ? " (default)" : ""}` : undefined}
        onClick={() => setOpen((o) => !o)}
        // The surface-style hook (`lib/appearance.ts` STYLES): Glass frosts it.
        data-dock-card={compact ? undefined : ""}
        className={cn(
          "flex items-center gap-2.5 rounded-xl text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          compact
            ? "p-1 hover:bg-surface"
            : "w-full bg-surface p-2 shadow-[0_0_0_1px_var(--border),0_6px_16px_-10px_rgb(16_30_20/0.25)] hover:shadow-[0_0_0_1px_var(--border),0_8px_20px_-10px_rgb(16_30_20/0.35)]",
          !compact && isPreviewing && "bg-warning/10 shadow-[0_0_0_1px_color-mix(in_srgb,var(--warning)_40%,transparent)]",
          !compact && !current && "shadow-[0_0_0_1px_color-mix(in_srgb,var(--danger)_45%,transparent)]",
          open && "ring-2 ring-primary",
        )}
      >
        {badge}
        {!compact && (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                {isPreviewing ? (
                  <span className="truncate text-warning">Previewing: {roleLabel}</span>
                ) : current ? (
                  <span className="truncate">{current.name}</span>
                ) : (
                  <span className="truncate text-danger">
                    {allowed.length === 0 ? "No unit assigned" : "Select a unit"}
                  </span>
                )}
                {!isPreviewing && defaultNote && (
                  <span
                    title={defaultNote}
                    className="flex-none rounded bg-warning/15 px-1.5 text-[9.5px] font-bold uppercase leading-[15px] tracking-wide text-warning"
                  >
                    Default
                  </span>
                )}
              </span>
              <span className="truncate text-[11.5px] text-muted-foreground">
                {isPreviewing
                  ? `${current?.name ?? "No unit"} · exit from this menu`
                  : `${user.fullName ?? user.email} · ${roleLabel}`}
              </span>
            </span>
            <ChevronsUpDown className="h-4 w-4 flex-none text-muted-foreground" />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Unit and account"
            onKeyDown={onMenuKey}
            className={cn(
              "absolute bottom-full z-50 mb-2 max-h-[calc(100dvh-5rem)] w-72 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-[0_18px_48px_-14px_rgb(16_30_20/0.4)]",
              compact ? "left-2" : "left-2.5",
            )}
          >
            <div className="flex items-center gap-2.5 px-2.5 pb-2 pt-1.5">
              {avatar("lg")}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold">{user.fullName ?? "—"}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email ?? user.phone}</span>
              </span>
            </div>

            <div className="my-1 border-t border-border" />
            <button
              type="button"
              data-dock-item
              aria-expanded={unitsOpen}
              onClick={() => setUnitsOpen((o) => !o)}
              className={ROW}
            >
              <span
                className={cn(
                  "flex h-5 min-w-5 flex-none items-center justify-center rounded-[5px] px-0.5 text-[8.5px] font-bold text-white",
                  unitTint(unitIndex),
                )}
              >
                {mark}
              </span>
              <span className="flex-1">Location</span>
              <span
                className={cn(
                  "max-w-[8rem] truncate text-xs",
                  current ? "text-muted-foreground" : "text-danger",
                )}
              >
                {current?.name ?? (allowed.length === 0 ? "None assigned" : "Select a unit")}
              </span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 flex-none text-muted-foreground transition-transform",
                  unitsOpen && "rotate-90",
                )}
              />
            </button>
            {unitsOpen && (
            <div className="ml-4 border-l border-border pl-1">
            {allowed.length === 0 && (
              <p className="px-2.5 py-1.5 text-sm text-danger">No unit assigned. Ask an admin to give you access to one.</p>
            )}
            {allowed.map((l, i) => {
              const on = l.id === current?.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  data-dock-item
                  disabled={switching}
                  onClick={() => (on ? setOpen(false) : onSwitchUnit(l.id))}
                  className={cn(ROW, on && "bg-surface-muted")}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 flex-none items-center justify-center rounded-md text-[10px] font-bold text-white",
                      unitTint(i),
                    )}
                  >
                    {unitMark(l.code, l.name)}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate">{l.name}</span>
                    {on && defaultNote && (
                      <span className="block text-[11px] text-warning">
                        {source === "fallback" ? "House default" : "Your home unit"}
                      </span>
                    )}
                  </span>
                  {on && <Check className="h-4 w-4 flex-none text-primary" />}
                </button>
              );
            })}
            </div>
            )}

            {canPreview && (
              <>
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  data-dock-item
                  aria-expanded={rolesOpen}
                  onClick={() => setRolesOpen((o) => !o)}
                  className={ROW}
                >
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">Preview as role</span>
                  <span className="max-w-[7.5rem] truncate text-xs text-muted-foreground">
                    {isPreviewing ? roleLabel : "None"}
                  </span>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 flex-none text-muted-foreground transition-transform",
                      rolesOpen && "rotate-90",
                    )}
                  />
                </button>
                {/* A multi-pick (an operator can hold several roles), ticked
                    locally and applied ONCE — each apply refreshes the tree. */}
                {rolesOpen && (
                <div className="ml-4 max-h-48 overflow-y-auto border-l border-border pl-1">
                  {previewableRoles.map((r) => {
                    const ticked = pendingPreview.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={ticked}
                        data-dock-item
                        disabled={previewing}
                        onClick={() =>
                          setPendingPreview((p) =>
                            ticked ? p.filter((id) => id !== r.id) : [...p, r.id],
                          )
                        }
                        className={ROW}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 flex-none items-center justify-center rounded border",
                            ticked ? "border-primary bg-primary text-white" : "border-border",
                          )}
                        >
                          {ticked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="truncate">{r.name}</span>
                      </button>
                    );
                  })}
                </div>
                )}
                {(previewDirty || isPreviewing) && (
                  <div className="flex gap-1.5 px-1.5 pb-1 pt-1.5">
                    {previewDirty && (
                      <button
                        type="button"
                        data-dock-item
                        disabled={previewing}
                        onClick={() => onApplyPreview(pendingPreview)}
                        className="h-8 flex-1 rounded-md bg-primary text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                      >
                        Apply preview
                      </button>
                    )}
                    {isPreviewing && (
                      <button
                        type="button"
                        data-dock-item
                        disabled={previewing}
                        onClick={() => onApplyPreview([])}
                        className="h-8 flex-1 rounded-md border border-warning/50 bg-warning/10 text-xs font-semibold text-warning hover:bg-warning/15 disabled:opacity-60"
                      >
                        Exit preview
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {error && (
              <p role="alert" className="px-2.5 py-1.5 text-xs text-danger">
                {error}
              </p>
            )}

            <div className="my-1 border-t border-border" />
            <div className="flex items-center gap-2.5 px-2.5 py-1">
              <Sun className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-sm">Theme</span>
              {/* The one-shape rule (user 2026-10-06): the SEG_* strings rather than
                  `ToggleGroup`, because each item must carry `data-dock-item`
                  for the dock's own arrow-key walk. */}
              <div role="radiogroup" aria-label="Theme" data-segmented="" className={SEG_TRACK}>
                {THEMES.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={theme === id}
                    aria-label={label}
                    title={label}
                    data-dock-item
                    onClick={() => setTheme(id)}
                    className={cn(SEG_ITEM, "justify-center px-2", theme === id ? SEG_LIT : SEG_IDLE)}
                  >
                    <Icon aria-hidden />
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              data-dock-item
              aria-expanded={appearanceOpen}
              title={appearance.summary}
              onClick={() => setAppearanceOpen((o) => !o)}
              className={ROW}
            >
              <Type className={cn("h-4 w-4", appearance.compact ? "text-primary" : "text-muted-foreground")} />
              <span className="flex-1">Appearance</span>
              <span className="max-w-[8rem] truncate text-xs text-muted-foreground">
                {appearance.styleLabel}
              </span>
              <ChevronRight
                className={cn(
                  "h-4 w-4 flex-none text-muted-foreground transition-transform",
                  appearanceOpen && "rotate-90",
                )}
              />
            </button>
            {appearanceOpen && (
              <div className="ml-4 max-h-64 overflow-y-auto border-l border-border pl-1">
                {appearance.items.map((item, i) => {
                  const heading = item.section && item.section !== appearance.items[i - 1]?.section;
                  return (
                    <div key={`${item.section}-${item.label}`}>
                      {heading && (
                        <p className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {item.section}
                        </p>
                      )}
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={!!item.checked}
                        data-dock-item
                        onClick={item.onClick}
                        className={cn(ROW, "py-1")}
                      >
                        {item.swatch ? (
                          <span
                            className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-border"
                            style={{ background: item.swatch }}
                          />
                        ) : (
                          <span className="w-3.5 flex-none" />
                        )}
                        <span className="flex-1 truncate" style={item.labelStyle}>
                          {item.label}
                        </span>
                        {item.checked && <Check className="h-4 w-4 flex-none text-primary" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="my-1 border-t border-border" />
            <button
              type="button"
              data-dock-item
              onClick={() => {
                setOpen(false);
                router.push("/my-profile");
              }}
              className={ROW}
            >
              <UserRound className="h-4 w-4 text-muted-foreground" /> My Profile
            </button>
            {/* Gated exactly as the Topbar's row: the portal is keyed on the
                email, and offering it for an unconfigured reporter is a 404. */}
            {bugReporterConfigured && user.email && (
              <a
                href={bugPortalUrl(user.email)}
                target="_blank"
                rel="noopener noreferrer"
                data-dock-item
                onClick={() => setOpen(false)}
                className={ROW}
              >
                <Bug className="h-4 w-4 text-muted-foreground" /> My bug reports
              </a>
            )}
            <InstallMenuItem onDone={() => setOpen(false)} />
            <form action={signOut}>
              <button type="submit" data-dock-item className={cn(ROW, "text-danger")}>
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
