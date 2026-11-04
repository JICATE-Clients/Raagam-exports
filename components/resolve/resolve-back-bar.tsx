"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { backTarget } from "@/lib/nav/back-target";
import { confirmDiscard } from "@/lib/reload-guard";

/**
 * ONE BACK ON EVERY HELP & REPAIRS SCREEN (user 2026-11-04: "help and repairs
 * module la ella screen kkum back icon venum"), phone included.
 *
 * Elsewhere the app's Back is `PageHeader`'s derived `BackLink`, hidden on a
 * phone and absent on a module root, a hub, and any screen without a header.
 * This module asked for it everywhere, so its layout draws this bar instead and
 * sets `ModuleDrawsBack`, which stands the derived link down — one Back per
 * screen, never two.
 *
 * Where it goes:
 * - the registry's answer (`backTarget`) when it has one — the sub-module hub;
 * - else the route one level up (`/resolve/kb/<id>` → `/resolve/kb`);
 * - a first-level screen or hub with no answer → the module (`/resolve`);
 * - the module itself → Home.
 *
 * Not drawn where the screen already carries its own Back: a ticket page
 * (`/resolve/tickets/<id>`, its header's ←).
 */
const OWN_BACK = [/^\/resolve\/tickets\//];

function targetFor(path: string): { href: string; label: string } {
  if (path === "/resolve") return { href: "/", label: "Home" };
  const t = backTarget(path);
  if (t) return t;
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 2) return { href: "/" + parts.slice(0, -1).join("/"), label: "the previous screen" };
  return { href: "/resolve", label: "Help & Repairs" };
}

export function ResolveBackBar() {
  const path = usePathname() ?? "/resolve";
  if (OWN_BACK.some((r) => r.test(path))) return null;
  const to = targetFor(path);
  return (
    <div className="-mt-1 mb-1 flex h-7 items-center">
      <Link
        href={to.href}
        aria-label={`Back to ${to.label}`}
        title={`Back to ${to.label}`}
        onClick={(e) => {
          if (!confirmDiscard()) e.preventDefault();
        }}
        className="inline-flex h-7 items-center gap-1 rounded-control pl-0.5 pr-1.5 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </Link>
    </div>
  );
}
