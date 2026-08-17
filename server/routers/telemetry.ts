import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";

const botHealthSchema = z.object({
  status: z.string(),
  reconciliation_required: z.boolean(),
  open_positions: z.number(),
  blocked_symbols: z.number(),
  cached_symbols: z.number(),
});

const snapshotSchema = z.object({
  timestamp_ms: z.number(),
  balance: z.object({ usdt_free: z.number(), usdt_locked: z.number() }),
  positions: z.array(z.object({
    symbol: z.string(),
    entry_price: z.number(),
    quantity: z.number(),
    current_price: z.number().nullable(),
    pnl_pct: z.number().nullable(),
    pnl_usdt: z.number().nullable(),
    entry_order_id: z.number().nullable(),
    order_list_id: z.number().nullable(),
    opened_at: z.number(),
  })),
  symbols: z.object({ pending: z.array(z.string()), blocked: z.array(z.string()), cached_count: z.number() }),
  health: botHealthSchema,
  request_weight: z.object({ used_weight: z.number(), limit: z.number(), window_seconds_remaining: z.number() }),
  mode: z.object({ use_testnet: z.boolean(), dry_run: z.boolean() }),
});

const signalsSchema = z.object({
  count: z.number(),
  signals: z.array(z.object({
    symbol: z.string(),
    current_price: z.number(),
    pct_change: z.number(),
    volume_surge: z.number(),
    bid: z.number(),
    ask: z.number(),
    detected_at: z.number(),
  })),
});

const configSchema = z.object({
  mode: z.object({ use_testnet: z.boolean(), dry_run: z.boolean(), allow_live_trading: z.boolean() }),
  scanner: z.object({
    momentum_trigger_pct: z.number(),
    momentum_window_secs: z.number(),
    volume_surge_multiplier: z.number(),
    max_spread_pct: z.number(),
  }),
  risk: z.object({
    stop_loss_pct: z.number(),
    take_profit_1_pct: z.number(),
    take_profit_2_pct: z.number(),
    max_positions: z.number(),
    position_size_pct: z.number(),
    min_24h_volume_usdt: z.number(),
  }),
});

type CacheEntry = { value: unknown; expiresAt: number };
const telemetryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 2_000;

function requireBotConfiguration() {
  if (!ENV.botApiBaseUrl || !ENV.dashboardApiKey) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A telemetria do bot não está configurada no servidor." });
  }
}

async function readBotJson(path: string, cacheKey: string, authenticated: boolean) {
  const now = Date.now();
  const cached = telemetryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  requireBotConfiguration();
  let response: Response;
  try {
    response = await fetch(`${ENV.botApiBaseUrl.replace(/\/$/, "")}${path}`, {
      headers: authenticated ? { "X-Api-Key": ENV.dashboardApiKey } : undefined,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível alcançar o bot no momento." });
  }
  if (!response.ok) {
    throw new TRPCError({
      code: response.status === 401 || response.status === 403 ? "BAD_GATEWAY" : "SERVICE_UNAVAILABLE",
      message: "A telemetria do bot está temporariamente indisponível.",
    });
  }
  const data: unknown = await response.json().catch(() => null);
  telemetryCache.set(cacheKey, { value: data, expiresAt: now + CACHE_TTL_MS });
  return data;
}

function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "O bot retornou uma resposta de telemetria inválida." });
  }
  return parsed.data;
}

export const telemetryRouter = router({
  health: protectedProcedure.query(async () => validate(botHealthSchema, await readBotJson("/health", "health", false))),
  snapshot: protectedProcedure.query(async () => validate(snapshotSchema, await readBotJson("/api/snapshot", "snapshot", true))),
  positions: protectedProcedure.query(async () => {
    const snapshot = validate(snapshotSchema, await readBotJson("/api/snapshot", "snapshot", true));
    return { positions: snapshot.positions, timestamp_ms: snapshot.timestamp_ms };
  }),
  signals: protectedProcedure.query(async () => validate(signalsSchema, await readBotJson("/api/signals", "signals", true))),
  config: protectedProcedure.query(async () => validate(configSchema, await readBotJson("/api/config", "config", true))),
});

export type Snapshot = z.infer<typeof snapshotSchema>;
export type BotHealth = z.infer<typeof botHealthSchema>;
