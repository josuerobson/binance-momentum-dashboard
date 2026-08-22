import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
import { orchestrator, ExperimentStatus } from "../services/experimentOrchestrator";
import type { SlotConfig } from "../services/aiAdvisors";
import { callProvider, getAssignedProviders } from "../services/aiRegistry";

function requireBot() {
  if (!ENV.botApiBaseUrl || !ENV.dashboardApiKey) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Bot não configurado." });
  }
}

async function fetchBot<T>(path: string, opts?: RequestInit): Promise<T> {
  requireBot();
  let res: Response;
  try {
    res = await fetch(`${ENV.botApiBaseUrl.replace(/\/$/, "")}${path}`, {
      ...opts,
      headers: { "X-Api-Key": ENV.dashboardApiKey, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível alcançar o bot." });
  }
  if (!res.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `Bot retornou ${res.status}.` });
  return res.json() as Promise<T>;
}

// ─── 20 configurações matemáticas fixas ──────────────────────────────────────
// Grupo A (8 slots): entrada fixa, variação de R:R
// Grupo B (6 slots): saídas fixas, variação de entrada
// Grupo C (6 slots): combinações balanceadas

type MathSlot = { id: number; label: string; ai_provider: string; config: SlotConfig };

const COMMON = {
  position_size_pct: 10,
  max_positions: 3,
  paper_balance: 10000,
  max_spread_pct: 0.3,
  min_24h_volume_usdt: 25_000_000,
  btc_filter_enabled: true,
  btc_filter_window_secs: 300,
  btc_min_momentum_pct: 0,
  trailing_stop_enabled: true,
};

const MATH_SLOTS: MathSlot[] = [
  // ── Grupo A — entrada w=60s m=2.0% v=3.0x, variação de stop/gain ──────────
  { id: 0,  label: "A1 — SL 1.0 / TP 2.0", ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60, momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 1.0, take_profit_pct: 2.0, trailing_stop_distance_pct: 1.0, reasoning: "Grupo A — R:R 2.0, SL apertado" } },
  { id: 1,  label: "A2 — SL 1.5 / TP 3.0", ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60, momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 1.5, take_profit_pct: 3.0, trailing_stop_distance_pct: 1.5, reasoning: "Grupo A — R:R 2.0 equilibrado" } },
  { id: 2,  label: "A3 — SL 2.0 / TP 3.5", ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60, momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 2.0, take_profit_pct: 3.5, trailing_stop_distance_pct: 2.0, reasoning: "Grupo A — base de referência" } },
  { id: 3,  label: "A4 — SL 2.0 / TP 4.0", ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60, momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 2.0, take_profit_pct: 4.0, trailing_stop_distance_pct: 2.0, reasoning: "Grupo A — R:R 2.0 ampliado" } },
  { id: 4,  label: "A5 — SL 2.5 / TP 5.0", ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60, momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 2.5, take_profit_pct: 5.0, trailing_stop_distance_pct: 2.5, reasoning: "Grupo A — SL/TP maiores, mesmo R:R" } },
  { id: 5,  label: "A6 — SL 3.0 / TP 6.0", ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60, momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 3.0, take_profit_pct: 6.0, trailing_stop_distance_pct: 3.0, reasoning: "Grupo A — stops amplos, R:R 2.0" } },
  { id: 6,  label: "A7 — SL 1.5 / TP 4.5", ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60, momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 1.5, take_profit_pct: 4.5, trailing_stop_distance_pct: 1.5, reasoning: "Grupo A — R:R 3.0 alto" } },
  { id: 7,  label: "A8 — SL 1.0 / TP 3.5", ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60, momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 1.0, take_profit_pct: 3.5, trailing_stop_distance_pct: 1.0, reasoning: "Grupo A — R:R 3.5, máxima assimetria" } },
  // ── Grupo B — saídas sl=2.0 tp=3.5 trail=2.0, variação de entrada ─────────
  { id: 8,  label: "B1 — W30 M1.5 V2.0",   ai_provider: "math", config: { ...COMMON, momentum_window_secs: 30,  momentum_trigger_pct: 1.5, volume_surge_multiplier: 2.0, stop_loss_pct: 2.0, take_profit_pct: 3.5, trailing_stop_distance_pct: 2.0, reasoning: "Grupo B — janela curta, limiar baixo, alta freq" } },
  { id: 9,  label: "B2 — W30 M2.5 V3.5",   ai_provider: "math", config: { ...COMMON, momentum_window_secs: 30,  momentum_trigger_pct: 2.5, volume_surge_multiplier: 3.5, stop_loss_pct: 2.0, take_profit_pct: 3.5, trailing_stop_distance_pct: 2.0, reasoning: "Grupo B — janela curta, sinal mais seletivo" } },
  { id: 10, label: "B3 — W60 M1.5 V2.5",   ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60,  momentum_trigger_pct: 1.5, volume_surge_multiplier: 2.5, stop_loss_pct: 2.0, take_profit_pct: 3.5, trailing_stop_distance_pct: 2.0, reasoning: "Grupo B — janela base, entrada mais frequente" } },
  { id: 11, label: "B4 — W60 M3.0 V4.0",   ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60,  momentum_trigger_pct: 3.0, volume_surge_multiplier: 4.0, stop_loss_pct: 2.0, take_profit_pct: 3.5, trailing_stop_distance_pct: 2.0, reasoning: "Grupo B — janela base, sinal muito seletivo" } },
  { id: 12, label: "B5 — W90 M2.0 V3.0",   ai_provider: "math", config: { ...COMMON, momentum_window_secs: 90,  momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 2.0, take_profit_pct: 3.5, trailing_stop_distance_pct: 2.0, reasoning: "Grupo B — janela longa, padrão equilibrado" } },
  { id: 13, label: "B6 — W120 M3.0 V4.0",  ai_provider: "math", config: { ...COMMON, momentum_window_secs: 120, momentum_trigger_pct: 3.0, volume_surge_multiplier: 4.0, stop_loss_pct: 2.0, take_profit_pct: 3.5, trailing_stop_distance_pct: 2.0, reasoning: "Grupo B — janela máxima, sinal conservador" } },
  // ── Grupo C — combinações cruzadas ────────────────────────────────────────
  { id: 14, label: "C1 — W30 R:R 3.0",     ai_provider: "math", config: { ...COMMON, momentum_window_secs: 30,  momentum_trigger_pct: 1.5, volume_surge_multiplier: 2.0, stop_loss_pct: 1.5, take_profit_pct: 4.5, trailing_stop_distance_pct: 1.5, reasoning: "Grupo C — frequente + R:R alto" } },
  { id: 15, label: "C2 — W30 Agressivo",   ai_provider: "math", config: { ...COMMON, momentum_window_secs: 30,  momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 1.0, take_profit_pct: 3.0, trailing_stop_distance_pct: 1.0, reasoning: "Grupo C — entrada rápida + SL apertado" } },
  { id: 16, label: "C3 — W120 Conservador", ai_provider: "math", config: { ...COMMON, momentum_window_secs: 120, momentum_trigger_pct: 3.0, volume_surge_multiplier: 4.0, stop_loss_pct: 3.0, take_profit_pct: 6.0, trailing_stop_distance_pct: 3.0, reasoning: "Grupo C — conservador em tudo" } },
  { id: 17, label: "C4 — W90 Balanceado",  ai_provider: "math", config: { ...COMMON, momentum_window_secs: 90,  momentum_trigger_pct: 2.5, volume_surge_multiplier: 3.5, stop_loss_pct: 2.5, take_profit_pct: 5.0, trailing_stop_distance_pct: 2.5, reasoning: "Grupo C — balanceado em todos os eixos" } },
  { id: 18, label: "C5 — W60 Moderado",    ai_provider: "math", config: { ...COMMON, momentum_window_secs: 60,  momentum_trigger_pct: 1.5, volume_surge_multiplier: 2.0, stop_loss_pct: 1.5, take_profit_pct: 3.0, trailing_stop_distance_pct: 1.5, reasoning: "Grupo C — moderado, alta frequência de entrada" } },
  { id: 19, label: "C6 — W90 Ampliado",    ai_provider: "math", config: { ...COMMON, momentum_window_secs: 90,  momentum_trigger_pct: 2.0, volume_surge_multiplier: 3.0, stop_loss_pct: 2.0, take_profit_pct: 4.0, trailing_stop_distance_pct: 2.0, reasoning: "Grupo C — janela estendida, TP ampliado" } },
];

// ─── Router ───────────────────────────────────────────────────────────────────
export const experimentRouter = router({
  status: protectedProcedure.query(async () => {
    const botStatus = await fetchBot<ExperimentStatus>("/api/experiment/status").catch(() => null);
    const orch = orchestrator.getState();
    return {
      botStatus,
      orchestrator: {
        running: orch.running,
        autoMode: orch.autoMode,
        phase: orch.phase,
        currentCycleId: orch.currentCycleId,
        cycleStartedAt: orch.cycleStartedAt,
        longRunStartedAt: orch.longRunStartedAt,
        longRunDeadlineAt: orch.longRunDeadlineAt,
        lastError: orch.lastError,
        minTradesPerSlot: orch.minTradesPerSlot,
        maxDurationMs: orch.maxDurationMs,
      },
    };
  }),

  history: protectedProcedure.query(() => {
    return orchestrator.getState().history;
  }),

  bestConfig: protectedProcedure.query(() => {
    return orchestrator.getBestConfig();
  }),

  configure: protectedProcedure
    .input(z.object({
      minTradesPerSlot: z.number().int().min(3).max(50).optional(),
      maxDurationMin: z.number().int().min(5).max(120).optional(),
    }))
    .mutation(({ input }) => {
      orchestrator.configure(input.minTradesPerSlot, input.maxDurationMin);
      return { ok: true };
    }),

  startCycle: protectedProcedure.mutation(async () => {
    requireBot();
    if (orchestrator.getState().running) {
      throw new TRPCError({ code: "CONFLICT", message: "Ciclo já está em andamento." });
    }
    try {
      return await orchestrator.startCycle();
    } catch (e) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
    }
  }),

  stopCycle: protectedProcedure.mutation(async () => {
    const result = await orchestrator.stopCycle();
    return { ok: true, cycle: result };
  }),

  setAutoMode: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      if (input.enabled) orchestrator.startAutoMode();
      else orchestrator.stopAutoMode();
      return { ok: true, autoMode: input.enabled };
    }),

  resetSlots: protectedProcedure
    .input(z.object({ balance: z.number().min(100).max(1_000_000).optional() }))
    .mutation(async ({ input }) => {
      await fetchBot<{ ok: boolean }>("/api/experiment/reset", {
        method: "POST",
        body: JSON.stringify({ balance: input.balance ?? 10000 }),
      });
      return { ok: true };
    }),

  // ─── Experimento 30 Dias — 20 configs matemáticas fixas ─────────────────
  start30Days: protectedProcedure.mutation(async () => {
    requireBot();
    if (orchestrator.getState().running) {
      throw new TRPCError({ code: "CONFLICT", message: "Um experimento já está em andamento. Pare-o primeiro." });
    }
    try {
      return await orchestrator.startLongRun(MATH_SLOTS);
    } catch (e) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
    }
  }),

  stop30Days: protectedProcedure.mutation(async () => {
    orchestrator.clearLongRun();
    const result = await orchestrator.stopCycle();
    return { ok: true, cycle: result };
  }),

  // Re-sends 20 slot configs to bot after bot restart without resetting balance/timestamps
  recover30Days: protectedProcedure.mutation(async () => {
    requireBot();
    try {
      return await orchestrator.recoverLongRun(MATH_SLOTS);
    } catch (e) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(e) });
    }
  }),

  // AI analysis comparing 20 experiment slots vs paper trading main engine
  compareWithPaper: protectedProcedure.mutation(async () => {
    requireBot();

    // Fetch both data sources in parallel
    const [expStatus, paperRes] = await Promise.allSettled([
      fetchBot<ExperimentStatus>("/api/experiment/status"),
      fetchBot<{ trades: unknown[]; paper_balance: number; win_rate_pct: number; total_pnl_usdt: number }>("/api/paper/history"),
    ]);

    const expSlots = expStatus.status === "fulfilled" ? (expStatus.value.slots ?? []) : [];
    const paper = paperRes.status === "fulfilled" ? paperRes.value : null;
    const paperTrades = (paper?.trades ?? []) as Array<{
      symbol: string; pnl_usdt: number; pnl_pct: number; exit_reason: string; closed_at: number;
    }>;

    if (expSlots.length === 0 && !paper) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Sem dados do experimento ou do paper trading para analisar." });
    }

    // Build paper trading summary
    const paperWins = paperTrades.filter(t => t.pnl_usdt > 0).length;
    const paperTotal = paperTrades.length;
    const paperWinRate = paperTotal > 0 ? (paperWins / paperTotal) * 100 : 0;
    const paperPnlUsdt = paperTrades.reduce((s, t) => s + t.pnl_usdt, 0);
    const paperBalance = paper?.paper_balance ?? (10000 + paperPnlUsdt);

    // Build slots summary (sorted by fitness)
    const slotsSummary = [...expSlots]
      .sort((a, b) => b.fitness_score - a.fitness_score)
      .map(s => ({
        label: s.label,
        balance: s.paper_balance,
        initial: s.initial_balance,
        pnl_usdt: s.paper_balance - s.initial_balance,
        pnl_pct: s.total_pnl_pct,
        win_rate: (s.win_rate * 100).toFixed(1) + "%",
        trades: s.trade_count,
        fitness: s.fitness_score.toFixed(3),
        config_highlights: {
          window: s.config?.momentum_window_secs,
          trigger_pct: s.config?.momentum_trigger_pct,
          sl: s.config?.stop_loss_pct,
          tp: s.config?.take_profit_pct,
        },
      }));

    const prompt = `Você é um analista quantitativo especializado em crypto trading. Analise os dados abaixo e gere um relatório comparativo em português.

## Paper Trading Principal (motor de produção)
- Saldo atual: ${paperBalance.toFixed(2)} USDT (inicial: 10000)
- P&L total: ${paperPnlUsdt >= 0 ? "+" : ""}${paperPnlUsdt.toFixed(2)} USDT (${((paperPnlUsdt / 10000) * 100).toFixed(2)}%)
- Win rate: ${paperWinRate.toFixed(1)}%
- Total trades: ${paperTotal}
- Últimos 10 trades: ${JSON.stringify(paperTrades.slice(0, 10).map(t => ({ symbol: t.symbol, pnl: t.pnl_usdt.toFixed(2), exit: t.exit_reason })))}

## Experimento 30 Dias — 20 Slots Matemáticos
Total de slots: ${expSlots.length}
Total trades no experimento: ${expSlots.reduce((s, sl) => s + sl.trade_count, 0)}

### Rankings por fitness:
${slotsSummary.slice(0, 20).map((s, i) => `${i + 1}. **${s.label}** | Balance: ${s.balance.toFixed(0)} USDT | P&L: ${s.pnl_usdt >= 0 ? "+" : ""}${s.pnl_usdt.toFixed(2)} USDT (${s.pnl_pct >= 0 ? "+" : ""}${typeof s.pnl_pct === "number" ? s.pnl_pct.toFixed(2) : s.pnl_pct}%) | WR: ${s.win_rate} | Trades: ${s.trades} | Fitness: ${s.fitness} | Config: W${s.config_highlights.window}s M${s.config_highlights.trigger_pct}% SL${s.config_highlights.sl}% TP${s.config_highlights.tp}%`).join("\n")}

## Sua análise deve responder:
1. Quais slots do experimento superam o paper trading principal? Por quê?
2. Qual configuração vencedora deve ser aplicada ao motor de produção?
3. O que explica a diferença de performance entre slots com parâmetros similares?
4. Qual grupo (A/B/C) apresenta melhor resultado e por quê?
5. Recomendação final: manter configuração atual, aplicar melhor slot, ou aguardar mais dados?

Responda em JSON com este formato exato:
{
  "summary": "resumo executivo em 2-3 frases",
  "winner_slot": "nome do slot vencedor ou null",
  "paper_vs_experiment": "comparação direta em 2-3 frases",
  "top_3": [{"slot": "nome", "reason": "por que é promissor"}],
  "worst_3": [{"slot": "nome", "reason": "por que está mal"}],
  "recommendation": "apply_winner | wait_more_data | keep_current | stop_experiment",
  "recommendation_reason": "justificativa da recomendação",
  "config_to_apply": {"momentum_window_secs": 0, "momentum_trigger_pct": 0, "stop_loss_pct": 0, "take_profit_pct": 0} | null,
  "key_insights": ["insight 1", "insight 2", "insight 3"]
}`;

    let providers: Awaited<ReturnType<typeof getAssignedProviders>> = [];
    try { providers = await getAssignedProviders("experiment_advisor"); } catch { /* ok */ }
    if (providers.length === 0) {
      try { providers = await getAssignedProviders("advisor"); } catch { /* ok */ }
    }
    if (providers.length === 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Nenhum provedor de IA configurado. Configure em Integração IA." });
    }

    const provider = providers[0]!;
    const raw = await callProvider(provider, [{ role: "user", content: prompt }], undefined, 4096);

    // Extract JSON from response
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "IA não retornou JSON válido." });

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(match[0]); } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "JSON da IA não pôde ser parseado." });
    }

    return {
      analysis: parsed,
      meta: {
        provider: provider.name,
        slotsAnalyzed: expSlots.length,
        paperTrades: paperTotal,
        analyzedAt: Date.now(),
      },
    };
  }),
});
