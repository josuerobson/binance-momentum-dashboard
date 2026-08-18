import { getPool } from "../_core/db";

export interface AnalysisRecord {
  id: number;
  created_at: string;
  trade_count: number;
  win_rate_pct: number;
  total_pnl_usdt: number;
  analysis_text: string;
  rationale_text: string;
  suggested_config: Record<string, unknown>;
  applied_at: string | null;
  config_before: Record<string, unknown> | null;
  config_after: Record<string, unknown> | null;
}

async function ensureTable() {
  await getPool().execute(`
    CREATE TABLE IF NOT EXISTS ai_analysis_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      trade_count INT NOT NULL DEFAULT 0,
      win_rate_pct DOUBLE NOT NULL DEFAULT 0,
      total_pnl_usdt DOUBLE NOT NULL DEFAULT 0,
      analysis_text TEXT,
      rationale_text TEXT,
      suggested_config JSON,
      applied_at DATETIME NULL,
      config_before JSON NULL,
      config_after JSON NULL
    )
  `);
}

export async function saveAnalysis(data: {
  trade_count: number;
  win_rate_pct: number;
  total_pnl_usdt: number;
  analysis_text: string;
  rationale_text: string;
  suggested_config: Record<string, unknown>;
  config_before: Record<string, unknown>;
}): Promise<number> {
  await ensureTable();
  const [result] = await getPool().execute(
    `INSERT INTO ai_analysis_log
       (trade_count, win_rate_pct, total_pnl_usdt, analysis_text, rationale_text, suggested_config, config_before)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.trade_count,
      data.win_rate_pct,
      data.total_pnl_usdt,
      data.analysis_text,
      data.rationale_text,
      JSON.stringify(data.suggested_config),
      JSON.stringify(data.config_before),
    ]
  );
  return (result as { insertId: number }).insertId;
}

export async function markAnalysisApplied(id: number, configAfter: Record<string, unknown>): Promise<void> {
  await ensureTable();
  await getPool().execute(
    `UPDATE ai_analysis_log SET applied_at = NOW(), config_after = ? WHERE id = ?`,
    [JSON.stringify(configAfter), id]
  );
}

export async function getRecentAnalyses(limit = 5): Promise<AnalysisRecord[]> {
  await ensureTable();
  const [rows] = await getPool().execute(
    `SELECT * FROM ai_analysis_log ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return (rows as Record<string, unknown>[]).map(r => ({
    id: r.id as number,
    created_at: r.created_at as string,
    trade_count: r.trade_count as number,
    win_rate_pct: r.win_rate_pct as number,
    total_pnl_usdt: r.total_pnl_usdt as number,
    analysis_text: r.analysis_text as string,
    rationale_text: r.rationale_text as string,
    suggested_config: JSON.parse((r.suggested_config as string) ?? "{}"),
    applied_at: r.applied_at as string | null,
    config_before: r.config_before ? JSON.parse(r.config_before as string) : null,
    config_after: r.config_after ? JSON.parse(r.config_after as string) : null,
  }));
}
