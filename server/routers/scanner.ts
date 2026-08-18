import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";

const candidateSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  momentum_pct: z.number(),
  momentum_target_pct: z.number(),
  volume_surge: z.number(),
  volume_surge_target: z.number(),
  volume_24h: z.number(),
  spread_pct: z.number(),
  tick_count: z.number(),
  proximity_score: z.number(),
  updated_at: z.number(),
});

export type ScannerCandidate = z.infer<typeof candidateSchema>;

const responseSchema = z.object({
  count: z.number(),
  candidates: z.array(candidateSchema),
  btc_momentum_pct: z.number().nullable().optional(),
  btc_filter_ok: z.boolean().optional(),
  btc_filter_enabled: z.boolean().optional(),
  btc_filter_window_secs: z.number().optional(),
  btc_min_momentum_pct: z.number().optional(),
});

const emptyResponse = {
  count: 0,
  candidates: [] as ScannerCandidate[],
  btc_momentum_pct: null,
  btc_filter_ok: true,
  btc_filter_enabled: false,
};

export const scannerRouter = router({
  candidates: protectedProcedure.query(async () => {
    if (!ENV.botApiBaseUrl || !ENV.dashboardApiKey) return emptyResponse;
    try {
      const res = await fetch(
        `${ENV.botApiBaseUrl.replace(/\/$/, "")}/api/scanner/candidates`,
        {
          headers: { "X-Api-Key": ENV.dashboardApiKey },
          signal: AbortSignal.timeout(5_000),
        }
      );
      if (!res.ok) return emptyResponse;
      const data = await res.json();
      const parsed = responseSchema.safeParse(data);
      if (!parsed.success) return emptyResponse;
      return parsed.data;
    } catch {
      return emptyResponse;
    }
  }),
});
