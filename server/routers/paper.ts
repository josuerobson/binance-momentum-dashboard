import mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPool } from "../_core/db";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";

const paperPositionSchema = z.object({
  symbol: z.string(),
  entry_price: z.number(),
  quantity: z.number(),
  virtual_usdt: z.number(),
  stop_price: z.number(),
  take_profit_price: z.number(),
  opened_at: z.number(),
  stop_loss_pct: z.number(),
  take_profit_pct: z.number(),
  momentum_trigger_pct: z.number(),
  momentum_window_secs: z.number(),
  volume_surge_multiplier: z.number(),
});

const paperPositionsResponseSchema = z.object({
  count: z.number(),
  paper_balance: z.number(),
  positions: z.array(paperPositionSchema),
});

const paperTradeSchema = z.object({
  symbol: z.string(),
  entry_price: z.number(),
  exit_price: z.number(),
  quantity: z.number(),
  virtual_usdt: z.number(),
  pnl_usdt: z.number(),
  pnl_pct: z.number(),
  exit_reason: z.string(),
  opened_at: z.number(),
  closed_at: z.number(),
  duration_ms: z.number(),
  stop_loss_pct: z.number(),
  take_profit_pct: z.number(),
  momentum_trigger_pct: z.number(),
  momentum_window_secs: z.number(),
  volume_surge_multiplier: z.number(),
});

const paperHistoryResponseSchema = z.object({
  count: z.number(),
  wins: z.number(),
  losses: z.number(),
  win_rate_pct: z.number(),
  total_pnl_usdt: z.number(),
  paper_balance: z.number(),
  history: z.array(paperTradeSchema),
});

export type PaperTrade = z.infer<typeof paperTradeSchema>;

function requireBot() {
  if (!ENV.botApiBaseUrl || !ENV.dashboardApiKey) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Bot não configurado." });
  }
}

async function fetchBot<T>(path: string): Promise<T> {
  requireBot();
  let res: Response;
  try {
    res = await fetch(`${ENV.botApiBaseUrl.replace(/\/$/, "")}${path}`, {
      headers: { "X-Api-Key": ENV.dashboardApiKey },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível alcançar o bot." });
  }
  if (!res.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "Bot retornou erro." });
  return res.json() as Promise<T>;
}

async function syncTradesToDb(trades: PaperTrade[]) {
  if (!trades.length || !ENV.databaseUrl) return;
  const pool = getPool();
  for (const t of trades) {
    try {
      await pool.query(
        `INSERT IGNORE INTO paper_trades
          (symbol, entry_price, exit_price, quantity, virtual_usdt, pnl_usdt, pnl_pct,
           exit_reason, opened_at, closed_at, duration_ms, stop_loss_pct, take_profit_pct,
           momentum_trigger_pct, momentum_window_secs, volume_surge_multiplier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.symbol, t.entry_price, t.exit_price, t.quantity, t.virtual_usdt,
          t.pnl_usdt, t.pnl_pct, t.exit_reason, t.opened_at, t.closed_at,
          t.duration_ms, t.stop_loss_pct, t.take_profit_pct,
          t.momentum_trigger_pct, t.momentum_window_secs, t.volume_surge_multiplier,
        ]
      );
    } catch {
      // ignore duplicate / db errors
    }
  }
}

async function getDbHistory(limit = 500): Promise<PaperTrade[]> {
  if (!ENV.databaseUrl) return [];
  try {
    const pool = getPool();
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM paper_trades ORDER BY closed_at DESC LIMIT ?`,
      [limit]
    );
    return rows as unknown as PaperTrade[];
  } catch {
    return [];
  }
}

export const paperRouter = router({
  positions: protectedProcedure.query(async () => {
    const raw = await fetchBot<unknown>("/api/paper/positions");
    const parsed = paperPositionsResponseSchema.safeParse(raw);
    if (!parsed.success) throw new TRPCError({ code: "BAD_GATEWAY", message: "Resposta inválida do bot." });
    return parsed.data;
  }),

  history: protectedProcedure.query(async () => {
    const raw = await fetchBot<unknown>("/api/paper/history");
    const parsed = paperHistoryResponseSchema.safeParse(raw);
    if (!parsed.success) throw new TRPCError({ code: "BAD_GATEWAY", message: "Resposta inválida do bot." });
    void syncTradesToDb(parsed.data.history);
    return parsed.data;
  }),

  allHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(1000).default(500) }).optional())
    .query(async ({ input }) => {
      try {
        const raw = await fetchBot<unknown>("/api/paper/history");
        const parsed = paperHistoryResponseSchema.safeParse(raw);
        if (parsed.success) void syncTradesToDb(parsed.data.history);
      } catch { /* best-effort */ }
      return getDbHistory(input?.limit ?? 500);
    }),

  updateConfig: protectedProcedure
    .input(z.object({
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
      btc_filter_enabled: z.boolean().optional(),
      btc_filter_window_secs: z.number().int().min(30).max(3600).optional(),
      btc_min_momentum_pct: z.number().min(-10).max(10).optional(),
      trailing_stop_enabled: z.boolean().optional(),
      trailing_stop_distance_pct: z.number().min(0.1).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      requireBot();
      let res: Response;
      try {
        res = await fetch(`${ENV.botApiBaseUrl.replace(/\/$/, "")}/api/runtime/config`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": ENV.dashboardApiKey,
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível atualizar o bot." });
      }
      if (!res.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "Bot recusou a atualização." });
      return res.json();
    }),

  runtimeConfig: protectedProcedure.query(async () => {
    return fetchBot<unknown>("/api/runtime/config");
  }),
});
