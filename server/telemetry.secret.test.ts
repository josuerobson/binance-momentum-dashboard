import { describe, expect, it } from "vitest";

describe("telemetria do bot protegida", () => {
  it("aceita a chave de dashboard no endpoint de configuração", async () => {
    const baseUrl = process.env.BOT_API_BASE_URL;
    const apiKey = process.env.DASHBOARD_API_KEY;

    expect(baseUrl).toBeTruthy();
    expect(apiKey).toBeTruthy();

    const response = await fetch(`${baseUrl}/api/config`, {
      headers: { "X-Api-Key": apiKey! },
      signal: AbortSignal.timeout(8_000),
    });

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    expect(response.status).toBe(200);
  }, 12_000);
});
