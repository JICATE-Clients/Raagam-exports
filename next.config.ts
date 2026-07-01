import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOTE: cacheComponents (PPR) is intentionally OFF for now. The Raagam ERP is
  // almost entirely per-user, per-role dynamic data behind auth, so the strict
  // Suspense discipline PPR requires adds friction without payoff at this stage.
  // Revisit for read-heavy public/reporting surfaces later. (see ASSUMPTIONS.md)

  images: {
    remotePatterns: [
      // Supabase Storage (style images, attachments)
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
