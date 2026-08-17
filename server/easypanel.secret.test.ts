import { describe, expect, it } from "vitest";

describe("integração protegida com Easypanel", () => {
  it("autoriza a consulta de projetos com a API key configurada", async () => {
    const configuredBaseUrl = process.env.EASYPANEL_BASE_URL?.replace(/\/$/, "");
    const apiKey = process.env.EASYPANEL_API_KEY;

    expect(configuredBaseUrl).toBeTruthy();
    expect(apiKey).toBeTruthy();
    const baseUrl = /^https?:\/\//.test(configuredBaseUrl!)
      ? configuredBaseUrl!
      : `https://${configuredBaseUrl}`;

    const response = await fetch(`${baseUrl}/api/listProjectsAndServices`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    expect(response.status).toBe(200);
  }, 12_000);
});
