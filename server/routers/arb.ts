import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";

const opportunitySchema = z.object({
  id: z.number(),
  direction: z.string(),
  path: z.string(),
  base: z.string(),
  btc_usdt_price: z.number(),
  alt_btc_price: z.number(),
  alt_usdt_price: z.number(),
  gross_pct: z.number(),
  fees_pct: z.number(),
  net_pct: z.number(),
  detected_at: z.number(),
});

export type ArbOpportunity = z.infer<typeof opportunitySchema>;

const responseSchema = z.object({
  count: z.number(),
  triangles_monitored: z.number(),
  profitable_count: z.number(),
  best_net_pct: z.number().nullable().optional(),
  opportunities: z.array(opportunitySchema),
});

const emptyResponse = {
  count: 0,
  triangles_monitored: 0,
  profitable_count: 0,
  best_net_pct: null,
  opportunities: [] as ArbOpportunity[],
};

export const arbRouter = router({
  opportunities: protectedProcedure.query(async () => {
    if (!ENV.botApiBaseUrl || !ENV.dashboardApiKey) return emptyResponse;
    try {
      const res = await fetch(
        `${ENV.botApiBaseUrl.replace(/\/$/, "")}/api/arb/opportunities`,
        {
          headers: { "X-Api-Key": ENV.dashboardApiKey },
          signal: AbortSignal.timeout(6_000),
        }
      );
      if (!res.ok) return emptyResponse;
      const data = await res.json();
      const parsed = responseSchema.safeParse(data);
      return parsed.success ? parsed.data : emptyResponse;
    } catch {
      return emptyResponse;
    }
  }),
});
