import { pool } from "../_core/db";

export interface PromptRecord {
  id: string;
  label: string;
  description: string;
  content: string;
  default_content: string;
  updated_at: string;
}

// ─── Default prompt contents ──────────────────────────────────────────────────

export const PROMPT_DEFAULTS: Record<string, { label: string; description: string; content: string }> = {
  market_analysis_intro: {
    label: "Análise de Mercado — Contexto e Persona",
    description: "Define o papel da IA, o contexto da estratégia e as interdependências dos parâmetros. Exibido antes dos dados computados (estatísticas e trades).",
    content: `Você é um analista quantitativo sênior especializado em estratégias de momentum intraday em criptomoedas. Seu papel é analisar com rigor os resultados de um bot de paper trading e sugerir otimizações baseadas em evidências — não em intuição.

## CONTEXTO DA ESTRATÉGIA
- Tipo: Momentum breakout em pares spot da Binance (dados de mercado reais, execução simulada)
- Funcionamento: O bot escaneia todos os pares USDT da Binance e entra em posições quando detecta:
  (1) momentum de preço acima do gatilho configurado na janela de tempo definida
  (2) surto de volume acima do multiplicador configurado
  (3) spread dentro do limite configurado
  (4) opcionalmente: filtro de momentum positivo no BTC
- Saída: Take Profit (TP), Stop Loss (SL) ou Trailing Stop (TRAILING)
- Objetivo de longo prazo: validar a estratégia em paper trading até atingir taxa de acerto e expectância seguros para operar com capital real. Prioridade é ROBUSTEZ, não P&L máximo a curto prazo.
- Interdependências dos parâmetros:
  • Se SL aumenta → position_size_pct deve diminuir proporcionalmente (risco $ constante)
  • Se TP/SL ratio < 1.5:1 → win rate precisa ser > 40% para estratégia ser positiva
  • Se momentum_window aumenta → menos sinais, mas de maior qualidade
  • Se btc_min_momentum_pct > 0 → filtra operações em momentos de queda do mercado ampliado
  • Se trailing_stop_distance < stop_loss → o trailing age como SL antecipado (evitar)`,
  },

  market_analysis_request: {
    label: "Análise de Mercado — Instrução e Formato de Saída",
    description: "A instrução final enviada à IA com o formato JSON esperado. Exibido após os dados de trades e estatísticas.",
    content: `## SOLICITAÇÃO DE ANÁLISE
Analise estes dados com rigor quantitativo. Responda SOMENTE com JSON válido, sem markdown, sem texto fora do JSON:

{
  "analysis": "análise detalhada em português — avalie: (1) se a expectância é positiva e o porquê, (2) padrão de saídas TP vs SL vs Trailing, (3) qual parâmetro provavelmente está causando mais perdas, (4) se o tamanho da amostra permite conclusões confiáveis, (5) se as análises anteriores produziram melhoria mensurável",
  "key_findings": ["observação objetiva 1", "observação objetiva 2", "observação objetiva 3"],
  "red_flags": ["problema crítico que precisa de ação imediata — ou array vazio se não houver"],
  "dont_change": ["param1", "param2"],
  "priority_changes": [
    {"param": "nome_do_parametro", "from": <valor_atual>, "to": <valor_sugerido>, "reason": "justificativa em 1 frase"}
  ],
  "confidence_level": "baixa|média|alta",
  "suggested_config": {
    "momentum_window_secs": <número>,
    "momentum_trigger_pct": <número>,
    "volume_surge_multiplier": <número>,
    "max_spread_pct": <número>,
    "min_24h_volume_usdt": <número>,
    "stop_loss_pct": <número>,
    "take_profit_pct": <número>,
    "position_size_pct": <número>,
    "max_positions": <número>,
    "paper_balance": <número>
  },
  "rationale": "justificativa dos ajustes mais importantes — explique o raciocínio quantitativo por trás de cada mudança principal e como elas interagem entre si"
}`,
  },

  experiment_advisor_system: {
    label: "Experimentos IA — Prompt de Sistema",
    description: "Define o papel da IA no sistema de experimentos paralelos. Enviado como system prompt antes de cada ciclo.",
    content: `You are an expert algorithmic trading parameter optimizer for a momentum scanner bot on Binance mainnet.
You receive the history of paper trading experiments (parallel A/B tests with different configs) and suggest the next optimal config.
Each config must balance signal quality (momentum threshold), risk management (stop/take-profit), and capital efficiency.
Return ONLY a raw JSON object (no markdown, no backticks, no explanation outside JSON).`,
  },

  experiment_advisor_schema: {
    label: "Experimentos IA — Schema de Configuração",
    description: "O formato JSON que a IA deve retornar ao sugerir novos parâmetros para os slots de experimento.",
    content: `{
  "momentum_trigger_pct": <float 1.5-6.0>,
  "momentum_window_secs": <int 30-600>,
  "volume_surge_multiplier": <float 1.2-5.0>,
  "stop_loss_pct": <float 0.5-4.0>,
  "take_profit_pct": <float 1.0-15.0>,
  "position_size_pct": <float 2.0-20.0>,
  "max_positions": <int 1-5>,
  "trailing_stop_enabled": <boolean>,
  "trailing_stop_distance_pct": <float 0.5-5.0>,
  "btc_filter_enabled": <boolean>,
  "btc_filter_window_secs": <int 60-600>,
  "btc_min_momentum_pct": <float -3.0-0.0>,
  "paper_balance": 10000,
  "max_spread_pct": 0.5,
  "min_24h_volume_usdt": 5000000,
  "reasoning": "<2-3 sentences explaining why>"
}`,
  },
};

// ─── DB operations ────────────────────────────────────────────────────────────

async function ensureTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ai_prompts (
      id VARCHAR(100) PRIMARY KEY,
      label VARCHAR(200) NOT NULL,
      description TEXT,
      content MEDIUMTEXT NOT NULL,
      default_content MEDIUMTEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

export async function getPrompt(id: string): Promise<string> {
  await ensureTable();
  const def = PROMPT_DEFAULTS[id];
  if (!def) throw new Error(`Unknown prompt id: ${id}`);

  const [rows] = await pool.execute(`SELECT content FROM ai_prompts WHERE id = ?`, [id]);
  const row = (rows as { content: string }[])[0];
  return row?.content ?? def.content;
}

export async function listPrompts(): Promise<PromptRecord[]> {
  await ensureTable();
  const [rows] = await pool.execute(`SELECT * FROM ai_prompts`);
  const dbMap = new Map((rows as PromptRecord[]).map(r => [r.id, r]));

  return Object.entries(PROMPT_DEFAULTS).map(([id, def]) => {
    const db = dbMap.get(id);
    return {
      id,
      label: def.label,
      description: def.description,
      content: db?.content ?? def.content,
      default_content: def.content,
      updated_at: db?.updated_at ?? "",
    };
  });
}

export async function setPrompt(id: string, content: string): Promise<void> {
  await ensureTable();
  const def = PROMPT_DEFAULTS[id];
  if (!def) throw new Error(`Unknown prompt id: ${id}`);

  await pool.execute(
    `INSERT INTO ai_prompts (id, label, description, content, default_content)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = NOW()`,
    [id, def.label, def.description, content, def.content]
  );
}

export async function resetPrompt(id: string): Promise<void> {
  await ensureTable();
  await pool.execute(`DELETE FROM ai_prompts WHERE id = ?`, [id]);
}
