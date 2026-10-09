import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/**
 * SAMPLE GROUPING WEARS THE RAAGAM SKIN, like Sample Entry, Costing and Orders — the
 * green field boxes, the light-blue primary and the rail chrome come from
 * `[data-skin="raagam"]`, not from the screen (precedent §0). A provider, not
 * a bare `<div data-skin>`, because a Sheet portals out of the wrapper.
 */
export default function SampleGroupingSkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
