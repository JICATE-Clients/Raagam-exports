"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { ReportConfig } from "@/lib/reports/types";

/**
 * Brand-leaning categorical palette for chart series / pie slices.
 *
 * These are `var()` references, not hex literals, so the palette follows the
 * theme. SVG `fill`/`stroke` resolve CSS custom properties natively and recharts
 * passes these strings straight through to the DOM, so no plumbing is needed.
 * With hard-coded hex the charts stayed light-mode indigo on a #14171d canvas.
 */
const PALETTE = [
  "var(--primary)",
  "var(--accent)",
  "var(--warning)",
  "var(--info)",
  "var(--success)",
  "var(--danger)",
];

/**
 * Axis + tooltip theming. recharts defaults to `#666` ticks and a hard white
 * tooltip, both of which disappear (or glare) in dark mode.
 */
const AXIS = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  stroke: "var(--border)",
} as const;

const TOOLTIP = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--foreground)",
  },
  labelStyle: { color: "var(--muted-foreground)" },
  itemStyle: { color: "var(--foreground)" },
} as const;

/** Renders the report's optional chart spec via recharts. */
export function ReportChart<T>({ config }: { config: ReportConfig<T> }) {
  const chart = config.chart;
  if (!chart) return null;

  // Flatten rows into recharts-friendly records keyed by series key + a category label.
  const data = config.rows.map((row) => {
    const record: Record<string, string | number> = {
      category: chart.category(row),
    };
    for (const s of chart.series) record[s.key] = s.value(row);
    return record;
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <ResponsiveContainer width="100%" height={360}>
        {chart.kind === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="category" {...AXIS} />
            <YAxis {...AXIS} />
            <Tooltip {...TOOLTIP} />
            <Legend />
            {chart.series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : chart.kind === "pie" ? (
          <PieChart>
            <Tooltip {...TOOLTIP} />
            <Legend />
            <Pie
              data={data}
              dataKey={chart.series[0]?.key}
              nameKey="category"
              cx="50%"
              cy="50%"
              outerRadius={130}
              label
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="category" {...AXIS} />
            <YAxis {...AXIS} />
            <Tooltip {...TOOLTIP} cursor={{ fill: "var(--surface-muted)" }} />
            <Legend />
            {chart.series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={PALETTE[i % PALETTE.length]}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
