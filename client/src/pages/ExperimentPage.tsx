import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight,
  Clock, ExternalLink, Filter, FlaskConical, Pause, Play, RefreshCw,
  Sparkles, Star, Timer, Trophy, TrendingDown, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { formatPercent } from "@/lib/format";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────
type SlotData = {
  id: number; label: string; ai_provider: string;
  paper_balance: number; initial_balance: number; open_positions: number;
  trade_count: number; win_rate: number; avg_pnl_pct: number;
  total_pnl_pct: number; fitness_score: number; started_at: number;
  config: Record<string, unknown>; history: unknown[];
};

type CycleSummary = {
  cycle_id: number; started_at: number; ended_at: number;
  slots: {
    label: string; ai_provider: string; trade_count: number; win_rate: number;
    avg_pnl_pct: number; total_pnl_pct: number; fitness_score: number;
    config: Record<string, unknown>;
  }[];
};

type Mode = "long" | "ai";
type SortBy = "fitness" | "win_rate" | "pnl" | "trades";
type GroupFilter = "all" | "A" | "B" | "C";
type StatusFilter = "all" | "promising" | "insufficient" | "underperforming";

type CachedSnapshot = {
  slots: SlotData[];
  savedAt: number;
  cycleId: number;
  longRunStartedAt: number | null;
  longRunDeadlineAt: number | null;
};

const TARGET_TRADES = 300;
const MIN_SIGNIFICANT_TRADES = 30;
const CACHE_KEY = "exp_snapshot_v2";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getGroup(label: string): "A" | "B" | "C" | "?" {
  const m = label.match(/^([ABC])\d/);
  return (m?.[1] as "A" | "B" | "C") ?? "?";
}

function getSlotStatus(
  slot: SlotData,
  topThreshold: number,
): "promising" | "insufficient" | "underperforming" {
  if (slot.trade_count < MIN_SIGNIFICANT_TRADES) return "insufficient";
  if (slot.total_pnl_pct < -15) return "underperforming";
  if (slot.fitness_score >= topThreshold) return "promising";
  return "insufficient";
}

function isRecommended(slot: SlotData, topThreshold: number): boolean {
  return slot.trade_count >= MIN_SIGNIFICANT_TRADES && slot.fitness_score >= topThreshold;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "0d 0h 0m";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${d}d ${h}h ${m}m`;
}

// ─── Group badge ──────────────────────────────────────────────────────────────
const GROUP_STYLES: Record<string, string> = {
  A: "bg-blue-400/10 text-blue-400 border-blue-400/20",
  B: "bg-purple-400/10 text-purple-400 border-purple-400/20",
  C: "bg-teal-400/10 text-teal-400 border-teal-400/20",
  "?": "bg-white/5 text-muted-foreground border-white/10",
};

function GroupBadge({ label }: { label: string }) {
  const g = getGroup(label);
  const code = label.split(" ")[0] ?? "?";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${GROUP_STYLES[g]}`}>
      {code}
    </span>
  );
}

// ─── Provider badge ───────────────────────────────────────────────────────────
const PROVIDER_COLORS: Record<string, string> = {
  claude: "text-[#e07f5a]", mimo: "text-[#7db3ff]",
  gemini: "text-[#a78bfa]", math: "text-teal-400", default: "text-muted-foreground",
};

function ProviderBadge({ provider }: { provider: string }) {
  const color = PROVIDER_COLORS[provider.toLowerCase()] ?? PROVIDER_COLORS.default;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${color}`}>
      <Bot className="h-3 w-3" />{provider}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: "promising" | "insufficient" | "underperforming" }) {
  if (status === "promising") return (
    <span className="inline-flex items-center gap-1 rounded bg-[#00ff88]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#00ff88]">
      <TrendingUp className="h-2.5 w-2.5" />Promissor
    </span>
  );
  if (status === "underperforming") return (
    <span className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
      <TrendingDown className="h-2.5 w-2.5" />Fraco
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
      <Clock className="h-2.5 w-2.5" />Insuficiente
    </span>
  );
}

// ─── Trade progress ───────────────────────────────────────────────────────────
function TradeProgress({ count }: { count: number }) {
  const pct = Math.min(100, (count / TARGET_TRADES) * 100);
  const color = pct >= 100 ? "bg-[#00ff88]" : pct >= 50 ? "bg-blue-400" : "bg-amber-400";
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{count} trades</span>
        <span>meta {TARGET_TRADES}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[.07]">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Countdown ────────────────────────────────────────────────────────────────
function CountdownTimer({ deadlineAt }: { deadlineAt: number }) {
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setNow(Date.now()), 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const remaining = deadlineAt - now;
  const expired = remaining <= 0;
  const d = Math.floor(remaining / 86_400_000);
  const h = Math.floor((remaining % 86_400_000) / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Timer className={`h-4 w-4 ${expired ? "text-rose-400" : "text-[#00ff88]"}`} />
      {expired
        ? <span className="font-bold text-rose-400">Expirado</span>
        : <span className="font-bold tabular-nums text-[#00ff88]">{d}d {h}h {m}m</span>
      }
      <span className="text-xs text-muted-foreground">restantes</span>
    </div>
  );
}

// ─── Enhanced slot card (30-day mode) ─────────────────────────────────────────
function LongRunSlotCard({
  slot, rank, topThreshold, recommended,
}: {
  slot: SlotData; rank: number; topThreshold: number; recommended: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const pnlColor = slot.total_pnl_pct >= 0 ? "text-[#00ff88]" : "text-rose-400";
  const rankColors = ["text-amber-400", "text-slate-300", "text-amber-700/90"];
  const status = getSlotStatus(slot, topThreshold);

  return (
    <article className="cyber-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-white/[.07] p-3">
        <div className="flex min-w-0 items-start gap-2">
          <Trophy className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${rankColors[rank] ?? "text-muted-foreground"}`} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <GroupBadge label={slot.label} />
              {recommended && (
                <span className="inline-flex items-center gap-0.5 rounded bg-[#00ff88]/10 px-1 py-0.5 text-[10px] font-bold text-[#00ff88]">
                  <CheckCircle2 className="h-2.5 w-2.5" />Rec
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs font-semibold text-foreground">{slot.label}</p>
          </div>
        </div>
        <div className="ml-2 shrink-0 text-right">
          <p className={`text-base font-bold tabular-nums ${pnlColor}`}>
            {slot.total_pnl_pct >= 0 ? "+" : ""}{formatPercent(slot.total_pnl_pct)}
          </p>
          <p className="text-[9px] text-muted-foreground">P&L total</p>
        </div>
      </div>

      {/* Progress */}
      <div className="border-b border-white/[.07] px-3 py-2">
        <TradeProgress count={slot.trade_count} />
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 divide-x divide-white/[.07] border-b border-white/[.07]">
        <div className="p-2 text-center">
          <p className="text-xs font-semibold tabular-nums text-foreground">{(slot.win_rate * 100).toFixed(0)}%</p>
          <p className="text-[9px] text-muted-foreground">Acerto</p>
        </div>
        <div className="p-2 text-center">
          <p className={`text-xs font-semibold tabular-nums ${slot.fitness_score > 0 ? "text-[#00ff88]" : "text-muted-foreground"}`}>
            {slot.fitness_score.toFixed(3)}
          </p>
          <p className="text-[9px] text-muted-foreground">Fitness</p>
        </div>
        <div className="p-2 text-center">
          <p className="text-xs font-semibold tabular-nums text-foreground">{slot.open_positions}</p>
          <p className="text-[9px] text-muted-foreground">Abertas</p>
        </div>
      </div>

      {/* Status + expand */}
      <div className="flex items-center justify-between px-3 py-2">
        <StatusBadge status={status} />
        <button
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Config
        </button>
      </div>

      {/* Config detail */}
      {expanded && (
        <div className="border-t border-white/[.07] bg-white/[.01] px-3 py-2 space-y-1">
          {Object.entries(slot.config)
            .filter(([k]) => k !== "reasoning" && k !== "paper_balance")
            .map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                <span className="tabular-nums text-foreground">{String(v as string | number | boolean)}</span>
              </div>
            ))}
        </div>
      )}
    </article>
  );
}

// ─── AI mode slot card (original) ────────────────────────────────────────────
function SlotCard({ slot, rank }: { slot: SlotData; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const pnlColor = slot.total_pnl_pct >= 0 ? "text-[#00ff88]" : "text-rose-400";
  const rankColors = ["text-amber-400", "text-slate-300", "text-amber-700/90"];
  return (
    <article className="cyber-surface overflow-hidden">
      <div className="flex items-start justify-between border-b border-white/[.07] p-4">
        <div className="flex items-center gap-2.5">
          <Trophy className={`h-4 w-4 ${rankColors[rank] ?? "text-muted-foreground"}`} />
          <div>
            <p className="text-sm font-semibold text-foreground">{slot.label}</p>
            <ProviderBadge provider={slot.ai_provider} />
          </div>
        </div>
        <div className="text-right">
          <p className={`text-lg font-bold tabular-nums ${pnlColor}`}>
            {slot.total_pnl_pct >= 0 ? "+" : ""}{formatPercent(slot.total_pnl_pct)}
          </p>
          <p className="text-[10px] text-muted-foreground">P&L total</p>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-white/[.07] border-b border-white/[.07]">
        <div className="p-3 text-center">
          <p className="text-xs font-semibold tabular-nums">{(slot.win_rate * 100).toFixed(0)}%</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Acerto</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xs font-semibold tabular-nums">{slot.trade_count}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Trades</p>
        </div>
        <div className="p-3 text-center">
          <p className={`text-xs font-semibold tabular-nums ${slot.fitness_score > 0 ? "text-[#00ff88]" : "text-muted-foreground"}`}>
            {slot.fitness_score.toFixed(3)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Fitness</p>
        </div>
      </div>
      <div className="p-3">
        <button
          className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Config usada
        </button>
        {expanded && (
          <div className="mt-2 space-y-1">
            {Object.entries(slot.config)
              .filter(([k]) => k !== "reasoning" && k !== "paper_balance")
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                  <span className="tabular-nums text-foreground">{String(v as string | number | boolean)}</span>
                </div>
              ))}
            {typeof slot.config.reasoning === "string" && slot.config.reasoning && (
              <p className="mt-2 rounded bg-white/[.03] p-2 text-[10px] leading-relaxed text-muted-foreground">
                {slot.config.reasoning}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Cycle history row ────────────────────────────────────────────────────────
function CycleRow({ cycle }: { cycle: CycleSummary }) {
  const [expanded, setExpanded] = useState(false);
  const best = [...cycle.slots].sort((a, b) => b.fitness_score - a.fitness_score)[0];
  const durationMin = Math.round((cycle.ended_at - cycle.started_at) / 60_000);
  return (
    <div className="border-b border-white/[.07] last:border-0">
      <button
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-white/[.02] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-xs text-muted-foreground">Ciclo #{cycle.cycle_id}</span>
        <span className="flex-1 text-xs text-foreground">{cycle.slots.length} slots · {durationMin}min</span>
        {best && (
          <span className="flex items-center gap-1.5 text-xs">
            <Star className="h-3 w-3 text-amber-400" />
            <ProviderBadge provider={best.ai_provider} />
            <span className={`tabular-nums ${best.total_pnl_pct >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
              {best.total_pnl_pct >= 0 ? "+" : ""}{formatPercent(best.total_pnl_pct)}
            </span>
          </span>
        )}
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-white/[.07] bg-white/[.01]">
          <table className="data-table">
            <thead>
              <tr><th>Slot</th><th>IA</th><th>Trades</th><th>Acerto</th><th>P&L %</th><th>Fitness</th></tr>
            </thead>
            <tbody>
              {cycle.slots.map((s, i) => (
                <tr key={i}>
                  <td className="font-medium text-foreground">{s.label}</td>
                  <td><ProviderBadge provider={s.ai_provider} /></td>
                  <td className="tabular-nums">{s.trade_count}</td>
                  <td className="tabular-nums">{(s.win_rate * 100).toFixed(0)}%</td>
                  <td className={`tabular-nums ${s.total_pnl_pct >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
                    {s.total_pnl_pct >= 0 ? "+" : ""}{formatPercent(s.total_pnl_pct)}
                  </td>
                  <td className="tabular-nums text-[#00ff88]">{s.fitness_score.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Phase badge ──────────────────────────────────────────────────────────────
function PhaseBadge({ phase }: { phase: string }) {
  const map: Record<string, string> = {
    idle: "status-neutral", collecting_suggestions: "status-amber",
    experiment_running: "status-ok", analyzing: "status-amber",
  };
  const labels: Record<string, string> = {
    idle: "Aguardando", collecting_suggestions: "Consultando IAs",
    experiment_running: "Executando", analyzing: "Analisando",
  };
  return (
    <div className={`status-chip ${map[phase] ?? "status-neutral"}`}>
      <FlaskConical className="h-3.5 w-3.5" />
      {labels[phase] ?? phase}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ExperimentPage() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<Mode>("long");
  const [sortBy, setSortBy] = useState<SortBy>("fitness");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [confirmStart, setConfirmStart] = useState(false);
  const [aiReport, setAiReport] = useState<Record<string, unknown> | null>(null);
  const [aiReportMeta, setAiReportMeta] = useState<{ provider: string; slotsAnalyzed: number; paperTrades: number; analyzedAt: number } | null>(null);

  // Cached snapshot (localStorage fallback if bot is unreachable)
  const [cache, setCache] = useState<CachedSnapshot | null>(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as CachedSnapshot) : null;
    } catch { return null; }
  });

  const { data, isLoading, refetch } = trpc.experiment.status.useQuery(undefined, { refetchInterval: 5_000, retry: 1 });
  const { data: history } = trpc.experiment.history.useQuery(undefined, { refetchInterval: 15_000, retry: 1 });
  const { data: bestConfig } = trpc.experiment.bestConfig.useQuery(undefined, { refetchInterval: 15_000, retry: 1 });
  const { data: assignmentsData } = trpc.aiIntegration.getAssignments.useQuery(undefined, { refetchInterval: 30_000, retry: 1 });
  const { data: providerList } = trpc.aiIntegration.listProviders.useQuery(undefined, { refetchInterval: 30_000, retry: 1 });

  const startCycle = trpc.experiment.startCycle.useMutation({
    onSuccess: (d) => { toast.success(`Ciclo #${d.cycleId} iniciado com ${d.slots} slots.`); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const stopCycle = trpc.experiment.stopCycle.useMutation({
    onSuccess: () => { toast.success("Ciclo encerrado."); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const setAutoMode = trpc.experiment.setAutoMode.useMutation({
    onSuccess: (d) => { toast.success(d.autoMode ? "Modo auto ligado." : "Modo auto desligado."); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const start30Days = trpc.experiment.start30Days.useMutation({
    onSuccess: (d) => {
      toast.success(`Experimento 30 dias iniciado — Ciclo #${d.cycleId} · 20 slots matemáticos.`);
      setConfirmStart(false);
      refetch();
    },
    onError: (e) => { toast.error(e.message); setConfirmStart(false); },
  });
  const recover30Days = trpc.experiment.recover30Days.useMutation({
    onSuccess: (d) => { toast.success(`Slots recuperados — Ciclo #${d.cycleId} · 20 slots reenviados ao bot.`); refetch(); },
    onError: (e) => toast.error(`Recuperação falhou: ${e.message}`),
  });
  const compareWithPaper = trpc.experiment.compareWithPaper.useMutation({
    onSuccess: (d) => {
      setAiReport(d.analysis as Record<string, unknown>);
      setAiReportMeta(d.meta);
      toast.success(`Análise concluída por ${d.meta.provider}.`);
    },
    onError: (e) => toast.error(`Análise falhou: ${e.message}`),
  });
  const stop30Days = trpc.experiment.stop30Days.useMutation({
    onSuccess: () => { toast.success("Experimento 30 dias encerrado."); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const orch = data?.orchestrator;
  const botSlots = (data?.botStatus?.slots ?? []) as SlotData[];
  const usingCache = botSlots.length === 0 && (cache?.slots?.length ?? 0) > 0;
  const displaySlots = usingCache ? (cache?.slots ?? []) : botSlots;

  // Save snapshot to localStorage on successful fetch
  useEffect(() => {
    if (botSlots.length > 0 && orch) {
      const snapshot: CachedSnapshot = {
        slots: botSlots,
        savedAt: Date.now(),
        cycleId: orch.currentCycleId,
        longRunStartedAt: orch.longRunStartedAt ?? null,
        longRunDeadlineAt: orch.longRunDeadlineAt ?? null,
      };
      setCache(snapshot);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot)); } catch { /* storage full */ }
    }
  }, [botSlots, orch]);

  const isRunning = orch?.running ?? false;
  const isAuto = orch?.autoMode ?? false;
  const isLongRun = !!(orch?.longRunStartedAt ?? cache?.longRunStartedAt);
  const longRunDeadlineAt = orch?.longRunDeadlineAt ?? cache?.longRunDeadlineAt ?? null;
  const longRunStartedAt = orch?.longRunStartedAt ?? cache?.longRunStartedAt ?? null;
  const totalTrades = displaySlots.reduce((s, sl) => s + sl.trade_count, 0);

  // Compute top-25% fitness threshold for "recommended" label
  const topThreshold = useMemo(() => {
    const qualified = displaySlots.filter(s => s.trade_count >= MIN_SIGNIFICANT_TRADES);
    if (qualified.length === 0) return Infinity;
    const sorted = [...qualified].sort((a, b) => b.fitness_score - a.fitness_score);
    const idx = Math.max(0, Math.floor(sorted.length * 0.25) - 1);
    return sorted[idx]?.fitness_score ?? Infinity;
  }, [displaySlots]);

  // Sort + filter slots
  const filteredSlots = useMemo(() => {
    let list = [...displaySlots];

    if (groupFilter !== "all") {
      list = list.filter(s => getGroup(s.label) === groupFilter);
    }

    if (statusFilter !== "all") {
      list = list.filter(s => getSlotStatus(s, topThreshold) === statusFilter);
    }

    list.sort((a, b) => {
      switch (sortBy) {
        case "fitness": return b.fitness_score - a.fitness_score;
        case "win_rate": return b.win_rate - a.win_rate;
        case "pnl": return b.total_pnl_pct - a.total_pnl_pct;
        case "trades": return b.trade_count - a.trade_count;
        default: return 0;
      }
    });
    return list;
  }, [displaySlots, groupFilter, statusFilter, sortBy, topThreshold]);

  const recommendedSlots = displaySlots.filter(s => isRecommended(s, topThreshold));
  const bestPnlSlot = displaySlots.reduce<SlotData | null>(
    (best, s) => (!best || s.total_pnl_pct > best.total_pnl_pct) ? s : best, null
  );

  // AI mode derived data
  const sortedByFitness = [...botSlots].sort((a, b) => b.fitness_score - a.fitness_score) as SlotData[];
  const experimentProviderIds = new Set(assignmentsData?.assignments?.["experiment_advisor"] ?? []);
  const assignedProviders = (providerList ?? []).filter(p => experimentProviderIds.has(p.id));

  return (
    <div className="page-enter">
      <PageHeader
        title="Experimentos de Trading"
        description="20 configurações matemáticas rodando em paralelo por 30 dias para encontrar a estratégia vencedora."
        action={<PhaseBadge phase={orch?.phase ?? "idle"} />}
      />

      {/* Mode tabs */}
      <div className="mb-5 flex gap-1 rounded-lg border border-white/[.07] bg-white/[.02] p-1 w-fit">
        <button
          className={`rounded px-4 py-1.5 text-xs font-semibold transition-colors ${
            mode === "long"
              ? "bg-[#00ff88] text-black"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setMode("long")}
        >
          <span className="flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" />30 Dias</span>
        </button>
        <button
          className={`rounded px-4 py-1.5 text-xs font-semibold transition-colors ${
            mode === "ai"
              ? "bg-white/10 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setMode("ai")}
        >
          <span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />Modo IA</span>
        </button>
      </div>

      {/* ── 30-DAY MODE ─────────────────────────────────────────────────────── */}
      {mode === "long" && (
        <div className="space-y-5">
          {/* Status bar */}
          <div className="cyber-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-5">
                {/* Run status */}
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${isLongRun && isRunning ? "animate-pulse bg-[#00ff88]" : "bg-muted-foreground"}`} />
                  <span className="text-sm font-semibold">
                    {isLongRun && isRunning ? "Experimento ativo" : "Inativo"}
                  </span>
                  {usingCache && (
                    <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                      cache · {cache ? Math.round((Date.now() - cache.savedAt) / 60_000) : 0}min atrás
                    </span>
                  )}
                </div>

                {/* Countdown */}
                {longRunDeadlineAt && <CountdownTimer deadlineAt={longRunDeadlineAt} />}

                {/* Started at */}
                {longRunStartedAt && (
                  <div className="text-xs text-muted-foreground">
                    Início: {new Date(longRunStartedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex gap-2">
                {isLongRun && isRunning && botSlots.length === 0 && (
                  <Button
                    size="sm" variant="outline" className="gap-1.5 text-xs border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
                    onClick={() => recover30Days.mutate()} disabled={recover30Days.isPending}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {recover30Days.isPending ? "Recuperando…" : "Recuperar Slots"}
                  </Button>
                )}
                {isRunning && isLongRun ? (
                  <Button
                    size="sm" variant="destructive" className="gap-1.5 text-xs"
                    onClick={() => stop30Days.mutate()} disabled={stop30Days.isPending}
                  >
                    <Pause className="h-3.5 w-3.5" />
                    {stop30Days.isPending ? "Parando…" : "Parar experimento"}
                  </Button>
                ) : confirmStart ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-400">Zera tudo e inicia 20 slots?</span>
                    <Button
                      size="sm" className="gap-1.5 bg-[#00ff88] text-black text-xs hover:bg-[#00ff88]/90"
                      onClick={() => start30Days.mutate()} disabled={start30Days.isPending}
                    >
                      {start30Days.isPending ? "Iniciando…" : "Confirmar"}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => setConfirmStart(false)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="gap-1.5 bg-[#00ff88] text-black text-xs hover:bg-[#00ff88]/90"
                    onClick={() => setConfirmStart(true)}
                    disabled={isRunning}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Iniciar Experimento 30 Dias
                  </Button>
                )}
              </div>
            </div>

            {/* Bot restart warning */}
            {isLongRun && isRunning && botSlots.length === 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[.06] px-3 py-2 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  O bot foi reiniciado e perdeu os slots em memória. Os dados históricos estão preservados no banco.
                  Clique em <strong>Recuperar Slots</strong> para reenviar as 20 configurações ao bot sem zerar o saldo.
                </span>
              </div>
            )}

          {/* Overall progress */}
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-white/[.03] p-3 text-center">
                <p className="text-sm font-bold tabular-nums text-foreground">{displaySlots.length}</p>
                <p className="text-[10px] text-muted-foreground">Slots ativos</p>
              </div>
              <div className="rounded-lg bg-white/[.03] p-3 text-center">
                <p className="text-sm font-bold tabular-nums text-foreground">{totalTrades.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">Trades totais</p>
              </div>
              <div className="rounded-lg bg-white/[.03] p-3 text-center">
                <p className="text-sm font-bold tabular-nums text-[#00ff88]">{recommendedSlots.length}</p>
                <p className="text-[10px] text-muted-foreground">Recomendados</p>
              </div>
              <div className="rounded-lg bg-white/[.03] p-3 text-center">
                <p className={`text-sm font-bold tabular-nums ${(bestPnlSlot?.total_pnl_pct ?? 0) >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
                  {bestPnlSlot ? `${bestPnlSlot.total_pnl_pct >= 0 ? "+" : ""}${formatPercent(bestPnlSlot.total_pnl_pct)}` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">Melhor P&L</p>
              </div>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />

            {/* Sort */}
            <select
              className="rounded border border-white/[.1] bg-white/[.04] px-2 py-1 text-xs text-foreground focus:outline-none"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortBy)}
            >
              <option value="fitness">Fitness ↓</option>
              <option value="win_rate">Win Rate ↓</option>
              <option value="pnl">P&L ↓</option>
              <option value="trades">Trades ↓</option>
            </select>

            {/* Group filter */}
            <div className="flex gap-1">
              {(["all", "A", "B", "C"] as GroupFilter[]).map(g => (
                <button
                  key={g}
                  className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                    groupFilter === g
                      ? g === "A" ? "bg-blue-400/20 text-blue-400"
                        : g === "B" ? "bg-purple-400/20 text-purple-400"
                        : g === "C" ? "bg-teal-400/20 text-teal-400"
                        : "bg-white/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setGroupFilter(g)}
                >
                  {g === "all" ? "Todos" : `Grupo ${g}`}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex gap-1">
              {(["all", "promising", "insufficient", "underperforming"] as StatusFilter[]).map(s => {
                const labels: Record<StatusFilter, string> = {
                  all: "Todos", promising: "Promissores",
                  insufficient: "Insuficientes", underperforming: "Fracos",
                };
                const active = statusFilter === s;
                const colors: Record<StatusFilter, string> = {
                  all: "bg-white/10 text-foreground",
                  promising: "bg-[#00ff88]/20 text-[#00ff88]",
                  insufficient: "bg-amber-400/20 text-amber-400",
                  underperforming: "bg-rose-400/20 text-rose-400",
                };
                return (
                  <button
                    key={s}
                    className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                      active ? colors[s] : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {labels[s]}
                  </button>
                );
              })}
            </div>

            <span className="ml-auto text-xs text-muted-foreground">
              {filteredSlots.length} de {displaySlots.length} slots
            </span>
          </div>

          {/* No slots state */}
          {!isLoading && displaySlots.length === 0 && (
            <div className="cyber-surface grid min-h-[200px] place-items-center rounded-xl">
              <div className="text-center">
                <FlaskConical className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-semibold text-foreground mb-1">Experimento não iniciado</p>
                <p className="text-xs text-muted-foreground">Clique em "Iniciar Experimento 30 Dias" para começar com as 20 configurações matemáticas.</p>
              </div>
            </div>
          )}

          {/* Slot grid */}
          {filteredSlots.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredSlots.map((slot, i) => (
                <LongRunSlotCard
                  key={slot.id}
                  slot={slot}
                  rank={i}
                  topThreshold={topThreshold}
                  recommended={isRecommended(slot, topThreshold)}
                />
              ))}
            </div>
          )}

          {/* Error notice */}
          {orch?.lastError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400" />
                <p className="text-xs font-semibold text-rose-400">Último erro</p>
              </div>
              <p className="mt-1 text-[11px] text-rose-300/80">{orch.lastError}</p>
            </div>
          )}

          {/* Recommended highlights */}
          {recommendedSlots.length > 0 && (
            <div className="cyber-surface p-4">
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#00ff88]" />
                <p className="text-sm font-semibold text-foreground">Configurações Recomendadas</p>
                <span className="text-xs text-muted-foreground">top 25% fitness com ≥{MIN_SIGNIFICANT_TRADES} trades</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>Slot</th><th>Grupo</th><th>Trades</th><th>Acerto</th><th>P&L %</th><th>Fitness</th></tr>
                  </thead>
                  <tbody>
                    {[...recommendedSlots]
                      .sort((a, b) => b.fitness_score - a.fitness_score)
                      .map(s => (
                        <tr key={s.id}>
                          <td className="font-medium text-foreground">{s.label}</td>
                          <td><GroupBadge label={s.label} /></td>
                          <td className="tabular-nums">{s.trade_count}</td>
                          <td className="tabular-nums">{(s.win_rate * 100).toFixed(0)}%</td>
                          <td className={`tabular-nums ${s.total_pnl_pct >= 0 ? "text-[#00ff88]" : "text-rose-400"}`}>
                            {s.total_pnl_pct >= 0 ? "+" : ""}{formatPercent(s.total_pnl_pct)}
                          </td>
                          <td className="tabular-nums font-bold text-[#00ff88]">{s.fitness_score.toFixed(3)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* ── AI Comparison Analysis ──────────────────────────────────────── */}
          <div className="cyber-surface p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#00ff88]" />
                <p className="text-sm font-semibold text-foreground">Análise IA: Experimento vs Paper Trading</p>
              </div>
              <Button
                size="sm"
                className="gap-1.5 bg-[#00ff88] text-black text-xs hover:bg-[#00ff88]/90"
                onClick={() => compareWithPaper.mutate()}
                disabled={compareWithPaper.isPending}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {compareWithPaper.isPending ? "Analisando…" : "Analisar agora"}
              </Button>
            </div>

            {compareWithPaper.isPending && (
              <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                IA comparando os 20 slots com o paper trading…
              </div>
            )}

            {!aiReport && !compareWithPaper.isPending && (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Clique em "Analisar agora" para que a IA compare os resultados dos 20 slots com o motor de paper trading principal e recomende a melhor configuração.
              </p>
            )}

            {aiReport && aiReportMeta && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground border-b border-white/[.07] pb-3">
                  <span>Provedor: <span className="text-foreground font-medium">{aiReportMeta.provider}</span></span>
                  <span>Slots analisados: <span className="text-foreground font-medium">{aiReportMeta.slotsAnalyzed}</span></span>
                  <span>Trades paper: <span className="text-foreground font-medium">{aiReportMeta.paperTrades}</span></span>
                  <span>Gerado: <span className="text-foreground font-medium">{new Date(aiReportMeta.analyzedAt).toLocaleTimeString("pt-BR")}</span></span>
                </div>

                {/* Summary */}
                {aiReport.summary && (
                  <div className="rounded-lg bg-white/[.03] p-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Resumo executivo</p>
                    <p className="text-sm text-foreground">{String(aiReport.summary)}</p>
                  </div>
                )}

                {/* Winner slot */}
                {aiReport.winner_slot && (
                  <div className="flex items-center gap-3 rounded-lg border border-[#00ff88]/30 bg-[#00ff88]/5 p-3">
                    <Trophy className="h-5 w-5 text-amber-400 shrink-0" />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#00ff88]">Slot vencedor</p>
                      <p className="text-sm font-bold text-foreground">{String(aiReport.winner_slot)}</p>
                    </div>
                  </div>
                )}

                {/* Paper vs Experiment */}
                {aiReport.paper_vs_experiment && (
                  <div className="rounded-lg bg-white/[.03] p-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Paper vs Experimento</p>
                    <p className="text-xs text-foreground/80">{String(aiReport.paper_vs_experiment)}</p>
                  </div>
                )}

                {/* Top 3 + Worst 3 */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.isArray(aiReport.top_3) && aiReport.top_3.length > 0 && (
                    <div className="rounded-lg bg-[#00ff88]/5 border border-[#00ff88]/20 p-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#00ff88]">Top 3 Slots</p>
                      <div className="space-y-2">
                        {(aiReport.top_3 as Array<{ slot: string; reason: string }>).map((item, i) => (
                          <div key={i}>
                            <p className="text-xs font-semibold text-foreground">{i + 1}. {item.slot}</p>
                            <p className="text-[11px] text-muted-foreground">{item.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {Array.isArray(aiReport.worst_3) && aiReport.worst_3.length > 0 && (
                    <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 p-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-rose-400">Piores 3 Slots</p>
                      <div className="space-y-2">
                        {(aiReport.worst_3 as Array<{ slot: string; reason: string }>).map((item, i) => (
                          <div key={i}>
                            <p className="text-xs font-semibold text-foreground">{i + 1}. {item.slot}</p>
                            <p className="text-[11px] text-muted-foreground">{item.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Recommendation */}
                {aiReport.recommendation && (
                  <div className={`rounded-lg border p-3 ${
                    aiReport.recommendation === "apply_winner"
                      ? "border-[#00ff88]/40 bg-[#00ff88]/5"
                      : aiReport.recommendation === "stop_experiment"
                      ? "border-rose-500/40 bg-rose-500/5"
                      : "border-amber-400/40 bg-amber-400/5"
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className={`h-4 w-4 ${
                        aiReport.recommendation === "apply_winner" ? "text-[#00ff88]"
                        : aiReport.recommendation === "stop_experiment" ? "text-rose-400"
                        : "text-amber-400"
                      }`} />
                      <p className="text-xs font-bold uppercase tracking-widest">
                        {{
                          apply_winner: "Aplicar slot vencedor",
                          wait_more_data: "Aguardar mais dados",
                          keep_current: "Manter configuração atual",
                          stop_experiment: "Encerrar experimento",
                        }[String(aiReport.recommendation)] ?? String(aiReport.recommendation)}
                      </p>
                    </div>
                    {aiReport.recommendation_reason && (
                      <p className="text-xs text-foreground/80">{String(aiReport.recommendation_reason)}</p>
                    )}
                  </div>
                )}

                {/* Key insights */}
                {Array.isArray(aiReport.key_insights) && aiReport.key_insights.length > 0 && (
                  <div className="rounded-lg bg-white/[.03] p-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Insights-chave</p>
                    <ul className="space-y-1.5">
                      {(aiReport.key_insights as string[]).map((insight, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                          <span className="mt-0.5 text-[#00ff88] shrink-0">•</span>
                          {insight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Config to apply */}
                {aiReport.config_to_apply && typeof aiReport.config_to_apply === "object" && (
                  <div className="rounded-lg bg-white/[.03] border border-white/[.07] p-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Configuração sugerida para aplicar</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                      {Object.entries(aiReport.config_to_apply as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground">{k.replace(/_/g, " ")}</span>
                          <span className="text-sm font-bold tabular-nums text-[#00ff88]">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AI CYCLE MODE ───────────────────────────────────────────────────── */}
      {mode === "ai" && (
        <div className="space-y-5">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Ciclo atual" value={isRunning ? `#${orch?.currentCycleId ?? 0}` : "—"} detail={isRunning ? "em andamento" : "nenhum ativo"} icon={Activity} tone={isRunning ? "green" : "slate"} />
            <MetricCard label="Slots ativos" value={botSlots.length} detail={`${totalTrades} trades neste ciclo`} icon={FlaskConical} tone="amber" />
            <MetricCard label="Melhor fitness" value={sortedByFitness[0]?.fitness_score.toFixed(3) ?? "—"} detail={sortedByFitness[0] ? `${sortedByFitness[0].label}` : "aguardando dados"} icon={Trophy} tone="green" />
            <MetricCard label="Ciclos históricos" value={history?.length ?? 0} detail={bestConfig ? `melhor fitness ${bestConfig.fitness.toFixed(3)}` : "sem histórico"} icon={Star} tone="amber" />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_300px]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  {isRunning ? `Ciclo #${orch?.currentCycleId} em execução` : "Nenhum ciclo ativo"}
                </p>
                <div className="flex gap-2">
                  {isRunning ? (
                    <Button size="sm" variant="destructive" className="gap-1.5 text-xs" onClick={() => stopCycle.mutate()} disabled={stopCycle.isPending}>
                      <Pause className="h-3.5 w-3.5" />{stopCycle.isPending ? "Parando…" : "Parar ciclo"}
                    </Button>
                  ) : (
                    <Button size="sm" className="gap-1.5 bg-[#00ff88] text-black text-xs hover:bg-[#00ff88]/90"
                      onClick={() => startCycle.mutate()} disabled={startCycle.isPending || isAuto}>
                      <Play className="h-3.5 w-3.5" />{startCycle.isPending ? "Iniciando…" : "Iniciar ciclo"}
                    </Button>
                  )}
                  <Button size="sm" variant="outline"
                    className={`gap-1.5 text-xs ${isAuto ? "border-[#00ff88]/40 text-[#00ff88]" : ""}`}
                    onClick={() => setAutoMode.mutate({ enabled: !isAuto })} disabled={setAutoMode.isPending}>
                    <RefreshCw className={`h-3.5 w-3.5 ${isAuto ? "animate-spin" : ""}`} />
                    Auto {isAuto ? "ligado" : "desligado"}
                  </Button>
                </div>
              </div>

              {!isLoading && sortedByFitness.length === 0 && (
                <div className="cyber-surface grid min-h-[200px] place-items-center rounded-xl">
                  <div className="text-center">
                    <FlaskConical className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">Inicie um ciclo para ver os slots das IAs.</p>
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sortedByFitness.map((slot, i) => <SlotCard key={slot.id} slot={slot} rank={i} />)}
              </div>

              {orch?.lastError && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
                  <p className="text-xs font-semibold text-rose-400">Último erro</p>
                  <p className="mt-0.5 text-[11px] text-rose-300/80">{orch.lastError}</p>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <article className="cyber-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Provedores</p>
                  <button className="flex items-center gap-1 text-[11px] text-[#00ff88] hover:underline" onClick={() => setLocation("/ai-integration")}>
                    Configurar <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
                {assignedProviders.length === 0 ? (
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                    <p className="text-[11px] text-amber-400">Nenhum provedor atribuído ao Advisor.</p>
                    <button className="mt-1.5 text-[11px] text-[#00ff88] hover:underline" onClick={() => setLocation("/ai-integration")}>
                      Configurar em Integração IA →
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {assignedProviders.map(p => (
                      <div key={p.id} className="flex items-center gap-2 rounded-lg border border-white/[.07] bg-white/[.02] p-2.5">
                        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">{p.name}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">{p.model}</p>
                        </div>
                        <div className={`ml-auto h-1.5 w-1.5 rounded-full shrink-0 ${p.enabled ? "bg-[#00ff88]" : "bg-muted-foreground"}`} />
                      </div>
                    ))}
                  </div>
                )}
              </article>

              {bestConfig && (
                <article className="cyber-surface p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-amber-400" />
                    <p className="text-sm font-semibold text-foreground">Melhor config</p>
                  </div>
                  <div className="mb-2 flex items-center justify-between">
                    <ProviderBadge provider={bestConfig.provider} />
                    <span className="text-xs font-bold text-[#00ff88]">fitness {bestConfig.fitness.toFixed(3)}</span>
                  </div>
                  <div className="space-y-1">
                    {Object.entries(bestConfig.config)
                      .filter(([k]) => k !== "reasoning" && k !== "paper_balance")
                      .map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                          <span className="tabular-nums text-foreground">{String(v as string | number | boolean)}</span>
                        </div>
                      ))}
                  </div>
                </article>
              )}

              <button
                className="flex w-full items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.02] p-3 text-left hover:bg-white/[.05] transition-colors"
                onClick={() => setLocation("/ai-integration")}
              >
                <Sparkles className="h-4 w-4 text-[#00ff88]" />
                <div>
                  <p className="text-xs font-medium text-foreground">Gerenciar provedores</p>
                  <p className="text-[11px] text-muted-foreground">Adicionar IAs e atribuir funções</p>
                </div>
                <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </aside>
          </section>

          {history && history.length > 0 && (
            <section className="cyber-surface overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">Histórico de ciclos</p>
                  <p className="mt-1 text-xs text-muted-foreground">Todos os experimentos encerrados nesta sessão.</p>
                </div>
                <span className="text-xs text-[#00ff88]">{history.length} ciclos</span>
              </div>
              {[...history].reverse().map(cycle => <CycleRow key={cycle.cycle_id} cycle={cycle as CycleSummary} />)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
