// TEMPORARY debug panel (Health page, Android only): every Health Connect
// heart-rate / steps / sleep record of the last 24 h with its source app, so
// it's clear which app (if any) writes each type. Remove once syncing is sorted.
import { useState } from "react";
import { Bug } from "lucide-react";
import { debugHealthRecords, type DebugRecord } from "@/lib/healthService";

const TYPES = ["heartRate", "steps", "sleep"] as const;
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const HealthDebugPanel = () => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{ records: DebugRecord[]; errors: string[]; at: Date } | null>(null);

  const load = async () => {
    setBusy(true);
    try {
      setData({ ...(await debugHealthRecords(24)), at: new Date() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed p-3 text-xs">
      <button
        onClick={() => {
          setOpen(!open);
          if (!open && !data) void load();
        }}
        className="flex w-full items-center gap-2 font-semibold text-muted-foreground"
      >
        <Bug className="h-4 w-4" /> Data sources, last 24 h (debug) {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <button onClick={() => void load()} disabled={busy} className="rounded-md border px-2 py-1 font-semibold">
            {busy ? "Reading…" : "Read again"}
          </button>
          {data?.errors.map((e) => <p key={e} className="text-destructive">{e}</p>)}
          {data &&
            TYPES.map((type) => {
              const rows = data.records.filter((r) => r.type === type);
              const byOrigin = new Map<string, { n: number; sum: number }>();
              for (const r of rows) {
                const o = byOrigin.get(r.origin) ?? { n: 0, sum: 0 };
                o.n++;
                o.sum += r.value;
                byOrigin.set(r.origin, o);
              }
              return (
                <div key={type}>
                  <p className="font-bold">
                    {type}: {rows.length} record{rows.length === 1 ? "" : "s"}
                    {rows.length === 0 && <span className="font-normal text-destructive"> (no app wrote this type)</span>}
                  </p>
                  {[...byOrigin].map(([origin, o]) => (
                    <p key={origin} className="text-muted-foreground">
                      from <span className="font-mono">{origin}</span>: {o.n} records
                      {type === "steps" ? `, ${o.sum} steps` : ""}
                    </p>
                  ))}
                  <ul className="mt-1 max-h-40 overflow-y-auto font-mono">
                    {rows.slice(0, 50).map((r, i) => (
                      <li key={i}>
                        {fmt(r.start)} · {Math.round(r.value)} {r.unit} · {r.app ?? r.origin}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          {data && <p className="text-muted-foreground">Read at {data.at.toLocaleTimeString()}</p>}
        </div>
      )}
    </div>
  );
};

export default HealthDebugPanel;
