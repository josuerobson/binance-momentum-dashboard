import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
import { callProvider, getAssignedProviders } from "../services/aiRegistry";
import { saveAnalysis, markAnalysisApplied, getRecentAnalyses, type AnalysisRecord } from "../services/aiAnalysisLog";
import type { PaperTrade } from "./paper";

const suggestedConfigSchema = z.object({
  momentum_window_secs: z.number().int().min(10).max(3600),
  momentum_trigger_pct: z.number().min(0.1).max(50),
  volume_surge_multiplier: z.number().min(0.1).max(100),
  max_spread_pct: z.number().min(0.01).max(10),
  min_24h_volume_usdt: z.number().min(0),
  stop_loss_pct: z.number().min(0.1).max(50),
  take_profit_pct: z.number().min(0.1).max(100),
  position_size_pct: z.number().min(0.1).max(100),
  max_positions: z.number().int().min(1).max(50),
  paper_balance: z.number().min(0),
}).partial();

export type SuggestedConfig = z.infer<typeof suggestedConfigSchema>;

function buildHistorySection(history: AnalysisRecord[], allTrades: PaperTrade[]): string {
  if (history.length === 0) return "";

  const lines: string[] = ["\n## Histórico de análises anteriores"];
  lines.push("Use estas informações para avaliar se suas sugestões anteriores funcionaram e refinar sua análise atual.\n");

  for (const h of history) {
    const appliedLabel = h.applied_at
      ? `✅ Aplicada em ${h.applied_at.toString().slice(0, 16)}`
      : "⏭ Não aplicada";

    lines.push(`### Análise de ${h.created_at.toString().slice(0, 16)} (base: ${h.trade_count} trades)`);
    lines.push(`- Win rate na época: ${h.win_rate_pct.toFixed(1)}% | P&L: ${h.total_pnl_usdt >= 0 ? "+" : ""}${h.total_pnl_usdt.toFixed(2)} USDT`);
    lines.push(`- Status: ${appliedLabel}`);

    if (h.applied_at && h.config_after) {
      // Compute trades that happened after this config was applied
      const appliedTs = new Date(h.applied_at).getTime();
      const tradesSince = allTrades.filter(t => t.closed_at > appliedTs);
      const winsSince = tradesSince.filter(t => t.pnl_usdt > 0).length;
      const pnlSince = tradesSince.reduce((s, t) => s + t.pnl_usdt, 0);
      const winRateSince = tradesSince.length > 0
        ? ((winsSince / tradesSince.length) * 100).toFixed(1)
        : "n/a";

      const changes: string[] = [];
      if (h.config_before && h.config_after) {
        for (const [k, v] of Object.entries(h.config_after)) {
          const before = (h.config_before as Record<string, unknown>)[k];
          if (before !== undefined && before !== v) {
            changes.push(`${k}: ${before} → ${v}`);
          }
        }
      }
      if (changes.length > 0) {
        lines.push(`- Mudanças aplicadas: ${changes.join(", ")}`);
      }

      if (tradesSince.length > 0) {
        lines.push(`- Resultado desde a aplicação: ${tradesSince.length} trades | win rate ${winRateSince}% | P&L ${pnlSince >= 0 ? "+" : ""}${pnlSince.toFixed(2)} USDT`);
        const tpSince = tradesSince.filter(t => t.exit_reason === "TP").length;
        const slSince = tradesSince.filter(t => t.exit_reason === "SL").length;
        lines.push(`  (TP: ${tpSince} | SL: ${slSince})`);
      } else {
        lines.push("- Nenhum trade registrado desde a aplicação.");
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function buildPrompt(trades: PaperTrade[], currentConfig: unknown, history: AnalysisRecord[]): string {
  const total = trades.length;
  const wins = trades.filter(t => t.pnl_usdt > 0).length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl_usdt, 0);
  const avgDuration = total
    ? Math.round(trades.reduce((s, t) => s + t.duration_ms, 0) / total / 1000)
    : 0;
  const tpCount = trades.filter(t => t.exit_reason === "TP").length;
  const slCount = trades.filter(t => t.exit_reason === "SL").length;

  const recentTrades = trades
    .slice(0, 30)
    .map(t =>
      `${t.symbol} | entrada: ${t.entry_price.toFixed(6)} | saída: ${t.exit_price.toFixed(6)} | P&L: ${t.pnl_pct.toFixed(2)}% (${t.pnl_usdt.toFixed(2)} USDT) | motivo: ${t.exit_reason} | duração: ${Math.round(t.duration_ms / 1000)}s | janela: ${t.momentum_window_secs}s | gatilho: ${t.momentum_trigger_pct}% | surto: ${t.volume_surge_multiplier}x | SL: ${t.stop_loss_pct}% | TP: ${t.take_profit_pct}%`
    )
    .join("\n");

  const historySection = buildHistorySection(history, trades);

  return `Você é um analista de trading quantitativo especializado em estratégias de momentum em criptomoedas. Analise os dados de um bot de paper trading (simulação com dados reais da Binance) e forneça recomendações para otimizar os parâmetros.
${historySection}
## Configuração atual do bot
${JSON.stringify(currentConfig, null, 2)}

## Estatísticas gerais (${total} operações)
- Taxa de acerto: ${total > 0 ? ((wins / total) * 100).toFixed(1) : 0}% (${wins} ganhos / ${total - wins} perdas)
- P&L total: ${totalPnl.toFixed(2)} USDT
- Take Profit atingido: ${tpCount} vezes
- Stop Loss atingido: ${slCount} vezes
- Duração média: ${avgDuration}s

## Últimas ${Math.min(30, total)} operações
${recentTrades || "Nenhuma operação registrada ainda."}

## Solicitação
Com base nesses dados e no histórico de análises anteriores (se houver):
1. Avalie se as sugestões anteriores tiveram o efeito esperado nos trades subsequentes.
2. Analise o que está funcionando e o que não está na estratégia atual.
3. Identifique padrões (ex: qual janela de tempo produz mais acertos, se o stop está muito apertado, etc).
4. Sugira ajustes específicos e justificados nos parâmetros.

Responda SOMENTE com JSON válido neste formato exato (sem markdown, sem texto fora do JSON):
{
  "analysis": "análise em português (3-5 parágrafos)",
  "suggested_config": {
    "momentum_window_secs": <número>,
    "momentum_trigger_pct": <número>,
    "volume_surge_multiplier": <número>,
    "max_spread_pct": <número>,
    "min_24h_volume_usdt": <número>,
    "stop_loss_pct": <número>,
    "take_profit_pct": <número>,
    "position_size_pct": <número>,
    "max_positions": <número>,
    "paper_balance": <número>
  },
  "rationale": "justificativa dos ajustes (2-3 parágrafos)"
}`;
}

export const aiRouter = router({
  analyze: protectedProcedure
    .input(z.object({
      trades: z.array(z.any()).max(200),
      currentConfig: z.any(),
    }))
    .mutation(async ({ input }) => {
      const assigned = await getAssignedProviders("market_analysis").catch(() => []);
      const provider = assigned[0] ?? null;

      if (!provider && !ENV.anthropicApiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Nenhum provedor de IA configurado para Análise de Mercado. Configure em Integração IA.",
        });
      }

      const trades = input.trades as PaperTrade[];
      const history = await getRecentAnalyses(3).catch(() => [] as AnalysisRecord[]);
      const prompt = buildPrompt(trades, input.currentConfig, history);

      let text: string;
      try {
        if (provider) {
          text = await callProvider(provider, [{ role: "user", content: prompt }], undefined, 3500);
        } else {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": ENV.anthropicApiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 3500, messages: [{ role: "user", content: prompt }] }),
            signal: AbortSignal.timeout(60_000),
          });
          if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
          const data = await res.json() as { content?: { type: string; text?: string }[] };
          text = data.content?.find(b => b.type === "text")?.text ?? "";
        }
      } catch (e) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: `Erro na API de IA: ${String(e).slice(0, 200)}` });
      }

      // Strip markdown code fences that some models add despite instructions
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

      let parsed: { analysis: string; suggested_config: SuggestedConfig; rationale: string };
      try {
        parsed = JSON.parse(stripped);
      } catch {
        parsed = { analysis: stripped, suggested_config: {}, rationale: "" };
      }

      const configValidation = suggestedConfigSchema.safeParse(parsed.suggested_config ?? {});
      const validConfig = configValidation.success ? configValidation.data : {};

      // Compute stats for logging
      const total = trades.length;
      const wins = trades.filter(t => t.pnl_usdt > 0).length;
      const totalPnl = trades.reduce((s, t) => s + t.pnl_usdt, 0);
      const winRate = total > 0 ? (wins / total) * 100 : 0;

      const analysisId = await saveAnalysis({
        trade_count: total,
        win_rate_pct: winRate,
        total_pnl_usdt: totalPnl,
        analysis_text: parsed.analysis ?? "",
        rationale_text: parsed.rationale ?? "",
        suggested_config: validConfig as Record<string, unknown>,
        config_before: (input.currentConfig as Record<string, unknown>) ?? {},
      }).catch(() => 0);

      return {
        analysisId,
        analysis: parsed.analysis ?? "",
        rationale: parsed.rationale ?? "",
        suggested_config: validConfig,
        raw: text,
      };
    }),

  markApplied: protectedProcedure
    .input(z.object({
      analysisId: z.number().int().positive(),
      configAfter: z.record(z.unknown()),
    }))
    .mutation(async ({ input }) => {
      await markAnalysisApplied(input.analysisId, input.configAfter);
      return { ok: true };
    }),

  getHistory: protectedProcedure.query(async () => {
    return getRecentAnalyses(5);
  }),
});
