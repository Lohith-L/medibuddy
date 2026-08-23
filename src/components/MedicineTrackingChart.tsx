import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartDataItem {
  name: string;
  value: number;
  color: string;
}

const COLORS = {
  taken: "#52B788",
  pending: "#EF9F27",
  missed: "#E24B4A",
  snoozed: "#378ADD",
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const { name, value, color } = payload[0].payload;
  const total = payload[0].payload.total || 1;
  const pct = ((value / total) * 100).toFixed(0);
  return (
    <div className="bg-card border rounded-xl px-4 py-2.5 shadow-card text-sm">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-semibold">{name}</span>
      </div>
      <p className="text-muted-foreground mt-1">{value} dose{value !== 1 ? "s" : ""} · {pct}%</p>
    </div>
  );
};

interface Props {
  schedule?: { status: string }[];
  loading?: boolean;
}

const MedicineTrackingChart = ({ schedule = [], loading = false }: Props) => {
  const counts = { taken: 0, pending: 0, missed: 0, snoozed: 0, escalated: 0 };
  
  schedule.forEach((l) => {
    const s = l.status.toLowerCase() as keyof typeof counts;
    if (s in counts) counts[s]++;
  });

  const missedCount = counts.missed + counts.escalated;

  const data = [
    { name: "Taken", value: counts.taken, color: COLORS.taken },
    { name: "Pending", value: counts.pending, color: COLORS.pending },
    { name: "Missed", value: missedCount, color: COLORS.missed },
    { name: "Snoozed", value: counts.snoozed, color: COLORS.snoozed },
  ];

  const total = data.reduce((s, d) => s + d.value, 0);
  const chartData = data.map((d) => ({ ...d, total }));
  const hasData = total > 0;

  if (loading) return <Skeleton className="h-72 rounded-2xl" />;

  return (
    <div className="bg-card rounded-2xl border p-5 shadow-card">
      <h2 className="text-xl font-bold">Medicine Tracking Overview</h2>
      <p className="text-sm text-muted-foreground mb-4">Today's intake status</p>

      <div className="flex items-center justify-center">
        <div className="relative w-[200px] h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={hasData ? chartData : [{ name: "No data", value: 1, color: "hsl(var(--muted))", total: 1 }]}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={hasData ? 3 : 0}
                dataKey="value"
                isAnimationActive={true}
                animationDuration={800}
              >
                {(hasData ? chartData : [{ color: "hsl(210 20% 94%)" }]).map((entry, i) => (
                  <Cell key={i} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              {hasData && <Tooltip content={<CustomTooltip />} />}
            </PieChart>
          </ResponsiveContainer>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-3xl font-extrabold">{total}</span>
            <span className="text-xs text-muted-foreground">doses today</span>
          </div>
        </div>
      </div>

      {/* Stat pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
        {data.map((d) => (
          <div
            key={d.name}
            className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ backgroundColor: d.color + "18" }}
          >
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <div className="min-w-0">
              <p className="text-sm font-bold" style={{ color: d.color }}>{d.value}</p>
              <p className="text-xs text-muted-foreground truncate">{d.name}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MedicineTrackingChart;
