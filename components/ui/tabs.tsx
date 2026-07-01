"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  key: string;
  label: string;
  content: ReactNode;
}

export function Tabs({
  items,
  defaultKey,
}: {
  items: TabItem[];
  defaultKey?: string;
}) {
  const [active, setActive] = useState(defaultKey ?? items[0]?.key);
  const current = items.find((i) => i.key === active) ?? items[0];

  return (
    <div>
      <div className="flex gap-1 border-b border-border">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setActive(item.key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active === item.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="pt-4">{current?.content}</div>
    </div>
  );
}
