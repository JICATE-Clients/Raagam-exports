"use client";

import { useState } from "react";
import Link from "next/link";
import { favoriteWellStyle, resolveFavorite } from "@/lib/favorites/registry";
import type { MyFavorite } from "@/lib/favorites/service";
import { EditFavoritesSheet } from "./favorites-bar";

/**
 * FAVOURITES IN PULSE'S SIDEBAR (user 2026-11-13, artifact "Pulse Sidebar Favourites",
 * option A: "apply a"). The person's own Home Favourites — the same list, read by the same
 * `getMyFavorites`, edited by the same sheet — drawn as a compact strip of five across the
 * top of the chat list, so Leave, Help & Repair, Trip, Approvals and Pulse are one tap away
 * without leaving Pulse.
 *
 * No "+ Add" tile here (the mock-up gave its slot to Pulse): the strip's Edit link opens the
 * same sheet Home's "+ Add" does. A count is the number alone in a corner pill, as on Home's
 * narrow tiles; the full sentence stays in the link's aria-label.
 */
export function PulseFavorites({ items }: { items: MyFavorite[] }) {
  const [editing, setEditing] = useState(false);
  const shown = items.filter((f) => !f.hidden && resolveFavorite(f.key));

  return (
    <section aria-labelledby="pulse-sec-favourites" className="mx-1 mb-1.5 rounded-xl border border-border bg-surface-muted/40 p-2">
      <div className="mb-1.5 flex items-baseline justify-between px-0.5">
        <h2 id="pulse-sec-favourites" className="text-xs font-bold text-heading">
          Favourites
        </h2>
        <button type="button" onClick={() => setEditing(true)} className="px-1 text-xs font-semibold text-primary">
          Edit
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="px-0.5 text-xs text-muted-foreground">No favourites yet. Use Edit to add some.</p>
      ) : (
        <ul className="grid grid-cols-5 gap-1">
          {shown.map((f) => {
            const item = resolveFavorite(f.key)!;
            const Icon = item.icon;
            return (
              <li key={f.key}>
                <Link
                  href={item.href}
                  aria-label={f.badge ? `${item.label}, ${f.badge}` : item.label}
                  className="relative flex flex-col items-center gap-1 rounded-lg px-0.5 py-1 text-center hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[11px]" style={favoriteWellStyle(item.hue)}>
                    <Icon className="size-[18px]" strokeWidth={2.1} aria-hidden />
                  </span>
                  {f.badge && (
                    <span aria-hidden className="absolute right-0 top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-surface bg-danger px-1 text-[10px] font-extrabold tabular-nums leading-none text-white">
                      {f.badge.split(" ")[0]}
                    </span>
                  )}
                  {/* truncate-reveal: exempt -- screen names, two lines allowed; the whole name is the link's aria-label */}
                  <span className="line-clamp-2 text-[10.5px] font-semibold leading-tight text-foreground">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <EditFavoritesSheet items={items} onClose={() => setEditing(false)} />}
    </section>
  );
}
