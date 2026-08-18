import { Bot, CheckCircle, Loader2, Sliders } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";

type Config = {
  momentum_window_secs: number;
  momentum_trigger_pct: number;
  volume_surge_multiplier: number;
  max_spread_pct: number;
  min_24h_volume_usdt: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  position_size_pct: number;
  max_positions: number;
  paper_balance: number;
  btc_filter_enabled: boolean;
  btc_filter_window_secs: number;
  btc_min_momentum_pct: number;
  trailing_stop_enabled: boolean;
  trailing_stop_distance_pct: number;
};

type NumericField = {
  [K in keyof Config]: Config[K] extends number ? K : never;
}[keyof Config];

type BooleanField = {
  [K in keyof Config]: Config[K] extends boolean ? K : never;
}[keyof Config];

function ConfigField({
  label, field, value, onChange,
}: {
  label: string; field: NumericField; value: number; onChange: (f: NumericField, v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[.06] py-2.5 text-sm last:border-0">
      <label className="text-muted-foreground">{label}</label>
      <input
        type="number"
        step="any"
        value={value}
        onChange={e => onChange(field, parseFloat(e.target.value) || 0)}
        className="w-28 rounded-md border border-white/10 bg-white/[.04] px-2 py-1 text-right text-foreground focus:border-[#00ff88]/40 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/20"
      />
    </div>
  );
}

function BoolConfigField({
  label, field, value, onChange,
}: {
  label: string; field: BooleanField; value: boolean; onChange: (f: BooleanField, v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[.06] py-2.5 text-sm last:border-0">
      <label className="text-muted-foreground">{label}</label>
      <button
        type="button"
        onClick={() => onChange(field, !value)}
        className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none ${value ? "bg-[#00ff88]/70" : "bg-white/10"}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

export default function AIAnalysisPage() {
  const { data: history } = trpc.paper.allHistory.useQuery({ limit: 200 });
  const { data: runtimeConfig } = trpc.paper.runtimeConfig.useQuery(undefined, { retry: 1 });

  const [localConfig, setLocalConfig] = useState<Partial<Config>>({});
  const [analysis, setAnalysis] = useState<{ analysis: string; rationale: string; suggested_config: Partial<Config> } | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  const analyzeMutation = trpc.ai.analyze.useMutation({
    onSuccess: data => {
      setAnalysis(data);
      if (data.suggested_config && Object.keys(data.suggested_config).length > 0) {
        setLocalConfig(prev => ({ ...prev, ...data.suggested_config }));
      }
    },
  });

  const updateConfigMutation = trpc.paper.updateConfig.useMutation({
    onSuccess: () => {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
  });

  const rt = runtimeConfig as Config | undefined;
  const effective: Config = {
    momentum_window_secs: 60,
    momentum_trigger_pct: 2.5,
    volume_surge_multiplier: 2.0,
    max_spread_pct: 0.3,
    min_24h_volume_usdt: 5_000_000,
    stop_loss_pct: 1.5,
    take_profit_pct: 3.0,
    position_size_pct: 10,
    max_positions: 2,
    paper_balance: 10_000,
    btc_filter_enabled: true,
    btc_filter_window_secs: 300,
    btc_min_momentum_pct: 0,
    trailing_stop_enabled: true,
    trailing_stop_distance_pct: 1.5,
    ...rt,
    ...localConfig,
  };

  const handleChange = (field: NumericField, value: number) => {
    setLocalConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleBoolChange = (field: BooleanField, value: boolean) => {
    setLocalConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleAnalyze = () => {
    analyzeMutation.mutate({
      trades: history ?? [],
      currentConfig: effective,
    });
  };

  const handleApply = () => {
    if (!effective.momentum_window_secs) return;
    updateConfigMutation.mutate(effective);
  };

  const tradeCount = history?.length ?? 0;
  const wins = (history ?? []).filter((t: { pnl_usdt: number }) => t.pnl_usdt > 0).length;
  const winRate = tradeCount > 0 ? (wins / tradeCount * 100).toFixed(1) : "0";
  const totalPnl = (history ?? []).reduce((s: number, t: { pnl_usdt: number }) => s + t.pnl_usdt, 0);
  const avgPnl = tradeCount > 0 ? totalPnl / tradeCount : 0;

  return (
    <div className="page-enter">
      <PageHeader
        title="Análise com IA"
        description="Ajuste dinâmico de parâmetros com base no histórico de paper trading e análise por IA."
        action={
          <button
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending || tradeCount < 1}
            className="flex items-center gap-2 rounded-lg border border-[#00ff88]/30 bg-[#00ff88]/10 px-4 py-2 text-sm font-medium text-[#00ff88] transition hover:bg-[#00ff88]/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            {analyzeMutation.isPending ? "Analisando…" : "Analisar com IA"}
          </button>
        }
      />

      {analyzeMutation.error && (
        <div className="mb-5 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          {analyzeMutation.error.message}
        </div>
      )}

      <section className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-5">
          <article className="cyber-surface p-5">
            <div className="mb-4 flex items-center gap-2">
              <Sliders className="h-4 w-4 text-[#00ff88]" />
              <h2 className="text-sm font-semibold text-foreground">Parâmetros dinâmicos</h2>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">Edite e aplique ao bot sem reiniciar. A IA pode sugerir ajustes após análise.</p>

            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Sinal</p>
            <ConfigField label="Janela de momentum (s)" field="momentum_window_secs" value={effective.momentum_window_secs} onChange={handleChange} />
            <ConfigField label="Gatilho de momentum (%)" field="momentum_trigger_pct" value={effective.momentum_trigger_pct} onChange={handleChange} />
            <ConfigField label="Surto de volume (x)" field="volume_surge_multiplier" value={effective.volume_surge_multiplier} onChange={handleChange} />
            <ConfigField label="Spread máximo (%)" field="max_spread_pct" value={effective.max_spread_pct} onChange={handleChange} />
            <ConfigField label="Volume mín. 24h (USDT)" field="min_24h_volume_usdt" value={effective.min_24h_volume_usdt} onChange={handleChange} />

            <p className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Risco</p>
            <ConfigField label="Stop loss (%)" field="stop_loss_pct" value={effective.stop_loss_pct} onChange={handleChange} />
            <ConfigField label="Take profit (%)" field="take_profit_pct" value={effective.take_profit_pct} onChange={handleChange} />
            <ConfigField label="Tamanho da posição (%)" field="position_size_pct" value={effective.position_size_pct} onChange={handleChange} />
            <ConfigField label="Máx. posições" field="max_positions" value={effective.max_positions} onChange={handleChange} />
            <ConfigField label="Saldo virtual (USDT)" field="paper_balance" value={effective.paper_balance} onChange={handleChange} />

            <p className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Filtro BTC</p>
            <BoolConfigField label="Filtro BTC ativo" field="btc_filter_enabled" value={effective.btc_filter_enabled} onChange={handleBoolChange} />
            <ConfigField label="Janela BTC (s)" field="btc_filter_window_secs" value={effective.btc_filter_window_secs} onChange={handleChange} />
            <ConfigField label="Momentum BTC mínimo (%)" field="btc_min_momentum_pct" value={effective.btc_min_momentum_pct} onChange={handleChange} />

            <p className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Trailing Stop</p>
            <BoolConfigField label="Trailing stop ativo" field="trailing_stop_enabled" value={effective.trailing_stop_enabled} onChange={handleBoolChange} />
            <ConfigField label="Distância trailing (%)" field="trailing_stop_distance_pct" value={effective.trailing_stop_distance_pct} onChange={handleChange} />

            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={handleApply}
                disabled={updateConfigMutation.isPending || !Object.keys(localConfig).length}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-[#0a0f1a] transition hover:bg-[#00ff88]/85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updateConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Aplicar ao bot
              </button>
              {saveStatus === "saved" && (
                <div className="flex items-center gap-1.5 text-sm text-[#00ff88]">
                  <CheckCircle className="h-4 w-4" />
                  Aplicado
                </div>
              )}
            </div>
            {updateConfigMutation.error && (
              <p className="mt-2 text-xs text-rose-300">{updateConfigMutation.error.message}</p>
            )}
          </article>

          <article className="cyber-surface p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Resumo de performance</h2>
            {[
              ["Operações", tradeCount],
              ["Taxa de acerto", `${winRate}%`],
              ["P&L total", `${totalPnl >= 0 ? "+" : ""}${formatMoney(totalPnl)} USDT`],
              ["P&L médio/op", `${avgPnl >= 0 ? "+" : ""}${formatMoney(avgPnl)} USDT`],
            ].map(([l, v]) => (
              <div key={l as string} className="flex items-center justify-between border-b border-white/[.06] py-2.5 text-sm last:border-0">
                <span className="text-muted-foreground">{l}</span>
                <span className="font-medium text-foreground">{v}</span>
              </div>
            ))}
            {tradeCount < 5 && (
              <p className="mt-3 text-xs text-amber-400">Aguardando mais operações para uma análise significativa (mínimo 5).</p>
            )}
          </article>
        </div>

        <article className="cyber-surface p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#00ff88]" />
            <h2 className="text-sm font-semibold text-foreground">Análise da IA</h2>
          </div>

          {analyzeMutation.isPending && (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-[#00ff88]" />
              <p className="text-sm">Analisando {tradeCount} operações…</p>
            </div>
          )}

          {!analyzeMutation.isPending && !analysis && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <Bot className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p>Clique em <strong className="text-foreground">Analisar com IA</strong> para receber uma análise do histórico e sugestões de parâmetros.</p>
              {tradeCount < 1 && <p className="mt-2 text-amber-400">Aguardando dados de paper trading.</p>}
            </div>
          )}

          {analysis && (
            <div className="space-y-5">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#00ff88]">Análise</h3>
                <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{analysis.analysis}</p>
              </section>
              {analysis.rationale && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">Justificativa dos ajustes</h3>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{analysis.rationale}</p>
                </section>
              )}
              {analysis.suggested_config && Object.keys(analysis.suggested_config).length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Parâmetros sugeridos (aplicados ao editor acima)</h3>
                  <div className="rounded-lg border border-white/[.07] bg-white/[.02] p-3 text-xs font-mono text-muted-foreground">
                    {Object.entries(analysis.suggested_config).map(([k, v]) => (
                      <div key={k}><span className="text-[#00ff88]">{k}</span>: {String(v)}</div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
