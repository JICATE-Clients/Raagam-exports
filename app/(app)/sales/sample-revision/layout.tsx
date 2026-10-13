import type { ReactNode } from "react";

import { SkinProvider } from "@/components/ui/skin";

/** Sample Revision wears the Raagam skin like every other Sample screen. */
export default function SampleRevisionSkinLayout({ children }: { children: ReactNode }) {
  return <SkinProvider skin="raagam">{children}</SkinProvider>;
}
