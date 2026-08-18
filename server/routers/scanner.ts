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

export const scannerRouter = router({
  candidates: protectedProcedure.query(async () => {
    if (!ENV.botApiBaseUrl || !ENV.dashboardApiKey) {
      return { count: 0, candidates: [] as ScannerCandidate[] };
    }
    try {
      const res = await fetch(
        `${ENV.botApiBaseUrl.replace(/\/$/, "")}/api/scanner/candidates`,
        {
          headers: { "X-Api-Key": ENV.dashboardApiKey },
          signal: AbortSignal.timeout(5_000),
        }
      );
      if (!res.ok) return { count: 0, candidates: [] as ScannerCandidate[] };
      const data = await res.json();
      const parsed = z
        .object({ count: z.number(), candidates: z.array(candidateSchema) })
        .safeParse(data);
      if (!parsed.success) return { count: 0, candidates: [] as ScannerCandidate[] };
      return parsed.data;
    } catch {
      return { count: 0, candidates: [] as ScannerCandidate[] };
    }
  }),
});
