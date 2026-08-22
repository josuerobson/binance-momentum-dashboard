import { getPool } from "../_core/db";
import type { ExperimentCycleSummary } from "./aiAdvisors";

export interface PersistedOrchestratorState {
  running: boolean;
  phase: string;
  currentCycleId: number;
  cycleStartedAt: number | null;
  longRunStartedAt: number | null;
  longRunDeadlineAt: number | null;
  minTradesPerSlot: number;
  maxDurationMs: number;
  lastError: string | null;
}

let tablesReady = false;

async function ensureTables() {
  if (tablesReady) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS experiment_orchestrator_state (
      id INT NOT NULL DEFAULT 1 PRIMARY KEY,
      running TINYINT(1) NOT NULL DEFAULT 0,
      phase VARCHAR(50) NOT NULL DEFAULT 'idle',
      current_cycle_id INT NOT NULL DEFAULT 0,
      cycle_started_at BIGINT NULL,
      long_run_started_at BIGINT NULL,
      long_run_deadline_at BIGINT NULL,
      min_trades_per_slot INT NOT NULL DEFAULT 8,
      max_duration_ms BIGINT NOT NULL DEFAULT 1500000,
      last_error TEXT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS experiment_cycle_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cycle_id INT NOT NULL,
      started_at BIGINT NOT NULL,
      ended_at BIGINT NOT NULL,
      slots_json JSON NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  tablesReady = true;
}

function parseJsonField(v: unknown, fallback: unknown): unknown {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

export async function loadOrchestratorState(): Promise<PersistedOrchestratorState | null> {
  try {
    await ensureTables();
    const [rows] = await getPool().query(`SELECT * FROM experiment_orchestrator_state WHERE id = 1`);
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      running: Boolean(row.running),
      phase: (row.phase as string) ?? "idle",
      currentCycleId: (row.current_cycle_id as number) ?? 0,
      cycleStartedAt: (row.cycle_started_at as number | null) ?? null,
      longRunStartedAt: (row.long_run_started_at as number | null) ?? null,
      longRunDeadlineAt: (row.long_run_deadline_at as number | null) ?? null,
      minTradesPerSlot: (row.min_trades_per_slot as number) ?? 8,
      maxDurationMs: (row.max_duration_ms as number) ?? 1_500_000,
      lastError: (row.last_error as string | null) ?? null,
    };
  } catch { return null; }
}

export async function saveOrchestratorState(state: PersistedOrchestratorState): Promise<void> {
  try {
    await ensureTables();
    await getPool().query(`
      INSERT INTO experiment_orchestrator_state
        (id, running, phase, current_cycle_id, cycle_started_at, long_run_started_at,
         long_run_deadline_at, min_trades_per_slot, max_duration_ms, last_error)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        running = VALUES(running), phase = VALUES(phase),
        current_cycle_id = VALUES(current_cycle_id), cycle_started_at = VALUES(cycle_started_at),
        long_run_started_at = VALUES(long_run_started_at), long_run_deadline_at = VALUES(long_run_deadline_at),
        min_trades_per_slot = VALUES(min_trades_per_slot), max_duration_ms = VALUES(max_duration_ms),
        last_error = VALUES(last_error)
    `, [
      state.running ? 1 : 0,
      state.phase,
      state.currentCycleId,
      state.cycleStartedAt,
      state.longRunStartedAt,
      state.longRunDeadlineAt,
      state.minTradesPerSlot,
      state.maxDurationMs,
      state.lastError,
    ]);
  } catch (e) {
    console.error("[experimentStateDb] saveOrchestratorState failed:", e);
  }
}

export async function loadCycleHistory(): Promise<ExperimentCycleSummary[]> {
  try {
    await ensureTables();
    const [rows] = await getPool().query(
      `SELECT * FROM experiment_cycle_history ORDER BY started_at DESC LIMIT 100`
    );
    return (rows as Record<string, unknown>[]).map(r => ({
      cycle_id: r.cycle_id as number,
      started_at: r.started_at as number,
      ended_at: r.ended_at as number,
      slots: parseJsonField(r.slots_json, []) as ExperimentCycleSummary["slots"],
    }));
  } catch { return []; }
}

export async function appendCycleHistory(cycle: ExperimentCycleSummary): Promise<void> {
  try {
    await ensureTables();
    await getPool().query(
      `INSERT INTO experiment_cycle_history (cycle_id, started_at, ended_at, slots_json) VALUES (?, ?, ?, ?)`,
      [cycle.cycle_id, cycle.started_at, cycle.ended_at, JSON.stringify(cycle.slots)]
    );
  } catch (e) {
    console.error("[experimentStateDb] appendCycleHistory failed:", e);
  }
}
