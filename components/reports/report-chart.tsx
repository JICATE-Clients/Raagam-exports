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

/** Brand-leaning categorical palette for chart series / pie slices. */
const PALETTE = [
  "#4f46e5", // indigo (primary)
  "#0d9488", // teal (accent)
  "#b45309", // amber
  "#1d4ed8", // blue
  "#15803d", // green
  "#b91c1c", // red
];

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
            <XAxis dataKey="category" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
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
            <Tooltip />
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
            <XAxis dataKey="category" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
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
