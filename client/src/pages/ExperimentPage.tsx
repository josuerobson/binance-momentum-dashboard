import { useState } from "react";
import {
  Activity,
  Bot,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Pause,
  Play,
  RefreshCw,
  Star,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { formatPercent } from "@/lib/format";
import { trpc } from "@/lib/trpc";

// ─── Provider label helpers ──────────────────────────────────────────────────
const PROVIDER_COLORS: Record<string, string> = {
  claude: "text-[#e07f5a]",
  mimo: "text-[#7db3ff]",
  gemini: "text-[#a78bfa]",
  default: "text-muted-foreground",
};

function ProviderBadge({ provider }: { provider: string }) {
  const label = provider.charAt(0).toUpperCase() + provider.slice(1);
  const color = PROVIDER_COLORS[provider] ?? PROVIDER_COLORS.default;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${color}`}>
      <Bot className="h-3 w-3" />{label}
    </span>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const map: Record<string, string> = {
    idle: "status-neutral",
    collecting_suggestions: "status-amber",
    experiment_running: "status-ok",
    analyzing: "status-amber",
  };
  const labels: Record<string, string> = {
    idle: "Aguardando",
    collecting_suggestions: "Consultando IAs",
    experiment_running: "Executando",
    analyzing: "Analisando",
  };
  return (
    <div className={`status-chip ${map[phase] ?? "status-neutral"}`}>
      <FlaskConical className="h-3.5 w-3.5" />
      {labels[phase] ?? phase}
    </div>
  );
}

// ─── Slot card ───────────────────────────────────────────────────────────────
type SlotData = {
  id: number;
  label: string;
  ai_provider: string;
  paper_balance: number;
  initial_balance: number;
  open_positions: number;
  trade_count: number;
  win_rate: number;
  avg_pnl_pct: number;
  total_pnl_pct: number;
  fitness_score: number;
  started_at: number;
  config: Record<string, unknown>;
};

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
          <p className="text-xs font-semibold tabular-nums text-foreground">{(slot.win_rate * 100).toFixed(0)}%</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Acerto</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xs font-semibold tabular-nums text-foreground">{slot.trade_count}</p>
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

// ─── Cycle history row ───────────────────────────────────────────────────────
type CycleSummary = {
  cycle_id: number;
  started_at: number;
  ended_at: number;
  slots: {
    label: string;
    ai_provider: string;
    trade_count: number;
    win_rate: number;
    avg_pnl_pct: number;
    total_pnl_pct: number;
    fitness_score: number;
    config: Record<string, unknown>;
  }[];
};

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
              <tr>
                <th>Slot</th>
                <th>IA</th>
                <th>Trades</th>
                <th>Acerto</th>
                <th>P&L %</th>
                <th>Fitness</th>
                <th>Raciocínio</th>
              </tr>
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
                  <td className="max-w-[240px] truncate text-[11px] text-muted-foreground">
                    {String(s.config?.reasoning ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Provider config panel ────────────────────────────────────────────────────
function ProviderPanel({ refetchStatus }: { refetchStatus: () => void }) {
  const [claudeEnabled, setClaudeEnabled] = useState(true);
  const [mimoEnabled, setMimoEnabled] = useState(false);
  const [mimoKey, setMimoKey] = useState("");
  const [geminiEnabled, setGeminiEnabled] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [minTrades, setMinTrades] = useState(8);
  const [maxDuration, setMaxDuration] = useState(25);

  const configure = trpc.experiment.configure.useMutation({
    onSuccess: () => { toast.success("Configuração salva."); refetchStatus(); },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    configure.mutate({
      claudeEnabled,
      mimoEnabled,
      mimoApiKey: mimoKey || undefined,
      geminiEnabled,
      geminiApiKey: geminiKey || undefined,
      minTradesPerSlot: minTrades,
      maxDurationMin: maxDuration,
    });
  };

  return (
    <div className="space-y-5">
      {/* Claude */}
      <div className="flex items-start gap-3">
        <input type="checkbox" id="claude-en" checked={claudeEnabled} onChange={e => setClaudeEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded accent-[#e07f5a]" />
        <div className="flex-1">
          <label htmlFor="claude-en" className="cursor-pointer text-sm font-medium text-foreground">Claude (Anthropic)</label>
          <p className="text-[11px] text-muted-foreground">Usa a chave Anthropic configurada no servidor</p>
        </div>
      </div>

      {/* MIMO */}
      <div className="flex items-start gap-3">
        <input type="checkbox" id="mimo-en" checked={mimoEnabled} onChange={e => setMimoEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded accent-[#7db3ff]" />
        <div className="flex-1">
          <label htmlFor="mimo-en" className="cursor-pointer text-sm font-medium text-foreground">MIMO (Xiaomi)</label>
          <input
            type="password"
            placeholder="API Key (tp-...)"
            value={mimoKey}
            onChange={e => setMimoKey(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-white/[.12] bg-white/[.04] px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-[#7db3ff]/50 focus:outline-none"
          />
        </div>
      </div>

      {/* Gemini */}
      <div className="flex items-start gap-3">
        <input type="checkbox" id="gemini-en" checked={geminiEnabled} onChange={e => setGeminiEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded accent-[#a78bfa]" />
        <div className="flex-1">
          <label htmlFor="gemini-en" className="cursor-pointer text-sm font-medium text-foreground">Gemini (Google)</label>
          <input
            type="password"
            placeholder="API Key (AIza...)"
            value={geminiKey}
            onChange={e => setGeminiKey(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-white/[.12] bg-white/[.04] px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-[#a78bfa]/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-white/[.07] pt-4">
        <div>
          <label className="block text-[11px] text-muted-foreground">Mín. trades/slot</label>
          <input type="number" min={3} max={50} value={minTrades} onChange={e => setMinTrades(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-white/[.12] bg-white/[.04] px-3 py-1.5 text-xs text-foreground focus:border-[#00ff88]/40 focus:outline-none tabular-nums" />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground">Duração máx. (min)</label>
          <input type="number" min={5} max={120} value={maxDuration} onChange={e => setMaxDuration(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-white/[.12] bg-white/[.04] px-3 py-1.5 text-xs text-foreground focus:border-[#00ff88]/40 focus:outline-none tabular-nums" />
        </div>
      </div>

      <Button size="sm" variant="outline" className="w-full text-xs" onClick={handleSave} disabled={configure.isPending}>
        {configure.isPending ? "Salvando…" : "Salvar configuração"}
      </Button>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function ExperimentPage() {
  const { data, isLoading, refetch } = trpc.experiment.status.useQuery(undefined, {
    refetchInterval: 5_000,
    retry: 1,
  });
  const { data: history } = trpc.experiment.history.useQuery(undefined, {
    refetchInterval: 15_000,
    retry: 1,
  });
  const { data: bestConfig } = trpc.experiment.bestConfig.useQuery(undefined, {
    refetchInterval: 15_000,
    retry: 1,
  });

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

  const orch = data?.orchestrator;
  const botSlots = data?.botStatus?.slots ?? [];
  const sortedSlots = [...botSlots].sort((a, b) => b.fitness_score - a.fitness_score) as SlotData[];
  const isRunning = orch?.running ?? false;
  const isAuto = orch?.autoMode ?? false;

  const totalTrades = botSlots.reduce((s, sl) => s + sl.trade_count, 0);
  const avgFitness = botSlots.length > 0
    ? botSlots.reduce((s, sl) => s + sl.fitness_score, 0) / botSlots.length
    : 0;

  return (
    <div className="page-enter">
      <PageHeader
        title="Experimentos de IA"
        description="Múltiplos agentes testam configurações em paralelo no paper trading para encontrar a estratégia mais lucrativa."
        action={<PhaseBadge phase={orch?.phase ?? "idle"} />}
      />

      {/* Summary metrics */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Ciclo atual"
          value={isRunning ? `#${orch?.currentCycleId ?? 0}` : "—"}
          detail={isRunning ? "em andamento" : "nenhum ativo"}
          icon={Activity}
          tone={isRunning ? "green" : "slate"}
        />
        <MetricCard
          label="Slots ativos"
          value={botSlots.length}
          detail={`${totalTrades} trades neste ciclo`}
          icon={FlaskConical}
          tone="amber"
        />
        <MetricCard
          label="Melhor fitness"
          value={sortedSlots[0]?.fitness_score.toFixed(3) ?? "—"}
          detail={sortedSlots[0] ? `${sortedSlots[0].label} · ${sortedSlots[0].ai_provider}` : "aguardando dados"}
          icon={Trophy}
          tone="green"
        />
        <MetricCard
          label="Ciclos históricos"
          value={history?.length ?? 0}
          detail={bestConfig ? `melhor fitness ${bestConfig.fitness.toFixed(3)}` : "sem histórico ainda"}
          icon={Star}
          tone="amber"
        />
      </section>

      {/* Controls + provider config */}
      <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_320px]">

        {/* Slot cards */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              {isRunning ? `Slots em execução — Ciclo #${orch?.currentCycleId}` : "Nenhum ciclo em andamento"}
            </p>
            <div className="flex gap-2">
              {isRunning ? (
                <Button size="sm" variant="destructive" className="gap-1.5 text-xs" onClick={() => stopCycle.mutate()} disabled={stopCycle.isPending}>
                  <Pause className="h-3.5 w-3.5" />
                  {stopCycle.isPending ? "Parando…" : "Parar ciclo"}
                </Button>
              ) : (
                <Button size="sm" className="gap-1.5 bg-[#00ff88] text-black text-xs hover:bg-[#00ff88]/90" onClick={() => startCycle.mutate()} disabled={startCycle.isPending || isAuto}>
                  <Play className="h-3.5 w-3.5" />
                  {startCycle.isPending ? "Iniciando…" : "Iniciar ciclo"}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className={`gap-1.5 text-xs ${isAuto ? "border-[#00ff88]/40 text-[#00ff88]" : ""}`}
                onClick={() => setAutoMode.mutate({ enabled: !isAuto })}
                disabled={setAutoMode.isPending}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isAuto ? "animate-spin" : ""}`} />
                Auto {isAuto ? "ligado" : "desligado"}
              </Button>
            </div>
          </div>

          {isLoading && (
            <div className="grid place-items-center py-16 text-sm text-muted-foreground">
              Carregando estado dos experimentos…
            </div>
          )}

          {!isLoading && sortedSlots.length === 0 && (
            <div className="cyber-surface grid min-h-[200px] place-items-center rounded-xl">
              <div className="text-center">
                <FlaskConical className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Inicie um ciclo para ver os slots de cada IA aqui.</p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedSlots.map((slot, i) => (
              <SlotCard key={slot.id} slot={slot} rank={i} />
            ))}
          </div>

          {orch?.lastError && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <p className="text-xs font-semibold text-rose-400">Último erro</p>
              <p className="mt-0.5 text-[11px] text-rose-300/80">{orch.lastError}</p>
            </div>
          )}
        </div>

        {/* Right panel: AI config + best config */}
        <aside className="space-y-5">
          <article className="cyber-surface p-5">
            <p className="mb-4 text-sm font-semibold text-foreground">Provedores de IA</p>
            <ProviderPanel refetchStatus={refetch} />
          </article>

          {bestConfig && (
            <article className="cyber-surface p-5">
              <div className="mb-3 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-400" />
                <p className="text-sm font-semibold text-foreground">Melhor config encontrada</p>
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
                      <span className="tabular-nums text-foreground">{String(v)}</span>
                    </div>
                  ))}
              </div>
              {bestConfig.config.reasoning && (
                <p className="mt-3 rounded bg-white/[.03] p-2 text-[10px] leading-relaxed text-muted-foreground">
                  {String(bestConfig.config.reasoning)}
                </p>
              )}
            </article>
          )}
        </aside>
      </section>

      {/* Cycle history */}
      {history && history.length > 0 && (
        <section className="cyber-surface mt-5 overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Histórico de ciclos</p>
              <p className="mt-1 text-xs text-muted-foreground">Todos os experimentos encerrados nesta sessão do servidor.</p>
            </div>
            <span className="text-xs text-[#00ff88]">{history.length} ciclos</span>
          </div>
          <div>
            {[...history].reverse().map(cycle => (
              <CycleRow key={cycle.cycle_id} cycle={cycle as CycleSummary} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
