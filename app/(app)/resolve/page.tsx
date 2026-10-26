import { ModuleHub } from "@/components/shell/module-hub";

// Resolve Hub landing page — one card per sub-module, from
// lib/nav/module-groups.ts (the same registry the sidebar reads).
export default function ResolvePage() {
  return <ModuleHub moduleHref="/resolve" />;
}
