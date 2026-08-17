import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";

export const logLevels = ["INFO", "WARN", "ERROR", "CRITICAL"] as const;
export type LogLevel = (typeof logLevels)[number];

export type NormalizedLog = {
  id: string;
  timestamp: string | null;
  level: LogLevel;
  message: string;
  source: string;
};

type LogEnvelope = { dados?: { container?: { log?: unknown } } };

function levelFor(message: string, explicit?: unknown): LogLevel {
  const candidate = typeof explicit === "string" ? explicit.toUpperCase() : "";
  if ((logLevels as readonly string[]).includes(candidate)) return candidate as LogLevel;
  if (/\b(CRITICAL|FATAL|PANIC)\b/i.test(message)) return "CRITICAL";
  if (/\b(ERROR|FAIL(?:ED|URE)?|EXCEPTION)\b/i.test(message)) return "ERROR";
  if (/\b(WARN(?:ING)?|RETRY|RECONCIL)\b/i.test(message)) return "WARN";
  return "INFO";
}

function parseLine(raw: string, index: number): NormalizedLog | null {
  const line = raw.trim();
  if (!line) return null;
  let timestamp: string | null = null;
  let level: unknown;
  let message = line;
  let source = "bot";
  try {
    const parsed = JSON.parse(line) as { timestamp?: unknown; level?: unknown; fields?: { message?: unknown }; target?: unknown };
    timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : null;
    level = parsed.level;
    message = typeof parsed.fields?.message === "string" ? parsed.fields.message : line;
    source = typeof parsed.target === "string" ? parsed.target : source;
  } catch {
    timestamp = line.match(/\b\d{4}-\d{2}-\d{2}T[\d:.+-]+Z\b/)?.[0] ?? null;
  }
  return { id: `${timestamp ?? "log"}-${index}-${message.slice(0, 32)}`, timestamp, level: levelFor(message, level), message, source };
}

export function parseLogEnvelope(payload: unknown): NormalizedLog[] {
  const raw = (payload as LogEnvelope)?.dados?.container?.log;
  if (typeof raw !== "string") return [];
  return raw.split(/\r?\n/).map(parseLine).filter((entry): entry is NormalizedLog => entry !== null).reverse();
}

export function classifyActivity(message: string) {
  if (/\bOCO\b/i.test(message)) return "OCO";
  if (/\b(signal|momentum)\b/i.test(message)) return "SINAL";
  if (/\b(order|ordem|filled|executed)\b/i.test(message)) return "ORDEM";
  if (/\b(emergency|panic|critical)\b/i.test(message)) return "EMERGÊNCIA";
  if (/\b(block|bloque)\b/i.test(message)) return "BLOQUEIO";
  return "SISTEMA";
}

const logsInput = z.object({ level: z.enum(logLevels).optional(), search: z.string().trim().max(200).optional(), limit: z.number().int().min(1).max(200).default(100) });
const activityInput = z.object({ kind: z.enum(["orders", "audit"]), limit: z.number().int().min(1).max(200).default(100) });

let cache: { entries: NormalizedLog[]; expiresAt: number } | null = null;

async function readLogs() {
  if (cache && cache.expiresAt > Date.now()) return cache.entries;
  if (!ENV.botLogsUrl) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A origem de logs não está configurada no servidor." });
  let response: Response;
  try {
    response = await fetch(ENV.botLogsUrl, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível consultar os logs do bot." });
  }
  if (!response.ok) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "O serviço de logs está temporariamente indisponível." });
  const payload: unknown = await response.json().catch(() => null);
  const entries = parseLogEnvelope(payload);
  cache = { entries, expiresAt: Date.now() + 2_000 };
  return entries;
}

export const logsRouter = router({
  list: protectedProcedure.input(logsInput).query(async ({ input }) => {
    const entries = await readLogs();
    const search = input.search?.toLocaleLowerCase();
    const filtered = entries.filter(entry => (!input.level || entry.level === input.level) && (!search || entry.message.toLocaleLowerCase().includes(search)));
    return { entries: filtered.slice(0, input.limit), fetchedAt: Date.now() };
  }),
  activity: protectedProcedure.input(activityInput).query(async ({ input }) => {
    const activity = (await readLogs()).map(entry => ({ ...entry, category: classifyActivity(entry.message) }));
    const filtered = input.kind === "orders" ? activity.filter(entry => entry.category === "ORDEM" || entry.category === "OCO") : activity.filter(entry => entry.category !== "SISTEMA");
    return { entries: filtered.slice(0, input.limit), fetchedAt: Date.now() };
  }),
});
