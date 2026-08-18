import { getPool } from "../_core/db";

export type ProviderType = "claude" | "openai" | "gemini";

export interface AIProvider {
  id: number;
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl: string | null;
  model: string;
  enabled: boolean;
  createdAt: number;
}

export interface AIProviderPublic {
  id: number;
  name: string;
  type: ProviderType;
  baseUrl: string | null;
  model: string;
  enabled: boolean;
  createdAt: number;
  keyPreview: string;
}

export type AIFunctionId = "market_analysis" | "experiment_advisor";

export const AI_FUNCTIONS: Record<AIFunctionId, { label: string; description: string; multi: boolean }> = {
  market_analysis: {
    label: "Análise de Mercado",
    description: "Analisa os trades do paper trading e sugere ajustes de parâmetros",
    multi: false,
  },
  experiment_advisor: {
    label: "Advisor de Experimentos",
    description: "Sugere configurações para os slots paralelos de experimento",
    multi: true,
  },
};

let _initialized = false;

async function ensureTables() {
  if (_initialized) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(100) NOT NULL,
      type        ENUM('claude','openai','gemini') NOT NULL DEFAULT 'openai',
      api_key     TEXT NOT NULL,
      base_url    VARCHAR(500) DEFAULT NULL,
      model       VARCHAR(200) NOT NULL DEFAULT 'gpt-4o-mini',
      enabled     TINYINT(1) NOT NULL DEFAULT 1,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_assignments (
      function_id VARCHAR(100) NOT NULL,
      provider_id INT NOT NULL,
      PRIMARY KEY (function_id, provider_id),
      FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
    )
  `);
  _initialized = true;
}

function redact(key: string): string {
  if (!key || key.length < 8) return "***";
  return `${key.slice(0, 6)}***${key.slice(-4)}`;
}

export function toPublic(p: AIProvider): AIProviderPublic {
  const { apiKey, ...rest } = p;
  return { ...rest, keyPreview: redact(apiKey) };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listProviders(): Promise<AIProvider[]> {
  await ensureTables();
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, name, type, api_key, base_url, model, enabled, UNIX_TIMESTAMP(created_at)*1000 AS created_at
     FROM ai_providers ORDER BY id`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type as ProviderType,
    apiKey: r.api_key,
    baseUrl: r.base_url ?? null,
    model: r.model,
    enabled: !!r.enabled,
    createdAt: Number(r.created_at),
  }));
}

export async function getProvider(id: number): Promise<AIProvider | null> {
  await ensureTables();
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT id, name, type, api_key, base_url, model, enabled, UNIX_TIMESTAMP(created_at)*1000 AS created_at
     FROM ai_providers WHERE id = ?`,
    [id]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, name: r.name, type: r.type as ProviderType,
    apiKey: r.api_key, baseUrl: r.base_url ?? null,
    model: r.model, enabled: !!r.enabled, createdAt: Number(r.created_at),
  };
}

export async function createProvider(data: {
  name: string; type: ProviderType; apiKey: string;
  baseUrl?: string | null; model: string; enabled?: boolean;
}): Promise<number> {
  await ensureTables();
  const pool = getPool();
  const [result] = await pool.query<any>(
    `INSERT INTO ai_providers (name, type, api_key, base_url, model, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
    [data.name, data.type, data.apiKey, data.baseUrl ?? null, data.model, data.enabled !== false ? 1 : 0]
  );
  return result.insertId as number;
}

export async function updateProvider(id: number, data: {
  name?: string; type?: ProviderType; apiKey?: string;
  baseUrl?: string | null; model?: string; enabled?: boolean;
}): Promise<void> {
  await ensureTables();
  const pool = getPool();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (data.name !== undefined) { sets.push("name=?"); vals.push(data.name); }
  if (data.type !== undefined) { sets.push("type=?"); vals.push(data.type); }
  if (data.apiKey !== undefined && data.apiKey !== "") { sets.push("api_key=?"); vals.push(data.apiKey); }
  if (data.baseUrl !== undefined) { sets.push("base_url=?"); vals.push(data.baseUrl ?? null); }
  if (data.model !== undefined) { sets.push("model=?"); vals.push(data.model); }
  if (data.enabled !== undefined) { sets.push("enabled=?"); vals.push(data.enabled ? 1 : 0); }
  if (!sets.length) return;
  vals.push(id);
  await pool.query(`UPDATE ai_providers SET ${sets.join(",")} WHERE id=?`, vals);
}

export async function deleteProvider(id: number): Promise<void> {
  await ensureTables();
  const pool = getPool();
  await pool.query(`DELETE FROM ai_providers WHERE id=?`, [id]);
}

// ─── Assignments ─────────────────────────────────────────────────────────────

export async function getAssignments(): Promise<Record<string, number[]>> {
  await ensureTables();
  const pool = getPool();
  const [rows] = await pool.query<any[]>(`SELECT function_id, provider_id FROM ai_assignments`);
  const result: Record<string, number[]> = {};
  for (const r of rows) {
    if (!result[r.function_id]) result[r.function_id] = [];
    result[r.function_id].push(r.provider_id);
  }
  return result;
}

export async function setAssignment(functionId: AIFunctionId, providerIds: number[]): Promise<void> {
  await ensureTables();
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM ai_assignments WHERE function_id=?`, [functionId]);
    for (const pid of providerIds) {
      await conn.query(`INSERT IGNORE INTO ai_assignments (function_id, provider_id) VALUES (?,?)`, [functionId, pid]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function getAssignedProviders(functionId: AIFunctionId): Promise<AIProvider[]> {
  await ensureTables();
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT p.id, p.name, p.type, p.api_key, p.base_url, p.model, p.enabled, UNIX_TIMESTAMP(p.created_at)*1000 AS created_at
     FROM ai_providers p
     INNER JOIN ai_assignments a ON a.provider_id = p.id
     WHERE a.function_id=? AND p.enabled=1
     ORDER BY p.id`,
    [functionId]
  );
  return rows.map(r => ({
    id: r.id, name: r.name, type: r.type as ProviderType,
    apiKey: r.api_key, baseUrl: r.base_url ?? null,
    model: r.model, enabled: !!r.enabled, createdAt: Number(r.created_at),
  }));
}

// ─── Generic call ─────────────────────────────────────────────────────────────

export async function callProvider(
  provider: AIProvider,
  messages: { role: string; content: string }[],
  systemPrompt?: string,
  maxTokens = 2048,
): Promise<string> {
  switch (provider.type) {
    case "claude": {
      const url = (provider.baseUrl ?? "https://api.anthropic.com") + "/v1/messages";
      const body: Record<string, unknown> = {
        model: provider.model,
        max_tokens: maxTokens,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      };
      if (systemPrompt) body.system = systemPrompt;
      const res = await fetch(url, {
        method: "POST",
        headers: { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(50_000),
      });
      if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text().catch(() => "")}`);
      const data = await res.json() as { content?: { text?: string }[] };
      return data.content?.[0]?.text ?? "";
    }
    case "openai": {
      const url = (provider.baseUrl ?? "https://api.openai.com/v1") + "/chat/completions";
      const msgs = systemPrompt
        ? [{ role: "system", content: systemPrompt }, ...messages]
        : messages;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: provider.model, max_tokens: maxTokens, temperature: 0.3, messages: msgs }),
        signal: AbortSignal.timeout(50_000),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text().catch(() => "")}`);
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    }
    case "gemini": {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey}`;
      const body: Record<string, unknown> = {
        contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
      };
      if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(50_000),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => "")}`);
      const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }
  }
}

// ─── Test connection ──────────────────────────────────────────────────────────

export async function testProvider(id: number): Promise<{ ok: boolean; latency_ms: number; message: string }> {
  const provider = await getProvider(id);
  if (!provider) return { ok: false, latency_ms: 0, message: "Provedor não encontrado" };
  const t0 = Date.now();
  try {
    const text = await callProvider(
      provider,
      [{ role: "user", content: "Reply with exactly: OK" }],
      undefined,
      16,
    );
    const latency_ms = Date.now() - t0;
    return { ok: true, latency_ms, message: `Resposta recebida: "${text.slice(0, 60)}"` };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, message: String(e).slice(0, 200) };
  }
}
