import { ENV } from "../_core/env";
import { ExperimentCycleSummary, SlotConfig } from "./aiAdvisors";
import { AIProvider, getAssignedProviders, callProvider } from "./aiRegistry";
import { getPrompt } from "./promptRegistry";
import { loadOrchestratorState, saveOrchestratorState, loadCycleHistory, appendCycleHistory } from "./experimentStateDb";

export type SlotStatus = {
  id: number;
  label: string;
  ai_provider: string;
  paper_balance: number;
  initial_balance: number;
  open_positions: number;
  trade_count: number;
  win_rate: number;
  avg_pnl_pct: number;
  total_pnl_pct: number;
  fitness_score: number;
  started_at: number;
  config: SlotConfig;
  history: unknown[];
};

export type ExperimentStatus = {
  active: boolean;
  cycle_id: number;
  slots: SlotStatus[];
};

export type OrchestratorState = {
  running: boolean;
  autoMode: boolean;
  phase: "idle" | "collecting_suggestions" | "experiment_running" | "analyzing";
  currentCycleId: number;
  cycleStartedAt: number | null;
  longRunStartedAt: number | null;
  longRunDeadlineAt: number | null;
  history: ExperimentCycleSummary[];
  lastError: string | null;
  minTradesPerSlot: number;
  maxDurationMs: number;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchBot<T>(path: string, opts?: RequestInit): Promise<T> {
  const baseUrl = ENV.botApiBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: { "X-Api-Key": ENV.dashboardApiKey, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Bot ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── AI advisor prompts (loaded from DB, editable via Integração IA) ─────────

async function buildPrompt(history: ExperimentCycleSummary[]): Promise<string> {
  const [schema] = await Promise.all([getPrompt("experiment_advisor_schema")]);
  const historyText = history.length === 0
    ? "No experiments yet. Use reasonable starting parameters."
    : `Past cycles (newest first):\n${JSON.stringify(history.slice(-5), null, 2)}`;
  return `${historyText}\n\nSuggest the next parameter set. Optimize for fitness_score = win_rate × avg_pnl / max_drawdown. Return only:\n${schema}`;
}

function parseConfig(text: string): SlotConfig | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    if (typeof p.momentum_trigger_pct !== "number") return null;
    return {
      momentum_trigger_pct: Math.min(6, Math.max(1.5, p.momentum_trigger_pct ?? 2.5)),
      momentum_window_secs: Math.min(600, Math.max(30, Math.round(p.momentum_window_secs ?? 120))),
      volume_surge_multiplier: Math.min(5, Math.max(1.2, p.volume_surge_multiplier ?? 2.0)),
      stop_loss_pct: Math.min(4, Math.max(0.5, p.stop_loss_pct ?? 1.5)),
      take_profit_pct: Math.min(15, Math.max(1, p.take_profit_pct ?? 3.0)),
      position_size_pct: Math.min(20, Math.max(2, p.position_size_pct ?? 10)),
      max_positions: Math.min(5, Math.max(1, Math.round(p.max_positions ?? 3))),
      trailing_stop_enabled: p.trailing_stop_enabled !== false,
      trailing_stop_distance_pct: Math.min(5, Math.max(0.5, p.trailing_stop_distance_pct ?? 1.5)),
      btc_filter_enabled: p.btc_filter_enabled !== false,
      btc_filter_window_secs: Math.min(600, Math.max(60, Math.round(p.btc_filter_window_secs ?? 300))),
      btc_min_momentum_pct: Math.min(0, Math.max(-3, p.btc_min_momentum_pct ?? 0)),
      paper_balance: 10000,
      max_spread_pct: 0.5,
      min_24h_volume_usdt: 5_000_000,
      reasoning: String(p.reasoning ?? ""),
    };
  } catch { return null; }
}

async function askProvider(provider: AIProvider, history: ExperimentCycleSummary[]): Promise<SlotConfig | null> {
  try {
    const [userPrompt, systemPrompt] = await Promise.all([
      buildPrompt(history),
      getPrompt("experiment_advisor_system"),
    ]);
    const text = await callProvider(provider, [{ role: "user", content: userPrompt }], systemPrompt, 1024);
    return parseConfig(text);
  } catch { return null; }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

class ExperimentOrchestrator {
  private state: OrchestratorState = {
    running: false,
    autoMode: false,
    phase: "idle",
    currentCycleId: 0,
    cycleStartedAt: null,
    longRunStartedAt: null,
    longRunDeadlineAt: null,
    history: [],
    lastError: null,
    minTradesPerSlot: 8,
    maxDurationMs: 25 * 60 * 1000,
  };

  private async persist() {
    await saveOrchestratorState({
      running: this.state.running,
      phase: this.state.phase,
      currentCycleId: this.state.currentCycleId,
      cycleStartedAt: this.state.cycleStartedAt,
      longRunStartedAt: this.state.longRunStartedAt,
      longRunDeadlineAt: this.state.longRunDeadlineAt,
      minTradesPerSlot: this.state.minTradesPerSlot,
      maxDurationMs: this.state.maxDurationMs,
      lastError: this.state.lastError,
    });
  }

  async init() {
    try {
      const [persisted, history] = await Promise.all([loadOrchestratorState(), loadCycleHistory()]);
      if (persisted) {
        this.state.running = persisted.running;
        this.state.phase = persisted.phase as OrchestratorState["phase"];
        this.state.currentCycleId = persisted.currentCycleId;
        this.state.cycleStartedAt = persisted.cycleStartedAt;
        this.state.longRunStartedAt = persisted.longRunStartedAt;
        this.state.longRunDeadlineAt = persisted.longRunDeadlineAt;
        this.state.minTradesPerSlot = persisted.minTradesPerSlot;
        this.state.maxDurationMs = persisted.maxDurationMs;
        this.state.lastError = persisted.lastError;
      }
      if (history.length > 0) this.state.history = history;
    } catch (e) {
      console.error("[orchestrator] init failed, using defaults:", e);
    }
  }

  getState(): OrchestratorState { return { ...this.state }; }

  configure(minTrades?: number, maxDurationMin?: number) {
    if (minTrades) this.state.minTradesPerSlot = Math.max(3, minTrades);
    if (maxDurationMin) this.state.maxDurationMs = Math.max(5, maxDurationMin) * 60 * 1000;
    void this.persist();
  }

  async getSuggestions(): Promise<{ label: string; provider: string; config: SlotConfig }[]> {
    const history = this.state.history;
    let providers: AIProvider[] = [];
    try {
      providers = await getAssignedProviders("experiment_advisor");
    } catch { /* DB not ready */ }

    if (providers.length === 0) {
      return [{ label: "Default", provider: "default", config: defaultConfig() }];
    }

    const results = await Promise.all(providers.map(p => askProvider(p, history)));
    const suggestions = providers
      .map((p, i) => results[i] ? { label: p.name, provider: p.name, config: results[i]! } : null)
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (suggestions.length === 0) {
      return [{ label: "Default", provider: "default", config: defaultConfig() }];
    }
    return suggestions;
  }

  async startCycle(): Promise<{ cycleId: number; slots: number }> {
    this.state.phase = "collecting_suggestions";
    this.state.lastError = null;

    let suggestions: { label: string; provider: string; config: SlotConfig }[];
    try {
      suggestions = await this.getSuggestions();
    } catch (e) {
      this.state.phase = "idle";
      this.state.lastError = String(e);
      throw e;
    }

    const payload = {
      balance: 10000,
      slots: suggestions.map((s, i) => ({ id: i, label: s.label, ai_provider: s.provider, config: s.config })),
    };

    const result = await fetchBot<{ cycle_id: number }>("/api/experiment/start", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    this.state.phase = "experiment_running";
    this.state.currentCycleId = result.cycle_id;
    this.state.cycleStartedAt = Date.now();
    this.state.running = true;
    void this.persist();

    return { cycleId: result.cycle_id, slots: suggestions.length };
  }

  async stopCycle(): Promise<ExperimentCycleSummary | null> {
    try {
      const statusBefore = await fetchBot<ExperimentStatus>("/api/experiment/status");
      await fetchBot<{ ok: boolean }>("/api/experiment/stop", { method: "POST", body: "{}" });
      this.state.phase = "analyzing";

      const cycle: ExperimentCycleSummary = {
        cycle_id: this.state.currentCycleId,
        started_at: this.state.cycleStartedAt ?? Date.now(),
        ended_at: Date.now(),
        slots: (statusBefore.slots ?? []).map(s => ({
          label: s.label,
          ai_provider: s.ai_provider,
          trade_count: s.trade_count,
          win_rate: s.win_rate,
          avg_pnl_pct: s.avg_pnl_pct,
          total_pnl_pct: s.total_pnl_pct,
          fitness_score: s.fitness_score,
          config: s.config as SlotConfig,
        })),
      };
      this.state.history.push(cycle);
      if (this.state.history.length > 100) this.state.history.shift();
      void appendCycleHistory(cycle);

      this.state.phase = "idle";
      this.state.running = false;
      this.state.cycleStartedAt = null;
      void this.persist();
      return cycle;
    } catch (e) {
      this.state.lastError = String(e);
      this.state.phase = "idle";
      this.state.running = false;
      void this.persist();
      return null;
    }
  }

  async runAutoLoop() {
    while (this.state.autoMode) {
      try {
        await this.startCycle();
        const deadline = Date.now() + this.state.maxDurationMs;
        while (Date.now() < deadline && this.state.autoMode) {
          await sleep(30_000);
          try {
            const status = await fetchBot<ExperimentStatus>("/api/experiment/status");
            const done = status.slots.length > 0 &&
              status.slots.every(s => s.trade_count >= this.state.minTradesPerSlot);
            if (done) break;
          } catch { /* ignore polling errors */ }
        }
        await this.stopCycle();
      } catch (e) {
        this.state.lastError = String(e);
        this.state.phase = "idle";
        this.state.running = false;
        await sleep(60_000);
      }
    }
    this.state.autoMode = false;
    this.state.phase = "idle";
  }

  startAutoMode() {
    if (this.state.autoMode) return;
    this.state.autoMode = true;
    this.runAutoLoop().catch(e => { this.state.lastError = String(e); this.state.autoMode = false; });
  }

  stopAutoMode() { this.state.autoMode = false; }

  async startLongRun(slots: { id: number; label: string; ai_provider: string; config: SlotConfig }[]): Promise<{ cycleId: number }> {
    this.state.lastError = null;
    await fetchBot<{ ok: boolean }>("/api/experiment/reset", {
      method: "POST",
      body: JSON.stringify({ balance: 10000 }),
    });
    // Strip `reasoning` — not a Rust RuntimeConfig field, saves ~800 bytes keeping payload under 8KB TCP buffer
    const botSlots = slots.map(s => {
      const { reasoning: _r, ...cfg } = s.config as SlotConfig & { reasoning?: string };
      return { id: s.id, label: s.label, ai_provider: s.ai_provider, config: cfg };
    });
    const result = await fetchBot<{ cycle_id: number }>("/api/experiment/start", {
      method: "POST",
      body: JSON.stringify({ balance: 10000, slots: botSlots }),
    });
    const now = Date.now();
    this.state.longRunStartedAt = now;
    this.state.longRunDeadlineAt = now + 30 * 24 * 60 * 60 * 1000;
    this.state.currentCycleId = result.cycle_id;
    this.state.cycleStartedAt = now;
    this.state.running = true;
    this.state.phase = "experiment_running";
    void this.persist();
    return { cycleId: result.cycle_id };
  }

  async recoverLongRun(slots: { id: number; label: string; ai_provider: string; config: SlotConfig }[]): Promise<{ cycleId: number }> {
    // Re-sends slot configs to the bot after a bot restart without resetting balance or timestamps.
    this.state.lastError = null;
    const botSlots = slots.map(s => {
      const { reasoning: _r, ...cfg } = s.config as SlotConfig & { reasoning?: string };
      return { id: s.id, label: s.label, ai_provider: s.ai_provider, config: cfg };
    });
    const result = await fetchBot<{ cycle_id: number }>("/api/experiment/start", {
      method: "POST",
      body: JSON.stringify({ balance: 10000, slots: botSlots }),
    });
    this.state.currentCycleId = result.cycle_id;
    this.state.cycleStartedAt = this.state.longRunStartedAt ?? Date.now();
    this.state.running = true;
    this.state.phase = "experiment_running";
    void this.persist();
    return { cycleId: result.cycle_id };
  }

  clearLongRun() {
    this.state.longRunStartedAt = null;
    this.state.longRunDeadlineAt = null;
    void this.persist();
  }

  getBestConfig(): { config: SlotConfig; fitness: number; provider: string } | null {
    let best: { config: SlotConfig; fitness: number; provider: string } | null = null;
    for (const cycle of this.state.history) {
      for (const slot of cycle.slots) {
        if (!best || slot.fitness_score > best.fitness) {
          best = { config: slot.config, fitness: slot.fitness_score, provider: slot.ai_provider };
        }
      }
    }
    return best;
  }
}

function defaultConfig(): SlotConfig {
  return {
    momentum_trigger_pct: 2.5, momentum_window_secs: 120,
    volume_surge_multiplier: 2.0, stop_loss_pct: 1.5, take_profit_pct: 3.0,
    position_size_pct: 10, max_positions: 3, trailing_stop_enabled: true,
    trailing_stop_distance_pct: 1.5, btc_filter_enabled: true,
    btc_filter_window_secs: 300, btc_min_momentum_pct: 0,
    paper_balance: 10000, max_spread_pct: 0.5, min_24h_volume_usdt: 5_000_000,
    reasoning: "Default starting configuration",
  };
}

export const orchestrator = new ExperimentOrchestrator();
