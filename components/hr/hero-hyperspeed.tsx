"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/**
 * The light-trail road behind the HR dashboard's header banner (client
 * 2026-10-28). `three` is ~600 KB, so the scene is loaded in the browser only
 * (`ssr: false`) and only on the page that renders this — no other screen pays
 * for it, and the banner's own gradient shows until (or if never) it arrives.
 *
 * Colours are tuned for the indigo → violet → fuchsia banner: magenta/violet
 * trails one way, cyan/white the other, cyan poles, a near-invisible road.
 * Hold the mouse on an empty part of the banner to boost; links and buttons
 * in the banner sit above it and keep working.
 */
/** The props this banner passes. Stated here because the component is plain
 *  JavaScript: TypeScript reads its `= undefined` defaults as "always
 *  undefined" and would refuse every colour list. */
type HyperspeedProps = {
  curve?: "straight" | "gentle" | "winding" | "hills" | "racing" | "deep";
  curvature?: number;
  speed?: number;
  boost?: number;
  fov?: number;
  boostFov?: number;
  lanes?: number;
  roadWidth?: number;
  medianWidth?: number;
  density?: number;
  trailLength?: number;
  lightSize?: number;
  poles?: number;
  poleHeight?: number;
  dust?: number;
  glow?: number;
  reflections?: number;
  roadOpacity?: number;
  steer?: number;
  tailColors?: string[];
  headColors?: string[];
  poleColors?: string[];
  interactive?: boolean;
  className?: string;
};

const Hyperspeed = dynamic(() => import("./hyperspeed"), { ssr: false }) as unknown as ComponentType<HyperspeedProps>;

export function HeroHyperspeed() {
  return (
    <Hyperspeed
      /*
       * TUNED FOR A WIDE, SHORT BANNER (client 2026-10-28: "spread the whole
       * card from start to end"). The defaults — a 10-wide road, 3 lanes, a
       * 90° view — are made for a tall box; in a ~7:1 banner the road shrank
       * to a point in the middle. So: a 3× wider road with more lanes, a
       * narrower (zoomed-in) view so it fills the height, a gentle curve that
       * sweeps across instead of twisting into the centre, and enough traffic
       * and streaks that both ends of the banner have light in them.
       */
      curve="gentle"
      curvature={0.7}
      speed={0.9}
      boost={3}
      fov={62}
      boostFov={95}
      lanes={6}
      roadWidth={32}
      medianWidth={6}
      density={120}
      trailLength={1.2}
      lightSize={1.6}
      poles={30}
      poleHeight={1.4}
      dust={500}
      glow={0.75}
      reflections={0.5}
      roadOpacity={0.06}
      steer={0.3}
      tailColors={["#f0abfc", "#d946ef", "#a855f7"]}
      headColors={["#67e8f9", "#ffffff", "#38bdf8"]}
      poleColors={["#a5f3fc"]}
      interactive
      className="-z-10"
    />
  );
}
