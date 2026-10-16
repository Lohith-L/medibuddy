// Recharts colours for the current theme (axis text, grid, tooltip).
// Plain colours rather than CSS variables: SVG attributes don't reliably
// resolve var() in every WebView.
import { useAppTheme } from "@/contexts/ThemeContext";

export function useChartTheme() {
  const { resolved } = useAppTheme();
  const dark = resolved === "dark";
  const axis = dark ? "#a3b0c2" : "#576175"; // = --muted-foreground
  const grid = dark ? "#2a3446" : "#dfe5ec";
  const tooltip = {
    contentStyle: {
      background: dark ? "#141c2b" : "#ffffff", // = --card
      border: `1px solid ${dark ? "#2a3446" : "#dfe5ec"}`,
      borderRadius: 12,
      color: dark ? "#f2f5f8" : "#20293c",
    },
    labelStyle: { color: dark ? "#f2f5f8" : "#20293c", fontWeight: 600 },
    itemStyle: { color: dark ? "#f2f5f8" : "#20293c" },
    cursor: { fill: dark ? "rgba(148, 163, 184, 0.12)" : "rgba(100, 116, 139, 0.08)" },
  };
  return {
    grid,
    /** Spread into <XAxis> / <YAxis>. */
    axisProps: { stroke: grid, tickLine: { stroke: grid }, tick: { fill: axis, fontSize: 11 } },
    tooltip,
    /** Bars: primary blue that reads on both backgrounds. */
    primary: dark ? "#4ca6f0" : "#2f85da",
    sleep: dark ? "#8b8ff5" : "#6366f1",
  };
}
