import { useEffect, useState } from "react";
import { BarChart3, TrendingUp, TrendingDown, Minus, Award, Calendar, Pill, CheckCircle2, XCircle, Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { startOfWeek, endOfWeek, subWeeks, format, startOfDay } from "date-fns";
import { tr } from "@/lib/reportTranslations";
import { resolvePreferredLanguage } from "@/lib/language";

interface WeekData {
  weekLabel: string;
  taken: number;
  missed: number;
  pending: number;
  total: number;
  adherence: number;
}

const COLORS = {
  taken: "hsl(155 45% 55%)",
  missed: "hsl(0 70% 60%)",
  pending: "hsl(35 90% 55%)",
};

const HealthReports = () => {
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientLang, setPatientLang] = useState("en");
  const [totalDoses, setTotalDoses] = useState(0);
  const [taken, setTaken] = useState(0);
  const [missed, setMissed] = useState(0);
  const [pending, setPending] = useState(0);
  const [adherence, setAdherence] = useState(0);
  const [streak, setStreak] = useState(0);
  const [weeklyData, setWeeklyData] = useState<WeekData[]>([]);
  const [activeMedicines, setActiveMedicines] = useState(0);
  const [trend, setTrend] = useState<"up" | "down" | "stable">("stable");

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: patient } = await supabase
        .from("patients")
        .select("id, name, language")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!patient) { setLoading(false); return; }
      setPatientId(patient.id);
      setPatientName(patient.name || "");
      setPatientLang(resolvePreferredLanguage({
        settingsLanguage: patient.language,
        patientLanguage: user.user_metadata?.language as string | undefined,
      }));

      const { count: medCount } = await supabase
        .from("medicines")
        .select("*", { count: "exact", head: true })
        .eq("patient_id", patient.id)
        .eq("is_active", true);
      setActiveMedicines(medCount || 0);

      const fourWeeksAgo = subWeeks(new Date(), 4);
      const { data: logs } = await supabase
        .from("medicine_logs")
        .select("status, scheduled_time")
        .eq("patient_id", patient.id)
        .gte("scheduled_time", fourWeeksAgo.toISOString())
        .order("scheduled_time", { ascending: true });

      if (!logs || logs.length === 0) {
        setLoading(false);
        return;
      }

      const t = logs.filter(l => l.status === "taken").length;
      const m = logs.filter(l => l.status === "missed").length;
      const p = logs.filter(l => l.status === "pending" || l.status === "snoozed").length;
      setTaken(t);
      setMissed(m);
      setPending(p);
      setTotalDoses(logs.length);
      const completed = t + m;
      setAdherence(completed > 0 ? Math.round((t / completed) * 100) : 0);

      const today = startOfDay(new Date());
      const dayMap = new Map<string, { taken: number; missed: number }>();
      logs.forEach(l => {
        const day = format(new Date(l.scheduled_time), "yyyy-MM-dd");
        const entry = dayMap.get(day) || { taken: 0, missed: 0 };
        if (l.status === "taken") entry.taken++;
        if (l.status === "missed") entry.missed++;
        dayMap.set(day, entry);
      });

      let currentStreak = 0;
      for (let i = 0; i < 28; i++) {
        const d = format(new Date(today.getTime() - i * 86400000), "yyyy-MM-dd");
        const entry = dayMap.get(d);
        if (!entry || entry.taken === 0) break;
        if (entry.missed > 0) break;
        currentStreak++;
      }
      setStreak(currentStreak);

      const weeks: WeekData[] = [];
      for (let w = 3; w >= 0; w--) {
        const refDate = subWeeks(new Date(), w);
        const ws = startOfWeek(refDate, { weekStartsOn: 1 });
        const we = endOfWeek(refDate, { weekStartsOn: 1 });
        const weekLogs = logs.filter(l => {
          const d = new Date(l.scheduled_time);
          return d >= ws && d <= we;
        });
        const wt = weekLogs.filter(l => l.status === "taken").length;
        const wm = weekLogs.filter(l => l.status === "missed").length;
        const wp = weekLogs.filter(l => l.status === "pending" || l.status === "snoozed").length;
        const wCompleted = wt + wm;
        weeks.push({
          weekLabel: format(ws, "MMM d"),
          taken: wt,
          missed: wm,
          pending: wp,
          total: weekLogs.length,
          adherence: wCompleted > 0 ? Math.round((wt / wCompleted) * 100) : 0,
        });
      }
      setWeeklyData(weeks);

      if (weeks.length >= 2) {
        const recent = weeks[weeks.length - 1].adherence;
        const prev = weeks[weeks.length - 2].adherence;
        setTrend(recent > prev + 5 ? "up" : recent < prev - 5 ? "down" : "stable");
      }

      setLoading(false);
    };

    load();
  }, []);

  const handleDownload = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    let lang = resolvePreferredLanguage({ fallback: patientLang });

    if (user) {
      const { data: latestPatient } = await supabase
        .from("patients")
        .select("language")
        .eq("user_id", user.id)
        .maybeSingle();

      lang = resolvePreferredLanguage({
        settingsLanguage: latestPatient?.language,
        patientLanguage: user.user_metadata?.language as string | undefined,
        fallback: patientLang,
      });
      setPatientLang(lang);
    }

    const trendText = trend === "up" ? tr("improving", lang) : trend === "down" ? tr("declining", lang) : tr("stable", lang);
    const adherenceStatusColor = adherence >= 80 ? "#52B788" : adherence >= 50 ? "#EF9F27" : "#E24B4A";
    const now = format(new Date(), "yyyy-MM-dd HH:mm");

    const weekRows = weeklyData.map(w => {
      const color = w.adherence >= 80 ? "#52B788" : w.adherence >= 50 ? "#EF9F27" : "#E24B4A";
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${tr("week", lang)} ${w.weekLabel}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${w.total}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#52B788;font-weight:600;">${w.taken}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#E24B4A;font-weight:600;">${w.missed}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:${color};font-weight:700;">${w.adherence}%</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${tr("title", lang)} - ${patientName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&family=Noto+Sans+Kannada:wght@400;600;700&family=Noto+Sans+Telugu:wght@400;600;700&family=Noto+Sans+Tamil:wght@400;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Noto Sans','Noto Sans Devanagari','Noto Sans Kannada','Noto Sans Telugu','Noto Sans Tamil',sans-serif; color:#1a1a2e; background:#fff; padding:40px; max-width:800px; margin:0 auto; }
  .header { text-align:center; margin-bottom:32px; border-bottom:3px solid #2E86AB; padding-bottom:20px; }
  .header h1 { font-size:28px; color:#2E86AB; margin-bottom:4px; }
  .header p { color:#666; font-size:14px; }
  .meta { display:flex; justify-content:space-between; margin-bottom:24px; font-size:14px; color:#555; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:28px; }
  .stat-card { border-radius:12px; padding:16px; text-align:center; }
  .stat-card .value { font-size:32px; font-weight:700; }
  .stat-card .label { font-size:13px; color:#666; margin-top:4px; }
  .section-title { font-size:18px; font-weight:700; margin-bottom:12px; color:#1a1a2e; }
  .progress-bar { background:#e5e7eb; border-radius:8px; height:16px; margin:8px 0 16px; overflow:hidden; }
  .progress-fill { height:100%; border-radius:8px; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  th { background:#f1f5f9; padding:10px 12px; text-align:left; font-size:13px; font-weight:600; color:#555; border-bottom:2px solid #e5e7eb; }
  .footer { text-align:center; margin-top:32px; padding-top:16px; border-top:1px solid #e5e7eb; font-size:12px; color:#999; }
  @media print { body { padding:20px; } }
</style>
</head>
<body>
  <div class="header">
    <h1>💊 ${tr("title", lang)}</h1>
    <p>${tr("subtitle", lang)}</p>
  </div>

  <div class="meta">
    <div><strong>${tr("patient", lang)}:</strong> ${patientName || "—"}</div>
    <div><strong>${tr("reportDate", lang)}:</strong> ${format(new Date(), "dd MMM yyyy")}</div>
    <div><strong>${tr("period", lang)}:</strong> ${tr("lastFourWeeks", lang)}</div>
  </div>

  <div class="section-title">${tr("summary", lang)}</div>
  <div class="stats">
    <div class="stat-card" style="background:#f0fdf4;">
      <div class="value" style="color:${adherenceStatusColor};">${adherence}%</div>
      <div class="label">${tr("adherence", lang)}</div>
    </div>
    <div class="stat-card" style="background:#f0fdf4;">
      <div class="value" style="color:#52B788;">${taken}</div>
      <div class="label">${tr("taken", lang)}</div>
    </div>
    <div class="stat-card" style="background:#fef2f2;">
      <div class="value" style="color:#E24B4A;">${missed}</div>
      <div class="label">${tr("missed", lang)}</div>
    </div>
    <div class="stat-card" style="background:#eff6ff;">
      <div class="value" style="color:#2E86AB;">${streak}</div>
      <div class="label">${tr("streak", lang)} (${tr("days", lang)})</div>
    </div>
  </div>

  <div style="margin-bottom:24px;">
    <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;">
      <span>${taken} / ${taken + missed} ${tr("doses", lang)} ${tr("taken", lang).toLowerCase()}</span>
      <span style="font-weight:700;color:${adherenceStatusColor};">${adherence}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${adherence}%;background:${adherenceStatusColor};"></div>
    </div>
    <div style="font-size:13px;color:#888;">
      ${tr("activeMedicines", lang)}: ${activeMedicines} · ${tr("totalDoses", lang)}: ${totalDoses} · ${tr("pending", lang)}: ${pending} · ${tr("trend", lang)}: ${trendText}
    </div>
  </div>

  <div class="section-title">${tr("weeklyBreakdown", lang)}</div>
  <table>
    <thead>
      <tr>
        <th>${tr("week", lang)}</th>
        <th style="text-align:center;">${tr("doses", lang)}</th>
        <th style="text-align:center;">${tr("taken", lang)}</th>
        <th style="text-align:center;">${tr("missed", lang)}</th>
        <th style="text-align:center;">${tr("adherence", lang)}</th>
      </tr>
    </thead>
    <tbody>${weekRows}</tbody>
  </table>

  <div class="footer">
    <p>${tr("generatedAt", lang)}: ${now}</p>
    <p style="margin-top:4px;">${tr("poweredBy", lang)}</p>
  </div>
</body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 600);
    }
  };

  const adherenceColor = adherence >= 80 ? "text-success" : adherence >= 50 ? "text-warning" : "text-destructive";
  const adherenceBg = adherence >= 80 ? "bg-success/10" : adherence >= 50 ? "bg-warning/10" : "bg-destructive/10";
  const adherenceBarColor = adherence >= 80 ? COLORS.taken : adherence >= 50 ? COLORS.pending : COLORS.missed;

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendLabel = trend === "up" ? "Improving" : trend === "down" ? "Declining" : "Stable";

  if (loading) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </DashboardLayout>
    );
  }

  const noData = totalDoses === 0;

  return (
    <DashboardLayout>
      <div className="max-w-4xl space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-extrabold">Health Reports</h1>
          {!noData && (
            <Button onClick={handleDownload} className="gap-2 min-h-[48px] rounded-xl">
              <Download className="w-5 h-5" />
              {tr("downloadReport", patientLang)}
            </Button>
          )}
        </div>

        {noData ? (
          <Card className="rounded-2xl shadow-card text-center p-10">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="w-8 h-8 text-primary" />
            </div>
            <p className="text-lg font-semibold mb-1">No data yet</p>
            <p className="text-muted-foreground">Start tracking your medicines to see adherence reports and health insights here.</p>
          </Card>
        ) : (
          <>
            {/* Top stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <Card className={`rounded-2xl shadow-card ${adherenceBg} border-0`}>
                <CardContent className="p-3 sm:p-5 text-center">
                  <p className={`text-3xl sm:text-4xl font-extrabold ${adherenceColor}`}>{adherence}%</p>
                  <p className="text-sm text-muted-foreground mt-1">Adherence</p>
                  <div className="flex items-center justify-center gap-1 mt-2">
                    <TrendIcon className={`w-4 h-4 ${adherenceColor}`} />
                    <span className={`text-xs font-medium ${adherenceColor}`}>{trendLabel}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-card border-0 bg-success/10">
                <CardContent className="p-3 sm:p-5 text-center">
                  <CheckCircle2 className="w-6 h-6 text-success mx-auto mb-1" />
                  <p className="text-2xl sm:text-3xl font-extrabold text-success">{taken}</p>
                  <p className="text-sm text-muted-foreground">Taken</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-card border-0 bg-destructive/10">
                <CardContent className="p-3 sm:p-5 text-center">
                  <XCircle className="w-6 h-6 text-destructive mx-auto mb-1" />
                  <p className="text-2xl sm:text-3xl font-extrabold text-destructive">{missed}</p>
                  <p className="text-sm text-muted-foreground">Missed</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-card border-0 bg-primary/10">
                <CardContent className="p-3 sm:p-5 text-center">
                  <Award className="w-6 h-6 text-primary mx-auto mb-1" />
                  <p className="text-2xl sm:text-3xl font-extrabold text-primary">{streak}</p>
                  <p className="text-sm text-muted-foreground">Day streak</p>
                </CardContent>
              </Card>
            </div>

            {/* Overall progress bar */}
            <Card className="rounded-2xl shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Pill className="w-5 h-5 text-primary" />
                  Overall Progress
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{taken} of {taken + missed} completed doses taken</span>
                  <span className="font-semibold" style={{ color: adherenceBarColor }}>{adherence}%</span>
                </div>
                <Progress value={adherence} className="h-3" />
                <div className="flex flex-wrap gap-2 sm:gap-4 text-xs text-muted-foreground">
                  <span>{activeMedicines} active medicine{activeMedicines !== 1 ? "s" : ""}</span>
                  <span>{totalDoses} total doses tracked</span>
                  <span>{pending} pending</span>
                </div>
              </CardContent>
            </Card>

            {/* Weekly chart */}
            <Card className="rounded-2xl shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Weekly Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="chart">
                  <TabsList className="mb-4">
                    <TabsTrigger value="chart">Chart</TabsTrigger>
                    <TabsTrigger value="table">Summary</TabsTrigger>
                  </TabsList>

                  <TabsContent value="chart">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weeklyData} barGap={4}>
                          <XAxis dataKey="weekLabel" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              return (
                                <div className="bg-card border rounded-xl px-4 py-2.5 shadow-card text-sm">
                                  <p className="font-semibold mb-1">Week of {label}</p>
                                  {payload.map((p: any) => (
                                    <p key={p.dataKey} style={{ color: p.fill }}>
                                      {p.dataKey}: {p.value}
                                    </p>
                                  ))}
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="taken" fill={COLORS.taken} radius={[4, 4, 0, 0]} name="Taken" />
                          <Bar dataKey="missed" fill={COLORS.missed} radius={[4, 4, 0, 0]} name="Missed" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </TabsContent>

                  <TabsContent value="table">
                    <div className="space-y-3">
                      {weeklyData.map((w) => (
                        <div key={w.weekLabel} className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                          <div>
                            <p className="font-semibold text-sm">Week of {w.weekLabel}</p>
                            <p className="text-xs text-muted-foreground">{w.total} doses · {w.taken} taken · {w.missed} missed</p>
                          </div>
                          <div className={`text-lg font-bold ${w.adherence >= 80 ? "text-success" : w.adherence >= 50 ? "text-warning" : "text-destructive"}`}>
                            {w.adherence}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default HealthReports;
