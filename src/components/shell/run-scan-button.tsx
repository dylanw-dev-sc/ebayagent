"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonClass, cn } from "../ui";

interface StatusPayload {
  running: boolean;
  dataSource: "ebay" | "fixture";
  scan: { id: number; status: string; queriesPlanned: number; queriesCompleted: number; examined: number; newListings: number; matchedNew: number; errorCount: number } | null;
}

export function RunScanButton({ initiallyRunning, dataSource, compact }: { initiallyRunning: boolean; dataSource: "ebay" | "fixture"; compact?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(initiallyRunning);
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState<StatusPayload["scan"]>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Poll scan progress while a scan is running.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = (await res.json()) as StatusPayload;
        if (cancelled) return;
        setProgress(data.scan);
        if (data.running) {
          timer = setTimeout(tick, 1200);
          return;
        }
        setRunning(false);
        const sc = data.scan;
        if (sc) {
          setMessage(
            sc.status === "failed"
              ? "Scan failed — see Scans & Status."
              : `${sc.newListings} new · ${sc.matchedNew} new matches${sc.errorCount ? ` · ${sc.errorCount} errors` : ""}`,
          );
        }
        router.refresh();
      } catch {
        if (!cancelled) timer = setTimeout(tick, 3000);
      }
    };
    timer = setTimeout(tick, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, router]);

  async function start() {
    setMessage(null);
    setStarting(true);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      if (!res.ok && res.status !== 409) {
        setMessage("Couldn't start the scan.");
        return;
      }
      setRunning(true);
    } catch {
      setMessage("Couldn't reach the app server.");
    } finally {
      setStarting(false);
    }
  }

  const busy = running || starting;
  const pct = progress && progress.queriesPlanned ? Math.round((progress.queriesCompleted / progress.queriesPlanned) * 100) : 0;

  return (
    <div className={cn("flex items-center gap-3", compact ? "flex-col items-stretch" : "")}>
      <button type="button" onClick={start} disabled={busy} className={cn(buttonClass.primary, compact ? "w-full" : "")}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" strokeWidth={2} />}
        {busy ? "Scanning…" : dataSource === "fixture" ? "Run fixture scan" : "Scan eBay now"}
      </button>
      {running && progress ? (
        <div className={cn("min-w-0 text-xs text-ink-2", compact ? "" : "max-w-56")} aria-live="polite">
          <div className="h-1 w-full overflow-hidden rounded-full bg-sunken">
            <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 tabular">
            {progress.queriesCompleted}/{progress.queriesPlanned} searches · {progress.examined} examined
          </p>
        </div>
      ) : message ? (
        <p className="text-xs text-ink-2" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
