/**
 * Flat people illustrations for the HR dashboard (client 2026-10-28: "can we
 * add human like figures here and there"). Hand-drawn SVG, no image files —
 * crisp at any size, no network request, and coloured by props so each figure
 * matches the panel it stands in. Purely decorative: every one is aria-hidden.
 *
 * One `Figure` builds every person from the same parts (head, hair, torso,
 * arms, legs, shoes) so they read as one cast; a scene composes a few.
 */

type Pose = "stand" | "wave" | "cheer" | "walk" | "laptop";
type Hat = "cap" | "helmet" | null;
type HairStyle = "short" | "long" | "bun";

const SKIN = ["#f2c7a5", "#d9a07a", "#b9794f", "#8d5a3b"] as const;

function Figure({
  x = 0,
  y = 0,
  s = 1,
  skin = SKIN[1],
  hair = "#2b2118",
  hairStyle = "short",
  shirt = "#6366f1",
  pants = "#1e293b",
  pose = "stand",
  hat = null,
  tie,
  flip = false,
}: {
  x?: number;
  y?: number;
  s?: number;
  skin?: string;
  hair?: string;
  hairStyle?: HairStyle;
  shirt?: string;
  pants?: string;
  pose?: Pose;
  hat?: Hat;
  tie?: string;
  flip?: boolean;
}) {
  const arm = { stroke: shirt, strokeWidth: 7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  const left =
    pose === "cheer" ? "M20 46 L12 30 L10 16" : pose === "laptop" ? "M20 46 L22 62 L30 64" : pose === "walk" ? "M20 46 L12 60 L10 72" : "M20 46 L15 62 L14 76";
  const right =
    pose === "wave" || pose === "cheer"
      ? "M40 46 L49 32 L52 16"
      : pose === "laptop"
        ? "M40 46 L38 62 L30 64"
        : pose === "walk"
          ? "M40 46 L47 60 L50 70"
          : "M40 46 L45 62 L46 76";
  const handL = pose === "cheer" ? [10, 14] : pose === "laptop" ? [30, 64] : pose === "walk" ? [10, 74] : [14, 78];
  const handR = pose === "wave" || pose === "cheer" ? [52, 14] : pose === "laptop" ? [30, 64] : pose === "walk" ? [50, 72] : [46, 78];
  const legL = pose === "walk" ? "M25 80 L17 116" : "M25 80 L23 116";
  const legR = pose === "walk" ? "M35 80 L44 115" : "M35 80 L37 116";

  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})${flip ? " translate(-60 0)" : ""}`}>
      {/* shadow */}
      <ellipse cx="30" cy="120" rx="18" ry="3.5" fill="#0f172a" opacity="0.12" />
      {/* legs */}
      <path d={legL} stroke={pants} strokeWidth="9" strokeLinecap="round" />
      <path d={legR} stroke={pants} strokeWidth="9" strokeLinecap="round" />
      <ellipse cx={pose === "walk" ? 15 : 22} cy="118" rx="6" ry="3" fill="#0f172a" />
      <ellipse cx={pose === "walk" ? 46 : 38} cy="118" rx="6" ry="3" fill="#0f172a" />
      {/* back arm */}
      <path d={left} {...arm} />
      <circle cx={handL[0]} cy={handL[1]} r="3.6" fill={skin} />
      {/* torso */}
      <path d="M18 46 Q18 38 26 37 L34 37 Q42 38 42 46 L41 82 Q30 86 19 82 Z" fill={shirt} />
      {tie && <path d="M30 39 L27.5 44 L30 62 L32.5 44 Z" fill={tie} />}
      {hat === "cap" && <rect x="22" y="52" width="8" height="5" rx="1" fill="#fde047" />}
      {/* neck + head */}
      <rect x="27" y="31" width="6" height="7" rx="2" fill={skin} />
      {hairStyle === "long" && <path d="M18 22 Q18 8 30 8 Q42 8 42 22 L43 40 Q36 36 34 30 L26 30 Q24 36 17 40 Z" fill={hair} />}
      <circle cx="30" cy="22" r="11" fill={skin} />
      {hairStyle === "bun" && <circle cx="30" cy="8" r="5" fill={hair} />}
      {hat === "helmet" ? (
        <>
          <path d="M17.5 20 Q18 8 30 8 Q42 8 42.5 20 Z" fill="#facc15" />
          <rect x="15" y="18.5" width="30" height="3.5" rx="1.75" fill="#eab308" />
        </>
      ) : hat === "cap" ? (
        <>
          <path d="M18.5 19 Q19 9 30 9 Q41 9 41.5 19 Z" fill="#1e3a8a" />
          <rect x="28" y="16.5" width="19" height="3.2" rx="1.6" fill="#1e3a8a" />
          <circle cx="30" cy="13" r="2" fill="#fde047" />
        </>
      ) : (
        <path d={hairStyle === "short" ? "M19 20 Q19 9 30 9 Q41 9 41 20 Q36 14 30 15 Q24 14 19 20 Z" : "M19 21 Q19 9 30 9 Q41 9 41 21 Q35 13 30 14 Q25 13 19 21 Z"} fill={hair} />
      )}
      {/* face */}
      <circle cx="26.5" cy="23" r="1.2" fill="#1f2937" />
      <circle cx="33.5" cy="23" r="1.2" fill="#1f2937" />
      <path d="M26.5 27.5 Q30 30.5 33.5 27.5" stroke="#1f2937" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {/* front arm */}
      <path d={right} {...arm} />
      <circle cx={handR[0]} cy={handR[1]} r="3.6" fill={skin} />
      {pose === "laptop" && (
        <>
          <rect x="16" y="58" width="28" height="18" rx="2" fill="#334155" />
          <rect x="18" y="60" width="24" height="14" rx="1" fill="#a5b4fc" />
          <circle cx="30" cy="67" r="2" fill="#ffffff" />
        </>
      )}
    </g>
  );
}

/** Header: the three groups as a little team — staff waving, guard, factory worker. */
export function TeamScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 130" className={className} aria-hidden>
      <Figure x={8} y={4} skin={SKIN[2]} shirt="#1e40af" pants="#0f172a" hat="cap" />
      <Figure x={80} y={0} s={1.04} skin={SKIN[0]} hair="#3b2416" hairStyle="long" shirt="#ffffff" pants="#312e81" pose="wave" tie="#ec4899" />
      <Figure x={152} y={4} skin={SKIN[1]} shirt="#f97316" pants="#1e293b" hat="helmet" pose="cheer" />
    </svg>
  );
}

/** One person per timing group, for its panel band. */
export function GroupFigure({ group, className }: { group: "staff" | "security" | "production_staff"; className?: string }) {
  return (
    <svg viewBox="0 0 60 126" className={className} aria-hidden>
      {group === "staff" && <Figure skin={SKIN[0]} hair="#2b2118" hairStyle="bun" shirt="#ffffff" pants="#1e1b4b" tie="#6366f1" pose="laptop" />}
      {group === "security" && <Figure skin={SKIN[2]} shirt="#1e3a8a" pants="#0f172a" hat="cap" />}
      {group === "production_staff" && <Figure skin={SKIN[1]} shirt="#0f766e" pants="#1e293b" hat="helmet" pose="wave" />}
    </svg>
  );
}

/** Empty "nobody late" — a cheer with confetti. */
export function CelebrateScene({ className }: { className?: string }) {
  const bits = [
    [8, 20, "#f59e0b"],
    [22, 6, "#ec4899"],
    [70, 10, "#6366f1"],
    [84, 26, "#10b981"],
    [14, 44, "#06b6d4"],
    [80, 50, "#f43f5e"],
    [46, 2, "#a855f7"],
  ] as const;
  return (
    <svg viewBox="0 0 92 130" className={className} aria-hidden>
      {bits.map(([cx, cy, c], i) => (
        <rect key={i} x={cx} y={cy} width="5" height="5" rx="1" fill={c} transform={`rotate(${i * 37} ${cx + 2.5} ${cy + 2.5})`} />
      ))}
      <Figure x={16} y={6} skin={SKIN[1]} hair="#1f2937" shirt="#f59e0b" pants="#1e293b" pose="cheer" />
    </svg>
  );
}

/** Empty "nobody out / left early" — someone at work on a laptop, plant beside. */
export function WorkingScene({ className, shirt = "#06b6d4" }: { className?: string; shirt?: string }) {
  return (
    <svg viewBox="0 0 110 130" className={className} aria-hidden>
      <rect x="74" y="92" width="18" height="26" rx="3" fill="#cbd5e1" />
      <path d="M83 92 Q72 76 78 64 Q84 78 83 92 Q86 72 96 66 Q94 84 83 92" fill="#10b981" />
      <Figure x={10} y={4} skin={SKIN[0]} hair="#3b2416" hairStyle="long" shirt={shirt} pants="#1e293b" pose="laptop" />
    </svg>
  );
}

/** Empty "no punches yet" — a person waiting beside a clock. */
export function WaitingScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 130" className={className} aria-hidden>
      <circle cx="90" cy="40" r="22" fill="#ffffff" stroke="#a855f7" strokeWidth="4" />
      <path d="M90 26 L90 40 L100 46" stroke="#1f2937" strokeWidth="3" strokeLinecap="round" fill="none" />
      <Figure x={8} y={4} skin={SKIN[3]} shirt="#a855f7" pants="#1e293b" />
    </svg>
  );
}

/** Punctuality — someone hurrying in, clock behind. */
export function HurryScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 130" className={className} aria-hidden>
      <circle cx="30" cy="34" r="20" fill="#fff7ed" stroke="#f97316" strokeWidth="3.5" />
      <path d="M30 22 L30 34 L38 38" stroke="#1f2937" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M4 70 L18 70 M0 82 L16 82 M6 94 L20 94" stroke="#fdba74" strokeWidth="3" strokeLinecap="round" />
      <Figure x={46} y={4} skin={SKIN[1]} hair="#1f2937" shirt="#f97316" pants="#1e293b" pose="walk" />
    </svg>
  );
}
