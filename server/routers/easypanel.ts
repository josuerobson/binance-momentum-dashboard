import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";

type ServiceInspection = { status?: unknown; state?: unknown; replicas?: unknown; domains?: unknown };

let cache: { value: ServiceInspection; expiresAt: number } | null = null;

export const easypanelRouter = router({
  serviceStatus: protectedProcedure.query(async () => {
    if (cache && cache.expiresAt > Date.now()) return cache.value;
    if (!ENV.easypanelBaseUrl || !ENV.easypanelApiKey) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A integração de infraestrutura não está configurada no servidor." });
    }
    const baseUrl = ENV.easypanelBaseUrl.startsWith("http") ? ENV.easypanelBaseUrl.replace(/\/$/, "") : `https://${ENV.easypanelBaseUrl.replace(/\/$/, "")}`;
    const query = new URLSearchParams({ projectName: "binance", serviceName: "bot" });
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/inspectAppService?${query}`, {
        headers: { Authorization: `Bearer ${ENV.easypanelApiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível consultar a infraestrutura do bot." });
    }
    if (!response.ok) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "A infraestrutura do bot está temporariamente indisponível." });
    const data = await response.json() as ServiceInspection;
    const safe = { status: data.status ?? null, state: data.state ?? null, replicas: data.replicas ?? null, domains: data.domains ?? null };
    cache = { value: safe, expiresAt: Date.now() + 5_000 };
    return safe;
  }),
});
