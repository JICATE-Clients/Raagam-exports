import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/**
 * Sample ▸ Plan Approval wears the Raagam skin like every other Sample screen.
 *
 * It copies Budget Approval (Orders, skinned by `app/(app)/orders/layout.tsx`)
 * line for line, and was the one Sample approval screen drawn without the skin
 * (Sample UI plan, 2026-10-15).
 */
export default function PlanApprovalSkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
