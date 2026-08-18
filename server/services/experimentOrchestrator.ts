import { ENV } from "../_core/env";
import { askClaude, askGemini, askMimo, ExperimentCycleSummary, SlotConfig } from "./aiAdvisors";

export type ProviderConfig = {
  claudeEnabled: boolean;
  mimoEnabled: boolean;
  mimoApiKey: string;
  geminiEnabled: boolean;
  geminiApiKey: string;
};

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
  history: ExperimentCycleSummary[];
  lastError: string | null;
  providers: ProviderConfig;
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

class ExperimentOrchestrator {
  private state: OrchestratorState = {
    running: false,
    autoMode: false,
    phase: "idle",
    currentCycleId: 0,
    cycleStartedAt: null,
    history: [],
    lastError: null,
    providers: {
      claudeEnabled: true,
      mimoEnabled: false,
      mimoApiKey: "",
      geminiEnabled: false,
      geminiApiKey: "",
    },
    minTradesPerSlot: 8,
    maxDurationMs: 25 * 60 * 1000,
  };

  getState(): OrchestratorState { return { ...this.state }; }

  configure(providers: Partial<ProviderConfig>, minTrades?: number, maxDurationMin?: number) {
    this.state.providers = { ...this.state.providers, ...providers };
    if (minTrades) this.state.minTradesPerSlot = Math.max(3, minTrades);
    if (maxDurationMin) this.state.maxDurationMs = Math.max(5, maxDurationMin) * 60 * 1000;
  }

  async getSuggestions(): Promise<{ label: string; provider: string; config: SlotConfig }[]> {
    const history = this.state.history;
    const results: { label: string; provider: string; config: SlotConfig }[] = [];

    const { claudeEnabled, mimoEnabled, mimoApiKey, geminiEnabled, geminiApiKey } = this.state.providers;

    const [claudeConfig, mimoConfig, geminiConfig] = await Promise.all([
      claudeEnabled ? askClaude(history) : Promise.resolve(null),
      mimoEnabled && mimoApiKey ? askMimo(mimoApiKey, history) : Promise.resolve(null),
      geminiEnabled && geminiApiKey ? askGemini(geminiApiKey, history) : Promise.resolve(null),
    ]);

    if (claudeConfig) results.push({ label: "Claude", provider: "claude", config: claudeConfig });
    if (mimoConfig) results.push({ label: "MIMO", provider: "mimo", config: mimoConfig });
    if (geminiConfig) results.push({ label: "Gemini", provider: "gemini", config: geminiConfig });

    // If no AI produced a config, use sensible defaults
    if (results.length === 0) {
      results.push({ label: "Default", provider: "default", config: defaultConfig() });
    }

    return results;
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
      slots: suggestions.map((s, i) => ({
        id: i,
        label: s.label,
        ai_provider: s.provider,
        config: s.config,
      })),
    };

    const result = await fetchBot<{ cycle_id: number }>("/api/experiment/start", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    this.state.phase = "experiment_running";
    this.state.currentCycleId = result.cycle_id;
    this.state.cycleStartedAt = Date.now();
    this.state.running = true;

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
      // Keep only last 100 cycles in memory
      if (this.state.history.length > 100) this.state.history.shift();

      this.state.phase = "idle";
      this.state.running = false;
      this.state.cycleStartedAt = null;
      return cycle;
    } catch (e) {
      this.state.lastError = String(e);
      this.state.phase = "idle";
      this.state.running = false;
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
            const minReached = status.slots.length > 0 &&
              status.slots.every(s => s.trade_count >= this.state.minTradesPerSlot);
            if (minReached) break;
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
    this.runAutoLoop().catch(e => {
      this.state.lastError = String(e);
      this.state.autoMode = false;
    });
  }

  stopAutoMode() {
    this.state.autoMode = false;
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
    momentum_trigger_pct: 2.5,
    momentum_window_secs: 120,
    volume_surge_multiplier: 2.0,
    stop_loss_pct: 1.5,
    take_profit_pct: 3.0,
    position_size_pct: 10,
    max_positions: 3,
    trailing_stop_enabled: true,
    trailing_stop_distance_pct: 1.5,
    btc_filter_enabled: true,
    btc_filter_window_secs: 300,
    btc_min_momentum_pct: 0,
    paper_balance: 10000,
    max_spread_pct: 0.5,
    min_24h_volume_usdt: 5_000_000,
    reasoning: "Default starting configuration",
  };
}

export const orchestrator = new ExperimentOrchestrator();
