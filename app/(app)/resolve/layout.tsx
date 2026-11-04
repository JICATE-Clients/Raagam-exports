"use client";

import type { ReactNode } from "react";
import { ModuleDrawsBack } from "@/components/ui/back-link";
import { ResolveBackBar } from "@/components/resolve/resolve-back-bar";

/**
 * HELP & REPAIRS DRAWS ITS OWN BACK, on every screen and every width (user
 * 2026-11-04). The bar sits above each page; `ModuleDrawsBack` stops a
 * `PageHeader` inside from adding its derived Back beside it.
 *
 * A FRAGMENT, NOT A WRAPPER BOX: `<main>` (app/(app)/layout.tsx) is a flex
 * column whose children fill its width, and the Inbox measures its own height
 * against the viewport — a wrapping <div> here would change both.
 */
export default function ResolveLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleDrawsBack.Provider value={true}>
      <ResolveBackBar />
      {children}
    </ModuleDrawsBack.Provider>
  );
}
