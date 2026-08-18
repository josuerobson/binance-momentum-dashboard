import { ENV } from "../_core/env";

export type SlotConfig = {
  momentum_trigger_pct: number;
  momentum_window_secs: number;
  volume_surge_multiplier: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  position_size_pct: number;
  max_positions: number;
  trailing_stop_enabled: boolean;
  trailing_stop_distance_pct: number;
  btc_filter_enabled: boolean;
  btc_filter_window_secs: number;
  btc_min_momentum_pct: number;
  paper_balance: number;
  max_spread_pct: number;
  min_24h_volume_usdt: number;
  reasoning?: string;
};

export type ExperimentCycleSummary = {
  cycle_id: number;
  started_at: number;
  ended_at: number;
  slots: {
    label: string;
    ai_provider: string;
    trade_count: number;
    win_rate: number;
    avg_pnl_pct: number;
    total_pnl_pct: number;
    fitness_score: number;
    config: SlotConfig;
  }[];
};

const ADVISOR_SYSTEM = `You are an expert algorithmic trading parameter optimizer for a momentum scanner bot on Binance mainnet.
You receive the history of paper trading experiments (parallel A/B tests with different configs) and suggest the next optimal config.
Each config must balance signal quality (momentum threshold), risk management (stop/take-profit), and capital efficiency.
Key insight: lower momentum_trigger means more frequent signals but more false positives; higher means fewer but higher quality.
Return ONLY a raw JSON object (no markdown, no backticks, no explanation outside JSON).`;

const CONFIG_SCHEMA = `{
  "momentum_trigger_pct": <float 1.5-6.0, signal strength threshold>,
  "momentum_window_secs": <int 30-600, lookback window>,
  "volume_surge_multiplier": <float 1.2-5.0, volume filter>,
  "stop_loss_pct": <float 0.5-4.0>,
  "take_profit_pct": <float 1.0-15.0>,
  "position_size_pct": <float 2.0-20.0, % of paper balance per trade>,
  "max_positions": <int 1-5>,
  "trailing_stop_enabled": <boolean>,
  "trailing_stop_distance_pct": <float 0.5-5.0>,
  "btc_filter_enabled": <boolean>,
  "btc_filter_window_secs": <int 60-600>,
  "btc_min_momentum_pct": <float -3.0-0.0>,
  "paper_balance": 10000,
  "max_spread_pct": 0.5,
  "min_24h_volume_usdt": 5000000,
  "reasoning": "<2-3 sentences explaining why these parameters>"
}`;

function buildPrompt(history: ExperimentCycleSummary[]): string {
  const historyText = history.length === 0
    ? "No experiments have run yet. Use reasonable starting parameters."
    : `Past cycles (newest first):\n${JSON.stringify(history.slice(-5), null, 2)}`;
  return `${historyText}\n\nBased on these results, suggest the next parameter set to test. Optimize for maximum fitness_score (win_rate × avg_profit / max_drawdown). Return only this JSON:\n${CONFIG_SCHEMA}`;
}

function parseConfigFromText(text: string): SlotConfig | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.momentum_trigger_pct !== "number") return null;
    return {
      momentum_trigger_pct: Math.min(6, Math.max(1.5, parsed.momentum_trigger_pct ?? 2.5)),
      momentum_window_secs: Math.min(600, Math.max(30, Math.round(parsed.momentum_window_secs ?? 120))),
      volume_surge_multiplier: Math.min(5, Math.max(1.2, parsed.volume_surge_multiplier ?? 2.0)),
      stop_loss_pct: Math.min(4, Math.max(0.5, parsed.stop_loss_pct ?? 1.5)),
      take_profit_pct: Math.min(15, Math.max(1, parsed.take_profit_pct ?? 3.0)),
      position_size_pct: Math.min(20, Math.max(2, parsed.position_size_pct ?? 10)),
      max_positions: Math.min(5, Math.max(1, Math.round(parsed.max_positions ?? 3))),
      trailing_stop_enabled: parsed.trailing_stop_enabled !== false,
      trailing_stop_distance_pct: Math.min(5, Math.max(0.5, parsed.trailing_stop_distance_pct ?? 1.5)),
      btc_filter_enabled: parsed.btc_filter_enabled !== false,
      btc_filter_window_secs: Math.min(600, Math.max(60, Math.round(parsed.btc_filter_window_secs ?? 300))),
      btc_min_momentum_pct: Math.min(0, Math.max(-3, parsed.btc_min_momentum_pct ?? 0)),
      paper_balance: 10000,
      max_spread_pct: 0.5,
      min_24h_volume_usdt: 5_000_000,
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return null;
  }
}

export async function askClaude(history: ExperimentCycleSummary[]): Promise<SlotConfig | null> {
  const apiKey = ENV.anthropicApiKey;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: ADVISOR_SYSTEM,
        messages: [{ role: "user", content: buildPrompt(history) }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { content?: { text?: string }[] };
    const text = data.content?.[0]?.text ?? "";
    return parseConfigFromText(text);
  } catch {
    return null;
  }
}

export async function askMimo(apiKey: string, history: ExperimentCycleSummary[]): Promise<SlotConfig | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch("https://token-plan-sgp.xiaomimimo.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mimo-v2.5-pro",
        max_tokens: 1024,
        temperature: 0.3,
        messages: [
          { role: "system", content: ADVISOR_SYSTEM },
          { role: "user", content: buildPrompt(history) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    return parseConfigFromText(text);
  } catch {
    return null;
  }
}

export async function askGemini(apiKey: string, history: ExperimentCycleSummary[]): Promise<SlotConfig | null> {
  if (!apiKey) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: ADVISOR_SYSTEM }] },
        contents: [{ parts: [{ text: buildPrompt(history) }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return parseConfigFromText(text);
  } catch {
    return null;
  }
}
