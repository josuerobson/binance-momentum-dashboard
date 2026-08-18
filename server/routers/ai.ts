import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
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

function buildPrompt(trades: PaperTrade[], currentConfig: unknown): string {
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

  return `Você é um analista de trading quantitativo especializado em estratégias de momentum em criptomoedas. Analise os dados de um bot de paper trading (simulação com dados reais da Binance) e forneça recomendações para otimizar os parâmetros.

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
Com base nesses dados:
1. Analise o que está funcionando e o que não está na estratégia atual.
2. Identifique padrões (ex: qual janela de tempo produz mais acertos, se o stop está muito apertado, etc).
3. Sugira ajustes específicos e justificados nos parâmetros.

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
      if (!ENV.anthropicApiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ANTHROPIC_API_KEY não configurada no servidor.",
        });
      }

      const trades = input.trades as PaperTrade[];
      const prompt = buildPrompt(trades, input.currentConfig);

      let res: Response;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ENV.anthropicApiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 2048,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível alcançar a API de IA." });
      }

      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `API de IA retornou erro ${res.status}: ${err.slice(0, 200)}`,
        });
      }

      const apiResponse = await res.json() as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = apiResponse.content?.find(b => b.type === "text")?.text ?? "";

      let parsed: { analysis: string; suggested_config: SuggestedConfig; rationale: string };
      try {
        parsed = JSON.parse(text);
      } catch {
        // If Claude returns non-JSON, wrap it
        parsed = {
          analysis: text,
          suggested_config: {},
          rationale: "",
        };
      }

      const configValidation = suggestedConfigSchema.safeParse(parsed.suggested_config ?? {});

      return {
        analysis: parsed.analysis ?? "",
        rationale: parsed.rationale ?? "",
        suggested_config: configValidation.success ? configValidation.data : {},
        raw: text,
      };
    }),
});
