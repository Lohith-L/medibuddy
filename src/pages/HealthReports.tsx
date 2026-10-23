import { useEffect, useState } from "react";
import { useActivePatient } from "@/contexts/CareContext";
import { BarChart3, TrendingUp, TrendingDown, Minus, Award, Calendar, Pill, CheckCircle2, XCircle, Download, Printer, Share2, Loader2, FileText } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { startOfWeek, endOfWeek, subWeeks, format, startOfDay } from "date-fns";
import { useLanguage } from "@/contexts/LanguageContext";
import { useChartTheme } from "@/lib/chartTheme";
import { printHealthReport, downloadHealthReportFile, shareHealthReport } from "@/lib/reportExport";
import { toast } from "sonner";

interface WeekData {
  weekLabel: string;
  taken: number;
  missed: number;
  pending: number;
  total: number;
  /** null: nothing taken or missed yet that week (all pending), so no percentage. */
  adherence: number | null;
}

const COLORS = {
  taken: "hsl(155 45% 55%)",
  missed: "hsl(0 70% 60%)",
  pending: "hsl(35 90% 55%)",
};

const HealthReports = () => {
  const { t, language, locale } = useLanguage();
  const chart = useChartTheme();
  /** "2026-10-05" → "5 Oct" / "5 अक्टू॰" in the current language. */
  const fmtWeek = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" });
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [patientName, setPatientName] = useState("");
  const [totalDoses, setTotalDoses] = useState(0);
  const [taken, setTaken] = useState(0);
  const [missed, setMissed] = useState(0);
  const [pending, setPending] = useState(0);
  const [adherence, setAdherence] = useState(0);
  const [streak, setStreak] = useState(0);
  const [weeklyData, setWeeklyData] = useState<WeekData[]>([]);
  const [activeMedicines, setActiveMedicines] = useState(0);
  const [trend, setTrend] = useState<"up" | "down" | "stable">("stable");

  // Me, or the patient I'm viewing as a caregiver.
  const { active, loading: careLoading } = useActivePatient();

  useEffect(() => {
    if (careLoading) return;
    const load = async () => {
      const patient = active ? { id: active.patientId, name: active.name } : null;
      if (!patient) { setLoading(false); return; }
      setPatientId(patient.id);
      setPatientName(patient.name || "");

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
          weekLabel: format(ws, "yyyy-MM-dd"), // formatted in the UI language at render
          taken: wt,
          missed: wm,
          pending: wp,
          total: weekLogs.length,
          adherence: wCompleted > 0 ? Math.round((wt / wCompleted) * 100) : null,
        });
      }
      setWeeklyData(weeks);

      // Trend from the last two weeks that have a percentage.
      const rated = weeks.filter((w) => w.adherence !== null);
      if (rated.length >= 2) {
        const recent = rated[rated.length - 1].adherence!;
        const prev = rated[rated.length - 2].adherence!;
        setTrend(recent > prev + 5 ? "up" : recent < prev - 5 ? "down" : "stable");
      }

      setLoading(false);
    };

    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.patientId, careLoading]);

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "download" | "share" | null>(null);

  const generateHtml = () => {
    const lang = language;
    const trendText = trend === "up" ? t("report.improving") : trend === "down" ? t("report.declining") : t("report.stable");
    const adherenceStatusColor = adherence >= 80 ? "#52B788" : adherence >= 50 ? "#EF9F27" : "#E24B4A";
    const now = format(new Date(), "yyyy-MM-dd HH:mm");

    const weekRows = weeklyData.map(w => {
      const color = w.adherence === null ? "#888888" : w.adherence >= 80 ? "#52B788" : w.adherence >= 50 ? "#EF9F27" : "#E24B4A";
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${t("report.week")} ${fmtWeek(w.weekLabel)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${w.total}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#52B788;font-weight:600;">${w.taken}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#E24B4A;font-weight:600;">${w.missed}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:${color};font-weight:700;">${w.adherence === null ? "–" : `${w.adherence}%`}</td>
      </tr>`;
    }).join("");

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${t("report.title")} - ${patientName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&family=Noto+Sans+Kannada:wght@400;600;700&family=Noto+Sans+Telugu:wght@400;600;700&family=Noto+Sans+Tamil:wght@400;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Noto Sans','Noto Sans Devanagari','Noto Sans Kannada','Noto Sans Telugu','Noto Sans Tamil',sans-serif; color:#1a1a2e; background:#fff; padding:24px; max-width:800px; margin:0 auto; line-height:1.5; }
  .header { text-align:center; margin-bottom:28px; border-bottom:3px solid #2E86AB; padding-bottom:16px; }
  .header h1 { font-size:26px; color:#2E86AB; margin-bottom:4px; }
  .header p { color:#666; font-size:14px; }
  .meta { display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px; margin-bottom:24px; font-size:13px; color:#555; background:#f8fafc; padding:12px 16px; border-radius:10px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:12px; margin-bottom:24px; }
  .stat-card { border-radius:12px; padding:14px; text-align:center; border:1px solid #e5e7eb; }
  .stat-card .value { font-size:28px; font-weight:700; }
  .stat-card .label { font-size:12px; color:#666; margin-top:4px; }
  .section-title { font-size:16px; font-weight:700; margin-bottom:12px; color:#1a1a2e; }
  .progress-bar { background:#e5e7eb; border-radius:8px; height:14px; margin:8px 0 16px; overflow:hidden; }
  .progress-fill { height:100%; border-radius:8px; }
  .table-container { width:100%; overflow-x:auto; margin-bottom:24px; }
  table { width:100%; border-collapse:collapse; min-width:320px; }
  th { background:#f1f5f9; padding:10px 12px; text-align:left; font-size:12px; font-weight:600; color:#555; border-bottom:2px solid #e5e7eb; }
  .footer { text-align:center; margin-top:28px; padding-top:16px; border-top:1px solid #e5e7eb; font-size:12px; color:#888; }
  @media print {
    body { padding:16px; }
    .meta { background:none; padding:0; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>💊 ${t("report.title")}</h1>
    <p>${t("report.subtitle")}</p>
  </div>

  <div class="meta">
    <div><strong>${t("report.patient")}:</strong> ${patientName || "—"}</div>
    <div><strong>${t("report.reportDate")}:</strong> ${new Date().toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}</div>
    <div><strong>${t("report.period")}:</strong> ${t("report.lastFourWeeks")}</div>
  </div>

  <div class="section-title">${t("report.summary")}</div>
  <div class="stats">
    <div class="stat-card" style="background:#f0fdf4;">
      <div class="value" style="color:${adherenceStatusColor};">${adherence}%</div>
      <div class="label">${t("report.adherence")}</div>
    </div>
    <div class="stat-card" style="background:#f0fdf4;">
      <div class="value" style="color:#52B788;">${taken}</div>
      <div class="label">${t("report.taken")}</div>
    </div>
    <div class="stat-card" style="background:#fef2f2;">
      <div class="value" style="color:#E24B4A;">${missed}</div>
      <div class="label">${t("report.missed")}</div>
    </div>
    <div class="stat-card" style="background:#eff6ff;">
      <div class="value" style="color:#2E86AB;">${streak}</div>
      <div class="label">${t("report.streak")} (${t("report.days")})</div>
    </div>
  </div>

  <div style="margin-bottom:24px;">
    <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px;">
      <span>${taken} / ${taken + missed} ${t("report.doses")} ${t("report.taken").toLowerCase()}</span>
      <span style="font-weight:700;color:${adherenceStatusColor};">${adherence}%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${adherence}%;background:${adherenceStatusColor};"></div>
    </div>
    <div style="font-size:13px;color:#888;">
      ${t("report.activeMedicines")}: ${activeMedicines} · ${t("report.totalDoses")}: ${totalDoses} · ${t("report.pending")}: ${pending} · ${t("report.trend")}: ${trendText}
    </div>
  </div>

  <div class="section-title">${t("report.weeklyBreakdown")}</div>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>${t("report.week")}</th>
          <th style="text-align:center;">${t("report.doses")}</th>
          <th style="text-align:center;">${t("report.taken")}</th>
          <th style="text-align:center;">${t("report.missed")}</th>
          <th style="text-align:center;">${t("report.adherence")}</th>
        </tr>
      </thead>
      <tbody>${weekRows}</tbody>
    </table>
  </div>

  <div class="footer">
    <p>${t("report.generatedAt")}: ${now}</p>
    <p style="margin-top:4px;">${t("report.poweredBy")}</p>
  </div>
</body>
</html>`;
  };

  const handleExport = async (action: "pdf" | "download" | "share") => {
    try {
      setExporting(action);
      const html = generateHtml();
      const cleanName = (patientName || "Patient").replace(/[^a-zA-Z0-9_\u0900-\u0D7F-]/g, "_");
      const fileName = `Health-Report-${cleanName}-${format(new Date(), "yyyyMMdd")}.html`;
      const reportTitle = `${t("report.title")} - ${patientName || "Patient"}`;

      if (action === "pdf") {
        await printHealthReport(html, reportTitle);
        toast.success(t("report.savePdf"));
      } else if (action === "download") {
        await downloadHealthReportFile(html, fileName);
        toast.success(t("report.downloadSuccess"));
      } else if (action === "share") {
        const shared = await shareHealthReport(html, fileName, reportTitle);
        if (shared) {
          toast.success(t("report.shareReport"));
        }
      }
      setExportOpen(false);
    } catch (err) {
      console.error("Export error:", err);
      toast.error(t("report.downloadFailed"));
    } finally {
      setExporting(null);
    }
  };

  const adherenceColor = adherence >= 80 ? "text-success" : adherence >= 50 ? "text-warning" : "text-destructive";
  const adherenceBg = adherence >= 80 ? "bg-success/10" : adherence >= 50 ? "bg-warning/10" : "bg-destructive/10";
  const adherenceBarColor = adherence >= 80 ? COLORS.taken : adherence >= 50 ? COLORS.pending : COLORS.missed;

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendLabel = trend === "up" ? t("report.improving") : trend === "down" ? t("report.declining") : t("report.stable");

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
          <h1 className="text-2xl font-extrabold">{t("healthReports")}</h1>
          {!noData && (
            <Button onClick={() => setExportOpen(true)} className="gap-2 min-h-[48px] rounded-xl shadow-sm">
              <Download className="w-5 h-5" />
              {t("report.downloadReport")}
            </Button>
          )}
        </div>

        {noData ? (
          <Card className="rounded-2xl shadow-card text-center p-10">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="w-8 h-8 text-primary" />
            </div>
            <p className="text-lg font-semibold mb-1">{t("reports.noData")}</p>
            <p className="text-muted-foreground">{t("reports.noDataDesc")}</p>
          </Card>
        ) : (
          <>
            {/* Top stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <Card className={`rounded-2xl shadow-card ${adherenceBg} border-0`}>
                <CardContent className="p-3 sm:p-5 text-center">
                  <p className={`text-3xl sm:text-4xl font-extrabold ${adherenceColor}`}>{adherence}%</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("report.adherence")}</p>
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
                  <p className="text-sm text-muted-foreground">{t("chart.taken")}</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-card border-0 bg-destructive/10">
                <CardContent className="p-3 sm:p-5 text-center">
                  <XCircle className="w-6 h-6 text-destructive mx-auto mb-1" />
                  <p className="text-2xl sm:text-3xl font-extrabold text-destructive">{missed}</p>
                  <p className="text-sm text-muted-foreground">{t("chart.missed")}</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-card border-0 bg-primary/10">
                <CardContent className="p-3 sm:p-5 text-center">
                  <Award className="w-6 h-6 text-primary mx-auto mb-1" />
                  <p className="text-2xl sm:text-3xl font-extrabold text-primary">{streak}</p>
                  <p className="text-sm text-muted-foreground">{t("reports.dayStreak")}</p>
                </CardContent>
              </Card>
            </div>

            {/* Overall progress bar */}
            <Card className="rounded-2xl shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Pill className="w-5 h-5 text-primary" />
                  {t("reports.overall")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("reports.completedTaken", { taken, total: taken + missed })}</span>
                  <span className="font-semibold" style={{ color: adherenceBarColor }}>{adherence}%</span>
                </div>
                <Progress value={adherence} className="h-3" />
                <div className="flex flex-wrap gap-2 sm:gap-4 text-xs text-muted-foreground">
                  <span>{t(activeMedicines === 1 ? "reports.activeMedicine" : "reports.activeMedicines", { count: activeMedicines })}</span>
                  <span>{t("reports.totalTracked", { count: totalDoses })}</span>
                  <span>{t("log.countPending", { count: pending })}</span>
                </div>
              </CardContent>
            </Card>

            {/* Weekly chart */}
            <Card className="rounded-2xl shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  {t("report.weeklyBreakdown")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="chart">
                  <TabsList className="mb-4">
                    <TabsTrigger value="chart">{t("reports.chart")}</TabsTrigger>
                    <TabsTrigger value="table">{t("report.summary")}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="chart">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weeklyData} barGap={4}>
                          <XAxis dataKey="weekLabel" {...chart.axisProps} tickFormatter={fmtWeek} />
                          <YAxis {...chart.axisProps} />
                          <Tooltip
                            cursor={chart.tooltip.cursor}
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null;
                              return (
                                <div className="bg-card border rounded-xl px-4 py-2.5 shadow-card text-sm">
                                  <p className="font-semibold mb-1">{t("reports.weekOf", { date: fmtWeek(String(label)) })}</p>
                                  {payload.map((p: any) => (
                                    <p key={p.dataKey} style={{ color: p.fill }}>
                                      {p.dataKey === "taken" ? t("chart.taken") : p.dataKey === "missed" ? t("chart.missed") : p.dataKey}: {p.value}
                                    </p>
                                  ))}
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="taken" fill={COLORS.taken} radius={[4, 4, 0, 0]} name={t("chart.taken")} />
                          <Bar dataKey="missed" fill={COLORS.missed} radius={[4, 4, 0, 0]} name={t("chart.missed")} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </TabsContent>

                  <TabsContent value="table">
                    <div className="space-y-3">
                      {weeklyData.map((w) => (
                        <div key={w.weekLabel} className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                          <div>
                            <p className="font-semibold text-sm">{t("reports.weekOf", { date: fmtWeek(w.weekLabel) })}</p>
                            <p className="text-xs text-muted-foreground">{t("reports.weekLine", { total: w.total, taken: w.taken, missed: w.missed })}</p>
                          </div>
                          <div className={`text-lg font-bold ${w.adherence === null ? "text-muted-foreground" : w.adherence >= 80 ? "text-success" : w.adherence >= 50 ? "text-warning" : "text-destructive"}`}>
                            {w.adherence === null ? "–" : `${w.adherence}%`}
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

      {/* Export & Download Dialog for Mobile and Desktop */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)] rounded-2xl p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Download className="w-5 h-5 text-primary" />
              {t("report.downloadReport")}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              {t("report.exportSubtitle")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 pt-3">
            {/* Save as PDF / Print */}
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => void handleExport("pdf")}
              className="flex items-start gap-4 p-4 rounded-xl border border-border/70 hover:border-primary/50 hover:bg-primary/5 active:bg-primary/10 transition-all text-left disabled:opacity-50"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                {exporting === "pdf" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm">{t("report.savePdf")}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t("report.savePdfDesc")}</p>
              </div>
            </button>

            {/* Download file directly */}
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => void handleExport("download")}
              className="flex items-start gap-4 p-4 rounded-xl border border-border/70 hover:border-emerald-500/50 hover:bg-emerald-500/5 active:bg-emerald-500/10 transition-all text-left disabled:opacity-50"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                {exporting === "download" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm">{t("report.downloadFile")}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t("report.downloadFileDesc")}</p>
              </div>
            </button>

            {/* Share report */}
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => void handleExport("share")}
              className="flex items-start gap-4 p-4 rounded-xl border border-border/70 hover:border-blue-500/50 hover:bg-blue-500/5 active:bg-blue-500/10 transition-all text-left disabled:opacity-50"
            >
              <div className="w-11 h-11 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                {exporting === "share" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Share2 className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm">{t("report.shareReport")}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t("report.shareReportDesc")}</p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HealthReports;
