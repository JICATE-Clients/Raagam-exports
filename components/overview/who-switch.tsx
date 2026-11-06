"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ToggleGroup } from "@/components/ui/segmented";

export type Who = "mine" | "everyone";

/**
 * MINE · EVERYONE (overview plan, rule 2: "my work first"). One word in the URL (`?who=`),
 * so a page can be linked as either. The counts sit after each word, so the switch itself
 * says how much is the operator's before they press it.
 */
export function WhoSwitch({ value, mine, everyone }: { value: Who; mine: number; everyone: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <ToggleGroup<Who>
      label="Whose work"
      value={value}
      options={[
        { value: "mine", label: "Mine", count: mine },
        { value: "everyone", label: "Everyone", count: everyone },
      ]}
      onChange={(next) => {
        const q = new URLSearchParams(params.toString());
        q.set("who", next);
        router.push(`${pathname}?${q.toString()}`);
      }}
    />
  );
}

/**
 * THE PAGE KEEPS ITSELF FRESH (rule 12: "as of 10:42 · refreshes itself"). A soft
 * `router.refresh()` every five minutes while the tab is visible — it re-reads the server
 * figures without reloading the page. An overview holds no typed work, so there is nothing
 * for a refresh to lose, and a hidden tab is not refreshed at all.
 */
export function AutoRefresh({ everyMs = 5 * 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(t);
  }, [router, everyMs]);
  return null;
}
