import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/**
 * Sample ▸ Fabric Plan wears the Raagam skin like every other Sample screen.
 *
 * It renders the SAME `IwoFabricBomScreen` as Orders ▸ IWO Fabric Plan, which
 * gets the skin from `app/(app)/orders/layout.tsx`. Under /sales there was no
 * provider, so one screen file drew two looks depending on the route
 * (Sample UI plan, 2026-10-15).
 */
export default function SampleFabricPlanSkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
