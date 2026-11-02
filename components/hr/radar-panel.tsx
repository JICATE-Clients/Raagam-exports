"use client";

import { useSyncExternalStore } from "react";
import Radar from "./radar";

/**
 * The radar at the top of the HR dashboard's Devices panel (client
 * 2026-10-28). It says two true things, not just decoration:
 *
 * - COLOUR is device health — green when every device is online, rose when
 *   any is not.
 * - BLIPS are activity — one contact per punch in the last 15 minutes (the
 *   component caps them at 16). A busy gate looks busy; a quiet one sweeps
 *   empty.
 *
 * Light theme draws it as ink (`lightMode`); dark theme as light. The app's
 * theme is the `.dark` class on <html> (see globals.css), read here through a
 * MutationObserver so a theme switch redraws it without a reload.
 */

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

export function RadarPanel({ healthy, blips }: { healthy: boolean; blips: number }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const color = healthy ? (dark ? "#34d399" : "#059669") : dark ? "#fb7185" : "#e11d48";

  return (
    <div className="relative h-52 border-b border-emerald-100 dark:border-emerald-500/20">
      <Radar
        key={dark ? "dark" : "light"}
        color={color}
        lightMode={!dark}
        mode="sweep"
        speed={0.8}
        trail={0.4}
        scale={0.86}
        ringCount={5}
        spokeCount={12}
        targets={Math.min(16, blips)}
        clutter={0.25}
        glow={dark ? 1 : 0.6}
        fade={0.15}
        mouseInteraction
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <span
          className={
            healthy
              ? "rounded-full bg-white/85 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-200 backdrop-blur dark:bg-slate-900/80 dark:text-emerald-300 dark:ring-emerald-500/30"
              : "rounded-full bg-white/85 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 shadow-sm ring-1 ring-rose-200 backdrop-blur dark:bg-slate-900/80 dark:text-rose-300 dark:ring-rose-500/30"
          }
        >
          {healthy ? "All devices online" : "Device offline"} · {blips} punch{blips === 1 ? "" : "es"} in 15 min
        </span>
      </div>
    </div>
  );
}
