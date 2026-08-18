import { AlertTriangle, Bot, CheckCircle, Clock, Loader2, Sliders, Trash2, TrendingUp, Zap } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";

// Parse AI JSON that may contain literal newlines/tabs inside string values
function repairAndParse(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const stripped = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
  const jsonStr = stripped.match(/\{[\s\S]*\}/)?.[0] ?? stripped;
  if (!jsonStr.startsWith("{")) return null;

  // Direct parse first
  try { return JSON.parse(jsonStr) as Record<string, unknown>; } catch { /* fall through */ }

  // Escape literal control chars inside string values
  let inStr = false, esc = false;
  const chars: string[] = [];
  for (const ch of jsonStr) {
    if (esc) { esc = false; chars.push(ch); continue; }
    if (ch === "\\" && inStr) { esc = true; chars.push(ch); continue; }
    if (ch === '"') { inStr = !inStr; chars.push(ch); continue; }
    if (inStr) {
      if (ch === "\n") { chars.push("\\n"); continue; }
      if (ch === "\r") { chars.push("\\r"); continue; }
      if (ch === "\t") { chars.push("\\t"); continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) { chars.push(`\\u${code.toString(16).padStart(4, "0")}`); continue; }
    }
    chars.push(ch);
  }
  // Also remove trailing commas before } or ]
  const fixed = chars.join("").replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(fixed) as Record<string, unknown>; } catch { /* fall through */ }

  // Last resort: regex field extraction — handles truncated JSON (hit token limit mid-response)
  const extractStr = (key: string): string | undefined => {
    const m = jsonStr.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\[\\s\\S])*)"`));
    return m ? m[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t") : undefined;
  };
  const extractStrArr = (key: string): string[] => {
    const m = jsonStr.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) return [];
    const items: string[] = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let item;
    while ((item = re.exec(m[1])) !== null) items.push(item[1]);
    return items;
  };
  const analysisText = extractStr("analysis");
  if (analysisText) {
    return {
      analysis: analysisText,
      key_findings: extractStrArr("key_findings"),
      red_flags: extractStrArr("red_flags"),
      dont_change: extractStrArr("dont_change"),
      confidence_level: extractStr("confidence_level") ?? "baixa",
      rationale: extractStr("rationale") ?? "",
      priority_changes: [],
      suggested_config: {},
    };
  }
  return null;
}

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

type NumericField = { [K in keyof Config]: Config[K] extends number ? K : never }[keyof Config];
type BooleanField = { [K in keyof Config]: Config[K] extends boolean ? K : never }[keyof Config];

function ConfigField({ label, field, value, onChange }: {
  label: string; field: NumericField; value: number; onChange: (f: NumericField, v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[.06] py-2.5 text-sm last:border-0">
      <label className="text-muted-foreground">{label}</label>
      <input
        type="number" step="any" value={value}
        onChange={e => onChange(field, parseFloat(e.target.value) || 0)}
        className="w-28 rounded-md border border-white/10 bg-white/[.04] px-2 py-1 text-right text-foreground focus:border-[#00ff88]/40 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/20"
      />
    </div>
  );
}

function BoolConfigField({ label, field, value, onChange }: {
  label: string; field: BooleanField; value: boolean; onChange: (f: BooleanField, v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[.06] py-2.5 text-sm last:border-0">
      <label className="text-muted-foreground">{label}</label>
      <button type="button" onClick={() => onChange(field, !value)}
        className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none ${value ? "bg-[#00ff88]/70" : "bg-white/10"}`}>
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function HistoryCard({ item, onDelete }: { item: {
  id: number; created_at: string; trade_count: number; win_rate_pct: number;
  total_pnl_usdt: number; applied_at: string | null; config_after: Record<string, unknown> | null;
  config_before: Record<string, unknown> | null;
}; onDelete: (id: number) => void }) {
  const applied = !!item.applied_at;
  const appliedDate = item.applied_at ? new Date(item.applied_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
  const createdDate = new Date(item.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const changes: string[] = [];
  if (applied && item.config_before && item.config_after) {
    for (const [k, v] of Object.entries(item.config_after)) {
      const before = item.config_before[k];
      if (before !== undefined && before !== v) {
        changes.push(`${k.replace(/_/g, " ")}: ${before} → ${v}`);
      }
    }
  }

  return (
    <div className={`rounded-lg border p-3 text-xs ${applied ? "border-[#00ff88]/20 bg-[#00ff88]/5" : "border-white/[.07] bg-white/[.02]"}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="font-medium text-foreground">{createdDate}</span>
          <span className="ml-2 text-muted-foreground">· {item.trade_count} trades</span>
        </div>
        <div className="flex items-center gap-2">
          {applied ? (
            <span className="flex items-center gap-1 rounded-full bg-[#00ff88]/10 px-2 py-0.5 text-[10px] font-semibold text-[#00ff88]">
              <CheckCircle className="h-3 w-3" /> Aplicada {appliedDate}
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-white/[.05] px-2 py-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" /> Não aplicada
            </span>
          )}
          <button
            onClick={() => onDelete(item.id)}
            className="rounded p-0.5 text-muted-foreground hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
            title="Excluir análise"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex gap-4 text-muted-foreground">
        <span>Win rate: <strong className="text-foreground">{item.win_rate_pct.toFixed(1)}%</strong></span>
        <span>P&L: <strong className={item.total_pnl_usdt >= 0 ? "text-[#00ff88]" : "text-rose-400"}>
          {item.total_pnl_usdt >= 0 ? "+" : ""}{formatMoney(item.total_pnl_usdt)} USDT
        </strong></span>
      </div>
      {changes.length > 0 && (
        <div className="mt-2 text-[11px] text-muted-foreground/70">
          Ajustes: {changes.slice(0, 3).join(" · ")}{changes.length > 3 ? ` +${changes.length - 3}` : ""}
        </div>
      )}
    </div>
  );
}

export default function AIAnalysisPage() {
  const { data: history } = trpc.paper.allHistory.useQuery({ limit: 200 });
  const { data: runtimeConfig } = trpc.paper.runtimeConfig.useQuery(undefined, { retry: 1 });
  const { data: analysisHistory, refetch: refetchHistory } = trpc.ai.getHistory.useQuery();

  const [localConfig, setLocalConfig] = useState<Partial<Config>>({});
  const [analysis, setAnalysis] = useState<{
    analysisId: number;
    analysis: string;
    key_findings: string[];
    red_flags: string[];
    dont_change: string[];
    priority_changes: { param: string; from: number | string; to: number | string; reason: string }[];
    confidence_level: string;
    rationale: string;
    suggested_config: Partial<Config>;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  const deleteHistoryMutation = trpc.ai.deleteHistory.useMutation({ onSuccess: () => refetchHistory() });
  const clearHistoryMutation = trpc.ai.clearHistory.useMutation({ onSuccess: () => refetchHistory() });

  const handleDeleteHistory = (id: number) => {
    if (confirm("Excluir esta análise do histórico?")) deleteHistoryMutation.mutate({ id });
  };

  const handleClearHistory = () => {
    if (confirm("Excluir todo o histórico de análises da IA?")) clearHistoryMutation.mutate();
  };

  const analyzeMutation = trpc.ai.analyze.useMutation({
    onSuccess: data => {
      // If server-side JSON parsing failed, analysis contains raw JSON text — try client-side repair
      let parsed = data as typeof data & { analysis: string };
      if (parsed.analysis?.trim().startsWith("{")) {
        const raw = repairAndParse(data.raw ?? parsed.analysis);
        if (raw && typeof raw.analysis === "string") {
          parsed = {
            ...parsed,
            analysis: raw.analysis,
            key_findings: Array.isArray(raw.key_findings) ? raw.key_findings as string[] : parsed.key_findings,
            red_flags: Array.isArray(raw.red_flags) ? raw.red_flags as string[] : parsed.red_flags,
            dont_change: Array.isArray(raw.dont_change) ? raw.dont_change as string[] : parsed.dont_change,
            priority_changes: Array.isArray(raw.priority_changes) ? raw.priority_changes as typeof parsed.priority_changes : parsed.priority_changes,
            confidence_level: typeof raw.confidence_level === "string" ? raw.confidence_level as "baixa" | "média" | "alta" : parsed.confidence_level,
            rationale: typeof raw.rationale === "string" ? raw.rationale : parsed.rationale,
            suggested_config: (raw.suggested_config as Partial<Config>) ?? parsed.suggested_config,
          };
        }
      }

      setAnalysis({
        ...parsed,
        key_findings: parsed.key_findings ?? [],
        red_flags: parsed.red_flags ?? [],
        dont_change: parsed.dont_change ?? [],
        priority_changes: (parsed.priority_changes ?? []) as { param: string; from: number | string; to: number | string; reason: string }[],
        confidence_level: parsed.confidence_level ?? "baixa",
        suggested_config: parsed.suggested_config as Partial<Config>,
      });
      if (parsed.suggested_config && Object.keys(parsed.suggested_config).length > 0) {
        setLocalConfig(prev => ({ ...prev, ...parsed.suggested_config }));
      }
    },
  });

  const markAppliedMutation = trpc.ai.markApplied.useMutation({
    onSuccess: () => {
      setSaveStatus("saved");
      refetchHistory();
    },
    onError: (err) => console.error("[markApplied] failed:", err.message),
  });

  const updateConfigMutation = trpc.paper.updateConfig.useMutation({
    onSuccess: () => {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    },
  });

  const rt = runtimeConfig as Config | undefined;
  const effective: Config = {
    momentum_window_secs: 60, momentum_trigger_pct: 2.5, volume_surge_multiplier: 2.0,
    max_spread_pct: 0.3, min_24h_volume_usdt: 5_000_000, stop_loss_pct: 1.5,
    take_profit_pct: 3.0, position_size_pct: 10, max_positions: 2, paper_balance: 10_000,
    btc_filter_enabled: true, btc_filter_window_secs: 300, btc_min_momentum_pct: 0,
    trailing_stop_enabled: true, trailing_stop_distance_pct: 1.5,
    ...rt, ...localConfig,
  };

  const handleChange = (field: NumericField, value: number) => setLocalConfig(prev => ({ ...prev, [field]: value }));
  const handleBoolChange = (field: BooleanField, value: boolean) => setLocalConfig(prev => ({ ...prev, [field]: value }));

  const handleAnalyze = () => {
    analyzeMutation.mutate({ trades: history ?? [], currentConfig: effective });
  };

  const handleApply = () => {
    if (!effective.momentum_window_secs) return;
    updateConfigMutation.mutate(effective);
    // Mark this analysis as applied so the AI knows in future analyses
    if (analysis?.analysisId) {
      markAppliedMutation.mutate({
        analysisId: analysis.analysisId,
        configAfter: effective as unknown as Record<string, unknown>,
      });
    }
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
          <button onClick={handleAnalyze} disabled={analyzeMutation.isPending || tradeCount < 1}
            className="flex items-center gap-2 rounded-lg border border-[#00ff88]/30 bg-[#00ff88]/10 px-4 py-2 text-sm font-medium text-[#00ff88] transition hover:bg-[#00ff88]/15 disabled:cursor-not-allowed disabled:opacity-50">
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
        {/* Left column — config editor + stats */}
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
              <button onClick={handleApply}
                disabled={updateConfigMutation.isPending || !Object.keys(localConfig).length}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-[#0a0f1a] transition hover:bg-[#00ff88]/85 disabled:cursor-not-allowed disabled:opacity-50">
                {updateConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Aplicar ao bot
              </button>
              {saveStatus === "saved" && (
                <div className="flex items-center gap-1.5 text-sm text-[#00ff88]">
                  <CheckCircle className="h-4 w-4" /> Aplicado
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

        {/* Right column — analysis + history */}
        <div className="space-y-5">
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
                {/* Confidence + red flags */}
                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${
                    analysis.confidence_level === "alta" ? "bg-[#00ff88]/10 border-[#00ff88]/30 text-[#00ff88]"
                    : analysis.confidence_level === "média" ? "bg-amber-400/10 border-amber-400/30 text-amber-400"
                    : "bg-rose-400/10 border-rose-400/30 text-rose-400"
                  }`}>
                    <Zap className="h-3 w-3" />
                    Confiança {analysis.confidence_level}
                  </span>
                </div>

                {analysis.red_flags.length > 0 && (
                  <section className="rounded-lg border border-rose-400/25 bg-rose-400/8 p-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rose-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> Alertas críticos
                    </h3>
                    <ul className="space-y-1">
                      {analysis.red_flags.map((f, i) => (
                        <li key={i} className="text-sm text-rose-300 flex gap-2"><span className="flex-shrink-0">⚠</span>{f}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {analysis.key_findings.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sky-400">Observações-chave</h3>
                    <ul className="space-y-1.5">
                      {analysis.key_findings.map((f, i) => (
                        <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                          <span className="text-sky-400 flex-shrink-0">→</span>{f}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#00ff88]">Análise completa</h3>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{analysis.analysis}</p>
                </section>

                {analysis.priority_changes.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">Ajustes prioritários</h3>
                    <div className="space-y-2">
                      {analysis.priority_changes.map((c, i) => (
                        <div key={i} className="rounded-lg border border-white/[.07] bg-white/[.02] px-3 py-2 text-xs">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-[#00ff88]">{c.param}</span>
                            <span className="text-muted-foreground">{String(c.from)}</span>
                            <span className="text-amber-400">→</span>
                            <span className="font-semibold text-foreground">{String(c.to)}</span>
                          </div>
                          <p className="text-muted-foreground">{c.reason}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {analysis.dont_change.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Não alterar</h3>
                    <div className="flex flex-wrap gap-2">
                      {analysis.dont_change.map(p => (
                        <span key={p} className="rounded-md border border-white/[.08] bg-white/[.03] px-2 py-0.5 font-mono text-xs text-muted-foreground">{p}</span>
                      ))}
                    </div>
                  </section>
                )}

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
                        <div key={k}>
                          <span className={analysis.dont_change.includes(k) ? "text-slate-500" : "text-[#00ff88]"}>{k}</span>: {String(v)}
                          {analysis.dont_change.includes(k) && <span className="ml-2 text-slate-600">(mantido)</span>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <div className="flex items-center gap-2 rounded-lg border border-[#00ff88]/20 bg-[#00ff88]/5 px-3 py-2 text-xs text-[#00ff88]">
                  <TrendingUp className="h-3.5 w-3.5 flex-shrink-0" />
                  Ao clicar <strong className="mx-1">Aplicar ao bot</strong>, esta análise é registrada. A próxima análise saberá quais ajustes foram feitos e avaliará se funcionaram.
                </div>
              </div>
            )}
          </article>

          {/* Analysis history */}
          {(analysisHistory ?? []).length > 0 && (
            <article className="cyber-surface p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">Histórico de análises</h2>
                </div>
                <button
                  onClick={handleClearHistory}
                  disabled={clearHistoryMutation.isLoading}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-rose-400 hover:bg-rose-400/10 transition-colors disabled:opacity-50"
                  title="Limpar todo o histórico"
                >
                  <Trash2 className="h-3 w-3" />
                  Limpar tudo
                </button>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">A IA usa este histórico para avaliar se suas sugestões anteriores funcionaram.</p>
              <div className="space-y-2">
                {(analysisHistory ?? []).map(item => (
                  <HistoryCard key={item.id} item={item} onDelete={handleDeleteHistory} />
                ))}
              </div>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}
