"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { House, Plus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { favoriteWellStyle, resolveFavorite } from "@/lib/favorites/registry";
import { saveMyFavorites } from "@/lib/favorites/actions";
import type { MyFavorite } from "@/lib/favorites/service";
import { FavoriteListEditor, type EditRow } from "./favorite-list-editor";
import { moduleHue } from "@/components/navigation/module-hue";
import { cn } from "@/lib/utils";

/**
 * FAVOURITES ON HOME (0812, user 2026-11-05, mock-up https://claude.ai/artifact/SMQnEeCU1GonRHYCHcVvLd).
 * One tap opens the form itself — the client's ask was "no menu diving" for the everyday
 * entries (Leave, Trip, Help & Repair; Raise PO, Stock Transfer, Dispatch).
 *
 * Same list on the phone and the desktop; only the grid differs. The last tile is always
 * "+ Add", which opens the Edit sheet — so arranging the bar is reachable from the bar.
 *
 * A TILE IS WIDE ONLY WHEN IT HAS SOMETHING TO SAY: the first tile spans two columns when it
 * carries a live count ("5 waiting"), never for decoration (raagam-visuals-carry-meaning).
 */

/** An action that opens a form through `?new=1` also asks to come BACK here once the form
 *  closes (`useCreateIntent`'s `back`), so Save or Cancel returns the person to Home. */
function tileHref(href: string): string {
  return href.includes("new=1") ? `${href}&back=/` : href;
}

/** THE PHONE'S WAY BACK TO HOME (user 2026-11-13, screenshot 4141: "add home page also in
 *  favourites, may need, user will click it"). On a phone the first page is Favourites, so the
 *  old Home — order book, Your day, At a glance, This week, Insights — opens from this tile
 *  (`/?view=home`, PhoneFullHome). Always first and not in Edit: it is the page's own door,
 *  not a pick. Phone only — the desktop rail already has Home. */
const PHONE_HOME_HREF = "/?view=home";

export function FavoritesBar({ items, variant }: { items: MyFavorite[]; variant: "phone" | "desktop" }) {
  const [editing, setEditing] = useState(false);
  const shown = items.filter((f) => !f.hidden && resolveFavorite(f.key));

  const phone = variant === "phone";
  return (
    <section aria-label="Favourites" className={cn(!phone && "rounded-2xl border border-border bg-surface p-3")}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className={cn("font-bold text-heading", phone ? "text-[15px]" : "text-sm")}>Favourites</h2>
        <button type="button" onClick={() => setEditing(true)} className="px-1 py-0.5 text-[13px] font-semibold text-primary">
          Edit
        </button>
      </div>
      <ul className={cn("grid gap-2", phone ? "grid-cols-4" : "grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]")}>
        {phone && (
          <li>
            <Link
              href={PHONE_HOME_HREF}
              aria-label="Home"
              className="flex h-full min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-border bg-surface px-1 pb-2.5 pt-3 text-center [-webkit-tap-highlight-color:transparent] hover:border-primary/40 active:scale-[0.97]"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-[13px]" style={favoriteWellStyle(moduleHue("/"))}>
                <House className="size-[22px]" strokeWidth={2.1} aria-hidden />
              </span>
              <span className="line-clamp-2 text-[11.5px] font-semibold leading-tight">Home</span>
            </Link>
          </li>
        )}
        {shown.map((f, i) => {
          const item = resolveFavorite(f.key)!;
          const Icon = item.icon;
          const wide = i === 0 && !!f.badge;
          return (
            <li key={f.key} className={cn(wide && "col-span-2")}>
              <Link
                href={tileHref(item.href)}
                aria-label={f.badge ? `${item.label}, ${f.badge}` : item.label}
                className={cn(
                  "relative flex h-full rounded-2xl border-[1.5px] border-border bg-surface text-center [-webkit-tap-highlight-color:transparent] hover:border-primary/40 active:scale-[0.97]",
                  wide
                    ? "flex-row items-center gap-2.5 px-3 py-2.5 text-left"
                    : cn("flex-col items-center justify-center gap-1.5 px-1 pb-2.5 pt-3", phone ? "min-h-[84px]" : "min-h-[92px]"),
                )}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-[13px]" style={favoriteWellStyle(item.hue)}>
                  <Icon className="size-[22px]" strokeWidth={2.1} aria-hidden />
                </span>
                {/* A NARROW TILE STILL SAYS ITS COUNT (user 2026-11-13, artifact "Favourites With
                    Pulse"): the number alone, in a corner pill — Pulse's unread, Approvals' waiting.
                    The whole sentence stays in the link's aria-label. */}
                {!wide && f.badge && (
                  <span aria-hidden className="absolute right-2 top-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-surface bg-danger px-1 text-[11px] font-extrabold tabular-nums leading-none text-white">
                    {f.badge.split(" ")[0]}
                  </span>
                )}
                {/* truncate-reveal: exempt -- screen names, two lines allowed; the whole name is the link's aria-label */}
                <span className={cn("font-semibold leading-tight", wide ? "text-[13px]" : "line-clamp-2 text-[11.5px]")}>
                  {item.label}
                  {wide && (
                    <span className="mt-1 block w-fit rounded-full bg-warning-soft px-1.5 py-px text-[11px] font-bold text-warning">
                      {f.badge}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Add or arrange favourites"
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-dashed border-border bg-surface px-1 pb-2.5 pt-3 text-muted-foreground active:scale-[0.97]",
              phone ? "min-h-[84px]" : "min-h-[92px]",
            )}
          >
            <span className="grid size-11 place-items-center rounded-[13px] bg-surface-muted">
              <Plus className="size-5" aria-hidden />
            </span>
            <span className="text-[11.5px] font-semibold">Add</span>
          </button>
        </li>
      </ul>
      {editing && <EditFavoritesSheet items={items} onClose={() => setEditing(false)} />}
    </section>
  );
}

/** Mounted only while open, so it starts from the server's list every time it opens. */
export function EditFavoritesSheet({ items, onClose }: { items: MyFavorite[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<EditRow[]>(() =>
    items.filter((f) => resolveFavorite(f.key)).map((f) => ({ key: f.key, source: f.source, hidden: f.hidden })),
  );
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedGuard(dirty || pending);

  function save() {
    start(async () => {
      // A pin that was unticked is simply not kept; a default unticked is stored as hidden.
      const list = rows.filter((r) => !(r.source === "mine" && r.hidden)).map((r) => ({ key: r.key, hidden: r.hidden }));
      const res = await saveMyFavorites(list);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDirty(false);
      toast.success("Favourites saved.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit Favourites"
      size="sm"
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={pending || !dirty} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <FavoriteListEditor
        idPrefix="fav-edit"
        mode="person"
        rows={rows}
        onChange={(next) => {
          setRows(next);
          setDirty(true);
        }}
      />
    </Sheet>
  );
}
