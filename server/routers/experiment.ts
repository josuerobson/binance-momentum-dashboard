import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
import { orchestrator, ExperimentStatus } from "../services/experimentOrchestrator";

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
});
