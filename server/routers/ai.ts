import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
import { callProvider, getAssignedProviders } from "../services/aiRegistry";
import { saveAnalysis, markAnalysisApplied, getRecentAnalyses, type AnalysisRecord } from "../services/aiAnalysisLog";
import { getPrompt } from "../services/promptRegistry";
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

const aiResponseSchema = z.object({
  analysis: z.string(),
  key_findings: z.array(z.string()).optional(),
  red_flags: z.array(z.string()).optional(),
  dont_change: z.array(z.string()).optional(),
  priority_changes: z.array(z.object({
    param: z.string(),
    from: z.union([z.number(), z.string()]),
    to: z.union([z.number(), z.string()]),
    reason: z.string(),
  })).optional(),
  confidence_level: z.enum(["baixa", "média", "alta"]).optional(),
  suggested_config: suggestedConfigSchema,
  rationale: z.string(),
});

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

async function buildPrompt(trades: PaperTrade[], currentConfig: unknown, history: AnalysisRecord[]): Promise<string> {
  const total = trades.length;
  const winTrades = trades.filter(t => t.pnl_usdt > 0);
  const lossTrades = trades.filter(t => t.pnl_usdt <= 0);
  const wins = winTrades.length;
  const losses = lossTrades.length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl_usdt, 0);
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  const avgWin = wins > 0 ? winTrades.reduce((s, t) => s + t.pnl_pct, 0) / wins : 0;
  const avgLoss = losses > 0 ? Math.abs(lossTrades.reduce((s, t) => s + t.pnl_pct, 0) / losses) : 0;
  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

  const tpTrades = trades.filter(t => t.exit_reason === "TP");
  const slTrades = trades.filter(t => t.exit_reason === "SL");
  const trailTrades = trades.filter(t => t.exit_reason === "TRAILING");

  const avgDurAll = total ? Math.round(trades.reduce((s, t) => s + t.duration_ms, 0) / total / 1000) : 0;
  const avgDurTP = tpTrades.length ? Math.round(tpTrades.reduce((s, t) => s + t.duration_ms, 0) / tpTrades.length / 1000) : 0;
  const avgDurSL = slTrades.length ? Math.round(slTrades.reduce((s, t) => s + t.duration_ms, 0) / slTrades.length / 1000) : 0;

  const maxWin = wins > 0 ? Math.max(...winTrades.map(t => t.pnl_pct)) : 0;
  const maxLoss = losses > 0 ? Math.min(...lossTrades.map(t => t.pnl_pct)) : 0;

  // Consecutive loss streak
  let maxConsecLoss = 0, consecLoss = 0;
  for (const t of trades) {
    if (t.pnl_usdt <= 0) { consecLoss++; maxConsecLoss = Math.max(maxConsecLoss, consecLoss); }
    else consecLoss = 0;
  }

  // Per-symbol breakdown
  const bySymbol: Record<string, { count: number; wins: number; pnl: number }> = {};
  for (const t of trades) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { count: 0, wins: 0, pnl: 0 };
    bySymbol[t.symbol].count++;
    if (t.pnl_usdt > 0) bySymbol[t.symbol].wins++;
    bySymbol[t.symbol].pnl += t.pnl_usdt;
  }
  const symbolLines = Object.entries(bySymbol)
    .sort((a, b) => b[1].pnl - a[1].pnl)
    .map(([sym, s]) => `  ${sym}: ${s.count} trades | win rate ${((s.wins / s.count) * 100).toFixed(0)}% | P&L ${s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)} USDT`)
    .join("\n");

  const confidenceHint = total < 10
    ? "⚠️ AMOSTRA MUITO PEQUENA (< 10 trades): seja extremamente conservador. Máximo 1-2 ajustes pequenos. NÃO faça mudanças drásticas."
    : total < 30
    ? "⚠️ Amostra pequena (< 30 trades): seja conservador. Prefira ajustes incrementais e avalie os resultados antes de mudanças maiores."
    : total < 100
    ? "Amostra moderada (< 100 trades): ajustes razoáveis são permitidos, mas evite otimização excessiva (overfitting)."
    : "Amostra robusta (100+ trades): análise estatística mais confiável. Ajustes mais assertivos são justificados.";

  const recentTrades = trades
    .slice(0, 30)
    .map((t, i) =>
      `#${i + 1} ${t.symbol} | ${t.exit_reason} | P&L: ${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(2)}% (${t.pnl_usdt >= 0 ? "+" : ""}${t.pnl_usdt.toFixed(2)} USDT) | duração: ${Math.round(t.duration_ms / 1000)}s | janela: ${t.momentum_window_secs}s | gatilho: ${t.momentum_trigger_pct}% | surto: ${t.volume_surge_multiplier}x | SL cfg: ${t.stop_loss_pct}% | TP cfg: ${t.take_profit_pct}%`
    )
    .join("\n");

  const historySection = buildHistorySection(history, trades);
  const [intro, request] = await Promise.all([
    getPrompt("market_analysis_intro"),
    getPrompt("market_analysis_request"),
  ]);

  return `${intro}
${historySection}
## CONFIGURAÇÃO ATUAL DO BOT
${JSON.stringify(currentConfig, null, 2)}

## ESTATÍSTICAS COMPUTADAS (${total} operações)
${confidenceHint}

### Resumo geral
- Win rate: ${winRate.toFixed(1)}% (${wins} ganhos / ${losses} perdas)
- P&L total: ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} USDT
- P&L médio por trade vencedor: +${avgWin.toFixed(2)}%
- P&L médio por trade perdedor: -${avgLoss.toFixed(2)}%
- Expectância por trade: ${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(3)}% (positivo = estratégia lucrativa no longo prazo)
- Maior ganho individual: +${maxWin.toFixed(2)}%
- Maior perda individual: ${maxLoss.toFixed(2)}%
- Sequência máxima de perdas consecutivas: ${maxConsecLoss}

### Por tipo de saída
- Take Profit (TP): ${tpTrades.length} trades | duração média: ${avgDurTP}s
- Stop Loss (SL): ${slTrades.length} trades | duração média: ${avgDurSL}s
- Trailing Stop: ${trailTrades.length} trades
- Duração média geral: ${avgDurAll}s

### Performance por símbolo
${symbolLines || "  Nenhum símbolo ainda"}

## ÚLTIMOS ${Math.min(30, total)} TRADES (do mais recente ao mais antigo)
${recentTrades || "Nenhuma operação registrada ainda."}

${request}`;
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
      const prompt = await buildPrompt(trades, input.currentConfig, history);

      let text: string;
      try {
        console.log(`[ai.analyze] calling AI, provider=${provider?.name ?? "ENV"}, trades=${trades.length}`);
        if (provider) {
          text = await callProvider(provider, [{ role: "user", content: prompt }], undefined, 3500);
        } else {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": ENV.anthropicApiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 3500, messages: [{ role: "user", content: prompt }] }),
            signal: AbortSignal.timeout(45_000),
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            console.error(`[ai.analyze] API error ${res.status}: ${errBody.slice(0, 200)}`);
            throw new Error(`${res.status}: ${errBody.slice(0, 200)}`);
          }
          const data = await res.json() as { content?: { type: string; text?: string }[] };
          text = data.content?.find(b => b.type === "text")?.text ?? "";
        }
        console.log(`[ai.analyze] AI responded, text length=${text.length}`);
      } catch (e) {
        console.error(`[ai.analyze] caught error:`, e);
        throw new TRPCError({ code: "BAD_GATEWAY", message: `Erro na API de IA: ${String(e).slice(0, 200)}` });
      }

      // Strip markdown fences, then extract the JSON object from anywhere in the text
      const fenceStripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      const jsonMatch = fenceStripped.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : fenceStripped;

      let parsed: z.infer<typeof aiResponseSchema>;
      try {
        const raw = JSON.parse(jsonStr);
        const validation = aiResponseSchema.safeParse(raw);
        if (!validation.success) console.warn("[ai.analyze] zod validation failed:", JSON.stringify(validation.error?.issues?.slice(0, 3)));
        parsed = validation.success ? validation.data : { ...raw, suggested_config: raw.suggested_config ?? {}, analysis: raw.analysis ?? fenceStripped, rationale: raw.rationale ?? "" };
      } catch (parseErr) {
        console.error("[ai.analyze] JSON.parse failed:", String(parseErr).slice(0, 200));
        console.error("[ai.analyze] jsonStr start:", JSON.stringify(jsonStr.slice(0, 150)));
        // Fix literal control chars inside JSON strings and trailing commas
        try {
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
          const fixed = chars.join("").replace(/,(\s*[}\]])/g, "$1");
          const raw = JSON.parse(fixed);
          const validation = aiResponseSchema.safeParse(raw);
          parsed = validation.success ? validation.data : { ...raw, suggested_config: raw.suggested_config ?? {}, analysis: raw.analysis ?? fenceStripped, rationale: raw.rationale ?? "" };
          console.log("[ai.analyze] JSON fixed by escaping newlines in strings");
        } catch {
          parsed = { analysis: fenceStripped, suggested_config: {}, rationale: "", confidence_level: "baixa" };
        }
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
        key_findings: parsed.key_findings ?? [],
        red_flags: parsed.red_flags ?? [],
        dont_change: parsed.dont_change ?? [],
        priority_changes: parsed.priority_changes ?? [],
        confidence_level: parsed.confidence_level ?? "baixa",
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
