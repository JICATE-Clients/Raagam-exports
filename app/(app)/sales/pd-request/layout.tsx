import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/** PD Request wears the Raagam skin like every other Sample screen. */
export default function PdRequestSkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
